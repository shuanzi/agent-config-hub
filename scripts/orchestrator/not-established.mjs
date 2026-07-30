/* global process, console */
/**
 * not-established：为已登记但 FE-01 未建立的命令提供显式失败出口
 * （build:app / package:macos / verify:release，均为 planned / unverified）。
 * 用法：node scripts/orchestrator/not-established.mjs <command-name>
 */
const name = process.argv[2] ?? '(未命名命令)';
console.error(`${name} 为 planned / unverified，FE-01 未建立该命令`);
process.exit(1);
