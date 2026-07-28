import type { WorkspaceSession, WorkspaceViewState } from '../session/WorkspaceSession';
import type { AssetListSnapshot, AssetSummary } from '../contract/types';
import { anomalyLabel, scopeLabel } from './labels';

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

/** 两行资产列表：整行选择，选中行 aria-selected */
export function AssetList({
  session,
  state,
  list,
}: {
  session: WorkspaceSession;
  state: WorkspaceViewState;
  list: AssetListSnapshot;
}) {
  return (
    <ul role="listbox" aria-label="资产列表" className="asset-list">
      {list.assets.map((summary) => (
        <AssetRow
          key={summary.asset.assetId}
          session={session}
          summary={summary}
          selected={state.selectedAsset?.assetId === summary.asset.assetId}
        />
      ))}
    </ul>
  );
}
