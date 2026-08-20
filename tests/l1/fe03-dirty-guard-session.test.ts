/** FE-03：dirty guard 只守护 frontend-local draft，不创建 write intent。 */
import { describe, expect, it } from 'vitest';

import {
  ReadOnlyWorkbenchSession,
  type ReadOnlyWorkbenchState,
} from '../../src/session/ReadOnlyWorkbenchSession';
import type { WorkbenchFilters } from '../../src/workbench/read-only-model';
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

const ASSET = asset('asset-fe03-dirty-safe', 'longTermInstruction', 'nunit-fe03-dirty-safe');
const OTHER_ASSET = asset(
  'asset-fe03-dirty-other-safe',
  'longTermInstruction',
  'nunit-fe03-dirty-other-safe',
);
const FILE = file('file-fe03-dirty-safe', 'daily.md');

const SOURCE_TEXT = '# Daily instruction\nunknown-extension: preserve\n';
const EDITED_TEXT = '# Daily instruction\nunknown-extension: preserve\nEdited safely.\n';

const ROW = row(ASSET, 'Safe daily instruction');
const OTHER_ROW = row(OTHER_ASSET, 'Other safe daily instruction');
const DETAIL = detail(
  ASSET,
  FILE,
  ROW.displayName,
  'asset-rev-fe03-dirty-safe',
  { kind: 'longTermInstruction', markdownFile: FILE },
  { pathDisplay: 'synthetic/daily.md' },
);
const SOURCE = source(FILE, 'file-rev-fe03-dirty-safe', DETAIL.revision, SOURCE_TEXT);

