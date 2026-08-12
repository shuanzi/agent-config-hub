import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error ticket-specific automatic-pass validator is a plain Node ESM module.
import { createFe01Pf01AutomaticPassRecord, validateFe01Pf01AutomaticPassCurrentBinding, writeFe01Pf01AutomaticPassRecord } from '../../scripts/orchestrator/fe01-pf01-automatic-pass.mjs';
// prettier-ignore
// @ts-expect-error runtime PF provenance helper is a plain Node ESM module.
import { collectPf01L3HarnessBuildInputsFromGit, computePf01L3HarnessBuildInputsDigest, PF01_L3_BUILD_INPUT_PATHS, PF01_L3_BUILD_INPUTS } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime build-environment helper is a plain Node ESM module.
import { PF01_BUILD_ENVIRONMENT } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime PF provenance helper is a plain Node ESM module.
import { collectPf01MeasurementInputsFromGit, computePf01MeasurementInputsDigest, expectedPf01L2ViteDevModuleGraph, PF01_MEASUREMENT_INPUT_PATHS, PF01_MEASUREMENT_INPUTS } from '../../scripts/orchestrator/pf01-measurement-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime PF provenance helper is a plain Node ESM module.
import { PF01_BUDGET_CONSTANTS } from '../../scripts/orchestrator/pf01-budget.mjs';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const comparisonCommit = 'a'.repeat(40);
const baselineCommit = 'b'.repeat(40);
const buildEntries = PF01_L3_BUILD_INPUT_PATHS.map((path: string, index: number) => ({
  path,
  sha256: (index + 2).toString(16).padStart(64, '0'),
}));
const buildInputs = {
  schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
  algorithm: PF01_L3_BUILD_INPUTS.algorithm,
  digest: computePf01L3HarnessBuildInputsDigest({
    schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
    algorithm: PF01_L3_BUILD_INPUTS.algorithm,
    entries: buildEntries,
  }),
  entries: buildEntries,
  source: {
    kind: 'clean-tracked-checkout',
    method: PF01_L3_BUILD_INPUTS.method,
    commit: comparisonCommit,
  },
};
const l2DevModuleGraph = expectedPf01L2ViteDevModuleGraph();
const measurementEntries = PF01_MEASUREMENT_INPUT_PATHS.map((path: string, index: number) => ({
  path,
  sha256: (index + 3).toString(16).padStart(64, '0'),
}));
const measurementInputs = {
  schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
  algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
  digest: computePf01MeasurementInputsDigest({
    schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
    algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
    entries: measurementEntries,
    l2DevModuleGraph,
  }),
  entries: measurementEntries,
  source: {
    kind: 'clean-tracked-checkout',
    method: PF01_MEASUREMENT_INPUTS.method,
    commit: comparisonCommit,
  },
  l2DevModuleGraph,
};
const current = {
  budget: { path: 'performance/budgets/pf-01.budgets.json', sha256: '5'.repeat(64) },
  descriptor: { path: 'performance/descriptors/pf-01.catalog-browse.json', digest: '6'.repeat(64) },
  fixture: { path: 'fixtures/fx-01/native-root', sha256: '7'.repeat(64) },
  artifact: {
    identityPath: '.artifacts/test-harness/identity.json',
    kind: 'test-harness',
    identifier: 'io.github.shuanzi.agent-config-manager.test-harness',
    profile: 'debug',
    binary: 'src-tauri/target/debug/agent-config-manager',
    declaredBinarySha256: '8'.repeat(64),
    actualBinarySha256: '8'.repeat(64),
    provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
  },
  buildInputs,
  measurementInputs,
  runner: {
    node: 'v24.18.0',
    npm: '11.16.0',
    platform: 'darwin',
    release: '25.6.0',
    macosProductVersion: '26.6.1',
    arch: 'arm64',
  },
  toolchain: { cargo: 'cargo 1.97.1', rustc: 'rustc 1.97.1' },
  buildEnvironment: { ...PF01_BUILD_ENVIRONMENT, overrides: [] as string[] },
};
const record = {
  schemaVersion: 2,
  kind: 'fe-01-pf-01-automatic-pass',
  ticket: 'FE-01',
  performance: 'PF-01',
  comparison: {
    runId: '20260811T130000000Z-p1-000',
    run: '.artifacts/performance/PF-01/20260811T130000000Z-p1-000',
    commit: comparisonCommit,
    worktreeDirty: false,
    status: 'pass',
    exitCode: 0,
  },
  budget: clone(current.budget),
  descriptor: clone(current.descriptor),
  current: {
    artifact: clone(current.artifact),
    fixture: clone(current.fixture),
    buildInputs: clone(current.buildInputs),
    measurementInputs: clone(current.measurementInputs),
    runner: clone(current.runner),
    toolchain: clone(current.toolchain),
    buildEnvironment: clone(current.buildEnvironment),
  },
  artifactSha256: { 'summary.json': '9'.repeat(64) },
};

