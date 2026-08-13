/**
 * ScriptedMockGateway — FE-01 的内存 mock FrontendGateway。
 *
 * 事实来源：FX-01 合成 fixture（fixtures/fx-01）。所有人类可读文本（displayName、
 * contextHint、pathDisplay、anomaly/ReadFailed message、sourceTier 标签等）在
 * 离开 gateway 前统一经 fixtures/sensitive-masking.ts 遮蔽；原始 SKILL.md 文本
 * 同理；sensitiveSegments 只携带元数据（不含 rawValue）。本模块不 import Tauri、
 * 不读文件系统、不访问浏览器存储。
 *
 * 脚本化能力（供 L1/L2 注入，不属于 FrontendGateway 契约）：
 * - failNext(queryKind, reasonCode)：下一次对应 read 返回一次性 ReadFailed(retryRead)；
 * - setIndexStatus('fresh' | 'stale')：stale 时 indexUpdatedAt 为过去时刻；
 * - simulateExternalChange()：revision 变为新不透明值，后续 read 反映新 revision；
 * - emitEvent(event)：向所有 observe listener 发事件；
 * - deferObserveReady()/resolveDeferredObserveReady()：挂起/释放 observe ready，
 *   用于确定性测试“listener ready 前不发起初始 read”；
 * - failObserve(times)：接下来 times 次 observe 进入降级（ready 仍 resolve，
 *   listener 不注册，事件不投递）；
 * - setFixtureTextOverrides(overrides)：覆盖 fixture 人类可读字段，用于注入
 *   含合成占位值的文本以验证出口统一遮蔽；
 * - pauseReads()/resumeReads()：暂停/恢复 read 完成，用于确定性地测试旧响应丢弃；
 * - applyScenario(name)：按 URL scenario 参数应用脚本（fail-list / fail-detail / stale-index）；
 * - getCallLog()：返回全部 read 调用（含 query），供“只有 read、无 prepare/apply”断言。
 */
import fixture from '../../fixtures/fx-01/fixture.json';
import skillMdRaw from '../../fixtures/fx-01/native-root/skills/demo-skill/SKILL.md?raw';
import { maskSyntheticSecrets } from '../../fixtures/sensitive-masking';
import {
  buildPerfCatalog,
  matchesPerfListQuery,
  type PerfCatalog,
  type PerfProfile,
} from './perf-catalog';
import {
  AGENT_ORDER,
  canonicalizeWorkbenchFilters,
  MVP_ASSET_TYPES,
  DEFAULT_LIST_PRESENTATION,
  type GlobalLocatorSnapshot,
  projectWorkbenchProjection,
  type ReadOnlyAssetRef,
  type ReadOnlyRow,
  type SkillTargetState,
  type ViewContext,
  type WorkbenchActualReadSnapshot,
  type WorkbenchQuery,
} from '../workbench/read-only-model';
import type { FrontendGateway, ObserveHandle } from '../contract/gateway';
import type {
  Anomaly,
  AssetContextHint,
  AssetDetail,
  AssetDetailSnapshot,
  AssetListQuery,
  AssetListSnapshot,
  AssetRef,
  AssetStatusFilter,
  AssetSummary,
  EffectiveContext,
  IndexStatus,
  InspectorData,
  NativeFileRef,
  NativeFileSnapshot,
  Query,
  ReadResult,
  ReasonCode,
  SensitiveSegmentRef,
  SnapshotFor,
  Subscription,
  WorkspaceEvent,
} from '../contract/types';

/** 一次 read 调用的记录（query 种类 + 原始 query，供旅程断言） */
export interface RecordedReadCall {
  method: 'read';
  queryKind: Query['kind'];
  query: Query;
}

/** 可脚本化覆盖的 fixture 人类可读字段（注入后仍在 gateway 出口统一遮蔽） */
export interface FixtureTextOverrides {
  displayName?: string;
  pathHint?: string;
  pathDisplay?: string;
  sourceTierLabel?: string;
  readFailedMessage?: string;
  anomalies?: Anomaly[];
}

// ---------------------------------------------------------------------------
// gateway 出口统一遮蔽：所有人类可读字符串字段离开前过 maskSyntheticSecrets；
// 不透明 id（assetId/fileId/sourceTier.id 等）除外。
// ---------------------------------------------------------------------------

function maskAnomalies(anomalies: Anomaly[]): Anomaly[] {
  return anomalies.map((anomaly) => ({
    ...anomaly,
    message: maskSyntheticSecrets(anomaly.message),
  }));
}

function maskContextHint(hint: AssetContextHint): AssetContextHint {
  return hint.kind === 'project'
    ? { kind: 'project', projectName: maskSyntheticSecrets(hint.projectName) }
    : { kind: 'path', pathHint: maskSyntheticSecrets(hint.pathHint) };
}

function maskEffectiveContexts(contexts: EffectiveContext[]): EffectiveContext[] {
  return contexts.map((context) => ({
    ...context,
    sourceTierLabel: maskSyntheticSecrets(context.sourceTierLabel),
  }));
}

function maskAssetSummary(summary: AssetSummary): AssetSummary {
  return {
    ...summary,
    displayName: maskSyntheticSecrets(summary.displayName),
    anomalies: maskAnomalies(summary.anomalies),
    contextHint: maskContextHint(summary.contextHint),
    sourceTier: {
      id: summary.sourceTier.id,
      label: maskSyntheticSecrets(summary.sourceTier.label),
    },
  };
}

function maskAssetDetail(detail: AssetDetail): AssetDetail {
  return {
    ...detail,
    displayName: maskSyntheticSecrets(detail.displayName),
    effectiveContexts: maskEffectiveContexts(detail.effectiveContexts),
  };
}

