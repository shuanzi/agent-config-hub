/**
 * TauriFrontendGateway — 生产 FrontendGateway adapter（ARC-02b/ARC-02c）。
 *
 * 唯一依赖 Tauri frontend package 的模块。职责：
 * - read：构造 wire envelope（requestId 仅用于脱敏关联），invoke 唯一 verb
 *   command `frontend_gateway_read`，核对 envelope / wireVersion / requestId /
 *   顶层 payload tag 后转 contract 类型；任何不匹配或异常归一化为
 *   `ReadFailed(GATEWAY_UNAVAILABLE, retryRead)`，异常字符串不出本模块；
 * - observe：监听唯一 invalidation event `acm://workspace-invalidation`，
 *   核对 wireVersion 后按封闭 Subscription 过滤转发。listen 注册有界重试
 *   （递增延迟），期间 ready 保持 pending 且注册完成前的事件不投递；全部
 *   失败后进入降级（ready 照常 resolve，事件通道本就允许丢失），并以低频
 *   后台重建，重建成功后向 listener 补发一次 assetsInvalidated 强制重读
 *   对账；unlisten 后注销监听并停止重建。
 *
 * wire 类型只来自 src/gateway/wire/gateway-wire.ts（Rust export-wire 生成的
 * 受管产物）；contract 类型只来自 src/contract。UI 其余部分零改动。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FrontendGateway, ObserveHandle } from '../contract/gateway';
import type {
  ActionAvailability,
  AssetDetailSnapshot,
  AssetReadSurface,
  AssetRef,
  AssetType,
  CompatibilityStatus,
  EffectiveContext,
  FileTreeNode,
  InspectorData,
  MaskedSourcePart,
  NativeFileContent,
  NativeFileRef,
  NativeFileSnapshot,
  OverrideRelation,
  Query,
  ReadResult,
  SensitiveAccessGrant,
  SensitiveRevealQuery,
  SensitiveRevealSnapshot,
  SensitiveSegmentRef,
  SnapshotFor,
  Subscription,
  WorkspaceEvent,
} from '../contract/types';
import { canonicalizeWorkbenchFilters } from '../workbench/read-only-model';
import type {
  GlobalLocatorSnapshot,
  MvpAssetType,
  ReadOnlyAssetRef,
  ReadOnlyRow,
  SkillCellAvailability,
  SkillTargetState,
  ViewContext,
  WorkbenchActualReadSnapshot,
  WorkbenchFilters,
  WorkbenchQuery,
} from '../workbench/read-only-model';
import {
  GATEWAY_WIRE_VERSION,
  type ReadRequestEnvelope,
  type ReadRequestPayload,
  type WorkspaceEventEnvelope,
} from './wire/gateway-wire';

const INVALIDATION_EVENT = 'acm://workspace-invalidation';
const MVP_ASSET_TYPES: readonly MvpAssetType[] = ['skill', 'longTermInstruction', 'subagent'];
const WIRE_ASSET_TYPES: readonly AssetType[] = ['skill', 'longTermInstruction', 'subagent', 'hook'];
const AGENT_IDS = ['claude-code', 'codex', 'gemini-cli', 'opencode'] as const;
const STATUS_MEMBERSHIPS = [
  'editable',
  'readOnly',
  'incompatible',
  'normal',
  'overridden',
  'conflict',
  'drift',
] as const;
const INDEX_STATUSES = ['fresh', 'stale', 'rebuilding', 'failed'] as const;
const APPLICABILITY = ['resolved', 'unknown', 'blocked', 'stale'] as const;
const PRESENCE = ['absent', 'present', 'unknown', 'blocked', 'stale'] as const;
const ACTIVATION = ['notApplicable', 'enabled', 'disabled', 'unknown', 'blocked', 'stale'] as const;
const SENSITIVE_ACCESS_SCOPES = ['view', 'modify'] as const;
const LOCATOR_MATCH_FIELDS = [
  'displayName',
  'assetType',
  'agent',
  'ownership',
  'projectHint',
  'redactedSummary',
] as const;
const REASON_CODES = [
  'UNKNOWN_AGENT_VERSION',
  'INCOMPATIBLE_STRUCTURE',
  'UNSUPPORTED_CAPABILITY',
  'READ_ONLY_POLICY',
  'PERMISSION_DENIED',
  'OUTSIDE_MANAGED_SCOPE',
  'PROJECT_UNAVAILABLE',
  'UNKNOWN_FIELD_PRESERVED',
  'NON_TEXT_UNPREVIEWABLE',
  'VALIDATION_FAILED',
  'EXECUTABLE_CONTENT_RISK',
  'INDEX_STALE',
  'EXTERNAL_CHANGE',
  'REPREPARE_REQUIRED',
  'MERGE_CONFLICT',
  'TARGET_NAME_CONFLICT',
  'CONVERSION_DEGRADED',
  'CONVERSION_BLOCKED',
  'READ_FAILED',
  'SNAPSHOT_REQUIRED',
  'SNAPSHOT_FAILED',
  'SECURE_STORAGE_UNAVAILABLE',
  'DISK_FULL',
  'WRITE_FAILED',
  'ROLLBACK_FAILED',
  'RECOVERY_TARGET_OCCUPIED',
  'ADAPTER_SIGNATURE_INVALID',
  'ADAPTER_COMPATIBILITY_MISMATCH',
  'ADAPTER_REGRESSION_FAILED',
  'IMPORT_SOURCE_UNAVAILABLE',
  'EXPORT_DESTINATION_INVALID',
  'GATEWAY_UNAVAILABLE',
] as const;

/** observe 时序配置（默认值面向生产；测试可注入极小延迟以保持确定性） */
export interface TauriGatewayOptions {
  /** listen 注册失败后的重试延迟（递增）；重试次数 = 数组长度（共 1+length 次尝试） */
  observeRetryDelaysMs?: readonly number[];
  /** 降级后后台重建间隔 */
  observeRebuildIntervalMs?: number;
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [100, 300];
const DEFAULT_REBUILD_INTERVAL_MS = 2000;

/** ARC-02c：统一归一化结果（固定文案，不含异常字符串）。 */
function gatewayUnavailable<T>(): ReadResult<T> {
  return {
    kind: 'readFailed',
    reasonCode: 'GATEWAY_UNAVAILABLE',
    message: '本地 gateway 暂时不可用，请重试。',
    recoveryAction: { kind: 'retryRead' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function actionAvailabilityFromWire(value: unknown): ActionAvailability | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'allowed' && Object.keys(value).length === 1) return { kind: 'allowed' };
  if (
    value.kind === 'disabled' &&
    isOneOf(value.reasonCode, REASON_CODES) &&
    (Object.keys(value).length === 2 ||
      (Object.keys(value).length === 3 &&
        isRecord(value.recoveryAction) &&
        value.recoveryAction.kind === 'retryRead'))
  ) {
    return {
      kind: 'disabled',
      reasonCode: value.reasonCode,
      ...(value.recoveryAction === undefined ? {} : { recoveryAction: { kind: 'retryRead' } }),
    };
  }
  return null;
}

function nativeOwnershipFromWire(value: unknown): AssetRef['nativeOwnership'] | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'global' && Object.keys(value).length === 1) return { kind: 'global' };
  if (
    value.kind === 'project' &&
    maskedDisplayString(value.projectId) &&
    Object.keys(value).length === 2
  ) {
    return { kind: 'project', projectId: value.projectId };
  }
  return null;
}

function assetRefFromResponseWire(value: unknown): AssetRef | null {
  if (
    !isRecord(value) ||
    !maskedDisplayString(value.assetId) ||
    !isOneOf(value.assetType, WIRE_ASSET_TYPES) ||
    !maskedDisplayString(value.nativeUnitRef) ||
    !maskedDisplayString(value.adapterIdentity) ||
    Object.keys(value).length !== 5
  ) {
    return null;
  }
  const nativeOwnership = nativeOwnershipFromWire(value.nativeOwnership);
  return nativeOwnership === null
    ? null
    : {
        assetId: value.assetId,
        assetType: value.assetType,
        nativeUnitRef: value.nativeUnitRef,
        adapterIdentity: value.adapterIdentity,
        nativeOwnership,
      };
}

