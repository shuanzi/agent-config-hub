/* global process, console */
/**
 * test:rust（L1）：Rust core/catalog/wire/IPC 测试，两轮 feature 集。
 * 默认 feature 一轮 + `--features test-harness` 一轮；任一非零退出 1。
 */
import { runStep, SRC_TAURI } from './lib.mjs';

const fullRounds = [
  { id: 'cargo test（默认 feature）', args: ['test'] },
  { id: 'cargo test（test-harness）', args: ['test', '--features', 'test-harness'] },
];

const focusedRounds = {
  'FE-02': [
    { id: 'cargo test（FE-02 read surfaces）', args: ['test', '--test', 'fe02_read_surfaces'] },
  ],
  'FE-07R': [
    { id: 'cargo test（FE-07R resolver）', args: ['test', '--test', 'project_applicability'] },
    { id: 'cargo test（FE-07R wire vectors）', args: ['test', '--test', 'wire_vectors'] },
  ],
};

const ticketId = process.argv[2];
const rounds = ticketId === undefined ? fullRounds : focusedRounds[ticketId];
if (rounds === undefined) {
  console.error(`未知 Rust focused ticket: ${ticketId}`);
  process.exit(1);
}

let failed = 0;
for (const round of rounds) {
  console.log(`\n=== ${round.id}`);
  const result = await runStep({ cmd: 'cargo', args: round.args, cwd: SRC_TAURI, timeoutMs: 900_000 });
  console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'}  ${round.id}  exit ${result.exitCode} (${result.durationMs}ms)`);
  if (result.exitCode !== 0) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
