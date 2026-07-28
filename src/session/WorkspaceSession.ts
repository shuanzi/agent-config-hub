/**
 * WorkspaceSession — framework-neutral 工作台会话（ARC-06a，FE-01 只读子集）。
 *
 * - 构造时注入唯一 FrontendGateway；本模块不 import Tauri、React 或浏览器存储；
 * - 先建立 observe listener，待其 ready settle 后才发起初始 read；
 * - 每个异步 read effect 绑定 generation + query identity，旧响应一律丢弃；
 * - workspace event 按 query 依赖界定失效范围（类型/范围/列表成员），失效后
 *   重读，保留当前选择/搜索/筛选；
 * - Workbench load state 为封闭五态；failed 只消费 ReadFailed 的 reasonCode 与
 *   recoveryAction，不解析 message 分支；stale 保留最近 snapshot 并暴露 indexUpdatedAt；
 * - 重试动作由调用点显式携带目标（list / detail），各自重试各自失败的 query。
 */
import type { FrontendGateway } from '../contract/gateway';
import type {
  AgentId,
  AssetDetailSnapshot,
  AssetGroupBy,
  AssetListQuery,
  AssetListSnapshot,
  AssetRef,
  AssetScope,
  AssetStatusFilter,
  AssetType,
  NativeFileSnapshot,
  ReasonCode,
  RecoveryAction,
  WorkspaceEvent,
} from '../contract/types';

/** 搜索范围：当前资产类型 / 全部资产（对应 AssetListScope） */
export type SearchScopeKind = 'currentAssetType' | 'allAssets';

/** 与搜索同区的筛选控件状态；空数组表示该维度不筛选 */
export interface WorkbenchFilters {
  agents: AgentId[];
  /** 项目名集合（匹配 project contextHint 的 projectName） */
  projects: string[];
  scopes: AssetScope[];
  /** sourceTier.id 集合 */
  sources: string[];
  statuses: AssetStatusFilter[];
}

/** Workbench load state（前端契约 §7.1 封闭五态） */
export type WorkbenchLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; list: AssetListSnapshot }
  | { kind: 'empty'; list: AssetListSnapshot }
  | { kind: 'stale'; list: AssetListSnapshot }
  | { kind: 'failed'; reasonCode: ReasonCode; message: string; recoveryAction?: RecoveryAction };

/** 详情区状态：详情 = AssetDetailQuery + NativeFileQuery(primaryFile) 组合 */
export type DetailLoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; asset: AssetRef }
  | { kind: 'ready'; detail: AssetDetailSnapshot; file: NativeFileSnapshot }
  | {
      kind: 'failed';
      asset: AssetRef;
      reasonCode: ReasonCode;
      message: string;
      recoveryAction?: RecoveryAction;
    };

/** 只读、可判别的 UI state（ARC-06a） */
export interface WorkspaceViewState {
  loadState: WorkbenchLoadState;
  detail: DetailLoadState;
  assetType: AssetType;
  searchText: string;
  searchScope: SearchScopeKind;
  filters: WorkbenchFilters;
  groupBy: AssetGroupBy;
  selectedAsset: AssetRef | null;
}

/** 封闭的用户动作 union */
export type WorkspaceAction =
  | { kind: 'selectAssetType'; assetType: AssetType }
  | { kind: 'setSearchText'; searchText: string }
  | { kind: 'setScope'; scope: SearchScopeKind }
  | { kind: 'setFilters'; filters: Partial<WorkbenchFilters> }
  | { kind: 'setGroupBy'; groupBy: AssetGroupBy }
  | { kind: 'selectAsset'; asset: AssetRef | null }
  | { kind: 'retryFailedRead'; target: 'list' | 'detail' };

type Listener = () => void;

const EMPTY_FILTERS: WorkbenchFilters = {
  agents: [],
  projects: [],
  scopes: [],
  sources: [],
  statuses: [],
};

export class WorkspaceSession {
  private readonly gateway: FrontendGateway;
  private readonly listeners = new Set<Listener>();
  private readonly unobserve: () => void;
  private disposed = false;
  private listEffectGeneration = 0;
  private detailEffectGeneration = 0;
  private currentListQueryIdentity = '';
  private currentDetailQueryIdentity = '';

  private state: WorkspaceViewState = {
    loadState: { kind: 'loading' },
    detail: { kind: 'idle' },
    assetType: 'skill',
    searchText: '',
    searchScope: 'currentAssetType',
    filters: EMPTY_FILTERS,
    groupBy: 'none',
    selectedAsset: null,
  };

