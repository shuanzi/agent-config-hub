/** PF-01 的 FE-01-only acceptance correction：选择 Skill 行只展示结构化只读 cells。 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const descriptorPath = resolve('performance/descriptors/pf-01.catalog-browse.json');

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
    expect(descriptor.budgetNote).toMatch(/独立 clean rerun/);
    expect(descriptor.budgetStatus).not.toMatch(/authoritative-baseline-required/);
  });
});
