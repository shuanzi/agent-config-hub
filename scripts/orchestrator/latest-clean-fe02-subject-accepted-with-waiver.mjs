/**
 * 本次 FE-02 subject accepted-with-waiver 的独立 clean index。
 * 它会读取并重验已有 subject index 的 backing evidence；绝不触碰 latest-clean-pass.json。
 * FE-02 manifest 保持 schemaVersion 1：无 run-local harness attestation、无 budgetState 段。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FE02_PF02_SUBJECT_WAIVER_PATH,
  FE02_PF02_SUBJECT_WAIVER_SHA256,
  validateFe02Pf02SubjectWaiver,
} from './fe02-pf02-subject-waiver.mjs';
import {
  FE02_PF02_STRESS_SUBJECT_WAIVER_PATH,
  FE02_PF02_STRESS_SUBJECT_WAIVER_SHA256,
  validateFe02Pf02StressSubjectWaiver,
} from './fe02-pf02-stress-subject-waiver.mjs';
import {
  FE02_PRODUCT_SUT_TREES,
  FE02_SUBJECT_COMMIT,
  FE02_SUBJECT_COMMITS,
  validateFe02SubjectClosureLineage,
} from './fe02-subject-lineage.mjs';
import { ticketConfig } from './ticket-registry.mjs';
import { scanEvidenceText, sha256File } from './lib.mjs';
import {
  isPhysicalRegularFile,
  readExactPhysicalJson,
} from './fe01-run-local-harness-attestation.mjs';
import {
  FE02_SUBJECT_PHYSICAL_CANDIDATE,
  FE02_SUBJECT_PHYSICAL_VALIDATED,
} from './fe02-subject-waiver-physical-disposition.mjs';
import {
  hasPhysicalPath,
  maybeAdvancePhysicalJsonIndex,
  relativeFrom,
  validCompletedAt,
} from './clean-evidence-index.mjs';

const SUBJECT_COMMIT = '7936cb91f54c94e836124b0d46337247776431d2';
const SUBJECT_RUN_ID = '20260815T060139784Z-p84684-000';
const SUBJECT_VIOLATION = {
  metric: 'pf02.source.scroll.render_stable',
  statistic: 'p50',
  observedMs: 12.95,
  thresholdMs: 3.9375,
  deltaMs: 9.0125,
};
const STRESS_SUBJECT_COMMIT = '222efc489f85a9efe9997f19badc350f23f50bb2';
const STRESS_SUBJECT_RUN_ID = '20260815T094047023Z-p76378-000';
const STRESS_SUBJECT_VIOLATION = {
  metric: 'pf02.source.scroll.render_stable',
  statistic: 'p50',
  observedMs: 12.25,
  thresholdMs: 8.5,
  deltaMs: 3.75,
};
const REQUIRED_STEPS = [
  ['toolchain', 'pass', 0],
  ['static', 'pass', 0],
  ['rust-fx02', 'pass', 0],
  ['frontend-read-surfaces', 'pass', 0],
  ['perf-read-contract', 'pass', 0],
  ['ui-fx02-read-surfaces', 'pass', 0],
  ['tauri-fx02-read', 'pass', 0],
  ['perf-pf02-representative', 'fail', 1],
  ['perf-pf02-stress', 'fail', 1],
  ['perf-pf03-representative', 'pass', 0],
  ['perf-pf03-stress', 'pass', 0],
];
const DESCRIPTOR_PATH = 'performance/descriptors/pf-02.source-large.json';
const DESCRIPTOR_DIGEST = '53df623aeb8538e1ad8e2821c287603241647de870dcd2c04c8816cb1beff86e';
const MEASUREMENT_INPUT_DIGEST =
  'a1b474199c61bf46c769d83f22c6b7953be7f1053db0c1cbf3ed108e9259de45';
const FIXTURE_SHA256 = 'fc1100b4835e795128117099bc6c246497a26ef0d37bbbb941c3b87d41989e56';
const STRESS_FIXTURE_SHA256 = '91c8c9502f06b4f6162bc107b248bb2451b27b3ecfd7c9e3fe338ab3408395f3';
/** 两份 waiver entry 的钉死投影常量（registry performances[] 顺序）。 */
const WAIVER_ENTRY_SPECS = Object.freeze([
  Object.freeze({
    profile: 'representative',
    stepId: 'perf-pf02-representative',
    summaryRelativePath: 'performance/PF-02/representative/summary.json',
    fixtureSha256: FIXTURE_SHA256,
    waiverPath: FE02_PF02_SUBJECT_WAIVER_PATH,
    waiverSha256: FE02_PF02_SUBJECT_WAIVER_SHA256,
    runId: SUBJECT_RUN_ID,
    commit: SUBJECT_COMMIT,
    violation: SUBJECT_VIOLATION,
  }),
  Object.freeze({
    profile: 'stress',
    stepId: 'perf-pf02-stress',
    summaryRelativePath: 'performance/PF-02/stress/summary.json',
    fixtureSha256: STRESS_FIXTURE_SHA256,
    waiverPath: FE02_PF02_STRESS_SUBJECT_WAIVER_PATH,
    waiverSha256: FE02_PF02_STRESS_SUBJECT_WAIVER_SHA256,
    runId: STRESS_SUBJECT_RUN_ID,
    commit: STRESS_SUBJECT_COMMIT,
    violation: STRESS_SUBJECT_VIOLATION,
  }),
]);
const RUNNER = {
  node: 'v24.18.0',
  npm: '11.16.0',
  platform: 'darwin',
  release: '25.6.0',
  macosProductVersion: '26.6.1',
  arch: 'arm64',
};
const TOOLCHAIN = {
  cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)',
  rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)',
};
const FE02_ACCEPTED_MANIFEST_KEYS = Object.freeze([
  'schemaVersion',
  'runId',
  'scope',
  'evidenceScope',
  'status',
  'commit',
  'worktreeDirty',
  'runIdentity',
  'verificationEnvironment',
  'toolchain',
  'fixtureDigests',
  'steps',
  'artifactIdentity',
  'performanceResults',
  'performanceEvidence',
  'startAt',
  'endAt',
  'completedAt',
  'uncoveredBoundaries',
  'subjectLineage',
  'manualDisposition',
  'pfAutomaticResult',
  'performanceDebt',
  'physicalValidation',
]);
const FE02_ACCEPTED_INDEX_KEYS = Object.freeze([
  'schemaVersion',
  'ticket',
  'scope',
  'status',
  'runId',
  'commit',
  'completedAt',
  'manifestPath',
  'manualDisposition',
  'pfAutomaticResult',
  'performanceDebt',
  'subjectLineage',
  'physicalValidation',
  'provenance',
]);
const SUBJECT_WAIVER_BUDGET_STATE =
  'historical-subject-waiver-validation（immutable automatic fail/exit 1；未启动当前 PF sampling）';
