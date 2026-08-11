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
 * FE-01 仅可由已验证的版本化 PF-01 waiver 产生 accepted-with-waiver（exit 0）；
 * manifest 会同时保留 automated fail/exit 1 与独立 manual disposition。
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
  capture,
  digestDirectory,
  gitInfo,
  makeRunId,
  pfDescriptorDigest,
  runStep,
  sanitizeText,
  scanEvidenceText,
  writeJson,
} from './lib.mjs';
import { TICKET_REGISTRY, ticketConfig } from './ticket-registry.mjs';
import { maybeWriteLatestCleanPass } from './latest-clean-pass.mjs';
import { maybeWriteLatestCleanAcceptedWithWaiver } from './latest-clean-accepted-with-waiver.mjs';
import {
  historicalPf01StepMetadata,
  validateFe01Pf01Waiver,
  FE01_PF01_WAIVER_PATH,
} from './fe01-pf01-waiver.mjs';
import { deriveTicketClosureStatus } from './fe01-ticket-waiver-verdict.mjs';
import {
  assertPf01L3ViteModuleClosure,
  collectPf01L3HarnessBuildInputs,
} from './pf01-build-inputs.mjs';
import {
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
  'accepted-with-waiver': 'ACCEPTED-WITH-WAIVER',
};

async function budgetState(performance) {
  const budgetPath = path.join(REPO_ROOT, performance.budgetPath);
  if (!fs.existsSync(budgetPath)) {
    return {
      label: performance.unfrozenLabel,
      status: 'inconclusive',
      validation: { valid: false, violations: ['预算文件不存在'] },
    };
  }
  try {
    const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
    const descriptor = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, performance.descriptorPath), 'utf8'),
    );
    await assertPf01L3ViteModuleClosure();
    const currentAttestation = collectCurrentPf01Attestation({
      buildInputs: collectPf01L3HarnessBuildInputs(),
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

  const startAt = new Date().toISOString();
  const runId = makeRunId();
  const evidenceRoot = path.join(ARTIFACTS_ROOT, 'verification', ticketId, runId);
  const performanceDir =
    ticket.performance === undefined ? null : path.join(evidenceRoot, 'performance');
  if (performanceDir !== null) fs.mkdirSync(performanceDir, { recursive: true });
  console.log(`verify:ticket ${ticketId} run ${runId}`);
  console.log(`evidence: ${sanitizeText(evidenceRoot)}`);

  let evidenceContaminated = false;
  const contaminationNotes = [];
  const initialWaiverValidation =
    ticketId === 'FE-01' && ticket.performance?.waiverPath === FE01_PF01_WAIVER_PATH
      ? validateFe01Pf01Waiver()
      : null;

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
  for (const step of ticket.steps) {
    console.log(`\n=== [${step.layer}] ${step.id}: ${step.cmd} ${step.args.join(' ')}`);
    const historicalWaiverStep = step.id === 'perf' && initialWaiverValidation !== null;
    const result = historicalWaiverStep
      ? {
          exitCode: 1,
          durationMs: 0,
          timedOut: false,
          stdout: initialWaiverValidation.valid
            ? 'PF-01 automatic result is validated from the immutable historical artifact; no confirmation perf sampling was run.\n'
            : `PF-01 historical waiver validation failed: ${initialWaiverValidation.violations.join('; ')}\n`,
          stderr: '',
        }
      : await runStep({
          cmd: step.cmd,
          args: step.args,
          timeoutMs: step.timeoutMs,
          env:
            step.evidenceOutput === undefined
              ? {}
              : {
                  [step.evidenceOutput.env]: path.join(
                    evidenceRoot,
                    step.evidenceOutput.relativeDir,
                  ),
                },
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
      ...(historicalWaiverStep
        ? {
            automatedResultSource:
              'authorized manual disposition + reproducible raw-samples/frozen-budget comparison; no PF sampling in this verification run',
            ...historicalPf01StepMetadata(initialWaiverValidation),
          }
        : {}),
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

  // 长步骤结束后必须重新读取 immutable waiver/artifact：起始校验只用于决定不采样，
  // 最终 disposition、manifest 与 index 一律以此处结果为准。
  const waiverValidation =
    initialWaiverValidation === null ? null : validateFe01Pf01Waiver();
  const historicalPerf = stepResults.find((step) => step.id === 'perf');
  if (historicalPerf !== undefined && waiverValidation !== null) {
    historicalPerf.finalWaiverValidation = waiverValidation.valid ? 'valid' : 'invalid';
    const finalMeta = Object.fromEntries(
      Object.entries(historicalPerf).filter(([key]) => key !== 'logs'),
    );
    writeJson(path.join(evidenceRoot, 'steps', 'perf', 'meta.json'), finalMeta);
  }
  const budget = ticket.performance === undefined ? null : await budgetState(ticket.performance);
  const git = await gitInfo();
  const overallStatus =
    waiverValidation === null
      ? stepResults.some((step) => step.status === 'fail') || budget?.status === 'fail'
        ? 'fail'
        : evidenceContaminated ||
            stepResults.some((step) => step.status === 'inconclusive') ||
            budget?.status === 'inconclusive'
          ? 'inconclusive'
          : 'pass'
      : deriveTicketClosureStatus({
          ticketId,
          steps: stepResults,
          budgetStatus: budget?.status,
          evidenceContaminated,
          worktreeDirty: git.worktreeDirty,
          waiverValidation,
        }).status;

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
    manifest.pfDescriptorDigest = pfDescriptorDigest(
      path.join(REPO_ROOT, ticket.performance.descriptorPath),
    );
  }
  if (waiverValidation !== null) {
    manifest.pfAutomaticResult = waiverValidation.automaticResult ?? {
      status: 'fail',
      exitCode: 1,
      source: 'historical PF result could not be validated',
    };
    manifest.manualDisposition = {
      status: waiverValidation.valid ? 'accepted-with-waiver' : 'not-accepted',
      waiverValidation: waiverValidation.valid ? 'valid' : 'invalid',
      waiverPath: FE01_PF01_WAIVER_PATH,
      waiverSha256: waiverValidation.waiverSha256,
      source:
        '用户授权的 exact FE-01 PF-01 disposition；automated fail/exit 1 由 immutable artifact 的 raw samples 与 frozen budget 重算，非本次 perf sampling。',
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
  if (manifest.status === 'accepted-with-waiver') {
    const acceptedWaiverIndex = await maybeWriteLatestCleanAcceptedWithWaiver({
      root: REPO_ROOT,
      evidenceRoot,
      ticketId,
      manifest,
    });
    if (acceptedWaiverIndex.updated) {
      console.log(`latest clean accepted with waiver: ${acceptedWaiverIndex.indexPath}`);
    }
  }

  console.log(`\nverify:ticket ${ticketId}: ${manifest.status}`);
  console.log(`manifest: ${sanitizeText(path.join(evidenceRoot, 'manifest.json'))}`);
  // 退出码：pass/accepted-with-waiver=0，inconclusive=2，fail=1
  process.exit(
    manifest.status === 'pass' || manifest.status === 'accepted-with-waiver'
      ? 0
      : manifest.status === 'inconclusive'
        ? 2
        : 1,
  );
}

await main();
