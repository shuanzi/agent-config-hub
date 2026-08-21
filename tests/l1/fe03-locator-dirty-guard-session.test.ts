/** FE-03：带草稿的 locator 跳转只在明确 discard 后改变 destination。 */
import { describe, expect, it } from 'vitest';

import type { Query, ReadResult, SnapshotFor } from '../../src/contract/types';
import {
  ReadOnlyWorkbenchSession,
  type ReadOnlyWorkbenchState,
} from '../../src/session/ReadOnlyWorkbenchSession';
import type { GlobalLocatorSnapshot, LocatorResult } from '../../src/workbench/read-only-model';
import {
  asset,
  detail,
  file,
  ReadOnlyGateway,
  row,
  source,
  waitForSession,
  workbench,
} from './support/fe03-session-fixtures';

const ORIGIN = asset(
  'asset-fe03-locator-origin',
  'longTermInstruction',
  'nunit-fe03-locator-origin',
);
const TARGET = asset('asset-fe03-locator-target', 'skill', 'nunit-fe03-locator-target');
const ORIGIN_FILE = file('file-fe03-locator-origin', 'daily.md');
const TARGET_FILE = file('file-fe03-locator-target', 'SKILL.md');
const ORIGIN_ROW = row(ORIGIN, 'Safe daily instruction');

const TARGET_RESULT: LocatorResult = {
  assetRef: TARGET,
  assetId: TARGET.assetId,
  displayName: 'Safe target Skill',
  sortBaseName: 'Safe target Skill',
  authoritativeInputOrder: 0,
  nativeOwnership: TARGET.nativeOwnership,
  statuses: ['editable', 'normal'],
  redactedSummary: 'safe target summary',
  ownershipHint: 'global',
  destinationViewContext: { kind: 'global' },
  destination: { kind: 'skillDetail', assetRef: TARGET },
  matchedField: 'displayName',
};

const ORIGIN_DETAIL = detail(
  ORIGIN,
  ORIGIN_FILE,
  ORIGIN_ROW.displayName,
  'asset-rev-fe03-locator-origin',
  { kind: 'longTermInstruction', markdownFile: ORIGIN_FILE },
  { pathDisplay: 'synthetic/daily.md' },
);
const TARGET_DETAIL = detail(
  TARGET,
  TARGET_FILE,
  TARGET_RESULT.displayName,
  'asset-rev-fe03-locator-target',
  { kind: 'skill', agentTargetStates: [], sourceReadAvailability: { kind: 'allowed' } },
  { pathDisplay: 'synthetic/SKILL.md' },
);
const ORIGIN_SOURCE = source(
  ORIGIN_FILE,
  'file-rev-fe03-locator-origin',
  ORIGIN_DETAIL.revision,
  '# Daily instruction\nunknown-extension: preserve\n',
);

const EDITED_TEXT = '# Daily instruction\nunknown-extension: preserve\nEdited safely.\n';

function locatorSnapshot(): GlobalLocatorSnapshot {
  return {
    kind: 'globalLocator',
    groups: [
      { assetType: 'skill', count: 1, results: [TARGET_RESULT] },
      { assetType: 'longTermInstruction', count: 0, results: [] },
      { assetType: 'subagent', count: 0, results: [] },
    ],
    aggregateTotal: 1,
    readAt: '2026-08-20T00:00:00.000Z',
  };
}

class LocatorDirtyGateway extends ReadOnlyGateway {
  constructor() {
    super((query) => {
      if (query.kind === 'workbench') {
        return workbench(
          query,
          query.assetType === 'skill' ? TARGET_RESULT : ORIGIN_ROW,
          `asset-rev-${query.assetType}`,
        );
      }
      if (query.kind === 'assetDetail')
        return query.asset.assetId === TARGET.assetId ? TARGET_DETAIL : ORIGIN_DETAIL;
      if (query.kind === 'nativeFile') return ORIGIN_SOURCE;
      if (query.kind === 'globalLocator') return locatorSnapshot();
      return undefined;
    });
  }

