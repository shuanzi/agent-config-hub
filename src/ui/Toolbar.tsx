import type { WorkspaceSession, WorkspaceViewState } from '../session/WorkspaceSession';
import type { AgentId, AssetScope, AssetStatusFilter } from '../contract/types';
import { agentLabel, scopeLabel, statusFilterLabel } from './labels';

const AGENTS: AgentId[] = ['claude-code', 'codex', 'gemini-cli', 'opencode'];
const SCOPES: AssetScope[] = ['global', 'project'];
const STATUSES: AssetStatusFilter[] = [
  'editable',
  'readOnly',
  'incompatible',
  'normal',
  'overridden',
  'conflict',
  'drift',
];

/** 搜索框 + 显式范围切换 + 最小筛选控件（Agent / 作用域 / 状态），同区呈现 */
export function Toolbar({
  session,
  state,
}: {
  session: WorkspaceSession;
  state: WorkspaceViewState;
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <label htmlFor="asset-search" className="toolbar-label">
          搜索
        </label>
        <input
          id="asset-search"
          type="search"
          value={state.searchText}
          placeholder="按名称搜索资产"
          onChange={(event) =>
            session.dispatch({ kind: 'setSearchText', searchText: event.target.value })
          }
        />
        <fieldset className="scope-toggle">
          <legend>搜索范围</legend>
          <label>
            <input
              id="scope-current"
              type="radio"
              name="search-scope"
              checked={state.searchScope === 'currentAssetType'}
              onChange={() => session.dispatch({ kind: 'setScope', scope: 'currentAssetType' })}
            />
            当前资产类型
          </label>
          <label>
            <input
              id="scope-all"
              type="radio"
              name="search-scope"
              checked={state.searchScope === 'allAssets'}
              onChange={() => session.dispatch({ kind: 'setScope', scope: 'allAssets' })}
            />
            全部资产
          </label>
        </fieldset>
      </div>
      <div className="toolbar-row" role="group" aria-label="筛选">
        <label htmlFor="filter-agent" className="toolbar-label">
          Agent
        </label>
        <select
          id="filter-agent"
          value={state.filters.agents[0] ?? ''}
          onChange={(event) =>
            session.dispatch({
              kind: 'setFilters',
              filters: {
                agents: event.target.value === '' ? [] : [event.target.value as AgentId],
              },
            })
          }
        >
          <option value="">全部</option>
          {AGENTS.map((agent) => (
            <option key={agent} value={agent}>
              {agentLabel(agent)}
            </option>
          ))}
        </select>
        <label htmlFor="filter-scope" className="toolbar-label">
          作用域
        </label>
        <select
          id="filter-scope"
          value={state.filters.scopes[0] ?? ''}
          onChange={(event) =>
            session.dispatch({
              kind: 'setFilters',
              filters: {
                scopes: event.target.value === '' ? [] : [event.target.value as AssetScope],
              },
            })
          }
        >
          <option value="">全部</option>
          {SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {scopeLabel(scope)}
            </option>
          ))}
        </select>
        <label htmlFor="filter-status" className="toolbar-label">
          状态
        </label>
        <select
          id="filter-status"
          value={state.filters.statuses[0] ?? ''}
          onChange={(event) =>
            session.dispatch({
              kind: 'setFilters',
              filters: {
                statuses:
                  event.target.value === '' ? [] : [event.target.value as AssetStatusFilter],
              },
            })
          }
        >
          <option value="">全部</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusFilterLabel(status)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
