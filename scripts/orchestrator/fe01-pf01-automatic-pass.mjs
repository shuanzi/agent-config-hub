import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import {
  assertNoGitAmbient,
  gitInfo,
  REPO_ROOT,
  scanEvidenceText,
  sha256File,
  sha256Text,
} from './lib.mjs';
import {
  assertPf01L3BuildEnvironment,
  assertPf01VerificationEnvironment,
  collectPf01L3HarnessBuildInputsFromGit,
  PF01_BUILD_ENVIRONMENT,
  validatePf01L3HarnessBuildInputs,
} from './pf01-build-inputs.mjs';
import {
  collectPf01MeasurementInputsFromGit,
  validatePf01L2ViteDevModuleGraph,
  validatePf01MeasurementInputs,
} from './pf01-measurement-inputs.mjs';
import {
  capturePf01RuntimeProvenance,
  collectCurrentPf01Attestation,
  PF01_BUDGET_CONSTANTS,
  PF01_TIMING_METRICS,
  validateCurrentPf01Attestation,
  validateFrozenPf01Budget,
} from './pf01-budget.mjs';
import { hasPhysicalPath } from './clean-evidence-index.mjs';
import { finalizeHarnessPeakRss, validatePf01ResourceEvidence } from './pf01-resource.mjs';
import { isPf01AutomatedPassResult, PF01_CLEAN_CONTAMINATION } from './pf01-automated-result.mjs';
import {
  FE01_PF01_AUTOMATIC_PASS_PATH,
  validateFe01Pf01AutomaticPassEvidence,
} from './fe01-pf01-automatic-pass-validation.mjs';

/**
 * FE-01 未来自动 PF pass 的 ticket-specific current-input binding。
 *
 * 此模块不读取或升级任何 historical waiver。只有未来真实 comparison 生成的独立
 * automatic-pass record 才可通过本 binding；调用方必须再验证 immutable run/record 文件。
 */

const BUILD_INPUTS = { schemaVersion: 4, algorithm: 'pf01-l3-harness-build-inputs-v4' };
const MEASUREMENT_INPUTS = { schemaVersion: 4, algorithm: 'pf01-measurement-inputs-v4' };
const L2_DEV_GRAPH = { schemaVersion: 3, algorithm: 'pf01-l2-vite-dev-module-graph-v3' };
const RECORD_PATH = 'performance/automatic-passes/fe-01-pf-01.json';
const BUDGET_PATH = 'performance/budgets/pf-01.budgets.json';
const DESCRIPTOR_PATH = 'performance/descriptors/pf-01.catalog-browse.json';
const FIXTURE_PATH = 'fixtures/fx-01/native-root';
const REQUIRED_ARTIFACTS = [
  'harness-identity.json',
  'l2-dev-module-graph.json',
  'l3-resource-runs.json',
  'l3-samples.json',
  'proposed-budgets.json',
  'samples.json',
  'summary.json',
];
const PROFILE = 'representative';
const L3_METRIC = 'pf01.l3.cold_start.first_snapshot';
const L2_METRICS = PF01_TIMING_METRICS.filter((metric) => metric !== L3_METRIC);

export { FE01_PF01_AUTOMATIC_PASS_PATH };

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function selfConsistentArtifact(value) {
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

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
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

function rawTimingSamples(payload, metrics, { profile, layer } = {}) {
  if (
    !isObject(payload) ||
    !sameKeys(
      payload,
      profile === undefined
        ? ['schemaVersion', 'descriptorId', 'layer', 'collectedAt', 'unit', 'metrics']
        : ['schemaVersion', 'descriptorId', 'profile', 'collectedAt', 'unit', 'metrics'],
    ) ||
    payload.schemaVersion !== 1 ||
    payload.descriptorId !== 'PF-01' ||
    payload.unit !== 'ms' ||
    !isIsoTimestamp(payload.collectedAt) ||
    !isObject(payload.metrics) ||
    (profile !== undefined && payload.profile !== profile) ||
    (layer !== undefined && payload.layer !== layer) ||
    !sameJson(Object.keys(payload.metrics).sort(), [...metrics].sort())
  ) {
    throw new Error('raw timing samples descriptor/profile/metric set invalid');
  }
  const samples = {};
  for (const metric of metrics) {
    const values = payload.metrics[metric]?.samples;
    if (
      !Array.isArray(values) ||
      values.length !== PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric] ||
      !values.every(isPositiveNumber)
    ) {
      throw new Error(`raw timing samples incomplete: ${metric}`);
    }
    samples[metric] = values;
  }
  return samples;
}

function validInputs(value, expected, sourceKind) {
  return expected === BUILD_INPUTS
    ? validatePf01L3HarnessBuildInputs(value, sourceKind)
    : validatePf01MeasurementInputs(value, sourceKind);
}

