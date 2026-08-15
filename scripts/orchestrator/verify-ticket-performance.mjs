/**
 * verify:ticket 的 PF-02/PF-03 evidence helpers。
 *
 * FE-01 继续使用其既有 singular performance/waiver seam；本模块仅服务
 * registry `performances[]`。读 PF closure evidence 必须先通过物理文件、
 * 当前 descriptor/fixture/measurement 重验，之后才可投影脱敏 metadata。
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertCurrentPfDescriptorDigest, REPO_ROOT, scanEvidenceText } from './lib.mjs';
import {
  comparePfReadPaths,
  evaluateReadPfEvidence,
  projectReadPfManifestResult,
} from './pf-read-evidence.mjs';
import { collectPfReadMeasurementInputs } from './pf-read-measurement-inputs.mjs';
import { readPfReadBaselineArtifactDigests } from './perf-read.mjs';

const REQUIRED_ARTIFACTS = Object.freeze([
  'samples.json',
  'fixture-attestation.json',
  'l2-dev-module-graph.json',
  'summary.json',
  'proposed-budgets.json',
]);
const READ_LAYER = 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）';
const SUBJECT_WAIVER_BUDGET_STATE =
  'historical-subject-waiver-validation（immutable automatic fail/exit 1；未启动当前 PF sampling）';
const SUBJECT_WAIVER_EXECUTION_MODE = 'historical-subject-waiver-validation';

function perfStepId(performance) {
  return `perf-${performance.descriptorId.toLowerCase().replace('-', '')}-${performance.profile}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isDigest(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(comparePfReadPaths)
      .map((key) => [key, canonicalJsonValue(value[key])]),
  );
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}

function safeRelative(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.normalize('NFC') &&
    !value.includes('\0') &&
    !value.includes('\\') &&
    !value.startsWith('/') &&
    !value.toLowerCase().includes('file:') &&
    value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}

function relativeUnder(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function physicalDirectoryChain(root, target) {
  if (!relativeUnder(root, target) && path.resolve(root) !== path.resolve(target)) {
    throw new Error('evidence path 越出 trusted root');
  }
  let current = path.resolve(root);
  const rootStat = fs.lstatSync(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('evidence root 必须是物理目录');
  }
  const relative = path.relative(current, target);
  for (const segment of relative.length === 0 ? [] : relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('evidence ancestry 必须全部为物理目录');
    }
  }
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  if (!relativeUnder(realRoot, realTarget) && realRoot !== realTarget) {
    throw new Error('evidence realpath 越出 trusted root');
  }
}

function physicalRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  return stat.isFile() && !stat.isSymbolicLink();
}

/** Recursively scan every physical regular file without exposing raw file names or content. */
export function scanNestedRegularEvidence({ root }) {
  if (!fs.existsSync(root)) {
    return { valid: false, contaminationNotes: ['performance: evidence directory 缺失'] };
  }
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { valid: false, contaminationNotes: ['performance: evidence root 必须是物理目录'] };
  }
  let contaminated = false;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      comparePfReadPaths(left.name, right.name),
    )) {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        contaminated = true;
      } else if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        if (!scanEvidenceText(fs.readFileSync(fullPath, 'utf8')).clean) contaminated = true;
      } else {
        contaminated = true;
      }
    }
  }
  walk(root);
  return {
    valid: !contaminated,
    contaminationNotes: contaminated ? ['performance: evidence scan rejected'] : [],
  };
}

function incompleteResult({ performance, step }) {
  const safeConfig =
    safeRelative(performance?.descriptorPath) && safeRelative(performance?.evidenceRelativeDir);
  return {
    pfId: performance?.descriptorId === 'PF-02' || performance?.descriptorId === 'PF-03' ? performance.descriptorId : 'unknown',
    profile:
      performance?.profile === 'representative' || performance?.profile === 'stress'
        ? performance.profile
        : 'unknown',
    step: {
      id: typeof step?.id === 'string' ? step.id : 'unknown',
      exitCode: Number.isInteger(step?.exitCode) ? step.exitCode : 2,
      status: typeof step?.status === 'string' ? step.status : 'inconclusive',
    },
    descriptor: { path: safeConfig ? performance.descriptorPath : 'unknown', digest: 'unknown' },
    fixtureDigest: 'unknown',
    metrics: [],
    summaryRelativePath: safeConfig ? `${performance.evidenceRelativeDir}/summary.json` : 'unknown',
    budgetState: 'budget-not-evaluated（PF evidence 不完整）',
    validation: { valid: false },
    budgetValidation: { status: 'not-created' },
    runner: {},
    toolchain: {},
    measurementInputDigest: 'unknown',
  };
}

