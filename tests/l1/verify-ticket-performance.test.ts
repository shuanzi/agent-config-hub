import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime manifest collector is a plain Node ESM module.
import { collectReadPfManifestResults } from '../../scripts/orchestrator/verify-ticket-performance.mjs';
// prettier-ignore
// @ts-expect-error runtime measurement input seam is a plain Node ESM module.
import { collectPfReadMeasurementInputs, PF_READ_REQUIRED_L2_MODULES } from '../../scripts/orchestrator/pf-read-measurement-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime evaluator seam is a plain Node ESM module.
import { evaluateReadPfEvidence } from '../../scripts/orchestrator/pf-read-evidence.mjs';
// prettier-ignore
// @ts-expect-error runtime registry module is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';

type Profile = 'representative' | 'stress';
type PerformanceConfig = {
  descriptorId: 'PF-02' | 'PF-03';
  profile: Profile;
  descriptorPath: string;
  budgetPath: string;
  evidenceRelativeDir: string;
};

type MetricSummary = {
  n: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  complete: boolean;
  minSamples: number;
  layer: string;
};

type EvidenceSummary = {
  schemaVersion: 1;
  descriptorId: 'PF-02' | 'PF-03';
  descriptorDigest: string;
  profile: Profile;
  fixtureDigest: string;
  metrics: Record<string, MetricSummary>;
  budgetState: string;
  status: string;
  runIdentity: {
    startCommit: string;
    startWorktreeDirty: boolean;
    endCommit: string;
    endWorktreeDirty: boolean;
    consistent: boolean;
  };
  validation: { valid: boolean; violations: string[] };
  budgetValidation:
    | { status: string }
    | {
        valid: boolean;
        violations?: string[];
        metricBudgets?: Record<string, { comparison: 'pass' | 'fail' }>;
      };
  runner: Record<string, string>;
  toolchain: Record<string, string>;
  measurementInputDigest: string;
};

function descriptor(config: PerformanceConfig, repoRoot = resolve()) {
  return JSON.parse(readFileSync(resolve(repoRoot, config.descriptorPath), 'utf8')) as {
    digest: { value: string };
    fixture: { profileDigests: Record<Profile, string> };
    metrics: Array<{ id: string; layer: string; minSamplesByProfile: Record<Profile, number> }>;
    budgetFormula: { absoluteCeilingMs: string; regressionAllowance: string };
  };
}

function percentileOfAscendingIntegers(n: number, percentile: number): number {
  const rank = (percentile / 100) * (n - 1);
  const lower = Math.floor(rank) + 1;
  const upper = Math.ceil(rank) + 1;
  return Math.round((lower + (upper - lower) * (rank - Math.floor(rank))) * 1000) / 1000;
}

function readOnlySummary(
  config: PerformanceConfig,
  measurementInputDigest: string,
  repoRoot = resolve(),
): EvidenceSummary {
  const spec = descriptor(config, repoRoot);
  return {
    schemaVersion: 1,
    descriptorId: config.descriptorId,
    descriptorDigest: spec.digest.value,
    profile: config.profile,
    fixtureDigest: spec.fixture.profileDigests[config.profile],
    metrics: Object.fromEntries(
      spec.metrics.map((metric) => [
        metric.id,
        {
          n: metric.minSamplesByProfile[config.profile],
          min: 1,
          max: metric.minSamplesByProfile[config.profile],
          p50: percentileOfAscendingIntegers(metric.minSamplesByProfile[config.profile], 50),
          p95: percentileOfAscendingIntegers(metric.minSamplesByProfile[config.profile], 95),
          complete: true,
          minSamples: metric.minSamplesByProfile[config.profile],
          layer: metric.layer,
        },
      ]),
    ),
    budgetState: 'budget-not-frozen（本次 baseline 只收集样本，未生成版本化预算）',
    status: 'baseline-collected / budget-not-frozen',
    runIdentity: {
      startCommit: 'a'.repeat(40),
      startWorktreeDirty: false,
      endCommit: 'a'.repeat(40),
      endWorktreeDirty: false,
      consistent: true,
    },
    validation: { valid: true, violations: [] },
    budgetValidation: { status: 'not-created' },
    runner: {
      node: 'v24.18.0',
      npm: '11.16.0',
      platform: 'darwin',
      release: '25.6.0',
      macosProductVersion: '26.6.1',
      arch: 'arm64',
    },
    toolchain: { rustc: 'rustc 1.97.1', cargo: 'cargo 1.97.1' },
    measurementInputDigest,
  };
}

