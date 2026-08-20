/**
 * FE-03 sensitive reveal 的 L1 transport seam。
 *
 * 只 mock Tauri invoke：不请求实际授权、不调用 IPC，也不产生写入 credit。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import type { NativeFileQuery, SensitiveRevealQuery } from '../../src/contract/types';
import { createTauriGateway } from '../../src/gateway/tauri';
import { GATEWAY_WIRE_VERSION } from '../../src/gateway/wire/gateway-wire';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

type InvokeFn = (
  command: string,
  arguments_: { request: { requestId: string; payload: Record<string, unknown> } },
) => Promise<unknown>;

const invokeMock = invoke as unknown as Mock<InvokeFn>;

const SENSITIVE_REVEAL_QUERY: SensitiveRevealQuery = {
  kind: 'sensitiveReveal',
  asset: {
    assetId: 'asset-fe03-wire-safe',
    assetType: 'skill',
    nativeUnitRef: 'nunit-fe03-wire-safe',
    adapterIdentity: 'fixture@synthetic',
    nativeOwnership: { kind: 'global' },
  },
  fileId: 'file-fe03-wire-safe',
  segmentId: 'segment-fe03-wire-safe',
  fileRevision: 'rev-fe03-current',
  assetRevision: 'asset-rev-fe03-current',
  scope: 'modify',
  surface: 'source',
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe('FE-03 Tauri sensitive-reveal wire', () => {
  it('将完整 binding 送入既有 read transport，并拒绝漂移 revision 的 reveal grant', async () => {
    // 运行时构造安全的假值，测试文件不保存明文、grant 或真实路径。
    const responsePlaintext = ['temporary', 'sensitive', 'buffer'].join('-');
    const responseGrantId = ['opaque', 'grant', 'fixture'].join('-');
    invokeMock.mockImplementation(async (_command, arguments_) => ({
      wireVersion: GATEWAY_WIRE_VERSION,
      requestId: arguments_.request.requestId,
      payload: {
        kind: 'readSucceeded',
        snapshot: {
          kind: 'sensitiveReveal',
          plaintext: responsePlaintext,
          grant: {
            grantId: responseGrantId,
            asset: SENSITIVE_REVEAL_QUERY.asset,
            fileId: SENSITIVE_REVEAL_QUERY.fileId,
            segmentId: SENSITIVE_REVEAL_QUERY.segmentId,
            // 与 query 不同，必须 fail closed。
            fileRevision: 'rev-fe03-stale',
            assetRevision: SENSITIVE_REVEAL_QUERY.assetRevision,
            scope: 'modify',
            surface: 'source',
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
        },
      },
    }));

    const result = await createTauriGateway().read(SENSITIVE_REVEAL_QUERY);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const sent = invokeMock.mock.calls[0]?.[1].request;
    expect(sent?.payload).toEqual(SENSITIVE_REVEAL_QUERY);
    expect(sent?.payload).not.toHaveProperty('plaintext');
    expect(sent?.payload).not.toHaveProperty('grant');
    expect(result).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
      recoveryAction: { kind: 'retryRead' },
    });
  });

  it('消费完整匹配的 Rust reveal response，且请求不携带 runtime-only 值', async () => {
    const runtimeValue = String.fromCharCode(116, 101, 109, 112, 45, 118, 97, 108, 117, 101);
    const runtimeGrantId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    invokeMock.mockImplementation(async (_command, arguments_) => ({
      wireVersion: GATEWAY_WIRE_VERSION,
      requestId: arguments_.request.requestId,
      payload: {
        kind: 'readSucceeded',
        snapshot: {
          kind: 'sensitiveReveal',
          plaintext: runtimeValue,
          grant: {
            grantId: runtimeGrantId,
            asset: SENSITIVE_REVEAL_QUERY.asset,
            fileId: SENSITIVE_REVEAL_QUERY.fileId,
            segmentId: SENSITIVE_REVEAL_QUERY.segmentId,
            fileRevision: SENSITIVE_REVEAL_QUERY.fileRevision,
            assetRevision: SENSITIVE_REVEAL_QUERY.assetRevision,
            scope: 'modify',
            surface: 'source',
            expiresAt,
          },
        },
      },
    }));

    const result = await createTauriGateway().read(SENSITIVE_REVEAL_QUERY);

    expect(result).toMatchObject({
      kind: 'readSucceeded',
      snapshot: {
        kind: 'sensitiveReveal',
        plaintext: runtimeValue,
        grant: { grantId: runtimeGrantId, expiresAt },
      },
    });
    expect(invokeMock.mock.calls[0]?.[1].request.payload).toEqual(SENSITIVE_REVEAL_QUERY);
    expect(invokeMock.mock.calls[0]?.[1].request.payload).not.toHaveProperty('plaintext');
    expect(invokeMock.mock.calls[0]?.[1].request.payload).not.toHaveProperty('grant');
  });

  it('消费 Rust 权威的有序 maskedParts，且只保留与 segment 绑定的安全占位符', async () => {
    const nativeFileQuery: NativeFileQuery = {
      kind: 'nativeFile',
      asset: SENSITIVE_REVEAL_QUERY.asset,
      fileId: 'file-fe03-masked-source',
    };
    const maskedParts = [
      { kind: 'text', text: 'setting=' },
      { kind: 'sensitivePlaceholder', segmentId: 'segment-fe03-masked-source' },
      { kind: 'text', text: '\nextension-note: retain' },
    ];
    const maskedText = 'setting=••••••••\nextension-note: retain';
    invokeMock.mockImplementation(async (_command, arguments_) => ({
      wireVersion: GATEWAY_WIRE_VERSION,
      requestId: arguments_.request.requestId,
      payload: {
        kind: 'readSucceeded',
        snapshot: {
          kind: 'nativeFile',
          file: {
            fileId: nativeFileQuery.fileId,
            name: 'safe-source.md',
            relativePath: 'safe-source.md',
            fileKind: 'text',
            isPrimary: true,
            canPreview: { kind: 'allowed' },
            canEdit: { kind: 'allowed' },
            hasDraftChanges: false,
          },
          revision: 'rev-fe03-masked-source',
          assetRevision: 'asset-rev-fe03-masked-source',
          content: {
            kind: 'source',
            maskedText,
            sensitiveSegments: [
              {
                segmentId: 'segment-fe03-masked-source',
                fileId: nativeFileQuery.fileId,
                revision: 'rev-fe03-masked-source',
                displayState: 'masked',
              },
            ],
            maskedParts,
          },
          structuredView: { kind: 'allowed' },
        },
      },
    }));

    const result = await createTauriGateway().read(nativeFileQuery);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[1].request.payload).toEqual(nativeFileQuery);
    expect(result).toEqual({
      kind: 'readSucceeded',
      snapshot: {
        kind: 'nativeFile',
        file: {
          fileId: nativeFileQuery.fileId,
          name: 'safe-source.md',
          relativePath: 'safe-source.md',
          fileKind: 'text',
          isPrimary: true,
          canPreview: { kind: 'allowed' },
          canEdit: { kind: 'allowed' },
          hasDraftChanges: false,
        },
        revision: 'rev-fe03-masked-source',
        assetRevision: 'asset-rev-fe03-masked-source',
        content: {
          kind: 'source',
          maskedText,
          sensitiveSegments: [
            {
              segmentId: 'segment-fe03-masked-source',
              fileId: nativeFileQuery.fileId,
              revision: 'rev-fe03-masked-source',
              displayState: 'masked',
            },
          ],
          maskedParts,
        },
        structuredView: { kind: 'allowed' },
      },
    });
  });
});
