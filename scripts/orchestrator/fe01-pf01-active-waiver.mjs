/**
 * FE-01 当前唯一可生效的 PF-01 manual disposition。
 *
 * 该模块与 `fe01-pf01-waiver.mjs` 的 historical-only L3 cold-start record 完全分离。
 * 它只接受用户指定的 immutable search p95 fail，不能成为通用 performance bypass。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, scanEvidenceText, sha256File, sha256Text } from './lib.mjs';
import {
  PF01_TIMING_METRICS,
  validateFrozenPf01Budget,
} from './pf01-budget.mjs';
import {
  collectPf01L3HarnessBuildInputsFromGit,
} from './pf01-build-inputs.mjs';
import {
  collectPf01MeasurementInputsFromGit,
  readPf01L2ViteDevModuleGraph,
} from './pf01-measurement-inputs.mjs';
import { finalizeHarnessPeakRss, validatePf01ResourceEvidence } from './pf01-resource.mjs';
import { hasPhysicalPath } from './clean-evidence-index.mjs';

export const FE01_PF01_ACTIVE_WAIVER_PATH =
  'performance/waivers/fe-01-pf-01-search-results-active.json';
export const FE01_PF01_ACTIVE_WAIVER_SHA256 =
  '7136c2ac32210c366ba417e03618f76435a0df50517f641deaced9984b6651ae';
export const FE01_PF01_ACTIVE_WAIVER_ARTIFACT_SHA256 = Object.freeze({
  'l2-dev-module-graph.json': '3ea6cafc107cb11c0f0e92e625dfbbbac4f3fc5fd463d10f1b1efac625985ff7',
  'l3-resource-runs.json': 'a8af3901d504462af8a8f37cb05eb33b78e0c79a81edb31f6ac8070750840fd8',
  'l3-samples.json': '65069f18ed9bc7e51d77017fb8f1e097ef6cf64e63da0d263e1fcca8cf6ab40a',
  'proposed-budgets.json': 'c1601e7d2abe704a45b25f332838c13babd85523cb6a935dad85e9ec48600d83',
  'samples.json': '357f3a69a90e7db2b15c2bc1b8e6627a06866fbee3d29d47c5ad2ffb5be4806e',
  'summary.json': '2bcc9c6322cc89e5a2e238abbbe4911428e45722f6435fa8abc5eecb2e7934b3',
});

const TICKET = 'FE-01';
const PERFORMANCE = 'PF-01';
const RUN_ID = '20260811T112008912Z-p30755-000';
const RUN_PATH = `.artifacts/performance/PF-01/${RUN_ID}`;
const EVIDENCE_COMMIT = 'ef1fd9823d286616ed108576c543b6f4980b5fcd';
const BUDGET_PATH = 'performance/budgets/pf-01.budgets.json';
const DESCRIPTOR_PATH = 'performance/descriptors/pf-01.catalog-browse.json';
const BASELINE_RUN_ID = '20260811T110951832Z-p22774-000';
const BASELINE_COMMIT = 'a5f6a640e0d0b7a560461e40d45ce2e06557e06d';
const WAIVER_SCOPE =
  '本次继续授权性能通过，仅该精确失败 accepted-with-waiver，不泛化、不改自动FAIL/预算/阈值/方法、不重采样。';
const REQUIRED_ARTIFACTS = Object.keys(FE01_PF01_ACTIVE_WAIVER_ARTIFACT_SHA256);
const RECORD_KEYS = [
  'schemaVersion',
  'kind',
  'recordDigest',
  'ticket',
  'performance',
  'manualDisposition',
  'scope',
  'automaticResult',
  'budget',
  'baseline',
  'current',
  'attestation',
  'artifactSha256',
];
const AUTOMATIC_RESULT_KEYS = [
  'status',
  'exitCode',
  'runId',
  'run',
  'commit',
  'worktreeDirty',
  'violation',
];
const VIOLATION = Object.freeze({
  metric: 'pf01.search.results_visible',
  statistic: 'p95',
  observedMs: 11.645,
  thresholdMs: 10,
  deltaMs: 1.645,
});
const EXPECTED_ATTESTATION = Object.freeze({
  descriptorDigest: 'ac6354a0976831863eeec8c50a523843e42f4084b3be49d417e586013f004c39',
  fixture: {
    path: 'fixtures/fx-01/native-root',
    sha256: 'ccaaf3161f651e22968d2ff6b32f4e0d06d108a18ed63977930a4ff27eab9519',
  },
  buildInputs: {
    schemaVersion: 2,
    algorithm: 'pf01-l3-harness-build-inputs-v2',
    digest: '83a541cb9674b51e31726e1d82de9ea1faa9d109df7a15bef00a7b2a490d8d0e',
    entryCount: 43,
  },
  measurementInputs: {
    schemaVersion: 2,
    algorithm: 'pf01-measurement-inputs-v2',
    digest: '1421b2eba2043f8098454e0d7d7e2178ce5d2c0b16f0260125a2f878b21de1d7',
    entryCount: 33,
    l2DevModuleGraph: {
      schemaVersion: 1,
      algorithm: 'pf01-l2-vite-dev-module-graph-v1',
      entry: 'tests/l2/workbench.html',
      moduleCount: 12,
      declaredEqualsActual: true,
      evidenceSha256: '3ea6cafc107cb11c0f0e92e625dfbbbac4f3fc5fd463d10f1b1efac625985ff7',
    },
  },
  runner: {
    node: 'v24.18.0',
    npm: '11.16.0',
    platform: 'darwin',
    release: '25.6.0',
    macosProductVersion: '26.6.1',
    arch: 'arm64',
  },
  toolchain: {
    cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)',
    rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)',
  },
  buildEnvironment: {
    policy: 'no ambient VITE_/TAURI_/CARGO_/Rust/SDK/Node build overrides or root .env files',
    overrides: [],
  },
  resources: { metric: 'pf01.l3.peak_rss_bytes', normalExitCount: 3, rawPeakCount: 3 },
});
const BASELINE_ARTIFACT_SHA256 =
  'df276a9be237e4f9b9454f0baed09a3ac38096eda75094586f7617a60fa0309b';
const CURRENT_ARTIFACT_SHA256 =
  'f27507f683d36b6d50e3a5e7bd6bd4e2e03f7c65fe556c82514b8029135d0e6c';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasExactKeys(value, expected) {
  return isObject(value) && sameJson(Object.keys(value).sort(), [...expected].sort());
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function gitText(commit, relativePath, repoRoot) {
  return execFileSync('git', ['show', `${commit}:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function gitJson(commit, relativePath, repoRoot) {
  return JSON.parse(gitText(commit, relativePath, repoRoot));
}

function percentile(sorted, p) {
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return Math.round((sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)) * 1000) / 1000;
}

function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || !samples.every(Number.isFinite)) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function expectedMetricStats(samples, metric) {
  const stats = summarize(samples);
  const counts = {
    'pf01.startup.first_list_visible': 5,
    'pf01.search.results_visible': 20,
    'pf01.filter.results_visible': 20,
    'pf01.select.skill_cells_visible': 20,
    'pf01.l3.cold_start.first_snapshot': 3,
  };
  if (stats === null || stats.n !== counts[metric]) return null;
  return {
    ...stats,
    minSamples: counts[metric],
    complete: true,
    unit: 'ms',
    layer:
      metric === 'pf01.l3.cold_start.first_snapshot'
        ? 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）'
        : 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
  };
}

function compareAgainstBudget(budget, metrics) {
  const entries = new Map((budget?.budgets ?? []).map((entry) => [entry.metric, entry]));
  const violations = [];
  for (const metric of PF01_TIMING_METRICS) {
    const stats = metrics[metric];
    const entry = entries.get(metric);
    if (stats === undefined || entry === undefined) return null;
    if (stats.p95 > entry.absoluteCeilingMs) {
      violations.push({
        metric,
        statistic: 'p95',
        observedMs: stats.p95,
        thresholdMs: entry.absoluteCeilingMs,
        deltaMs: Math.round((stats.p95 - entry.absoluteCeilingMs) * 1000) / 1000,
      });
    }
    const thresholdMs = entry.baseline.p50 * entry.regressionAllowance.maxRatio;
    if (stats.p50 > thresholdMs) {
      violations.push({
        metric,
        statistic: 'p50',
        observedMs: stats.p50,
        thresholdMs,
        deltaMs: Math.round((stats.p50 - thresholdMs) * 1000) / 1000,
      });
    }
  }
  return violations;
}

function canonicalRecordDigest(record) {
  const canonical = JSON.parse(JSON.stringify(record));
  canonical.recordDigest.value = '';
  return sha256Text(`${JSON.stringify(canonical)}\n`);
}

function exactRecord(record) {
  return (
    hasExactKeys(record, RECORD_KEYS) &&
    record.schemaVersion === 1 &&
    record.kind === 'fe-01-pf-01-active-exact-performance-waiver' &&
    hasExactKeys(record.recordDigest, ['algorithm', 'canonicalization', 'value']) &&
    record.recordDigest.algorithm === 'sha256' &&
    record.recordDigest.canonicalization ===
      'JSON.stringify(record with recordDigest.value set to an empty string) plus newline' &&
    isSha256(record.recordDigest.value) &&
    record.recordDigest.value === canonicalRecordDigest(record) &&
    record.ticket === TICKET &&
    record.performance === PERFORMANCE &&
    record.manualDisposition === 'accepted-with-waiver' &&
    record.scope === WAIVER_SCOPE &&
    hasExactKeys(record.automaticResult, AUTOMATIC_RESULT_KEYS) &&
    record.automaticResult.status === 'fail' &&
    record.automaticResult.exitCode === 1 &&
    record.automaticResult.runId === RUN_ID &&
    record.automaticResult.run === RUN_PATH &&
    record.automaticResult.commit === EVIDENCE_COMMIT &&
    record.automaticResult.worktreeDirty === false &&
    sameJson(record.automaticResult.violation, VIOLATION) &&
    sameJson(record.budget, {
      path: BUDGET_PATH,
      sha256: 'fb188a8a32e27d69bed2a2920262e527121ca1578f290608cf0219a09fbc349a',
    }) &&
    sameJson(record.baseline, {
      runId: BASELINE_RUN_ID,
      run: `.artifacts/performance/PF-01/${BASELINE_RUN_ID}`,
      commit: BASELINE_COMMIT,
      artifact: {
        declaredBinarySha256: BASELINE_ARTIFACT_SHA256,
        actualBinarySha256: BASELINE_ARTIFACT_SHA256,
      },
    }) &&
    sameJson(record.current, {
      artifact: {
        declaredBinarySha256: CURRENT_ARTIFACT_SHA256,
        actualBinarySha256: CURRENT_ARTIFACT_SHA256,
      },
    }) &&
    sameJson(record.attestation, EXPECTED_ATTESTATION) &&
    isObject(record.artifactSha256) &&
    sameJson(Object.keys(record.artifactSha256).sort(), REQUIRED_ARTIFACTS) &&
    REQUIRED_ARTIFACTS.every(
      (file) => record.artifactSha256[file] === FE01_PF01_ACTIVE_WAIVER_ARTIFACT_SHA256[file],
    )
  );
}

function invalid(violations, message) {
  violations.push(message);
}

function sameInputAttestation(actual, expected, sourceKind, commit) {
  return (
    actual?.schemaVersion === expected.schemaVersion &&
    actual?.algorithm === expected.algorithm &&
    actual?.digest === expected.digest &&
    actual?.entries?.length === expected.entryCount &&
    actual?.source?.kind === sourceKind &&
    actual?.source?.commit === commit
  );
}

function sameArtifact(actual, expected) {
  return (
    actual?.declaredBinarySha256 === expected.declaredBinarySha256 &&
    actual?.actualBinarySha256 === expected.actualBinarySha256
  );
}

/** immutable comparison summary 必须证明整个 run 始终处于同一 clean evidence commit。 */
export function hasExactActiveWaiverRunIdentity(runIdentity) {
  return (
    hasExactKeys(runIdentity, [
      'startCommit',
      'startWorktreeDirty',
      'endCommit',
      'endWorktreeDirty',
      'consistent',
    ]) &&
    runIdentity.startCommit === EVIDENCE_COMMIT &&
    runIdentity.startWorktreeDirty === false &&
    runIdentity.endCommit === EVIDENCE_COMMIT &&
    runIdentity.endWorktreeDirty === false &&
    runIdentity.consistent === true
  );
}

