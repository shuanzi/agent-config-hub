/** FE-01 的首个 workbench read-session。 */
import type { FrontendGateway } from '../contract/gateway';
import type {
  AssetDetailSnapshot,
  AssetRef,
  MaskedSourcePart,
  NativeFileRef,
  NativeFileSnapshot,
  ReasonCode,
  SensitiveAccessGrant,
  SensitiveRevealQuery,
  SensitiveRevealSnapshot,
  SensitiveSegmentRef,
} from '../contract/types';
import {
  canonicalizeWorkbenchFilters,
  DEFAULT_LIST_PRESENTATION,
  type ListPresentationState,
  type LocatorResult,
  projectWorkbenchProjection,
  projectVisibleRows,
  type GlobalLocatorSnapshot,
  type MvpAssetType,
  type ReadOnlyAssetRef,
  type ReadOnlyRow,
  type ViewContext,
  type WorkbenchActualReadSnapshot,
  type WorkbenchFilters,
} from '../workbench/read-only-model';

export type ReadOnlyLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: WorkbenchActualReadSnapshot }
  | { kind: 'empty'; snapshot: WorkbenchActualReadSnapshot }
  | { kind: 'stale'; snapshot: WorkbenchActualReadSnapshot }
  | { kind: 'failed'; reasonCode: ReasonCode; message: string };

/** FE-03 的 frontend-local 全文草稿；不表示 prepared operation 或写入 intent。 */
export interface LocalEditFileProjection {
  fileId: string;
  /** 完整的已遮蔽 source 投影，未知文本不会被 session 重建或丢弃。 */
  sourceText: string;
  /** 敏感 source 仅保留 Rust authority 已验证的安全 parts。 */
  maskedParts?: readonly MaskedSourcePart[];
}

export interface LocalSensitiveDraftChange {
  segmentId: string;
  kind: 'changed';
}

export interface LocalEditAssetDraft {
  kind: 'editAsset';
  assetRef: ReadOnlyAssetRef;
  activeFileId: string;
  dirty: true;
  sourceText: string;
  /** Subagent 仅允许此处声明的已验证 structured field 覆盖。 */
  structuredFieldEdits?: { model: string };
  /** 敏感值只留在不可序列化 buffer；draft 仅保存 opaque 变更标记。 */
  sensitiveChanges?: readonly LocalSensitiveDraftChange[];
  expandedSectionIds: readonly string[];
  /** 同一 asset 的已改 source 文件仍归属同一草稿。 */
  fileProjections: readonly LocalEditFileProjection[];
}

export type DirtyGuardState =
  | { kind: 'idle' }
  | { kind: 'pending'; reason: 'contextSwitch' }
  | {
      kind: 'pending';
      reason: 'assetSwitch';
      target: { assetRef: ReadOnlyAssetRef; assetType: MvpAssetType };
    }
  | {
      kind: 'pending';
      reason: 'locator';
      target: { assetRef: ReadOnlyAssetRef; assetType: MvpAssetType };
    };

export type SensitiveEditorStatus = Readonly<Record<string, { kind: 'active' | 'changed' }>>;

/** FE-10 只读查看只公开 opaque segment 状态；失败时只保留稳定 reasonCode。 */
export type SensitiveViewStatus = Readonly<
  Record<string, { kind: 'active' } | { kind: 'failed'; reasonCode: ReasonCode }>
>;

export interface ReadOnlyWorkbenchState {
  loadState: ReadOnlyLoadState;
  assetType: MvpAssetType;
  viewContext: ViewContext;
  filters?: WorkbenchFilters;
  presentation: ListPresentationState;
  /** 最近一次同 revision 的权威 all/project read 所见 opaque project identity。 */
  availableProjectIds: readonly string[];
  selected: ReadOnlyRow | null;
  detail:
    | { kind: 'idle' }
    | { kind: 'loading'; assetRef: ReadOnlyAssetRef }
    | { kind: 'ready'; detail: AssetDetailSnapshot; file?: NativeFileSnapshot }
    | { kind: 'failed'; reasonCode: ReasonCode; message: string };
  /** 非 FE-01 Skill detail 的合法 locator destination：只显示 fail-closed 错误。 */
  detailError: { assetRef: ReadOnlyAssetRef; reasonCode: ReasonCode; message: string } | null;
  /** source/structured 仅是 frontend-local 展示选择。 */
  detailView: 'structured' | 'source';
  /** 同一 frontend session 至多一个本地 `editAsset` 草稿。 */
  draft: LocalEditAssetDraft | null;
  /** 仅提示 frontend-local draft 的 context switch，不携带 callback 或 replay。 */
  dirtyGuard: DirtyGuardState;
  /** 只公开 opaque segment 的编辑状态；绝不公开明文、grant 或 expiry。 */
  sensitiveEditorStatus: SensitiveEditorStatus;
  /** 只公开 opaque segment 的查看状态；绝不公开明文、grant 或 expiry。 */
  sensitiveViewStatus: SensitiveViewStatus;
  locator:
    | { kind: 'closed' }
    | {
        kind: 'open';
        searchText: string;
        snapshot: GlobalLocatorSnapshot | null;
        error?: {
          reasonCode: ReasonCode;
          message: string;
          kind: 'readFailed' | 'unsupportedDetail';
        };
      };
}

export type ReadOnlyWorkbenchAction =
  | { kind: 'selectAssetType'; assetType: MvpAssetType }
  | { kind: 'selectViewContext'; viewContext: ViewContext }
  | { kind: 'setFilters'; filters: WorkbenchFilters | undefined }
  | { kind: 'setNameSort'; nameSort: ListPresentationState['nameSort'] }
  | { kind: 'setPageSize'; pageSize: ListPresentationState['pageSize'] }
  | { kind: 'setPage'; page: number }
  | { kind: 'selectRow'; row: ReadOnlyRow }
  | { kind: 'selectDetailFile'; file: NativeFileRef }
  | { kind: 'setDetailView'; view: 'structured' | 'source' }
  | { kind: 'focusEditSurface'; surface: 'source' | 'structured' }
  | { kind: 'replaceDraftText'; text: string }
  | { kind: 'replaceDraftTextPart'; partIndex: number; text: string }
  | { kind: 'beginSensitiveModify'; segmentId: string; scope?: 'modify'; surface?: 'source' }
  | { kind: 'beginSensitiveView'; segmentId: string; scope?: 'view'; surface?: 'source' }
  | { kind: 'replaceSensitiveDraftSegment'; segmentId: string; value: string }
  | { kind: 'replaceDraftField'; field: 'model'; value: string }
  | { kind: 'setDraftSectionExpanded'; sectionId: string; expanded: boolean }
  | { kind: 'continueEditing' }
  | { kind: 'cancelDirtyGuard' }
  | { kind: 'discardDraft' }
  | { kind: 'openLocator' }
  | { kind: 'closeLocator' }
  | { kind: 'setLocatorSearch'; searchText: string }
  | { kind: 'selectLocatorResult'; result: LocatorResult }
  | { kind: 'retry' };

type Listener = () => void;

type PendingDirtyTransition =
  | { kind: 'assetType'; assetType: MvpAssetType }
  | { kind: 'viewContext'; viewContext: ViewContext }
  | { kind: 'row'; row: ReadOnlyRow }
  | { kind: 'filters'; filters: WorkbenchFilters | undefined }
  | { kind: 'locator'; result: LocatorResult };

/** 明文与 Rust authority grant 只可存在于此 ECMAScript private buffer。 */
type EphemeralSensitiveBuffer = {
  authorityPlaintext: string;
  plaintext: string;
  grant: SensitiveAccessGrant;
};

/** FE-10 专用的只读 buffer；绝不与 FE-03 modify buffer 或 draft 共享。 */
type EphemeralSensitiveViewBuffer = {
  plaintext: string;
  grant: SensitiveAccessGrant;
};

type SensitiveModifySource = {
  assetRef: ReadOnlyAssetRef;
  fileId: string;
  fileRevision: string;
  assetRevision: string;
  maskedText: string;
  maskedParts: readonly MaskedSourcePart[];
  sensitiveSegmentIds: readonly string[];
};

/** `view` 只要求当前 masked source 的 authoritative binding，不要求可编辑。 */
type SensitiveViewSource = {
  assetRef: ReadOnlyAssetRef;
  fileId: string;
  fileRevision: string;
  assetRevision: string;
  sensitiveSegmentIds: readonly string[];
};

function sameAssetRef(left: AssetRef, right: AssetRef): boolean {
  const leftOwnership = left.nativeOwnership;
  const rightOwnership = right.nativeOwnership;
  return (
    left.assetId === right.assetId &&
    left.assetType === right.assetType &&
    left.nativeUnitRef === right.nativeUnitRef &&
    left.adapterIdentity === right.adapterIdentity &&
    leftOwnership.kind === rightOwnership.kind &&
    (leftOwnership.kind !== 'project' ||
      rightOwnership.kind !== 'project' ||
      leftOwnership.projectId === rightOwnership.projectId)
  );
}

function sameViewContext(left: ViewContext, right: ViewContext): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== 'project' || right.kind !== 'project' || left.projectId === right.projectId)
  );
}

function sameValues<T>(left: readonly T[] | undefined, right: readonly T[] | undefined): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((value, index) => value === right[index]))
  );
}

