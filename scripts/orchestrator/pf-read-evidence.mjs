/**
 * PF-02/PF-03 只读性能证据的纯判定层。
 *
 * 本模块不读取工作树、不执行采样，也绝不写入 versioned budget。read runner
 * 仅将已采集的 descriptor、fixture、样本及运行身份传入，再由本模块给出
 * summary、建议预算和进程退出码。首次完整 clean baseline 一律 exit 2：
 * 它只能提出预算，不能把建议当作已冻结预算或 ticket closure credit。
 */

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const READ_DESCRIPTOR_IDS = new Set(['PF-02', 'PF-03']);
const READ_PROFILES = new Set(['representative', 'stress']);
const FORMULA = Object.freeze({
  absoluteCeilingMs: 'ceil(p95 * 1.5 / 10) * 10',
  regressionAllowance: 'current p50 <= baseline p50 * 1.25',
});
const CLEAN_BASELINE_LABEL =
  'budget-not-frozen（本次 baseline 只收集样本，未生成版本化预算）';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDigest(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/** Canonical path ordering is UTF-8 byte order, never host locale collation. */
export function comparePfReadPaths(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalCaseKey(value) {
  return value.normalize('NFC').toLowerCase();
}

function safeRelative(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.normalize('NFC') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.toLowerCase().includes('file:')
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** Measurement contract uses only sorted unique repo-relative path/SHA bindings. */
export function pfReadMeasurementInputDigest(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('measurement inputs entries 不能为空');
  }
  const normalized = entries.map((entry) => {
    if (!hasExactKeys(entry, ['path', 'sha256']) || !safeRelative(entry?.path) || !isDigest(entry?.sha256)) {
      throw new Error('measurement input 必须为 repo-relative path 和 sha256');
    }
    return { path: entry.path, sha256: entry.sha256.toLowerCase() };
  });
  normalized.sort((left, right) => comparePfReadPaths(left.path, right.path));
  const caseKeys = new Set();
  for (const entry of normalized) {
    const caseKey = canonicalCaseKey(entry.path);
    if (caseKeys.has(caseKey)) throw new Error('measurement input path 不得重复或发生 casefold collision');
    caseKeys.add(caseKey);
  }
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

function hasCanonicalMeasurementEntryOrder(entries) {
  if (!Array.isArray(entries)) return false;
  return entries.every(
    (entry, index) =>
      index === 0 ||
      typeof entry?.path === 'string' &&
        typeof entries[index - 1]?.path === 'string' &&
        comparePfReadPaths(entries[index - 1].path, entry.path) < 0,
  );
}

function percentile(sorted, percentileValue) {
  const rank = (percentileValue / 100) * (sorted.length - 1);
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

function absoluteCeilingMs(p95) {
  return Math.ceil((p95 * 1.5) / 10) * 10;
}

function regressionP50CeilingMs(p50) {
  return p50 * 1.25;
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function versionedBudgetPath(descriptorId, profile) {
  return `performance/budgets/${descriptorId.toLowerCase()}.${profile}.budgets.json`;
}

function safeMetricIds(descriptor) {
  return Array.isArray(descriptor?.metrics)
    ? descriptor.metrics
        .map((metric) => metric?.id)
        .filter((metricId) => typeof metricId === 'string' && metricId.length > 0)
    : [];
}

function proposedReadBudgets({ descriptorId, profile, metrics, budgetIsAbsent }) {
  return {
    schemaVersion: 1,
    descriptorId,
    profile,
    status: budgetIsAbsent ? 'proposed-not-frozen' : 'proposal-not-applicable',
    note: budgetIsAbsent
      ? '以下仅为首次完整 clean baseline 的建议预算；未写入版本化预算，须再次取得人工冻结确认。'
      : '已提供版本化 budget；本次仅比较，不生成或修改预算。',
    budgets: Object.entries(metrics).map(([metricId, stats]) => ({
      metric: metricId,
      layer: stats.layer,
      baseline: { p50: stats.p50, p95: stats.p95, n: stats.n },
      proposedAbsoluteCeilingMs: absoluteCeilingMs(stats.p95),
      proposedRegressionP50CeilingMs: regressionP50CeilingMs(stats.p50),
      proposedRegressionAllowance: { relativeTo: 'baseline-p50', maxRatio: 1.25 },
      status: budgetIsAbsent ? 'proposed-not-frozen' : 'not-written',
    })),
  };
}

function evidenceValidation(input) {
  const violations = [];
  const descriptor = input?.descriptor;
  const descriptorId = descriptor?.descriptorId;
  const profile = input?.profile;
  const metrics = Array.isArray(descriptor?.metrics) ? descriptor.metrics : [];
  const metricIds = safeMetricIds(descriptor);

  if (!READ_DESCRIPTOR_IDS.has(descriptorId)) violations.push('仅 PF-02/PF-03 可使用 read PF evidence seam');
  if (!READ_PROFILES.has(profile)) violations.push('profile 必须为 representative 或 stress');
  if (!isPlainObject(descriptor?.profiles?.[profile])) violations.push('descriptor profile 不存在');
  if (!Array.isArray(descriptor?.metrics) || metricIds.length !== 3 || new Set(metricIds).size !== 3) {
    violations.push('descriptor 必须精确声明三个唯一 read metrics');
  }
  if (descriptor?.digest?.value !== input?.descriptorDigest || !isDigest(input?.descriptorDigest)) {
    violations.push('descriptor digest 未绑定当前 descriptor');
  }
  if (
    !isDigest(descriptor?.fixture?.profileDigests?.[profile]) ||
    descriptor?.fixture?.profileDigests?.[profile] !== input?.fixtureDigest
  ) {
    violations.push('fixture digest 未绑定当前 descriptor/profile');
  }
  if (!isDigest(input?.fixtureDigest)) violations.push('fixture digest 缺失');

  const samplesPayload = input?.samplesPayload;
  if (
    !isPlainObject(samplesPayload) ||
    samplesPayload.schemaVersion !== 1 ||
    samplesPayload.descriptorId !== descriptorId ||
    samplesPayload.profile !== profile ||
    samplesPayload.unit !== 'ms' ||
    !isPlainObject(samplesPayload.metrics) ||
    !hasExactKeys(samplesPayload, ['schemaVersion', 'descriptorId', 'profile', 'unit', 'metrics'])
  ) {
    violations.push('samples payload 未绑定 descriptor/profile 或单位');
  }

  const collectedMetrics = {};
  for (const metric of metrics) {
    const metricId = metric?.id;
    const samples = samplesPayload?.metrics?.[metricId]?.samples;
    const minSamples = metric?.minSamplesByProfile?.[profile];
    if (!Number.isInteger(minSamples) || minSamples <= 0) {
      violations.push(`metric ${metricId ?? 'unknown'} 缺少最小样本数`);
      continue;
    }
    if (!hasExactKeys(samplesPayload?.metrics?.[metricId], ['samples']) || !Array.isArray(samples) || samples.length !== minSamples) {
      violations.push(`metric ${metricId ?? 'unknown'} 样本数必须精确匹配 profile contract`);
      continue;
    }
    if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
      violations.push(`metric ${metricId ?? 'unknown'} 含无效毫秒样本`);
      continue;
    }
    collectedMetrics[metricId] = {
      ...summarize(samples),
      complete: true,
      minSamples,
      layer: metric.layer,
    };
  }
  if (
    isPlainObject(samplesPayload?.metrics) &&
    Object.keys(samplesPayload.metrics).some((metricId) => !metricIds.includes(metricId))
  ) {
    violations.push('samples payload 含未声明 metric');
  }

  const start = input?.runIdentity?.start;
  const end = input?.runIdentity?.end;
  if (
    !hasNonEmptyString(start?.commit) ||
    !hasNonEmptyString(end?.commit) ||
    start?.commit !== end?.commit ||
    start?.worktreeDirty !== false ||
    end?.worktreeDirty !== false
  ) {
    violations.push('run identity 必须为同一 clean commit');
  }

  const runner = input?.runtime?.runner;
  const toolchain = input?.runtime?.toolchain;
  if (
    !hasNonEmptyString(runner?.node) ||
    !hasNonEmptyString(runner?.npm) ||
    !hasNonEmptyString(runner?.platform) ||
    !hasNonEmptyString(runner?.release) ||
    !hasNonEmptyString(runner?.macosProductVersion) ||
    !hasNonEmptyString(runner?.arch) ||
    !hasNonEmptyString(toolchain?.rustc) ||
    !hasNonEmptyString(toolchain?.cargo)
  ) {
    violations.push('runner/toolchain attestation 不完整');
  }

  const measurementInputs = input?.measurementInputs;
  let measurementDigestValid = false;
  try {
    measurementDigestValid =
      isPlainObject(measurementInputs) &&
      measurementInputs.schemaVersion === 1 &&
      measurementInputs.algorithm === 'pf-read-measurement-contract-v1' &&
      isDigest(measurementInputs.digest) &&
      hasExactKeys(measurementInputs, ['schemaVersion', 'algorithm', 'digest', 'entries']) &&
      measurementInputs.entries.every((entry) => hasExactKeys(entry, ['path', 'sha256'])) &&
      hasCanonicalMeasurementEntryOrder(measurementInputs.entries) &&
      measurementInputs.digest === pfReadMeasurementInputDigest(measurementInputs.entries);
  } catch {
    measurementDigestValid = false;
  }
  if (!measurementDigestValid) {
    violations.push('measurement inputs attestation 无效');
  }

  return { valid: violations.length === 0, violations, metrics: collectedMetrics };
}

function invalidResult(input, validation) {
  const descriptorId = READ_DESCRIPTOR_IDS.has(input?.descriptor?.descriptorId)
    ? input.descriptor.descriptorId
    : 'unknown';
  const profile = READ_PROFILES.has(input?.profile) ? input.profile : 'unknown';
  return {
    summary: {
      schemaVersion: 1,
      descriptorId,
      profile,
      status: 'inconclusive',
      budgetState: 'budget-not-evaluated（evidence 无效，未生成版本化预算）',
      metrics: validation.metrics,
      validation: { valid: false, violations: validation.violations },
      budgetValidation: { status: 'not-created' },
    },
    proposedBudgets: {
      schemaVersion: 1,
      descriptorId,
      profile,
      status: 'proposed-invalid',
      budgets: [],
    },
    exitCode: 2,
  };
}

function validateBaselineEvidence({
  baselineEvidence,
  descriptor,
  descriptorDigest,
  profile,
  fixtureDigest,
  measurementInputs,
  runtime,
  baselineProvenance,
}) {
  const violations = [];
  const samplesPayload = baselineEvidence?.samplesPayload;
  const summary = baselineEvidence?.summary;
  const proposedBudgets = baselineEvidence?.proposedBudgets;
  const summaryIdentity = summary?.runIdentity;
  const baselineValidation = evidenceValidation({
    descriptor,
    descriptorDigest,
    profile,
    fixtureDigest,
    samplesPayload,
    runIdentity: {
      start: {
        commit: summaryIdentity?.startCommit,
        worktreeDirty: summaryIdentity?.startWorktreeDirty,
      },
      end: {
        commit: summaryIdentity?.endCommit,
        worktreeDirty: summaryIdentity?.endWorktreeDirty,
      },
    },
    runtime: { runner: summary?.runner, toolchain: summary?.toolchain },
    measurementInputs,
  });
  if (!baselineValidation.valid) {
    violations.push('baseline samples/summary 未能重算为完整 clean evidence');
    return { valid: false, violations, metrics: {} };
  }
  const expectedIdentity = {
    startCommit: baselineProvenance?.commit,
    startWorktreeDirty: false,
    endCommit: baselineProvenance?.commit,
    endWorktreeDirty: false,
    consistent: true,
  };
  if (
    !hasExactKeys(summaryIdentity, Object.keys(expectedIdentity)) ||
    !sameJson(summaryIdentity, expectedIdentity) ||
    summary?.schemaVersion !== 1 ||
    summary?.descriptorId !== descriptor?.descriptorId ||
    summary?.descriptorDigest !== descriptorDigest ||
    summary?.profile !== profile ||
    summary?.fixtureDigest !== fixtureDigest ||
    summary?.measurementInputDigest !== measurementInputs?.digest ||
    !sameJson(summary?.metrics, baselineValidation.metrics) ||
    summary?.status !== 'baseline-collected / budget-not-frozen' ||
    summary?.budgetState !== CLEAN_BASELINE_LABEL ||
    !sameJson(summary?.validation, { valid: true, violations: [] }) ||
    !sameJson(summary?.budgetValidation, { status: 'not-created' }) ||
    !sameJson(summary?.runner, runtime?.runner) ||
    !sameJson(summary?.toolchain, runtime?.toolchain)
  ) {
    violations.push('baseline summary 未精确绑定重算样本、运行身份或 attestation');
  }
  const expectedProposedBudgets = proposedReadBudgets({
    descriptorId: descriptor?.descriptorId,
    profile,
    metrics: baselineValidation.metrics,
    budgetIsAbsent: true,
  });
  if (!sameJson(proposedBudgets, expectedProposedBudgets)) {
    violations.push('baseline proposed budgets 未精确源自重算样本和获批公式');
  }
  return { valid: violations.length === 0, violations, metrics: baselineValidation.metrics };
}

/**
 * 校验已经人工冻结的 read PF budget。该函数只验证内存值，绝不读写 budget file；
 * 首次 baseline 不应调用冻结路径。
 */
export function validateReadPfBudget({
  budget,
  descriptor,
  descriptorDigest,
  profile,
  fixtureDigest,
  metrics,
  measurementInputs,
  runtime,
  baselineArtifactDigests,
  baselineEvidence,
}) {
  const violations = [];
  const descriptorId = descriptor?.descriptorId;
  const metricIds = safeMetricIds(descriptor);
  const baselineProvenance = budget?.baselineProvenance;
  const budgetMetrics = budget?.metrics;

  if (!isPlainObject(budget) || budget.schemaVersion !== 1) violations.push('budget schemaVersion 无效');
  if (budget?.descriptorId !== descriptorId) violations.push('budget descriptorId 不匹配');
  if (budget?.descriptorDigest !== descriptorDigest) violations.push('budget descriptor digest 不匹配');
  if (budget?.profile !== profile) violations.push('budget profile 不匹配');
  if (budget?.fixtureDigest !== fixtureDigest) violations.push('budget fixture digest 不匹配');
  if (budget?.measurementInputDigest !== measurementInputs?.digest) {
    violations.push('budget measurement input digest 不匹配');
  }
  if (budget?.path !== versionedBudgetPath(descriptorId, profile)) {
    violations.push('budget path 未绑定该 PF/profile 的版本化位置');
  }
  const requiredArtifacts = ['samples.json', 'summary.json', 'proposed-budgets.json'];
  const artifactsValid = requiredArtifacts.every((name) => isDigest(baselineProvenance?.artifacts?.[name]));
  const physicalArtifactsMatch = requiredArtifacts.every(
    (name) => baselineArtifactDigests?.[name] === baselineProvenance?.artifacts?.[name],
  );
  if (
    budget?.formula?.absoluteCeilingMs !== FORMULA.absoluteCeilingMs ||
    budget?.formula?.regressionAllowance !== FORMULA.regressionAllowance
  ) {
    violations.push('budget formula 不匹配获批 contract');
  }
  if (
    !isPlainObject(baselineProvenance) ||
    !hasNonEmptyString(baselineProvenance.run) ||
    !hasNonEmptyString(baselineProvenance.commit) ||
    baselineProvenance.worktreeDirty !== false ||
    baselineProvenance.descriptorDigest !== descriptorDigest ||
    baselineProvenance.fixtureDigest !== fixtureDigest ||
    baselineProvenance.measurementInputDigest !== measurementInputs?.digest ||
    JSON.stringify(baselineProvenance.runner) !== JSON.stringify(runtime?.runner) ||
    JSON.stringify(baselineProvenance.toolchain) !== JSON.stringify(runtime?.toolchain) ||
    !artifactsValid ||
    !physicalArtifactsMatch
  ) {
    violations.push('budget baseline provenance 未绑定当前 descriptor/fixture/measurement/runtime');
  }
  if (!hasExactKeys(budgetMetrics, metricIds)) {
    violations.push('budget metrics 集合不完整');
  }

  const baselineEvidenceValidation = validateBaselineEvidence({
    baselineEvidence,
    descriptor,
    descriptorDigest,
    profile,
    fixtureDigest,
    measurementInputs,
    runtime,
    baselineProvenance,
  });
  violations.push(...baselineEvidenceValidation.violations);

  const metricBudgets = {};
  for (const metricId of metricIds) {
    const current = metrics?.[metricId];
    const metricBudget = budgetMetrics?.[metricId];
    if (!isPlainObject(current) || !isPlainObject(metricBudget) || !isPlainObject(metricBudget.baseline)) {
      violations.push(`metric ${metricId} budget 缺失`);
      continue;
    }
    const baseline = metricBudget.baseline;
    const recomputedBaseline = baselineEvidenceValidation.metrics[metricId];
    const expectedAbsolute = absoluteCeilingMs(baseline.p95);
    const expectedRegression = regressionP50CeilingMs(baseline.p50);
    if (
      !hasExactKeys(metricBudget, ['baseline', 'absoluteCeilingMs', 'regressionP50CeilingMs']) ||
      !hasExactKeys(baseline, ['p50', 'p95', 'n']) ||
      !Number.isFinite(baseline.p50) ||
      !Number.isFinite(baseline.p95) ||
      !Number.isInteger(baseline.n) ||
      baseline.n <= 0 ||
      !sameJson(baseline, {
        p50: recomputedBaseline?.p50,
        p95: recomputedBaseline?.p95,
        n: recomputedBaseline?.n,
      }) ||
      metricBudget.absoluteCeilingMs !== expectedAbsolute ||
      metricBudget.regressionP50CeilingMs !== expectedRegression
    ) {
      violations.push(`metric ${metricId} budget threshold 与公式不一致`);
      continue;
    }
    metricBudgets[metricId] = {
      absoluteCeilingMs: metricBudget.absoluteCeilingMs,
      regressionP50CeilingMs: metricBudget.regressionP50CeilingMs,
      baseline: { p50: baseline.p50, p95: baseline.p95, n: baseline.n },
      comparison:
        current.p95 <= metricBudget.absoluteCeilingMs && current.p50 <= metricBudget.regressionP50CeilingMs
          ? 'pass'
          : 'fail',
    };
  }

  const valid = violations.length === 0;
  return {
    valid,
    violations,
    budgetState: valid ? `budget-frozen（${budget?.path ?? 'versioned budget'}）` : 'budget-invalid（禁止比较或 PASS）',
    metricBudgets,
  };
}

/**
 * 对一次 PF-02/PF-03 read sampling 形成不含内容、路径或 L3/RSS claim 的结果。
 */
export function evaluateReadPfEvidence(input) {
  const validation = evidenceValidation(input);
  if (!validation.valid) return invalidResult(input, validation);

  const descriptor = input.descriptor;
  const metrics = validation.metrics;
  const basicSummary = {
    schemaVersion: 1,
    descriptorId: descriptor.descriptorId,
    descriptorDigest: input.descriptorDigest,
    profile: input.profile,
    fixtureDigest: input.fixtureDigest,
    metrics,
    runIdentity: {
      startCommit: input.runIdentity.start.commit,
      startWorktreeDirty: false,
      endCommit: input.runIdentity.end.commit,
      endWorktreeDirty: false,
      consistent: true,
    },
    runner: input.runtime.runner,
    toolchain: input.runtime.toolchain,
    measurementInputDigest: input.measurementInputs.digest,
    validation: { valid: true, violations: [] },
  };
  const budget = input.budget;
  const budgetIsAbsent = budget === undefined || budget === null;
  const budgetValidation = budgetIsAbsent
    ? undefined
    : validateReadPfBudget({
        budget,
        descriptor,
        descriptorDigest: input.descriptorDigest,
        profile: input.profile,
        fixtureDigest: input.fixtureDigest,
        metrics,
        measurementInputs: input.measurementInputs,
        runtime: input.runtime,
        baselineArtifactDigests: input.baselineArtifactDigests,
        baselineEvidence: input.baselineEvidence,
      });
  const comparisonFailed =
    budgetValidation?.valid === true &&
    Object.values(budgetValidation.metricBudgets).some((metric) => metric.comparison === 'fail');
  const status = budgetIsAbsent
    ? 'baseline-collected / budget-not-frozen'
    : budgetValidation?.valid !== true
      ? 'budget-invalid'
      : comparisonFailed
        ? 'budget-comparison-failed'
        : 'budget-comparison';
  const budgetState = budgetIsAbsent
    ? CLEAN_BASELINE_LABEL
    : budgetValidation?.budgetState ?? 'budget-invalid（禁止比较或 PASS）';
  const proposedBudgets = proposedReadBudgets({
    descriptorId: descriptor.descriptorId,
    profile: input.profile,
    metrics,
    budgetIsAbsent,
  });

  return {
    summary: {
      ...basicSummary,
      status,
      budgetState,
      budgetValidation: budgetValidation === undefined ? { status: 'not-created' } : budgetValidation,
    },
    proposedBudgets,
    exitCode: budgetIsAbsent ? 2 : budgetValidation?.valid !== true || comparisonFailed ? 1 : 0,
  };
}

/**
 * 仅将 manifest closure 所需的脱敏 metadata 投影出来。input summary 的内容、
 * activePath、raw samples 和绝对路径均不会传播到 manifest。
 */
export function projectReadPfManifestResult({ config, step, summary, summaryRelativePath }) {
  if (
    !safeRelative(config?.descriptorPath) ||
    !safeRelative(config?.budgetPath) ||
    !safeRelative(config?.evidenceRelativeDir) ||
    !safeRelative(summaryRelativePath)
  ) {
    throw new Error('read PF manifest projection 仅接受 repo-relative evidence paths');
  }
  const requiredRunner = ['node', 'npm', 'platform', 'release', 'macosProductVersion', 'arch'];
  const safeAttestationString = (value) =>
    hasNonEmptyString(value) &&
    !value.includes('\0') &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.toLowerCase().includes('file:') &&
    !value.includes('SYNTHETIC-SECRET-');
  if (
    !READ_DESCRIPTOR_IDS.has(config?.descriptorId) ||
    !READ_PROFILES.has(config?.profile) ||
    summary?.descriptorId !== config.descriptorId ||
    summary?.profile !== config.profile ||
    !isDigest(summary?.descriptorDigest) ||
    !isDigest(summary?.fixtureDigest) ||
    !isDigest(summary?.measurementInputDigest) ||
    summary?.validation?.valid !== true ||
    !isPlainObject(summary?.budgetValidation) ||
    !requiredRunner.every((key) => safeAttestationString(summary?.runner?.[key])) ||
    !safeAttestationString(summary?.toolchain?.rustc) ||
    !safeAttestationString(summary?.toolchain?.cargo)
  ) {
    throw new Error('read PF manifest projection 的 summary attestation 无效');
  }
  const descriptorPath = config.descriptorPath;
  const safeSummaryPath = summaryRelativePath;
  const metrics = Object.entries(summary?.metrics ?? {});
  if (
    metrics.length !== 3 ||
    metrics.some(
      ([id, metric]) =>
        !/^pf0[23]\.[a-z0-9_.-]+$/.test(id) ||
        !Number.isInteger(metric?.n) ||
        metric.n <= 0 ||
        metric?.layer !== 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
    )
  ) {
    throw new Error('read PF manifest projection 的 metric metadata 无效');
  }
  const normalizedStep = {
    id: typeof step?.id === 'string' ? step.id : 'unknown',
    exitCode: Number.isInteger(step?.exitCode) ? step.exitCode : 1,
    status: typeof step?.status === 'string' ? step.status : 'fail',
  };
  const isPass = normalizedStep.exitCode === 0 && normalizedStep.status === 'pass';
  const isBaseline = normalizedStep.exitCode === 2 && normalizedStep.status === 'inconclusive';
  const isFailure = normalizedStep.exitCode === 1 && normalizedStep.status === 'fail';
  if (!isPass && !isBaseline && !isFailure) {
    throw new Error('read PF manifest projection 的 step status/exitCode 无效');
  }
  let budgetValidation;
  let budgetState;
  if (isBaseline) {
    if (
      summary?.status !== 'baseline-collected / budget-not-frozen' ||
      !sameJson(summary?.budgetValidation, { status: 'not-created' })
    ) {
      throw new Error('read PF baseline summary 与 inconclusive step 不一致');
    }
    budgetValidation = { status: 'not-created' };
    budgetState = 'budget-not-frozen';
  } else {
    const budgetValid = summary?.budgetValidation?.valid;
    const metricBudgets = summary?.budgetValidation?.metricBudgets;
    if (typeof budgetValid !== 'boolean' || !isPlainObject(metricBudgets)) {
      throw new Error('read PF comparison summary 缺少 budget validation');
    }
    const comparisons = Object.entries(metricBudgets).map(([id, metric]) => {
      if (!/^pf0[23]\.[a-z0-9_.-]+$/.test(id) || !['pass', 'fail'].includes(metric?.comparison)) {
        throw new Error('read PF comparison metric metadata 无效');
      }
      return { id, comparison: metric.comparison };
    });
    comparisons.sort((left, right) => comparePfReadPaths(left.id, right.id));
    if (comparisons.length !== 3) throw new Error('read PF comparison metrics 不完整');
    if (
      isPass &&
      !(summary?.status === 'budget-comparison' && budgetValid === true && comparisons.every((item) => item.comparison === 'pass'))
    ) {
      throw new Error('read PF pass step 未绑定完整 budget comparison');
    }
    if (
      isFailure &&
      !(
        (summary?.status === 'budget-comparison-failed' && budgetValid === true && comparisons.some((item) => item.comparison === 'fail')) ||
        (summary?.status === 'budget-invalid' && budgetValid === false)
      )
    ) {
      throw new Error('read PF fail step 未绑定失败 comparison');
    }
    budgetValidation = { valid: budgetValid, comparisons };
    budgetState = budgetValid ? `budget-frozen（${config.budgetPath}）` : 'budget-invalid';
  }
  return {
    pfId: typeof config?.descriptorId === 'string' ? config.descriptorId : 'unknown',
    profile: typeof config?.profile === 'string' ? config.profile : 'unknown',
    step: normalizedStep,
    descriptor: { path: descriptorPath, digest: summary?.descriptorDigest ?? 'unknown' },
    fixtureDigest: typeof summary?.fixtureDigest === 'string' ? summary.fixtureDigest : 'unknown',
    metrics: metrics.map(([id, metric]) => ({ id, sampleCount: metric.n, layer: metric.layer })),
    summaryRelativePath: safeSummaryPath,
    budgetState,
    validation: { valid: true },
    budgetValidation,
    runner: Object.fromEntries(requiredRunner.map((key) => [key, summary.runner[key]])),
    toolchain: { rustc: summary.toolchain.rustc, cargo: summary.toolchain.cargo },
    measurementInputDigest:
      typeof summary?.measurementInputDigest === 'string' ? summary.measurementInputDigest : 'unknown',
  };
}