function readOnlyProposedBudgets(summary: EvidenceSummary) {
  return {
    schemaVersion: 1,
    descriptorId: summary.descriptorId,
    profile: summary.profile,
    status: 'proposed-not-frozen',
    note: '以下仅为首次完整 clean baseline 的建议预算；未写入版本化预算，须再次取得人工冻结确认。',
    budgets: Object.entries(summary.metrics).map(([metric, stats]) => ({
      metric,
      layer: stats.layer,
      baseline: { p50: stats.p50, p95: stats.p95, n: stats.n },
      proposedAbsoluteCeilingMs: Math.ceil((stats.p95 * 1.5) / 10) * 10,
      proposedRegressionP50CeilingMs: stats.p50 * 1.25,
      proposedRegressionAllowance: { relativeTo: 'baseline-p50', maxRatio: 1.25 },
      status: 'proposed-not-frozen',
    })),
  };
}

function writeCurrentEvidence(
  evidenceRoot: string,
  config: PerformanceConfig,
  mutateSummary?: (summary: EvidenceSummary) => void,
  repoRoot = resolve(),
): string {
  const outputDir = join(evidenceRoot, config.evidenceRelativeDir);
  const spec = descriptor(config, repoRoot);
  mkdirSync(outputDir, { recursive: true });
  const samples = {
    schemaVersion: 1,
    descriptorId: config.descriptorId,
    profile: config.profile,
    unit: 'ms',
    metrics: Object.fromEntries(
      spec.metrics.map((metric) => [
        metric.id,
        {
          samples: Array.from(
            { length: metric.minSamplesByProfile[config.profile] },
            (_unused, index) => index + 1,
          ),
        },
      ]),
    ),
  };
  const fixtureAttestation = {
    schemaVersion: 1,
    descriptorId: config.descriptorId,
    profile: config.profile,
    fixtureDigest: spec.fixture.profileDigests[config.profile],
  };
  const graph = {
    schemaVersion: 1,
    modulePaths: [...PF_READ_REQUIRED_L2_MODULES].sort((left, right) => left.localeCompare(right)),
  };
  writeFileSync(join(outputDir, 'l2-dev-module-graph.json'), `${JSON.stringify(graph)}\n`, 'utf8');
  const measurementInputs = collectPfReadMeasurementInputs({
    graphPath: join(outputDir, 'l2-dev-module-graph.json'),
    descriptorPath: config.descriptorPath,
    repoRoot,
  });
  const summary = readOnlySummary(config, measurementInputs.digest, repoRoot);
  mutateSummary?.(summary);
  const proposedBudgets = readOnlyProposedBudgets(summary);
  for (const [name, payload] of Object.entries({
    'samples.json': samples,
    'summary.json': summary,
    'proposed-budgets.json': proposedBudgets,
    'fixture-attestation.json': fixtureAttestation,
  })) {
    writeFileSync(join(outputDir, name), `${JSON.stringify(payload)}\n`, 'utf8');
  }
  return outputDir;
}

function stepResults(
  performances: PerformanceConfig[],
  override: Partial<{ id: string; exitCode: number; status: string }> = {},
) {
  return performances.map((config) => ({
    id: `perf-${config.descriptorId.toLowerCase().replace('-', '')}-${config.profile}`,
    exitCode: 2,
    status: 'inconclusive',
    ...override,
  }));
}