function validComparisonInputs() {
  const commit = comparisonCommit;
  const currentAtComparison = clone(current);
  currentAtComparison.buildInputs.source.commit = commit;
  currentAtComparison.measurementInputs.source.commit = commit;
  const l2Raw = Object.fromEntries(
    [
      'pf01.startup.first_list_visible',
      'pf01.search.results_visible',
      'pf01.filter.results_visible',
      'pf01.select.skill_cells_visible',
    ].map((metric) => [
      metric,
      { samples: Array(PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric]).fill(1) },
    ]),
  );
  const l3Raw = {
    'pf01.l3.cold_start.first_snapshot': {
      samples: Array(
        PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS['pf01.l3.cold_start.first_snapshot'],
      ).fill(1),
    },
  };
  const metrics = Object.fromEntries(
    [...Object.keys(l2Raw), 'pf01.l3.cold_start.first_snapshot'].map((metric) => [
      metric,
      {
        n: PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric],
        min: 1,
        max: 1,
        p50: 1,
        p95: 1,
        minSamples: PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric],
        complete: true,
        unit: 'ms',
        layer:
          metric === 'pf01.l3.cold_start.first_snapshot'
            ? PF01_BUDGET_CONSTANTS.L3_LAYER
            : PF01_BUDGET_CONSTANTS.L2_LAYER,
      },
    ]),
  );
  const resourceRuns = {
    schemaVersion: 1,
    metric: 'pf01.l3.peak_rss_bytes',
    runs: [
      { harnessPid: 1, normalExit: true, samples: [100] },
      { harnessPid: 2, normalExit: true, samples: [120] },
      { harnessPid: 3, normalExit: true, samples: [110] },
    ],
  };
  const baselineBuildInputs = {
    ...clone(currentAtComparison.buildInputs),
    source: {
      ...currentAtComparison.buildInputs.source,
      kind: 'git-object-tree',
      commit: baselineCommit,
    },
  };
  const baselineMeasurementInputs = {
    ...clone(currentAtComparison.measurementInputs),
    source: {
      ...currentAtComparison.measurementInputs.source,
      kind: 'git-object-tree',
      commit: baselineCommit,
    },
  };
  const budget = {
    schemaVersion: 4,
    descriptorId: 'PF-01',
    descriptorDigest: '',
    profile: 'representative',
    formula: {
      absoluteCeilingMs: PF01_BUDGET_CONSTANTS.ABSOLUTE_FORMULA,
      regressionAllowance: PF01_BUDGET_CONSTANTS.REGRESSION_FORMULA,
    },
    baselineProvenance: {
      run: '.artifacts/performance/PF-01/20260811T120000000Z-p1-000',
      collectedAt: '2026-08-11T12:00:00.000Z',
      statusBeforeBudgetFreeze: 'baseline-collected / budget-not-frozen',
      commit: baselineCommit,
      worktreeDirty: false,
      artifact: clone(currentAtComparison.artifact),
      runner: clone(currentAtComparison.runner),
      toolchain: clone(currentAtComparison.toolchain),
      fixture: clone(currentAtComparison.fixture),
      buildInputs: baselineBuildInputs,
      measurementInputs: baselineMeasurementInputs,
      resources: {
        metric: 'pf01.l3.peak_rss_bytes',
        layer: PF01_BUDGET_CONSTANTS.L3_LAYER,
        sampling: PF01_BUDGET_CONSTANTS.RESOURCE_SAMPLING,
        rawPeaksBytes: [100, 120, 110],
        maxBytes: 120,
      },
    },
    budgets: Object.keys(metrics).map((metric) => ({
      metric,
      layer:
        metric === 'pf01.l3.cold_start.first_snapshot'
          ? PF01_BUDGET_CONSTANTS.L3_LAYER
          : PF01_BUDGET_CONSTANTS.L2_LAYER,
      absoluteCeilingMs: 10,
      baseline: {
        p50: 1,
        p95: 1,
        n: PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric],
      },
      regressionAllowance: { relativeTo: 'baseline-p50', maxRatio: 1.25 },
    })),
  };
  const descriptorWithoutDigest = '{\n  "descriptorId": "PF-01",\n  "digest": { "value": "" }\n}\n';
  const digest = createHash('sha256').update(descriptorWithoutDigest, 'utf8').digest('hex');
  const descriptorText = descriptorWithoutDigest.replace('"value": ""', `"value": "${digest}"`);
  budget.descriptorDigest = digest;
  const artifacts = {
    'harness-identity.json': { schemaVersion: 1, artifact: clone(currentAtComparison.artifact) },
    'l2-dev-module-graph.json': clone(l2DevModuleGraph),
    'l3-resource-runs.json': resourceRuns,
    'l3-samples.json': {
      schemaVersion: 1,
      descriptorId: 'PF-01',
      layer: 'L3 test-harness debug（非 release-like artifact）',
      collectedAt: '2026-08-11T13:00:00.000Z',
      unit: 'ms',
      metrics: l3Raw,
    },
    'proposed-budgets.json': {
      schemaVersion: 1,
      descriptorId: 'PF-01',
      status: 'proposed-not-frozen',
    },
    'samples.json': {
      schemaVersion: 1,
      descriptorId: 'PF-01',
      profile: 'representative',
      collectedAt: '2026-08-11T13:00:00.000Z',
      unit: 'ms',
      metrics: l2Raw,
    },
    'summary.json': undefined as unknown,
  };
  const summary = {
    schemaVersion: 1,
    descriptorId: 'PF-01',
    descriptorDigest: digest,
    profile: 'representative',
    status: 'budget-comparison',
    budgetState: 'budget-frozen（performance/budgets/pf-01.budgets.json）',
    budgetValidation: { valid: true, violations: [] },
    automatedResult: { schemaVersion: 1, status: 'pass', exitCode: 0 },
    contamination: { schemaVersion: 1, syntheticSecretHits: 0, personalPathHits: 0 },
    runIdentity: {
      startCommit: commit,
      startWorktreeDirty: false,
      endCommit: commit,
      endWorktreeDirty: false,
      consistent: true,
    },
    comparisonProvenance: { current: currentAtComparison },
    metrics,
    resources: {
      status: 'collected',
      metric: 'pf01.l3.peak_rss_bytes',
      layer: PF01_BUDGET_CONSTANTS.L3_LAYER,
      sampling: {
        process: 'agent-config-manager harness PID and descendants only',
        intervalMs: 50,
        window: 'successful process start to normal exit',
      },
      rawPeakBytes: [100, 120, 110],
      maxBytes: 120,
    },
    collectedAt: '2026-08-11T13:00:00.000Z',
  };
  artifacts['summary.json'] = summary;
  const artifactTexts = Object.fromEntries(
    Object.entries(artifacts).map(([file, payload]) => [file, JSON.stringify(payload)]),
  );
  const artifactSha256 = Object.fromEntries(
    Object.entries(artifactTexts).map(([file, text]) => [
      file,
      createHash('sha256').update(text).digest('hex'),
    ]),
  );
  return {
    comparison: {
      runId: '20260811T130000000Z-p1-000',
      run: '.artifacts/performance/PF-01/20260811T130000000Z-p1-000',
      commit,
      worktreeDirty: false,
      status: 'pass',
      exitCode: 0,
    },
    artifactSha256,
    budgetText: JSON.stringify(budget),
    descriptorText,
    summary,
    artifacts,
    artifactTexts,
  };
}

