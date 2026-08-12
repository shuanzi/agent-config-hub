import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime registry module is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';

describe('FE-01 ticket registry', () => {
  it('将未冻结预算准确表述为首次完整 clean baseline 只收集样本但本次仍 inconclusive', () => {
    expect(TICKET_REGISTRY['FE-01'].performance.unfrozenLabel).toBe(
      'budget-not-frozen（首次完整 clean representative baseline 只收集样本；该次仍为 inconclusive）',
    );
  });

  it('旧 waiver 仅保留为历史审计；本次 subject waiver 与未来 automatic-pass 都使用独立路径', () => {
    expect(TICKET_REGISTRY['FE-01'].performance.historicalWaiverPath).toBe(
      'performance/waivers/fe-01-pf-01-l3-cold-start.json',
    );
    expect(TICKET_REGISTRY['FE-01'].performance.historicalActiveWaiverPath).toBe(
      'performance/waivers/fe-01-pf-01-search-results-active.json',
    );
    expect(TICKET_REGISTRY['FE-01'].performance.activeWaiverPath).toBeUndefined();
    expect(TICKET_REGISTRY['FE-01'].performance.subjectWaiverPath).toBe(
      'performance/waivers/fe-01-pf-01-subject-startup-p50.json',
    );
    expect(TICKET_REGISTRY['FE-01'].performance.automaticPassPath).toBe(
      'performance/automatic-passes/fe-01-pf-01.json',
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
