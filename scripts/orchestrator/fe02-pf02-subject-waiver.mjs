/**
 * FE-02 的唯一 subject-bound PF-02 representative manual disposition。
 *
 * 只重读 immutable historical artifacts 和对应 Git objects；绝不启动 PF sampling，
 * 也不读取/升级旧 waiver record。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertCurrentPfDescriptorDigest,
  assertNoGitAmbient,
  REPO_ROOT,
  scanEvidenceText,
  sha256File,
  sha256Text,
} from './lib.mjs';
import { evaluateReadPfEvidence } from './pf-read-evidence.mjs';
import { collectPfReadMeasurementInputs } from './pf-read-measurement-inputs.mjs';
import { hasPhysicalPath } from './clean-evidence-index.mjs';

export const FE02_PF02_SUBJECT_WAIVER_PATH =
  'performance/waivers/fe-02-pf-02-representative-scroll-render-stable.json';
export const FE02_PF02_SUBJECT_WAIVER_SHA256 =
  '60a6f7dbb89da3b6a2a4c955af796a41c7b5ec5d87dc765177056fc9c4e0eb8b';
export const FE02_PF02_SUBJECT_WAIVER_MODE = 'historical-subject-waiver-validation';

const TICKET = 'FE-02';
const PERFORMANCE = 'PF-02';
const PROFILE = 'representative';
const BASELINE = Object.freeze({
  runId: '20260814T153344617Z-p43084-000',
  commit: '9470f64e9b1edb4695092675fbfbd2043ac7b354',
});
const SUBJECT = Object.freeze({
  runId: '20260815T060139784Z-p84684-000',
  commit: '7936cb91f54c94e836124b0d46337247776431d2',
});
const SUBJECT_ARTIFACT_DIR =
  `.artifacts/verification/${TICKET}/${SUBJECT.runId}/performance/PF-02/${PROFILE}`;
const BASELINE_ARTIFACT_DIR = `.artifacts/performance/PF-02/${PROFILE}/${BASELINE.runId}`;
const BUDGET_PATH = 'performance/budgets/pf-02.representative.budgets.json';
const DESCRIPTOR_PATH = 'performance/descriptors/pf-02.source-large.json';
const METRIC_IDS = Object.freeze([
  'pf02.source.open.content_visible',
  'pf02.source.scroll.render_stable',
  'pf02.source.readonly_switch.content_visible',
]);
const EXPECTED_VIOLATION = Object.freeze({
  metric: 'pf02.source.scroll.render_stable',
  statistic: 'p50',
  observedMs: 12.95,
  thresholdMs: 3.9375,
  deltaMs: 9.0125,
});
const AUTHORIZATION = Object.freeze({
  scope:
    '仅此 FE-02 subject historical PF-02 representative 的 pf02.source.scroll.render_stable 自动 numeric latency fail；不改变 automatic fail/exit 1、预算、阈值、公式、样本数、collector、verifier 规则或历史 artifact，不泛化、不复用。',
  policy: '仅精确 numeric latency violation 可有显式人工 disposition；hard gate 不可 waive；不得称为 automatic PASS。',
});
const EXPECTED_ARTIFACTS = Object.freeze({
  baseline: Object.freeze({
    'samples.json': '4c69d018fc9b54e45ae7340b6716b8b1cdc352cf2e1d1d5f4a0730dd43e13aa4',
    'summary.json': '373705bcb83f62ac8278521e69d1bc70804c6a70e87f14b97087f84e99c97e01',
    'proposed-budgets.json': '10297e8e61e8d315ebc0f036593116e10df0c2b5b45ab1aa7261be9b5fd1b864',
  }),
  subject: Object.freeze({
    'samples.json': '25123773cfe6dc4d24225e8c7c55ed00778adf1cad3b3d2b17b92c52b25b19ff',
    'summary.json': '9323fa0edab6c98bdb49ff99cc6cdd2c6fd34dd5da22a10c3cb07f395db67137',
    'fixture-attestation.json': 'b588bcd36ab999e618acba98e86d36e2ba01c295d0d5ca3ebe9fbe04c7f2a76e',
    'l2-dev-module-graph.json': '0461ec1eb1f9e6ca4b0412cec23a56abd84d728238f50b2cdbd7f01ae5b7b2fa',
    'proposed-budgets.json': '26f646bc424005e9fc9a6c6fefabe31c5c5892af77b06a06b8440c48d79516be',
  }),
});
const RUNNER = Object.freeze({
  node: 'v24.18.0',
  npm: '11.16.0',
  platform: 'darwin',
  release: '25.6.0',
  macosProductVersion: '26.6.1',
  arch: 'arm64',
});
const TOOLCHAIN = Object.freeze({
  cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)',
  rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)',
});
/** summary/fixture evidence 内 toolchain 的 key 顺序为 rustc 在前；与 record 常量分开绑定。 */
const SUMMARY_TOOLCHAIN = Object.freeze({
  rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)',
  cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)',
});
const MEASUREMENT_CONTRACT = Object.freeze({
  descriptorPath: DESCRIPTOR_PATH,
  descriptorDigest: '53df623aeb8538e1ad8e2821c287603241647de870dcd2c04c8816cb1beff86e',
  measurementInputs: {
    schemaVersion: 1,
    algorithm: 'pf-read-measurement-contract-v1',
    digest: 'a1b474199c61bf46c769d83f22c6b7953be7f1053db0c1cbf3ed108e9259de45',
    l2DevModuleGraphSha256: '0461ec1eb1f9e6ca4b0412cec23a56abd84d728238f50b2cdbd7f01ae5b7b2fa',
  },
  fixture: {
    generator: 'src/gateway/pf-read-fixtures.ts#buildPf02SourceLargeFixture',
    profile: PROFILE,
    sha256: 'fc1100b4835e795128117099bc6c246497a26ef0d37bbbb941c3b87d41989e56',
  },
  runner: RUNNER,
  toolchain: TOOLCHAIN,
});
const PERFORMANCE_DEBT = Object.freeze({
  status: 'deferred',
  phase: 'post-optimization',
  rootCause:
    'collector 以两个 requestAnimationFrame 间隔度量 render_stable，冻结 p50 ceiling（3.9375ms）与 headless Chrome 帧量化/宿主调度噪声同量级；同一 commit、全部测量输入零 diff 的三次测量呈双峰（快簇 1.9-6.7ms，慢簇 16-19.3ms）且在 representative/stress 间交替失败，baseline 自身 p95 已达 16.965ms；证据指向宿主调度/测量相位不稳定而非产品回归，未经受控诊断采样进一步证实。',
  scope: '仅 PF-02 representative 的 scroll.render_stable p50 9.0125ms 超出 frozen regression threshold；不掩盖 automatic fail。',
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

/** 对 subject/baseline commit 的 descriptor Git object 内容复算自描述 digest。 */
function descriptorDigestFromGit(repoRoot, commit, violations) {
  let tempDir;
  try {
    const text = gitText(repoRoot, commit, DESCRIPTOR_PATH);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe02-pf02-descriptor-'));
    const descriptorPath = path.join(tempDir, 'descriptor.json');
    fs.writeFileSync(descriptorPath, text, 'utf8');
    return assertCurrentPfDescriptorDigest(descriptorPath).digest;
  } catch {
    violations.push(`${commit} descriptor Git object unavailable or digest invalid`);
    return null;
  } finally {
    if (tempDir !== undefined) fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
}

/**
 * 重读一次 historical run 的 immutable artifact。record 只绑定授权列出的文件；
 * subject 目录另要求其物理文件集合恰为五个 read PF artifact，baseline 目录只校验
 * 记录绑定的 budget 三元组（baseline 的 fixture/graph 不参与冻结预算比较）。
 */
function validateArtifactSet({ repoRoot, run, directory, hashes, exactSet, violations }) {
  const absolute = path.join(repoRoot, directory);
  if (!hasPhysicalPath(repoRoot, absolute)) {
    violations.push(`${run.runId} artifact directory is not physical`);
    return null;
  }
  try {
    const stats = fs.lstatSync(absolute);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error();
    if (exactSet && !sameJson(fs.readdirSync(absolute).sort(), Object.keys(hashes ?? {}).sort())) {
      violations.push(`${run.runId} artifact set has extra or missing files`);
      return null;
    }
  } catch {
    violations.push(`${run.runId} artifact directory unreadable`);
    return null;
  }
  if (!isObject(hashes) || Object.keys(hashes).length === 0) {
    violations.push(`${run.runId} artifact hash binding invalid`);
    return null;
  }
  const artifacts = {};
  for (const [file, expected] of Object.entries(hashes)) {
    const filePath = path.join(absolute, file);
    try {
      const stats = fs.lstatSync(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || !hasPhysicalPath(repoRoot, filePath)) {
        throw new Error();
      }
      if (!isSha256(expected) || sha256File(filePath) !== expected) {
        violations.push(`${run.runId}/${file} SHA-256 mismatch`);
      }
      const text = fs.readFileSync(filePath, 'utf8');
      if (!scanEvidenceText(text).clean) violations.push(`${run.runId}/${file} contaminated`);
      artifacts[file] = JSON.parse(text);
    } catch {
      violations.push(`${run.runId}/${file} is not a physical JSON artifact`);
    }
  }
  return Object.keys(artifacts).length === Object.keys(hashes).length ? artifacts : null;
}

function validateSamples(payload, violations, label) {
  if (
    !exactKeys(payload, ['schemaVersion', 'descriptorId', 'profile', 'unit', 'metrics']) ||
    payload.schemaVersion !== 1 ||
    payload.descriptorId !== PERFORMANCE ||
    payload.profile !== PROFILE ||
    payload.unit !== 'ms' ||
    !exactKeys(payload.metrics, METRIC_IDS)
  ) {
    violations.push(`${label} raw timing schema/profile/metric set invalid`);
    return;
  }
  for (const metric of METRIC_IDS) {
    const values = payload.metrics[metric]?.samples;
    if (
      !Array.isArray(values) ||
      values.length !== 20 ||
      values.some((sample) => typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0)
    ) {
      violations.push(`${label} raw timing samples invalid: ${metric}`);
    }
  }
}

function validateFixtureAttestation(attestation, contract, violations, label) {
  if (
    !exactKeys(attestation, ['schemaVersion', 'descriptorId', 'profile', 'fixtureDigest']) ||
    attestation.schemaVersion !== 1 ||
    attestation.descriptorId !== PERFORMANCE ||
    attestation.profile !== PROFILE ||
    attestation.fixtureDigest !== contract.fixture.sha256
  ) {
    violations.push(`${label} fixture attestation does not bind descriptorId/profile/fixtureDigest`);
  }
}

/** 对 subject evidence 重算冻结预算比较；确认有且仅有授权的那一个 numeric violation。 */
function recomputeSubjectBudgetComparison({
  repoRoot,
  record,
  subjectArtifacts,
  baselineArtifacts,
  descriptorDigest,
  violations,
}) {
  let budget;
  try {
    budget = JSON.parse(gitText(repoRoot, SUBJECT.commit, record?.budget?.path ?? BUDGET_PATH));
  } catch {
    violations.push('frozen budget Git object unavailable');
    return;
  }
  let measurementInputs;
  try {
    measurementInputs = collectPfReadMeasurementInputs({
      graphPath: path.join(repoRoot, SUBJECT_ARTIFACT_DIR, 'l2-dev-module-graph.json'),
      descriptorPath: DESCRIPTOR_PATH,
      repoRoot,
    });
    if (measurementInputs.digest !== record?.measurementContract?.measurementInputs?.digest) {
      violations.push('measurement method inputs drift since the subject run');
      return;
    }
  } catch {
    violations.push('measurement method inputs unavailable or drifted');
    return;
  }
  const summary = subjectArtifacts?.['summary.json'];
  let result;
  try {
    result = evaluateReadPfEvidence({
      descriptor: JSON.parse(gitText(repoRoot, SUBJECT.commit, DESCRIPTOR_PATH)),
      descriptorDigest,
      profile: PROFILE,
      fixtureDigest: record?.measurementContract?.fixture?.sha256,
      samplesPayload: subjectArtifacts?.['samples.json'],
      runIdentity: {
        start: {
          commit: summary?.runIdentity?.startCommit,
          worktreeDirty: summary?.runIdentity?.startWorktreeDirty,
        },
        end: {
          commit: summary?.runIdentity?.endCommit,
          worktreeDirty: summary?.runIdentity?.endWorktreeDirty,
        },
      },
      runtime: { runner: summary?.runner, toolchain: summary?.toolchain },
      measurementInputs,
      budget,
      baselineArtifactDigests: record?.artifacts?.baseline,
      baselineEvidence: {
        samplesPayload: baselineArtifacts?.['samples.json'],
        summary: baselineArtifacts?.['summary.json'],
        proposedBudgets: baselineArtifacts?.['proposed-budgets.json'],
      },
    });
  } catch {
    violations.push('subject budget recomputation failed');
    return;
  }
  if (
    result.exitCode !== 1 ||
    result.summary?.status !== 'budget-comparison-failed' ||
    !sameJson(result.summary, summary) ||
    !sameJson(result.proposedBudgets, subjectArtifacts?.['proposed-budgets.json'])
  ) {
    violations.push('subject summary does not recompute from raw samples and frozen budget');
    return;
  }
  const metricBudgets = result.summary?.budgetValidation?.metricBudgets ?? {};
  const failures = METRIC_IDS.filter((metric) => metricBudgets[metric]?.comparison === 'fail');
  const stats = summary?.metrics?.[EXPECTED_VIOLATION.metric];
  const budgetEntry = metricBudgets[EXPECTED_VIOLATION.metric];
  const recomputed =
    failures.length === 1 && budgetEntry !== undefined && isObject(stats)
      ? {
          metric: EXPECTED_VIOLATION.metric,
          statistic: 'p50',
          observedMs: stats.p50,
          thresholdMs: budgetEntry.regressionP50CeilingMs,
          deltaMs: Math.round((stats.p50 - budgetEntry.regressionP50CeilingMs) * 10000) / 10000,
        }
      : null;
  if (
    recomputed === null ||
    stats.p95 > budgetEntry.absoluteCeilingMs ||
    !sameJson(recomputed, EXPECTED_VIOLATION)
  ) {
    violations.push('subject raw stats do not produce the unique authorized violation');
  }
}

export function isExactFe02Pf02SubjectWaiverRecord(record) {
  return (
    exactKeys(record, [
      'schemaVersion',
      'kind',
      'recordDigest',
      'ticket',
      'performance',
      'profile',
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
    record.kind === 'fe-02-pf-02-representative-scroll-render-stable-exact-performance-waiver' &&
    record.ticket === TICKET &&
    record.performance === PERFORMANCE &&
    record.profile === PROFILE &&
    record.manualDisposition === 'accepted-with-waiver' &&
    exactKeys(record.recordDigest, ['algorithm', 'canonicalization', 'value']) &&
    record.recordDigest?.algorithm === 'sha256' &&
    record.recordDigest?.canonicalization ===
      '将本文件 recordDigest.value 置为空字符串后对文件原始字节求 sha256；由 FE-02 waiver validator 复算' &&
    isSha256(record.recordDigest?.value) &&
    record.recordDigest.value === canonicalDigest(record, 'recordDigest') &&
    exactKeys(record.authorization, ['scope', 'policy']) &&
    sameJson(record.authorization, AUTHORIZATION) &&
    exactKeys(record.automaticResult, ['status', 'exitCode', 'runId', 'run', 'commit', 'worktreeDirty', 'violation']) &&
    record.automaticResult.status === 'fail' &&
    record.automaticResult.exitCode === 1 &&
    record.automaticResult.runId === SUBJECT.runId &&
    record.automaticResult.run === SUBJECT_ARTIFACT_DIR &&
    record.automaticResult.commit === SUBJECT.commit &&
    record.automaticResult.worktreeDirty === false &&
    exactKeys(record.automaticResult.violation, ['metric', 'statistic', 'observedMs', 'thresholdMs', 'deltaMs']) &&
    sameJson(record.automaticResult.violation, EXPECTED_VIOLATION) &&
    exactKeys(record.budget, ['path', 'sha256']) &&
    record.budget.path === BUDGET_PATH &&
    record.budget.sha256 === '1bd6c4944fdb9de1cf360be2d08745791e3cf7f0e24f449c559b29a439bd4606' &&
    exactKeys(record.baseline, ['runId', 'run', 'commit', 'worktreeDirty']) &&
    record.baseline.runId === BASELINE.runId &&
    record.baseline.run === BASELINE_ARTIFACT_DIR &&
    record.baseline.commit === BASELINE.commit &&
    record.baseline.worktreeDirty === false &&
    sameJson(record.measurementContract, MEASUREMENT_CONTRACT) &&
    exactKeys(record.artifacts, ['baseline', 'subject']) &&
    sameJson(record.artifacts, EXPECTED_ARTIFACTS) &&
    exactKeys(record.performanceDebt, ['status', 'phase', 'rootCause', 'scope']) &&
    sameJson(record.performanceDebt, PERFORMANCE_DEBT)
  );
}

/** 公开 seam：只验证这一次 subject-bound record；所有漂移 fail-closed。 */
export function validateFe02Pf02SubjectWaiver({ repoRoot = REPO_ROOT, waiver = undefined } = {}) {
  const violations = [];
  const recordPath = path.join(repoRoot, FE02_PF02_SUBJECT_WAIVER_PATH);
  let record;
  try {
    if (!hasPhysicalPath(repoRoot, recordPath)) throw new Error();
    record = waiver ?? readJson(recordPath);
  } catch {
    return { valid: false, violations: ['subject waiver record is not physical/readable'] };
  }
  if (sha256File(recordPath) !== FE02_PF02_SUBJECT_WAIVER_SHA256) {
    violations.push('subject waiver record SHA-256 mismatch');
  }
  if (!isExactFe02Pf02SubjectWaiverRecord(record)) {
    violations.push('subject waiver record is not the exact authorized disposition');
  }

  try {
    const budgetText = gitText(repoRoot, SUBJECT.commit, BUDGET_PATH);
    if (
      sha256Text(budgetText) !== record?.budget?.sha256 ||
      sha256File(path.join(repoRoot, BUDGET_PATH)) !== record?.budget?.sha256
    ) {
      throw new Error();
    }
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
    directory: BASELINE_ARTIFACT_DIR,
    hashes: record?.artifacts?.baseline,
    exactSet: false,
    violations,
  });
  const subjectArtifacts = validateArtifactSet({
    repoRoot,
    run: SUBJECT,
    directory: SUBJECT_ARTIFACT_DIR,
    hashes: record?.artifacts?.subject,
    exactSet: true,
    violations,
  });

  const baselineSummary = baselineArtifacts?.['summary.json'];
  if (baselineArtifacts !== null) {
    validateRunIdentity(baselineSummary, BASELINE, violations);
    if (
      baselineSummary?.descriptorId !== PERFORMANCE ||
      baselineSummary?.descriptorDigest !== record?.measurementContract?.descriptorDigest ||
      baselineSummary?.profile !== PROFILE ||
      baselineSummary?.fixtureDigest !== record?.measurementContract?.fixture?.sha256 ||
      baselineSummary?.measurementInputDigest !==
        record?.measurementContract?.measurementInputs?.digest ||
      baselineSummary?.status !== 'baseline-collected / budget-not-frozen' ||
      !sameJson(baselineSummary?.runner, RUNNER) ||
      !sameJson(baselineSummary?.toolchain, SUMMARY_TOOLCHAIN)
    ) {
      violations.push(`${BASELINE.runId} descriptor/fixture/measurement/runtime attestation invalid`);
    }
    validateSamples(baselineArtifacts['samples.json'], violations, BASELINE.runId);
  }

  const subjectSummary = subjectArtifacts?.['summary.json'];
  if (subjectArtifacts !== null) {
    validateRunIdentity(subjectSummary, SUBJECT, violations);
    if (
      subjectSummary?.descriptorId !== PERFORMANCE ||
      subjectSummary?.descriptorDigest !== record?.measurementContract?.descriptorDigest ||
      subjectSummary?.profile !== PROFILE ||
      subjectSummary?.fixtureDigest !== record?.measurementContract?.fixture?.sha256 ||
      subjectSummary?.measurementInputDigest !==
        record?.measurementContract?.measurementInputs?.digest ||
      subjectSummary?.status !== 'budget-comparison-failed' ||
      subjectSummary?.budgetValidation?.valid !== true ||
      !sameJson(subjectSummary?.validation, { valid: true, violations: [] }) ||
      !sameJson(subjectSummary?.runner, RUNNER) ||
      !sameJson(subjectSummary?.toolchain, SUMMARY_TOOLCHAIN)
    ) {
      violations.push(`${SUBJECT.runId} automatic fail/exit status or attestation invalid`);
    }
    validateSamples(subjectArtifacts['samples.json'], violations, SUBJECT.runId);
    validateFixtureAttestation(
      subjectArtifacts['fixture-attestation.json'],
      record?.measurementContract ?? {},
      violations,
      SUBJECT.runId,
    );
  }

  if (subjectArtifacts !== null && baselineArtifacts !== null) {
    recomputeSubjectBudgetComparison({
      repoRoot,
      record,
      subjectArtifacts,
      baselineArtifacts,
      descriptorDigest: subjectDescriptorDigest,
      violations,
    });
  }

  if (violations.length > 0) return { valid: false, violations };
  return {
    valid: true,
    violations: [],
    waiverPath: FE02_PF02_SUBJECT_WAIVER_PATH,
    waiverSha256: FE02_PF02_SUBJECT_WAIVER_SHA256,
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

export function subjectPf02StepMetadata(validation) {
  return {
    executionMode: FE02_PF02_SUBJECT_WAIVER_MODE,
    samplingRun: false,
    historicalRunId: validation?.automaticResult?.runId ?? null,
    initialWaiverValidation: validation?.valid === true ? 'valid' : 'invalid',
  };
}
