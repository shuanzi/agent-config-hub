import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Descriptor = {
  metrics: Array<{ id: string; minSamplesByProfile: { representative: number; stress: number } }>;
};

function descriptor(relativePath: string): Descriptor {
  return JSON.parse(readFileSync(resolve(relativePath), 'utf8')) as Descriptor;
}

describe('PF-02/PF-03 L2 collector contract', () => {
  it('只为六项只读 metric 写入最小、脱敏的 samples payload，并以页面内 User Timing/DOM 稳定取样', () => {
    const source = readFileSync(resolve('performance/pf-read.collector.test.ts'), 'utf8');
    const metrics = [
      ...descriptor('performance/descriptors/pf-02.source-large.json').metrics,
      ...descriptor('performance/descriptors/pf-03.multifile-workbench.json').metrics,
    ];

    for (const metric of metrics) {
      expect(source).toContain(metric.id);
      expect(metric.minSamplesByProfile).toEqual({ representative: 20, stress: 10 });
    }
    expect(source).toContain('samples.json');
    expect(source).toMatch(/schemaVersion\s*:\s*1/);
    expect(source).toMatch(/descriptorId/);
    expect(source).toMatch(/profile/);
    expect(source).toMatch(/unit\s*:\s*['"]ms['"]/);
    expect(source).toMatch(/performance\.mark/);
    expect(source).toMatch(/performance\.measure/);
    expect(source).toContain('MutationObserver');
    expect((source.match(/requestAnimationFrame/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/restorePreState/);
    expect(source).toMatch(/重复选择|alreadySelected|sameSelected|repeat.*selected/i);
    expect(source).toMatch(/native-file-text/);
    expect(source).toMatch(/detail-panel/);
    expect(source).toMatch(/scrollTop/);
    expect(source).toMatch(/native-file-tree/);
    expect(source).not.toMatch(/Date\.now|browser\.pause/);

    const visibilityIntent = source.match(
      /async function dispatchVisibilityIntent[\s\S]*?(?=\/\*\* PF-02 scroll)/,
    )?.[0];
    const scrollIntent = source.match(
      /async function armScrollProbe[\s\S]*?(?=async function awaitProbeMs)/,
    )?.[0];
    const measuredCallSites = source.slice(source.indexOf('describe(`${DESCRIPTOR_ID}'));
    expect(visibilityIntent).toBeDefined();
    expect(scrollIntent).toBeDefined();
    expect(visibilityIntent).toContain('await browser.execute');
    expect(visibilityIntent).toContain('row.click()');
    expect(visibilityIntent).toContain('item.click()');
    expect(visibilityIntent?.indexOf('performance.mark')).toBeLessThan(
      visibilityIntent?.indexOf('row.click()') ?? -1,
    );
    expect(visibilityIntent?.indexOf('performance.mark')).toBeLessThan(
      visibilityIntent?.indexOf('item.click()') ?? -1,
    );
    expect(scrollIntent).toContain('await browser.execute');
    expect(scrollIntent?.indexOf('performance.mark')).toBeLessThan(
      scrollIntent?.indexOf('panel.scrollTop') ?? -1,
    );
    expect(measuredCallSites).not.toContain('await clickTreeFile');
    expect(measuredCallSites).not.toContain('await $(\'[role="option"]\').click');
    expect(measuredCallSites).toContain("restorePreState('secondaryText')");
    expect(measuredCallSites).toContain('pf02PrimaryTextBytes(metadata)');
  });

  it('使用独立 read WDIO config 与三项显式 env；共享 PF-01 config 不接触 read routing', () => {
    const readConfig = readFileSync(resolve('performance/wdio.read.conf.ts'), 'utf8');
    const pf01Config = readFileSync(resolve('performance/wdio.conf.ts'), 'utf8');

    expect(readConfig).toContain('PF_READ_DESCRIPTOR_ID');
    expect(readConfig).toContain('PF_READ_PROFILE');
    expect(readConfig).toContain('PF_READ_OUTPUT_DIR');
    expect(readConfig).toContain('pf-read.collector.test.ts');
    expect(pf01Config).not.toMatch(/PF_READ_|pf-read\.collector\.test/);
    expect(pf01Config).toBe(
      execFileSync('git', ['show', 'HEAD:performance/wdio.conf.ts'], { encoding: 'utf8' }),
    );
    expect(
      readdirSync(resolve('performance'))
        .filter((entry) => entry.endsWith('.perf.test.ts'))
        .sort(),
    ).toEqual(['pf-01.perf.test.ts']);
  });
});
