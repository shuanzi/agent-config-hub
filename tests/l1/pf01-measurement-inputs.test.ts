import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { PF01_MEASUREMENT_INPUTS, PF01_MEASUREMENT_INPUT_PATHS, assertPf01L2ViteModuleClosure, collectPf01MeasurementInputs, collectPf01MeasurementInputsFromGit, computePf01MeasurementInputsDigest, validatePf01MeasurementInputs } from '../../scripts/orchestrator/pf01-measurement-inputs.mjs';

const REQUIRED_MEASUREMENT_METHOD_FILES = [
  'scripts/orchestrator/pf01-measurement-inputs.mjs',
  'scripts/orchestrator/refresh-pf01-budget.mjs',
];

function entries() {
  return PF01_MEASUREMENT_INPUT_PATHS.map((path: string, index: number) => ({
    path,
    sha256: index.toString(16).padStart(64, '0'),
  }));
}

function measurementInputs(kind: 'clean-tracked-checkout' | 'git-object-tree') {
  const inputEntries = entries();
  return {
    schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
    algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
    digest: computePf01MeasurementInputsDigest({
      schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
      algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
      entries: inputEntries,
    }),
    entries: inputEntries,
    source: {
      kind,
      method: PF01_MEASUREMENT_INPUTS.method,
      commit: 'a'.repeat(40),
    },
  };
}

function writeFixtureTree(root: string): void {
  for (const pathname of PF01_MEASUREMENT_INPUT_PATHS as string[]) {
    const file = join(root, pathname);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, pathname, 'utf8');
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'pf01@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'PF-01 test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
}

describe('PF-01 independent measurement-input provenance', () => {
  it('版本化 digest 精确绑定闭合的实际测量输入；missing、extra、drift 均 fail-closed', () => {
    const valid = measurementInputs('clean-tracked-checkout');
    expect(validatePf01MeasurementInputs(valid, 'clean-tracked-checkout')).toBe(true);

    const missing = measurementInputs('clean-tracked-checkout');
    missing.entries.pop();
    const extra = measurementInputs('clean-tracked-checkout');
    extra.entries.push({ path: 'unrelated.ts', sha256: 'f'.repeat(64) });
    const drift = measurementInputs('clean-tracked-checkout');
    drift.entries[0].sha256 = 'f'.repeat(64);
    const declaredActualMismatch = measurementInputs('clean-tracked-checkout');
    declaredActualMismatch.digest = 'f'.repeat(64);

    for (const invalid of [missing, extra, drift, declaredActualMismatch]) {
      expect(validatePf01MeasurementInputs(invalid, 'clean-tracked-checkout')).toBe(false);
    }
  });

  it('measurement collector 与显式 freeze 实现本身属于闭合集合，任一 drift 都 fail-closed', () => {
    expect(PF01_MEASUREMENT_INPUT_PATHS).toEqual(
      expect.arrayContaining(REQUIRED_MEASUREMENT_METHOD_FILES),
    );

    for (const pathname of REQUIRED_MEASUREMENT_METHOD_FILES) {
      const drift = measurementInputs('clean-tracked-checkout');
      const entry = drift.entries.find(
        (candidate: { path: string; sha256: string }) => candidate.path === pathname,
      );
      expect(entry).toBeDefined();
      entry!.sha256 = 'f'.repeat(64);
      expect(validatePf01MeasurementInputs(drift, 'clean-tracked-checkout')).toBe(false);
    }
  });

  it('实际 L2 Vite module closure 是测量方法的一部分，未来未登记模块 fail-closed', async () => {
    const actual = await assertPf01L2ViteModuleClosure({
      moduleIds: [
        'fixtures/fx-01/fixture.json',
        'fixtures/fx-01/native-root/skills/demo-skill/SKILL.md',
        'fixtures/sensitive-masking.ts',
        'src/App.tsx',
        'src/gateway/mock.ts',
        'src/gateway/perf-catalog.ts',
        'src/session/ReadOnlyWorkbenchSession.ts',
        'src/ui/ReadOnlyWorkbench.tsx',
        'src/ui/workbench.css',
        'src/workbench/read-only-model.ts',
        'tests/l2/l2-main.tsx',
        'tests/l2/pf01-startup-eligibility.ts',
        'tests/l2/workbench.html',
      ],
    });
    expect(actual).toContain('tests/l2/l2-main.tsx');
    await expect(
      assertPf01L2ViteModuleClosure({ moduleIds: [...actual, 'src/untracked-measurement.ts'] }),
    ).rejects.toThrow(/closure/i);
  });

  it('current/Git collector 拒绝 untracked 与 symlink，且只接受 regular Git blobs', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-measurement-inputs-'));
    try {
      writeFixtureTree(root);
      const current = collectPf01MeasurementInputs({
        repoRoot: root,
        trackedPaths: PF01_MEASUREMENT_INPUT_PATHS,
      });
      expect(current).toMatchObject({ source: { kind: 'clean-tracked-checkout' } });
      expect(current.entries.map((entry: { path: string }) => entry.path)).toEqual(
        expect.arrayContaining(REQUIRED_MEASUREMENT_METHOD_FILES),
      );
      expect(collectPf01MeasurementInputsFromGit({ repoRoot: root, commit: 'HEAD' })).toMatchObject(
        {
          source: { kind: 'git-object-tree' },
        },
      );

      expect(() =>
        collectPf01MeasurementInputs({
          repoRoot: root,
          trackedPaths: PF01_MEASUREMENT_INPUT_PATHS,
          gitStatus: '?? untracked-method.ts\n',
        }),
      ).toThrow(/untracked|clean/i);

      const target = join(root, 'performance/pf-01.perf.test.ts');
      rmSync(target);
      symlinkSync(join(root, 'performance/wdio.conf.ts'), target);
      expect(() =>
        collectPf01MeasurementInputs({
          repoRoot: root,
          trackedPaths: PF01_MEASUREMENT_INPUT_PATHS,
          gitStatus: '',
        }),
      ).toThrow(/symlink/i);

      writeFileSync(target, 'performance/pf-01.perf.test.ts', 'utf8');
      writeFileSync(join(root, REQUIRED_MEASUREMENT_METHOD_FILES[0]), 'collector drift', 'utf8');
      expect(() =>
        collectPf01MeasurementInputs({
          repoRoot: root,
          trackedPaths: PF01_MEASUREMENT_INPUT_PATHS,
        }),
      ).toThrow(/untracked|clean/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
