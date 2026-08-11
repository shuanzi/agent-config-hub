/** PF-01 版本化预算的 fail-closed schema 与阈值校验。 */
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import prettier from 'prettier';
import {
  ARTIFACTS_ROOT,
  REPO_ROOT,
  capture,
  digestDirectory,
  sha256File,
  sha256Text,
} from './lib.mjs';
import { HARNESS_BINARY } from './build-harness.mjs';
import { computePf01L3HarnessBuildInputsDigest, PF01_L3_BUILD_INPUTS } from './pf01-build-inputs.mjs';
import { validatePf01MeasurementInputs } from './pf01-measurement-inputs.mjs';

export const PF01_TIMING_METRICS = [
  'pf01.startup.first_list_visible',
  'pf01.search.results_visible',
  'pf01.filter.results_visible',
  'pf01.select.skill_cells_visible',
  'pf01.l3.cold_start.first_snapshot',
];

const PF01_EXACT_SAMPLE_COUNTS = {
  'pf01.startup.first_list_visible': 5,
  'pf01.search.results_visible': 20,
  'pf01.filter.results_visible': 20,
  'pf01.select.skill_cells_visible': 20,
  'pf01.l3.cold_start.first_snapshot': 3,
};

const L2_LAYER = 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）';
const L3_LAYER = 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）';
const ABSOLUTE_FORMULA = 'ceil(p95 * 1.5 / 10) * 10';
const REGRESSION_FORMULA = 'current p50 <= baseline p50 * 1.25';
const RESOURCE_SAMPLING =
  'agent-config-manager harness PID + 后代；50ms process-tree RSS bytes；排除 WDIO/Vite；成功启动至正常退出';
const HARNESS_IDENTITY_RELATIVE_PATH = '.artifacts/test-harness/identity.json';
const FX01_FIXTURE_RELATIVE_PATH = 'fixtures/fx-01/native-root';
const BUDGET_SCHEMA_VERSION = 4;
const BUILD_INPUT_SCHEMA_VERSION = PF01_L3_BUILD_INPUTS.schemaVersion;
const BUILD_INPUT_ALGORITHM = PF01_L3_BUILD_INPUTS.algorithm;
const BUILD_INPUT_METHOD = 'raw bytes SHA-256 / byte-sorted repo-relative paths';

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function sameSet(left, right) {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((value) => right.includes(value))
  );
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function matchesArtifactSchema(artifact) {
  return (
    artifact !== null &&
    typeof artifact === 'object' &&
    artifact.identityPath === HARNESS_IDENTITY_RELATIVE_PATH &&
    isSha256(artifact.declaredBinarySha256) &&
    isSha256(artifact.actualBinarySha256) &&
    artifact.kind === 'test-harness' &&
    typeof artifact.identifier === 'string' &&
    artifact.identifier.length > 0 &&
    artifact.profile === 'debug' &&
    artifact.binary === HARNESS_BINARY &&
    typeof artifact.provenance === 'string' &&
    artifact.provenance.length > 0
  );
}

function artifactHashesMatch(artifact) {
  return artifact?.declaredBinarySha256 === artifact?.actualBinarySha256;
}

function sameArtifactIdentity(baseline, current) {
  return [
    'identityPath',
    'kind',
    'identifier',
    'profile',
    'binary',
    'provenance',
  ].every((field) => baseline?.[field] === current?.[field]);
}

const RUNNER_FIELDS = ['node', 'npm', 'platform', 'release', 'macosProductVersion', 'arch'];
const TOOLCHAIN_FIELDS = ['cargo', 'rustc'];

function matchesRuntimeProvenance(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.runner !== null &&
    typeof value.runner === 'object' &&
    RUNNER_FIELDS.every((field) => typeof value.runner[field] === 'string' && value.runner[field].length > 0) &&
    value.toolchain !== null &&
    typeof value.toolchain === 'object' &&
    TOOLCHAIN_FIELDS.every(
      (field) => typeof value.toolchain[field] === 'string' && value.toolchain[field].length > 0,
    )
  );
}