const MANUAL_DISPOSITION_SOURCE =
  '用户授权的 exact FE-02 subject PF-02 representative+stress disposition；immutable subject artifact raw samples 与 frozen budget 重算，非本次 perf sampling。';

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isGitOid(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && sameJson(Object.keys(value).sort(), [...keys].sort());
}

/** waiver entry 从各自的 waiver validation 投影；automatic fail/exit 1 事实不被掩盖。 */
function exactSubjectWaiverPerformanceResult(spec, entry) {
  return (
    exactKeys(entry, [
      'pfId',
      'profile',
      'step',
      'descriptor',
      'fixtureDigest',
      'metrics',
      'summaryRelativePath',
      'budgetState',
      'validation',
      'budgetValidation',
      'runner',
      'toolchain',
      'measurementInputDigest',
      'subjectWaiver',
    ]) &&
    entry.pfId === 'PF-02' &&
    entry.profile === spec.profile &&
    sameJson(entry.step, { id: spec.stepId, exitCode: 1, status: 'fail' }) &&
    sameJson(entry.descriptor, { path: DESCRIPTOR_PATH, digest: DESCRIPTOR_DIGEST }) &&
    entry.fixtureDigest === spec.fixtureSha256 &&
    sameJson(entry.metrics, []) &&
    entry.summaryRelativePath === spec.summaryRelativePath &&
    entry.budgetState === SUBJECT_WAIVER_BUDGET_STATE &&
    sameJson(entry.validation, { valid: true }) &&
    sameJson(entry.budgetValidation, {
      status: 'historical-subject-waiver-validation',
      automaticResult: { status: 'fail', exitCode: 1 },
    }) &&
    sameJson(entry.runner, RUNNER) &&
    sameJson(entry.toolchain, TOOLCHAIN) &&
    entry.measurementInputDigest === MEASUREMENT_INPUT_DIGEST &&
    sameJson(entry.subjectWaiver, {
      waiverPath: spec.waiverPath,
      waiverSha256: spec.waiverSha256,
      runId: spec.runId,
      commit: spec.commit,
      violation: spec.violation,
    })
  );
}

