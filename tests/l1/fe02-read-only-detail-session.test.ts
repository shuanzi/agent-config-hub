/**
 * FE-02 ReadOnlyWorkbenchSession 的最小只读详情行为。
 *
 * Provenance: L1 scripted FrontendGateway only. This verifies session query
 * selection and fail-closed rendering state; it is not IPC/disk evidence.
 */
import { describe, expect, it } from 'vitest';

import type { FrontendGateway, ObserveHandle } from '../../src/contract/gateway';
import type {
  AssetDetailSnapshot,
  NativeFileRef,
  NativeFileSnapshot,
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
import type {
  MvpAssetType,
  ReadOnlyAssetRef,
  WorkbenchActualReadSnapshot,
} from '../../src/workbench/read-only-model';

const defaultSourceAssetTypes = ['longTermInstruction', 'subagent'] as const;

function assetRef(assetType: MvpAssetType): ReadOnlyAssetRef {
  return {
    assetId: `asset-fx02-${assetType}`,
    assetType,
    nativeUnitRef: `native-fx02-${assetType}`,
    adapterIdentity: 'fixture@fx02',
    nativeOwnership: { kind: 'global' },
  };
}

function file(
  assetType: MvpAssetType,
  name: string,
  fileKind: NativeFileRef['fileKind'],
  isPrimary: boolean,
): NativeFileRef {
  return {
    fileId: `file-fx02-${assetType}-${name}`,
    name,
    relativePath: isPrimary ? name : `references/${name}`,
    fileKind,
    isPrimary,
    canPreview:
      fileKind === 'text'
        ? { kind: 'allowed' }
        : { kind: 'disabled', reasonCode: 'NON_TEXT_UNPREVIEWABLE' },
    canEdit: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
    hasDraftChanges: false,
  };
}

function detailSnapshot(assetType: MvpAssetType): AssetDetailSnapshot {
  const primary = file(
    assetType,
    assetType === 'skill' ? 'SKILL.md' : `${assetType}.md`,
    'text',
    true,
  );
  const secondary = file(assetType, 'usage.md', 'text', false);
  const opaque = file(assetType, 'opaque.bin', 'nonText', false);
  const readSurface =
    assetType === 'skill'
      ? {
          kind: 'skill' as const,
          agentTargetStates: [],
          sourceReadAvailability: { kind: 'allowed' as const },
        }
      : assetType === 'longTermInstruction'
        ? { kind: 'longTermInstruction' as const, markdownFile: primary }
        : {
            kind: 'subagent' as const,
            model: 'fixture-model',
            tools: ['read'],
            permissions: ['read-only'],
            bodyFile: primary,
            readOnlyReason: 'UNKNOWN_FIELD_PRESERVED' as const,
          };
  return {
    kind: 'assetDetail',
    revision: `revision-fx02-${assetType}`,
    detail: {
      asset: assetRef(assetType),
      displayName: `FX-02 ${assetType}`,
      nativeUnitKind: assetType === 'skill' ? 'multiFileDirectory' : 'singleFile',
      revision: `revision-fx02-${assetType}`,
      compatibility: 'recognizedReadOnly',
      capabilities: {
        edit: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
        convert: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
        export: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
        delete: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
      },
      primaryFile: primary,
      ...(assetType === 'skill'
        ? {
            fileTreeRoot: {
              name: 'multifile-skill-mixed',
              children: [
                { name: primary.name, file: primary },
                { name: secondary.name, file: secondary },
                { name: opaque.name, file: opaque },
              ],
            },
          }
        : {}),
      effectiveContexts: [],
      readSurface,
    },
    inspector: {
      agents: [],
      scope: 'global',
      effectiveContexts: [],
      sourceAnchor: { kind: 'globalRoot', label: 'fixture root' },
      pathDisplay: 'fixture root',
      compatibility: 'recognizedReadOnly',
      overrides: [],
    },
  };
}

function nativeFileSnapshot(assetType: MvpAssetType, selected: NativeFileRef): NativeFileSnapshot {
  const revision = `revision-fx02-${assetType}`;
  return {
    kind: 'nativeFile',
    file: selected,
    revision,
    assetRevision: revision,
    content:
      selected.fileKind === 'nonText'
        ? {
            kind: 'nonTextMetadata',
            fileKindLabel: 'binary',
            sizeBytes: 7,
            pathDisplay: `fixture/${selected.relativePath}`,
            reasonCode: 'NON_TEXT_UNPREVIEWABLE',
            reason: '该文件不能作为文本预览。',
          }
        : {
            kind: 'source',
            maskedText: `${selected.name}\n••••••••`,
            sensitiveSegments: [],
          },
    structuredView: { kind: 'disabled', reasonCode: 'UNKNOWN_FIELD_PRESERVED' },
  };
}

function workbenchSnapshot(assetType: MvpAssetType): WorkbenchActualReadSnapshot {
  const ref = assetRef(assetType);
  return {
    kind: 'workbench',
    query: { kind: 'workbench', assetType, viewContext: { kind: 'all' } },
    authoritativeReadRevision: `revision-fx02-${assetType}`,
    segments: [
      {
        id: `global-${assetType}`,
        source: 'globalApplicable',
        displayLabel: 'Global',
        rows: [
          {
            assetRef: ref,
            assetId: ref.assetId,
            displayName: `FX-02 ${assetType}`,
            sortBaseName: `FX-02 ${assetType}`,
            authoritativeInputOrder: 0,
          },
        ],
      },
    ],
    effectiveContexts: [],
    findings: [],
    aggregateTotal: 1,
    indexStatus: 'fresh',
    readAt: '2026-08-14T00:00:00.000Z',
  };
}

class Fx02DetailGateway implements FrontendGateway {
  readonly calls: Query[] = [];

  read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
    this.calls.push(query);
    if (query.kind === 'workbench') {
      return Promise.resolve({
        kind: 'readSucceeded',
        snapshot: workbenchSnapshot(query.assetType),
      }) as Promise<ReadResult<SnapshotFor<Q>>>;
    }
    if (query.kind === 'assetDetail') {
      return Promise.resolve({
        kind: 'readSucceeded',
        snapshot: detailSnapshot(query.asset.assetType as MvpAssetType),
      }) as Promise<ReadResult<SnapshotFor<Q>>>;
    }
    if (query.kind === 'nativeFile') {
      const assetType = query.asset.assetType as MvpAssetType;
      const detail = detailSnapshot(assetType);
      const files = [
        detail.detail.primaryFile,
        ...(detail.detail.fileTreeRoot?.children?.flatMap((node) =>
          node.file ? [node.file] : [],
        ) ?? []),
      ];
      const selected = files.find((candidate) => candidate.fileId === query.fileId);
      return Promise.resolve(
        selected === undefined
          ? {
              kind: 'readFailed',
              reasonCode: 'READ_FAILED',
              message: 'fixture file not found',
              recoveryAction: { kind: 'retryRead' },
            }
          : { kind: 'readSucceeded', snapshot: nativeFileSnapshot(assetType, selected) },
      ) as Promise<ReadResult<SnapshotFor<Q>>>;
    }
    return Promise.resolve({
      kind: 'readFailed',
      reasonCode: 'READ_FAILED',
      message: 'unexpected read query',
    }) as Promise<ReadResult<SnapshotFor<Q>>>;
  }

  observe(_subscription: Subscription, _listener: (event: WorkspaceEvent) => void): ObserveHandle {
    return { ready: Promise.resolve(), unlisten: () => {} };
  }
}

