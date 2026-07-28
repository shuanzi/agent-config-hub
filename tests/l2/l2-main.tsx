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
import { WorkspaceSession } from '../../src/session/WorkspaceSession';
import { App } from '../../src/App';
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
  /** 以单次 dispatch 表达搜索 intent（避免多键入与输入延迟混入测量） */
  dispatchSearch: (searchText: string) => void;
}

declare global {
  interface Window {
    __fx01?: {
      getCalls: () => RecordedReadCall[];
      getObserveCallCount: () => number;
    };
    __pf01?: Pf01Bridge;
  }
}

const params = new URLSearchParams(window.location.search);
const scenario = params.get('scenario');

const mock = new ScriptedMockGateway();
let startupMs: number | null = null;

if (scenario === 'perf-catalog') {
  // User Timing 起点：入口模块求值时刻（navigation 之后的最早可记点）
  const entryAt = performance.now();
  mock.enablePerfCatalog(params.get('perfProfile') === 'stress' ? 'stress' : 'representative');
  const session = new WorkspaceSession(mock);
  const unsubscribe = session.subscribe(() => {
    const loadState = session.getSnapshot().loadState;
    if ((loadState.kind === 'ready' || loadState.kind === 'stale') && startupMs === null) {
      startupMs = performance.now() - entryAt;
      unsubscribe();
    }
  });
  window.__pf01 = {
    getStartupMs: () => startupMs,
    countList: (condition) =>
      mock.perfListCount({
        kind: 'assetList',
        scope: { kind: 'currentAssetType', assetType: 'skill' },
        searchText: condition.searchText,
        filters: {
          agents: condition.agents,
          scopes: condition.scopes,
          statuses: condition.statuses,
        },
      }),
    dispatchSearch: (searchText) => session.dispatch({ kind: 'setSearchText', searchText }),
  };
  mount(session);
} else {
  mock.applyScenario(scenario);
  const session = new WorkspaceSession(mock);
  mount(session);
}

function mount(session: WorkspaceSession): void {
  const container = document.getElementById('root');
  if (container === null) {
    throw new Error('缺少 #root 挂载点');
  }
  createRoot(container).render(<App session={session} />);
}

window.__fx01 = {
  getCalls: () => mock.getCallLog(),
  getObserveCallCount: () => mock.getObserveCallCount(),
};
