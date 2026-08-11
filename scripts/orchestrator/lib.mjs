/* global process, performance, setTimeout, clearTimeout */
/**
 * orchestrator 共享库（ARC-06c 命令契约 §3.17）。
 *
 * 约定：
 * - 所有子进程一律 spawn(cmd, argsArray, { shell: false })，不拼接 shell 字符串；
 * - child env PATH 前缀固定为 node v24.18.0 + cargo bin（确定性、可复现）；
 * - 支持超时（SIGTERM → 5s 后 SIGKILL，exitCode 记 124）与 SIGINT/SIGTERM 信号转发；
 * - 写入 evidence 的文本先脱敏（$HOME → <HOME>），再由 scanEvidenceText 扫描
 *   合成占位敏感值与残留个人路径；扫描命中由调用方记为 inconclusive；
 * - 本库不写 source/lockfile/budget/baseline，只写 .artifacts 与临时目录。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC_TAURI = path.join(REPO_ROOT, 'src-tauri');
export const ARTIFACTS_ROOT = path.join(REPO_ROOT, '.artifacts');

const NODE_BIN = path.join(os.homedir(), '.nvm/versions/node/v24.18.0/bin');
const CARGO_BIN = path.join(os.homedir(), '.cargo/bin');

/** 合成占位敏感值模式（与 fixtures/sensitive-masking.ts 同一模式） */
export const SYNTHETIC_SECRET_PATTERN = /SYNTHETIC-SECRET-[A-Za-z0-9][A-Za-z0-9-]*/g;

/** orchestrator 子进程环境：PATH 前缀固定，不使用 shell */
export function orchestratorEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  env.PATH = `${NODE_BIN}:${CARGO_BIN}:${env.PATH ?? ''}`;
  return env;
}

/** Git identity/object/status 读取不得继承任何可重定向 repository 解析的 ambient。 */
export function assertNoGitAmbient(env = process.env) {
  // `GIT_PAGER` 只影响人类输出呈现（CI/本地 runner 常设置为 cat），不参与 repo、
  // index、object、config 或 ref 解析。其余未知 `GIT_*` 一律按可影响解析处理。
  const keys = Object.keys(env).filter((key) => key.startsWith('GIT_') && key !== 'GIT_PAGER');
  if (keys.length > 0) {
    throw new Error(`Git ambient environment override rejected: ${keys.sort().join(', ')}`);
  }
  return { policy: 'no ambient Git repository/index/object/config/ref overrides', overrides: [] };
}

function declaredPackageRoots(repoRoot) {
  const packagePath = path.join(repoRoot, 'package.json');
  const stats = fs.lstatSync(packagePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('PF-01 Vite package manifest must be a physical regular file');
  }
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const roots = new Set();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const dependencies = manifest?.[field];
    if (dependencies === undefined) continue;
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new Error(`PF-01 Vite package manifest ${field} must be an object`);
    }
    for (const name of Object.keys(dependencies)) roots.add(name);
  }
  return roots;
}

function packageRoot(moduleId) {
  if (moduleId.startsWith('@')) {
    const [scope, name] = moduleId.split('/');
    return scope !== undefined && name !== undefined && name.length > 0 ? `${scope}/${name}` : null;
  }
  const [name] = moduleId.split('/');
  return name?.length > 0 ? name : null;
}

/** Vite IDs are external only when virtual/builtin or explicitly declared by this package manifest. */
export function classifyPf01ViteModuleId(moduleId, { repoRoot = REPO_ROOT } = {}) {
  if (typeof moduleId !== 'string') return { kind: 'ignored' };
  const canonical = moduleId.split('?')[0];
  if (
    canonical.startsWith('\0') ||
    canonical.startsWith('/@id/') ||
    canonical.startsWith('virtual:') ||
    canonical.startsWith('node:')
  ) {
    return { kind: 'external' };
  }
  if (canonical.startsWith('/') || canonical.startsWith('.')) return { kind: 'candidate', value: canonical };
  if (/\.(?:[cm]?[jt]sx?|json|html?|css|scss|sass|less|svg|md)$/i.test(canonical)) {
    return { kind: 'candidate', value: canonical };
  }
  const root = packageRoot(canonical);
  if (root !== null && declaredPackageRoots(repoRoot).has(root)) return { kind: 'external' };
  return { kind: 'candidate', value: canonical };
}

/** evidence 脱敏：家目录绝对路径替换为 <HOME> */
export function sanitizeText(text) {
  const home = os.homedir();
  return text.split(home).join('<HOME>');
}

/**
 * evidence 扫描：统计合成占位敏感值与残留个人路径命中数。
 * 供 verify-static 的守卫与 verify-ticket 的 evidence writer 复用。
 */
