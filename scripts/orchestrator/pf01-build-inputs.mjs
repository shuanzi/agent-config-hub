/* global process */
/**
 * PF-01 L3 harness build-input digest v4.
 *
 * 该 digest 只刻画会影响 `build-harness.mjs` 产物的仓库输入：构建命令/配置、
 * L3 Vite 的两个入口实际产出的 module closure、FX-01 Vite raw import，以及 Tauri
 * debug binary 的配置、manifest、capability/icon 与 Rust module closure。`dist`/target
 * 是输出；production `vite.config.ts`、未进入 closure 的 prototype/legacy UI、budget、
 * 文档、evidence 与 no-emit-only source 都不是该 artifact 的输入。
 *
 * 规范化：repo-relative POSIX path 按原始 UTF-8 bytes 排序；每个文件对原始 bytes
 * 算 SHA-256；整个 `{schemaVersion, algorithm, entries}` JSON 加 LF 后再算 SHA-256。
 * 工作树含未跟踪/修改内容、缺失、符号链接、越界路径或 NFC/case path collision 时
 * 一律拒绝。baseline 从 Git tree blob 读取，绝不追补历史 runtime artifact。
 */
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { ARTIFACTS_ROOT, assertNoGitAmbient, classifyPf01ViteModuleId, REPO_ROOT } from './lib.mjs';

export const PF01_L3_BUILD_INPUTS = {
  schemaVersion: 4,
  algorithm: 'pf01-l3-harness-build-inputs-v4',
  method: 'raw bytes SHA-256 / byte-sorted repo-relative paths',
};

/** Build-environment attestation is a versioned producer/freezer wire shape. */
export const PF01_BUILD_ENVIRONMENT = Object.freeze({
  schemaVersion: 1,
  policy: 'no ambient Git/VITE_/TAURI_/CARGO_/Rust/SDK/Node build overrides or root .env files',
  overrides: [],
});

const BUILD_COMMAND_AND_CONFIG_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.l3.config.ts',
  'rust-toolchain.toml',
  'scripts/orchestrator/build-harness.mjs',
  'scripts/orchestrator/lib.mjs',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/build.rs',
  'src-tauri/tauri.conf.json',
  'src-tauri/tauri.conf.test-harness.json',
  'src-tauri/capabilities/default.json',
  'src-tauri/icons/icon.png',
];

/** `vite.l3.config.ts` 在 production mode 的实际 repo-local module closure。 */
export const PF01_L3_VITE_MODULES = [
  'fixtures/fx-01/fixture.json',
  'fixtures/fx-01/native-root/skills/demo-skill/SKILL.md',
  'fixtures/sensitive-masking.ts',
  'index.html',
  'src/App.tsx',
  'src/gateway/index.ts',
  'src/gateway/mock.ts',
  'src/gateway/perf-catalog.ts',
  'src/gateway/tauri.ts',
  'src/gateway/wire/gateway-wire.ts',
  'src/main.tsx',
  'src/session/ReadOnlyWorkbenchSession.ts',
  'src/ui/ReadOnlyWorkbench.tsx',
  'src/ui/workbench.css',
  'src/workbench/read-only-model.ts',
  'tests/contract/frontend-gateway-contract.ts',
  'tests/l3/contract-entry.ts',
  'tests/l3/contract.html',
];

const PF01_L3_TAURI_MODULES = [
  'src-tauri/src/adapter_registry.rs',
  'src-tauri/src/catalog.rs',
  'src-tauri/src/core.rs',
  'src-tauri/src/domain.rs',
  'src-tauri/src/ipc.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/main.rs',
  'src-tauri/src/project_applicability.rs',
  'src-tauri/src/wire.rs',
];

const INPUT_FILES = new Set([
  ...BUILD_COMMAND_AND_CONFIG_FILES,
  ...PF01_L3_VITE_MODULES,
  ...PF01_L3_TAURI_MODULES,
]);

const TAURI_RESOURCE_PREFIX = 'src-tauri/resources/';

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function command(repoRoot, args, encoding = 'utf8') {
  assertNoGitAmbient();
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`PF-01 build-input Git 查询失败: ${args.join(' ')} (${String(error)})`);
  }
}