  read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
    if (query.kind !== 'globalLocator' || query.searchText !== 'missing') return super.read(query);
    this.methods.push('read');
    this.queries.push(query);
    return Promise.resolve({
      kind: 'readFailed',
      reasonCode: 'READ_FAILED',
      message: 'synthetic locator failure',
    } as ReadResult<SnapshotFor<Q>>);
  }
}

function stateOf(session: ReadOnlyWorkbenchSession) {
  return session.getSnapshot();
}

function expectOriginPreserved(
  state: ReadOnlyWorkbenchState,
  origin: Pick<
    ReadOnlyWorkbenchState,
    'assetType' | 'viewContext' | 'selected' | 'detail' | 'draft'
  >,
): void {
  expect(state.assetType).toBe(origin.assetType);
  expect(state.viewContext).toEqual(origin.viewContext);
  expect(state.selected).toEqual(origin.selected);
  expect(state.detail).toEqual(origin.detail);
  expect(state.draft).toEqual(origin.draft);
}

describe('FE-03 locator dirty guard', () => {
  it('keeps a draft until explicit locator discard atomically commits the selected destination', async () => {
    const gateway = new LocatorDirtyGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);

    await waitForSession(() => session.getSnapshot().loadState.kind === 'ready');
    session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
    await waitForSession(
      () =>
        session.getSnapshot().loadState.kind === 'ready' &&
        session.getSnapshot().assetType === 'longTermInstruction',
    );
    const loaded = session.getSnapshot().loadState;
    if (loaded.kind !== 'ready') throw new Error('long-term instruction list must be ready');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    await waitForSession(() => session.getSnapshot().detail.kind === 'ready');
    session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
    session.dispatch({ kind: 'replaceDraftText', text: EDITED_TEXT });

    const origin = stateOf(session);
    const originState = {
      assetType: origin.assetType,
      viewContext: origin.viewContext,
      selected: origin.selected,
      detail: origin.detail,
      draft: origin.draft,
    };

    session.dispatch({ kind: 'openLocator' });
    session.dispatch({ kind: 'setLocatorSearch', searchText: 'missing' });
    await waitForSession(() => {
      const locator = stateOf(session).locator;
      return locator.kind === 'open' && locator.error !== undefined;
    });
    expectOriginPreserved(stateOf(session), originState);

    session.dispatch({ kind: 'setLocatorSearch', searchText: 'target' });
    await waitForSession(() => {
      const locator = stateOf(session).locator;
      return locator.kind === 'open' && locator.snapshot !== null;
    });
    const readsBeforeSelect = gateway.methods.length;

    session.dispatch({ kind: 'selectLocatorResult', result: TARGET_RESULT });
    expect(stateOf(session).dirtyGuard).toMatchObject({
      kind: 'pending',
      reason: 'locator',
      target: { assetRef: TARGET, assetType: TARGET.assetType },
    });
    expectOriginPreserved(stateOf(session), originState);
    expect(stateOf(session).locator).toMatchObject({
      kind: 'open',
      searchText: 'target',
      snapshot: locatorSnapshot(),
    });
    expect(gateway.methods).toHaveLength(readsBeforeSelect);

    session.dispatch({ kind: 'continueEditing' });
    expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
    expectOriginPreserved(stateOf(session), originState);
    expect(stateOf(session).locator).toMatchObject({ kind: 'open', snapshot: locatorSnapshot() });
    expect(gateway.methods).toHaveLength(readsBeforeSelect);

    session.dispatch({ kind: 'selectLocatorResult', result: TARGET_RESULT });
    session.dispatch({ kind: 'cancelDirtyGuard' });
    expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
    expectOriginPreserved(stateOf(session), originState);
    expect(stateOf(session).locator).toMatchObject({ kind: 'open', snapshot: locatorSnapshot() });
    expect(gateway.methods).toHaveLength(readsBeforeSelect);

    session.dispatch({ kind: 'selectLocatorResult', result: TARGET_RESULT });
    const publications: ReadOnlyWorkbenchState[] = [];
    const unsubscribe = session.subscribe(() => publications.push(stateOf(session)));
    session.dispatch({ kind: 'discardDraft' });
    unsubscribe();

    const firstPublication = publications[0];
    expect(firstPublication).toMatchObject({
      assetType: TARGET.assetType,
      viewContext: TARGET_RESULT.destinationViewContext,
      selected: TARGET_RESULT,
      detail: { kind: 'loading', assetRef: TARGET },
      draft: null,
      dirtyGuard: { kind: 'idle' },
      locator: { kind: 'closed' },
    });
    expect(firstPublication?.selected).toEqual(TARGET_RESULT);
    expect(gateway.methods.length).toBeGreaterThan(readsBeforeSelect);
    expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(true);

    session.dispose();
  });

  it.each(['close', 'searchFailure', 'reopen'] as const)(
    'invalidates a pending locator destination after %s, so ordinary discard stays local',
    async (invalidation) => {
      const gateway = new LocatorDirtyGateway();
      const session = new ReadOnlyWorkbenchSession(gateway);
      try {
        await waitForSession(() => session.getSnapshot().loadState.kind === 'ready');
        session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
        await waitForSession(
          () =>
            session.getSnapshot().loadState.kind === 'ready' &&
            session.getSnapshot().assetType === 'longTermInstruction',
        );
        const loaded = session.getSnapshot().loadState;
        if (loaded.kind !== 'ready') throw new Error('long-term instruction list must be ready');
        session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
        await waitForSession(() => session.getSnapshot().detail.kind === 'ready');
        session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
        session.dispatch({ kind: 'replaceDraftText', text: EDITED_TEXT });

        const origin = stateOf(session);
        const originState = {
          assetType: origin.assetType,
          viewContext: origin.viewContext,
          selected: origin.selected,
          detail: origin.detail,
          draft: origin.draft,
        };
        session.dispatch({ kind: 'openLocator' });
        session.dispatch({ kind: 'setLocatorSearch', searchText: 'target' });
        await waitForSession(() => {
          const locator = stateOf(session).locator;
          return locator.kind === 'open' && locator.snapshot !== null;
        });
        session.dispatch({ kind: 'selectLocatorResult', result: TARGET_RESULT });
        expect(stateOf(session).dirtyGuard).toMatchObject({
          kind: 'pending',
          reason: 'locator',
          target: { assetRef: TARGET, assetType: TARGET.assetType },
        });
        expectOriginPreserved(stateOf(session), originState);

        if (invalidation === 'close') {
          session.dispatch({ kind: 'closeLocator' });
          expect(stateOf(session).locator).toEqual({ kind: 'closed' });
        } else if (invalidation === 'reopen') {
          session.dispatch({ kind: 'openLocator' });
          expect(stateOf(session).locator).toEqual({
            kind: 'open',
            searchText: '',
            snapshot: null,
          });
        } else {
          session.dispatch({ kind: 'setLocatorSearch', searchText: 'missing' });
          await waitForSession(() => {
            const locator = stateOf(session).locator;
            return locator.kind === 'open' && locator.error !== undefined;
          });
          expect(stateOf(session).locator).toMatchObject({
            kind: 'open',
            searchText: 'missing',
            snapshot: null,
            error: { kind: 'readFailed' },
          });
        }

        expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
        expectOriginPreserved(stateOf(session), originState);
        const readsBeforeOrdinaryDiscard = gateway.queries.length;
        expect(
          gateway.queries.filter(
            (query) => query.kind === 'assetDetail' && query.asset.assetId === TARGET.assetId,
          ),
        ).toHaveLength(0);

        session.dispatch({ kind: 'discardDraft' });
        expect(stateOf(session).draft).toBeNull();
        expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
        expect(stateOf(session).assetType).toBe(originState.assetType);
        expect(stateOf(session).viewContext).toEqual(originState.viewContext);
        expect(stateOf(session).selected).toEqual(originState.selected);
        expect(stateOf(session).detail).toEqual(originState.detail);
        expect(gateway.queries).toHaveLength(readsBeforeOrdinaryDiscard);
        expect(
          gateway.queries.filter(
            (query) => query.kind === 'assetDetail' && query.asset.assetId === TARGET.assetId,
          ),
        ).toHaveLength(0);
        expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(
          true,
        );
      } finally {
        session.dispose();
      }
    },
  );
});
