/** FE-03：同一 Skill 的多文件草稿只保留一份 shared editAsset state。 */
import { describe, expect, it } from 'vitest';

import { ReadOnlyWorkbenchSession } from '../../src/session/ReadOnlyWorkbenchSession';
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

const ASSET = asset('asset-fe03-multifile-safe', 'skill', 'nunit-fe03-multifile-safe');
const PRIMARY = file('file-fe03-primary', 'SKILL.md');
const SECONDARY = file('file-fe03-secondary', 'usage.md', false);
const SOURCE_BY_FILE = new Map([
  [PRIMARY.fileId, '# Primary\nextension-primary: preserve\n'],
  [SECONDARY.fileId, '# Usage\nextension-secondary: preserve\n'],
]);
const EDITED_PRIMARY = '# Primary\nextension-primary: preserve\nUpdated safely.\n';
const EDITED_SECONDARY = '# Usage\nextension-secondary: preserve\nUpdated safely.\n';
const ROW = row(ASSET, 'Safe multi-file skill');
const DETAIL = detail(
  ASSET,
  PRIMARY,
  ROW.displayName,
  'asset-rev-fe03-multifile',
  { kind: 'skill', agentTargetStates: [], sourceReadAvailability: { kind: 'allowed' } },
  {
    nativeUnitKind: 'multiFileDirectory',
    fileTreeRoot: {
      name: 'safe-skill',
      children: [
        { name: PRIMARY.name, file: PRIMARY },
        { name: SECONDARY.name, file: SECONDARY },
      ],
    },
    pathDisplay: 'synthetic/safe-skill',
  },
);

function stateOf(session: ReadOnlyWorkbenchSession) {
  return session.getSnapshot();
}

function activeFileIs(session: ReadOnlyWorkbenchSession, fileId: string): boolean {
  const detail = session.getSnapshot().detail;
  return detail.kind === 'ready' && detail.file?.file.fileId === fileId;
}

describe('FE-03 multi-file local draft', () => {
  it('keeps one shared draft through same-asset file and view switches without opening dirty guard', async () => {
    const gateway = new ReadOnlyGateway((query) => {
      if (query.kind === 'workbench') return workbench(query, ROW, DETAIL.revision);
      if (query.kind === 'assetDetail') return DETAIL;
      if (query.kind !== 'nativeFile') return undefined;
      const selected = [PRIMARY, SECONDARY].find((candidate) => candidate.fileId === query.fileId);
      const maskedText = SOURCE_BY_FILE.get(query.fileId);
      return selected === undefined || maskedText === undefined
        ? undefined
        : source(selected, `file-rev-${selected.fileId}`, DETAIL.revision, maskedText);
    });
    const session = new ReadOnlyWorkbenchSession(gateway);

    await waitForSession(() => session.getSnapshot().loadState.kind === 'ready');
    const loaded = session.getSnapshot().loadState;
    if (loaded.kind !== 'ready') throw new Error('skill list must be ready');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    await waitForSession(() => session.getSnapshot().detail.kind === 'ready');

    session.dispatch({ kind: 'selectDetailFile', file: SECONDARY });
    await waitForSession(() => activeFileIs(session, SECONDARY.fileId));
    session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
    session.dispatch({ kind: 'replaceDraftText', text: EDITED_SECONDARY });
    session.dispatch({
      kind: 'setDraftSectionExpanded',
      sectionId: 'source-context',
      expanded: true,
    });

    session.dispatch({ kind: 'selectDetailFile', file: PRIMARY });
    await waitForSession(() => activeFileIs(session, PRIMARY.fileId));
    session.dispatch({ kind: 'setDetailView', view: 'structured' });
    session.dispatch({ kind: 'setDetailView', view: 'source' });
    expect(stateOf(session).dirtyGuard).toEqual({ kind: 'idle' });
    session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
    session.dispatch({ kind: 'replaceDraftText', text: EDITED_PRIMARY });

    session.dispatch({ kind: 'selectDetailFile', file: SECONDARY });
    await waitForSession(() => activeFileIs(session, SECONDARY.fileId));
    session.dispatch({ kind: 'setDetailView', view: 'structured' });
    session.dispatch({ kind: 'setDetailView', view: 'source' });

    const state = stateOf(session);
    expect(state).toMatchObject({
      detailView: 'source',
      dirtyGuard: { kind: 'idle' },
      draft: {
        kind: 'editAsset',
        assetRef: ASSET,
        activeFileId: SECONDARY.fileId,
        dirty: true,
        sourceText: EDITED_SECONDARY,
        expandedSectionIds: ['source-context'],
      },
    });
    expect(state.draft?.fileProjections).toHaveLength(2);
    expect(state.draft?.fileProjections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: PRIMARY.fileId, sourceText: EDITED_PRIMARY }),
        expect.objectContaining({ fileId: SECONDARY.fileId, sourceText: EDITED_SECONDARY }),
      ]),
    );
    expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(true);

    session.dispose();
  });
});
