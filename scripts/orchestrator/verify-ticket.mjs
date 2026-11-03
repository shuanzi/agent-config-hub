/* global process, console */
/**
 * verify:ticket（票据关闭入口，ARC-06c §3.17）。
 *
 * 封闭 registry：FE-01 = toolchain(L0) + static(L0) + rust(L1) + frontend(L1)
 *   + ui(L2) + tauri(L3)。旧性能采样已退役；性能能力未建立。未知 ticket id 退出 1。
 * 顺序执行；前序失败仍跑完后续独立步骤，但总体 fail。
 *
 * 状态模型：step 退出码映射 0=pass / 2=inconclusive / 其余=fail；
 * 整体 status 有 fail→fail，否则有 inconclusive→inconclusive，否则 pass；
 * 进程退出码 pass=0、inconclusive=2、fail=1。manifest 每 step 记录 status。
 *
 * evidence：.artifacts/verification/<scope>/<run-id>/
 *   manifest.json
 *   steps/<step-id>/{stdout.log,stderr.log,meta.json}
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
  runStep,
  sanitizeText,
  scanEvidenceText,
  writeJson,
} from './lib.mjs';

const PROVENANCE = {
  L0: '本地静态/工具链门禁；不产生行为 credit',
  L1: 'Vitest node-mode / cargo test；无浏览器、无 IPC',
  L2: 'mock renderer 旅程（scripted mock gateway + headless Chrome）；不取得真实 IPC/事件/磁盘 credit',
  L3: 'test harness 隔离构建（debug profile、独立 identifier、隔离临时 fixture 根）；不等同生产签名/DMG/L4',
};

/** step 退出码 → 状态映射（ARC-06c §3.17）：0=pass，2=inconclusive，其余=fail */
function stepStatusOf(exitCode) {
  if (exitCode === 0) return 'pass';
  if (exitCode === 2) return 'inconclusive';
  return 'fail';
}

const STATUS_LABEL = { pass: 'PASS', inconclusive: 'INCONCLUSIVE', fail: 'FAIL' };

/** 封闭票据层级 registry；ticket 不能在自身实现中静默减少层级 */
const TICKET_REGISTRY = {
  'FE-01': [
    {
      id: 'toolchain',
      layer: 'L0',
      cmd: 'node',
      args: ['scripts/orchestrator/verify-toolchain.mjs'],
      timeoutMs: 300_000,
    },
    {
      id: 'static',
      layer: 'L0',
      cmd: 'node',
      args: ['scripts/orchestrator/verify-static.mjs'],
      timeoutMs: 1_800_000,
    },
    {
      id: 'rust',
      layer: 'L1',
      cmd: 'node',
      args: ['scripts/orchestrator/test-rust.mjs'],
      timeoutMs: 1_800_000,
    },
    {
      id: 'frontend',
      layer: 'L1',
      cmd: 'corepack',
      args: ['npm', 'run', 'test:frontend'],
      timeoutMs: 600_000,
    },
    {
      id: 'ui',
      layer: 'L2',
      cmd: 'corepack',
      args: ['npm', 'run', 'test:ui'],
      timeoutMs: 900_000,
    },
    {
      id: 'tauri',
      layer: 'L3',
      cmd: 'node',
      args: ['scripts/orchestrator/test-tauri.mjs'],
      timeoutMs: 2_400_000,
    },
  ],
};

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
  const registry = TICKET_REGISTRY[ticketId];
  if (registry === undefined) {
    console.error(
      `未知 ticket ID: ${ticketId ?? '(未提供)'}；已登记: ${Object.keys(TICKET_REGISTRY).join(', ')}`,
    );
    process.exit(1);
  }

  const startAt = new Date().toISOString();
  const runId = makeRunId();
  const evidenceRoot = path.join(ARTIFACTS_ROOT, 'verification', ticketId, runId);
  fs.mkdirSync(evidenceRoot, { recursive: true });
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
  for (const step of registry) {
    console.log(`\n=== [${step.layer}] ${step.id}: ${step.cmd} ${step.args.join(' ')}`);
    const result = await runStep({
      cmd: step.cmd,
      args: step.args,
      timeoutMs: step.timeoutMs,
    });
    const stepDir = path.join(evidenceRoot, 'steps', step.id);
    writeEvidenceText(path.join(stepDir, 'stdout.log'), result.stdout);
    writeEvidenceText(path.join(stepDir, 'stderr.log'), result.stderr);
    const meta = {
      id: step.id,
      layer: step.layer,
      provenance: PROVENANCE[step.layer],
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

  // 整体 status：有 fail → fail；否则有 inconclusive（含 evidence 污染）→
  // inconclusive；否则 pass。未知退出码已由 stepStatusOf 归为 fail。
  const anyFailed = stepResults.some((step) => step.status === 'fail');
  const anyInconclusive =
    evidenceContaminated || stepResults.some((step) => step.status === 'inconclusive');
  const overallStatus = anyFailed ? 'fail' : anyInconclusive ? 'inconclusive' : 'pass';

  // harness artifact identity（test:tauri 写入；production 标 N/A）
  const identityPath = path.join(ARTIFACTS_ROOT, 'test-harness/identity.json');
  const artifactIdentity = fs.existsSync(identityPath)
    ? {
        ...JSON.parse(fs.readFileSync(identityPath, 'utf8')),
        production: 'N/A（FE-01 不产出生产 artifact）',
      }
    : {
        kind: 'test-harness',
        identifier: 'unknown',
        profile: 'unknown',
        production: 'N/A（FE-01 不产出生产 artifact）',
      };

  const git = await gitInfo();
  const manifest = {
    schemaVersion: 1,
    scope: ticketId,
    status: overallStatus,
    budgetState: 'not-established',
    commit: git.commit,
    worktreeDirty: git.worktreeDirty,
    toolchain: await toolchainInfo(),
    fixtureDigests: digestDirectory(path.join(REPO_ROOT, 'fixtures/fx-01')),
    pfDescriptorDigest: null,
    steps: stepResults,
    artifactIdentity,
    startAt,
    endAt,
  };
  if (evidenceContaminated) {
    manifest.contamination = {
      note: 'evidence 扫描命中占位敏感值或个人路径，状态记为 inconclusive',
      hits: contaminationNotes,
    };
  }
  writeJson(path.join(evidenceRoot, 'manifest.json'), manifest);

  console.log(`\nverify:ticket ${ticketId}: ${manifest.status}`);
  console.log(`manifest: ${sanitizeText(path.join(evidenceRoot, 'manifest.json'))}`);
  // 退出码：pass=0，inconclusive=2，fail=1
  process.exit(manifest.status === 'pass' ? 0 : manifest.status === 'inconclusive' ? 2 : 1);
}

await main();
