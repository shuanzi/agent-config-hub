/**
 * FE-02 / FX-02 L3 actual multi-file read tracer.
 *
 * Provenance: the test-harness WebView invokes only `frontend_gateway_read`
 * against a temporary FX-02 copy. It proves WebView → IPC → Rust/core → disk
 * read for the mixed fixture; it does not invoke writes, drafts, prepare,
 * apply, Hook content, production artifacts, or L4.
 */
import { describe, it } from 'mocha';
import { browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

import { GATEWAY_WIRE_VERSION } from '../../src/gateway/wire/gateway-wire';

interface AssetRef {
  assetId: string;
  assetType: string;
  nativeUnitRef: string;
  adapterIdentity: string;
  nativeOwnership: { kind: string; projectId?: string };
}

interface NativeFileRef {
  fileId: string;
  name: string;
  relativePath: string;
  fileKind: 'text' | 'nonText' | 'unknown';
  isPrimary: boolean;
}

interface FileTreeNode {
  file?: NativeFileRef;
  children?: FileTreeNode[];
}

interface ReadResponse {
  wireVersion: number;
  requestId: string;
  payload:
    | { kind: 'readFailed'; reasonCode: string; message: string }
    | { kind: 'readSucceeded'; snapshot: Record<string, unknown> };
}

async function actualRead(payload: Record<string, unknown>): Promise<ReadResponse> {
  const executeWithArgs = browser.execute as unknown as (
    script: (requestPayload: Record<string, unknown>, wireVersion: number) => Promise<unknown>,
    requestPayload: Record<string, unknown>,
    wireVersion: number,
  ) => Promise<unknown>;
  return executeWithArgs(
    (requestPayload, wireVersion) => {
      const invoke = window.__TAURI__?.core?.invoke as unknown as
        ((command: string, arguments_: unknown) => Promise<unknown>) | undefined;
      if (invoke === undefined) throw new Error('test harness 未暴露 Tauri invoke');
      return invoke('frontend_gateway_read', {
        request: {
          wireVersion,
          requestId: `fx02-l3-${crypto.randomUUID()}`,
          payload: requestPayload,
        },
      });
    },
    payload,
    GATEWAY_WIRE_VERSION,
  ) as unknown as Promise<ReadResponse>;
}

function succeeded(response: ReadResponse): Record<string, unknown> {
  expect(response.wireVersion).toBe(GATEWAY_WIRE_VERSION);
  expect(response.payload.kind).toBe('readSucceeded');
  if (response.payload.kind !== 'readSucceeded') {
    throw new Error(`actual read failed: ${response.payload.reasonCode}`);
  }
  return response.payload.snapshot;
}

function collectFiles(node: FileTreeNode, files: NativeFileRef[] = []): NativeFileRef[] {
  if (node.file !== undefined) files.push(node.file);
  for (const child of node.children ?? []) collectFiles(child, files);
  return files;
}

describe('FX-02 L3 actual multi-file read tracer', () => {
  it('WebView 经真实 IPC/Rust/core 读取隔离多文件树、文本与非文本，不执行任何内容', async () => {
    const list = succeeded(
      await actualRead({
        kind: 'assetList',
        scope: { kind: 'currentAssetType', assetType: 'skill' },
      }),
    );
    expect(list.kind).toBe('assetList');
    const assets = list.assets as Array<{ asset: AssetRef }>;
    expect(assets).toHaveLength(1);
    const asset = assets[0].asset;
    expect(asset).toMatchObject({
      assetId: 'asset-fx02-multifile-skill-mixed',
      assetType: 'skill',
      nativeOwnership: { kind: 'global' },
    });

    const detail = succeeded(await actualRead({ kind: 'assetDetail', asset }));
    expect(detail.kind).toBe('assetDetail');
    const detailBody = detail.detail as {
      nativeUnitKind: string;
      primaryFile: NativeFileRef;
      fileTreeRoot?: FileTreeNode;
    };
    expect(detailBody.nativeUnitKind).toBe('multiFileDirectory');
    const files = collectFiles(detailBody.fileTreeRoot ?? {});
    const primary = files.filter((file) => file.isPrimary);
    expect(primary).toHaveLength(1);
    expect(primary[0]).toMatchObject({ name: 'SKILL.md', fileKind: 'text' });
    expect(detailBody.primaryFile.fileId).toBe(primary[0].fileId);
    const text = files.find((file) => !file.isPrimary && file.fileKind === 'text');
    const nonText = files.find((file) => file.fileKind === 'nonText');
    expect(text).toBeDefined();
    expect(nonText).toBeDefined();

    const primaryFile = succeeded(
      await actualRead({ kind: 'nativeFile', asset, fileId: primary[0].fileId }),
    );
    expect(primaryFile.kind).toBe('nativeFile');
    const primaryContent = primaryFile.content as { kind: string; maskedText?: string };
    expect(primaryContent.kind).toBe('source');
    expect(primaryContent.maskedText).toContain('••••••••');
    expect(primaryContent.maskedText).not.toContain('SYNTHETIC-SECRET');

    const textFile = succeeded(
      await actualRead({ kind: 'nativeFile', asset, fileId: text?.fileId }),
    );
    expect((textFile.content as { kind: string }).kind).toBe('source');

    const binaryFile = succeeded(
      await actualRead({ kind: 'nativeFile', asset, fileId: nonText?.fileId }),
    );
    const binaryContent = binaryFile.content as {
      kind: string;
      reasonCode?: string;
      sizeBytes?: number;
    };
    expect(binaryContent).toMatchObject({
      kind: 'nonTextMetadata',
      reasonCode: 'NON_TEXT_UNPREVIEWABLE',
    });
    expect(binaryContent.sizeBytes).toBeGreaterThan(0);
  });
});
