import type { WorkspaceSession, WorkspaceViewState } from '../session/WorkspaceSession';
import type {
  AgentId,
  AssetGroupBy,
  AssetListSnapshot,
  AssetScope,
  AssetStatusFilter,
} from '../contract/types';
import { agentLabel, groupByLabel, scopeLabel, statusFilterLabel } from './labels';

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
const GROUP_BY_OPTIONS: AssetGroupBy[] = ['none', 'agent', 'project', 'scope', 'source', 'status'];

/** 从当前列表 snapshot 推导筛选选项（无 snapshot 时为空集合，控件仍可用） */
function currentList(state: WorkspaceViewState): AssetListSnapshot | null {
  const loadState = state.loadState;
  return loadState.kind === 'ready' || loadState.kind === 'empty' || loadState.kind === 'stale'
    ? loadState.list
    : null;
}

function projectOptions(list: AssetListSnapshot | null): string[] {
  const names = new Set<string>();
  for (const asset of list?.assets ?? []) {
    if (asset.contextHint.kind === 'project') {
      names.add(asset.contextHint.projectName);
    }
  }
  return [...names];
}

interface SourceOption {
  id: string;
  label: string;
}

function sourceOptions(list: AssetListSnapshot | null): SourceOption[] {
  const byId = new Map<string, string>();
  for (const asset of list?.assets ?? []) {
    if (!byId.has(asset.sourceTier.id)) {
      byId.set(asset.sourceTier.id, asset.sourceTier.label);
    }
  }
  return [...byId.entries()].map(([id, label]) => ({ id, label }));
}

/** 搜索框 + 显式范围切换 + 筛选控件（Agent / 项目 / 作用域 / 来源 / 状态）+ 分组，同区呈现 */
export function Toolbar({
  session,
  state,
}: {
  session: WorkspaceSession;
  state: WorkspaceViewState;
}) {
  const list = currentList(state);
  const projects = projectOptions(list);
  const sources = sourceOptions(list);
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
        <label htmlFor="filter-project" className="toolbar-label">
          项目
        </label>
        <select
          id="filter-project"
          value={state.filters.projects[0] ?? ''}
          onChange={(event) =>
            session.dispatch({
              kind: 'setFilters',
              filters: { projects: event.target.value === '' ? [] : [event.target.value] },
            })
          }
        >
          <option value="">全部</option>
          {projects.map((project) => (
            <option key={project} value={project}>
              {project}
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
        <label htmlFor="filter-source" className="toolbar-label">
          来源
        </label>
        <select
          id="filter-source"
          value={state.filters.sources[0] ?? ''}
          onChange={(event) =>
            session.dispatch({
              kind: 'setFilters',
              filters: { sources: event.target.value === '' ? [] : [event.target.value] },
            })
          }
        >
          <option value="">全部</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
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
        <label htmlFor="group-by" className="toolbar-label">
          分组
        </label>
        <select
          id="group-by"
          value={state.groupBy}
          onChange={(event) =>
            session.dispatch({
              kind: 'setGroupBy',
              groupBy: event.target.value as AssetGroupBy,
            })
          }
        >
          {GROUP_BY_OPTIONS.map((groupBy) => (
            <option key={groupBy} value={groupBy}>
              {groupByLabel(groupBy)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