/** 其余两个 PF-03 entry 是本次 run 的正常采样投影；只做结构性通过校验，不绑定具体数值。 */
function exactSampledPerformanceResult(entry) {
  return (
    exactKeys(entry, [
      'pfId',
      'profile',
      'step',
      'descriptor',
      'fixtureDigest',
      'metrics',
      'summaryRelativePath',
      'budgetState',
      'validation',
      'budgetValidation',
      'runner',
      'toolchain',
      'measurementInputDigest',
    ]) &&
    entry.pfId === 'PF-03' &&
    (entry.profile === 'representative' || entry.profile === 'stress') &&
    exactKeys(entry.step, ['id', 'exitCode', 'status']) &&
    entry.step.id === `perf-${entry.pfId.toLowerCase().replace('-', '')}-${entry.profile}` &&
    entry.step.exitCode === 0 &&
    entry.step.status === 'pass' &&
    exactKeys(entry.descriptor, ['path', 'digest']) &&
    isSha256(entry.descriptor.digest) &&
    isSha256(entry.fixtureDigest) &&
    Array.isArray(entry.metrics) &&
    entry.metrics.length === 3 &&
    typeof entry.summaryRelativePath === 'string' &&
    typeof entry.budgetState === 'string' &&
    entry.budgetState.startsWith('budget-frozen（') &&
    entry.validation?.valid === true &&
    entry.budgetValidation?.valid === true &&
    isSha256(entry.measurementInputDigest)
  );
}

function exactPerformanceResults(value) {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const waiverEntries = WAIVER_ENTRY_SPECS.map((spec) =>
    value.filter((entry) => entry?.pfId === 'PF-02' && entry?.profile === spec.profile),
  );
  return (
    waiverEntries.every((matches) => matches.length === 1) &&
    WAIVER_ENTRY_SPECS.every((spec, index) =>
      exactSubjectWaiverPerformanceResult(spec, waiverEntries[index][0]),
    ) &&
    value
      .filter((entry) => !waiverEntries.some((matches) => matches[0] === entry))
      .every(exactSampledPerformanceResult)
  );
}

function exactSubjectLineage(lineage, finalCommit) {
  return (
    lineage?.valid === true &&
    lineage.subjectCommit === FE02_SUBJECT_COMMIT &&
    sameJson(lineage.subjectCommits, [...FE02_SUBJECT_COMMITS]) &&
    lineage.finalCommit === finalCommit &&
    exactKeys(lineage.trees, FE02_PRODUCT_SUT_TREES) &&
    FE02_PRODUCT_SUT_TREES.every(
      (tree) =>
        isGitOid(lineage.trees[tree]?.subject ?? '') &&
        lineage.trees[tree]?.final === lineage.trees[tree]?.subject,
    )
  );
}

function exactStep(step) {
  const hasHistoricalExecution = WAIVER_ENTRY_SPECS.some((spec) => spec.stepId === step?.id);
  const keys = [
    'id',
    'layer',
    'provenance',
    'command',
    'exitCode',
    'status',
    'timedOut',
    'durationMs',
    'logs',
    ...(hasHistoricalExecution ? ['execution'] : []),
  ];
  return (
    exactKeys(step, keys) &&
    typeof step.id === 'string' &&
    typeof step.layer === 'string' &&
    typeof step.provenance === 'string' &&
    step.provenance.length > 0 &&
    Array.isArray(step.command) &&
    step.command.length > 0 &&
    step.command.every((part) => typeof part === 'string' && part.length > 0) &&
    typeof step.exitCode === 'number' &&
    Number.isInteger(step.exitCode) &&
    typeof step.status === 'string' &&
    step.timedOut === false &&
    typeof step.durationMs === 'number' &&
    Number.isFinite(step.durationMs) &&
    step.durationMs >= 0 &&
    exactKeys(step.logs, ['stdout', 'stderr', 'meta']) &&
    sameJson(step.logs, {
      stdout: `steps/${step.id}/stdout.log`,
      stderr: `steps/${step.id}/stderr.log`,
      meta: `steps/${step.id}/meta.json`,
    })
  );
}

function exactTicketStepIdentity(step) {
  const expectedSteps = ticketConfig('FE-02')?.steps;
  const expected = expectedSteps?.find((candidate) => candidate.id === step?.id);
  return (
    expected !== undefined &&
    step.layer === expected.layer &&
    step.provenance === expected.provenance &&
    sameJson(step.command, [expected.cmd, ...expected.args])
  );
}

