import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Profile = Record<string, number | string>;
type Metric = {
  id: string;
  definition: string;
  selector: string;
  layer: string;
  minSamplesByProfile: Record<string, number>;
};
type Descriptor = {
  descriptorId: string;
  name: string;
  schemaVersion: number;
  seed: number;
  shapeDimensions: Record<string, string>;
  profiles: Record<string, Profile>;
  contentRules: string[];
  metrics: Metric[];
  budgetFormula: Record<string, string>;
  budgetStatus: string;
  fixture: {
    generator: string;
    algorithm: string;
    canonicalization: string;
    profileDigests: Record<string, string>;
  };
  digest: { algorithm: string; value: string };
};

const layer = 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）';
const formula = {
  absoluteCeilingMs: 'ceil(p95 * 1.5 / 10) * 10',
  regressionAllowance: 'current p50 <= baseline p50 * 1.25',
};

function readDescriptor(relativePath: string): { raw: string; descriptor: Descriptor } {
  const raw = readFileSync(resolve(relativePath), 'utf8');
  return { raw, descriptor: JSON.parse(raw) as Descriptor };
}

function digest(raw: string, value: string): string {
  return createHash('sha256')
    .update(raw.replace(`"value": "${value}"`, '"value": ""'), 'utf8')
    .digest('hex');
}

function expectSharedContract(raw: string, descriptor: Descriptor): void {
  expect(Object.keys(descriptor).sort()).toEqual(
    [
      'budgetFormula',
      'budgetStatus',
      'contentRules',
      'descriptorId',
      'digest',
      'fixture',
      'metrics',
      'name',
      'profiles',
      'schemaVersion',
      'seed',
      'shapeDimensions',
    ].sort(),
  );
  expect(descriptor.schemaVersion).toBe(1);
  expect(descriptor.budgetFormula).toEqual(formula);
  expect(descriptor.digest.algorithm).toBe('sha256');
  expect(descriptor.digest.value).toMatch(/^[a-f0-9]{64}$/);
  expect(digest(raw, descriptor.digest.value)).toBe(descriptor.digest.value);
  expect(Object.keys(descriptor.fixture).sort()).toEqual(
    ['generator', 'algorithm', 'canonicalization', 'profileDigests'].sort(),
  );
  expect(descriptor.fixture.algorithm).toBe('sha256');
  expect(descriptor.fixture.canonicalization).not.toBe('');
  expect(descriptor.fixture.canonicalization).toMatch(/workbench/);
  expect(descriptor.fixture.canonicalization).toMatch(/detail/);
  expect(descriptor.fixture.canonicalization).toMatch(/files/);
  expect(descriptor.fixture.canonicalization).not.toMatch(
    /\{ descriptorId, profile, seed, shape \}/,
  );
  expect(descriptor.fixture.profileDigests).toEqual({
    representative: expect.stringMatching(/^[a-f0-9]{64}$/),
    stress: expect.stringMatching(/^[a-f0-9]{64}$/),
  });

  expect(descriptor.metrics).toHaveLength(3);
  for (const metric of descriptor.metrics) {
    expect(metric.layer).toBe(layer);
    expect(metric.minSamplesByProfile).toEqual({ representative: 20, stress: 10 });
    expect(metric.definition).toMatch(/页内/);
    expect(metric.definition).toMatch(/rAF/);
    expect(metric.definition).not.toMatch(/WebDriver.*roundtrip|roundtrip.*WebDriver/i);
  }

  const rules = descriptor.contentRules.join('\n');
  expect(rules).toMatch(/确定性/);
  expect(rules).toMatch(/synthetic/i);
  expect(rules).toMatch(/敏感.*遮蔽|遮蔽.*敏感/);
  expect(rules).toMatch(/未知字段/);
  expect(rules).toMatch(/注释/);
  expect(rules).toMatch(/Hook/);
  expect(rules).toMatch(/可执行/);
  expect(rules).toMatch(/edit/);
  expect(rules).toMatch(/draft/);
  expect(rules).toMatch(/写入/);
  expect(rules).not.toMatch(/\bL3\b|\bRSS\b/);
  expect(raw).not.toMatch(/SYNTHETIC-SECRET-|\/Users\/|file:\/\/|\.git\b/i);
}

