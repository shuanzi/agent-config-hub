/** 仅为本次 FE-02 subject scroll.render_stable p50 manual disposition（两份 waiver）服务的 closure verdict。 */
import {
  FE02_PF02_SUBJECT_WAIVER_PATH,
  FE02_PF02_SUBJECT_WAIVER_SHA256,
} from './fe02-pf02-subject-waiver.mjs';
import {
  FE02_PF02_STRESS_SUBJECT_WAIVER_PATH,
  FE02_PF02_STRESS_SUBJECT_WAIVER_SHA256,
} from './fe02-pf02-stress-subject-waiver.mjs';

const WAIVED_STEP_SPECS = Object.freeze([
  Object.freeze({
    stepId: 'perf-pf02-representative',
    waiverPath: FE02_PF02_SUBJECT_WAIVER_PATH,
    waiverSha256: FE02_PF02_SUBJECT_WAIVER_SHA256,
    runId: '20260815T060139784Z-p84684-000',
    commit: '7936cb91f54c94e836124b0d46337247776431d2',
    violation: Object.freeze({
      metric: 'pf02.source.scroll.render_stable',
      statistic: 'p50',
      observedMs: 12.95,
      thresholdMs: 3.9375,
      deltaMs: 9.0125,
    }),
  }),
  Object.freeze({
    stepId: 'perf-pf02-stress',
    waiverPath: FE02_PF02_STRESS_SUBJECT_WAIVER_PATH,
    waiverSha256: FE02_PF02_STRESS_SUBJECT_WAIVER_SHA256,
    runId: '20260815T094047023Z-p76378-000',
    commit: '222efc489f85a9efe9997f19badc350f23f50bb2',
    violation: Object.freeze({
      metric: 'pf02.source.scroll.render_stable',
      statistic: 'p50',
      observedMs: 12.25,
      thresholdMs: 8.5,
      deltaMs: 3.75,
    }),
  }),
]);
const WAIVED_STEP_IDS = Object.freeze(WAIVED_STEP_SPECS.map((spec) => spec.stepId));
const REQUIRED_STEPS = Object.freeze([
  { id: 'toolchain', status: 'pass', exitCode: 0 },
  { id: 'static', status: 'pass', exitCode: 0 },
  { id: 'rust-fx02', status: 'pass', exitCode: 0 },
  { id: 'frontend-read-surfaces', status: 'pass', exitCode: 0 },
  { id: 'perf-read-contract', status: 'pass', exitCode: 0 },
  { id: 'ui-fx02-read-surfaces', status: 'pass', exitCode: 0 },
  { id: 'tauri-fx02-read', status: 'pass', exitCode: 0 },
  { id: 'perf-pf02-representative', status: 'fail', exitCode: 1 },
  { id: 'perf-pf02-stress', status: 'fail', exitCode: 1 },
  { id: 'perf-pf03-representative', status: 'pass', exitCode: 0 },
  { id: 'perf-pf03-stress', status: 'pass', exitCode: 0 },
]);

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactValidation(spec, value) {
  const automaticResult = value?.automaticResult;
  return (
    value?.valid === true &&
    value.waiverPath === spec.waiverPath &&
    value.waiverSha256 === spec.waiverSha256 &&
    value.manualDisposition === 'accepted-with-waiver' &&
    automaticResult?.status === 'fail' &&
    automaticResult?.exitCode === 1 &&
    automaticResult?.runId === spec.runId &&
    automaticResult?.commit === spec.commit &&
    automaticResult?.worktreeDirty === false &&
    sameJson(automaticResult?.violation, spec.violation) &&
    value?.performanceDebt?.status === 'deferred' &&
    value?.performanceDebt?.phase === 'post-optimization' &&
    typeof value?.performanceDebt?.rootCause === 'string'
  );
}

function stableBinding(spec, initial, final) {
  return (
    exactValidation(spec, initial) &&
    exactValidation(spec, final) &&
    sameJson(
      {
        waiverPath: initial.waiverPath,
        waiverSha256: initial.waiverSha256,
        automaticResult: initial.automaticResult,
        baseline: initial.baseline,
        subject: initial.subject,
        measurementContract: initial.measurementContract,
        performanceDebt: initial.performanceDebt,
      },
      {
        waiverPath: final.waiverPath,
        waiverSha256: final.waiverSha256,
        automaticResult: final.automaticResult,
        baseline: final.baseline,
        subject: final.subject,
        measurementContract: final.measurementContract,
        performanceDebt: final.performanceDebt,
      },
    )
  );
}

export function hasExactFe02SubjectWaiverClosureSteps(steps) {
  return (
    Array.isArray(steps) &&
    steps.length === REQUIRED_STEPS.length &&
    REQUIRED_STEPS.every((expected) => {
      const matches = steps.filter((step) => step?.id === expected.id);
      return (
        matches.length === 1 &&
        matches[0].status === expected.status &&
        matches[0].exitCode === expected.exitCode
      );
    })
  );
}

/** hard gate、contamination、dirty、lineage drift 或额外 numeric failure 都不可由 manual disposition 掩盖。 */
export function deriveFe02SubjectWaiverClosureStatus({
  ticketId,
  steps,
  budgetStatus,
  evidenceContaminated,
  worktreeDirty,
  initialWaiverValidations,
  finalWaiverValidations,
  subjectLineage,
}) {
  const exactWaiver =
    ticketId === 'FE-02' &&
    WAIVED_STEP_SPECS.every((spec) =>
      stableBinding(
        spec,
        initialWaiverValidations?.[spec.stepId],
        finalWaiverValidations?.[spec.stepId],
      ),
    );
  const exactSteps = ticketId === 'FE-02' && hasExactFe02SubjectWaiverClosureSteps(steps);
  // 两个 waived step 恰好是仅有的两个 fail/exit-1 step（REQUIRED_STEPS 已钉死其余 9 步全 pass）。
  const waivedStepsPresent =
    exactWaiver &&
    WAIVED_STEP_IDS.every((stepId) =>
      steps?.some((step) => step?.id === stepId && step.status === 'fail' && step.exitCode === 1),
    );
  const hardFailure =
    (steps ?? []).some(
      (step) => step.status === 'fail' && !WAIVED_STEP_IDS.includes(step?.id),
    ) || budgetStatus === 'fail';
  const inconclusive =
    evidenceContaminated === true ||
    worktreeDirty !== false ||
    subjectLineage?.valid !== true ||
    budgetStatus === 'inconclusive' ||
    (steps ?? []).some((step) => step.status === 'inconclusive');
  if (
    exactWaiver &&
    exactSteps &&
    waivedStepsPresent &&
    budgetStatus === 'accepted-with-waiver' &&
    !hardFailure &&
    !inconclusive
  ) {
    return { status: 'accepted-with-waiver', waivedStepIds: [...WAIVED_STEP_IDS] };
  }
  if (hardFailure) {
    return { status: 'fail', waivedStepIds: [] };
  }
  if (inconclusive) return { status: 'inconclusive', waivedStepIds: [] };
  if (ticketId === 'FE-02' && (!exactWaiver || !exactSteps)) {
    return { status: 'fail', waivedStepIds: [] };
  }
  return { status: 'pass', waivedStepIds: [] };
}
