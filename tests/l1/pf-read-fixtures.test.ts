import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NativeFileSnapshot } from '../../src/contract/types';
import {
  buildPf02SourceLargeFixture,
  buildPf03MultifileFixture,
  pfReadFixtureDigest,
} from '../../src/gateway/pf-read-fixtures';

type Profile = 'representative' | 'stress';
type PublicFixtureBundle = {
  schemaVersion: 1;
  descriptorId: 'PF-02' | 'PF-03';
  profile: Profile;
  seed: number;
  shape: Record<string, number | string>;
  workbench: unknown;
  detail: unknown;
  files: NativeFileSnapshot[];
};

function descriptor(id: 'PF-02' | 'PF-03') {
  const relative =
    id === 'PF-02'
      ? 'performance/descriptors/pf-02.source-large.json'
      : 'performance/descriptors/pf-03.multifile-workbench.json';
  return JSON.parse(readFileSync(resolve(relative), 'utf8')) as {
    descriptorId: 'PF-02' | 'PF-03';
    seed: number;
    profiles: Record<Profile, Record<string, number | string>>;
    fixture: { profileDigests: Record<Profile, string> };
  };
}

function expectSafeReadonlyBundle(bundle: PublicFixtureBundle): void {
  expect(Object.keys(bundle).sort()).toEqual(
    [
      'schemaVersion',
      'descriptorId',
      'profile',
      'seed',
      'shape',
      'workbench',
      'detail',
      'files',
    ].sort(),
  );
  expect(bundle.schemaVersion).toBe(1);
  expect(bundle.workbench).toBeDefined();
  expect(bundle.detail).toBeDefined();
  expect(bundle.files.length).toBeGreaterThan(0);

  for (const file of bundle.files) {
    expect(file.kind).toBe('nativeFile');
    expect(file.file.hasDraftChanges).toBe(false);
    expect(file.file.canEdit).toEqual({ kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' });
  }

  const serialized = JSON.stringify(bundle);
  expect(serialized).not.toContain('SYNTHETIC-SECRET-');
  expect(serialized).not.toMatch(/\/Users\/|file:\/\/|~\//);
}

function assertDeterministicFixture(
  build: (profile: Profile) => PublicFixtureBundle,
  id: 'PF-02' | 'PF-03',
): void {
  const spec = descriptor(id);
  for (const profile of ['representative', 'stress'] as const) {
    const first = build(profile);
    const second = build(profile);

    expect(first).toEqual(second);
    expect(first.descriptorId).toBe(id);
    expect(first.profile).toBe(profile);
    expect(first.seed).toBe(spec.seed);
    expect(first.shape).toEqual(spec.profiles[profile]);
    expectSafeReadonlyBundle(first);
    expect(pfReadFixtureDigest(first)).toBe(spec.fixture.profileDigests[profile]);
  }
}

describe('PF-02/PF-03 deterministic synthetic read fixtures', () => {
  it('以 Node createHash 交叉核验 custom SHA-256：四个 profile 的完整 safe bundle digest 一致', () => {
    for (const [id, build] of [
      ['PF-02', buildPf02SourceLargeFixture],
      ['PF-03', buildPf03MultifileFixture],
    ] as const) {
      const spec = descriptor(id);
      for (const profile of ['representative', 'stress'] as const) {
        const bundle = build(profile);
        const nodeDigest = createHash('sha256')
          .update(JSON.stringify(bundle, null, 2), 'utf8')
          .digest('hex');

        expect(pfReadFixtureDigest(bundle)).toBe(nodeDigest);
        expect(nodeDigest).toBe(spec.fixture.profileDigests[profile]);
      }
    }
  });

  it('PF-02 两个 profile 的大源码 bundle 逐字节确定、已遮蔽且 hash 与 descriptor 相同', () => {
    assertDeterministicFixture(buildPf02SourceLargeFixture, 'PF-02');
    for (const profile of ['representative', 'stress'] as const) {
      const bundle = buildPf02SourceLargeFixture(profile);
      const shape = descriptor('PF-02').profiles[profile] as Record<string, number>;
      const source = bundle.files.find((file) => file.content.kind === 'source');

      expect(source?.content.kind).toBe('source');
      if (source?.content.kind !== 'source') throw new Error('PF-02 source snapshot missing');
      expect(source.content.sensitiveSegments).toHaveLength(shape.maskedSensitiveSegmentCount);
      expect(source.content.maskedText).not.toContain('SYNTHETIC-SECRET-');
      const lines = source.content.maskedText.split('\n');
      expect(Buffer.byteLength(source.content.maskedText, 'utf8')).toBe(shape.textBytes);
      expect(lines).toHaveLength(shape.lineCount);
      expect(Math.max(...lines.map((line) => Buffer.byteLength(line, 'utf8')))).toBe(
        shape.longestLineBytes,
      );
      expect(lines.filter((line) => line.startsWith('# comment '))).toHaveLength(
        shape.commentCount,
      );
      expect(lines.filter((line) => line.startsWith('unknown_field_'))).toHaveLength(
        shape.unknownFieldCount,
      );
    }
  });

  it('PF-03 两个 profile 精确保留多文件 shape，所有 public 文件均只读且无草稿', () => {
    assertDeterministicFixture(buildPf03MultifileFixture, 'PF-03');
    const spec = descriptor('PF-03');
    for (const profile of ['representative', 'stress'] as const) {
      const bundle = buildPf03MultifileFixture(profile);
      const shape = spec.profiles[profile] as Record<string, number | string>;

      expect(bundle.files).toHaveLength(shape.fileCount as number);
      expect(bundle.files.filter((file) => file.file.fileKind === 'text')).toHaveLength(
        shape.textFileCount as number,
      );
      expect(bundle.files.filter((file) => file.file.fileKind === 'nonText')).toHaveLength(
        shape.nonTextFileCount as number,
      );
      expect(bundle.files.every((file) => file.file.hasDraftChanges === false)).toBe(true);
      expect(new Set(bundle.files.map((file) => file.file.fileId)).size).toBe(
        shape.fileCount as number,
      );
      expect(new Set(bundle.files.map((file) => file.file.relativePath)).size).toBe(
        shape.fileCount as number,
      );
      expect(
        bundle.files.some((file) => file.file.relativePath === (shape.activePath as string)),
      ).toBe(true);
      expect(
        bundle.files.find((file) => file.file.relativePath === (shape.activePath as string))?.file
          .fileKind,
      ).toBe('text');
      expect(
        Math.max(
          ...bundle.files.map((file) => Math.max(0, file.file.relativePath.split('/').length - 1)),
        ),
      ).toBe(shape.maxDirectoryDepth as number);
      expect(
        bundle.files.reduce(
          (total, file) =>
            total +
            (file.content.kind === 'source'
              ? Buffer.byteLength(file.content.maskedText, 'utf8')
              : file.content.sizeBytes),
          0,
        ),
      ).toBe(shape.totalBytes as number);
      for (const file of bundle.files) {
        if (file.content.kind !== 'source') continue;
        expect(file.content.maskedText).not.toContain('SYNTHETIC-SECRET-');
        expect(file.content.sensitiveSegments.length).toBeGreaterThan(0);
      }
    }
  });
});
