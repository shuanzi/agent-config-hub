/** FE-03：敏感 source 只允许编辑 Rust 权威 maskedParts 中的普通文本。 */
import { describe, expect, it, vi } from 'vitest';

import type { FrontendGateway, ObserveHandle } from '../../src/contract/gateway';
import type {
  MaskedSourcePart,
  Query,
  ReadResult,
  SnapshotFor,
  Subscription,
  WorkspaceEvent,
} from '../../src/contract/types';
import { ReadOnlyWorkbenchSession } from '../../src/session/ReadOnlyWorkbenchSession';
import {
  asset,
  detail,
  file,
  row,
  source,
  waitForSession,
  workbench,
} from './support/fe03-session-fixtures';

const ASSET = asset(
  'asset-fe03-sensitive-safe',
  'longTermInstruction',
  'nunit-fe03-sensitive-safe',
);
const FILE = file('file-fe03-sensitive-safe', 'daily.md');
const OTHER_FILE = file('file-fe03-sensitive-other-safe', 'other.md', false);

const SEGMENT_ID = 'segment-fe03-sensitive-safe';
const OTHER_SEGMENT_ID = 'segment-fe03-sensitive-other-safe';
const MASKED_PARTS: MaskedSourcePart[] = [
  { kind: 'text', text: 'setting=' },
  { kind: 'sensitivePlaceholder', segmentId: SEGMENT_ID },
  { kind: 'text', text: '\nunknown-extension: preserve\n' },
];
const MASKED_TEXT = 'setting=••••••••\nunknown-extension: preserve\n';
const EDITED_MASKED_TEXT = 'updated-setting=••••••••\nunknown-extension: preserve\n';
const EDITED_MASKED_PARTS: MaskedSourcePart[] = [
  { kind: 'text', text: 'updated-setting=' },
  MASKED_PARTS[1],
  MASKED_PARTS[2],
];

const ROW = row(ASSET, 'Safe sensitive instruction');
const DETAIL = detail(ASSET, FILE, ROW.displayName, 'asset-rev-fe03-sensitive-safe', {
  kind: 'longTermInstruction',
  markdownFile: FILE,
});
const SOURCE = source(FILE, 'file-rev-fe03-sensitive-safe', DETAIL.revision, MASKED_TEXT, {
  sensitiveSegments: [
    {
      segmentId: SEGMENT_ID,
      fileId: FILE.fileId,
      revision: 'file-rev-fe03-sensitive-safe',
      displayState: 'masked',
    },
  ],
  maskedParts: MASKED_PARTS,
});

type SensitiveBinding = {
  asset: typeof ASSET;
  row: typeof ROW;
  detail: typeof DETAIL;
  sensitiveFile: typeof FILE;
  sensitiveSource: typeof SOURCE;
  segmentId: string;
  assetType: 'longTermInstruction' | 'skill';
  ordinaryFile?: typeof FILE;
  ordinarySource?: typeof SOURCE;
  strictFileIds?: boolean;
};

const LTI_BINDING: SensitiveBinding = {
  asset: ASSET,
  row: ROW,
  detail: DETAIL,
  sensitiveFile: FILE,
  sensitiveSource: SOURCE,
  segmentId: SEGMENT_ID,
  assetType: 'longTermInstruction',
};

