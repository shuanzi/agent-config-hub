/* global console */
/**
 * L3 harness 构建（test-tauri.mjs 与 perf.mjs 共用，ARC-06c §3.15/§3.16）。
 *
 * 顺序（命令固化自 tests/l3/README.md）：
 * 1. `corepack npm exec -- tsc -b`（类型检查）；
 * 2. `corepack npm exec -- vite build --config vite.l3.config.ts`
 *    （harness 前端构建：含 tests/l3/contract.html 测试入口；生产
 *    `build:frontend` 保持单入口，物理不含测试入口）；
 * 3. `tauri build --debug --no-bundle -c src-tauri/tauri.conf.test-harness.json
 *    -- --features test-harness`；
 * 4. 记录 harness artifact identity（identifier + debug profile + 相对二进制
 *    路径）到 .artifacts/test-harness/identity.json，供 verify:ticket manifest
 *    引用。
 *
 * Provenance：只证明隔离测试构建，不等同生产签名、DMG 或 L4。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runStep, writeJson, ARTIFACTS_ROOT, REPO_ROOT } from './lib.mjs';

export const HARNESS_CONF = 'src-tauri/tauri.conf.test-harness.json';
export const HARNESS_BINARY = 'src-tauri/target/debug/agent-config-manager';

/**
 * 构建 harness（前端 + debug 二进制）并记录 identity。
 * 返回 true=成功；任一失败打印 FAIL 并返回 false（退出码由调用方决定）。
 */
export async function ensureHarnessBuilt() {
  const steps = [
    {
      id: 'L3 tsc -b',
      cmd: 'corepack',
      args: ['npm', 'exec', '--', 'tsc', '-b'],
      timeoutMs: 600_000,
    },
    {
      id: 'L3 vite build（vite.l3.config.ts，含 contract 测试入口）',
      cmd: 'corepack',
      args: ['npm', 'exec', '--', 'vite', 'build', '--config', 'vite.l3.config.ts'],
      timeoutMs: 600_000,
    },
    {
      id: 'L3 harness debug build',
      cmd: 'corepack',
      args: [
        'npm',
        'exec',
        '--',
        'tauri',
        'build',
        '--debug',
        '--no-bundle',
        '-c',
        HARNESS_CONF,
        '--',
        '--features',
        'test-harness',
      ],
      timeoutMs: 1_800_000,
    },
  ];

  for (const step of steps) {
    console.log(`\n=== ${step.id}`);
    const result = await runStep({ cmd: step.cmd, args: step.args, timeoutMs: step.timeoutMs });
    console.log(
      `${result.exitCode === 0 ? 'PASS' : 'FAIL'}  ${step.id}  exit ${result.exitCode} (${result.durationMs}ms)`,
    );
    if (result.exitCode !== 0) return false;
  }

  const conf = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, HARNESS_CONF), 'utf8'));
  if (!fs.existsSync(path.join(REPO_ROOT, HARNESS_BINARY))) {
    console.error(`FAIL  harness 二进制不存在: ${HARNESS_BINARY}`);
    return false;
  }
  const identity = {
    kind: 'test-harness',
    identifier: conf.identifier,
    profile: 'debug',
    binary: HARNESS_BINARY,
    provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
  };
  writeJson(path.join(ARTIFACTS_ROOT, 'test-harness/identity.json'), identity);
  console.log(`\nharness 构建完成；artifact identity: ${identity.identifier} (${identity.profile})`);
  return true;
}