function runGit(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function gitFixtureDigest(root: string, commit: string) {
  const listed = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', commit], {
    cwd: root,
    encoding: 'buffer',
  });
  if (listed.status !== 0) throw new Error(String(listed.stderr));
  const digest: Record<string, string> = {};
  for (const pathname of listed.stdout
    .toString('utf8')
    .split('\0')
    .filter((value) => value.startsWith('fixtures/fx-01/native-root/'))) {
    const content = spawnSync('git', ['show', `${commit}:${pathname}`], {
      cwd: root,
      encoding: 'buffer',
    });
    if (content.status !== 0) throw new Error(String(content.stderr));
    digest[pathname.slice('fixtures/fx-01/native-root/'.length)] = createHash('sha256')
      .update(content.stdout)
      .digest('hex');
  }
  return createHash('sha256').update(JSON.stringify(digest)).digest('hex');
}

function writeImmutableComparisonFixture(root: string) {
  const inputs = validComparisonInputs();
  for (const pathname of new Set([...PF01_L3_BUILD_INPUT_PATHS, ...PF01_MEASUREMENT_INPUT_PATHS])) {
    const target = join(root, pathname);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `fixture ${pathname}\n`);
  }
  mkdirSync(join(root, 'performance', 'budgets'), { recursive: true });
  mkdirSync(join(root, 'performance', 'descriptors'), { recursive: true });
  writeFileSync(join(root, 'performance', 'budgets', 'pf-01.budgets.json'), inputs.budgetText);
  writeFileSync(
    join(root, 'performance', 'descriptors', 'pf-01.catalog-browse.json'),
    inputs.descriptorText,
  );
  writeFileSync(join(root, '.gitignore'), '.artifacts/\nperformance/automatic-passes/\n');
  runGit(root, ['init']);
  runGit(root, ['add', '.']);
  runGit(root, [
    '-c',
    'user.name=PF test',
    '-c',
    'user.email=pf@example.test',
    'commit',
    '-m',
    'fixture',
  ]);
  const initialCommit = runGit(root, ['rev-parse', 'HEAD']);
  const buildInputs = collectPf01L3HarnessBuildInputsFromGit({
    repoRoot: root,
    commit: initialCommit,
  });
  const measurementInputs = collectPf01MeasurementInputsFromGit({
    repoRoot: root,
    commit: initialCommit,
    l2DevModuleGraph,
  });
  const budget = JSON.parse(inputs.budgetText) as {
    baselineProvenance: { buildInputs: unknown; measurementInputs: unknown; fixture: unknown };
  };
  budget.baselineProvenance.buildInputs = {
    ...buildInputs,
    source: { ...buildInputs.source, kind: 'git-object-tree', commit: baselineCommit },
  };
  budget.baselineProvenance.measurementInputs = {
    ...measurementInputs,
    source: { ...measurementInputs.source, kind: 'git-object-tree', commit: baselineCommit },
  };
  budget.baselineProvenance.fixture = {
    path: 'fixtures/fx-01/native-root',
    sha256: gitFixtureDigest(root, initialCommit),
  };
  inputs.budgetText = JSON.stringify(budget);
  writeFileSync(join(root, 'performance', 'budgets', 'pf-01.budgets.json'), inputs.budgetText);
  runGit(root, ['add', 'performance/budgets/pf-01.budgets.json']);
  runGit(root, [
    '-c',
    'user.name=PF test',
    '-c',
    'user.email=pf@example.test',
    'commit',
    '--amend',
    '--no-edit',
  ]);

  const commit = runGit(root, ['rev-parse', 'HEAD']);
  const finalBuildInputs = collectPf01L3HarnessBuildInputsFromGit({ repoRoot: root, commit });
  const finalMeasurementInputs = collectPf01MeasurementInputsFromGit({
    repoRoot: root,
    commit,
    l2DevModuleGraph,
  });
  const current = inputs.summary.comparisonProvenance.current;
  current.buildInputs = {
    ...finalBuildInputs,
    source: { ...finalBuildInputs.source, kind: 'clean-tracked-checkout', commit },
  };
  current.measurementInputs = {
    ...finalMeasurementInputs,
    source: { ...finalMeasurementInputs.source, kind: 'clean-tracked-checkout', commit },
  };
  current.fixture = { path: 'fixtures/fx-01/native-root', sha256: gitFixtureDigest(root, commit) };
  inputs.comparison.commit = commit;
  inputs.summary.runIdentity.startCommit = commit;
  inputs.summary.runIdentity.endCommit = commit;
  inputs.artifacts['harness-identity.json'] = { schemaVersion: 1, artifact: current.artifact };
  inputs.artifacts['summary.json'] = inputs.summary;

  const runDirectory = join(root, inputs.comparison.run);
  mkdirSync(runDirectory, { recursive: true });
  for (const [artifact, payload] of Object.entries(inputs.artifacts)) {
    writeFileSync(join(runDirectory, artifact), JSON.stringify(payload));
  }
  return inputs;
}

