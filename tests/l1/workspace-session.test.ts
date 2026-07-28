/**
 * WorkspaceSession 行为测试（L1，ARC-06a）：
 * 注入 scripted mock FrontendGateway，断言 session 暴露的可见状态与
 * gateway 调用，不依赖内部实现顺序。
 */
import { describe, expect, it } from 'vitest';
import { ScriptedMockGateway } from '../../src/gateway/mock';
import { WorkspaceSession } from '../../src/session/WorkspaceSession';
import type { WorkspaceViewState } from '../../src/session/WorkspaceSession';

async function waitFor(
  predicate: (state: WorkspaceViewState) => boolean,
  session: WorkspaceSession,
): Promise<WorkspaceViewState> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = session.getSnapshot();
    if (predicate(state)) {
      return state;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }
  throw new Error('waitFor 超时：状态未达到预期');
}

function createSession() {
  const mock = new ScriptedMockGateway();
  const session = new WorkspaceSession(mock);
  return { mock, session };
}

describe('WorkspaceSession', () => {
  it('构造后先 loading，初始 read 成功后 ready', async () => {
    const { mock, session } = createSession();
    expect(session.getSnapshot().loadState.kind).toBe('loading');
    // observe 必须先于初始 read 建立
    expect(mock.getObserveCallCount()).toBe(1);

    const state = await waitFor((s) => s.loadState.kind === 'ready', session);
    if (state.loadState.kind === 'ready') {
      expect(state.loadState.list.assets).toHaveLength(1);
      expect(state.loadState.list.assets[0].displayName).toBe('Demo Skill');
    }
    session.dispose();
  });

  it('搜索无结果时进入 empty 并保留查询上下文', async () => {
    const { session } = createSession();
    await waitFor((s) => s.loadState.kind === 'ready', session);
    session.dispatch({ kind: 'setSearchText', searchText: '不存在的资产' });
    const state = await waitFor((s) => s.loadState.kind === 'empty', session);
    expect(state.searchText).toBe('不存在的资产');
    session.dispatch({ kind: 'setSearchText', searchText: '' });
    await waitFor((s) => s.loadState.kind === 'ready', session);
    session.dispose();
  });

  it('脚本化失败进入 failed（只见 reasonCode），retryFailedRead(list) 后恢复', async () => {
    const mock = new ScriptedMockGateway();
    mock.failNext('assetList', 'READ_FAILED');
    const session = new WorkspaceSession(mock);

    const failed = await waitFor((s) => s.loadState.kind === 'failed', session);
    if (failed.loadState.kind === 'failed') {
      expect(failed.loadState.reasonCode).toBe('READ_FAILED');
      expect(failed.loadState.recoveryAction).toEqual({ kind: 'retryRead' });
    }
    session.dispatch({ kind: 'retryFailedRead', target: 'list' });
    await waitFor((s) => s.loadState.kind === 'ready', session);
    session.dispose();
  });

  it('stale 索引保留最近 snapshot 并暴露 indexUpdatedAt', async () => {
    const mock = new ScriptedMockGateway();
    mock.setIndexStatus('stale');
    const session = new WorkspaceSession(mock);

    const state = await waitFor((s) => s.loadState.kind === 'stale', session);
    if (state.loadState.kind === 'stale') {
      expect(state.loadState.list.assets).toHaveLength(1);
      expect(state.loadState.list.indexUpdatedAt).toBeTruthy();
      expect(state.loadState.list.indexUpdatedAt <= state.loadState.list.queriedAt).toBe(true);
    }
    session.dispose();
  });

  it('失效事件触发重读并保留当前选择，外部变化后 revision 更新', async () => {
    const { mock, session } = createSession();
    const ready = await waitFor((s) => s.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') {
      throw new Error('unreachable');
    }
    const asset = ready.loadState.list.assets[0].asset;
    session.dispatch({ kind: 'selectAsset', asset });
    const withDetail = await waitFor((s) => s.detail.kind === 'ready', session);
    if (withDetail.detail.kind !== 'ready') {
      throw new Error('unreachable');
    }
    const revisionBefore = withDetail.detail.detail.revision;

    mock.simulateExternalChange();
    mock.emitEvent({ kind: 'assetsInvalidated', assetType: 'skill' });

    const updated = await waitFor(
      (s) => s.detail.kind === 'ready' && s.detail.detail.revision !== revisionBefore,
      session,
    );
    expect(updated.selectedAsset?.assetId).toBe(asset.assetId);
    expect(updated.searchText).toBe('');
    session.dispose();
  });

  it('切换搜索词后旧响应被丢弃，最终状态只反映最新查询', async () => {
    const { mock, session } = createSession();
    await waitFor((s) => s.loadState.kind === 'ready', session);

    mock.pauseReads();
    session.dispatch({ kind: 'setSearchText', searchText: 'zzz-不匹配' });
    session.dispatch({ kind: 'setSearchText', searchText: 'Demo' });
    mock.resumeReads();

    const state = await waitFor(
      (s) => s.loadState.kind === 'ready' || s.loadState.kind === 'empty',
      session,
    );
    // 再等一轮，确保没有旧响应后续覆盖
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(state.loadState.kind).toBe('ready');
    expect(session.getSnapshot().searchText).toBe('Demo');
    session.dispose();
  });

  it('切换资产类型清空选择并反映到 list query', async () => {
    const { mock, session } = createSession();
    const ready = await waitFor((s) => s.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') {
      throw new Error('unreachable');
    }
    session.dispatch({ kind: 'selectAsset', asset: ready.loadState.list.assets[0].asset });
    await waitFor((s) => s.detail.kind === 'ready', session);

    session.dispatch({ kind: 'selectAssetType', assetType: 'hook' });
    const state = await waitFor((s) => s.loadState.kind === 'empty', session);
    expect(state.selectedAsset).toBeNull();
    expect(state.detail.kind).toBe('idle');
    const lastListCall = mock
      .getCallLog()
      .filter((call) => call.queryKind === 'assetList')
      .at(-1);
    expect(lastListCall?.query).toMatchObject({
      scope: { kind: 'currentAssetType', assetType: 'hook' },
    });
    session.dispose();
  });

  it('范围切换（当前类型/全部资产）正确反映到 query', async () => {
    const { mock, session } = createSession();
    await waitFor((s) => s.loadState.kind === 'ready', session);

    session.dispatch({ kind: 'setScope', scope: 'allAssets' });
    await waitFor((s) => s.loadState.kind === 'ready', session);
    const listCalls = () => mock.getCallLog().filter((call) => call.queryKind === 'assetList');
    expect(listCalls().at(-1)?.query).toMatchObject({ scope: { kind: 'allAssets' } });

    session.dispatch({ kind: 'setScope', scope: 'currentAssetType' });
    await waitFor(
      () =>
        listCalls().at(-1)?.query.kind === 'assetList' &&
        JSON.stringify(listCalls().at(-1)?.query).includes('currentAssetType'),
      session,
    );
    expect(listCalls().at(-1)?.query).toMatchObject({
      scope: { kind: 'currentAssetType', assetType: 'skill' },
    });
    session.dispose();
  });

  it('dispose 后不再提交异步结果', async () => {
    const mock = new ScriptedMockGateway();
    mock.pauseReads();
    const session = new WorkspaceSession(mock);
    session.dispose();
    mock.resumeReads();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(session.getSnapshot().loadState.kind).toBe('loading');
  });

  it('整个会话过程只有 read 调用（无 prepare/apply seam）', async () => {
    const { mock, session } = createSession();
    const ready = await waitFor((s) => s.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') {
      throw new Error('unreachable');
    }
    session.dispatch({ kind: 'selectAsset', asset: ready.loadState.list.assets[0].asset });
    await waitFor((s) => s.detail.kind === 'ready', session);
    const calls = mock.getCallLog();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === 'read')).toBe(true);
    session.dispose();
  });

  // -------------------------------------------------------------------------
  // D1：observe ready 竞态
  // -------------------------------------------------------------------------

  it('observe ready 未完成前不发起初始 read，ready resolve 后才发起', async () => {
    const mock = new ScriptedMockGateway();
    mock.deferObserveReady();
    const session = new WorkspaceSession(mock);
    expect(mock.getObserveCallCount()).toBe(1);

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(mock.getCallLog()).toHaveLength(0);
    expect(session.getSnapshot().loadState.kind).toBe('loading');

    mock.resolveDeferredObserveReady();
    await waitFor((s) => s.loadState.kind === 'ready', session);
    expect(mock.getCallLog().some((call) => call.queryKind === 'assetList')).toBe(true);
    session.dispose();
  });

  it('dispose 发生在 ready 前则不再发起初始 read', async () => {
    const mock = new ScriptedMockGateway();
    mock.deferObserveReady();
    const session = new WorkspaceSession(mock);
    session.dispose();
    mock.resolveDeferredObserveReady();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(mock.getCallLog()).toHaveLength(0);
  });

  it('observe 降级（listener 未注册）时初始 read 仍发生，事件不投递', async () => {
    const mock = new ScriptedMockGateway();
    mock.failObserve(1);
    const session = new WorkspaceSession(mock);
    await waitFor((s) => s.loadState.kind === 'ready', session);

    const listCalls = () => mock.getCallLog().filter((call) => call.queryKind === 'assetList');
    const before = listCalls().length;
    mock.emitEvent({ kind: 'assetsInvalidated' });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(listCalls()).toHaveLength(before);
    session.dispose();
  });

  // -------------------------------------------------------------------------
  // D2：失效范围按 query 依赖
  // -------------------------------------------------------------------------

  it('allAssets 范围下其他类型的 assetsInvalidated 仍触发列表重读', async () => {
    const { mock, session } = createSession();
    await waitFor((s) => s.loadState.kind === 'ready', session);
    session.dispatch({ kind: 'setScope', scope: 'allAssets' });
    const listCalls = () => mock.getCallLog().filter((call) => call.queryKind === 'assetList');
    await waitFor(() => JSON.stringify(listCalls().at(-1)?.query).includes('allAssets'), session);

    const before = listCalls().length;
    mock.emitEvent({ kind: 'assetsInvalidated', assetType: 'hook' });
    await waitFor(() => listCalls().length === before + 1, session);
    session.dispose();
  });

  it('currentAssetType 范围下其他类型事件不触发列表重读，匹配类型才触发', async () => {
    const { mock, session } = createSession();
    await waitFor((s) => s.loadState.kind === 'ready', session);

    const listCalls = () => mock.getCallLog().filter((call) => call.queryKind === 'assetList');
    const before = listCalls().length;
    mock.emitEvent({ kind: 'assetsInvalidated', assetType: 'hook' });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(listCalls()).toHaveLength(before);

    mock.emitEvent({ kind: 'assetsInvalidated', assetType: 'skill' });
    await waitFor(() => listCalls().length === before + 1, session);
    session.dispose();
  });

  it('未选中但在列表中的资产 drift/compatibility → 列表重读；不在列表中则不动作', async () => {
    const { mock, session } = createSession();
    const ready = await waitFor((s) => s.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') {
      throw new Error('unreachable');
    }
    const assetId = ready.loadState.list.assets[0].asset.assetId;

    const listCalls = () => mock.getCallLog().filter((call) => call.queryKind === 'assetList');
    const detailCalls = () => mock.getCallLog().filter((call) => call.queryKind === 'assetDetail');

    // 未选中：drift 只失效列表，不重读详情
    let before = listCalls().length;
    mock.emitEvent({ kind: 'assetDriftDetected', assetId });
    await waitFor(() => listCalls().length === before + 1, session);
    expect(detailCalls()).toHaveLength(0);

    before = listCalls().length;
    mock.emitEvent({ kind: 'compatibilityChanged', assetId });
    await waitFor(() => listCalls().length === before + 1, session);

    // 不在当前列表 snapshot 中的资产：不重读
    before = listCalls().length;
    mock.emitEvent({ kind: 'assetDriftDetected', assetId: 'asset-not-in-list' });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(listCalls()).toHaveLength(before);
    session.dispose();
  });

  // -------------------------------------------------------------------------
  // D3：retry 目标显式化
  // -------------------------------------------------------------------------

  it('list 与 detail 并发失败时，两个重试入口各自重试正确 query', async () => {
    const mock = new ScriptedMockGateway();
    const session = new WorkspaceSession(mock);
    const ready = await waitFor((s) => s.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') {
      throw new Error('unreachable');
    }
    session.dispatch({ kind: 'selectAsset', asset: ready.loadState.list.assets[0].asset });
    await waitFor((s) => s.detail.kind === 'ready', session);

    // 同时对两类 query 脚本化失败，经失效事件触发两侧重读 → 双双 failed
    mock.failNext('assetList', 'READ_FAILED');
    mock.failNext('assetDetail', 'READ_FAILED');
    mock.emitEvent({ kind: 'assetsInvalidated', assetType: 'skill' });
    await waitFor((s) => s.loadState.kind === 'failed' && s.detail.kind === 'failed', session);

    // 列表重试只恢复列表；详情保持 failed
    session.dispatch({ kind: 'retryFailedRead', target: 'list' });
    await waitFor((s) => s.loadState.kind === 'ready', session);
    expect(session.getSnapshot().detail.kind).toBe('failed');

    // 详情重试只恢复详情
    session.dispatch({ kind: 'retryFailedRead', target: 'detail' });
    await waitFor((s) => s.detail.kind === 'ready', session);
    session.dispose();
  });

  // -------------------------------------------------------------------------
  // D5：筛选与分组维度进入 list query
  // -------------------------------------------------------------------------

  it('项目/来源筛选与 groupBy 透传到 list query，并约束结果', async () => {
    const { mock, session } = createSession();
    await waitFor((s) => s.loadState.kind === 'ready', session);

    const lastListQuery = () =>
      mock
        .getCallLog()
        .filter((call) => call.queryKind === 'assetList')
        .at(-1)?.query;
    // 默认查询不带 filters
    expect(lastListQuery()).not.toHaveProperty('filters');

    session.dispatch({
      kind: 'setFilters',
      filters: { projects: ['any-project'], sources: ['user-global-root'] },
    });
    session.dispatch({ kind: 'setGroupBy', groupBy: 'scope' });
    // FX-01 资产无项目上下文：项目筛选使列表为空；query 携带全部新维度
    await waitFor((s) => s.loadState.kind === 'empty', session);
    expect(lastListQuery()).toMatchObject({
      filters: { projects: ['any-project'], sources: ['user-global-root'], groupBy: 'scope' },
    });

    // 清除项目筛选后恢复；来源筛选与分组保留
    session.dispatch({ kind: 'setFilters', filters: { projects: [] } });
    await waitFor((s) => s.loadState.kind === 'ready', session);
    expect(session.getSnapshot().groupBy).toBe('scope');
    expect(lastListQuery()).toMatchObject({
      filters: { sources: ['user-global-root'], groupBy: 'scope' },
    });
    session.dispose();
  });
});
