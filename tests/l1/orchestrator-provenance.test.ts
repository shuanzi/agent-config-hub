import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const importRuntimeModule = (modulePath: string) => import(modulePath);

const { assertPf01OutputDirectory, assertPf01VerificationEnvironment } = (await importRuntimeModule(
  '../../scripts/orchestrator/pf01-build-inputs.mjs',
)) as {
  assertPf01OutputDirectory: (outputDir: string, options: { artifactsRoot: string }) => string;
  assertPf01VerificationEnvironment: (environment: Record<string, string | undefined>) => {
    overrides: readonly string[];
  };
};

const { assertCurrentPfDescriptorDigest, sameGitIdentity } = (await importRuntimeModule(
  '../../scripts/orchestrator/lib.mjs',
)) as {
  assertCurrentPfDescriptorDigest: (descriptorPath: string) => { digest: string };
  sameGitIdentity: (
    left: { commit: string; worktreeDirty: boolean },
    right: { commit: string; worktreeDirty: boolean },
  ) => boolean;
};

describe('PF/verify provenance guards', () => {
  it('拒绝 ambient PF/fixture override，并只接受 artifacts 内的 physical output directory', () => {
    expect(() =>
      assertPf01VerificationEnvironment({
        PF01_OUTPUT_DIR: '/tmp/forged',
        ACM_NATIVE_ROOT: '/tmp/forged-fixture',
      }),
    ).toThrow(/ambient/i);
    expect(() => assertPf01VerificationEnvironment({ PERF_OUTPUT_DIR: '/tmp/forged' })).toThrow(
      /ambient/i,
    );
    expect(assertPf01VerificationEnvironment({}).overrides).toEqual([]);

    const root = mkdtempSync(join(tmpdir(), 'pf01-output-directory-'));
    try {
      const artifactsRoot = join(root, '.artifacts');
      const output = join(artifactsRoot, 'verification/FE-01/run/performance');
      expect(assertPf01OutputDirectory(output, { artifactsRoot })).toBe(output);
      expect(() => assertPf01OutputDirectory(join(root, 'outside'), { artifactsRoot })).toThrow(
        /artifact/i,
      );

      mkdirSync(artifactsRoot, { recursive: true });
      const physical = join(root, 'physical');
      mkdirSync(physical);
      symlinkSync(physical, join(artifactsRoot, 'linked'));
      expect(() =>
        assertPf01OutputDirectory(join(artifactsRoot, 'linked/run'), { artifactsRoot }),
      ).toThrow(/symlink/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('descriptor digest 或起止 Git identity 任一漂移时 fail-closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-descriptor-'));
    try {
      const descriptorPath = join(root, 'descriptor.json');
      const initial = '{\n  "digest": { "value": "" }\n}\n';
      const digest = createHash('sha256').update(initial, 'utf8').digest('hex');
      writeFileSync(descriptorPath, initial.replace('"value": ""', `"value": "${digest}"`));
      expect(assertCurrentPfDescriptorDigest(descriptorPath)).toMatchObject({ digest });

      writeFileSync(descriptorPath, `{"changed":true,"digest":{"value":"${digest}"}}\n`);
      expect(() => assertCurrentPfDescriptorDigest(descriptorPath)).toThrow(/digest/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    expect(
      sameGitIdentity(
        { commit: 'a'.repeat(40), worktreeDirty: false },
        { commit: 'a'.repeat(40), worktreeDirty: false },
      ),
    ).toBe(true);
    expect(
      sameGitIdentity(
        { commit: 'a'.repeat(40), worktreeDirty: false },
        { commit: 'b'.repeat(40), worktreeDirty: false },
      ),
    ).toBe(false);
    expect(
      sameGitIdentity(
        { commit: 'a'.repeat(40), worktreeDirty: false },
        { commit: 'a'.repeat(40), worktreeDirty: true },
      ),
    ).toBe(false);
  });
});
