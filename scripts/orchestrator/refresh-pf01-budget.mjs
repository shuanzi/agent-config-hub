/* global console, process */
/**
 * PF-01 的受控预算冻结入口。
 *
 * 它只读取一个显式指定、已经由 `perf.mjs` 收集完成的 baseline run；绝不调用
 * perf/WDIO/harness。任何 provenance、物理路径或当前 checkout 身份不完整时均拒绝
 * 写入 current budget。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACTS_ROOT,
  REPO_ROOT,
  assertCurrentPfDescriptorDigest,
  gitInfo,
} from './lib.mjs';
import {
  assertPf01L3BuildEnvironment,
  assertPf01VerificationEnvironment,
  collectPf01L3HarnessBuildInputs,
  collectPf01L3HarnessBuildInputsFromGit,
} from './pf01-build-inputs.mjs';
import {
  collectPf01MeasurementInputs,
  collectPf01MeasurementInputsFromGit,
  readPf01L2ViteDevModuleGraph,
  validatePf01L2ViteDevModuleGraph,
} from './pf01-measurement-inputs.mjs';
import {
  PF01_BUDGET_CONSTANTS,
  PF01_TIMING_METRICS,
  capturePf01RuntimeProvenance,
  collectCurrentPf01Attestation,
  formatPf01BudgetJson,
  freezePf01Budget,
  validateCurrentPf01Attestation,
  validateFrozenPf01Budget,
} from './pf01-budget.mjs';
import { finalizeHarnessPeakRss, validatePf01ResourceEvidence } from './pf01-resource.mjs';

const DESCRIPTOR_PATH = path.join(REPO_ROOT, 'performance/descriptors/pf-01.catalog-browse.json');
const BUDGET_PATH = path.join(REPO_ROOT, 'performance/budgets/pf-01.budgets.json');
const PROFILE = 'representative';
const L3_METRIC = 'pf01.l3.cold_start.first_snapshot';
const L2_METRICS = PF01_TIMING_METRICS.filter((metric) => metric !== L3_METRIC);
const EXACT_SAMPLE_COUNTS = Object.freeze({
  'pf01.startup.first_list_visible': 5,
  'pf01.search.results_visible': 20,
  'pf01.filter.results_visible': 20,
  'pf01.select.skill_cells_visible': 20,
  'pf01.l3.cold_start.first_snapshot': 3,
});
const EXPECTED_BUILD_ENVIRONMENT = Object.freeze({
  policy: 'no ambient VITE_/TAURI_/CARGO_/Rust/SDK/Node build overrides or root .env files',
  overrides: [],
});

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertPhysicalPath(root, target, expectedKind) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`PF-01 baseline path outside artifacts root: ${target}`);
  }
  let current = absoluteRoot;
  const rootStats = fs.lstatSync(current);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`PF-01 baseline artifacts root symlink/non-directory rejected: ${current}`);
  }
  for (const [index, segment] of relative.split(path.sep).entries()) {
    current = path.join(current, segment);
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) throw new Error(`PF-01 baseline path symlink rejected: ${current}`);
    const final = index === relative.split(path.sep).length - 1;
    if (!final && !stats.isDirectory()) {
      throw new Error(`PF-01 baseline parent is not a directory: ${current}`);
    }
    if (final && expectedKind === 'directory' && !stats.isDirectory()) {
      throw new Error(`PF-01 baseline run is not a directory: ${current}`);
    }
    if (final && expectedKind === 'file' && !stats.isFile()) {
      throw new Error(`PF-01 baseline input is not a regular file: ${current}`);
    }
  }
  return absoluteTarget;
}

function readPhysicalJson(artifactsRoot, filePath) {
  const physical = assertPhysicalPath(artifactsRoot, filePath, 'file');
  try {
    return JSON.parse(fs.readFileSync(physical, 'utf8'));
  } catch (error) {
    throw new Error(
      `PF-01 baseline JSON invalid: ${path.basename(filePath)} (${error instanceof Error ? error.message : 'unknown'})`,
    );
  }
}

function baselineRunDirectory({ repoRoot, artifactsRoot, baselineRun }) {
  if (typeof baselineRun !== 'string' || baselineRun.trim() === '') {
    throw new Error('PF-01 refresh requires explicit --baseline-run=<repo-relative run directory>');
  }
  if (path.isAbsolute(baselineRun)) {
    throw new Error('PF-01 baseline run must be repo-relative');
  }
  const runDirectory = path.resolve(repoRoot, baselineRun);
  const expectedPrefix = path.join(path.resolve(artifactsRoot), 'performance', 'PF-01');
  const runName = path.relative(expectedPrefix, runDirectory);
  if (
    runName === '' ||
    runName.startsWith(`..${path.sep}`) ||
    path.isAbsolute(runName) ||
    runName.split(path.sep).length !== 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runName)
  ) {
    throw new Error('PF-01 baseline run must be .artifacts/performance/PF-01/<run-id>');
  }
  const canonical = path.relative(repoRoot, runDirectory).split(path.sep).join('/');
  if (canonical !== baselineRun.replaceAll('\\', '/')) {
    throw new Error('PF-01 baseline run path is not canonical repo-relative form');
  }
  assertPhysicalPath(artifactsRoot, runDirectory, 'directory');
  return { runDirectory, run: canonical };
}

function percentile(sorted, p) {
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return Math.round((sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)) * 1000) / 1000;
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function assertExactMetricSamples(payload, metricNames, expectedProfile, { hasProfile }) {
  if (
    !isObject(payload) ||
    payload.schemaVersion !== 1 ||
    payload.descriptorId !== 'PF-01' ||
    payload.unit !== 'ms' ||
    !isIsoTimestamp(payload.collectedAt) ||
    !isObject(payload.metrics)
  ) {
    throw new Error('PF-01 baseline raw samples descriptor/profile/unit invalid');
  }
  if (hasProfile && payload.profile !== expectedProfile) {
    throw new Error('PF-01 baseline raw samples profile invalid');
  }
  const actual = Object.keys(payload.metrics).sort();
  const expected = [...metricNames].sort();
  if (!sameJson(actual, expected)) throw new Error('PF-01 baseline raw samples metric set incomplete');
  return Object.fromEntries(
    metricNames.map((metric) => {
      const samples = payload.metrics[metric]?.samples;
      if (
        !Array.isArray(samples) ||
        samples.length !== EXACT_SAMPLE_COUNTS[metric] ||
        !samples.every(isPositiveNumber)
      ) {
        throw new Error(`PF-01 baseline raw samples incomplete: ${metric}`);
      }
      return [metric, samples];
    }),
  );
}

function assertSummaryMetrics(summary, samples) {
  if (!isObject(summary.metrics)) throw new Error('PF-01 baseline summary metrics missing');
  for (const metric of PF01_TIMING_METRICS) {
    const calculated = summarize(samples[metric]);
    const recorded = summary.metrics[metric];
    if (
      !isObject(recorded) ||
      recorded.n !== calculated.n ||
      recorded.min !== calculated.min ||
      recorded.max !== calculated.max ||
      recorded.p50 !== calculated.p50 ||
      recorded.p95 !== calculated.p95 ||
      recorded.complete !== true ||
      recorded.minSamples !== EXACT_SAMPLE_COUNTS[metric] ||
      recorded.unit !== 'ms' ||
      recorded.layer !==
        (metric === L3_METRIC ? PF01_BUDGET_CONSTANTS.L3_LAYER : PF01_BUDGET_CONSTANTS.L2_LAYER)
    ) {
      throw new Error(`PF-01 baseline summary/raw sample mismatch: ${metric}`);
    }
  }
  if (!sameJson(Object.keys(summary.metrics).sort(), [...PF01_TIMING_METRICS].sort())) {
    throw new Error('PF-01 baseline summary metric set incomplete');
  }
  return summary.metrics;
}

function assertRuntimeProvenance(current) {
  if (
    !isObject(current?.runner) ||
    !['node', 'npm', 'platform', 'release', 'macosProductVersion', 'arch'].every(
      (key) => typeof current.runner[key] === 'string' && current.runner[key].length > 0,
    ) ||
    !isObject(current?.toolchain) ||
    typeof current.toolchain.cargo !== 'string' ||
    current.toolchain.cargo.length === 0 ||
    typeof current.toolchain.rustc !== 'string' ||
    current.toolchain.rustc.length === 0
  ) {
    throw new Error('PF-01 baseline runner/toolchain provenance incomplete');
  }
}

function assertBuildEnvironmentProvenance(current) {
  const recorded = current?.buildEnvironment;
  if (
    !isObject(recorded) ||
    !sameJson(Object.keys(recorded).sort(), ['overrides', 'policy']) ||
    recorded.policy !== EXPECTED_BUILD_ENVIRONMENT.policy ||
    !Array.isArray(recorded.overrides) ||
    recorded.overrides.length !== 0
  ) {
    throw new Error('PF-01 baseline build environment provenance incomplete or drifted');
  }
}

/** refresh 的 CLI 和公开 seam 共享 ambient fail-closed gate。 */
export function assertRefreshPf01Environment(environment = process.env, repoRoot = REPO_ROOT) {
  return {
    verification: assertPf01VerificationEnvironment(environment),
    build: assertPf01L3BuildEnvironment(environment, repoRoot),
  };
}

