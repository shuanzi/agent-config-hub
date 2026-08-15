import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error runtime evidence seam is a plain Node ESM module.
import { evaluateReadPfEvidence, pfReadMeasurementInputDigest, projectReadPfManifestResult, validateReadPfBudget } from '../../scripts/orchestrator/pf-read-evidence.mjs';
// prettier-ignore
// @ts-expect-error runtime measurement input seam is a plain Node ESM module.
import { PF_READ_REQUIRED_L2_MODULES, attestPfReadL2ViteModuleGraph, collectPfReadMeasurementInputs, readPfReadL2ViteModuleGraph } from '../../scripts/orchestrator/pf-read-measurement-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime runner seam is a plain Node ESM module.
import { readPfReadBaselineArtifactDigests, runReadPf } from '../../scripts/orchestrator/perf-read.mjs';

type Profile = 'representative' | 'stress';
type Descriptor = {
  descriptorId: 'PF-02' | 'PF-03';
  profiles: Record<Profile, Record<string, number | string>>;
  metrics: Array<{
    id: string;
    layer: string;
    minSamplesByProfile: Record<Profile, number>;
  }>;
  budgetFormula: {
    absoluteCeilingMs: string;
    regressionAllowance: string;
  };
  digest: { value: string };
  fixture: { profileDigests: Record<Profile, string> };
};

const APPROVED_LIVE_BUDGETS = [
  {
    id: 'PF-02',
    profile: 'representative',
    path: 'performance/budgets/pf-02.representative.budgets.json',
    baselineRun: '.artifacts/performance/PF-02/representative/20260814T153344617Z-p43084-000',
    ceilings: {
      'pf02.source.open.content_visible': 40,
      'pf02.source.scroll.render_stable': 30,
      'pf02.source.readonly_switch.content_visible': 40,
    },
  },
  {
    id: 'PF-02',
    profile: 'stress',
    path: 'performance/budgets/pf-02.stress.budgets.json',
    baselineRun: '.artifacts/performance/PF-02/stress/20260814T153438289Z-p43278-000',
    ceilings: {
      'pf02.source.open.content_visible': 120,
      'pf02.source.scroll.render_stable': 30,
      'pf02.source.readonly_switch.content_visible': 120,
    },
  },
  {
    id: 'PF-03',
    profile: 'representative',
    path: 'performance/budgets/pf-03.representative.budgets.json',
    baselineRun: '.artifacts/performance/PF-03/representative/20260814T153509462Z-p43457-000',
    ceilings: {
      'pf03.multifile.tree.visible': 30,
      'pf03.multifile.text_switch.content_visible': 30,
      'pf03.multifile.nontext_switch.metadata_visible': 30,
    },
  },
  {
    id: 'PF-03',
    profile: 'stress',
    path: 'performance/budgets/pf-03.stress.budgets.json',
    baselineRun: '.artifacts/performance/PF-03/stress/20260814T153618182Z-p43652-000',
    ceilings: {
      'pf03.multifile.tree.visible': 50,
      'pf03.multifile.text_switch.content_visible': 30,
      'pf03.multifile.nontext_switch.metadata_visible': 30,
    },
  },
] as const;

function descriptor(id: Descriptor['descriptorId']): Descriptor {
  return JSON.parse(
    readFileSync(
      resolve(
        id === 'PF-02'
          ? 'performance/descriptors/pf-02.source-large.json'
          : 'performance/descriptors/pf-03.multifile-workbench.json',
      ),
      'utf8',
    ),
  ) as Descriptor;
}

function completeInput(id: Descriptor['descriptorId'], profile: Profile) {
  const spec = descriptor(id);
  const n = spec.metrics[0]?.minSamplesByProfile[profile];
  if (n === undefined) throw new Error('descriptor metric sample contract missing');
  const measurementEntries = [
    { path: 'src/gateway/pf-read-fixtures.ts', sha256: 'c'.repeat(64) },
    { path: 'src/ui/ReadOnlyWorkbench.tsx', sha256: 'd'.repeat(64) },
  ];
  return {
    descriptor: spec,
    descriptorDigest: spec.digest.value,
    profile,
    fixtureDigest: spec.fixture.profileDigests[profile],
    samplesPayload: {
      schemaVersion: 1,
      descriptorId: id,
      profile,
      unit: 'ms',
      metrics: Object.fromEntries(
        spec.metrics.map((metric, index) => [
          metric.id,
          { samples: Array.from({ length: n }, (_, sample) => index + sample + 1) },
        ]),
      ),
    },
    runIdentity: {
      start: { commit: 'a'.repeat(40), worktreeDirty: false },
      end: { commit: 'a'.repeat(40), worktreeDirty: false },
    },
    runtime: {
      runner: {
        node: 'v24.18.0',
        npm: '11.16.0',
        platform: 'darwin',
        release: '25.6.0',
        macosProductVersion: '26.6.1',
        arch: 'arm64',
      },
      toolchain: { rustc: 'rustc 1.97.1', cargo: 'cargo 1.97.1' },
    },
    measurementInputs: {
      schemaVersion: 1,
      algorithm: 'pf-read-measurement-contract-v1',
      digest: pfReadMeasurementInputDigest(measurementEntries),
      entries: measurementEntries,
    },
    budget: undefined,
  };
}

