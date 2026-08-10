/* global process, console */
/**
 * verify:ticket（票据关闭入口，ARC-06c §3.17）。
 *
 * 封闭 registry 的每个 ticket 自带步骤、fixture、可选 PF 与 artifact 配置；
 * 未知 ticket id 退出 1。
 * 顺序执行；前序失败仍跑完后续独立步骤，但总体 fail。
 *
 * 状态模型：step 退出码映射 0=pass / 2=inconclusive / 其余=fail；
 * 整体 status 有 fail→fail，否则有 inconclusive→inconclusive，否则 pass；
 * 进程退出码 pass=0、inconclusive=2、fail=1。manifest 每 step 记录 status。
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

/** step 退出码 → 状态映射（ARC-06c §3.17）：0=pass，2=inconclusive，其余=fail */
function stepStatusOf(exitCode) {
  if (exitCode === 0) return 'pass';
  if (exitCode === 2) return 'inconclusive';
  return 'fail';
}

const STATUS_LABEL = { pass: 'PASS', inconclusive: 'INCONCLUSIVE', fail: 'FAIL' };

function budgetState(performance) {
  return fs.existsSync(path.join(REPO_ROOT, performance.budgetPath))
    ? performance.frozenLabel
    : performance.unfrozenLabel;
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
    const result = await runStep({
      cmd: step.cmd,
      args: step.args,
      timeoutMs: step.timeoutMs,
      env:
        step.evidenceOutput === undefined
          ? {}
          : {
              [step.evidenceOutput.env]: path.join(evidenceRoot, step.evidenceOutput.relativeDir),
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

  // 整体 status：有 fail → fail；否则有 inconclusive（含 evidence 污染）→
  // inconclusive；否则 pass。未知退出码已由 stepStatusOf 归为 fail。
  const anyFailed = stepResults.some((step) => step.status === 'fail');
  const anyInconclusive =
    evidenceContaminated || stepResults.some((step) => step.status === 'inconclusive');
  const overallStatus = anyFailed ? 'fail' : anyInconclusive ? 'inconclusive' : 'pass';

  // harness artifact identity（test:tauri 写入；production 标 N/A）
  const identityPath = path.join(REPO_ROOT, ticket.artifact.identityPath);
  const artifactIdentity = fs.existsSync(identityPath)
    ? {
        ...JSON.parse(fs.readFileSync(identityPath, 'utf8')),
        production: ticket.artifact.production,
      }
    : { ...ticket.artifact.fallback, production: ticket.artifact.production };

  const git = await gitInfo();
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
  };
  if (ticket.performance !== undefined) {
    manifest.budgetState = budgetState(ticket.performance);
    manifest.pfDescriptorDigest = pfDescriptorDigest(
      path.join(REPO_ROOT, ticket.performance.descriptorPath),
    );
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

  console.log(`\nverify:ticket ${ticketId}: ${manifest.status}`);
  console.log(`manifest: ${sanitizeText(path.join(evidenceRoot, 'manifest.json'))}`);
  // 退出码：pass=0，inconclusive=2，fail=1
  process.exit(manifest.status === 'pass' ? 0 : manifest.status === 'inconclusive' ? 2 : 1);
}

await main();