type ImmutableComparisonFailure = {
  name: string;
  mutate: (root: string, inputs: ReturnType<typeof validComparisonInputs>) => void;
};

const immutableComparisonFailures: readonly ImmutableComparisonFailure[] = [
  {
    name: 'rss',
    mutate: (root, inputs) =>
      writeFileSync(
        join(root, inputs.comparison.run, 'l3-resource-runs.json'),
        JSON.stringify({ runs: [{ harnessPid: null, normalExit: false, samples: [] }] }),
      ),
  },
  {
    name: 'raw-timing',
    mutate: (root, inputs) =>
      writeFileSync(
        join(root, inputs.comparison.run, 'samples.json'),
        JSON.stringify({ metrics: { 'pf01.search.results_visible': { samples: [1] } } }),
      ),
  },
  {
    name: 'contamination',
    mutate: (root, inputs) =>
      writeFileSync(
        join(root, inputs.comparison.run, 'proposed-budgets.json'),
        JSON.stringify({ note: 'SYNTHETIC-SECRET-automatic-pass' }),
      ),
  },
  {
    name: 'automated-result',
    mutate: (root, inputs) => {
      const summaryPath = join(root, inputs.comparison.run, 'summary.json');
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
        automatedResult: { exitCode: number };
      };
      summary.automatedResult.exitCode = 2;
      writeFileSync(summaryPath, JSON.stringify(summary));
    },
  },
  {
    name: 'identity',
    mutate: (root, inputs) => {
      const summaryPath = join(root, inputs.comparison.run, 'summary.json');
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
        runIdentity: { consistent: boolean };
      };
      summary.runIdentity.consistent = false;
      writeFileSync(summaryPath, JSON.stringify(summary));
    },
  },
  {
    name: 'comparison-source',
    mutate: (root, inputs) => {
      const summaryPath = join(root, inputs.comparison.run, 'summary.json');
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
        comparisonProvenance: { current: { buildInputs: { source: { commit: string } } } };
      };
      summary.comparisonProvenance.current.buildInputs.source.commit = 'f'.repeat(40);
      writeFileSync(summaryPath, JSON.stringify(summary));
    },
  },
  {
    name: 'comparison-fixture',
    mutate: (root, inputs) => {
      const summaryPath = join(root, inputs.comparison.run, 'summary.json');
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
        comparisonProvenance: { current: { fixture: { sha256: string } } };
      };
      summary.comparisonProvenance.current.fixture.sha256 = 'f'.repeat(64);
      writeFileSync(summaryPath, JSON.stringify(summary));
    },
  },
  {
    name: 'comparison-harness-identity',
    mutate: (root, inputs) => {
      const identityPath = join(root, inputs.comparison.run, 'harness-identity.json');
      const identity = JSON.parse(readFileSync(identityPath, 'utf8')) as {
        artifact: { actualBinarySha256: string };
      };
      identity.artifact.actualBinarySha256 = 'f'.repeat(64);
      writeFileSync(identityPath, JSON.stringify(identity));
    },
  },
];