function sameAssetRef(left: AssetRef, right: AssetRef): boolean {
  return (
    left.assetId === right.assetId &&
    left.assetType === right.assetType &&
    left.nativeUnitRef === right.nativeUnitRef &&
    left.adapterIdentity === right.adapterIdentity &&
    left.nativeOwnership.kind === right.nativeOwnership.kind &&
    (left.nativeOwnership.kind !== 'project' ||
      right.nativeOwnership.kind !== 'project' ||
      left.nativeOwnership.projectId === right.nativeOwnership.projectId)
  );
}

function sensitiveRevealQueryFromWire(value: unknown): SensitiveRevealQuery | null {
  if (
    !isRecord(value) ||
    value.kind !== 'sensitiveReveal' ||
    !Object.keys(value).every((key) =>
      [
        'kind',
        'asset',
        'fileId',
        'segmentId',
        'fileRevision',
        'assetRevision',
        'scope',
        'surface',
      ].includes(key),
    ) ||
    Object.keys(value).length !== 8 ||
    !maskedDisplayString(value.fileId) ||
    !maskedDisplayString(value.segmentId) ||
    !maskedDisplayString(value.fileRevision) ||
    !maskedDisplayString(value.assetRevision) ||
    !isOneOf(value.scope, SENSITIVE_ACCESS_SCOPES) ||
    value.surface !== 'source'
  ) {
    return null;
  }
  const asset = assetRefFromResponseWire(value.asset);
  return asset === null
    ? null
    : {
        kind: 'sensitiveReveal',
        asset,
        fileId: value.fileId,
        segmentId: value.segmentId,
        fileRevision: value.fileRevision,
        assetRevision: value.assetRevision,
        scope: value.scope,
        surface: 'source',
      };
}

function canonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const instant = new Date(value);
  return !Number.isNaN(instant.getTime()) && instant.toISOString() === value;
}

/**
 * `sensitiveReveal` response 在进入 session/buffer 前必须完整复验 Rust DTO
 * 的封闭形状和 query binding。任何拒绝都由外层归一化，不读取或记录明文/grant。
 */
function sensitiveRevealSnapshotFromWire(
  value: unknown,
  request: SensitiveRevealQuery,
): SensitiveRevealSnapshot | null {
  if (
    !isRecord(value) ||
    value.kind !== 'sensitiveReveal' ||
    typeof value.plaintext !== 'string' ||
    !isRecord(value.grant) ||
    Object.keys(value).length !== 3 ||
    !Object.keys(value).every((key) => ['kind', 'plaintext', 'grant'].includes(key))
  ) {
    return null;
  }
  const grant = value.grant;
  if (
    !maskedDisplayString(grant.grantId) ||
    !maskedDisplayString(grant.fileId) ||
    !maskedDisplayString(grant.segmentId) ||
    !maskedDisplayString(grant.fileRevision) ||
    !maskedDisplayString(grant.assetRevision) ||
    !isOneOf(grant.scope, SENSITIVE_ACCESS_SCOPES) ||
    grant.surface !== 'source' ||
    !canonicalUtcTimestamp(grant.expiresAt) ||
    new Date(grant.expiresAt).getTime() <= Date.now() ||
    Object.keys(grant).length !== 9 ||
    !Object.keys(grant).every((key) =>
      [
        'grantId',
        'asset',
        'fileId',
        'segmentId',
        'fileRevision',
        'assetRevision',
        'scope',
        'surface',
        'expiresAt',
      ].includes(key),
    )
  ) {
    return null;
  }
  const asset = assetRefFromResponseWire(grant.asset);
  if (
    asset === null ||
    !sameAssetRef(asset, request.asset) ||
    grant.fileId !== request.fileId ||
    grant.segmentId !== request.segmentId ||
    grant.fileRevision !== request.fileRevision ||
    grant.assetRevision !== request.assetRevision ||
    grant.scope !== request.scope ||
    grant.surface !== request.surface
  ) {
    return null;
  }
  const decodedGrant: SensitiveAccessGrant = {
    grantId: grant.grantId,
    asset,
    fileId: grant.fileId,
    segmentId: grant.segmentId,
    fileRevision: grant.fileRevision,
    assetRevision: grant.assetRevision,
    scope: grant.scope,
    surface: 'source',
    expiresAt: grant.expiresAt,
  };
  return { kind: 'sensitiveReveal', plaintext: value.plaintext, grant: decodedGrant };
}

function nativeFileRefFromWire(value: unknown): NativeFileRef | null {
  if (
    !isRecord(value) ||
    !maskedDisplayString(value.fileId) ||
    !maskedDisplayString(value.name) ||
    !maskedDisplayString(value.relativePath) ||
    !isOneOf(value.fileKind, ['text', 'nonText', 'unknown'] as const) ||
    typeof value.isPrimary !== 'boolean' ||
    typeof value.hasDraftChanges !== 'boolean' ||
    Object.keys(value).length !== 8 ||
    !Object.keys(value).every((key) =>
      [
        'fileId',
        'name',
        'relativePath',
        'fileKind',
        'isPrimary',
        'canPreview',
        'canEdit',
        'hasDraftChanges',
      ].includes(key),
    )
  ) {
    return null;
  }
  const canPreview = actionAvailabilityFromWire(value.canPreview);
  const canEdit = actionAvailabilityFromWire(value.canEdit);
  return canPreview === null || canEdit === null
    ? null
    : {
        fileId: value.fileId,
        name: value.name,
        relativePath: value.relativePath,
        fileKind: value.fileKind,
        isPrimary: value.isPrimary,
        canPreview,
        canEdit,
        hasDraftChanges: value.hasDraftChanges,
      };
}

function fileTreeFromWire(value: unknown): FileTreeNode | null {
  if (!isRecord(value) || !maskedDisplayString(value.name)) return null;
  if (!Object.keys(value).every((key) => ['name', 'file', 'children'].includes(key))) return null;
  const file = value.file === undefined ? undefined : nativeFileRefFromWire(value.file);
  const children =
    value.children === undefined
      ? undefined
      : Array.isArray(value.children)
        ? value.children.map(fileTreeFromWire)
        : null;
  return file === null || children === null || children?.some((child) => child === null)
    ? null
    : {
        name: value.name,
        ...(file === undefined ? {} : { file }),
        ...(children === undefined ? {} : { children: children as FileTreeNode[] }),
      };
}

function sensitiveSourceIsMasked(value: string): boolean {
  return !/SYNTHETIC-SECRET-[A-Za-z0-9][A-Za-z0-9-]*/.test(value);
}

function maskedDisplayString(value: unknown): value is string {
  return isNonEmptyString(value) && sensitiveSourceIsMasked(value);
}

function allDecoded<T>(values: readonly (T | null)[]): values is T[] {
  return values.every((value): value is T => value !== null);
}

/**
 * `maskedParts` 只有 Rust authority 可构造。缺失/null 仍兼容旧 nativeFile
 * read；若出现则闭合验证每个 part，并与现有 sensitive segment 一一绑定。
 */
function maskedSourcePartsFromWire(
  value: unknown,
  sensitiveSegments: readonly SensitiveSegmentRef[],
  maskedText: string,
): MaskedSourcePart[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  const parts: MaskedSourcePart[] = [];
  const placeholderIds = new Set<string>();
  for (const part of value) {
    if (!isRecord(part)) return null;
    if (
      part.kind === 'text' &&
      maskedDisplayString(part.text) &&
      Object.keys(part).length === 2 &&
      Object.keys(part).every((key) => ['kind', 'text'].includes(key))
    ) {
      parts.push({ kind: 'text', text: part.text });
      continue;
    }
    if (
      part.kind === 'sensitivePlaceholder' &&
      maskedDisplayString(part.segmentId) &&
      Object.keys(part).length === 2 &&
      Object.keys(part).every((key) => ['kind', 'segmentId'].includes(key)) &&
      !placeholderIds.has(part.segmentId)
    ) {
      placeholderIds.add(part.segmentId);
      parts.push({ kind: 'sensitivePlaceholder', segmentId: part.segmentId });
      continue;
    }
    return null;
  }
  const segmentIds = new Set(sensitiveSegments.map((segment) => segment.segmentId));
  if (
    segmentIds.size !== sensitiveSegments.length ||
    placeholderIds.size !== segmentIds.size ||
    [...segmentIds].some((segmentId) => !placeholderIds.has(segmentId)) ||
    parts.map((part) => (part.kind === 'text' ? part.text : '••••••••')).join('') !== maskedText
  ) {
    return null;
  }
  return parts;
}

