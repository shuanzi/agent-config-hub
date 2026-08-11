/** Exact immutable provenance checks shared by automatic-pass producer, execution and index. */
import {
  PF01_BUILD_ENVIRONMENT,
  PF01_L3_BUILD_INPUTS,
  validatePf01L3HarnessBuildInputs,
} from './pf01-build-inputs.mjs';
import {
  PF01_MEASUREMENT_INPUTS,
  validatePf01L2ViteDevModuleGraph,
  validatePf01MeasurementInputs,
} from './pf01-measurement-inputs.mjs';
import { PF01_BUDGET_CONSTANTS } from './pf01-budget.mjs';

export const FE01_PF01_AUTOMATIC_PASS_PATH = 'performance/automatic-passes/fe-01-pf-01.json';
export const FE01_PF01_AUTOMATIC_PASS_MODE = 'historical-automatic-pass-validation';
const BUDGET_PATH = 'performance/budgets/pf-01.budgets.json';
const DESCRIPTOR_PATH = 'performance/descriptors/pf-01.catalog-browse.json';
const FIXTURE_PATH = 'fixtures/fx-01/native-root';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validArtifact(value) {
  return (
    isObject(value) &&
    value.identityPath === '.artifacts/test-harness/identity.json' &&
    value.kind === 'test-harness' &&
    typeof value.identifier === 'string' &&
    value.identifier.length > 0 &&
    value.profile === 'debug' &&
    typeof value.binary === 'string' &&
    value.binary.length > 0 &&
    isSha256(value.declaredBinarySha256) &&
    value.declaredBinarySha256 === value.actualBinarySha256 &&
    typeof value.provenance === 'string' &&
    value.provenance.length > 0
  );
}

function artifactIdentity(value) {
  return {
    identityPath: value?.identityPath,
    kind: value?.kind,
    identifier: value?.identifier,
    profile: value?.profile,
    binary: value?.binary,
    provenance: value?.provenance,
  };
}

function sameArtifactIdentity(left, right) {
  return sameJson(artifactIdentity(left), artifactIdentity(right));
}

function validFixture(value) {
  return value?.path === FIXTURE_PATH && isSha256(value.sha256);
}

function validRuntime(value) {
  return (
    isObject(value?.runner) &&
    ['node', 'npm', 'platform', 'release', 'macosProductVersion', 'arch'].every(
      (key) => typeof value.runner[key] === 'string' && value.runner[key].length > 0,
    ) &&
    isObject(value?.toolchain) &&
    typeof value.toolchain.cargo === 'string' &&
    value.toolchain.cargo.length > 0 &&
    typeof value.toolchain.rustc === 'string' &&
    value.toolchain.rustc.length > 0
  );
}

function validInputs(value, expected, expectedKind, expectedCommit, { l2Graph = false } = {}) {
  const valid =
    expected === PF01_L3_BUILD_INPUTS
      ? validatePf01L3HarnessBuildInputs(value, expectedKind)
      : validatePf01MeasurementInputs(value, expectedKind);
  return (
    valid &&
    value.source?.kind === expectedKind &&
    value.source?.method === expected.method &&
    value.source?.commit === expectedCommit &&
    (!l2Graph || validatePf01L2ViteDevModuleGraph(value.l2DevModuleGraph))
  );
}

function sameInputContent(left, right, { l2Graph = false } = {}) {
  return (
    left?.schemaVersion === right?.schemaVersion &&
    left?.algorithm === right?.algorithm &&
    left?.digest === right?.digest &&
    sameJson(left?.entries, right?.entries) &&
    (!l2Graph || sameJson(left?.l2DevModuleGraph, right?.l2DevModuleGraph))
  );
}