function createGateway() {
  return new ReadOnlyGateway((query) =>
    query.kind === 'workbench'
      ? workbench(query, ROW, DETAIL.revision)
      : query.kind === 'assetDetail'
        ? DETAIL
        : query.kind === 'nativeFile'
          ? SOURCE
          : undefined,
  );
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

describe('FE-03 frontend-local dirty guard', () => {
  it('defers destination changes until explicit discard, while ordinary discard only clears the draft', async () => {
    const gateway = createGateway();
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
    const readsBeforeGuard = gateway.methods.length;

    session.dispatch({ kind: 'selectAssetType', assetType: 'skill' });
    expect(stateOf(session).dirtyGuard).toMatchObject({ kind: 'pending' });
    expectOriginPreserved(stateOf(session), originState);
    expect(gateway.methods).toHaveLength(readsBeforeGuard);

    session.dispatch({ kind: 'continueEditing' });
    expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
    expectOriginPreserved(stateOf(session), originState);
    expect(gateway.methods).toHaveLength(readsBeforeGuard);

    session.dispatch({
      kind: 'selectViewContext',
      viewContext: { kind: 'project', projectId: 'project-fe03-dirty-safe' },
    });
    expect(stateOf(session).dirtyGuard).toMatchObject({ kind: 'pending' });
    expectOriginPreserved(stateOf(session), originState);
    expect(gateway.methods).toHaveLength(readsBeforeGuard);

    session.dispatch({ kind: 'cancelDirtyGuard' });
    expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
    expectOriginPreserved(stateOf(session), originState);
    expect(gateway.methods).toHaveLength(readsBeforeGuard);

    session.dispatch({ kind: 'discardDraft' });
    expect(stateOf(session).draft).toBeNull();
    expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
    expect(stateOf(session).assetType).toBe(originState.assetType);
    expect(stateOf(session).viewContext).toEqual(originState.viewContext);
    expect(stateOf(session).selected).toEqual(originState.selected);
    expect(stateOf(session).detail).toEqual(originState.detail);
    expect(gateway.methods).toHaveLength(readsBeforeGuard);

    session.dispatch({ kind: 'replaceDraftText', text: EDITED_TEXT });
    expect(stateOf(session).draft?.sourceText).toBe(EDITED_TEXT);
    session.dispatch({ kind: 'selectAssetType', assetType: 'skill' });
    expect(stateOf(session).dirtyGuard).toMatchObject({ kind: 'pending' });
    expect(gateway.methods).toHaveLength(readsBeforeGuard);

    session.dispatch({ kind: 'discardDraft' });
    expect(stateOf(session)).toMatchObject({
      assetType: 'skill',
      draft: null,
      dirtyGuard: { kind: 'idle' },
    });
    expect(gateway.methods.length).toBeGreaterThan(readsBeforeGuard);

    session.dispose();
  });

  it.each(['asset type', 'view context', 'filters'] as const)(
    'treats a duplicate current %s as a draft-preserving no-op',
    async (duplicate) => {
      const gateway = createGateway();
      const session = new ReadOnlyWorkbenchSession(gateway);

      try {
        await waitForSession(() => session.getSnapshot().loadState.kind === 'ready');
        session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
        await waitForSession(
          () =>
            session.getSnapshot().loadState.kind === 'ready' &&
            session.getSnapshot().assetType === 'longTermInstruction',
        );
        if (duplicate === 'filters') {
          session.dispatch({
            kind: 'setFilters',
            filters: {
              statuses: ['normal', 'editable'],
              agents: ['opencode', 'claude-code'],
            },
          });
          await waitForSession(() => session.getSnapshot().loadState.kind === 'ready');
        }
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
        const callsBeforeRepeat = gateway.methods.length;
        const publications: ReadOnlyWorkbenchState[] = [];
        const stopCapture = session.subscribe(() => publications.push(stateOf(session)));

        if (duplicate === 'asset type') {
          session.dispatch({ kind: 'selectAssetType', assetType: origin.assetType });
        } else if (duplicate === 'view context') {
          session.dispatch({ kind: 'selectViewContext', viewContext: origin.viewContext });
        } else {
          session.dispatch({
            kind: 'setFilters',
            filters: {
              agents: ['claude-code', 'opencode'],
              statuses: ['editable', 'normal'],
            },
          });
        }
        stopCapture();

        expect(publications).toEqual([]);
        expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
        expectOriginPreserved(stateOf(session), originState);
        expect(stateOf(session).filters).toEqual(origin.filters);
        expect(gateway.methods).toHaveLength(callsBeforeRepeat);
      } finally {
        session.dispose();
      }
    },
  );

  it('keeps asset and filter destinations private until an explicit dirty-draft discard', async () => {
    const gateway = createGateway();
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
    const readsBeforeAssetGuard = gateway.methods.length;
    session.dispatch({ kind: 'selectRow', row: OTHER_ROW });
    expect(stateOf(session).dirtyGuard).toEqual({
      kind: 'pending',
      reason: 'assetSwitch',
      target: { assetRef: OTHER_ASSET, assetType: OTHER_ASSET.assetType },
    });
    expectOriginPreserved(stateOf(session), originState);
    expect(gateway.methods).toHaveLength(readsBeforeAssetGuard);

    session.dispatch({ kind: 'continueEditing' });
    expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
    expectOriginPreserved(stateOf(session), originState);
    expect(gateway.methods).toHaveLength(readsBeforeAssetGuard);

    session.dispatch({ kind: 'selectRow', row: OTHER_ROW });
    const assetCommitStates: ReadOnlyWorkbenchState[] = [];
    const stopAssetCapture = session.subscribe(() => assetCommitStates.push(stateOf(session)));
    session.dispatch({ kind: 'discardDraft' });
    stopAssetCapture();
    const firstAssetCommit = assetCommitStates[0];
    if (firstAssetCommit === undefined) throw new Error('discard must publish an asset transition');
    expect(firstAssetCommit).toMatchObject({
      selected: OTHER_ROW,
      detail: { kind: 'loading', assetRef: OTHER_ASSET },
      draft: null,
      dirtyGuard: { kind: 'idle' },
    });
    expect(gateway.methods.length).toBeGreaterThan(readsBeforeAssetGuard);
    session.dispose();

    const filterGateway = createGateway();
    const filterSession = new ReadOnlyWorkbenchSession(filterGateway);
    await waitForSession(() => filterSession.getSnapshot().loadState.kind === 'ready');
    filterSession.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
    await waitForSession(
      () =>
        filterSession.getSnapshot().loadState.kind === 'ready' &&
        filterSession.getSnapshot().assetType === 'longTermInstruction',
    );
    const filterLoaded = filterSession.getSnapshot().loadState;
    if (filterLoaded.kind !== 'ready') throw new Error('filter list must be ready');
    filterSession.dispatch({ kind: 'selectRow', row: filterLoaded.snapshot.segments[0].rows[0] });
    await waitForSession(() => filterSession.getSnapshot().detail.kind === 'ready');
    filterSession.dispatch({ kind: 'focusEditSurface', surface: 'source' });
    filterSession.dispatch({ kind: 'replaceDraftText', text: EDITED_TEXT });

    const filterOrigin = stateOf(filterSession);
    const filterOriginState = {
      assetType: filterOrigin.assetType,
      viewContext: filterOrigin.viewContext,
      selected: filterOrigin.selected,
      detail: filterOrigin.detail,
      draft: filterOrigin.draft,
    };
    const targetFilters: WorkbenchFilters = { statuses: ['editable'] };
    const readsBeforeFilterGuard = filterGateway.methods.length;
    filterSession.dispatch({ kind: 'setFilters', filters: targetFilters });
    expect(stateOf(filterSession).dirtyGuard).toEqual({ kind: 'pending', reason: 'contextSwitch' });
    expect(stateOf(filterSession).filters).toEqual(undefined);
    expectOriginPreserved(stateOf(filterSession), filterOriginState);
    expect(filterGateway.methods).toHaveLength(readsBeforeFilterGuard);

    filterSession.dispatch({ kind: 'cancelDirtyGuard' });
    expect(stateOf(filterSession).dirtyGuard).toEqual({ kind: 'idle' });
    expect(stateOf(filterSession).filters).toEqual(undefined);
    expectOriginPreserved(stateOf(filterSession), filterOriginState);
    expect(filterGateway.methods).toHaveLength(readsBeforeFilterGuard);

    filterSession.dispatch({ kind: 'setFilters', filters: targetFilters });
    const filterCommitStates: ReadOnlyWorkbenchState[] = [];
    const stopFilterCapture = filterSession.subscribe(() =>
      filterCommitStates.push(stateOf(filterSession)),
    );
    filterSession.dispatch({ kind: 'discardDraft' });
    stopFilterCapture();
    const firstFilterCommit = filterCommitStates[0];
    if (firstFilterCommit === undefined)
      throw new Error('discard must publish a filter transition');
    expect(firstFilterCommit).toMatchObject({
      filters: targetFilters,
      selected: null,
      detail: { kind: 'idle' },
      draft: null,
      dirtyGuard: { kind: 'idle' },
    });
    expect(filterGateway.methods.length).toBeGreaterThan(readsBeforeFilterGuard);
    expect(
      [gateway, filterGateway].every((candidate) =>
        candidate.methods.every((method) => method === 'read' || method === 'observe'),
      ),
    ).toBe(true);
    filterSession.dispose();
  });
});