function nativeFileSnapshotFromWire(
  value: unknown,
  requestAsset: AssetRef,
  requestFileId: string,
): NativeFileSnapshot | null {
  if (
    !isRecord(value) ||
    value.kind !== 'nativeFile' ||
    !maskedDisplayString(value.revision) ||
    !maskedDisplayString(value.assetRevision) ||
    !isRecord(value.content) ||
    !Object.keys(value).every((key) =>
      ['kind', 'file', 'revision', 'assetRevision', 'content', 'structuredView'].includes(key),
    ) ||
    Object.keys(value).length !== 6
  ) {
    return null;
  }
  const file = nativeFileRefFromWire(value.file);
  const structuredView = actionAvailabilityFromWire(value.structuredView);
  if (file === null || file.fileId !== requestFileId || structuredView === null) return null;
  const wireContent = value.content;
  let content: NativeFileContent;
  if (
    wireContent.kind === 'source' &&
    maskedDisplayString(wireContent.maskedText) &&
    Array.isArray(wireContent.sensitiveSegments) &&
    Object.keys(wireContent).every((key) =>
      ['kind', 'maskedText', 'sensitiveSegments', 'maskedParts'].includes(key),
    ) &&
    file.fileKind === 'text'
  ) {
    const sensitiveSegments: SensitiveSegmentRef[] = [];
    for (const segment of wireContent.sensitiveSegments) {
      if (
        !isRecord(segment) ||
        !maskedDisplayString(segment.segmentId) ||
        !maskedDisplayString(segment.fileId) ||
        segment.fileId !== file.fileId ||
        !maskedDisplayString(segment.revision) ||
        segment.revision !== value.revision ||
        !isOneOf(segment.displayState, [
          'masked',
          'temporarilyRevealed',
          'changedMasked',
        ] as const) ||
        Object.keys(segment).length !== 4 ||
        !Object.keys(segment).every((key) =>
          ['segmentId', 'fileId', 'revision', 'displayState'].includes(key),
        )
      ) {
        return null;
      }
      sensitiveSegments.push({
        segmentId: segment.segmentId,
        fileId: segment.fileId,
        revision: segment.revision,
        displayState: segment.displayState,
      });
    }
    const maskedParts = maskedSourcePartsFromWire(
      wireContent.maskedParts,
      sensitiveSegments,
      wireContent.maskedText,
    );
    if (maskedParts === null) return null;
    content = {
      kind: 'source',
      maskedText: wireContent.maskedText,
      sensitiveSegments,
      ...(maskedParts === undefined ? {} : { maskedParts }),
    };
  } else if (
    wireContent.kind === 'nonTextMetadata' &&
    maskedDisplayString(wireContent.fileKindLabel) &&
    Number.isSafeInteger(wireContent.sizeBytes) &&
    (wireContent.sizeBytes as number) >= 0 &&
    maskedDisplayString(wireContent.pathDisplay) &&
    isOneOf(wireContent.reasonCode, REASON_CODES) &&
    maskedDisplayString(wireContent.reason) &&
    Object.keys(wireContent).length === 6 &&
    Object.keys(wireContent).every((key) =>
      ['kind', 'fileKindLabel', 'sizeBytes', 'pathDisplay', 'reasonCode', 'reason'].includes(key),
    ) &&
    file.fileKind !== 'text'
  ) {
    content = {
      kind: 'nonTextMetadata',
      fileKindLabel: wireContent.fileKindLabel,
      sizeBytes: wireContent.sizeBytes as number,
      pathDisplay: wireContent.pathDisplay,
      reasonCode: wireContent.reasonCode,
      reason: wireContent.reason,
    };
  } else {
    return null;
  }
  if (requestAsset.assetType === 'hook') return null;
  return {
    kind: 'nativeFile',
    file,
    revision: value.revision,
    assetRevision: value.assetRevision,
    content,
    structuredView,
  };
}

function skillTargetStateFromWire(value: unknown): SkillTargetState | null {
  if (
    !isRecord(value) ||
    !isOneOf(value.agent, AGENT_IDS) ||
    !isOneOf(value.presence, PRESENCE) ||
    !isOneOf(value.activation, ACTIVATION) ||
    !isOneOf(value.applicability, APPLICABILITY) ||
    !Object.keys(value).every((key) =>
      [
        'agent',
        'presence',
        'activation',
        'applicability',
        'enableAvailability',
        'disableAvailability',
        'pending',
        'stableReason',
      ].includes(key),
    )
  ) {
    return null;
  }
  const enableAvailability = skillCellAvailabilityFromWire(value.enableAvailability);
  const disableAvailability = skillCellAvailabilityFromWire(value.disableAvailability);
  const pending =
    value.pending === undefined
      ? undefined
      : isRecord(value.pending) &&
          maskedDisplayString(value.pending.operationId) &&
          maskedDisplayString(value.pending.phase) &&
          Object.keys(value.pending).length === 2
        ? { operationId: value.pending.operationId, phase: value.pending.phase }
        : null;
  if (
    enableAvailability === null ||
    disableAvailability === null ||
    pending === null ||
    (value.stableReason !== undefined && !maskedDisplayString(value.stableReason))
  ) {
    return null;
  }
  return {
    agent: value.agent,
    presence: value.presence,
    activation: value.activation,
    applicability: value.applicability,
    enableAvailability,
    disableAvailability,
    ...(pending === undefined ? {} : { pending }),
    ...(value.stableReason === undefined ? {} : { stableReason: value.stableReason }),
  };
}

function assetReadSurfaceFromWire(value: unknown, assetType: AssetType): AssetReadSurface | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (assetType === 'skill' && value.kind === 'skill') {
    if (
      !Array.isArray(value.agentTargetStates) ||
      value.agentTargetStates.length !== AGENT_IDS.length ||
      !Object.keys(value).every((key) =>
        ['kind', 'agentTargetStates', 'sourceReadAvailability', 'unknownContentReason'].includes(
          key,
        ),
      )
    ) {
      return null;
    }
    const agentTargetStates = value.agentTargetStates.map(skillTargetStateFromWire);
    const sourceReadAvailability = actionAvailabilityFromWire(value.sourceReadAvailability);
    if (
      !allDecoded(agentTargetStates) ||
      agentTargetStates.some((state, index) => state?.agent !== AGENT_IDS[index]) ||
      sourceReadAvailability === null ||
      (value.unknownContentReason !== undefined &&
        !isOneOf(value.unknownContentReason, REASON_CODES))
    ) {
      return null;
    }
    return {
      kind: 'skill',
      agentTargetStates,
      sourceReadAvailability,
      ...(value.unknownContentReason === undefined
        ? {}
        : { unknownContentReason: value.unknownContentReason }),
    };
  }
  if (assetType === 'longTermInstruction' && value.kind === 'longTermInstruction') {
    const markdownFile = nativeFileRefFromWire(value.markdownFile);
    return Object.keys(value).length === 2 && markdownFile !== null
      ? { kind: 'longTermInstruction', markdownFile }
      : null;
  }
  if (
    assetType !== 'subagent' ||
    value.kind !== 'subagent' ||
    !Object.keys(value).every((key) =>
      ['kind', 'model', 'tools', 'permissions', 'bodyFile', 'readOnlyReason'].includes(key),
    ) ||
    (value.model !== undefined && !maskedDisplayString(value.model)) ||
    !Array.isArray(value.tools) ||
    !value.tools.every(maskedDisplayString) ||
    !Array.isArray(value.permissions) ||
    !value.permissions.every(maskedDisplayString) ||
    (value.readOnlyReason !== undefined && !isOneOf(value.readOnlyReason, REASON_CODES))
  ) {
    return null;
  }
  const bodyFile = nativeFileRefFromWire(value.bodyFile);
  return bodyFile === null
    ? null
    : {
        kind: 'subagent',
        ...(value.model === undefined ? {} : { model: value.model }),
        tools: [...value.tools],
        permissions: [...value.permissions],
        bodyFile,
        ...(value.readOnlyReason === undefined ? {} : { readOnlyReason: value.readOnlyReason }),
      };
}