function sameCanonicalFilters(
  left: WorkbenchFilters | undefined,
  right: WorkbenchFilters | undefined,
  viewContext: ViewContext,
): boolean {
  if (left === right) return true;
  try {
    const canonicalLeft = canonicalizeWorkbenchFilters(left, viewContext);
    const canonicalRight = canonicalizeWorkbenchFilters(right, viewContext);
    return (
      sameValues(canonicalLeft?.agents, canonicalRight?.agents) &&
      sameValues(canonicalLeft?.sourceIds, canonicalRight?.sourceIds) &&
      sameValues(canonicalLeft?.statuses, canonicalRight?.statuses) &&
      sameValues(canonicalLeft?.projectIds, canonicalRight?.projectIds)
    );
  } catch {
    return false;
  }
}

/** 仅替换完整权威 source 中唯一的 `model` 行，绝不解析或重建其他 YAML 内容。 */
function replaceUniqueModelLine(
  sourceText: string,
  currentModel: string,
  nextModel: string,
): string | null {
  if (
    currentModel.includes('\r') ||
    currentModel.includes('\n') ||
    nextModel.includes('\r') ||
    nextModel.includes('\n')
  )
    return null;
  const expectedLine = `model: ${currentModel}`;
  let match: { start: number; end: number } | null = null;
  let lineStart = 0;
  while (lineStart <= sourceText.length) {
    const newline = sourceText.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? sourceText.length : newline;
    const contentEnd = sourceText[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    if (sourceText.slice(lineStart, contentEnd) === expectedLine) {
      if (match !== null) return null;
      match = { start: lineStart, end: contentEnd };
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return match === null
    ? null
    : `${sourceText.slice(0, match.start)}model: ${nextModel}${sourceText.slice(match.end)}`;
}

const SENSITIVE_MASKED_GAP = '••••••••';

function renderedMaskedParts(parts: readonly MaskedSourcePart[]): string | null {
  let rendered = '';
  for (const part of parts) {
    if (
      part.kind === 'text' &&
      typeof part.text === 'string' &&
      Object.keys(part).length === 2 &&
      Object.keys(part).every((key) => key === 'kind' || key === 'text')
    ) {
      rendered += part.text;
      continue;
    }
    if (
      part.kind === 'sensitivePlaceholder' &&
      typeof part.segmentId === 'string' &&
      part.segmentId.trim() !== '' &&
      Object.keys(part).length === 2 &&
      Object.keys(part).every((key) => key === 'kind' || key === 'segmentId')
    ) {
      rendered += SENSITIVE_MASKED_GAP;
      continue;
    }
    return null;
  }
  return rendered;
}

/** session 只接受能重建当前 maskedText、且逐一绑定已遮蔽 segment 的 authority parts。 */
function hasValidatedMaskedParts(
  parts: readonly MaskedSourcePart[],
  maskedText: string,
  sensitiveSegments: readonly SensitiveSegmentRef[],
  fileId: string,
  revision: string,
): boolean {
  const segmentIds = new Set<string>();
  for (const segment of sensitiveSegments) {
    if (
      typeof segment.segmentId !== 'string' ||
      segment.segmentId.trim() === '' ||
      segment.fileId !== fileId ||
      segment.revision !== revision ||
      segment.displayState !== 'masked' ||
      segmentIds.has(segment.segmentId)
    )
      return false;
    segmentIds.add(segment.segmentId);
  }
  if (segmentIds.size === 0 || renderedMaskedParts(parts) !== maskedText) return false;
  const placeholderIds = new Set<string>();
  for (const part of parts) {
    if (part.kind === 'text') continue;
    if (part.kind !== 'sensitivePlaceholder' || placeholderIds.has(part.segmentId)) return false;
    placeholderIds.add(part.segmentId);
  }
  return (
    placeholderIds.size === segmentIds.size &&
    [...segmentIds].every((segmentId) => placeholderIds.has(segmentId))
  );
}

/** 草稿可改变 text，但不可改变 authority placeholder 的数量、顺序或 identity。 */
function hasSameMaskedPartLayout(
  authority: readonly MaskedSourcePart[],
  candidate: readonly MaskedSourcePart[],
): boolean {
  return (
    authority.length === candidate.length &&
    authority.every((part, index) => {
      const next = candidate[index];
      if (next === undefined) return false;
      if (part.kind === 'text') return next.kind === 'text';
      return next.kind === 'sensitivePlaceholder' && part.segmentId === next.segmentId;
    })
  );
}

function sameMaskedParts(
  left: readonly MaskedSourcePart[],
  right: readonly MaskedSourcePart[],
): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => {
      const candidate = right[index];
      if (candidate === undefined || part.kind !== candidate.kind) return false;
      return part.kind === 'text'
        ? candidate.kind === 'text' && part.text === candidate.text
        : candidate.kind === 'sensitivePlaceholder' && part.segmentId === candidate.segmentId;
    })
  );
}

function maskedTextPartSpan(
  parts: readonly MaskedSourcePart[],
  maskedText: string,
  partIndex: number,
): { start: number; end: number } | null {
  if (
    !Number.isSafeInteger(partIndex) ||
    partIndex < 0 ||
    renderedMaskedParts(parts) !== maskedText
  )
    return null;
  let offset = 0;
  for (const [index, part] of parts.entries()) {
    const partText = part.kind === 'text' ? part.text : SENSITIVE_MASKED_GAP;
    if (index === partIndex) {
      return part.kind === 'text' ? { start: offset, end: offset + partText.length } : null;
    }
    offset += partText.length;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key))
  );
}

function isOpaqueString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isCanonicalFutureTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const instant = new Date(value);
  return (
    !Number.isNaN(instant.getTime()) &&
    instant.toISOString() === value &&
    instant.getTime() > Date.now()
  );
}

function hasMatchingAssetRef(value: unknown, expected: AssetRef): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'assetId',
      'assetType',
      'nativeUnitRef',
      'adapterIdentity',
      'nativeOwnership',
    ]) ||
    value.assetId !== expected.assetId ||
    value.assetType !== expected.assetType ||
    value.nativeUnitRef !== expected.nativeUnitRef ||
    value.adapterIdentity !== expected.adapterIdentity ||
    !isRecord(value.nativeOwnership)
  )
    return false;
  const ownership = value.nativeOwnership;
  return expected.nativeOwnership.kind === 'global'
    ? ownership.kind === 'global' && hasExactKeys(ownership, ['kind'])
    : ownership.kind === 'project' &&
        ownership.projectId === expected.nativeOwnership.projectId &&
        hasExactKeys(ownership, ['kind', 'projectId']);
}

/** 再次闭合复验 gateway response；拒绝时不发布 response 的任意文本或 grant。 */
function sensitiveRevealSnapshotForRequest(
  value: unknown,
  request: SensitiveRevealQuery,
): SensitiveRevealSnapshot | null {
  if (
    !isRecord(value) ||
    value.kind !== 'sensitiveReveal' ||
    typeof value.plaintext !== 'string' ||
    !isRecord(value.grant) ||
    !hasExactKeys(value, ['kind', 'plaintext', 'grant'])
  )
    return null;
  const grant = value.grant;
  if (
    !hasExactKeys(grant, [
      'grantId',
      'asset',
      'fileId',
      'segmentId',
      'fileRevision',
      'assetRevision',
      'scope',
      'surface',
      'expiresAt',
    ]) ||
    !isOpaqueString(grant.grantId) ||
    !isOpaqueString(grant.fileId) ||
    !isOpaqueString(grant.segmentId) ||
    !isOpaqueString(grant.fileRevision) ||
    !isOpaqueString(grant.assetRevision) ||
    grant.scope !== request.scope ||
    grant.surface !== request.surface ||
    !isCanonicalFutureTimestamp(grant.expiresAt) ||
    !hasMatchingAssetRef(grant.asset, request.asset) ||
    grant.fileId !== request.fileId ||
    grant.segmentId !== request.segmentId ||
    grant.fileRevision !== request.fileRevision ||
    grant.assetRevision !== request.assetRevision
  )
    return null;
  return value as unknown as SensitiveRevealSnapshot;
}

/**
 * 此 session 的唯一路径是 `FrontendGateway.read/observe`。
 * event 从不作为事实使用：只使当前 snapshot 失效并请求新的 authoritative read。
 */
export class ReadOnlyWorkbenchSession {
  private readonly listeners = new Set<Listener>();
  private readonly gateway: FrontendGateway;
  private readonly unlisten: () => void;
  #sensitiveBuffer: EphemeralSensitiveBuffer | null = null;
  #sensitiveRequestEpoch = 0;
  #sensitiveExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  #sensitiveViewBuffer: EphemeralSensitiveViewBuffer | null = null;
  #sensitiveViewRequestEpoch = 0;
  #sensitiveViewExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  private workbenchGeneration = 0;
  private locatorGeneration = 0;
  private detailGeneration = 0;
  /** event 后 UI 不保留旧 facts；仅保留 native identity 供新 snapshot 成功时重绑。 */
  private pendingRereadSelection: ReadOnlyRow | null = null;
  /** 合法 locator 跳转在随后的 authoritative reread 失败时仍需定位到详情错误。 */
  private pendingLocatorDetail: ReadOnlyAssetRef | null = null;
  /** 非 Skill destination 的 fail-closed detail error 必须跨过其单次 context reread。 */
  private preserveUnsupportedLocatorDetail = false;
  /** private typed intent；绝不作为公开 state、callback 或 replay payload。 */
  private pendingDirtyTransition: PendingDirtyTransition | null = null;
  private disposed = false;
  private state: ReadOnlyWorkbenchState = {
    loadState: { kind: 'loading' },
    assetType: 'skill',
    viewContext: { kind: 'all' },
    presentation: DEFAULT_LIST_PRESENTATION,
    availableProjectIds: [],
    selected: null,
    detail: { kind: 'idle' },
    detailError: null,
    detailView: 'structured',
    draft: null,
    dirtyGuard: { kind: 'idle' },
    sensitiveEditorStatus: {},
    sensitiveViewStatus: {},
    locator: { kind: 'closed' },
  };