function copyFixtureRepositoryFile(repoRoot: string, relativePath: string): void {
  const source = resolve(relativePath);
  const destination = resolve(repoRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function createFrozenPf02ComparisonFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'acm-pf-read-frozen-repo-'));
  const config = (TICKET_REGISTRY['FE-02'].performances as PerformanceConfig[]).find(
    (performance) =>
      performance.descriptorId === 'PF-02' && performance.profile === 'representative',
  );
  if (config === undefined) throw new Error('PF-02 representative registry fixture missing');
  const staticFiles = [
    ...PF_READ_REQUIRED_L2_MODULES,
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'tests/l2/workbench.html',
    config.descriptorPath,
    'performance/wdio.read.conf.ts',
    'performance/pf-read.collector.test.ts',
    'scripts/orchestrator/perf.mjs',
    'scripts/orchestrator/perf-read.mjs',
    'scripts/orchestrator/pf-read-evidence.mjs',
    'scripts/orchestrator/pf-read-measurement-inputs.mjs',
    'scripts/orchestrator/lib.mjs',
  ];
  for (const relativePath of staticFiles) copyFixtureRepositoryFile(repoRoot, relativePath);

  const baselineCommit = 'c'.repeat(40);
  const baselineHolder = join(repoRoot, '.artifacts', 'baseline-holder');
  const baselineProfileDir = writeCurrentEvidence(
    baselineHolder,
    config,
    (summary) => {
      summary.runIdentity = {
        startCommit: baselineCommit,
        startWorktreeDirty: false,
        endCommit: baselineCommit,
        endWorktreeDirty: false,
        consistent: true,
      };
    },
    repoRoot,
  );
  const baselineDir = join(repoRoot, '.artifacts', 'baseline');
  mkdirSync(baselineDir, { recursive: true });
  const baselineNames = ['samples.json', 'summary.json', 'proposed-budgets.json'] as const;
  for (const name of baselineNames)
    copyFileSync(join(baselineProfileDir, name), join(baselineDir, name));
  const baselineArtifacts = Object.fromEntries(
    baselineNames.map((name) => [name, sha256File(join(baselineDir, name))]),
  );
  const spec = descriptor(config, repoRoot);
  const budget = {
    schemaVersion: 1,
    descriptorId: config.descriptorId,
    descriptorDigest: spec.digest.value,
    profile: config.profile,
    fixtureDigest: spec.fixture.profileDigests[config.profile],
    measurementInputDigest: JSON.parse(
      readFileSync(join(baselineProfileDir, 'summary.json'), 'utf8'),
    ).measurementInputDigest,
    path: config.budgetPath,
    formula: spec.budgetFormula,
    baselineProvenance: {
      run: relative(repoRoot, baselineDir).split('/').join('/'),
      commit: baselineCommit,
      worktreeDirty: false,
      runner: JSON.parse(readFileSync(join(baselineDir, 'summary.json'), 'utf8')).runner,
      toolchain: JSON.parse(readFileSync(join(baselineDir, 'summary.json'), 'utf8')).toolchain,
      descriptorDigest: spec.digest.value,
      fixtureDigest: spec.fixture.profileDigests[config.profile],
      measurementInputDigest: JSON.parse(readFileSync(join(baselineDir, 'summary.json'), 'utf8'))
        .measurementInputDigest,
      artifacts: baselineArtifacts,
    },
    metrics: Object.fromEntries(
      Object.entries(
        JSON.parse(readFileSync(join(baselineDir, 'summary.json'), 'utf8')).metrics as Record<
          string,
          { p50: number; p95: number; n: number }
        >,
      ).map(([id, metric]) => [
        id,
        {
          baseline: { p50: metric.p50, p95: metric.p95, n: metric.n },
          absoluteCeilingMs: Math.ceil((metric.p95 * 1.5) / 10) * 10,
          regressionP50CeilingMs: metric.p50 * 1.25,
        },
      ]),
    ),
  };
  const budgetPath = resolve(repoRoot, config.budgetPath);
  mkdirSync(dirname(budgetPath), { recursive: true });
  writeFileSync(budgetPath, `${JSON.stringify(budget)}\n`, 'utf8');

  const evidenceRoot = join(repoRoot, '.artifacts', 'current-holder');
  const currentProfileDir = writeCurrentEvidence(evidenceRoot, config, undefined, repoRoot);
  const samplesPayload = JSON.parse(readFileSync(join(currentProfileDir, 'samples.json'), 'utf8'));
  const measurementInputs = collectPfReadMeasurementInputs({
    graphPath: join(currentProfileDir, 'l2-dev-module-graph.json'),
    descriptorPath: config.descriptorPath,
    repoRoot,
  });
  const baselineEvidence = {
    samplesPayload: JSON.parse(readFileSync(join(baselineDir, 'samples.json'), 'utf8')),
    summary: JSON.parse(readFileSync(join(baselineDir, 'summary.json'), 'utf8')),
    proposedBudgets: JSON.parse(readFileSync(join(baselineDir, 'proposed-budgets.json'), 'utf8')),
  };
  const currentSummary = JSON.parse(readFileSync(join(currentProfileDir, 'summary.json'), 'utf8'));
  const evaluated = evaluateReadPfEvidence({
    descriptor: spec,
    descriptorDigest: spec.digest.value,
    profile: config.profile,
    fixtureDigest: spec.fixture.profileDigests[config.profile],
    samplesPayload,
    runIdentity: {
      start: { commit: currentSummary.runIdentity.startCommit, worktreeDirty: false },
      end: { commit: currentSummary.runIdentity.endCommit, worktreeDirty: false },
    },
    runtime: { runner: currentSummary.runner, toolchain: currentSummary.toolchain },
    measurementInputs,
    budget,
    baselineArtifactDigests: baselineArtifacts,
    baselineEvidence,
  });
  writeFileSync(
    join(currentProfileDir, 'summary.json'),
    `${JSON.stringify(evaluated.summary)}\n`,
    'utf8',
  );
  writeFileSync(
    join(currentProfileDir, 'proposed-budgets.json'),
    `${JSON.stringify(evaluated.proposedBudgets)}\n`,
    'utf8',
  );
  return { repoRoot, evidenceRoot, currentProfileDir, baselineDir, budgetPath, config };
}

