import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const importRuntimeModule = (modulePath: string) => import(modulePath);

const {
  assertPf01L3BuildEnvironment,
  assertPf01OutputDirectory,
  assertPf01VerificationEnvironment,
} = (await importRuntimeModule('../../scripts/orchestrator/pf01-build-inputs.mjs')) as {
  assertPf01L3BuildEnvironment: (environment: Record<string, string | undefined>) => {
    overrides: readonly string[];
  };
  assertPf01OutputDirectory: (outputDir: string, options: { artifactsRoot: string }) => string;
  assertPf01VerificationEnvironment: (environment: Record<string, string | undefined>) => {
    overrides: readonly string[];
  };
};

const { assertCurrentPfDescriptorDigest, gitInfo, sameGitIdentity } = (await importRuntimeModule(
  '../../scripts/orchestrator/lib.mjs',
)) as {
  assertCurrentPfDescriptorDigest: (descriptorPath: string) => { digest: string };
  gitInfo: (options: { env: Record<string, string | undefined> }) => Promise<unknown>;
  sameGitIdentity: (
    left: { commit: string; worktreeDirty: boolean },
    right: { commit: string; worktreeDirty: boolean },
  ) => boolean;
};

describe('PF/verify provenance guards', () => {
  it('Git identity/object/status 入口一律拒绝可改变 repository、index、object、config 或 ref 解析的 ambient', async () => {
    const gitOverrides = [
      'GIT_INDEX_FILE',
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
      'GIT_CONFIG_PARAMETERS',
      'GIT_REPLACE_REF_BASE',
    ];
    for (const key of gitOverrides) {
      const env = { [key]: '/tmp/forged-git-state' };
      expect(() => assertPf01VerificationEnvironment(env)).toThrow(/Git.*ambient/i);
      expect(() => assertPf01L3BuildEnvironment(env)).toThrow(/Git.*ambient/i);
      await expect(gitInfo({ env })).rejects.toThrow(/Git.*ambient/i);
    }
  });

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
