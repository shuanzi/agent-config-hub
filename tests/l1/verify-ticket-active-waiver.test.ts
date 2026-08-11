import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { executeTicketStep } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { finalizeActiveWaiverValidation } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { historicalPf01BudgetState } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { planTicketExecutionSteps } from '../../scripts/orchestrator/verify-ticket-execution.mjs';

const activeValidation = {
  valid: true,
  waiverPath: 'performance/waivers/fe-01-pf-01-search-results-active.json',
  waiverSha256: '7136c2ac32210c366ba417e03618f76435a0df50517f641deaced9984b6651ae',
  manualDisposition: 'accepted-with-waiver',
  automaticResult: {
    status: 'fail',
    exitCode: 1,
    runId: '20260811T112008912Z-p30755-000',
    commit: 'ef1fd9823d286616ed108576c543b6f4980b5fcd',
    worktreeDirty: false,
    violation: {
      metric: 'pf01.search.results_visible',
      statistic: 'p95',
      observedMs: 11.645,
      thresholdMs: 10,
      deltaMs: 1.645,
    },
  },
};

const ticket = {
  performance: {
    activeWaiverPath: 'performance/waivers/fe-01-pf-01-search-results-active.json',
  },
  steps: [
    { id: 'ui', layer: 'L2', cmd: 'corepack', args: ['npm', 'run', 'test:ui'] },
    { id: 'perf', layer: 'PF', cmd: 'node', args: ['scripts/orchestrator/perf.mjs', 'PF-01'] },
  ],
};

describe('verify:ticket active-waiver execution seam', () => {
  it('仅在 registry path 与精确已验证 record 匹配时把 perf 变为 historical-artifact-validation，且不调用 sampling', async () => {
    const steps = planTicketExecutionSteps({
      ticketId: 'FE-01',
      ticket,
      waiverValidation: activeValidation,
    });
    const perf = steps.find((step: { id: string }) => step.id === 'perf');
    expect(perf).toMatchObject({
      executionMode: 'historical-artifact-validation',
      samplingRun: false,
      historicalRunId: '20260811T112008912Z-p30755-000',
    });
    const runStepImpl = vi.fn(async () => {
      throw new Error('perf sampling must not start');
    });
    await expect(executeTicketStep({ step: perf, runStepImpl })).resolves.toMatchObject({
      exitCode: 1,
      timedOut: false,
      historical: true,
    });
    expect(runStepImpl).not.toHaveBeenCalled();
  });

  it('只要 FE-01 registry 配置 active waiver，初始 invalid 也绝不回退 perf sampling', async () => {
    for (const waiverValidation of [
      undefined,
      { ...activeValidation, valid: false },
      {
        ...activeValidation,
        waiverPath: 'performance/waivers/fe-01-pf-01-l3-cold-start.json',
      },
    ]) {
      const perf = planTicketExecutionSteps({ ticketId: 'FE-01', ticket, waiverValidation }).find(
        (step: { id: string }) => step.id === 'perf',
      );
      expect(perf).toMatchObject({
        executionMode: 'historical-artifact-validation',
        samplingRun: false,
      });
      const runStepImpl = vi.fn(async () => {
        throw new Error('invalid active waiver must not restart PF');
      });
      await expect(executeTicketStep({ step: perf, runStepImpl })).resolves.toMatchObject({
        historical: true,
      });
      expect(runStepImpl).not.toHaveBeenCalled();
    }

    const pathMismatchTicket = {
      ...ticket,
      performance: {
        activeWaiverPath: 'performance/waivers/fe-01-pf-01-l3-cold-start.json',
      },
    };
    const perf = planTicketExecutionSteps({
      ticketId: 'FE-01',
      ticket: pathMismatchTicket,
      waiverValidation: activeValidation,
    }).find((step: { id: string }) => step.id === 'perf');
    expect(perf).toMatchObject({
      executionMode: 'historical-artifact-validation',
      samplingRun: false,
      historicalRunId: null,
      initialWaiverValidation: 'invalid',
    });
  });

  it('只在结束时重新校验仍为同一精确 binding 时才保留 valid；record/run 漂移一律拒绝', () => {
    const finalInvalid = {
      ...activeValidation,
      valid: false,
      automaticResult: {
        ...activeValidation.automaticResult,
        violation: { ...activeValidation.automaticResult.violation, observedMs: 11.646 },
      },
    };
    const validateActiveWaiver = vi.fn(() => finalInvalid);
    expect(
      finalizeActiveWaiverValidation({
        initialWaiverValidation: activeValidation,
        validateActiveWaiver,
      }),
    ).toEqual({
      finalWaiverValidation: finalInvalid,
      finalWaiverValidationStatus: 'invalid',
      bindingStable: false,
    });
    expect(validateActiveWaiver).toHaveBeenCalledTimes(1);
  });

  it('registry active waiver path 不精确时不重采样，且不调用 validator 或产生可接受 binding', () => {
    const validateActiveWaiver = vi.fn(() => activeValidation);
    expect(
      finalizeActiveWaiverValidation({
        initialWaiverValidation: activeValidation,
        validateActiveWaiver,
        activeWaiverPathExact: false,
      }),
    ).toEqual({
      finalWaiverValidation: undefined,
      finalWaiverValidationStatus: 'invalid',
      bindingStable: false,
    });
    expect(validateActiveWaiver).not.toHaveBeenCalled();
  });

  it('historical budget state 仅在起止 binding 均 exact stable 时报告 pass/valid', () => {
    const stable = finalizeActiveWaiverValidation({
      initialWaiverValidation: activeValidation,
      validateActiveWaiver: () => activeValidation,
    });
    expect(
      historicalPf01BudgetState({
        initialWaiverValidation: activeValidation,
        waiverCompletion: stable,
      }),
    ).toMatchObject({
      status: 'pass',
      validation: { valid: true, violations: [] },
    });

    expect(
      historicalPf01BudgetState({
        initialWaiverValidation: { valid: false, violations: ['initial drift'] },
        waiverCompletion: {
          finalWaiverValidation: { valid: false, violations: ['final drift'] },
          finalWaiverValidationStatus: 'invalid',
          bindingStable: false,
        },
      }),
    ).toMatchObject({
      status: 'fail',
      validation: {
        valid: false,
        violations: expect.arrayContaining([
          'initial drift',
          'final drift',
          'active waiver 起止 binding 不精确或发生漂移',
        ]),
      },
    });
  });

  it('没有 active waiver 配置的普通 ticket 才保留 automatic perf sampling', () => {
    const ordinary = { ...ticket, performance: {} };
    const perf = planTicketExecutionSteps({
      ticketId: 'FE-01',
      ticket: ordinary,
      waiverValidation: undefined,
    }).find((step: { id: string }) => step.id === 'perf');
    expect(perf).toMatchObject({
      cmd: 'node',
      args: ['scripts/orchestrator/perf.mjs', 'PF-01'],
    });
    expect(perf).not.toHaveProperty('executionMode');
  });
});