function detailEffectiveContextFromWire(value: unknown): EffectiveContext | null {
  if (
    !isRecord(value) ||
    !isOneOf(value.agent, AGENT_IDS) ||
    !isOneOf(value.scope, ['global', 'project'] as const) ||
    !maskedDisplayString(value.sourceTierLabel) ||
    !Number.isInteger(value.precedence) ||
    !Object.keys(value).every((key) =>
      ['agent', 'scope', 'sourceTierLabel', 'precedence'].includes(key),
    )
  ) {
    return null;
  }
  return {
    agent: value.agent,
    scope: value.scope,
    sourceTierLabel: value.sourceTierLabel,
    precedence: value.precedence as number,
  };
}

function sourceAnchorFromWire(value: unknown): InspectorData['sourceAnchor'] | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'userHome' && Object.keys(value).length === 1) return { kind: 'userHome' };
  if (
    value.kind === 'project' &&
    maskedDisplayString(value.projectName) &&
    Object.keys(value).length === 2
  ) {
    return { kind: 'project', projectName: value.projectName };
  }
  if (
    value.kind === 'globalRoot' &&
    maskedDisplayString(value.label) &&
    Object.keys(value).length === 2
  ) {
    return { kind: 'globalRoot', label: value.label };
  }
  return null;
}

function overrideRelationFromWire(value: unknown): OverrideRelation | null {
  if (
    !isRecord(value) ||
    !isOneOf(value.kind, ['overrides', 'overriddenBy', 'shadowed'] as const) ||
    !maskedDisplayString(value.otherAssetId) ||
    !maskedDisplayString(value.note) ||
    !Object.keys(value).every((key) => ['kind', 'otherAssetId', 'note'].includes(key))
  ) {
    return null;
  }
  return { kind: value.kind, otherAssetId: value.otherAssetId, note: value.note };
}

function sameDetailEffectiveContexts(
  left: readonly EffectiveContext[],
  right: readonly EffectiveContext[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (context, index) =>
        context.agent === right[index]?.agent &&
        context.scope === right[index]?.scope &&
        context.sourceTierLabel === right[index]?.sourceTierLabel &&
        context.precedence === right[index]?.precedence,
    )
  );
}

function assetDetailSnapshotFromWire(
  value: unknown,
  requestAsset: AssetRef,
): AssetDetailSnapshot | null {
  if (
    !isRecord(value) ||
    value.kind !== 'assetDetail' ||
    !isRecord(value.detail) ||
    !isRecord(value.inspector)
  ) {
    return null;
  }
  const detail = value.detail;
  const asset = assetRefFromResponseWire(detail.asset);
  const primaryFile = nativeFileRefFromWire(detail.primaryFile);
  const readSurface =
    asset === null ? null : assetReadSurfaceFromWire(detail.readSurface, asset.assetType);
  const fileTreeRoot =
    detail.fileTreeRoot === undefined ? undefined : fileTreeFromWire(detail.fileTreeRoot);
  if (
    asset === null ||
    !sameAssetRef(asset, requestAsset) ||
    !maskedDisplayString(detail.displayName) ||
    !isOneOf(detail.nativeUnitKind, [
      'singleFile',
      'multiFileDirectory',
      'configBlock',
      'pluginModule',
    ] as const) ||
    !maskedDisplayString(detail.revision) ||
    !isOneOf(detail.compatibility, [
      'verifiedWritable',
      'recognizedReadOnly',
      'incompatibleBlocked',
    ] as const) ||
    !isRecord(detail.capabilities) ||
    primaryFile === null ||
    !Array.isArray(detail.effectiveContexts) ||
    readSurface === null ||
    fileTreeRoot === null ||
    !Object.keys(detail).every((key) =>
      [
        'asset',
        'displayName',
        'nativeUnitKind',
        'revision',
        'compatibility',
        'capabilities',
        'effectiveContexts',
        'primaryFile',
        'fileTreeRoot',
        'readSurface',
      ].includes(key),
    ) ||
    !maskedDisplayString(value.revision) ||
    value.revision !== detail.revision
  ) {
    return null;
  }
  const edit = actionAvailabilityFromWire(detail.capabilities.edit);
  const convert = actionAvailabilityFromWire(detail.capabilities.convert);
  const exportAvailability = actionAvailabilityFromWire(detail.capabilities.export);
  const deleteAvailability = actionAvailabilityFromWire(detail.capabilities.delete);
  if (
    edit === null ||
    convert === null ||
    exportAvailability === null ||
    deleteAvailability === null
  ) {
    return null;
  }
  const treeFiles = (node: FileTreeNode): NativeFileRef[] => [
    ...(node.file === undefined ? [] : [node.file]),
    ...(node.children?.flatMap(treeFiles) ?? []),
  ];
  if (
    (detail.nativeUnitKind === 'multiFileDirectory' && fileTreeRoot === undefined) ||
    (fileTreeRoot !== undefined &&
      (treeFiles(fileTreeRoot).filter((file) => file.isPrimary).length !== 1 ||
        !treeFiles(fileTreeRoot).some(
          (file) => file.fileId === primaryFile.fileId && file.isPrimary,
        ))) ||
    (readSurface.kind === 'longTermInstruction' &&
      readSurface.markdownFile.fileId !== primaryFile.fileId) ||
    (readSurface.kind === 'subagent' && readSurface.bodyFile.fileId !== primaryFile.fileId)
  ) {
    return null;
  }
  const inspector = value.inspector;
  const detailEffectiveContexts = detail.effectiveContexts.map(detailEffectiveContextFromWire);
  const inspectorEffectiveContexts = Array.isArray(inspector.effectiveContexts)
    ? inspector.effectiveContexts.map(detailEffectiveContextFromWire)
    : null;
  const sourceAnchor = sourceAnchorFromWire(inspector.sourceAnchor);
  const overrides = Array.isArray(inspector.overrides)
    ? inspector.overrides.map(overrideRelationFromWire)
    : null;
  if (
    !Array.isArray(inspector.agents) ||
    !inspector.agents.every((agent) => isOneOf(agent, AGENT_IDS)) ||
    !isOneOf(inspector.scope, ['global', 'project'] as const) ||
    detailEffectiveContexts.some((context) => context === null) ||
    inspectorEffectiveContexts === null ||
    inspectorEffectiveContexts.some((context) => context === null) ||
    sourceAnchor === null ||
    !maskedDisplayString(inspector.pathDisplay) ||
    !isOneOf(inspector.compatibility, [
      'verifiedWritable',
      'recognizedReadOnly',
      'incompatibleBlocked',
    ] as const) ||
    overrides === null ||
    overrides.some((override) => override === null) ||
    inspector.compatibility !== detail.compatibility ||
    !sameDetailEffectiveContexts(
      detailEffectiveContexts as EffectiveContext[],
      inspectorEffectiveContexts as EffectiveContext[],
    ) ||
    !Object.keys(inspector).every((key) =>
      [
        'agents',
        'scope',
        'effectiveContexts',
        'sourceAnchor',
        'pathDisplay',
        'compatibility',
        'overrides',
      ].includes(key),
    )
  ) {
    return null;
  }
  return {
    kind: 'assetDetail',
    detail: {
      asset,
      displayName: detail.displayName,
      nativeUnitKind: detail.nativeUnitKind,
      revision: detail.revision,
      compatibility: detail.compatibility as CompatibilityStatus,
      capabilities: { edit, convert, export: exportAvailability, delete: deleteAvailability },
      effectiveContexts: detailEffectiveContexts as EffectiveContext[],
      primaryFile,
      ...(fileTreeRoot === undefined ? {} : { fileTreeRoot }),
      readSurface,
    },
    inspector: {
      agents: [...inspector.agents] as InspectorData['agents'],
      scope: inspector.scope,
      effectiveContexts: inspectorEffectiveContexts as EffectiveContext[],
      sourceAnchor,
      pathDisplay: inspector.pathDisplay,
      compatibility: inspector.compatibility as CompatibilityStatus,
      overrides: overrides as OverrideRelation[],
    },
    revision: value.revision,
  };
}

