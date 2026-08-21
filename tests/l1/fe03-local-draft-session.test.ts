/** FE-03：长期指令首次实际编辑只建立 frontend-local draft。 */
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

const ASSET = asset(
  'asset-fe03-instruction-safe',
  'longTermInstruction',
  'nunit-fe03-instruction-safe',
);
const FILE = file('file-fe03-instruction-safe', 'daily.md');
const SOURCE_TEXT = '# Daily instruction\nextension-note: preserve\n';
const EDITED_TEXT = '# Daily instruction\nextension-note: preserve\nAdded safely.\n';
const ROW = row(ASSET, 'Safe daily instruction');
const DETAIL = detail(
  ASSET,
  FILE,
  ROW.displayName,
  'asset-rev-fe03-instruction-safe',
  { kind: 'longTermInstruction', markdownFile: FILE },
  { pathDisplay: 'synthetic/daily.md' },
);
const SOURCE = source(FILE, 'file-rev-fe03-instruction-safe', DETAIL.revision, SOURCE_TEXT);

function draftOf(session: ReadOnlyWorkbenchSession) {
  return session.getSnapshot().draft;
}

describe('FE-03 long-term-instruction local draft', () => {
  it('only creates one local editAsset draft on the first actual source difference', async () => {
    const gateway = new ReadOnlyGateway((query) =>
      query.kind === 'workbench'
        ? workbench(query, ROW, DETAIL.revision)
        : query.kind === 'assetDetail'
          ? DETAIL
          : query.kind === 'nativeFile'
            ? SOURCE
            : undefined,
    );
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
    expect(draftOf(session)).toBeNull();

    session.dispatch({ kind: 'replaceDraftText', text: EDITED_TEXT });
    expect(draftOf(session)).toMatchObject({
      kind: 'editAsset',
      assetRef: ASSET,
      activeFileId: FILE.fileId,
      dirty: true,
      sourceText: EDITED_TEXT,
    });
    expect(draftOf(session)?.sourceText).toContain('extension-note: preserve\n');
    expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(true);

    session.dispose();
  });

  it('does not create a source draft while the authoritative index is stale', async () => {
    const gateway = new ReadOnlyGateway((query) =>
      query.kind === 'workbench'
        ? { ...workbench(query, ROW, DETAIL.revision), indexStatus: 'stale' }
        : query.kind === 'assetDetail'
          ? DETAIL
          : query.kind === 'nativeFile'
            ? SOURCE
            : undefined,
    );
    const session = new ReadOnlyWorkbenchSession(gateway);

    await waitForSession(() => session.getSnapshot().loadState.kind === 'stale');
    const loaded = session.getSnapshot().loadState;
    if (loaded.kind !== 'stale') throw new Error('long-term instruction list must be stale');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    await waitForSession(() => session.getSnapshot().detail.kind === 'ready');

    session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
    session.dispatch({ kind: 'replaceDraftText', text: EDITED_TEXT });

    expect(draftOf(session)).toBeNull();
    session.dispose();
  });
});
