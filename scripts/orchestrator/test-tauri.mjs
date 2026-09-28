/* global process, console */
/**
 * test:tauri（L3）：隔离 test-harness 的真实命令与文件操作。
 * 构建后运行写入旅程，再用同一 ACM_L3_HOME 启动新进程回读；结束清理临时根。
 * 构建身份由 build-harness.mjs 记录；细节见 docs/development.md。
 * 该证据不等同正式签名、分发或生产构建验收。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStep } from './lib.mjs';
import { ensureHarnessBuilt } from './build-harness.mjs';

async function main() {
  if (!(await ensureHarnessBuilt())) {
    process.exit(1);
  }

  console.log('\n=== L3 wdio（tests/l3：tracer + contract）');
  const home = mkdtempSync(join(tmpdir(), 'acm-l3-restart-'));
  let failed = false;
  try {
    for (const readback of ['0', '1']) {
      const result = await runStep({
        cmd: 'corepack', args: ['npm', 'exec', '--', 'wdio', 'run', 'tests/l3/wdio.conf.ts'],
        env: { ACM_L3_HOME: home, ACM_L3_READBACK: readback }, timeoutMs: 600_000,
      });
      console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'} L3 ${readback === '1' ? '进程重启回读' : '写入旅程'} exit ${result.exitCode}`);
      if (result.exitCode !== 0) { failed = true; break; }
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
  if (failed) process.exit(1);

  console.log('\ntest:tauri OK');
  process.exit(0);
}

await main();