function validBaseline(value) {
  return (
    isObject(value) &&
    typeof value.run === 'string' &&
    value.run.startsWith('.artifacts/performance/PF-01/') &&
    isIsoTimestamp(value.collectedAt) &&
    value.statusBeforeBudgetFreeze === 'baseline-collected / budget-not-frozen' &&
    isCommit(value.commit) &&
    value.worktreeDirty === false &&
    validArtifact(value.artifact) &&
    validFixture(value.fixture) &&
    validInputs(value.buildInputs, PF01_L3_BUILD_INPUTS, 'git-object-tree', value.commit) &&
    validInputs(value.measurementInputs, PF01_MEASUREMENT_INPUTS, 'git-object-tree', value.commit, {
      l2Graph: true,
    }) &&
    validRuntime(value) &&
    value.resources?.metric === 'pf01.l3.peak_rss_bytes' &&
    value.resources?.layer === PF01_BUDGET_CONSTANTS.L3_LAYER &&
    sameJson(value.resources?.sampling, PF01_BUDGET_CONSTANTS.RESOURCE_SAMPLING) &&
    Array.isArray(value.resources?.rawPeaksBytes) &&
    value.resources.rawPeaksBytes.length === 3 &&
    value.resources.rawPeaksBytes.every(
      (peak) => typeof peak === 'number' && Number.isFinite(peak) && peak > 0,
    ) &&
    typeof value.resources.maxBytes === 'number' &&
    value.resources.maxBytes === Math.max(...value.resources.rawPeaksBytes)
  );
}

function validCurrent(value, comparisonCommit) {
  return (
    isObject(value) &&
    validArtifact(value.artifact) &&
    validFixture(value.fixture) &&
    validInputs(value.buildInputs, PF01_L3_BUILD_INPUTS, 'clean-tracked-checkout', comparisonCommit) &&
    validInputs(
      value.measurementInputs,
      PF01_MEASUREMENT_INPUTS,
      'clean-tracked-checkout',
      comparisonCommit,
      { l2Graph: true },
    ) &&
    validRuntime(value) &&
    sameJson(value.buildEnvironment, PF01_BUILD_ENVIRONMENT)
  );
}

function validBinding(value) {
  return (
    isObject(value) &&
    value.recordPath === FE01_PF01_AUTOMATIC_PASS_PATH &&
    isSha256(value.recordSha256) &&
    isObject(value.comparison) &&
    typeof value.comparison.runId === 'string' &&
    value.comparison.run === `.artifacts/performance/PF-01/${value.comparison.runId}` &&
    isCommit(value.comparison.commit) &&
    value.comparison.worktreeDirty === false &&
    value.comparison.status === 'pass' &&
    value.comparison.exitCode === 0
  );
}

/** Full provenance evidence must be complete and mutually exact before any no-sampling pass. */
export function validateFe01Pf01AutomaticPassEvidence({ binding, evidence } = {}) {
  const violations = [];
  if (!validBinding(binding)) violations.push('automatic-pass binding invalid');
  if (
    !isObject(evidence) ||
    !sameJson(Object.keys(evidence).sort(), [
      'baselineProvenance',
      'budget',
      'comparison',
      'currentProvenance',
      'descriptor',
      'record',
    ])
  ) {
    violations.push('automatic-pass evidence key set invalid');
    return { valid: false, violations };
  }
  if (evidence.record?.path !== binding?.recordPath || evidence.record?.sha256 !== binding?.recordSha256) {
    violations.push('automatic-pass record binding invalid');
  }
  if (!sameJson(evidence.comparison, binding?.comparison)) {
    violations.push('automatic-pass comparison binding invalid');
  }
  if (evidence.budget?.path !== BUDGET_PATH || !isSha256(evidence.budget?.sha256)) {
    violations.push('automatic-pass budget binding invalid');
  }
  if (evidence.descriptor?.path !== DESCRIPTOR_PATH || !isSha256(evidence.descriptor?.digest)) {
    violations.push('automatic-pass descriptor binding invalid');
  }
  if (!validBaseline(evidence.baselineProvenance)) {
    violations.push('automatic-pass baseline provenance incomplete');
  }
  if (!validCurrent(evidence.currentProvenance, binding?.comparison?.commit)) {
    violations.push('automatic-pass current provenance incomplete');
  }
  const baseline = evidence.baselineProvenance;
  const current = evidence.currentProvenance;
  if (
    validBaseline(baseline) &&
    validCurrent(current, binding?.comparison?.commit) &&
    (!sameArtifactIdentity(baseline.artifact, current.artifact) ||
      !sameJson(baseline.fixture, current.fixture) ||
      !sameInputContent(baseline.buildInputs, current.buildInputs) ||
      !sameInputContent(baseline.measurementInputs, current.measurementInputs, { l2Graph: true }) ||
      !sameJson(baseline.runner, current.runner) ||
      !sameJson(baseline.toolchain, current.toolchain))
  ) {
    violations.push('automatic-pass baseline/current provenance drift');
  }
  return { valid: violations.length === 0, ...(violations.length === 0 ? {} : { violations }) };
}

