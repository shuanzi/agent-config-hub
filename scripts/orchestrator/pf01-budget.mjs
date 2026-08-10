/** PF-01 版本化预算的 fail-closed schema 与阈值校验。 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACTS_ROOT,
  REPO_ROOT,
  digestDirectory,
  sha256File,
  sha256Text,
} from './lib.mjs';
import { HARNESS_BINARY } from './build-harness.mjs';

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
    isSha256(artifact.binarySha256) &&
    artifact.kind === 'test-harness' &&
    typeof artifact.identifier === 'string' &&
    artifact.identifier.length > 0 &&
    artifact.profile === 'debug' &&
    artifact.binary === HARNESS_BINARY &&
    typeof artifact.provenance === 'string' &&
    artifact.provenance.length > 0
  );
}

function sameArtifactIdentity(baseline, current) {
  return [
    'identityPath',
    'kind',
    'identifier',
    'profile',
    'binary',
    'binarySha256',
    'provenance',
  ].every((field) => baseline?.[field] === current?.[field]);
}

/**
 * 读取当前真实 L3 harness 与 FX-01 fixture，并以此生成 comparison/freeze attestation。
 * identity.json 只提供声明元数据；binarySha256 必须由当前 HARNESS_BINARY 重算。
 */
export function collectCurrentPf01Attestation({ repoRoot = REPO_ROOT, artifactsRoot = ARTIFACTS_ROOT } = {}) {
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
      binarySha256: identity.binarySha256,
      provenance: identity.provenance,
      actualBinarySha256: sha256File(binaryPath),
    },
    fixture: {
      path: FX01_FIXTURE_RELATIVE_PATH,
      sha256: sha256Text(JSON.stringify(digestDirectory(fixtureRoot))),
    },
  };
}

/** 当前 identity、binary、fixture 的任何不确定或不一致都不允许用于冻结或 clean evidence。 */
export function validateCurrentPf01Attestation(attestation) {
  const violations = [];
  const artifact = attestation?.artifact;
  if (!matchesArtifactSchema(artifact)) {
    violations.push('current harness artifact identity 不完整或不符合 PF-01 contract');
  } else if (artifact.binarySha256 !== artifact.actualBinarySha256) {
    violations.push('current harness identity binarySha256 与实际 binary 不匹配');
  }
  if (
    attestation?.fixture?.path !== FX01_FIXTURE_RELATIVE_PATH ||
    !isSha256(attestation?.fixture?.sha256)
  ) {
    violations.push('current FX-01 fixture attestation 不完整');
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
  if (budget?.schemaVersion !== 2) violations.push('schemaVersion 必须为 2');
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
  }
  if (
    provenance?.runner === undefined ||
    typeof provenance.runner.node !== 'string' ||
    typeof provenance.runner.npm !== 'string' ||
    typeof provenance.runner.platform !== 'string' ||
    typeof provenance.runner.release !== 'string' ||
    typeof provenance.runner.macosProductVersion !== 'string' ||
    typeof provenance.runner.arch !== 'string' ||
    provenance?.toolchain === undefined ||
    typeof provenance.toolchain.cargo !== 'string' ||
    typeof provenance.toolchain.rustc !== 'string' ||
    provenance?.fixture === undefined ||
    provenance.fixture.path !== 'fixtures/fx-01/native-root' ||
    !isSha256(provenance.fixture.sha256)
  ) {
    violations.push('baselineProvenance runner/toolchain/fixture 不完整');
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
    schemaVersion: 2,
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

export const PF01_BUDGET_CONSTANTS = {
  L2_LAYER,
  L3_LAYER,
  ABSOLUTE_FORMULA,
  REGRESSION_FORMULA,
  RESOURCE_SAMPLING,
  EXACT_SAMPLE_COUNTS: PF01_EXACT_SAMPLE_COUNTS,
};