  constructor(gateway: FrontendGateway) {
    this.gateway = gateway;
    const handle = gateway.observe({ kind: 'workspace' }, () => this.invalidateAndReread());
    this.unlisten = handle.unlisten;
    void handle.ready.then(() => this.refresh(true));
  }

  getSnapshot(): ReadOnlyWorkbenchState {
    return this.state;
  }

  /** 仅供当前敏感编辑 surface 读取；过期或错绑 buffer 会立即失效。 */
  getSensitiveEditorValue(segmentId: string): string | undefined {
    return this.#currentSensitiveBuffer(segmentId)?.plaintext;
  }

  /** 仅供当前只读临时 overlay 的纯读取；不会在 render/read 中发布状态。 */
  getSensitiveViewValue(segmentId: string): string | undefined {
    return this.#currentSensitiveViewBuffer(segmentId)?.plaintext;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.#sensitiveBuffer = null;
    this.#sensitiveRequestEpoch += 1;
    this.#cancelSensitiveExpiryTimer();
    this.#sensitiveViewBuffer = null;
    this.#sensitiveViewRequestEpoch += 1;
    this.#cancelSensitiveViewExpiryTimer();
    this.workbenchGeneration += 1;
    this.locatorGeneration += 1;
    this.detailGeneration += 1;
    this.unlisten();
    this.listeners.clear();
  }

  dispatch(action: ReadOnlyWorkbenchAction): void {
    if (this.disposed) return;
    switch (action.kind) {
      case 'selectAssetType':
        if (this.state.assetType === action.assetType) return;
        if (this.deferDraftTransition({ kind: 'assetType', assetType: action.assetType })) return;
        this.#clearSensitiveBuffer(false);
        this.#clearSensitiveViewBuffer();
        this.commitAssetTypeTransition(action.assetType, false);
        return;
      case 'selectViewContext':
        if (sameViewContext(this.state.viewContext, action.viewContext)) return;
        if (this.deferDraftTransition({ kind: 'viewContext', viewContext: action.viewContext }))
          return;
        this.#clearSensitiveBuffer(false);
        this.#clearSensitiveViewBuffer();
        this.commitViewContextTransition(action.viewContext, false);
        return;
      case 'setFilters':
        if (sameCanonicalFilters(this.state.filters, action.filters, this.state.viewContext))
          return;
        if (this.deferFiltersDraftTransition(action.filters)) return;
        if (this.state.draft === null) this.#clearSensitiveBuffer(false);
        this.#clearSensitiveViewBuffer();
        this.commitFiltersTransition(action.filters, false);
        return;
      case 'setNameSort':
        this.update({
          presentation: { ...this.state.presentation, nameSort: action.nameSort, page: 1 },
        });
        return;
      case 'setPageSize':
        this.update({
          presentation: { ...this.state.presentation, pageSize: action.pageSize, page: 1 },
        });
        return;
      case 'setPage':
        this.update({ presentation: { ...this.state.presentation, page: action.page } });
        return;
      case 'selectRow':
        if (this.deferRowDraftTransition(action.row)) return;
        if (
          this.state.draft === null &&
          (this.state.selected === null ||
            !sameAssetRef(this.state.selected.assetRef, action.row.assetRef))
        )
          this.#clearSensitiveBuffer(false);
        // 显式重开同一行同样会发起新的 detail read，旧 view 不得跨 read 存活。
        this.#clearSensitiveViewBuffer();
        this.commitRowTransition(action.row, false);
        return;
      case 'selectDetailFile': {
        if (this.state.detail.kind !== 'ready') return;
        const generation = ++this.detailGeneration;
        const { detail } = this.state.detail;
        const assetRef = detail.detail.asset;
        if (assetRef.assetType === 'hook') {
          this.update({
            detail: {
              kind: 'failed',
              reasonCode: 'EXECUTABLE_CONTENT_RISK',
              message: '可执行 Hook 内容不提供只读展示。',
            },
          });
          return;
        }
        if (this.state.detail.file?.file.fileId !== action.file.fileId)
          this.#clearSensitiveBuffer(false);
        // 即使是同一文件的显式重读，也必须在新 nativeFile 事实返回前重新遮蔽。
        this.#clearSensitiveViewBuffer();
        const readOnlyAssetRef: ReadOnlyAssetRef = {
          assetId: assetRef.assetId,
          assetType: assetRef.assetType,
          nativeUnitRef: assetRef.nativeUnitRef,
          adapterIdentity: assetRef.adapterIdentity,
          nativeOwnership: assetRef.nativeOwnership,
        };
        this.update({ detail: { kind: 'loading', assetRef: readOnlyAssetRef } });
        this.readDetailFile(readOnlyAssetRef, detail, action.file, generation);
        return;
      }
      case 'setDetailView':
        if (this.state.detailView !== action.view) {
          this.#clearSensitiveBuffer(false);
          this.#clearSensitiveViewBuffer();
        }
        this.update({ detailView: action.view });
        return;
      case 'focusEditSurface':
        // 聚焦本身不建立草稿，也不触发任何 gateway 操作。
        if (this.state.detailView !== action.surface) {
          this.#clearSensitiveBuffer(false);
          this.#clearSensitiveViewBuffer();
        }
        this.update({ detailView: action.surface });
        return;
      case 'replaceDraftText':
        this.replaceDraftText(action.text);
        return;
      case 'replaceDraftTextPart':
        this.replaceDraftTextPart(action.partIndex, action.text);
        return;
      case 'beginSensitiveModify':
        this.beginSensitiveModify(action.segmentId, action.scope, action.surface);
        return;
      case 'beginSensitiveView':
        this.beginSensitiveView(action.segmentId, action.scope, action.surface);
        return;
      case 'replaceSensitiveDraftSegment':
        this.replaceSensitiveDraftSegment(action.segmentId, action.value);
        return;
      case 'replaceDraftField':
        this.replaceDraftField(action.field, action.value);
        return;
      case 'setDraftSectionExpanded':
        this.setDraftSectionExpanded(action.sectionId, action.expanded);
        return;
      case 'continueEditing':
      case 'cancelDirtyGuard':
        this.clearDirtyGuard();
        return;
      case 'discardDraft':
        this.discardDraft();
        return;
      case 'openLocator':
        this.locatorGeneration += 1;
        this.#clearSensitiveViewBuffer();
        this.update({ locator: { kind: 'open', searchText: '', snapshot: null } });
        return;
      case 'closeLocator':
        this.locatorGeneration += 1;
        this.update({
          locator: { kind: 'closed' },
          ...this.invalidatePendingLocatorTransition(),
        });
        return;
      case 'setLocatorSearch': {
        if (this.state.locator.kind !== 'open') return;
        const locatorGeneration = ++this.locatorGeneration;
        const searchText = action.searchText;
        const canonicalSearchText = searchText.trim();
        this.update({
          locator: { kind: 'open', searchText, snapshot: null },
          ...this.invalidatePendingLocatorTransition(),
        });
        if (canonicalSearchText !== '') this.readLocator(canonicalSearchText, locatorGeneration);
        return;
      }
      case 'selectLocatorResult':
        if (this.deferLocatorDraftTransition(action.result)) return;
        this.commitLocatorResult(action.result, false);
        return;
      case 'retry':
        this.#clearSensitiveBuffer(false);
        this.#clearSensitiveViewBuffer();
        this.refresh(true);
        if (this.state.selected !== null) this.readDetail(this.state.selected.assetRef);
        return;
    }
  }

  /** 有草稿时只记录第一个 destination；当前公开 state 与 read seam 均保持不变。 */
  private deferDraftTransition(transition: PendingDirtyTransition): boolean {
    if (this.state.draft === null) return false;
    if (this.pendingDirtyTransition === null) {
      this.pendingDirtyTransition = transition;
      this.update({ dirtyGuard: { kind: 'pending', reason: 'contextSwitch' } });
    }
    return true;
  }

  private deferRowDraftTransition(row: ReadOnlyRow): boolean {
    const draft = this.state.draft;
    if (draft === null) return false;
    if (this.pendingDirtyTransition !== null) return true;
    if (sameAssetRef(draft.assetRef, row.assetRef)) return false;
    this.pendingDirtyTransition = { kind: 'row', row };
    this.update({
      dirtyGuard: {
        kind: 'pending',
        reason: 'assetSwitch',
        target: { assetRef: row.assetRef, assetType: row.assetRef.assetType },
      },
    });
    return true;
  }

  private deferFiltersDraftTransition(filters: WorkbenchFilters | undefined): boolean {
    if (this.state.draft === null) return false;
    if (this.pendingDirtyTransition !== null) return true;
    if (sameCanonicalFilters(this.state.filters, filters, this.state.viewContext)) return false;
    this.pendingDirtyTransition = { kind: 'filters', filters };
    this.update({ dirtyGuard: { kind: 'pending', reason: 'contextSwitch' } });
    return true;
  }