function assertSameCurrentAttestation(recorded, current) {
  const recordedValidation = validateCurrentPf01Attestation(recorded);
  const currentValidation = validateCurrentPf01Attestation(current);
  if (!recordedValidation.valid) {
    throw new Error(`PF-01 baseline artifact attestation invalid: ${recordedValidation.violations.join('; ')}`);
  }
  if (!currentValidation.valid) {
    throw new Error(`PF-01 current artifact attestation invalid: ${currentValidation.violations.join('; ')}`);
  }
  if (
    !sameJson(recorded.artifact, current.artifact) ||
    !sameJson(recorded.fixture, current.fixture) ||
    recorded.buildInputs.digest !== current.buildInputs.digest ||
    !sameJson(recorded.buildInputs.entries, current.buildInputs.entries) ||
    recorded.measurementInputs.digest !== current.measurementInputs.digest ||
    !sameJson(recorded.measurementInputs.entries, current.measurementInputs.entries) ||
    !sameJson(recorded.measurementInputs.l2DevModuleGraph, current.measurementInputs.l2DevModuleGraph) ||
    !sameJson(recorded.runner, current.runner) ||
    !sameJson(recorded.toolchain, current.toolchain)
  ) {
    throw new Error('PF-01 baseline/current artifact, fixture, runtime, build-input, or measurement-input mismatch');
  }
}

