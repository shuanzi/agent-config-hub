import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime verdict module is a plain Node ESM module.
import { deriveFe01SubjectWaiverClosureStatus } from '../../scripts/orchestrator/fe01-subject-waiver-verdict.mjs';
// @ts-expect-error runtime validator is a plain Node ESM module.
import { validateFe01Pf01SubjectWaiver } from '../../scripts/orchestrator/fe01-pf01-subject-waiver.mjs';

const steps = [
  ...['toolchain', 'static', 'rust', 'frontend', 'ui', 'tauri'].map((id) => ({
    id,
    status: 'pass',
    exitCode: 0,
  })),
  { id: 'perf', status: 'fail', exitCode: 1 },
];

describe('FE-01 subject waiver closure verdict', () => {
  it('仅精确自动 fail/1、manual disposition、clean lineage 和其余六项通过时接受', () => {
    const waiver = validateFe01Pf01SubjectWaiver();
    expect(
      deriveFe01SubjectWaiverClosureStatus({
        ticketId: 'FE-01',
        steps,
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidation: waiver,
        finalWaiverValidation: waiver,
        subjectLineage: { valid: true },
      }),
    ).toEqual({ status: 'accepted-with-waiver', waivedStepId: 'perf' });
  });

  it('任何非 perf hard failure、额外 violation、dirty 或 lineage drift 都不可 waive', () => {
    const waiver = validateFe01Pf01SubjectWaiver();
    for (const candidate of [
      {
        steps: steps.map((step) =>
          step.id === 'static' ? { ...step, status: 'fail', exitCode: 1 } : step,
        ),
      },
      { steps: [...steps, { id: 'extra', status: 'pass', exitCode: 0 }] },
      { worktreeDirty: true },
      { subjectLineage: { valid: false } },
      { budgetStatus: 'fail' },
    ]) {
      expect(
        deriveFe01SubjectWaiverClosureStatus({
          ticketId: 'FE-01',
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

  it('hard step inconclusive/2 保持 inconclusive，而非被 exact waiver 缺失误判为 fail', () => {
    const waiver = validateFe01Pf01SubjectWaiver();
    expect(
      deriveFe01SubjectWaiverClosureStatus({
        ticketId: 'FE-01',
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