function validProvenance(steps) {
  const expectedSteps = ticketConfig('FE-02')?.steps;
  return (
    Array.isArray(steps) &&
    Array.isArray(expectedSteps) &&
    steps.length === expectedSteps.length &&
    steps.every((step) => exactStep(step) && exactTicketStepIdentity(step))
  );
}

function exactClosureSteps(steps) {
  return (
    Array.isArray(steps) &&
    steps.length === REQUIRED_STEPS.length &&
    REQUIRED_STEPS.every(([id, status, exitCode]) => {
      const matches = steps.filter((step) => step?.id === id);
      return matches.length === 1 && matches[0].status === status && matches[0].exitCode === exitCode;
    })
  );
}

function exactHistoricalPerfSteps(steps) {
  return WAIVER_ENTRY_SPECS.every((spec) => {
    const perf = steps?.find((step) => step?.id === spec.stepId);
    return (
      exactKeys(perf?.execution, [
        'mode',
        'samplingRun',
        'historicalRunId',
        'initialWaiverValidation',
        'finalWaiverValidation',
        'bindingStable',
      ]) &&
      perf?.execution?.mode === 'historical-subject-waiver-validation' &&
      perf.execution.samplingRun === false &&
      perf.execution.historicalRunId === spec.runId &&
      perf.execution.initialWaiverValidation === 'valid' &&
      perf.execution.finalWaiverValidation === 'valid' &&
      perf.execution.bindingStable === true
    );
  });
}

function exactRunIdentity(value, commit) {
  return (
    exactKeys(value, [
      'startCommit',
      'startWorktreeDirty',
      'endCommit',
      'endWorktreeDirty',
      'consistent',
    ]) &&
    value.startCommit === commit &&
    value.endCommit === commit &&
    value.startWorktreeDirty === false &&
    value.endWorktreeDirty === false &&
    value.consistent === true
  );
}

function exactVerificationEnvironment(value) {
  return (
    exactKeys(value, ['verification', 'build']) &&
    exactKeys(value.verification, ['policy', 'overrides']) &&
    value.verification.policy === 'no ambient Git/PERF_OUTPUT_DIR/PF01_*/ACM_* overrides' &&
    sameJson(value.verification.overrides, []) &&
    sameJson(value.build, {
      schemaVersion: 1,
      policy: 'no ambient Git/VITE_/TAURI_/CARGO_/Rust/SDK/Node build overrides or root .env files',
      overrides: [],
    })
  );
}

function exactToolchain(value) {
  return (
    exactKeys(value, ['node', 'npm', 'rustc', 'os', 'arch']) &&
    ['node', 'npm', 'rustc', 'os', 'arch'].every(
      (field) => typeof value[field] === 'string' && value[field].length > 0,
    )
  );
}

function validFixtureDigest(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(
      ([filePath, digest]) =>
        typeof filePath === 'string' &&
        filePath.length > 0 &&
        !filePath.startsWith('/') &&
        !filePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') &&
        isSha256(digest),
    )
  );
}

function exactFixtureDigests(value) {
  return exactKeys(value, ['FX-02', 'FX-03']) && validFixtureDigest(value['FX-02']) && validFixtureDigest(value['FX-03']);
}

function exactArtifactIdentity(value) {
  return (
    exactKeys(value, [
      'kind',
      'identifier',
      'profile',
      'binary',
      'binarySha256',
      'provenance',
      'production',
    ]) &&
    value.kind === 'test-harness' &&
    typeof value.identifier === 'string' &&
    value.identifier.length > 0 &&
    value.profile === 'debug' &&
    value.binary === 'src-tauri/target/debug/agent-config-manager' &&
    isSha256(value.binarySha256) &&
    typeof value.provenance === 'string' &&
    value.provenance.length > 0 &&
    value.production === 'N/A（FE-02 不产出生产 artifact）'
  );
}

function exactCandidatePhysicalValidation(value) {
  return (
    sameJson(value, FE02_SUBJECT_PHYSICAL_CANDIDATE) ||
    sameJson(value, FE02_SUBJECT_PHYSICAL_VALIDATED)
  );
}

function exactFinalPhysicalValidation(value) {
  return sameJson(value, FE02_SUBJECT_PHYSICAL_VALIDATED);
}

