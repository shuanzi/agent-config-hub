import { describe, expect, it, vi } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { SUBJECT_WAIVER_EXECUTION_MODE, executeTicketStep, isSubjectWaiverPerfStep, planTicketExecutionSteps, subjectWaiverPf02BudgetState, ticketManifestExitCode } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// prettier-ignore
// @ts-expect-error runtime validator is a plain Node ESM module.
import { validateFe02Pf02SubjectWaiver } from '../../scripts/orchestrator/fe02-pf02-subject-waiver.mjs';
// prettier-ignore
// @ts-expect-error runtime registry is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';

const ticket = TICKET_REGISTRY['FE-02'];

describe('verify:ticket FE-02 subject accepted-with-waiver execution seam', () => {
  it('closure exit-code mapping 将 FE-02 accepted-with-waiver 映射为成功，不篡改 PF automatic fail/1', () => {
    expect(
      ticketManifestExitCode('accepted-with-waiver', {
        ticketId: 'FE-02',
        exactSubjectWaiver: true,
      }),
    ).toBe(0);
    expect(
      ticketManifestExitCode('accepted-with-waiver', {
        ticketId: 'FE-02',
        exactSubjectWaiver: false,
      }),
    ).toBe(1);
    expect(ticketManifestExitCode('accepted-with-waiver', { ticketId: 'FE-02' })).toBe(1);
    // FE-01 既有行为不变。
    expect(
      ticketManifestExitCode('accepted-with-waiver', {
        ticketId: 'FE-01',
        exactSubjectWaiver: true,
      }),
    ).toBe(0);
    expect(ticketManifestExitCode('accepted-with-waiver')).toBe(1);
    expect(ticketManifestExitCode('pass')).toBe(0);
    expect(ticketManifestExitCode('inconclusive')).toBe(2);
    expect(ticketManifestExitCode('fail')).toBe(1);
  });

  it('仅 exact validated record 将 perf-pf02-representative 改为 historical no-sampling fail/1，其余三个 PF step 照常采样', async () => {
    const validation = validateFe02Pf02SubjectWaiver();
    expect(validation.valid).toBe(true);
    const steps = planTicketExecutionSteps({
      ticketId: 'FE-02',
      ticket,
      subjectWaiverValidation: validation,
    });

    const waived = steps.find((step: { id: string }) => step.id === 'perf-pf02-representative');
    expect(waived).toMatchObject({
      executionMode: SUBJECT_WAIVER_EXECUTION_MODE,
      samplingRun: false,
      historicalRunId: '20260815T060139784Z-p84684-000',
      initialWaiverValidation: 'valid',
    });
    expect(isSubjectWaiverPerfStep(waived)).toBe(true);
    for (const id of ['perf-pf02-stress', 'perf-pf03-representative', 'perf-pf03-stress']) {
      expect(steps.find((step: { id: string }) => step.id === id)).not.toHaveProperty(
        'executionMode',
      );
    }

    const runStepImpl = vi.fn(async () => {
      throw new Error('subject waiver must not sample');
    });
    await expect(executeTicketStep({ step: waived, runStepImpl })).resolves.toMatchObject({
      exitCode: 1,
      timedOut: false,
      historical: true,
      stdout:
        'historical subject waiver artifact validation; automatic fail/exit 1; samplingRun=false\n',
    });
    expect(runStepImpl).not.toHaveBeenCalled();
  });

  it('invalid record 或无 waiver 配置的 registry 都保留全部四个 PF step 的真实采样', () => {
    const invalid = { ...validateFe02Pf02SubjectWaiver(), valid: false };
    const withoutWaiver = {
      ...ticket,
      performances: ticket.performances.map(
        ({ subjectWaiverPath: _omitted, ...entry }: Record<string, unknown>) => entry,
      ),
    };
    for (const candidate of [invalid, undefined]) {
      const steps = planTicketExecutionSteps({
        ticketId: 'FE-02',
        ticket,
        subjectWaiverValidation: candidate,
      });
      expect(steps).not.toContainEqual(expect.objectContaining({ samplingRun: false }));
    }
    const steps = planTicketExecutionSteps({
      ticketId: 'FE-02',
      ticket: withoutWaiver,
      subjectWaiverValidation: validateFe02Pf02SubjectWaiver(),
    });
    expect(steps).not.toContainEqual(expect.objectContaining({ samplingRun: false }));
  });

  it('subject budget state 保留 automated fail，不将其改写为 automatic pass；binding 漂移即 fail', () => {
    const validation = validateFe02Pf02SubjectWaiver();
    expect(
      subjectWaiverPf02BudgetState({
        subjectWaiverCompletion: {
          finalSubjectWaiverValidation: validation,
          finalSubjectWaiverValidationStatus: 'valid',
          bindingStable: true,
        },
      }),
    ).toMatchObject({
      status: 'accepted-with-waiver',
      automaticResult: { status: 'fail', exitCode: 1 },
      provenance: { kind: 'fe-02-pf-02-subject-waiver' },
    });
    expect(
      subjectWaiverPf02BudgetState({
        subjectWaiverCompletion: {
          finalSubjectWaiverValidation: validation,
          finalSubjectWaiverValidationStatus: 'invalid',
          bindingStable: false,
        },
      }),
    ).toMatchObject({ status: 'fail' });
  });
});