/**
 * 公开可测 seam：仅读取 immutable run 并重建预算 object，不写入 current budget。
 * CLI 在全部验证后才负责安全创建文件。
 */
export function freezePf01BudgetFromBaselineRun({
  repoRoot = REPO_ROOT,
  artifactsRoot = ARTIFACTS_ROOT,
  baselineRun,
  descriptor,
  profile = PROFILE,
  currentGit,
  currentAttestation,
  baselineBuildInputs,
  baselineMeasurementInputs,
  environment = process.env,
} = {}) {
  if (profile !== PROFILE) throw new Error('PF-01 budget freeze only accepts representative profile');
  assertRefreshPf01Environment(environment, repoRoot);
  const { runDirectory, run } = baselineRunDirectory({ repoRoot, artifactsRoot, baselineRun });
  const summary = readPhysicalJson(artifactsRoot, path.join(runDirectory, 'summary.json'));
  const l2Samples = readPhysicalJson(artifactsRoot, path.join(runDirectory, 'samples.json'));
  const l3Samples = readPhysicalJson(artifactsRoot, path.join(runDirectory, 'l3-samples.json'));
  const resourceRuns = readPhysicalJson(artifactsRoot, path.join(runDirectory, 'l3-resource-runs.json'));
  const l2DevModuleGraph = readPhysicalJson(
    artifactsRoot,
    path.join(runDirectory, 'l2-dev-module-graph.json'),
  );

  if (
    !isObject(summary) ||
    summary.schemaVersion !== 1 ||
    summary.descriptorId !== 'PF-01' ||
    summary.descriptorDigest !== descriptor?.digest?.value ||
    summary.profile !== profile ||
    summary.status !== 'baseline-collected / budget-not-frozen' ||
    summary.budgetValidation?.status !== 'not-created' ||
    typeof summary.budgetState !== 'string' ||
    !summary.budgetState.startsWith('budget-not-frozen') ||
    !isIsoTimestamp(summary.collectedAt)
  ) {
    throw new Error('PF-01 baseline summary descriptor/status is not freezeable');
  }
  const runIdentity = summary.runIdentity;
  if (
    !isObject(runIdentity) ||
    runIdentity.consistent !== true ||
    !isCommit(runIdentity.startCommit) ||
    runIdentity.startCommit !== runIdentity.endCommit ||
    runIdentity.startWorktreeDirty !== false ||
    runIdentity.endWorktreeDirty !== false ||
    currentGit?.worktreeDirty !== false ||
    currentGit?.commit !== runIdentity.startCommit
  ) {
    throw new Error('PF-01 baseline and current checkout must be the same clean commit');
  }

  const rawSamples = {
    ...assertExactMetricSamples(l2Samples, L2_METRICS, profile, { hasProfile: true }),
    ...assertExactMetricSamples(l3Samples, [L3_METRIC], profile, { hasProfile: false }),
  };
  const metrics = assertSummaryMetrics(summary, rawSamples);
  let resources;
  try {
    resources = finalizeHarnessPeakRss(resourceRuns?.runs);
  } catch (error) {
    throw new Error(`PF-01 baseline RSS runs incomplete: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  if (
    !validatePf01ResourceEvidence(resources).valid ||
    !isObject(summary.resources) ||
    summary.resources.status !== 'collected' ||
    !sameJson(
      Object.fromEntries(Object.entries(summary.resources).filter(([key]) => key !== 'status')),
      resources,
    )
  ) {
    throw new Error('PF-01 baseline RSS evidence mismatch');
  }

  const recorded = summary.comparisonProvenance?.current;
  if (!isObject(recorded)) throw new Error('PF-01 baseline comparison provenance missing');
  if (
    !validatePf01L2ViteDevModuleGraph(l2DevModuleGraph) ||
    !sameJson(recorded.measurementInputs?.l2DevModuleGraph, l2DevModuleGraph)
  ) {
    throw new Error('PF-01 baseline actual L2 Vite dev module graph missing or mismatched');
  }
  assertRuntimeProvenance(recorded);
  assertBuildEnvironmentProvenance(recorded);
  assertSameCurrentAttestation(recorded, currentAttestation);
  if (
    !isObject(baselineBuildInputs) ||
    baselineBuildInputs.source?.kind !== 'git-object-tree' ||
    baselineBuildInputs.source?.commit !== runIdentity.startCommit ||
    baselineBuildInputs.digest !== recorded.buildInputs.digest ||
    !sameJson(baselineBuildInputs.entries, recorded.buildInputs.entries)
  ) {
    throw new Error('PF-01 baseline Git-object build-input mismatch');
  }
  if (
    !isObject(baselineMeasurementInputs) ||
    baselineMeasurementInputs.source?.kind !== 'git-object-tree' ||
    baselineMeasurementInputs.source?.commit !== runIdentity.startCommit ||
    baselineMeasurementInputs.digest !== recorded.measurementInputs.digest ||
    !sameJson(baselineMeasurementInputs.entries, recorded.measurementInputs.entries) ||
    !sameJson(baselineMeasurementInputs.l2DevModuleGraph, l2DevModuleGraph)
  ) {
    throw new Error('PF-01 baseline Git-object measurement-input mismatch');
  }

  const budget = freezePf01Budget({
    descriptor,
    profile,
    metrics,
    baselineProvenance: {
      run,
      collectedAt: summary.collectedAt,
      statusBeforeBudgetFreeze: 'baseline-collected / budget-not-frozen',
      commit: runIdentity.startCommit,
      worktreeDirty: false,
      artifact: recorded.artifact,
      runner: recorded.runner,
      toolchain: recorded.toolchain,
      fixture: recorded.fixture,
      buildInputs: baselineBuildInputs,
      measurementInputs: baselineMeasurementInputs,
      resources: {
        metric: resources.metric,
        layer: resources.layer,
        sampling: PF01_BUDGET_CONSTANTS.RESOURCE_SAMPLING,
        rawPeaksBytes: resources.rawPeakBytes,
        maxBytes: resources.maxBytes,
      },
    },
  });
  const validation = validateFrozenPf01Budget(budget, descriptor, profile, currentAttestation);
  if (!validation.valid) {
    throw new Error(`PF-01 generated budget failed validation: ${validation.violations.join('; ')}`);
  }
  return budget;
}

function parseArguments(args) {
  const runFlags = args.filter((arg) => arg.startsWith('--baseline-run='));
  if (args.length !== 1 || runFlags.length !== 1 || runFlags[0].length === '--baseline-run='.length) {
    throw new Error(
      '用法: node scripts/orchestrator/refresh-pf01-budget.mjs --baseline-run=.artifacts/performance/PF-01/<run-id>',
    );
  }
  return { baselineRun: runFlags[0].slice('--baseline-run='.length) };
}

function assertBudgetTargetIsNew() {
  const directory = path.dirname(BUDGET_PATH);
  for (let current = directory; ; current = path.dirname(current)) {
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`PF-01 budget target parent symlink/non-directory rejected: ${current}`);
    }
    if (current === REPO_ROOT) break;
  }
  if (fs.existsSync(BUDGET_PATH)) {
    const stats = fs.lstatSync(BUDGET_PATH);
    if (stats.isSymbolicLink()) throw new Error('PF-01 current budget symlink rejected');
    throw new Error('PF-01 current budget already exists; refresh refuses overwrite');
  }
}

async function main() {
  try {
    const { baselineRun } = parseArguments(process.argv.slice(2));
    assertRefreshPf01Environment();
    const { runDirectory } = baselineRunDirectory({
      repoRoot: REPO_ROOT,
      artifactsRoot: ARTIFACTS_ROOT,
      baselineRun,
    });
    const l2DevModuleGraph = readPf01L2ViteDevModuleGraph(
      path.join(runDirectory, 'l2-dev-module-graph.json'),
    );
    const { descriptor } = assertCurrentPfDescriptorDigest(DESCRIPTOR_PATH);
    const currentGit = await gitInfo();
    const runtimeProvenance = await capturePf01RuntimeProvenance();
    const currentAttestation = collectCurrentPf01Attestation({
      buildInputs: collectPf01L3HarnessBuildInputs(),
      measurementInputs: collectPf01MeasurementInputs({ l2DevModuleGraph }),
      runtimeProvenance,
    });
    const baselineBuildInputs = collectPf01L3HarnessBuildInputsFromGit({ commit: currentGit.commit });
    const baselineMeasurementInputs = collectPf01MeasurementInputsFromGit({
      commit: currentGit.commit,
      l2DevModuleGraph,
    });
    const budget = freezePf01BudgetFromBaselineRun({
      baselineRun,
      descriptor,
      currentGit,
      currentAttestation,
      baselineBuildInputs,
      baselineMeasurementInputs,
    });
    assertBudgetTargetIsNew();
    const formatted = await formatPf01BudgetJson(budget);
    fs.writeFileSync(BUDGET_PATH, formatted, { encoding: 'utf8', flag: 'wx' });
    console.log(`PF-01 current budget frozen from ${baselineRun}`);
  } catch (error) {
    console.error(`INCONCLUSIVE  ${error instanceof Error ? error.message : 'PF-01 budget freeze failed'}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
