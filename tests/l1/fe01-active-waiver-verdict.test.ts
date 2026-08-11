import { describe, expect, it } from 'vitest';

// @ts-expect-error active waiver verdict is a plain Node ESM module.
import { deriveFe01ActiveWaiverClosureStatus } from '../../scripts/orchestrator/fe01-active-waiver-verdict.mjs';
// @ts-expect-error active waiver verdict is a plain Node ESM module.
import { FE01_ACTIVE_WAIVER_CLOSURE_STEPS } from '../../scripts/orchestrator/fe01-active-waiver-verdict.mjs';

const waiver = {
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

describe('FE-01 active waiver verdict', () => {
  it('仅把精确 historical PF fail 与其余六个实际 pass 转成 accepted-with-waiver', () => {
    expect(
      deriveFe01ActiveWaiverClosureStatus({
        ticketId: 'FE-01',
        steps: FE01_ACTIVE_WAIVER_CLOSURE_STEPS,
        budgetStatus: 'pass',
        evidenceContaminated: false,
        worktreeDirty: false,
        waiverValidation: waiver,
      }),
    ).toEqual({ status: 'accepted-with-waiver', waivedStepId: 'perf' });
  });

  it('对 old waiver、漂移、非 PF 失败、dirty 或 contamination 保持 ordinary fail/inconclusive', () => {
    const base = {
      ticketId: 'FE-01',
      steps: FE01_ACTIVE_WAIVER_CLOSURE_STEPS,
      budgetStatus: 'pass',
      evidenceContaminated: false,
      worktreeDirty: false,
      waiverValidation: waiver,
    } as const;
    for (const waiverValidation of [
      { ...waiver, waiverPath: 'performance/waivers/fe-01-pf-01-l3-cold-start.json' },
      { ...waiver, valid: false },
      {
        ...waiver,
        automaticResult: { ...waiver.automaticResult, runId: '20260811T000000000Z-p0-000' },
      },
      {
        ...waiver,
        automaticResult: {
          ...waiver.automaticResult,
          violation: { ...waiver.automaticResult.violation, observedMs: 11.646 },
        },
      },
    ]) {
      expect(deriveFe01ActiveWaiverClosureStatus({ ...base, waiverValidation })).toEqual({
        status: 'fail',
        waivedStepId: null,
      });
    }
    expect(
      deriveFe01ActiveWaiverClosureStatus({
        ...base,
        steps: base.steps.map((step: { id: string; status: string; exitCode: number }) =>
          step.id === 'ui' ? { ...step, exitCode: 1 } : step,
        ),
      }),
    ).toEqual({ status: 'fail', waivedStepId: null });
    expect(deriveFe01ActiveWaiverClosureStatus({ ...base, worktreeDirty: true })).toEqual({
      status: 'inconclusive',
      waivedStepId: null,
    });
    expect(deriveFe01ActiveWaiverClosureStatus({ ...base, evidenceContaminated: true })).toEqual({
      status: 'inconclusive',
      waivedStepId: null,
    });
  });

  it('起止 validator 任一无效或 binding 漂移时，不能把初始 historical fail 升格为 accepted', () => {
    const base = {
      ticketId: 'FE-01',
      steps: FE01_ACTIVE_WAIVER_CLOSURE_STEPS,
      budgetStatus: 'pass',
      evidenceContaminated: false,
      worktreeDirty: false,
      waiverValidation: waiver,
      initialWaiverValidation: waiver,
      finalWaiverValidation: waiver,
    } as const;
    for (const finalWaiverValidation of [
      { ...waiver, valid: false },
      {
        ...waiver,
        automaticResult: {
          ...waiver.automaticResult,
          violation: { ...waiver.automaticResult.violation, observedMs: 11.646 },
        },
      },
    ]) {
      expect(deriveFe01ActiveWaiverClosureStatus({ ...base, finalWaiverValidation })).not.toEqual({
        status: 'accepted-with-waiver',
        waivedStepId: 'perf',
      });
    }
  });
});
