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

  it('脚本化失败进入 failed（只见 reasonCode），retryFailedRead 后恢复', async () => {
    const mock = new ScriptedMockGateway();
    mock.failNext('assetList', 'READ_FAILED');
    const session = new WorkspaceSession(mock);

    const failed = await waitFor((s) => s.loadState.kind === 'failed', session);
    if (failed.loadState.kind === 'failed') {
      expect(failed.loadState.reasonCode).toBe('READ_FAILED');
      expect(failed.loadState.recoveryAction).toEqual({ kind: 'retryRead' });
    }
    session.dispatch({ kind: 'retryFailedRead' });
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
});