function readProfileArtifacts({ evidenceRoot, performance }) {
  if (
    !safeRelative(performance?.descriptorPath) ||
    !safeRelative(performance?.budgetPath) ||
    !safeRelative(performance?.evidenceRelativeDir)
  ) {
    throw new Error('read PF registry evidence path 无效');
  }
  const profileDir = path.resolve(evidenceRoot, performance.evidenceRelativeDir);
  if (!relativeUnder(evidenceRoot, profileDir)) throw new Error('read PF profile evidence 越界');
  physicalDirectoryChain(evidenceRoot, profileDir);
  return Object.fromEntries(
    REQUIRED_ARTIFACTS.map((name) => {
      const artifactPath = path.join(profileDir, name);
      if (!physicalRegularFile(artifactPath)) throw new Error('read PF required artifact 非物理 regular file');
      const raw = fs.readFileSync(artifactPath, 'utf8');
      if (!scanEvidenceText(raw).clean) throw new Error('read PF required artifact scan rejected');
      return [name, JSON.parse(raw)];
    }),
  );
}

function validateSamples({ samples, descriptor, profile }) {
  const metricIds = descriptor.metrics.map((metric) => metric.id);
  if (
    !hasExactKeys(samples, ['schemaVersion', 'descriptorId', 'profile', 'unit', 'metrics']) ||
    samples.schemaVersion !== 1 ||
    samples.descriptorId !== descriptor.descriptorId ||
    samples.profile !== profile ||
    samples.unit !== 'ms' ||
    !hasExactKeys(samples.metrics, metricIds)
  ) {
    throw new Error('read PF samples schema 未绑定 current descriptor/profile');
  }
  for (const metric of descriptor.metrics) {
    const entry = samples.metrics[metric.id];
    const expectedCount = metric.minSamplesByProfile?.[profile];
    if (
      !hasExactKeys(entry, ['samples']) ||
      !Array.isArray(entry.samples) ||
      entry.samples.length !== expectedCount ||
      entry.samples.some((sample) => !Number.isFinite(sample) || sample < 0)
    ) {
      throw new Error('read PF samples 未满足精确 profile contract');
    }
  }
}

function validateSummary({
  summary,
  descriptor,
  descriptorDigest,
  fixtureDigest,
  profile,
  measurementInputDigest,
  expectedCommit,
}) {
  const metricIds = descriptor.metrics.map((metric) => metric.id);
  const identity = summary?.runIdentity;
  if (
    summary?.schemaVersion !== 1 ||
    summary?.descriptorId !== descriptor.descriptorId ||
    summary?.descriptorDigest !== descriptorDigest ||
    summary?.profile !== profile ||
    summary?.fixtureDigest !== fixtureDigest ||
    summary?.measurementInputDigest !== measurementInputDigest ||
    !isDigest(summary?.measurementInputDigest) ||
    !sameJson(summary?.validation, { valid: true, violations: [] }) ||
    !hasExactKeys(summary?.metrics, metricIds) ||
    !hasExactKeys(identity, [
      'startCommit',
      'startWorktreeDirty',
      'endCommit',
      'endWorktreeDirty',
      'consistent',
    ]) ||
    !/^[0-9a-f]{40}$/i.test(identity.startCommit) ||
    identity.startCommit !== expectedCommit ||
    identity.startCommit !== identity.endCommit ||
    identity.startWorktreeDirty !== false ||
    identity.endWorktreeDirty !== false ||
    identity.consistent !== true
  ) {
    throw new Error('read PF summary 未绑定 current descriptor 或 clean run identity');
  }
  for (const metric of descriptor.metrics) {
    const stats = summary.metrics[metric.id];
    if (
      !hasExactKeys(stats, ['n', 'min', 'max', 'p50', 'p95', 'complete', 'minSamples', 'layer']) ||
      stats.n !== metric.minSamplesByProfile[profile] ||
      stats.minSamples !== metric.minSamplesByProfile[profile] ||
      stats.complete !== true ||
      stats.layer !== metric.layer ||
      stats.layer !== READ_LAYER ||
      !Number.isFinite(stats.min) ||
      !Number.isFinite(stats.max) ||
      !Number.isFinite(stats.p50) ||
      !Number.isFinite(stats.p95)
    ) {
      throw new Error('read PF summary metric metadata 不完整');
    }
  }
}

