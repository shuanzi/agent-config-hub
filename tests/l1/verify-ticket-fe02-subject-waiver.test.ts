import { describe, expect, it, vi } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { SUBJECT_WAIVER_EXECUTION_MODE, executeTicketStep, isSubjectWaiverPerfStep, planTicketExecutionSteps, subjectWaiverPf02BudgetState, ticketManifestExitCode } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// prettier-ignore
// @ts-expect-error runtime validator is a plain Node ESM module.
import { validateFe02Pf02SubjectWaiver } from '../../scripts/orchestrator/fe02-pf02-subject-waiver.mjs';
// prettier-ignore
// @ts-expect-error runtime validator is a plain Node ESM module.
import { validateFe02Pf02StressSubjectWaiver } from '../../scripts/orchestrator/fe02-pf02-stress-subject-waiver.mjs';
// prettier-ignore
// @ts-expect-error runtime registry is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';

const ticket = TICKET_REGISTRY['FE-02'];

function waiverValidations() {
  return {
    'perf-pf02-representative': validateFe02Pf02SubjectWaiver(),
    'perf-pf02-stress': validateFe02Pf02StressSubjectWaiver(),
  };
}

function validCompletions() {
  const validations = waiverValidations();
  return {
    perStep: Object.fromEntries(
      Object.entries(validations).map(([stepId, validation]) => [
        stepId,
        {
          finalSubjectWaiverValidation: validation,
          finalSubjectWaiverValidationStatus: 'valid',
          bindingStable: true,
        },
      ]),
    ),
  };
}

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

  it('两份 exact validated record 各自将对应 PF-02 step 改为 historical no-sampling fail/1，PF-03 两个 step 照常采样', async () => {
    const validations = waiverValidations();
    expect(validations['perf-pf02-representative'].valid).toBe(true);
    expect(validations['perf-pf02-stress'].valid).toBe(true);
    const steps = planTicketExecutionSteps({
      ticketId: 'FE-02',
      ticket,
      subjectWaiverValidations: validations,
    });

    const expectedHistorical = {
      'perf-pf02-representative': '20260815T060139784Z-p84684-000',
      'perf-pf02-stress': '20260815T094047023Z-p76378-000',
    };
    for (const [id, runId] of Object.entries(expectedHistorical)) {
      const waived = steps.find((step: { id: string }) => step.id === id);
      expect(waived).toMatchObject({
        executionMode: SUBJECT_WAIVER_EXECUTION_MODE,
        samplingRun: false,
        historicalRunId: runId,
        initialWaiverValidation: 'valid',
      });
      expect(isSubjectWaiverPerfStep(waived)).toBe(true);

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
    }
    for (const id of ['perf-pf03-representative', 'perf-pf03-stress']) {
      expect(steps.find((step: { id: string }) => step.id === id)).not.toHaveProperty(
        'executionMode',
      );
    }
  });

  it('单一 waiver invalid 只回退对应 step；两份都 invalid 或无 waiver 配置保留全部采样', () => {
    const validations = waiverValidations();
    const stressInvalid = {
      ...validations,
      'perf-pf02-stress': { ...validations['perf-pf02-stress'], valid: false },
    };
    const partial = planTicketExecutionSteps({
      ticketId: 'FE-02',
      ticket,
      subjectWaiverValidations: stressInvalid,
    });
    expect(
      partial.find((step: { id: string }) => step.id === 'perf-pf02-representative'),
    ).toMatchObject({ samplingRun: false });
    expect(
      partial.find((step: { id: string }) => step.id === 'perf-pf02-stress'),
    ).not.toHaveProperty('executionMode');

    const invalid = Object.fromEntries(
      Object.entries(validations).map(([stepId, validation]) => [
        stepId,
        { ...validation, valid: false },
      ]),
    );
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
        subjectWaiverValidations: candidate,
      });
      expect(steps).not.toContainEqual(expect.objectContaining({ samplingRun: false }));
    }
    const steps = planTicketExecutionSteps({
      ticketId: 'FE-02',
      ticket: withoutWaiver,
      subjectWaiverValidations: validations,
    });
    expect(steps).not.toContainEqual(expect.objectContaining({ samplingRun: false }));
  });

  it('subject budget state 保留两个 automated fail，不将其改写为 automatic pass；任一 binding 漂移即 fail', () => {
    const completions = validCompletions();
    expect(subjectWaiverPf02BudgetState({ subjectWaiverCompletions: completions })).toMatchObject({
      status: 'accepted-with-waiver',
      automaticResults: [
        { status: 'fail', exitCode: 1, runId: '20260815T060139784Z-p84684-000' },
        { status: 'fail', exitCode: 1, runId: '20260815T094047023Z-p76378-000' },
      ],
      provenance: { kind: 'fe-02-pf-02-subject-waiver' },
    });
    for (const stepId of ['perf-pf02-representative', 'perf-pf02-stress']) {
      const drifted = {
        perStep: {
          ...completions.perStep,
          [stepId]: {
            ...completions.perStep[stepId],
            finalSubjectWaiverValidationStatus: 'invalid',
            bindingStable: false,
          },
        },
      };
      expect(subjectWaiverPf02BudgetState({ subjectWaiverCompletions: drifted })).toMatchObject({
        status: 'fail',
      });
    }
  });
});