  /** locator 选择在有草稿时只保留私有 result；不改变当前 destination 或发起 read。 */
  private deferLocatorDraftTransition(result: LocatorResult): boolean {
    if (this.state.draft === null) return false;
    if (this.pendingDirtyTransition === null) {
      const assetRef = result.destination.assetRef;
      this.pendingDirtyTransition = { kind: 'locator', result };
      this.update({
        dirtyGuard: {
          kind: 'pending',
          reason: 'locator',
          target: { assetRef, assetType: assetRef.assetType },
        },
      });
    }
    return true;
  }

  private commitFiltersTransition(
    filters: WorkbenchFilters | undefined,
    discardDraft: boolean,
    sensitiveEditorStatus?: SensitiveEditorStatus,
  ): void {
    this.detailGeneration += 1;
    this.pendingRereadSelection = null;
    this.pendingLocatorDetail = null;
    this.preserveUnsupportedLocatorDetail = false;
    this.update({
      filters,
      selected: null,
      detail: { kind: 'idle' },
      detailError: null,
      presentation: this.resetPage(),
      ...(discardDraft ? { draft: null, dirtyGuard: { kind: 'idle' } as const } : {}),
      ...(sensitiveEditorStatus === undefined ? {} : { sensitiveEditorStatus }),
    });
    this.refresh(true);
  }

  private commitRowTransition(
    row: ReadOnlyRow,
    discardDraft: boolean,
    sensitiveEditorStatus?: SensitiveEditorStatus,
  ): void {
    this.detailGeneration += 1;
    this.pendingRereadSelection = null;
    this.pendingLocatorDetail = null;
    this.preserveUnsupportedLocatorDetail = false;
    this.update({
      selected: row,
      detail: { kind: 'loading', assetRef: row.assetRef },
      detailError: null,
      ...(discardDraft ? { draft: null, dirtyGuard: { kind: 'idle' } as const } : {}),
      ...(sensitiveEditorStatus === undefined ? {} : { sensitiveEditorStatus }),
    });
    this.readDetail(row.assetRef);
  }

  private commitAssetTypeTransition(
    assetType: MvpAssetType,
    discardDraft: boolean,
    sensitiveEditorStatus?: SensitiveEditorStatus,
  ): void {
    this.detailGeneration += 1;
    this.pendingRereadSelection = null;
    this.pendingLocatorDetail = null;
    this.preserveUnsupportedLocatorDetail = false;
    this.update({
      assetType,
      selected: null,
      detail: { kind: 'idle' },
      detailError: null,
      presentation: this.resetPage(),
      ...(discardDraft ? { draft: null, dirtyGuard: { kind: 'idle' } as const } : {}),
      ...(sensitiveEditorStatus === undefined ? {} : { sensitiveEditorStatus }),
    });
    this.refresh(true);
  }

  private commitViewContextTransition(
    viewContext: ViewContext,
    discardDraft: boolean,
    sensitiveEditorStatus?: SensitiveEditorStatus,
  ): void {
    this.detailGeneration += 1;
    this.pendingRereadSelection = null;
    this.pendingLocatorDetail = null;
    this.preserveUnsupportedLocatorDetail = false;
    this.update({
      viewContext,
      selected: null,
      detail: { kind: 'idle' },
      detailError: null,
      presentation: this.resetPage(),
      ...(discardDraft ? { draft: null, dirtyGuard: { kind: 'idle' } as const } : {}),
      ...(sensitiveEditorStatus === undefined ? {} : { sensitiveEditorStatus }),
    });
    this.refresh(true);
  }

  /** 仅 explicit discard 后才从待定 locator result 原子提交 destination。 */
  private commitLocatorResult(
    result: LocatorResult,
    discardDraft: boolean,
    sensitiveEditorStatus?: SensitiveEditorStatus,
  ): void {
    if (
      !discardDraft &&
      this.state.draft === null &&
      (this.state.assetType !== result.destination.assetRef.assetType ||
        !sameViewContext(this.state.viewContext, result.destinationViewContext) ||
        this.state.selected === null ||
        !sameAssetRef(this.state.selected.assetRef, result.assetRef))
    )
      this.#clearSensitiveBuffer(false);
    // locator result 一律建立新的 detail read destination；同一资产重开也不能保留 view。
    this.#clearSensitiveViewBuffer();
    this.detailGeneration += 1;
    this.locatorGeneration += 1;
    this.preserveUnsupportedLocatorDetail = result.destination.kind === 'unsupportedReadOnly';
    const filters = this.filtersForLocatorDestination(result.destinationViewContext);
    if (result.destination.kind === 'unsupportedReadOnly') {
      this.pendingRereadSelection = null;
      this.pendingLocatorDetail = null;
      const assetRef = result.destination.assetRef;
      this.update({
        assetType: assetRef.assetType,
        viewContext: result.destinationViewContext,
        filters,
        selected: null,
        detail: { kind: 'idle' },
        detailError: {
          assetRef,
          reasonCode: result.destination.reasonCode as ReasonCode,
          message: '此只读资产没有可用的 FE-01 只读详情。',
        },
        locator: { kind: 'closed' },
        presentation: this.resetPage(),
        ...(discardDraft ? { draft: null, dirtyGuard: { kind: 'idle' } as const } : {}),
        ...(sensitiveEditorStatus === undefined ? {} : { sensitiveEditorStatus }),
      });
      this.refresh(true);
      return;
    }
    this.pendingRereadSelection = null;
    this.pendingLocatorDetail = result.destination.assetRef;
    this.update({
      assetType: result.destination.assetRef.assetType,
      viewContext: result.destinationViewContext,
      filters,
      selected: result,
      detail: { kind: 'loading', assetRef: result.destination.assetRef },
      detailError: null,
      locator: { kind: 'closed' },
      presentation: this.resetPage(),
      ...(discardDraft ? { draft: null, dirtyGuard: { kind: 'idle' } as const } : {}),
      ...(sensitiveEditorStatus === undefined ? {} : { sensitiveEditorStatus }),
    });
    this.refresh(true);
    this.readDetail(result.destination.assetRef);
  }

  private clearDirtyGuard(): void {
    if (this.pendingDirtyTransition === null && this.state.dirtyGuard.kind === 'idle') return;
    this.pendingDirtyTransition = null;
    this.update({ dirtyGuard: { kind: 'idle' } });
  }

  /** 新 locator lifecycle 不可复用旧 result；只废弃 locator pending。 */
  private invalidatePendingLocatorTransition(): Partial<
    Pick<ReadOnlyWorkbenchState, 'dirtyGuard'>
  > {
    if (this.pendingDirtyTransition?.kind !== 'locator') return {};
    this.pendingDirtyTransition = null;
    return { dirtyGuard: { kind: 'idle' } };
  }

  private discardDraft(): void {
    const pending = this.pendingDirtyTransition;
    const sensitiveEditorStatus = this.#clearSensitiveBuffer(true, false);
    this.#clearSensitiveViewBuffer();
    if (pending === null) {
      // 普通 discard 只清 frontend-local draft；绝不发起 read 或写入。
      this.update({
        draft: null,
        dirtyGuard: { kind: 'idle' },
        ...(sensitiveEditorStatus === undefined ? {} : { sensitiveEditorStatus }),
      });
      return;
    }
    this.pendingDirtyTransition = null;
    if (pending.kind === 'assetType') {
      this.commitAssetTypeTransition(pending.assetType, true, sensitiveEditorStatus);
      return;
    }
    if (pending.kind === 'viewContext') {
      this.commitViewContextTransition(pending.viewContext, true, sensitiveEditorStatus);
      return;
    }
    if (pending.kind === 'row') {
      this.commitRowTransition(pending.row, true, sensitiveEditorStatus);
      return;
    }
    if (pending.kind === 'filters') {
      this.commitFiltersTransition(pending.filters, true, sensitiveEditorStatus);
      return;
    }
    this.commitLocatorResult(pending.result, true, sensitiveEditorStatus);
  }

