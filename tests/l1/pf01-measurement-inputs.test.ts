import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { PF01_MEASUREMENT_INPUTS, PF01_MEASUREMENT_INPUT_PATHS, attestPf01L2ViteDevModuleGraph, expectedPf01L2ViteDevModuleGraph, assertPf01L2ViteModuleClosure, collectPf01MeasurementInputs, collectPf01MeasurementInputsFromGit, computePf01MeasurementInputsDigest, validatePf01MeasurementInputs } from '../../scripts/orchestrator/pf01-measurement-inputs.mjs';

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
  const l2DevModuleGraph = expectedPf01L2ViteDevModuleGraph();
  return {
    schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
    algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
    digest: computePf01MeasurementInputsDigest({
      schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
      algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
      entries: inputEntries,
      l2DevModuleGraph,
    }),
    entries: inputEntries,
    l2DevModuleGraph,
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

describe('PF-01 independent measurement-input provenance v3', () => {
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

  it('measurement input 与 entry 都是 closed shape；extra key 即使重算 digest 也 fail-closed', () => {
    const topLevelExtra = measurementInputs('clean-tracked-checkout') as Record<string, unknown>;
    topLevelExtra.unexpected = 'forged';
    expect(validatePf01MeasurementInputs(topLevelExtra, 'clean-tracked-checkout')).toBe(false);

    const entryExtra = measurementInputs('clean-tracked-checkout');
    entryExtra.entries[0] = { ...entryExtra.entries[0], unexpected: 'forged' };
    entryExtra.digest = computePf01MeasurementInputsDigest({
      schemaVersion: entryExtra.schemaVersion,
      algorithm: entryExtra.algorithm,
      entries: entryExtra.entries,
      l2DevModuleGraph: entryExtra.l2DevModuleGraph,
    });
    expect(validatePf01MeasurementInputs(entryExtra, 'clean-tracked-checkout')).toBe(false);
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
    const expected = expectedPf01L2ViteDevModuleGraph();
    const actual = await assertPf01L2ViteModuleClosure({
      moduleIds: expected.actualModulePaths,
    });
    expect(actual).toContain('tests/l2/l2-main.tsx');
    await expect(
      assertPf01L2ViteModuleClosure({ moduleIds: [...actual, 'src/untracked-measurement.ts'] }),
    ).rejects.toThrow(/closure/i);
  });

  it('只接受实际 dev-server/browser module graph：missing、extra、dev-only 与 declared/actual mismatch 均 fail-closed', () => {
    const expected = expectedPf01L2ViteDevModuleGraph();
    expect(
      attestPf01L2ViteDevModuleGraph({
        moduleIds: [...expected.actualModulePaths, '\0vite/client'],
      }),
    ).toEqual(expected);
    expect(
      attestPf01L2ViteDevModuleGraph({
        moduleIds: [...expected.actualModulePaths, 'react/jsx-runtime', '@tauri-apps/api/core'],
      }),
    ).toEqual(expected);

    const invalidGraphs = [
      { ...expected, actualModulePaths: expected.actualModulePaths.slice(1) },
      {
        ...expected,
        actualModulePaths: [...expected.actualModulePaths, 'src/dev-only-measurement.ts'],
      },
      {
        ...expected,
        declaredModulePaths: [...expected.declaredModulePaths].reverse(),
      },
    ];
    for (const graph of invalidGraphs) {
      expect(() =>
        attestPf01L2ViteDevModuleGraph({
          moduleIds: graph.actualModulePaths,
          declaredModulePaths: graph.declaredModulePaths,
        }),
      ).toThrow(/module graph|closure|declared/i);
    }

    for (const outsidePhysicalModule of [
      '/tmp/pf01-outside.ts',
      '/@fs/tmp/pf01-outside.ts',
      '/tmp/node_modules/evil/index.js',
      '/@fs/tmp/node_modules/evil/index.js',
    ]) {
      expect(() =>
        attestPf01L2ViteDevModuleGraph({
          moduleIds: [...expected.actualModulePaths, outsidePhysicalModule],
        }),
      ).toThrow(/outside repository/i);
    }
    expect(() =>
      attestPf01L2ViteDevModuleGraph({
        moduleIds: [...expected.actualModulePaths, './tests/l2/l2-main.tsx'],
      }),
    ).toThrow(/path|module graph|closure/i);
  });

  it('实际 dev module graph 的 repo-local module 必须是 physical regular file', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-dev-module-graph-symlink-'));
    try {
      writeFixtureTree(root);
      const expected = expectedPf01L2ViteDevModuleGraph();
      const target = join(root, 'src/gateway/mock.ts');
      rmSync(target);
      symlinkSync(join(root, 'src/App.tsx'), target);
      expect(() =>
        attestPf01L2ViteDevModuleGraph({
          repoRoot: root,
          moduleIds: expected.actualModulePaths,
        }),
      ).toThrow(/symlink/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('current/Git collector 拒绝 untracked 与 symlink，且只接受 regular Git blobs', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-measurement-inputs-'));
    try {
      writeFixtureTree(root);
      const current = collectPf01MeasurementInputs({
        repoRoot: root,
        trackedPaths: PF01_MEASUREMENT_INPUT_PATHS,
        l2DevModuleGraph: expectedPf01L2ViteDevModuleGraph(),
      });
      expect(current).toMatchObject({ source: { kind: 'clean-tracked-checkout' } });
      expect(current.entries.map((entry: { path: string }) => entry.path)).toEqual(
        expect.arrayContaining(REQUIRED_MEASUREMENT_METHOD_FILES),
      );
      expect(
        collectPf01MeasurementInputsFromGit({
          repoRoot: root,
          commit: 'HEAD',
          l2DevModuleGraph: expectedPf01L2ViteDevModuleGraph(),
        }),
      ).toMatchObject({ source: { kind: 'git-object-tree' } });

      expect(() =>
        collectPf01MeasurementInputs({
          repoRoot: root,
          trackedPaths: PF01_MEASUREMENT_INPUT_PATHS,
          gitStatus: '?? untracked-method.ts\n',
          l2DevModuleGraph: expectedPf01L2ViteDevModuleGraph(),
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
          l2DevModuleGraph: expectedPf01L2ViteDevModuleGraph(),
        }),
      ).toThrow(/symlink/i);

      writeFileSync(target, 'performance/pf-01.perf.test.ts', 'utf8');
      writeFileSync(join(root, REQUIRED_MEASUREMENT_METHOD_FILES[0]), 'collector drift', 'utf8');
      expect(() =>
        collectPf01MeasurementInputs({
          repoRoot: root,
          trackedPaths: PF01_MEASUREMENT_INPUT_PATHS,
          l2DevModuleGraph: expectedPf01L2ViteDevModuleGraph(),
        }),
      ).toThrow(/untracked|clean/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
