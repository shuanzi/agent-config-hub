import type { WorkspaceSession, WorkspaceViewState } from '../session/WorkspaceSession';
import type { AssetGroupBy, AssetListSnapshot, AssetSummary } from '../contract/types';
import { agentLabel, anomalyLabel, scopeLabel } from './labels';

function AssetRow({
  session,
  summary,
  selected,
}: {
  session: WorkspaceSession;
  summary: AssetSummary;
  selected: boolean;
}) {
  const select = () => session.dispatch({ kind: 'selectAsset', asset: summary.asset });
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={selected ? 'asset-row asset-row-selected' : 'asset-row'}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      }}
    >
      <div className="asset-row-line1">
        <span className="asset-name">{summary.displayName}</span>
        {summary.anomalies.map((anomaly) => (
          <span key={anomaly.kind} className="anomaly" role="note">
            <span aria-hidden="true">⚠ </span>
            {anomalyLabel(anomaly.kind)}：{anomaly.message}
          </span>
        ))}
      </div>
      <div className="asset-row-line2">
        <span>{summary.agents.join('、')}</span>
        <span aria-label="作用域">{scopeLabel(summary.scope)}</span>
        <span className="context-hint">
          {summary.contextHint.kind === 'project'
            ? summary.contextHint.projectName
            : summary.contextHint.pathHint}
        </span>
      </div>
    </li>
  );
}

interface AssetGroup {
  key: string;
  label: string;
  assets: AssetSummary[];
}

/** 分组值从 snapshot 资产推导；无项目上下文的资产归入“无项目”组 */
function groupOf(summary: AssetSummary, groupBy: Exclude<AssetGroupBy, 'none'>): AssetGroup {
  switch (groupBy) {
    case 'agent': {
      const label = summary.agents.map(agentLabel).join('、');
      return { key: `agent:${summary.agents.join(',')}`, label, assets: [] };
    }
    case 'project':
      return summary.contextHint.kind === 'project'
        ? {
            key: `project:${summary.contextHint.projectName}`,
            label: summary.contextHint.projectName,
            assets: [],
          }
        : { key: 'project:', label: '无项目', assets: [] };
    case 'scope':
      return { key: `scope:${summary.scope}`, label: scopeLabel(summary.scope), assets: [] };
    case 'source':
      return {
        key: `source:${summary.sourceTier.id}`,
        label: summary.sourceTier.label,
        assets: [],
      };
    case 'status': {
      if (summary.availability.kind === 'disabled') {
        return { key: 'status:incompatible', label: '不兼容', assets: [] };
      }
      const anomaly = summary.anomalies[0];
      return anomaly === undefined
        ? { key: 'status:normal', label: '正常', assets: [] }
        : { key: `status:${anomaly.kind}`, label: anomalyLabel(anomaly.kind), assets: [] };
    }
  }
}

function buildGroups(assets: AssetSummary[], groupBy: Exclude<AssetGroupBy, 'none'>): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();
  for (const summary of assets) {
    const group = groupOf(summary, groupBy);
    const existing = groups.get(group.key);
    if (existing === undefined) {
      group.assets.push(summary);
      groups.set(group.key, group);
    } else {
      existing.assets.push(summary);
    }
  }
  return [...groups.values()];
}

/** 两行资产列表：整行选择，选中行 aria-selected；groupBy 非 none 时按维度渲染分组标题 */
export function AssetList({
  session,
  state,
  list,
}: {
  session: WorkspaceSession;
  state: WorkspaceViewState;
  list: AssetListSnapshot;
}) {
  const renderRow = (summary: AssetSummary) => (
    <AssetRow
      key={summary.asset.assetId}
      session={session}
      summary={summary}
      selected={state.selectedAsset?.assetId === summary.asset.assetId}
    />
  );

  if (state.groupBy === 'none') {
    return (
      <ul role="listbox" aria-label="资产列表" className="asset-list">
        {list.assets.map(renderRow)}
      </ul>
    );
  }

  const groups = buildGroups(list.assets, state.groupBy);
  return (
    <ul role="listbox" aria-label="资产列表" className="asset-list">
      {groups.map((group) => (
        <li key={group.key} role="presentation" className="asset-group">
          <h3 className="asset-group-heading">{group.label}</h3>
          <ul role="group" aria-label={group.label} className="asset-group-items">
            {group.assets.map(renderRow)}
          </ul>
        </li>
      ))}
    </ul>
  );
}
