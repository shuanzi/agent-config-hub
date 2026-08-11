/** PF-01 的 FE-01-only acceptance correction：选择 Skill 行只展示结构化只读 cells。 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const descriptorPath = resolve('performance/descriptors/pf-01.catalog-browse.json');

function descriptorDigest(raw: string, value: string): string {
  return createHash('sha256')
    .update(raw.replace(`"value": "${value}"`, '"value": ""'), 'utf8')
    .digest('hex');
}

describe('PF-01 descriptor', () => {
  it('将选择指标限制为四个只读 Skill Agent cells，不读取源码', () => {
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as {
      metrics: Array<{ id: string; definition: string }>;
    };
    const ids = descriptor.metrics.map((metric) => metric.id);
    expect(ids).toContain('pf01.select.skill_cells_visible');
    expect(ids).not.toContain('pf01.select.source_visible');
    const select = descriptor.metrics.find(
      (metric) => metric.id === 'pf01.select.skill_cells_visible',
    );
    expect(select?.definition).toBe(
      '点击 Skill 行（真实 WebDriver click）→ 结构化只读详情与四个固定 Agent cells 可见',
    );
    expect(select?.definition).not.toMatch(/源码|source/i);
  });

  it('预算语义稳定描述 clean-manifest gate，而不把采样前后状态硬编码为未冻结', () => {
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as {
      budgetStatus: string;
      budgetNote: string;
    };
    expect(descriptor.budgetStatus).toEqual('formula-authorized / clean-manifest-gated');
    expect(descriptor.budgetNote).toMatch(/首次.*inconclusive/);
    expect(descriptor.budgetNote).toMatch(/独立人工审核/);
    expect(descriptor.budgetNote).toMatch(/绝不生成版本化预算/);
    expect(descriptor.budgetStatus).not.toMatch(/authoritative-baseline-required/);
  });

  it('将独立的版本化 measurementInputs 方法学写入 descriptor，不把它混同为 harness buildInputs', () => {
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as {
      measurementInputs?: { schemaVersion: number; algorithm: string; responsibility: string };
    };
    expect(descriptor.measurementInputs).toEqual({
      schemaVersion: 1,
      algorithm: 'pf01-measurement-inputs-v1',
      responsibility:
        '独立固定 L2 实际 Vite module closure、PF/L3 WDIO、cold-start/RSS、统计与预算比较、collector 与显式 freeze 输入；不替代 L3 harness buildInputs 或 binary SHA。',
    });
  });

  it('将 startup 计为首屏代表性列表行真实可见，并固定 L2 layer、selector 与自描述 digest', () => {
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as {
      metrics: Array<{ id: string; definition: string; layer?: string; selector?: string }>;
      digest: { value: string };
    };
    const startup = descriptor.metrics.find(
      (metric) => metric.id === 'pf01.startup.first_list_visible',
    );
    expect(startup).toMatchObject({
      definition:
        '测试入口模块求值（User Timing 起点）→ 首屏代表性 `.list-pane [role="option"]` DOM 行真正可见',
      layer: 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
      selector: '.list-pane [role="option"]',
    });
    expect(descriptorDigest(readFileSync(descriptorPath, 'utf8'), descriptor.digest.value)).toBe(
      descriptor.digest.value,
    );
  });
});
