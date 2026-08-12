/**
 * FE-01 Scheme B 的唯一 subject-bound PF-01 manual disposition。
 *
 * 只重读 immutable historical artifacts 和对应 Git objects；绝不启动 PF sampling，
 * 也不读取/升级旧 waiver record。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNoGitAmbient,
  REPO_ROOT,
  scanEvidenceText,
  sha256File,
  sha256Text,
} from './lib.mjs';
import {
  collectPf01L3HarnessBuildInputsFromGit,
  PF01_BUILD_ENVIRONMENT,
} from './pf01-build-inputs.mjs';
import { collectPf01MeasurementInputsFromGitV4 } from './pf01-measurement-inputs.mjs';
import { PF01_BUDGET_CONSTANTS, PF01_TIMING_METRICS } from './pf01-budget.mjs';
import { finalizeHarnessPeakRss, validatePf01ResourceEvidence } from './pf01-resource.mjs';
import {
  PF01_HISTORICAL_BASELINE_IDENTITY,
  validatePf01FrozenBaselineBinding,
} from './pf01-baseline-freeze.mjs';
import { hasPhysicalPath } from './clean-evidence-index.mjs';

export const FE01_PF01_SUBJECT_WAIVER_PATH =
  'performance/waivers/fe-01-pf-01-subject-startup-p50.json';
export const FE01_PF01_SUBJECT_WAIVER_SHA256 =
  'e18bd6f7fa532c5987342208305d6fa254a0c16cb12770176f21558768da1aaa';
export const FE01_PF01_SUBJECT_WAIVER_MODE = 'historical-subject-waiver-validation';

const TICKET = 'FE-01';
const PERFORMANCE = 'PF-01';
const BASELINE = Object.freeze({
  runId: '20260812T033832054Z-p69961-000',
  commit: '114298a619af40d00941efec4c959e0b13d6be83',
});
const SUBJECT = Object.freeze({
  runId: '20260812T035717854Z-p74069-000',
  commit: '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf',
});
const BUDGET_PATH = 'performance/budgets/pf-01.budgets.json';
const FREEZE_PATH = 'performance/budgets/pf-01.freeze.json';
const DESCRIPTOR_PATH = 'performance/descriptors/pf-01.catalog-browse.json';
const REQUIRED_ARTIFACTS = Object.freeze([
  'harness-identity.json',
  'l2-dev-module-graph.json',
  'l3-resource-runs.json',
  'l3-samples.json',
  'proposed-budgets.json',
  'samples.json',
  'summary.json',
]);
const L3_METRIC = 'pf01.l3.cold_start.first_snapshot';
const L2_METRICS = PF01_TIMING_METRICS.filter((metric) => metric !== L3_METRIC);
const EXPECTED_VIOLATION = Object.freeze({
  metric: 'pf01.startup.first_list_visible',
  statistic: 'p50',
  observedMs: 16.2,
  thresholdMs: 15.75,
  deltaMs: 0.45,
});
const AUTHORIZATION = Object.freeze({
  scope:
    '仅此 FE-01 subject historical PF-01 自动 numeric latency fail；不改变 automatic fail/exit 1、预算、阈值、方法或历史 artifact，不泛化、不复用。',
  policy: '仅精确 numeric latency violation 可有显式人工 disposition；hard gate 不可 waive；不得称为 automatic PASS。',
});
const EXPECTED_ARTIFACTS = Object.freeze({
  baseline: Object.freeze({
    'harness-identity.json': '3891b51343ccafac74b0e276c5d7ce4b14a8fa5d5b4fe2375a30516d01649428',
    'l2-dev-module-graph.json': '76a326c12b8a71313aa7761f90832bddab4e88eb074ae78ac0fc0b0cc2973d52',
    'l3-resource-runs.json': '328a1ea5165254f5448dde0bdb74ace477e07c27158fd39b125545a828c6f811',
    'l3-samples.json': '4216561dd02728c5c2b346e41d4d444d9cb6c2d199cfc29c05599369a94f13f8',
    'proposed-budgets.json': '702d9f808e237c32ffab90fb264490d9174d541490cd4551d2800f84eafc16f8',
    'samples.json': 'f7d447ad63efa09d98118b26ab72e7905f9623f562152fb4dea89613cafcd808',
    'summary.json': '1b4c9c931adf43b0982fff2a57d60fbd528d654a10ad46a72f034239c0e4ca4c',
  }),
  subject: Object.freeze({
    'harness-identity.json': 'daa6b56d8e17867f924c9477e463e0630c83741e53d069daba468a09c4758b52',
    'l2-dev-module-graph.json': '76a326c12b8a71313aa7761f90832bddab4e88eb074ae78ac0fc0b0cc2973d52',
    'l3-resource-runs.json': '621103df8e4bd11926a91a8909442c1edf0b6ea0310da93ca2cc765c847616d9',
    'l3-samples.json': '51d6026a114eb8c7aea66fa0f4899e27f3441697ff8e394fb8ed2eeacd5422d7',
    'proposed-budgets.json': '1f5dd1295320675808b969499473c41dda78c9b3f9b9ea572c011295a2f52842',
    'samples.json': '396b16ab3341026472773f5e92ab8751a304a69dd78e1b6d598a3a1e692fddb7',
    'summary.json': '703f5c523571ebf0d7f7264035d88bcf2521bbdeb5c3e03298e62929ef4cad5d',
  }),
});
const MEASUREMENT_CONTRACT = Object.freeze({
  descriptorPath: DESCRIPTOR_PATH,
  descriptorDigest: '1f21a9dad1128ca4482500e1556925a8d8af2468a64e83628e7274007aa28b9a',
  artifact: {
    identityPath: '.artifacts/test-harness/identity.json',
    kind: 'test-harness',
    identifier: 'com.agentconfigmanager.testharness',
    profile: 'debug',
    binary: 'src-tauri/target/debug/agent-config-manager',
    declaredBinarySha256: '29bb905638eb65f701f612d37ca0d17a41af1eb82377ddc401ae4115910a2390',
    actualBinarySha256: '29bb905638eb65f701f612d37ca0d17a41af1eb82377ddc401ae4115910a2390',
    provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
  },
  buildInputs: {
    schemaVersion: 4,
    algorithm: 'pf01-l3-harness-build-inputs-v4',
    digest: '580f2831fb7ac349a4b16cbe49fcfb37015db8265fb4f7096a9c3e55d0755238',
  },
  measurementInputs: {
    schemaVersion: 4,
    algorithm: 'pf01-measurement-inputs-v4',
    digest: '27991cd34d9f067a71a2985aaf9f6b6e23e5833adc05efa7767a5d8dcdb5b4bb',
    l2DevModuleGraphSha256: '76a326c12b8a71313aa7761f90832bddab4e88eb074ae78ac0fc0b0cc2973d52',
  },
  fixture: { path: 'fixtures/fx-01/native-root', sha256: 'ccaaf3161f651e22968d2ff6b32f4e0d06d108a18ed63977930a4ff27eab9519' },
  runner: { node: 'v24.18.0', npm: '11.16.0', platform: 'darwin', release: '25.6.0', macosProductVersion: '26.6.1', arch: 'arm64' },
  toolchain: { cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)', rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)' },
  buildEnvironment: PF01_BUILD_ENVIRONMENT,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function exactKeys(value, keys) {
  return isObject(value) && sameJson(Object.keys(value).sort(), [...keys].sort());
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function gitText(repoRoot, commit, relativePath) {
  assertNoGitAmbient();
  return execFileSync('git', ['show', `${commit}:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function canonicalDigest(value, field) {
  const copy = JSON.parse(JSON.stringify(value));
  copy[field].value = '';
  return sha256Text(`${JSON.stringify(copy, null, 2)}\n`);
}

function descriptorDigestFromGit(repoRoot, commit, violations) {
  try {
    const text = gitText(repoRoot, commit, DESCRIPTOR_PATH);
    const descriptor = JSON.parse(text);
    const digest = descriptor?.digest?.value;
    if (!isSha256(digest) || sha256Text(text.replace(`"value": "${digest}"`, '"value": ""')) !== digest) {
      violations.push(`${commit} descriptor digest invalid`);
      return null;
    }
    return digest;
  } catch {
    violations.push(`${commit} descriptor Git object unavailable`);
    return null;
  }
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

function expectedStats(metric, samples) {
  return {
    ...summarize(samples),
    minSamples: PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric],
    complete: true,
    unit: 'ms',
    layer: metric === L3_METRIC ? PF01_BUDGET_CONSTANTS.L3_LAYER : PF01_BUDGET_CONSTANTS.L2_LAYER,
  };
}

function rawSamples(payload, metrics, { profile, layer } = {}) {
  if (
    !isObject(payload) ||
    payload.schemaVersion !== 1 ||
    payload.descriptorId !== PERFORMANCE ||
    payload.unit !== 'ms' ||
    (profile !== undefined && payload.profile !== profile) ||
    (layer !== undefined && payload.layer !== layer) ||
    !isObject(payload.metrics) ||
    !sameJson(Object.keys(payload.metrics).sort(), [...metrics].sort())
  ) {
    throw new Error('raw timing schema/profile/metric set invalid');
  }
  const result = {};
  for (const metric of metrics) {
    const values = payload.metrics[metric]?.samples;
    if (
      !Array.isArray(values) ||
      values.length !== PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric] ||
      !values.every(isPositiveNumber)
    ) {
      throw new Error(`raw timing samples invalid: ${metric}`);
    }
    result[metric] = values;
  }
  return result;
}

function validateRunIdentity(summary, expected, violations) {
  const identity = summary?.runIdentity;
  if (
    !exactKeys(identity, ['startCommit', 'startWorktreeDirty', 'endCommit', 'endWorktreeDirty', 'consistent']) ||
    identity.startCommit !== expected.commit ||
    identity.endCommit !== expected.commit ||
    identity.startWorktreeDirty !== false ||
    identity.endWorktreeDirty !== false ||
    identity.consistent !== true
  ) {
    violations.push(`${expected.runId} dirty or inconsistent run identity`);
  }
  if (!sameJson(summary?.contamination, { schemaVersion: 1, syntheticSecretHits: 0, personalPathHits: 0 })) {
    violations.push(`${expected.runId} contaminated evidence`);
  }
}

function validateArtifactSet({ repoRoot, run, hashes, violations }) {
  const directory = path.join(repoRoot, '.artifacts', 'performance', PERFORMANCE, run.runId);
  if (!hasPhysicalPath(repoRoot, directory)) {
    violations.push(`${run.runId} artifact directory is not physical`);
    return null;
  }
  let names;
  try {
    const stats = fs.lstatSync(directory);
    names = fs.readdirSync(directory).sort();
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error();
  } catch {
    violations.push(`${run.runId} artifact directory unreadable`);
    return null;
  }
  if (!sameJson(names, REQUIRED_ARTIFACTS)) {
    violations.push(`${run.runId} artifact set has extra or missing files`);
    return null;
  }
  if (!exactKeys(hashes, REQUIRED_ARTIFACTS)) {
    violations.push(`${run.runId} artifact hash binding invalid`);
    return null;
  }
  const artifacts = {};
  for (const file of REQUIRED_ARTIFACTS) {
    const filePath = path.join(directory, file);
    try {
      const stats = fs.lstatSync(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || !hasPhysicalPath(repoRoot, filePath)) {
        throw new Error();
      }
      if (sha256File(filePath) !== hashes[file]) {
        violations.push(`${run.runId}/${file} SHA-256 mismatch`);
      }
      const text = fs.readFileSync(filePath, 'utf8');
      if (!scanEvidenceText(text).clean) violations.push(`${run.runId}/${file} contaminated`);
      artifacts[file] = JSON.parse(text);
    } catch {
      violations.push(`${run.runId}/${file} is not a physical JSON artifact`);
    }
  }
  return Object.keys(artifacts).length === REQUIRED_ARTIFACTS.length ? artifacts : null;
}

function validHarnessArtifact(value) {
  return (
    isObject(value) &&
    value.identityPath === '.artifacts/test-harness/identity.json' &&
    value.kind === 'test-harness' &&
    value.profile === 'debug' &&
    typeof value.identifier === 'string' &&
    typeof value.binary === 'string' &&
    isSha256(value.declaredBinarySha256) &&
    value.declaredBinarySha256 === value.actualBinarySha256
  );
}

function validateInputs({ repoRoot, commit, current, graph, contract, violations, label }) {
  try {
    const buildInputs = collectPf01L3HarnessBuildInputsFromGit({ repoRoot, commit });
    const measurementInputs = collectPf01MeasurementInputsFromGitV4({
      repoRoot,
      commit,
      l2DevModuleGraph: graph,
    });
    if (
      current?.buildInputs?.digest !== buildInputs.digest ||
      !sameJson(current?.buildInputs?.entries, buildInputs.entries) ||
      current?.measurementInputs?.digest !== measurementInputs.digest ||
      !sameJson(current?.measurementInputs?.entries, measurementInputs.entries) ||
      !sameJson(current?.measurementInputs?.l2DevModuleGraph, graph) ||
      buildInputs.digest !== contract.buildInputs.digest ||
      measurementInputs.digest !== contract.measurementInputs.digest ||
      !sameJson(current?.buildEnvironment, contract.buildEnvironment)
    ) {
      violations.push(`${label} build/measurement/graph/environment drift`);
    }
  } catch {
    violations.push(`${label} Git-object inputs unavailable`);
  }
}

function validateRun({ repoRoot, run, artifacts, contract, expectedDescriptorDigest, violations }) {
  if (artifacts === null) return null;
  const summary = artifacts['summary.json'];
  const harness = artifacts['harness-identity.json']?.artifact;
  const current = summary?.comparisonProvenance?.current;
  const graph = artifacts['l2-dev-module-graph.json'];
  validateRunIdentity(summary, run, violations);
  if (
    summary?.descriptorId !== PERFORMANCE ||
    summary?.descriptorDigest !== expectedDescriptorDigest ||
    summary?.profile !== 'representative' ||
    !validHarnessArtifact(harness) ||
    !sameJson(harness, current?.artifact) ||
    !sameJson(current?.fixture, contract.fixture) ||
    !sameJson(current?.runner, contract.runner) ||
    !sameJson(current?.toolchain, contract.toolchain)
  ) {
    violations.push(`${run.runId} descriptor/SUT/fixture/runtime/toolchain attestation invalid`);
  }
  validateInputs({
    repoRoot,
    commit: run.commit,
    current,
    graph,
    contract,
    violations,
    label: run.runId,
  });
  let metrics;
  try {
    const samples = {
      ...rawSamples(artifacts['samples.json'], L2_METRICS, { profile: 'representative' }),
      ...rawSamples(artifacts['l3-samples.json'], [L3_METRIC], {
        layer: 'L3 test-harness debug（非 release-like artifact）',
      }),
    };
    metrics = Object.fromEntries(
      PF01_TIMING_METRICS.map((metric) => [metric, expectedStats(metric, samples[metric])]),
    );
    if (!sameJson(summary?.metrics, metrics)) violations.push(`${run.runId} raw timing stats mismatch`);
  } catch (error) {
    violations.push(error instanceof Error ? `${run.runId} ${error.message}` : `${run.runId} raw timing invalid`);
  }
  try {
    const resource = finalizeHarnessPeakRss(artifacts['l3-resource-runs.json']?.runs);
    if (!validatePf01ResourceEvidence(resource).valid || !sameJson(summary?.resources, { status: 'collected', ...resource })) {
      violations.push(`${run.runId} normalExit/RSS evidence invalid`);
    }
  } catch {
    violations.push(`${run.runId} normalExit/RSS evidence invalid`);
  }
  return { summary, metrics };
}

function deriveBudgetViolations(budget, metrics) {
  const entries = new Map((budget?.budgets ?? []).map((entry) => [entry?.metric, entry]));
  const violations = [];
  for (const metric of PF01_TIMING_METRICS) {
    const entry = entries.get(metric);
    const stats = metrics?.[metric];
    if (!entry || !stats) return null;
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

export function isExactFe01Pf01SubjectWaiverRecord(record) {
  return (
    exactKeys(record, [
      'schemaVersion',
      'kind',
      'recordDigest',
      'ticket',
      'performance',
      'manualDisposition',
      'authorization',
      'automaticResult',
      'budget',
      'baseline',
      'measurementContract',
      'artifacts',
      'performanceDebt',
    ]) &&
    record.schemaVersion === 1 &&
    record.kind === 'fe-01-pf-01-subject-startup-p50-exact-performance-waiver' &&
    record.ticket === TICKET &&
    record.performance === PERFORMANCE &&
    record.manualDisposition === 'accepted-with-waiver' &&
    exactKeys(record.recordDigest, ['algorithm', 'canonicalization', 'value']) &&
    record.recordDigest?.algorithm === 'sha256' &&
    record.recordDigest?.canonicalization ===
      '将本文件 recordDigest.value 置为空字符串后对文件原始字节求 sha256；由 FE-01 waiver validator 复算' &&
    isSha256(record.recordDigest?.value) &&
    record.recordDigest.value === canonicalDigest(record, 'recordDigest') &&
    exactKeys(record.authorization, ['scope', 'policy']) &&
    sameJson(record.authorization, AUTHORIZATION) &&
    exactKeys(record.automaticResult, ['status', 'exitCode', 'runId', 'run', 'commit', 'worktreeDirty', 'violation']) &&
    record.automaticResult.status === 'fail' &&
    record.automaticResult.exitCode === 1 &&
    record.automaticResult.runId === SUBJECT.runId &&
    record.automaticResult.run === `.artifacts/performance/PF-01/${SUBJECT.runId}` &&
    record.automaticResult.commit === SUBJECT.commit &&
    record.automaticResult.worktreeDirty === false &&
    exactKeys(record.automaticResult.violation, ['metric', 'statistic', 'observedMs', 'thresholdMs', 'deltaMs']) &&
    sameJson(record.automaticResult.violation, EXPECTED_VIOLATION) &&
    exactKeys(record.budget, ['path', 'sha256', 'freezePath', 'freezeSha256']) &&
    record.budget.path === BUDGET_PATH &&
    record.budget.sha256 === '80461fdd8041f3247ec930dcfb4e77434fcc294465df9b299efae89fe15c7e87' &&
    record.budget.freezePath === FREEZE_PATH &&
    isSha256(record.budget.freezeSha256) &&
    exactKeys(record.baseline, ['runId', 'run', 'commit', 'worktreeDirty']) &&
    record.baseline.runId === BASELINE.runId &&
    record.baseline.run === `.artifacts/performance/PF-01/${BASELINE.runId}` &&
    record.baseline.commit === BASELINE.commit &&
    record.baseline.worktreeDirty === false &&
    sameJson(record.measurementContract, MEASUREMENT_CONTRACT) &&
    exactKeys(record.artifacts, ['baseline', 'subject']) &&
    sameJson(record.artifacts, EXPECTED_ARTIFACTS) &&
    exactKeys(record.performanceDebt, ['status', 'phase', 'rootCause', 'scope']) &&
    record.performanceDebt.status === 'deferred' &&
    record.performanceDebt.phase === 'post-optimization' &&
    record.performanceDebt.rootCause === 'unknown' &&
    record.performanceDebt.scope === '仅 startup p50 0.45ms 超出 frozen regression threshold；不掩盖 automatic fail。'
  );
}

/** 公开 seam：只验证这一次 subject-bound record；所有漂移 fail-closed。 */
export function validateFe01Pf01SubjectWaiver({ repoRoot = REPO_ROOT, waiver = undefined } = {}) {
  const violations = [];
  const recordPath = path.join(repoRoot, FE01_PF01_SUBJECT_WAIVER_PATH);
  let record;
  try {
    if (!hasPhysicalPath(repoRoot, recordPath)) throw new Error();
    record = waiver ?? readJson(recordPath);
  } catch {
    return { valid: false, violations: ['subject waiver record is not physical/readable'] };
  }
  if (sha256File(recordPath) !== FE01_PF01_SUBJECT_WAIVER_SHA256) {
    violations.push('subject waiver record SHA-256 mismatch');
  }
  if (!isExactFe01Pf01SubjectWaiverRecord(record)) violations.push('subject waiver record is not the exact authorized disposition');

  let freezer;
  try {
    const freezerPath = path.join(repoRoot, FREEZE_PATH);
    if (!hasPhysicalPath(repoRoot, freezerPath) || sha256File(freezerPath) !== record?.budget?.freezeSha256) {
      throw new Error();
    }
    freezer = readJson(freezerPath);
    if (
      freezer?.digest?.algorithm !== 'sha256' ||
      freezer.digest.value !== canonicalDigest(freezer, 'digest') ||
      !sameJson(freezer?.budget, { path: BUDGET_PATH, sha256: record?.budget?.sha256 }) ||
      freezer?.baseline?.runId !== BASELINE.runId ||
      freezer?.baseline?.commit !== BASELINE.commit ||
      !sameJson(freezer?.baseline?.measurementContract, record?.measurementContract)
    ) {
      throw new Error();
    }
  } catch {
    violations.push('frozen baseline/buildEnvironment binding invalid');
  }

  let budget;
  let budgetText;
  try {
    budgetText = gitText(repoRoot, SUBJECT.commit, BUDGET_PATH);
    if (
      sha256Text(budgetText) !== record?.budget?.sha256 ||
      sha256File(path.join(repoRoot, BUDGET_PATH)) !== record?.budget?.sha256
    ) {
      throw new Error();
    }
    budget = JSON.parse(budgetText);
  } catch {
    violations.push('frozen budget binding invalid');
  }

  const baselineDescriptorDigest = descriptorDigestFromGit(repoRoot, BASELINE.commit, violations);
  const subjectDescriptorDigest = descriptorDigestFromGit(repoRoot, SUBJECT.commit, violations);
  if (
    baselineDescriptorDigest !== record?.measurementContract?.descriptorDigest ||
    subjectDescriptorDigest !== record?.measurementContract?.descriptorDigest
  ) {
    violations.push('historical subject descriptor digest drift');
  }

  const baselineArtifacts = validateArtifactSet({
    repoRoot,
    run: BASELINE,
    hashes: record?.artifacts?.baseline,
    violations,
  });
  const baseline = validateRun({
    repoRoot,
    run: BASELINE,
    artifacts: baselineArtifacts,
    contract: record?.measurementContract ?? {},
    expectedDescriptorDigest: baselineDescriptorDigest,
    violations,
  });
  const subject = validateRun({
    repoRoot,
    run: SUBJECT,
    artifacts: validateArtifactSet({
      repoRoot,
      run: SUBJECT,
      hashes: record?.artifacts?.subject,
      violations,
    }),
    contract: record?.measurementContract ?? {},
    expectedDescriptorDigest: subjectDescriptorDigest,
    violations,
  });
  if (
    freezer !== undefined &&
    !validatePf01FrozenBaselineBinding({
      binding: freezer,
      budgetText,
      artifactSha256: record?.artifacts?.baseline,
      l2Samples: baselineArtifacts?.['samples.json'],
      l3Samples: baselineArtifacts?.['l3-samples.json'],
      resourceRuns: baselineArtifacts?.['l3-resource-runs.json'],
      expectedBaseline: PF01_HISTORICAL_BASELINE_IDENTITY,
    }).valid
  ) {
    violations.push('frozen baseline raw/artifact/budget binding drift');
  }
  if (baseline?.summary?.status !== 'baseline-collected / budget-not-frozen') {
    violations.push('baseline historical status invalid');
  }
  if (
    subject?.summary?.status !== 'budget-comparison' ||
    subject?.summary?.automatedResult?.status !== 'fail' ||
    subject?.summary?.automatedResult?.exitCode !== 1 ||
    subject?.summary?.budgetValidation?.valid !== true
  ) {
    violations.push('subject automatic fail/exit status invalid');
  }
  const budgetViolations = deriveBudgetViolations(budget, subject?.metrics);
  if (!sameJson(budgetViolations, [EXPECTED_VIOLATION])) {
    violations.push('subject raw stats do not produce the unique authorized violation');
  }

  if (violations.length > 0) return { valid: false, violations };
  return {
    valid: true,
    violations: [],
    waiverPath: FE01_PF01_SUBJECT_WAIVER_PATH,
    waiverSha256: FE01_PF01_SUBJECT_WAIVER_SHA256,
    manualDisposition: 'accepted-with-waiver',
    automaticResult: {
      ...record.automaticResult,
      automatedExitCode: 1,
      automatedExitCodeSource:
        'immutable subject artifact validation plus raw-samples/frozen-budget recomputation; no current perf sampling was started',
      artifactDirectory: record.automaticResult.run,
      artifactSha256: record.artifacts,
    },
    baseline: record.baseline,
    subject: { commit: SUBJECT.commit, runId: SUBJECT.runId },
    budget: record.budget,
    artifacts: record.artifacts,
    measurementContract: record.measurementContract,
    performanceDebt: record.performanceDebt,
  };
}

export function subjectPf01StepMetadata(validation) {
  return {
    executionMode: FE01_PF01_SUBJECT_WAIVER_MODE,
    samplingRun: false,
    historicalRunId: validation?.automaticResult?.runId ?? null,
    initialWaiverValidation: validation?.valid === true ? 'valid' : 'invalid',
  };
}
