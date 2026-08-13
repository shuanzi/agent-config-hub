/**
 * 本次 FE-01 subject accepted-with-waiver 的独立 clean index。
 * 它会读取并重验已有 subject index 的 backing evidence；只有 exact 授权的 legacy v1
 * global identity/binary mutable failure 可由新的 run-local attestation supersede，且绝不触碰
 * latest-clean-pass.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FE01_PF01_SUBJECT_WAIVER_PATH,
  FE01_PF01_SUBJECT_WAIVER_SHA256,
  validateFe01Pf01SubjectWaiver,
} from './fe01-pf01-subject-waiver.mjs';
import {
  FE01_PRODUCT_SUT_TREES,
  FE01_SUT_PROJECTION_ALGORITHM,
  FE01_SUT_PROJECTION_PATHS,
  validateFe01SubjectClosureLineage,
} from './fe01-subject-lineage.mjs';
import { PF01_BUILD_ENVIRONMENT } from './pf01-build-inputs.mjs';
import { ticketConfig } from './ticket-registry.mjs';
import { scanEvidenceText, sha256File } from './lib.mjs';
import {
  isPhysicalRegularFile,
  readExactPhysicalJson,
  validateFe01RunLocalHarnessAttestation,
} from './fe01-run-local-harness-attestation.mjs';
import {
  FE01_SUBJECT_PHYSICAL_CANDIDATE,
  FE01_SUBJECT_PHYSICAL_VALIDATED,
} from './fe01-subject-waiver-physical-disposition.mjs';
import {
  hasPhysicalPath,
  isNewerCompletion,
  maybeAdvancePhysicalJsonIndex,
  relativeFrom,
  validCompletedAt,
} from './clean-evidence-index.mjs';

const SUBJECT_COMMIT = '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf';
const SUBJECT_RUN_ID = '20260812T035717854Z-p74069-000';
const SUBJECT_VIOLATION = {
  metric: 'pf01.startup.first_list_visible',
  statistic: 'p50',
  observedMs: 16.2,
  thresholdMs: 15.75,
  deltaMs: 0.45,
};
const REQUIRED_STEPS = [
  ['toolchain', 'pass', 0],
  ['static', 'pass', 0],
  ['rust', 'pass', 0],
  ['frontend', 'pass', 0],
  ['ui', 'pass', 0],
  ['tauri', 'pass', 0],
  ['perf', 'fail', 1],
];
const BASELINE_RUN_ID = '20260812T033832054Z-p69961-000';
const BASELINE_COMMIT = '114298a619af40d00941efec4c959e0b13d6be83';
const DESCRIPTOR_DIGEST = '1f21a9dad1128ca4482500e1556925a8d8af2468a64e83628e7274007aa28b9a';
const BUDGET_SHA256 = '80461fdd8041f3247ec930dcfb4e77434fcc294465df9b299efae89fe15c7e87';
const ARTIFACTS = [
  'harness-identity.json',
  'l2-dev-module-graph.json',
  'l3-resource-runs.json',
  'l3-samples.json',
  'proposed-budgets.json',
  'samples.json',
  'summary.json',
];
const FE01_ACCEPTED_MANIFEST_KEYS = Object.freeze([
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
  'runLocalHarnessAttestation',
  'startAt',
  'endAt',
  'completedAt',
  'budgetState',
  'budgetValidation',
  'pf01Provenance',
  'pfDescriptorDigest',
  'subjectLineage',
  'manualDisposition',
  'pfAutomaticResult',
  'performanceDebt',
  'physicalValidation',
  'uncoveredBoundaries',
]);
const FE01_LEGACY_ACCEPTED_MANIFEST_KEYS = Object.freeze(
  FE01_ACCEPTED_MANIFEST_KEYS.filter((key) => key !== 'runLocalHarnessAttestation'),
);
const FE01_ACCEPTED_INDEX_KEYS = Object.freeze([
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
  'runLocalHarnessAttestation',
  'legacySupersede',
]);
const FE01_LEGACY_ACCEPTED_INDEX_KEYS = Object.freeze(
  FE01_ACCEPTED_INDEX_KEYS.filter(
    (key) => key !== 'runLocalHarnessAttestation' && key !== 'legacySupersede',
  ),
);
const LEGACY_GLOBAL_HARNESS_FAILURE = 'final-harness-identity-or-binary-invalid';
const LEGACY_SUPERSEDE_REASON = 'legacy-global-harness-identity-or-binary-invalid';
const LEGACY_STABLE_RUN_ID = '20260812T115759948Z-p90022-000';
const LEGACY_STABLE_MANIFEST_SHA256 =
  '7b63502cd2d5b39c008eb176f8d731763dc65801603f79622f14d52d9d956921';
const LEGACY_STABLE_BINARY_SHA256 =
  '25f95d26bb245d8dab47cab214a04fdbadca0db71746748512a81d56fe26e249';
const SUBJECT_WAIVER_BUDGET_STATE =
  'historical-subject-waiver-validation（immutable automatic fail/exit 1；未启动当前 PF sampling）';

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

function exactArtifactBinding(value) {
  return (
    exactKeys(value, ['baseline', 'subject']) &&
    [value.baseline, value.subject].every(
      (run) => exactKeys(run, ARTIFACTS) && ARTIFACTS.every((file) => isSha256(run[file])),
    )
  );
}

function exactHistoricalMeasurementContract(contract) {
  return (
    exactKeys(contract, [
      'descriptorPath',
      'descriptorDigest',
      'artifact',
      'buildInputs',
      'measurementInputs',
      'fixture',
      'runner',
      'toolchain',
      'buildEnvironment',
    ]) &&
    contract.descriptorPath === 'performance/descriptors/pf-01.catalog-browse.json' &&
    contract.descriptorDigest === DESCRIPTOR_DIGEST &&
    isSha256(contract.artifact?.declaredBinarySha256) &&
    contract.artifact?.declaredBinarySha256 === contract.artifact?.actualBinarySha256 &&
    contract.fixture?.path === 'fixtures/fx-01/native-root' &&
    isSha256(contract.fixture?.sha256) &&
    contract.buildInputs?.schemaVersion === 4 &&
    contract.buildInputs?.algorithm === 'pf01-l3-harness-build-inputs-v4' &&
    isSha256(contract.buildInputs?.digest) &&
    contract.measurementInputs?.schemaVersion === 4 &&
    contract.measurementInputs?.algorithm === 'pf01-measurement-inputs-v4' &&
    isSha256(contract.measurementInputs?.digest) &&
    isSha256(contract.measurementInputs?.l2DevModuleGraphSha256) &&
    exactKeys(contract.runner, ['node', 'npm', 'platform', 'release', 'macosProductVersion', 'arch']) &&
    exactKeys(contract.toolchain, ['cargo', 'rustc']) &&
    exactKeys(contract.buildEnvironment, ['schemaVersion', 'policy', 'overrides']) &&
    contract.buildEnvironment.schemaVersion === 1 &&
    Array.isArray(contract.buildEnvironment.overrides) &&
    contract.buildEnvironment.overrides.length === 0
  );
}

function exactSubjectWaiverProvenance(provenance) {
  return (
    exactKeys(provenance, [
      'kind',
      'mode',
      'record',
      'budget',
      'baseline',
      'subject',
      'measurementContract',
      'artifacts',
    ]) &&
    provenance.kind === 'fe-01-pf-01-subject-waiver' &&
    provenance.mode === 'historical-subject-waiver-validation' &&
    sameJson(provenance.record, {
      path: FE01_PF01_SUBJECT_WAIVER_PATH,
      sha256: FE01_PF01_SUBJECT_WAIVER_SHA256,
    }) &&
    exactKeys(provenance.budget, ['path', 'sha256', 'freezePath', 'freezeSha256']) &&
    provenance.budget.path === 'performance/budgets/pf-01.budgets.json' &&
    provenance.budget.sha256 === BUDGET_SHA256 &&
    provenance.budget.freezePath === 'performance/budgets/pf-01.freeze.json' &&
    isSha256(provenance.budget.freezeSha256) &&
    sameJson(provenance.baseline, {
      runId: BASELINE_RUN_ID,
      run: `.artifacts/performance/PF-01/${BASELINE_RUN_ID}`,
      commit: BASELINE_COMMIT,
      worktreeDirty: false,
    }) &&
    exactKeys(provenance.subject, ['runId', 'commit']) &&
    provenance.subject.runId === SUBJECT_RUN_ID &&
    provenance.subject.commit === SUBJECT_COMMIT &&
    exactHistoricalMeasurementContract(provenance.measurementContract) &&
    exactArtifactBinding(provenance.artifacts)
  );
}

function exactSubjectLineage(lineage, finalCommit) {
  return (
    lineage?.valid === true &&
    lineage.subjectCommit === SUBJECT_COMMIT &&
    lineage.finalCommit === finalCommit &&
    exactKeys(lineage.trees, FE01_PRODUCT_SUT_TREES) &&
    FE01_PRODUCT_SUT_TREES.every(
      (tree) =>
        /^[0-9a-f]{40}$/i.test(lineage.trees[tree]?.subject ?? '') &&
        lineage.trees[tree]?.final === lineage.trees[tree]?.subject,
    ) &&
    exactKeys(lineage.projection, ['algorithm', 'subjectDigest', 'finalDigest', 'entries']) &&
    lineage.projection.algorithm === FE01_SUT_PROJECTION_ALGORITHM &&
    isSha256(lineage.projection.subjectDigest) &&
    lineage.projection.finalDigest === lineage.projection.subjectDigest &&
    exactKeys(lineage.projection.entries, FE01_SUT_PROJECTION_PATHS) &&
    FE01_SUT_PROJECTION_PATHS.every(
      (filePath) =>
        /^[0-9a-f]{40}$/i.test(lineage.projection.entries[filePath]?.subject ?? '') &&
        lineage.projection.entries[filePath]?.final === lineage.projection.entries[filePath]?.subject,
    )
  );
}

function exactStep(step) {
  const hasHistoricalExecution = step?.id === 'perf';
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
  const expectedSteps = ticketConfig('FE-01')?.steps;
  const expected = expectedSteps?.find((candidate) => candidate.id === step?.id);
  return (
    expected !== undefined &&
    step.layer === expected.layer &&
    step.provenance === expected.provenance &&
    sameJson(step.command, [expected.cmd, ...expected.args])
  );
}

function validProvenance(steps) {
  const expectedSteps = ticketConfig('FE-01')?.steps;
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

function exactHistoricalPerfStep(steps) {
  const perf = steps?.find((step) => step?.id === 'perf');
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
    perf.execution.historicalRunId === SUBJECT_RUN_ID &&
    perf.execution.initialWaiverValidation === 'valid' &&
    perf.execution.finalWaiverValidation === 'valid' &&
    perf.execution.bindingStable === true
  );
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
    sameJson(value.build, PF01_BUILD_ENVIRONMENT)
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
  return exactKeys(value, ['FX-01']) && validFixtureDigest(value['FX-01']);
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
    value.production === 'N/A（FE-01 不产出生产 artifact）'
  );
}

function exactCandidatePhysicalValidation(value) {
  return (
    sameJson(value, FE01_SUBJECT_PHYSICAL_CANDIDATE) ||
    sameJson(value, FE01_SUBJECT_PHYSICAL_VALIDATED)
  );
}

function exactFinalPhysicalValidation(value) {
  return sameJson(value, FE01_SUBJECT_PHYSICAL_VALIDATED);
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
  const fixtures = ticketConfig('FE-01')?.fixtures;
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

/**
 * Legacy v1 has no run-local binary. It may be superseded only after the current
 * global harness proves a normal, self-consistent rebuild different from that old SHA.
 */
