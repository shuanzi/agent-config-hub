/**
 * L2 测试入口：挂载与生产相同的 App，但强制使用按 URL `scenario` 参数
 * 脚本化的 ScriptedMockGateway（production index.html 不引用本文件）。
 * 同时把 mock 调用记录暴露到 window.__fx01，供旅程断言“只有 read”。
 *
 * PF-01 扩展（additive，只在 ?scenario=perf-catalog 时激活）：
 * - mock 切换为 perf-catalog 合成目录（?perfProfile=stress 选择 stress profile）；
 * - window.__pf01 暴露采样桥：startup 首屏可见耗时（User Timing）、
 *   期望行数计算与搜索 dispatch（供性能探针记点，不含资产名/搜索词于指标名）。
 */
import { createRoot } from 'react-dom/client';
import { ScriptedMockGateway, type RecordedReadCall } from '../../src/gateway/mock';
import type { AgentId, AssetScope, AssetStatusFilter } from '../../src/contract/types';
import {
  ReadOnlyWorkbenchSession,
  type ReadOnlyWorkbenchState,
} from '../../src/session/ReadOnlyWorkbenchSession';
import { App } from '../../src/App';
import { canRecordPf01Startup } from './pf01-startup-eligibility';
import '../../src/ui/workbench.css';

interface Pf01ListCondition {
  searchText?: string;
  agents?: AgentId[];
  scopes?: AssetScope[];
  statuses?: AssetStatusFilter[];
}

interface Pf01Bridge {
  /** 入口模块求值 → 首屏列表首次 ready 的毫秒数（未 ready 时为 null） */
  getStartupMs: () => number | null;
  /** 当前资产类型（skills）+ 给定条件下的期望行数 */
  countList: (condition: Pf01ListCondition) => number | null;
  /** 打开 locator 但不产生搜索结果，供搜索性能探针先绑定 DOM。 */
  openLocator: () => void;
  /** 以单次 dispatch 表达搜索 intent（避免多键入与输入延迟混入测量） */
  dispatchSearch: (searchText: string) => void;
}

declare global {
  interface Window {
    __fx01?: {
      getCalls: () => RecordedReadCall[];
      getObserveCallCount: () => number;
      emitWorkspaceInvalidation: () => void;
      getLocator: () => ReadOnlyWorkbenchState['locator'];
    };
    __pf01?: Pf01Bridge;
  }
}

const params = new URLSearchParams(window.location.search);
const scenario = params.get('scenario');
const startupRowsHidden = params.get('startupRowsHidden') === '1';
const PF01_STARTUP_ROW_SELECTOR = '.list-pane [role="option"]';

function firstScreenStartupRowIsVisible(): boolean {
  const row = document.querySelector<HTMLElement>(PF01_STARTUP_ROW_SELECTOR);
  if (row === null || !row.isConnected) return false;
  const style = window.getComputedStyle(row);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    style.opacity === '0'
  ) {
    return false;
  }
  const rect = row.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

const mock = new ScriptedMockGateway();
let session: ReadOnlyWorkbenchSession;
let startupMs: number | null = null;

if (scenario === 'perf-catalog') {
  if (startupRowsHidden) {
    const style = document.createElement('style');
    style.dataset.testid = 'pf01-startup-hidden';
    style.textContent = '.list-pane [role="option"] { display: none !important; }';
    document.head.append(style);
  }
  // User Timing 起点：入口模块求值时刻（navigation 之后的最早可记点）
  const entryAt = performance.now();
  mock.enablePerfCatalog(params.get('perfProfile') === 'stress' ? 'stress' : 'representative');
  session = new ReadOnlyWorkbenchSession(mock);
  let startupFrame: number | null = null;
  let startupTimer: number | null = null;
  let unsubscribeStartup = () => {};
  const clearScheduledStartupCheck = () => {
    if (startupFrame !== null) cancelAnimationFrame(startupFrame);
    if (startupTimer !== null) window.clearTimeout(startupTimer);
    startupFrame = null;
    startupTimer = null;
  };
  const scheduleStartupVisibilityCheck = () => {
    if (startupMs !== null || startupFrame !== null || startupTimer !== null) return;
    const checkStartupVisibility = () => {
      clearScheduledStartupCheck();
      const loadState = session.getSnapshot().loadState;
      const aggregateTotal =
        loadState.kind === 'ready' || loadState.kind === 'stale'
          ? loadState.snapshot.aggregateTotal
          : 0;
      if (
        !canRecordPf01Startup({
          loadState: loadState.kind,
          aggregateTotal,
          representativeRowVisible: firstScreenStartupRowIsVisible(),
        })
      ) {
        if ((loadState.kind === 'ready' || loadState.kind === 'stale') && aggregateTotal > 0) {
          scheduleStartupVisibilityCheck();
        }
        return;
      }
      startupMs = performance.now() - entryAt;
      unsubscribeStartup();
    };
    startupFrame = requestAnimationFrame(checkStartupVisibility);
    // WDIO 会并发运行浏览器；后台页的 rAF 可被无限期节流。计时器仍只在
    // `firstScreenStartupRowIsVisible` 判真后写入，避免因此放宽首屏可见语义。
    startupTimer = window.setTimeout(checkStartupVisibility, 50);
  };
  unsubscribeStartup = session.subscribe(scheduleStartupVisibilityCheck);
  window.__pf01 = {
    getStartupMs: () => startupMs,
    countList: (condition) =>
      condition.searchText === undefined
        ? mock.perfWorkbenchVisibleCount({
            kind: 'workbench',
            assetType: 'skill',
            viewContext: { kind: 'all' },
            filters: { agents: condition.agents, statuses: condition.statuses },
          })
        : mock.perfLocatorCount(condition.searchText),
    dispatchSearch: (searchText) => {
      session.dispatch({ kind: 'openLocator' });
      session.dispatch({ kind: 'setLocatorSearch', searchText });
    },
    openLocator: () => session.dispatch({ kind: 'openLocator' }),
  };
  mount(session);
} else {
  mock.applyScenario(scenario);
  session = new ReadOnlyWorkbenchSession(mock);
  mount(session);
}

function mount(session: ReadOnlyWorkbenchSession): void {
  const container = document.getElementById('root');
  if (container === null) {
    throw new Error('缺少 #root 挂载点');
  }
  createRoot(container).render(<App session={session} />);
}

window.__fx01 = {
  getCalls: () => mock.getCallLog(),
  getObserveCallCount: () => mock.getObserveCallCount(),
  emitWorkspaceInvalidation: () => {
    mock.simulateExternalChange();
    mock.emitEvent({ kind: 'assetsInvalidated', assetType: 'skill' });
  },
  getLocator: () => session.getSnapshot().locator,
};