const MULTIFILE_ASSET = asset('asset-fe03-sensitive-skill', 'skill', 'nunit-fe03-sensitive-skill');
const MULTIFILE_SENSITIVE_FILE = file('file-fe03-sensitive-skill', 'SKILL.md');
const MULTIFILE_ORDINARY_FILE = file('file-fe03-ordinary-skill', 'usage.md', false);
const MULTIFILE_SEGMENT_ID = 'segment-fe03-sensitive-skill';
const MULTIFILE_MASKED_PARTS: MaskedSourcePart[] = [
  { kind: 'text', text: 'setting=' },
  { kind: 'sensitivePlaceholder', segmentId: MULTIFILE_SEGMENT_ID },
  { kind: 'text', text: '\nunknown-extension: preserve\n' },
];
const MULTIFILE_MASKED_TEXT = 'setting=••••••••\nunknown-extension: preserve\n';
const MULTIFILE_EDITED_MASKED_TEXT = 'updated-setting=••••••••\nunknown-extension: preserve\n';
const MULTIFILE_EDITED_MASKED_PARTS: MaskedSourcePart[] = [
  { kind: 'text', text: 'updated-setting=' },
  MULTIFILE_MASKED_PARTS[1],
  MULTIFILE_MASKED_PARTS[2],
];
const MULTIFILE_ORDINARY_TEXT = 'ordinary-setting=authority\nunknown-extension: preserve\n';
const MULTIFILE_EDITED_ORDINARY_TEXT = 'ordinary-setting=edited\nunknown-extension: preserve\n';
const MULTIFILE_ROW = row(MULTIFILE_ASSET, 'Safe sensitive multi-file skill');
const MULTIFILE_DETAIL = detail(
  MULTIFILE_ASSET,
  MULTIFILE_SENSITIVE_FILE,
  MULTIFILE_ROW.displayName,
  'asset-rev-fe03-sensitive-skill',
  { kind: 'skill', agentTargetStates: [], sourceReadAvailability: { kind: 'allowed' } },
  {
    nativeUnitKind: 'multiFileDirectory',
    fileTreeRoot: {
      name: 'safe-sensitive-skill',
      children: [
        { name: MULTIFILE_SENSITIVE_FILE.name, file: MULTIFILE_SENSITIVE_FILE },
        { name: MULTIFILE_ORDINARY_FILE.name, file: MULTIFILE_ORDINARY_FILE },
      ],
    },
  },
);
const MULTIFILE_SENSITIVE_SOURCE = source(
  MULTIFILE_SENSITIVE_FILE,
  'file-rev-fe03-sensitive-skill',
  MULTIFILE_DETAIL.revision,
  MULTIFILE_MASKED_TEXT,
  {
    sensitiveSegments: [
      {
        segmentId: MULTIFILE_SEGMENT_ID,
        fileId: MULTIFILE_SENSITIVE_FILE.fileId,
        revision: 'file-rev-fe03-sensitive-skill',
        displayState: 'masked',
      },
    ],
    maskedParts: MULTIFILE_MASKED_PARTS,
  },
);
const MULTIFILE_ORDINARY_SOURCE = source(
  MULTIFILE_ORDINARY_FILE,
  'file-rev-fe03-ordinary-skill',
  MULTIFILE_DETAIL.revision,
  MULTIFILE_ORDINARY_TEXT,
);
const MULTIFILE_BINDING: SensitiveBinding = {
  asset: MULTIFILE_ASSET,
  row: MULTIFILE_ROW,
  detail: MULTIFILE_DETAIL,
  sensitiveFile: MULTIFILE_SENSITIVE_FILE,
  sensitiveSource: MULTIFILE_SENSITIVE_SOURCE,
  ordinaryFile: MULTIFILE_ORDINARY_FILE,
  ordinarySource: MULTIFILE_ORDINARY_SOURCE,
  segmentId: MULTIFILE_SEGMENT_ID,
  assetType: 'skill',
  strictFileIds: true,
};

class SensitiveDraftGateway implements FrontendGateway {
  readonly methods: Array<'read' | 'observe'> = [];
  readonly queries: Query[] = [];
  private listener: ((event: WorkspaceEvent) => void) | null = null;

  constructor(
    protected readonly binding: SensitiveBinding = LTI_BINDING,
    private readonly indexStatus: 'fresh' | 'stale' = 'fresh',
  ) {}