function ownArtifactsDirectory(prefix: string): string {
  const artifactsRoot = resolve('.artifacts');
  mkdirSync(artifactsRoot, { recursive: true });
  return mkdtempSync(join(artifactsRoot, prefix));
}

function safeGraphModulePaths(): string[] {
  return [...PF_READ_REQUIRED_L2_MODULES] as string[];
}

function writeGraph(directory: string, modulePaths: string[]): string {
  const graphPath = join(directory, 'l2-dev-module-graph.json');
  writeFileSync(graphPath, `${JSON.stringify({ schemaVersion: 1, modulePaths })}\n`, 'utf8');
  return graphPath;
}

function utf8ByteSorted(paths: string[]): string[] {
  return [...paths].sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
  );
}

describe('PF-02/PF-03 pure read-only evidence dispatcher', () => {
  it('measurement input digest 对有序 repo-relative entries 稳定可重算，并拒绝重复或不安全路径', () => {
    const entries = [
      { path: 'src/gateway/pf-read-fixtures.ts', sha256: 'c'.repeat(64) },
      { path: 'src/ui/ReadOnlyWorkbench.tsx', sha256: 'd'.repeat(64) },
    ];

    expect(pfReadMeasurementInputDigest(entries)).toMatch(/^[a-f0-9]{64}$/);
    expect(pfReadMeasurementInputDigest([...entries].reverse())).toBe(
      pfReadMeasurementInputDigest(entries),
    );
    expect(() => pfReadMeasurementInputDigest([...entries, entries[0]!])).toThrow();
    expect(() =>
      pfReadMeasurementInputDigest([{ path: '../outside.ts', sha256: 'e'.repeat(64) }]),
    ).toThrow();
  });

  it('measurement paths 以 UTF-8 byte order（非 host locale）canonicalize，并拒绝 NFC/casefold collision', () => {
    const entries = [
      { path: 'src/Älpha.ts', sha256: 'a'.repeat(64) },
      { path: 'src/zeta.ts', sha256: 'b'.repeat(64) },
      { path: 'src/éclair.ts', sha256: 'c'.repeat(64) },
    ];
    const byteSorted = utf8ByteSorted(entries.map((entry) => entry.path));

    expect(byteSorted).toEqual(['src/zeta.ts', 'src/Älpha.ts', 'src/éclair.ts']);
    expect(pfReadMeasurementInputDigest(entries)).toBe(
      pfReadMeasurementInputDigest(
        byteSorted.map((path) => entries.find((entry) => entry.path === path)!),
      ),
    );
    expect(() =>
      pfReadMeasurementInputDigest([
        { path: 'src/Älpha.ts', sha256: 'a'.repeat(64) },
        { path: 'src/älpha.ts', sha256: 'b'.repeat(64) },
      ]),
    ).toThrow();
    expect(() =>
      pfReadMeasurementInputDigest([{ path: 'src/e\u0301clair.ts', sha256: 'c'.repeat(64) }]),
    ).toThrow();
  });

  it.each([
    ['PF-02', 'representative'],
    ['PF-02', 'stress'],
    ['PF-03', 'representative'],
    ['PF-03', 'stress'],
  ] as const)(
    '%s %s 的首次完整 clean 样本只收集 baseline，绝不冻结或写入 versioned budget',
    (id, profile) => {
      const input = completeInput(id, profile);
      const result = evaluateReadPfEvidence(input);

      expect(result.exitCode).toBe(2);
      expect(result.summary).toMatchObject({
        descriptorId: id,
        profile,
        status: 'baseline-collected / budget-not-frozen',
      });
      expect(result.summary.budgetState).toMatch(/budget-not-frozen/);
      expect(result.summary.budgetState).toMatch(/未生成版本化预算/);
      expect(result.summary.budgetValidation).toEqual({ status: 'not-created' });
      expect(result.proposedBudgets).toMatchObject({
        descriptorId: id,
        profile,
        status: 'proposed-not-frozen',
      });
      expect(Object.values(result.summary.metrics)).toHaveLength(3);
      for (const metric of Object.values(result.summary.metrics) as Array<{
        n: number;
        complete: boolean;
        minSamples: number;
        layer: string;
      }>) {
        expect(metric).toMatchObject({
          n: descriptor(id).metrics[0]?.minSamplesByProfile[profile],
          complete: true,
          minSamples: descriptor(id).metrics[0]?.minSamplesByProfile[profile],
          layer: 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
        });
      }
      for (const entry of result.proposedBudgets.budgets as Array<{
        metric: string;
        baseline: { p50: number; p95: number; n: number };
        proposedAbsoluteCeilingMs: number;
        proposedRegressionP50CeilingMs: number;
        proposedRegressionAllowance: { relativeTo: string; maxRatio: number };
      }>) {
        const metric = result.summary.metrics[entry.metric];
        expect(entry.baseline).toEqual({ p50: metric.p50, p95: metric.p95, n: metric.n });
        expect(entry.proposedAbsoluteCeilingMs).toBe(Math.ceil((metric.p95 * 1.5) / 10) * 10);
        expect(entry.proposedRegressionAllowance).toEqual({
          relativeTo: 'baseline-p50',
          maxRatio: 1.25,
        });
        expect(entry.proposedRegressionP50CeilingMs).toBe(entry.baseline.p50 * 1.25);
        expect(entry.baseline.p50 * entry.proposedRegressionAllowance.maxRatio).toBe(
          metric.p50 * 1.25,
        );
      }
      expect(JSON.stringify(result)).not.toMatch(/\bL3\b|\bRSS\b|SYNTHETIC-SECRET-|\/Users\//);
    },
  );

  it('人工 freeze 后四份真实 versioned budget 必须精确绑定批准阈值与 baseline provenance', () => {
    expect(
      APPROVED_LIVE_BUDGETS.filter((config) => !existsSync(config.path)).map(
        (config) => config.path,
      ),
    ).toEqual([]);

    for (const config of APPROVED_LIVE_BUDGETS) {
      const stat = lstatSync(config.path);
      expect(stat.isFile()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);

      const raw = readFileSync(config.path, 'utf8');
      expect(raw).not.toMatch(/SYNTHETIC-SECRET-|\/Users\//);
      const budget = JSON.parse(raw) as Record<string, unknown>;
      const spec = descriptor(config.id);
      const provenance = budget.baselineProvenance as Record<string, unknown>;
      const metrics = budget.metrics as Record<
        string,
        {
          baseline: { p50: number; p95: number; n: number };
          absoluteCeilingMs: number;
          regressionP50CeilingMs: number;
        }
      >;

      expect(Object.keys(budget).sort()).toEqual([
        'baselineProvenance',
        'descriptorDigest',
        'descriptorId',
        'fixtureDigest',
        'formula',
        'measurementInputDigest',
        'metrics',
        'path',
        'profile',
        'schemaVersion',
      ]);
      expect(budget).toMatchObject({
        schemaVersion: 1,
        descriptorId: config.id,
        descriptorDigest: spec.digest.value,
        profile: config.profile,
        fixtureDigest: spec.fixture.profileDigests[config.profile],
        path: config.path,
        formula: spec.budgetFormula,
      });
      expect(budget.measurementInputDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.keys(provenance).sort()).toEqual([
        'artifacts',
        'commit',
        'descriptorDigest',
        'fixtureDigest',
        'measurementInputDigest',
        'run',
        'runner',
        'toolchain',
        'worktreeDirty',
      ]);
      expect(provenance).toMatchObject({
        run: config.baselineRun,
        worktreeDirty: false,
        descriptorDigest: spec.digest.value,
        fixtureDigest: spec.fixture.profileDigests[config.profile],
        measurementInputDigest: budget.measurementInputDigest,
      });
      expect(Object.keys(provenance.artifacts as Record<string, unknown>).sort()).toEqual([
        'proposed-budgets.json',
        'samples.json',
        'summary.json',
      ]);
      for (const artifactDigest of Object.values(provenance.artifacts as Record<string, unknown>)) {
        expect(artifactDigest).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(Object.keys(metrics).sort()).toEqual(Object.keys(config.ceilings).sort());
      for (const [metricId, approvedCeiling] of Object.entries(config.ceilings)) {
        const metric = metrics[metricId];
        expect(metric).toBeDefined();
        expect(Object.keys(metric!).sort()).toEqual([
          'absoluteCeilingMs',
          'baseline',
          'regressionP50CeilingMs',
        ]);
        expect(Object.keys(metric!.baseline).sort()).toEqual(['n', 'p50', 'p95']);
        expect(metric!.baseline.n).toBe(
          spec.metrics.find((candidate) => candidate.id === metricId)?.minSamplesByProfile[
            config.profile
          ],
        );
        expect(metric!.absoluteCeilingMs).toBe(approvedCeiling);
        expect(metric!.absoluteCeilingMs).toBe(Math.ceil((metric!.baseline.p95 * 1.5) / 10) * 10);
        expect(metric!.regressionP50CeilingMs).toBe(metric!.baseline.p50 * 1.25);
      }
    }
  });

  it.each([
    [
      'measurement entries 为空',
      (input: ReturnType<typeof completeInput>) => (input.measurementInputs.entries = []),
    ],
    [
      'measurement entry 不是带 SHA 的 repo-relative file',
      (input: ReturnType<typeof completeInput>) =>
        (input.measurementInputs.entries = [{ path: '/Users/example/input.ts', sha256: 'bad' }]),
    ],
    [
      'measurement entries 非规范排序',
      (input: ReturnType<typeof completeInput>) => input.measurementInputs.entries.reverse(),
    ],
    [
      'measurement digest 未重算匹配 entries',
      (input: ReturnType<typeof completeInput>) =>
        (input.measurementInputs.digest = 'e'.repeat(64)),
    ],
    [
      'samples top-level 含未批准字段',
      (input: ReturnType<typeof completeInput>) =>
        Object.assign(input.samplesPayload, { unexpected: true }),
    ],
    [
      'samples metric 含未批准字段',
      (input: ReturnType<typeof completeInput>) => {
        const [firstMetric] = Object.keys(input.samplesPayload.metrics);
        if (firstMetric === undefined) throw new Error('metric fixture missing');
        Object.assign(input.samplesPayload.metrics[firstMetric], { unexpected: true });
      },
    ],
    [
      'measurement top-level 含未批准字段',
      (input: ReturnType<typeof completeInput>) =>
        Object.assign(input.measurementInputs, { unexpected: true }),
    ],
    [
      'measurement entry 含未批准字段',
      (input: ReturnType<typeof completeInput>) =>
        Object.assign(input.measurementInputs.entries[0]!, { unexpected: true }),
    ],
    [
      'runner 缺少 release',
      (input: ReturnType<typeof completeInput>) => (input.runtime.runner.release = ''),
    ],
    [
      'runner 缺少 macOS 版本',
      (input: ReturnType<typeof completeInput>) => (input.runtime.runner.macosProductVersion = ''),
    ],
    [
      '起止 commit 漂移',
      (input: ReturnType<typeof completeInput>) => (input.runIdentity.end.commit = 'd'.repeat(40)),
    ],
    [
      'worktree dirty',
      (input: ReturnType<typeof completeInput>) => (input.runIdentity.end.worktreeDirty = true),
    ],
    [
      '单项样本不足',
      (input: ReturnType<typeof completeInput>) => {
        const [firstMetric] = Object.keys(input.samplesPayload.metrics);
        if (firstMetric === undefined) throw new Error('metric fixture missing');
        input.samplesPayload.metrics[firstMetric] = { samples: [1] };
      },
    ],
    [
      '单项样本多于冻结 profile 数',
      (input: ReturnType<typeof completeInput>) => {
        const [firstMetric] = Object.keys(input.samplesPayload.metrics);
        if (firstMetric === undefined) throw new Error('metric fixture missing');
        input.samplesPayload.metrics[firstMetric].samples.push(99);
      },
    ],
  ])('%s 必须保持 inconclusive，而不是首次 baseline 成功', (_label, mutate) => {
    const input = completeInput('PF-02', 'representative');
    mutate(input);

    const result = evaluateReadPfEvidence(input);

    expect(result.exitCode).toBe(2);
    expect(result.summary.status).toMatch(/^inconclusive/);
    expect(result.summary.budgetState).not.toMatch(/budget-frozen|baseline-collected/);
  });

  it('只在内存中验证冻结 budget 的精确绑定、两条公式与全部 metric，任何漂移均 fail-closed', () => {
    const input = completeInput('PF-02', 'representative');
    const [firstMetricId] = Object.keys(input.samplesPayload.metrics);
    if (firstMetricId === undefined) throw new Error('metric fixture missing');
    input.samplesPayload.metrics[firstMetricId].samples[10] = 10.246;
    const budgetPath = resolve('performance/budgets/pf-02.representative.budgets.json');
    const budgetBefore = existsSync(budgetPath) ? readFileSync(budgetPath, 'utf8') : undefined;
    const { summary, proposedBudgets } = evaluateReadPfEvidence(input);
    const baselineCommit = 'c'.repeat(40);
    const baselineSummary = JSON.parse(JSON.stringify(summary)) as typeof summary;
    baselineSummary.runIdentity = {
      startCommit: baselineCommit,
      startWorktreeDirty: false,
      endCommit: baselineCommit,
      endWorktreeDirty: false,
      consistent: true,
    };
    const baselineEvidence = {
      samplesPayload: input.samplesPayload,
      summary: baselineSummary,
      proposedBudgets,
    };
    const budget = {
      schemaVersion: 1,
      descriptorId: 'PF-02',
      descriptorDigest: input.descriptorDigest,
      profile: 'representative',
      fixtureDigest: input.fixtureDigest,
      measurementInputDigest: input.measurementInputs.digest,
      path: 'performance/budgets/pf-02.representative.budgets.json',
      formula: descriptor('PF-02').budgetFormula,
      baselineProvenance: {
        run: '.artifacts/performance/PF-02/baseline-from-another-clean-commit',
        commit: baselineCommit,
        worktreeDirty: false,
        runner: input.runtime.runner,
        toolchain: input.runtime.toolchain,
        descriptorDigest: input.descriptorDigest,
        fixtureDigest: input.fixtureDigest,
        measurementInputDigest: input.measurementInputs.digest,
        artifacts: {
          'samples.json': '1'.repeat(64),
          'summary.json': '2'.repeat(64),
          'proposed-budgets.json': '3'.repeat(64),
        },
      },
      metrics: Object.fromEntries(
        Object.entries(
          summary.metrics as Record<string, { p50: number; p95: number; n: number }>,
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
    const validate = (
      candidate: typeof budget,
      runtime = input.runtime,
      baselineArtifactDigests = candidate.baselineProvenance.artifacts,
      candidateBaselineEvidence = baselineEvidence,
    ) =>
      validateReadPfBudget({
        budget: candidate,
        descriptor: input.descriptor,
        descriptorDigest: input.descriptorDigest,
        profile: input.profile,
        fixtureDigest: input.fixtureDigest,
        metrics: summary.metrics,
        measurementInputs: input.measurementInputs,
        runtime,
        baselineArtifactDigests,
        baselineEvidence: candidateBaselineEvidence,
      });

    expect(validate(budget)).toMatchObject({ valid: true, violations: [] });
    expect(budget.baselineProvenance.commit).not.toBe(input.runIdentity.start.commit);
    const fractionalP50 = budget.metrics[firstMetricId].baseline.p50;
    expect(fractionalP50).toBe(10.123);
    expect(budget.metrics[firstMetricId].regressionP50CeilingMs).toBe(fractionalP50 * 1.25);
    const roundedThreshold = JSON.parse(JSON.stringify(budget)) as typeof budget;
    roundedThreshold.metrics[firstMetricId].regressionP50CeilingMs = Number(
      (fractionalP50 * 1.25).toFixed(3),
    );
    expect(validate(roundedThreshold)).toMatchObject({
      valid: false,
      violations: expect.any(Array),
    });
    expect(
      validate(budget, {
        ...input.runtime,
        runner: { ...input.runtime.runner, node: 'v25.0.0' },
      }),
    ).toMatchObject({ valid: false, violations: expect.any(Array) });
    expect(
      validate(budget, input.runtime, {
        ...budget.baselineProvenance.artifacts,
        'summary.json': 'f'.repeat(64),
      }),
    ).toMatchObject({ valid: false, violations: expect.any(Array) });
    for (const mutate of [
      (candidate: typeof budget) => (candidate.descriptorDigest = 'd'.repeat(64)),
      (candidate: typeof budget) => (candidate.profile = 'stress'),
      (candidate: typeof budget) => (candidate.fixtureDigest = 'e'.repeat(64)),
      (candidate: typeof budget) => (candidate.measurementInputDigest = 'f'.repeat(64)),
      (candidate: typeof budget) => (candidate.baselineProvenance.runner.node = 'v25.0.0'),
      (candidate: typeof budget) =>
        (candidate.baselineProvenance.runner.macosProductVersion = '99.0.0'),
      (candidate: typeof budget) => (candidate.baselineProvenance.toolchain.rustc = 'rustc 99.0.0'),
      (candidate: typeof budget) =>
        (candidate.baselineProvenance.measurementInputDigest = '1'.repeat(64)),
      (candidate: typeof budget) =>
        Reflect.deleteProperty(candidate.baselineProvenance.artifacts, 'samples.json'),
      (candidate: typeof budget) =>
        (candidate.baselineProvenance.artifacts['summary.json'] = 'bad'),
      (candidate: typeof budget) => {
        const [first] = Object.keys(candidate.metrics);
        if (first === undefined) throw new Error('metric budget fixture missing');
        candidate.metrics[first].absoluteCeilingMs += 10;
      },
      (candidate: typeof budget) => {
        const [first] = Object.keys(candidate.metrics);
        if (first === undefined) throw new Error('metric budget fixture missing');
        candidate.metrics[first].regressionP50CeilingMs += 1;
      },
    ]) {
      const candidate = JSON.parse(JSON.stringify(budget)) as typeof budget;
      mutate(candidate);
      expect(validate(candidate)).toMatchObject({ valid: false, violations: expect.any(Array) });
      expect(validate(candidate).violations.length).toBeGreaterThan(0);
    }
    expect(existsSync(budgetPath) ? readFileSync(budgetPath, 'utf8') : undefined).toBe(
      budgetBefore,
    );
  });

  it('只将脱敏的 PF-03 stress metadata 投影为 manifest result，不写 activePath、内容或绝对路径', () => {
    const input = completeInput('PF-03', 'stress');
    const { summary } = evaluateReadPfEvidence(input);
    const projected = projectReadPfManifestResult({
      config: {
        descriptorId: 'PF-03',
        profile: 'stress',
        descriptorPath: 'performance/descriptors/pf-03.multifile-workbench.json',
        budgetPath: 'performance/budgets/pf-03.stress.budgets.json',
        evidenceRelativeDir: 'performance/PF-03/stress',
      },
      step: { id: 'perf-pf03-stress', exitCode: 2, status: 'inconclusive' },
      summary,
      summaryRelativePath: 'performance/PF-03/stress/summary.json',
    });

    expect(projected).toMatchObject({
      pfId: 'PF-03',
      profile: 'stress',
      step: { id: 'perf-pf03-stress', exitCode: 2, status: 'inconclusive' },
      descriptor: {
        path: 'performance/descriptors/pf-03.multifile-workbench.json',
        digest: input.descriptorDigest,
      },
      fixtureDigest: input.fixtureDigest,
      summaryRelativePath: 'performance/PF-03/stress/summary.json',
      budgetState: expect.stringContaining('budget-not-frozen'),
      validation: expect.anything(),
      runner: input.runtime.runner,
      toolchain: input.runtime.toolchain,
      measurementInputDigest: input.measurementInputs.digest,
      budgetValidation: { status: 'not-created' },
    });
    expect(projected.metrics).toEqual(
      descriptor('PF-03').metrics.map((metric) => ({
        id: metric.id,
        sampleCount: metric.minSamplesByProfile.stress,
        layer: metric.layer,
      })),
    );
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toMatch(
      /deep\/nested\/secondary\/readme\.md|SYNTHETIC-SECRET-|\/Users\/|file:\/\//,
    );
    const project = (candidateSummary: typeof summary, summaryRelativePath: string) =>
      projectReadPfManifestResult({
        config: {
          descriptorId: 'PF-03',
          profile: 'stress',
          descriptorPath: 'performance/descriptors/pf-03.multifile-workbench.json',
          budgetPath: 'performance/budgets/pf-03.stress.budgets.json',
          evidenceRelativeDir: 'performance/PF-03/stress',
        },
        step: { id: 'perf-pf03-stress', exitCode: 2, status: 'inconclusive' },
        summary: candidateSummary,
        summaryRelativePath,
      });
    for (const invalidPath of [
      '/Users/example/summary.json',
      '',
      'performance/PF-03/./stress/summary.json',
      'performance/PF-03//stress/summary.json',
      'performance/PF-03/\u0000stress/summary.json',
    ]) {
      expect(() => project(summary, invalidPath)).toThrow();
    }
    const invalidSummaries = [
      (candidate: typeof summary) => (candidate.descriptorDigest = 'not-a-sha256'),
      (candidate: typeof summary) => (candidate.fixtureDigest = 'not-a-sha256'),
      (candidate: typeof summary) => (candidate.runner.node = ''),
      (candidate: typeof summary) => {
        candidate.metrics['pf03.unapproved.metric'] = {
          n: 10,
          complete: true,
          minSamples: 10,
          layer: 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
        };
      },
    ];
    for (const mutate of invalidSummaries) {
      const candidate = JSON.parse(JSON.stringify(summary)) as typeof summary;
      mutate(candidate);
      expect(() => project(candidate, 'performance/PF-03/stress/summary.json')).toThrow();
    }
  });
});

describe('PF-02/PF-03 actual L2 Vite graph and measurement-input attestation', () => {
  it('只接受完整、物理且 canonical 的 actual graph，并将其与静态 measurement method 精确并集哈希', () => {
    const directory = ownArtifactsDirectory('acm-pf-read-measurement-');
    try {
      const graph = attestPfReadL2ViteModuleGraph({
        moduleIds: safeGraphModulePaths().map((modulePath) => resolve(modulePath)),
      });
      expect(graph).toEqual({
        schemaVersion: 1,
        modulePaths: utf8ByteSorted(safeGraphModulePaths()),
      });

      const graphPath = writeGraph(directory, graph.modulePaths);
      const inputs = collectPfReadMeasurementInputs({
        graphPath,
        descriptorPath: 'performance/descriptors/pf-02.source-large.json',
      });
      expect(inputs.entries.map((entry: { path: string }) => entry.path)).toEqual(
        expect.arrayContaining([
          ...safeGraphModulePaths(),
          'package.json',
          'package-lock.json',
          'performance/wdio.read.conf.ts',
          'performance/pf-read.collector.test.ts',
          'scripts/orchestrator/perf.mjs',
          'scripts/orchestrator/perf-read.mjs',
          'scripts/orchestrator/pf-read-evidence.mjs',
          'performance/descriptors/pf-02.source-large.json',
        ]),
      );
      expect(inputs.entries.map((entry: { path: string }) => entry.path)).toEqual(
        utf8ByteSorted(inputs.entries.map((entry: { path: string }) => entry.path)),
      );
      expect(inputs.digest).toBe(
        pfReadMeasurementInputDigest(inputs.entries as Array<{ path: string; sha256: string }>),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('对缺失、乱序、absolute、virtual 及 symlink graph/path 全部 fail-closed；额外物理 repo module 计入 digest', () => {
    const directory = ownArtifactsDirectory('acm-pf-read-measurement-negative-');
    const required = safeGraphModulePaths();
    try {
      expect(() =>
        attestPfReadL2ViteModuleGraph({
          moduleIds: required.slice(1).map((modulePath) => resolve(modulePath)),
        }),
      ).toThrow();
      expect(() =>
        attestPfReadL2ViteModuleGraph({
          moduleIds: [...required, 'virtual:injected'].map((modulePath) =>
            modulePath.startsWith('virtual:') ? modulePath : resolve(modulePath),
          ),
        }),
      ).toThrow();
      const baselineGraph = attestPfReadL2ViteModuleGraph({
        moduleIds: required.map((modulePath) => resolve(modulePath)),
      });
      const graphWithPhysicalExtra = attestPfReadL2ViteModuleGraph({
        moduleIds: [...required, 'src/contract/types.ts'].map((modulePath) => resolve(modulePath)),
      });
      expect(graphWithPhysicalExtra.modulePaths).toContain('src/contract/types.ts');
      const baselineInputs = collectPfReadMeasurementInputs({
        graphPath: writeGraph(directory, baselineGraph.modulePaths),
        descriptorPath: 'performance/descriptors/pf-02.source-large.json',
      });
      const extraInputs = collectPfReadMeasurementInputs({
        graphPath: writeGraph(directory, graphWithPhysicalExtra.modulePaths),
        descriptorPath: 'performance/descriptors/pf-02.source-large.json',
      });
      expect(extraInputs.digest).not.toBe(baselineInputs.digest);

      expect(() =>
        readPfReadL2ViteModuleGraph({
          graphPath: writeGraph(directory, [...required].reverse()),
        }),
      ).toThrow();
      expect(() =>
        readPfReadL2ViteModuleGraph({
          graphPath: writeGraph(directory, [...required, '/private/tmp/outside.ts']),
        }),
      ).toThrow();

      const physicalGraph = writeGraph(directory, required);
      const symlinkGraph = join(directory, 'graph-link.json');
      symlinkSync(physicalGraph, symlinkGraph);
      expect(() => readPfReadL2ViteModuleGraph({ graphPath: symlinkGraph })).toThrow();

      const external = mkdtempSync(join(tmpdir(), 'acm-pf-read-module-escape-'));
      const moduleSymlink = join(directory, 'escape.ts');
      try {
        writeFileSync(join(external, 'escape.ts'), 'export {};\n', 'utf8');
        symlinkSync(join(external, 'escape.ts'), moduleSymlink);
        expect(() =>
          readPfReadL2ViteModuleGraph({
            graphPath: writeGraph(directory, [...required, relative(resolve(), moduleSymlink)]),
          }),
        ).toThrow();
      } finally {
        rmSync(external, { recursive: true, force: true });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persisted graph 以 UTF-8 byte order 接受物理 Unicode module，并拒绝 NFC/casefold collision', () => {
    const directory = ownArtifactsDirectory('acm-pf-read-graph-unicode-');
    const required = safeGraphModulePaths();
    try {
      const unicodeModule = join(directory, 'Älpha.ts');
      writeFileSync(unicodeModule, 'export {};\n', 'utf8');
      const unicodeRelativePath = relative(resolve(), unicodeModule).split('/').join('/');
      const ordered = utf8ByteSorted([...required, unicodeRelativePath]);
      expect(() =>
        readPfReadL2ViteModuleGraph({ graphPath: writeGraph(directory, ordered) }),
      ).not.toThrow();

      expect(() =>
        readPfReadL2ViteModuleGraph({
          graphPath: writeGraph(
            directory,
            utf8ByteSorted([...required, 'src/Älpha.ts', 'src/älpha.ts']),
          ),
        }),
      ).toThrow();
      expect(() =>
        readPfReadL2ViteModuleGraph({
          graphPath: writeGraph(directory, utf8ByteSorted([...required, 'src/e\u0301clair.ts'])),
        }),
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('PF-02/PF-03 read runner physical evidence boundaries', () => {
  it('预存非空 leaf、target symlink 和 parent symlink escape 均 exit 2 且不写入', async () => {
    const directory = ownArtifactsDirectory('acm-pf-read-output-negative-');
    const external = mkdtempSync(join(tmpdir(), 'acm-pf-read-output-escape-'));
    try {
      const occupied = join(directory, 'occupied');
      mkdirSync(occupied);
      writeFileSync(join(occupied, 'sentinel.txt'), 'keep\n', 'utf8');
      expect(await runReadPf(['PF-02', `--output-dir=${occupied}`])).toEqual({ exitCode: 2 });
      expect(readFileSync(join(occupied, 'sentinel.txt'), 'utf8')).toBe('keep\n');

      const target = join(directory, 'target');
      mkdirSync(target);
      const targetLink = join(directory, 'target-link');
      symlinkSync(target, targetLink);
      expect(await runReadPf(['PF-02', `--output-dir=${targetLink}`])).toEqual({ exitCode: 2 });
      expect(readdirSync(target)).toEqual([]);

      const parentLink = join(directory, 'parent-link');
      symlinkSync(external, parentLink);
      expect(await runReadPf(['PF-02', `--output-dir=${join(parentLink, 'leaf')}`])).toEqual({
        exitCode: 2,
      });
      expect(readdirSync(external)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it('baseline parent symlink 或任一 required artifact symlink/escape 都使 budget 物理重算失效', () => {
    const directory = ownArtifactsDirectory('acm-pf-read-baseline-negative-');
    const external = mkdtempSync(join(tmpdir(), 'acm-pf-read-baseline-escape-'));
    const artifacts = ['samples.json', 'summary.json', 'proposed-budgets.json'] as const;
    const budgetFor = (baseline: string) => ({
      baselineProvenance: { run: relative(resolve(), baseline).split('/').join('/') },
    });
    try {
      const physicalBaseline = join(directory, 'physical');
      mkdirSync(physicalBaseline);
      for (const name of artifacts) writeFileSync(join(physicalBaseline, name), '{}\n', 'utf8');
      expect(readPfReadBaselineArtifactDigests(budgetFor(physicalBaseline)).digests).toEqual(
        expect.objectContaining({
          'samples.json': expect.stringMatching(/^[a-f0-9]{64}$/),
          'summary.json': expect.stringMatching(/^[a-f0-9]{64}$/),
          'proposed-budgets.json': expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );

      const parentLink = join(directory, 'parent-link');
      symlinkSync(physicalBaseline, parentLink);
      expect(() => readPfReadBaselineArtifactDigests(budgetFor(parentLink))).toThrow();

      for (const artifactName of artifacts) {
        const baseline = join(directory, `symlink-${artifactName}`);
        mkdirSync(baseline);
        for (const name of artifacts) writeFileSync(join(baseline, name), '{}\n', 'utf8');
        const escapedArtifact = join(external, artifactName);
        writeFileSync(escapedArtifact, 'outside\n', 'utf8');
        rmSync(join(baseline, artifactName));
        symlinkSync(escapedArtifact, join(baseline, artifactName));
        expect(() => readPfReadBaselineArtifactDigests(budgetFor(baseline))).toThrow();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });
});
