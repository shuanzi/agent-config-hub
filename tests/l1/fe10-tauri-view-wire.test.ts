/**
 * FE-10 的 `view` grant transport seam。
 *
 * 只 mock Tauri invoke；不启动 IPC、Tauri 或任何写入路径。所有临时值均在运行时
 * 构造，且只验证 binding，避免 fixture 或测试日志承载敏感内容。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import type { SensitiveRevealQuery } from '../../src/contract/types';
import { createTauriGateway } from '../../src/gateway/tauri';
import { GATEWAY_WIRE_VERSION } from '../../src/gateway/wire/gateway-wire';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

type InvokeFn = (
  command: string,
  arguments_: { request: { requestId: string; payload: Record<string, unknown> } },
) => Promise<unknown>;

const invokeMock = invoke as unknown as Mock<InvokeFn>;

const VIEW_QUERY: SensitiveRevealQuery = {
  kind: 'sensitiveReveal',
  asset: {
    assetId: 'asset-fx12-view-wire-safe',
    assetType: 'longTermInstruction',
    nativeUnitRef: 'nunit-fx12-view-wire-safe',
    adapterIdentity: 'fixture@synthetic',
    nativeOwnership: { kind: 'global' },
  },
  fileId: 'file-fx12-view-wire-safe',
  segmentId: 'segment-fx12-view-wire-safe',
  fileRevision: 'rev-fx12-view-current',
  assetRevision: 'asset-rev-fx12-view-current',
  scope: 'view',
  surface: 'source',
};

function matchingResponse(requestId: string, grant: Record<string, unknown>) {
  return {
    wireVersion: GATEWAY_WIRE_VERSION,
    requestId,
    payload: {
      kind: 'readSucceeded',
      snapshot: {
        kind: 'sensitiveReveal',
        plaintext: String.fromCharCode(101, 112, 104, 101, 109, 101, 114, 97, 108),
        grant,
      },
    },
  };
}

function matchingGrant(): Record<string, unknown> {
  return {
    grantId: crypto.randomUUID(),
    asset: VIEW_QUERY.asset,
    fileId: VIEW_QUERY.fileId,
    segmentId: VIEW_QUERY.segmentId,
    fileRevision: VIEW_QUERY.fileRevision,
    assetRevision: VIEW_QUERY.assetRevision,
    scope: 'view',
    surface: 'source',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('FE-10 Tauri sensitive view wire', () => {
  it('encodes the closed view request and accepts only its matching Rust response binding', async () => {
    invokeMock.mockImplementation(async (_command, arguments_) =>
      matchingResponse(arguments_.request.requestId, matchingGrant()),
    );

    const result = await createTauriGateway().read(VIEW_QUERY);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const sent = invokeMock.mock.calls[0]?.[1].request;
    expect(sent?.payload).toEqual(VIEW_QUERY);
    expect(sent?.payload).not.toHaveProperty('plaintext');
    expect(sent?.payload).not.toHaveProperty('grant');
    expect(result).toMatchObject({
      kind: 'readSucceeded',
      snapshot: {
        kind: 'sensitiveReveal',
        grant: {
          asset: VIEW_QUERY.asset,
          fileId: VIEW_QUERY.fileId,
          segmentId: VIEW_QUERY.segmentId,
          fileRevision: VIEW_QUERY.fileRevision,
          assetRevision: VIEW_QUERY.assetRevision,
          scope: 'view',
          surface: 'source',
        },
      },
    });
  });

  it.each([
    [
      'asset',
      (grant: Record<string, unknown>) => ({
        ...grant,
        asset: { ...VIEW_QUERY.asset, assetId: 'asset-wrong' },
      }),
    ],
    ['file', (grant: Record<string, unknown>) => ({ ...grant, fileId: 'file-wrong' })],
    ['segment', (grant: Record<string, unknown>) => ({ ...grant, segmentId: 'segment-wrong' })],
    [
      'file revision',
      (grant: Record<string, unknown>) => ({ ...grant, fileRevision: 'rev-wrong' }),
    ],
    [
      'asset revision',
      (grant: Record<string, unknown>) => ({ ...grant, assetRevision: 'asset-rev-wrong' }),
    ],
    ['scope', (grant: Record<string, unknown>) => ({ ...grant, scope: 'modify' })],
    [
      'Hook type',
      (grant: Record<string, unknown>) => ({
        ...grant,
        asset: { ...VIEW_QUERY.asset, assetType: 'hook' },
      }),
    ],
  ])('fails closed when the response binding has the wrong %s', async (_label, mutateGrant) => {
    const runtimeValue = String.fromCharCode(117, 110, 116, 114, 117, 115, 116, 101, 100);
    invokeMock.mockImplementation(async (_command, arguments_) => {
      const response = matchingResponse(arguments_.request.requestId, mutateGrant(matchingGrant()));
      response.payload.snapshot.plaintext = runtimeValue;
      return response;
    });

    const result = await createTauriGateway().read(VIEW_QUERY);

    expect(result).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
      recoveryAction: { kind: 'retryRead' },
    });
    expect(JSON.stringify(result)).not.toContain(runtimeValue);
  });
});