function viewContextFromWire(value: unknown): ViewContext | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if ((value.kind === 'all' || value.kind === 'global') && Object.keys(value).length === 1) {
    return { kind: value.kind };
  }
  return value.kind === 'project' &&
    isNonEmptyString(value.projectId) &&
    Object.keys(value).length === 2
    ? { kind: 'project', projectId: value.projectId }
    : null;
}

function assetRefFromWire(
  value: unknown,
  expectedAssetType: MvpAssetType,
): ReadOnlyAssetRef | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.assetId) ||
    value.assetType !== expectedAssetType ||
    !isNonEmptyString(value.nativeUnitRef) ||
    !isNonEmptyString(value.adapterIdentity) ||
    !isRecord(value.nativeOwnership)
  ) {
    return null;
  }
  const nativeOwnership =
    value.nativeOwnership.kind === 'global'
      ? ({ kind: 'global' } as const)
      : value.nativeOwnership.kind === 'project' &&
          isNonEmptyString(value.nativeOwnership.projectId)
        ? ({ kind: 'project', projectId: value.nativeOwnership.projectId } as const)
        : null;
  return nativeOwnership === null
    ? null
    : {
        assetId: value.assetId,
        assetType: expectedAssetType,
        nativeUnitRef: value.nativeUnitRef,
        adapterIdentity: value.adapterIdentity,
        nativeOwnership,
      };
}

function skillCellAvailabilityFromWire(value: unknown): SkillCellAvailability | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'allowed' && Object.keys(value).length === 1) return { kind: 'allowed' };
  if (
    (value.kind === 'disabled' || value.kind === 'blocked') &&
    isOneOf(value.reasonCode, REASON_CODES) &&
    Object.keys(value).length === 2
  ) {
    return { kind: value.kind, reasonCode: value.reasonCode };
  }
  return null;
}

function skillTargetStateSemanticallyValid(cell: SkillTargetState): boolean {
  const absent = cell.presence === 'absent';
  const present = cell.presence === 'present';
  const notApplicable = cell.activation === 'notApplicable';
  const active = cell.activation === 'enabled' || cell.activation === 'disabled';
  if (absent !== notApplicable || present !== active) return false;

  const unresolved =
    ['unknown', 'blocked', 'stale'].includes(cell.presence) ||
    ['unknown', 'blocked', 'stale'].includes(cell.activation) ||
    ['unknown', 'blocked', 'stale'].includes(cell.applicability);
  if (unresolved) {
    return (
      cell.enableAvailability.kind !== 'allowed' && cell.disableAvailability.kind !== 'allowed'
    );
  }
  if (absent) return cell.disableAvailability.kind !== 'allowed';
  if (cell.activation === 'disabled') return cell.disableAvailability.kind !== 'allowed';
  return cell.activation !== 'enabled' || cell.enableAvailability.kind !== 'allowed';
}

function rowFromWire(value: unknown, expectedAssetType: MvpAssetType): ReadOnlyRow | null {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.summary.asset)) return null;
  const summary = value.summary as Record<string, unknown>;
  const assetRef = assetRefFromWire(summary.asset, expectedAssetType);
  if (
    assetRef === null ||
    !isNonEmptyString(summary.displayName) ||
    !isNonEmptyString(value.sortBaseName) ||
    !Number.isInteger(value.authoritativeInputOrder) ||
    (value.authoritativeInputOrder as number) < 0 ||
    !Array.isArray(summary.agents) ||
    !summary.agents.every((agent) => isOneOf(agent, AGENT_IDS)) ||
    !isRecord(summary.sourceTier) ||
    !isNonEmptyString(summary.sourceTier.id) ||
    !isNonEmptyString(summary.sourceTier.label) ||
    !isRecord(summary.contextHint) ||
    !Array.isArray(value.statusMemberships) ||
    !value.statusMemberships.every((status) => isOneOf(status, STATUS_MEMBERSHIPS)) ||
    !Array.isArray(value.skillTargetStates) ||
    (value.redactedSummary !== undefined && !isNonEmptyString(value.redactedSummary))
  ) {
    return null;
  }
  const ownershipHint =
    summary.contextHint.kind === 'path' && isNonEmptyString(summary.contextHint.pathHint)
      ? summary.contextHint.pathHint
      : summary.contextHint.kind === 'project' && isNonEmptyString(summary.contextHint.projectName)
        ? summary.contextHint.projectName
        : null;
  if (ownershipHint === null) return null;
  const targetStates = value.skillTargetStates.map((cell) => {
    if (
      !isRecord(cell) ||
      !isOneOf(cell.agent, AGENT_IDS) ||
      !isOneOf(cell.presence, PRESENCE) ||
      !isOneOf(cell.activation, ACTIVATION) ||
      !isOneOf(cell.applicability, APPLICABILITY) ||
      skillCellAvailabilityFromWire(cell.enableAvailability) === null ||
      skillCellAvailabilityFromWire(cell.disableAvailability) === null ||
      (cell.pending !== undefined &&
        (!isRecord(cell.pending) ||
          !isNonEmptyString(cell.pending.operationId) ||
          !isNonEmptyString(cell.pending.phase) ||
          Object.keys(cell.pending).length !== 2)) ||
      (cell.stableReason !== undefined && !isNonEmptyString(cell.stableReason))
    ) {
      return null;
    }
    const state = {
      agent: cell.agent,
      presence: cell.presence,
      activation: cell.activation,
      applicability: cell.applicability,
      enableAvailability: skillCellAvailabilityFromWire(cell.enableAvailability)!,
      disableAvailability: skillCellAvailabilityFromWire(cell.disableAvailability)!,
      ...(cell.pending === undefined
        ? {}
        : {
            pending: {
              operationId: cell.pending.operationId as string,
              phase: cell.pending.phase as string,
            },
          }),
      ...(cell.stableReason === undefined ? {} : { stableReason: cell.stableReason }),
    } satisfies SkillTargetState;
    return skillTargetStateSemanticallyValid(state) ? state : null;
  });
  if (
    targetStates.some((cell) => cell === null) ||
    (expectedAssetType === 'skill' &&
      (targetStates.length !== AGENT_IDS.length ||
        !AGENT_IDS.every((agent, index) => targetStates[index]?.agent === agent)))
  ) {
    return null;
  }
  return {
    assetRef,
    assetId: assetRef.assetId,
    displayName: summary.displayName,
    sortBaseName: value.sortBaseName,
    authoritativeInputOrder: value.authoritativeInputOrder as number,
    nativeOwnership: assetRef.nativeOwnership,
    agents: [...summary.agents] as ReadOnlyRow['agents'],
    sourceTierId: summary.sourceTier.id,
    sourceTierLabel: summary.sourceTier.label,
    ownershipHint,
    ...(value.redactedSummary === undefined ? {} : { redactedSummary: value.redactedSummary }),
    statuses: [...value.statusMemberships] as ReadOnlyRow['statuses'],
    skillTargetStates: targetStates as SkillTargetState[],
  };
}