function sameRuntimeProvenance(baseline, current) {
  return (
    RUNNER_FIELDS.every((field) => baseline?.runner?.[field] === current?.runner?.[field]) &&
    TOOLCHAIN_FIELDS.every((field) => baseline?.toolchain?.[field] === current?.toolchain?.[field])
  );
}

function matchesBuildInputEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  const collisions = new Set();
  let prior = null;
  for (const entry of entries) {
    const pathname = entry?.path;
    if (
      typeof pathname !== 'string' ||
      pathname.length === 0 ||
      pathname.includes('\0') ||
      pathname.includes('\\') ||
      pathname.startsWith('/') ||
      pathname.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !isSha256(entry?.sha256)
    ) {
      return false;
    }
    if (prior !== null && Buffer.compare(Buffer.from(prior), Buffer.from(pathname)) >= 0) return false;
    prior = pathname;
    const collisionKey = pathname.normalize('NFC').toLocaleLowerCase('en-US');
    if (collisions.has(collisionKey)) return false;
    collisions.add(collisionKey);
  }
  return true;
}

function matchesBuildInputsSchema(buildInputs, sourceKind) {
  return (
    buildInputs !== null &&
    typeof buildInputs === 'object' &&
    buildInputs.schemaVersion === BUILD_INPUT_SCHEMA_VERSION &&
    buildInputs.algorithm === BUILD_INPUT_ALGORITHM &&
    isSha256(buildInputs.digest) &&
    buildInputs.source !== null &&
    typeof buildInputs.source === 'object' &&
    buildInputs.source.kind === sourceKind &&
    buildInputs.source.method === BUILD_INPUT_METHOD &&
    isCommit(buildInputs.source.commit) &&
    matchesBuildInputEntries(buildInputs.entries) &&
    buildInputs.digest ===
      computePf01L3HarnessBuildInputsDigest({
        schemaVersion: buildInputs.schemaVersion,
        algorithm: buildInputs.algorithm,
        entries: buildInputs.entries,
      })
  );
}

function sameBuildInputs(baseline, current) {
  return (
    baseline?.schemaVersion === current?.schemaVersion &&
    baseline?.algorithm === current?.algorithm &&
    baseline?.digest === current?.digest
  );
}

function sameMeasurementInputs(baseline, current) {
  return (
    baseline?.schemaVersion === current?.schemaVersion &&
    baseline?.algorithm === current?.algorithm &&
    baseline?.digest === current?.digest &&
    JSON.stringify(baseline?.entries) === JSON.stringify(current?.entries)
  );
}

/** Sampling, freezing and verification use the same runtime reference shape. */
export async function capturePf01RuntimeProvenance() {
  const [npm, cargo, rustc, macosProductVersion] = await Promise.all([
    capture('corepack', ['npm', '--version']),
    capture('cargo', ['--version']),
    capture('rustc', ['--version']),
    capture('sw_vers', ['-productVersion']),
  ]);
  if (
    npm.exitCode !== 0 ||
    cargo.exitCode !== 0 ||
    rustc.exitCode !== 0 ||
    macosProductVersion.exitCode !== 0
  ) {
    throw new Error('runner/toolchain provenance unavailable');
  }
  return {
    runner: {
      node: process.version,
      npm: npm.stdout.trim(),
      platform: os.platform(),
      release: os.release(),
      macosProductVersion: macosProductVersion.stdout.trim(),
      arch: os.arch(),
    },
    toolchain: { cargo: cargo.stdout.trim(), rustc: rustc.stdout.trim() },
  };
}

/**
 * 读取当前真实 L3 harness 与 FX-01 fixture，并以此生成 comparison/freeze attestation。
 * identity.json 只提供声明元数据；binarySha256 必须由当前 HARNESS_BINARY 重算。
 */
