/* global process, console */
/**
 * test:tauri（L3）：专用 test-harness 构建的真实 command/event/隔离磁盘 tracer。
 *
 * 顺序（命令固化自 tests/l3/README.md）：
 * 1. `corepack npm run build:frontend`（harness 依赖 dist/）；
 * 2. harness debug build：`tauri build --debug --no-bundle
 *    -c src-tauri/tauri.conf.test-harness.json -- --features test-harness`；
 * 3. `wdio run tests/l3/wdio.conf.ts`（onPrepare 自带临时隔离 fixture 根
 *    ACM_NATIVE_ROOT，仓库内 fixture 不被原地修改）；
 * 4. 记录 harness artifact identity（identifier + debug profile + 相对二进制路径）
 *    到 .artifacts/test-harness/identity.json，供 verify:ticket manifest 引用。
 *
 * Provenance：只证明隔离测试构建，不等同生产签名、DMG 或 L4。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runStep, writeJson, ARTIFACTS_ROOT, REPO_ROOT } from './lib.mjs';

const HARNESS_CONF = 'src-tauri/tauri.conf.test-harness.json';
const HARNESS_BINARY = 'src-tauri/target/debug/agent-config-manager';

async function main() {
  const steps = [
    {
      id: 'L3 build:frontend',
      cmd: 'corepack',
      args: ['npm', 'run', 'build:frontend'],
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
    {
      id: 'L3 wdio tracer（tests/l3）',
      cmd: 'corepack',
      args: ['npm', 'exec', '--', 'wdio', 'run', 'tests/l3/wdio.conf.ts'],
      timeoutMs: 600_000,
    },
  ];

  for (const step of steps) {
    console.log(`\n=== ${step.id}`);
    const result = await runStep({ cmd: step.cmd, args: step.args, timeoutMs: step.timeoutMs });
    console.log(
      `${result.exitCode === 0 ? 'PASS' : 'FAIL'}  ${step.id}  exit ${result.exitCode} (${result.durationMs}ms)`,
    );
    if (result.exitCode !== 0) process.exit(1);
  }

  const conf = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, HARNESS_CONF), 'utf8'));
  if (!fs.existsSync(path.join(REPO_ROOT, HARNESS_BINARY))) {
    console.error(`FAIL  harness 二进制不存在: ${HARNESS_BINARY}`);
    process.exit(1);
  }
  const identity = {
    kind: 'test-harness',
    identifier: conf.identifier,
    profile: 'debug',
    binary: HARNESS_BINARY,
    provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
  };
  writeJson(path.join(ARTIFACTS_ROOT, 'test-harness/identity.json'), identity);
  console.log(`\ntest:tauri OK；artifact identity: ${identity.identifier} (${identity.profile})`);
  process.exit(0);
}

await main();