function verifySummaryProvenance({ record, summary, budget, l2DevModuleGraph }) {
  const baseline = summary?.comparisonProvenance?.baseline;
  const current = summary?.comparisonProvenance?.current;
  const expected = record.attestation;
  const baselineExpected = budget?.baselineProvenance;
  return (
    hasExactKeys(summary?.comparisonProvenance, ['baseline', 'current']) &&
    hasExactKeys(baseline, [
      'run',
      'collectedAt',
      'commit',
      'worktreeDirty',
      'artifact',
      'fixture',
      'buildInputs',
      'measurementInputs',
      'runner',
      'toolchain',
    ]) &&
    baseline.run === record.baseline.run &&
    baseline.commit === record.baseline.commit &&
    baseline.worktreeDirty === false &&
    sameArtifact(baseline.artifact, record.baseline.artifact) &&
    sameJson(baseline.fixture, expected.fixture) &&
    sameInputAttestation(
      baseline.buildInputs,
      expected.buildInputs,
      'git-object-tree',
      BASELINE_COMMIT,
    ) &&
    sameInputAttestation(
      baseline.measurementInputs,
      expected.measurementInputs,
      'git-object-tree',
      BASELINE_COMMIT,
    ) &&
    sameJson(baseline.runner, expected.runner) &&
    sameJson(baseline.toolchain, expected.toolchain) &&
    sameJson(
      {
        run: baseline.run,
        collectedAt: baseline.collectedAt,
        commit: baseline.commit,
        worktreeDirty: baseline.worktreeDirty,
        artifact: baseline.artifact,
        fixture: baseline.fixture,
        buildInputs: baseline.buildInputs,
        measurementInputs: baseline.measurementInputs,
        runner: baseline.runner,
        toolchain: baseline.toolchain,
      },
      {
        run: baselineExpected?.run,
        collectedAt: baselineExpected?.collectedAt,
        commit: baselineExpected?.commit,
        worktreeDirty: baselineExpected?.worktreeDirty,
        artifact: baselineExpected?.artifact,
        fixture: baselineExpected?.fixture,
        buildInputs: baselineExpected?.buildInputs,
        measurementInputs: baselineExpected?.measurementInputs,
        runner: baselineExpected?.runner,
        toolchain: baselineExpected?.toolchain,
      },
    ) &&
    hasExactKeys(current, [
      'artifact',
      'fixture',
      'buildInputs',
      'measurementInputs',
      'runner',
      'toolchain',
      'buildEnvironment',
    ]) &&
    sameArtifact(current.artifact, record.current.artifact) &&
    sameJson(current.fixture, expected.fixture) &&
    sameInputAttestation(current.buildInputs, expected.buildInputs, 'clean-tracked-checkout', EVIDENCE_COMMIT) &&
    sameInputAttestation(
      current.measurementInputs,
      expected.measurementInputs,
      'clean-tracked-checkout',
      EVIDENCE_COMMIT,
    ) &&
    sameJson(current.measurementInputs.l2DevModuleGraph, l2DevModuleGraph) &&
    sameJson(current.runner, expected.runner) &&
    sameJson(current.toolchain, expected.toolchain) &&
    sameJson(current.buildEnvironment, expected.buildEnvironment)
  );
}