  read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
    this.methods.push('read');
    this.queries.push(query);
    if (query.kind === 'workbench') {
      return Promise.resolve({
        kind: 'readSucceeded',
        snapshot: {
          ...workbench(query, this.binding.row, this.binding.detail.revision),
          indexStatus: this.indexStatus,
        },
      } as ReadResult<SnapshotFor<Q>>);
    }
    if (query.kind === 'assetDetail') {
      return Promise.resolve({ kind: 'readSucceeded', snapshot: this.binding.detail } as ReadResult<
        SnapshotFor<Q>
      >);
    }
    if (query.kind === 'nativeFile') {
      const snapshot =
        query.fileId === this.binding.sensitiveFile.fileId
          ? this.binding.sensitiveSource
          : query.fileId === this.binding.ordinaryFile?.fileId
            ? this.binding.ordinarySource
            : this.binding.strictFileIds
              ? undefined
              : this.binding.sensitiveSource;
      if (snapshot === undefined) {
        return Promise.resolve({
          kind: 'readFailed',
          reasonCode: 'READ_FAILED',
          message: 'unexpected synthetic file',
        } as ReadResult<SnapshotFor<Q>>);
      }
      return Promise.resolve({ kind: 'readSucceeded', snapshot } as ReadResult<SnapshotFor<Q>>);
    }
    return Promise.resolve({
      kind: 'readFailed',
      reasonCode: 'READ_FAILED',
      message: 'unexpected synthetic query',
    } as ReadResult<SnapshotFor<Q>>);
  }

  observe(_subscription: Subscription, listener: (event: WorkspaceEvent) => void): ObserveHandle {
    this.methods.push('observe');
    this.listener = listener;
    return {
      ready: Promise.resolve(),
      unlisten: () => {
        if (this.listener === listener) this.listener = null;
      },
    };
  }

  emit(event: WorkspaceEvent): void {
    this.listener?.(event);
  }
}

function authoritativeSensitiveGateway(
  ephemeralValue: string,
  grantId: string,
  expiresAt: string,
  binding: SensitiveBinding = LTI_BINDING,
): SensitiveDraftGateway & { readonly sensitiveQueries: readonly Query[] } {
  const sensitiveQueries: Query[] = [];
  return new (class extends SensitiveDraftGateway {
    constructor() {
      super(binding);
    }

    get sensitiveQueries(): readonly Query[] {
      return sensitiveQueries;
    }

    override read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
      if (query.kind !== 'sensitiveReveal') return super.read(query);
      this.methods.push('read');
      sensitiveQueries.push(query);
      const matchesCurrentSource =
        query.asset.assetId === binding.asset.assetId &&
        query.fileId === binding.sensitiveFile.fileId &&
        query.segmentId === binding.segmentId &&
        query.fileRevision === binding.sensitiveSource.revision &&
        query.assetRevision === binding.sensitiveSource.assetRevision &&
        query.scope === 'modify' &&
        query.surface === 'source';
      return Promise.resolve(
        matchesCurrentSource
          ? {
              kind: 'readSucceeded',
              snapshot: {
                kind: 'sensitiveReveal',
                plaintext: ephemeralValue,
                grant: {
                  grantId,
                  asset: binding.asset,
                  fileId: binding.sensitiveFile.fileId,
                  segmentId: binding.segmentId,
                  fileRevision: binding.sensitiveSource.revision,
                  assetRevision: binding.sensitiveSource.assetRevision,
                  scope: 'modify',
                  surface: 'source',
                  expiresAt,
                },
              },
            }
          : {
              kind: 'readFailed',
              reasonCode: 'READ_FAILED',
              message: 'synthetic binding mismatch',
            },
      ) as Promise<ReadResult<SnapshotFor<Q>>>;
    }
  })();
}