function physicalDirectoryDigest(root, directoryPath) {
  if (!hasPhysicalPath(root, directoryPath)) return null;
  try {
    const rootStats = fs.lstatSync(directoryPath);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  const digest = {};
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    } catch {
      return false;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      let stats;
      try {
        stats = fs.lstatSync(full);
      } catch {
        return false;
      }
      if (stats.isSymbolicLink()) return false;
      if (stats.isDirectory()) {
        if (!walk(full)) return false;
      } else if (stats.isFile()) {
        digest[path.relative(directoryPath, full).split(path.sep).join('/')] = sha256File(full);
      } else {
        return false;
      }
    }
    return true;
  };
  return walk(directoryPath) ? digest : null;
}

function exactFinalFixtureDigests(root, value) {
  const fixtures = ticketConfig('FE-02')?.fixtures;
  if (!Array.isArray(fixtures) || !exactKeys(value, fixtures.map((fixture) => fixture.id))) {
    return false;
  }
  return fixtures.every((fixture) => {
    const fixtureRoot = path.resolve(root, fixture.root);
    const relative = relativeFrom(root, fixtureRoot);
    if (relative === null || relative !== fixture.root) return false;
    const digest = physicalDirectoryDigest(root, fixtureRoot);
    return digest !== null && sameJson(value[fixture.id], digest);
  });
}

function physicalStepEvidenceViolation(root, evidenceRoot, steps) {
  for (const step of steps) {
    const stdoutPath = path.join(evidenceRoot, step.logs.stdout);
    const stderrPath = path.join(evidenceRoot, step.logs.stderr);
    const metaPath = path.join(evidenceRoot, step.logs.meta);
    if (
      !isPhysicalRegularFile(root, stdoutPath) ||
      !isPhysicalRegularFile(root, stderrPath) ||
      !isPhysicalRegularFile(root, metaPath)
    ) {
      return `step-${step.id}-physical-file-missing-or-symlink`;
    }
    let stdout;
    let stderr;
    try {
      stdout = fs.readFileSync(stdoutPath, 'utf8');
      stderr = fs.readFileSync(stderrPath, 'utf8');
    } catch {
      return `step-${step.id}-physical-file-unreadable`;
    }
    const { logs: _logs, ...expectedMeta } = step;
    if (!scanEvidenceText(stdout).clean || !scanEvidenceText(stderr).clean) {
      return `step-${step.id}-log-contaminated`;
    }
    const parsedMeta = readExactPhysicalJson(root, metaPath);
    if (parsedMeta.value === null) {
      return parsedMeta.reason === 'raw-contaminated'
        ? `step-${step.id}-meta-raw-contaminated`
        : `step-${step.id}-meta-invalid-or-duplicate-key`;
    }
    const meta = parsedMeta.value;
    if (!scanEvidenceText(JSON.stringify(expectedMeta)).clean || !sameJson(meta, expectedMeta)) {
      return `step-${step.id}-meta-does-not-match-manifest`;
    }
  }
  return null;
}

function exactPerformanceEvidence(value) {
  return exactKeys(value, ['valid', 'notes']) && value.valid === true && sameJson(value.notes, []);
}

function exactUncoveredBoundaries(value) {
  return sameJson(value, ticketConfig('FE-02')?.uncoveredBoundaries);
}

function exactAcceptedManifestSchema(manifest) {
  return (
    exactKeys(manifest, FE02_ACCEPTED_MANIFEST_KEYS) &&
    manifest.schemaVersion === 1 &&
    manifest.scope === 'FE-02' &&
    manifest.evidenceScope === 'ticket-closure' &&
    manifest.status === 'accepted-with-waiver' &&
    isGitOid(manifest.commit) &&
    manifest.worktreeDirty === false &&
    exactRunIdentity(manifest.runIdentity, manifest.commit) &&
    exactVerificationEnvironment(manifest.verificationEnvironment) &&
    exactToolchain(manifest.toolchain) &&
    exactFixtureDigests(manifest.fixtureDigests) &&
    exactArtifactIdentity(manifest.artifactIdentity) &&
    exactPerformanceResults(manifest.performanceResults) &&
    exactPerformanceEvidence(manifest.performanceEvidence) &&
    exactCandidatePhysicalValidation(manifest.physicalValidation) &&
    validCompletedAt(manifest.startAt) &&
    validCompletedAt(manifest.endAt) &&
    validCompletedAt(manifest.completedAt) &&
    Date.parse(manifest.startAt) <= Date.parse(manifest.endAt) &&
    Date.parse(manifest.endAt) === Date.parse(manifest.completedAt) &&
    exactUncoveredBoundaries(manifest.uncoveredBoundaries)
  );
}