function provenanceFromWire(value: unknown):
  | { identity: string; version: string; source: { kind: 'builtIn' } }
  | {
      identity: string;
      version: string;
      source: { kind: 'activePackage'; packageIdentity: string; packageVersion: string };
    }
  | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.identity) ||
    !isNonEmptyString(value.version) ||
    !isRecord(value.source)
  )
    return null;
  if (value.source.kind === 'builtIn')
    return { identity: value.identity, version: value.version, source: { kind: 'builtIn' } };
  if (
    value.source.kind === 'activePackage' &&
    isNonEmptyString(value.source.packageIdentity) &&
    isNonEmptyString(value.source.packageVersion)
  ) {
    return {
      identity: value.identity,
      version: value.version,
      source: {
        kind: 'activePackage',
        packageIdentity: value.source.packageIdentity,
        packageVersion: value.source.packageVersion,
      },
    };
  }
  return null;
}

function effectiveContextFromWire(value: unknown, expectedAssetType: MvpAssetType) {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.assetId) ||
    !isNonEmptyString(value.projectId) ||
    !isNonEmptyString(value.projectDisplayName) ||
    !isOneOf(value.resolution, APPLICABILITY) ||
    !isNonEmptyString(value.authoritativeReadRevision) ||
    !isNonEmptyString(value.sourceTierId) ||
    !Number.isInteger(value.loadOrder) ||
    !Number.isInteger(value.priority) ||
    (value.reasonCode !== undefined && !isOneOf(value.reasonCode, REASON_CODES))
  )
    return null;
  const asset = assetRefFromWire(value.asset, expectedAssetType);
  const adapter = provenanceFromWire(value.adapter);
  const rule = provenanceFromWire(value.rule);
  const overrideRelation =
    value.overrideRelation === undefined
      ? undefined
      : isRecord(value.overrideRelation) &&
          isOneOf(value.overrideRelation.kind, [
            'overrides',
            'overriddenBy',
            'shadowed',
          ] as const) &&
          isNonEmptyString(value.overrideRelation.otherAssetId) &&
          isNonEmptyString(value.overrideRelation.note)
        ? {
            kind: value.overrideRelation.kind,
            otherAssetId: value.overrideRelation.otherAssetId,
            note: value.overrideRelation.note,
          }
        : null;
  if (
    asset === null ||
    asset.assetId !== value.assetId ||
    adapter === null ||
    rule === null ||
    overrideRelation === null
  )
    return null;
  if ((value.resolution === 'resolved') !== (value.reasonCode === undefined)) return null;
  return {
    asset,
    assetId: value.assetId,
    projectId: value.projectId,
    projectDisplayName: value.projectDisplayName,
    adapter,
    rule,
    authoritativeReadRevision: value.authoritativeReadRevision,
    sourceTierId: value.sourceTierId,
    loadOrder: value.loadOrder as number,
    priority: value.priority as number,
    resolution: value.resolution,
    ...(overrideRelation === undefined ? {} : { overrideRelation }),
    ...(value.reasonCode === undefined ? {} : { reasonCode: value.reasonCode }),
  };
}

function filtersFromWire(
  value: unknown,
  viewContext: ViewContext,
): WorkbenchFilters | null | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Object.keys(value).length === 0 ||
    !Object.keys(value).every((key) =>
      ['agents', 'sourceIds', 'statuses', 'projectIds'].includes(key),
    )
  )
    return null;
  const agents = value.agents;
  const sourceIds = value.sourceIds;
  const statuses = value.statuses;
  const projectIds = value.projectIds;
  if (
    (agents !== undefined &&
      (!Array.isArray(agents) ||
        agents.length === 0 ||
        !agents.every((agent) => isOneOf(agent, AGENT_IDS)))) ||
    (sourceIds !== undefined &&
      (!Array.isArray(sourceIds) ||
        sourceIds.length === 0 ||
        !sourceIds.every(isNonEmptyString))) ||
    (statuses !== undefined &&
      (!Array.isArray(statuses) ||
        statuses.length === 0 ||
        !statuses.every((status) => isOneOf(status, STATUS_MEMBERSHIPS)))) ||
    (projectIds !== undefined &&
      (!Array.isArray(projectIds) ||
        projectIds.length === 0 ||
        !projectIds.every(isNonEmptyString))) ||
    (viewContext.kind !== 'all' && projectIds !== undefined)
  )
    return null;
  const supplied: WorkbenchFilters = {
    ...(agents === undefined ? {} : { agents }),
    ...(sourceIds === undefined ? {} : { sourceIds }),
    ...(statuses === undefined ? {} : { statuses }),
    ...(projectIds === undefined ? {} : { projectIds }),
  };
  try {
    const canonical = canonicalizeWorkbenchFilters(supplied, viewContext);
    return canonical === undefined || !sameCanonicalFilters(supplied, canonical) ? null : canonical;
  } catch {
    return null;
  }
}

function sameStringArray(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((value, index) => value === right[index]))
  );
}

function sameCanonicalFilters(left: WorkbenchFilters, right: WorkbenchFilters): boolean {
  return (
    sameStringArray(left.agents, right.agents) &&
    sameStringArray(left.sourceIds, right.sourceIds) &&
    sameStringArray(left.statuses, right.statuses) &&
    sameStringArray(left.projectIds, right.projectIds)
  );
}

/** Workbench snapshot query has no tag; request query adds the closed `kind` tag. */
function workbenchQueryFromWire(value: unknown, requestForm: boolean): WorkbenchQuery | null {
  if (!isRecord(value)) return null;
  const allowedKeys = requestForm
    ? ['kind', 'assetType', 'viewContext', 'filters']
    : ['assetType', 'viewContext', 'filters'];
  if (
    !Object.keys(value).every((key) => allowedKeys.includes(key)) ||
    !isOneOf(value.assetType, MVP_ASSET_TYPES) ||
    (requestForm && value.kind !== 'workbench') ||
    (Object.prototype.hasOwnProperty.call(value, 'filters') && value.filters === undefined)
  ) {
    return null;
  }
  const viewContext = viewContextFromWire(value.viewContext);
  if (viewContext === null) return null;
  const filters = filtersFromWire(value.filters, viewContext);
  if (filters === null) return null;
  return {
    kind: 'workbench',
    assetType: value.assetType,
    viewContext,
    ...(filters === undefined ? {} : { filters }),
  };
}

/** snapshot echo 必须正好对应本次 canonical workbench request，不能被 session 投影。 */
function sameCanonicalWorkbenchRequest(
  requested: Extract<Query, { kind: 'workbench' }>,
  echoed: WorkbenchActualReadSnapshot['query'],
): boolean {
  const requestedView = requested.viewContext;
  const echoedView = echoed.viewContext;
  return (
    requested.assetType === echoed.assetType &&
    requestedView.kind === echoedView.kind &&
    (requestedView.kind !== 'project' ||
      echoedView.kind !== 'project' ||
      requestedView.projectId === echoedView.projectId) &&
    sameStringArray(requested.filters?.agents, echoed.filters?.agents) &&
    sameStringArray(requested.filters?.sourceIds, echoed.filters?.sourceIds) &&
    sameStringArray(requested.filters?.statuses, echoed.filters?.statuses) &&
    sameStringArray(requested.filters?.projectIds, echoed.filters?.projectIds)
  );
}

