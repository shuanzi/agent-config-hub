/* global process, console */
/**
 * verify:ticket（票据关闭入口，ARC-06c §3.17）。
 *
 * 封闭 registry 的每个 ticket 自带步骤、fixture、可选 PF 与 artifact 配置；
 * 未知 ticket id 退出 1。
 * 顺序执行；前序失败仍跑完后续独立步骤，但总体 fail。
 *
 * 状态模型：step 退出码映射 0=pass / 2=inconclusive / 其余=fail；
 * 常规整体 status 有 fail→fail，否则有 inconclusive→inconclusive，否则 pass。
 * 父进程收到 SIGINT/SIGTERM 时：runStep 仍把信号转发给当前子进程（lib.mjs 是 PF
 * 测量方法输入，保持字节不变）；verify-ticket 级 tracker 记录信号，主循环在当前
 * 步骤结束后（或下一步启动前）终止后续步骤，manifest 记 `aborted` 且
 * `completedAt=null`，进程以 128+signo 退出；aborted run 永不构成 completed/closure。
 * registry 默认执行新的 automatic sampling。仅未来 FE-01 registry 的精确 automatic-pass
 * record，或本次 subject-bound exact manual disposition，经 immutable validation 成功后，
 * 才将 perf 改为不采样的 historical validation；旧 waiver 仍永不进入 ticket closure。
 *
 * evidence：.artifacts/verification/<scope>/<run-id>/
 *   manifest.json
 *   steps/<step-id>/{stdout.log,stderr.log,meta.json}
 *   performance/{...}（仅 registry 声明 PF 的 ticket）
 * 所有写入先脱敏（$HOME → <HOME>）再扫描（占位敏感值/个人路径），
 * 扫描命中 → 状态 inconclusive 并在 manifest 说明。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACTS_ROOT,
  REPO_ROOT,
  assertCurrentPfDescriptorDigest,
  capture,
  digestDirectory,
  gitInfo,
  makeRunId,
  runStep,
  sanitizeText,
  scanEvidenceText,
  sameGitIdentity,
  writeJson,
} from './lib.mjs';
import { TICKET_REGISTRY, ticketConfig } from './ticket-registry.mjs';
import { maybeWriteLatestCleanPass } from './latest-clean-pass.mjs';
import {
  maybeWriteLatestCleanSubjectAcceptedWithWaiver,
  validateFe01SubjectAcceptedWithWaiverCandidate,
} from './latest-clean-subject-accepted-with-waiver.mjs';
import {
  maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver,
  validateFe02SubjectAcceptedWithWaiverCandidate,
} from './latest-clean-fe02-subject-accepted-with-waiver.mjs';
import { finalizeFe01RunLocalHarnessCapture } from './fe01-run-local-harness-capture.mjs';
import {
  FE01_SUBJECT_PHYSICAL_CANDIDATE,
  finalizeFe01SubjectWaiverPhysicalDisposition,
} from './fe01-subject-waiver-physical-disposition.mjs';
import {
  FE02_SUBJECT_PHYSICAL_CANDIDATE,
  finalizeFe02SubjectWaiverPhysicalDisposition,
} from './fe02-subject-waiver-physical-disposition.mjs';
import {
  FE01_PF01_AUTOMATIC_PASS_PATH,
  validateFe01Pf01AutomaticPass,
} from './fe01-pf01-automatic-pass.mjs';
import {
  FE01_PF01_SUBJECT_WAIVER_PATH,
  validateFe01Pf01SubjectWaiver,
} from './fe01-pf01-subject-waiver.mjs';
import { validateFe02Pf02SubjectWaiver } from './fe02-pf02-subject-waiver.mjs';
import { validateFe02Pf02StressSubjectWaiver } from './fe02-pf02-stress-subject-waiver.mjs';
import {
  automaticPassPf01BudgetState,
  createAbortSignalTracker,
  deriveStepRuntimeAdvisory,
  executeTicketStep,
  finalizeAutomaticPassValidation,
  finalizeFe02SubjectWaiverValidations,
  finalizeSubjectWaiverValidation,
  FE02_SUBJECT_WAIVER_STEP_IDS,
  hasExactAutomaticPassConfiguration,
  hasExactSubjectWaiverConfiguration,
  isAutomaticPassPerfStep,
  isSubjectWaiverPerfStep,
  planTicketExecutionSteps,
  signalExitCode,
  SUBJECT_WAIVER_EXECUTION_MODE,
  subjectWaiverPf01BudgetState,
  subjectWaiverPf02BudgetState,
  ticketManifestExitCode,
} from './verify-ticket-execution.mjs';
import { deriveFe01SubjectWaiverClosureStatus } from './fe01-subject-waiver-verdict.mjs';
import { deriveFe02SubjectWaiverClosureStatus } from './fe02-subject-waiver-verdict.mjs';
import { validateFe01SubjectClosureLineage } from './fe01-subject-lineage.mjs';
import { validateFe02SubjectClosureLineage } from './fe02-subject-lineage.mjs';
import {
  assertPf01L3ViteModuleClosure,
  assertPf01L3BuildEnvironment,
  assertPf01VerificationEnvironment,
  collectPf01L3HarnessBuildInputs,
} from './pf01-build-inputs.mjs';
import {
  collectPf01MeasurementInputs,
  readPf01L2ViteDevModuleGraph,
} from './pf01-measurement-inputs.mjs';
import {
  capturePf01RuntimeProvenance,
  collectCurrentPf01Attestation,
  pf01ComparisonProvenance,
  validateFrozenPf01Budget,
} from './pf01-budget.mjs';
import { collectReadPfManifestResults } from './verify-ticket-performance.mjs';

/** step 退出码 → 状态映射（ARC-06c §3.17）：0=pass，2=inconclusive，其余=fail */
function stepStatusOf(exitCode) {
  if (exitCode === 0) return 'pass';
  if (exitCode === 2) return 'inconclusive';
  return 'fail';
}