function validDevGraph(value) {
  return (
    isObject(value) &&
    value.schemaVersion === L2_DEV_GRAPH.schemaVersion &&
    value.algorithm === L2_DEV_GRAPH.algorithm &&
    value.entry === 'tests/l2/workbench.html' &&
    Array.isArray(value.declaredModulePaths) &&
    Array.isArray(value.actualModulePaths)
  );
}

function sameKeys(value, expected) {
  return isObject(value) && sameJson(Object.keys(value).sort(), [...expected].sort());
}

function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value);
}

function canonicalRecordDigest(record) {
  const canonical = JSON.parse(JSON.stringify(record));
  canonical.recordDigest.value = '';
  return sha256Text(`${JSON.stringify(canonical)}\n`);
}

function validRecord(record) {
  return (
    sameKeys(record, [
      'schemaVersion',
      'kind',
      'recordDigest',
      'ticket',
      'performance',
      'comparison',
      'budget',
      'descriptor',
      'current',
      'artifactSha256',
    ]) &&
    record.schemaVersion === 2 &&
    record.kind === 'fe-01-pf-01-automatic-pass' &&
    record.ticket === 'FE-01' &&
    record.performance === 'PF-01' &&
    sameKeys(record.recordDigest, ['algorithm', 'canonicalization', 'value']) &&
    record.recordDigest.algorithm === 'sha256' &&
    record.recordDigest.canonicalization ===
      'JSON.stringify(record with recordDigest.value set to an empty string) plus newline' &&
    isSha256(record.recordDigest.value) &&
    record.recordDigest.value === canonicalRecordDigest(record) &&
    sameKeys(record.comparison, ['runId', 'run', 'commit', 'worktreeDirty', 'status', 'exitCode']) &&
    typeof record.comparison.runId === 'string' &&
    record.comparison.run === `.artifacts/performance/PF-01/${record.comparison.runId}` &&
    isCommit(record.comparison.commit) &&
    record.comparison.worktreeDirty === false &&
    record.comparison.status === 'pass' &&
    record.comparison.exitCode === 0 &&
    sameJson(record.budget && Object.keys(record.budget).sort(), ['path', 'sha256']) &&
    record.budget?.path === BUDGET_PATH &&
    isSha256(record.budget?.sha256) &&
    sameJson(record.descriptor && Object.keys(record.descriptor).sort(), ['digest', 'path']) &&
    record.descriptor?.path === DESCRIPTOR_PATH &&
    isSha256(record.descriptor?.digest) &&
    isObject(record.current) &&
    sameKeys(record.current, [
      'artifact',
      'fixture',
      'buildInputs',
      'measurementInputs',
      'runner',
      'toolchain',
      'buildEnvironment',
    ]) &&
    selfConsistentArtifact(record.current.artifact) &&
    validInputs(record.current.buildInputs, BUILD_INPUTS, 'clean-tracked-checkout') &&
    validInputs(record.current.measurementInputs, MEASUREMENT_INPUTS, 'clean-tracked-checkout') &&
    validDevGraph(record.current.measurementInputs.l2DevModuleGraph) &&
    sameKeys(record.artifactSha256, REQUIRED_ARTIFACTS) &&
    REQUIRED_ARTIFACTS.every((file) => isSha256(record.artifactSha256[file]))
  );
}

function git(repoRoot, args, encoding = 'utf8') {
  assertNoGitAmbient();
  return execFileSync('git', args, { cwd: repoRoot, encoding, maxBuffer: 16 * 1024 * 1024 });
}

function gitText(repoRoot, commit, relativePath) {
  return git(repoRoot, ['show', `${commit}:${relativePath}`]);
}

function digestGitFixture(repoRoot, commit) {
  const prefix = `${FIXTURE_PATH}/`;
  const paths = git(repoRoot, ['ls-tree', '-r', '-z', '--name-only', commit], 'buffer')
    .toString('utf8')
    .split('\0')
    .filter((pathname) => pathname.startsWith(prefix));
  if (paths.length === 0) throw new Error('automatic-pass current FX-01 fixture missing from HEAD Git tree');
  const digest = {};
  for (const pathname of paths) {
    digest[pathname.slice(prefix.length)] = createHash('sha256')
      .update(git(repoRoot, ['show', `${commit}:${pathname}`], 'buffer'))
      .digest('hex');
  }
  return sha256Text(JSON.stringify(digest));
}

