/** 只为当前 FE-01 search p95 active waiver 服务的 closure verdict。 */
import {
  FE01_PF01_ACTIVE_WAIVER_PATH,
  FE01_PF01_ACTIVE_WAIVER_SHA256,
} from './fe01-pf01-active-waiver.mjs';

export const FE01_ACTIVE_WAIVER_CLOSURE_STEPS = Object.freeze([
  { id: 'toolchain', status: 'pass', exitCode: 0 },
  { id: 'static', status: 'pass', exitCode: 0 },
  { id: 'rust', status: 'pass', exitCode: 0 },
  { id: 'frontend', status: 'pass', exitCode: 0 },
  { id: 'ui', status: 'pass', exitCode: 0 },
  { id: 'tauri', status: 'pass', exitCode: 0 },
  { id: 'perf', status: 'fail', exitCode: 1 },
]);

export function hasExactFe01ActiveWaiverClosureSteps(steps) {
  return (
    Array.isArray(steps) &&
    steps.length === FE01_ACTIVE_WAIVER_CLOSURE_STEPS.length &&
    FE01_ACTIVE_WAIVER_CLOSURE_STEPS.every((expected) => {
      const matches = steps.filter((step) => step?.id === expected.id);
      return (
        matches.length === 1 &&
        matches[0].status === expected.status &&
        matches[0].exitCode === expected.exitCode
      );
    })
  );
}

export function isExactFe01ActiveWaiverValidation(value) {
  const violation = value?.automaticResult?.violation;
  return (
    value?.valid === true &&
    value.waiverPath === FE01_PF01_ACTIVE_WAIVER_PATH &&
    value.waiverSha256 === FE01_PF01_ACTIVE_WAIVER_SHA256 &&
    value.manualDisposition === 'accepted-with-waiver' &&
    value.automaticResult?.status === 'fail' &&
    value.automaticResult?.exitCode === 1 &&
    value.automaticResult?.runId === '20260811T112008912Z-p30755-000' &&
    value.automaticResult?.commit === 'ef1fd9823d286616ed108576c543b6f4980b5fcd' &&
    value.automaticResult?.worktreeDirty === false &&
    violation?.metric === 'pf01.search.results_visible' &&
    violation?.statistic === 'p95' &&
    violation?.observedMs === 11.645 &&
    violation?.thresholdMs === 10 &&
    violation?.deltaMs === 1.645
  );
}

function hasStableFe01ActiveWaiverBinding(initialWaiverValidation, finalWaiverValidation) {
  if (
    !isExactFe01ActiveWaiverValidation(initialWaiverValidation) ||
    !isExactFe01ActiveWaiverValidation(finalWaiverValidation)
  ) {
    return false;
  }
  return (
    JSON.stringify({
      waiverPath: initialWaiverValidation.waiverPath,
      waiverSha256: initialWaiverValidation.waiverSha256,
      manualDisposition: initialWaiverValidation.manualDisposition,
      automaticResult: initialWaiverValidation.automaticResult,
    }) ===
    JSON.stringify({
      waiverPath: finalWaiverValidation.waiverPath,
      waiverSha256: finalWaiverValidation.waiverSha256,
      manualDisposition: finalWaiverValidation.manualDisposition,
      automaticResult: finalWaiverValidation.automaticResult,
    })
  );
}

/** 只有当前精确 active waiver 才能把已复算的 perf fail 接成 accepted-with-waiver。 */
export function deriveFe01ActiveWaiverClosureStatus({
  ticketId,
  steps,
  budgetStatus,
  evidenceContaminated,
  worktreeDirty,
  waiverValidation,
  initialWaiverValidation = waiverValidation,
  finalWaiverValidation = waiverValidation,
}) {
  const exactWaiver =
    ticketId === 'FE-01' &&
    hasStableFe01ActiveWaiverBinding(initialWaiverValidation, finalWaiverValidation);
  const exactSteps = ticketId === 'FE-01' && hasExactFe01ActiveWaiverClosureSteps(steps);
  const waivedStep = (steps ?? []).find(
    (step) => step?.id === 'perf' && step.status === 'fail' && step.exitCode === 1 && exactWaiver,
  );
  const anyFailure =
    (steps ?? []).some((step) => step.status === 'fail' && step !== waivedStep) ||
    budgetStatus === 'fail';
  const anyInconclusive =
    evidenceContaminated === true ||
    worktreeDirty !== false ||
    budgetStatus === 'inconclusive' ||
    (steps ?? []).some((step) => step.status === 'inconclusive');

  if (exactWaiver && exactSteps && waivedStep !== undefined && !anyFailure && !anyInconclusive) {
    return { status: 'accepted-with-waiver', waivedStepId: 'perf' };
  }
  if (anyFailure || (ticketId === 'FE-01' && !exactSteps)) {
    return { status: 'fail', waivedStepId: null };
  }
  if (anyInconclusive) return { status: 'inconclusive', waivedStepId: null };
  return { status: 'pass', waivedStepId: null };
}
