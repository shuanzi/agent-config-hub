/**
 * FE-10 FX-12 sensitive view grant。
 *
 * 此测试只通过 session 与 ScriptedMockGateway 的既有 read seam 观察；不读取、
 * 断言或写入明文，亦不复用 FE-03 modify action。
 */
import { describe, expect, it, vi } from 'vitest';

import fx12Fixture from '../../fixtures/fx-12/fixture.json';
import type { FrontendGateway, ObserveHandle } from '../../src/contract/gateway';
import type {
  Query,
  ReadResult,
  SnapshotFor,
  Subscription,
  WorkspaceEvent,
} from '../../src/contract/types';
import { ScriptedMockGateway } from '../../src/gateway/mock';
import { ReadOnlyWorkbenchSession } from '../../src/session/ReadOnlyWorkbenchSession';

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

class FailingSensitiveViewGateway implements FrontendGateway {
  constructor(
    private readonly delegate: ScriptedMockGateway,
    private readonly failure: 'transport' | 'mismatchedResponse',
  ) {}

  read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
    if (query.kind !== 'sensitiveReveal') return this.delegate.read(query);
    if (this.failure === 'transport')
      return Promise.reject(new Error('synthetic transport refusal'));
    return Promise.resolve({
      kind: 'readSucceeded',
      snapshot: {
        kind: 'sensitiveReveal',
        plaintext: String.fromCharCode(117, 110, 116, 114, 117, 115, 116, 101, 100),
        grant: {
          grantId: crypto.randomUUID(),
          asset: { ...query.asset, assetId: 'asset-fx12-mismatched' },
          fileId: query.fileId,
          segmentId: query.segmentId,
          fileRevision: query.fileRevision,
          assetRevision: query.assetRevision,
          scope: 'view',
          surface: 'source',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    } as ReadResult<SnapshotFor<Q>>);
  }

  observe(subscription: Subscription, listener: (event: WorkspaceEvent) => void): ObserveHandle {
    return this.delegate.observe(subscription, listener);
  }
}

async function selectFx12MaskedSource(session: ReadOnlyWorkbenchSession): Promise<void> {
  session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
  await settle();
  const loaded = session.getSnapshot().loadState;
  if (loaded.kind !== 'ready') throw new Error('FX-12 long-term instruction list must be ready');
  const maskedRow = loaded.snapshot.segments
    .flatMap((segment) => segment.rows)
    .find((row) => row.assetId === fx12Fixture.asset.assetId);
  if (maskedRow === undefined) throw new Error('FX-12 masked row must be available');

  session.dispatch({ kind: 'selectRow', row: maskedRow });
  await settle();
  const selected = session.getSnapshot().detail;
  if (selected.kind !== 'ready') throw new Error('FX-12 masked detail must be ready');
  session.dispatch({ kind: 'selectDetailFile', file: selected.detail.detail.primaryFile });
  await settle();
  const source = session.getSnapshot().detail;
  if (source.kind !== 'ready' || source.file === undefined)
    throw new Error('FX-12 masked source must be ready');
}

describe('FE-10 sensitive view grant public seam', () => {
  it('requests a separate read-only view grant without creating a draft or serializing a secret', async () => {
    const gateway = new ScriptedMockGateway();
    gateway.applyScenario('fx12-sensitive-view');
    const session = new ReadOnlyWorkbenchSession(gateway);
    await settle();

    session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
    await settle();
    const loaded = session.getSnapshot().loadState;
    if (loaded.kind !== 'ready') throw new Error('FX-12 long-term instruction list must be ready');
    const maskedRow = loaded.snapshot.segments
      .flatMap((segment) => segment.rows)
      .find((row) => row.assetId === fx12Fixture.asset.assetId);
    if (maskedRow === undefined) throw new Error('FX-12 masked row must be available');

    session.dispatch({ kind: 'selectRow', row: maskedRow });
    await settle();
    const selected = session.getSnapshot().detail;
    if (selected.kind !== 'ready') throw new Error('FX-12 masked detail must be ready');
    session.dispatch({ kind: 'selectDetailFile', file: selected.detail.detail.primaryFile });
    await settle();
    const source = session.getSnapshot().detail;
    if (source.kind !== 'ready' || source.file === undefined)
      throw new Error('FX-12 masked source must be ready');

    const deniedModify = await gateway.read({
      kind: 'sensitiveReveal',
      asset: source.detail.detail.asset,
      fileId: source.file.file.fileId,
      segmentId: fx12Fixture.segment.segmentId,
      fileRevision: source.file.revision,
      assetRevision: source.file.assetRevision,
      scope: 'modify',
      surface: 'source',
    });
    expect(deniedModify.kind).toBe('readFailed');

    const callsBeforeView = gateway.getCallLog().length;
    session.dispatch({ kind: 'beginSensitiveView', segmentId: fx12Fixture.segment.segmentId });
    await settle();
    const viewCalls = gateway.getCallLog().slice(callsBeforeView);

    expect(viewCalls).toHaveLength(1);
    expect(viewCalls[0]).toMatchObject({
      method: 'read',
      queryKind: 'sensitiveReveal',
      query: { kind: 'sensitiveReveal', scope: 'view', surface: 'source' },
    });
    expect(session.getSnapshot().draft).toBeNull();
    expect(JSON.stringify({ viewCalls, state: session.getSnapshot() })).not.toContain('plaintext');
    expect(JSON.stringify({ viewCalls, state: session.getSnapshot() })).not.toContain('grantId');

    session.dispose();
  });

  it('re-masks a view grant on TTL, asset and revision changes before new authorization', async () => {
    vi.useFakeTimers();
    const gateway = new ScriptedMockGateway();
    gateway.applyScenario('fx12-sensitive-view');
    const session = new ReadOnlyWorkbenchSession(gateway);
    try {
      await settle();
      session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
      await settle();
      const loaded = session.getSnapshot().loadState;
      if (loaded.kind !== 'ready')
        throw new Error('FX-12 long-term instruction list must be ready');
      const rows = loaded.snapshot.segments.flatMap((segment) => segment.rows);
      const maskedRow = rows.find((row) => row.assetId === fx12Fixture.asset.assetId);
      const ordinaryRow = rows.find((row) => row.assetId !== fx12Fixture.asset.assetId);
      if (maskedRow === undefined || ordinaryRow === undefined)
        throw new Error('FX-12 must expose masked and ordinary read-only rows');

      session.dispatch({ kind: 'selectRow', row: maskedRow });
      await settle();
      const selected = session.getSnapshot().detail;
      if (selected.kind !== 'ready') throw new Error('FX-12 masked detail must be ready');
      session.dispatch({ kind: 'selectDetailFile', file: selected.detail.detail.primaryFile });
      await settle();
      session.dispatch({ kind: 'beginSensitiveView', segmentId: fx12Fixture.segment.segmentId });
      await settle();
      expect(session.getSnapshot().sensitiveViewStatus).toEqual({
        [fx12Fixture.segment.segmentId]: { kind: 'active' },
      });
      expect(session.getSnapshot().draft).toBeNull();

      await vi.advanceTimersByTimeAsync(fx12Fixture.view.ttlMs);
      expect(session.getSnapshot().sensitiveViewStatus).toEqual({});
      expect(session.getSensitiveViewValue(fx12Fixture.segment.segmentId)).toBeUndefined();

      session.dispatch({ kind: 'beginSensitiveView', segmentId: fx12Fixture.segment.segmentId });
      await settle();
      session.dispatch({ kind: 'selectRow', row: ordinaryRow });
      expect(session.getSnapshot().sensitiveViewStatus).toEqual({});
      expect(session.getSensitiveViewValue(fx12Fixture.segment.segmentId)).toBeUndefined();

      session.dispatch({ kind: 'selectRow', row: maskedRow });
      await settle();
      const reselected = session.getSnapshot().detail;
      if (reselected.kind !== 'ready') throw new Error('FX-12 masked detail must be reloaded');
      session.dispatch({ kind: 'selectDetailFile', file: reselected.detail.detail.primaryFile });
      await settle();
      session.dispatch({ kind: 'beginSensitiveView', segmentId: fx12Fixture.segment.segmentId });
      await settle();
      const callsBeforeRevision = gateway
        .getCallLog()
        .filter((call) => call.queryKind === 'sensitiveReveal');
      gateway.simulateExternalChange();
      gateway.emitEvent({ kind: 'assetDriftDetected', assetId: fx12Fixture.asset.assetId });
      expect(session.getSnapshot().sensitiveViewStatus).toEqual({});
      expect(session.getSensitiveViewValue(fx12Fixture.segment.segmentId)).toBeUndefined();
      await settle();

      const refreshed = session.getSnapshot().loadState;
      if (refreshed.kind !== 'ready') throw new Error('FX-12 revision refresh must be ready');
      const refreshedMaskedRow = refreshed.snapshot.segments
        .flatMap((segment) => segment.rows)
        .find((row) => row.assetId === fx12Fixture.asset.assetId);
      if (refreshedMaskedRow === undefined)
        throw new Error('FX-12 masked row must survive revision');
      session.dispatch({ kind: 'selectRow', row: refreshedMaskedRow });
      await settle();
      const refreshedDetail = session.getSnapshot().detail;
      if (refreshedDetail.kind !== 'ready') throw new Error('FX-12 refreshed detail must be ready');
      session.dispatch({
        kind: 'selectDetailFile',
        file: refreshedDetail.detail.detail.primaryFile,
      });
      await settle();
      session.dispatch({ kind: 'beginSensitiveView', segmentId: fx12Fixture.segment.segmentId });
      await settle();
      const callsAfterRevision = gateway
        .getCallLog()
        .filter((call) => call.queryKind === 'sensitiveReveal');
      expect(callsAfterRevision).toHaveLength(callsBeforeRevision.length + 1);
      expect(callsAfterRevision.at(-1)?.query).toMatchObject({
        scope: 'view',
        fileRevision: `${fx12Fixture.revision}+external-1`,
        assetRevision: `${fx12Fixture.revision}+external-1`,
      });
      expect(session.getSnapshot().draft).toBeNull();
      expect(JSON.stringify({ callsAfterRevision, state: session.getSnapshot() })).not.toContain(
        'plaintext',
      );
    } finally {
      session.dispose();
      vi.useRealTimers();
    }
  });

  it('does not synchronously mutate the active view state when a render reads a different segment', async () => {
    const gateway = new ScriptedMockGateway();
    gateway.applyScenario('fx12-sensitive-view');
    const session = new ReadOnlyWorkbenchSession(gateway);
    try {
      await settle();
      session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
      await settle();
      const loaded = session.getSnapshot().loadState;
      if (loaded.kind !== 'ready')
        throw new Error('FX-12 long-term instruction list must be ready');
      const maskedRow = loaded.snapshot.segments
        .flatMap((segment) => segment.rows)
        .find((row) => row.assetId === fx12Fixture.asset.assetId);
      if (maskedRow === undefined) throw new Error('FX-12 masked row must be available');

      session.dispatch({ kind: 'selectRow', row: maskedRow });
      await settle();
      const selected = session.getSnapshot().detail;
      if (selected.kind !== 'ready') throw new Error('FX-12 masked detail must be ready');
      session.dispatch({ kind: 'selectDetailFile', file: selected.detail.detail.primaryFile });
      await settle();
      session.dispatch({ kind: 'beginSensitiveView', segmentId: fx12Fixture.segment.segmentId });
      await settle();

      const beforeRead = session.getSnapshot();
      const publishedStates: unknown[] = [];
      const unsubscribe = session.subscribe(() => publishedStates.push(session.getSnapshot()));
      expect(session.getSensitiveViewValue('seg-fx12-not-current')).toBeUndefined();
      unsubscribe();

      expect(publishedStates).toEqual([]);
      expect(session.getSnapshot()).toBe(beforeRead);
      expect(session.getSnapshot().sensitiveViewStatus).toEqual({
        [fx12Fixture.segment.segmentId]: { kind: 'active' },
      });
      expect(session.getSensitiveViewValue(fx12Fixture.segment.segmentId)).toBeDefined();
    } finally {
      session.dispose();
    }
  });

  it('fails closed for every FX-12 view request whose asset, file, segment, revision, or type binding is wrong', async () => {
    const gateway = new ScriptedMockGateway();
    gateway.applyScenario('fx12-sensitive-view');
    const session = new ReadOnlyWorkbenchSession(gateway);
    try {
      await settle();
      session.dispatch({ kind: 'selectAssetType', assetType: 'longTermInstruction' });
      await settle();
      const loaded = session.getSnapshot().loadState;
      if (loaded.kind !== 'ready')
        throw new Error('FX-12 long-term instruction list must be ready');
      const maskedRow = loaded.snapshot.segments
        .flatMap((segment) => segment.rows)
        .find((row) => row.assetId === fx12Fixture.asset.assetId);
      if (maskedRow === undefined) throw new Error('FX-12 masked row must be available');

      session.dispatch({ kind: 'selectRow', row: maskedRow });
      await settle();
      const selected = session.getSnapshot().detail;
      if (selected.kind !== 'ready') throw new Error('FX-12 masked detail must be ready');
      session.dispatch({ kind: 'selectDetailFile', file: selected.detail.detail.primaryFile });
      await settle();
      const source = session.getSnapshot().detail;
      if (source.kind !== 'ready' || source.file === undefined)
        throw new Error('FX-12 masked source must be ready');

      const request = {
        kind: 'sensitiveReveal' as const,
        asset: source.detail.detail.asset,
        fileId: source.file.file.fileId,
        segmentId: fx12Fixture.segment.segmentId,
        fileRevision: source.file.revision,
        assetRevision: source.file.assetRevision,
        scope: 'view' as const,
        surface: 'source' as const,
      };
      const invalidRequests = [
        { ...request, asset: { ...request.asset, nativeUnitRef: 'nunit-fx12-wrong' } },
        { ...request, fileId: fx12Fixture.alternateFile.fileId },
        { ...request, segmentId: 'seg-fx12-wrong' },
        { ...request, fileRevision: 'rev-fx12-wrong' },
        { ...request, assetRevision: 'rev-fx12-wrong' },
        { ...request, asset: { ...request.asset, assetType: 'hook' as const } },
      ];

      for (const invalidRequest of invalidRequests) {
        const result = await gateway.read(invalidRequest);
        expect(result.kind).toBe('readFailed');
      }
      expect(session.getSnapshot().draft).toBeNull();
      expect(session.getSnapshot().sensitiveViewStatus).toEqual({});
    } finally {
      session.dispose();
    }
  });

  it.each(['transport', 'mismatchedResponse'] as const)(
    'publishes only an opaque failed view state when the gateway has a %s failure',
    async (failure) => {
      const base = new ScriptedMockGateway();
      base.applyScenario('fx12-sensitive-view');
      const session = new ReadOnlyWorkbenchSession(new FailingSensitiveViewGateway(base, failure));
      const forbiddenRuntimeValue = String.fromCharCode(
        117,
        110,
        116,
        114,
        117,
        115,
        116,
        101,
        100,
      );
      try {
        await settle();
        await selectFx12MaskedSource(session);
        session.dispatch({ kind: 'beginSensitiveView', segmentId: fx12Fixture.segment.segmentId });
        await settle();

        expect(session.getSnapshot().sensitiveViewStatus).toEqual({
          [fx12Fixture.segment.segmentId]: {
            kind: 'failed',
            reasonCode: 'GATEWAY_UNAVAILABLE',
          },
        });
        expect(session.getSensitiveViewValue(fx12Fixture.segment.segmentId)).toBeUndefined();
        expect(session.getSnapshot().draft).toBeNull();
        expect(JSON.stringify(session.getSnapshot())).not.toContain(forbiddenRuntimeValue);
        expect(JSON.stringify(session.getSnapshot())).not.toContain('grantId');
      } finally {
        session.dispose();
      }
    },
  );
});