function exactManifest(manifest) {
  return (
    exactAcceptedManifestSchema(manifest) &&
    manifest?.status === 'accepted-with-waiver' &&
    exactKeys(manifest?.manualDisposition, [
      'status',
      'waiverValidation',
      'initialWaiverValidation',
      'finalWaiverValidation',
      'bindingStable',
      'waivers',
      'source',
    ]) &&
    manifest.manualDisposition.status === 'accepted-with-waiver' &&
    manifest.manualDisposition.waiverValidation === 'valid' &&
    manifest.manualDisposition.initialWaiverValidation === 'valid' &&
    manifest.manualDisposition.finalWaiverValidation === 'valid' &&
    manifest.manualDisposition.bindingStable === true &&
    Array.isArray(manifest.manualDisposition.waivers) &&
    manifest.manualDisposition.waivers.length === WAIVER_ENTRY_SPECS.length &&
    WAIVER_ENTRY_SPECS.every((spec, index) => {
      const entry = manifest.manualDisposition.waivers[index];
      return (
        exactKeys(entry, [
          'stepId',
          'initialWaiverValidation',
          'finalWaiverValidation',
          'bindingStable',
          'waiverPath',
          'waiverSha256',
        ]) &&
        entry.stepId === spec.stepId &&
        entry.initialWaiverValidation === 'valid' &&
        entry.finalWaiverValidation === 'valid' &&
        entry.bindingStable === true &&
        entry.waiverPath === spec.waiverPath &&
        entry.waiverSha256 === spec.waiverSha256
      );
    }) &&
    Array.isArray(manifest?.pfAutomaticResult) &&
    manifest.pfAutomaticResult.length === WAIVER_ENTRY_SPECS.length &&
    WAIVER_ENTRY_SPECS.every((spec, index) => {
      const result = manifest.pfAutomaticResult[index];
      return (
        result?.status === 'fail' &&
        result?.exitCode === 1 &&
        result?.runId === spec.runId &&
        result?.run ===
          `.artifacts/verification/FE-02/${spec.runId}/performance/PF-02/${spec.profile}` &&
        result?.commit === spec.commit &&
        result?.worktreeDirty === false &&
        sameJson(result?.violation, spec.violation)
      );
    }) &&
    Array.isArray(manifest?.performanceDebt) &&
    manifest.performanceDebt.length === WAIVER_ENTRY_SPECS.length &&
    manifest.performanceDebt.every(
      (debt) =>
        debt?.status === 'deferred' &&
        debt?.phase === 'post-optimization' &&
        typeof debt?.rootCause === 'string',
    ) &&
    exactSubjectLineage(manifest?.subjectLineage, manifest.commit)
  );
}

function exactRecomputedBinding({ manifest, waivers, lineage }) {
  return (
    waivers.every((waiver) => waiver?.valid === true) &&
    lineage?.valid === true &&
    sameJson(manifest.manualDisposition, {
      status: 'accepted-with-waiver',
      waiverValidation: 'valid',
      initialWaiverValidation: 'valid',
      finalWaiverValidation: 'valid',
      bindingStable: true,
      waivers: WAIVER_ENTRY_SPECS.map((spec, index) => ({
        stepId: spec.stepId,
        initialWaiverValidation: 'valid',
        finalWaiverValidation: 'valid',
        bindingStable: true,
        waiverPath: waivers[index].waiverPath,
        waiverSha256: waivers[index].waiverSha256,
      })),
      source: MANUAL_DISPOSITION_SOURCE,
    }) &&
    sameJson(
      manifest.pfAutomaticResult,
      waivers.map((waiver) => waiver.automaticResult),
    ) &&
    sameJson(
      manifest.performanceDebt,
      waivers.map((waiver) => waiver.performanceDebt),
    ) &&
    sameJson(manifest.subjectLineage, lineage)
  );
}

function rejected(reason) {
  return { eligible: false, validated: false, reason };
}

function acceptedIndexProvenance(manifest) {
  return {
    evidenceScope: manifest.evidenceScope,
    steps: manifest.steps.map(({ id, layer, provenance }) => ({ id, layer, provenance })),
    statement:
      '仅指向本次 exact FE-02 subject waiver：historical automatic PF fail/exit 1、显式 manual disposition、final subject lineage、worktreeDirty=false、无 contamination；不代表 automatic pass 或 release gate。',
  };
}