export function collectCurrentPf01Attestation({
  repoRoot = REPO_ROOT,
  artifactsRoot = ARTIFACTS_ROOT,
  buildInputs,
  measurementInputs,
  runtimeProvenance,
} = {}) {
  const identityPath = path.join(artifactsRoot, 'test-harness/identity.json');
  if (!fs.existsSync(identityPath)) throw new Error('current harness artifact identity missing');
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const binaryPath = path.join(repoRoot, HARNESS_BINARY);
  if (!fs.existsSync(binaryPath)) throw new Error('current harness binary missing');
  const fixtureRoot = path.join(repoRoot, FX01_FIXTURE_RELATIVE_PATH);
  if (!fs.existsSync(fixtureRoot)) throw new Error('current FX-01 fixture missing');

  return {
    artifact: {
      identityPath: path.relative(repoRoot, identityPath),
      kind: identity.kind,
      identifier: identity.identifier,
      profile: identity.profile,
      binary: identity.binary,
      declaredBinarySha256: identity.binarySha256,
      actualBinarySha256: sha256File(binaryPath),
      provenance: identity.provenance,
    },
    fixture: {
      path: FX01_FIXTURE_RELATIVE_PATH,
      sha256: sha256Text(JSON.stringify(digestDirectory(fixtureRoot))),
    },
    ...(buildInputs === undefined ? {} : { buildInputs }),
    ...(measurementInputs === undefined ? {} : { measurementInputs }),
    ...(runtimeProvenance === undefined ? {} : runtimeProvenance),
  };
}

/** 当前 identity、binary、fixture 的任何不确定或不一致都不允许用于冻结或 clean evidence。 */
export function validateCurrentPf01Attestation(attestation) {
  const violations = [];
  const artifact = attestation?.artifact;
  if (!matchesArtifactSchema(artifact)) {
    violations.push('current harness artifact identity 不完整或不符合 PF-01 contract');
  } else if (!artifactHashesMatch(artifact)) {
    violations.push('current harness identity declaredBinarySha256 与实际 binary 不匹配');
  }
  if (
    attestation?.fixture?.path !== FX01_FIXTURE_RELATIVE_PATH ||
    !isSha256(attestation?.fixture?.sha256)
  ) {
    violations.push('current FX-01 fixture attestation 不完整');
  }
  if (!matchesBuildInputsSchema(attestation?.buildInputs, 'clean-tracked-checkout')) {
    violations.push('current L3 harness build-input attestation 不完整');
  }
  if (!validatePf01MeasurementInputs(attestation?.measurementInputs, 'clean-tracked-checkout')) {
    violations.push('current measurement-input attestation 不完整');
  }
  if (!matchesRuntimeProvenance(attestation)) {
    violations.push('current runner/toolchain provenance 不完整');
  }
  return { valid: violations.length === 0, violations };
}

/** authoritative sampling 与版本化 budget 写入共同使用的 clean-commit gate。 */
export function assertCleanPf01Baseline(git) {
  if (git?.worktreeDirty !== false) {
    throw new Error('PF-01 authoritative baseline requires clean worktree');
  }
}

/**
 * 预算缺字段、descriptor/profile 漂移、阈值公式偏离或 provenance 不完整一律无效。
 * 此函数不把无效预算降级成可通过状态；调用方据此返回 fail/inconclusive。
 */
