/** FE-01 的唯一 PF-01 waiver verdict 规则；不提供任意 ticket/metric bypass。 */
export const FE01_EXACT_CLOSURE_STEPS = Object.freeze([
  { id: 'toolchain', status: 'pass', exitCode: 0 },
  { id: 'static', status: 'pass', exitCode: 0 },
  { id: 'rust', status: 'pass', exitCode: 0 },
  { id: 'frontend', status: 'pass', exitCode: 0 },
  { id: 'ui', status: 'pass', exitCode: 0 },
  { id: 'tauri', status: 'pass', exitCode: 0 },
  { id: 'perf', status: 'fail', exitCode: 1 },
]);

export function hasExactFe01ClosureSteps(steps) {
  return (
    Array.isArray(steps) &&
    steps.length === FE01_EXACT_CLOSURE_STEPS.length &&
    FE01_EXACT_CLOSURE_STEPS.every((expected) => {
      const matching = steps.filter((step) => step?.id === expected.id);
      return (
        matching.length === 1 &&
        matching[0].status === expected.status &&
        matching[0].exitCode === expected.exitCode
      );
    })
  );
}

function isExactValidatedWaiver(value) {
  return (
    value?.valid === true &&
    value.manualDisposition === 'accepted-with-waiver' &&
    value.automaticResult?.status === 'fail' &&
    value.automaticResult?.exitCode === 1 &&
    value.automaticResult?.runId === '20260811T024255740Z-p14989-000' &&
    value.automaticResult?.commit === '40009202e2e88e946dadf82a71816e10338da639' &&
    value.automaticResult?.worktreeDirty === false &&
    value.automaticResult?.violation?.metric === 'pf01.l3.cold_start.first_snapshot' &&
    value.automaticResult?.violation?.statistic === 'p50' &&
    value.automaticResult?.violation?.observedMs === 612 &&
    value.automaticResult?.violation?.thresholdMs === 610 &&
    value.automaticResult?.violation?.deltaMs === 2
  );
}

/**
 * 只有已验证的 historical PF automatic fail 可被手工 disposition 接住。
 * 所有其他 step/budget/evidence 问题仍遵循普通 fail/inconclusive 语义。
 */
export function deriveTicketClosureStatus({
  ticketId,
  steps,
  budgetStatus,
  evidenceContaminated,
  worktreeDirty,
  waiverValidation,
}) {
  const exactWaiver = ticketId === 'FE-01' && isExactValidatedWaiver(waiverValidation);
  const exactClosureSteps = ticketId === 'FE-01' && hasExactFe01ClosureSteps(steps);
  const waivedStep = (steps ?? []).find(
    (step) =>
      step?.id === 'perf' &&
      step.status === 'fail' &&
      step.exitCode === 1 &&
      exactWaiver,
  );
  const unwaivedFailure = (steps ?? []).some(
    (step) => step?.status === 'fail' && step !== waivedStep,
  );
  const anyFailure = unwaivedFailure || (budgetStatus !== undefined && budgetStatus === 'fail');
  const anyInconclusive =
    evidenceContaminated === true ||
    worktreeDirty !== false ||
    budgetStatus === 'inconclusive' ||
    (steps ?? []).some((step) => step?.status === 'inconclusive');

  if (
    exactWaiver &&
    waivedStep !== undefined &&
    !anyFailure &&
    !anyInconclusive &&
    exactClosureSteps
  ) {
    return { status: 'accepted-with-waiver', waivedStepId: 'perf' };
  }
  if (anyFailure || (ticketId === 'FE-01' && !exactClosureSteps)) {
    return { status: 'fail', waivedStepId: null };
  }
  if (anyInconclusive) return { status: 'inconclusive', waivedStepId: null };
  return { status: 'pass', waivedStepId: null };
}
