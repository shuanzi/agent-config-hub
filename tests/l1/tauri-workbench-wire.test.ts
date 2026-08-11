import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';

import { createTauriGateway } from '../../src/gateway/tauri';
import { GATEWAY_WIRE_VERSION } from '../../src/gateway/wire/gateway-wire';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function snapshot() {
  return {
    kind: 'workbench',
    query: { assetType: 'skill', viewContext: { kind: 'all' } },
    authoritativeReadRevision: 'rev-1',
    segments: [
      {
        id: 'global',
        source: 'globalApplicable',
        displayLabel: 'Global',
        rows: [
          {
            summary: {
              asset: {
                assetId: 'asset-1',
                assetType: 'skill',
                nativeUnitRef: 'nunit-asset-1',
                adapterIdentity: 'claude-code@fixture',
                nativeOwnership: { kind: 'global' },
              },
              displayName: 'Skill',
              agents: ['claude-code'],
              sourceTier: { id: 'source-1', label: 'Source 1' },
              contextHint: { kind: 'path', pathHint: '~/…/skills/skill/SKILL.md' },
            },
            sortBaseName: 'Skill',
            authoritativeInputOrder: 0,
            statusMemberships: ['editable', 'normal'],
            skillTargetStates: [
              {
                agent: 'claude-code',
                presence: 'present',
                activation: 'enabled',
                applicability: 'resolved',
                enableAvailability: { kind: 'allowed' },
                disableAvailability: { kind: 'allowed' },
                pending: { operationId: 'pending-read-only', phase: 'reread' },
              },
              {
                agent: 'codex',
                presence: 'absent',
                activation: 'notApplicable',
                applicability: 'resolved',
                enableAvailability: { kind: 'allowed' },
                disableAvailability: { kind: 'disabled', reasonCode: 'UNSUPPORTED_CAPABILITY' },
              },
              {
                agent: 'gemini-cli',
                presence: 'absent',
                activation: 'notApplicable',
                applicability: 'resolved',
                enableAvailability: { kind: 'blocked', reasonCode: 'READ_ONLY_POLICY' },
                disableAvailability: { kind: 'disabled', reasonCode: 'UNSUPPORTED_CAPABILITY' },
              },
              {
                agent: 'opencode',
                presence: 'absent',
                activation: 'notApplicable',
                applicability: 'resolved',
                enableAvailability: { kind: 'allowed' },
                disableAvailability: { kind: 'disabled', reasonCode: 'UNSUPPORTED_CAPABILITY' },
              },
            ],
          },
        ],
      },
    ],
    effectiveContexts: [],
    findings: [],
    aggregateTotal: 1,
    indexStatus: 'fresh',
    readAt: '2026-08-10T00:00:00.000Z',
  };
}

function locatorSnapshot() {
  const baseRow = snapshot().segments[0].rows[0];
  const row = { ...baseRow, redactedSummary: '只读遮蔽摘要' };
  return {
    kind: 'globalLocator',
    groups: [
      {
        assetType: 'skill',
        count: 1,
        results: [
          {
            row,
            destinationViewContext: { kind: 'global' },
            destination: { kind: 'skillDetail', assetRef: row.summary.asset },
            matchedField: 'displayName',
          },
        ],
      },
      { assetType: 'longTermInstruction', count: 0, results: [] },
      { assetType: 'subagent', count: 0, results: [] },
    ],
    aggregateTotal: 1,
    readAt: '2026-08-10T00:00:00.000Z',
  };
}

