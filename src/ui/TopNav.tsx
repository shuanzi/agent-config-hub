import type { WorkspaceSession, WorkspaceViewState } from '../session/WorkspaceSession';
import type { AssetType } from '../contract/types';
import { assetTypeLabel } from './labels';

const ASSET_TYPES: AssetType[] = ['skill', 'longTermInstruction', 'subagent', 'hook'];

/** 一级导航：仅 Skills / 长期指令 / Subagents / Hooks（tab 语义） */
export function TopNav({
  session,
  state,
}: {
  session: WorkspaceSession;
  state: WorkspaceViewState;
}) {
  return (
    <nav aria-label="资产类型" className="top-nav">
      <div className="tablist" role="tablist" aria-label="一级资产类型">
        {ASSET_TYPES.map((assetType) => {
          const selected = state.assetType === assetType;
          return (
            <button
              key={assetType}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? 'tab tab-selected' : 'tab'}
              onClick={() => session.dispatch({ kind: 'selectAssetType', assetType })}
            >
              {assetTypeLabel(assetType)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
