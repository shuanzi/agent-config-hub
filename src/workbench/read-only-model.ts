/**
 * FE-01 的前端本地只读投影规则。
 *
 * 此模块只消费同次 `WorkbenchActualReadSnapshot` 中的权威事实；它不导入
 * gateway、Tauri、文件系统或任何写入 API。`ReadOnlyWorkbenchSession` 以它作为
 * FrontendGateway.read 的呈现层，event 只会使 session 发起权威重读。
 */

export const MVP_ASSET_TYPES = ['skill', 'longTermInstruction', 'subagent'] as const;
export type MvpAssetType = (typeof MVP_ASSET_TYPES)[number];

export const AGENT_ORDER = ['claude-code', 'codex', 'gemini-cli', 'opencode'] as const;
export type AgentId = (typeof AGENT_ORDER)[number];

export const STATUS_ORDER = [
  'editable',
  'readOnly',
  'incompatible',
  'normal',
  'overridden',
  'conflict',
  'drift',
] as const;
export type WorkbenchStatus = (typeof STATUS_ORDER)[number];

export type ViewContext =
  { kind: 'all' } | { kind: 'global' } | { kind: 'project'; projectId: string };

export interface WorkbenchFilters {
  agents?: AgentId[];
  sourceIds?: string[];
  statuses?: WorkbenchStatus[];
  projectIds?: string[];
}

export interface WorkbenchQuery {
  kind: 'workbench';
  assetType: MvpAssetType;
  viewContext: ViewContext;
  filters?: WorkbenchFilters;
}

export interface GlobalLocatorQuery {
  kind: 'globalLocator';
  searchText: string;
  assetTypes: readonly MvpAssetType[];
}

export type ReadOnlyQuery = WorkbenchQuery | GlobalLocatorQuery;

/** Workbench/locator 选择必须保留的原生 identity；不用于读取源码。 */
export interface ReadOnlyAssetRef {
  assetId: string;
  assetType: MvpAssetType;
  nativeUnitRef: string;
  adapterIdentity: string;
  nativeOwnership: { kind: 'global' } | { kind: 'project'; projectId: string };
}

export interface ReadOnlyRow {
  /** authoritative gateway rows 必须带全量 native AssetRef。 */
  assetRef: ReadOnlyAssetRef;
  assetId: string;
  displayName: string;
  /** 来源 snapshot 的唯一、权威排序键。 */
  sortBaseName: string;
  /** 同名 `sortBaseName` 的权威稳定 tie-break；不向用户显示。 */
  authoritativeInputOrder: number;
  /** global `AssetRef` 的 native identity 仍由 gateway snapshot 提供。 */
  nativeOwnership?: { kind: 'global' } | { kind: 'project'; projectId: string };
  agents?: readonly AgentId[];
  sourceTierId?: string;
  sourceTierLabel?: string;
  redactedSummary?: string;
  ownershipHint?: string;
  statuses?: readonly WorkbenchStatus[];
  skillTargetStates?: readonly SkillTargetState[];
}

export type SegmentSource = 'globalApplicable' | 'projectNative';

export interface WorkbenchSegment {
  id: string;
  source: SegmentSource;
  displayLabel: string;
  projectId?: string;
  rows: readonly ReadOnlyRow[];
}

export interface EffectiveContextFact {
  /** authoritative native identity; project matching must never use assetId alone. */
  asset: ReadOnlyAssetRef;
  assetId: string;
  projectId: string;
  projectDisplayName?: string;
  resolution: 'resolved' | 'unknown' | 'blocked' | 'stale';
  reasonCode?: string;
  authoritativeReadRevision?: string;
  sourceTierId?: string;
  loadOrder?: number;
  priority?: number;
  adapter?: {
    identity: string;
    version: string;
    source:
      | { kind: 'builtIn' }
      | { kind: 'activePackage'; packageIdentity: string; packageVersion: string };
  };
  rule?: {
    identity: string;
    version: string;
    source:
      | { kind: 'builtIn' }
      | { kind: 'activePackage'; packageIdentity: string; packageVersion: string };
  };
  overrideRelation?: {
    kind: 'overrides' | 'overriddenBy' | 'shadowed';
    otherAssetId: string;
    note: string;
  };
}