function isBuildInput(pathname) {
  if (INPUT_FILES.has(pathname)) return true;
  if (pathname.startsWith('.cargo/')) return true;
  return pathname.startsWith(TAURI_RESOURCE_PREFIX);
}

function canonicalPath(pathname) {
  if (
    typeof pathname !== 'string' ||
    pathname.length === 0 ||
    pathname.includes('\0') ||
    pathname.includes('\\') ||
    pathname.startsWith('/') ||
    pathname.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`PF-01 build-input path outside repository: ${String(pathname)}`);
  }
  return pathname;
}

function assertNoPathCollisions(paths) {
  const seen = new Map();
  for (const pathname of paths) {
    const key = pathname.normalize('NFC').toLocaleLowerCase('en-US');
    const prior = seen.get(key);
    if (prior !== undefined && prior !== pathname) {
      throw new Error(`PF-01 build-input path collision: ${prior} / ${pathname}`);
    }
    seen.set(key, pathname);
  }
}

function sortPaths(paths) {
  return [...paths].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

/** Fixed build-method files; dynamic .cargo/resources are added only when tracked in a real Git tree. */
export const PF01_L3_BUILD_INPUT_PATHS = Object.freeze(sortPaths([...INPUT_FILES]));

function digest(entries) {
  const payload = {
    schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
    algorithm: PF01_L3_BUILD_INPUTS.algorithm,
    entries,
  };
  return sha256Bytes(Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8'));
}

/** v4 canonical payload 的唯一 digest 实现；schema validator 也必须通过此函数复算。 */
export function computePf01L3HarnessBuildInputsDigest({ schemaVersion, algorithm, entries }) {
  if (
    schemaVersion !== PF01_L3_BUILD_INPUTS.schemaVersion ||
    algorithm !== PF01_L3_BUILD_INPUTS.algorithm ||
    !Array.isArray(entries)
  ) {
    throw new Error('PF-01 build-input canonical payload schema invalid');
  }
  return digest(entries);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  const paths = [];
  const collisions = new Set();
  let prior = null;
  for (const entry of entries) {
    try {
      if (!exactKeys(entry, ['path', 'sha256'])) return false;
      const pathname = canonicalPath(entry.path);
      if (!isBuildInput(pathname) || !isSha256(entry.sha256)) return false;
      if (prior !== null && Buffer.compare(Buffer.from(prior), Buffer.from(pathname)) >= 0) return false;
      prior = pathname;
      const collision = pathname.normalize('NFC').toLocaleLowerCase('en-US');
      if (collisions.has(collision)) return false;
      collisions.add(collision);
      paths.push(pathname);
    } catch {
      return false;
    }
  }
  try {
    assertRequiredPaths(paths);
    return true;
  } catch {
    return false;
  }
}

/** Shared schema seam for immutable evidence; recomputes the canonical v4 payload. */
export function validatePf01L3HarnessBuildInputs(value, sourceKind) {
  return (
    exactKeys(value, ['schemaVersion', 'algorithm', 'digest', 'entries', 'source']) &&
    value.schemaVersion === PF01_L3_BUILD_INPUTS.schemaVersion &&
    value.algorithm === PF01_L3_BUILD_INPUTS.algorithm &&
    isSha256(value.digest) &&
    exactKeys(value.source, ['kind', 'method', 'commit']) &&
    value.source.kind === sourceKind &&
    value.source.method === PF01_L3_BUILD_INPUTS.method &&
    typeof value.source.commit === 'string' &&
    /^[a-f0-9]{40}$/i.test(value.source.commit) &&
    validEntries(value.entries) &&
    value.digest ===
      computePf01L3HarnessBuildInputsDigest({
        schemaVersion: value.schemaVersion,
        algorithm: value.algorithm,
        entries: value.entries,
      })
  );
}

function assertRequiredPaths(paths) {
  const available = new Set(paths);
  for (const pathname of INPUT_FILES) {
    if (!available.has(pathname)) {
      throw new Error(`PF-01 build-input missing required path: ${pathname}`);
    }
  }
}

function formatResult(entries, source) {
  return {
    schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
    algorithm: PF01_L3_BUILD_INPUTS.algorithm,
    digest: computePf01L3HarnessBuildInputsDigest({
      schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
      algorithm: PF01_L3_BUILD_INPUTS.algorithm,
      entries,
    }),
    entries,
    source,
  };
}

function samePathList(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function relativeViteModuleId(moduleId, repoRoot) {
  const classified = classifyPf01ViteModuleId(moduleId, { repoRoot });
  if (classified.kind !== 'candidate') return null;
  const encodedPhysical = classified.value;
  const physical = encodedPhysical.startsWith('/@fs/')
    ? encodedPhysical.slice('/@fs'.length)
    : encodedPhysical;
  if (!path.isAbsolute(physical)) return canonicalPath(physical);
  const relative = path.relative(repoRoot, physical);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`PF-01 L3 Vite module path outside repository: ${moduleId}`);
  }
  const normalized = relative.split(path.sep).join('/');
  if (normalized.startsWith('node_modules/')) return null;
  return canonicalPath(normalized);
}

/**
 * 以实际 `vite.l3.config.ts` production build 的 Rollup module map 复验锁定 closure。
 * 输出固定临时目录；该验证不修改 production config、dist、权限或业务 IPC。
 */
export async function assertPf01L3ViteModuleClosure({ repoRoot = REPO_ROOT, moduleIds } = {}) {
  let discovered = moduleIds;
  if (discovered === undefined) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf01-vite-closure-'));
    const moduleSet = new Set();
    const priorNodeEnv = process.env.NODE_ENV;
    try {
      // Vitest 的 NODE_ENV=test 会令 Vite 把 DEV branch 也编入 chunk；真实
      // `vite build` 口径为 production，故在仅临时 closure build 内固定该值。
      process.env.NODE_ENV = 'production';
      await build(
        {
          root: repoRoot,
          configFile: path.join(repoRoot, 'vite.l3.config.ts'),
          mode: 'production',
          logLevel: 'silent',
          build: { outDir: outputDir, emptyOutDir: true },
          plugins: [
            {
              name: 'pf01-l3-module-closure',
              generateBundle(_, bundle) {
                for (const output of Object.values(bundle)) {
                  if (output.type !== 'chunk') continue;
                  for (const id of Object.keys(output.modules)) moduleSet.add(id);
                }
              },
            },
          ],
        },
      );
      discovered = [...moduleSet];
    } finally {
      if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = priorNodeEnv;
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }
  const actual = sortPaths(
    [...new Set(discovered.map((id) => relativeViteModuleId(id, repoRoot)).filter(Boolean))],
  );
  const expected = sortPaths(PF01_L3_VITE_MODULES);
  if (!samePathList(actual, expected)) {
    throw new Error(
      `PF-01 L3 Vite module closure mismatch: actual=${actual.join(',')} expected=${expected.join(',')}`,
    );
  }
  return actual;
}

/** Rust `main`/`lib` 的非 inline module closure 必须与 versioned list 完全一致。 */
export function assertPf01L3TauriModuleClosure({ repoRoot = REPO_ROOT } = {}) {
  const visited = new Set();
  const visit = (relative) => {
    if (visited.has(relative)) return;
    const filePath = path.join(repoRoot, relative);
    if (!fs.existsSync(filePath)) throw new Error(`PF-01 Tauri module missing: ${relative}`);
    visited.add(relative);
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(/^\s*(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm)) {
      const moduleRelative = path.posix.join(path.posix.dirname(relative), `${match[1]}.rs`);
      visit(moduleRelative);
    }
  };
  visit('src-tauri/src/main.rs');
  visit('src-tauri/src/lib.rs');
  const actual = sortPaths([...visited]);
  const expected = sortPaths(PF01_L3_TAURI_MODULES);
  if (!samePathList(actual, expected)) {
    throw new Error(
      `PF-01 Tauri module closure mismatch: actual=${actual.join(',')} expected=${expected.join(',')}`,
    );
  }
  return actual;
}

function defaultTrackedPaths(repoRoot) {
  const raw = command(repoRoot, ['ls-files', '-z'], 'buffer');
  return raw
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter(isBuildInput);
}

/**
 * 从当前 clean tracked checkout 计算 v1 digest。`trackedPaths`/`gitStatus` 仅作为
 * 单元测试注入 seam；正常调用始终通过 Git 读取真实状态与文件列表。
 */
export function collectPf01L3HarnessBuildInputs({
  repoRoot = REPO_ROOT,
  trackedPaths,
  gitStatus,
} = {}) {
  const status =
    gitStatus === undefined
      ? command(repoRoot, ['status', '--porcelain', '--untracked-files=all'])
      : gitStatus;
  if (status.trim() !== '') {
    throw new Error('PF-01 build-input collection requires clean tracked checkout (untracked/modified input)');
  }

  const selected = trackedPaths === undefined ? defaultTrackedPaths(repoRoot) : trackedPaths;
  const paths = sortPaths(selected.map(canonicalPath));
  assertNoPathCollisions(paths);
  if (trackedPaths === undefined) {
    assertRequiredPaths(paths);
    assertPf01L3TauriModuleClosure({ repoRoot });
  }

  const root = path.resolve(repoRoot);
  const entries = paths.map((pathname) => {
    const fullPath = path.resolve(root, pathname);
    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`PF-01 build-input path outside repository: ${pathname}`);
    }
    let stat;
    try {
      stat = fs.lstatSync(fullPath);
    } catch {
      throw new Error(`PF-01 build-input missing: ${pathname}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`PF-01 build-input symlink rejected: ${pathname}`);
    if (!stat.isFile()) throw new Error(`PF-01 build-input must be a regular file: ${pathname}`);
    return { path: pathname, sha256: sha256Bytes(fs.readFileSync(fullPath)) };
  });
  const commit = command(repoRoot, ['rev-parse', 'HEAD']).trim();
  return formatResult(entries, {
    kind: 'clean-tracked-checkout',
    method: PF01_L3_BUILD_INPUTS.method,
    commit,
  });
}

function decodeGitPath(bytes) {
  const pathname = bytes.toString('utf8');
  if (!Buffer.from(pathname, 'utf8').equals(bytes)) {
    throw new Error('PF-01 build-input Git path must be UTF-8');
  }
  return pathname;
}

/** 从 immutable Git tree blob 重新计算历史 baseline 输入摘要。 */
export function collectPf01L3HarnessBuildInputsFromGit({
  repoRoot = REPO_ROOT,
  commit,
} = {}) {
  if (!/^[a-f0-9]{40}$/i.test(commit ?? '')) {
    throw new Error('PF-01 build-input baseline commit invalid');
  }
  const raw = command(repoRoot, ['ls-tree', '-r', '-z', '--full-tree', commit], 'buffer');
  const selected = [];
  for (const record of raw.toString('binary').split('\0').filter(Boolean)) {
    const bytes = Buffer.from(record, 'binary');
    const tab = bytes.indexOf(0x09);
    if (tab <= 0) throw new Error('PF-01 build-input Git tree record malformed');
    const header = bytes.subarray(0, tab).toString('ascii').split(' ');
    const pathname = decodeGitPath(bytes.subarray(tab + 1));
    if (!isBuildInput(pathname)) continue;
    selected.push({ mode: header[0], type: header[1], object: header[2], path: canonicalPath(pathname) });
  }
  const paths = sortPaths(selected.map((entry) => entry.path));
  assertNoPathCollisions(paths);
  assertRequiredPaths(paths);
  const byPath = new Map(selected.map((entry) => [entry.path, entry]));
  const entries = paths.map((pathname) => {
    const entry = byPath.get(pathname);
    if (
      entry === undefined ||
      !/^100[0-7]{3}$/.test(entry.mode) ||
      entry.type !== 'blob' ||
      !/^[a-f0-9]{40}$/i.test(entry.object)
    ) {
      throw new Error(`PF-01 build-input Git object invalid: ${pathname}`);
    }
    const bytes = command(repoRoot, ['cat-file', 'blob', entry.object], 'buffer');
    return { path: pathname, sha256: sha256Bytes(bytes) };
  });
  return formatResult(entries, {
    kind: 'git-object-tree',
    method: PF01_L3_BUILD_INPUTS.method,
    commit,
  });
}

const NATIVE_TOOLCHAIN_EXACT_OVERRIDES = new Set([
  'RUSTFLAGS',
  'RUSTC',
  'RUSTDOC',
  'RUSTDOCFLAGS',
  'RUSTC_WRAPPER',
  'RUSTC_WORKSPACE_WRAPPER',
  'RUSTUP_HOME',
  'RUSTUP_TOOLCHAIN',
  'CC',
  'CXX',
  'AR',
  'CPPFLAGS',
  'CFLAGS',
  'CXXFLAGS',
  'LDFLAGS',
  'CXXSTDLIB',
  'CRATE_CC_NO_DEFAULTS',
  'CC_ENABLE_DEBUG_OUTPUT',
  'CC_SHELL_ESCAPED_FLAGS',
  'CC_KNOWN_WRAPPER_CUSTOM',
  'CC_FORCE_DISABLE',
]);

const TARGETABLE_NATIVE_TOOLCHAIN_OVERRIDES = [
  'CC',
  'CXX',
  'AR',
  'CPPFLAGS',
  'CFLAGS',
  'CXXFLAGS',
  'LDFLAGS',
  'CXXSTDLIB',
];

function isNativeToolchainOverride(key) {
  if (NATIVE_TOOLCHAIN_EXACT_OVERRIDES.has(key)) return true;
  return TARGETABLE_NATIVE_TOOLCHAIN_OVERRIDES.some(
    (name) =>
      key === `HOST_${name}` ||
      key === `TARGET_${name}` ||
      (key.startsWith(`${name}_`) && /^[A-Za-z0-9_.-]+$/.test(key.slice(name.length + 1))),
  );
}

/** 禁止未记录的 build override 参与当前 PF-01 attestation。 */
export function assertPf01L3BuildEnvironment(env = process.env, repoRoot = REPO_ROOT) {
  assertNoGitAmbient(env);
  const keys = Object.keys(env).filter(
    (key) =>
      key.startsWith('VITE_') ||
      key.startsWith('TAURI_') ||
      key.startsWith('CARGO_') ||
      isNativeToolchainOverride(key) ||
      ['MACOSX_DEPLOYMENT_TARGET', 'SDKROOT', 'NODE_OPTIONS', 'NVM_INC', 'NVM_BIN'].includes(key) ||
      (key === 'NODE_ENV' && env[key] !== 'production'),
  );
  const dotEnv = fs.readdirSync(repoRoot).filter((name) => name === '.env' || name.startsWith('.env.'));
  const cargoHome = path.join(os.homedir(), '.cargo');
  const cargoConfig = ['config', 'config.toml']
    .map((name) => path.join(cargoHome, name))
    .filter((candidate) => fs.existsSync(candidate));
  if (keys.length > 0 || dotEnv.length > 0 || cargoConfig.length > 0) {
    throw new Error(
      `PF-01 build-input environment override not attested: ${[...keys, ...dotEnv, ...cargoConfig].join(', ')}`,
    );
  }
  return {
    schemaVersion: PF01_BUILD_ENVIRONMENT.schemaVersion,
    policy: PF01_BUILD_ENVIRONMENT.policy,
    overrides: [],
  };
}

/** PF/verify 入口不得继承会改变 fixture、profile 或 evidence 目的地的 ambient override。 */
export function assertPf01VerificationEnvironment(env = process.env) {
  assertNoGitAmbient(env);
  const keys = Object.keys(env).filter(
    (key) => key === 'PERF_OUTPUT_DIR' || key.startsWith('PF01_') || key.startsWith('ACM_'),
  );
  if (keys.length > 0) {
    throw new Error(`PF/verify ambient environment override rejected: ${keys.join(', ')}`);
  }
  return {
    policy: 'no ambient Git/PERF_OUTPUT_DIR/PF01_*/ACM_* overrides',
    overrides: [],
  };
}

/** PF evidence 只能写入 repo-local artifacts，且已存在的任一父目录不得为 symlink。 */
export function assertPf01OutputDirectory(outputDir, { artifactsRoot = ARTIFACTS_ROOT } = {}) {
  if (typeof outputDir !== 'string' || outputDir.trim() === '') {
    throw new Error('PF-01 artifact output directory missing');
  }
  const root = path.resolve(artifactsRoot);
  const resolved = path.resolve(outputDir);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`PF-01 artifact output directory outside artifacts root: ${outputDir}`);
  }
  for (let current = resolved; ; current = path.dirname(current)) {
    if (fs.existsSync(current)) {
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`PF-01 artifact output directory symlink rejected: ${current}`);
      }
      if (!stats.isDirectory()) {
        throw new Error(`PF-01 artifact output directory parent must be a directory: ${current}`);
      }
    }
    if (current === root) break;
  }
  return resolved;
}
