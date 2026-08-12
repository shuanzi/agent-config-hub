import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PF-01 proposed-budgets lifecycle copy', () => {
  it('已有 frozen budget 的比较失败不再被描述为首次 baseline 或 inconclusive', () => {
    const source = fs.readFileSync('scripts/orchestrator/perf.mjs', 'utf8');

    expect(source).toContain('proposed-after-frozen-budget-comparison-failed');
    expect(source).toContain('已有 frozen budget 的比较失败');
    expect(source).not.toContain(
      '首次 clean baseline 只收集样本；须独立人工审核后才可冻结，绝不据此关闭性能验收。',
    );
  });

  it('已有有效 frozen budget 但 automated comparison inconclusive 时明确为不完整且不可比较', () => {
    const source = fs.readFileSync('scripts/orchestrator/perf.mjs', 'utf8');

    expect(source).toContain('proposed-after-frozen-budget-comparison-inconclusive');
    expect(source).toContain('已有 frozen budget，但本次自动比较不完整且不可比较');
    expect(source.indexOf("automatedResult.status === 'inconclusive'")).toBeLessThan(
      source.indexOf("automatedResult.status === 'fail'"),
    );
  });
});
