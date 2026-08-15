import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime verdict module is a plain Node ESM module.
import { deriveFe02SubjectWaiverClosureStatus } from '../../scripts/orchestrator/fe02-subject-waiver-verdict.mjs';
// @ts-expect-error runtime validator is a plain Node ESM module.
import { validateFe02Pf02SubjectWaiver } from '../../scripts/orchestrator/fe02-pf02-subject-waiver.mjs';

const steps = [
  ...[
    'toolchain',
    'static',
    'rust-fx02',
    'frontend-read-surfaces',
    'perf-read-contract',
    'ui-fx02-read-surfaces',
    'tauri-fx02-read',
  ].map((id) => ({
    id,
    status: 'pass',
    exitCode: 0,
  })),
  { id: 'perf-pf02-representative', status: 'fail', exitCode: 1 },
  ...['perf-pf02-stress', 'perf-pf03-representative', 'perf-pf03-stress'].map((id) => ({
    id,
    status: 'pass',
    exitCode: 0,
  })),
];

describe('FE-02 subject waiver closure verdict', () => {
  it('仅精确自动 fail/1、manual disposition、clean lineage 和其余十项通过时接受', () => {
    const waiver = validateFe02Pf02SubjectWaiver();
    expect(
      deriveFe02SubjectWaiverClosureStatus({
        ticketId: 'FE-02',
        steps,
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidation: waiver,
        finalWaiverValidation: waiver,
        subjectLineage: { valid: true },
      }),
    ).toEqual({ status: 'accepted-with-waiver', waivedStepId: 'perf-pf02-representative' });
  });

  it('任何非 waiver step hard failure、额外/缺失 step、dirty、lineage drift 或 binding 漂移都不可 waive', () => {
    const waiver = validateFe02Pf02SubjectWaiver();
    for (const candidate of [
      {
        steps: steps.map((step) =>
          step.id === 'static' ? { ...step, status: 'fail', exitCode: 1 } : step,
        ),
      },
      // perf-pf02-stress 等其余 PF numeric failure 同样是 hard failure，不可掩盖。
      {
        steps: steps.map((step) =>
          step.id === 'perf-pf02-stress' ? { ...step, status: 'fail', exitCode: 1 } : step,
        ),
      },
      { steps: [...steps, { id: 'extra', status: 'pass', exitCode: 0 }] },
      { steps: steps.filter((step) => step.id !== 'tauri-fx02-read') },
      { worktreeDirty: true },
      { subjectLineage: { valid: false } },
      { budgetStatus: 'fail' },
      {
        finalWaiverValidation: { ...waiver, waiverSha256: '0'.repeat(64) },
      },
    ]) {
      expect(
        deriveFe02SubjectWaiverClosureStatus({
          ticketId: 'FE-02',
          steps,
          budgetStatus: 'accepted-with-waiver',
          evidenceContaminated: false,
          worktreeDirty: false,
          initialWaiverValidation: waiver,
          finalWaiverValidation: waiver,
          subjectLineage: { valid: true },
          ...candidate,
        }),
      ).not.toMatchObject({ status: 'accepted-with-waiver' });
    }
  });

  it('非 historical 的 perf-pf02-representative fail（waiver 无效）不可被接受', () => {
    const waiver = validateFe02Pf02SubjectWaiver();
    expect(
      deriveFe02SubjectWaiverClosureStatus({
        ticketId: 'FE-02',
        steps,
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidation: { ...waiver, valid: false },
        finalWaiverValidation: { ...waiver, valid: false },
        subjectLineage: { valid: true },
      }),
    ).toEqual({ status: 'fail', waivedStepId: null });
  });

  it('ticketId 非 FE-02 时 waiver 不启用', () => {
    const waiver = validateFe02Pf02SubjectWaiver();
    expect(
      deriveFe02SubjectWaiverClosureStatus({
        ticketId: 'FE-01',
        steps,
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidation: waiver,
        finalWaiverValidation: waiver,
        subjectLineage: { valid: true },
      }),
    ).not.toMatchObject({ status: 'accepted-with-waiver' });
  });

  it('hard step inconclusive/2 保持 inconclusive，而非被 exact waiver 缺失误判为 fail', () => {
    const waiver = validateFe02Pf02SubjectWaiver();
    expect(
      deriveFe02SubjectWaiverClosureStatus({
        ticketId: 'FE-02',
        steps: steps.map((step) =>
          step.id === 'static' ? { ...step, status: 'inconclusive', exitCode: 2 } : step,
        ),
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidation: waiver,
        finalWaiverValidation: waiver,
        subjectLineage: { valid: true },
      }),
    ).toEqual({ status: 'inconclusive', waivedStepId: null });
  });
});