  private refresh(showLoading: boolean): void {
    // 每次 refresh（包括 canonicalization failure）都废弃旧 pending read。
    const generation = ++this.workbenchGeneration;
    let filters: WorkbenchFilters | undefined;
    try {
      filters = canonicalizeWorkbenchFilters(this.state.filters, this.state.viewContext);
    } catch {
      this.update({
        loadState: {
          kind: 'failed',
          reasonCode: 'READ_FAILED',
          message: '读取条件无效，请调整后重试。',
        },
        selected: null,
        detail: { kind: 'idle' },
      });
      this.detailGeneration += 1;
      this.pendingRereadSelection = null;
      return;
    }
    const query = {
      kind: 'workbench' as const,
      assetType: this.state.assetType,
      viewContext: this.state.viewContext,
      ...(filters === undefined ? {} : { filters }),
    };
    if (showLoading) this.update({ loadState: { kind: 'loading' } });
    void this.gateway.read(query).then((result) => {
      if (this.disposed || generation !== this.workbenchGeneration) return;
      if (result.kind === 'readFailed') {
        // 当前 authoritative workbench read 已失败，旧 detail/nativeFile 不再有
        // 可绑定的 selection；先废弃它们，迟到结果不得复活 detail。
        this.detailGeneration += 1;
        const detailAsset = this.pendingLocatorDetail;
        this.pendingLocatorDetail = null;
        const preserveUnsupported = this.preserveUnsupportedLocatorDetail;
        this.preserveUnsupportedLocatorDetail = false;
        this.update({
          loadState: { kind: 'failed', reasonCode: result.reasonCode, message: result.message },
          selected: null,
          detail: { kind: 'idle' },
          detailError:
            detailAsset === null
              ? preserveUnsupported
                ? this.state.detailError
                : null
              : { assetRef: detailAsset, reasonCode: result.reasonCode, message: result.message },
        });
        return;
      }
      const visible = projectVisibleRows(result.snapshot);
      const loadState: ReadOnlyLoadState =
        result.snapshot.indexStatus === 'stale'
          ? { kind: 'stale', snapshot: result.snapshot }
          : visible.length === 0
            ? { kind: 'empty', snapshot: result.snapshot }
            : { kind: 'ready', snapshot: result.snapshot };
      const projected = projectWorkbenchProjection(result.snapshot, this.state.presentation);
      const currentProjectIds = result.snapshot.segments
        .filter((segment) => segment.source === 'projectNative' && segment.projectId !== undefined)
        .map((segment) => segment.projectId as string);
      const availableProjectIds =
        result.snapshot.query.viewContext.kind === 'all'
          ? currentProjectIds
          : [...new Set([...this.state.availableProjectIds, ...currentProjectIds])];
      const selectedBeforeReread = this.state.selected ?? this.pendingRereadSelection;
      const selected =
        loadState.kind === 'ready'
          ? (visible.find(
              (row) =>
                selectedBeforeReread !== null &&
                sameAssetRef(row.assetRef, selectedBeforeReread.assetRef),
            ) ?? null)
          : null;
      const shouldRestoreDetail =
        selected !== null && this.state.selected === null && this.state.detail.kind === 'idle';
      this.pendingRereadSelection = null;
      this.pendingLocatorDetail = null;
      const preserveUnsupported = this.preserveUnsupportedLocatorDetail;
      this.preserveUnsupportedLocatorDetail = false;
      this.update({
        loadState,
        selected,
        detail: selected === null ? { kind: 'idle' } : this.state.detail,
        detailError: preserveUnsupported ? this.state.detailError : null,
        availableProjectIds,
        presentation:
          projected.page === this.state.presentation.page
            ? this.state.presentation
            : { ...this.state.presentation, page: projected.page },
      });
      if (selected === null) this.detailGeneration += 1;
      else if (shouldRestoreDetail) this.readDetail(selected.assetRef);
    });
  }

  private invalidateAndReread(): void {
    // event 不携带事实：到达瞬间先失效旧 snapshot/cells，后续仅接受新 read。
    this.#clearSensitiveBuffer(false);
    this.#clearSensitiveViewBuffer();
    this.workbenchGeneration += 1;
    this.detailGeneration += 1;
    // locator snapshot 同样不是权威事实；若用户正在搜索，保留输入和 open state，
    // 立即清空旧结果并用同一 searchText 发起新的 authoritative read。
    const locatorSearchText =
      this.state.locator.kind === 'open' && this.state.locator.searchText.trim() !== ''
        ? this.state.locator.searchText
        : null;
    const locatorGeneration = ++this.locatorGeneration;
    this.pendingRereadSelection = this.state.selected ?? this.pendingRereadSelection;
    this.pendingLocatorDetail = null;
    this.preserveUnsupportedLocatorDetail = false;
    this.update({
      loadState: { kind: 'loading' },
      selected: null,
      detail: { kind: 'idle' },
      detailError: null,
      availableProjectIds: [],
      locator:
        locatorSearchText === null
          ? this.state.locator.kind === 'open'
            ? { kind: 'open', searchText: '', snapshot: null }
            : { kind: 'closed' }
          : { kind: 'open', searchText: locatorSearchText, snapshot: null },
    });
    this.refresh(false);
    if (locatorSearchText !== null) this.readLocator(locatorSearchText, locatorGeneration);
  }

  private readLocator(searchText: string, generation: number): void {
    const canonicalSearchText = searchText.trim();
    if (canonicalSearchText === '') return;
    void this.gateway
      .read({
        kind: 'globalLocator',
        searchText: canonicalSearchText,
        assetTypes: ['skill', 'longTermInstruction', 'subagent'],
      })
      .then((result) => {
        if (
          this.disposed ||
          generation !== this.locatorGeneration ||
          this.state.locator.kind !== 'open' ||
          this.state.locator.searchText.trim() !== canonicalSearchText
        )
          return;
        const currentSearchText = this.state.locator.searchText;
        if (result.kind === 'readSucceeded') {
          this.update({
            locator: { kind: 'open', searchText: currentSearchText, snapshot: result.snapshot },
          });
        } else {
          this.update({
            locator: {
              kind: 'open',
              searchText: currentSearchText,
              snapshot: null,
              error: { kind: 'readFailed', reasonCode: result.reasonCode, message: result.message },
            },
            ...this.invalidatePendingLocatorTransition(),
          });
        }
      });
  }

  /**
   * 类型详情只经同一个 FrontendGateway 的只读 query 链取得。Skill 先显示
   * structured detail/tree；只有用户选择“查看源码”后才请求 nativeFile。
   */
  private readDetail(assetRef: ReadOnlyAssetRef): void {
    const generation = ++this.detailGeneration;
    void (async () => {
      const detailResult = await this.gateway.read({ kind: 'assetDetail', asset: assetRef });
      if (this.disposed || generation !== this.detailGeneration) return;
      if (detailResult.kind === 'readFailed') {
        this.update({
          detail: {
            kind: 'failed',
            reasonCode: detailResult.reasonCode,
            message: detailResult.message,
          },
        });
        return;
      }
      if (assetRef.assetType === 'skill') {
        this.update({ detail: { kind: 'ready', detail: detailResult.snapshot } });
        return;
      }
      this.readDetailFile(
        assetRef,
        detailResult.snapshot,
        detailResult.snapshot.detail.primaryFile,
        generation,
      );
    })();
  }

  private readDetailFile(
    assetRef: ReadOnlyAssetRef,
    detail: AssetDetailSnapshot,
    file: NativeFileRef,
    generation: number,
  ): void {
    // nativeFile 只在用户明确打开 Skill 文件，或长期指令/Subagent 的默认正文
    // surface 需要读取时触发；仍与同一 asset detail revision 绑定。
    void this.gateway
      .read({ kind: 'nativeFile', asset: assetRef, fileId: file.fileId })
      .then((fileResult) => {
        if (this.disposed || generation !== this.detailGeneration) return;
        if (
          fileResult.kind === 'readFailed' ||
          fileResult.snapshot.assetRevision !== detail.revision
        ) {
          this.#clearSensitiveBufferForFileResult(assetRef, detail, null);
          this.#clearSensitiveViewBufferForFileResult(assetRef, detail, null);
          this.update({
            detail: {
              kind: 'failed',
              reasonCode: fileResult.kind === 'readFailed' ? fileResult.reasonCode : 'READ_FAILED',
              message:
                fileResult.kind === 'readFailed'
                  ? fileResult.message
                  : '详情与原生文件版本不一致，请重读。',
            },
          });
          return;
        }
        this.#clearSensitiveBufferForFileResult(assetRef, detail, fileResult.snapshot);
        this.#clearSensitiveViewBufferForFileResult(assetRef, detail, fileResult.snapshot);
        const restoredDraft = this.draftForFile(assetRef, fileResult.snapshot.file.fileId);
        this.update({
          detail: { kind: 'ready', detail, file: fileResult.snapshot },
          ...(restoredDraft === null ? {} : { draft: restoredDraft }),
        });
      });
  }

  private replaceDraftText(text: string): void {
    const source = this.editableSource();
    if (source === null) return;
    const currentDraft = this.state.draft;
    if (currentDraft !== null && !sameAssetRef(currentDraft.assetRef, source.assetRef)) return;
    if (text === source.maskedText) {
      if (currentDraft?.fileProjections.some((projection) => projection.fileId === source.fileId)) {
        this.removeDraftFileProjection(currentDraft, source.fileId, source.maskedText);
      }
      return;
    }
    const fileProjection: LocalEditFileProjection = { fileId: source.fileId, sourceText: text };
    const fileProjections =
      currentDraft === null
        ? [fileProjection]
        : currentDraft.fileProjections.some((projection) => projection.fileId === source.fileId)
          ? currentDraft.fileProjections.map((projection) =>
              projection.fileId === source.fileId ? fileProjection : projection,
            )
          : [...currentDraft.fileProjections, fileProjection];
    this.update({
      draft: {
        kind: 'editAsset',
        assetRef: source.assetRef,
        activeFileId: source.fileId,
        dirty: true,
        sourceText: text,
        expandedSectionIds: currentDraft?.expandedSectionIds ?? [],
        fileProjections,
        sensitiveChanges: currentDraft?.sensitiveChanges,
      },
    });
  }

  /** 仅移除当前文件的 local projection；同 asset 的其他安全变更仍保留。 */
  private removeDraftFileProjection(
    draft: LocalEditAssetDraft,
    fileId: string,
    fallbackSourceText: string,
  ): void {
    const fileProjections = draft.fileProjections.filter(
      (projection) => projection.fileId !== fileId,
    );
    if (
      fileProjections.length === 0 &&
      draft.structuredFieldEdits === undefined &&
      (draft.sensitiveChanges?.length ?? 0) === 0
    ) {
      this.update({ draft: null });
      return;
    }
    const activeProjection =
      fileProjections.find((projection) => projection.fileId === draft.activeFileId) ??
      fileProjections[0];
    this.update({
      draft: {
        ...draft,
        activeFileId: activeProjection?.fileId ?? fileId,
        sourceText: activeProjection?.sourceText ?? fallbackSourceText,
        fileProjections,
      },
    });
  }

