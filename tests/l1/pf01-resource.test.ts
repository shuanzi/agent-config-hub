import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime helper is a plain Node ESM module.
import { finalizeHarnessPeakRss, HarnessPeakRssSampler, parsePsRssTable, processTreeRssBytes, validatePf01ResourceEvidence } from '../../scripts/orchestrator/pf01-resource.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeLifecycle(
  pathname: string,
  { pid = 42, role = 'test-harness', normalExit = false } = {},
): void {
  writeFileSync(
    pathname,
    JSON.stringify({ pid, binary: 'agent-config-manager', role, normalExit }),
  );
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('PF-01 L3 peak RSS evidence', () => {
  it('接受全系统 ps 中合法的零 RSS 行，只汇总 harness 树的正 RSS', () => {
    const rows = parsePsRssTable(`
      1 0 0
      42 1 0
      43 42 7
      900 1 0
    `);

    expect(rows).toEqual([
      { pid: 1, parentPid: 0, rssBytes: 0 },
      { pid: 42, parentPid: 1, rssBytes: 0 },
      { pid: 43, parentPid: 42, rssBytes: 7 * 1024 },
      { pid: 900, parentPid: 1, rssBytes: 0 },
    ]);
    expect(processTreeRssBytes(rows, 42)).toBe(7 * 1024);
  });

  it('当 harness 树总 RSS 为零或 ps 数值非法时保持 fail-closed', () => {
    expect(() =>
      processTreeRssBytes(
        parsePsRssTable(`
          42 1 0
          43 42 0
        `),
        42,
      ),
    ).toThrow('tree RSS missing');

    for (const table of ['42 1 -1', '42 xx 7', '0 1 7', '42 9007199254740992 7']) {
      expect(() => parsePsRssTable(table)).toThrow('inconclusive');
    }
  });

  it('only accepts three complete, normally-exited harness-tree samples and records their max', () => {
    const runs = [
      { harnessPid: 101, samples: [100, 130, 110], normalExit: true },
      { harnessPid: 102, samples: [90, 150], normalExit: true },
      { harnessPid: 103, samples: [120, 125], normalExit: true },
    ];
    const evidence = finalizeHarnessPeakRss(runs);

    expect(evidence).toEqual({
      metric: 'pf01.l3.peak_rss_bytes',
      layer: 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）',
      sampling: {
        process: 'agent-config-manager harness PID and descendants only',
        intervalMs: 50,
        window: 'successful process start to normal exit',
      },
      rawPeakBytes: [130, 150, 125],
      maxBytes: 150,
    });
    expect(validatePf01ResourceEvidence(evidence)).toEqual({ valid: true });
  });

  it('fails closed when PID ownership, sampling, or normal exit cannot be established', () => {
    for (const runs of [
      [
        { harnessPid: null, samples: [100], normalExit: true },
        { harnessPid: 102, samples: [100], normalExit: true },
        { harnessPid: 103, samples: [100], normalExit: true },
      ],
      [
        { harnessPid: 101, samples: [], normalExit: true },
        { harnessPid: 102, samples: [100], normalExit: true },
        { harnessPid: 103, samples: [100], normalExit: true },
      ],
      [
        { harnessPid: 101, samples: [100], normalExit: false },
        { harnessPid: 102, samples: [100], normalExit: true },
        { harnessPid: 103, samples: [100], normalExit: true },
      ],
    ]) {
      expect(() => finalizeHarnessPeakRss(runs)).toThrow('inconclusive');
    }
    expect(
      validatePf01ResourceEvidence({
        metric: 'pf01.l3.peak_rss_bytes',
        layer: 'L2 mock renderer',
        sampling: {},
        rawPeakBytes: [1, 2, 3],
        maxBytes: 3,
      }),
    ).toEqual({ valid: false });
  });

  it('lifecycle 写入 normalExit 后停止采样，只使用退出前已认证的 samples', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acm-pf01-resource-'));
    temporaryRoots.push(root);
    const lifecyclePath = join(root, 'lifecycle.json');
    let readCalls = 0;
    const sampler = new HarnessPeakRssSampler({
      lifecyclePath,
      intervalMs: 60_000,
      readRows: async () => {
        readCalls += 1;
        return [{ pid: 42, parentPid: 1, rssBytes: 1024 }];
      },
    });
    writeFileSync(
      lifecyclePath,
      JSON.stringify({
        pid: 42,
        binary: 'agent-config-manager',
        role: 'test-harness',
        normalExit: false,
      }),
    );
    await sampler.capture();
    writeFileSync(
      lifecyclePath,
      JSON.stringify({
        pid: 42,
        binary: 'agent-config-manager',
        role: 'test-harness',
        normalExit: true,
      }),
    );
    await sampler.capture();

    expect(readCalls).toBe(1);
    await expect(sampler.finalize({ waitForLifecycleMs: 0 })).resolves.toEqual({
      harnessPid: 42,
      samples: [1024],
      normalExit: true,
    });
  });

  it('normalExit 边界的 PID 消失或零 RSS 不污染既有有效样本', async () => {
    for (const boundaryRows of [
      [{ pid: 1, parentPid: 0, rssBytes: 1024 }],
      [{ pid: 42, parentPid: 1, rssBytes: 0 }],
    ]) {
      const root = mkdtempSync(join(tmpdir(), 'acm-pf01-resource-'));
      temporaryRoots.push(root);
      const lifecyclePath = join(root, 'lifecycle.json');
      const boundaryRead = deferred<typeof boundaryRows>();
      let readCalls = 0;
      const sampler = new HarnessPeakRssSampler({
        lifecyclePath,
        intervalMs: 60_000,
        readRows: async () => {
          readCalls += 1;
          return readCalls === 1
            ? [{ pid: 42, parentPid: 1, rssBytes: 1024 }]
            : boundaryRead.promise;
        },
      });
      writeLifecycle(lifecyclePath);
      await sampler.capture();

      const edgeCapture = sampler.capture();
      expect(readCalls).toBe(2);
      writeLifecycle(lifecyclePath, { normalExit: true });
      boundaryRead.resolve(boundaryRows);
      await edgeCapture;

      await expect(sampler.finalize({ waitForLifecycleMs: 0 })).resolves.toEqual({
        harnessPid: 42,
        samples: [1024],
        normalExit: true,
      });
    }
  });

  it('仍在运行时 PID 缺失、零样本或失真的 lifecycle 仍 fail-closed，并保留诊断字段', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acm-pf01-resource-'));
    temporaryRoots.push(root);
    const lifecyclePath = join(root, 'lifecycle.json');
    const missingPid = new HarnessPeakRssSampler({
      lifecyclePath,
      intervalMs: 60_000,
      readRows: async () => [{ pid: 1, parentPid: 0, rssBytes: 1024 }],
    });
    writeLifecycle(lifecyclePath);
    await missingPid.capture();
    await expect(missingPid.finalize({ waitForLifecycleMs: 0 })).rejects.toThrow(
      'harness PID absent from ps',
    );
    expect(missingPid.diagnosticRun()).toMatchObject({
      harnessPid: 42,
      samples: [],
      normalExit: false,
      failure: expect.stringContaining('harness PID absent from ps'),
    });

    const zeroSamplesPath = join(root, 'zero-samples.json');
    const zeroSamples = new HarnessPeakRssSampler({
      lifecyclePath: zeroSamplesPath,
      intervalMs: 60_000,
      readRows: async () => [{ pid: 42, parentPid: 1, rssBytes: 1024 }],
    });
    writeLifecycle(zeroSamplesPath, { normalExit: true });
    await zeroSamples.capture();
    await expect(zeroSamples.finalize({ waitForLifecycleMs: 0 })).rejects.toThrow(
      'sampling missing',
    );
    expect(zeroSamples.diagnosticRun()).toMatchObject({
      harnessPid: 42,
      samples: [],
      normalExit: true,
      failure: expect.stringContaining('sampling missing'),
    });

    const changedPidPath = join(root, 'changed-pid.json');
    const changedPid = new HarnessPeakRssSampler({
      lifecyclePath: changedPidPath,
      intervalMs: 60_000,
      readRows: async () => [{ pid: 42, parentPid: 1, rssBytes: 1024 }],
    });
    writeLifecycle(changedPidPath);
    await changedPid.capture();
    writeLifecycle(changedPidPath, { pid: 43 });
    await changedPid.capture();
    await expect(changedPid.finalize({ waitForLifecycleMs: 0 })).rejects.toThrow(
      'harness PID changed',
    );

    const invalidIdentityPath = join(root, 'invalid-identity.json');
    const invalidIdentity = new HarnessPeakRssSampler({
      lifecyclePath: invalidIdentityPath,
      intervalMs: 60_000,
      readRows: async () => [{ pid: 42, parentPid: 1, rssBytes: 1024 }],
    });
    writeLifecycle(invalidIdentityPath, { role: 'other' });
    await invalidIdentity.capture();
    await expect(invalidIdentity.finalize({ waitForLifecycleMs: 0 })).rejects.toThrow(
      'harness lifecycle identity invalid',
    );

    const samplingFailurePath = join(root, 'sampling-failure.json');
    const samplingFailure = new HarnessPeakRssSampler({
      lifecyclePath: samplingFailurePath,
      intervalMs: 60_000,
      readRows: async () => {
        throw new Error('ps invocation failed');
      },
    });
    writeLifecycle(samplingFailurePath);
    await samplingFailure.capture();
    await expect(samplingFailure.finalize({ waitForLifecycleMs: 0 })).rejects.toThrow(
      'ps invocation failed',
    );
  });

  it('重叠 tick 共用同一 in-flight capture，finalize 等待它后再认证 normalExit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acm-pf01-resource-'));
    temporaryRoots.push(root);
    const lifecyclePath = join(root, 'lifecycle.json');
    const delayedRows = deferred<Array<{ pid: number; parentPid: number; rssBytes: number }>>();
    let readCalls = 0;
    const sampler = new HarnessPeakRssSampler({
      lifecyclePath,
      intervalMs: 60_000,
      readRows: async () => {
        readCalls += 1;
        return delayedRows.promise;
      },
    });
    writeLifecycle(lifecyclePath);

    const firstTick = sampler.capture();
    const overlappingTick = sampler.capture();
    expect(readCalls).toBe(1);
    const finalized = sampler.finalize({ waitForLifecycleMs: 100 });
    writeLifecycle(lifecyclePath, { normalExit: true });
    delayedRows.resolve([{ pid: 42, parentPid: 1, rssBytes: 1024 }]);

    await Promise.all([firstTick, overlappingTick]);
    await expect(finalized).resolves.toEqual({
      harnessPid: 42,
      samples: [1024],
      normalExit: true,
    });
  });
});