  constructor(gateway: FrontendGateway) {
    this.gateway = gateway;
    // ARC-06a：先建立 observe listener，ready settle 后才发起初始 read；
    // dispose 发生在 ready 前则不再发起 read。
    const handle = gateway.observe({ kind: 'workspace' }, (event) => {
      this.onWorkspaceEvent(event);
    });
    this.unobserve = handle.unlisten;
    const startInitialRead = (): void => {
      if (!this.disposed) {
        this.refreshList({ showLoading: true });
      }
    };
    // ready 按契约只 resolve；防御性处理 rejection（同语义：事件允许丢失）
    void handle.ready.then(startInitialRead, startInitialRead);
  }

  getSnapshot(): WorkspaceViewState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listEffectGeneration += 1;
    this.detailEffectGeneration += 1;
    this.unobserve();
    this.listeners.clear();
  }

  dispatch(action: WorkspaceAction): void {
    if (this.disposed) {
      return;
    }
    switch (action.kind) {
      case 'selectAssetType':
        if (action.assetType === this.state.assetType) {
          return;
        }
        this.update({
          assetType: action.assetType,
          selectedAsset: null,
          detail: { kind: 'idle' },
        });
        this.refreshList({ showLoading: true });
        return;
      case 'setSearchText':
        if (action.searchText === this.state.searchText) {
          return;
        }
        this.update({ searchText: action.searchText });
        this.refreshList({ showLoading: false });
        return;
      case 'setScope':
        if (action.scope === this.state.searchScope) {
          return;
        }
        this.update({ searchScope: action.scope });
        this.refreshList({ showLoading: false });
        return;
      case 'setFilters':
        this.update({ filters: { ...this.state.filters, ...action.filters } });
        this.refreshList({ showLoading: false });
        return;
      case 'setGroupBy':
        if (action.groupBy === this.state.groupBy) {
          return;
        }
        this.update({ groupBy: action.groupBy });
        this.refreshList({ showLoading: false });
        return;
      case 'selectAsset':
        if (action.asset === null) {
          this.detailEffectGeneration += 1;
          this.update({ selectedAsset: null, detail: { kind: 'idle' } });
          return;
        }
        if (action.asset.assetId === this.state.selectedAsset?.assetId) {
          return;
        }
        this.update({ selectedAsset: action.asset });
        this.refreshDetail({ showLoading: true });
        return;
      case 'retryFailedRead':
        // 重试目标由调用点显式携带：列表失败重试列表，详情失败重试详情
        if (action.target === 'list') {
          this.refreshList({ showLoading: true });
        } else {
          this.refreshDetail({ showLoading: true });
        }
        return;
    }
  }

  // -------------------------------------------------------------------------
  // 内部：list read effect
  // -------------------------------------------------------------------------

  private buildListQuery(): AssetListQuery {
    const filters = this.state.filters;
    const groupBy = this.state.groupBy;
    const hasFilters =
      filters.agents.length > 0 ||
      filters.projects.length > 0 ||
      filters.scopes.length > 0 ||
      filters.sources.length > 0 ||
      filters.statuses.length > 0;
    return {
      kind: 'assetList',
      scope:
        this.state.searchScope === 'allAssets'
          ? { kind: 'allAssets' }
          : { kind: 'currentAssetType', assetType: this.state.assetType },
      ...(this.state.searchText.trim() !== '' ? { searchText: this.state.searchText } : {}),
      ...(hasFilters || groupBy !== 'none'
        ? {
            filters: {
              ...(filters.agents.length > 0 ? { agents: filters.agents } : {}),
              ...(filters.projects.length > 0 ? { projects: filters.projects } : {}),
              ...(filters.scopes.length > 0 ? { scopes: filters.scopes } : {}),
              ...(filters.sources.length > 0 ? { sources: filters.sources } : {}),
              ...(filters.statuses.length > 0 ? { statuses: filters.statuses } : {}),
              ...(groupBy !== 'none' ? { groupBy } : {}),
            },
          }
        : {}),
    };
  }

  private refreshList(options: { showLoading: boolean }): void {
    const query = this.buildListQuery();
    const generation = ++this.listEffectGeneration;
    this.currentListQueryIdentity = JSON.stringify(query);
    if (options.showLoading) {
      this.update({ loadState: { kind: 'loading' } });
    }
    void this.gateway.read(query).then((result) => {
      if (
        this.disposed ||
        generation !== this.listEffectGeneration ||
        this.currentListQueryIdentity !== JSON.stringify(query)
      ) {
        return; // 旧响应：丢弃
      }
      if (result.kind === 'readFailed') {
        this.update({
          loadState: {
            kind: 'failed',
            reasonCode: result.reasonCode,
            message: result.message,
            ...(result.recoveryAction ? { recoveryAction: result.recoveryAction } : {}),
          },
        });
        return;
      }
      const list = result.snapshot;
      if (list.indexStatus === 'stale') {
        this.update({ loadState: { kind: 'stale', list } });
      } else if (list.assets.length === 0) {
        this.update({ loadState: { kind: 'empty', list } });
      } else {
        this.update({ loadState: { kind: 'ready', list } });
      }
    });
  }

  // -------------------------------------------------------------------------
  // 内部：detail read effect（AssetDetailQuery + NativeFileQuery(primaryFile)）
  // -------------------------------------------------------------------------

  private refreshDetail(options: { showLoading: boolean }): void {
    const asset = this.state.selectedAsset;
    if (asset === null) {
      return;
    }
    const generation = ++this.detailEffectGeneration;
    const identity = asset.assetId;
    this.currentDetailQueryIdentity = identity;
    if (options.showLoading) {
      this.update({ detail: { kind: 'loading', asset } });
    }
    void (async () => {
      const detailResult = await this.gateway.read({ kind: 'assetDetail', asset });
      if (this.isStaleDetailEffect(generation, identity)) {
        return;
      }
      if (detailResult.kind === 'readFailed') {
        this.update({
          detail: {
            kind: 'failed',
            asset,
            reasonCode: detailResult.reasonCode,
            message: detailResult.message,
            ...(detailResult.recoveryAction ? { recoveryAction: detailResult.recoveryAction } : {}),
          },
        });
        return;
      }
      const fileResult = await this.gateway.read({
        kind: 'nativeFile',
        asset,
        fileId: detailResult.snapshot.detail.primaryFile.fileId,
      });
      if (this.isStaleDetailEffect(generation, identity)) {
        return;
      }
      if (fileResult.kind === 'readFailed') {
        this.update({
          detail: {
            kind: 'failed',
            asset,
            reasonCode: fileResult.reasonCode,
            message: fileResult.message,
            ...(fileResult.recoveryAction ? { recoveryAction: fileResult.recoveryAction } : {}),
          },
        });
        return;
      }
      this.update({
        detail: { kind: 'ready', detail: detailResult.snapshot, file: fileResult.snapshot },
      });
    })();
  }

  private isStaleDetailEffect(generation: number, identity: string): boolean {
    return (
      this.disposed ||
      generation !== this.detailEffectGeneration ||
      identity !== this.currentDetailQueryIdentity
    );
  }

  // -------------------------------------------------------------------------
  // 内部：workspace event → 只失效并重读，保留选择/搜索/筛选
  //
  // 失效范围按 query 依赖界定：
  // - assetsInvalidated：无类型、或当前范围为 allAssets、或类型匹配当前一级
  //   类型时失效列表，否则列表不受影响；
  // - assetDriftDetected / compatibilityChanged：选中资产匹配时重读详情；
  //   assetId 出现在当前列表 snapshot 中时同时失效列表（未选中资产的摘要/
  //   异常/可用性可能已变），不在列表中则不动作。
  // -------------------------------------------------------------------------

  private currentListSnapshot(): AssetListSnapshot | null {
    const loadState = this.state.loadState;
    return loadState.kind === 'ready' || loadState.kind === 'empty' || loadState.kind === 'stale'
      ? loadState.list
      : null;
  }

  private onWorkspaceEvent(event: WorkspaceEvent): void {
    if (this.disposed) {
      return;
    }
    switch (event.kind) {
      case 'assetsInvalidated':
        if (
          event.assetType === undefined ||
          this.state.searchScope === 'allAssets' ||
          event.assetType === this.state.assetType
        ) {
          this.refreshList({ showLoading: false });
        }
        // 事件不携带事实；当前详情可能已失效，重读之（保留选择）
        if (this.state.selectedAsset !== null) {
          this.refreshDetail({ showLoading: false });
        }
        return;
      case 'assetDriftDetected':
      case 'compatibilityChanged': {
        if (this.state.selectedAsset?.assetId === event.assetId) {
          this.refreshDetail({ showLoading: false });
        }
        const list = this.currentListSnapshot();
        if (list !== null && list.assets.some((asset) => asset.asset.assetId === event.assetId)) {
          this.refreshList({ showLoading: false });
        }
        return;
      }
      case 'indexStatusChanged':
        this.refreshList({ showLoading: false });
        return;
    }
  }

  // -------------------------------------------------------------------------

  private update(patch: Partial<WorkspaceViewState>): void {
    if (this.disposed) {
      return;
    }
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