/** 当前 waiver 的 performance step metadata；它明确不启动 perf sampling。 */
export function activePf01StepMetadata(validation) {
  return {
    executionMode: 'historical-artifact-validation',
    samplingRun: false,
    historicalRunId: validation?.automaticResult?.runId ?? null,
    initialWaiverValidation: validation?.valid === true ? 'valid' : 'invalid',
  };
}

/**
 * 从指定 physical immutable run、evidence commit 的 Git object 和 raw samples 逐项复算。
 * 该 public seam 不接受任意 ticket/run override；record 或路径的任一漂移都 fail-closed。
 */
export function validateFe01Pf01ActiveWaiver({ repoRoot = REPO_ROOT, waiver = undefined } = {}) {
  const violations = [];
  const recordPath = path.join(repoRoot, FE01_PF01_ACTIVE_WAIVER_PATH);
  const runDirectory = path.join(repoRoot, RUN_PATH);
  if (!hasPhysicalPath(repoRoot, recordPath) || !hasPhysicalPath(repoRoot, runDirectory)) {
    return { valid: false, violations: ['active waiver record 或 immutable run 不是 physical containment path'] };
  }

  let record;
  try {
    record = waiver ?? readJson(recordPath);
  } catch {
    return { valid: false, violations: ['active waiver record 无法读取'] };
  }
  if (sha256File(recordPath) !== FE01_PF01_ACTIVE_WAIVER_SHA256) {
    return { valid: false, violations: ['active waiver record SHA-256 不匹配'] };
  }
  if (!exactRecord(record)) {
    return { valid: false, violations: ['active waiver record 不是唯一已授权的 exact disposition'] };
  }

  let fileNames;
  try {
    const runStats = fs.lstatSync(runDirectory);
    if (!runStats.isDirectory() || runStats.isSymbolicLink()) {
      return { valid: false, violations: ['active waiver immutable run 必须是实际目录'] };
    }
    fileNames = fs.readdirSync(runDirectory).sort();
  } catch {
    return { valid: false, violations: ['active waiver immutable run 不存在'] };
  }
  if (!sameJson(fileNames, REQUIRED_ARTIFACTS)) {
    return { valid: false, violations: ['active waiver artifact 文件集合不精确或存在 contamination file'] };
  }
  for (const file of REQUIRED_ARTIFACTS) {
    const artifactPath = path.join(runDirectory, file);
    try {
      const stats = fs.lstatSync(artifactPath);
      if (!hasPhysicalPath(repoRoot, artifactPath) || !stats.isFile() || stats.isSymbolicLink()) {
        invalid(violations, `${file} 不是 physical regular artifact`);
        continue;
      }
      if (sha256File(artifactPath) !== record.artifactSha256[file]) {
        invalid(violations, `${file} SHA-256 与 active waiver record 不匹配`);
      }
      if (!scanEvidenceText(fs.readFileSync(artifactPath, 'utf8')).clean) {
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
  let l2DevModuleGraph;
  let budget;
  let descriptor;
  try {
    summary = readJson(path.join(runDirectory, 'summary.json'));
    samples = readJson(path.join(runDirectory, 'samples.json'));
    l3Samples = readJson(path.join(runDirectory, 'l3-samples.json'));
    resourceRuns = readJson(path.join(runDirectory, 'l3-resource-runs.json'));
    l2DevModuleGraph = readPf01L2ViteDevModuleGraph(
      path.join(runDirectory, 'l2-dev-module-graph.json'),
    );
    budget = gitJson(EVIDENCE_COMMIT, BUDGET_PATH, repoRoot);
    descriptor = gitJson(EVIDENCE_COMMIT, DESCRIPTOR_PATH, repoRoot);
  } catch {
    return { valid: false, violations: ['active waiver artifact 或 evidence-commit Git object 无法解析'] };
  }

  try {
    if (sha256Text(gitText(EVIDENCE_COMMIT, BUDGET_PATH, repoRoot)) !== record.budget.sha256) {
      invalid(violations, 'evidence-commit frozen budget SHA-256 不匹配');
    }
    const descriptorText = gitText(EVIDENCE_COMMIT, DESCRIPTOR_PATH, repoRoot);
    const descriptorDigest = descriptor?.digest?.value;
    if (
      descriptorDigest !== record.attestation.descriptorDigest ||
      sha256Text(descriptorText.replace(`"value": "${descriptorDigest}"`, '"value": ""')) !==
        descriptorDigest
    ) {
      invalid(violations, 'evidence-commit descriptor digest 不匹配');
    }
  } catch {
    invalid(violations, 'evidence-commit budget 或 descriptor digest 无法复算');
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
    summary?.descriptorDigest !== record.attestation.descriptorDigest ||
    !hasExactActiveWaiverRunIdentity(summary?.runIdentity) ||
    summary?.contamination !== undefined
  ) {
    invalid(violations, 'summary 不是完整 clean 的 PF-01 budget comparison artifact');
  }

  const merged = { ...(samples?.metrics ?? {}), ...(l3Samples?.metrics ?? {}) };
  const expectedMetrics = {};
  for (const metric of PF01_TIMING_METRICS) {
    const stats = expectedMetricStats(merged[metric]?.samples, metric);
    if (stats === null) {
      invalid(violations, `${metric} raw samples 不完整`);
      continue;
    }
    expectedMetrics[metric] = stats;
    if (!sameJson(summary?.metrics?.[metric], stats)) {
      invalid(violations, `${metric} summary 与 raw samples 不一致`);
    }
  }
  if (!sameJson(Object.keys(summary?.metrics ?? {}).sort(), [...PF01_TIMING_METRICS].sort())) {
    invalid(violations, 'summary metric 集合不精确');
  }

  try {
    const resourceEvidence = finalizeHarnessPeakRss(resourceRuns?.runs);
    if (!validatePf01ResourceEvidence(resourceEvidence).valid) throw new Error('resource schema');
    if (!sameJson(summary?.resources, { status: 'collected', ...resourceEvidence })) {
      throw new Error('resource summary mismatch');
    }
    if (
      resourceRuns?.runs?.length !== record.attestation.resources.normalExitCount ||
      resourceRuns.runs.some((run) => run?.normalExit !== true) ||
      resourceEvidence.rawPeakBytes.length !== record.attestation.resources.rawPeakCount
    ) {
      throw new Error('resource normal exit mismatch');
    }
  } catch {
    invalid(violations, 'L3 RSS resource evidence/normalExit 不完整或与 raw run 不一致');
  }

  try {
    const baselineBuildInputs = collectPf01L3HarnessBuildInputsFromGit({
      repoRoot,
      commit: BASELINE_COMMIT,
    });
    const baselineMeasurementInputs = collectPf01MeasurementInputsFromGit({
      repoRoot,
      commit: BASELINE_COMMIT,
      l2DevModuleGraph,
    });
    const currentBuildInputs = collectPf01L3HarnessBuildInputsFromGit({
      repoRoot,
      commit: EVIDENCE_COMMIT,
    });
    const currentMeasurementInputs = collectPf01MeasurementInputsFromGit({
      repoRoot,
      commit: EVIDENCE_COMMIT,
      l2DevModuleGraph,
    });
    const provenance = summary?.comparisonProvenance;
    if (
      !sameJson(baselineBuildInputs, provenance?.baseline?.buildInputs) ||
      !sameJson(baselineMeasurementInputs, provenance?.baseline?.measurementInputs) ||
      !sameJson(currentBuildInputs.entries, provenance?.current?.buildInputs?.entries) ||
      currentBuildInputs.digest !== provenance?.current?.buildInputs?.digest ||
      !sameJson(currentMeasurementInputs.entries, provenance?.current?.measurementInputs?.entries) ||
      currentMeasurementInputs.digest !== provenance?.current?.measurementInputs?.digest
    ) {
      invalid(violations, 'build/measurement inputs 无法从 immutable Git object 复算');
    }
  } catch {
    invalid(violations, 'build/measurement input Git object 无法复算');
  }

  if (!verifySummaryProvenance({ record, summary, budget, l2DevModuleGraph })) {
    invalid(violations, 'summary provenance 与 active waiver binding 不精确');
  }
  if (!validateFrozenPf01Budget(budget, descriptor, 'representative', summary?.comparisonProvenance?.current).valid) {
    invalid(violations, 'evidence-commit frozen budget/provenance 无效');
  }

  const comparison = compareAgainstBudget(budget, expectedMetrics);
  if (comparison === null || comparison.length !== 1 || !sameJson(comparison[0], VIOLATION)) {
    invalid(violations, 'raw samples 与 frozen budget 未能唯一复算授权的 search p95 failure');
  }
  if (violations.length > 0) return { valid: false, violations };

  return {
    valid: true,
    violations: [],
    waiverPath: FE01_PF01_ACTIVE_WAIVER_PATH,
    waiverSha256: FE01_PF01_ACTIVE_WAIVER_SHA256,
    manualDisposition: record.manualDisposition,
    automaticResult: {
      ...record.automaticResult,
      artifactDirectory: record.automaticResult.run,
      artifactSha256: record.artifactSha256,
    },
  };
}