describe('FE-01 PF-01 ticket-specific automatic-pass current binding', () => {
  let immutableComparisonFixtureRoot: string | undefined;
  let immutableComparisonFixture: ReturnType<typeof writeImmutableComparisonFixture> | undefined;

  beforeAll(() => {
    immutableComparisonFixtureRoot = mkdtempSync(join(tmpdir(), 'pf01-automatic-pass-base-'));
    immutableComparisonFixture = writeImmutableComparisonFixture(immutableComparisonFixtureRoot);
  });

  afterAll(() => {
    if (immutableComparisonFixtureRoot !== undefined) {
      rmSync(immutableComparisonFixtureRoot, { recursive: true, force: true });
    }
  });

  function isolatedImmutableComparisonFixture(name: string) {
    if (immutableComparisonFixtureRoot === undefined || immutableComparisonFixture === undefined) {
      throw new Error('immutable comparison base fixture missing');
    }
    const parent = mkdtempSync(join(tmpdir(), `pf01-automatic-pass-${name}-`));
    const root = join(parent, 'fixture');
    cpSync(immutableComparisonFixtureRoot, root, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
    return { parent, root, inputs: clone(immutableComparisonFixture) };
  }
  it('只有当前 HEAD 的预算、descriptor、inputs/graph、fixture 与 runtime 全部精确等价才可作为 automatic pass', () => {
    expect(validateFe01Pf01AutomaticPassCurrentBinding({ record, current })).toEqual({
      valid: true,
    });

    const drifts = [
      (value: typeof current) => (value.budget.sha256 = 'a'.repeat(64)),
      (value: typeof current) => (value.descriptor.digest = 'a'.repeat(64)),
      (value: typeof current) => (value.fixture.sha256 = 'a'.repeat(64)),
      (value: typeof current) => (value.artifact.actualBinarySha256 = 'a'.repeat(64)),
      (value: typeof current) => (value.artifact.identifier = 'io.example.changed'),
      (value: typeof current) => (value.artifact.binary = 'target/changed-harness'),
      (value: typeof current) => (value.buildInputs.entries[0].sha256 = 'a'.repeat(64)),
      (value: typeof current) => (value.measurementInputs.digest = 'a'.repeat(64)),
      (value: typeof current) =>
        value.measurementInputs.l2DevModuleGraph.actualModulePaths.push('src/extra.ts'),
      (value: typeof current) => (value.runner.node = 'v99.0.0'),
      (value: typeof current) => (value.toolchain.rustc = 'rustc 99'),
      (value: typeof current) => (value.buildEnvironment.overrides = ['GIT_DIR']),
    ];
    for (const drift of drifts) {
      const candidate = clone(current);
      drift(candidate);
      expect(
        validateFe01Pf01AutomaticPassCurrentBinding({ record, current: candidate }),
      ).toMatchObject({
        valid: false,
      });
    }
  });

  it('保留 comparison binary SHA，但允许每次 declared==actual 的 clean harness rebuild 产生不同 binary SHA', () => {
    const comparisonRecord = clone(record);
    comparisonRecord.current.artifact.declaredBinarySha256 = 'a'.repeat(64);
    comparisonRecord.current.artifact.actualBinarySha256 = 'a'.repeat(64);
    const rebuiltCurrent = clone(current);
    rebuiltCurrent.artifact.declaredBinarySha256 = 'b'.repeat(64);
    rebuiltCurrent.artifact.actualBinarySha256 = 'b'.repeat(64);

    expect(
      validateFe01Pf01AutomaticPassCurrentBinding({
        record: comparisonRecord,
        current: rebuiltCurrent,
      }),
    ).toEqual({ valid: true });
  });

  it('v2 预算/测量 provenance 与 historical manual waiver 形状不能借用为新的 automatic pass', () => {
    const legacy = clone(record) as Record<string, unknown>;
    legacy.kind = 'fe-01-pf-01-active-exact-performance-waiver';
    (legacy.current as typeof record.current).buildInputs.schemaVersion = 2;
    (legacy.current as typeof record.current).buildInputs.algorithm =
      'pf01-l3-harness-build-inputs-v2';
    (legacy.current as typeof record.current).measurementInputs.schemaVersion = 2;
    (legacy.current as typeof record.current).measurementInputs.algorithm =
      'pf01-measurement-inputs-v2';
    expect(validateFe01Pf01AutomaticPassCurrentBinding({ record: legacy, current })).toMatchObject({
      valid: false,
    });
  });

  it('只从 clean exit-0 comparison 的 immutable summary、Git budget/descriptor 与完整 artifact hashes 构造 record', () => {
    const inputs = validComparisonInputs();
    const generated = createFe01Pf01AutomaticPassRecord(inputs);
    expect(generated).toMatchObject({
      schemaVersion: 2,
      ticket: 'FE-01',
      performance: 'PF-01',
      comparison: inputs.comparison,
      artifactSha256: inputs.artifactSha256,
    });
    expect(generated.recordDigest.value).toMatch(/^[a-f0-9]{64}$/);

    for (const mutate of [
      (value: ReturnType<typeof validComparisonInputs>) => (value.comparison.exitCode = 1),
      (value: ReturnType<typeof validComparisonInputs>) => (value.comparison.worktreeDirty = true),
      (value: ReturnType<typeof validComparisonInputs>) =>
        (value.summary.status = 'baseline-collected'),
      (value: ReturnType<typeof validComparisonInputs>) =>
        Reflect.deleteProperty(value.artifactSha256, 'samples.json'),
      (value: ReturnType<typeof validComparisonInputs>) =>
        (value.artifactSha256['samples.json'] = 'f'.repeat(64)),
    ]) {
      const invalid = clone(inputs);
      mutate(invalid);
      expect(() => createFe01Pf01AutomaticPassRecord(invalid)).toThrow(/automatic-pass/i);
    }
  });

  it('受控 generator 仅从当前 clean HEAD 的完整 immutable exit-0 comparison 写入一次 Prettier record', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-automatic-pass-'));
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      const inputs = writeImmutableComparisonFixture(root);
      const written = await writeFe01Pf01AutomaticPassRecord({
        repoRoot: root,
        comparisonRun: inputs.comparison.runId,
      });
      const content = readFileSync(join(root, written.recordPath), 'utf8');
      expect(written.record.comparison.commit).toBe(inputs.comparison.commit);
      expect(content).toContain('"schemaVersion": 2');
      expect(content.endsWith('\n')).toBe(true);
      await expect(
        writeFe01Pf01AutomaticPassRecord({
          repoRoot: root,
          comparisonRun: inputs.comparison.runId,
        }),
      ).rejects.toThrow(/refuses overwrite/i);

      writeFileSync(
        join(root, inputs.comparison.run, 'summary.json'),
        '{"status":"baseline-collected"}',
      );
      await expect(
        writeFe01Pf01AutomaticPassRecord({
          repoRoot: root,
          comparisonRun: inputs.comparison.runId,
        }),
      ).rejects.toThrow(/automatic-pass/i);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(immutableComparisonFailures)(
    '拒绝 immutable comparison $name 漂移且不生成 record',
    async ({ name, mutate }) => {
      const previousNodeEnv = process.env.NODE_ENV;
      const { parent, root, inputs } = isolatedImmutableComparisonFixture(name);
      try {
        delete process.env.NODE_ENV;
        mutate(root, inputs);
        await expect(
          writeFe01Pf01AutomaticPassRecord({
            repoRoot: root,
            comparisonRun: inputs.comparison.runId,
          }),
        ).rejects.toThrow(/automatic-pass/i);
        expect(existsSync(join(root, 'performance', 'automatic-passes', 'fe-01-pf-01.json'))).toBe(
          false,
        );
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});