/** Rust-first DTO → contract read snapshot. Unknown/malformed nested fields fail closed. */
function workbenchSnapshotFromWire(value: unknown): WorkbenchActualReadSnapshot | null {
  if (!isRecord(value) || value.kind !== 'workbench' || !isRecord(value.query)) return null;
  const query = workbenchQueryFromWire(value.query, false);
  const aggregateTotalValue = value.aggregateTotal;
  if (
    query === null ||
    !isNonEmptyString(value.authoritativeReadRevision) ||
    !Array.isArray(value.segments) ||
    typeof aggregateTotalValue !== 'number' ||
    !Number.isInteger(aggregateTotalValue) ||
    aggregateTotalValue < 0 ||
    !isOneOf(value.indexStatus, INDEX_STATUSES) ||
    !isNonEmptyString(value.readAt)
  ) {
    return null;
  }
  const assetType = query.assetType;
  const segments = value.segments.map((segment) => {
    if (
      !isRecord(segment) ||
      !isNonEmptyString(segment.id) ||
      (segment.source !== 'globalApplicable' && segment.source !== 'projectNative') ||
      !isNonEmptyString(segment.displayLabel) ||
      !Array.isArray(segment.rows)
    ) {
      return null;
    }
    if (
      (segment.source === 'globalApplicable' && segment.projectId !== undefined) ||
      (segment.source === 'projectNative' && !isNonEmptyString(segment.projectId))
    )
      return null;
    const rows = segment.rows.map((row) => rowFromWire(row, assetType));
    return rows.some((row) => row === null)
      ? null
      : {
          id: segment.id,
          source: segment.source,
          displayLabel: segment.displayLabel,
          ...(typeof segment.projectId === 'string' ? { projectId: segment.projectId } : {}),
          rows: rows as ReadOnlyRow[],
        };
  });
  if (segments.some((segment) => segment === null)) return null;
  const effectiveContexts = !Array.isArray(value.effectiveContexts)
    ? null
    : value.effectiveContexts.map((context) => effectiveContextFromWire(context, assetType));
  const findings = !Array.isArray(value.findings)
    ? null
    : value.findings.map((finding) => {
        if (
          !isRecord(finding) ||
          !isNonEmptyString(finding.assetId) ||
          !isOneOf(finding.reasonCode, REASON_CODES)
        )
          return null;
        const context = effectiveContextFromWire(finding.context, assetType);
        return context === null ||
          context.assetId !== finding.assetId ||
          context.reasonCode !== finding.reasonCode
          ? null
          : { assetId: finding.assetId, reasonCode: finding.reasonCode, context };
      });
  if (
    effectiveContexts === null ||
    effectiveContexts.some((context) => context === null) ||
    findings === null ||
    findings.some((finding) => finding === null)
  )
    return null;
  const aggregateTotal = (segments as Array<{ rows: readonly ReadOnlyRow[] }>).reduce(
    (total, segment) => total + segment.rows.length,
    0,
  );
  if (aggregateTotal !== aggregateTotalValue) return null;
  return {
    kind: 'workbench',
    query,
    authoritativeReadRevision: value.authoritativeReadRevision,
    segments: segments as WorkbenchActualReadSnapshot['segments'],
    effectiveContexts: effectiveContexts as WorkbenchActualReadSnapshot['effectiveContexts'],
    findings: findings as WorkbenchActualReadSnapshot['findings'],
    aggregateTotal: aggregateTotalValue,
    indexStatus: value.indexStatus,
    readAt: value.readAt,
  };
}

function locatorSnapshotFromWire(value: unknown): GlobalLocatorSnapshot | null {
  if (
    !isRecord(value) ||
    value.kind !== 'globalLocator' ||
    !Array.isArray(value.groups) ||
    !isNonEmptyString(value.readAt)
  ) {
    return null;
  }
  const aggregateTotalValue = value.aggregateTotal;
  if (
    typeof aggregateTotalValue !== 'number' ||
    !Number.isInteger(aggregateTotalValue) ||
    aggregateTotalValue < 0
  )
    return null;
  const groups = value.groups.map((group) => {
    if (!isRecord(group)) return null;
    const assetType = group.assetType;
    const count = group.count;
    if (
      !isOneOf(assetType, MVP_ASSET_TYPES) ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 0 ||
      !Array.isArray(group.results)
    ) {
      return null;
    }
    const results = group.results.map((result) => {
      if (!isRecord(result)) return null;
      const row = rowFromWire(result.row, assetType);
      const destinationViewContext = viewContextFromWire(result.destinationViewContext);
      const rawDestination = isRecord(result.destination) ? result.destination : null;
      const destinationKind =
        rawDestination !== null &&
        (rawDestination.kind === 'skillDetail' || rawDestination.kind === 'typeSpecificDetail')
          ? rawDestination.kind
          : null;
      const destination =
        destinationKind !== null
          ? (assetType === 'skill' && destinationKind === 'skillDetail') ||
            (assetType !== 'skill' && destinationKind === 'typeSpecificDetail')
            ? assetRefFromWire(rawDestination!.assetRef, assetType)
            : null
          : rawDestination?.kind === 'unsupportedReadOnly'
            ? (() => {
                const assetRef = assetRefFromWire(rawDestination.assetRef, assetType);
                return assetRef === null || !isOneOf(rawDestination.reasonCode, REASON_CODES)
                  ? null
                  : { assetRef, reasonCode: rawDestination.reasonCode };
              })()
            : null;
      const matchedField = isOneOf(result.matchedField, LOCATOR_MATCH_FIELDS)
        ? result.matchedField
        : null;
      const destinationAsset =
        destination === null ? null : 'assetId' in destination ? destination : destination.assetRef;
      const destinationMatchesRow =
        destinationAsset !== null &&
        row?.assetRef !== undefined &&
        destinationAsset.assetId === row.assetRef.assetId &&
        destinationAsset.assetType === row.assetRef.assetType &&
        destinationAsset.nativeUnitRef === row.assetRef.nativeUnitRef &&
        destinationAsset.adapterIdentity === row.assetRef.adapterIdentity &&
        destinationAsset.nativeOwnership.kind === row.assetRef.nativeOwnership.kind &&
        (destinationAsset.nativeOwnership.kind !== 'project' ||
          row.assetRef.nativeOwnership.kind !== 'project' ||
          destinationAsset.nativeOwnership.projectId === row.assetRef.nativeOwnership.projectId);
      return row === null ||
        !isNonEmptyString(row.redactedSummary) ||
        !isNonEmptyString(row.ownershipHint) ||
        destinationViewContext === null ||
        destination === null ||
        matchedField === null ||
        !destinationMatchesRow
        ? null
        : {
            ...row,
            redactedSummary: row.redactedSummary,
            ownershipHint: row.ownershipHint,
            destinationViewContext,
            destination:
              'assetId' in destination
                ? {
                    kind: destinationKind!,
                    assetRef: destination,
                  }
                : { kind: 'unsupportedReadOnly' as const, ...destination },
            matchedField,
          };
    });
    return results.some((result) => result === null)
      ? null
      : {
          assetType,
          count,
          results: results as GlobalLocatorSnapshot['groups'][number]['results'],
        };
  });
  if (groups.some((group) => group === null)) return null;
  if (!MVP_ASSET_TYPES.every((assetType, index) => groups[index]?.assetType === assetType))
    return null;
  const total = (groups as Array<{ count: number; results: readonly unknown[] }>).reduce(
    (sum, group) => sum + group.count,
    0,
  );
  if (
    total !== aggregateTotalValue ||
    (groups as Array<{ count: number; results: readonly unknown[] }>).some(
      (group) => group.count !== group.results.length,
    )
  )
    return null;
  return {
    kind: 'globalLocator',
    groups: groups as GlobalLocatorSnapshot['groups'],
    aggregateTotal: aggregateTotalValue,
    readAt: value.readAt,
  };
}

/**
 * 核对 response envelope 与顶层 payload tag，并把 snapshot 与 query 的封闭
 * 对应关系再验证一遍。任何不匹配返回 null（由调用方归一化）。
 */