function assertComparisonGitProvenance({ repoRoot, comparison, summary, l2DevModuleGraph }) {
  const current = summary?.comparisonProvenance?.current;
  if (
    current?.buildInputs?.source?.kind !== 'clean-tracked-checkout' ||
    current.buildInputs.source.commit !== comparison.commit ||
    current?.measurementInputs?.source?.kind !== 'clean-tracked-checkout' ||
    current.measurementInputs.source.commit !== comparison.commit
  ) {
    throw new Error('automatic-pass comparison current input source commit invalid');
  }
  const buildInputs = collectPf01L3HarnessBuildInputsFromGit({
    repoRoot,
    commit: comparison.commit,
  });
  const measurementInputs = collectPf01MeasurementInputsFromGit({
    repoRoot,
    commit: comparison.commit,
    l2DevModuleGraph,
  });
  const fixture = { path: FIXTURE_PATH, sha256: digestGitFixture(repoRoot, comparison.commit) };
  if (
    current.buildInputs.digest !== buildInputs.digest ||
    !sameJson(current.buildInputs.entries, buildInputs.entries) ||
    current.measurementInputs.digest !== measurementInputs.digest ||
    !sameJson(current.measurementInputs.entries, measurementInputs.entries) ||
    !sameJson(current.measurementInputs.l2DevModuleGraph, l2DevModuleGraph) ||
    !sameJson(current.fixture, fixture)
  ) {
    throw new Error('automatic-pass comparison Git-object inputs or fixture drift');
  }
}

function descriptorDigestFromGitText(text) {
  const descriptor = JSON.parse(text);
  const digest = descriptor?.digest?.value;
  if (!isSha256(digest) || sha256Text(text.replace(`"value": "${digest}"`, '"value": ""')) !== digest) {
    throw new Error('automatic-pass current descriptor digest invalid');
  }
  return { path: DESCRIPTOR_PATH, digest };
}

function currentInputReference(inputs) {
  return {
    schemaVersion: inputs.schemaVersion,
    algorithm: inputs.algorithm,
    digest: inputs.digest,
    entries: inputs.entries,
    source: inputs.source,
    ...(inputs.l2DevModuleGraph === undefined ? {} : { l2DevModuleGraph: inputs.l2DevModuleGraph }),
  };
}

/** Recompute current HEAD-only inputs; working-tree source bytes are never accepted as provenance. */
export async function collectFe01Pf01AutomaticPassCurrentHead({
  repoRoot = REPO_ROOT,
  l2DevModuleGraph,
  runtimeProvenance,
} = {}) {
  if (!validatePf01L2ViteDevModuleGraph(l2DevModuleGraph)) {
    throw new Error('automatic-pass record L2 dev graph invalid');
  }
  const identity = await gitInfo({ repoRoot });
  if (identity.worktreeDirty !== false || !isCommit(identity.commit)) {
    throw new Error('automatic-pass current HEAD must be clean and resolvable');
  }
  const budgetText = gitText(repoRoot, identity.commit, BUDGET_PATH);
  const descriptorText = gitText(repoRoot, identity.commit, DESCRIPTOR_PATH);
  const runtime = runtimeProvenance ?? (await capturePf01RuntimeProvenance());
  const physical = collectCurrentPf01Attestation({ repoRoot, runtimeProvenance: runtime });
  return {
    budget: { path: BUDGET_PATH, sha256: sha256Text(budgetText) },
    descriptor: descriptorDigestFromGitText(descriptorText),
    fixture: { path: FIXTURE_PATH, sha256: digestGitFixture(repoRoot, identity.commit) },
    artifact: physical.artifact,
    buildInputs: currentInputReference(
      collectPf01L3HarnessBuildInputsFromGit({ repoRoot, commit: identity.commit }),
    ),
    measurementInputs: currentInputReference(
      collectPf01MeasurementInputsFromGit({ repoRoot, commit: identity.commit, l2DevModuleGraph }),
    ),
    runner: runtime.runner,
    toolchain: runtime.toolchain,
    buildEnvironment: assertPf01L3BuildEnvironment(undefined, repoRoot),
  };
}

/**
 * Public seam for a future real automatic-pass record: every source-affecting current
 * input is compared exactly, so a later clean docs commit is allowed while any PF input
 * drift is rejected.
 */
