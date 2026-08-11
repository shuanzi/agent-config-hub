/** FE-01 的首个 workbench read-session。 */
import type { FrontendGateway } from '../contract/gateway';
import type { ReasonCode } from '../contract/types';
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

export interface ReadOnlyWorkbenchState {
  loadState: ReadOnlyLoadState;
  assetType: MvpAssetType;
  viewContext: ViewContext;
  filters?: WorkbenchFilters;
  presentation: ListPresentationState;
  /** 最近一次同 revision 的权威 all/project read 所见 opaque project identity。 */
  availableProjectIds: readonly string[];
  selected: ReadOnlyRow | null;
  /** 非 FE-01 Skill detail 的合法 locator destination：只显示 fail-closed 错误。 */
  detailError: { assetRef: ReadOnlyAssetRef; reasonCode: ReasonCode; message: string } | null;
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
  | { kind: 'openLocator' }
  | { kind: 'closeLocator' }
  | { kind: 'setLocatorSearch'; searchText: string }
  | { kind: 'selectLocatorResult'; result: LocatorResult }
  | { kind: 'retry' };

type Listener = () => void;

function sameAssetIdentity(left: ReadOnlyRow, right: ReadOnlyRow): boolean {
  const leftOwnership = left.assetRef.nativeOwnership;
  const rightOwnership = right.assetRef.nativeOwnership;
  return (
    left.assetRef.assetId === right.assetRef.assetId &&
    left.assetRef.assetType === right.assetRef.assetType &&
    left.assetRef.nativeUnitRef === right.assetRef.nativeUnitRef &&
    left.assetRef.adapterIdentity === right.assetRef.adapterIdentity &&
    leftOwnership.kind === rightOwnership.kind &&
    (leftOwnership.kind !== 'project' ||
      rightOwnership.kind !== 'project' ||
      leftOwnership.projectId === rightOwnership.projectId)
  );
}

/**
 * 此 session 的唯一路径是 `FrontendGateway.read/observe`。
 * event 从不作为事实使用：只使当前 snapshot 失效并请求新的 authoritative read。
 */
export class ReadOnlyWorkbenchSession {
  private readonly listeners = new Set<Listener>();
  private readonly gateway: FrontendGateway;
  private readonly unlisten: () => void;
  private workbenchGeneration = 0;
  private locatorGeneration = 0;
  /** event 后 UI 不保留旧 facts；仅保留 native identity 供新 snapshot 成功时重绑。 */
  private pendingRereadSelection: ReadOnlyRow | null = null;
  private disposed = false;
  private state: ReadOnlyWorkbenchState = {
    loadState: { kind: 'loading' },
    assetType: 'skill',
    viewContext: { kind: 'all' },
    presentation: DEFAULT_LIST_PRESENTATION,
    availableProjectIds: [],
    selected: null,
    detailError: null,
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

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.workbenchGeneration += 1;
    this.locatorGeneration += 1;
    this.unlisten();
    this.listeners.clear();
  }

  dispatch(action: ReadOnlyWorkbenchAction): void {
    if (this.disposed) return;
    switch (action.kind) {
      case 'selectAssetType':
        this.pendingRereadSelection = null;
        this.update({
          assetType: action.assetType,
          selected: null,
          detailError: null,
          presentation: this.resetPage(),
        });
        this.refresh(true);
        return;
      case 'selectViewContext':
        this.pendingRereadSelection = null;
        this.update({
          viewContext: action.viewContext,
          selected: null,
          detailError: null,
          presentation: this.resetPage(),
        });
        this.refresh(true);
        return;
      case 'setFilters':
        this.pendingRereadSelection = null;
        this.update({
          filters: action.filters,
          selected: null,
          detailError: null,
          presentation: this.resetPage(),
        });
        this.refresh(true);
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
        this.pendingRereadSelection = null;
        this.update({ selected: action.row, detailError: null });
        return;
      case 'openLocator':
        this.locatorGeneration += 1;
        this.update({ locator: { kind: 'open', searchText: '', snapshot: null } });
        return;
      case 'closeLocator':
        this.locatorGeneration += 1;
        this.update({ locator: { kind: 'closed' } });
        return;
      case 'setLocatorSearch': {
        if (this.state.locator.kind !== 'open') return;
        const locatorGeneration = ++this.locatorGeneration;
        this.update({ locator: { kind: 'open', searchText: action.searchText, snapshot: null } });
        if (action.searchText.trim() !== '') this.readLocator(action.searchText, locatorGeneration);
        return;
      }
      case 'selectLocatorResult':
        this.locatorGeneration += 1;
        if (action.result.destination.kind !== 'skillDetail') {
          this.pendingRereadSelection = null;
          const assetRef = action.result.destination.assetRef;
          this.update({
            assetType: assetRef.assetType,
            viewContext: action.result.destinationViewContext,
            selected: null,
            detailError: {
              assetRef,
              reasonCode: action.result.destination.reasonCode as ReasonCode,
              message: '此只读资产没有可用的 FE-01 只读详情。',
            },
            locator: { kind: 'closed' },
            presentation: this.resetPage(),
          });
          this.refresh(true);
          return;
        }
        this.pendingRereadSelection = null;
        this.update({
          assetType: action.result.destination.assetRef.assetType,
          viewContext: action.result.destinationViewContext,
          selected: action.result,
          detailError: null,
          locator: { kind: 'closed' },
          presentation: this.resetPage(),
        });
        this.refresh(true);
        return;
      case 'retry':
        this.refresh(true);
        return;
    }
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
      });
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
        this.pendingRereadSelection = null;
        this.update({
          loadState: { kind: 'failed', reasonCode: result.reasonCode, message: result.message },
          selected: null,
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
                selectedBeforeReread !== null && sameAssetIdentity(row, selectedBeforeReread),
            ) ?? null)
          : null;
      this.pendingRereadSelection = null;
      this.update({
        loadState,
        selected,
        availableProjectIds,
        presentation:
          projected.page === this.state.presentation.page
            ? this.state.presentation
            : { ...this.state.presentation, page: projected.page },
      });
    });
  }

  private invalidateAndReread(): void {
    // event 不携带事实：到达瞬间先失效旧 snapshot/cells，后续仅接受新 read。
    this.workbenchGeneration += 1;
    // locator snapshot 同样不是权威事实；若用户正在搜索，保留输入和 open state，
    // 立即清空旧结果并用同一 searchText 发起新的 authoritative read。
    const locatorSearchText =
      this.state.locator.kind === 'open' && this.state.locator.searchText.trim() !== ''
        ? this.state.locator.searchText
        : null;
    const locatorGeneration = ++this.locatorGeneration;
    this.pendingRereadSelection = this.state.selected;
    this.update({
      loadState: { kind: 'loading' },
      selected: null,
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
    void this.gateway
      .read({
        kind: 'globalLocator',
        searchText,
        assetTypes: ['skill', 'longTermInstruction', 'subagent'],
      })
      .then((result) => {
        if (
          this.disposed ||
          generation !== this.locatorGeneration ||
          this.state.locator.kind !== 'open' ||
          this.state.locator.searchText !== searchText
        )
          return;
        if (result.kind === 'readSucceeded') {
          this.update({ locator: { kind: 'open', searchText, snapshot: result.snapshot } });
        } else {
          this.update({
            locator: {
              kind: 'open',
              searchText,
              snapshot: null,
              error: { kind: 'readFailed', reasonCode: result.reasonCode, message: result.message },
            },
          });
        }
      });
  }

  private update(patch: Partial<ReadOnlyWorkbenchState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private resetPage(): ListPresentationState {
    return { ...this.state.presentation, page: 1 };
  }
}