export function validateFrozenPf01Budget(budget, descriptor, expectedProfile, currentAttestation) {
  const violations = [];
  const descriptorDigest = descriptor?.digest?.value;
  if (budget?.schemaVersion !== BUDGET_SCHEMA_VERSION) {
    violations.push(`schemaVersion 必须为 ${BUDGET_SCHEMA_VERSION}`);
  }
  if (budget?.descriptorId !== 'PF-01' || descriptor?.descriptorId !== 'PF-01') {
    violations.push('descriptorId 必须为 PF-01');
  }
  if (budget?.descriptorDigest !== descriptorDigest) violations.push('descriptorDigest 不匹配');
  if (budget?.profile !== expectedProfile) violations.push('profile 不匹配');
  if (
    budget?.formula?.absoluteCeilingMs !== ABSOLUTE_FORMULA ||
    budget?.formula?.regressionAllowance !== REGRESSION_FORMULA
  ) {
    violations.push('预算公式不匹配');
  }

  const provenance = budget?.baselineProvenance;
  if (
    provenance === null ||
    typeof provenance !== 'object' ||
    typeof provenance.run !== 'string' ||
    !provenance.run.startsWith('.artifacts/performance/PF-01/') ||
    !isIsoTimestamp(provenance.collectedAt) ||
    provenance.statusBeforeBudgetFreeze !== 'baseline-collected / budget-not-frozen' ||
    !isCommit(provenance.commit) ||
    provenance.worktreeDirty !== false
  ) {
    violations.push('baselineProvenance 基础字段不完整');
  }
  if (!matchesArtifactSchema(provenance?.artifact)) {
    violations.push('baselineProvenance.artifact 不完整');
  } else if (!artifactHashesMatch(provenance.artifact)) {
    violations.push('baselineProvenance.artifact declaredBinarySha256 与实际 binary 不匹配');
  }
  if (
    !matchesRuntimeProvenance(provenance) ||
    provenance?.fixture === undefined ||
    provenance.fixture.path !== 'fixtures/fx-01/native-root' ||
    !isSha256(provenance.fixture.sha256)
  ) {
    violations.push('baselineProvenance runner/toolchain/fixture 不完整');
  }
  if (!matchesBuildInputsSchema(provenance?.buildInputs, 'git-object-tree')) {
    violations.push('baselineProvenance.buildInputs 不完整');
  } else if (provenance.buildInputs.source.commit !== provenance.commit) {
    violations.push('baselineProvenance.buildInputs commit 与 baseline commit 不匹配');
  }
  if (!validatePf01MeasurementInputs(provenance?.measurementInputs, 'git-object-tree')) {
    violations.push('baselineProvenance.measurementInputs 不完整');
  } else if (provenance.measurementInputs.source.commit !== provenance.commit) {
    violations.push('baselineProvenance.measurementInputs commit 与 baseline commit 不匹配');
  }
  const resources = provenance?.resources;
  if (
    resources?.metric !== 'pf01.l3.peak_rss_bytes' ||
    resources?.layer !== L3_LAYER ||
    resources?.sampling !== RESOURCE_SAMPLING ||
    !Array.isArray(resources?.rawPeaksBytes) ||
    resources.rawPeaksBytes.length !== 3 ||
    !resources.rawPeaksBytes.every(positiveNumber) ||
    !positiveNumber(resources?.maxBytes) ||
    resources.maxBytes !== Math.max(...(resources?.rawPeaksBytes ?? []))
  ) {
    violations.push('baselineProvenance.resources 不完整或不符合 L3 RSS 口径');
  }

  const attestation = validateCurrentPf01Attestation(currentAttestation);
  if (!attestation.valid) {
    violations.push(...attestation.violations);
  } else {
    if (!sameArtifactIdentity(provenance?.artifact, currentAttestation.artifact)) {
      violations.push('baselineProvenance.artifact 与当前 harness identity 不匹配');
    }
    if (!sameBuildInputs(provenance?.buildInputs, currentAttestation.buildInputs)) {
      violations.push('baselineProvenance.buildInputs 与当前 L3 harness build-input 不匹配');
    }
    if (!sameMeasurementInputs(provenance?.measurementInputs, currentAttestation.measurementInputs)) {
      violations.push('baselineProvenance.measurementInputs 与当前测量方法不匹配');
    }
    if (!sameRuntimeProvenance(provenance, currentAttestation)) {
      violations.push('baselineProvenance runner/toolchain 与当前执行环境不匹配');
    }
    if (
      provenance?.fixture?.path !== currentAttestation.fixture.path ||
      provenance?.fixture?.sha256 !== currentAttestation.fixture.sha256
    ) {
      violations.push('baselineProvenance.fixture 与当前 FX-01 fixture 不匹配');
    }
  }

  const entries = Array.isArray(budget?.budgets) ? budget.budgets : [];
  const metrics = entries.map((entry) => entry?.metric);
  if (!sameSet(metrics, PF01_TIMING_METRICS)) {
    violations.push('预算 metric 集合必须精确匹配 PF-01 timing metrics');
  }
  for (const entry of entries) {
    const expectedLayer = entry?.metric === 'pf01.l3.cold_start.first_snapshot' ? L3_LAYER : L2_LAYER;
    if (entry?.layer !== expectedLayer) violations.push(`${entry?.metric ?? 'unknown'}: layer 不匹配`);
    const baseline = entry?.baseline;
    if (
      !positiveNumber(baseline?.p50) ||
      !positiveNumber(baseline?.p95) ||
      !Number.isInteger(baseline?.n) ||
      baseline.n !== PF01_EXACT_SAMPLE_COUNTS[entry?.metric]
    ) {
      violations.push(`${entry?.metric ?? 'unknown'}: baseline 不完整`);
    }
    const expectedCeiling =
      positiveNumber(baseline?.p95) ? Math.ceil((baseline.p95 * 1.5) / 10) * 10 : null;
    if (entry?.absoluteCeilingMs !== expectedCeiling) {
      violations.push(`${entry?.metric ?? 'unknown'}: absoluteCeilingMs 不符合公式`);
    }
    if (
      entry?.regressionAllowance?.relativeTo !== 'baseline-p50' ||
      entry?.regressionAllowance?.maxRatio !== 1.25
    ) {
      violations.push(`${entry?.metric ?? 'unknown'}: regressionAllowance 不符合公式`);
    }
  }
  return { valid: violations.length === 0, violations };
}