const STATUS_LABEL = {
  pass: 'PASS',
  inconclusive: 'INCONCLUSIVE',
  fail: 'FAIL',
};

async function budgetState(performance, l2DevModuleGraphPath) {
  let descriptor;
  let descriptorDigest;
  try {
    ({ descriptor, digest: descriptorDigest } = assertCurrentPfDescriptorDigest(
      path.join(REPO_ROOT, performance.descriptorPath),
    ));
  } catch (error) {
    return {
      label: 'budget-invalid（禁止作为 PF PASS 依据）',
      status: 'fail',
      validation: {
        valid: false,
        violations: [error instanceof Error ? error.message : 'descriptor digest 无法验证'],
      },
    };
  }
  const budgetPath = path.join(REPO_ROOT, performance.budgetPath);
  if (!fs.existsSync(budgetPath)) {
    return {
      label: performance.unfrozenLabel,
      status: 'inconclusive',
      validation: { valid: false, violations: ['预算文件不存在'] },
      descriptorDigest,
    };
  }
  try {
    const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
    await assertPf01L3ViteModuleClosure();
    const l2DevModuleGraph = readPf01L2ViteDevModuleGraph(l2DevModuleGraphPath);
    const runtimeProvenance = await capturePf01RuntimeProvenance();
    const currentAttestation = collectCurrentPf01Attestation({
      buildInputs: collectPf01L3HarnessBuildInputs(),
      measurementInputs: collectPf01MeasurementInputs({ l2DevModuleGraph }),
      runtimeProvenance,
    });
    const validation = validateFrozenPf01Budget(
      budget,
      descriptor,
      performance.profile ?? 'representative',
      currentAttestation,
    );
    return {
      label: validation.valid ? performance.frozenLabel : 'budget-invalid（禁止作为 PF PASS 依据）',
      status: validation.valid ? 'pass' : 'fail',
      validation,
      provenance: pf01ComparisonProvenance(budget, currentAttestation),
      descriptorDigest,
    };
  } catch (error) {
    return {
      label: 'budget-invalid（禁止作为 PF PASS 依据）',
      status: 'fail',
      validation: { valid: false, violations: [error instanceof Error ? error.message : '预算文件无法解析'] },
    };
  }
}

async function toolchainInfo() {
  const node = await capture('node', ['--version']);
  const npm = await capture('corepack', ['npm', '--version']);
  const rustc = await capture('rustc', ['--version']);
  const swvers = await capture('sw_vers', ['-productVersion']);
  const arch = await capture('uname', ['-m']);
  return {
    node: node.stdout.trim(),
    npm: npm.stdout.trim(),
    rustc: rustc.stdout.trim().split('\n')[0],
    os: `macOS ${swvers.stdout.trim()}`,
    arch: arch.stdout.trim(),
  };
}

