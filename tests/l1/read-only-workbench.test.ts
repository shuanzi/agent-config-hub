import { describe, expect, it } from 'vitest';

import {
  canonicalizeWorkbenchFilters,
  projectWorkbenchProjection,
  projectVisibleRows,
  type ReadOnlyRow,
  type WorkbenchActualReadSnapshot,
} from '../../src/workbench/read-only-model';

function row(
  assetId: string,
  displayName: string,
  authoritativeInputOrder: number,
  nativeOwnership: ReadOnlyRow['assetRef']['nativeOwnership'] = { kind: 'global' },
): ReadOnlyRow {
  return {
    assetRef: {
      assetId,
      assetType: 'skill',
      nativeUnitRef: `nunit-${assetId}`,
      adapterIdentity: 'fixture@read-only-workbench-test',
      nativeOwnership,
    },
    assetId,
    displayName,
    sortBaseName: displayName,
    authoritativeInputOrder,
  };
}

describe('FE-01 read-only workbench model', () => {
  it('canonicalizes closed filters and rejects project ids outside all', () => {
    expect(
      canonicalizeWorkbenchFilters(
        {
          agents: ['opencode', 'claude-code', 'opencode'],
          sourceIds: ['z-source', 'a-source', 'a-source'],
          statuses: ['drift', 'editable', 'drift'],
        },
        { kind: 'all' },
      ),
    ).toEqual({
      agents: ['claude-code', 'opencode'],
      sourceIds: ['a-source', 'z-source'],
      statuses: ['editable', 'drift'],
    });

    expect(() =>
      canonicalizeWorkbenchFilters({ projectIds: ['project-a'] }, { kind: 'global' }),
    ).toThrow('READ_FAILED');

    // 运行时 ingress 也必须封闭；不能把未知 enum 静默 canonicalize 成空筛选。
    expect(() =>
      canonicalizeWorkbenchFilters(
        {
          agents: ['not-an-agent'] as unknown as NonNullable<
            WorkbenchActualReadSnapshot['query']['filters']
          >['agents'],
        },
        { kind: 'all' },
      ),
    ).toThrow('READ_FAILED');
    expect(() =>
      canonicalizeWorkbenchFilters(
        {
          statuses: ['not-a-status'] as unknown as NonNullable<
            WorkbenchActualReadSnapshot['query']['filters']
          >['statuses'],
        },
        { kind: 'all' },
      ),
    ).toThrow('READ_FAILED');
  });

  it('keeps resolved global rows out of project segments unless resolution is resolved', () => {
    const snapshot = {
      kind: 'workbench',
      query: {
        kind: 'workbench',
        assetType: 'skill',
        viewContext: { kind: 'project', projectId: 'project-a' },
      },
      authoritativeReadRevision: 'rev-1',
      aggregateTotal: 1,
      indexStatus: 'fresh',
      readAt: '2026-08-10T00:00:00.000Z',
      segments: [
        {
          id: 'project-native',
          source: 'projectNative',
          displayLabel: 'A',
          projectId: 'project-a',
          rows: [],
        },
        {
          id: 'global-applicable',
          source: 'globalApplicable',
          displayLabel: 'Global',
          rows: [row('resolved', 'Resolved', 0), row('blocked', 'Blocked', 1)],
        },
      ],
      effectiveContexts: [
        {
          assetId: 'resolved',
          asset: row('resolved', 'Resolved', 0).assetRef,
          projectId: 'project-a',
          resolution: 'resolved',
        },
        {
          assetId: 'blocked',
          asset: row('blocked', 'Blocked', 1).assetRef,
          projectId: 'project-a',
          resolution: 'blocked',
        },
      ],
      findings: [{ assetId: 'blocked', reasonCode: 'READ_FAILED' }],
    } satisfies WorkbenchActualReadSnapshot;

    expect(projectVisibleRows(snapshot).map((row) => row.assetId)).toEqual(['resolved']);
  });

  it('matches project applicability by the complete native AssetRef, never by assetId alone', () => {
    const first = row('shared', 'First native unit', 0);
    const second = {
      ...row('shared', 'Second native unit', 1),
      assetRef: {
        ...row('shared', 'Second native unit', 1).assetRef,
        nativeUnitRef: 'nunit-shared-second',
      },
    };
    const snapshot = {
      kind: 'workbench',
      query: {
        kind: 'workbench',
        assetType: 'skill',
        viewContext: { kind: 'project', projectId: 'opaque-project' },
      },
      authoritativeReadRevision: 'rev-native-ref',
      aggregateTotal: 2,
      indexStatus: 'fresh',
      readAt: '2026-08-10T00:00:00.000Z',
      segments: [
        {
          id: 'global-applicable',
          source: 'globalApplicable',
          displayLabel: 'Global',
          rows: [first, second],
        },
      ],
      effectiveContexts: [
        {
          assetId: 'shared',
          asset: second.assetRef,
          projectId: 'opaque-project',
          resolution: 'resolved',
        },
      ],
      findings: [],
    } as unknown as WorkbenchActualReadSnapshot;

    expect(projectVisibleRows(snapshot).map((row) => row.assetRef.nativeUnitRef)).toEqual([
      'nunit-shared-second',
    ]);
  });

  it('uses one flattened global page after fixed segment order and stable row sorting', () => {
    const snapshot = {
      kind: 'workbench',
      query: { kind: 'workbench', assetType: 'skill', viewContext: { kind: 'all' } },
      authoritativeReadRevision: 'rev-projection',
      aggregateTotal: 5,
      indexStatus: 'fresh',
      readAt: '2026-08-10T00:00:00.000Z',
      effectiveContexts: [],
      findings: [],
      segments: [
        {
          id: 'project-z',
          source: 'projectNative',
          displayLabel: 'Same project',
          projectId: 'z-project',
          rows: [
            row('z-2', 'z2', 1, { kind: 'project', projectId: 'z-project' }),
            row('z-10', 'z10', 0, { kind: 'project', projectId: 'z-project' }),
          ],
        },
        {
          id: 'global',
          source: 'globalApplicable',
          displayLabel: 'Global',
          rows: [row('same-b', 'same', 1), row('same-a', 'same', 0)],
        },
        {
          id: 'project-a',
          source: 'projectNative',
          displayLabel: 'Same project',
          projectId: 'a-project',
          rows: [row('a-1', 'a1', 0, { kind: 'project', projectId: 'a-project' })],
        },
      ],
    } satisfies WorkbenchActualReadSnapshot;

    const first = projectWorkbenchProjection(snapshot, { nameSort: 'asc', pageSize: 20, page: 1 });
    expect(first.aggregateTotal).toBe(5);
    expect(first.segments.map((segment) => segment.id)).toEqual([
      'global',
      'project-a',
      'project-z',
    ]);
    expect(first.segments.flatMap((segment) => segment.rows).map((row) => row.assetId)).toEqual([
      'same-a',
      'same-b',
      'a-1',
      'z-2',
      'z-10',
    ]);

    const pageBoundary = projectWorkbenchProjection(snapshot, {
      nameSort: 'asc',
      pageSize: 20,
      page: 1,
    });
    expect(pageBoundary.page).toBe(1);
    expect(
      projectWorkbenchProjection(snapshot, { nameSort: 'desc', pageSize: 20, page: 9 }).page,
    ).toBe(1);
  });

  it('keeps source segments visible across a single global page boundary', () => {
    const globalRows = Array.from({ length: 20 }, (_, authoritativeInputOrder) =>
      row(
        `global-${authoritativeInputOrder}`,
        `Global ${authoritativeInputOrder}`,
        authoritativeInputOrder,
      ),
    );
    const snapshot = {
      kind: 'workbench',
      query: { kind: 'workbench', assetType: 'skill', viewContext: { kind: 'all' } },
      authoritativeReadRevision: 'rev-page-boundary',
      aggregateTotal: 21,
      indexStatus: 'fresh',
      readAt: '2026-08-10T00:00:00.000Z',
      effectiveContexts: [],
      findings: [],
      segments: [
        {
          id: 'global',
          source: 'globalApplicable',
          displayLabel: 'Global',
          rows: globalRows,
        },
        {
          id: 'project',
          source: 'projectNative',
          displayLabel: 'Project',
          projectId: 'project-opaque',
          rows: [
            row('project-1', 'Project Skill', 0, {
              kind: 'project',
              projectId: 'project-opaque',
            }),
          ],
        },
      ],
    } satisfies WorkbenchActualReadSnapshot;

    const firstPage = projectWorkbenchProjection(snapshot, {
      nameSort: 'asc',
      pageSize: 20,
      page: 1,
    });
    const secondPage = projectWorkbenchProjection(snapshot, {
      nameSort: 'asc',
      pageSize: 20,
      page: 2,
    });

    expect(firstPage.aggregateTotal).toBe(21);
    expect(firstPage.segments.map((segment) => segment.id)).toEqual(['global']);
    expect(secondPage.segments.map((segment) => segment.id)).toEqual(['project']);
    expect(secondPage.segments[0].rows.map((row) => row.assetId)).toEqual(['project-1']);
  });
});