function normalizeResponse<Q extends Query>(
  raw: unknown,
  requestId: string,
  request: Q,
): ReadResult<SnapshotFor<Q>> | null {
  if (
    !isRecord(raw) ||
    (request.kind === 'sensitiveReveal' &&
      (Object.keys(raw).length !== 3 ||
        !Object.keys(raw).every((key) => ['wireVersion', 'requestId', 'payload'].includes(key))))
  ) {
    return null;
  }
  if (raw.wireVersion !== GATEWAY_WIRE_VERSION || raw.requestId !== requestId) {
    return null;
  }
  const payload = raw.payload;
  if (!isRecord(payload)) {
    return null;
  }
  if (payload.kind === 'readSucceeded') {
    const snapshot = payload.snapshot;
    if (
      !isRecord(snapshot) ||
      snapshot.kind !== request.kind ||
      (request.kind === 'sensitiveReveal' &&
        (Object.keys(payload).length !== 2 ||
          !Object.keys(payload).every((key) => ['kind', 'snapshot'].includes(key))))
    ) {
      return null;
    }
    if (request.kind === 'workbench') {
      const normalized = workbenchSnapshotFromWire(snapshot);
      return normalized === null || !sameCanonicalWorkbenchRequest(request, normalized.query)
        ? null
        : ({ kind: 'readSucceeded', snapshot: normalized } as ReadResult<SnapshotFor<Q>>);
    }
    if (request.kind === 'globalLocator') {
      const normalized = locatorSnapshotFromWire(snapshot);
      return normalized === null
        ? null
        : ({ kind: 'readSucceeded', snapshot: normalized } as ReadResult<SnapshotFor<Q>>);
    }
    if (request.kind === 'assetDetail') {
      const normalized = assetDetailSnapshotFromWire(snapshot, request.asset);
      return normalized === null
        ? null
        : ({ kind: 'readSucceeded', snapshot: normalized } as ReadResult<SnapshotFor<Q>>);
    }
    if (request.kind === 'nativeFile') {
      const normalized = nativeFileSnapshotFromWire(snapshot, request.asset, request.fileId);
      return normalized === null
        ? null
        : ({ kind: 'readSucceeded', snapshot: normalized } as ReadResult<SnapshotFor<Q>>);
    }
    if (request.kind === 'sensitiveReveal') {
      const normalized = sensitiveRevealSnapshotFromWire(snapshot, request);
      return normalized === null
        ? null
        : ({ kind: 'readSucceeded', snapshot: normalized } as ReadResult<SnapshotFor<Q>>);
    }
    return { kind: 'readSucceeded', snapshot: snapshot as unknown as SnapshotFor<Q> };
  }
  if (payload.kind === 'readFailed') {
    if (request.kind === 'sensitiveReveal') {
      // 敏感 read 的 transport failure 不透传任何不可信 message，以免 grant 或
      // 明文经错误分支进入 session、日志或诊断面。
      return gatewayUnavailable() as ReadResult<SnapshotFor<Q>>;
    }
    if (!isOneOf(payload.reasonCode, REASON_CODES) || typeof payload.message !== 'string') {
      return null;
    }
    const recovery = payload.recoveryAction;
    if (recovery !== undefined && (!isRecord(recovery) || recovery.kind !== 'retryRead')) {
      return null;
    }
    return {
      kind: 'readFailed',
      reasonCode: payload.reasonCode,
      message: payload.message,
      // 如实透传 core 声明的恢复动作；未声明时不发明
      ...(recovery !== undefined ? { recoveryAction: { kind: 'retryRead' as const } } : {}),
    };
  }
  return null;
}

/** 核对 event envelope 的 wireVersion 与封闭 tag；不匹配返回 null。 */
function normalizeEvent(raw: unknown): WorkspaceEvent | null {
  if (!isRecord(raw) || raw.wireVersion !== GATEWAY_WIRE_VERSION) {
    return null;
  }
  const event = raw.event;
  if (!isRecord(event)) {
    return null;
  }
  switch (event.kind) {
    case 'assetsInvalidated': {
      const assetType = event.assetType;
      if (assetType !== undefined && !isOneOf(assetType, WIRE_ASSET_TYPES)) {
        return null;
      }
      return assetType === undefined
        ? { kind: 'assetsInvalidated' }
        : { kind: 'assetsInvalidated', assetType };
    }
    case 'assetDriftDetected':
      return typeof event.assetId === 'string'
        ? { kind: 'assetDriftDetected', assetId: event.assetId }
        : null;
    case 'indexStatusChanged':
      return isOneOf(event.indexStatus, INDEX_STATUSES)
        ? {
            kind: 'indexStatusChanged',
            indexStatus: event.indexStatus,
          }
        : null;
    case 'compatibilityChanged':
      return typeof event.assetId === 'string'
        ? { kind: 'compatibilityChanged', assetId: event.assetId }
        : null;
    default:
      return null;
  }
}

export function createTauriGateway(options: TauriGatewayOptions = {}): FrontendGateway {
  const retryDelaysMs = options.observeRetryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const rebuildIntervalMs = options.observeRebuildIntervalMs ?? DEFAULT_REBUILD_INTERVAL_MS;
  return {
    async read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
      const requestId = crypto.randomUUID();
      try {
        const request =
          query.kind === 'workbench'
            ? workbenchQueryFromWire(query, true)
            : query.kind === 'sensitiveReveal'
              ? sensitiveRevealQueryFromWire(query)
              : query;
        if (request === null) return gatewayUnavailable();
        // contract Query 与 wire ReadRequestPayload 结构一一对应（同一封闭
        // tag 集合由 Rust wire DTO 事实源保证）。
        const envelope: ReadRequestEnvelope = {
          wireVersion: GATEWAY_WIRE_VERSION,
          requestId,
          payload: request as ReadRequestPayload,
        };
        const raw: unknown = await invoke('frontend_gateway_read', { request: envelope });
        return normalizeResponse(raw, requestId, request as Q) ?? gatewayUnavailable();
      } catch {
        // transport/协议异常一律归一化，不把异常字符串传给 UI。
        return gatewayUnavailable();
      }
    },

    observe(subscription: Subscription, listener: (event: WorkspaceEvent) => void): ObserveHandle {
      let disposed = false;
      /** 首次注册成功后才投递事件（注册完成前到达的事件一律丢弃） */
      let registered = false;
      let unlistenFn: UnlistenFn | null = null;
      let failedAttempts = 0;
      let rebuildTimer: ReturnType<typeof setInterval> | null = null;
      let resolveReady!: () => void;
      // ready 只 resolve、永不 reject：降级时同样 resolve（事件允许丢失，
      // 初始 read 不依赖事件通道），消费方无需 rejection 处理。
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });

      const stopRebuild = (): void => {
        if (rebuildTimer !== null) {
          clearInterval(rebuildTimer);
          rebuildTimer = null;
        }
      };

      const onRegistered = (fn: UnlistenFn): void => {
        resolveReady();
        if (disposed || registered) {
          // 注册完成前已 unlisten，或与并发成功的重建重复：立即注销
          fn();
          return;
        }
        unlistenFn = fn;
        registered = true;
        stopRebuild();
        if (failedAttempts > 0) {
          // 注册曾失败：失败窗口内的事件可能已丢失，补发一次失效强制重读
          // 对账（失效语义，不携带事实）。
          listener({ kind: 'assetsInvalidated' });
        }
      };

      const onRegisterFailed = (attempt: number): void => {
        if (disposed || registered) {
          return;
        }
        failedAttempts += 1;
        if (attempt < retryDelaysMs.length) {
          // 有界重试（递增延迟），期间 ready 保持 pending
          setTimeout(() => {
            attemptListen(attempt + 1);
          }, retryDelaysMs[attempt]);
          return;
        }
        // 全部失败：进入降级——ready 照常 resolve，低频后台重建直到成功或 unlisten
        resolveReady();
        if (rebuildTimer === null) {
          rebuildTimer = setInterval(() => {
            attemptListen(attempt);
          }, rebuildIntervalMs);
        }
      };

      const attemptListen = (attempt: number): void => {
        if (disposed || registered) {
          return;
        }
        const pending = listen<WorkspaceEventEnvelope>(INVALIDATION_EVENT, (message) => {
          if (!registered || disposed) {
            return;
          }
          const event = normalizeEvent(message.payload);
          if (event === null) {
            return;
          }
          if (
            subscription.assetType !== undefined &&
            event.kind === 'assetsInvalidated' &&
            event.assetType !== undefined &&
            event.assetType !== subscription.assetType
          ) {
            return;
          }
          listener(event);
        });
        // rejection 在此被处理，不产生未捕获拒绝
        void pending.then(onRegistered, () => {
          onRegisterFailed(attempt);
        });
      };

      attemptListen(0);

      return {
        ready,
        unlisten: () => {
          disposed = true;
          registered = false;
          stopRebuild();
          unlistenFn?.();
          // dispose 后 ready 不再有任何意义；settle 以免消费方悬挂
          resolveReady();
        },
      };
    },
  };
}