export function validateFe01Pf01AutomaticPassCurrentBinding({ record, current } = {}) {
  const violations = [];
  if (
    !isObject(record) ||
    record.schemaVersion !== 2 ||
    record.kind !== 'fe-01-pf-01-automatic-pass' ||
    record.ticket !== 'FE-01' ||
    record.performance !== 'PF-01' ||
    !isObject(record.comparison) ||
    record.comparison.status !== 'pass' ||
    record.comparison.exitCode !== 0 ||
    record.comparison.worktreeDirty !== false
  ) {
    violations.push('automatic-pass record identity/status invalid');
  }
  if (!isObject(record.current) || !isObject(current)) {
    violations.push('automatic-pass current binding missing');
    return { valid: false, violations };
  }
  if (
    !validInputs(record.current.buildInputs, BUILD_INPUTS, 'clean-tracked-checkout') ||
    !validInputs(current.buildInputs, BUILD_INPUTS, 'clean-tracked-checkout')
  ) {
    violations.push('automatic-pass buildInputs v4 invalid');
  }
  if (
    !validInputs(record.current.measurementInputs, MEASUREMENT_INPUTS, 'clean-tracked-checkout') ||
    !validInputs(current.measurementInputs, MEASUREMENT_INPUTS, 'clean-tracked-checkout') ||
    !validDevGraph(record.current.measurementInputs?.l2DevModuleGraph) ||
    !validDevGraph(current.measurementInputs?.l2DevModuleGraph)
  ) {
    violations.push('automatic-pass measurementInputs/dev graph v4/v3 invalid');
  }
  if (!selfConsistentArtifact(record.current.artifact)) {
    violations.push('automatic-pass comparison artifact declared/actual binary SHA invalid');
  }
  if (!selfConsistentArtifact(current.artifact)) {
    violations.push('automatic-pass current artifact declared/actual binary SHA invalid');
  }
  if (
    selfConsistentArtifact(record.current.artifact) &&
    selfConsistentArtifact(current.artifact) &&
    !sameJson(artifactIdentity(record.current.artifact), artifactIdentity(current.artifact))
  ) {
    violations.push('automatic-pass current artifact identity drift');
  }
  for (const field of ['budget', 'descriptor']) {
    if (!sameJson(record[field], current[field])) {
      violations.push(`automatic-pass current ${field} drift`);
    }
  }
  for (const field of [
    'fixture',
    'buildInputs',
    'measurementInputs',
    'runner',
    'toolchain',
    'buildEnvironment',
  ]) {
    if (!sameJson(record.current[field], current[field])) {
      violations.push(`automatic-pass current ${field} drift`);
    }
  }
  return { valid: violations.length === 0, ...(violations.length === 0 ? {} : { violations }) };
}

function invalid(violations, message) {
  violations.push(message);
  return { valid: false, violations };
}

function metricPassesBudget(summary, budget) {
  const entries = new Map((budget?.budgets ?? []).map((entry) => [entry?.metric, entry]));
  const metrics = summary?.metrics;
  if (!isObject(metrics) || entries.size === 0) return false;
  for (const [metric, entry] of entries) {
    const stats = metrics[metric];
    if (
      !isObject(stats) ||
      typeof stats.p50 !== 'number' ||
      typeof stats.p95 !== 'number' ||
      typeof entry?.absoluteCeilingMs !== 'number' ||
      typeof entry?.baseline?.p50 !== 'number' ||
      typeof entry?.regressionAllowance?.maxRatio !== 'number' ||
      stats.p95 > entry.absoluteCeilingMs ||
      stats.p50 > entry.baseline.p50 * entry.regressionAllowance.maxRatio
    ) {
      return false;
    }
  }
  return Object.keys(metrics).length === entries.size;
}

function automaticResultIsExact(value) {
  return isPf01AutomatedPassResult(value);
}