function validateFixture({ fixture, descriptor, profile }) {
  const fixtureDigest = descriptor.fixture?.profileDigests?.[profile];
  if (
    !hasExactKeys(fixture, ['schemaVersion', 'descriptorId', 'profile', 'fixtureDigest']) ||
    fixture.schemaVersion !== 1 ||
    fixture.descriptorId !== descriptor.descriptorId ||
    fixture.profile !== profile ||
    fixture.fixtureDigest !== fixtureDigest ||
    !isDigest(fixtureDigest)
  ) {
    throw new Error('read PF fixture attestation 未绑定 current descriptor/profile');
  }
  return fixtureDigest;
}

function validateProposedBudgets({ proposedBudgets, summary, descriptor, profile }) {
  const metricIds = descriptor.metrics.map((metric) => metric.id);
  const isBaseline = summary.status === 'baseline-collected / budget-not-frozen';
  if (
    !hasExactKeys(proposedBudgets, ['schemaVersion', 'descriptorId', 'profile', 'status', 'note', 'budgets']) ||
    proposedBudgets.schemaVersion !== 1 ||
    proposedBudgets.descriptorId !== descriptor.descriptorId ||
    proposedBudgets.profile !== profile ||
    proposedBudgets.status !== (isBaseline ? 'proposed-not-frozen' : 'proposal-not-applicable') ||
    !Array.isArray(proposedBudgets.budgets) ||
    proposedBudgets.budgets.length !== metricIds.length
  ) {
    throw new Error('read PF proposed budget schema 无效');
  }
  const byMetric = Object.fromEntries(proposedBudgets.budgets.map((entry) => [entry?.metric, entry]));
  if (!hasExactKeys(byMetric, metricIds)) throw new Error('read PF proposed budget metrics 不完整');
  for (const metric of descriptor.metrics) {
    const proposal = byMetric[metric.id];
    const stats = summary.metrics[metric.id];
    if (
      !hasExactKeys(proposal, [
        'metric',
        'layer',
        'baseline',
        'proposedAbsoluteCeilingMs',
        'proposedRegressionP50CeilingMs',
        'proposedRegressionAllowance',
        'status',
      ]) ||
      !hasExactKeys(proposal.baseline, ['p50', 'p95', 'n']) ||
      proposal.layer !== metric.layer ||
      proposal.baseline.p50 !== stats.p50 ||
      proposal.baseline.p95 !== stats.p95 ||
      proposal.baseline.n !== stats.n ||
      proposal.proposedAbsoluteCeilingMs !== Math.ceil((stats.p95 * 1.5) / 10) * 10 ||
      proposal.proposedRegressionP50CeilingMs !== stats.p50 * 1.25 ||
      !hasExactKeys(proposal.proposedRegressionAllowance, ['relativeTo', 'maxRatio']) ||
      proposal.proposedRegressionAllowance.relativeTo !== 'baseline-p50' ||
      proposal.proposedRegressionAllowance.maxRatio !== 1.25 ||
      proposal.status !== (isBaseline ? 'proposed-not-frozen' : 'not-written')
    ) {
      throw new Error('read PF proposed budget 未精确源自 summary metric');
    }
  }
}