export function scanEvidenceText(text) {
  const secretHits = (text.match(SYNTHETIC_SECRET_PATTERN) ?? []).length;
  const personalPathHits = (text.match(/\/Users\/[^/\s:]+/g) ?? []).length;
  return { secretHits, personalPathHits, clean: secretHits === 0 && personalPathHits === 0 };
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** 目录内全部文件（递归）的 sha256，key 为相对路径，按路径排序 */
export function digestDirectory(rootDir) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out[path.relative(rootDir, full)] = sha256File(full);
      }
    }
  };
  walk(rootDir);
  return out;
}

/**
 * PF descriptor 自身 digest：将 JSON 中 digest.value 置空后对文件字节求 sha256。
 * 与 performance/descriptors/*.json 内 digest.canonicalization 的描述一致。
 */
export function pfDescriptorDigest(descriptorPath) {
  const raw = fs.readFileSync(descriptorPath, 'utf8');
  const parsed = JSON.parse(raw);
  const value = parsed?.digest?.value;
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`descriptor digest.value 缺失或格式错误: ${descriptorPath}`);
  }
  const canonical = raw.replace(`"value": "${value}"`, '"value": ""');
  return sha256Text(canonical);
}

/** descriptor 的声明 digest 必须与当前原始字节复算值完全一致。 */
export function assertCurrentPfDescriptorDigest(descriptorPath) {
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  const declared = descriptor?.digest?.value;
  const digest = pfDescriptorDigest(descriptorPath);
  if (declared !== digest) {
    throw new Error(`PF-01 descriptor digest 不一致: 实算 ${digest} != 声明 ${String(declared)}`);
  }
  return { descriptor, digest };
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

let lastRunTimestamp = '';
let runSequence = 0;

export function makeRunId(now = new Date()) {
  // 毫秒 + PID + 同毫秒进程内序号，避免并发 verifier evidence 目录碰撞。
  // 2026-07-28T04:08:35.065Z → 20260728T040835065Z-p12345-000
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('.', '');
  if (timestamp === lastRunTimestamp) {
    runSequence += 1;
  } else {
    lastRunTimestamp = timestamp;
    runSequence = 0;
  }
  return `${timestamp}-p${process.pid}-${String(runSequence).padStart(3, '0')}`;
}

/**
 * 运行一个子进程步骤。
 * - spawn(cmd, args, { shell: false })，流式转发 stdout/stderr 到当前进程；
 * - timeoutMs 超时：SIGTERM，5s 未退出则 SIGKILL，exitCode 记 124；
 * - 当前进程收到 SIGINT/SIGTERM 时转发给子进程；
 * 返回 { exitCode, durationMs, timedOut, stdout, stderr }（未脱敏，脱敏由写盘方负责）。
 */
export function runStep({ cmd, args, cwd = REPO_ROOT, env = {}, timeoutMs = 600_000, quiet = false }) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(cmd, args, {
      cwd,
      env: orchestratorEnv(env),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const killTimer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => {
              if (!settled) child.kill('SIGKILL');
            }, 5_000).unref();
          }, timeoutMs)
        : null;
    if (killTimer) killTimer.unref?.();

    const forward = (signal) => {
      if (!settled) child.kill(signal);
    };
    const onSigint = () => forward('SIGINT');
    const onSigterm = () => forward('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      stderr += `\n[orchestrator] spawn 失败: ${String(error)}\n`;
      resolve({ exitCode: 127, durationMs: Math.round(performance.now() - startedAt), timedOut, stdout, stderr });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const exitCode = timedOut ? 124 : code ?? (signal === null ? 1 : 128 + 15);
      resolve({ exitCode, durationMs: Math.round(performance.now() - startedAt), timedOut, stdout, stderr });
    });

    function cleanup() {
      if (killTimer) clearTimeout(killTimer);
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    }
  });
}

/** 捕获式执行（不转发输出），供 toolchain 探测使用 */
export async function capture(cmd, args, cwd = REPO_ROOT) {
  const result = await runStep({ cmd, args, cwd, quiet: true, timeoutMs: 60_000 });
  return result;
}

/** git 只读查询（禁止任何 git 写操作；rev-parse/status 均为只读） */
export async function gitInfo({ env = process.env, repoRoot = REPO_ROOT } = {}) {
  assertNoGitAmbient(env);
  const head = await capture('git', ['rev-parse', 'HEAD'], repoRoot);
  const status = await capture('git', ['status', '--porcelain'], repoRoot);
  return {
    commit: head.exitCode === 0 ? head.stdout.trim() : 'unknown',
    worktreeDirty: status.exitCode === 0 ? status.stdout.trim().length > 0 : null,
  };
}

/** PF/verify 的开始与结束必须来自同一 commit 且拥有相同 clean state。 */
export function sameGitIdentity(start, end) {
  return (
    start !== null &&
    typeof start === 'object' &&
    end !== null &&
    typeof end === 'object' &&
    typeof start.commit === 'string' &&
    typeof end.commit === 'string' &&
    start.commit === end.commit &&
    start.worktreeDirty === end.worktreeDirty
  );
}

export { require };