function validateSummaryAgainstRawArtifacts({ summary, artifacts, budget, descriptor, comparison }) {
  const violations = [];
  if (
    !isObject(summary) ||
    summary.schemaVersion !== 1 ||
    summary.descriptorId !== 'PF-01' ||
    summary.descriptorDigest !== descriptor?.digest?.value ||
    summary.profile !== PROFILE ||
    !isIsoTimestamp(summary.collectedAt) ||
    summary.status !== 'budget-comparison' ||
    summary.budgetState !== 'budget-frozen（performance/budgets/pf-01.budgets.json）' ||
    summary.budgetValidation?.valid !== true ||
    !Array.isArray(summary.budgetValidation?.violations) ||
    summary.budgetValidation.violations.length !== 0 ||
    !automaticResultIsExact(summary.automatedResult) ||
    !sameJson(summary.contamination, PF01_CLEAN_CONTAMINATION)
  ) {
    violations.push('summary automated result/status/contamination invalid');
  }
  const identity = summary?.runIdentity;
  if (
    !sameKeys(identity, [
      'startCommit',
      'startWorktreeDirty',
      'endCommit',
      'endWorktreeDirty',
      'consistent',
    ]) ||
    identity.startCommit !== comparison.commit ||
    identity.endCommit !== comparison.commit ||
    identity.startWorktreeDirty !== false ||
    identity.endWorktreeDirty !== false ||
    identity.consistent !== true
  ) {
    violations.push('summary run identity is not one clean comparison commit');
  }

  let rawSamples;
  try {
    rawSamples = {
      ...rawTimingSamples(artifacts['samples.json'], L2_METRICS, { profile: PROFILE }),
      ...rawTimingSamples(artifacts['l3-samples.json'], [L3_METRIC], {
        layer: 'L3 test-harness debug（非 release-like artifact）',
      }),
    };
  } catch (error) {
    violations.push(error instanceof Error ? error.message : 'raw timing samples invalid');
  }
  if (rawSamples !== undefined) {
    for (const metric of PF01_TIMING_METRICS) {
      const expected = {
        ...summarize(rawSamples[metric]),
        minSamples: PF01_BUDGET_CONSTANTS.EXACT_SAMPLE_COUNTS[metric],
        complete: true,
        unit: 'ms',
        layer: metric === L3_METRIC ? PF01_BUDGET_CONSTANTS.L3_LAYER : PF01_BUDGET_CONSTANTS.L2_LAYER,
      };
      if (!sameJson(summary.metrics?.[metric], expected)) {
        violations.push(`${metric} summary/raw timing mismatch`);
      }
    }
    if (!sameJson(Object.keys(summary.metrics ?? {}).sort(), [...PF01_TIMING_METRICS].sort())) {
      violations.push('summary timing metric set invalid');
    }
  }

  try {
    const resourceRuns = artifacts['l3-resource-runs.json'];
    if (
      !sameKeys(resourceRuns, ['schemaVersion', 'metric', 'runs']) ||
      resourceRuns.schemaVersion !== 1 ||
      resourceRuns.metric !== 'pf01.l3.peak_rss_bytes'
    ) {
      throw new Error('L3 RSS raw run schema invalid');
    }
    const resources = finalizeHarnessPeakRss(resourceRuns.runs);
    if (!validatePf01ResourceEvidence(resources).valid) throw new Error('L3 RSS resource schema invalid');
    if (!sameJson(summary.resources, { status: 'collected', ...resources })) {
      throw new Error('summary L3 RSS evidence mismatch');
    }
  } catch (error) {
    violations.push(error instanceof Error ? error.message : 'L3 RSS evidence invalid');
  }

  const current = summary?.comparisonProvenance?.current;
  const harnessIdentity = artifacts['harness-identity.json'];
  if (
    !sameKeys(harnessIdentity, ['schemaVersion', 'artifact']) ||
    harnessIdentity.schemaVersion !== 1 ||
    !sameJson(harnessIdentity.artifact, current?.artifact)
  ) {
    violations.push('immutable comparison harness identity artifact mismatch');
  }
  if (!validatePf01L2ViteDevModuleGraph(artifacts['l2-dev-module-graph.json'])) {
    violations.push('actual L2 Vite dev module graph invalid');
  } else if (!sameJson(current?.measurementInputs?.l2DevModuleGraph, artifacts['l2-dev-module-graph.json'])) {
    violations.push('summary/current actual L2 Vite dev module graph mismatch');
  }
  const currentValidation = validateCurrentPf01Attestation(current);
  if (!currentValidation.valid) {
    violations.push(...currentValidation.violations.map((violation) => `summary current ${violation}`));
  }
  if (
    !sameJson(current?.buildEnvironment, PF01_BUILD_ENVIRONMENT)
  ) {
    violations.push('summary build environment provenance invalid');
  }
  const budgetValidation = validateFrozenPf01Budget(budget, descriptor, PROFILE, current);
  if (!budgetValidation.valid) {
    violations.push(...budgetValidation.violations.map((violation) => `frozen budget ${violation}`));
  }
  if (!metricPassesBudget(summary, budget)) {
    violations.push('raw timing summary does not pass frozen budget');
  }
  return { valid: violations.length === 0, violations };
}

/** Recompute an exit-0 automatic pass from the immutable run instead of trusting its summary label. */
export function validateFe01Pf01AutomaticPassComparisonSource({
  comparison,
  summary,
  budgetText,
  descriptorText,
  artifacts,
  artifactTexts,
} = {}) {
  const violations = [];
  let budget;
  let descriptor;
  try {
    budget = JSON.parse(budgetText);
    descriptor = JSON.parse(descriptorText);
  } catch {
    return { valid: false, violations: ['automatic-pass immutable budget/descriptor JSON invalid'] };
  }
  if (
    !isObject(artifacts) ||
    !sameKeys(artifacts, REQUIRED_ARTIFACTS) ||
    !isObject(artifactTexts) ||
    !sameKeys(artifactTexts, REQUIRED_ARTIFACTS)
  ) {
    return { valid: false, violations: ['automatic-pass immutable artifact set invalid'] };
  }
  for (const file of REQUIRED_ARTIFACTS) {
    if (typeof artifactTexts[file] !== 'string' || !scanEvidenceText(artifactTexts[file]).clean) {
      violations.push(`${file} evidence contamination`);
    }
  }
  const source = validateSummaryAgainstRawArtifacts({
    summary,
    artifacts,
    budget,
    descriptor,
    comparison,
  });
  violations.push(...source.violations);
  return { valid: violations.length === 0, ...(violations.length === 0 ? {} : { violations }) };
}

