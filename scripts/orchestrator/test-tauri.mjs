/* global process, console */
/**
 * test:tauri（L3）：专用 test-harness 构建的真实 command/event/隔离磁盘 tracer。
 *
 * 顺序（命令固化自 tests/l3/README.md）：
 * 1. harness 构建（tsc -b + vite build --config vite.l3.config.ts +
 *    `tauri build --debug --no-bundle -c src-tauri/tauri.conf.test-harness.json
 *    -- --features test-harness`，见 build-harness.mjs）；
 * 2. `wdio run tests/l3/wdio.conf.ts`（onPrepare 自带临时隔离 fixture 根
 *    ACM_NATIVE_ROOT，仓库内 fixture 不被原地修改）；
 * 3. harness artifact identity 由 build-harness.mjs 记录到
 *    .artifacts/test-harness/identity.json，供 verify:ticket manifest 引用。
 *
 * Provenance：只证明隔离测试构建，不等同生产签名、DMG 或 L4。
 */
import { runStep } from './lib.mjs';
import { ensureHarnessBuilt } from './build-harness.mjs';

async function main() {
  if (!(await ensureHarnessBuilt())) {
    process.exit(1);
  }

  console.log('\n=== L3 wdio（tests/l3：tracer + contract）');
  const result = await runStep({
    cmd: 'corepack',
    args: ['npm', 'exec', '--', 'wdio', 'run', 'tests/l3/wdio.conf.ts'],
    timeoutMs: 600_000,
  });
  console.log(
    `${result.exitCode === 0 ? 'PASS' : 'FAIL'}  L3 wdio（tests/l3）  exit ${result.exitCode} (${result.durationMs}ms)`,
  );
  if (result.exitCode !== 0) process.exit(1);

  console.log('\ntest:tauri OK');
  process.exit(0);
}

await main();