function noSamplingPerfSteps(manifest) {
  return Array.isArray(manifest?.steps)
    ? manifest.steps.filter((step) => step?.id === 'perf' && step.execution?.samplingRun === false)
    : [];
}

/** A perf step declaring samplingRun=false may never fall back to ordinary clean-pass indexing. */
export function validateFe01Pf01AutomaticPassManifest({ ticketId, manifest } = {}) {
  if (ticketId !== 'FE-01') return { valid: true };
  const noSampling = noSamplingPerfSteps(manifest);
  const marked =
    noSampling.length > 0 ||
    manifest?.automaticPassValidation !== undefined ||
    manifest?.pfAutomaticResult !== undefined ||
    manifest?.pf01Provenance?.kind === 'fe-01-pf-01-automatic-pass';
  if (!marked) return { valid: true };
  const violations = [];
  if (
    noSampling.some(
      (step) => step.execution?.mode !== FE01_PF01_AUTOMATIC_PASS_MODE || step.execution?.samplingRun !== false,
    )
  ) {
    violations.push('no-sampling perf execution mode invalid');
  }
  const validation = manifest?.automaticPassValidation;
  const automatic = manifest?.pfAutomaticResult;
  if (
    !isObject(validation) ||
    validation.initial !== 'valid' ||
    validation.final !== 'valid' ||
    validation.bindingStable !== true ||
    !isObject(automatic) ||
    automatic.status !== 'pass' ||
    automatic.exitCode !== 0 ||
    automatic.automatedExitCode !== 0 ||
    automatic.worktreeDirty !== false ||
    !isCommit(automatic.commit)
  ) {
    violations.push('automatic-pass manifest markers invalid');
  }
  const binding = {
    recordPath: validation?.recordPath,
    recordSha256: validation?.recordSha256,
    comparison: {
      runId: automatic?.runId,
      run: automatic?.run,
      commit: automatic?.commit,
      worktreeDirty: automatic?.worktreeDirty,
      status: automatic?.status,
      exitCode: automatic?.exitCode,
    },
  };
  const provenance = manifest?.pf01Provenance;
  const evidence = {
    record: provenance?.record,
    comparison: provenance?.comparison,
    budget: provenance?.budget,
    descriptor: provenance?.descriptor,
    baselineProvenance: provenance?.baseline,
    currentProvenance: provenance?.current,
  };
  if (manifest?.budgetValidation?.valid !== true || provenance?.descriptor?.digest !== manifest?.pfDescriptorDigest) {
    violations.push('automatic-pass manifest budget/descriptor invalid');
  }
  if (
    provenance?.kind !== 'fe-01-pf-01-automatic-pass' ||
    provenance?.mode !== FE01_PF01_AUTOMATIC_PASS_MODE
  ) {
    violations.push('automatic-pass manifest provenance identity invalid');
  }
  const evidenceValidation = validateFe01Pf01AutomaticPassEvidence({ binding, evidence });
  if (!evidenceValidation.valid) violations.push(...evidenceValidation.violations);
  return { valid: violations.length === 0, ...(violations.length === 0 ? {} : { violations }) };
}
