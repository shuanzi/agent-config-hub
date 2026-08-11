/**
 * FE-01 唯一允许的 PF-01 人工 performance waiver。
 *
 * 此模块刻意不提供通用 waiver API：它只验证用户授权的一个 immutable run。
 * 该 run 的 summary 没有保留 perf process exit/status；因此 exit=1/fail 必须由
 * 原始 samples 与当时 commit 的 frozen budget 完整重算，绝不把 record 自述当事实。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  scanEvidenceText,
  sha256File,
  sha256Text,
} from './lib.mjs';
import {
  PF01_BUDGET_CONSTANTS,
  PF01_TIMING_METRICS,
} from './pf01-budget.mjs';
import { computePf01L3HarnessBuildInputsDigest, PF01_L3_BUILD_INPUTS } from './pf01-build-inputs.mjs';
import { finalizeHarnessPeakRss, validatePf01ResourceEvidence } from './pf01-resource.mjs';

export const FE01_PF01_WAIVER_PATH = 'performance/waivers/fe-01-pf-01-l3-cold-start.json';
export const FE01_PF01_WAIVER_ARTIFACT_SHA256 = Object.freeze({
  'l3-resource-runs.json': '47825d415adfded2105fd97e6990a8302854eedd57f8c34895c45c31c22db972',
  'l3-samples.json': 'dc62c2684857348d6b8f7fee5001ba0b664f1fa3bf5d5ceda816cfc592f74686',
  'proposed-budgets.json': '50d6d720c91e1c50d784b28904ac88f20ff90b2ba35f096fc1bca7ad99bded83',
  'samples.json': 'da12933dd0c5759d37c114f4aec74e3467ef7f35847e4fd99829a7e97701e528',
  'summary.json': '259ae88977d487b6b1f984d385c52e831f34cdcdeced0ecef47ecc75763cb1c9',
});
export const FE01_PF01_WAIVER_SHA256 =
  '56d5c650742ea200ea9880eec4ea093cb8df4bd6954a3197bed67ed5c2ad8fe0';
const TICKET = 'FE-01';
const PERFORMANCE = 'PF-01';
const RUN_ID = '20260811T024255740Z-p14989-000';
const PERFORMANCE_COMMIT = '40009202e2e88e946dadf82a71816e10338da639';
const RUN_PATH = `.artifacts/performance/PF-01/${RUN_ID}`;
const AUTOMATED_RESULT_SOURCE =
  '用户授权的 manual disposition；由原始 samples 与 performance-run commit 的 frozen budget 可重算，summary.json 不含 exitCode 或 status。';
const WAIVER_SCOPE =
  '仅限 FE-01、PF-01、所列 metric、run 与 performance-run commit；不改变预算阈值、baseline、样本或方法，且不构成通用 bypass。';
const PERFORMANCE_DEBT =
  '该 run 的 L3 cold-start p50 超过既有阈值 2ms；按用户授权接受为本阶段性能债务。';
const REQUIRED_ARTIFACTS = Object.keys(FE01_PF01_WAIVER_ARTIFACT_SHA256);
const RECORD_KEYS = [
  'schemaVersion',
  'kind',
  'ticket',
  'performance',
  'manualDisposition',
  'scope',
  'performanceDebt',
  'automaticResult',
  'artifactSha256',
];
const AUTOMATIC_RESULT_KEYS = [
  'status',
  'exitCode',
  'source',
  'runId',
  'run',
  'commit',
  'worktreeDirty',
  'violation',
];
const VIOLATION_KEYS = ['metric', 'statistic', 'observedMs', 'thresholdMs', 'deltaMs'];
const L2_LAYER = PF01_BUDGET_CONSTANTS.L2_LAYER;
const L3_LAYER = PF01_BUDGET_CONSTANTS.L3_LAYER;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function percentile(sorted, p) {
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return Math.round((sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)) * 1000) / 1000;
}

function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || !samples.every(number)) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function gitJson(commit, relativePath, repoRoot) {
  const text = execFileSync('git', ['show', `${commit}:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return JSON.parse(text);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function expectedMetricStats(samples, metric) {
  const stats = summarize(samples);
  if (stats === null) return null;
  const minSamples = PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric];
  if (stats.n !== minSamples) return null;
  return {
    ...stats,
    minSamples,
    complete: true,
    unit: 'ms',
    layer: metric === 'pf01.l3.cold_start.first_snapshot' ? L3_LAYER : L2_LAYER,
  };
}

function expectedWaiver(record) {
  return (
    isObject(record) &&
    hasExactKeys(record, RECORD_KEYS) &&
    record.schemaVersion === 1 &&
    record.kind === 'fe-01-pf-01-exact-performance-waiver' &&
    record.ticket === TICKET &&
    record.performance === PERFORMANCE &&
    record.manualDisposition === 'accepted-with-waiver' &&
    record.scope === WAIVER_SCOPE &&
    record.performanceDebt === PERFORMANCE_DEBT &&
    isObject(record.automaticResult) &&
    hasExactKeys(record.automaticResult, AUTOMATIC_RESULT_KEYS) &&
    record.automaticResult.status === 'fail' &&
    record.automaticResult.exitCode === 1 &&
    record.automaticResult.source === AUTOMATED_RESULT_SOURCE &&
    record.automaticResult.runId === RUN_ID &&
    record.automaticResult.run === RUN_PATH &&
    record.automaticResult.commit === PERFORMANCE_COMMIT &&
    record.automaticResult.worktreeDirty === false &&
    isObject(record.automaticResult.violation) &&
    hasExactKeys(record.automaticResult.violation, VIOLATION_KEYS) &&
    sameJson(record.automaticResult.violation, {
      metric: 'pf01.l3.cold_start.first_snapshot',
      statistic: 'p50',
      observedMs: 612,
      thresholdMs: 610,
      deltaMs: 2,
    }) &&
    exactArtifactHashes(record.artifactSha256)
  );
}

function hasExactKeys(value, expected) {
  return sameJson(Object.keys(value).sort(), [...expected].sort());
}

function exactArtifactHashes(value) {
  return (
    isObject(value) &&
    sameJson(Object.keys(value).sort(), REQUIRED_ARTIFACTS) &&
    REQUIRED_ARTIFACTS.every(
      (file) =>
        isSha256(value[file]) && value[file] === FE01_PF01_WAIVER_ARTIFACT_SHA256[file],
    )
  );
}

function compareAgainstBudget(budget, metrics) {
  const entries = new Map((budget.budgets ?? []).map((entry) => [entry.metric, entry]));
  const violations = [];
  for (const metric of PF01_TIMING_METRICS) {
    const stats = metrics[metric];
    const entry = entries.get(metric);
    if (entry === undefined || stats === undefined) return null;
    if (stats.p95 > entry.absoluteCeilingMs) {
      violations.push({
        metric,
        statistic: 'p95',
        observedMs: stats.p95,
        thresholdMs: entry.absoluteCeilingMs,
        deltaMs: Math.round((stats.p95 - entry.absoluteCeilingMs) * 1000) / 1000,
      });
    }
    const threshold = entry.baseline.p50 * entry.regressionAllowance.maxRatio;
    if (stats.p50 > threshold) {
      violations.push({
        metric,
        statistic: 'p50',
        observedMs: stats.p50,
        thresholdMs: threshold,
        deltaMs: Math.round((stats.p50 - threshold) * 1000) / 1000,
      });
    }
  }
  return violations;
}

/**
 * The only historical waiver is immutable schema v3 evidence. It remains auditable, but
 * is deliberately not upgraded into (or accepted as) the current v4 measurement method.
 */