function summaryCurrentReference(summary) {
  const current = summary?.comparisonProvenance?.current;
  if (!isObject(current)) return null;
  return {
    artifact: current.artifact,
    fixture: current.fixture,
    buildInputs: currentInputReference(current.buildInputs ?? {}),
    measurementInputs: currentInputReference(current.measurementInputs ?? {}),
    runner: current.runner,
    toolchain: current.toolchain,
    buildEnvironment: current.buildEnvironment,
  };
}

function comparisonPayloadIsValid(record, summary, budgetText, descriptorText, artifacts, artifactTexts) {
  try {
    JSON.parse(budgetText);
  } catch {
    return false;
  }
  const runIdentity = summary?.runIdentity;
  return (
    summary?.schemaVersion === 1 &&
    summary?.status === 'budget-comparison' &&
    summary?.budgetValidation?.valid === true &&
    Array.isArray(summary?.budgetValidation?.violations) &&
    summary.budgetValidation.violations.length === 0 &&
    sameKeys(runIdentity, [
      'startCommit',
      'startWorktreeDirty',
      'endCommit',
      'endWorktreeDirty',
      'consistent',
    ]) &&
    runIdentity.startCommit === record.comparison.commit &&
    runIdentity.endCommit === record.comparison.commit &&
    runIdentity.startWorktreeDirty === false &&
    runIdentity.endWorktreeDirty === false &&
    runIdentity.consistent === true &&
    sha256Text(budgetText) === record.budget.sha256 &&
    descriptorDigestFromGitText(descriptorText).digest === record.descriptor.digest &&
    sameJson(summaryCurrentReference(summary), record.current) &&
    REQUIRED_ARTIFACTS.every(
      (file) => typeof artifactTexts?.[file] === 'string' && sha256Text(artifactTexts[file]) === record.artifactSha256[file],
    ) &&
    validateFe01Pf01AutomaticPassComparisonSource({
      comparison: record.comparison,
      summary,
      budgetText,
      descriptorText,
      artifacts,
      artifactTexts,
    }).valid
  );
}

/**
 * 受控 generator 的纯 public seam：它只接受完整 clean exit-0 comparison 的 immutable
 * inputs，保留 comparison 的实际 binary SHA；不会读取或写入工作树。
 */
export function createFe01Pf01AutomaticPassRecord({
  comparison,
  artifactSha256,
  summary,
  budgetText,
  descriptorText,
  artifacts,
  artifactTexts,
} = {}) {
  const record = {
    schemaVersion: 2,
    kind: 'fe-01-pf-01-automatic-pass',
    recordDigest: {
      algorithm: 'sha256',
      canonicalization: 'JSON.stringify(record with recordDigest.value set to an empty string) plus newline',
      value: '',
    },
    ticket: 'FE-01',
    performance: 'PF-01',
    comparison,
    budget: { path: BUDGET_PATH, sha256: sha256Text(budgetText ?? '') },
    descriptor: (() => {
      try {
        return descriptorDigestFromGitText(descriptorText ?? '');
      } catch {
        return { path: DESCRIPTOR_PATH, digest: '' };
      }
    })(),
    current: summaryCurrentReference(summary),
    artifactSha256,
  };
  record.recordDigest.value = canonicalRecordDigest(record);
  if (!validRecord(record)) {
    throw new Error('automatic-pass generated record schema/digest invalid');
  }
  if (!comparisonPayloadIsValid(record, summary, budgetText, descriptorText, artifacts, artifactTexts)) {
    throw new Error('automatic-pass comparison artifact/provenance is not a clean exit-0 record source');
  }
  return record;
}