export interface WorkbenchFinding {
  assetId: string;
  reasonCode: string;
  context?: EffectiveContextFact;
}

export interface WorkbenchActualReadSnapshot {
  kind: 'workbench';
  query: WorkbenchQuery;
  authoritativeReadRevision: string;
  segments: readonly WorkbenchSegment[];
  effectiveContexts: readonly EffectiveContextFact[];
  findings: readonly WorkbenchFinding[];
  aggregateTotal: number;
  indexStatus: 'fresh' | 'stale' | 'rebuilding' | 'failed';
  readAt: string;
}

export type LocatorDestination =
  | { kind: 'skillDetail'; assetRef: ReadOnlyAssetRef }
  | { kind: 'unsupportedReadOnly'; assetRef: ReadOnlyAssetRef; reasonCode: string };

export interface LocatorResult extends Omit<ReadOnlyRow, 'redactedSummary' | 'ownershipHint'> {
  /** locator 只能展示已遮蔽的摘要；缺失时整个 wire snapshot fail-closed。 */
  redactedSummary: string;
  /** 已遮蔽的全局/项目展示提示；opaque AssetRef 仍是唯一 identity。 */
  ownershipHint: string;
  destinationViewContext: ViewContext;
  destination: LocatorDestination;
  matchedField:
    'displayName' | 'assetType' | 'agent' | 'ownership' | 'projectHint' | 'redactedSummary';
}

export interface LocatorGroup {
  assetType: MvpAssetType;
  count: number;
  results: readonly LocatorResult[];
}

export interface GlobalLocatorSnapshot {
  kind: 'globalLocator';
  groups: readonly LocatorGroup[];
  aggregateTotal: number;
  readAt: string;
}

export type ReadOnlySnapshot = WorkbenchActualReadSnapshot | GlobalLocatorSnapshot;

export interface SkillTargetState {
  agent: AgentId;
  presence: 'absent' | 'present' | 'unknown' | 'blocked' | 'stale';
  activation: 'notApplicable' | 'enabled' | 'disabled' | 'unknown' | 'blocked' | 'stale';
  applicability: 'resolved' | 'unknown' | 'blocked' | 'stale';
  /** 权威操作可用性只读事实；FE-01 不渲染任何操作控件。 */
  enableAvailability: SkillCellAvailability;
  disableAvailability: SkillCellAvailability;
  /** 可选的权威事务标识；仅显示，不产生或推进事务。 */
  pending?: { operationId: string; phase: string };
  stableReason?: string;
}

export type SkillCellAvailability =
  | { kind: 'allowed' }
  | { kind: 'disabled'; reasonCode: string }
  | { kind: 'blocked'; reasonCode: string };

export interface ListPresentationState {
  nameSort: 'asc' | 'desc';
  pageSize: 20 | 50 | 100;
  page: number;
}

export interface WorkbenchProjection {
  segments: readonly WorkbenchSegment[];
  aggregateTotal: number;
  page: number;
  pageCount: number;
}

export const DEFAULT_LIST_PRESENTATION: ListPresentationState = {
  nameSort: 'asc',
  pageSize: 20,
  page: 1,
};

const NAME_COLLATOR = new Intl.Collator('zh-CN', {
  usage: 'sort',
  numeric: true,
  sensitivity: 'variant',
  caseFirst: 'false',
  ignorePunctuation: false,
});