function stateOf(session: ReadOnlyWorkbenchSession) {
  return session.getSnapshot();
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

function runtimeSensitiveAuthority(): {
  ephemeralValue: string;
  grantId: string;
  expiresAt: string;
} {
  return {
    ephemeralValue: String.fromCharCode(
      115,
      119,
      105,
      116,
      99,
      104,
      45,
      98,
      117,
      102,
      102,
      101,
      114,
    ),
    grantId: globalThis.crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function readySensitiveSource(
  session: ReadOnlyWorkbenchSession,
  assetType: SensitiveBinding['assetType'] = 'longTermInstruction',
): Promise<void> {
  await flushMicrotasks();
  session.dispatch({ kind: 'selectAssetType', assetType });
  await flushMicrotasks();
  const loaded = session.getSnapshot().loadState;
  if (loaded.kind !== 'ready') throw new Error('long-term instruction list must be ready');
  session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
  await flushMicrotasks();
  session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
}

async function activateSensitiveBuffer(
  session: ReadOnlyWorkbenchSession,
  expectedValue: string,
  segmentId = SEGMENT_ID,
): Promise<void> {
  session.dispatch({
    kind: 'beginSensitiveModify',
    segmentId,
    scope: 'modify',
    surface: 'source',
  });
  await flushMicrotasks();
  expect(session.getSensitiveEditorValue(segmentId)).toBe(expectedValue);
  expect(stateOf(session).sensitiveEditorStatus).toEqual({ [segmentId]: { kind: 'active' } });
  expect(vi.getTimerCount()).toBe(1);
}

function expectSensitiveBufferRemasked(session: ReadOnlyWorkbenchSession): void {
  expect(session.getSensitiveEditorValue(SEGMENT_ID)).toBeUndefined();
  expect(stateOf(session).sensitiveEditorStatus).toEqual({});
  expect(vi.getTimerCount()).toBe(0);
}

function expectOnlyModifySourceQueries(gateway: {
  readonly sensitiveQueries: readonly Query[];
}): void {
  for (const query of gateway.sensitiveQueries) {
    expect(query).toMatchObject({
      kind: 'sensitiveReveal',
      scope: 'modify',
      surface: 'source',
    });
  }
}

describe('FE-03 sensitive masked-parts local draft', () => {
  it('only edits ordinary masked text parts while retaining the authoritative placeholder gap', async () => {
    const gateway = new SensitiveDraftGateway();
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

    session.dispatch({ kind: 'replaceDraftText', text: EDITED_MASKED_TEXT });
    expect(stateOf(session).draft).toBeNull();

    session.dispatch({ kind: 'replaceDraftTextPart', partIndex: 1, text: 'ignored' });
    expect(stateOf(session).draft).toBeNull();

    session.dispatch({
      kind: 'replaceDraftTextPart',
      partIndex: 0,
      text: 'updated-setting=',
    });
    expect(stateOf(session).draft).toMatchObject({
      kind: 'editAsset',
      sourceText: EDITED_MASKED_TEXT,
      fileProjections: [
        {
          fileId: FILE.fileId,
          sourceText: EDITED_MASKED_TEXT,
          maskedParts: EDITED_MASKED_PARTS,
        },
      ],
    });
    const editedProjection = stateOf(session).draft?.fileProjections[0];
    if (editedProjection?.maskedParts === undefined)
      throw new Error('sensitive draft must retain authority masked parts');
    expect(editedProjection.maskedParts[1]).toEqual(MASKED_PARTS[1]);
    const serialized = JSON.stringify({ state: stateOf(session), draft: stateOf(session).draft });
    const secretSentinel = ['secret', 'sentinel', 'forbidden'].join('-');
    for (const forbidden of ['plaintext', 'rawValue', 'grant', secretSentinel]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(true);

    session.dispose();
  });

  it('does not create a masked draft or request a modify reveal while the index is stale', async () => {
    const gateway = new SensitiveDraftGateway(LTI_BINDING, 'stale');
    const session = new ReadOnlyWorkbenchSession(gateway);

    await waitForSession(() => stateOf(session).loadState.kind === 'stale');
    const loaded = stateOf(session).loadState;
    if (loaded.kind !== 'stale') throw new Error('sensitive instruction list must be stale');
    session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
    await waitForSession(() => stateOf(session).detail.kind === 'ready');
    session.dispatch({ kind: 'focusEditSurface', surface: 'source' });

    session.dispatch({ kind: 'replaceDraftTextPart', partIndex: 0, text: 'updated-setting=' });
    session.dispatch({ kind: 'beginSensitiveModify', segmentId: SEGMENT_ID });
    await flushMicrotasks();

    expect(stateOf(session).draft).toBeNull();
    expect(gateway.queries.filter((query) => query.kind === 'sensitiveReveal')).toHaveLength(0);
    session.dispose();
  });

  it('consumes a matching authoritative modify result only through an ephemeral editor buffer', async () => {
    const ephemeralValue = String.fromCharCode(101, 112, 104, 101, 109, 101, 114, 97, 108);
    const editedValue = String.fromCharCode(101, 100, 105, 116, 101, 100, 45, 115, 97, 102, 101);
    const grantId = globalThis.crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    const gateway = authoritativeSensitiveGateway(ephemeralValue, grantId, expiresAt);
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

    session.dispatch({ kind: 'beginSensitiveModify', segmentId: SEGMENT_ID });
    expect(gateway.sensitiveQueries).toHaveLength(1);
    expect(gateway.sensitiveQueries[0]).toEqual({
      kind: 'sensitiveReveal',
      asset: ASSET,
      fileId: FILE.fileId,
      segmentId: SEGMENT_ID,
      fileRevision: SOURCE.revision,
      assetRevision: SOURCE.assetRevision,
      scope: 'modify',
      surface: 'source',
    });
    await waitForSession(() => session.getSensitiveEditorValue(SEGMENT_ID) === ephemeralValue);
    expect(stateOf(session).sensitiveEditorStatus).toEqual({ [SEGMENT_ID]: { kind: 'active' } });

    session.dispatch({
      kind: 'replaceSensitiveDraftSegment',
      segmentId: SEGMENT_ID,
      value: editedValue,
    });
    expect(stateOf(session).draft).toMatchObject({
      kind: 'editAsset',
      sensitiveChanges: [{ segmentId: SEGMENT_ID, kind: 'changed' }],
    });
    const serialized = JSON.stringify({
      session,
      state: stateOf(session),
      draft: stateOf(session).draft,
    });
    for (const forbidden of [
      ephemeralValue,
      editedValue,
      grantId,
      expiresAt,
      'plaintext',
      'grant',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(true);

    session.dispose();
  });

  it('keeps opaque sensitive markers independent from ordinary masked-text projections', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    let session: ReadOnlyWorkbenchSession | null = null;
    try {
      const authority = runtimeSensitiveAuthority();
      const changedSensitiveValue = String.fromCharCode(
        99,
        104,
        97,
        110,
        103,
        101,
        100,
        45,
        118,
        97,
        108,
        117,
        101,
      );
      const gateway = authoritativeSensitiveGateway(
        authority.ephemeralValue,
        authority.grantId,
        authority.expiresAt,
      );
      session = new ReadOnlyWorkbenchSession(gateway);
      await readySensitiveSource(session);
      await activateSensitiveBuffer(session, authority.ephemeralValue);

      session.dispatch({
        kind: 'replaceSensitiveDraftSegment',
        segmentId: SEGMENT_ID,
        value: changedSensitiveValue,
      });
      expect(stateOf(session).draft).toMatchObject({
        kind: 'editAsset',
        sensitiveChanges: [{ segmentId: SEGMENT_ID, kind: 'changed' }],
      });

      session.dispatch({
        kind: 'replaceDraftTextPart',
        partIndex: 0,
        text: 'updated-setting=',
      });
      expect(stateOf(session).draft).toMatchObject({
        kind: 'editAsset',
        sensitiveChanges: [{ segmentId: SEGMENT_ID, kind: 'changed' }],
        fileProjections: [
          {
            fileId: FILE.fileId,
            sourceText: EDITED_MASKED_TEXT,
            maskedParts: EDITED_MASKED_PARTS,
          },
        ],
      });

      const authoritativeTextPart = MASKED_PARTS[0];
      if (authoritativeTextPart?.kind !== 'text')
        throw new Error('first synthetic masked part must be ordinary text');
      session.dispatch({
        kind: 'replaceDraftTextPart',
        partIndex: 0,
        text: authoritativeTextPart.text,
      });
      expect(stateOf(session).draft?.fileProjections).toEqual([]);
      expect(stateOf(session).draft?.sensitiveChanges).toEqual([
        { segmentId: SEGMENT_ID, kind: 'changed' },
      ]);

      session.dispatch({
        kind: 'replaceSensitiveDraftSegment',
        segmentId: SEGMENT_ID,
        value: authority.ephemeralValue,
      });
      expect(stateOf(session).draft).toBeNull();
      const serialized = JSON.stringify({ session, state: stateOf(session) });
      for (const forbidden of [
        authority.ephemeralValue,
        changedSensitiveValue,
        authority.grantId,
        authority.expiresAt,
        'plaintext',
        'grant',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(
        true,
      );
    } finally {
      session?.dispose();
      vi.useRealTimers();
    }
  });

  it('keeps a sensitive marker and both same-asset file projections until each authority value returns', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const authority = runtimeSensitiveAuthority();
    const changedSensitiveValue = String.fromCharCode(
      99,
      114,
      111,
      115,
      115,
      45,
      102,
      105,
      108,
      101,
    );
    const gateway = authoritativeSensitiveGateway(
      authority.ephemeralValue,
      authority.grantId,
      authority.expiresAt,
      MULTIFILE_BINDING,
    );
    const session = new ReadOnlyWorkbenchSession(gateway);
    try {
      await readySensitiveSource(session, 'skill');
      session.dispatch({ kind: 'selectDetailFile', file: MULTIFILE_SENSITIVE_FILE });
      await flushMicrotasks();
      expect(stateOf(session).detail).toMatchObject({
        kind: 'ready',
        detail: {
          detail: {
            asset: MULTIFILE_ASSET,
            readSurface: {
              kind: 'skill',
              sourceReadAvailability: { kind: 'allowed' },
            },
          },
        },
        file: { file: { fileId: MULTIFILE_SENSITIVE_FILE.fileId } },
      });
      session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
      await activateSensitiveBuffer(session, authority.ephemeralValue, MULTIFILE_SEGMENT_ID);
      session.dispatch({
        kind: 'replaceSensitiveDraftSegment',
        segmentId: MULTIFILE_SEGMENT_ID,
        value: changedSensitiveValue,
      });
      session.dispatch({
        kind: 'replaceDraftTextPart',
        partIndex: 0,
        text: 'updated-setting=',
      });

      session.dispatch({ kind: 'selectDetailFile', file: MULTIFILE_ORDINARY_FILE });
      await flushMicrotasks();
      expect(stateOf(session).detail).toMatchObject({
        kind: 'ready',
        file: { file: { fileId: MULTIFILE_ORDINARY_FILE.fileId } },
      });
      session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
      session.dispatch({ kind: 'replaceDraftText', text: MULTIFILE_EDITED_ORDINARY_TEXT });

      expect(stateOf(session).draft).toMatchObject({
        kind: 'editAsset',
        sensitiveChanges: [{ segmentId: MULTIFILE_SEGMENT_ID, kind: 'changed' }],
      });
      expect(stateOf(session).draft?.fileProjections).toHaveLength(2);
      expect(stateOf(session).draft?.fileProjections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fileId: MULTIFILE_SENSITIVE_FILE.fileId,
            sourceText: MULTIFILE_EDITED_MASKED_TEXT,
            maskedParts: MULTIFILE_EDITED_MASKED_PARTS,
          }),
          expect.objectContaining({
            fileId: MULTIFILE_ORDINARY_FILE.fileId,
            sourceText: MULTIFILE_EDITED_ORDINARY_TEXT,
          }),
        ]),
      );

      session.dispatch({ kind: 'replaceDraftText', text: MULTIFILE_ORDINARY_TEXT });
      expect(stateOf(session).draft?.sensitiveChanges).toEqual([
        { segmentId: MULTIFILE_SEGMENT_ID, kind: 'changed' },
      ]);
      expect(stateOf(session).draft?.fileProjections).toEqual([
        expect.objectContaining({
          fileId: MULTIFILE_SENSITIVE_FILE.fileId,
          sourceText: MULTIFILE_EDITED_MASKED_TEXT,
        }),
      ]);

      session.dispatch({ kind: 'selectDetailFile', file: MULTIFILE_SENSITIVE_FILE });
      await flushMicrotasks();
      expect(stateOf(session).detail).toMatchObject({
        kind: 'ready',
        file: { file: { fileId: MULTIFILE_SENSITIVE_FILE.fileId } },
      });
      session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
      await activateSensitiveBuffer(session, authority.ephemeralValue, MULTIFILE_SEGMENT_ID);
      session.dispatch({
        kind: 'replaceSensitiveDraftSegment',
        segmentId: MULTIFILE_SEGMENT_ID,
        value: authority.ephemeralValue,
      });
      expect(stateOf(session).draft?.sensitiveChanges ?? []).toEqual([]);
      const authorityTextPart = MULTIFILE_MASKED_PARTS[0];
      if (authorityTextPart?.kind !== 'text') {
        throw new Error('first synthetic masked part must remain ordinary text');
      }
      session.dispatch({
        kind: 'replaceDraftTextPart',
        partIndex: 0,
        text: authorityTextPart.text,
      });
      expect(stateOf(session).draft).toBeNull();

      const serialized = JSON.stringify({ session, state: stateOf(session) });
      for (const forbidden of [
        authority.ephemeralValue,
        changedSensitiveValue,
        authority.grantId,
        authority.expiresAt,
        'plaintext',
        'grant',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expectOnlyModifySourceQueries(gateway);
      expect(gateway.methods.every((method) => method === 'read' || method === 'observe')).toBe(
        true,
      );
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('actively clears an expired sensitive buffer without waiting for a later edit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    let session: ReadOnlyWorkbenchSession | null = null;
    let cleanupSession: ReadOnlyWorkbenchSession | null = null;
    try {
      const ephemeralValue = String.fromCharCode(116, 116, 108, 45, 98, 117, 102, 102, 101, 114);
      const grantId = globalThis.crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 1_000).toISOString();
      const gateway = authoritativeSensitiveGateway(ephemeralValue, grantId, expiresAt);
      session = new ReadOnlyWorkbenchSession(gateway);

      await flushMicrotasks();
      session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
      await flushMicrotasks();
      const loaded = session.getSnapshot().loadState;
      if (loaded.kind !== 'ready') throw new Error('long-term instruction list must be ready');
      session.dispatch({ kind: 'selectRow', row: loaded.snapshot.segments[0].rows[0] });
      await flushMicrotasks();
      session.dispatch({ kind: 'focusEditSurface', surface: 'source' });
      session.dispatch({ kind: 'beginSensitiveModify', segmentId: SEGMENT_ID });
      await flushMicrotasks();

      expect(session.getSensitiveEditorValue(SEGMENT_ID)).toBe(ephemeralValue);
      expect(session.getSnapshot().sensitiveEditorStatus).toEqual({
        [SEGMENT_ID]: { kind: 'active' },
      });
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1_001);
      await flushMicrotasks();
      expect(session.getSnapshot().sensitiveEditorStatus).toEqual({});
      expect(session.getSensitiveEditorValue(SEGMENT_ID)).toBeUndefined();
      const serialized = JSON.stringify({
        session,
        state: session.getSnapshot(),
        draft: session.getSnapshot().draft,
      });
      for (const forbidden of [ephemeralValue, grantId, expiresAt, 'plaintext', 'grant']) {
        expect(serialized).not.toContain(forbidden);
      }

      const cleanupGrantId = globalThis.crypto.randomUUID();
      const cleanupExpiresAt = new Date(Date.now() + 1_000).toISOString();
      const cleanupGateway = authoritativeSensitiveGateway(
        ephemeralValue,
        cleanupGrantId,
        cleanupExpiresAt,
      );
      cleanupSession = new ReadOnlyWorkbenchSession(cleanupGateway);
      await flushMicrotasks();
      cleanupSession.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
      await flushMicrotasks();
      const cleanupLoaded = cleanupSession.getSnapshot().loadState;
      if (cleanupLoaded.kind !== 'ready') throw new Error('cleanup session list must be ready');
      cleanupSession.dispatch({
        kind: 'selectRow',
        row: cleanupLoaded.snapshot.segments[0].rows[0],
      });
      await flushMicrotasks();
      cleanupSession.dispatch({ kind: 'focusEditSurface', surface: 'source' });
      cleanupSession.dispatch({ kind: 'beginSensitiveModify', segmentId: SEGMENT_ID });
      await flushMicrotasks();
      expect(vi.getTimerCount()).toBe(1);
      cleanupSession.dispose();
      cleanupSession = null;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      cleanupSession?.dispose();
      session?.dispose();
      vi.useRealTimers();
    }
  });

  it('does not publish while checking an expired current sensitive editor segment', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const gateway = authoritativeSensitiveGateway('', globalThis.crypto.randomUUID(), expiresAt);
    const session = new ReadOnlyWorkbenchSession(gateway);
    try {
      await readySensitiveSource(session);
      session.dispatch({ kind: 'beginSensitiveModify', segmentId: SEGMENT_ID });
      await flushMicrotasks();
      expect(session.getCurrentSensitiveEditorSegmentId()).toBe(SEGMENT_ID);
      expect(stateOf(session).sensitiveEditorStatus).toEqual({
        [SEGMENT_ID]: { kind: 'active' },
      });
      let publications = 0;
      const unsubscribe = session.subscribe(() => {
        publications += 1;
      });
      try {
        vi.setSystemTime(new Date(Date.parse(expiresAt) + 1));

        expect(session.getCurrentSensitiveEditorSegmentId()).toBeUndefined();
        expect(publications).toBe(0);
        vi.setSystemTime(new Date(Date.parse(expiresAt) - 1));
        expect(session.getCurrentSensitiveEditorSegmentId()).toBeUndefined();
        expect(publications).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        unsubscribe();
      }
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('re-masks the ephemeral modify buffer before every binding-changing transition', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const sessions: ReadOnlyWorkbenchSession[] = [];
    try {
      const firstAuthority = runtimeSensitiveAuthority();
      const gateway = authoritativeSensitiveGateway(
        firstAuthority.ephemeralValue,
        firstAuthority.grantId,
        firstAuthority.expiresAt,
      );
      const session = new ReadOnlyWorkbenchSession(gateway);
      sessions.push(session);
      await readySensitiveSource(session);
      await activateSensitiveBuffer(session, firstAuthority.ephemeralValue);

      session.dispatch({ kind: 'setDetailView', view: 'structured' });
      expectSensitiveBufferRemasked(session);

      session.dispatch({ kind: 'setDetailView', view: 'source' });
      await activateSensitiveBuffer(session, firstAuthority.ephemeralValue);
      const beforeOtherSegment = gateway.sensitiveQueries.length;
      session.dispatch({
        kind: 'beginSensitiveModify',
        segmentId: OTHER_SEGMENT_ID,
        scope: 'modify',
        surface: 'source',
      });
      expectSensitiveBufferRemasked(session);
      expect(gateway.sensitiveQueries).toHaveLength(beforeOtherSegment);

      await activateSensitiveBuffer(session, firstAuthority.ephemeralValue);
      const beforeMalformedScope = gateway.sensitiveQueries.length;
      session.dispatch({
        kind: 'beginSensitiveModify',
        segmentId: SEGMENT_ID,
        scope: 'view',
        surface: 'source',
      } as never);
      expectSensitiveBufferRemasked(session);
      expect(gateway.sensitiveQueries).toHaveLength(beforeMalformedScope);

      await activateSensitiveBuffer(session, firstAuthority.ephemeralValue);
      session.dispatch({ kind: 'selectDetailFile', file: OTHER_FILE });
      expectSensitiveBufferRemasked(session);

      const assetTypeAuthority = runtimeSensitiveAuthority();
      const assetTypeGateway = authoritativeSensitiveGateway(
        assetTypeAuthority.ephemeralValue,
        assetTypeAuthority.grantId,
        assetTypeAuthority.expiresAt,
      );
      const assetTypeSession = new ReadOnlyWorkbenchSession(assetTypeGateway);
      sessions.push(assetTypeSession);
      await readySensitiveSource(assetTypeSession);
      await activateSensitiveBuffer(assetTypeSession, assetTypeAuthority.ephemeralValue);
      expect(stateOf(assetTypeSession).draft).toBeNull();
      assetTypeSession.dispatch({ kind: 'selectAssetType', assetType: 'skill' });
      expectSensitiveBufferRemasked(assetTypeSession);

      const eventAuthority = runtimeSensitiveAuthority();
      const eventGateway = authoritativeSensitiveGateway(
        eventAuthority.ephemeralValue,
        eventAuthority.grantId,
        eventAuthority.expiresAt,
      );
      const eventSession = new ReadOnlyWorkbenchSession(eventGateway);
      sessions.push(eventSession);
      await readySensitiveSource(eventSession);
      await activateSensitiveBuffer(eventSession, eventAuthority.ephemeralValue);
      const readsBeforeInvalidation = eventGateway.methods.filter(
        (method) => method === 'read',
      ).length;
      eventGateway.emit({ kind: 'assetDriftDetected', assetId: ASSET.assetId });
      expectSensitiveBufferRemasked(eventSession);
      await flushMicrotasks();
      expect(eventGateway.methods.filter((method) => method === 'read').length).toBeGreaterThan(
        readsBeforeInvalidation,
      );

      for (const candidate of [gateway, assetTypeGateway, eventGateway]) {
        expectOnlyModifySourceQueries(candidate);
        expect(candidate.methods.every((method) => method === 'read' || method === 'observe')).toBe(
          true,
        );
      }
    } finally {
      for (const session of sessions) session.dispose();
      vi.useRealTimers();
    }
  });
});
