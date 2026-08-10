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
});
