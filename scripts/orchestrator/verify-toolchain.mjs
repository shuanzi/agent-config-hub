/* global process, console */
/**
 * verify:toolchain（L0，只读，不安装不修改）。
 *
 * 逐项核对 ARC-06c §3.17 的工具链锁定：
 *   node == 24.18.0、corepack npm == 11.16.0、rustc == 1.97.1、
 *   aarch64-apple-darwin target、macOS >= 15、arm64、Xcode CLT、
 *   package-lock.json / Cargo.lock 存在且与 manifest 结构一致、Chrome 存在（L2 前置）。
 * 任一失败退出 1。
 *
 * lockfile 一致性做法（可靠、无网络、不写盘）：
 * - npm：比对 package.json 与 package-lock.json 根包条目的 name/version/
 *   dependencies/devDependencies 规格集合完全相等（lockfileVersion 3）；
 * - cargo：比对 Cargo.toml 三个依赖段的（name, version req）在 Cargo.lock 中
 *   存在满足 caret 语义的锁定版本（不调用 cargo metadata，避免全图谱下载）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { capture, REPO_ROOT, SRC_TAURI } from './lib.mjs';

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
}

function parseCargoTomlDeps(tomlText) {
  const deps = [];
  let section = null;
  for (const line of tomlText.split('\n')) {
    const sectionMatch = line.match(/^\[(.+)\]/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (!['dependencies', 'dev-dependencies', 'build-dependencies'].includes(section)) continue;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    // 形态 A：name = "req"；形态 B：name = { version = "req", ... }
    const simple = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
    const table = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
    const match = simple ?? table;
    if (match) deps.push({ name: match[1], req: match[2] });
  }
  return deps;
}

function parseCargoLockPackages(lockText) {
  const versionsByName = new Map();
  for (const block of lockText.split('[[package]]').slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (name && version) {
      const list = versionsByName.get(name) ?? [];
      list.push(version);
      versionsByName.set(name, list);
    }
  }
  return versionsByName;
}

/** caret 语义（Cargo 默认）："2" → >=2.0.0 <3；"0.10" → >=0.10.0 <0.11 */
function satisfiesCaret(version, req) {
  if (req === '*') return true;
  const parse = (text) => text.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const v = parse(version);
  const r = parse(req);
  for (let index = 0; index < r.length; index += 1) {
    if ((v[index] ?? 0) !== r[index]) return false;
    if (r[index] !== 0) {
      // 第一个非零分量之后只允许更大或相等
      return compareVersions(v, r) >= 0;
    }
  }
  return compareVersions(v, r) >= 0;
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function main() {
  // node 版本（本进程即 orchestrator node）
  check('node==24.18.0', process.version === 'v24.18.0', `actual ${process.version}`);

  const npmVersion = await capture('corepack', ['npm', '--version']);
  check(
    'npm==11.16.0',
    npmVersion.exitCode === 0 && npmVersion.stdout.trim() === '11.16.0',
    `actual ${npmVersion.stdout.trim() || `exit ${npmVersion.exitCode}`}`,
  );

  const rustc = await capture('rustc', ['--version']);
  check(
    'rustc==1.97.1',
    rustc.exitCode === 0 && rustc.stdout.startsWith('rustc 1.97.1 '),
    `actual ${rustc.stdout.trim() || `exit ${rustc.exitCode}`}`,
  );

  const targets = await capture('rustup', ['target', 'list', '--installed']);
  check(
    'rust-target aarch64-apple-darwin',
    targets.exitCode === 0 && targets.stdout.split('\n').includes('aarch64-apple-darwin'),
    targets.stdout.trim().replace(/\n/g, ',') || `exit ${targets.exitCode}`,
  );

  const swvers = await capture('sw_vers', ['-productVersion']);
  const macMajor = Number.parseInt(swvers.stdout.trim().split('.')[0], 10);
  check('macOS>=15', swvers.exitCode === 0 && macMajor >= 15, `actual ${swvers.stdout.trim()}`);

  const arch = await capture('uname', ['-m']);
  check('arch==arm64', arch.exitCode === 0 && arch.stdout.trim() === 'arm64', `actual ${arch.stdout.trim()}`);

  const clt = await capture('xcode-select', ['-p']);
  check('xcode CLT', clt.exitCode === 0, clt.stdout.trim() || `exit ${clt.exitCode}`);

  // npm lockfile 一致性（结构比对，不执行 npm ci，不触网不写盘）
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const lockPath = path.join(REPO_ROOT, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    check('package-lock.json 存在', false, 'missing');
  } else {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const rootEntry = lock.packages?.[''] ?? {};
    const sameSpecs = (a = {}, b = {}) => {
      const ak = Object.keys(a).sort();
      const bk = Object.keys(b).sort();
      return ak.length === bk.length && ak.every((key, i) => key === bk[i] && a[key] === b[key]);
    };
    const consistent =
      lock.lockfileVersion === 3 &&
      rootEntry.name === pkg.name &&
      rootEntry.version === pkg.version &&
      sameSpecs(pkg.dependencies, rootEntry.dependencies) &&
      sameSpecs(pkg.devDependencies, rootEntry.devDependencies);
    check(
      'package-lock.json 与 package.json 一致',
      consistent,
      `lockfileVersion ${lock.lockfileVersion}`,
    );
  }

  // Cargo.lock 一致性（结构比对）
  const cargoTomlPath = path.join(SRC_TAURI, 'Cargo.toml');
  const cargoLockPath = path.join(SRC_TAURI, 'Cargo.lock');
  if (!fs.existsSync(cargoLockPath)) {
    check('Cargo.lock 存在', false, 'missing');
  } else {
    const deps = parseCargoTomlDeps(fs.readFileSync(cargoTomlPath, 'utf8'));
    const locked = parseCargoLockPackages(fs.readFileSync(cargoLockPath, 'utf8'));
    const missing = deps.filter(
      (dep) => !(locked.get(dep.name) ?? []).some((version) => satisfiesCaret(version, dep.req)),
    );
    check(
      'Cargo.lock 与 Cargo.toml 一致',
      missing.length === 0,
      missing.length === 0
        ? `${deps.length} 个直接依赖均有满足 req 的锁定版本`
        : `未满足: ${missing.map((d) => `${d.name}@${d.req}`).join(', ')}`,
    );
  }

  // Chrome（L2 前置）
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  check('Chrome 存在（L2 前置）', fs.existsSync(chromePath), chromePath);

  const failed = checks.filter((entry) => !entry.ok);
  console.log(
    failed.length === 0
      ? `verify:toolchain OK（${checks.length} 项）`
      : `verify:toolchain FAILED（${failed.length}/${checks.length} 项失败）`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
