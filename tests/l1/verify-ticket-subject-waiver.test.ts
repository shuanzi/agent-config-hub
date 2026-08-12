import { describe, expect, it, vi } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { SUBJECT_WAIVER_EXECUTION_MODE, executeTicketStep, isSubjectWaiverPerfStep, planTicketExecutionSteps, subjectWaiverPf01BudgetState, ticketManifestExitCode } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// prettier-ignore
// @ts-expect-error runtime validator is a plain Node ESM module.
import { validateFe01Pf01SubjectWaiver } from '../../scripts/orchestrator/fe01-pf01-subject-waiver.mjs';

const ticket = {
  performance: {
    subjectWaiverPath: 'performance/waivers/fe-01-pf-01-subject-startup-p50.json',
  },
  steps: [
    { id: 'static', layer: 'L0', cmd: 'node', args: ['verify-static'] },
    { id: 'perf', layer: 'PF', cmd: 'node', args: ['perf'] },
  ],
};

describe('verify:ticket subject accepted-with-waiver execution seam', () => {
  it('closure exit-code mapping 仅将 accepted-with-waiver 映射为成功，不篡改 PF automatic fail/1', () => {
    expect(
      ticketManifestExitCode('accepted-with-waiver', {
        ticketId: 'FE-01',
        exactSubjectWaiver: true,
      }),
    ).toBe(0);
    expect(ticketManifestExitCode('accepted-with-waiver')).toBe(1);
    expect(
      ticketManifestExitCode('accepted-with-waiver', {
        ticketId: 'FE-02',
        exactSubjectWaiver: true,
      }),
    ).toBe(1);
    expect(ticketManifestExitCode('pass')).toBe(0);
    expect(ticketManifestExitCode('inconclusive')).toBe(2);
    expect(ticketManifestExitCode('fail')).toBe(1);
    expect(ticketManifestExitCode('unknown')).toBe(1);
  });

  it('仅本次 exact validated record 才将 perf 改为 historical no-sampling fail/1', async () => {
    const validation = validateFe01Pf01SubjectWaiver();
    const perf = planTicketExecutionSteps({
      ticketId: 'FE-01',
      ticket,
      subjectWaiverValidation: validation,
    }).find((step: { id: string }) => step.id === 'perf');

    expect(perf).toMatchObject({
      executionMode: SUBJECT_WAIVER_EXECUTION_MODE,
      samplingRun: false,
      historicalRunId: '20260812T035717854Z-p74069-000',
      initialWaiverValidation: 'valid',
    });
    expect(isSubjectWaiverPerfStep(perf)).toBe(true);
    const runStepImpl = vi.fn(async () => {
      throw new Error('subject waiver must not sample');
    });
    await expect(executeTicketStep({ step: perf, runStepImpl })).resolves.toMatchObject({
      exitCode: 1,
      historical: true,
    });
    expect(runStepImpl).not.toHaveBeenCalled();
  });

  it('invalid record 或旧 waiver path 都保留真实 perf sampling', () => {
    const invalid = { ...validateFe01Pf01SubjectWaiver(), valid: false };
    const oldWaiverTicket = {
      ...ticket,
      performance: { subjectWaiverPath: 'performance/waivers/fe-01-pf-01-l3-cold-start.json' },
    };
    for (const candidate of [invalid, undefined]) {
      const perf = planTicketExecutionSteps({
        ticketId: 'FE-01',
        ticket,
        subjectWaiverValidation: candidate,
      }).find((step: { id: string }) => step.id === 'perf');
      expect(perf).not.toHaveProperty('executionMode');
    }
    expect(
      planTicketExecutionSteps({
        ticketId: 'FE-01',
        ticket: oldWaiverTicket,
        subjectWaiverValidation: validateFe01Pf01SubjectWaiver(),
      }).find((step: { id: string }) => step.id === 'perf'),
    ).not.toHaveProperty('executionMode');
  });

  it('subject budget state 保留 automated fail，不将其改写为 automatic pass', () => {
    const validation = validateFe01Pf01SubjectWaiver();
    expect(
      subjectWaiverPf01BudgetState({
        subjectWaiverCompletion: {
          finalSubjectWaiverValidation: validation,
          finalSubjectWaiverValidationStatus: 'valid',
          bindingStable: true,
        },
      }),
    ).toMatchObject({
      status: 'accepted-with-waiver',
      automaticResult: { status: 'fail', exitCode: 1 },
    });
  });
});