function validateHistoricalWaiverBudget(budget, descriptor, current) {
  const provenance = budget?.baselineProvenance;
  const validBuildInputs = (value, sourceKind) =>
    value?.schemaVersion === PF01_L3_BUILD_INPUTS.schemaVersion &&
    value?.algorithm === PF01_L3_BUILD_INPUTS.algorithm &&
    value?.source?.kind === sourceKind &&
    value?.source?.method === 'raw bytes SHA-256 / byte-sorted repo-relative paths' &&
    typeof value?.source?.commit === 'string' &&
    isSha256(value?.digest) &&
    Array.isArray(value?.entries) &&
    value.digest ===
      computePf01L3HarnessBuildInputsDigest({
        schemaVersion: value.schemaVersion,
        algorithm: value.algorithm,
        entries: value.entries,
      });
  const sameArtifact =
    provenance?.artifact !== null &&
    typeof provenance?.artifact === 'object' &&
    current?.artifact !== null &&
    typeof current?.artifact === 'object' &&
    ['identityPath', 'kind', 'identifier', 'profile', 'binary', 'provenance'].every(
      (field) => provenance.artifact[field] === current.artifact[field],
    ) &&
    isSha256(provenance.artifact.declaredBinarySha256) &&
    provenance.artifact.declaredBinarySha256 === provenance.artifact.actualBinarySha256 &&
    isSha256(current.artifact.declaredBinarySha256) &&
    current.artifact.declaredBinarySha256 === current.artifact.actualBinarySha256;
  const expectedMetricSet = PF01_TIMING_METRICS;
  const validMetrics =
    Array.isArray(budget?.budgets) &&
    budget.budgets.length === expectedMetricSet.length &&
    sameJson(
      budget.budgets.map((entry) => entry?.metric).sort(),
      [...expectedMetricSet].sort(),
    ) &&
    budget.budgets.every((entry) => {
      const metric = entry?.metric;
      const baseline = entry?.baseline;
      const expectedCount = PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric];
      return (
        entry?.layer === (metric === 'pf01.l3.cold_start.first_snapshot' ? L3_LAYER : L2_LAYER) &&
        positiveNumber(baseline?.p50) &&
        positiveNumber(baseline?.p95) &&
        baseline?.n === expectedCount &&
        entry?.absoluteCeilingMs === Math.ceil((baseline.p95 * 1.5) / 10) * 10 &&
        entry?.regressionAllowance?.relativeTo === 'baseline-p50' &&
        entry?.regressionAllowance?.maxRatio === 1.25
      );
    });
  const validResources =
    provenance?.resources?.metric === 'pf01.l3.peak_rss_bytes' &&
    provenance.resources.layer === L3_LAYER &&
    provenance.resources.sampling === PF01_BUDGET_CONSTANTS.RESOURCE_SAMPLING &&
    Array.isArray(provenance.resources.rawPeaksBytes) &&
    provenance.resources.rawPeaksBytes.length === 3 &&
    provenance.resources.rawPeaksBytes.every(positiveNumber) &&
    provenance.resources.maxBytes === Math.max(...provenance.resources.rawPeaksBytes);
  return (
    budget?.schemaVersion === 3 &&
    budget?.descriptorId === PERFORMANCE &&
    budget?.descriptorDigest === descriptor?.digest?.value &&
    budget?.profile === 'representative' &&
    budget?.formula?.absoluteCeilingMs === PF01_BUDGET_CONSTANTS.ABSOLUTE_FORMULA &&
    budget?.formula?.regressionAllowance === PF01_BUDGET_CONSTANTS.REGRESSION_FORMULA &&
    provenance?.run === '.artifacts/performance/PF-01/20260810T174423659Z-p67445-000' &&
    provenance?.statusBeforeBudgetFreeze === 'baseline-collected / budget-not-frozen' &&
    provenance?.worktreeDirty === false &&
    typeof provenance?.commit === 'string' &&
    validBuildInputs(provenance?.buildInputs, 'git-object-tree') &&
    provenance.buildInputs.source.commit === provenance.commit &&
    validBuildInputs(current?.buildInputs, 'clean-tracked-checkout') &&
    current.buildInputs.source.commit === PERFORMANCE_COMMIT &&
    sameJson(provenance.buildInputs.entries, current.buildInputs.entries) &&
    provenance.buildInputs.digest === current.buildInputs.digest &&
    provenance?.fixture?.path === 'fixtures/fx-01/native-root' &&
    provenance.fixture.sha256 === current?.fixture?.sha256 &&
    isSha256(provenance.fixture.sha256) &&
    sameArtifact &&
    validResources &&
    validMetrics
  );
}

