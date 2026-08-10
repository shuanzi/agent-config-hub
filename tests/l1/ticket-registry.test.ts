import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime registry module is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';

describe('FE-01 ticket registry', () => {
  it('将未冻结预算准确表述为首次完整 clean baseline 生成预算但本次仍 inconclusive', () => {
    expect(TICKET_REGISTRY['FE-01'].performance.unfrozenLabel).toBe(
      'budget-not-frozen（首次完整 clean representative baseline 生成预算；该次仍为 inconclusive）',
    );
  });
});
