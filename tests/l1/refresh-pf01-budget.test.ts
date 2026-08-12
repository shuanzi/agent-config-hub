import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime orchestrator module is plain Node ESM.
import { freezePf01BudgetFromBaselineRun } from '../../scripts/orchestrator/refresh-pf01-budget.mjs';
// prettier-ignore
// @ts-expect-error runtime build-environment helper is a plain Node ESM module.
import { assertPf01L3BuildEnvironment } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime build-environment helper is a plain Node ESM module.
import { PF01_BUILD_ENVIRONMENT } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime orchestrator module is plain Node ESM.
import { computePf01L3HarnessBuildInputsDigest, PF01_L3_BUILD_INPUTS } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { computePf01MeasurementInputsDigest, expectedPf01L2ViteDevModuleGraph, PF01_MEASUREMENT_INPUT_PATHS, PF01_MEASUREMENT_INPUTS } from '../../scripts/orchestrator/pf01-measurement-inputs.mjs';

const descriptor = JSON.parse(
  readFileSync(resolve('performance/descriptors/pf-01.catalog-browse.json'), 'utf8'),
) as Record<string, unknown>;
const commit = 'f783568e73d70411f3a7ce1e5b982b99135b5e57';
const run = '.artifacts/performance/PF-01/20260811T120000000Z-p1-000';

function buildInputs(kind: 'clean-tracked-checkout' | 'git-object-tree') {
  const entries = [{ path: 'src/main.tsx', sha256: 'c'.repeat(64) }];
  return {
    schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
    algorithm: PF01_L3_BUILD_INPUTS.algorithm,
    digest: computePf01L3HarnessBuildInputsDigest({
      schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
      algorithm: PF01_L3_BUILD_INPUTS.algorithm,
      entries,
    }),
    source: {
      kind,
      method: 'raw bytes SHA-256 / byte-sorted repo-relative paths',
      commit,
    },
    entries,
  };
}

function measurementInputs(kind: 'clean-tracked-checkout' | 'git-object-tree') {
  const entries = PF01_MEASUREMENT_INPUT_PATHS.map((path: string, index: number) => ({
    path,
    sha256: (index + 1).toString(16).padStart(64, '0'),
  }));
  const l2DevModuleGraph = expectedPf01L2ViteDevModuleGraph();
  return {
    schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
    algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
    digest: computePf01MeasurementInputsDigest({
      schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
      algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
      entries,
      l2DevModuleGraph,
    }),
    source: {
      kind,
      method: PF01_MEASUREMENT_INPUTS.method,
      commit,
    },
    entries,
    l2DevModuleGraph,
  };
}

const artifact = {
  identityPath: '.artifacts/test-harness/identity.json',
  kind: 'test-harness',
  identifier: 'io.github.shuanzi.agent-config-manager.test-harness',
  profile: 'debug',
  binary: 'src-tauri/target/debug/agent-config-manager',
  declaredBinarySha256: 'a'.repeat(64),
  actualBinarySha256: 'a'.repeat(64),
  provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
};
const fixture = { path: 'fixtures/fx-01/native-root', sha256: 'b'.repeat(64) };