function maskInspectorData(inspector: InspectorData): InspectorData {
  const anchor = inspector.sourceAnchor;
  return {
    ...inspector,
    effectiveContexts: maskEffectiveContexts(inspector.effectiveContexts),
    sourceAnchor:
      anchor.kind === 'project'
        ? { kind: 'project', projectName: maskSyntheticSecrets(anchor.projectName) }
        : anchor.kind === 'globalRoot'
          ? { kind: 'globalRoot', label: maskSyntheticSecrets(anchor.label) }
          : anchor,
    pathDisplay: maskSyntheticSecrets(inspector.pathDisplay),
    overrides: inspector.overrides.map((override) => ({
      ...override,
      note: maskSyntheticSecrets(override.note),
    })),
  };
}

function toReadOnlyAssetRef(asset: AssetRef): ReadOnlyAssetRef {
  if (asset.assetType === 'hook') {
    throw new Error('Hook is outside the FE-01 locator surface');
  }
  return {
    assetId: asset.assetId,
    assetType: asset.assetType,
    nativeUnitRef: asset.nativeUnitRef,
    adapterIdentity: asset.adapterIdentity,
    nativeOwnership: asset.nativeOwnership,
  };
}

/**
 * ScriptedMock 不是 Unicode case-fold 的权威实现。Rust locator 才是唯一
 * authoritative matcher；此处只保存 FE-01 已登记 fixture/vector 的预计算
 * canonical facts，避免把 `toLowerCase` 误宣称为 default case-fold。
 */
const REGISTERED_LOCATOR_CANONICAL_FACTS: Readonly<Record<string, string>> = {
  'Café Straße': 'café strasse',
  café: 'café',
  CAFÉ: 'café',
  Straße: 'strasse',
  straße: 'strasse',
  STRASSE: 'strasse',
  'é S': 'é s',
};

function mockCanonicalLocatorFact(value: string): string {
  const nfc = value.trim().normalize('NFC');
  const registered = REGISTERED_LOCATOR_CANONICAL_FACTS[nfc];
  if (registered !== undefined) return registered;
  // 仅普通 ASCII fixture 的非权威便利匹配；未知 Unicode 事实保持 NFC 原样。
  return Array.from(nfc).every((character) => character.codePointAt(0)! <= 0x7f)
    ? nfc.toLowerCase()
    : nfc;
}

function mockLocatorMatchedField(
  query: string,
  row: ReadOnlyRow,
): 'displayName' | 'assetType' | 'agent' | 'ownership' | 'projectHint' | 'redactedSummary' | null {
  const needle = mockCanonicalLocatorFact(query);
  if (needle === '') return null;
  const contains = (value: string | undefined) =>
    value === undefined ? false : mockCanonicalLocatorFact(value).includes(needle);
  if (contains(row.displayName)) return 'displayName';
  if (contains(row.assetRef.assetType)) return 'assetType';
  if (row.agents?.some((agent) => contains(agent))) return 'agent';
  if (contains(row.nativeOwnership?.kind)) return 'ownership';
  if (contains(row.ownershipHint)) return 'projectHint';
  return contains(row.redactedSummary) ? 'redactedSummary' : null;
}

export class ScriptedMockGateway implements FrontendGateway {
  private readonly listeners = new Set<(event: WorkspaceEvent) => void>();
  private readonly readCalls: RecordedReadCall[] = [];
  private observeCallCount = 0;
  private readonly pendingFailures = new Map<Query['kind'], ReasonCode[]>();
  private indexStatus: IndexStatus = 'fresh';
  private staleIndexUpdatedAt = new Date(Date.now() - 3600_000).toISOString();
  private externalChangeCount = 0;
  private paused = false;
  private readonly pauseQueue: Array<() => void> = [];
  private deferredObserveReady: { promise: Promise<void>; resolve: () => void } | null = null;
  private observeFailuresRemaining = 0;
  private textOverrides: FixtureTextOverrides = {};
  private projectProjection: 'none' | 'single' | 'multiple' = 'none';
  private skillCellFailure: 'unknown' | 'blocked' | null = null;
  private unsupportedLocator = false;
  private failWorkbenchAfterLocator = false;
  /** PF-01 perf-catalog scenario 的合成目录；null 时保持 FX-01 单资产语义 */
  private perfCatalog: PerfCatalog | null = null;

  async read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
    this.readCalls.push({ method: 'read', queryKind: query.kind, query });
    await this.waitIfPaused();

    const failureQueue = this.pendingFailures.get(query.kind);
    const scriptedReason = failureQueue?.shift();
    if (scriptedReason !== undefined) {
      return this.readFailed(scriptedReason);
    }

    if (this.perfCatalog !== null) {
      return this.readFromPerfCatalog(query) as ReadResult<SnapshotFor<Q>>;
    }