  /** 敏感 source 只能替换 Rust authority 已验证 parts 中的普通文本。 */
  private replaceDraftTextPart(partIndex: number, text: string): void {
    const source = this.editableMaskedPartsSource();
    if (source === null) return;
    const currentDraft = this.state.draft;
    if (currentDraft !== null && !sameAssetRef(currentDraft.assetRef, source.assetRef)) return;
    const projection = currentDraft?.fileProjections.find(
      (candidate) => candidate.fileId === source.fileId,
    );
    const parts =
      projection?.maskedParts ?? (projection === undefined ? source.maskedParts : undefined);
    const sourceText = projection?.sourceText ?? source.maskedText;
    if (
      parts === undefined ||
      !hasSameMaskedPartLayout(source.maskedParts, parts) ||
      renderedMaskedParts(parts) !== sourceText
    )
      return;
    const span = maskedTextPartSpan(parts, sourceText, partIndex);
    const part = parts[partIndex];
    if (span === null || part === undefined || part.kind !== 'text' || part.text === text) return;
    const maskedParts = parts.map((candidate, index) =>
      candidate.kind === 'sensitivePlaceholder'
        ? { kind: 'sensitivePlaceholder' as const, segmentId: candidate.segmentId }
        : { kind: 'text' as const, text: index === partIndex ? text : candidate.text },
    );
    const nextSourceText = `${sourceText.slice(0, span.start)}${text}${sourceText.slice(span.end)}`;
    if (renderedMaskedParts(maskedParts) !== nextSourceText) return;
    if (
      currentDraft !== null &&
      projection !== undefined &&
      sameMaskedParts(maskedParts, source.maskedParts)
    ) {
      this.removeDraftFileProjection(currentDraft, source.fileId, source.maskedText);
      return;
    }
    const fileProjection: LocalEditFileProjection = {
      fileId: source.fileId,
      sourceText: nextSourceText,
      maskedParts,
    };
    const fileProjections =
      currentDraft === null
        ? [fileProjection]
        : currentDraft.fileProjections.some((candidate) => candidate.fileId === source.fileId)
          ? currentDraft.fileProjections.map((candidate) =>
              candidate.fileId === source.fileId ? fileProjection : candidate,
            )
          : [...currentDraft.fileProjections, fileProjection];
    this.update({
      draft: {
        kind: 'editAsset',
        assetRef: source.assetRef,
        activeFileId: source.fileId,
        dirty: true,
        sourceText: nextSourceText,
        expandedSectionIds: currentDraft?.expandedSectionIds ?? [],
        fileProjections,
        sensitiveChanges: currentDraft?.sensitiveChanges,
      },
    });
  }

  /** 只经既有 read seam 请求 Rust authority 的单段 modify grant。 */
  private beginSensitiveModify(
    segmentId: unknown,
    scope: unknown = 'modify',
    surface: unknown = 'source',
  ): void {
    this.#clearSensitiveBuffer(false);
    if (!isOpaqueString(segmentId) || scope !== 'modify' || surface !== 'source') return;
    const source = this.sensitiveModifySource(segmentId);
    if (source === null) return;
    const requestEpoch = ++this.#sensitiveRequestEpoch;
    const request: SensitiveRevealQuery = {
      kind: 'sensitiveReveal',
      asset: source.assetRef,
      fileId: source.fileId,
      segmentId,
      fileRevision: source.fileRevision,
      assetRevision: source.assetRevision,
      scope: 'modify',
      surface: 'source',
    };
    void this.gateway
      .read(request)
      .then((result) => {
        if (
          this.disposed ||
          requestEpoch !== this.#sensitiveRequestEpoch ||
          result.kind !== 'readSucceeded'
        )
          return;
        const snapshot = sensitiveRevealSnapshotForRequest(result.snapshot, request);
        if (snapshot === null) return;
        const currentSource = this.sensitiveModifySource(segmentId);
        if (
          currentSource === null ||
          !this.#grantMatchesSource(snapshot.grant, currentSource, segmentId)
        )
          return;
        this.#sensitiveBuffer = {
          authorityPlaintext: snapshot.plaintext,
          plaintext: snapshot.plaintext,
          grant: snapshot.grant,
        };
        this.#scheduleSensitiveExpiry(snapshot.grant, requestEpoch);
        if (this.#sensitiveBuffer === null) return;
        this.update({ sensitiveEditorStatus: this.#statusWith(segmentId, 'active') });
      })
      .catch(() => undefined);
  }

  /**
   * FE-10 只读查看路径：单独请求 `view` grant，结果只进入当前 overlay 的私有
   * buffer。它不读取或创建 draft，也不会触碰 FE-03 的 modify buffer/status。
   */
  private beginSensitiveView(
    segmentId: unknown,
    scope: unknown = 'view',
    surface: unknown = 'source',
  ): void {
    this.#clearSensitiveViewBuffer();
    if (!isOpaqueString(segmentId) || scope !== 'view' || surface !== 'source') return;
    const source = this.sensitiveViewSource(segmentId);
    if (source === null) return;
    const requestEpoch = ++this.#sensitiveViewRequestEpoch;
    const request: SensitiveRevealQuery = {
      kind: 'sensitiveReveal',
      asset: source.assetRef,
      fileId: source.fileId,
      segmentId,
      fileRevision: source.fileRevision,
      assetRevision: source.assetRevision,
      scope: 'view',
      surface: 'source',
    };
    void this.gateway
      .read(request)
      .then((result) => {
        if (this.disposed || requestEpoch !== this.#sensitiveViewRequestEpoch) return;
        if (result.kind === 'readFailed') {
          this.#publishSensitiveViewFailure(segmentId, result.reasonCode);
          return;
        }
        const snapshot = sensitiveRevealSnapshotForRequest(result.snapshot, request);
        if (snapshot === null) {
          this.#publishSensitiveViewFailure(segmentId, 'GATEWAY_UNAVAILABLE');
          return;
        }
        const currentSource = this.sensitiveViewSource(segmentId);
        if (
          currentSource === null ||
          !this.#viewGrantMatchesSource(snapshot.grant, currentSource, segmentId)
        ) {
          this.#publishSensitiveViewFailure(segmentId, 'READ_FAILED');
          return;
        }
        this.#sensitiveViewBuffer = { plaintext: snapshot.plaintext, grant: snapshot.grant };
        this.#scheduleSensitiveViewExpiry(snapshot.grant, requestEpoch);
        if (this.#sensitiveViewBuffer === null) return;
        this.update({ sensitiveViewStatus: { [segmentId]: { kind: 'active' } } });
      })
      .catch(() => {
        if (this.disposed || requestEpoch !== this.#sensitiveViewRequestEpoch) return;
        this.#publishSensitiveViewFailure(segmentId, 'GATEWAY_UNAVAILABLE');
      });
  }

  /** 明文只更新 `#sensitiveBuffer`；公开 draft 仅追加 opaque changed marker。 */
  private replaceSensitiveDraftSegment(segmentId: string, value: string): void {
    if (typeof value !== 'string') return;
    const source = this.sensitiveModifySource(segmentId);
    const buffer = this.#currentSensitiveBuffer(segmentId, source);
    if (source === null || buffer === null) return;
    const currentDraft = this.state.draft;
    if (currentDraft !== null && !sameAssetRef(currentDraft.assetRef, source.assetRef)) return;
    if (
      buffer.plaintext === value &&
      (value !== buffer.authorityPlaintext ||
        !currentDraft?.sensitiveChanges?.some((change) => change.segmentId === segmentId))
    )
      return;
    if (value === buffer.authorityPlaintext) {
      this.#sensitiveBuffer = { ...buffer, plaintext: value };
      const sensitiveChanges =
        currentDraft?.sensitiveChanges?.filter((change) => change.segmentId !== segmentId) ?? [];
      if (
        currentDraft !== null &&
        currentDraft.sensitiveChanges?.some((change) => change.segmentId === segmentId)
      ) {
        const { sensitiveChanges: _clearedChange, ...draftWithoutClearedChange } = currentDraft;
        this.update({
          draft:
            sensitiveChanges.length === 0 &&
            currentDraft.fileProjections.length === 0 &&
            currentDraft.structuredFieldEdits === undefined
              ? null
              : {
                  ...draftWithoutClearedChange,
                  ...(sensitiveChanges.length === 0 ? {} : { sensitiveChanges }),
                },
          sensitiveEditorStatus: this.#statusWith(segmentId, 'active'),
        });
        return;
      }
      this.update({ sensitiveEditorStatus: this.#statusWith(segmentId, 'active') });
      return;
    }
    const projection = currentDraft?.fileProjections.find(
      (candidate) => candidate.fileId === source.fileId,
    );
    if (
      projection !== undefined &&
      (projection.maskedParts === undefined ||
        !hasSameMaskedPartLayout(source.maskedParts, projection.maskedParts) ||
        renderedMaskedParts(projection.maskedParts) !== projection.sourceText)
    )
      return;
    const fileProjection: LocalEditFileProjection = projection ?? {
      fileId: source.fileId,
      sourceText: source.maskedText,
      maskedParts: source.maskedParts,
    };
    const fileProjections =
      currentDraft === null
        ? [fileProjection]
        : projection === undefined
          ? [...currentDraft.fileProjections, fileProjection]
          : currentDraft.fileProjections;
    const sensitiveChanges = currentDraft?.sensitiveChanges?.some(
      (change) => change.segmentId === segmentId,
    )
      ? currentDraft.sensitiveChanges
      : [...(currentDraft?.sensitiveChanges ?? []), { segmentId, kind: 'changed' as const }];
    this.#sensitiveBuffer = { ...buffer, plaintext: value };
    this.update({
      draft: {
        kind: 'editAsset',
        assetRef: source.assetRef,
        activeFileId: source.fileId,
        dirty: true,
        sourceText: fileProjection.sourceText,
        expandedSectionIds: currentDraft?.expandedSectionIds ?? [],
        fileProjections,
        sensitiveChanges,
      },
      sensitiveEditorStatus: this.#statusWith(segmentId, 'changed'),
    });
  }

  #currentSensitiveViewBuffer(
    segmentId: string,
    source: SensitiveViewSource | null = this.sensitiveViewSource(segmentId),
  ): EphemeralSensitiveViewBuffer | null {
    const buffer = this.#sensitiveViewBuffer;
    if (buffer === null) return null;
    if (source === null || !this.#viewGrantMatchesSource(buffer.grant, source, segmentId))
      return null;
    return buffer;
  }

  #viewGrantMatchesSource(
    grant: SensitiveAccessGrant,
    source: SensitiveViewSource,
    segmentId: string,
  ): boolean {
    return (
      sameAssetRef(grant.asset, source.assetRef) &&
      grant.fileId === source.fileId &&
      grant.segmentId === segmentId &&
      source.sensitiveSegmentIds.includes(segmentId) &&
      grant.fileRevision === source.fileRevision &&
      grant.assetRevision === source.assetRevision &&
      grant.scope === 'view' &&
      grant.surface === 'source' &&
      isCanonicalFutureTimestamp(grant.expiresAt)
    );
  }

  #scheduleSensitiveViewExpiry(grant: SensitiveAccessGrant, bufferEpoch: number): void {
    this.#cancelSensitiveViewExpiryTimer();
    const delay = Date.parse(grant.expiresAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      this.#clearSensitiveViewBuffer();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    timer = setTimeout(() => {
      const buffer = this.#sensitiveViewBuffer;
      if (
        timer === null ||
        this.disposed ||
        this.#sensitiveViewExpiryTimer !== timer ||
        this.#sensitiveViewRequestEpoch !== bufferEpoch ||
        buffer === null ||
        !this.#sameGrantIdentity(buffer.grant, grant)
      )
        return;
      this.#sensitiveViewExpiryTimer = null;
      this.#clearSensitiveViewBuffer();
    }, delay);
    this.#sensitiveViewExpiryTimer = timer;
  }

  #cancelSensitiveViewExpiryTimer(): void {
    if (this.#sensitiveViewExpiryTimer === null) return;
    clearTimeout(this.#sensitiveViewExpiryTimer);
    this.#sensitiveViewExpiryTimer = null;
  }

  #clearSensitiveViewBufferForFileResult(
    assetRef: ReadOnlyAssetRef,
    detail: AssetDetailSnapshot,
    file: NativeFileSnapshot | null,
  ): void {
    const buffer = this.#sensitiveViewBuffer;
    if (
      buffer !== null &&
      (file === null ||
        !sameAssetRef(buffer.grant.asset, assetRef) ||
        buffer.grant.fileId !== file.file.fileId ||
        buffer.grant.fileRevision !== file.revision ||
        buffer.grant.assetRevision !== file.assetRevision ||
        file.assetRevision !== detail.revision)
    )
      this.#clearSensitiveViewBuffer();
  }

  #clearSensitiveViewBuffer(publishStatus = true): void {
    this.#cancelSensitiveViewExpiryTimer();
    this.#sensitiveViewBuffer = null;
    this.#sensitiveViewRequestEpoch += 1;
    if (Object.keys(this.state.sensitiveViewStatus).length > 0 && publishStatus) {
      this.update({ sensitiveViewStatus: {} });
    }
  }

  /** 失败态只公开 opaque reasonCode；清除任何旧 grant/buffer 后再发布。 */
  #publishSensitiveViewFailure(segmentId: string, reasonCode: ReasonCode): void {
    this.#clearSensitiveViewBuffer(false);
    this.update({ sensitiveViewStatus: { [segmentId]: { kind: 'failed', reasonCode } } });
  }

  #currentSensitiveBuffer(
    segmentId: string,
    source: SensitiveModifySource | null = this.sensitiveModifySource(segmentId),
  ): EphemeralSensitiveBuffer | null {
    const buffer = this.#sensitiveBuffer;
    if (buffer === null) return null;
    if (source === null || !this.#grantMatchesSource(buffer.grant, source, segmentId)) {
      this.#clearSensitiveBuffer(false);
      return null;
    }
    return buffer;
  }

  #grantMatchesSource(
    grant: SensitiveAccessGrant,
    source: SensitiveModifySource,
    segmentId: string,
  ): boolean {
    return (
      sameAssetRef(grant.asset, source.assetRef) &&
      grant.fileId === source.fileId &&
      grant.segmentId === segmentId &&
      source.sensitiveSegmentIds.includes(segmentId) &&
      grant.fileRevision === source.fileRevision &&
      grant.assetRevision === source.assetRevision &&
      grant.scope === 'modify' &&
      grant.surface === 'source' &&
      isCanonicalFutureTimestamp(grant.expiresAt)
    );
  }