function validateLegacyGlobalHarnessRebuild(root) {
  const artifact = ticketConfig('FE-01')?.artifact;
  if (artifact === undefined) return { valid: false, reason: 'legacy-global-harness-configuration-invalid' };
  const identityPath = path.resolve(root, artifact.identityPath);
  if (relativeFrom(root, identityPath) !== artifact.identityPath || !isPhysicalRegularFile(root, identityPath)) {
    return { valid: false, reason: 'legacy-global-harness-identity-not-physical' };
  }
  const parsedIdentity = readExactPhysicalJson(root, identityPath);
  if (parsedIdentity.value === null) {
    return {
      valid: false,
      reason:
        parsedIdentity.reason === 'raw-contaminated'
          ? 'legacy-global-harness-identity-raw-contaminated'
          : 'legacy-global-harness-identity-invalid-or-duplicate-key',
    };
  }
  const identity = parsedIdentity.value;
  if (!exactArtifactIdentity({ ...identity, production: artifact.production })) {
    return { valid: false, reason: 'legacy-global-harness-identity-schema-invalid' };
  }
  const binaryPath = path.resolve(root, identity.binary);
  if (relativeFrom(root, binaryPath) !== identity.binary || !isPhysicalRegularFile(root, binaryPath)) {
    return { valid: false, reason: 'legacy-global-harness-binary-not-physical' };
  }
  if (sha256File(binaryPath) !== identity.binarySha256) {
    return { valid: false, reason: 'legacy-global-harness-binary-hash-mismatch' };
  }
  if (identity.binarySha256 === LEGACY_STABLE_BINARY_SHA256) {
    return { valid: false, reason: 'legacy-global-harness-binary-not-rebuilt' };
  }
  return { valid: true, reason: 'legacy-global-harness-rebuild-exact' };
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

function exactBudgetValidation(value) {
  return exactKeys(value, ['valid', 'violations']) && value.valid === true && sameJson(value.violations, []);
}

function exactUncoveredBoundaries(value) {
  return sameJson(value, ticketConfig('FE-01')?.uncoveredBoundaries);
}

function exactAcceptedManifestSchema(manifest, { legacy = false } = {}) {
  return (
    exactKeys(
      manifest,
      legacy ? FE01_LEGACY_ACCEPTED_MANIFEST_KEYS : FE01_ACCEPTED_MANIFEST_KEYS,
    ) &&
    manifest.schemaVersion === (legacy ? 1 : 2) &&
    manifest.scope === 'FE-01' &&
    manifest.evidenceScope === 'ticket-closure' &&
    manifest.status === 'accepted-with-waiver' &&
    isGitOid(manifest.commit) &&
    manifest.worktreeDirty === false &&
    exactRunIdentity(manifest.runIdentity, manifest.commit) &&
    exactVerificationEnvironment(manifest.verificationEnvironment) &&
    exactToolchain(manifest.toolchain) &&
    exactFixtureDigests(manifest.fixtureDigests) &&
    exactArtifactIdentity(manifest.artifactIdentity) &&
    exactCandidatePhysicalValidation(manifest.physicalValidation) &&
    validCompletedAt(manifest.startAt) &&
    validCompletedAt(manifest.endAt) &&
    validCompletedAt(manifest.completedAt) &&
    Date.parse(manifest.startAt) <= Date.parse(manifest.endAt) &&
    Date.parse(manifest.endAt) === Date.parse(manifest.completedAt) &&
    manifest.budgetState === SUBJECT_WAIVER_BUDGET_STATE &&
    exactBudgetValidation(manifest.budgetValidation) &&
    exactUncoveredBoundaries(manifest.uncoveredBoundaries)
  );
}

function exactManifest(manifest, options) {
  return (
    exactAcceptedManifestSchema(manifest, options) &&
    manifest?.status === 'accepted-with-waiver' &&
    manifest?.manualDisposition?.status === 'accepted-with-waiver' &&
    manifest?.manualDisposition?.waiverValidation === 'valid' &&
    manifest?.manualDisposition?.initialWaiverValidation === 'valid' &&
    manifest?.manualDisposition?.finalWaiverValidation === 'valid' &&
    manifest?.manualDisposition?.bindingStable === true &&
    manifest?.manualDisposition?.waiverPath === FE01_PF01_SUBJECT_WAIVER_PATH &&
    manifest?.manualDisposition?.waiverSha256 === FE01_PF01_SUBJECT_WAIVER_SHA256 &&
    manifest?.pfAutomaticResult?.status === 'fail' &&
    manifest?.pfAutomaticResult?.exitCode === 1 &&
    manifest?.pfAutomaticResult?.runId === SUBJECT_RUN_ID &&
    manifest?.pfAutomaticResult?.run === `.artifacts/performance/PF-01/${SUBJECT_RUN_ID}` &&
    manifest?.pfAutomaticResult?.commit === SUBJECT_COMMIT &&
    manifest?.pfAutomaticResult?.worktreeDirty === false &&
    sameJson(manifest?.pfAutomaticResult?.violation, SUBJECT_VIOLATION) &&
    manifest?.performanceDebt?.status === 'deferred' &&
    manifest?.performanceDebt?.phase === 'post-optimization' &&
    manifest?.performanceDebt?.rootCause === 'unknown' &&
    manifest?.pfDescriptorDigest === DESCRIPTOR_DIGEST &&
    exactSubjectWaiverProvenance(manifest?.pf01Provenance) &&
    exactSubjectLineage(manifest?.subjectLineage, manifest.commit)
  );
}

function exactRecomputedBinding({ manifest, waiver, lineage }) {
  return (
    waiver?.valid === true &&
    lineage?.valid === true &&
    sameJson(manifest.pf01Provenance, {
      kind: 'fe-01-pf-01-subject-waiver',
      mode: 'historical-subject-waiver-validation',
      record: { path: waiver.waiverPath, sha256: waiver.waiverSha256 },
      budget: waiver.budget,
      baseline: waiver.baseline,
      subject: waiver.subject,
      measurementContract: waiver.measurementContract,
      artifacts: waiver.artifacts,
    }) &&
    sameJson(manifest.manualDisposition, {
      status: waiver.manualDisposition,
      waiverValidation: 'valid',
      initialWaiverValidation: 'valid',
      finalWaiverValidation: 'valid',
      bindingStable: true,
      waiverPath: waiver.waiverPath,
      waiverSha256: waiver.waiverSha256,
      source:
        '用户授权的 exact FE-01 subject PF-01 disposition；immutable subject artifact raw samples 与 frozen budget 重算，非本次 perf sampling。',
    }) &&
    sameJson(manifest.pfAutomaticResult, waiver.automaticResult) &&
    sameJson(manifest.performanceDebt, waiver.performanceDebt) &&
    manifest.pfDescriptorDigest === waiver.measurementContract?.descriptorDigest &&
    sameJson(manifest.subjectLineage, lineage)
  );
}

function rejected(reason) {
  return { eligible: false, validated: false, reason };
}

function acceptedIndexProvenance(manifest, legacySupersede = null) {
  return {
    evidenceScope: manifest.evidenceScope,
    steps: manifest.steps.map(({ id, layer, provenance }) => ({ id, layer, provenance })),
    statement:
      legacySupersede === null
        ? '仅指向本次 exact FE-01 subject waiver：historical automatic PF fail/exit 1、显式 manual disposition、final subject lineage、worktreeDirty=false、无 contamination；不代表 automatic pass 或 release gate。'
        : '仅指向本次 exact FE-01 subject waiver：以新的 run-local harness attestation 取代旧 schema 的唯一 global identity/binary mutable failure；旧 binary 未被重新物理证明，不代表 automatic pass 或 release gate。',
  };
}

function exactLegacySupersede(value) {
  return (
    value === null ||
    (exactKeys(value, ['mode', 'reason', 'previousRunId', 'previousManifestPath']) &&
      value.mode === 'legacy-global-harness-identity-only' &&
      value.reason === LEGACY_SUPERSEDE_REASON &&
      value.previousRunId === LEGACY_STABLE_RUN_ID &&
      value.previousManifestPath === `.artifacts/verification/FE-01/${LEGACY_STABLE_RUN_ID}/manifest.json`)
  );
}

function acceptedIndexForManifest({ ticketId, manifest, relativeManifestPath, legacySupersede = null }) {
  return {
    schemaVersion: 2,
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
    runLocalHarnessAttestation: manifest.runLocalHarnessAttestation,
    legacySupersede,
    provenance: acceptedIndexProvenance(manifest, legacySupersede),
  };
}

function legacyAcceptedIndexForManifest({ ticketId, manifest, relativeManifestPath }) {
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

function exactAcceptedIndex(index, { ticketId, manifest, relativeManifestPath, legacySupersede = null }) {
  return (
    exactKeys(index, FE01_ACCEPTED_INDEX_KEYS) &&
    exactLegacySupersede(index.legacySupersede) &&
    sameJson(index, acceptedIndexForManifest({ ticketId, manifest, relativeManifestPath, legacySupersede }))
  );
}

function exactLegacyAcceptedIndex(index, { ticketId, manifest, relativeManifestPath }) {
  return (
    exactKeys(index, FE01_LEGACY_ACCEPTED_INDEX_KEYS) &&
    sameJson(index, legacyAcceptedIndexForManifest({ ticketId, manifest, relativeManifestPath }))
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
  const legacy = index?.schemaVersion === 1;
  if (
    !exactKeys(index, legacy ? FE01_LEGACY_ACCEPTED_INDEX_KEYS : FE01_ACCEPTED_INDEX_KEYS) ||
    index.ticket !== 'FE-01' ||
    !exactFinalPhysicalValidation(index.physicalValidation) ||
    typeof index.manifestPath !== 'string'
  ) {
    return rejected('existing-accepted-index-schema-or-physical-validation-invalid');
  }
  const manifestPath = path.resolve(root, index.manifestPath);
  if (
    relativeFrom(root, manifestPath) !== index.manifestPath ||
    index.manifestPath !== `.artifacts/verification/FE-01/${index.runId}/manifest.json` ||
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
  if (
    legacy &&
    (index.runId !== LEGACY_STABLE_RUN_ID ||
      sha256File(manifestPath) !== LEGACY_STABLE_MANIFEST_SHA256 ||
      manifest.artifactIdentity?.binarySha256 !== LEGACY_STABLE_BINARY_SHA256)
  ) {
    return rejected('existing-accepted-index-legacy-identity-not-the-authorized-stable-run');
  }
  const backing = validateAcceptedWithWaiverCandidate({
    root,
    evidenceRoot: path.dirname(manifestPath),
    ticketId: 'FE-01',
    manifest,
    legacy,
  });
  if (!backing.eligible || !backing.validated) {
    return rejected(`existing-accepted-index-backing-${backing.reason}`);
  }
  const exactIndex = legacy
    ? exactLegacyAcceptedIndex(index, {
        ticketId: 'FE-01',
        manifest,
        relativeManifestPath: index.manifestPath,
      })
    : exactAcceptedIndex(index, {
        ticketId: 'FE-01',
        manifest,
        relativeManifestPath: index.manifestPath,
        legacySupersede: index.legacySupersede,
      });
  if (!exactIndex) {
    return rejected('existing-accepted-index-binding-invalid');
  }
  if (!legacy) {
    return {
      eligible: true,
      validated: true,
      reason: 'existing-accepted-index-backing-exact',
      runId: index.runId,
      completedAt: index.completedAt,
    };
  }
  const currentRebuild = validateLegacyGlobalHarnessRebuild(root);
  if (!currentRebuild.valid) {
    return rejected(`existing-accepted-index-backing-${currentRebuild.reason}`);
  }
  return {
    ...rejected(`existing-accepted-index-backing-${LEGACY_GLOBAL_HARNESS_FAILURE}`),
    legacySupersedeEligible: true,
    runId: index.runId,
    completedAt: index.completedAt,
    manifestPath: index.manifestPath,
  };
}

/** 候选的 physical eligibility 独立于 accepted index 是否可前进。 */
function validateAcceptedWithWaiverCandidate({
  root,
  evidenceRoot,
  ticketId,
  manifest,
  legacy = false,
}) {
  if (
    ticketId !== 'FE-01' ||
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
    !exactHistoricalPerfStep(manifest.steps) ||
    !exactManifest(manifest, { legacy })
  ) {
    return rejected('manifest-schema-or-step-identity-invalid');
  }
  const waiver = validateFe01Pf01SubjectWaiver({ repoRoot: root });
  const lineage = validateFe01SubjectClosureLineage({ repoRoot: root, finalCommit: manifest.commit });
  if (!exactRecomputedBinding({ manifest, waiver, lineage })) {
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
  if (!legacy) {
    const runLocalAttestation = validateFe01RunLocalHarnessAttestation({
      root,
      evidenceRoot,
      artifactIdentity: manifest.artifactIdentity,
      attestation: manifest.runLocalHarnessAttestation,
    });
    if (!runLocalAttestation.valid) {
      return rejected(runLocalAttestation.reason);
    }
  }
  return { eligible: true, validated: true, reason: 'final-physical-evidence-exact' };
}

export function validateFe01SubjectAcceptedWithWaiverCandidate(input) {
  return validateAcceptedWithWaiverCandidate({ ...input, legacy: false });
}

/** 仅 final-validated 的 clean、physical、exact candidate 才能前进 subject 专属 index。 */
export async function maybeWriteLatestCleanSubjectAcceptedWithWaiver(input) {
  const eligibility = validateFe01SubjectAcceptedWithWaiverCandidate(input);
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
      const lockedEligibility = validateFe01SubjectAcceptedWithWaiverCandidate({
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
      if (!exists) return { valid: true, existing: null, context: { legacySupersede: null } };
      const existing = validateExistingAcceptedIndex({ root, indexPath });
      if (existing.eligible && existing.validated) {
        return {
          valid: true,
          existing: { completedAt: existing.completedAt, runId: existing.runId },
          context: { legacySupersede: null },
        };
      }
      if (
        existing.legacySupersedeEligible !== true ||
        !isNewerCompletion(
          { completedAt: manifest.completedAt, runId: manifest.runId },
          { completedAt: existing.completedAt, runId: existing.runId },
        )
      ) {
        return { valid: false, result: existing };
      }
      return {
        valid: true,
        existing: { completedAt: existing.completedAt, runId: existing.runId },
        context: {
          legacySupersede: {
            mode: 'legacy-global-harness-identity-only',
            reason: LEGACY_SUPERSEDE_REASON,
            previousRunId: existing.runId,
            previousManifestPath: existing.manifestPath,
          },
        },
      };
    },
    createIndex: (context = {}) => {
      const legacySupersede = context.legacySupersede ?? null;
      const candidateIndex = acceptedIndexForManifest({
        ticketId,
        manifest,
        relativeManifestPath,
        legacySupersede,
      });
      return exactAcceptedIndex(candidateIndex, {
        ticketId,
        manifest,
        relativeManifestPath,
        legacySupersede,
      })
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
