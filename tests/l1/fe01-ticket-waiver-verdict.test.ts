import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime verifier helper is a plain Node ESM module.
import { deriveTicketClosureStatus } from '../../scripts/orchestrator/fe01-ticket-waiver-verdict.mjs';

const waiver = {
  valid: true,
  manualDisposition: 'accepted-with-waiver',
  automaticResult: {
    status: 'fail',
    exitCode: 1,
    runId: '20260811T024255740Z-p14989-000',
    commit: '40009202e2e88e946dadf82a71816e10338da639',
    worktreeDirty: false,
    violation: {
      metric: 'pf01.l3.cold_start.first_snapshot',
      statistic: 'p50',
      observedMs: 612,
      thresholdMs: 610,
      deltaMs: 2,
    },
  },
};

const requiredSteps = [
  { id: 'toolchain', status: 'pass', exitCode: 0 },
  { id: 'static', status: 'pass', exitCode: 0 },
  { id: 'rust', status: 'pass', exitCode: 0 },
  { id: 'frontend', status: 'pass', exitCode: 0 },
  { id: 'ui', status: 'pass', exitCode: 0 },
  { id: 'tauri', status: 'pass', exitCode: 0 },
  { id: 'perf', status: 'fail', exitCode: 1 },
];

describe('FE-01 ticket performance waiver verdict', () => {
  it('only turns the exact validated historical PF failure into accepted-with-waiver', () => {
    expect(
      deriveTicketClosureStatus({
        ticketId: 'FE-01',
        steps: requiredSteps,
        budgetStatus: 'pass',
        evidenceContaminated: false,
        worktreeDirty: false,
        waiverValidation: waiver,
      }),
    ).toEqual({ status: 'accepted-with-waiver', waivedStepId: 'perf' });
  });

  it('retains ordinary failure/inconclusive semantics for invalid waiver, dirty evidence, contamination or any non-PF failure', () => {
    const base = {
      ticketId: 'FE-01',
      steps: requiredSteps,
      budgetStatus: 'pass',
      evidenceContaminated: false,
      worktreeDirty: false,
      waiverValidation: waiver,
    } as const;
    expect(
      deriveTicketClosureStatus({ ...base, waiverValidation: { ...waiver, valid: false } }),
    ).toEqual({
      status: 'fail',
      waivedStepId: null,
    });
    expect(
      deriveTicketClosureStatus({
        ...base,
        waiverValidation: {
          ...waiver,
          automaticResult: {
            ...waiver.automaticResult,
            violation: { metric: 'pf01.l3.cold_start.first_snapshot', observedMs: 613 },
          },
        },
      }),
    ).toEqual({ status: 'fail', waivedStepId: null });
    for (const steps of [
      requiredSteps.filter((step) => step.id !== 'static'),
      [...requiredSteps, { id: 'extra', status: 'pass', exitCode: 0 }],
      [...requiredSteps, { id: 'static', status: 'pass', exitCode: 0 }],
      requiredSteps.map((step) => (step.id === 'ui' ? { ...step, exitCode: 1 } : step)),
    ]) {
      expect(deriveTicketClosureStatus({ ...base, steps })).toEqual({
        status: 'fail',
        waivedStepId: null,
      });
    }
    expect(deriveTicketClosureStatus({ ...base, worktreeDirty: true })).toEqual({
      status: 'inconclusive',
      waivedStepId: null,
    });
    expect(deriveTicketClosureStatus({ ...base, evidenceContaminated: true })).toEqual({
      status: 'inconclusive',
      waivedStepId: null,
    });
    expect(
      deriveTicketClosureStatus({
        ...base,
        steps: [...base.steps, { id: 'tauri', status: 'fail', exitCode: 1 }],
      }),
    ).toEqual({ status: 'fail', waivedStepId: null });
  });
});
