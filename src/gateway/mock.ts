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
import fx12Fixture from '../../fixtures/fx-12/fixture.json';
import skillMdRaw from '../../fixtures/fx-01/native-root/skills/demo-skill/SKILL.md?raw';
import fx02InstructionRaw from '../../fixtures/fx-02/native-root/long-term-instructions/release-notes.md?raw';
import fx02SkillRaw from '../../fixtures/fx-02/native-root/skills/multifile-skill-mixed/SKILL.md?raw';
import fx02UsageRaw from '../../fixtures/fx-02/native-root/skills/multifile-skill-mixed/references/usage.md?raw';
import fx02SubagentRaw from '../../fixtures/fx-02/native-root/subagents/researcher/SUBAGENT.md?raw';
import { maskSyntheticSecrets } from '../../fixtures/sensitive-masking';
import {
  buildPerfCatalog,
  matchesPerfListQuery,
  type PerfCatalog,
  type PerfProfile,
} from './perf-catalog';
import {
  buildPf02SourceLargeFixture,
  buildPf03MultifileFixture,
  pfReadFixtureDigest,
  type PfReadFixtureBundle,
  type PfReadProfile,
} from './pf-read-fixtures';
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
  MaskedSourcePart,
  NativeFileRef,
  NativeFileSnapshot,
  Query,
  ReadResult,
  ReasonCode,
  SensitiveRevealSnapshot,
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

type SyntheticReadRecord = {
  summary: AssetSummary;
  detail: AssetDetail;
  inspector: InspectorData;
  files: Array<{
    file: NativeFileRef;
    source?: string;
    maskedParts?: MaskedSourcePart[];
    sensitiveSegments?: SensitiveSegmentRef[];
  }>;
};

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

