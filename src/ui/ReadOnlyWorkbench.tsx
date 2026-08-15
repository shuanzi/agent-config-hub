import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

import type { AssetDetailSnapshot, FileTreeNode, NativeFileSnapshot } from '../contract/types';
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
  listPaneRef,
  emptyHeadingRef,
  firstRowRef,
}: {
  session: ReadOnlyWorkbenchSession;
  state: ReadOnlyWorkbenchState;
  listPaneRef: RefObject<HTMLDivElement>;
  emptyHeadingRef: RefObject<HTMLHeadingElement>;
  firstRowRef: RefObject<HTMLButtonElement>;
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
  const firstRowIdentity = projection.segments[0]?.rows[0]
    ? rowIdentity(projection.segments[0].rows[0])
    : null;
  return (
    <div ref={listPaneRef} className="readonly-segment-list list-pane" aria-label="只读资产列表">
      <p aria-label="结果总数">共 {projection.aggregateTotal} 项</p>
      {projection.aggregateTotal === 0 && (
        <h2 ref={emptyHeadingRef} tabIndex={-1} data-testid="workbench-empty-heading">
          当前范围内没有匹配的资产。
        </h2>
      )}
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
                  ref={rowIdentity(row) === firstRowIdentity ? firstRowRef : undefined}
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

function availabilityLabel(availability: { kind: string; reasonCode?: string }): string {
  return availability.reasonCode === undefined
    ? availability.kind
    : `${availability.kind}（${availability.reasonCode}）`;
}

function SkillCells({
  displayName,
  cells,
  headingRef,
}: {
  displayName: string;
  cells: ReadOnlyRow['skillTargetStates'];
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  if (cells === undefined) return null;
  const byAgent = new Map(cells.map((cell) => [cell.agent, cell]));
  return (
    <section
      className="skill-target-cells"
      aria-label="Skill Agent 状态（只读）"
      data-testid="skill-readonly-detail"
    >
      <h2 ref={headingRef} tabIndex={-1} data-testid="skill-detail-heading">
        Skill 详情：{displayName}
      </h2>
      <div className="skill-target-grid">
        {AGENT_ORDER.map((agent) => {
          const cell = byAgent.get(agent);
          const presence = cell?.presence ?? 'unknown';
          const activation = cell?.activation ?? 'unknown';
          const applicability = cell?.applicability ?? 'unknown';
          const stableReason =
            cell?.stableReason ?? (cell === undefined ? 'UNKNOWN_FIELD_PRESERVED' : undefined);
          const enableAvailability = cell?.enableAvailability ?? {
            kind: 'disabled',
            reasonCode: 'UNKNOWN_FIELD_PRESERVED',
          };
          const disableAvailability = cell?.disableAvailability ?? {
            kind: 'disabled',
            reasonCode: 'UNKNOWN_FIELD_PRESERVED',
          };
          return (
            <article key={agent} aria-label={`${agent} 状态`}>
              <h3>{agent}</h3>
              <p>存在：{presence}</p>
              <p>激活：{activation}</p>
              <p>适用性：{applicability}</p>
              <p>开启可用性：{availabilityLabel(enableAvailability)}</p>
              <p>关闭可用性：{availabilityLabel(disableAvailability)}</p>
              {cell?.pending !== undefined && (
                <p>
                  Pending：{cell.pending.operationId}（{cell.pending.phase}）
                </p>
              )}
              {stableReason !== undefined && <p>原因：{stableReason}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function NativeFileTree({
  session,
  node,
  selectedFileId,
}: {
  session: ReadOnlyWorkbenchSession;
  node: FileTreeNode;
  selectedFileId?: string;
}) {
  return (
    <ul data-testid="native-file-tree" aria-label="原生文件树">
      {node.file !== undefined && (
        <li>
          <button
            type="button"
            data-testid="native-file-tree-item"
            aria-current={node.file.fileId === selectedFileId ? 'true' : undefined}
            onClick={() => session.dispatch({ kind: 'selectDetailFile', file: node.file! })}
          >
            查看源码：{node.file.relativePath}
            {node.file.isPrimary ? '（主文件）' : ''}
          </button>
        </li>
      )}
      {node.children?.map((child) => (
        <li key={`${child.name}-${child.file?.fileId ?? 'directory'}`}>
          {child.file === undefined && <span>{child.name}</span>}
          <NativeFileTree session={session} node={child} selectedFileId={selectedFileId} />
        </li>
      ))}
    </ul>
  );
}

function NativeFileSurface({ file }: { file: NativeFileSnapshot }) {
  if (file.content.kind === 'source') {
    return (
      <section data-testid="native-file-text" aria-label="文本原生文件（只读）">
        <h3>{file.file.relativePath}</h3>
        <pre>{file.content.maskedText}</pre>
        {file.content.sensitiveSegments.length > 0 && (
          <p role="status" data-testid="safety-finding">
            敏感字段已遮蔽。
          </p>
        )}
      </section>
    );
  }
  return (
    <section data-testid="native-file-nontext" aria-label="非文本原生文件（只读）">
      <h3>{file.file.relativePath}</h3>
      <p>{file.content.fileKindLabel}</p>
      <p>{file.content.sizeBytes} bytes</p>
      <p role="status" data-testid="safety-finding">
        {file.content.reasonCode}：{file.content.reason}
      </p>
    </section>
  );
}

function sourceAnchorLabel(anchor: AssetDetailSnapshot['inspector']['sourceAnchor']): string {
  if (anchor.kind === 'globalRoot') return anchor.label;
  if (anchor.kind === 'project') return anchor.projectName;
  return '用户目录';
}

function ReadOnlyDetail({
  session,
  state,
  headingRef,
}: {
  session: ReadOnlyWorkbenchSession;
  state: ReadOnlyWorkbenchState;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  if (state.detail.kind === 'idle') return <p>在列表中选择资产以查看只读状态。</p>;
  if (state.detail.kind === 'loading') {
    return (
      <p aria-busy="true" data-testid="readonly-detail-loading">
        正在读取只读详情…
      </p>
    );
  }
  if (state.detail.kind === 'failed') {
    return (
      <section role="alert" aria-label="只读详情读取失败" data-testid="readonly-detail-error">
        <h2 ref={headingRef} tabIndex={-1}>
          无法读取只读详情
        </h2>
        <p>{state.detail.reasonCode}</p>
        <p>{state.detail.message}</p>
        <button type="button" onClick={() => session.dispatch({ kind: 'retry' })}>
          重试读取
        </button>
      </section>
    );
  }

  const { detail, file } = state.detail;
  const surface = detail.detail.readSurface;
  const fileTree = detail.detail.fileTreeRoot;
  const finding =
    surface.kind === 'skill'
      ? surface.unknownContentReason
      : surface.kind === 'subagent'
        ? surface.readOnlyReason
        : undefined;
  return (
    <section aria-label="类型特定只读详情">
      {surface.kind === 'skill' && (
        <SkillCells
          displayName={detail.detail.displayName}
          cells={surface.agentTargetStates}
          headingRef={headingRef}
        />
      )}
      {surface.kind === 'longTermInstruction' && (
        <section data-testid="long-term-instruction-readonly-detail">
          <h2 ref={headingRef} tabIndex={-1}>
            长期指令详情：{detail.detail.displayName}
          </h2>
          <p>Markdown（只读）</p>
        </section>
      )}
      {surface.kind === 'subagent' && (
        <section data-testid="subagent-readonly-detail">
          <h2 ref={headingRef} tabIndex={-1}>
            Subagent 详情：{detail.detail.displayName}
          </h2>
          <p>模型：{surface.model ?? '未知'}</p>
          <p>工具：{surface.tools.join('、') || '未知'}</p>
          <p>权限：{surface.permissions.join('、') || '未知'}</p>
        </section>
      )}
      <p role="status" data-testid="safety-finding">
        兼容性：{detail.detail.compatibility}
      </p>
      {finding !== undefined && (
        <p role="status" data-testid="safety-finding">
          {finding}
        </p>
      )}
      {fileTree !== undefined ? (
        <NativeFileTree session={session} node={fileTree} selectedFileId={file?.file.fileId} />
      ) : (
        <ul data-testid="native-file-tree" aria-label="原生文件树">
          <li>
            <button
              type="button"
              data-testid="native-file-tree-item"
              aria-current="true"
              onClick={() =>
                session.dispatch({ kind: 'selectDetailFile', file: detail.detail.primaryFile })
              }
            >
              查看源码：{detail.detail.primaryFile.relativePath}（主文件）
            </button>
          </li>
        </ul>
      )}
      {file === undefined ? (
        <p data-testid="native-file-not-opened">选择“查看源码”以加载只读文件内容。</p>
      ) : (
        <NativeFileSurface file={file} />
      )}
      <details>
        <summary>来源与上下文</summary>
        <p>来源路径：{detail.inspector.pathDisplay}</p>
        <p>来源锚点：{sourceAnchorLabel(detail.inspector.sourceAnchor)}</p>
        {detail.inspector.effectiveContexts.map((context) => (
          <p key={`${context.agent}-${context.scope}-${context.precedence}`}>
            {context.agent} · {context.scope} · {context.sourceTierLabel} · 优先级{' '}
            {context.precedence}
          </p>
        ))}
        {detail.inspector.overrides.length === 0 ? (
          <p>覆盖关系：当前 read snapshot 未声明覆盖关系</p>
        ) : (
          detail.inspector.overrides.map((override) => (
            <p key={`${override.kind}-${override.otherAssetId}`}>
              覆盖关系：{override.kind} · {override.otherAssetId} · {override.note}
            </p>
          ))
        )}
      </details>
      <details>
        <summary>历史与恢复</summary>
        <p>当前版本：{detail.revision}</p>
        <p>漂移：当前详情 snapshot 未提供权威事实</p>
        <p>最近变更：当前详情 snapshot 未提供权威事实</p>
        <p>恢复点：当前详情 snapshot 未提供权威事实</p>
      </details>
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
      {state.locator.searchText.trim() !== '' && state.locator.snapshot?.aggregateTotal === 0 && (
        <p role="status" data-testid="locator-empty">
          没有匹配的资产。
        </p>
      )}
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
              <small>{row.redactedSummary}</small>
              <small>
                {row.assetRef.nativeOwnership.kind === 'global'
                  ? '全局'
                  : `项目 ${row.ownershipHint}`}
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
  const listPaneRef = useRef<HTMLDivElement>(null!);
  const emptyHeadingRef = useRef<HTMLHeadingElement>(null!);
  const firstRowRef = useRef<HTMLButtonElement>(null!);
  const focusedPageRef = useRef<number | null>(null);
  const focusedSnapshotRef = useRef<unknown>(null);
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
    if (state.detail.kind === 'ready' || state.detail.kind === 'failed') {
      detailHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [state.detail]);
  useEffect(() => {
    if (state.locator.kind === 'open' && state.locator.error !== undefined) {
      locatorErrorHeadingRef.current?.focus();
    }
  }, [state.locator]);
  useEffect(() => {
    if (state.detailError !== null) detailErrorHeadingRef.current?.focus();
  }, [state.detailError]);
  useEffect(() => {
    if (
      state.loadState.kind !== 'ready' &&
      state.loadState.kind !== 'empty' &&
      state.loadState.kind !== 'stale'
    ) {
      return;
    }
    const projection = projectWorkbenchProjection(state.loadState.snapshot, state.presentation);
    const hasPreviousProjection = focusedSnapshotRef.current !== null;
    const pageChanged = hasPreviousProjection && focusedPageRef.current !== projection.page;
    if (
      focusedSnapshotRef.current === state.loadState.snapshot &&
      focusedPageRef.current === projection.page
    ) {
      return;
    }
    focusedSnapshotRef.current = state.loadState.snapshot;
    focusedPageRef.current = projection.page;
    const shouldFocusEmpty = projection.aggregateTotal === 0 && state.detailError === null;
    if (pageChanged || shouldFocusEmpty) listPaneRef.current?.scrollTo({ top: 0 });
    queueMicrotask(() => {
      if (shouldFocusEmpty) emptyHeadingRef.current?.focus({ preventScroll: true });
      else if (pageChanged) firstRowRef.current?.focus({ preventScroll: true });
    });
  }, [state.detailError, state.loadState, state.presentation]);
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
        <SegmentList
          session={session}
          state={state}
          listPaneRef={listPaneRef}
          emptyHeadingRef={emptyHeadingRef}
          firstRowRef={firstRowRef}
        />
        <aside className="detail-panel" aria-label="资产详情">
          {state.detailError !== null ? (
            <section role="alert" aria-label="只读详情错误">
              <h2 ref={detailErrorHeadingRef} tabIndex={-1} data-testid="detail-error-heading">
                无法打开只读详情
              </h2>
              <p>{state.detailError.reasonCode}</p>
              <p>{state.detailError.message}</p>
            </section>
          ) : (
            <ReadOnlyDetail session={session} state={state} headingRef={detailHeadingRef} />
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
