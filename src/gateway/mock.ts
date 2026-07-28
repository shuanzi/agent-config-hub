/**
 * ScriptedMockGateway — FE-01 的内存 mock FrontendGateway。
 *
 * 事实来源：FX-01 合成 fixture（fixtures/fx-01）。原始 SKILL.md 文本在离开
 * gateway 前经 fixtures/sensitive-masking.ts 遮蔽；sensitiveSegments 只携带
 * 元数据（不含 rawValue）。本模块不 import Tauri、不读文件系统、不访问浏览器存储。
 *
 * 脚本化能力（供 L1/L2 注入，不属于 FrontendGateway 契约）：
 * - failNext(queryKind, reasonCode)：下一次对应 read 返回一次性 ReadFailed(retryRead)；
 * - setIndexStatus('fresh' | 'stale')：stale 时 indexUpdatedAt 为过去时刻；
 * - simulateExternalChange()：revision 变为新不透明值，后续 read 反映新 revision；
 * - emitEvent(event)：向所有 observe listener 发事件；
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
import type { FrontendGateway } from '../contract/gateway';
import type {
  AssetDetail,
  AssetDetailSnapshot,
  AssetListQuery,
  AssetListSnapshot,
  AssetRef,
  AssetStatusFilter,
  AssetSummary,
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

  observe(subscription: Subscription, listener: (event: WorkspaceEvent) => void): () => void {
    void subscription;
    this.observeCallCount += 1;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
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
        this.failNext('assetList', 'READ_FAILED');
        break;
      case 'fail-detail':
        this.failNext('assetDetail', 'READ_FAILED');
        break;
      case 'stale-index':
        this.setIndexStatus('stale');
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

  // -------------------------------------------------------------------------
  // PF-01 perf-catalog 读取路径（只在 enablePerfCatalog 后可达）
  // -------------------------------------------------------------------------

  private readFromPerfCatalog(
    query: Query,
  ): ReadResult<AssetListSnapshot | AssetDetailSnapshot | NativeFileSnapshot> {
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
            .map((record) => record.summary),
          indexStatus: this.indexStatus,
          scope: query.scope,
          queriedAt,
          indexUpdatedAt: this.indexStatus === 'stale' ? this.staleIndexUpdatedAt : queriedAt,
        };
        return this.readSucceeded(snapshot);
      }
      case 'assetDetail': {
        const record = catalog.assets.find(
          (candidate) => candidate.summary.asset.assetId === query.asset.assetId,
        );
        if (record === undefined) {
          return this.readFailed('READ_FAILED');
        }
        const snapshot: AssetDetailSnapshot = {
          kind: 'assetDetail',
          detail: record.detail,
          inspector: record.inspector,
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
    return {
      asset: this.assetRef(),
      displayName: fixture.displayName,
      anomalies: [],
      agents: ['claude-code'],
      scope: 'global',
      contextHint: { kind: 'path', pathHint: fixture.contextHint.pathHint },
      availability: { kind: 'allowed' },
    };
  }

  private derivedStatuses(): AssetStatusFilter[] {
    // FX-01：verifiedWritable + availability allowed → 可编辑且正常
    return ['editable', 'normal'];
  }

  private matchesListQuery(query: AssetListQuery): boolean {
    if (query.scope.kind === 'currentAssetType' && query.scope.assetType !== 'skill') {
      return false;
    }
    const searchText = query.searchText?.trim().toLowerCase();
    if (searchText && !fixture.displayName.toLowerCase().includes(searchText)) {
      return false;
    }
    const filters = query.filters;
    if (filters?.agents && filters.agents.length > 0) {
      if (!filters.agents.some((agent) => fixture.agents.includes(agent))) {
        return false;
      }
    }
    if (filters?.scopes && filters.scopes.length > 0) {
      if (!filters.scopes.includes('global')) {
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
    return {
      asset: this.assetRef(),
      displayName: fixture.displayName,
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
        sourceTierLabel: context.sourceTierLabel,
        precedence: context.precedence,
      })),
      primaryFile: this.primaryFileRef(),
    };
  }

  private buildInspector(): InspectorData {
    return {
      agents: ['claude-code'],
      scope: 'global',
      effectiveContexts: fixture.effectiveContexts.map((context) => ({
        agent: 'claude-code',
        scope: 'global',
        sourceTierLabel: context.sourceTierLabel,
        precedence: context.precedence,
      })),
      sourceAnchor: { kind: 'userHome' },
      pathDisplay: fixture.pathDisplay,
      compatibility: 'verifiedWritable',
      overrides: [],
    };
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
      message: '读取未能完成（合成 mock 脚本化失败）。',
      recoveryAction: { kind: 'retryRead' },
    };
  }
}
