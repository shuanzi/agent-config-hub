/** 仅为本次 FE-01 subject startup p50 manual disposition 服务的 closure verdict。 */
import {
  FE01_PF01_SUBJECT_WAIVER_PATH,
  FE01_PF01_SUBJECT_WAIVER_SHA256,
} from './fe01-pf01-subject-waiver.mjs';

const REQUIRED_STEPS = Object.freeze([
  { id: 'toolchain', status: 'pass', exitCode: 0 },
  { id: 'static', status: 'pass', exitCode: 0 },
  { id: 'rust', status: 'pass', exitCode: 0 },
  { id: 'frontend', status: 'pass', exitCode: 0 },
  { id: 'ui', status: 'pass', exitCode: 0 },
  { id: 'tauri', status: 'pass', exitCode: 0 },
  { id: 'perf', status: 'fail', exitCode: 1 },
]);
const SUBJECT_VIOLATION = Object.freeze({
  metric: 'pf01.startup.first_list_visible',
  statistic: 'p50',
  observedMs: 16.2,
  thresholdMs: 15.75,
  deltaMs: 0.45,
});

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactValidation(value) {
  const automaticResult = value?.automaticResult;
  return (
    value?.valid === true &&
    value.waiverPath === FE01_PF01_SUBJECT_WAIVER_PATH &&
    value.waiverSha256 === FE01_PF01_SUBJECT_WAIVER_SHA256 &&
    value.manualDisposition === 'accepted-with-waiver' &&
    automaticResult?.status === 'fail' &&
    automaticResult?.exitCode === 1 &&
    automaticResult?.runId === '20260812T035717854Z-p74069-000' &&
    automaticResult?.commit === '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf' &&
    automaticResult?.worktreeDirty === false &&
    sameJson(automaticResult?.violation, SUBJECT_VIOLATION) &&
    value?.performanceDebt?.status === 'deferred' &&
    value?.performanceDebt?.phase === 'post-optimization' &&
    value?.performanceDebt?.rootCause === 'unknown'
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

export function hasExactFe01SubjectWaiverClosureSteps(steps) {
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
export function deriveFe01SubjectWaiverClosureStatus({
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
    ticketId === 'FE-01' && stableBinding(initialWaiverValidation, finalWaiverValidation);
  const exactSteps = ticketId === 'FE-01' && hasExactFe01SubjectWaiverClosureSteps(steps);
  const waivedPerf = exactWaiver
    ? steps?.find((step) => step?.id === 'perf' && step.status === 'fail' && step.exitCode === 1)
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
    return { status: 'accepted-with-waiver', waivedStepId: 'perf' };
  }
  if (hardFailure) {
    return { status: 'fail', waivedStepId: null };
  }
  if (inconclusive) return { status: 'inconclusive', waivedStepId: null };
  if (ticketId === 'FE-01' && (!exactWaiver || !exactSteps)) {
    return { status: 'fail', waivedStepId: null };
  }
  return { status: 'pass', waivedStepId: null };
}
