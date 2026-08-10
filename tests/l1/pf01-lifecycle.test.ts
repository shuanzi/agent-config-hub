import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime helper is a plain Node ESM module.
import { exitRequestMatchesHarness, lifecycleExitFailurePath, lifecycleExitRequestPath, readHarnessExitFailure, readHarnessExitRequest, waitForHarnessLifecycleState, writeHarnessExitFailure, writeHarnessExitRequest } from '../../scripts/orchestrator/pf01-lifecycle.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function lifecyclePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'acm-pf01-lifecycle-'));
  temporaryRoots.push(root);
  return join(root, 'harness-lifecycle.json');
}

function writeLifecycle(pathname: string, normalExit: boolean, pid = 42): void {
  writeFileSync(
    pathname,
    JSON.stringify({
      pid,
      binary: 'agent-config-manager',
      role: 'test-harness',
      normalExit,
    }),
  );
}

describe('PF-01 harness normal-exit lifecycle', () => {
  it('只为同一临时 lifecycle 原子发布并读取 exit request', () => {
    const pathname = lifecyclePath();
    writeHarnessExitRequest({
      lifecyclePath: pathname,
      harness: { pid: 42, binary: 'agent-config-manager', role: 'test-harness' },
    });

    expect(readHarnessExitRequest(pathname)).toEqual({
      schemaVersion: 1,
      kind: 'pf01-harness-exit-request',
      pid: 42,
      binary: 'agent-config-manager',
      role: 'test-harness',
    });
    expect(lifecycleExitRequestPath(pathname)).toMatch(/pf01-harness-exit-request\.json$/);
  });

  it('拒绝不同 PID 或 role 的 exit request', () => {
    const harness = { pid: 42, binary: 'agent-config-manager', role: 'test-harness' };
    expect(
      exitRequestMatchesHarness(
        {
          schemaVersion: 1,
          kind: 'pf01-harness-exit-request',
          pid: 43,
          binary: 'agent-config-manager',
          role: 'test-harness',
        },
        harness,
      ),
    ).toBe(false);
    expect(
      exitRequestMatchesHarness(
        {
          schemaVersion: 1,
          kind: 'pf01-harness-exit-request',
          pid: 42,
          binary: 'agent-config-manager',
          role: 'other',
        },
        harness,
      ),
    ).toBe(false);
  });

  it('将 afterSession 失败 marker 保持原子且 fail-closed', () => {
    const pathname = lifecyclePath();
    writeHarnessExitFailure(pathname);
    expect(readHarnessExitFailure(pathname)).toEqual({
      schemaVersion: 1,
      kind: 'pf01-harness-exit-failure',
      reason: 'normal-exit-not-established',
    });

    writeFileSync(lifecycleExitFailurePath(pathname), '{', 'utf8');
    expect(() => readHarnessExitFailure(pathname)).toThrow('exit failure invalid');
  });

  it('在同一已认证 harness 生命周期写入 normalExit 后返回', async () => {
    const pathname = lifecyclePath();
    writeLifecycle(pathname, false);
    setTimeout(() => writeLifecycle(pathname, true), 5);

    await expect(
      waitForHarnessLifecycleState({
        lifecyclePath: pathname,
        expectedNormalExit: true,
        expectedHarness: { pid: 42, binary: 'agent-config-manager', role: 'test-harness' },
        timeoutMs: 100,
        pollIntervalMs: 1,
      }),
    ).resolves.toEqual({
      pid: 42,
      binary: 'agent-config-manager',
      role: 'test-harness',
      normalExit: true,
    });
  });

  it('对缺失、身份不匹配或正常退出超时保持 fail-closed', async () => {
    const missing = lifecyclePath();
    await expect(
      waitForHarnessLifecycleState({
        lifecyclePath: missing,
        expectedNormalExit: false,
        timeoutMs: 5,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow('lifecycle state timeout');

    const mismatch = lifecyclePath();
    writeLifecycle(mismatch, true, 99);
    await expect(
      waitForHarnessLifecycleState({
        lifecyclePath: mismatch,
        expectedNormalExit: true,
        expectedHarness: { pid: 42, binary: 'agent-config-manager', role: 'test-harness' },
        timeoutMs: 5,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow('lifecycle identity mismatch');

    const malformed = lifecyclePath();
    writeFileSync(lifecycleExitRequestPath(malformed), '{', 'utf8');
    expect(() => readHarnessExitRequest(malformed)).toThrow('exit request invalid');
  });
});