function acceptedIndexForManifest({ ticketId, manifest, relativeManifestPath }) {
  return {
    schemaVersion: 1,
    ticket: ticketId,
    scope: manifest.scope,
    status: 'accepted-with-waiver',
    runId: manifest.runId,
    commit: manifest.commit,
    completedAt: manifest.completedAt,
    manifestPath: relativeManifestPath,
    manualDisposition: manifest.manualDisposition,
    pfAutomaticResult: manifest.pfAutomaticResult,
    performanceDebt: manifest.performanceDebt,
    subjectLineage: manifest.subjectLineage,
    physicalValidation: manifest.physicalValidation,
    provenance: acceptedIndexProvenance(manifest),
  };
}

function exactAcceptedIndex(index, { ticketId, manifest, relativeManifestPath }) {
  return (
    exactKeys(index, FE02_ACCEPTED_INDEX_KEYS) &&
    sameJson(index, acceptedIndexForManifest({ ticketId, manifest, relativeManifestPath }))
  );
}

/** 已有 index 是 latest truth，须按候选同一 public validator 重验其所有 backing evidence。 */
function validateExistingAcceptedIndex({ root, indexPath }) {
  if (!isPhysicalRegularFile(root, indexPath)) {
    return rejected('existing-accepted-index-not-physical');
  }
  const parsedIndex = readExactPhysicalJson(root, indexPath);
  if (parsedIndex.value === null) {
    return rejected('existing-accepted-index-raw-invalid-or-contaminated');
  }
  const index = parsedIndex.value;
  if (
    !exactKeys(index, FE02_ACCEPTED_INDEX_KEYS) ||
    index.ticket !== 'FE-02' ||
    !exactFinalPhysicalValidation(index.physicalValidation) ||
    typeof index.manifestPath !== 'string'
  ) {
    return rejected('existing-accepted-index-schema-or-physical-validation-invalid');
  }
  const manifestPath = path.resolve(root, index.manifestPath);
  if (
    relativeFrom(root, manifestPath) !== index.manifestPath ||
    index.manifestPath !== `.artifacts/verification/FE-02/${index.runId}/manifest.json` ||
    !isPhysicalRegularFile(root, manifestPath)
  ) {
    return rejected('existing-accepted-index-manifest-not-physical');
  }
  const parsedManifest = readExactPhysicalJson(root, manifestPath);
  if (parsedManifest.value === null) {
    return rejected('existing-accepted-index-manifest-raw-invalid-or-contaminated');
  }
  const manifest = parsedManifest.value;
  if (
    manifest === null ||
    !exactFinalPhysicalValidation(manifest.physicalValidation) ||
    !sameJson(index.physicalValidation, manifest.physicalValidation)
  ) {
    return rejected('existing-accepted-index-manifest-binding-invalid');
  }
  const backing = validateAcceptedWithWaiverCandidate({
    root,
    evidenceRoot: path.dirname(manifestPath),
    ticketId: 'FE-02',
    manifest,
  });
  if (!backing.eligible || !backing.validated) {
    return rejected(`existing-accepted-index-backing-${backing.reason}`);
  }
  if (!exactAcceptedIndex(index, {
    ticketId: 'FE-02',
    manifest,
    relativeManifestPath: index.manifestPath,
  })) {
    return rejected('existing-accepted-index-binding-invalid');
  }
  return {
    eligible: true,
    validated: true,
    reason: 'existing-accepted-index-backing-exact',
    runId: index.runId,
    completedAt: index.completedAt,
  };
}

