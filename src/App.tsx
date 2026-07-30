import { useSyncExternalStore } from 'react';
import type { WorkspaceSession } from './session/WorkspaceSession';
import { TopNav } from './ui/TopNav';
import { Toolbar } from './ui/Toolbar';
import { AssetList } from './ui/AssetList';
import { DetailPanel } from './ui/DetailPanel';
import { reasonCodeExplanation } from './ui/labels';

/**
 * 工作台根组件：只 dispatch 可见用户动作并从 session snapshot 渲染。
 * 五态可见区分：loading 保留骨架 / ready / empty 解释范围 / stale 过期提示 /
 * failed 稳定原因 + 重试。
 */
export function App({ session }: { session: WorkspaceSession }) {
  const state = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
  );
  const { loadState } = state;

  return (
    <div className="workbench">
      <TopNav session={session} state={state} />
      <Toolbar session={session} state={state} />
      <div className="workbench-main">
        <div className="list-pane">
          {loadState.kind === 'loading' && (
            <div className="state-loading" aria-busy="true" aria-label="正在加载资产列表">
              <div className="skeleton-row" />
              <div className="skeleton-row" />
              <div className="skeleton-row" />
              <p>正在加载资产…</p>
            </div>
          )}
          {loadState.kind === 'failed' && (
            <div role="alert" className="state-failed">
              <p>资产列表读取失败：{reasonCodeExplanation(loadState.reasonCode)}</p>
              <p className="reason-code">原因码：{loadState.reasonCode}</p>
              {loadState.recoveryAction?.kind === 'retryRead' && (
                <button
                  type="button"
                  onClick={() => session.dispatch({ kind: 'retryFailedRead', target: 'list' })}
                >
                  重试
                </button>
              )}
            </div>
          )}
          {loadState.kind === 'empty' && (
            <div className="state-empty">
              <p>当前范围内没有匹配的资产。</p>
              <p className="state-empty-hint">
                范围：
                {state.searchScope === 'allAssets' ? '全部资产' : '当前资产类型'}
                {state.searchText.trim() !== '' && ` · 搜索：“${state.searchText}”`}
                。可调整搜索词、范围或筛选条件。
              </p>
            </div>
          )}
          {(loadState.kind === 'ready' || loadState.kind === 'stale') && (
            <>
              {loadState.kind === 'stale' && (
                <div role="status" className="state-stale">
                  <span aria-hidden="true">⚠ </span>
                  索引已过期，结果可能不是最新。最近更新：
                  <time dateTime={loadState.list.indexUpdatedAt}>
                    {loadState.list.indexUpdatedAt}
                  </time>
                </div>
              )}
              <AssetList session={session} state={state} list={loadState.list} />
            </>
          )}
        </div>
        <DetailPanel session={session} state={state} />
      </div>
    </div>
  );
}
