import type { WorkspaceSession, WorkspaceViewState } from '../session/WorkspaceSession';
import type { NativeFileSnapshot } from '../contract/types';
import { compatibilityLabel, reasonCodeExplanation, scopeLabel } from './labels';

function StructuredViewDisabled({ file }: { file: NativeFileSnapshot }) {
  if (file.structuredView.kind !== 'disabled') {
    return null;
  }
  const reason = reasonCodeExplanation(file.structuredView.reasonCode);
  return (
    <span className="structured-toggle">
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={`结构化视图不可用：${reason}（原因码：${file.structuredView.reasonCode}）`}
      >
        结构化
      </button>
      <span className="structured-reason">结构化视图不可用：{reason}</span>
    </span>
  );
}

/** 详情区：原位更新；默认只读源码视图（磁盘内容）+ 关键状态区 + 检查器摘要 */
export function DetailPanel({
  session,
  state,
}: {
  session: WorkspaceSession;
  state: WorkspaceViewState;
}) {
  const detail = state.detail;
  if (detail.kind === 'idle') {
    return (
      <section className="detail-panel" aria-label="资产详情">
        <p className="detail-hint">在左侧选择一个资产以查看其磁盘源码与状态。</p>
      </section>
    );
  }
  if (detail.kind === 'loading') {
    return (
      <section className="detail-panel" aria-label="资产详情" aria-busy="true">
        <p className="detail-hint">正在读取资产详情…</p>
      </section>
    );
  }
  if (detail.kind === 'failed') {
    return (
      <section className="detail-panel" aria-label="资产详情">
        <div role="alert" className="state-failed">
          <p>详情读取失败：{reasonCodeExplanation(detail.reasonCode)}</p>
          <p className="reason-code">原因码：{detail.reasonCode}</p>
          {detail.recoveryAction?.kind === 'retryRead' && (
            <button
              type="button"
              onClick={() => session.dispatch({ kind: 'retryFailedRead', target: 'detail' })}
            >
              重试
            </button>
          )}
        </div>
      </section>
    );
  }

  const { detail: assetDetail, inspector, revision } = detail.detail;
  const file = detail.file;
  return (
    <section className="detail-panel" aria-label="资产详情">
      <header className="detail-header">
        <h2>{assetDetail.displayName}</h2>
        <span className="disk-badge">磁盘内容</span>
        <div className="view-toggle" role="group" aria-label="内容视图">
          <button type="button" aria-pressed="true" className="view-active">
            源码
          </button>
          <StructuredViewDisabled file={file} />
        </div>
      </header>

      {file.content.kind === 'source' ? (
        <pre className="source-view" aria-label="源码（磁盘内容，已遮蔽敏感值）">
          {file.content.maskedText}
        </pre>
      ) : (
        <p className="detail-hint">
          {file.content.reason}（原因码：{file.content.reasonCode}）
        </p>
      )}

      <section className="status-area" aria-label="关键状态">
        <h3>关键状态</h3>
        <dl>
          <div>
            <dt>兼容状态</dt>
            <dd>{compatibilityLabel(assetDetail.compatibility)}</dd>
          </div>
          <div>
            <dt>修订</dt>
            <dd className="revision">{revision}</dd>
          </div>
        </dl>
      </section>

      <section className="inspector" aria-label="检查器">
        <h3>检查器</h3>
        <dl>
          <div>
            <dt>Agent</dt>
            <dd>{inspector.agents.join('、')}</dd>
          </div>
          <div>
            <dt>作用域</dt>
            <dd>{scopeLabel(inspector.scope)}</dd>
          </div>
          <div>
            <dt>生效上下文</dt>
            <dd>
              <ul>
                {inspector.effectiveContexts.map((context) => (
                  <li key={`${context.agent}-${context.scope}-${context.precedence}`}>
                    {context.agent} · {scopeLabel(context.scope)} · {context.sourceTierLabel}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>路径</dt>
            <dd className="path-display">{inspector.pathDisplay}</dd>
          </div>
        </dl>
      </section>
    </section>
  );
}
