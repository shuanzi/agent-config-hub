import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

import type {
  ReadOnlyWorkbenchSession,
  ReadOnlyWorkbenchState,
} from '../session/ReadOnlyWorkbenchSession';
import {
  AGENT_ORDER,
  MVP_ASSET_TYPES,
  projectWorkbenchProjection,
  type MvpAssetType,
  type ReadOnlyRow,
  type ViewContext,
} from '../workbench/read-only-model';

const typeLabel: Record<MvpAssetType, string> = {
  skill: 'Skills',
  longTermInstruction: '长期指令',
  subagent: 'Subagents',
};

function stateLabel(state: ReadOnlyWorkbenchState): string {
  if (state.loadState.kind === 'failed') return `读取失败：${state.loadState.reasonCode}`;
  if (state.loadState.kind === 'loading') return '正在读取资产…';
  if (state.loadState.kind === 'empty') return '当前范围内没有匹配的资产。';
  if (state.loadState.kind === 'stale') return '索引已过期，正在显示最近的权威读取。';
  return '';
}

function SegmentList({
  session,
  state,
}: {
  session: ReadOnlyWorkbenchSession;
  state: ReadOnlyWorkbenchState;
}) {
  const snapshot =
    state.loadState.kind === 'ready' ||
    state.loadState.kind === 'empty' ||
    state.loadState.kind === 'stale'
      ? state.loadState.snapshot
      : null;
  if (snapshot === null) return null;
  const projection = projectWorkbenchProjection(snapshot, state.presentation);
  const rowIdentity = (row: ReadOnlyRow) => {
    const ownership = row.assetRef.nativeOwnership;
    return [
      row.assetRef.assetId,
      row.assetRef.assetType,
      row.assetRef.nativeUnitRef,
      row.assetRef.adapterIdentity,
      ownership.kind,
      ownership.kind === 'project' ? ownership.projectId : '',
    ].join('\u0000');
  };
  return (
    <div className="readonly-segment-list list-pane" aria-label="只读资产列表">
      <p aria-label="结果总数">共 {projection.aggregateTotal} 项</p>
      {snapshot.findings.map((finding) => (
        <p key={`${finding.assetId}-${finding.reasonCode}`} role="status">
          适用性未解析：{finding.reasonCode}
        </p>
      ))}
      {projection.segments.map((segment) => (
        <section key={segment.id} className="readonly-segment" aria-label={segment.displayLabel}>
          <h2>{segment.displayLabel}</h2>
          <ul role="listbox" aria-label={`${segment.displayLabel} 资产`}>
            {segment.rows.map((row) => (
              <li key={rowIdentity(row)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={
                    state.selected !== null && rowIdentity(state.selected) === rowIdentity(row)
                  }
                  onClick={() => session.dispatch({ kind: 'selectRow', row })}
                >
                  <span>{row.displayName}</span>
                  {row.redactedSummary !== undefined && <small>{row.redactedSummary}</small>}
                  <small>{row.nativeOwnership?.kind === 'global' ? '全局' : '项目'}</small>
                  {row.ownershipHint !== undefined && <small>{row.ownershipHint}</small>}
                  {row.sourceTierLabel !== undefined && <small>{row.sourceTierLabel}</small>}
                  <small>{row.agents?.join('、')}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <nav aria-label="全局分页">
        <button
          type="button"
          disabled={projection.page <= 1}
          onClick={() => session.dispatch({ kind: 'setPage', page: projection.page - 1 })}
        >
          上一页
        </button>
        <span>
          第 {projection.page} / {projection.pageCount} 页
        </span>
        <button
          type="button"
          disabled={projection.page >= projection.pageCount}
          onClick={() => session.dispatch({ kind: 'setPage', page: projection.page + 1 })}
        >
          下一页
        </button>
      </nav>
    </div>
  );
}

function SkillCells({
  row,
  headingRef,
}: {
  row: ReadOnlyRow;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  if (row.skillTargetStates === undefined) return null;
  const cells = new Map(row.skillTargetStates.map((cell) => [cell.agent, cell]));
  return (
    <section className="skill-target-cells" aria-label="Skill Agent 状态（只读）">
      <h2 ref={headingRef} tabIndex={-1} data-testid="skill-detail-heading">
        Skill 详情：{row.displayName}
      </h2>
      <div className="skill-target-grid">
        {AGENT_ORDER.map((agent) => {
          const cell = cells.get(agent);
          const presence = cell?.presence ?? 'unknown';
          const activation = cell?.activation ?? 'unknown';
          const applicability = cell?.applicability ?? 'unknown';
          const stableReason =
            cell?.stableReason ?? (cell === undefined ? 'UNKNOWN_FIELD_PRESERVED' : undefined);
          return (
            <article key={agent} aria-label={`${agent} 状态`}>
              <h3>{agent}</h3>
              <p>存在：{presence}</p>
              <p>激活：{activation}</p>
              <p>适用性：{applicability}</p>
              {stableReason !== undefined && <p>原因：{stableReason}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Locator({
  session,
  state,
  onClose,
  errorHeadingRef,
}: {
  session: ReadOnlyWorkbenchSession;
  state: ReadOnlyWorkbenchState;
  onClose: () => void;
  errorHeadingRef: RefObject<HTMLHeadingElement>;
}) {
  if (state.locator.kind !== 'open') return null;
  return (
    <section
      className="global-locator"
      role="dialog"
      aria-label="全局搜索"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <label htmlFor="global-locator-input">全局搜索</label>
      <input
        id="global-locator-input"
        autoFocus
        value={state.locator.searchText}
        onChange={(event) =>
          session.dispatch({ kind: 'setLocatorSearch', searchText: event.target.value })
        }
      />
      {state.locator.error !== undefined && (
        <section role="alert" aria-label="全局搜索错误">
          <h2 ref={errorHeadingRef} tabIndex={-1} data-testid="locator-error-heading">
            {state.locator.error.kind === 'readFailed' ? '全局搜索读取失败' : '无法打开只读详情'}
          </h2>
          <p>{state.locator.error.reasonCode}</p>
          <p>{state.locator.error.message}</p>
        </section>
      )}
      {state.locator.searchText.trim() === '' && <p>输入搜索词</p>}
      {state.locator.snapshot?.groups.map((group) => (
        <section key={group.assetType} aria-label={typeLabel[group.assetType]}>
          <h2>
            {typeLabel[group.assetType]} · {group.count}
          </h2>
          {group.results.map((row) => (
            <button
              key={`${row.assetRef.assetId}\u0000${row.assetRef.nativeUnitRef}`}
              type="button"
              data-testid="locator-result"
              onClick={() =>
                session.dispatch({
                  kind: 'selectLocatorResult',
                  result: row,
                })
              }
            >
              <span>{row.displayName}</span>
              {row.redactedSummary !== undefined && <small>{row.redactedSummary}</small>}
              <small>
                {row.assetRef.nativeOwnership.kind === 'global'
                  ? '全局'
                  : `项目 ${row.assetRef.nativeOwnership.projectId}`}
              </small>
              <small>{row.agents?.join('、')}</small>
            </button>
          ))}
        </section>
      ))}
      <button type="button" onClick={onClose}>
        关闭搜索
      </button>
    </section>
  );
}

export function ReadOnlyWorkbench({ session }: { session: ReadOnlyWorkbenchSession }) {
  const state = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );
  const locatorButtonRef = useRef<HTMLButtonElement>(null);
  const locatorReturnTargetRef = useRef<HTMLElement | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null!);
  const detailErrorHeadingRef = useRef<HTMLHeadingElement>(null!);
  const locatorErrorHeadingRef = useRef<HTMLHeadingElement>(null!);
  const openLocator = () => {
    locatorReturnTargetRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    session.dispatch({ kind: 'openLocator' });
  };
  const closeLocator = () => {
    session.dispatch({ kind: 'closeLocator' });
    queueMicrotask(() => {
      const target = locatorReturnTargetRef.current;
      if (target?.isConnected === true && target.tabIndex >= 0 && !target.matches(':disabled')) {
        target.focus();
      } else {
        locatorButtonRef.current?.focus();
      }
      locatorReturnTargetRef.current = null;
    });
  };
  useEffect(() => {
    if (state.selected?.assetRef?.assetType === 'skill') detailHeadingRef.current?.focus();
  }, [state.selected?.assetRef?.assetId, state.selected?.assetRef?.nativeUnitRef]);
  useEffect(() => {
    if (state.locator.kind === 'open' && state.locator.error !== undefined) {
      locatorErrorHeadingRef.current?.focus();
    }
  }, [state.locator]);
  useEffect(() => {
    if (state.detailError !== null) detailErrorHeadingRef.current?.focus();
  }, [state.detailError]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openLocator();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);
  const viewContexts: Array<{ label: string; value: ViewContext }> = [
    { label: '全部', value: { kind: 'all' } },
    { label: '全局', value: { kind: 'global' } },
  ];
  return (
    <main className="workbench read-only-workbench" aria-label="只读工作台">
      <header>
        <nav aria-label="资产类型">
          <div role="tablist" aria-label="一级资产类型">
            {MVP_ASSET_TYPES.map((assetType) => (
              <button
                key={assetType}
                type="button"
                role="tab"
                aria-selected={state.assetType === assetType}
                onClick={() => session.dispatch({ kind: 'selectAssetType', assetType })}
              >
                {typeLabel[assetType]}
              </button>
            ))}
          </div>
        </nav>
        <button ref={locatorButtonRef} type="button" onClick={openLocator}>
          全局搜索
        </button>
      </header>
      <section aria-label="作用域">
        {[
          ...viewContexts,
          ...state.availableProjectIds.map((projectId) => ({
            label: `项目 ${projectId}`,
            value: { kind: 'project', projectId } as ViewContext,
          })),
        ].map(({ label, value }) => (
          <button
            key={value.kind === 'project' ? value.projectId : value.kind}
            type="button"
            aria-pressed={
              value.kind === 'project'
                ? state.viewContext.kind === 'project' &&
                  state.viewContext.projectId === value.projectId
                : state.viewContext.kind === value.kind
            }
            onClick={() => session.dispatch({ kind: 'selectViewContext', viewContext: value })}
          >
            {label}
          </button>
        ))}
      </section>
      <section className="toolbar" aria-label="列表投影">
        <label htmlFor="filter-agent">Agent 筛选</label>
        <select
          id="filter-agent"
          value={state.filters?.agents?.[0] ?? ''}
          onChange={(event) =>
            session.dispatch({
              kind: 'setFilters',
              filters:
                event.target.value === ''
                  ? { ...state.filters, agents: undefined }
                  : {
                      ...state.filters,
                      agents: [event.target.value as (typeof AGENT_ORDER)[number]],
                    },
            })
          }
        >
          <option value="">全部 Agent</option>
          {AGENT_ORDER.map((agent) => (
            <option key={agent} value={agent}>
              {agent}
            </option>
          ))}
        </select>
        <label htmlFor="name-sort">名称排序</label>
        <select
          id="name-sort"
          value={state.presentation.nameSort}
          onChange={(event) =>
            session.dispatch({
              kind: 'setNameSort',
              nameSort: event.target.value as 'asc' | 'desc',
            })
          }
        >
          <option value="asc">名称升序</option>
          <option value="desc">名称降序</option>
        </select>
        <label htmlFor="page-size">每页</label>
        <select
          id="page-size"
          value={state.presentation.pageSize}
          onChange={(event) =>
            session.dispatch({
              kind: 'setPageSize',
              pageSize: Number(event.target.value) as 20 | 50 | 100,
            })
          }
        >
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </section>
      {stateLabel(state) !== '' && (
        <p role={state.loadState.kind === 'failed' ? 'alert' : 'status'}>{stateLabel(state)}</p>
      )}
      {state.loadState.kind === 'failed' && (
        <button type="button" onClick={() => session.dispatch({ kind: 'retry' })}>
          重试
        </button>
      )}
      {(state.loadState.kind === 'ready' ||
        state.loadState.kind === 'empty' ||
        state.loadState.kind === 'stale') && (
        <p data-testid="authoritative-revision">
          {state.loadState.snapshot.authoritativeReadRevision}
        </p>
      )}
      <div className="workbench-main">
        <SegmentList session={session} state={state} />
        <aside className="detail-panel" aria-label="资产详情">
          {state.detailError !== null ? (
            <section role="alert" aria-label="只读详情错误">
              <h2 ref={detailErrorHeadingRef} tabIndex={-1} data-testid="detail-error-heading">
                无法打开只读详情
              </h2>
              <p>{state.detailError.reasonCode}</p>
              <p>{state.detailError.message}</p>
            </section>
          ) : state.selected === null ? (
            <p>在列表中选择资产以查看只读状态。</p>
          ) : (
            <SkillCells row={state.selected} headingRef={detailHeadingRef} />
          )}
        </aside>
      </div>
      <Locator
        session={session}
        state={state}
        onClose={closeLocator}
        errorHeadingRef={locatorErrorHeadingRef}
      />
    </main>
  );
}
