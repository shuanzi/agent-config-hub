import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime verdict module is a plain Node ESM module.
import { deriveFe02SubjectWaiverClosureStatus } from '../../scripts/orchestrator/fe02-subject-waiver-verdict.mjs';
// @ts-expect-error runtime validator is a plain Node ESM module.
import { validateFe02Pf02SubjectWaiver } from '../../scripts/orchestrator/fe02-pf02-subject-waiver.mjs';
// @ts-expect-error runtime validator is a plain Node ESM module.
import { validateFe02Pf02StressSubjectWaiver } from '../../scripts/orchestrator/fe02-pf02-stress-subject-waiver.mjs';

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
  { id: 'perf-pf02-stress', status: 'fail', exitCode: 1 },
  ...['perf-pf03-representative', 'perf-pf03-stress'].map((id) => ({
    id,
    status: 'pass',
    exitCode: 0,
  })),
];

function waivers() {
  return {
    'perf-pf02-representative': validateFe02Pf02SubjectWaiver(),
    'perf-pf02-stress': validateFe02Pf02StressSubjectWaiver(),
  };
}

describe('FE-02 subject waiver closure verdict', () => {
  it('仅两份精确自动 fail/1、manual disposition、clean lineage 和其余九项通过时接受', () => {
    const waiverMap = waivers();
    expect(
      deriveFe02SubjectWaiverClosureStatus({
        ticketId: 'FE-02',
        steps,
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidations: waiverMap,
        finalWaiverValidations: waiverMap,
        subjectLineage: { valid: true },
      }),
    ).toEqual({
      status: 'accepted-with-waiver',
      waivedStepIds: ['perf-pf02-representative', 'perf-pf02-stress'],
    });
  });

  it('任何非 waiver step hard failure、额外/缺失 step、dirty、lineage drift 或 binding 漂移都不可 waive', () => {
    const waiverMap = waivers();
    for (const candidate of [
      {
        steps: steps.map((step) =>
          step.id === 'static' ? { ...step, status: 'fail', exitCode: 1 } : step,
        ),
      },
      // perf-pf03-stress 等其余 PF numeric failure 同样是 hard failure，不可掩盖。
      {
        steps: steps.map((step) =>
          step.id === 'perf-pf03-stress' ? { ...step, status: 'fail', exitCode: 1 } : step,
        ),
      },
      { steps: [...steps, { id: 'extra', status: 'pass', exitCode: 0 }] },
      { steps: steps.filter((step) => step.id !== 'tauri-fx02-read') },
      { worktreeDirty: true },
      { subjectLineage: { valid: false } },
      { budgetStatus: 'fail' },
      {
        finalWaiverValidations: {
          ...waiverMap,
          'perf-pf02-stress': { ...waiverMap['perf-pf02-stress'], waiverSha256: '0'.repeat(64) },
        },
      },
      // 只有一份 waiver exact 时同样不可 closure。
      {
        initialWaiverValidations: {
          ...waiverMap,
          'perf-pf02-representative': { ...waiverMap['perf-pf02-representative'], valid: false },
        },
      },
    ]) {
      expect(
        deriveFe02SubjectWaiverClosureStatus({
          ticketId: 'FE-02',
          steps,
          budgetStatus: 'accepted-with-waiver',
          evidenceContaminated: false,
          worktreeDirty: false,
          initialWaiverValidations: waiverMap,
          finalWaiverValidations: waiverMap,
          subjectLineage: { valid: true },
          ...candidate,
        }),
      ).not.toMatchObject({ status: 'accepted-with-waiver' });
    }
  });

  it('非 historical 的 perf-pf02 fail（waiver 无效）不可被接受', () => {
    const waiverMap = waivers();
    const invalid = Object.fromEntries(
      Object.entries(waiverMap).map(([stepId, waiver]) => [stepId, { ...waiver, valid: false }]),
    );
    expect(
      deriveFe02SubjectWaiverClosureStatus({
        ticketId: 'FE-02',
        steps,
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidations: invalid,
        finalWaiverValidations: invalid,
        subjectLineage: { valid: true },
      }),
    ).toEqual({ status: 'fail', waivedStepIds: [] });
  });

  it('ticketId 非 FE-02 时 waiver 不启用', () => {
    const waiverMap = waivers();
    expect(
      deriveFe02SubjectWaiverClosureStatus({
        ticketId: 'FE-01',
        steps,
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidations: waiverMap,
        finalWaiverValidations: waiverMap,
        subjectLineage: { valid: true },
      }),
    ).not.toMatchObject({ status: 'accepted-with-waiver' });
  });

  it('hard step inconclusive/2 保持 inconclusive，而非被 exact waiver 缺失误判为 fail', () => {
    const waiverMap = waivers();
    expect(
      deriveFe02SubjectWaiverClosureStatus({
        ticketId: 'FE-02',
        steps: steps.map((step) =>
          step.id === 'static' ? { ...step, status: 'inconclusive', exitCode: 2 } : step,
        ),
        budgetStatus: 'accepted-with-waiver',
        evidenceContaminated: false,
        worktreeDirty: false,
        initialWaiverValidations: waiverMap,
        finalWaiverValidations: waiverMap,
        subjectLineage: { valid: true },
      }),
    ).toEqual({ status: 'inconclusive', waivedStepIds: [] });
  });
});