  #scheduleSensitiveExpiry(grant: SensitiveAccessGrant, bufferEpoch: number): void {
    this.#cancelSensitiveExpiryTimer();
    const delay = Date.parse(grant.expiresAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      this.#clearSensitiveBuffer(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    timer = setTimeout(() => {
      const buffer = this.#sensitiveBuffer;
      if (
        timer === null ||
        this.disposed ||
        this.#sensitiveExpiryTimer !== timer ||
        this.#sensitiveRequestEpoch !== bufferEpoch ||
        buffer === null ||
        !this.#sameGrantIdentity(buffer.grant, grant)
      )
        return;
      this.#sensitiveExpiryTimer = null;
      this.#clearSensitiveBuffer(false);
    }, delay);
    this.#sensitiveExpiryTimer = timer;
  }

  #sameGrantIdentity(left: SensitiveAccessGrant, right: SensitiveAccessGrant): boolean {
    return (
      left.grantId === right.grantId &&
      sameAssetRef(left.asset, right.asset) &&
      left.fileId === right.fileId &&
      left.segmentId === right.segmentId &&
      left.fileRevision === right.fileRevision &&
      left.assetRevision === right.assetRevision &&
      left.scope === right.scope &&
      left.surface === right.surface &&
      left.expiresAt === right.expiresAt
    );
  }

  #cancelSensitiveExpiryTimer(): void {
    if (this.#sensitiveExpiryTimer === null) return;
    clearTimeout(this.#sensitiveExpiryTimer);
    this.#sensitiveExpiryTimer = null;
  }

  #clearSensitiveBufferForFileResult(
    assetRef: ReadOnlyAssetRef,
    detail: AssetDetailSnapshot,
    file: NativeFileSnapshot | null,
  ): void {
    const buffer = this.#sensitiveBuffer;
    if (
      buffer !== null &&
      (file === null ||
        !sameAssetRef(buffer.grant.asset, assetRef) ||
        buffer.grant.fileId !== file.file.fileId ||
        buffer.grant.fileRevision !== file.revision ||
        buffer.grant.assetRevision !== file.assetRevision ||
        file.assetRevision !== detail.revision)
    )
      this.#clearSensitiveBuffer(false);
  }

  #clearSensitiveBuffer(
    clearChangedStatus: boolean,
    publishStatus = true,
  ): SensitiveEditorStatus | undefined {
    this.#cancelSensitiveExpiryTimer();
    this.#sensitiveBuffer = null;
    this.#sensitiveRequestEpoch += 1;
    const current = this.state.sensitiveEditorStatus;
    const retained = clearChangedStatus
      ? []
      : Object.entries(current).filter(([, status]) => status.kind === 'changed');
    if (retained.length !== Object.keys(current).length) {
      const sensitiveEditorStatus = Object.fromEntries(retained) as SensitiveEditorStatus;
      if (publishStatus) this.update({ sensitiveEditorStatus });
      return sensitiveEditorStatus;
    }
    return undefined;
  }

  #statusWith(segmentId: string, kind: 'active' | 'changed'): SensitiveEditorStatus {
    return {
      ...Object.fromEntries(
        Object.entries(this.state.sensitiveEditorStatus).filter(
          ([candidate, status]) => candidate !== segmentId && status.kind === 'changed',
        ),
      ),
      [segmentId]: { kind },
    };
  }

  private replaceDraftField(field: 'model', value: string): void {
    if (field !== 'model') return;
    const source = this.editableSubagentStructuredSource();
    const currentDraft = this.state.draft;
    if (source === null) return;
    if (currentDraft !== null && !sameAssetRef(currentDraft.assetRef, source.assetRef)) return;
    if (value === source.model) {
      if (currentDraft === null || currentDraft.structuredFieldEdits?.model === undefined) return;
      // Subagent 的此文件只由 model overlay 修改；恢复 authority 值时移除它，
      // 但不影响同 asset 的其他安全 projection 或 opaque 敏感变更标记。
      const { structuredFieldEdits: _restoredField, ...draftWithoutField } = currentDraft;
      this.removeDraftFileProjection(draftWithoutField, source.fileId, source.maskedText);
      return;
    }
    const sourceText = replaceUniqueModelLine(source.maskedText, source.model, value);
    if (sourceText === null) return;
    const fileProjection: LocalEditFileProjection = { fileId: source.fileId, sourceText };
    const fileProjections =
      currentDraft === null
        ? [fileProjection]
        : currentDraft.fileProjections.some((projection) => projection.fileId === source.fileId)
          ? currentDraft.fileProjections.map((projection) =>
              projection.fileId === source.fileId ? fileProjection : projection,
            )
          : [...currentDraft.fileProjections, fileProjection];
    this.update({
      draft: {
        kind: 'editAsset',
        assetRef: source.assetRef,
        activeFileId: source.fileId,
        dirty: true,
        sourceText,
        structuredFieldEdits: { model: value },
        expandedSectionIds: currentDraft?.expandedSectionIds ?? [],
        fileProjections,
      },
    });
  }

  private setDraftSectionExpanded(sectionId: string, expanded: boolean): void {
    const draft = this.state.draft;
    if (draft === null) return;
    const alreadyExpanded = draft.expandedSectionIds.includes(sectionId);
    if (alreadyExpanded === expanded) return;
    this.update({
      draft: {
        ...draft,
        expandedSectionIds: expanded
          ? [...draft.expandedSectionIds, sectionId]
          : draft.expandedSectionIds.filter((candidate) => candidate !== sectionId),
      },
    });
  }

  /** 只接受当前已验证、可编辑的完整安全 source 投影。 */
  private editableSource(): {
    assetRef: ReadOnlyAssetRef;
    fileId: string;
    maskedText: string;
  } | null {
    const ready = this.state.detail;
    if (ready.kind !== 'ready' || ready.file === undefined) return null;
    const { detail, file } = ready;
    const source = file.content;
    const asset = detail.detail.asset;
    if (
      (asset.assetType !== 'longTermInstruction' && asset.assetType !== 'skill') ||
      detail.detail.compatibility !== 'verifiedWritable' ||
      detail.detail.capabilities.edit.kind !== 'allowed' ||
      file.file.fileKind !== 'text' ||
      file.file.canEdit.kind !== 'allowed' ||
      source.kind !== 'source' ||
      source.sensitiveSegments.length !== 0 ||
      this.state.detailView !== 'source'
    )
      return null;
    const isSupportedSurface =
      (asset.assetType === 'longTermInstruction' &&
        detail.detail.readSurface.kind === 'longTermInstruction' &&
        detail.detail.readSurface.markdownFile.fileId === file.file.fileId) ||
      (asset.assetType === 'skill' &&
        detail.detail.readSurface.kind === 'skill' &&
        detail.detail.readSurface.sourceReadAvailability.kind === 'allowed');
    if (!isSupportedSurface) return null;
    return {
      assetRef: {
        assetId: asset.assetId,
        assetType: asset.assetType,
        nativeUnitRef: asset.nativeUnitRef,
        adapterIdentity: asset.adapterIdentity,
        nativeOwnership: asset.nativeOwnership,
      },
      fileId: file.file.fileId,
      maskedText: source.maskedText,
    };
  }

  /** 仅接受当前 adapter 已验证的敏感 source 安全 parts，不从 maskedText 猜测敏感边界。 */
  private editableMaskedPartsSource(): {
    assetRef: ReadOnlyAssetRef;
    fileId: string;
    fileRevision: string;
    assetRevision: string;
    maskedText: string;
    maskedParts: readonly MaskedSourcePart[];
    sensitiveSegmentIds: readonly string[];
  } | null {
    const ready = this.state.detail;
    if (ready.kind !== 'ready' || ready.file === undefined) return null;
    const { detail, file } = ready;
    const source = file.content;
    const asset = detail.detail.asset;
    if (
      (asset.assetType !== 'longTermInstruction' && asset.assetType !== 'skill') ||
      detail.detail.compatibility !== 'verifiedWritable' ||
      detail.detail.capabilities.edit.kind !== 'allowed' ||
      file.file.fileKind !== 'text' ||
      file.file.canEdit.kind !== 'allowed' ||
      file.assetRevision !== detail.revision ||
      source.kind !== 'source' ||
      this.state.detailView !== 'source' ||
      source.maskedParts === undefined ||
      !Array.isArray(source.maskedParts) ||
      !hasValidatedMaskedParts(
        source.maskedParts,
        source.maskedText,
        source.sensitiveSegments,
        file.file.fileId,
        file.revision,
      )
    )
      return null;
    const isSupportedSurface =
      (asset.assetType === 'longTermInstruction' &&
        detail.detail.readSurface.kind === 'longTermInstruction' &&
        detail.detail.readSurface.markdownFile.fileId === file.file.fileId) ||
      (asset.assetType === 'skill' &&
        detail.detail.readSurface.kind === 'skill' &&
        detail.detail.readSurface.sourceReadAvailability.kind === 'allowed');
    if (!isSupportedSurface) return null;
    return {
      assetRef: {
        assetId: asset.assetId,
        assetType: asset.assetType,
        nativeUnitRef: asset.nativeUnitRef,
        adapterIdentity: asset.adapterIdentity,
        nativeOwnership: asset.nativeOwnership,
      },
      fileId: file.file.fileId,
      fileRevision: file.revision,
      assetRevision: file.assetRevision,
      maskedText: source.maskedText,
      maskedParts: source.maskedParts,
      sensitiveSegmentIds: source.sensitiveSegments.map((segment) => segment.segmentId),
    };
  }

  private sensitiveModifySource(segmentId: string): SensitiveModifySource | null {
    if (!isOpaqueString(segmentId)) return null;
    const source = this.editableMaskedPartsSource();
    return source === null || !source.sensitiveSegmentIds.includes(segmentId) ? null : source;
  }

  /**
   * FE-10 `view` 不继承 modify 的可编辑限制：只接受当前已遮蔽 source 明确给出的
   * opaque segment/revision binding，任何不一致都在 read 前封闭失败。
   */
  private sensitiveViewSource(segmentId: string): SensitiveViewSource | null {
    if (!isOpaqueString(segmentId)) return null;
    const ready = this.state.detail;
    if (ready.kind !== 'ready' || ready.file === undefined) return null;
    const { detail, file } = ready;
    const source = file.content;
    const asset = detail.detail.asset;
    if (
      asset.assetType === 'hook' ||
      file.file.fileKind !== 'text' ||
      source.kind !== 'source' ||
      file.assetRevision !== detail.revision
    )
      return null;
    const segment = source.sensitiveSegments.find((candidate) => candidate.segmentId === segmentId);
    if (
      segment === undefined ||
      segment.fileId !== file.file.fileId ||
      segment.revision !== file.revision ||
      segment.displayState !== 'masked'
    )
      return null;
    return {
      assetRef: {
        assetId: asset.assetId,
        assetType: asset.assetType,
        nativeUnitRef: asset.nativeUnitRef,
        adapterIdentity: asset.adapterIdentity,
        nativeOwnership: asset.nativeOwnership,
      },
      fileId: file.file.fileId,
      fileRevision: file.revision,
      assetRevision: file.assetRevision,
      sensitiveSegmentIds: source.sensitiveSegments.map((candidate) => candidate.segmentId),
    };
  }

  /** 仅限 Subagent 已验证结构化 surface 的单一 `model` 字段。 */
  private editableSubagentStructuredSource(): {
    assetRef: ReadOnlyAssetRef;
    fileId: string;
    maskedText: string;
    model: string;
  } | null {
    const ready = this.state.detail;
    if (ready.kind !== 'ready' || ready.file === undefined) return null;
    const { detail, file } = ready;
    const source = file.content;
    const asset = detail.detail.asset;
    if (
      asset.assetType !== 'subagent' ||
      detail.detail.compatibility !== 'verifiedWritable' ||
      detail.detail.capabilities.edit.kind !== 'allowed' ||
      detail.detail.readSurface.kind !== 'subagent' ||
      detail.detail.readSurface.bodyFile.fileId !== file.file.fileId ||
      typeof detail.detail.readSurface.model !== 'string' ||
      file.file.fileKind !== 'text' ||
      file.file.canEdit.kind !== 'allowed' ||
      file.structuredView.kind !== 'allowed' ||
      source.kind !== 'source' ||
      source.sensitiveSegments.length !== 0 ||
      this.state.detailView !== 'structured'
    )
      return null;
    return {
      assetRef: {
        assetId: asset.assetId,
        assetType: asset.assetType,
        nativeUnitRef: asset.nativeUnitRef,
        adapterIdentity: asset.adapterIdentity,
        nativeOwnership: asset.nativeOwnership,
      },
      fileId: file.file.fileId,
      maskedText: source.maskedText,
      model: detail.detail.readSurface.model,
    };
  }

  private draftForFile(assetRef: ReadOnlyAssetRef, fileId: string): LocalEditAssetDraft | null {
    const draft = this.state.draft;
    if (draft === null || !sameAssetRef(draft.assetRef, assetRef)) return null;
    const projection = draft.fileProjections.find((candidate) => candidate.fileId === fileId);
    return projection === undefined
      ? null
      : { ...draft, activeFileId: fileId, sourceText: projection.sourceText };
  }

  private update(patch: Partial<ReadOnlyWorkbenchState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private resetPage(): ListPresentationState {
    return { ...this.state.presentation, page: 1 };
  }

  /** locator destination 改变作用域时，All-only projectIds 不能进入 global/project query。 */
  private filtersForLocatorDestination(viewContext: ViewContext): WorkbenchFilters | undefined {
    if (viewContext.kind === 'all') {
      return canonicalizeWorkbenchFilters(this.state.filters, viewContext);
    }
    const { projectIds: _projectIds, ...retained } = this.state.filters ?? {};
    return canonicalizeWorkbenchFilters(retained, viewContext);
  }
}