/** comparison/manifest 两条 provenance 一律带完整 artifact、fixture 与 input digest。 */
export function pf01ComparisonProvenance(budget, currentAttestation) {
  const baseline = budget?.baselineProvenance;
  return {
    baseline:
      baseline === undefined || baseline === null
        ? null
        : {
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
    current: {
      artifact: currentAttestation?.artifact,
      fixture: currentAttestation?.fixture,
      buildInputs: currentAttestation?.buildInputs,
      measurementInputs: currentAttestation?.measurementInputs,
      runner: currentAttestation?.runner,
      toolchain: currentAttestation?.toolchain,
    },
  };
}

/** 按已授权公式把完整实际 summary 冻结为 versioned budget payload。 */
export function freezePf01Budget({ descriptor, profile, metrics, baselineProvenance }) {
  const metricEntries = PF01_TIMING_METRICS.map((metric) => {
    const stats = metrics?.[metric];
    if (
      !positiveNumber(stats?.p50) ||
      !positiveNumber(stats?.p95) ||
      !Number.isInteger(stats?.n) ||
      stats.n !== PF01_EXACT_SAMPLE_COUNTS[metric]
    ) {
      throw new Error(`PF-01 baseline metric incomplete: ${metric}`);
    }
    return {
      metric,
      layer: metric === 'pf01.l3.cold_start.first_snapshot' ? L3_LAYER : L2_LAYER,
      baseline: { p50: stats.p50, p95: stats.p95, n: stats.n },
      absoluteCeilingMs: Math.ceil((stats.p95 * 1.5) / 10) * 10,
      regressionAllowance: { relativeTo: 'baseline-p50', maxRatio: 1.25 },
    };
  });
  return {
    schemaVersion: BUDGET_SCHEMA_VERSION,
    descriptorId: 'PF-01',
    descriptorDigest: descriptor?.digest?.value,
    profile,
    baselineProvenance,
    formula: {
      absoluteCeilingMs: ABSOLUTE_FORMULA,
      regressionAllowance: REGRESSION_FORMULA,
    },
    budgets: metricEntries,
  };
}

/** 预算生成器的唯一 JSON wire 格式；直接使用仓库 Prettier 配置。 */
export async function formatPf01BudgetJson(budget) {
  const filePath = path.join(REPO_ROOT, 'performance/budgets/pf-01.budgets.json');
  const config = await prettier.resolveConfig(filePath);
  return prettier.format(JSON.stringify(budget), { ...config, filepath: filePath, parser: 'json' });
}

/**
 * 将历史 v2/v3 budget 仅在调用方同时给出可复算 Git-object build/measurement
 * provenance 时转换为当前 schema；仅读取历史，不修改 immutable sampling artifact。
 */
export function migratePf01BudgetV2({ budget, baselineBuildInputs, baselineMeasurementInputs }) {
  if (![2, 3, BUDGET_SCHEMA_VERSION].includes(budget?.schemaVersion)) {
    throw new Error('PF-01 budget migration requires schemaVersion 2, 3, or 4');
  }
  if (budget?.descriptorId !== 'PF-01' || !isSha256(budget?.descriptorDigest)) {
    throw new Error('PF-01 budget migration requires PF-01 descriptor identity');
  }
  const legacyArtifact = budget?.baselineProvenance?.artifact;
  const declaredBinarySha256 =
    budget.schemaVersion === 2 ? legacyArtifact?.binarySha256 : legacyArtifact?.declaredBinarySha256;
  const actualBinarySha256 =
    budget.schemaVersion === 2 ? legacyArtifact?.binarySha256 : legacyArtifact?.actualBinarySha256;
  if (
    !matchesArtifactSchema({
      ...legacyArtifact,
      declaredBinarySha256,
      actualBinarySha256,
    }) ||
    declaredBinarySha256 !== actualBinarySha256
  ) {
    throw new Error('PF-01 v2 baseline artifact invalid');
  }
  if (
    !matchesBuildInputsSchema(baselineBuildInputs, 'git-object-tree') ||
    baselineBuildInputs.source.commit !== budget.baselineProvenance.commit
  ) {
    throw new Error('PF-01 baseline build-input digest invalid');
  }
  if (
    !validatePf01MeasurementInputs(baselineMeasurementInputs, 'git-object-tree') ||
    baselineMeasurementInputs.source.commit !== budget.baselineProvenance.commit
  ) {
    throw new Error('PF-01 baseline measurement-input digest invalid');
  }
  const metrics = Object.fromEntries(
    (budget.budgets ?? []).map((entry) => [entry?.metric, entry?.baseline]),
  );
  return freezePf01Budget({
    descriptor: { descriptorId: budget.descriptorId, digest: { value: budget.descriptorDigest } },
    profile: budget.profile,
    metrics,
    baselineProvenance: {
      ...budget.baselineProvenance,
      artifact: {
        identityPath: legacyArtifact.identityPath,
        kind: legacyArtifact.kind,
        identifier: legacyArtifact.identifier,
        profile: legacyArtifact.profile,
        binary: legacyArtifact.binary,
        declaredBinarySha256,
        actualBinarySha256,
        provenance: legacyArtifact.provenance,
      },
      buildInputs: baselineBuildInputs,
      measurementInputs: baselineMeasurementInputs,
    },
  });
}

export const PF01_BUDGET_CONSTANTS = {
  L2_LAYER,
  L3_LAYER,
  ABSOLUTE_FORMULA,
  REGRESSION_FORMULA,
  RESOURCE_SAMPLING,
  EXACT_SAMPLE_COUNTS: PF01_EXACT_SAMPLE_COUNTS,
};