/** FE-02 L2 fixture：仅暴露已遮蔽的片段关联，不携带原始值或位置。 */
function fx02MaskedSegments(
  assetType: AssetRef['assetType'],
  file: NativeFileRef,
  revision: string,
  source: string | undefined,
): SensitiveSegmentRef[] {
  if (
    (assetType !== 'longTermInstruction' && assetType !== 'subagent') ||
    !source?.includes('SYNTHETIC-SECRET')
  ) {
    return [];
  }
  return [
    {
      segmentId: `seg-${file.fileId}-masked`,
      fileId: file.fileId,
      revision,
      displayState: 'masked',
    },
  ];
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
  /** FX-02 只读 UI journey 的隔离三类型 fixture；不含 Hook。 */
  private fe02ReadSurfaces = false;
  /** FE-03 frontend-local draft L2 的隔离安全三类型 fixture。 */
  private fe03Drafts = false;
  /** FX-12 的只读 sensitive-view 场景；与 FE-03 modify fixture 保持独立。 */
  private fx12SensitiveView = false;
  /** PF-01 perf-catalog scenario 的合成目录；null 时保持 FX-01 单资产语义 */
  private perfCatalog: PerfCatalog | null = null;
  /** PF-02/PF-03 安全 bundle；只读采样 scenario，不读取真实文件系统。 */
  private perfReadSurface: PfReadFixtureBundle | null = null;
  private perfReadFixtureDigest: string | null = null;

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
    if (this.perfReadSurface !== null) {
      return this.readFromPerfReadSurface(query) as ReadResult<SnapshotFor<Q>>;
    }
    if (this.fx12SensitiveView) {
      return this.readFromFx12SensitiveView(query) as ReadResult<SnapshotFor<Q>>;
    }
    if (this.fe03Drafts) {
      return this.readFromFe03Drafts(query) as ReadResult<SnapshotFor<Q>>;
    }
    if (this.fe02ReadSurfaces) {
      return this.readFromFx02(query) as ReadResult<SnapshotFor<Q>>;
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
      case 'sensitiveReveal':
        // Mock 只可表现为 grant 不可用，绝不制造授权或明文。
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
      case 'fx02-read-surfaces':
        this.fe02ReadSurfaces = true;
        break;
      case 'fe03-drafts':
        this.fe03Drafts = true;
        break;
      case 'fe03-drafts-stale':
        this.fe03Drafts = true;
        this.setIndexStatus('stale');
        break;
      case 'fx12-sensitive-view':
        this.fx12SensitiveView = true;
        break;
      case 'fx12-sensitive-view-failed':
        this.fx12SensitiveView = true;
        this.failNext('sensitiveReveal', 'READ_FAILED');
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
   * 启用 PF-02/PF-03 L2 read-surface scenario。bundle 来自冻结的安全 builder；
   * mock 只返还其 public masked snapshot，绝不持有或读取用户文件内容。
   */
  enablePerfReadSurface(pfId: 'PF-02' | 'PF-03', profile: PfReadProfile): void {
    this.perfReadSurface =
      pfId === 'PF-02' ? buildPf02SourceLargeFixture(profile) : buildPf03MultifileFixture(profile);
    this.perfReadFixtureDigest = pfReadFixtureDigest(this.perfReadSurface);
  }

  /** 采样页仅可查询 public-safe bundle 元数据；不暴露原始内容或文件系统路径。 */
  perfReadSurfaceMetadata(): {
    descriptorId: 'PF-02' | 'PF-03';
    profile: PfReadProfile;
    fixtureDigest: string;
    shape: Record<string, number | string>;
    files: NativeFileRef[];
  } | null {
    const bundle = this.perfReadSurface;
    return bundle === null || this.perfReadFixtureDigest === null
      ? null
      : {
          descriptorId: bundle.descriptorId,
          profile: bundle.profile,
          fixtureDigest: this.perfReadFixtureDigest,
          shape: bundle.shape,
          files: bundle.files.map((snapshot) => snapshot.file),
        };
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
      case 'sensitiveReveal':
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

  // -------------------------------------------------------------------------
  // PF-02/PF-03 read-surface 读取路径（只在 enablePerfReadSurface 后可达）
  // -------------------------------------------------------------------------

  private readFromPerfReadSurface(
    query: Query,
  ): ReadResult<AssetDetailSnapshot | NativeFileSnapshot | WorkbenchActualReadSnapshot> {
    const bundle = this.perfReadSurface;
    if (bundle === null) return this.readFailed('READ_FAILED');
    const asset = bundle.detail.detail.asset;
    switch (query.kind) {
      case 'workbench':
        return query.assetType === 'skill'
          ? this.readSucceeded({ ...bundle.workbench, query })
          : this.readFailed('READ_FAILED');
      case 'assetDetail':
        return query.asset.assetId === asset.assetId
          ? this.readSucceeded(bundle.detail)
          : this.readFailed('READ_FAILED');
      case 'nativeFile': {
        if (query.asset.assetId !== asset.assetId) return this.readFailed('READ_FAILED');
        const snapshot = bundle.files.find((candidate) => candidate.file.fileId === query.fileId);
        return snapshot === undefined
          ? this.readFailed('READ_FAILED')
          : this.readSucceeded(snapshot);
      }
      case 'assetList':
      case 'globalLocator':
      case 'projectApplicability':
      case 'sensitiveReveal':
        return this.readFailed('UNSUPPORTED_CAPABILITY');
    }
  }

  // -------------------------------------------------------------------------
  // FE-02 FX-02 浏览器 mock：仅合成 readonly snapshot，不读/执行用户内容。
  // -------------------------------------------------------------------------

  private fe03DraftRecords(): SyntheticReadRecord[] {
    const allowed = { kind: 'allowed' as const };
    const disabled = { kind: 'disabled' as const, reasonCode: 'UNSUPPORTED_CAPABILITY' as const };
    const file = (
      fileId: string,
      name: string,
      relativePath: string,
      isPrimary: boolean,
    ): NativeFileRef => ({
      fileId,
      name,
      relativePath,
      fileKind: 'text',
      isPrimary,
      canPreview: allowed,
      canEdit: allowed,
      hasDraftChanges: false,
    });
    const summary = (
      assetId: string,
      assetType: AssetSummary['asset']['assetType'],
      nativeUnitRef: string,
      displayName: string,
      agents: AssetSummary['agents'],
    ): AssetSummary => ({
      asset: {
        assetId,
        assetType,
        nativeUnitRef,
        adapterIdentity: 'fe03-synthetic@local',
        nativeOwnership: { kind: 'global' },
      },
      displayName,
      anomalies: [],
      agents,
      scope: 'global',
      contextHint: { kind: 'path', pathHint: 'FE-03 synthetic fixture' },
      sourceTier: { id: 'source-fe03-drafts', label: 'FE-03 synthetic fixture' },
      availability: allowed,
    });
    const inspector = (agents: AssetSummary['agents']): InspectorData => ({
      agents,
      scope: 'global',
      effectiveContexts: agents.map((agent) => ({
        agent,
        scope: 'global',
        sourceTierLabel: 'FE-03 synthetic fixture',
        precedence: 0,
      })),
      sourceAnchor: { kind: 'globalRoot', label: 'FE-03 synthetic fixture' },
      pathDisplay: 'FE-03 synthetic fixture',
      compatibility: 'verifiedWritable',
      overrides: [],
    });
    const skillPrimary = file('file-fe03-skill-primary', 'SKILL.md', 'SKILL.md', true);
    const skillSecondary = file(
      'file-fe03-skill-secondary',
      'usage.md',
      'references/usage.md',
      false,
    );
    const instructionFile = file('file-fe03-instruction', 'instruction.md', 'instruction.md', true);
    const maskedInstructionFile = file(
      'file-fe03-masked-instruction',
      'masked-instruction.md',
      'masked-instruction.md',
      true,
    );
    const subagentFile = file('file-fe03-subagent', 'SUBAGENT.md', 'SUBAGENT.md', true);
    const skill = summary('asset-fe03-skill', 'skill', 'nunit-fe03-skill', 'FE-03 Skill', [
      'codex',
    ]);
    const instruction = summary(
      'asset-fe03-instruction',
      'longTermInstruction',
      'nunit-fe03-instruction',
      'FE-03 Instruction',
      ['codex'],
    );
    const maskedInstruction = summary(
      'asset-fe03-masked-instruction',
      'longTermInstruction',
      'nunit-fe03-masked-instruction',
      'Masked local instruction',
      ['codex'],
    );
    const subagent = summary(
      'asset-fe03-subagent',
      'subagent',
      'nunit-fe03-subagent',
      'FE-03 Subagent',
      ['codex'],
    );
    const contexts = (agents: AssetSummary['agents']): EffectiveContext[] =>
      agents.map((agent) => ({
        agent,
        scope: 'global',
        sourceTierLabel: 'FE-03 synthetic fixture',
        precedence: 0,
      }));
    return [
      {
        summary: skill,
        detail: {
          asset: skill.asset,
          displayName: skill.displayName,
          nativeUnitKind: 'multiFileDirectory',
          revision: 'rev-fe03-skill',
          compatibility: 'verifiedWritable',
          capabilities: { edit: allowed, convert: disabled, export: disabled, delete: disabled },
          effectiveContexts: contexts(skill.agents),
          primaryFile: skillPrimary,
          fileTreeRoot: {
            name: 'fe03-skill',
            children: [
              { name: 'SKILL.md', file: skillPrimary },
              { name: 'references', children: [{ name: 'usage.md', file: skillSecondary }] },
            ],
          },
          readSurface: {
            kind: 'skill',
            agentTargetStates: this.skillTargetStates(),
            sourceReadAvailability: allowed,
          },
        },
        inspector: inspector(skill.agents),
        files: [
          { file: skillPrimary, source: '# FE-03 Skill\n\nPrimary safe instruction.\n' },
          { file: skillSecondary, source: '# Reference\n\nSecondary safe instruction.\n' },
        ],
      },
      {
        summary: instruction,
        detail: {
          asset: instruction.asset,
          displayName: instruction.displayName,
          nativeUnitKind: 'singleFile',
          revision: 'rev-fe03-instruction',
          compatibility: 'verifiedWritable',
          capabilities: { edit: allowed, convert: disabled, export: disabled, delete: disabled },
          effectiveContexts: contexts(instruction.agents),
          primaryFile: instructionFile,
          readSurface: { kind: 'longTermInstruction', markdownFile: instructionFile },
        },
        inspector: inspector(instruction.agents),
        files: [
          {
            file: instructionFile,
            source: '# FE-03 Instruction\n\nKeep this synthetic Markdown local.\n',
          },
        ],
      },
      {
        summary: maskedInstruction,
        detail: {
          asset: maskedInstruction.asset,
          displayName: maskedInstruction.displayName,
          nativeUnitKind: 'singleFile',
          revision: 'rev-fe03-masked-instruction',
          compatibility: 'verifiedWritable',
          capabilities: { edit: allowed, convert: disabled, export: disabled, delete: disabled },
          effectiveContexts: contexts(maskedInstruction.agents),
          primaryFile: maskedInstructionFile,
          readSurface: { kind: 'longTermInstruction', markdownFile: maskedInstructionFile },
        },
        inspector: inspector(maskedInstruction.agents),
        files: [
          {
            file: maskedInstructionFile,
            source: '# Masked local instruction\n\nSetting: ••••••••\nFallback: ••••••••\n',
            maskedParts: [
              { kind: 'text', text: '# Masked local instruction\n\nSetting: ' },
              { kind: 'sensitivePlaceholder', segmentId: 'seg-fe03-masked-instruction' },
              { kind: 'text', text: '\nFallback: ' },
              {
                kind: 'sensitivePlaceholder',
                segmentId: 'seg-fe03-masked-instruction-secondary',
              },
              { kind: 'text', text: '\n' },
            ],
            sensitiveSegments: [
              {
                segmentId: 'seg-fe03-masked-instruction',
                fileId: maskedInstructionFile.fileId,
                revision: 'rev-fe03-masked-instruction',
                displayState: 'masked',
              },
              {
                segmentId: 'seg-fe03-masked-instruction-secondary',
                fileId: maskedInstructionFile.fileId,
                revision: 'rev-fe03-masked-instruction',
                displayState: 'masked',
              },
            ],
          },
        ],
      },
      {
        summary: subagent,
        detail: {
          asset: subagent.asset,
          displayName: subagent.displayName,
          nativeUnitKind: 'configBlock',
          revision: 'rev-fe03-subagent',
          compatibility: 'verifiedWritable',
          capabilities: { edit: allowed, convert: disabled, export: disabled, delete: disabled },
          effectiveContexts: contexts(subagent.agents),
          primaryFile: subagentFile,
          readSurface: {
            kind: 'subagent',
            model: 'fe03-safe-model',
            tools: ['read'],
            permissions: ['local'],
            bodyFile: subagentFile,
          },
        },
        inspector: inspector(subagent.agents),
        files: [
          {
            file: subagentFile,
            source: 'model: fe03-safe-model\nunknown-extension: preserve\n',
          },
        ],
      },
    ];
  }

  private readFromFe03Drafts(
    query: Query,
  ): ReadResult<
    AssetDetailSnapshot | NativeFileSnapshot | SensitiveRevealSnapshot | WorkbenchActualReadSnapshot
  > {
    const records = this.fe03DraftRecords();
    switch (query.kind) {
      case 'workbench': {
        let filters;
        try {
          filters = canonicalizeWorkbenchFilters(query.filters, query.viewContext);
        } catch {
          return this.readFailed('READ_FAILED');
        }
        const rows = records
          .filter((record) => record.summary.asset.assetType === query.assetType)
          .filter(
            (record) =>
              filters?.agents === undefined ||
              filters.agents.some((agent) => record.summary.agents.includes(agent)),
          )
          .filter(
            (record) =>
              filters?.sourceIds === undefined ||
              filters.sourceIds.includes(record.summary.sourceTier.id),
          )
          .filter(
            () =>
              filters?.statuses === undefined ||
              filters.statuses.some((status) => status === 'editable' || status === 'normal'),
          )
          .map((record, authoritativeInputOrder): ReadOnlyRow => ({
            assetRef: toReadOnlyAssetRef(record.summary.asset),
            assetId: record.summary.asset.assetId,
            displayName: record.summary.displayName,
            sortBaseName: record.summary.displayName,
            authoritativeInputOrder,
            nativeOwnership: { kind: 'global' },
            agents: record.summary.agents,
            sourceTierId: record.summary.sourceTier.id,
            sourceTierLabel: record.summary.sourceTier.label,
            redactedSummary: 'FE-03 local draft fixture',
            ownershipHint: 'FE-03 synthetic fixture',
            statuses: ['editable', 'normal'],
            skillTargetStates:
              query.assetType === 'skill' && record.detail.readSurface.kind === 'skill'
                ? record.detail.readSurface.agentTargetStates
                : [],
          }));
        return this.readSucceeded({
          kind: 'workbench',
          query: { ...query, ...(filters === undefined ? {} : { filters }) },
          authoritativeReadRevision: 'rev-fe03-workbench',
          segments:
            rows.length === 0
              ? []
              : [
                  {
                    id: `segment-fe03-${query.assetType}`,
                    source: 'globalApplicable',
                    displayLabel: 'Global',
                    rows,
                  },
                ],
          effectiveContexts: [],
          findings: [],
          aggregateTotal: rows.length,
          indexStatus: this.indexStatus,
          readAt: new Date().toISOString(),
        });
      }
      case 'assetDetail': {
        const record = records.find(
          (candidate) => candidate.summary.asset.assetId === query.asset.assetId,
        );
        return record === undefined
          ? this.readFailed('READ_FAILED')
          : this.readSucceeded({
              kind: 'assetDetail',
              detail: record.detail,
              inspector: record.inspector,
              revision: record.detail.revision,
            });
      }
      case 'nativeFile': {
        const record = records.find(
          (candidate) => candidate.summary.asset.assetId === query.asset.assetId,
        );
        const entry = record?.files.find((candidate) => candidate.file.fileId === query.fileId);
        if (record === undefined || entry === undefined) return this.readFailed('READ_FAILED');
        const revision = record.detail.revision;
        return this.readSucceeded({
          kind: 'nativeFile',
          file: entry.file,
          revision,
          assetRevision: revision,
          content: {
            kind: 'source',
            maskedText: entry.source ?? '',
            sensitiveSegments: entry.sensitiveSegments ?? [],
            ...(entry.maskedParts === undefined ? {} : { maskedParts: entry.maskedParts }),
          },
          structuredView: { kind: 'allowed' },
        });
      }
      case 'assetList':
      case 'globalLocator':
      case 'projectApplicability':
        return this.readFailed('UNSUPPORTED_CAPABILITY');
      case 'sensitiveReveal': {
        const record = records.find((candidate) =>
          sameAssetRef(candidate.summary.asset, query.asset),
        );
        const entry = record?.files.find((candidate) => candidate.file.fileId === query.fileId);
        const segment = entry?.sensitiveSegments?.find(
          (candidate) => candidate.segmentId === query.segmentId,
        );
        if (
          record === undefined ||
          entry === undefined ||
          segment === undefined ||
          segment.fileId !== entry.file.fileId ||
          segment.revision !== record.detail.revision ||
          query.fileRevision !== record.detail.revision ||
          query.assetRevision !== record.detail.revision ||
          query.scope !== 'modify' ||
          query.surface !== 'source'
        )
          return this.readFailed('READ_FAILED');
        const snapshot: SensitiveRevealSnapshot = {
          kind: 'sensitiveReveal',
          plaintext: String.fromCharCode(101, 112, 104, 101, 109, 101, 114, 97, 108),
          grant: {
            grantId: globalThis.crypto.randomUUID(),
            asset: record.summary.asset,
            fileId: entry.file.fileId,
            segmentId: segment.segmentId,
            fileRevision: record.detail.revision,
            assetRevision: record.detail.revision,
            scope: 'modify',
            surface: 'source',
            expiresAt: new Date(Date.now() + 2_000).toISOString(),
          },
        };
        return this.readSucceeded(snapshot);
      }
    }
  }

  /**
   * FX-12 是单独的只读功能输入：没有 FE-03 draft、modify grant 或可编辑
   * capability。fixture 只携带遮蔽 metadata；临时内容只在下面的 read response
   * 中出现，既不写入 fixture、call log、缓存或 workspace event。
   */
  private fx12SensitiveViewRecords(): SyntheticReadRecord[] {
    const readonly = { kind: 'disabled' as const, reasonCode: 'READ_ONLY_POLICY' as const };
    const allowed = { kind: 'allowed' as const };
    const revision =
      this.externalChangeCount === 0
        ? fx12Fixture.revision
        : `${fx12Fixture.revision}+external-${this.externalChangeCount}`;
    const primaryFile: NativeFileRef = {
      fileId: fx12Fixture.file.fileId,
      name: fx12Fixture.file.name,
      relativePath: fx12Fixture.file.relativePath,
      fileKind: 'text',
      isPrimary: true,
      canPreview: allowed,
      canEdit: readonly,
      hasDraftChanges: false,
    };
    const alternateFile: NativeFileRef = {
      fileId: fx12Fixture.alternateFile.fileId,
      name: fx12Fixture.alternateFile.name,
      relativePath: fx12Fixture.alternateFile.relativePath,
      fileKind: 'text',
      isPrimary: false,
      canPreview: allowed,
      canEdit: readonly,
      hasDraftChanges: false,
    };
    const alternateDestinationFile: NativeFileRef = {
      fileId: fx12Fixture.alternateDestination.file.fileId,
      name: fx12Fixture.alternateDestination.file.name,
      relativePath: fx12Fixture.alternateDestination.file.relativePath,
      fileKind: 'text',
      isPrimary: true,
      canPreview: allowed,
      canEdit: readonly,
      hasDraftChanges: false,
    };
    const ordinaryFile: NativeFileRef = {
      fileId: fx12Fixture.ordinaryFile.fileId,
      name: fx12Fixture.ordinaryFile.name,
      relativePath: fx12Fixture.ordinaryFile.relativePath,
      fileKind: 'text',
      isPrimary: true,
      canPreview: allowed,
      canEdit: readonly,
      hasDraftChanges: false,
    };
    const asset: AssetSummary = {
      asset: {
        assetId: fx12Fixture.asset.assetId,
        assetType: 'longTermInstruction',
        nativeUnitRef: fx12Fixture.asset.nativeUnitRef,
        adapterIdentity: 'fx12-synthetic@local',
        nativeOwnership: { kind: 'global' },
      },
      displayName: fx12Fixture.asset.displayName,
      anomalies: [],
      agents: ['codex'],
      scope: 'global',
      contextHint: { kind: 'path', pathHint: 'FX-12 masked-only fixture' },
      sourceTier: { id: 'source-fx12-sensitive-view', label: 'FX-12 masked-only fixture' },
      availability: readonly,
    };
    const detail: AssetDetail = {
      asset: asset.asset,
      displayName: asset.displayName,
      nativeUnitKind: 'singleFile',
      revision,
      compatibility: 'recognizedReadOnly',
      capabilities: { edit: readonly, convert: readonly, export: readonly, delete: readonly },
      effectiveContexts: [
        {
          agent: 'codex',
          scope: 'global',
          sourceTierLabel: 'FX-12 masked-only fixture',
          precedence: 0,
        },
      ],
      primaryFile,
      fileTreeRoot: {
        name: 'fx12-sensitive-view',
        children: [
          { name: primaryFile.name, file: primaryFile },
          { name: alternateFile.name, file: alternateFile },
        ],
      },
      readSurface: { kind: 'longTermInstruction', markdownFile: primaryFile },
    };
    const inspector: InspectorData = {
      agents: asset.agents,
      scope: 'global',
      effectiveContexts: detail.effectiveContexts,
      sourceAnchor: { kind: 'globalRoot', label: 'FX-12 masked-only fixture' },
      pathDisplay: 'FX-12 masked-only fixture',
      compatibility: 'recognizedReadOnly',
      overrides: [],
    };
    const alternateDestinationAsset: AssetSummary = {
      asset: {
        assetId: fx12Fixture.asset.assetId,
        assetType: 'longTermInstruction',
        nativeUnitRef: fx12Fixture.alternateDestination.nativeUnitRef,
        adapterIdentity: 'fx12-synthetic@local',
        nativeOwnership: {
          kind: 'project',
          projectId: fx12Fixture.alternateDestination.projectId,
        },
      },
      displayName: fx12Fixture.alternateDestination.displayName,
      anomalies: [],
      agents: ['codex'],
      scope: 'project',
      contextHint: {
        kind: 'project',
        projectName: fx12Fixture.alternateDestination.projectId,
      },
      sourceTier: {
        id: 'source-fx12-sensitive-view-project',
        label: 'FX-12 project masked-only fixture',
      },
      availability: readonly,
    };
    const alternateDestinationDetail: AssetDetail = {
      asset: alternateDestinationAsset.asset,
      displayName: alternateDestinationAsset.displayName,
      nativeUnitKind: 'singleFile',
      revision,
      compatibility: 'recognizedReadOnly',
      capabilities: { edit: readonly, convert: readonly, export: readonly, delete: readonly },
      effectiveContexts: [
        {
          agent: 'codex',
          scope: 'project',
          sourceTierLabel: 'FX-12 project masked-only fixture',
          precedence: 0,
        },
      ],
      primaryFile: alternateDestinationFile,
      fileTreeRoot: {
        name: 'fx12-sensitive-view-project',
        children: [{ name: alternateDestinationFile.name, file: alternateDestinationFile }],
      },
      readSurface: { kind: 'longTermInstruction', markdownFile: alternateDestinationFile },
    };
    const alternateDestinationInspector: InspectorData = {
      agents: alternateDestinationAsset.agents,
      scope: 'project',
      effectiveContexts: alternateDestinationDetail.effectiveContexts,
      sourceAnchor: {
        kind: 'project',
        projectName: fx12Fixture.alternateDestination.projectId,
      },
      pathDisplay: 'FX-12 project masked-only fixture',
      compatibility: 'recognizedReadOnly',
      overrides: [],
    };
    const ordinaryAsset: AssetSummary = {
      asset: {
        assetId: fx12Fixture.ordinaryAsset.assetId,
        assetType: 'longTermInstruction',
        nativeUnitRef: fx12Fixture.ordinaryAsset.nativeUnitRef,
        adapterIdentity: 'fx12-synthetic@local',
        nativeOwnership: { kind: 'global' },
      },
      displayName: fx12Fixture.ordinaryAsset.displayName,
      anomalies: [],
      agents: ['codex'],
      scope: 'global',
      contextHint: { kind: 'path', pathHint: 'FX-12 masked-only fixture' },
      sourceTier: { id: 'source-fx12-ordinary-readonly', label: 'FX-12 masked-only fixture' },
      availability: readonly,
    };
    const ordinaryDetail: AssetDetail = {
      asset: ordinaryAsset.asset,
      displayName: ordinaryAsset.displayName,
      nativeUnitKind: 'singleFile',
      revision: 'rev-fx12-ordinary-readonly-0001',
      compatibility: 'recognizedReadOnly',
      capabilities: { edit: readonly, convert: readonly, export: readonly, delete: readonly },
      effectiveContexts: detail.effectiveContexts,
      primaryFile: ordinaryFile,
      readSurface: { kind: 'longTermInstruction', markdownFile: ordinaryFile },
    };
    const ordinaryInspector: InspectorData = {
      ...inspector,
      agents: ordinaryAsset.agents,
      effectiveContexts: ordinaryDetail.effectiveContexts,
    };
    const paginationRecords: SyntheticReadRecord[] = Array.from(
      { length: fx12Fixture.pagination.additionalReadOnlyRows },
      (_, index) => {
        const displayName = `Z FX-12 pagination ${String(index + 1).padStart(2, '0')}`;
        const paginationAsset: AssetSummary = {
          ...ordinaryAsset,
          asset: {
            ...ordinaryAsset.asset,
            assetId: `asset-fx12-pagination-${index + 1}`,
            nativeUnitRef: `nunit-fx12-pagination-${index + 1}`,
          },
          displayName,
        };
        const paginationDetail: AssetDetail = {
          ...ordinaryDetail,
          asset: paginationAsset.asset,
          displayName,
          revision: `rev-fx12-pagination-${index + 1}`,
        };
        return {
          summary: paginationAsset,
          detail: paginationDetail,
          inspector: ordinaryInspector,
          files: [
            {
              file: ordinaryFile,
              source: '# FX-12 pagination read-only\n\nMasked-only fixture metadata.\n',
            },
          ],
        };
      },
    );
    return [
      {
        summary: asset,
        detail,
        inspector,
        files: [
          {
            file: primaryFile,
            source: `${fx12Fixture.maskedSource.prefix}${fx12Fixture.maskedSource.placeholder}${fx12Fixture.maskedSource.suffix}`,
            maskedParts: [
              { kind: 'text', text: fx12Fixture.maskedSource.prefix },
              { kind: 'sensitivePlaceholder', segmentId: fx12Fixture.segment.segmentId },
              { kind: 'text', text: fx12Fixture.maskedSource.suffix },
            ],
            sensitiveSegments: [
              {
                segmentId: fx12Fixture.segment.segmentId,
                fileId: primaryFile.fileId,
                revision,
                displayState: 'masked',
              },
            ],
          },
          {
            file: alternateFile,
            source: '# FX-12 view context\n\nMasked-only fixture metadata.\n',
          },
        ],
      },
      {
        summary: alternateDestinationAsset,
        detail: alternateDestinationDetail,
        inspector: alternateDestinationInspector,
        files: [
          {
            file: alternateDestinationFile,
            source: '# FX-12 project read-only\n\nMasked-only fixture metadata.\n',
          },
        ],
      },
      {
        summary: ordinaryAsset,
        detail: ordinaryDetail,
        inspector: ordinaryInspector,
        files: [
          {
            file: ordinaryFile,
            source: '# FX-12 ordinary read-only\n\nMasked-only fixture metadata.\n',
          },
        ],
      },
      ...paginationRecords,
    ];
  }

  private readFromFx12SensitiveView(
    query: Query,
  ): ReadResult<
    AssetDetailSnapshot | NativeFileSnapshot | SensitiveRevealSnapshot | WorkbenchActualReadSnapshot
  > {
    const records = this.fx12SensitiveViewRecords();
    const maskedRecord = records.find(
      (record) => record.summary.asset.assetId === fx12Fixture.asset.assetId,
    );
    if (maskedRecord === undefined) return this.readFailed('READ_FAILED');
    switch (query.kind) {
      case 'workbench': {
        let filters;
        try {
          filters = canonicalizeWorkbenchFilters(query.filters, query.viewContext);
        } catch {
          return this.readFailed('READ_FAILED');
        }
        const eligibleRecords =
          query.assetType !== 'longTermInstruction'
            ? []
            : records.filter(
                (record) =>
                  (filters?.agents === undefined || filters.agents.includes('codex')) &&
                  (filters?.sourceIds === undefined ||
                    filters.sourceIds.includes(record.summary.sourceTier.id)) &&
                  (filters?.statuses === undefined || filters.statuses.includes('readOnly')),
              );
        const rowsFor = (segmentRecords: SyntheticReadRecord[]): ReadOnlyRow[] =>
          segmentRecords.map((record, authoritativeInputOrder) => ({
            assetRef: toReadOnlyAssetRef(record.summary.asset),
            assetId: record.summary.asset.assetId,
            displayName: record.summary.displayName,
            sortBaseName: record.summary.displayName,
            authoritativeInputOrder,
            nativeOwnership: record.summary.asset.nativeOwnership,
            agents: record.summary.agents,
            sourceTierId: record.summary.sourceTier.id,
            sourceTierLabel: record.summary.sourceTier.label,
            redactedSummary: 'FX-12 masked-only fixture',
            ownershipHint:
              record.summary.asset.nativeOwnership.kind === 'global'
                ? 'FX-12 masked-only fixture'
                : record.summary.asset.nativeOwnership.projectId,
            statuses: ['readOnly'],
          }));
        const globalRows = rowsFor(
          eligibleRecords.filter(
            (record) => record.summary.asset.nativeOwnership.kind === 'global',
          ),
        );
        const projectSegments = [
          ...new Set(
            eligibleRecords.flatMap((record) =>
              record.summary.asset.nativeOwnership.kind === 'project'
                ? [record.summary.asset.nativeOwnership.projectId]
                : [],
            ),
          ),
        ]
          .sort((left, right) => left.localeCompare(right, 'zh-CN'))
          .map((projectId) => ({
            id: `segment-fx12-project-${projectId}`,
            source: 'projectNative' as const,
            displayLabel: projectId,
            projectId,
            rows: rowsFor(
              eligibleRecords.filter(
                (record) =>
                  record.summary.asset.nativeOwnership.kind === 'project' &&
                  record.summary.asset.nativeOwnership.projectId === projectId,
              ),
            ),
          }));
        const globalSegment = {
          id: 'segment-fx12-sensitive-view',
          source: 'globalApplicable' as const,
          displayLabel: 'Global',
          rows: globalRows,
        };
        const selectedProjectId =
          query.viewContext.kind === 'project' ? query.viewContext.projectId : null;
        const segments =
          query.viewContext.kind === 'global'
            ? globalRows.length === 0
              ? []
              : [globalSegment]
            : query.viewContext.kind === 'project'
              ? projectSegments.filter((segment) => segment.projectId === selectedProjectId)
              : [...(globalRows.length === 0 ? [] : [globalSegment]), ...projectSegments];
        return this.readSucceeded({
          kind: 'workbench',
          query: { ...query, ...(filters === undefined ? {} : { filters }) },
          authoritativeReadRevision: maskedRecord.detail.revision,
          segments,
          effectiveContexts: [],
          findings: [],
          aggregateTotal: segments.reduce((total, segment) => total + segment.rows.length, 0),
          indexStatus: 'fresh',
          readAt: new Date().toISOString(),
        });
      }
      case 'assetDetail': {
        const record = records.find((candidate) =>
          sameAssetRef(candidate.summary.asset, query.asset),
        );
        return record === undefined
          ? this.readFailed('READ_FAILED')
          : this.readSucceeded({
              kind: 'assetDetail',
              detail: record.detail,
              inspector: record.inspector,
              revision: record.detail.revision,
            });
      }
      case 'nativeFile': {
        const record = records.find((candidate) =>
          sameAssetRef(candidate.summary.asset, query.asset),
        );
        if (record === undefined) return this.readFailed('READ_FAILED');
        const entry = record.files.find((candidate) => candidate.file.fileId === query.fileId);
        if (entry === undefined) return this.readFailed('READ_FAILED');
        return this.readSucceeded({
          kind: 'nativeFile',
          file: entry.file,
          revision: record.detail.revision,
          assetRevision: record.detail.revision,
          content: {
            kind: 'source',
            maskedText: entry.source ?? '',
            sensitiveSegments: entry.sensitiveSegments ?? [],
            ...(entry.maskedParts === undefined ? {} : { maskedParts: entry.maskedParts }),
          },
          structuredView: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
        });
      }
      case 'sensitiveReveal': {
        const entry = maskedRecord.files.find(
          (candidate) => candidate.file.fileId === query.fileId,
        );
        const segment = entry?.sensitiveSegments?.find(
          (candidate) => candidate.segmentId === query.segmentId,
        );
        if (
          !sameAssetRef(maskedRecord.summary.asset, query.asset) ||
          entry === undefined ||
          segment === undefined ||
          segment.fileId !== entry.file.fileId ||
          segment.revision !== maskedRecord.detail.revision ||
          query.fileRevision !== maskedRecord.detail.revision ||
          query.assetRevision !== maskedRecord.detail.revision ||
          query.scope !== 'view' ||
          query.surface !== 'source'
        )
          return this.readFailed('READ_FAILED');
        return this.readSucceeded({
          kind: 'sensitiveReveal',
          plaintext: String.fromCodePoint(101, 112, 104, 101, 109, 101, 114, 97, 108),
          grant: {
            grantId: globalThis.crypto.randomUUID(),
            asset: maskedRecord.summary.asset,
            fileId: entry.file.fileId,
            segmentId: segment.segmentId,
            fileRevision: maskedRecord.detail.revision,
            assetRevision: maskedRecord.detail.revision,
            scope: 'view',
            surface: 'source',
            expiresAt: new Date(Date.now() + fx12Fixture.view.ttlMs).toISOString(),
          },
        });
      }
      case 'assetList':
      case 'globalLocator':
      case 'projectApplicability':
        return this.readFailed('UNSUPPORTED_CAPABILITY');
    }
  }

  private fx02Records(): SyntheticReadRecord[] {
    const readonly = { kind: 'disabled' as const, reasonCode: 'READ_ONLY_POLICY' as const };
    const file = (
      fileId: string,
      name: string,
      relativePath: string,
      fileKind: NativeFileRef['fileKind'],
      isPrimary: boolean,
    ): NativeFileRef => ({
      fileId,
      name,
      relativePath,
      fileKind,
      isPrimary,
      canPreview:
        fileKind === 'text'
          ? ({ kind: 'allowed' } as const)
          : { kind: 'disabled' as const, reasonCode: 'NON_TEXT_UNPREVIEWABLE' as const },
      canEdit: readonly,
      hasDraftChanges: false,
    });
    const skillPrimary = file('file-fx02-skill-primary', 'SKILL.md', 'SKILL.md', 'text', true);
    const skillUsage = file(
      'file-fx02-skill-usage',
      'usage.md',
      'references/usage.md',
      'text',
      false,
    );
    const skillBinary = file(
      'file-fx02-skill-opaque',
      'opaque.bin',
      'assets/opaque.bin',
      'nonText',
      false,
    );
    const instructionFile = file(
      'file-fx02-instruction',
      'release-notes.md',
      'release-notes.md',
      'text',
      true,
    );
    const subagentFile = file('file-fx02-subagent', 'SUBAGENT.md', 'SUBAGENT.md', 'text', true);
    const summary = (
      assetId: string,
      assetType: AssetSummary['asset']['assetType'],
      nativeUnitRef: string,
      displayName: string,
      agents: AssetSummary['agents'],
    ): AssetSummary => ({
      asset: {
        assetId,
        assetType,
        nativeUnitRef,
        adapterIdentity: 'fixture-fx02@synthetic',
        nativeOwnership: { kind: 'global' },
      },
      displayName,
      anomalies: [
        { kind: 'readOnly', reasonCode: 'READ_ONLY_POLICY', message: '只读合成 fixture' },
      ],
      agents,
      scope: 'global',
      contextHint: { kind: 'path', pathHint: 'FX-02/native-root' },
      sourceTier: { id: 'source-fx02', label: 'FX-02 synthetic root' },
      availability: readonly,
    });
    const inspector = (agents: AssetSummary['agents']): InspectorData => ({
      agents,
      scope: 'global',
      effectiveContexts: agents.map((agent) => ({
        agent,
        scope: 'global',
        sourceTierLabel: 'FX-02 synthetic root',
        precedence: 0,
      })),
      sourceAnchor: { kind: 'globalRoot', label: 'FX-02 synthetic root' },
      pathDisplay: 'FX-02/native-root',
      compatibility: 'recognizedReadOnly',
      overrides: [],
    });
    const skillSummary = summary(
      'asset-fx02-multifile-skill-mixed',
      'skill',
      'nunit-fx02-multifile-skill-mixed',
      'Multifile Skill',
      ['claude-code'],
    );
    const instructionSummary = summary(
      'asset-fx02-long-term-release-notes',
      'longTermInstruction',
      'nunit-fx02-long-term-release-notes',
      'Release notes',
      ['codex'],
    );
    const subagentSummary = summary(
      'asset-fx02-subagent-researcher',
      'subagent',
      'nunit-fx02-subagent-researcher',
      'Researcher',
      ['codex'],
    );
    const context = (agents: AssetSummary['agents']): EffectiveContext[] =>
      agents.map((agent) => ({
        agent,
        scope: 'global',
        sourceTierLabel: 'FX-02 synthetic root',
        precedence: 0,
      }));
    return [
      {
        summary: skillSummary,
        detail: {
          asset: skillSummary.asset,
          displayName: skillSummary.displayName,
          nativeUnitKind: 'multiFileDirectory',
          revision: 'rev-fx02-skill',
          compatibility: 'recognizedReadOnly',
          capabilities: { edit: readonly, convert: readonly, export: readonly, delete: readonly },
          effectiveContexts: context(skillSummary.agents),
          primaryFile: skillPrimary,
          fileTreeRoot: {
            name: 'multifile-skill-mixed',
            children: [
              { name: 'SKILL.md', file: skillPrimary },
              { name: 'assets', children: [{ name: 'opaque.bin', file: skillBinary }] },
              { name: 'references', children: [{ name: 'usage.md', file: skillUsage }] },
            ],
          },
          readSurface: {
            kind: 'skill',
            agentTargetStates: this.skillTargetStates(),
            sourceReadAvailability: { kind: 'allowed' },
            unknownContentReason: 'UNKNOWN_FIELD_PRESERVED',
          },
        },
        inspector: inspector(skillSummary.agents),
        files: [
          { file: skillPrimary, source: fx02SkillRaw },
          { file: skillUsage, source: fx02UsageRaw },
          { file: skillBinary },
        ],
      },
      {
        summary: instructionSummary,
        detail: {
          asset: instructionSummary.asset,
          displayName: instructionSummary.displayName,
          nativeUnitKind: 'singleFile',
          revision: 'rev-fx02-instruction',
          compatibility: 'recognizedReadOnly',
          capabilities: { edit: readonly, convert: readonly, export: readonly, delete: readonly },
          effectiveContexts: context(instructionSummary.agents),
          primaryFile: instructionFile,
          readSurface: { kind: 'longTermInstruction', markdownFile: instructionFile },
        },
        inspector: inspector(instructionSummary.agents),
        files: [{ file: instructionFile, source: fx02InstructionRaw }],
      },
      {
        summary: subagentSummary,
        detail: {
          asset: subagentSummary.asset,
          displayName: subagentSummary.displayName,
          nativeUnitKind: 'configBlock',
          revision: 'rev-fx02-subagent',
          compatibility: 'recognizedReadOnly',
          capabilities: { edit: readonly, convert: readonly, export: readonly, delete: readonly },
          effectiveContexts: context(subagentSummary.agents),
          primaryFile: subagentFile,
          readSurface: {
            kind: 'subagent',
            model: 'synthetic-readonly-model',
            tools: ['read'],
            permissions: ['readonly'],
            bodyFile: subagentFile,
            readOnlyReason: 'UNKNOWN_FIELD_PRESERVED',
          },
        },
        inspector: inspector(subagentSummary.agents),
        files: [{ file: subagentFile, source: fx02SubagentRaw }],
      },
    ];
  }

  private readFromFx02(
    query: Query,
  ): ReadResult<
    | AssetListSnapshot
    | AssetDetailSnapshot
    | NativeFileSnapshot
    | WorkbenchActualReadSnapshot
    | GlobalLocatorSnapshot
  > {
    const records = this.fx02Records();
    switch (query.kind) {
      case 'assetList': {
        const assets = records
          .filter(
            (record) =>
              query.scope.kind === 'allAssets' ||
              record.summary.asset.assetType === query.scope.assetType,
          )
          .map((record) => record.summary);
        return this.readSucceeded({
          kind: 'assetList',
          assets,
          indexStatus: 'fresh',
          scope: query.scope,
          queriedAt: new Date().toISOString(),
          indexUpdatedAt: new Date().toISOString(),
        });
      }
      case 'workbench': {
        let filters;
        try {
          filters = canonicalizeWorkbenchFilters(query.filters, query.viewContext);
        } catch {
          return this.readFailed('READ_FAILED');
        }
        const rows = records
          .filter((record) => record.summary.asset.assetType === query.assetType)
          .filter(
            (record) =>
              filters?.agents === undefined ||
              filters.agents.some((agent) => record.summary.agents.includes(agent)),
          )
          .map((record, authoritativeInputOrder): ReadOnlyRow => ({
            assetRef: toReadOnlyAssetRef(record.summary.asset),
            assetId: record.summary.asset.assetId,
            displayName: record.summary.displayName,
            sortBaseName: record.summary.displayName,
            authoritativeInputOrder,
            nativeOwnership: { kind: 'global' },
            agents: record.summary.agents,
            sourceTierId: record.summary.sourceTier.id,
            sourceTierLabel: record.summary.sourceTier.label,
            redactedSummary: 'FX-02 结构化只读摘要',
            ownershipHint: 'FX-02 synthetic root',
            statuses: ['readOnly', 'normal'],
            skillTargetStates:
              query.assetType === 'skill'
                ? record.detail.readSurface.kind === 'skill'
                  ? record.detail.readSurface.agentTargetStates
                  : []
                : [],
          }));
        return this.readSucceeded({
          kind: 'workbench',
          query: { ...query, ...(filters === undefined ? {} : { filters }) },
          authoritativeReadRevision: 'rev-fx02-workbench',
          segments:
            rows.length === 0
              ? []
              : [
                  {
                    id: `segment-fx02-${query.assetType}`,
                    source: 'globalApplicable',
                    displayLabel: 'Global',
                    rows,
                  },
                ],
          effectiveContexts: [],
          findings: [],
          aggregateTotal: rows.length,
          indexStatus: 'fresh',
          readAt: new Date().toISOString(),
        });
      }
      case 'globalLocator': {
        const groups = MVP_ASSET_TYPES.map((assetType) => {
          const results = records
            .filter((record) => record.summary.asset.assetType === assetType)
            .map((record, authoritativeInputOrder) => ({
              assetRef: toReadOnlyAssetRef(record.summary.asset),
              assetId: record.summary.asset.assetId,
              displayName: record.summary.displayName,
              sortBaseName: record.summary.displayName,
              authoritativeInputOrder,
              nativeOwnership: { kind: 'global' as const },
              agents: record.summary.agents,
              sourceTierId: record.summary.sourceTier.id,
              sourceTierLabel: record.summary.sourceTier.label,
              redactedSummary: 'FX-02 结构化只读摘要',
              ownershipHint: 'FX-02 synthetic root',
              statuses: ['readOnly' as const, 'normal' as const],
              skillTargetStates: [],
              destinationViewContext: { kind: 'global' as const },
              destination:
                assetType === 'skill'
                  ? {
                      kind: 'skillDetail' as const,
                      assetRef: toReadOnlyAssetRef(record.summary.asset),
                    }
                  : {
                      kind: 'typeSpecificDetail' as const,
                      assetRef: toReadOnlyAssetRef(record.summary.asset),
                    },
              matchedField: mockLocatorMatchedField(query.searchText, {
                assetRef: toReadOnlyAssetRef(record.summary.asset),
                assetId: record.summary.asset.assetId,
                displayName: record.summary.displayName,
                sortBaseName: record.summary.displayName,
                authoritativeInputOrder,
                nativeOwnership: { kind: 'global' },
                agents: record.summary.agents,
                redactedSummary: 'FX-02 结构化只读摘要',
                ownershipHint: 'FX-02 synthetic root',
              }),
            }))
            .filter(
              (result) => result.matchedField !== null,
            ) as GlobalLocatorSnapshot['groups'][number]['results'];
          return { assetType, count: results.length, results };
        });
        return this.readSucceeded({
          kind: 'globalLocator',
          groups,
          aggregateTotal: groups.reduce((total, group) => total + group.count, 0),
          readAt: new Date().toISOString(),
        });
      }
      case 'assetDetail': {
        const record = records.find(
          (candidate) => candidate.summary.asset.assetId === query.asset.assetId,
        );
        return record === undefined
          ? this.readFailed('READ_FAILED')
          : this.readSucceeded({
              kind: 'assetDetail',
              detail: record.detail,
              inspector: record.inspector,
              revision: record.detail.revision,
            });
      }
      case 'nativeFile': {
        const record = records.find(
          (candidate) => candidate.summary.asset.assetId === query.asset.assetId,
        );
        const entry = record?.files.find((candidate) => candidate.file.fileId === query.fileId);
        if (record === undefined || entry === undefined) return this.readFailed('READ_FAILED');
        const revision = record.detail.revision;
        const content =
          entry.file.fileKind === 'text'
            ? {
                kind: 'source' as const,
                maskedText: maskSyntheticSecrets(entry.source ?? ''),
                sensitiveSegments: fx02MaskedSegments(
                  record.summary.asset.assetType,
                  entry.file,
                  revision,
                  entry.source,
                ),
              }
            : {
                kind: 'nonTextMetadata' as const,
                fileKindLabel: 'binary',
                sizeBytes: 26,
                pathDisplay: entry.file.relativePath,
                reasonCode: 'NON_TEXT_UNPREVIEWABLE' as const,
                reason: '非文本文件仅提供元数据。',
              };
        return this.readSucceeded({
          kind: 'nativeFile',
          file: entry.file,
          revision,
          assetRevision: revision,
          content,
          structuredView: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
        });
      }
      case 'projectApplicability':
      case 'sensitiveReveal':
        return this.readFailed('UNSUPPORTED_CAPABILITY');
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
      readSurface: {
        kind: 'skill',
        agentTargetStates: this.skillTargetStates(),
        sourceReadAvailability: { kind: 'allowed' },
      },
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