function percentile(sorted: number[], p: number) {
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return (
    Math.round((sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (rank - lower)) * 1000) / 1000
  );
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function writeRun(root: string, mutate?: (summary: Record<string, unknown>) => void) {
  const runDir = join(root, run);
  mkdirSync(runDir, { recursive: true });
  const l2 = {
    'pf01.startup.first_list_visible': [10, 11, 12, 13, 14],
    'pf01.search.results_visible': Array.from({ length: 20 }, (_, index) => index + 1),
    'pf01.filter.results_visible': Array.from({ length: 20 }, (_, index) => index + 21),
    'pf01.select.skill_cells_visible': Array.from({ length: 20 }, (_, index) => index + 41),
  };
  const l3 = { 'pf01.l3.cold_start.first_snapshot': [30, 40, 50] };
  const current = {
    artifact: { ...artifact },
    fixture: { ...fixture },
    buildInputs: buildInputs('clean-tracked-checkout'),
    measurementInputs: measurementInputs('clean-tracked-checkout'),
    runner: {
      node: 'v24.18.0',
      npm: '11.16.0',
      platform: 'darwin',
      release: '25.0.0',
      macosProductVersion: '26.0',
      arch: 'arm64',
    },
    toolchain: { cargo: 'cargo 1.90.0', rustc: 'rustc 1.90.0' },
    buildEnvironment: { ...PF01_BUILD_ENVIRONMENT, overrides: [] },
  };
  const l2DevModuleGraph = current.measurementInputs.l2DevModuleGraph;
  const summary: Record<string, unknown> = {
    schemaVersion: 1,
    descriptorId: 'PF-01',
    descriptorDigest: (descriptor.digest as { value: string }).value,
    profile: 'representative',
    status: 'baseline-collected / budget-not-frozen',
    budgetState: 'budget-not-frozen（本次 baseline 只收集样本，未生成版本化预算）',
    metrics: Object.fromEntries(
      [...Object.entries(l2), ...Object.entries(l3)].map(([metric, samples]) => [
        metric,
        {
          ...stats(samples),
          minSamples: samples.length,
          complete: true,
          unit: 'ms',
          layer: metric.includes('.l3.')
            ? 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）'
            : 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
        },
      ]),
    ),
    resources: {
      status: 'collected',
      metric: 'pf01.l3.peak_rss_bytes',
      layer: 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）',
      sampling: {
        process: 'agent-config-manager harness PID and descendants only',
        intervalMs: 50,
        window: 'successful process start to normal exit',
      },
      rawPeakBytes: [100, 120, 110],
      maxBytes: 120,
    },
    comparisonProvenance: { current },
    runIdentity: {
      startCommit: commit,
      startWorktreeDirty: false,
      endCommit: commit,
      endWorktreeDirty: false,
      consistent: true,
    },
    budgetValidation: { status: 'not-created' },
    collectedAt: '2026-08-11T12:00:00.000Z',
  };
  mutate?.(summary);
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary));
  writeFileSync(join(runDir, 'l2-dev-module-graph.json'), JSON.stringify(l2DevModuleGraph));
  writeFileSync(
    join(runDir, 'samples.json'),
    JSON.stringify({
      schemaVersion: 1,
      descriptorId: 'PF-01',
      profile: 'representative',
      collectedAt: '2026-08-11T12:00:00.000Z',
      unit: 'ms',
      metrics: Object.fromEntries(
        Object.entries(l2).map(([metric, samples]) => [metric, { samples }]),
      ),
    }),
  );
  writeFileSync(
    join(runDir, 'l3-samples.json'),
    JSON.stringify({
      schemaVersion: 1,
      descriptorId: 'PF-01',
      layer: 'L3 test-harness debug（非 release-like artifact）',
      collectedAt: '2026-08-11T12:00:00.000Z',
      unit: 'ms',
      metrics: Object.fromEntries(
        Object.entries(l3).map(([metric, samples]) => [metric, { samples }]),
      ),
    }),
  );
  writeFileSync(
    join(runDir, 'l3-resource-runs.json'),
    JSON.stringify({
      metric: 'pf01.l3.peak_rss_bytes',
      runs: [
        { harnessPid: 1, normalExit: true, samples: [100] },
        { harnessPid: 2, normalExit: true, samples: [120] },
        { harnessPid: 3, normalExit: true, samples: [110] },
      ],
    }),
  );
  writeFileSync(join(runDir, 'harness-identity.json'), JSON.stringify({ artifact }));
  writeFileSync(join(runDir, 'proposed-budgets.json'), JSON.stringify({ status: 'not-created' }));
}

function argumentsFor(root: string) {
  return {
    repoRoot: root,
    artifactsRoot: join(root, '.artifacts'),
    baselineRun: run,
    descriptor,
    profile: 'representative',
    currentGit: { commit, worktreeDirty: false },
    currentAttestation: {
      artifact: { ...artifact },
      fixture: { ...fixture },
      buildInputs: buildInputs('clean-tracked-checkout'),
      measurementInputs: measurementInputs('clean-tracked-checkout'),
      runner: {
        node: 'v24.18.0',
        npm: '11.16.0',
        platform: 'darwin',
        release: '25.0.0',
        macosProductVersion: '26.0',
        arch: 'arm64',
      },
      toolchain: { cargo: 'cargo 1.90.0', rustc: 'rustc 1.90.0' },
      buildEnvironment: { ...PF01_BUILD_ENVIRONMENT, overrides: [] },
    },
    baselineBuildInputs: buildInputs('git-object-tree'),
    baselineMeasurementInputs: measurementInputs('git-object-tree'),
    environment: {},
  };
}

