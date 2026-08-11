import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime PF result seam is a plain Node ESM module.
import { derivePf01AutomatedResult } from '../../scripts/orchestrator/pf01-automated-result.mjs';

describe('PF-01 versioned automated result', () => {
  it('封闭区分 baseline/incomplete exit 2、invalid/over-budget exit 1 与完整 comparison exit 0', () => {
    expect(
      derivePf01AutomatedResult({
        complete: false,
        budgetExistedBeforeRun: true,
        budgetValid: true,
        comparisonViolations: [],
      }),
    ).toEqual({ schemaVersion: 1, status: 'inconclusive', exitCode: 2 });
    expect(
      derivePf01AutomatedResult({
        complete: true,
        budgetExistedBeforeRun: false,
        budgetValid: false,
        comparisonViolations: [],
      }),
    ).toEqual({ schemaVersion: 1, status: 'inconclusive', exitCode: 2 });
    expect(
      derivePf01AutomatedResult({
        complete: true,
        budgetExistedBeforeRun: true,
        budgetValid: false,
        comparisonViolations: [],
      }),
    ).toEqual({ schemaVersion: 1, status: 'fail', exitCode: 1 });
    expect(
      derivePf01AutomatedResult({
        complete: true,
        budgetExistedBeforeRun: true,
        budgetValid: true,
        comparisonViolations: ['p95 ceiling'],
      }),
    ).toEqual({ schemaVersion: 1, status: 'fail', exitCode: 1 });
    expect(
      derivePf01AutomatedResult({
        complete: true,
        budgetExistedBeforeRun: true,
        budgetValid: true,
        comparisonViolations: [],
      }),
    ).toEqual({ schemaVersion: 1, status: 'pass', exitCode: 0 });
  });
});