function byteCompare(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function assertNonEmptyIds(ids: readonly string[] | undefined): void {
  if (ids?.some((id) => id.trim() === '')) {
    throw new Error('READ_FAILED: opaque id must be non-empty');
  }
}

/**
 * 将用户筛选规范化为 snapshot/query echo 使用的唯一 closed form。
 * 空集合从 canonical form 省略；`projectIds` 只允许 all view。
 */
export function canonicalizeWorkbenchFilters(
  filters: WorkbenchFilters | undefined,
  viewContext: ViewContext,
): WorkbenchFilters | undefined {
  if (filters === undefined) return undefined;
  if (
    filters.agents?.some((agent) => !AGENT_ORDER.includes(agent)) ||
    filters.statuses?.some((status) => !STATUS_ORDER.includes(status))
  ) {
    throw new Error('READ_FAILED: unknown workbench filter enum');
  }
  assertNonEmptyIds(filters.sourceIds);
  assertNonEmptyIds(filters.projectIds);
  if (viewContext.kind !== 'all' && (filters.projectIds?.length ?? 0) > 0) {
    throw new Error('READ_FAILED: projectIds are only valid in all view');
  }
  const canonical: WorkbenchFilters = {};
  if ((filters.agents?.length ?? 0) > 0) {
    canonical.agents = AGENT_ORDER.filter((agent) => filters.agents?.includes(agent));
  }
  if ((filters.sourceIds?.length ?? 0) > 0) {
    canonical.sourceIds = unique(filters.sourceIds ?? []).sort(byteCompare);
  }
  if ((filters.statuses?.length ?? 0) > 0) {
    canonical.statuses = STATUS_ORDER.filter((status) => filters.statuses?.includes(status));
  }
  if ((filters.projectIds?.length ?? 0) > 0) {
    canonical.projectIds = unique(filters.projectIds ?? []).sort(byteCompare);
  }
  return Object.keys(canonical).length === 0 ? undefined : canonical;
}

/**
 * project view 的防御性呈现筛选：只有同一 opaque project 的 resolved
 * EffectiveContext 才能让 global-applicable row 可见。该规则不会把 finding
 * 或 non-resolved context 伪装成项目投影。
 */
export function projectVisibleRows(snapshot: WorkbenchActualReadSnapshot): ReadOnlyRow[] {
  if (snapshot.query.viewContext.kind !== 'project') {
    return snapshot.segments.flatMap((segment) => segment.rows);
  }
  const projectId = snapshot.query.viewContext.projectId;
  const resolved = snapshot.effectiveContexts
    .filter((context) => context.projectId === projectId && context.resolution === 'resolved')
    .map((context) => context.asset);
  const matchesResolvedAsset = (row: ReadOnlyRow) =>
    resolved.some(
      (asset) =>
        asset.assetId === row.assetRef.assetId &&
        asset.assetType === row.assetRef.assetType &&
        asset.nativeUnitRef === row.assetRef.nativeUnitRef &&
        asset.adapterIdentity === row.assetRef.adapterIdentity &&
        asset.nativeOwnership.kind === row.assetRef.nativeOwnership.kind &&
        (asset.nativeOwnership.kind !== 'project' ||
          row.assetRef.nativeOwnership.kind !== 'project' ||
          asset.nativeOwnership.projectId === row.assetRef.nativeOwnership.projectId),
    );
  return snapshot.segments.flatMap((segment) => {
    if (segment.source === 'projectNative') return segment.rows;
    return segment.rows.filter(matchesResolvedAsset);
  });
}

function rowMatchesFilters(
  row: ReadOnlyRow,
  segment: WorkbenchSegment,
  filters: WorkbenchFilters | undefined,
  viewContext: ViewContext,
): boolean {
  if (filters === undefined) return true;
  if (
    filters.agents !== undefined &&
    !filters.agents.some((agent) => row.agents?.includes(agent) ?? false)
  ) {
    return false;
  }
  if (filters.sourceIds !== undefined && !filters.sourceIds.includes(row.sourceTierId ?? '')) {
    return false;
  }
  if (
    filters.statuses !== undefined &&
    !filters.statuses.some((status) => row.statuses?.includes(status) ?? false)
  ) {
    return false;
  }
  return !(
    viewContext.kind === 'all' &&
    segment.source === 'projectNative' &&
    filters.projectIds !== undefined &&
    !filters.projectIds.includes(segment.projectId ?? '')
  );
}

function isVisibleInProject(
  row: ReadOnlyRow,
  segment: WorkbenchSegment,
  snapshot: WorkbenchActualReadSnapshot,
): boolean {
  if (snapshot.query.viewContext.kind !== 'project') return true;
  if (segment.source === 'projectNative') return true;
  const projectId = snapshot.query.viewContext.projectId;
  return snapshot.effectiveContexts.some(
    (context) =>
      context.asset.assetId === row.assetRef.assetId &&
      context.asset.assetType === row.assetRef.assetType &&
      context.asset.nativeUnitRef === row.assetRef.nativeUnitRef &&
      context.asset.adapterIdentity === row.assetRef.adapterIdentity &&
      context.asset.nativeOwnership.kind === row.assetRef.nativeOwnership.kind &&
      (context.asset.nativeOwnership.kind !== 'project' ||
        row.assetRef.nativeOwnership.kind !== 'project' ||
        context.asset.nativeOwnership.projectId === row.assetRef.nativeOwnership.projectId) &&
      context.projectId === projectId &&
      context.resolution === 'resolved',
  );
}

function orderedSegments(snapshot: WorkbenchActualReadSnapshot): readonly WorkbenchSegment[] {
  const { viewContext } = snapshot.query;
  const applicable = snapshot.segments.filter((segment) => {
    if (viewContext.kind === 'all') return true;
    if (viewContext.kind === 'global') return segment.source === 'globalApplicable';
    return (
      (segment.source === 'projectNative' && segment.projectId === viewContext.projectId) ||
      segment.source === 'globalApplicable'
    );
  });
  const globals = applicable.filter((segment) => segment.source === 'globalApplicable');
  const projects = applicable
    .filter((segment) => segment.source === 'projectNative')
    .sort((left, right) => {
      const byLabel = NAME_COLLATOR.compare(
        left.displayLabel.normalize('NFC'),
        right.displayLabel.normalize('NFC'),
      );
      return byLabel !== 0 ? byLabel : byteCompare(left.projectId ?? '', right.projectId ?? '');
    });
  if (viewContext.kind === 'project') return [...projects, ...globals];
  return [...globals, ...projects];
}

function stableSortedRows(
  rows: readonly ReadOnlyRow[],
  nameSort: ListPresentationState['nameSort'],
) {
  return [...rows].sort((left, right) => {
    const compared = NAME_COLLATOR.compare(
      left.sortBaseName.normalize('NFC'),
      right.sortBaseName.normalize('NFC'),
    );
    if (compared !== 0) return nameSort === 'asc' ? compared : -compared;
    return left.authoritativeInputOrder - right.authoritativeInputOrder;
  });
}

/**
 * 完整 actual-read snapshot 的纯前端投影：筛选、固定段序、段内稳定排序、
 * 扁平化，最后只有一个跨段分页窗口。它不产生 gateway query 或任何写副作用。
 */
export function projectWorkbenchProjection(
  snapshot: WorkbenchActualReadSnapshot,
  presentation: ListPresentationState,
): WorkbenchProjection {
  if (![20, 50, 100].includes(presentation.pageSize) || presentation.page < 1) {
    throw new Error('READ_FAILED: invalid local list presentation');
  }
  const segments = orderedSegments(snapshot)
    .map((segment) => ({
      ...segment,
      rows: stableSortedRows(
        segment.rows.filter(
          (row) =>
            isVisibleInProject(row, segment, snapshot) &&
            rowMatchesFilters(row, segment, snapshot.query.filters, snapshot.query.viewContext),
        ),
        presentation.nameSort,
      ),
    }))
    .filter((segment) => segment.rows.length > 0);
  const flattened = segments.flatMap((segment) =>
    segment.rows.map((row) => ({ segmentId: segment.id, row })),
  );
  const aggregateTotal = flattened.length;
  const pageCount = Math.max(1, Math.ceil(aggregateTotal / presentation.pageSize));
  const page = aggregateTotal === 0 ? 1 : Math.min(presentation.page, pageCount);
  const start = (page - 1) * presentation.pageSize;
  const pageRows = flattened.slice(start, start + presentation.pageSize);
  const rowsBySegment = new Map<string, ReadOnlyRow[]>();
  for (const { segmentId, row } of pageRows) {
    const rows = rowsBySegment.get(segmentId) ?? [];
    rows.push(row);
    rowsBySegment.set(segmentId, rows);
  }
  return {
    segments: segments
      .map((segment) => ({ ...segment, rows: rowsBySegment.get(segment.id) ?? [] }))
      .filter((segment) => segment.rows.length > 0),
    aggregateTotal,
    page,
    pageCount,
  };
}