function physicalJson(repoRoot, filePath) {
  if (!hasPhysicalPath(repoRoot, filePath)) throw new Error('automatic-pass physical path rejected');
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('automatic-pass JSON must be regular');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readPhysicalComparisonArtifacts(repoRoot, comparisonRun) {
  if (typeof comparisonRun !== 'string' || !/^\d{8}T\d{9}Z-p\d+-\d{3}$/.test(comparisonRun)) {
    throw new Error('automatic-pass comparison runId invalid');
  }
  const run = `.artifacts/performance/PF-01/${comparisonRun}`;
  const runDirectory = path.resolve(repoRoot, run);
  if (!hasPhysicalPath(repoRoot, runDirectory)) throw new Error('automatic-pass comparison run path rejected');
  const runStats = fs.lstatSync(runDirectory);
  if (!runStats.isDirectory() || runStats.isSymbolicLink()) {
    throw new Error('automatic-pass comparison run directory rejected');
  }
  if (!sameJson(fs.readdirSync(runDirectory).sort(), REQUIRED_ARTIFACTS)) {
    throw new Error('automatic-pass comparison artifact set invalid');
  }
  const artifactSha256 = {};
  const artifacts = {};
  const artifactTexts = {};
  for (const file of REQUIRED_ARTIFACTS) {
    const filePath = path.join(runDirectory, file);
    const stats = fs.lstatSync(filePath);
    if (!hasPhysicalPath(repoRoot, filePath) || !stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`automatic-pass comparison artifact physical path rejected: ${file}`);
    }
    const text = fs.readFileSync(filePath, 'utf8');
    artifactSha256[file] = sha256File(filePath);
    try {
      artifacts[file] = JSON.parse(text);
    } catch {
      throw new Error(`automatic-pass immutable artifact JSON invalid: ${file}`);
    }
    artifactTexts[file] = text;
  }
  return {
    run,
    runDirectory,
    artifactSha256,
    artifacts,
    artifactTexts,
    summary: artifacts['summary.json'],
  };
}

function assertNewAutomaticPassTarget(repoRoot, recordPath) {
  if (recordPath !== RECORD_PATH) throw new Error('automatic-pass record target must be ticket-specific path');
  const absolute = path.resolve(repoRoot, recordPath);
  if (path.relative(repoRoot, absolute).split(path.sep).join('/') !== recordPath) {
    throw new Error('automatic-pass record target outside repository');
  }
  for (let current = path.dirname(absolute); ; current = path.dirname(current)) {
    if (fs.existsSync(current)) {
      const stats = fs.lstatSync(current);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`automatic-pass record target parent rejected: ${current}`);
      }
    }
    if (current === repoRoot) break;
  }
  if (fs.existsSync(absolute)) throw new Error('automatic-pass record already exists; generator refuses overwrite');
  return absolute;
}

async function formatAutomaticPassRecord(record, repoRoot) {
  const config = await prettier.resolveConfig(path.join(repoRoot, RECORD_PATH));
  return prettier.format(JSON.stringify(record), {
    ...config,
    filepath: path.join(repoRoot, RECORD_PATH),
    parser: 'json',
  });
}

/**
 * Controlled future-only record generator. It never invokes PF, accepts exactly one
 * immutable clean exit-0 comparison run at current clean HEAD, and refuses overwrite.
 */