describe('Tauri workbench wire decode', () => {
  it('接受满足 decoder 全部必需字段的 workbench 与四个 closed Agent cells', async () => {
    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => ({
        wireVersion: GATEWAY_WIRE_VERSION,
        requestId: args.request.requestId,
        payload: { kind: 'readSucceeded', snapshot: snapshot() },
      }),
    );
    const result = await createTauriGateway().read({
      kind: 'workbench',
      assetType: 'skill',
      viewContext: { kind: 'all' },
    });
    expect(result).toMatchObject({ kind: 'readSucceeded' });
    if (result.kind === 'readSucceeded') {
      expect(result.snapshot.segments[0].rows[0].skillTargetStates).toHaveLength(4);
      expect(result.snapshot.segments[0].rows[0].skillTargetStates?.[0]?.presence).toBe('present');
      expect(result.snapshot.segments[0].rows[0].skillTargetStates?.[0]).toMatchObject({
        enableAvailability: { kind: 'allowed' },
        disableAvailability: { kind: 'allowed' },
        pending: { operationId: 'pending-read-only', phase: 'reread' },
      });
    }
  });

  it('preserves complete effective AssetRef, override relation, and active-package identity/version', async () => {
    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => {
        const raw = snapshot();
        const asset = raw.segments[0].rows[0].summary.asset;
        raw.effectiveContexts = [
          {
            assetId: 'asset-1',
            asset,
            projectId: 'opaque-project',
            projectDisplayName: 'Synthetic project',
            adapter: {
              identity: 'adapter-active',
              version: '1.2.3',
              source: {
                kind: 'activePackage',
                packageIdentity: 'pkg.acm.fixture',
                packageVersion: '9.8.7',
              },
            },
            rule: { identity: 'rule-built-in', version: '1', source: { kind: 'builtIn' } },
            authoritativeReadRevision: 'rev-1',
            sourceTierId: 'source-1',
            loadOrder: 0,
            priority: 0,
            overrideRelation: {
              kind: 'overriddenBy',
              otherAssetId: 'asset-other',
              note: 'fixture relation',
            },
            resolution: 'resolved',
          },
        ] as unknown as never[];
        return {
          wireVersion: GATEWAY_WIRE_VERSION,
          requestId: args.request.requestId,
          payload: { kind: 'readSucceeded', snapshot: raw },
        };
      },
    );
    const result = await createTauriGateway().read({
      kind: 'workbench',
      assetType: 'skill',
      viewContext: { kind: 'all' },
    });
    expect(result).toMatchObject({ kind: 'readSucceeded' });
    if (result.kind === 'readSucceeded') {
      expect(result.snapshot.effectiveContexts[0]).toMatchObject({
        asset: {
          assetId: 'asset-1',
          nativeUnitRef: 'nunit-asset-1',
          adapterIdentity: 'claude-code@fixture',
        },
        adapter: {
          source: {
            kind: 'activePackage',
            packageIdentity: 'pkg.acm.fixture',
            packageVersion: '9.8.7',
          },
        },
        overrideRelation: { kind: 'overriddenBy', otherAssetId: 'asset-other' },
      });
    }
  });

  it('对嵌套 closed enum 或 aggregate 不一致封闭为 GATEWAY_UNAVAILABLE', async () => {
    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => {
        const malformed = snapshot();
        malformed.segments[0].rows[0].skillTargetStates[0].presence = 'invented';
        return {
          wireVersion: GATEWAY_WIRE_VERSION,
          requestId: args.request.requestId,
          payload: { kind: 'readSucceeded', snapshot: malformed },
        };
      },
    );
    const result = await createTauriGateway().read({
      kind: 'workbench',
      assetType: 'skill',
      viewContext: { kind: 'all' },
    });
    expect(result).toMatchObject({ kind: 'readFailed', reasonCode: 'GATEWAY_UNAVAILABLE' });
  });

  it('breaking wire V3 ingress 明确拒绝前一版 V2 response envelope', async () => {
    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => ({
        wireVersion: 2,
        requestId: args.request.requestId,
        payload: { kind: 'readSucceeded', snapshot: snapshot() },
      }),
    );
    const result = await createTauriGateway().read({
      kind: 'workbench',
      assetType: 'skill',
      viewContext: { kind: 'all' },
    });
    expect(result).toMatchObject({ kind: 'readFailed', reasonCode: 'GATEWAY_UNAVAILABLE' });
  });

  it('缺少或伪造 Skill cell action availability/pending 时封闭为 GATEWAY_UNAVAILABLE', async () => {
    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => {
        const malformed = snapshot();
        delete (malformed.segments[0].rows[0].skillTargetStates[0] as Record<string, unknown>)
          .enableAvailability;
        (
          malformed.segments[0].rows[0].skillTargetStates[1] as Record<string, unknown>
        ).disableAvailability = { kind: 'allowed', reasonCode: 'READ_ONLY_POLICY' };
        return {
          wireVersion: GATEWAY_WIRE_VERSION,
          requestId: args.request.requestId,
          payload: { kind: 'readSucceeded', snapshot: malformed },
        };
      },
    );
    const result = await createTauriGateway().read({
      kind: 'workbench',
      assetType: 'skill',
      viewContext: { kind: 'all' },
    });
    expect(result).toMatchObject({ kind: 'readFailed', reasonCode: 'GATEWAY_UNAVAILABLE' });
  });

  it('缺少完整 AssetRef 的任一 identity 字段时封闭为 GATEWAY_UNAVAILABLE', async () => {
    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => {
        const malformed = snapshot();
        const asset = malformed.segments[0].rows[0].summary.asset as unknown as Record<
          string,
          unknown
        >;
        delete asset.nativeUnitRef;
        return {
          wireVersion: GATEWAY_WIRE_VERSION,
          requestId: args.request.requestId,
          payload: { kind: 'readSucceeded', snapshot: malformed },
        };
      },
    );
    const result = await createTauriGateway().read({
      kind: 'workbench',
      assetType: 'skill',
      viewContext: { kind: 'all' },
    });
    expect(result).toMatchObject({ kind: 'readFailed', reasonCode: 'GATEWAY_UNAVAILABLE' });
  });

  it('locator 只接受完整 native AssetRef、Skill detail destination 与 closed matchedField', async () => {
    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => ({
        wireVersion: GATEWAY_WIRE_VERSION,
        requestId: args.request.requestId,
        payload: { kind: 'readSucceeded', snapshot: locatorSnapshot() },
      }),
    );
    const result = await createTauriGateway().read({
      kind: 'globalLocator',
      searchText: 'Skill',
      assetTypes: ['skill', 'longTermInstruction', 'subagent'],
    });
    expect(result).toMatchObject({ kind: 'readSucceeded' });
    if (result.kind === 'readSucceeded') {
      const locator = result.snapshot.groups[0].results[0];
      expect(locator.destination.kind).toBe('skillDetail');
      expect(locator.destination.assetRef).toMatchObject({
        assetId: 'asset-1',
        assetType: 'skill',
        nativeUnitRef: 'nunit-asset-1',
        adapterIdentity: 'claude-code@fixture',
        nativeOwnership: { kind: 'global' },
      });
      expect(locator.matchedField).toBe('displayName');
      expect(locator).toMatchObject({ redactedSummary: '只读遮蔽摘要' });
      expect(locator.ownershipHint).toBe('~/…/skills/skill/SKILL.md');
    }

    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => {
        const malformed = locatorSnapshot();
        malformed.groups[0].results[0].matchedField = 'invented';
        return {
          wireVersion: GATEWAY_WIRE_VERSION,
          requestId: args.request.requestId,
          payload: { kind: 'readSucceeded', snapshot: malformed },
        };
      },
    );
    const rejected = await createTauriGateway().read({
      kind: 'globalLocator',
      searchText: 'Skill',
      assetTypes: ['skill', 'longTermInstruction', 'subagent'],
    });
    expect(rejected).toMatchObject({ kind: 'readFailed', reasonCode: 'GATEWAY_UNAVAILABLE' });

    invokeMock.mockImplementation(
      async (_command: string, args: { request: { requestId: string } }) => {
        const malformed = locatorSnapshot();
        delete (malformed.groups[0].results[0].row as Record<string, unknown>).redactedSummary;
        return {
          wireVersion: GATEWAY_WIRE_VERSION,
          requestId: args.request.requestId,
          payload: { kind: 'readSucceeded', snapshot: malformed },
        };
      },
    );
    const redactedSummaryRejected = await createTauriGateway().read({
      kind: 'globalLocator',
      searchText: 'Skill',
      assetTypes: ['skill', 'longTermInstruction', 'subagent'],
    });
    expect(redactedSummaryRejected).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
    });
  });
});