/** 候选的 physical eligibility 独立于 accepted index 是否可前进。 */
function validateAcceptedWithWaiverCandidate({ root, evidenceRoot, ticketId, manifest }) {
  if (
    ticketId !== 'FE-02' ||
    manifest === null ||
    typeof manifest !== 'object' ||
    manifest.scope !== ticketId ||
    manifest.worktreeDirty !== false ||
    manifest.contamination !== undefined ||
    manifest.runId !== path.basename(evidenceRoot) ||
    typeof manifest.commit !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(manifest.commit) ||
    typeof manifest.evidenceScope !== 'string' ||
    !validCompletedAt(manifest.completedAt) ||
    !validProvenance(manifest.steps) ||
    !exactClosureSteps(manifest.steps) ||
    !exactHistoricalPerfSteps(manifest.steps) ||
    !exactManifest(manifest)
  ) {
    return rejected('manifest-schema-or-step-identity-invalid');
  }
  const waivers = [
    validateFe02Pf02SubjectWaiver({ repoRoot: root }),
    validateFe02Pf02StressSubjectWaiver({ repoRoot: root }),
  ];
  const lineage = validateFe02SubjectClosureLineage({ repoRoot: root, finalCommit: manifest.commit });
  if (!exactRecomputedBinding({ manifest, waivers, lineage })) {
    return rejected('immutable-waiver-or-lineage-binding-invalid');
  }
  const expectedEvidence = path.join(root, '.artifacts', 'verification', ticketId, manifest.runId);
  if (path.resolve(expectedEvidence) !== path.resolve(evidenceRoot)) {
    return rejected('evidence-root-does-not-match-manifest');
  }
  const manifestPath = path.join(evidenceRoot, 'manifest.json');
  if (
    !hasPhysicalPath(root, evidenceRoot) ||
    !hasPhysicalPath(root, manifestPath) ||
    !hasPhysicalPath(root, path.dirname(expectedEvidence))
  ) {
    return rejected('manifest-or-evidence-path-not-physical');
  }
  const writtenManifest = readExactPhysicalJson(root, manifestPath);
  if (writtenManifest.value === null) {
    return rejected(
      writtenManifest.reason === 'raw-contaminated'
        ? 'physical-manifest-raw-contaminated'
        : 'physical-manifest-raw-invalid-or-duplicate-key',
    );
  }
  if (!sameJson(writtenManifest.value, manifest)) {
    return rejected('physical-manifest-does-not-match-input');
  }
  const physicalStepViolation = physicalStepEvidenceViolation(root, evidenceRoot, manifest.steps);
  if (physicalStepViolation !== null) return rejected(physicalStepViolation);
  if (!exactFinalFixtureDigests(root, manifest.fixtureDigests)) {
    return rejected('final-fixture-digest-invalid');
  }
  return { eligible: true, validated: true, reason: 'final-physical-evidence-exact' };
}

export function validateFe02SubjectAcceptedWithWaiverCandidate(input) {
  return validateAcceptedWithWaiverCandidate(input);
}

/** 仅 final-validated 的 clean、physical、exact candidate 才能前进 subject 专属 index。 */
export async function maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver(input) {
  const eligibility = validateFe02SubjectAcceptedWithWaiverCandidate(input);
  if (!eligibility.eligible || !eligibility.validated) return { ...eligibility, updated: false };
  const { root, evidenceRoot, ticketId, manifest } = input;
  if (!exactFinalPhysicalValidation(manifest.physicalValidation)) {
    return { ...eligibility, updated: false, reason: 'physical-validation-disposition-not-finalized' };
  }
  const manifestPath = path.join(evidenceRoot, 'manifest.json');
  const relativeManifestPath = relativeFrom(root, manifestPath);
  if (relativeManifestPath === null) {
    return { ...rejected('manifest-path-outside-root'), updated: false };
  }

  const indexPath = path.join(
    root,
    '.artifacts',
    'verification',
    ticketId,
    'latest-clean-subject-accepted-with-waiver.json',
  );
  const advancement = await maybeAdvancePhysicalJsonIndex({
    root,
    indexPath,
    candidate: { completedAt: manifest.completedAt, runId: manifest.runId },
    temporaryPrefix: 'latest-clean-subject-accepted-with-waiver',
    lockOptions: input.lockOptions,
    revalidateCandidate: () => {
      const lockedEligibility = validateFe02SubjectAcceptedWithWaiverCandidate({
        root,
        evidenceRoot,
        ticketId,
        manifest,
      });
      if (!lockedEligibility.eligible || !lockedEligibility.validated) {
        return { valid: false, result: lockedEligibility };
      }
      if (!exactFinalPhysicalValidation(manifest.physicalValidation)) {
        return {
          valid: false,
          result: {
            ...lockedEligibility,
            updated: false,
            reason: 'physical-validation-disposition-not-finalized',
          },
        };
      }
      return { valid: true };
    },
    revalidateExisting: ({ exists }) => {
      if (!exists) return { valid: true, existing: null };
      const existing = validateExistingAcceptedIndex({ root, indexPath });
      if (!existing.eligible || !existing.validated) {
        return { valid: false, result: existing };
      }
      return {
        valid: true,
        existing: { completedAt: existing.completedAt, runId: existing.runId },
      };
    },
    createIndex: () => {
      const candidateIndex = acceptedIndexForManifest({
        ticketId,
        manifest,
        relativeManifestPath,
      });
      return exactAcceptedIndex(candidateIndex, { ticketId, manifest, relativeManifestPath })
        ? candidateIndex
        : null;
    },
  });
  if (advancement.validation !== undefined) return { ...advancement.validation, updated: false };
  return {
    ...eligibility,
    ...advancement,
    reason: advancement.updated ? 'final-physical-evidence-validated-and-index-advanced' : 'final-physical-evidence-validated-not-advanced',
  };
}
