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
  AssetType,
  Query,
  ReadResult,
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
      const destination =
        isRecord(result.destination) && result.destination.kind === 'skillDetail'
          ? assetType === 'skill'
            ? assetRefFromWire(result.destination.assetRef, assetType)
            : null
          : isRecord(result.destination) && result.destination.kind === 'unsupportedReadOnly'
            ? (() => {
                const assetRef = assetRefFromWire(result.destination.assetRef, assetType);
                return assetRef === null || !isOneOf(result.destination.reasonCode, REASON_CODES)
                  ? null
                  : { assetRef, reasonCode: result.destination.reasonCode };
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
                ? { kind: 'skillDetail' as const, assetRef: destination }
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
  if (!isRecord(raw)) {
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
    if (!isRecord(snapshot) || snapshot.kind !== request.kind) {
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
    return { kind: 'readSucceeded', snapshot: snapshot as unknown as SnapshotFor<Q> };
  }
  if (payload.kind === 'readFailed') {
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
        const request = query.kind === 'workbench' ? workbenchQueryFromWire(query, true) : query;
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
