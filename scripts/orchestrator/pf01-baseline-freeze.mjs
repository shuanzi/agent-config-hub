/** Immutable, content-addressed PF-01 baseline binding; separate from the numeric budget payload. */
import { sha256Text } from './lib.mjs';
import { PF01_BUDGET_CONSTANTS, PF01_TIMING_METRICS } from './pf01-budget.mjs';
import { PF01_BUILD_ENVIRONMENT, PF01_L3_BUILD_INPUTS } from './pf01-build-inputs.mjs';
import { PF01_MEASUREMENT_INPUTS } from './pf01-measurement-inputs.mjs';

export const PF01_BASELINE_FREEZE_PATH = 'performance/budgets/pf-01.freeze.json';
export const PF01_BASELINE_ARTIFACTS = Object.freeze([
  'harness-identity.json',
  'l2-dev-module-graph.json',
  'l3-resource-runs.json',
  'l3-samples.json',
  'proposed-budgets.json',
  'samples.json',
  'summary.json',
]);
export const PF01_HISTORICAL_BASELINE_IDENTITY = Object.freeze({
  runId: '20260812T033832054Z-p69961-000',
  run: '.artifacts/performance/PF-01/20260812T033832054Z-p69961-000',
  commit: '114298a619af40d00941efec4c959e0b13d6be83',
  descriptorDigest: '1f21a9dad1128ca4482500e1556925a8d8af2468a64e83628e7274007aa28b9a',
  worktreeDirty: false,
});
const BASELINE_IDENTITY_KEYS = Object.freeze([
  'runId',
  'run',
  'commit',
  'descriptorDigest',
  'worktreeDirty',
]);
const BASELINE_BINDING_KEYS = Object.freeze([
  ...BASELINE_IDENTITY_KEYS,
  'artifactSha256',
  'rawTiming',
  'resource',
  'measurementContract',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, keys) {
  return isObject(value) && sameJson(Object.keys(value).sort(), [...keys].sort());
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isGitOid(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function canonicalDigest(binding) {
  const canonical = JSON.parse(JSON.stringify(binding));
  canonical.digest.value = '';
  return sha256Text(`${JSON.stringify(canonical, null, 2)}\n`);
}

function rawTimingFromArtifacts(l2Samples, l3Samples) {
  const output = {};
  for (const metric of PF01_TIMING_METRICS) {
    const source = metric === 'pf01.l3.cold_start.first_snapshot' ? l3Samples : l2Samples;
    const values = source?.metrics?.[metric]?.samples;
    if (
      !Array.isArray(values) ||
      values.length !== PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric] ||
      !values.every(isPositiveNumber)
    ) {
      throw new Error(`PF-01 frozen baseline raw timing invalid: ${metric}`);
    }
    output[metric] = values;
  }
  return output;
}

function resourceFromRuns(resourceRuns) {
  const runs = resourceRuns?.runs;
  if (!Array.isArray(runs) || runs.length !== 3) {
    throw new Error('PF-01 frozen baseline RSS runs invalid');
  }
  const rawPeakBytes = runs.map((run) => {
    if (run?.normalExit !== true || !Array.isArray(run?.samples) || !run.samples.every(isPositiveNumber)) {
      throw new Error('PF-01 frozen baseline RSS/normalExit invalid');
    }
    return Math.max(...run.samples);
  });
  return {
    metric: 'pf01.l3.peak_rss_bytes',
    rawPeakBytes,
    normalExit: runs.map((run) => run.normalExit),
    maxBytes: Math.max(...rawPeakBytes),
  };
}

function frozenMeasurementContract(contract, artifactSha256) {
  return {
    descriptorPath: contract?.descriptorPath,
    descriptorDigest: contract?.descriptorDigest,
    artifact: contract?.artifact,
    buildInputs: {
      schemaVersion: contract?.buildInputs?.schemaVersion,
      algorithm: contract?.buildInputs?.algorithm,
      digest: contract?.buildInputs?.digest,
    },
    measurementInputs: {
      schemaVersion: contract?.measurementInputs?.schemaVersion,
      algorithm: contract?.measurementInputs?.algorithm,
      digest: contract?.measurementInputs?.digest,
      l2DevModuleGraphSha256: artifactSha256?.['l2-dev-module-graph.json'],
    },
    fixture: contract?.fixture,
    runner: contract?.runner,
    toolchain: contract?.toolchain,
    buildEnvironment: contract?.buildEnvironment,
  };
}

function validMeasurementContract(contract) {
  const measurementSchema =
    (contract?.measurementInputs?.schemaVersion === 4 &&
      contract.measurementInputs.algorithm === 'pf01-measurement-inputs-v4') ||
    (contract?.measurementInputs?.schemaVersion === PF01_MEASUREMENT_INPUTS.schemaVersion &&
      contract.measurementInputs.algorithm === PF01_MEASUREMENT_INPUTS.algorithm);
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
    isSha256(contract.descriptorDigest) &&
    exactKeys(contract.artifact, [
      'identityPath',
      'kind',
      'identifier',
      'profile',
      'binary',
      'declaredBinarySha256',
      'actualBinarySha256',
      'provenance',
    ]) &&
    contract.artifact.identityPath === '.artifacts/test-harness/identity.json' &&
    contract.artifact.kind === 'test-harness' &&
    typeof contract.artifact.identifier === 'string' &&
    contract.artifact.identifier.length > 0 &&
    contract.artifact.profile === 'debug' &&
    contract.artifact.binary === 'src-tauri/target/debug/agent-config-manager' &&
    isSha256(contract.artifact.declaredBinarySha256) &&
    contract.artifact.declaredBinarySha256 === contract.artifact.actualBinarySha256 &&
    typeof contract.artifact.provenance === 'string' &&
    contract.artifact.provenance.length > 0 &&
    exactKeys(contract.buildInputs, ['schemaVersion', 'algorithm', 'digest']) &&
    contract.buildInputs.schemaVersion === PF01_L3_BUILD_INPUTS.schemaVersion &&
    contract.buildInputs.algorithm === PF01_L3_BUILD_INPUTS.algorithm &&
    isSha256(contract.buildInputs.digest) &&
    exactKeys(contract.measurementInputs, [
      'schemaVersion',
      'algorithm',
      'digest',
      'l2DevModuleGraphSha256',
    ]) &&
    measurementSchema &&
    isSha256(contract.measurementInputs.digest) &&
    isSha256(contract.measurementInputs.l2DevModuleGraphSha256) &&
    exactKeys(contract.fixture, ['path', 'sha256']) &&
    contract.fixture.path === 'fixtures/fx-01/native-root' &&
    isSha256(contract.fixture.sha256) &&
    exactKeys(contract.runner, ['node', 'npm', 'platform', 'release', 'macosProductVersion', 'arch']) &&
    ['node', 'npm', 'platform', 'release', 'macosProductVersion', 'arch'].every(
      (field) => typeof contract.runner[field] === 'string' && contract.runner[field].length > 0,
    ) &&
    exactKeys(contract.toolchain, ['cargo', 'rustc']) &&
    ['cargo', 'rustc'].every(
      (field) => typeof contract.toolchain[field] === 'string' && contract.toolchain[field].length > 0,
    ) &&
    sameJson(contract.buildEnvironment, PF01_BUILD_ENVIRONMENT)
  );
}

function contractMatchesFrozenBudget(contract, budgetText) {
  if (typeof budgetText !== 'string') return true;
  try {
    const budget = JSON.parse(budgetText);
    const provenance = budget?.baselineProvenance;
    return (
      contract.descriptorDigest === budget.descriptorDigest &&
      sameJson(contract.artifact, provenance?.artifact) &&
      sameJson(contract.fixture, provenance?.fixture) &&
      sameJson(contract.runner, provenance?.runner) &&
      sameJson(contract.toolchain, provenance?.toolchain) &&
      contract.buildInputs.schemaVersion === provenance?.buildInputs?.schemaVersion &&
      contract.buildInputs.algorithm === provenance?.buildInputs?.algorithm &&
      contract.buildInputs.digest === provenance?.buildInputs?.digest &&
      contract.measurementInputs.schemaVersion === provenance?.measurementInputs?.schemaVersion &&
      contract.measurementInputs.algorithm === provenance?.measurementInputs?.algorithm &&
      contract.measurementInputs.digest === provenance?.measurementInputs?.digest
    );
  } catch {
    return false;
  }
}

function validBaselineIdentity(baseline, expectedBaseline) {
  return (
    exactKeys(baseline, BASELINE_BINDING_KEYS) &&
    exactKeys(expectedBaseline, BASELINE_IDENTITY_KEYS) &&
    typeof baseline.runId === 'string' &&
    baseline.run === `.artifacts/performance/PF-01/${baseline.runId}` &&
    isGitOid(baseline.commit) &&
    isSha256(baseline.descriptorDigest) &&
    baseline.worktreeDirty === false &&
    BASELINE_IDENTITY_KEYS.every((field) => baseline[field] === expectedBaseline[field])
  );
}

/** Builds the persisted binding from already-validated, immutable baseline evidence; never samples. */
export function createPf01FrozenBaselineBinding({
  budget,
  baseline,
  artifactSha256,
  l2Samples,
  l3Samples,
  resourceRuns,
  measurementContract,
}) {
  const binding = {
    schemaVersion: 1,
    kind: 'pf-01-frozen-baseline-binding',
    digest: {
      algorithm: 'sha256',
      canonicalization:
        '将本文件 digest.value 置为空字符串后对文件原始字节求 sha256；由 freezer 与 waiver validator 复算',
      value: '',
    },
    budget,
    baseline: {
      ...baseline,
      artifactSha256,
      rawTiming: rawTimingFromArtifacts(l2Samples, l3Samples),
      resource: resourceFromRuns(resourceRuns),
      measurementContract: frozenMeasurementContract(measurementContract, artifactSha256),
    },
  };
  binding.digest.value = canonicalDigest(binding);
  return binding;
}

/** Rechecks an already persisted binding against supplied immutable bytes/artifacts; no ambient sampling. */
export function validatePf01FrozenBaselineBinding({
  binding,
  budgetText,
  artifactSha256,
  l2Samples,
  l3Samples,
  resourceRuns,
  expectedBaseline = PF01_HISTORICAL_BASELINE_IDENTITY,
}) {
  const violations = [];
  if (
    !exactKeys(binding, ['schemaVersion', 'kind', 'digest', 'budget', 'baseline']) ||
    binding.schemaVersion !== 1 ||
    binding.kind !== 'pf-01-frozen-baseline-binding' ||
    !exactKeys(binding.digest, ['algorithm', 'canonicalization', 'value']) ||
    binding.digest.algorithm !== 'sha256' ||
    binding.digest.canonicalization !==
      '将本文件 digest.value 置为空字符串后对文件原始字节求 sha256；由 freezer 与 waiver validator 复算' ||
    !isSha256(binding.digest.value) ||
    binding.digest.value !== canonicalDigest(binding) ||
    !exactKeys(binding.budget, ['path', 'sha256']) ||
    binding.budget.path !== 'performance/budgets/pf-01.budgets.json' ||
    !isSha256(binding.budget.sha256) ||
    !validBaselineIdentity(binding.baseline, expectedBaseline)
  ) {
    violations.push('frozen baseline binding schema/digest invalid');
    return { valid: false, violations };
  }
  if (typeof budgetText === 'string' && sha256Text(budgetText) !== binding.budget.sha256) {
    violations.push('frozen baseline budget SHA-256 mismatch');
  }
  if (
    !exactKeys(binding.baseline.artifactSha256, PF01_BASELINE_ARTIFACTS) ||
    !PF01_BASELINE_ARTIFACTS.every((file) => isSha256(binding.baseline.artifactSha256[file]))
  ) {
    violations.push('frozen baseline seven artifact SHA binding invalid');
  }
  if (
    artifactSha256 !== undefined &&
    !sameJson(binding.baseline.artifactSha256, artifactSha256)
  ) {
    violations.push('frozen baseline artifact SHA drift');
  }
  try {
    if (
      !sameJson(binding.baseline.rawTiming, rawTimingFromArtifacts(l2Samples, l3Samples)) ||
      !sameJson(binding.baseline.resource, resourceFromRuns(resourceRuns))
    ) {
      violations.push('frozen baseline raw timing/RSS/normalExit drift');
    }
  } catch (error) {
    violations.push(error instanceof Error ? error.message : 'frozen baseline raw evidence invalid');
  }
  const contract = binding.baseline.measurementContract;
  if (
    !validMeasurementContract(contract) ||
    binding.baseline.descriptorDigest !== contract?.descriptorDigest ||
    contract.measurementInputs.l2DevModuleGraphSha256 !==
      binding.baseline.artifactSha256?.['l2-dev-module-graph.json'] ||
    !contractMatchesFrozenBudget(contract, budgetText)
  ) {
    violations.push('frozen baseline measurement/buildEnvironment contract invalid');
  }
  return { valid: violations.length === 0, violations };
}
