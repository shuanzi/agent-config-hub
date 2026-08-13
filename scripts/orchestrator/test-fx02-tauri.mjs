/* global console, process */
/**
 * FE-02 / FX-02 的独立 L3 actual-read 入口。
 *
 * `ensureHarnessBuilt()` 固化了 TypeScript、L3 Vite 与真实
 * `agent-config-manager --features test-harness` 二进制构建；随后只运行
 * 本 ticket 的 multi-file disk-read tracer。它不运行 Hook、write、draft、
 * prepare 或 apply，也不产生 closure / performance evidence。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureHarnessBuilt, HARNESS_BINARY } from './build-harness.mjs';
import { ARTIFACTS_ROOT, REPO_ROOT, runStep, sha256File } from './lib.mjs';

function currentHarnessIdentity() {
  const identityPath = path.join(ARTIFACTS_ROOT, 'test-harness/identity.json');
  if (!fs.existsSync(identityPath)) return null;
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const binaryPath = path.join(REPO_ROOT, HARNESS_BINARY);
  const binarySha256 = fs.existsSync(binaryPath) ? sha256File(binaryPath) : null;
  return identity.kind === 'test-harness' &&
    identity.identifier === 'com.agentconfigmanager.testharness' &&
    identity.profile === 'debug' &&
    identity.binary === HARNESS_BINARY &&
    identity.binarySha256 === binarySha256
    ? { binaryPath, binarySha256 }
    : null;
}

async function main() {
  if (!(await ensureHarnessBuilt())) process.exit(1);
  const beforeRun = currentHarnessIdentity();
  if (beforeRun === null) {
    console.error('FAIL  FX-02 L3 harness identity 与本轮 agent-config-manager 二进制不一致');
    process.exit(1);
  }

  console.log('\n=== L3 FX-02 actual multi-file read tracer');
  const result = await runStep({
    cmd: 'corepack',
    args: ['npm', 'exec', '--', 'wdio', 'run', 'tests/l3/fx-02.wdio.conf.ts'],
    timeoutMs: 600_000,
  });
  console.log(
    `${result.exitCode === 0 ? 'PASS' : 'FAIL'}  L3 FX-02 actual read exit ${result.exitCode} (${result.durationMs}ms)`,
  );
  const afterRun = currentHarnessIdentity();
  if (
    result.exitCode !== 0 ||
    afterRun === null ||
    afterRun.binaryPath !== beforeRun.binaryPath ||
    afterRun.binarySha256 !== beforeRun.binarySha256
  ) {
    console.error('FAIL  FX-02 L3 运行期间 harness identity/二进制发生漂移');
    process.exit(1);
  }
  console.log(`PASS  FX-02 L3 harness identity ${beforeRun.binarySha256}`);
  process.exit(0);
}

await main();
