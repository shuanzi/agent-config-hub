import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime registry module is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';

describe('FE-01 ticket registry', () => {
  it('将未冻结预算准确表述为首次完整 clean baseline 只收集样本但本次仍 inconclusive', () => {
    expect(TICKET_REGISTRY['FE-01'].performance.unfrozenLabel).toBe(
      'budget-not-frozen（首次完整 clean representative baseline 只收集样本；该次仍为 inconclusive）',
    );
  });

  it('保留 historical waiver 审计，并且只登记本次精确 active waiver 路径', () => {
    expect(TICKET_REGISTRY['FE-01'].performance.historicalWaiverPath).toBe(
      'performance/waivers/fe-01-pf-01-l3-cold-start.json',
    );
    expect(TICKET_REGISTRY['FE-01'].performance.activeWaiverPath).toBe(
      'performance/waivers/fe-01-pf-01-search-results-active.json',
    );
    expect(
      TICKET_REGISTRY['FE-01'].steps.find((step: { id: string }) => step.id === 'perf'),
    ).toMatchObject({
      cmd: 'node',
      args: ['scripts/orchestrator/perf.mjs', 'PF-01'],
    });
    expect(TICKET_REGISTRY['FE-07R'].performance).toBeUndefined();
  });
});
