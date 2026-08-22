/* global process, console */
/**
 * verify:static（L0）。
 *
 * 子检查（全部跑完再汇总，任一失败退出 1）：
 * 1. `corepack npm exec -- tsc -b`；
 * 2. `corepack npm exec -- eslint .`；
 * 3. `corepack npm exec -- prettier --check .`；
 * 4. `cargo fmt --check`；
 * 5. `cargo clippy --all-targets -- -D warnings`（默认 feature）；
 * 6. `cargo clippy --all-targets --features test-harness -- -D warnings`；
 * 7. 禁止依赖守卫（ARC-06a/06b：不引入横向状态/查询/编辑器/UI 库，UI 为自绘
 *    最小组件；列表见 BANNED_DEPENDENCIES，命中 package.json 或
 *    package-lock.json 即失败）；
 * 8. 敏感占位值守卫：FX-01 占位明文只允许存在于 fixture 原始文件；
 *    其余被跟踪源文件（src/tests/scripts/src-tauri/performance，排除
 *    node_modules/dist/target/.artifacts/lockfiles）出现即失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runStep, REPO_ROOT, SRC_TAURI } from './lib.mjs';

/**
 * 禁止依赖清单（ARC-06a/06b 对应；经 ADR-0020 架构 pivot 调整）：
 * - zustand / redux / @reduxjs/* / xstate：禁止引入额外客户端状态库（服务端状态由
 *   React Query 承担，组件本地状态用 useState）；
 * - @tanstack/*（除 react-query 外）：禁止引入表格/路由等横向库；React Query 是
 *   ADR-0020 指定的数据获取层，显式豁免；
 * - monaco-editor：源码视图为只读/简单 textarea，不引入重型编辑器；
 * - @mui/* / antd / @radix-ui/* / shadcn*：禁止组件库，UI 为自绘最小组件。
 * exact：精确包名；prefix：scope/名称前缀。
 */
const BANNED_DEPENDENCIES = {
  exact: [
    'zustand',
    'redux',
    'xstate',
    'monaco-editor',
    'antd',
    '@tanstack/react-table',
    '@tanstack/react-router',
    '@tanstack/react-form',
    '@tanstack/react-virtual',
  ],
  prefix: ['@reduxjs/', '@mui/', '@radix-ui/', 'shadcn'],
};

const results = [];
function record(id, ok, detail = '') {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail === '' ? '' : `  ${detail}`}`);
}

async function step(id, cmd, args, cwd = REPO_ROOT, timeoutMs = 600_000) {
  console.log(`\n=== ${id}: ${cmd} ${args.join(' ')}`);
  const result = await runStep({ cmd, args, cwd, timeoutMs });
  record(id, result.exitCode === 0, `exit ${result.exitCode} (${result.durationMs}ms)`);
}

async function bannedDepsGate() {
  const id = '禁止依赖守卫';
  const hits = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.overrides ?? {}),
  ];
  const lock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
  const lockedNames = Object.keys(lock.packages ?? {})
    .map((key) => key.match(/(?:^|\/)node_modules\/(@?[^/]+(?:\/[^/]+)?)$/)?.[1])
    .filter(Boolean);
  const isBanned = (name) =>
    BANNED_DEPENDENCIES.exact.includes(name) ||
    BANNED_DEPENDENCIES.prefix.some((prefix) => name.startsWith(prefix));
  for (const name of new Set([...declared, ...lockedNames])) {
    if (isBanned(name)) hits.push(name);
  }
  record(id, hits.length === 0, hits.length === 0 ? '' : `命中: ${hits.join(', ')}`);
}

async function placeholderGuard() {
  const id = '敏感占位值守卫（FX-01 占位明文不出现在 fixture 之外）';
  // 目标占位值分段拼接，避免字面值进入本守卫源码而自我命中
  const placeholder = ['SYNTHETIC-SECRET', 'demo-skill-0001'].join('-');
  // 文件系统遍历（交付物可能尚未提交，git ls-files 会漏掉 untracked 文件）；
  // 排除构建产物、依赖与 evidence 目录。扫描结果为 0 时封闭失败（空转即门禁失效）。
  const scanRoots = ['src', 'tests', 'scripts', 'src-tauri/src', 'src-tauri/tests', 'src-tauri/capabilities', 'performance', 'fixtures'];
  const skipDirs = new Set(['node_modules', 'dist', 'target', '.artifacts', 'gen']);
  const skipFiles = new Set(['package-lock.json', 'Cargo.lock']);
  const allowed = new Set(['fixtures/fx-01/fixture.json']);
  const allowedPrefix = 'fixtures/fx-01/native-root/';
  const offenders = [];
  let scanned = 0;
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || skipFiles.has(entry.name)) continue;
      const rel = path.relative(REPO_ROOT, path.join(dir, entry.name));
      if (allowed.has(rel) || rel.startsWith(allowedPrefix)) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      } catch {
        continue; // 非 UTF-8（如 .DS_Store、占位图标）不属于源文件扫描范围
      }
      scanned += 1;
      if (text.includes(placeholder)) offenders.push(rel);
    }
  };
  for (const root of scanRoots) walk(path.join(REPO_ROOT, root));
  if (scanned === 0) {
    record(id, false, '扫描到 0 个源文件，守卫空转，封闭失败');
    return;
  }
  record(
    id,
    offenders.length === 0,
    offenders.length === 0 ? `已扫描 ${scanned} 个源文件` : `命中: ${offenders.join(', ')}`,
  );
}

async function main() {
  await step('tsc -b', 'corepack', ['npm', 'exec', '--', 'tsc', '-b']);
  await step('eslint .', 'corepack', ['npm', 'exec', '--', 'eslint', '.']);
  await step('prettier --check .', 'corepack', ['npm', 'exec', '--', 'prettier', '--check', '.']);
  await step('cargo fmt --check', 'cargo', ['fmt', '--check'], SRC_TAURI);
  await step(
    'cargo clippy（默认 feature）',
    'cargo',
    ['clippy', '--all-targets', '--', '-D', 'warnings'],
    SRC_TAURI,
  );
  await step(
    'cargo clippy（test-harness）',
    'cargo',
    ['clippy', '--all-targets', '--features', 'test-harness', '--', '-D', 'warnings'],
    SRC_TAURI,
  );
  await bannedDepsGate();
  await placeholderGuard();

  const failed = results.filter((entry) => !entry.ok);
  console.log(
    failed.length === 0
      ? `\nverify:static OK（${results.length} 项）`
      : `\nverify:static FAILED（${failed.length}/${results.length} 项失败）`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
