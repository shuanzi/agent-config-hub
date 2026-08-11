import { describe, expect, it } from 'vitest';

import type { FrontendGateway, ObserveHandle } from '../../src/contract/gateway';
import type {
  Query,
  ReadResult,
  SnapshotFor,
  Subscription,
  WorkspaceEvent,
} from '../../src/contract/types';
import {
  ReadOnlyWorkbenchSession,
  type ReadOnlyWorkbenchState,
} from '../../src/session/ReadOnlyWorkbenchSession';
import type { WorkbenchActualReadSnapshot } from '../../src/workbench/read-only-model';
import type { GlobalLocatorSnapshot, LocatorResult } from '../../src/workbench/read-only-model';

function snapshot(activation: 'enabled' | 'disabled'): WorkbenchActualReadSnapshot {
  return {
    kind: 'workbench',
    query: { kind: 'workbench', assetType: 'skill', viewContext: { kind: 'all' } },
    authoritativeReadRevision: activation === 'enabled' ? 'rev-before' : 'rev-after',
    effectiveContexts: [],
    findings: [],
    aggregateTotal: 1,
    indexStatus: 'fresh',
    readAt: '2026-08-10T00:00:00.000Z',
    segments: [
      {
        id: 'global',
        source: 'globalApplicable',
        displayLabel: 'Global',
        rows: [
          {
            assetRef: {
              assetId: 'skill-1',
              assetType: 'skill',
              nativeUnitRef: 'nunit-skill-1',
              adapterIdentity: 'claude-code@fixture',
              nativeOwnership: { kind: 'global' },
            },
            assetId: 'skill-1',
            displayName: 'Skill',
            sortBaseName: 'Skill',
            authoritativeInputOrder: 0,
            skillTargetStates: [
              {
                agent: 'claude-code',
                presence: 'present',
                activation,
                applicability: 'resolved',
                enableAvailability: { kind: 'allowed' },
                disableAvailability: { kind: 'allowed' },
              },
            ],
          },
        ],
      },
    ],
  };
}

class EventingReadGateway implements FrontendGateway {
  private listener: ((event: WorkspaceEvent) => void) | null = null;
  private current = snapshot('enabled');
  private failure: ReadResult<WorkbenchActualReadSnapshot> | null = null;

  read<Q extends Query>(_query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
    return Promise.resolve(
      this.failure ?? {
        kind: 'readSucceeded',
        snapshot: this.current as SnapshotFor<Q>,
      },
    ) as Promise<ReadResult<SnapshotFor<Q>>>;
  }

  observe(_subscription: Subscription, listener: (event: WorkspaceEvent) => void): ObserveHandle {
    this.listener = listener;
    return {
      ready: Promise.resolve(),
      unlisten: () => {
        this.listener = null;
      },
    };
  }

  replaceAuthoritativeSnapshot(next: WorkbenchActualReadSnapshot): void {
    this.failure = null;
    this.current = next;
  }

  failAuthoritativeRead(): void {
    this.failure = {
      kind: 'readFailed',
      reasonCode: 'READ_FAILED',
      message: 'fixture read failure',
    };
  }

  invalidate(): void {
    this.listener?.({ kind: 'assetsInvalidated', assetType: 'skill' });
  }
}

class DeferredReadGateway extends EventingReadGateway {
  private pending: Array<{
    resolve: (result: ReadResult<WorkbenchActualReadSnapshot>) => void;
  }> = [];

  override read<Q extends Query>(_query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
    return new Promise((resolve) => {
      this.pending.push({
        resolve: (result) => resolve(result as ReadResult<SnapshotFor<Q>>),
      });
    });
  }