async function main() {
  const ticketId = process.argv[2];
  const ticket = ticketConfig(ticketId);
  if (ticket === undefined) {
    console.error(
      `未知 ticket ID: ${ticketId ?? '(未提供)'}；已登记: ${Object.keys(TICKET_REGISTRY).join(', ')}`,
    );
    process.exit(1);
  }

  let verificationEnvironment;
  try {
    verificationEnvironment = {
      verification: assertPf01VerificationEnvironment(),
      build: assertPf01L3BuildEnvironment(),
    };
  } catch (error) {
    console.error(
      `INCONCLUSIVE  verify ambient environment 无法证明：${error instanceof Error ? error.message : 'unknown'}`,
    );
    process.exit(2);
  }

  const startAt = new Date().toISOString();
  const startingGit = await gitInfo();
  const subjectWaiverPathExact = hasExactSubjectWaiverConfiguration({ ticketId, ticket });
  // FE-02：两份 waiver（representative/stress）各自独立做 initial exact validation，
  // 按 stepId 分发；FE-01 保持单值。
  const initialFe02SubjectWaiverValidations =
    subjectWaiverPathExact && ticketId === 'FE-02'
      ? {
          'perf-pf02-representative': validateFe02Pf02SubjectWaiver({}),
          'perf-pf02-stress': validateFe02Pf02StressSubjectWaiver({}),
        }
      : undefined;
  const initialSubjectWaiverValidation =
    subjectWaiverPathExact && ticketId !== 'FE-02'
      ? validateFe01Pf01SubjectWaiver({ recordPath: FE01_PF01_SUBJECT_WAIVER_PATH })
      : undefined;
  const automaticPassPathExact = hasExactAutomaticPassConfiguration({ ticketId, ticket });
  const initialAutomaticPassValidation = automaticPassPathExact
    ? await validateFe01Pf01AutomaticPass({
        recordPath: FE01_PF01_AUTOMATIC_PASS_PATH,
      })
    : undefined;
  const executionSteps = planTicketExecutionSteps({
    ticketId,
    ticket,
    automaticPassValidation: initialAutomaticPassValidation,
    subjectWaiverValidation: initialSubjectWaiverValidation,
    subjectWaiverValidations: initialFe02SubjectWaiverValidations,
  });
  const runId = makeRunId();
  const evidenceRoot = path.join(ARTIFACTS_ROOT, 'verification', ticketId, runId);
  const performanceDir =
    ticket.performance === undefined && ticket.performances === undefined
      ? null
      : path.join(evidenceRoot, 'performance');
  if (performanceDir !== null) fs.mkdirSync(performanceDir, { recursive: true });
  console.log(`verify:ticket ${ticketId} run ${runId}`);
  console.log(`evidence: ${sanitizeText(evidenceRoot)}`);

  let evidenceContaminated = false;
  const contaminationNotes = [];
  /** 脱敏 + 扫描后写文本文件；命中记录 contamination */
  function writeEvidenceText(filePath, text) {
    const sanitized = sanitizeText(text);
    const scan = scanEvidenceText(sanitized);
    if (!scan.clean) {
      evidenceContaminated = true;
      contaminationNotes.push(
        `${path.relative(evidenceRoot, filePath)}: 占位敏感值 ${scan.secretHits} 处 / 个人路径 ${scan.personalPathHits} 处`,
      );
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, sanitized, 'utf8');
  }

  const stepResults = [];
  const abortTracker = createAbortSignalTracker();
  let aborted = null;
  for (const step of executionSteps) {
    // 信号可能在上一步结束后、下一步启动前到达：不再启动新步骤。
    if (abortTracker.received() !== null) {
      aborted = { signal: abortTracker.received(), stepId: null, at: new Date().toISOString() };
      console.error(
        `ABORTED  verify:ticket 收到 ${aborted.signal}，步骤 ${step.id} 不再启动；后续步骤不再执行`,
      );
      break;
    }
    console.log(`\n=== [${step.layer}] ${step.id}: ${step.cmd} ${step.args.join(' ')}`);
    const result = await executeTicketStep({
      step,
      runStepImpl: () =>
        runStep({
          cmd: step.cmd,
          args:
            step.evidenceOutput === undefined
              ? step.args
              : [...step.args, `--output-dir=${path.join(evidenceRoot, step.evidenceOutput.relativeDir)}`],
          timeoutMs: step.timeoutMs,
          env: {},
        }),
    });
    const runtimeAdvisory = deriveStepRuntimeAdvisory({ step, result });
    if (runtimeAdvisory !== undefined) {
      console.warn(
        `WARN  [${step.layer}] ${step.id} runtime ${runtimeAdvisory.durationMs}ms exceeded soft budget ${runtimeAdvisory.thresholdMs}ms (${runtimeAdvisory.classification}); non-blocking`,
      );
    }
    const stepDir = path.join(evidenceRoot, 'steps', step.id);
    writeEvidenceText(path.join(stepDir, 'stdout.log'), result.stdout);
    writeEvidenceText(path.join(stepDir, 'stderr.log'), result.stderr);
    const meta = {
      id: step.id,
      layer: step.layer,
      provenance: step.provenance,
      command: [step.cmd, ...step.args],
      exitCode: result.exitCode,
      status: stepStatusOf(result.exitCode),
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      ...(step.executionMode === undefined
        ? {}
        : {
            execution: {
              mode: step.executionMode,
              samplingRun: step.samplingRun,
              historicalRunId: step.historicalRunId,
              ...(step.initialAutomaticPassValidation === undefined
                ? {}
                : { initialAutomaticPassValidation: step.initialAutomaticPassValidation }),
              ...(step.initialWaiverValidation === undefined
                ? {}
                : { initialWaiverValidation: step.initialWaiverValidation }),
            },
          }),
    };
    writeJson(path.join(stepDir, 'meta.json'), meta);
    stepResults.push({
      ...meta,
      logs: {
        stdout: `steps/${step.id}/stdout.log`,
        stderr: `steps/${step.id}/stderr.log`,
        meta: `steps/${step.id}/meta.json`,
      },
    });
    console.log(
      `${STATUS_LABEL[meta.status]}  [${step.layer}] ${step.id}  exit ${result.exitCode} (${result.durationMs}ms)`,
    );
    // 父进程收到 SIGINT/SIGTERM（lib.mjs 的 runStep 已把信号转发给当前子进程）：
    // run 记为 aborted，终止后续步骤，不再把 manifest 写成 completed 语义。
    if (abortTracker.received() !== null) {
      aborted = { signal: abortTracker.received(), stepId: step.id, at: new Date().toISOString() };
      console.error(
        `ABORTED  verify:ticket 收到 ${aborted.signal}，终止于步骤 ${step.id}；后续步骤不再执行`,
      );
      break;
    }
  }

  const endAt = new Date().toISOString();

  const historicalAutomaticPassValidation = executionSteps.some(isAutomaticPassPerfStep);
  const historicalSubjectWaiverValidation = executionSteps.some(isSubjectWaiverPerfStep);
  const automaticPassCompletion = historicalAutomaticPassValidation
    ? await finalizeAutomaticPassValidation({
        initialAutomaticPassValidation,
        validateAutomaticPass: () =>
          validateFe01Pf01AutomaticPass({ recordPath: FE01_PF01_AUTOMATIC_PASS_PATH }),
      })
    : undefined;
  const subjectWaiverCompletion = historicalSubjectWaiverValidation
    ? ticketId === 'FE-02'
      ? await finalizeFe02SubjectWaiverValidations({
          initialSubjectWaiverValidations: initialFe02SubjectWaiverValidations,
          validateSubjectWaivers: {
            'perf-pf02-representative': () => validateFe02Pf02SubjectWaiver({}),
            'perf-pf02-stress': () => validateFe02Pf02StressSubjectWaiver({}),
          },
        })
      : await finalizeSubjectWaiverValidation({
          initialSubjectWaiverValidation,
          validateSubjectWaiver: () =>
            validateFe01Pf01SubjectWaiver({ recordPath: FE01_PF01_SUBJECT_WAIVER_PATH }),
        })
    : undefined;

  // PF-01 保持 historical singular scanner/manifest；read PF 使用递归 physical-file
  // scan + 每 profile 的脱敏 projection，禁止将嵌套目录、symlink 或 raw 内容跳过扫描。
  // 配置 subjectWaiverPath 的 entry 在 historical step 下从 final waiver validation 投影，
  // 不要求本次 run 的 evidence 目录。
  let readPerformanceEvidence;
  if (performanceDir !== null && fs.existsSync(performanceDir)) {
    if (ticket.performances !== undefined) {
      readPerformanceEvidence = collectReadPfManifestResults({
        performances: ticket.performances,
        stepResults,
        evidenceRoot,
        expectedCommit: startingGit.commit,
        subjectWaiverValidations:
          ticketId === 'FE-02'
            ? Object.fromEntries(
                FE02_SUBJECT_WAIVER_STEP_IDS.map((stepId) => [
                  stepId,
                  subjectWaiverCompletion?.perStep?.[stepId]?.finalSubjectWaiverValidation,
                ]),
              )
            : undefined,
      });
    } else {
      for (const file of fs.readdirSync(performanceDir)) {
        const full = path.join(performanceDir, file);
        const scan = scanEvidenceText(fs.readFileSync(full, 'utf8'));
        if (!scan.clean) {
          evidenceContaminated = true;
          contaminationNotes.push(`performance/${file}: 扫描命中`);
        }
      }
    }
  }
  const perfResult = stepResults.find((step) => step.id === 'perf');
  if (perfResult?.execution !== undefined && automaticPassCompletion !== undefined) {
    perfResult.execution.finalAutomaticPassValidation =
      automaticPassCompletion.finalAutomaticPassValidationStatus;
    perfResult.execution.bindingStable = automaticPassCompletion.bindingStable;
    const { logs: _logs, ...perfMeta } = perfResult;
    writeJson(path.join(evidenceRoot, 'steps', 'perf', 'meta.json'), perfMeta);
  }
  // historical subject-waiver step 按 execution mode 定位（FE-01 为 perf，FE-02 为
  // perf-pf02-representative 与 perf-pf02-stress），各自起止 binding 结果回写其 meta。
  for (const subjectWaiverStepResult of stepResults.filter(
    (step) => step.execution?.mode === SUBJECT_WAIVER_EXECUTION_MODE,
  )) {
    if (subjectWaiverCompletion === undefined) continue;
    const perStep = subjectWaiverCompletion.perStep?.[subjectWaiverStepResult.id];
    subjectWaiverStepResult.execution.finalWaiverValidation =
      ticketId === 'FE-02'
        ? perStep?.finalSubjectWaiverValidationStatus
        : subjectWaiverCompletion.finalSubjectWaiverValidationStatus;
    subjectWaiverStepResult.execution.bindingStable =
      ticketId === 'FE-02' ? perStep?.bindingStable : subjectWaiverCompletion.bindingStable;
    const { logs: _logs, ...perfMeta } = subjectWaiverStepResult;
    writeJson(path.join(evidenceRoot, 'steps', subjectWaiverStepResult.id, 'meta.json'), perfMeta);
  }
  const budget =
    ticket.performance === undefined
      ? ticketId === 'FE-02' && historicalSubjectWaiverValidation
        ? subjectWaiverPf02BudgetState({ subjectWaiverCompletions: subjectWaiverCompletion })
        : null
      : historicalSubjectWaiverValidation
        ? subjectWaiverPf01BudgetState({ subjectWaiverCompletion })
      : historicalAutomaticPassValidation
        ? automaticPassPf01BudgetState({ automaticPassCompletion })
        : await budgetState(ticket.performance, path.join(performanceDir, 'l2-dev-module-graph.json'));
  const git = await gitInfo();
  const gitIdentityConsistent = sameGitIdentity(startingGit, git);
  const subjectLineage = historicalSubjectWaiverValidation
    ? ticketId === 'FE-02'
      ? validateFe02SubjectClosureLineage({ finalCommit: git.commit })
      : validateFe01SubjectClosureLineage({ finalCommit: git.commit })
    : undefined;
  const computedOverallStatus =
    stepResults.some((step) => step.status === 'fail') || budget?.status === 'fail'
      ? 'fail'
      : evidenceContaminated ||
          readPerformanceEvidence?.incomplete === true ||
          stepResults.some((step) => step.status === 'inconclusive') ||
          budget?.status === 'inconclusive'
        ? 'inconclusive'
        : 'pass';
  const subjectWaiverVerdict = historicalSubjectWaiverValidation
    ? ticketId === 'FE-02'
      ? deriveFe02SubjectWaiverClosureStatus({
          ticketId,
          steps: stepResults,
          budgetStatus: budget?.status,
          evidenceContaminated,
          worktreeDirty: git.worktreeDirty,
          initialWaiverValidations: initialFe02SubjectWaiverValidations,
          finalWaiverValidations: Object.fromEntries(
            FE02_SUBJECT_WAIVER_STEP_IDS.map((stepId) => [
              stepId,
              subjectWaiverCompletion?.perStep?.[stepId]?.finalSubjectWaiverValidation,
            ]),
          ),
          subjectLineage,
        })
      : deriveFe01SubjectWaiverClosureStatus({
          ticketId,
          steps: stepResults,
          budgetStatus: budget?.status,
          evidenceContaminated,
          worktreeDirty: git.worktreeDirty,
          initialWaiverValidation: initialSubjectWaiverValidation,
          finalWaiverValidation: subjectWaiverCompletion?.finalSubjectWaiverValidation,
          subjectLineage,
        })
    : undefined;
  let overallStatus = gitIdentityConsistent
    ? subjectWaiverVerdict?.status ?? computedOverallStatus
    : 'inconclusive';

  const fe01HarnessCapture = finalizeFe01RunLocalHarnessCapture({
    ticketId,
    overallStatus,
    steps: stepResults,
    repoRoot: REPO_ROOT,
    evidenceRoot,
    artifact: ticket.artifact,
  });
  if (fe01HarnessCapture !== null) overallStatus = fe01HarnessCapture.status;
  // harness artifact identity（test:tauri 写入；production 标 N/A）
  const identityPath = path.join(REPO_ROOT, ticket.artifact.identityPath);
  const artifactIdentity =
    fe01HarnessCapture === null
      ? fs.existsSync(identityPath)
        ? {
            ...JSON.parse(fs.readFileSync(identityPath, 'utf8')),
            production: ticket.artifact.production,
          }
        : { ...ticket.artifact.fallback, production: ticket.artifact.production }
      : fe01HarnessCapture.artifactIdentity;

  let manifest = {
    schemaVersion: ticketId === 'FE-01' ? 2 : 1,
    runId,
    scope: ticket.scope,
    evidenceScope: ticket.evidenceScope,
    status: overallStatus,
    commit: git.commit,
    worktreeDirty: git.worktreeDirty,
    runIdentity: {
      startCommit: startingGit.commit,
      startWorktreeDirty: startingGit.worktreeDirty,
      endCommit: git.commit,
      endWorktreeDirty: git.worktreeDirty,
      consistent: gitIdentityConsistent,
    },
    verificationEnvironment,
    toolchain: await toolchainInfo(),
    fixtureDigests: Object.fromEntries(
      ticket.fixtures.map((fixture) => [
        fixture.id,
        digestDirectory(path.join(REPO_ROOT, fixture.root)),
      ]),
    ),
    steps: stepResults,
    artifactIdentity,
    ...(fe01HarnessCapture?.runLocalHarnessAttestation === undefined
      ? {}
      : { runLocalHarnessAttestation: fe01HarnessCapture.runLocalHarnessAttestation }),
    ...(fe01HarnessCapture === null || fe01HarnessCapture.capture.disposition === 'captured'
      ? {}
      : { runLocalHarnessCapture: fe01HarnessCapture?.capture }),
    ...(readPerformanceEvidence === undefined
      ? {}
      : {
          performanceResults: readPerformanceEvidence.performanceResults,
          performanceEvidence: {
            valid: !readPerformanceEvidence.incomplete,
            notes: readPerformanceEvidence.contaminationNotes,
          },
        }),
    startAt,
    endAt,
    completedAt: aborted === null ? endAt : null,
    ...(aborted === null ? {} : { aborted }),
  };
  if (ticket.performance !== undefined) {
    manifest.budgetState = budget?.label;
    manifest.budgetValidation = budget?.validation;
    manifest.pf01Provenance = budget?.provenance;
    manifest.pfDescriptorDigest = budget?.descriptorDigest;
  }
  if (historicalAutomaticPassValidation && automaticPassCompletion !== undefined) {
    manifest.automaticPassValidation = {
      initial: initialAutomaticPassValidation?.valid === true ? 'valid' : 'invalid',
      final: automaticPassCompletion.finalAutomaticPassValidationStatus,
      bindingStable: automaticPassCompletion.bindingStable,
      ...(automaticPassCompletion.finalAutomaticPassValidation?.recordPath === undefined
        ? {}
        : {
            recordPath: automaticPassCompletion.finalAutomaticPassValidation.recordPath,
            recordSha256: automaticPassCompletion.finalAutomaticPassValidation.recordSha256,
          }),
      ...(automaticPassCompletion.finalAutomaticPassValidation?.violations === undefined
        ? {}
        : { violations: automaticPassCompletion.finalAutomaticPassValidation.violations }),
    };
  }
  if (historicalSubjectWaiverValidation && subjectWaiverCompletion !== undefined) {
    manifest.subjectLineage = subjectLineage;
    if (ticketId === 'FE-02') {
      // FE-02 两份 waiver：保留聚合字段，并以按 stepId 有序的 waivers 数组承载各自事实。
      const waiverEntries = FE02_SUBJECT_WAIVER_STEP_IDS.map((stepId) => {
        const perStep = subjectWaiverCompletion.perStep?.[stepId];
        const finalValidation = perStep?.finalSubjectWaiverValidation;
        return {
          stepId,
          initialWaiverValidation:
            initialFe02SubjectWaiverValidations?.[stepId]?.valid === true ? 'valid' : 'invalid',
          finalWaiverValidation: perStep?.finalSubjectWaiverValidationStatus ?? 'invalid',
          bindingStable: perStep?.bindingStable === true,
          ...(finalValidation?.waiverPath === undefined
            ? {}
            : {
                waiverPath: finalValidation.waiverPath,
                waiverSha256: finalValidation.waiverSha256,
              }),
        };
      });
      manifest.manualDisposition = {
        status: 'accepted-with-waiver',
        waiverValidation: waiverEntries.every(
          (entry) => entry.initialWaiverValidation === 'valid',
        )
          ? 'valid'
          : 'invalid',
        initialWaiverValidation: waiverEntries.every(
          (entry) => entry.initialWaiverValidation === 'valid',
        )
          ? 'valid'
          : 'invalid',
        finalWaiverValidation: waiverEntries.every(
          (entry) => entry.finalWaiverValidation === 'valid',
        )
          ? 'valid'
          : 'invalid',
        bindingStable: waiverEntries.every((entry) => entry.bindingStable),
        waivers: waiverEntries,
        source:
          '用户授权的 exact FE-02 subject PF-02 representative+stress disposition；immutable subject artifact raw samples 与 frozen budget 重算，非本次 perf sampling。',
      };
      manifest.pfAutomaticResult = budget?.automaticResults;
      manifest.performanceDebt = budget?.performanceDebts;
    } else {
      manifest.manualDisposition = {
        status: 'accepted-with-waiver',
        waiverValidation: initialSubjectWaiverValidation?.valid === true ? 'valid' : 'invalid',
        initialWaiverValidation: initialSubjectWaiverValidation?.valid === true ? 'valid' : 'invalid',
        finalWaiverValidation: subjectWaiverCompletion.finalSubjectWaiverValidationStatus,
        bindingStable: subjectWaiverCompletion.bindingStable,
        ...(subjectWaiverCompletion.finalSubjectWaiverValidation?.waiverPath === undefined
          ? {}
          : {
              waiverPath: subjectWaiverCompletion.finalSubjectWaiverValidation.waiverPath,
              waiverSha256: subjectWaiverCompletion.finalSubjectWaiverValidation.waiverSha256,
            }),
        source:
          '用户授权的 exact FE-01 subject PF-01 disposition；immutable subject artifact raw samples 与 frozen budget 重算，非本次 perf sampling。',
      };
      manifest.pfAutomaticResult = budget?.automaticResult;
      manifest.performanceDebt = budget?.performanceDebt;
    }
    if (overallStatus === 'accepted-with-waiver') {
      manifest.physicalValidation =
        ticketId === 'FE-02' ? FE02_SUBJECT_PHYSICAL_CANDIDATE : FE01_SUBJECT_PHYSICAL_CANDIDATE;
    }
  }
  if (
    historicalAutomaticPassValidation &&
    automaticPassCompletion?.finalAutomaticPassValidationStatus === 'valid' &&
    automaticPassCompletion.bindingStable === true
  ) {
    manifest.pfAutomaticResult = {
      status: 'pass',
      exitCode: 0,
      runId: automaticPassCompletion.finalAutomaticPassValidation.comparison.runId,
      run: automaticPassCompletion.finalAutomaticPassValidation.comparison.run,
      commit: automaticPassCompletion.finalAutomaticPassValidation.comparison.commit,
      worktreeDirty: false,
      automatedExitCode: 0,
      automatedExitCodeSource:
        'immutable automatic-pass comparison plus current-HEAD exact input binding; no current perf sampling was started',
    };
  }
  if (ticket.uncoveredBoundaries !== undefined) {
    manifest.uncoveredBoundaries = ticket.uncoveredBoundaries;
  }
  if (evidenceContaminated) {
    manifest.contamination = {
      note: 'evidence 扫描命中占位敏感值或个人路径，状态记为 inconclusive',
      hits: contaminationNotes,
    };
  }
  writeJson(path.join(evidenceRoot, 'manifest.json'), manifest);
  if (ticket.manifestAssertions?.runIdMatchesEvidenceDirectory === true) {
    const generatedManifest = JSON.parse(
      fs.readFileSync(path.join(evidenceRoot, 'manifest.json'), 'utf8'),
    );
    if (generatedManifest.runId !== path.basename(evidenceRoot)) {
      throw new Error('generated manifest runId does not match evidence directory');
    }
  }
  let exactSubjectWaiver = subjectWaiverVerdict?.status === 'accepted-with-waiver';
  if (manifest.status === 'accepted-with-waiver') {
    const eligibility =
      ticketId === 'FE-02'
        ? validateFe02SubjectAcceptedWithWaiverCandidate({
            root: REPO_ROOT,
            evidenceRoot,
            ticketId,
            manifest,
          })
        : validateFe01SubjectAcceptedWithWaiverCandidate({
            root: REPO_ROOT,
            evidenceRoot,
            ticketId,
            manifest,
          });
    const disposition = (
      ticketId === 'FE-02'
        ? finalizeFe02SubjectWaiverPhysicalDisposition
        : finalizeFe01SubjectWaiverPhysicalDisposition
    )({ manifest, eligibility });
    manifest = disposition.manifest;
    exactSubjectWaiver = disposition.exactSubjectWaiver;
    writeJson(path.join(evidenceRoot, 'manifest.json'), manifest);
    if (exactSubjectWaiver) {
      const acceptedIndex =
        ticketId === 'FE-02'
          ? await maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
              root: REPO_ROOT,
              evidenceRoot,
              ticketId,
              manifest,
            })
          : await maybeWriteLatestCleanSubjectAcceptedWithWaiver({
              root: REPO_ROOT,
              evidenceRoot,
              ticketId,
              manifest,
            });
      if (!acceptedIndex.eligible || !acceptedIndex.validated) {
        const rejected = (
          ticketId === 'FE-02'
            ? finalizeFe02SubjectWaiverPhysicalDisposition
            : finalizeFe01SubjectWaiverPhysicalDisposition
        )({
          manifest,
          eligibility: acceptedIndex,
        });
        manifest = rejected.manifest;
        exactSubjectWaiver = false;
        writeJson(path.join(evidenceRoot, 'manifest.json'), manifest);
      } else if (acceptedIndex.updated) {
        console.log(`latest clean subject accepted-with-waiver: ${acceptedIndex.indexPath}`);
      } else {
        console.log(`latest clean subject accepted-with-waiver: ${acceptedIndex.reason}`);
      }
    }
  } else if (manifest.status === 'pass') {
    const cleanPassIndex = await maybeWriteLatestCleanPass({
      root: REPO_ROOT,
      evidenceRoot,
      ticketId,
      manifest,
    });
    if (cleanPassIndex.updated) {
      console.log(`latest clean pass: ${cleanPassIndex.indexPath}`);
    }
  }

  console.log(`\nverify:ticket ${ticketId}: ${manifest.status}`);
  console.log(`manifest: ${sanitizeText(path.join(evidenceRoot, 'manifest.json'))}`);
  // aborted run 以信号语义退出（128 + signo），不伪装成正常 completed exit。
  if (aborted !== null) {
    process.exit(signalExitCode(aborted.signal));
  }
  // closure accepted-with-waiver=0；manifest 与 PF step 仍分别保留 waiver/fail-1 事实。
  process.exit(
    ticketManifestExitCode(manifest.status, {
      ticketId,
      exactSubjectWaiver,
    }),
  );
}

await main();
