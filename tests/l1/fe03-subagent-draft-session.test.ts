/** FE-03：Subagent 的安全 structured model edit 只建立 frontend-local draft。 */
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

const ASSET = asset('asset-fe03-subagent-safe', 'subagent', 'nunit-fe03-subagent-safe');
const FILE = file('file-fe03-subagent-safe', 'subagent.yaml');
const INITIAL_MODEL = 'safe-model-base';
const UPDATED_MODEL = 'safe-model-next';
const SOURCE_TEXT = `model: ${INITIAL_MODEL}\nopaque-extension: preserve\n`;
const UPDATED_SOURCE_TEXT = `model: ${UPDATED_MODEL}\nopaque-extension: preserve\n`;
const ROW = row(ASSET, 'Safe Subagent');
const DETAIL = detail(
  ASSET,
  FILE,
  ROW.displayName,
  'asset-rev-fe03-subagent-safe',
  { kind: 'subagent', model: INITIAL_MODEL, tools: [], permissions: [], bodyFile: FILE },
  { pathDisplay: 'synthetic/subagent.yaml' },
);
const SOURCE = source(FILE, 'file-rev-fe03-subagent-safe', DETAIL.revision, SOURCE_TEXT);

function stateOf(session: ReadOnlyWorkbenchSession) {
  return session.getSnapshot();
}

describe('FE-03 Subagent structured local draft', () => {
  it('only records the first actual model change while preserving the full source projection', async () => {
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
    session.dispatch({ kind: 'selectAssetType', assetType: 'subagent' });
    await waitForSession(
      () =>
        session.getSnapshot().loadState.kind === 'ready' &&
        session.getSnapshot().assetType === 'subagent',
    );
    const loaded = session.getSnapshot().loadState;
    if (loaded.kind !== 'ready') throw new Error('Subagent list must be ready');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    await waitForSession(() => session.getSnapshot().detail.kind === 'ready');

    session.dispatch({ kind: 'focusEditSurface', surface: 'structured' });
    session.dispatch({ kind: 'replaceDraftField', field: 'model', value: INITIAL_MODEL });
    expect(stateOf(session).draft).toBeNull();

    session.dispatch({ kind: 'replaceDraftField', field: 'model', value: UPDATED_MODEL });
    expect(stateOf(session).draft).toMatchObject({
      kind: 'editAsset',
      assetRef: ASSET,
      activeFileId: FILE.fileId,
      dirty: true,
      sourceText: UPDATED_SOURCE_TEXT,
      structuredFieldEdits: { model: UPDATED_MODEL },
      fileProjections: [{ fileId: FILE.fileId, sourceText: UPDATED_SOURCE_TEXT }],
    });
    expect(stateOf(session).draft?.sourceText).toContain('opaque-extension: preserve\n');
    expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(true);

    session.dispose();
  });

  it('does not create a structured draft while the authoritative index is stale', async () => {
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
    if (loaded.kind !== 'stale') throw new Error('Subagent list must be stale');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    await waitForSession(() => session.getSnapshot().detail.kind === 'ready');

    session.dispatch({ kind: 'focusEditSurface', surface: 'structured' });
    session.dispatch({ kind: 'replaceDraftField', field: 'model', value: UPDATED_MODEL });

    expect(stateOf(session).draft).toBeNull();
    session.dispose();
  });
});