describe('refresh PF-01 budget public seam', () => {
  it('producer 的当前 buildEnvironment 可直接被 freezer 接受，不能复制漂移 policy 文本', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-freeze-producer-build-environment-'));
    try {
      const producerEnvironment = assertPf01L3BuildEnvironment({}, root);
      writeRun(root, (summary) => {
        (
          summary.comparisonProvenance as { current: { buildEnvironment: unknown } }
        ).current.buildEnvironment = producerEnvironment;
      });
      expect(() => freezePf01BudgetFromBaselineRun(argumentsFor(root))).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('没有显式 baseline run 时 fail-closed，且不触发任何 automatic PF 采样', () => {
    const result = spawnSync(process.execPath, ['scripts/orchestrator/refresh-pf01-budget.mjs'], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--baseline-run/);
    expect(result.stdout).not.toMatch(/PF-01 descriptor digest|wdio|harness/i);
  });

  it('只从完整、clean、当前 descriptor 的 immutable baseline run 重建可验证预算', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-freeze-'));
    try {
      writeRun(root);
      const budget = freezePf01BudgetFromBaselineRun(argumentsFor(root));
      expect(budget.baselineProvenance.run).toBe(run);
      expect(budget.baselineProvenance.buildInputs.source.kind).toBe('git-object-tree');
      expect(budget.baselineProvenance.resources.rawPeaksBytes).toEqual([100, 120, 110]);
      expect(budget.budgets).toHaveLength(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('freezer producer 同时生成独立的 7-SHA、raw timing/RSS 与 buildEnvironment baseline binding', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-freeze-binding-producer-'));
    try {
      writeRun(root);
      const frozen = freezePf01BudgetFromBaselineRun({
        ...argumentsFor(root),
        frozenBaselineBudget: {
          path: 'performance/budgets/pf-01.budgets.json',
          sha256: 'f'.repeat(64),
        },
      });
      expect(frozen.frozenBaseline.baseline.artifactSha256).toHaveProperty('summary.json');
      expect(frozen.frozenBaseline.baseline.rawTiming['pf01.startup.first_list_visible']).toEqual([
        10, 11, 12, 13, 14,
      ]);
      expect(frozen.frozenBaseline.baseline.resource).toMatchObject({
        rawPeakBytes: [100, 120, 110],
        normalExit: [true, true, true],
      });
      expect(frozen.frozenBaseline.baseline.measurementContract.buildEnvironment).toEqual(
        PF01_BUILD_ENVIRONMENT,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fail-closed：拒绝缺 provenance、dirty/old descriptor、attestation 漂移与 run symlink', () => {
    const cases: Array<[string, (summary: Record<string, unknown>) => void, RegExp]> = [
      [
        'missing',
        (summary) => delete (summary.comparisonProvenance as { current?: unknown }).current,
        /provenance/i,
      ],
      [
        'dirty',
        (summary) =>
          ((summary.runIdentity as { startWorktreeDirty: boolean }).startWorktreeDirty = true),
        /clean/i,
      ],
      ['old-descriptor', (summary) => (summary.descriptorDigest = 'd'.repeat(64)), /descriptor/i],
      [
        'artifact',
        (summary) =>
          ((
            summary.comparisonProvenance as {
              current: { artifact: { actualBinarySha256: string } };
            }
          ).current.artifact.actualBinarySha256 = 'c'.repeat(64)),
        /attestation/i,
      ],
      [
        'fixture',
        (summary) =>
          ((
            summary.comparisonProvenance as { current: { fixture: { sha256: string } } }
          ).current.fixture.sha256 = 'c'.repeat(64)),
        /fixture/i,
      ],
      [
        'build-input',
        (summary) =>
          ((
            summary.comparisonProvenance as { current: { buildInputs: { digest: string } } }
          ).current.buildInputs.digest = 'd'.repeat(64)),
        /build-input/i,
      ],
      [
        'missing-measurement-input',
        (summary) =>
          delete (summary.comparisonProvenance as { current: { measurementInputs?: unknown } })
            .current.measurementInputs,
        /attestation|module graph/i,
      ],
      [
        'measurement-input-drift',
        (summary) =>
          (((
            summary.comparisonProvenance as {
              current: { measurementInputs: { digest: string } };
            }
          ).current.measurementInputs.digest as string) = 'd'.repeat(64)),
        /attestation/i,
      ],
      [
        'runtime-drift',
        (summary) =>
          (((summary.comparisonProvenance as { current: { runner: { node: string } } }).current
            .runner.node as string) = 'v99.0.0'),
        /runtime|attestation/i,
      ],
      [
        'missing-build-environment',
        (summary) =>
          delete (summary.comparisonProvenance as { current: { buildEnvironment?: unknown } })
            .current.buildEnvironment,
        /build environment/i,
      ],
      [
        'drifted-build-environment',
        (summary) =>
          ((
            summary.comparisonProvenance as {
              current: { buildEnvironment: { overrides: string[] } };
            }
          ).current.buildEnvironment.overrides = ['RUSTFLAGS']),
        /build environment/i,
      ],
    ];
    for (const [name, mutate, message] of cases) {
      const root = mkdtempSync(join(tmpdir(), `pf01-freeze-${name}-`));
      try {
        writeRun(root, mutate);
        expect(() => freezePf01BudgetFromBaselineRun(argumentsFor(root))).toThrow(message);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    const incompleteRoot = mkdtempSync(join(tmpdir(), 'pf01-freeze-incomplete-'));
    try {
      writeRun(incompleteRoot);
      const l3Path = join(incompleteRoot, run, 'l3-samples.json');
      const l3 = JSON.parse(readFileSync(l3Path, 'utf8')) as {
        metrics: { 'pf01.l3.cold_start.first_snapshot': { samples: number[] } };
      };
      l3.metrics['pf01.l3.cold_start.first_snapshot'].samples = [30, 40];
      writeFileSync(l3Path, JSON.stringify(l3));
      expect(() => freezePf01BudgetFromBaselineRun(argumentsFor(incompleteRoot))).toThrow(
        /raw samples/i,
      );
    } finally {
      rmSync(incompleteRoot, { recursive: true, force: true });
    }

    const graphRoot = mkdtempSync(join(tmpdir(), 'pf01-freeze-dev-graph-'));
    try {
      writeRun(graphRoot);
      const graphPath = join(graphRoot, run, 'l2-dev-module-graph.json');
      const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as {
        actualModulePaths: string[];
      };
      graph.actualModulePaths = graph.actualModulePaths.slice(1);
      writeFileSync(graphPath, JSON.stringify(graph));
      expect(() => freezePf01BudgetFromBaselineRun(argumentsFor(graphRoot))).toThrow(
        /module graph/i,
      );

      writeRun(graphRoot);
      rmSync(graphPath);
      symlinkSync(join(graphRoot, run, 'summary.json'), graphPath);
      expect(() => freezePf01BudgetFromBaselineRun(argumentsFor(graphRoot))).toThrow(/symlink/i);
    } finally {
      rmSync(graphRoot, { recursive: true, force: true });
    }

    const root = mkdtempSync(join(tmpdir(), 'pf01-freeze-symlink-'));
    try {
      const physical = join(root, 'physical');
      writeRun(physical);
      mkdirSync(join(root, '.artifacts/performance/PF-01'), { recursive: true });
      symlinkSync(join(physical, run), join(root, run));
      expect(() => freezePf01BudgetFromBaselineRun(argumentsFor(root))).toThrow(/symlink/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    const parentRoot = mkdtempSync(join(tmpdir(), 'pf01-freeze-parent-symlink-'));
    try {
      const physical = join(parentRoot, 'physical');
      writeRun(physical);
      symlinkSync(join(physical, '.artifacts'), join(parentRoot, '.artifacts'));
      expect(() => freezePf01BudgetFromBaselineRun(argumentsFor(parentRoot))).toThrow(/symlink/i);
    } finally {
      rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('public seam 与 CLI 在读取 artifact 前拒绝 ambient verification/build override', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-freeze-ambient-'));
    try {
      writeRun(root);
      expect(() =>
        freezePf01BudgetFromBaselineRun({
          ...argumentsFor(root),
          environment: { PF01_OUTPUT_DIR: '/tmp/forged' },
        }),
      ).toThrow(/ambient/i);
      expect(() =>
        freezePf01BudgetFromBaselineRun({
          ...argumentsFor(root),
          environment: { RUSTFLAGS: '-C debuginfo=0' },
        }),
      ).toThrow(/build-input environment/i);
      expect(() =>
        freezePf01BudgetFromBaselineRun({
          ...argumentsFor(root),
          environment: { NODE_OPTIONS: '--require=/tmp/forged' },
        }),
      ).toThrow(/build-input environment/i);

      const cliOverrides: Array<[string, string, RegExp]> = [
        ['PF01_OUTPUT_DIR', '/tmp/forged', /ambient/i],
        ['ACM_NATIVE_ROOT', '/tmp/forged', /ambient/i],
        ['RUSTFLAGS', '-C debuginfo=0', /build-input environment/i],
        ['RUSTC', '/tmp/alternate-rustc', /build-input environment/i],
        ['NODE_OPTIONS', '--trace-warnings', /build-input environment/i],
      ];
      for (const [key, value, message] of cliOverrides) {
        const cli = spawnSync(
          process.execPath,
          ['scripts/orchestrator/refresh-pf01-budget.mjs', `--baseline-run=${run}`],
          {
            cwd: resolve('.'),
            encoding: 'utf8',
            env: { ...process.env, [key]: value },
          },
        );
        expect(cli.status).toBe(2);
        expect(cli.stderr).toMatch(message);
        expect(cli.stdout).not.toMatch(/descriptor|harness|wdio/i);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