class DeferredFx02DetailGateway extends Fx02DetailGateway {
  private readonly pending: Array<{
    query: Query;
    resolve: (result: ReadResult<unknown>) => void;
  }> = [];

  override read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
    this.calls.push(query);
    return new Promise((resolve) => {
      this.pending.push({
        query,
        resolve: (result) => resolve(result as ReadResult<SnapshotFor<Q>>),
      });
    });
  }

  resolve(kind: Query['kind'], result: ReadResult<unknown>, occurrence = 0): void {
    const index = this.pending.findIndex(
      (pending) => pending.query.kind === kind && occurrence-- === 0,
    );
    if (index < 0) throw new Error(`missing deferred ${kind} read`);
    this.pending.splice(index, 1)[0].resolve(result);
  }

  hasPending(kind: Query['kind']): boolean {
    return this.pending.some((pending) => pending.query.kind === kind);
  }
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

function onlyReadQueries(calls: readonly Query[]): void {
  expect(calls.map((call) => call.kind)).toEqual(
    expect.arrayContaining(['workbench', 'assetDetail', 'nativeFile']),
  );
  expect(
    calls.every((call) => ['workbench', 'assetDetail', 'nativeFile'].includes(call.kind)),
  ).toBe(true);
}

async function waitForPending(
  gateway: DeferredFx02DetailGateway,
  kind: Query['kind'],
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (gateway.hasPending(kind)) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`missing pending ${kind} read`);
}