function readCurrentFrozenBudget({ performance, repoRoot }) {
  const budgetPath = path.resolve(repoRoot, performance.budgetPath);
  if (!relativeUnder(repoRoot, budgetPath) || !fs.existsSync(budgetPath)) return { budget: undefined };
  physicalDirectoryChain(repoRoot, path.dirname(budgetPath));
  if (!physicalRegularFile(budgetPath)) throw new Error('read PF versioned budget 必须是物理 regular file');
  if (!relativeUnder(fs.realpathSync(repoRoot), fs.realpathSync(budgetPath))) {
    throw new Error('read PF versioned budget realpath 越出 repo root');
  }
  const raw = fs.readFileSync(budgetPath, 'utf8');
  if (!scanEvidenceText(raw).clean) throw new Error('read PF versioned budget scan rejected');
  const budget = JSON.parse(raw);
  if (budget?.path !== performance.budgetPath) {
    throw new Error('read PF versioned budget path 未绑定 registry');
  }
  const baseline = readPfReadBaselineArtifactDigests(budget, {
    repoRoot,
    artifactsRoot: path.join(repoRoot, '.artifacts'),
  });
  return {
    budget,
    baselineArtifactDigests: baseline.digests,
    baselineEvidence: baseline.evidence,
  };
}

function reEvaluateCurrentEvidence({
  artifacts,
  descriptor,
  descriptorDigest,
  fixtureDigest,
  measurementInputs,
  performance,
  repoRoot,
}) {
  const summary = artifacts['summary.json'];
  const frozen = readCurrentFrozenBudget({ performance, repoRoot });
  const result = evaluateReadPfEvidence({
    descriptor,
    descriptorDigest,
    profile: performance.profile,
    fixtureDigest,
    samplesPayload: artifacts['samples.json'],
    runIdentity: {
      start: {
        commit: summary.runIdentity.startCommit,
        worktreeDirty: summary.runIdentity.startWorktreeDirty,
      },
      end: {
        commit: summary.runIdentity.endCommit,
        worktreeDirty: summary.runIdentity.endWorktreeDirty,
      },
    },
    runtime: { runner: summary.runner, toolchain: summary.toolchain },
    measurementInputs,
    budget: frozen.budget,
    baselineArtifactDigests: frozen.baselineArtifactDigests,
    baselineEvidence: frozen.baselineEvidence,
  });
  if (!sameJson(summary, result.summary) || !sameJson(artifacts['proposed-budgets.json'], result.proposedBudgets)) {
    throw new Error('read PF summary/proposal 未精确源自 raw samples 与 physical budget comparison');
  }
}

function validateCurrentProfileEvidence({ evidenceRoot, performance, expectedCommit, repoRoot }) {
  const descriptorPath = path.resolve(repoRoot, performance.descriptorPath);
  const descriptorStat = fs.lstatSync(descriptorPath);
  if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink()) {
    throw new Error('read PF descriptor 必须是物理 regular file');
  }
  const { descriptor, digest: descriptorDigest } = assertCurrentPfDescriptorDigest(descriptorPath);
  if (descriptor.descriptorId !== performance.descriptorId || !descriptor.profiles?.[performance.profile]) {
    throw new Error('read PF registry 与 current descriptor 不一致');
  }
  const artifacts = readProfileArtifacts({ evidenceRoot, performance });
  const fixtureDigest = validateFixture({
    fixture: artifacts['fixture-attestation.json'],
    descriptor,
    profile: performance.profile,
  });
  validateSamples({ samples: artifacts['samples.json'], descriptor, profile: performance.profile });
  const profileDir = path.resolve(evidenceRoot, performance.evidenceRelativeDir);
  const measurementInputs = collectPfReadMeasurementInputs({
    graphPath: path.join(profileDir, 'l2-dev-module-graph.json'),
    descriptorPath: performance.descriptorPath,
    repoRoot,
  });
  validateSummary({
    summary: artifacts['summary.json'],
    descriptor,
    descriptorDigest,
    fixtureDigest,
    profile: performance.profile,
    measurementInputDigest: measurementInputs.digest,
    expectedCommit,
  });
  validateProposedBudgets({
    proposedBudgets: artifacts['proposed-budgets.json'],
    summary: artifacts['summary.json'],
    descriptor,
    profile: performance.profile,
  });
  reEvaluateCurrentEvidence({
    artifacts,
    descriptor,
    descriptorDigest,
    fixtureDigest,
    measurementInputs,
    performance,
    repoRoot,
  });
  return artifacts['summary.json'];
}

/**
 * 配置了 subjectWaiverPath 的 entry 在 historical subject-waiver step 下不要求本次 run 的
 * evidence 目录；从 waiver validation 投影脱敏 metadata。step 的 automatic fail/exit 1
 * 事实原样保留，budgetState 仅标注 historical-subject-waiver-validation；waiver binding
 * 不精确或 step 不是 historical no-sampling 时抛错，由调用方记为 incomplete。
 */
