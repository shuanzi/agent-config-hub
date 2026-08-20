import { describe, expect, it } from 'vitest';

import { ScriptedMockGateway } from '../../src/gateway/mock';
import {
  ReadOnlyWorkbenchSession,
  type ReadOnlyWorkbenchState,
} from '../../src/session/ReadOnlyWorkbenchSession';
import {
  DEFAULT_LIST_PRESENTATION,
  projectWorkbenchProjection,
  type WorkbenchActualReadSnapshot,
} from '../../src/workbench/read-only-model';

function singleRowSnapshot(rowCount = 1): WorkbenchActualReadSnapshot {
  return {
    kind: 'workbench',
    query: { kind: 'workbench', assetType: 'skill', viewContext: { kind: 'all' } },
    authoritativeReadRevision: 'fe10-red-revision',
    segments: [
      {
        id: 'global',
        source: 'globalApplicable',
        displayLabel: 'Global',
        rows: Array.from({ length: rowCount }, (_, index) => ({
          assetRef: {
            assetId: `fe10-red-skill-${index}`,
            assetType: 'skill',
            nativeUnitRef: `fe10-red-native-unit-${index}`,
            adapterIdentity: 'fe10-red-adapter',
            nativeOwnership: { kind: 'global' as const },
          },
          assetId: `fe10-red-skill-${index}`,
          displayName: `FE-10 read-only Skill ${index}`,
          sortBaseName: `FE-10 read-only Skill ${index}`,
          authoritativeInputOrder: index,
        })),
      },
    ],
    effectiveContexts: [],
    findings: [],
    aggregateTotal: rowCount,
    indexStatus: 'fresh',
    readAt: '2026-08-20T00:00:00.000Z',
  };
}

async function waitFor(
  session: ReadOnlyWorkbenchSession,
  predicate: (state: ReadOnlyWorkbenchState) => boolean,
): Promise<ReadOnlyWorkbenchState> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = session.getSnapshot();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('session state did not settle');
}

describe('FE-10 read-only accessibility public seams', () => {
  it('rejects a local name-sort value outside the closed asc/desc presentation contract', () => {
    expect(() =>
      projectWorkbenchProjection(singleRowSnapshot(), {
        ...DEFAULT_LIST_PRESENTATION,
        nameSort: 'sideways' as never,
      }),
    ).toThrow('READ_FAILED');
  });

  it('uses global 20/50/100 pagination and resets page atomically for each presentation input', async () => {
    expect(DEFAULT_LIST_PRESENTATION).toEqual({ nameSort: 'asc', pageSize: 20, page: 1 });
    for (const [pageSize, pageCount] of [
      [20, 6],
      [50, 3],
      [100, 2],
    ] as const) {
      const projection = projectWorkbenchProjection(singleRowSnapshot(101), {
        ...DEFAULT_LIST_PRESENTATION,
        pageSize,
      });
      expect(projection.pageCount).toBe(pageCount);
      expect(projection.segments.flatMap((segment) => segment.rows)).toHaveLength(pageSize);
    }

    const session = new ReadOnlyWorkbenchSession(new ScriptedMockGateway());
    await waitFor(session, (state) => state.loadState.kind === 'ready');
    const expectReset = () => expect(session.getSnapshot().presentation.page).toBe(1);

    session.dispatch({ kind: 'setPage', page: 2 });
    session.dispatch({ kind: 'setNameSort', nameSort: 'desc' });
    expectReset();
    session.dispatch({ kind: 'setPage', page: 2 });
    session.dispatch({ kind: 'setPageSize', pageSize: 50 });
    expectReset();
    session.dispatch({ kind: 'setPage', page: 2 });
    session.dispatch({ kind: 'setFilters', filters: { agents: ['codex'] } });
    expectReset();
    session.dispatch({ kind: 'setPage', page: 2 });
    session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
    expectReset();
    session.dispatch({ kind: 'setPage', page: 2 });
    session.dispatch({ kind: 'selectViewContext', viewContext: { kind: 'global' } });
    expectReset();

    session.dispose();
  });

  it('trims a nonempty locator query before its read-only FrontendGateway request', async () => {
    const gateway = new ScriptedMockGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitFor(session, (state) => state.loadState.kind === 'ready');

    session.dispatch({ kind: 'openLocator' });
    session.dispatch({ kind: 'setLocatorSearch', searchText: '  Café  ' });
    await waitFor(
      session,
      (state) => state.locator.kind === 'open' && state.locator.snapshot !== null,
    );

    const locatorCalls = gateway.getCallLog().filter((call) => call.queryKind === 'globalLocator');
    expect(locatorCalls).toHaveLength(1);
    expect(locatorCalls[0]?.query).toMatchObject({
      kind: 'globalLocator',
      searchText: 'Café',
      assetTypes: ['skill', 'longTermInstruction', 'subagent'],
    });
    expect(gateway.getCallLog().every((call) => call.method === 'read')).toBe(true);

    session.dispose();
  });
});