export async function writeFe01Pf01AutomaticPassRecord({
  repoRoot = REPO_ROOT,
  comparisonRun,
  recordPath = RECORD_PATH,
} = {}) {
  assertPf01VerificationEnvironment();
  assertPf01L3BuildEnvironment(undefined, repoRoot);
  const currentGit = await gitInfo({ repoRoot });
  if (currentGit.worktreeDirty !== false || !isCommit(currentGit.commit)) {
    throw new Error('automatic-pass record generation requires current clean HEAD');
  }
  const { run, artifactSha256, artifacts, artifactTexts, summary } = readPhysicalComparisonArtifacts(
    repoRoot,
    comparisonRun,
  );
  const comparison = {
    runId: comparisonRun,
    run,
    commit: summary?.runIdentity?.startCommit,
    worktreeDirty: summary?.runIdentity?.startWorktreeDirty,
    status: summary?.status === 'budget-comparison' ? 'pass' : summary?.status,
    exitCode: summary?.status === 'budget-comparison' ? 0 : 1,
  };
  if (comparison.commit !== currentGit.commit) {
    throw new Error('automatic-pass comparison commit must equal current clean HEAD');
  }
  try {
    assertComparisonGitProvenance({
      repoRoot,
      comparison,
      summary,
      l2DevModuleGraph: artifacts['l2-dev-module-graph.json'],
    });
  } catch (error) {
    throw new Error(
      `automatic-pass comparison Git-object provenance invalid: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
  const record = createFe01Pf01AutomaticPassRecord({
    comparison,
    artifactSha256,
    summary,
    budgetText: gitText(repoRoot, comparison.commit, BUDGET_PATH),
    descriptorText: gitText(repoRoot, comparison.commit, DESCRIPTOR_PATH),
    artifacts,
    artifactTexts,
  });
  const target = assertNewAutomaticPassTarget(repoRoot, recordPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, await formatAutomaticPassRecord(record, repoRoot), { encoding: 'utf8', flag: 'wx' });
  return { record, recordPath, recordSha256: sha256File(target) };
}

/**
 * Future automatic-pass history validator. It reads only the record's immutable run and
 * then recomputes current HEAD references; absent, old-version or drifted evidence never
 * becomes a no-sampling pass.
 */
export async function validateFe01Pf01AutomaticPass({
  repoRoot = REPO_ROOT,
  recordPath = RECORD_PATH,
} = {}) {
  const violations = [];
  const absoluteRecord = path.resolve(repoRoot, recordPath);
  let record;
  try {
    record = physicalJson(repoRoot, absoluteRecord);
  } catch {
    return invalid(violations, 'automatic-pass record missing or not physical');
  }
  let recordSha256;
  try {
    recordSha256 = sha256File(absoluteRecord);
  } catch {
    return invalid(violations, 'automatic-pass record SHA unavailable');
  }
  if (!validRecord(record)) return invalid(violations, 'automatic-pass record schema/digest invalid');

  const runDirectory = path.resolve(repoRoot, record.comparison.run);
  try {
    if (!hasPhysicalPath(repoRoot, runDirectory)) throw new Error('path');
    const runStats = fs.lstatSync(runDirectory);
    if (!runStats.isDirectory() || runStats.isSymbolicLink()) throw new Error('directory');
    if (!sameJson(fs.readdirSync(runDirectory).sort(), REQUIRED_ARTIFACTS)) throw new Error('set');
    for (const file of REQUIRED_ARTIFACTS) {
      const filePath = path.join(runDirectory, file);
      const stats = fs.lstatSync(filePath);
      if (!hasPhysicalPath(repoRoot, filePath) || !stats.isFile() || stats.isSymbolicLink()) {
        throw new Error('artifact physical');
      }
      if (sha256File(filePath) !== record.artifactSha256[file]) throw new Error('artifact SHA');
    }
  } catch {
    return invalid(violations, 'automatic-pass immutable comparison artifact set invalid');
  }

  let summary;
  let comparisonBudgetText;
  let comparisonDescriptor;
  try {
    summary = physicalJson(repoRoot, path.join(runDirectory, 'summary.json'));
    comparisonBudgetText = gitText(repoRoot, record.comparison.commit, BUDGET_PATH);
    comparisonDescriptor = gitText(repoRoot, record.comparison.commit, DESCRIPTOR_PATH);
  } catch {
    return invalid(violations, 'automatic-pass comparison Git object or summary unreadable');
  }
  const artifacts = {};
  const artifactTexts = {};
  try {
    for (const file of REQUIRED_ARTIFACTS) {
      const filePath = path.join(runDirectory, file);
      artifactTexts[file] = fs.readFileSync(filePath, 'utf8');
      artifacts[file] = JSON.parse(artifactTexts[file]);
    }
  } catch {
    return invalid(violations, 'automatic-pass immutable comparison artifact JSON unreadable');
  }
  try {
    assertComparisonGitProvenance({
      repoRoot,
      comparison: record.comparison,
      summary,
      l2DevModuleGraph: artifacts['l2-dev-module-graph.json'],
    });
  } catch {
    return invalid(violations, 'automatic-pass comparison Git-object provenance invalid');
  }
  if (!comparisonPayloadIsValid(record, summary, comparisonBudgetText, comparisonDescriptor, artifacts, artifactTexts)) {
    return invalid(violations, 'automatic-pass comparison summary/provenance/budget invalid');
  }
  let comparisonBudget;
  try {
    comparisonBudget = JSON.parse(comparisonBudgetText);
  } catch {
    return invalid(violations, 'automatic-pass immutable comparison budget unreadable');
  }

  let current;
  try {
    current = await collectFe01Pf01AutomaticPassCurrentHead({
      repoRoot,
      l2DevModuleGraph: record.current.measurementInputs.l2DevModuleGraph,
    });
  } catch {
    return invalid(violations, 'automatic-pass current HEAD inputs unavailable or dirty');
  }
  const binding = validateFe01Pf01AutomaticPassCurrentBinding({ record, current });
  if (!binding.valid) return binding;
  const automaticPassEvidence = {
    record: {
      path: recordPath.split(path.sep).join('/'),
      sha256: recordSha256,
    },
    comparison: record.comparison,
    budget: record.budget,
    descriptor: record.descriptor,
    baselineProvenance: comparisonBudget.baselineProvenance,
    currentProvenance: summary.comparisonProvenance.current,
  };
  const evidenceValidation = validateFe01Pf01AutomaticPassEvidence({
    binding: {
      recordPath: recordPath.split(path.sep).join('/'),
      recordSha256,
      comparison: record.comparison,
    },
    evidence: automaticPassEvidence,
  });
  if (!evidenceValidation.valid) {
    return invalid(violations, 'automatic-pass manifest provenance incomplete');
  }
  return {
    valid: true,
    recordPath: recordPath.split(path.sep).join('/'),
    recordSha256,
    comparison: record.comparison,
    automaticPassEvidence,
  };
}