function historicalComparisonProvenance(budget, currentAttestation) {
  const baseline = budget?.baselineProvenance;
  return {
    baseline: {
      run: baseline?.run,
      collectedAt: baseline?.collectedAt,
      commit: baseline?.commit,
      worktreeDirty: baseline?.worktreeDirty,
      artifact: baseline?.artifact,
      fixture: baseline?.fixture,
      buildInputs: baseline?.buildInputs,
    },
    current: {
      artifact: currentAttestation?.artifact,
      fixture: currentAttestation?.fixture,
      buildInputs: currentAttestation?.buildInputs,
    },
  };
}

function invalid(violations, message) {
  violations.push(message);
}

/** historical PF evidence 的机器可读声明；它从不代表本次运行做过 sampling。 */
export function historicalPf01StepMetadata(validation) {
  return {
    executionMode: 'historical-artifact-validation',
    samplingRun: false,
    historicalRunId: validation?.automaticResult?.runId ?? null,
    initialWaiverValidation: validation?.valid === true ? 'valid' : 'invalid',
  };
}

/**
 * 从 record 指向的原始 files 与 immutable `performance-run commit` 真正验证。
 * 可注入 record/artifactDirectory 仅供 L1 测试复制 artifact 后作篡改负例。
 */
export function validateFe01Pf01Waiver({
  repoRoot = REPO_ROOT,
  waiver = undefined,
  waiverRecordPath = undefined,
  artifactDirectory = undefined,
} = {}) {
  const violations = [];
  const recordPath = waiverRecordPath ?? path.join(repoRoot, FE01_PF01_WAIVER_PATH);
  let record;
  try {
    record = waiver ?? readJson(recordPath);
  } catch {
    return { valid: false, violations: ['FE-01 PF-01 waiver record 无法读取'] };
  }
  let waiverSha256;
  try {
    waiverSha256 = sha256File(recordPath);
  } catch {
    return { valid: false, violations: ['FE-01 PF-01 waiver record SHA-256 无法读取'] };
  }
  if (waiverSha256 !== FE01_PF01_WAIVER_SHA256) {
    return { valid: false, violations: ['FE-01 PF-01 waiver record SHA-256 不匹配'] };
  }
  if (!expectedWaiver(record)) {
    return { valid: false, violations: ['FE-01 PF-01 waiver record 不是唯一已授权的精确 disposition'] };
  }

  const runDirectory = artifactDirectory ?? path.join(repoRoot, RUN_PATH);
  if (path.basename(runDirectory) !== record.automaticResult.runId) {
    return { valid: false, violations: ['waiver runId 与 artifact directory 不一致'] };
  }
  let fileNames;
  try {
    const runStats = fs.lstatSync(runDirectory);
    if (!runStats.isDirectory() || runStats.isSymbolicLink()) {
      return { valid: false, violations: ['waiver artifact directory 必须是实际目录'] };
    }
    fileNames = fs.readdirSync(runDirectory).sort();
  } catch {
    return { valid: false, violations: ['waiver artifact directory 不存在'] };
  }
  if (!sameJson(fileNames, REQUIRED_ARTIFACTS)) {
    return { valid: false, violations: ['waiver artifact 文件集合不完整或存在未认证文件'] };
  }
  for (const file of REQUIRED_ARTIFACTS) {
    const filePath = path.join(runDirectory, file);
    try {
      const stats = fs.lstatSync(filePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        invalid(violations, `${file} 不是实际 artifact file`);
        continue;
      }
      if (sha256File(filePath) !== record.artifactSha256[file]) {
        invalid(violations, `${file} SHA-256 与 waiver record 不匹配`);
      }
      if (!scanEvidenceText(fs.readFileSync(filePath, 'utf8')).clean) {
        invalid(violations, `${file} evidence contamination`);
      }
    } catch {
      invalid(violations, `${file} 无法读取`);
    }
  }
  if (violations.length > 0) return { valid: false, violations };

  let summary;
  let samples;
  let l3Samples;
  let resourceRuns;
  let budget;
  let descriptor;
  try {
    summary = readJson(path.join(runDirectory, 'summary.json'));
    samples = readJson(path.join(runDirectory, 'samples.json'));
    l3Samples = readJson(path.join(runDirectory, 'l3-samples.json'));
    resourceRuns = readJson(path.join(runDirectory, 'l3-resource-runs.json'));
    budget = gitJson(
      record.automaticResult.commit,
      'performance/budgets/pf-01.budgets.json',
      repoRoot,
    );
    descriptor = gitJson(
      record.automaticResult.commit,
      'performance/descriptors/pf-01.catalog-browse.json',
      repoRoot,
    );
  } catch {
    return { valid: false, violations: ['waiver artifact 或 performance-run Git object 无法解析'] };
  }

  if (
    summary?.schemaVersion !== 1 ||
    summary?.status !== 'budget-comparison' ||
    summary?.budgetState !== 'budget-frozen（performance/budgets/pf-01.budgets.json）' ||
    summary?.budgetValidation?.valid !== true ||
    !Array.isArray(summary?.budgetValidation?.violations) ||
    summary.budgetValidation.violations.length !== 0 ||
    summary?.descriptorId !== PERFORMANCE ||
    summary?.profile !== 'representative' ||
    summary?.descriptorDigest !== descriptor?.digest?.value ||
    summary?.contamination !== undefined
  ) {
    invalid(violations, 'summary 不是完整、clean 的 PF-01 budget comparison artifact');
  }
  // `pfDescriptorDigest` 的行为基于原始文本；这里对 immutable Git object 用同一
  // canonicalization 规则复算，不信任 descriptor 声明值。
  try {
    const descriptorText = execFileSync(
      'git',
      ['show', `${record.automaticResult.commit}:performance/descriptors/pf-01.catalog-browse.json`],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const declared = descriptor?.digest?.value;
    const computed = declared
      ? sha256Text(descriptorText.replace(`"value": "${declared}"`, '"value": ""'))
      : null;
    if (computed === null || computed !== declared) invalid(violations, 'immutable descriptor digest 无效');
  } catch {
    invalid(violations, 'immutable descriptor digest 无法复算');
  }

  const merged = { ...(samples?.metrics ?? {}), ...(l3Samples?.metrics ?? {}) };
  const expectedMetrics = {};
  for (const metric of PF01_TIMING_METRICS) {
    const raw = merged[metric]?.samples;
    const stats = expectedMetricStats(raw, metric);
    if (stats === null) {
      invalid(violations, `${metric} raw samples 不完整`);
    } else {
      expectedMetrics[metric] = stats;
      if (!sameJson(summary?.metrics?.[metric], stats)) {
        invalid(violations, `${metric} summary 与 raw samples 不一致`);
      }
    }
  }
  if (!sameJson(Object.keys(summary?.metrics ?? {}).sort(), [...PF01_TIMING_METRICS].sort())) {
    invalid(violations, 'summary metric 集合不精确');
  }

  let resourceEvidence;
  try {
    resourceEvidence = finalizeHarnessPeakRss(resourceRuns?.runs);
    if (!validatePf01ResourceEvidence(resourceEvidence).valid) throw new Error('resource schema');
    if (!sameJson(summary?.resources, { status: 'collected', ...resourceEvidence })) {
      throw new Error('resource summary mismatch');
    }
  } catch {
    invalid(violations, 'L3 RSS resource evidence 不完整或与 raw runs 不一致');
  }

  const currentAttestation = summary?.comparisonProvenance?.current;
  if (!validateHistoricalWaiverBudget(budget, descriptor, currentAttestation)) {
    invalid(violations, 'performance-run legacy budget/provenance 无效');
  }
  const expectedBaseline = historicalComparisonProvenance(budget, currentAttestation).baseline;
  if (!sameJson(summary?.comparisonProvenance?.baseline, expectedBaseline)) {
    invalid(violations, 'summary baseline provenance 与 immutable performance-run budget 不一致');
  }
  if (
    currentAttestation?.buildInputs?.source?.kind !== 'clean-tracked-checkout' ||
    currentAttestation?.buildInputs?.source?.commit !== record.automaticResult.commit ||
    currentAttestation?.buildEnvironment?.policy !==
      'no ambient VITE_/TAURI_/CARGO_/Rust/SDK/Node build overrides or root .env files' ||
    !Array.isArray(currentAttestation?.buildEnvironment?.overrides) ||
    currentAttestation.buildEnvironment.overrides.length !== 0
  ) {
    invalid(violations, 'current build/input provenance 不足以证明 clean performance run');
  }

  const comparison = compareAgainstBudget(budget, expectedMetrics);
  const expectedViolation = record.automaticResult.violation;
  if (comparison === null || comparison.length !== 1 || !sameJson(comparison[0], expectedViolation)) {
    invalid(violations, 'raw samples 与 frozen budget 未能唯一复算授权的 2ms L3 p50 失败');
  }
  if (violations.length > 0) return { valid: false, violations };

  return {
    valid: true,
    violations: [],
    waiverPath: FE01_PF01_WAIVER_PATH,
    waiverSha256,
    manualDisposition: record.manualDisposition,
    automaticResult: {
      ...record.automaticResult,
      automatedExitCode: 1,
      automatedExitCodeSource:
        'authorized manual disposition + reproducible raw-samples/frozen-budget comparison; summary.json did not record exitCode/status',
      source: 'authorized manual disposition + reproducible raw-samples/frozen-budget comparison; summary.json did not record exitCode/status',
      artifactDirectory: record.automaticResult.run,
      artifactSha256: record.artifactSha256,
    },
  };
}