  resolveNext(result: ReadResult<unknown>): void {
    const pending = this.pending.shift();
    if (pending === undefined) throw new Error('没有待完成的 read');
    pending.resolve(result as ReadResult<WorkbenchActualReadSnapshot>);
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

function locatorSnapshot(
  destination: LocatorResult['destination'] = {
    kind: 'skillDetail',
    assetRef: snapshot('enabled').segments[0].rows[0].assetRef,
  },
  resultRow = snapshot('enabled').segments[0].rows[0],
): GlobalLocatorSnapshot {
  const redactedSummary = resultRow.redactedSummary ?? '只读遮蔽摘要';
  const ownershipHint = resultRow.ownershipHint ?? 'global';
  return {
    kind: 'globalLocator',
    groups: [
      {
        assetType: 'skill',
        count: 1,
        results: [
          {
            ...resultRow,
            redactedSummary,
            ownershipHint,
            destinationViewContext: { kind: 'global' },
            destination,
            matchedField: 'displayName',
          },
        ],
      },
      { assetType: 'longTermInstruction', count: 0, results: [] },
      { assetType: 'subagent', count: 0, results: [] },
    ],
    aggregateTotal: 1,
    readAt: '2026-08-10T00:00:00.000Z',
  };
}

async function waitForPending(gateway: DeferredReadGateway, count = 1): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (gateway.pendingCount >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`待完成 read 数未达到 ${count}`);
}

async function waitFor(
  predicate: (state: ReadOnlyWorkbenchState) => boolean,
  session: ReadOnlyWorkbenchSession,
): Promise<ReadOnlyWorkbenchState> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = session.getSnapshot();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('waitFor 超时：状态未达到预期');
}