describe('verify:ticket multi-PF manifest projection', () => {
  it('仅从四个隔离 profile evidence 投影脱敏 performanceResults[]，FE-01 legacy PF 保持 singular', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'acm-pf-read-manifest-'));
    const performances = TICKET_REGISTRY['FE-02'].performances as PerformanceConfig[];
    const steps = stepResults(performances);

    try {
      for (const config of performances) {
        writeCurrentEvidence(evidenceRoot, config);
      }

      const collected = collectReadPfManifestResults({
        performances,
        stepResults: steps,
        evidenceRoot,
        expectedCommit: 'a'.repeat(40),
      });

      expect(collected).toMatchObject({ incomplete: false, contaminationNotes: [] });
      expect(collected.performanceResults).toHaveLength(4);
      expect(
        collected.performanceResults.map((result: { pfId: string; profile: string }) => [
          result.pfId,
          result.profile,
        ]),
      ).toEqual([
        ['PF-02', 'representative'],
        ['PF-02', 'stress'],
        ['PF-03', 'representative'],
        ['PF-03', 'stress'],
      ]);
      for (const result of collected.performanceResults as Array<Record<string, unknown>>) {
        expect(result).toMatchObject({
          step: { exitCode: 2, status: 'inconclusive' },
          descriptor: {
            path: expect.stringMatching(/^performance\/descriptors\/pf-0[23]\./),
            digest: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
          fixtureDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          summaryRelativePath: expect.stringMatching(
            /^performance\/PF-0[23]\/(representative|stress)\/summary\.json$/,
          ),
          budgetState: expect.stringContaining('budget-not-frozen'),
          validation: { valid: true },
          budgetValidation: { status: 'not-created' },
          runner: expect.any(Object),
          toolchain: expect.any(Object),
          measurementInputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        expect(result.metrics).toHaveLength(3);
        expect(JSON.stringify(result)).not.toMatch(
          /nested\/secondary|activePath|SYNTHETIC-SECRET-|\/Users\/|file:\/\//,
        );
      }
      expect(TICKET_REGISTRY['FE-01'].performance).toBeDefined();
      expect(TICKET_REGISTRY['FE-01'].performances).toBeUndefined();
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'exit 0/pass 却声明首次 baseline',
      mutate: (
        _summary: ReturnType<typeof readOnlySummary>,
        steps: Array<{ exitCode: number; status: string }>,
      ) => {
        steps[0] = { exitCode: 0, status: 'pass' };
      },
    },
    {
      label: 'evidence validation false',
      mutate: (summary: ReturnType<typeof readOnlySummary>) => {
        summary.validation = { valid: false, violations: ['evidence invalid'] };
      },
    },
    {
      label: 'budget validation false',
      mutate: (summary: ReturnType<typeof readOnlySummary>) => {
        summary.budgetValidation = { valid: false, violations: ['budget invalid'] };
      },
    },
    {
      label: 'metric comparison fail',
      mutate: (
        summary: ReturnType<typeof readOnlySummary>,
        steps: Array<{ exitCode: number; status: string }>,
      ) => {
        summary.status = 'budget-comparison';
        summary.budgetState = 'budget-comparison';
        summary.budgetValidation = {
          valid: true,
          metricBudgets: Object.fromEntries(
            Object.keys(summary.metrics).map((id) => [id, { comparison: 'fail' }]),
          ),
        };
        steps[0] = { exitCode: 0, status: 'pass' };
      },
    },
    {
      label: 'summary status drift',
      mutate: (summary: ReturnType<typeof readOnlySummary>) => {
        summary.status = 'unapproved-status';
      },
    },
    {
      label: 'descriptor digest drift',
      mutate: (summary: ReturnType<typeof readOnlySummary>) => {
        summary.descriptorDigest = 'b'.repeat(64);
      },
    },
    {
      label: 'fixture digest drift',
      mutate: (summary: ReturnType<typeof readOnlySummary>) => {
        summary.fixtureDigest = 'c'.repeat(64);
      },
    },
    {
      label: 'metric id drift',
      mutate: (summary: ReturnType<typeof readOnlySummary>) => {
        const [id, metric] = Object.entries(summary.metrics)[0] ?? [];
        if (id === undefined || metric === undefined) throw new Error('metric fixture missing');
        delete summary.metrics[id];
        summary.metrics['pf02.injected.metric'] = metric;
      },
    },
    {
      label: 'metric sample count drift',
      mutate: (summary: ReturnType<typeof readOnlySummary>) => {
        const [metric] = Object.values(summary.metrics);
        if (metric === undefined) throw new Error('metric fixture missing');
        metric.n += 1;
      },
    },
    {
      label: 'run identity dirty',
      mutate: (summary: ReturnType<typeof readOnlySummary>) => {
        summary.runIdentity.startWorktreeDirty = true;
      },
    },
  ])('$label 必须 generic incomplete，不能成为 manifest 成功 PF evidence', ({ mutate }) => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'acm-pf-read-manifest-invalid-'));
    const performances = TICKET_REGISTRY['FE-02'].performances as PerformanceConfig[];
    const steps = stepResults(performances);
    try {
      for (const [index, config] of performances.entries()) {
        writeCurrentEvidence(
          evidenceRoot,
          config,
          index === 0 ? (summary) => mutate(summary, steps) : undefined,
        );
      }

      const collected = collectReadPfManifestResults({
        performances,
        stepResults: steps,
        evidenceRoot,
        expectedCommit: 'a'.repeat(40),
      });

      expect(collected.incomplete).toBe(true);
      expect(collected.performanceResults[0]).toMatchObject({
        validation: { valid: false },
        budgetState: expect.stringContaining('不完整'),
      });
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });

  it('summary validation/budgetValidation 中的敏感占位或绝对路径只能 generic incomplete，绝不先投影泄漏', () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), 'acm-pf-read-manifest-secret-'));
    const performances = TICKET_REGISTRY['FE-02'].performances as PerformanceConfig[];
    try {
      for (const [index, config] of performances.entries()) {
        writeCurrentEvidence(
          evidenceRoot,
          config,
          index === 0
            ? (summary) => {
                summary.validation = {
                  valid: false,
                  violations: ['SYNTHETIC-SECRET-manifest /Users/example/private'],
                };
                summary.budgetValidation = {
                  valid: false,
                  violations: ['SYNTHETIC-SECRET-budget /Users/example/private'],
                };
              }
            : undefined,
        );
      }
      const collected = collectReadPfManifestResults({
        performances,
        stepResults: stepResults(performances),
        evidenceRoot,
        expectedCommit: 'a'.repeat(40),
      });

      expect(collected.incomplete).toBe(true);
      expect(collected.performanceResults[0]).toMatchObject({ validation: { valid: false } });
      expect(JSON.stringify(collected)).not.toMatch(/SYNTHETIC-SECRET-|\/Users\/example/);
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });

  it.each([
    'samples.json',
    'summary.json',
    'proposed-budgets.json',
    'fixture-attestation.json',
    'l2-dev-module-graph.json',
  ])('current evidence 缺失或 symlink %s 时必须 generic incomplete', (artifactName) => {
    const performances = TICKET_REGISTRY['FE-02'].performances as PerformanceConfig[];
    for (const mode of ['missing', 'symlink'] as const) {
      const evidenceRoot = mkdtempSync(join(tmpdir(), 'acm-pf-read-manifest-artifact-'));
      const external = mkdtempSync(join(tmpdir(), 'acm-pf-read-manifest-external-'));
      try {
        const outputDirs = performances.map((config) => writeCurrentEvidence(evidenceRoot, config));
        const artifactPath = join(outputDirs[0]!, artifactName);
        if (mode === 'missing') {
          rmSync(artifactPath);
        } else {
          const target = join(external, artifactName);
          writeFileSync(target, '{}\n', 'utf8');
          rmSync(artifactPath);
          symlinkSync(target, artifactPath);
        }
        const collected = collectReadPfManifestResults({
          performances,
          stepResults: stepResults(performances),
          evidenceRoot,
          expectedCommit: 'a'.repeat(40),
        });
        expect(collected.incomplete).toBe(true);
        expect(collected.performanceResults[0]).toMatchObject({ validation: { valid: false } });
      } finally {
        rmSync(evidenceRoot, { recursive: true, force: true });
        rmSync(external, { recursive: true, force: true });
      }
    }
  });

  it.each([
    {
      label: 'raw samples 与已存 summary 不一致',
      mutate: (fixture: ReturnType<typeof createFrozenPf02ComparisonFixture>) => {
        const samplesPath = join(fixture.currentProfileDir, 'samples.json');
        const samples = JSON.parse(readFileSync(samplesPath, 'utf8'));
        samples.metrics['pf02.source.open.content_visible'].samples[0] = 999;
        writeFileSync(samplesPath, `${JSON.stringify(samples)}\n`, 'utf8');
      },
    },
    {
      label: '伪造 summary budgetValidation pass',
      mutate: (fixture: ReturnType<typeof createFrozenPf02ComparisonFixture>) => {
        const summaryPath = join(fixture.currentProfileDir, 'summary.json');
        const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
        summary.budgetValidation = { valid: true, violations: [], metricBudgets: {} };
        writeFileSync(summaryPath, `${JSON.stringify(summary)}\n`, 'utf8');
      },
    },
    {
      label: 'current versioned budget 缺失',
      mutate: (fixture: ReturnType<typeof createFrozenPf02ComparisonFixture>) => {
        rmSync(fixture.budgetPath);
      },
    },
    {
      label: 'current versioned budget 阈值篡改',
      mutate: (fixture: ReturnType<typeof createFrozenPf02ComparisonFixture>) => {
        const budget = JSON.parse(readFileSync(fixture.budgetPath, 'utf8'));
        budget.metrics['pf02.source.open.content_visible'].absoluteCeilingMs += 10;
        writeFileSync(fixture.budgetPath, `${JSON.stringify(budget)}\n`, 'utf8');
      },
    },
    {
      label: 'baseline triple SHA 不自洽',
      mutate: (fixture: ReturnType<typeof createFrozenPf02ComparisonFixture>) => {
        const budget = JSON.parse(readFileSync(fixture.budgetPath, 'utf8'));
        budget.baselineProvenance.artifacts['summary.json'] = 'f'.repeat(64);
        writeFileSync(fixture.budgetPath, `${JSON.stringify(budget)}\n`, 'utf8');
      },
    },
    {
      label: 'baseline triple 内容漂移',
      mutate: (fixture: ReturnType<typeof createFrozenPf02ComparisonFixture>) => {
        writeFileSync(join(fixture.baselineDir, 'samples.json'), '{"tampered":true}\n', 'utf8');
      },
    },
  ])('$label 时 exit 0/pass 绝不可成为 manifest valid PASS', ({ mutate }) => {
    const fixture = createFrozenPf02ComparisonFixture();
    const steps = [{ id: 'perf-pf02-representative', exitCode: 0, status: 'pass' }];
    try {
      expect(
        collectReadPfManifestResults({
          performances: [fixture.config],
          stepResults: steps,
          evidenceRoot: fixture.evidenceRoot,
          expectedCommit: 'a'.repeat(40),
          repoRoot: fixture.repoRoot,
        }),
      ).toMatchObject({ incomplete: false });

      mutate(fixture);
      const collected = collectReadPfManifestResults({
        performances: [fixture.config],
        stepResults: steps,
        evidenceRoot: fixture.evidenceRoot,
        expectedCommit: 'a'.repeat(40),
        repoRoot: fixture.repoRoot,
      });
      expect(collected).toMatchObject({ incomplete: true });
      expect(collected.performanceResults[0]).toMatchObject({ validation: { valid: false } });
    } finally {
      rmSync(fixture.repoRoot, { recursive: true, force: true });
    }
  });
});