describe('FE-02 ReadOnlyWorkbenchSession detail/file selection', () => {
  it.each(defaultSourceAssetTypes)(
    'opens %s through its type-specific read surface with only a default primary-file read',
    async (assetType) => {
      const gateway = new Fx02DetailGateway();
      const session = new ReadOnlyWorkbenchSession(gateway);
      await waitFor(session, (state) => state.loadState.kind === 'ready');
      session.dispatch({ kind: 'selectAssetType', assetType });
      await waitFor(
        session,
        (state) => state.loadState.kind === 'ready' && state.assetType === assetType,
      );
      const row = session.getSnapshot().loadState;
      if (row.kind !== 'ready') throw new Error('workbench did not become ready');
      session.dispatch({ kind: 'selectRow', row: row.snapshot.segments[0].rows[0] });
      const ready = await waitFor(session, (state) => state.detail.kind === 'ready');
      if (ready.detail.kind !== 'ready') throw new Error('detail did not become ready');
      if (ready.detail.file === undefined)
        throw new Error('default source file did not become ready');

      expect(ready.detail.detail.detail.readSurface.kind).toBe(assetType);
      expect(ready.detail.file.file.fileId).toBe(ready.detail.detail.detail.primaryFile.fileId);
      expect(ready.detail.file.file.fileKind).toBe('text');
      expect(ready.detail.file.file.hasDraftChanges).toBe(false);
      expect(ready.detail.file.file.canEdit).toEqual({
        kind: 'disabled',
        reasonCode: 'READ_ONLY_POLICY',
      });
      if (ready.detail.file.content.kind === 'source') {
        expect(ready.detail.file.content.maskedText).toContain('••');
        expect(ready.detail.file.content.maskedText).not.toContain('SYNTHETIC-SECRET');
      }
      onlyReadQueries(gateway.calls);
      expect(gateway.calls.filter((call) => call.kind === 'nativeFile')).toHaveLength(1);
      session.dispose();
    },
  );

  it('opens a Skill structured detail and file tree without reading native source until an explicit file selection', async () => {
    const gateway = new Fx02DetailGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitFor(session, (state) => state.loadState.kind === 'ready');
    const loaded = session.getSnapshot().loadState;
    if (loaded.kind !== 'ready') throw new Error('workbench did not become ready');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    const detail = await waitFor(
      session,
      (state) =>
        state.detail.kind === 'ready' && state.detail.detail.detail.readSurface.kind === 'skill',
    );
    if (detail.detail.kind !== 'ready') throw new Error('Skill detail did not become ready');
    expect(detail.detail.detail.detail.fileTreeRoot).toBeDefined();
    expect(detail.detail.detail.detail.primaryFile.canEdit).toEqual({
      kind: 'disabled',
      reasonCode: 'READ_ONLY_POLICY',
    });
    expect(gateway.calls.filter((call) => call.kind === 'assetDetail')).toHaveLength(1);
    expect(gateway.calls.filter((call) => call.kind === 'nativeFile')).toHaveLength(0);

    session.dispatch({ kind: 'selectDetailFile', file: detail.detail.detail.detail.primaryFile });
    const source = await waitFor(
      session,
      (state) =>
        state.detail.kind === 'ready' &&
        state.detail.file !== undefined &&
        state.detail.file.file.isPrimary,
    );
    if (source.detail.kind !== 'ready')
      throw new Error('Skill primary source did not become ready');
    if (source.detail.file === undefined)
      throw new Error('Skill primary source did not become ready');
    expect(source.detail.file.content).toMatchObject({
      kind: 'source',
      maskedText: expect.stringContaining('••'),
    });
    expect(gateway.calls.filter((call) => call.kind === 'nativeFile')).toHaveLength(1);
    onlyReadQueries(gateway.calls);
    session.dispose();
  });

  it('does not revive a detail after retry workbench failure clears its authoritative selection', async () => {
    const gateway = new DeferredFx02DetailGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitForPending(gateway, 'workbench');
    gateway.resolve('workbench', { kind: 'readSucceeded', snapshot: workbenchSnapshot('skill') });
    await waitFor(session, (state) => state.loadState.kind === 'ready');
    session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
    await waitForPending(gateway, 'workbench');
    gateway.resolve('workbench', {
      kind: 'readSucceeded',
      snapshot: workbenchSnapshot('longTermInstruction'),
    });
    await waitFor(
      session,
      (state) => state.loadState.kind === 'ready' && state.assetType === 'longTermInstruction',
    );
    const loaded = session.getSnapshot().loadState;
    if (loaded.kind !== 'ready') throw new Error('workbench did not become ready');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    await waitForPending(gateway, 'assetDetail');
    gateway.resolve('assetDetail', {
      kind: 'readSucceeded',
      snapshot: detailSnapshot('longTermInstruction'),
    });
    await waitForPending(gateway, 'nativeFile');
    session.dispatch({ kind: 'retry' });
    await waitForPending(gateway, 'workbench');
    await waitForPending(gateway, 'assetDetail');

    gateway.resolve('workbench', {
      kind: 'readFailed',
      reasonCode: 'READ_FAILED',
      message: 'authoritative workbench reread failed',
    });
    await waitFor(session, (state) => state.loadState.kind === 'failed');
    gateway.resolve('nativeFile', {
      kind: 'readSucceeded',
      snapshot: nativeFileSnapshot(
        'longTermInstruction',
        detailSnapshot('longTermInstruction').detail.primaryFile,
      ),
    });
    gateway.resolve('assetDetail', {
      kind: 'readSucceeded',
      snapshot: detailSnapshot('longTermInstruction'),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(session.getSnapshot()).toMatchObject({
      loadState: { kind: 'failed', reasonCode: 'READ_FAILED' },
      selected: null,
      detail: { kind: 'idle' },
    });
    session.dispose();
  });

  it('switches a multi-file Skill to secondary text/non-text and fails closed for an unreadable file', async () => {
    const gateway = new Fx02DetailGateway();
    const session = new ReadOnlyWorkbenchSession(gateway);
    await waitFor(session, (state) => state.loadState.kind === 'ready');
    const loaded = session.getSnapshot().loadState;
    if (loaded.kind !== 'ready') throw new Error('workbench did not become ready');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    let ready = await waitFor(session, (state) => state.detail.kind === 'ready');
    if (ready.detail.kind !== 'ready') throw new Error('detail did not become ready');
    const files = ready.detail.detail.detail.fileTreeRoot?.children?.flatMap((node) =>
      node.file === undefined ? [] : [node.file],
    );
    const secondaryText = files?.find(
      (candidate) => !candidate.isPrimary && candidate.fileKind === 'text',
    );
    const nonText = files?.find((candidate) => candidate.fileKind === 'nonText');
    if (secondaryText === undefined || nonText === undefined)
      throw new Error('missing fixture files');

    session.dispatch({ kind: 'selectDetailFile', file: secondaryText });
    ready = await waitFor(
      session,
      (state) =>
        state.detail.kind === 'ready' &&
        state.detail.file !== undefined &&
        state.detail.file.file.fileId === secondaryText.fileId,
    );
    if (ready.detail.kind !== 'ready') throw new Error('secondary text did not become ready');
    if (ready.detail.file === undefined) throw new Error('secondary text did not become ready');
    expect(ready.detail.file.content).toMatchObject({
      kind: 'source',
      maskedText: expect.stringContaining('••'),
    });
    expect(ready.detail.file.file.hasDraftChanges).toBe(false);

    session.dispatch({ kind: 'selectDetailFile', file: nonText });
    ready = await waitFor(
      session,
      (state) =>
        state.detail.kind === 'ready' &&
        state.detail.file !== undefined &&
        state.detail.file.file.fileId === nonText.fileId,
    );
    if (ready.detail.kind !== 'ready') throw new Error('non-text metadata did not become ready');
    if (ready.detail.file === undefined) throw new Error('non-text metadata did not become ready');
    expect(ready.detail.file.content).toMatchObject({
      kind: 'nonTextMetadata',
      reasonCode: 'NON_TEXT_UNPREVIEWABLE',
    });

    session.dispatch({
      kind: 'selectDetailFile',
      file: { ...nonText, fileId: 'file-fx02-missing' },
    });
    const failed = await waitFor(session, (state) => state.detail.kind === 'failed');
    expect(failed.detail).toMatchObject({ kind: 'failed', reasonCode: 'READ_FAILED' });
    onlyReadQueries(gateway.calls);
    expect(gateway.calls.filter((call) => call.kind === 'nativeFile')).toHaveLength(3);
    session.dispose();
  });
});