describe('PF-02/PF-03 descriptor contract', () => {
  it('PF-02 精确声明大只读源码 profile、三项 DOM+rAF/User Timing 指标和安全输入边界', () => {
    const { raw, descriptor } = readDescriptor('performance/descriptors/pf-02.source-large.json');

    expectSharedContract(raw, descriptor);
    expect(descriptor).toMatchObject({
      descriptorId: 'PF-02',
      name: 'source-large',
      seed: 2026081402,
    });
    expect(Object.keys(descriptor.shapeDimensions).sort()).toEqual(
      [
        'textBytes',
        'lineCount',
        'longestLineBytes',
        'unknownFieldCount',
        'commentCount',
        'maskedSensitiveSegmentCount',
      ].sort(),
    );
    expect(descriptor.profiles).toEqual({
      representative: {
        textBytes: 262144,
        lineCount: 4096,
        longestLineBytes: 512,
        unknownFieldCount: 8,
        commentCount: 128,
        maskedSensitiveSegmentCount: 16,
      },
      stress: {
        textBytes: 1048576,
        lineCount: 16384,
        longestLineBytes: 2048,
        unknownFieldCount: 32,
        commentCount: 512,
        maskedSensitiveSegmentCount: 64,
      },
    });
    expect(descriptor.metrics.map(({ id, selector }) => ({ id, selector }))).toEqual([
      { id: 'pf02.source.open.content_visible', selector: '[data-testid="native-file-text"]' },
      { id: 'pf02.source.scroll.render_stable', selector: '.detail-panel' },
      {
        id: 'pf02.source.readonly_switch.content_visible',
        selector: '[data-testid="native-file-text"]',
      },
    ]);
    expect(descriptor.metrics[1]?.definition).toMatch(/native-file-text/);
    expect(descriptor.metrics[1]?.definition).toMatch(/detail-panel/);
    expect(descriptor.metrics[1]?.definition).toMatch(/scrollTop/);
    expect(descriptor.metrics[1]?.definition).toMatch(/两.*rAF|rAF.*两/);
  });

  it('PF-03 精确声明多文件只读 profile、零 dirty 和非文本 metadata 指标', () => {
    const { raw, descriptor } = readDescriptor(
      'performance/descriptors/pf-03.multifile-workbench.json',
    );

    expectSharedContract(raw, descriptor);
    expect(descriptor).toMatchObject({
      descriptorId: 'PF-03',
      name: 'multifile-workbench',
      seed: 2026081403,
    });
    expect(Object.keys(descriptor.shapeDimensions).sort()).toEqual(
      [
        'fileCount',
        'maxDirectoryDepth',
        'textFileCount',
        'nonTextFileCount',
        'totalBytes',
        'activePath',
        'dirtyFileCount',
      ].sort(),
    );
    expect(descriptor.profiles).toEqual({
      representative: {
        fileCount: 64,
        maxDirectoryDepth: 4,
        textFileCount: 48,
        nonTextFileCount: 16,
        totalBytes: 524288,
        activePath: 'nested/secondary/readme.md',
        dirtyFileCount: 0,
      },
      stress: {
        fileCount: 256,
        maxDirectoryDepth: 6,
        textFileCount: 192,
        nonTextFileCount: 64,
        totalBytes: 2097152,
        activePath: 'deep/nested/secondary/readme.md',
        dirtyFileCount: 0,
      },
    });
    expect(descriptor.metrics.map(({ id, selector }) => ({ id, selector }))).toEqual([
      { id: 'pf03.multifile.tree.visible', selector: '[data-testid="native-file-tree"]' },
      {
        id: 'pf03.multifile.text_switch.content_visible',
        selector: '[data-testid="native-file-text"]',
      },
      {
        id: 'pf03.multifile.nontext_switch.metadata_visible',
        selector: '[data-testid="native-file-nontext"]',
      },
    ]);
    expect(descriptor.metrics[0]?.definition).toMatch(/native-file-tree/);
    expect(descriptor.metrics[0]?.definition).toMatch(/detail.*pane|pane.*detail|详情/);
    expect(descriptor.metrics[0]?.definition).toMatch(/两.*rAF|rAF.*两/);
    expect(descriptor.contentRules.join('\n')).toMatch(/dirtyFileCount=0/);
    expect(descriptor.contentRules.join('\n')).toMatch(/metadata/);
  });

  it('将每个 profile 的 synthetic fixture identity 固定到指定 generator，且不把原始敏感值写入 descriptor', () => {
    const pf02 = readDescriptor('performance/descriptors/pf-02.source-large.json');
    const pf03 = readDescriptor('performance/descriptors/pf-03.multifile-workbench.json');

    expect(pf02.descriptor.fixture.generator).toBe(
      'src/gateway/pf-read-fixtures.ts#buildPf02SourceLargeFixture',
    );
    expect(pf03.descriptor.fixture.generator).toBe(
      'src/gateway/pf-read-fixtures.ts#buildPf03MultifileFixture',
    );
    for (const { descriptor } of [pf02, pf03]) {
      expect(descriptor.fixture.profileDigests).toEqual({
        representative: expect.stringMatching(/^[a-f0-9]{64}$/),
        stress: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    }
    expect(`${pf02.raw}\n${pf03.raw}`).not.toContain('SYNTHETIC-SECRET-');
  });
});
