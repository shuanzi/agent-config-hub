/* global console */
/** FE-07R bare L3 harness 构建；identity 路径由 ticket registry 消费。 */
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_ROOT, REPO_ROOT, runStep, writeJson } from './lib.mjs';

export const FX19_HARNESS_CONF = 'src-tauri/tauri.conf.test-harness.json';
export const FX19_HARNESS_BINARY = 'src-tauri/target/debug/agent-config-manager';

export async function ensureFx19HarnessBuilt() {
  const steps = [
    {
      id: 'L3 FX-19 tsc -b',
      cmd: 'corepack',
      args: ['npm', 'exec', '--', 'tsc', '-b'],
      timeoutMs: 600_000,
    },
    {
      id: 'L3 FX-19 bare Vite build',
      cmd: 'corepack',
      args: ['npm', 'exec', '--', 'vite', 'build', '--config', 'vite.fx19.config.ts'],
      timeoutMs: 600_000,
    },
    {
      id: 'L3 FX-19 harness debug build',
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
        FX19_HARNESS_CONF,
        '--',
        '--bin',
        'agent-config-manager',
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

  if (!fs.existsSync(path.join(REPO_ROOT, FX19_HARNESS_BINARY))) {
    console.error(`FAIL  FX-19 harness 二进制不存在: ${FX19_HARNESS_BINARY}`);
    return false;
  }
  const conf = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, FX19_HARNESS_CONF), 'utf8'));
  writeJson(path.join(ARTIFACTS_ROOT, 'test-harness/fx19-identity.json'), {
    kind: 'test-harness',
    identifier: conf.identifier,
    profile: 'debug',
    binary: FX19_HARNESS_BINARY,
    provenance: 'L3 专用 FX-19 isolated synthetic actual-read harness；非生产签名/DMG，不取得 L4 credit',
  });
  return true;
}