    switch (query.kind) {
      case 'assetList':
        return this.readSucceeded(this.buildAssetListSnapshot(query)) as ReadResult<SnapshotFor<Q>>;
      case 'workbench':
        return this.readWorkbench(query) as ReadResult<SnapshotFor<Q>>;
      case 'globalLocator':
        if (this.failWorkbenchAfterLocator) {
          this.failWorkbenchAfterLocator = false;
          this.failNext('workbench', 'READ_FAILED');
        }
        return this.readSucceeded(this.buildGlobalLocatorSnapshot(query.searchText)) as ReadResult<
          SnapshotFor<Q>
        >;
      case 'projectApplicability':
        // FE-07R only accepts FX-19 through the Rust/Tauri actual-read path; the
        // legacy scripted mock must not manufacture applicability facts.
        return this.readFailed('UNSUPPORTED_CAPABILITY') as ReadResult<SnapshotFor<Q>>;
      case 'assetDetail':
        if (query.asset.assetId !== this.assetRef().assetId) {
          return this.readFailed('READ_FAILED');
        }
        return this.readSucceeded(this.buildAssetDetailSnapshot()) as ReadResult<SnapshotFor<Q>>;
      case 'nativeFile':
        if (
          query.asset.assetId !== this.assetRef().assetId ||
          query.fileId !== fixture.primaryFile.fileId
        ) {
          return this.readFailed('READ_FAILED');
        }
        return this.readSucceeded(this.buildNativeFileSnapshot()) as ReadResult<SnapshotFor<Q>>;
    }
  }

  observe(subscription: Subscription, listener: (event: WorkspaceEvent) => void): ObserveHandle {
    void subscription;
    this.observeCallCount += 1;
    // failObserve 脚本化降级：ready 照常 resolve（事件通道允许丢失），listener 不注册
    const degraded = this.observeFailuresRemaining > 0;
    if (degraded) {
      this.observeFailuresRemaining -= 1;
    } else {
      this.listeners.add(listener);
    }
    const ready = this.deferredObserveReady?.promise ?? Promise.resolve();
    return {
      ready,
      unlisten: () => {
        this.listeners.delete(listener);
      },
    };
  }

  // -------------------------------------------------------------------------
  // 脚本化 API（非契约）
  // -------------------------------------------------------------------------

  /** 下一次对应种类的 read 返回一次性 ReadFailed（带 retryRead 恢复动作） */
  failNext(queryKind: Query['kind'], reasonCode: ReasonCode): void {
    const queue = this.pendingFailures.get(queryKind) ?? [];
    queue.push(reasonCode);
    this.pendingFailures.set(queryKind, queue);
  }

  /** 挂起后续 observe 的 ready，直到 resolveDeferredObserveReady()（一次性脚本） */
  deferObserveReady(): void {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
      resolve = settle;
    });
    this.deferredObserveReady = { promise, resolve };
  }

  /** 释放由 deferObserveReady 挂起的 ready */
  resolveDeferredObserveReady(): void {
    this.deferredObserveReady?.resolve();
    this.deferredObserveReady = null;
  }

  /** 接下来 times 次 observe 进入降级：ready 仍 resolve，listener 不注册 */
  failObserve(times: number): void {
    this.observeFailuresRemaining = times;
  }

  /** 覆盖 fixture 人类可读字段（出口遮蔽语义不变；用于注入占位文本验证遮蔽） */
  setFixtureTextOverrides(overrides: FixtureTextOverrides): void {
    this.textOverrides = overrides;
  }

  setIndexStatus(status: 'fresh' | 'stale'): void {
    this.indexStatus = status;
    if (status === 'stale') {
      this.staleIndexUpdatedAt = new Date(Date.now() - 3600_000).toISOString();
    }
  }

  /** 改变 revision；后续 read 反映新 revision（模拟磁盘外部变化） */
  simulateExternalChange(): void {
    this.externalChangeCount += 1;
  }

  /** 向所有 observe listener 发事件 */
  emitEvent(event: WorkspaceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** 暂停 read 完成（调用仍被记录），用于确定性地制造乱序/旧响应 */
  pauseReads(): void {
    this.paused = true;
  }

  resumeReads(): void {
    this.paused = false;
    const queue = this.pauseQueue.splice(0);
    for (const release of queue) {
      release();
    }
  }

  /** 按 URL scenario 参数应用脚本（L2 注入点） */
  applyScenario(scenario: string | null): void {
    switch (scenario) {
      case 'fail-list':
        this.failNext('workbench', 'READ_FAILED');
        break;
      case 'fail-detail':
        this.failNext('assetDetail', 'READ_FAILED');
        break;
      case 'stale-index':
        this.setIndexStatus('stale');
        break;
      case 'unknown-skill-cell':
        this.skillCellFailure = 'unknown';
        break;
      case 'blocked-skill-cell':
        this.skillCellFailure = 'blocked';
        break;
      case 'project-projection':
        this.projectProjection = 'single';
        break;
      case 'multi-project-projection':
        this.projectProjection = 'multiple';
        break;
      case 'fail-locator':
        this.failNext('globalLocator', 'READ_FAILED');
        break;
      case 'unsupported-locator':
        this.unsupportedLocator = true;
        break;
      case 'fail-locator-detail':
        this.failWorkbenchAfterLocator = true;
        break;
      case 'masked-text':
        this.setFixtureTextOverrides({
          displayName: 'SYNTHETIC-SECRET-mask-name',
          pathHint: 'SYNTHETIC-SECRET-mask-path',
          sourceTierLabel: 'SYNTHETIC-SECRET-mask-source',
          readFailedMessage: 'SYNTHETIC-SECRET-mask-error',
        });
        break;
      case 'masked-fail-list':
        this.setFixtureTextOverrides({
          displayName: 'SYNTHETIC-SECRET-mask-name',
          pathHint: 'SYNTHETIC-SECRET-mask-path',
          sourceTierLabel: 'SYNTHETIC-SECRET-mask-source',
          readFailedMessage: 'SYNTHETIC-SECRET-mask-error',
        });
        this.failNext('workbench', 'READ_FAILED');
        break;
      default:
        break;
    }
  }

  /** 全部 read 调用（按顺序）；mock 不存在 prepare/apply，故序列只可能含 read */
  getCallLog(): RecordedReadCall[] {
    return [...this.readCalls];
  }

  getObserveCallCount(): number {
    return this.observeCallCount;
  }

  /**
   * 启用 PF-01 perf-catalog scenario（additive，不改变 FX-01 语义）：
   * 后续 read 由确定性合成目录应答；遮蔽语义不变（rawSource 在 gateway
   * 边界内经 maskSyntheticSecrets 处理）。
   */
  enablePerfCatalog(profile: PerfProfile): void {
    this.perfCatalog = buildPerfCatalog(profile);
  }

  /**
   * PF-01 采样辅助：给定列表条件返回期望行数（perf 未启用时返回 null）。
   * 仅供性能探针断言“结果稳定为期望行数”，不属于 FrontendGateway 契约。
   */
  perfListCount(query: AssetListQuery): number | null {
    if (this.perfCatalog === null) {
      return null;
    }
    return this.perfCatalog.assets.filter((record) => matchesPerfListQuery(record, query)).length;
  }

  /** 当前默认单一分页窗口实际可见的行数（PF DOM 探针专用）。 */
  perfWorkbenchVisibleCount(query: WorkbenchQuery): number | null {
    if (this.perfCatalog === null) return null;
    const projection = projectWorkbenchProjection(
      this.buildPerfWorkbenchSnapshot(query),
      DEFAULT_LIST_PRESENTATION,
    );
    return projection.segments.reduce((total, segment) => total + segment.rows.length, 0);
  }

  perfLocatorCount(searchText: string): number | null {
    if (this.perfCatalog === null) return null;
    return this.buildPerfLocatorSnapshot(searchText).aggregateTotal;
  }

  // -------------------------------------------------------------------------
  // PF-01 perf-catalog 读取路径（只在 enablePerfCatalog 后可达）
  // -------------------------------------------------------------------------

  private readFromPerfCatalog(
    query: Query,
  ): ReadResult<
    | AssetListSnapshot
    | AssetDetailSnapshot
    | NativeFileSnapshot
    | WorkbenchActualReadSnapshot
    | GlobalLocatorSnapshot
  > {
    const catalog = this.perfCatalog;
    if (catalog === null) {
      return this.readFailed('READ_FAILED');
    }
    switch (query.kind) {
      case 'assetList': {
        const queriedAt = new Date().toISOString();
        const snapshot: AssetListSnapshot = {
          kind: 'assetList',
          assets: catalog.assets
            .filter((record) => matchesPerfListQuery(record, query))
            .map((record) => maskAssetSummary(record.summary)),
          indexStatus: this.indexStatus,
          scope: query.scope,
          queriedAt,
          indexUpdatedAt: this.indexStatus === 'stale' ? this.staleIndexUpdatedAt : queriedAt,
        };
        return this.readSucceeded(snapshot);
      }
      case 'workbench':
        return this.readSucceeded(this.buildPerfWorkbenchSnapshot(query));
      case 'globalLocator':
        return this.readSucceeded(this.buildPerfLocatorSnapshot(query.searchText));
      case 'projectApplicability':
        return this.readFailed('UNSUPPORTED_CAPABILITY');
      case 'assetDetail': {
        const record = catalog.assets.find(
          (candidate) => candidate.summary.asset.assetId === query.asset.assetId,
        );
        if (record === undefined) {
          return this.readFailed('READ_FAILED');
        }
        const snapshot: AssetDetailSnapshot = {
          kind: 'assetDetail',
          detail: maskAssetDetail(record.detail),
          inspector: maskInspectorData(record.inspector),
          revision: record.detail.revision,
        };
        return this.readSucceeded(snapshot);
      }
      case 'nativeFile': {
        const record = catalog.assets.find(
          (candidate) => candidate.summary.asset.assetId === query.asset.assetId,
        );
        if (record === undefined || record.detail.primaryFile.fileId !== query.fileId) {
          return this.readFailed('READ_FAILED');
        }
        const revision = record.detail.revision;
        const snapshot: NativeFileSnapshot = {
          kind: 'nativeFile',
          file: record.detail.primaryFile,
          revision,
          assetRevision: revision,
          content: {
            kind: 'source',
            maskedText: maskSyntheticSecrets(record.rawSource),
            sensitiveSegments: record.sensitiveSegments.map((segment) => ({
              ...segment,
              revision,
              displayState: 'masked',
            })),
          },
          structuredView: { kind: 'disabled', reasonCode: 'UNKNOWN_FIELD_PRESERVED' },
        };
        return this.readSucceeded(snapshot);
      }
    }
  }

  private buildPerfWorkbenchSnapshot(query: WorkbenchQuery): WorkbenchActualReadSnapshot {
    let filters;
    try {
      filters = canonicalizeWorkbenchFilters(query.filters, query.viewContext);
    } catch {
      throw new Error('PF-01 received invalid workbench filters');
    }
    const matches = (record: PerfCatalog['assets'][number]) => {
      const summary = record.summary;
      if (summary.asset.assetType !== query.assetType) return false;
      if (
        filters?.agents !== undefined &&
        !filters.agents.some((agent) => summary.agents.includes(agent))
      )
        return false;
      if (filters?.sourceIds !== undefined && !filters.sourceIds.includes(summary.sourceTier.id))
        return false;
      if (
        filters?.statuses !== undefined &&
        !filters.statuses.some((status) => record.statuses.includes(status))
      )
        return false;
      return true;
    };
    const rowsFor = (records: PerfCatalog['assets']) =>
      records.filter(matches).map((record, authoritativeInputOrder): ReadOnlyRow => ({
        assetRef: toReadOnlyAssetRef(record.summary.asset),
        assetId: record.summary.asset.assetId,
        displayName: record.summary.displayName,
        sortBaseName: record.summary.displayName.normalize('NFC'),
        authoritativeInputOrder,
        nativeOwnership: record.summary.asset.nativeOwnership,
        agents: record.summary.agents,
        sourceTierId: record.summary.sourceTier.id,
        statuses: record.statuses,
        skillTargetStates:
          query.assetType === 'skill'
            ? AGENT_ORDER.map((agent) => ({
                agent,
                presence: record.summary.agents.includes(agent) ? 'present' : 'absent',
                activation: record.summary.agents.includes(agent) ? 'enabled' : 'notApplicable',
                applicability: 'resolved',
                enableAvailability: record.summary.agents.includes(agent)
                  ? { kind: 'disabled' as const, reasonCode: 'READ_ONLY_POLICY' }
                  : { kind: 'allowed' as const },
                disableAvailability: record.summary.agents.includes(agent)
                  ? { kind: 'allowed' as const }
                  : { kind: 'disabled' as const, reasonCode: 'UNSUPPORTED_CAPABILITY' },
              }))
            : [],
      }));
    const catalog = this.perfCatalog;
    if (catalog === null) throw new Error('PF-01 catalog unavailable');
    const projectRecords = new Map<string, PerfCatalog['assets']>();
    for (const record of catalog.assets) {
      if (record.summary.asset.nativeOwnership.kind !== 'project') continue;
      const records = projectRecords.get(record.summary.asset.nativeOwnership.projectId) ?? [];
      records.push(record);
      projectRecords.set(record.summary.asset.nativeOwnership.projectId, records);
    }
    const global = rowsFor(
      catalog.assets.filter((record) => record.summary.asset.nativeOwnership.kind === 'global'),
    );
    const projectSegments = [...projectRecords.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
      .map(([projectId, records]) => ({
        id: `segment-pf01-project-${projectId}`,
        source: 'projectNative' as const,
        displayLabel: projectId,
        projectId,
        rows: rowsFor(records).filter(() =>
          query.viewContext.kind !== 'all' || filters?.projectIds === undefined
            ? true
            : filters.projectIds.includes(projectId),
        ),
      }))
      .filter((segment) => segment.rows.length > 0);
    const globalSegment = {
      id: 'segment-pf01-global-applicable',
      source: 'globalApplicable' as const,
      displayLabel: 'Global',
      rows: global,
    };
    const selectedProjectId =
      query.viewContext.kind === 'project' ? query.viewContext.projectId : null;
    const segments =
      query.viewContext.kind === 'global'
        ? global.length === 0
          ? []
          : [globalSegment]
        : query.viewContext.kind === 'project'
          ? projectSegments.filter((segment) => segment.projectId === selectedProjectId)
          : [...(global.length === 0 ? [] : [globalSegment]), ...projectSegments];
    const aggregateTotal = segments.reduce((total, segment) => total + segment.rows.length, 0);
    return {
      kind: 'workbench',
      query: { ...query, ...(filters === undefined ? {} : { filters }) },
      authoritativeReadRevision: `rev-pf01-${catalog.profile}`,
      segments,
      effectiveContexts: [],
      findings: [],
      aggregateTotal,
      indexStatus: this.indexStatus,
      readAt: new Date().toISOString(),
    };
  }

  private buildPerfLocatorSnapshot(searchText: string): GlobalLocatorSnapshot {
    const catalog = this.perfCatalog;
    if (catalog === null) throw new Error('PF-01 catalog unavailable');
    const needle = mockCanonicalLocatorFact(searchText);
    const groups = MVP_ASSET_TYPES.map((assetType) => {
      const results =
        needle === ''
          ? []
          : catalog.assets
              .filter((record) => record.summary.asset.assetType === assetType)
              .filter((record) =>
                mockCanonicalLocatorFact(record.summary.displayName).includes(needle),
              )
              .map((record, authoritativeInputOrder) => ({
                assetRef: toReadOnlyAssetRef(record.summary.asset),
                assetId: record.summary.asset.assetId,
                displayName: record.summary.displayName,
                sortBaseName: record.summary.displayName.normalize('NFC'),
                authoritativeInputOrder,
                nativeOwnership: record.summary.asset.nativeOwnership,
                agents: record.summary.agents,
                sourceTierId: record.summary.sourceTier.id,
                redactedSummary: '结构化只读资产摘要',
                ownershipHint:
                  record.summary.asset.nativeOwnership.kind === 'global'
                    ? 'global'
                    : record.summary.asset.nativeOwnership.projectId,
                statuses: record.statuses,
                skillTargetStates: [],
                destinationViewContext:
                  record.summary.asset.nativeOwnership.kind === 'global'
                    ? ({ kind: 'global' } as ViewContext)
                    : ({
                        kind: 'project',
                        projectId: record.summary.asset.nativeOwnership.projectId,
                      } as ViewContext),
                destination: {
                  kind: 'skillDetail' as const,
                  assetRef: toReadOnlyAssetRef(record.summary.asset),
                },
                matchedField: 'displayName' as const,
              }));
      return { assetType, count: results.length, results };
    });
    return {
      kind: 'globalLocator',
      groups,
      aggregateTotal: groups.reduce((total, group) => total + group.count, 0),
      readAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // 内部构造
  // -------------------------------------------------------------------------

  private waitIfPaused(): Promise<void> {
    if (!this.paused) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.pauseQueue.push(resolve);
    });
  }

  private currentRevision(): string {
    return this.externalChangeCount === 0
      ? fixture.revision
      : `${fixture.revision}+external-${this.externalChangeCount}`;
  }

  private assetRef(): AssetRef {
    return {
      assetId: fixture.asset.assetId,
      assetType: 'skill',
      nativeUnitRef: fixture.asset.nativeUnitRef,
      adapterIdentity: fixture.asset.adapterIdentity,
      nativeOwnership: { kind: 'global' },
    };
  }

  private primaryFileRef(): NativeFileRef {
    return {
      fileId: fixture.primaryFile.fileId,
      name: fixture.primaryFile.name,
      relativePath: fixture.primaryFile.relativePath,
      fileKind: 'text',
      isPrimary: true,
      canPreview: { kind: 'allowed' },
      canEdit: { kind: 'allowed' },
      hasDraftChanges: false,
    };
  }

  private assetSummary(): AssetSummary {
    // 先按 fixture/override 构造原始值，再在出口统一遮蔽（maskAssetSummary）
    return maskAssetSummary({
      asset: this.assetRef(),
      displayName: this.textOverrides.displayName ?? fixture.displayName,
      anomalies: this.textOverrides.anomalies ?? [],
      agents: ['claude-code'],
      scope: 'global',
      contextHint: {
        kind: 'path',
        pathHint: this.textOverrides.pathHint ?? fixture.contextHint.pathHint,
      },
      sourceTier: { id: fixture.sourceTier.id, label: fixture.sourceTier.label },
      availability: { kind: 'allowed' },
    });
  }

  private summaryOwnershipHint(): string {
    const hint = this.assetSummary().contextHint;
    return hint.kind === 'path' ? hint.pathHint : hint.projectName;
  }

  /** FE-01 B2 workbench 的同次权威只读 projection。 */
  private readWorkbench(query: WorkbenchQuery): ReadResult<WorkbenchActualReadSnapshot> {
    let filters;
    try {
      filters = canonicalizeWorkbenchFilters(query.filters, query.viewContext);
    } catch {
      return this.readFailed('READ_FAILED');
    }
    const queriedAt = new Date().toISOString();
    const row: ReadOnlyRow = {
      assetRef: toReadOnlyAssetRef(this.assetRef()),
      assetId: this.assetRef().assetId,
      displayName: this.assetSummary().displayName,
      sortBaseName: this.assetSummary().displayName.normalize('NFC'),
      authoritativeInputOrder: 0,
      nativeOwnership: { kind: 'global' },
      agents: ['claude-code'],
      sourceTierId: fixture.sourceTier.id,
      sourceTierLabel: this.assetSummary().sourceTier.label,
      redactedSummary: '结构化只读 Skill 摘要',
      ownershipHint: this.summaryOwnershipHint(),
      statuses: this.derivedStatuses(),
      skillTargetStates: this.skillTargetStates(),
    };
    const matches =
      query.assetType === 'skill' &&
      (filters?.agents === undefined || filters.agents.includes('claude-code')) &&
      (filters?.sourceIds === undefined || filters.sourceIds.includes(fixture.sourceTier.id)) &&
      (filters?.statuses === undefined ||
        filters.statuses.some((status) => this.derivedStatuses().includes(status)));
    const globalRows = matches ? [row] : [];
    const projectIds =
      this.projectProjection === 'multiple'
        ? ['project-fx01-opaque', 'project-fx01-second-opaque']
        : this.projectProjection === 'single'
          ? ['project-fx01-opaque']
          : [];
    const projectRows =
      query.assetType === 'skill'
        ? projectIds
            .filter(
              (projectId) =>
                filters?.projectIds === undefined || filters.projectIds.includes(projectId),
            )
            .map((projectId, authoritativeInputOrder): ReadOnlyRow => ({
              assetRef: {
                assetId: `asset-fx01-project-native-${projectId}`,
                assetType: 'skill',
                nativeUnitRef: `nunit-fx01-project-native-${projectId}`,
                adapterIdentity: fixture.asset.adapterIdentity,
                nativeOwnership: { kind: 'project', projectId },
              },
              assetId: `asset-fx01-project-native-${projectId}`,
              displayName: `Project Native Skill ${projectId}`,
              sortBaseName: `Project Native Skill ${projectId}`,
              authoritativeInputOrder,
              nativeOwnership: { kind: 'project', projectId },
              agents: ['codex'],
              sourceTierId: 'project-fx01-root',
              sourceTierLabel: 'Project root (synthetic)',
              redactedSummary: '结构化只读项目 Skill 摘要',
              ownershipHint: projectId,
              statuses: ['readOnly', 'normal'],
              skillTargetStates: AGENT_ORDER.map((agent) => ({
                agent,
                presence: agent === 'codex' ? 'present' : 'absent',
                activation: agent === 'codex' ? 'enabled' : 'notApplicable',
                applicability: 'resolved',
                enableAvailability:
                  agent === 'codex'
                    ? { kind: 'disabled' as const, reasonCode: 'READ_ONLY_POLICY' }
                    : { kind: 'allowed' as const },
                disableAvailability:
                  agent === 'codex'
                    ? { kind: 'allowed' as const }
                    : { kind: 'disabled' as const, reasonCode: 'UNSUPPORTED_CAPABILITY' },
              })),
            }))
        : [];
    const selectedProjectId =
      query.viewContext.kind === 'project' ? query.viewContext.projectId : undefined;
    const projectRowsForView = projectRows.filter((row) => {
      const ownership = row.assetRef.nativeOwnership;
      return (
        selectedProjectId === undefined ||
        (ownership.kind === 'project' && ownership.projectId === selectedProjectId)
      );
    });
    const globalAllowedInProject =
      query.viewContext.kind !== 'project' || projectIds.includes(query.viewContext.projectId);
    const globalSegment = {
      id: 'segment-fx01-global-applicable',
      source: 'globalApplicable' as const,
      displayLabel: 'Global',
      rows: globalRows,
    };
    const projectSegments = projectRowsForView.flatMap((row) => {
      const ownership = row.assetRef.nativeOwnership;
      if (ownership.kind !== 'project') return [];
      return [
        {
          id: `segment-fx01-project-native-${ownership.projectId}`,
          source: 'projectNative' as const,
          displayLabel: ownership.projectId,
          projectId: ownership.projectId,
          rows: [row],
        },
      ];
    });
    const segments =
      query.viewContext.kind === 'global'
        ? globalRows.length === 0
          ? []
          : [globalSegment]
        : query.viewContext.kind === 'project'
          ? [
              ...projectSegments,
              ...(globalRows.length === 0 || !globalAllowedInProject ? [] : [globalSegment]),
            ]
          : [...(globalRows.length === 0 ? [] : [globalSegment]), ...projectSegments];
    const snapshot: WorkbenchActualReadSnapshot = {
      kind: 'workbench',
      query: { ...query, ...(filters === undefined ? {} : { filters }) },
      authoritativeReadRevision: this.currentRevision(),
      segments,
      effectiveContexts: projectIds.map((projectId) => ({
        asset: row.assetRef,
        assetId: row.assetId,
        projectId,
        projectDisplayName: projectId,
        resolution: 'resolved' as const,
      })),
      findings: [],
      aggregateTotal: segments.reduce((total, segment) => total + segment.rows.length, 0),
      indexStatus: this.indexStatus,
      readAt: queriedAt,
    };
    return this.readSucceeded(snapshot);
  }

  /** global locator 只使用 redacted row facts；没有写入 side effect。 */
  private buildGlobalLocatorSnapshot(searchText: string): GlobalLocatorSnapshot {
    const skillRow: ReadOnlyRow = {
      assetRef: toReadOnlyAssetRef(this.assetRef()),
      assetId: this.assetRef().assetId,
      displayName: this.assetSummary().displayName,
      sortBaseName: this.assetSummary().displayName.normalize('NFC'),
      authoritativeInputOrder: 0,
      nativeOwnership: { kind: 'global' },
      agents: ['claude-code'],
      sourceTierId: fixture.sourceTier.id,
      sourceTierLabel: this.assetSummary().sourceTier.label,
      redactedSummary: '结构化只读 Skill 摘要',
      ownershipHint: this.summaryOwnershipHint(),
      statuses: this.derivedStatuses(),
      skillTargetStates: this.skillTargetStates(),
    };
    const projectLocatorRow: ReadOnlyRow = {
      assetRef: {
        assetId: 'asset-fx01-project-native-project-fx01-opaque',
        assetType: 'skill',
        nativeUnitRef: 'nunit-fx01-project-native-project-fx01-opaque',
        adapterIdentity: this.assetRef().adapterIdentity,
        nativeOwnership: { kind: 'project', projectId: 'project-fx01-opaque' },
      },
      assetId: 'asset-fx01-project-native-project-fx01-opaque',
      displayName: 'Project Native Skill',
      sortBaseName: 'Project Native Skill',
      authoritativeInputOrder: 0,
      nativeOwnership: { kind: 'project', projectId: 'project-fx01-opaque' },
      agents: ['codex'],
      sourceTierId: 'project-fx01-root',
      sourceTierLabel: 'Project root (synthetic)',
      redactedSummary: '结构化只读项目 Skill 摘要',
      ownershipHint: 'Fixture project（只读）',
      statuses: ['readOnly', 'normal'],
      skillTargetStates: this.skillTargetStates(),
    };
    const row: ReadOnlyRow = this.unsupportedLocator
      ? {
          assetRef: {
            assetId: 'instruction-fx01-read-only',
            assetType: 'longTermInstruction',
            nativeUnitRef: 'nunit-instruction-fx01-read-only',
            adapterIdentity: this.assetRef().adapterIdentity,
            nativeOwnership: { kind: 'global' },
          },
          assetId: 'instruction-fx01-read-only',
          displayName: 'Read-only Instruction',
          sortBaseName: 'Read-only Instruction',
          authoritativeInputOrder: 0,
          nativeOwnership: { kind: 'global' },
          agents: ['codex'],
          redactedSummary: '结构化只读长期指令摘要',
          ownershipHint: 'global',
          statuses: ['readOnly', 'normal'],
        }
      : this.projectProjection === 'none'
        ? skillRow
        : projectLocatorRow;
    const matchedField = mockLocatorMatchedField(searchText, row);
    const { redactedSummary, ownershipHint } = row;
    if (redactedSummary === undefined || ownershipHint === undefined) {
      throw new Error('locator requires redacted display facts');
    }
    const groups = MVP_ASSET_TYPES.map((assetType) => ({
      assetType,
      count: assetType === row.assetRef.assetType && matchedField !== null ? 1 : 0,
      results:
        assetType === row.assetRef.assetType && matchedField !== null
          ? [
              {
                ...row,
                redactedSummary,
                ownershipHint,
                destinationViewContext:
                  row.assetRef.nativeOwnership.kind === 'global'
                    ? ({ kind: 'global' } as ViewContext)
                    : ({
                        kind: 'project',
                        projectId: row.assetRef.nativeOwnership.projectId,
                      } as ViewContext),
                destination:
                  row.assetRef.assetType === 'skill'
                    ? { kind: 'skillDetail' as const, assetRef: row.assetRef }
                    : {
                        kind: 'unsupportedReadOnly' as const,
                        assetRef: row.assetRef,
                        reasonCode: 'UNSUPPORTED_CAPABILITY',
                      },
                matchedField,
              },
            ]
          : [],
    }));
    return {
      kind: 'globalLocator',
      groups,
      aggregateTotal: matchedField === null ? 0 : 1,
      readAt: new Date().toISOString(),
    };
  }

  private skillTargetStates(): SkillTargetState[] {
    const failure = this.indexStatus === 'stale' ? 'stale' : this.skillCellFailure;
    return AGENT_ORDER.map((agent) =>
      failure !== null
        ? {
            agent,
            presence: failure,
            activation: failure,
            applicability: failure,
            enableAvailability: {
              kind: 'disabled',
              reasonCode:
                failure === 'stale'
                  ? 'INDEX_STALE'
                  : failure === 'blocked'
                    ? 'READ_ONLY_POLICY'
                    : 'UNKNOWN_FIELD_PRESERVED',
            },
            disableAvailability: {
              kind: 'disabled',
              reasonCode:
                failure === 'stale'
                  ? 'INDEX_STALE'
                  : failure === 'blocked'
                    ? 'READ_ONLY_POLICY'
                    : 'UNKNOWN_FIELD_PRESERVED',
            },
            stableReason:
              failure === 'stale'
                ? 'INDEX_STALE'
                : failure === 'blocked'
                  ? 'READ_ONLY_POLICY'
                  : 'UNKNOWN_FIELD_PRESERVED',
          }
        : agent === 'claude-code'
          ? {
              agent,
              presence: 'present',
              activation: 'enabled',
              applicability: 'resolved',
              enableAvailability: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
              disableAvailability: { kind: 'allowed' },
            }
          : {
              agent,
              presence: 'absent',
              activation: 'notApplicable',
              applicability: 'resolved',
              enableAvailability: { kind: 'allowed' },
              disableAvailability: { kind: 'disabled', reasonCode: 'UNSUPPORTED_CAPABILITY' },
            },
    );
  }

  private derivedStatuses(): AssetStatusFilter[] {
    // FX-01：verifiedWritable + availability allowed → 可编辑且正常
    return ['editable', 'normal'];
  }

  private matchesListQuery(query: AssetListQuery): boolean {
    if (query.scope.kind === 'currentAssetType' && query.scope.assetType !== 'skill') {
      return false;
    }
    const displayName = this.textOverrides.displayName ?? fixture.displayName;
    const searchText = query.searchText?.trim().toLowerCase();
    if (searchText && !displayName.toLowerCase().includes(searchText)) {
      return false;
    }
    const filters = query.filters;
    if (filters?.agents && filters.agents.length > 0) {
      if (!filters.agents.some((agent) => fixture.agents.includes(agent))) {
        return false;
      }
    }
    if (filters?.projects && filters.projects.length > 0) {
      // FX-01 资产无项目上下文（contextHint 为 path），任何项目筛选都不匹配
      return false;
    }
    if (filters?.scopes && filters.scopes.length > 0) {
      if (!filters.scopes.includes('global')) {
        return false;
      }
    }
    if (filters?.sources && filters.sources.length > 0) {
      if (!filters.sources.includes(fixture.sourceTier.id)) {
        return false;
      }
    }
    if (filters?.statuses && filters.statuses.length > 0) {
      const statuses = this.derivedStatuses();
      if (!filters.statuses.some((status) => statuses.includes(status))) {
        return false;
      }
    }
    return true;
  }

  private buildAssetListSnapshot(query: AssetListQuery): AssetListSnapshot {
    const queriedAt = new Date().toISOString();
    return {
      kind: 'assetList',
      assets: this.matchesListQuery(query) ? [this.assetSummary()] : [],
      indexStatus: this.indexStatus,
      scope: query.scope,
      queriedAt,
      indexUpdatedAt: this.indexStatus === 'stale' ? this.staleIndexUpdatedAt : queriedAt,
    };
  }

  private buildAssetDetail(): AssetDetail {
    return maskAssetDetail({
      asset: this.assetRef(),
      displayName: this.textOverrides.displayName ?? fixture.displayName,
      nativeUnitKind: 'singleFile',
      revision: this.currentRevision(),
      compatibility: 'verifiedWritable',
      capabilities: {
        edit: { kind: 'allowed' },
        convert: { kind: 'allowed' },
        export: { kind: 'allowed' },
        delete: { kind: 'allowed' },
      },
      effectiveContexts: fixture.effectiveContexts.map((context) => ({
        agent: 'claude-code',
        scope: 'global',
        sourceTierLabel: this.textOverrides.sourceTierLabel ?? context.sourceTierLabel,
        precedence: context.precedence,
      })),
      primaryFile: this.primaryFileRef(),
    });
  }

  private buildInspector(): InspectorData {
    return maskInspectorData({
      agents: ['claude-code'],
      scope: 'global',
      effectiveContexts: fixture.effectiveContexts.map((context) => ({
        agent: 'claude-code',
        scope: 'global',
        sourceTierLabel: this.textOverrides.sourceTierLabel ?? context.sourceTierLabel,
        precedence: context.precedence,
      })),
      sourceAnchor: { kind: 'userHome' },
      pathDisplay: this.textOverrides.pathDisplay ?? fixture.pathDisplay,
      compatibility: 'verifiedWritable',
      overrides: [],
    });
  }

  private buildAssetDetailSnapshot(): AssetDetailSnapshot {
    return {
      kind: 'assetDetail',
      detail: this.buildAssetDetail(),
      inspector: this.buildInspector(),
      revision: this.currentRevision(),
    };
  }

  private buildNativeFileSnapshot(): NativeFileSnapshot {
    const revision = this.currentRevision();
    const sensitiveSegments: SensitiveSegmentRef[] = fixture.sensitiveSegments.map((segment) => ({
      segmentId: segment.segmentId,
      fileId: segment.fileId,
      revision,
      displayState: 'masked',
    }));
    return {
      kind: 'nativeFile',
      file: this.primaryFileRef(),
      revision,
      assetRevision: revision,
      content: {
        kind: 'source',
        maskedText: maskSyntheticSecrets(skillMdRaw),
        sensitiveSegments,
      },
      structuredView: { kind: 'disabled', reasonCode: 'UNKNOWN_FIELD_PRESERVED' },
    };
  }

  private readSucceeded<T>(snapshot: T): ReadResult<T> {
    return { kind: 'readSucceeded', snapshot };
  }

  private readFailed<T>(reasonCode: ReasonCode): ReadResult<T> {
    return {
      kind: 'readFailed',
      reasonCode,
      message: maskSyntheticSecrets(
        this.textOverrides.readFailedMessage ?? '读取未能完成（合成 mock 脚本化失败）。',
      ),
      recoveryAction: { kind: 'retryRead' },
    };
  }
}
