import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { freezePf01Budget } from '../../scripts/orchestrator/pf01-budget.mjs';

describe('PF-01 frozen representative budget', () => {
  it('仅以完整实际统计生成预算，严格应用授权公式', () => {
    const descriptor = { descriptorId: 'PF-01', digest: { value: 'd'.repeat(64) } };
    const budget = freezePf01Budget({
      descriptor,
      profile: 'representative',
      metrics: Object.fromEntries(
        [
          'pf01.startup.first_list_visible',
          'pf01.search.results_visible',
          'pf01.filter.results_visible',
          'pf01.select.skill_cells_visible',
          'pf01.l3.cold_start.first_snapshot',
        ].map((metric) => [
          metric,
          {
            p50: 10,
            p95: 12,
            n: metric === 'pf01.startup.first_list_visible' ? 5 : metric.includes('.l3.') ? 3 : 20,
          },
        ]),
      ),
      baselineProvenance: { run: 'actual-run' },
    });
    expect(budget.descriptorId).toBe('PF-01');
    expect(budget.profile).toBe('representative');
    expect(budget.formula).toEqual({
      absoluteCeilingMs: 'ceil(p95 * 1.5 / 10) * 10',
      regressionAllowance: 'current p50 <= baseline p50 * 1.25',
    });
    expect(budget.budgets).toHaveLength(5);
    for (const entry of budget.budgets) {
      expect(entry.metric).toMatch(/^pf01\./);
      expect(entry.layer).toMatch(/^L[23] /);
      expect(entry.baseline.n).toBeGreaterThan(0);
      expect(entry.absoluteCeilingMs).toBe(Math.ceil((entry.baseline.p95 * 1.5) / 10) * 10);
      expect(entry.regressionAllowance).toEqual({ relativeTo: 'baseline-p50', maxRatio: 1.25 });
    }
  });

  it('样本不完整时拒绝生成预算', () => {
    expect(() =>
      freezePf01Budget({
        descriptor: { digest: { value: 'd'.repeat(64) } },
        profile: 'representative',
        metrics: {},
        baselineProvenance: {},
      }),
    ).toThrow('baseline metric incomplete');
  });
});
