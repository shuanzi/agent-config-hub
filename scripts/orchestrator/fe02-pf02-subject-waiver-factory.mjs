/**
 * FE-02 subject-bound PF-02 manual disposition validator 的共享工厂。
 *
 * representative 与 stress 两份 exact waiver record 共用同一套 fail-closed exact 语义；
 * 全部 historical 常量（runId/commit/SHA/violation/预算/契约/授权文案）由调用方作为
 * config 注入，工厂本身不携带任何 subject 事实。
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

export const FE02_PF02_SUBJECT_WAIVER_EXECUTION_MODE = 'historical-subject-waiver-validation';

const METRIC_IDS = Object.freeze([
  'pf02.source.open.content_visible',
  'pf02.source.scroll.render_stable',
  'pf02.source.readonly_switch.content_visible',
]);

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

/**
 * 由注入常量生成一份 subject-bound exact waiver validator。
 * config 字段全部为钉死的 historical 事实；任何漂移 fail-closed。
 */
export function createFe02Pf02SubjectWaiver(config) {
  const {
    waiverPath,
    waiverSha256,
    kind,
    performance,
    profile,
    baseline,
    subject,
    budgetPath,
    budgetSha256,
    descriptorPath,
    descriptorDigest,
    expectedViolation,
    authorization,
    expectedArtifacts,
    runner,
    toolchain,
    summaryToolchain,
    measurementInputs,
    fixture,
    sampleCount,
    performanceDebt,
  } = config;
  const subjectArtifactDir = `.artifacts/verification/FE-02/${subject.runId}/performance/${performance}/${profile}`;
  const baselineArtifactDir = `.artifacts/performance/${performance}/${profile}/${baseline.runId}`;
  const measurementContract = Object.freeze({
    descriptorPath,
    descriptorDigest,
    measurementInputs,
    fixture,
    runner,
    toolchain,
  });

  /** 对 subject/baseline commit 的 descriptor Git object 内容复算自描述 digest。 */
  function descriptorDigestFromGit(repoRoot, commit, violations) {
    let tempDir;
    try {
      const text = gitText(repoRoot, commit, descriptorPath);
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe02-pf02-descriptor-'));
      const tempDescriptorPath = path.join(tempDir, 'descriptor.json');
      fs.writeFileSync(tempDescriptorPath, text, 'utf8');
      return assertCurrentPfDescriptorDigest(tempDescriptorPath).digest;
    } catch {
      violations.push(`${commit} descriptor Git object unavailable or digest invalid`);
      return null;
    } finally {
      if (tempDir !== undefined) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  function validateSamples(payload, violations, label) {
    if (
      !exactKeys(payload, ['schemaVersion', 'descriptorId', 'profile', 'unit', 'metrics']) ||
      payload.schemaVersion !== 1 ||
      payload.descriptorId !== performance ||
      payload.profile !== profile ||
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
        values.length !== sampleCount ||
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
      attestation.descriptorId !== performance ||
      attestation.profile !== profile ||
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
    violations,
  }) {
    let budget;
    try {
      budget = JSON.parse(gitText(repoRoot, subject.commit, record?.budget?.path ?? budgetPath));
    } catch {
      violations.push('frozen budget Git object unavailable');
      return;
    }
    let measurementInputsNow;
    try {
      measurementInputsNow = collectPfReadMeasurementInputs({
        graphPath: path.join(repoRoot, subjectArtifactDir, 'l2-dev-module-graph.json'),
        descriptorPath,
        repoRoot,
      });
      if (measurementInputsNow.digest !== record?.measurementContract?.measurementInputs?.digest) {
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
        descriptor: JSON.parse(gitText(repoRoot, subject.commit, descriptorPath)),
        descriptorDigest,
        profile,
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
        measurementInputs: measurementInputsNow,
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
    const stats = summary?.metrics?.[expectedViolation.metric];
    const budgetEntry = metricBudgets[expectedViolation.metric];
    const recomputed =
      failures.length === 1 && budgetEntry !== undefined && isObject(stats)
        ? {
            metric: expectedViolation.metric,
            statistic: 'p50',
            observedMs: stats.p50,
            thresholdMs: budgetEntry.regressionP50CeilingMs,
            deltaMs: Math.round((stats.p50 - budgetEntry.regressionP50CeilingMs) * 10000) / 10000,
          }
        : null;
    if (
      recomputed === null ||
      stats.p95 > budgetEntry.absoluteCeilingMs ||
      !sameJson(recomputed, expectedViolation)
    ) {
      violations.push('subject raw stats do not produce the unique authorized violation');
    }
  }

  function isExactRecord(record) {
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
      record.kind === kind &&
      record.ticket === 'FE-02' &&
      record.performance === performance &&
      record.profile === profile &&
      record.manualDisposition === 'accepted-with-waiver' &&
      exactKeys(record.recordDigest, ['algorithm', 'canonicalization', 'value']) &&
      record.recordDigest?.algorithm === 'sha256' &&
      record.recordDigest?.canonicalization ===
        '将本文件 recordDigest.value 置为空字符串后对文件原始字节求 sha256；由 FE-02 waiver validator 复算' &&
      isSha256(record.recordDigest?.value) &&
      record.recordDigest.value === canonicalDigest(record, 'recordDigest') &&
      exactKeys(record.authorization, ['scope', 'policy']) &&
      sameJson(record.authorization, authorization) &&
      exactKeys(record.automaticResult, ['status', 'exitCode', 'runId', 'run', 'commit', 'worktreeDirty', 'violation']) &&
      record.automaticResult.status === 'fail' &&
      record.automaticResult.exitCode === 1 &&
      record.automaticResult.runId === subject.runId &&
      record.automaticResult.run === subjectArtifactDir &&
      record.automaticResult.commit === subject.commit &&
      record.automaticResult.worktreeDirty === false &&
      exactKeys(record.automaticResult.violation, ['metric', 'statistic', 'observedMs', 'thresholdMs', 'deltaMs']) &&
      sameJson(record.automaticResult.violation, expectedViolation) &&
      exactKeys(record.budget, ['path', 'sha256']) &&
      record.budget.path === budgetPath &&
      record.budget.sha256 === budgetSha256 &&
      exactKeys(record.baseline, ['runId', 'run', 'commit', 'worktreeDirty']) &&
      record.baseline.runId === baseline.runId &&
      record.baseline.run === baselineArtifactDir &&
      record.baseline.commit === baseline.commit &&
      record.baseline.worktreeDirty === false &&
      sameJson(record.measurementContract, measurementContract) &&
      exactKeys(record.artifacts, ['baseline', 'subject']) &&
      sameJson(record.artifacts, expectedArtifacts) &&
      exactKeys(record.performanceDebt, ['status', 'phase', 'rootCause', 'scope']) &&
      sameJson(record.performanceDebt, performanceDebt)
    );
  }

  /** 公开 seam：只验证这一次 subject-bound record；所有漂移 fail-closed。 */
  function validate({ repoRoot = REPO_ROOT, waiver = undefined } = {}) {
    const violations = [];
    const recordPath = path.join(repoRoot, waiverPath);
    let record;
    try {
      if (!hasPhysicalPath(repoRoot, recordPath)) throw new Error();
      record = waiver ?? readJson(recordPath);
    } catch {
      return { valid: false, violations: ['subject waiver record is not physical/readable'] };
    }
    if (sha256File(recordPath) !== waiverSha256) {
      violations.push('subject waiver record SHA-256 mismatch');
    }
    if (!isExactRecord(record)) {
      violations.push('subject waiver record is not the exact authorized disposition');
    }

    try {
      const budgetText = gitText(repoRoot, subject.commit, budgetPath);
      if (
        sha256Text(budgetText) !== record?.budget?.sha256 ||
        sha256File(path.join(repoRoot, budgetPath)) !== record?.budget?.sha256
      ) {
        throw new Error();
      }
    } catch {
      violations.push('frozen budget binding invalid');
    }

    const baselineDescriptorDigest = descriptorDigestFromGit(repoRoot, baseline.commit, violations);
    const subjectDescriptorDigest = descriptorDigestFromGit(repoRoot, subject.commit, violations);
    if (
      baselineDescriptorDigest !== record?.measurementContract?.descriptorDigest ||
      subjectDescriptorDigest !== record?.measurementContract?.descriptorDigest
    ) {
      violations.push('historical subject descriptor digest drift');
    }

    const baselineArtifacts = validateArtifactSet({
      repoRoot,
      run: baseline,
      directory: baselineArtifactDir,
      hashes: record?.artifacts?.baseline,
      exactSet: false,
      violations,
    });
    const subjectArtifacts = validateArtifactSet({
      repoRoot,
      run: subject,
      directory: subjectArtifactDir,
      hashes: record?.artifacts?.subject,
      exactSet: true,
      violations,
    });

    const baselineSummary = baselineArtifacts?.['summary.json'];
    if (baselineArtifacts !== null) {
      validateRunIdentity(baselineSummary, baseline, violations);
      if (
        baselineSummary?.descriptorId !== performance ||
        baselineSummary?.descriptorDigest !== record?.measurementContract?.descriptorDigest ||
        baselineSummary?.profile !== profile ||
        baselineSummary?.fixtureDigest !== record?.measurementContract?.fixture?.sha256 ||
        baselineSummary?.measurementInputDigest !==
          record?.measurementContract?.measurementInputs?.digest ||
        baselineSummary?.status !== 'baseline-collected / budget-not-frozen' ||
        !sameJson(baselineSummary?.runner, runner) ||
        !sameJson(baselineSummary?.toolchain, summaryToolchain)
      ) {
        violations.push(`${baseline.runId} descriptor/fixture/measurement/runtime attestation invalid`);
      }
      validateSamples(baselineArtifacts['samples.json'], violations, baseline.runId);
    }

    const subjectSummary = subjectArtifacts?.['summary.json'];
    if (subjectArtifacts !== null) {
      validateRunIdentity(subjectSummary, subject, violations);
      if (
        subjectSummary?.descriptorId !== performance ||
        subjectSummary?.descriptorDigest !== record?.measurementContract?.descriptorDigest ||
        subjectSummary?.profile !== profile ||
        subjectSummary?.fixtureDigest !== record?.measurementContract?.fixture?.sha256 ||
        subjectSummary?.measurementInputDigest !==
          record?.measurementContract?.measurementInputs?.digest ||
        subjectSummary?.status !== 'budget-comparison-failed' ||
        subjectSummary?.budgetValidation?.valid !== true ||
        !sameJson(subjectSummary?.validation, { valid: true, violations: [] }) ||
        !sameJson(subjectSummary?.runner, runner) ||
        !sameJson(subjectSummary?.toolchain, summaryToolchain)
      ) {
        violations.push(`${subject.runId} automatic fail/exit status or attestation invalid`);
      }
      validateSamples(subjectArtifacts['samples.json'], violations, subject.runId);
      validateFixtureAttestation(
        subjectArtifacts['fixture-attestation.json'],
        record?.measurementContract ?? {},
        violations,
        subject.runId,
      );
    }

    if (subjectArtifacts !== null && baselineArtifacts !== null) {
      recomputeSubjectBudgetComparison({
        repoRoot,
        record,
        subjectArtifacts,
        baselineArtifacts,
        violations,
      });
    }

    if (violations.length > 0) return { valid: false, violations };
    return {
      valid: true,
      violations: [],
      waiverPath,
      waiverSha256,
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
      subject: { commit: subject.commit, runId: subject.runId },
      budget: record.budget,
      artifacts: record.artifacts,
      measurementContract: record.measurementContract,
      performanceDebt: record.performanceDebt,
    };
  }

  function subjectStepMetadata(validation) {
    return {
      executionMode: FE02_PF02_SUBJECT_WAIVER_EXECUTION_MODE,
      samplingRun: false,
      historicalRunId: validation?.automaticResult?.runId ?? null,
      initialWaiverValidation: validation?.valid === true ? 'valid' : 'invalid',
    };
  }

  return { isExactRecord, validate, subjectStepMetadata };
}
