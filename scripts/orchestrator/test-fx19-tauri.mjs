/* global process, console */
/** FE-07R L3：专用 bare harness 的 WebView/IPC/Rust/core/fixture actual-read。 */
import { ensureFx19HarnessBuilt } from './build-fx19-harness.mjs';
import { runStep } from './lib.mjs';

if (!(await ensureFx19HarnessBuilt())) {
  process.exit(1);
}

console.log('\n=== L3 FX-19 bare wdio');
const result = await runStep({
  cmd: 'corepack',
  args: ['npm', 'exec', '--', 'wdio', 'run', 'tests/l3/fx19.wdio.conf.ts'],
  timeoutMs: 600_000,
});
console.log(
  `${result.exitCode === 0 ? 'PASS' : 'FAIL'}  L3 FX-19 bare wdio exit ${result.exitCode} (${result.durationMs}ms)`,
);
process.exit(result.exitCode === 0 ? 0 : 1);
