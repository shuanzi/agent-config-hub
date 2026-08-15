/** 仅为本次 FE-02 subject scroll.render_stable p50 manual disposition 服务的 closure verdict。 */
import {
  FE02_PF02_SUBJECT_WAIVER_PATH,
  FE02_PF02_SUBJECT_WAIVER_SHA256,
} from './fe02-pf02-subject-waiver.mjs';

const WAIVED_STEP_ID = 'perf-pf02-representative';
const REQUIRED_STEPS = Object.freeze([
  { id: 'toolchain', status: 'pass', exitCode: 0 },
  { id: 'static', status: 'pass', exitCode: 0 },
  { id: 'rust-fx02', status: 'pass', exitCode: 0 },
  { id: 'frontend-read-surfaces', status: 'pass', exitCode: 0 },
  { id: 'perf-read-contract', status: 'pass', exitCode: 0 },
  { id: 'ui-fx02-read-surfaces', status: 'pass', exitCode: 0 },
  { id: 'tauri-fx02-read', status: 'pass', exitCode: 0 },
  { id: 'perf-pf02-representative', status: 'fail', exitCode: 1 },
  { id: 'perf-pf02-stress', status: 'pass', exitCode: 0 },
  { id: 'perf-pf03-representative', status: 'pass', exitCode: 0 },
  { id: 'perf-pf03-stress', status: 'pass', exitCode: 0 },
]);
const SUBJECT_VIOLATION = Object.freeze({
  metric: 'pf02.source.scroll.render_stable',
  statistic: 'p50',
  observedMs: 12.95,
  thresholdMs: 3.9375,
  deltaMs: 9.0125,
});

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactValidation(value) {
  const automaticResult = value?.automaticResult;
  return (
    value?.valid === true &&
    value.waiverPath === FE02_PF02_SUBJECT_WAIVER_PATH &&
    value.waiverSha256 === FE02_PF02_SUBJECT_WAIVER_SHA256 &&
    value.manualDisposition === 'accepted-with-waiver' &&
    automaticResult?.status === 'fail' &&
    automaticResult?.exitCode === 1 &&
    automaticResult?.runId === '20260815T060139784Z-p84684-000' &&
    automaticResult?.commit === '7936cb91f54c94e836124b0d46337247776431d2' &&
    automaticResult?.worktreeDirty === false &&
    sameJson(automaticResult?.violation, SUBJECT_VIOLATION) &&
    value?.performanceDebt?.status === 'deferred' &&
    value?.performanceDebt?.phase === 'post-optimization' &&
    typeof value?.performanceDebt?.rootCause === 'string'
  );
}

function stableBinding(initial, final) {
  return (
    exactValidation(initial) &&
    exactValidation(final) &&
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
  initialWaiverValidation,
  finalWaiverValidation,
  subjectLineage,
}) {
  const exactWaiver =
    ticketId === 'FE-02' && stableBinding(initialWaiverValidation, finalWaiverValidation);
  const exactSteps = ticketId === 'FE-02' && hasExactFe02SubjectWaiverClosureSteps(steps);
  const waivedPerf = exactWaiver
    ? steps?.find(
        (step) => step?.id === WAIVED_STEP_ID && step.status === 'fail' && step.exitCode === 1,
      )
    : undefined;
  const hardFailure =
    (steps ?? []).some((step) => step.status === 'fail' && step !== waivedPerf) ||
    budgetStatus === 'fail';
  const inconclusive =
    evidenceContaminated === true ||
    worktreeDirty !== false ||
    subjectLineage?.valid !== true ||
    budgetStatus === 'inconclusive' ||
    (steps ?? []).some((step) => step.status === 'inconclusive');
  if (
    exactWaiver &&
    exactSteps &&
    waivedPerf !== undefined &&
    budgetStatus === 'accepted-with-waiver' &&
    !hardFailure &&
    !inconclusive
  ) {
    return { status: 'accepted-with-waiver', waivedStepId: WAIVED_STEP_ID };
  }
  if (hardFailure) {
    return { status: 'fail', waivedStepId: null };
  }
  if (inconclusive) return { status: 'inconclusive', waivedStepId: null };
  if (ticketId === 'FE-02' && (!exactWaiver || !exactSteps)) {
    return { status: 'fail', waivedStepId: null };
  }
  return { status: 'pass', waivedStepId: null };
}
