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
 * registry 默认执行新的 automatic sampling。仅未来 FE-01 registry 的精确 automatic-pass
 * record 经 immutable comparison 与 current-HEAD input validator 成功后，才将 perf 改为
 * 不采样的 historical validation；historical waiver 永不进入 ticket closure。
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
  FE01_PF01_AUTOMATIC_PASS_PATH,
  validateFe01Pf01AutomaticPass,
} from './fe01-pf01-automatic-pass.mjs';
import {
  automaticPassPf01BudgetState,
  executeTicketStep,
  finalizeAutomaticPassValidation,
  hasExactAutomaticPassConfiguration,
  isAutomaticPassPerfStep,
  planTicketExecutionSteps,
} from './verify-ticket-execution.mjs';
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
  });
  const runId = makeRunId();
  const evidenceRoot = path.join(ARTIFACTS_ROOT, 'verification', ticketId, runId);
  const performanceDir =
    ticket.performance === undefined ? null : path.join(evidenceRoot, 'performance');
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
  for (const step of executionSteps) {
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
              initialAutomaticPassValidation: step.initialAutomaticPassValidation,
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
  }

  const endAt = new Date().toISOString();

  // performance evidence 扫描（perf.mjs 已自行扫描其 summary/budgets；此处兜底）
  if (performanceDir !== null && fs.existsSync(performanceDir)) {
    for (const file of fs.readdirSync(performanceDir)) {
      const full = path.join(performanceDir, file);
      const scan = scanEvidenceText(fs.readFileSync(full, 'utf8'));
      if (!scan.clean) {
        evidenceContaminated = true;
        contaminationNotes.push(`performance/${file}: 扫描命中`);
      }
    }
  }

  const historicalAutomaticPassValidation = executionSteps.some(isAutomaticPassPerfStep);
  const automaticPassCompletion = historicalAutomaticPassValidation
    ? await finalizeAutomaticPassValidation({
        initialAutomaticPassValidation,
        validateAutomaticPass: () =>
          validateFe01Pf01AutomaticPass({ recordPath: FE01_PF01_AUTOMATIC_PASS_PATH }),
      })
    : undefined;
  const perfResult = stepResults.find((step) => step.id === 'perf');
  if (perfResult?.execution !== undefined && automaticPassCompletion !== undefined) {
    perfResult.execution.finalAutomaticPassValidation =
      automaticPassCompletion.finalAutomaticPassValidationStatus;
    perfResult.execution.bindingStable = automaticPassCompletion.bindingStable;
    const { logs: _logs, ...perfMeta } = perfResult;
    writeJson(path.join(evidenceRoot, 'steps', 'perf', 'meta.json'), perfMeta);
  }
  const budget =
    ticket.performance === undefined
      ? null
      : historicalAutomaticPassValidation
        ? automaticPassPf01BudgetState({ automaticPassCompletion })
        : await budgetState(ticket.performance, path.join(performanceDir, 'l2-dev-module-graph.json'));
  const git = await gitInfo();
  const gitIdentityConsistent = sameGitIdentity(startingGit, git);
  const computedOverallStatus =
    stepResults.some((step) => step.status === 'fail') || budget?.status === 'fail'
      ? 'fail'
      : evidenceContaminated ||
          stepResults.some((step) => step.status === 'inconclusive') ||
          budget?.status === 'inconclusive'
        ? 'inconclusive'
        : 'pass';
  const overallStatus = gitIdentityConsistent ? computedOverallStatus : 'inconclusive';

  // harness artifact identity（test:tauri 写入；production 标 N/A）
  const identityPath = path.join(REPO_ROOT, ticket.artifact.identityPath);
  const artifactIdentity = fs.existsSync(identityPath)
    ? {
        ...JSON.parse(fs.readFileSync(identityPath, 'utf8')),
        production: ticket.artifact.production,
      }
    : { ...ticket.artifact.fallback, production: ticket.artifact.production };

  const manifest = {
    schemaVersion: 1,
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
    startAt,
    endAt,
    completedAt: endAt,
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
  if (manifest.status === 'pass') {
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
  // 退出码：pass=0，inconclusive=2，fail=1
  process.exit(manifest.status === 'pass' ? 0 : manifest.status === 'inconclusive' ? 2 : 1);
}

await main();