describe('ReadOnlyWorkbenchSession', () => {
  it('locator read failure remains in locator, while unsupported destination atomically switches context and focuses fail-closed detail error', async () => {
    const gateway = new DeferredReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitForPending(gateway);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('enabled') });
    await waitFor((state) => state.loadState.kind === 'ready', session);

    session.dispatch({ kind: 'openLocator' });
    session.dispatch({ kind: 'setLocatorSearch', searchText: 'missing' });
    await waitForPending(gateway);
    gateway.resolveNext({
      kind: 'readFailed',
      reasonCode: 'READ_FAILED',
      message: 'locator unavailable',
    });
    await waitFor(
      (state) => state.locator.kind === 'open' && state.locator.error?.reasonCode === 'READ_FAILED',
      session,
    );

    const unsupportedAssetRef = {
      ...snapshot('enabled').segments[0].rows[0].assetRef,
      assetId: 'instruction-1',
      assetType: 'longTermInstruction' as const,
      nativeUnitRef: 'nunit-instruction-1',
    };
    const unsupported = locatorSnapshot(
      {
        kind: 'unsupportedReadOnly',
        assetRef: unsupportedAssetRef,
        reasonCode: 'UNSUPPORTED_CAPABILITY',
      },
      {
        ...snapshot('enabled').segments[0].rows[0],
        assetRef: unsupportedAssetRef,
        assetId: unsupportedAssetRef.assetId,
      },
    ).groups[0].results[0];
    session.dispatch({ kind: 'selectLocatorResult', result: unsupported });
    expect(session.getSnapshot().selected).toBeNull();
    expect(session.getSnapshot()).toMatchObject({
      assetType: 'longTermInstruction',
      viewContext: { kind: 'global' },
      locator: { kind: 'closed' },
      detailError: {
        reasonCode: 'UNSUPPORTED_CAPABILITY',
        assetRef: unsupportedAssetRef,
      },
    });
    session.dispose();
  });

  it('locator clear, close, and reopen cancel old in-flight searches before their result can revive', async () => {
    const gateway = new DeferredReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitForPending(gateway);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('enabled') });
    await waitFor((state) => state.loadState.kind === 'ready', session);

    session.dispatch({ kind: 'openLocator' });
    session.dispatch({ kind: 'setLocatorSearch', searchText: 'old' });
    await waitForPending(gateway);
    session.dispatch({ kind: 'setLocatorSearch', searchText: '' });
    session.dispatch({ kind: 'closeLocator' });
    session.dispatch({ kind: 'openLocator' });
    session.dispatch({ kind: 'setLocatorSearch', searchText: 'new' });
    await waitForPending(gateway, 2);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: locatorSnapshot() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(session.getSnapshot().locator).toMatchObject({
      kind: 'open',
      searchText: 'new',
      snapshot: null,
    });
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: locatorSnapshot() });
    const latest = await waitFor(
      (state) => state.locator.kind === 'open' && state.locator.snapshot !== null,
      session,
    );
    expect(latest.locator).toMatchObject({ kind: 'open', searchText: 'new' });
    session.dispose();
  });

  it('canonical filter failure cancels the previous workbench generation so an old pending read cannot restore ready', async () => {
    const gateway = new DeferredReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitForPending(gateway);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('enabled') });
    await waitFor((state) => state.loadState.kind === 'ready', session);

    session.dispatch({ kind: 'setFilters', filters: { agents: ['claude-code'] } });
    session.dispatch({ kind: 'selectViewContext', viewContext: { kind: 'global' } });
    await waitForPending(gateway, 2);
    session.dispatch({ kind: 'setFilters', filters: { projectIds: ['opaque-project'] } });

    expect(session.getSnapshot().loadState).toMatchObject({
      kind: 'failed',
      reasonCode: 'READ_FAILED',
    });
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('disabled') });
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('disabled') });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(session.getSnapshot().loadState).toMatchObject({
      kind: 'failed',
      reasonCode: 'READ_FAILED',
    });
    expect(session.getSnapshot().selected).toBeNull();
    session.dispose();
  });

  it('event invalidation immediately hides the current revision and selection until its authoritative reread completes', async () => {
    const gateway = new DeferredReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitForPending(gateway);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('enabled') });
    const ready = await waitFor((state) => state.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') throw new Error('unreachable');
    session.dispatch({ kind: 'selectRow', row: ready.loadState.snapshot.segments[0].rows[0] });

    gateway.invalidate();
    expect(session.getSnapshot().loadState).toEqual({ kind: 'loading' });
    expect(session.getSnapshot().selected).toBeNull();

    await waitForPending(gateway);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('disabled') });
    const reread = await waitFor((state) => state.loadState.kind === 'ready', session);
    expect(reread.loadState).toMatchObject({ kind: 'ready' });
    session.dispose();
  });

  it('workspace event keeps a non-empty open locator loading, rereads it authoritatively, and discards its old in-flight result', async () => {
    const gateway = new DeferredReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitForPending(gateway);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('enabled') });
    await waitFor((state) => state.loadState.kind === 'ready', session);

    session.dispatch({ kind: 'openLocator' });
    session.dispatch({ kind: 'setLocatorSearch', searchText: 'Skill' });
    await waitForPending(gateway);

    gateway.invalidate();
    expect(session.getSnapshot()).toMatchObject({
      loadState: { kind: 'loading' },
      locator: { kind: 'open', searchText: 'Skill', snapshot: null },
      selected: null,
    });

    await waitForPending(gateway, 3);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: locatorSnapshot() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(session.getSnapshot().locator).toMatchObject({
      kind: 'open',
      searchText: 'Skill',
      snapshot: null,
    });

    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('disabled') });
    await waitFor((state) => state.loadState.kind === 'ready', session);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: locatorSnapshot() });
    const reread = await waitFor(
      (state) => state.locator.kind === 'open' && state.locator.snapshot !== null,
      session,
    );
    expect(reread.locator).toMatchObject({ kind: 'open', searchText: 'Skill' });
    session.dispose();
  });

  it('workspace event does not add locator reads for a closed or empty locator', async () => {
    const gateway = new DeferredReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitForPending(gateway);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('enabled') });
    await waitFor((state) => state.loadState.kind === 'ready', session);

    gateway.invalidate();
    await waitForPending(gateway);
    expect(gateway.pendingCount).toBe(1);
    gateway.resolveNext({ kind: 'readSucceeded', snapshot: snapshot('disabled') });
    await waitFor((state) => state.loadState.kind === 'ready', session);

    session.dispatch({ kind: 'openLocator' });
    gateway.invalidate();
    await waitForPending(gateway);
    expect(gateway.pendingCount).toBe(1);
    session.dispose();
  });

  it('在失效事件后的 authoritative reread 中按 assetId 重绑定已选择行，绝不继续展示旧 cell 事实', async () => {
    const gateway = new EventingReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    const before = await waitFor((state) => state.loadState.kind === 'ready', session);
    if (before.loadState.kind !== 'ready') throw new Error('unreachable');
    session.dispatch({ kind: 'selectRow', row: before.loadState.snapshot.segments[0].rows[0] });
    expect(session.getSnapshot().selected?.skillTargetStates?.[0]?.activation).toBe('enabled');

    gateway.replaceAuthoritativeSnapshot(snapshot('disabled'));
    gateway.invalidate();

    const after = await waitFor(
      (state) =>
        state.loadState.kind === 'ready' &&
        state.loadState.snapshot.authoritativeReadRevision === 'rev-after',
      session,
    );
    expect(after.selected?.assetId).toBe('skill-1');
    expect(after.selected?.skillTargetStates?.[0]?.activation).toBe('disabled');
    session.dispose();
  });

  it('将 authoritative 空 snapshot 表示为 empty，且不保留选择', async () => {
    const gateway = new EventingReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    const ready = await waitFor((state) => state.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') throw new Error('unreachable');
    session.dispatch({ kind: 'selectRow', row: ready.loadState.snapshot.segments[0].rows[0] });

    gateway.replaceAuthoritativeSnapshot({
      ...snapshot('enabled'),
      authoritativeReadRevision: 'rev-empty',
      aggregateTotal: 0,
      segments: [],
    });
    gateway.invalidate();

    const empty = await waitFor(
      (state) =>
        state.loadState.kind === 'empty' &&
        state.loadState.snapshot.authoritativeReadRevision === 'rev-empty',
      session,
    );
    expect(empty.selected).toBeNull();
    session.dispose();
  });

  it('相同 assetId 但不同 native AssetRef 时 fail-closed 清空选择', async () => {
    const gateway = new EventingReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    const ready = await waitFor((state) => state.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') throw new Error('unreachable');
    session.dispatch({ kind: 'selectRow', row: ready.loadState.snapshot.segments[0].rows[0] });

    const replacement = snapshot('disabled');
    replacement.segments[0].rows[0].assetRef = {
      ...replacement.segments[0].rows[0].assetRef,
      nativeUnitRef: 'nunit-replaced',
    };
    gateway.replaceAuthoritativeSnapshot(replacement);
    gateway.invalidate();

    const after = await waitFor(
      (state) =>
        state.loadState.kind === 'ready' &&
        state.loadState.snapshot.authoritativeReadRevision === 'rev-after',
      session,
    );
    expect(after.selected).toBeNull();
    session.dispose();
  });

  it('筛选、stale 与 authoritative readFailed 都 fail-closed 清空选择', async () => {
    const gateway = new EventingReadGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    const ready = await waitFor((state) => state.loadState.kind === 'ready', session);
    if (ready.loadState.kind !== 'ready') throw new Error('unreachable');
    session.dispatch({ kind: 'selectRow', row: ready.loadState.snapshot.segments[0].rows[0] });

    session.dispatch({ kind: 'setFilters', filters: { agents: ['claude-code'] } });
    const filtered = await waitFor((state) => state.loadState.kind === 'ready', session);
    expect(filtered.selected).toBeNull();

    session.dispatch({
      kind: 'selectRow',
      row:
        filtered.loadState.kind === 'ready'
          ? filtered.loadState.snapshot.segments[0].rows[0]
          : ready.loadState.snapshot.segments[0].rows[0],
    });
    gateway.replaceAuthoritativeSnapshot({ ...snapshot('disabled'), indexStatus: 'stale' });
    gateway.invalidate();
    const stale = await waitFor((state) => state.loadState.kind === 'stale', session);
    expect(stale.selected).toBeNull();

    gateway.replaceAuthoritativeSnapshot(snapshot('enabled'));
    gateway.invalidate();
    const readyAgain = await waitFor((state) => state.loadState.kind === 'ready', session);
    if (readyAgain.loadState.kind !== 'ready') throw new Error('unreachable');
    session.dispatch({ kind: 'selectRow', row: readyAgain.loadState.snapshot.segments[0].rows[0] });
    gateway.failAuthoritativeRead();
    gateway.invalidate();
    const failed = await waitFor((state) => state.loadState.kind === 'failed', session);
    expect(failed.selected).toBeNull();
    session.dispose();
  });
});