function projectSubjectWaiverManifestResult({ performance, step, validation }) {
  const contract = validation?.measurementContract;
  const automaticResult = validation?.automaticResult;
  if (
    !safeRelative(performance?.descriptorPath) ||
    !safeRelative(performance?.evidenceRelativeDir) ||
    validation?.valid !== true ||
    validation.waiverPath !== performance.subjectWaiverPath ||
    !isDigest(validation.waiverSha256) ||
    step?.id !== perfStepId(performance) ||
    step.execution?.mode !== SUBJECT_WAIVER_EXECUTION_MODE ||
    step.execution?.samplingRun !== false ||
    step.exitCode !== 1 ||
    step.status !== 'fail' ||
    contract?.descriptorPath !== performance.descriptorPath ||
    !isDigest(contract?.descriptorDigest) ||
    !isDigest(contract?.fixture?.sha256) ||
    !isDigest(contract?.measurementInputs?.digest) ||
    automaticResult?.status !== 'fail' ||
    automaticResult?.exitCode !== 1 ||
    typeof automaticResult?.runId !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(automaticResult?.commit)
  ) {
    throw new Error('read PF subject waiver projection 未绑定 exact validated disposition');
  }
  return {
    pfId: performance.descriptorId,
    profile: performance.profile,
    step: { id: step.id, exitCode: step.exitCode, status: step.status },
    descriptor: { path: performance.descriptorPath, digest: contract.descriptorDigest },
    fixtureDigest: contract.fixture.sha256,
    metrics: [],
    summaryRelativePath: `${performance.evidenceRelativeDir}/summary.json`,
    budgetState: SUBJECT_WAIVER_BUDGET_STATE,
    validation: { valid: true },
    budgetValidation: {
      status: SUBJECT_WAIVER_EXECUTION_MODE,
      automaticResult: { status: 'fail', exitCode: 1 },
    },
    runner: contract.runner,
    toolchain: contract.toolchain,
    measurementInputDigest: contract.measurementInputs.digest,
    subjectWaiver: {
      waiverPath: validation.waiverPath,
      waiverSha256: validation.waiverSha256,
      runId: automaticResult.runId,
      commit: automaticResult.commit,
      violation: automaticResult.violation,
    },
  };
}

/**
 * Reads and projects one manifest entry per registered PF profile. The helper
 * cannot elevate incomplete/tainted evidence; raw summary strings never leave
 * this boundary. Entries carrying a subjectWaiverPath are projected from their
 * own exact waiver validation instead of current-run evidence.
 */
export function collectReadPfManifestResults({
  performances,
  stepResults,
  evidenceRoot,
  expectedCommit,
  repoRoot = REPO_ROOT,
  subjectWaiverValidations = undefined,
}) {
  const performanceResults = [];
  let incomplete = false;
  for (const performance of performances ?? []) {
    const step = stepResults.find((candidate) => candidate.id === perfStepId(performance));
    try {
      if (step === undefined) throw new Error('read PF registered step 缺失');
      if (performance.subjectWaiverPath !== undefined) {
        performanceResults.push(
          projectSubjectWaiverManifestResult({
            performance,
            step,
            validation: subjectWaiverValidations?.[perfStepId(performance)],
          }),
        );
        continue;
      }
      const summary = validateCurrentProfileEvidence({
        evidenceRoot,
        performance,
        expectedCommit,
        repoRoot,
      });
      performanceResults.push(
        projectReadPfManifestResult({
          config: performance,
          step: {
            id: step.id,
            exitCode: step.exitCode,
            status: step.status,
          },
          summary,
          summaryRelativePath: `${performance.evidenceRelativeDir}/summary.json`,
        }),
      );
    } catch {
      incomplete = true;
      performanceResults.push(incompleteResult({ performance, step }));
    }
  }
  const scan = scanNestedRegularEvidence({ root: path.join(evidenceRoot, 'performance') });
  return {
    performanceResults,
    incomplete: incomplete || !scan.valid,
    contaminationNotes: scan.contaminationNotes,
  };
}
