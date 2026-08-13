/** verify:ticket 的 performance execution seam；仅未来 exact automatic-pass record 可跳过 perf.mjs。 */
import {
  FE01_PF01_AUTOMATIC_PASS_MODE,
  FE01_PF01_AUTOMATIC_PASS_PATH,
  validateFe01Pf01AutomaticPassEvidence,
} from './fe01-pf01-automatic-pass-validation.mjs';
import {
  FE01_PF01_SUBJECT_WAIVER_MODE,
  FE01_PF01_SUBJECT_WAIVER_PATH,
  FE01_PF01_SUBJECT_WAIVER_SHA256,
} from './fe01-pf01-subject-waiver.mjs';

export const AUTOMATIC_PASS_EXECUTION_MODE = FE01_PF01_AUTOMATIC_PASS_MODE;
export const SUBJECT_WAIVER_EXECUTION_MODE = FE01_PF01_SUBJECT_WAIVER_MODE;

/** 成功完成但超过软预算时，仅记录非阻塞的测试基础设施债务。 */
export function deriveStepRuntimeAdvisory({ step, result }) {
  const softRuntimeBudget = step?.softRuntimeBudget;
  if (
    !Number.isFinite(softRuntimeBudget?.thresholdMs) ||
    result?.exitCode !== 0 ||
    result.timedOut === true ||
    !Number.isFinite(result?.durationMs) ||
    result.durationMs <= softRuntimeBudget.thresholdMs
  ) {
    return undefined;
  }
  return {
    level: 'warning',
    blocking: false,
    classification: softRuntimeBudget.classification,
    thresholdMs: softRuntimeBudget.thresholdMs,
    durationMs: result.durationMs,
  };
}

const SUBJECT_VIOLATION = Object.freeze({
  metric: 'pf01.startup.first_list_visible',
  statistic: 'p50',
  observedMs: 16.2,
  thresholdMs: 15.75,
  deltaMs: 0.45,
});

/** manifest 保持 accepted-with-waiver，而 closure command 成功交付；automatic PF fail/1 不变。 */
export function ticketManifestExitCode(status, { ticketId, exactSubjectWaiver = false } = {}) {
  if (status === 'pass') return 0;
  if (status === 'accepted-with-waiver' && ticketId === 'FE-01' && exactSubjectWaiver === true) {
    return 0;
  }
  if (status === 'inconclusive') return 2;
  return 1;
}

function hasAutomaticPassConfiguration({ ticketId, ticket }) {
  return (
    ticketId === 'FE-01' &&
    ticket?.performance !== null &&
    typeof ticket?.performance === 'object' &&
    Object.hasOwn(ticket.performance, 'automaticPassPath')
  );
}

export function hasExactAutomaticPassConfiguration({ ticketId, ticket }) {
  return (
    hasAutomaticPassConfiguration({ ticketId, ticket }) &&
    ticket.performance.automaticPassPath === FE01_PF01_AUTOMATIC_PASS_PATH
  );
}

export function hasExactSubjectWaiverConfiguration({ ticketId, ticket }) {
  return (
    ticketId === 'FE-01' &&
    ticket?.performance !== null &&
    typeof ticket?.performance === 'object' &&
    ticket.performance.subjectWaiverPath === FE01_PF01_SUBJECT_WAIVER_PATH
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function subjectWaiverBinding(value) {
  const automaticResult = value?.automaticResult;
  if (
    value?.valid !== true ||
    value.waiverPath !== FE01_PF01_SUBJECT_WAIVER_PATH ||
    value.waiverSha256 !== FE01_PF01_SUBJECT_WAIVER_SHA256 ||
    value.manualDisposition !== 'accepted-with-waiver' ||
    automaticResult?.status !== 'fail' ||
    automaticResult?.exitCode !== 1 ||
    automaticResult?.runId !== '20260812T035717854Z-p74069-000' ||
    automaticResult?.run !== '.artifacts/performance/PF-01/20260812T035717854Z-p74069-000' ||
    automaticResult?.commit !== '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf' ||
    automaticResult?.worktreeDirty !== false ||
    !sameJson(automaticResult?.violation, SUBJECT_VIOLATION) ||
    value?.baseline?.runId !== '20260812T033832054Z-p69961-000' ||
    value?.baseline?.commit !== '114298a619af40d00941efec4c959e0b13d6be83' ||
    value?.subject?.runId !== automaticResult.runId ||
    value?.subject?.commit !== automaticResult.commit ||
    value?.measurementContract?.descriptorDigest !==
      '1f21a9dad1128ca4482500e1556925a8d8af2468a64e83628e7274007aa28b9a' ||
    value?.budget?.path !== 'performance/budgets/pf-01.budgets.json' ||
    typeof value?.budget?.sha256 !== 'string' ||
    typeof value?.budget?.freezePath !== 'string' ||
    typeof value?.budget?.freezeSha256 !== 'string' ||
    value?.artifacts === null || typeof value?.artifacts !== 'object' ||
    value?.performanceDebt?.status !== 'deferred' ||
    value?.performanceDebt?.phase !== 'post-optimization' ||
    value?.performanceDebt?.rootCause !== 'unknown'
  ) {
    return null;
  }
  return {
    waiverPath: value.waiverPath,
    waiverSha256: value.waiverSha256,
    automaticResult,
    baseline: value.baseline,
    subject: value.subject,
    measurementContract: value.measurementContract,
    budget: value.budget,
    artifacts: value.artifacts,
    performanceDebt: value.performanceDebt,
  };
}

function stableBinding(value) {
  if (
    value?.valid !== true ||
    value.recordPath !== FE01_PF01_AUTOMATIC_PASS_PATH ||
    typeof value.recordSha256 !== 'string' ||
    !value.comparison ||
    typeof value.comparison.runId !== 'string' ||
    value.comparison.run !== `.artifacts/performance/PF-01/${value.comparison.runId}` ||
    value.comparison.status !== 'pass' ||
    value.comparison.exitCode !== 0 ||
    value.comparison.worktreeDirty !== false
  ) {
    return null;
  }
  const binding = {
    recordPath: value.recordPath,
    recordSha256: value.recordSha256,
    comparison: value.comparison,
  };
  const evidence = exactAutomaticPassEvidence(value, binding);
  return evidence === null ? null : { ...binding, evidence };
}

/** no-sampling 的 pass manifest 必须能回指完整 immutable comparison evidence。 */
function exactAutomaticPassEvidence(value, binding) {
  const evidence = value?.automaticPassEvidence;
  return validateFe01Pf01AutomaticPassEvidence({ binding, evidence }).valid ? evidence : null;
}

/** 未来 automatic-pass record 已精确验证时，PF 步骤才不启动 sampling。 */
export function planTicketExecutionSteps({
  ticketId,
  ticket,
  automaticPassValidation,
  subjectWaiverValidation,
}) {
  if (hasExactAutomaticPassConfiguration({ ticketId, ticket })) {
    const binding = stableBinding(automaticPassValidation);
    if (binding !== null) {
      return ticket.steps.map((step) =>
        step.id === 'perf'
          ? {
              ...step,
              executionMode: AUTOMATIC_PASS_EXECUTION_MODE,
              samplingRun: false,
              historicalRunId: binding.comparison.runId,
              initialAutomaticPassValidation: 'valid',
            }
          : step,
      );
    }
  }
  if (!hasExactSubjectWaiverConfiguration({ ticketId, ticket })) return ticket.steps;
  const binding = subjectWaiverBinding(subjectWaiverValidation);
  if (binding === null) return ticket.steps;
  return ticket.steps.map((step) =>
    step.id === 'perf'
      ? {
          ...step,
          executionMode: SUBJECT_WAIVER_EXECUTION_MODE,
          samplingRun: false,
          historicalRunId: binding.automaticResult.runId,
          initialWaiverValidation: 'valid',
        }
      : step,
  );
}

/** verify:ticket 与 execution seam 共用同一判定，禁止字符串分叉。 */
export function isAutomaticPassPerfStep(step) {
  return (
    step?.id === 'perf' &&
    step.executionMode === AUTOMATIC_PASS_EXECUTION_MODE &&
    step.samplingRun === false
  );
}

export function isSubjectWaiverPerfStep(step) {
  return (
    step?.id === 'perf' &&
    step.executionMode === SUBJECT_WAIVER_EXECUTION_MODE &&
    step.samplingRun === false
  );
}

/** 结束时重做 current-HEAD binding；record、run 或任一输入漂移都拒绝 automatic pass。 */
export async function finalizeAutomaticPassValidation({
  initialAutomaticPassValidation,
  validateAutomaticPass,
}) {
  let finalAutomaticPassValidation;
  try {
    finalAutomaticPassValidation = await validateAutomaticPass();
  } catch {
    finalAutomaticPassValidation = undefined;
  }
  const initialBinding = stableBinding(initialAutomaticPassValidation);
  const finalBinding = stableBinding(finalAutomaticPassValidation);
  const bindingStable =
    initialBinding !== null &&
    finalBinding !== null &&
    JSON.stringify(initialBinding) === JSON.stringify(finalBinding);
  return {
    finalAutomaticPassValidation,
    finalAutomaticPassValidationStatus: bindingStable ? 'valid' : 'invalid',
    bindingStable,
  };
}

/** 起止均须重算同一 exact subject record，才能维持此次 manual disposition。 */
export async function finalizeSubjectWaiverValidation({
  initialSubjectWaiverValidation,
  validateSubjectWaiver,
}) {
  let finalSubjectWaiverValidation;
  try {
    finalSubjectWaiverValidation = await validateSubjectWaiver();
  } catch {
    finalSubjectWaiverValidation = undefined;
  }
  const initialBinding = subjectWaiverBinding(initialSubjectWaiverValidation);
  const finalBinding = subjectWaiverBinding(finalSubjectWaiverValidation);
  return {
    finalSubjectWaiverValidation,
    finalSubjectWaiverValidationStatus:
      initialBinding !== null && finalBinding !== null && sameJson(initialBinding, finalBinding)
        ? 'valid'
        : 'invalid',
    bindingStable:
      initialBinding !== null && finalBinding !== null && sameJson(initialBinding, finalBinding),
  };
}

/** historical automatic evidence 只有起止 exact binding 都成立时才可报告预算 pass。 */
export function automaticPassPf01BudgetState({ automaticPassCompletion }) {
  const finalValidation = automaticPassCompletion?.finalAutomaticPassValidation;
  const binding = stableBinding(finalValidation);
  const evidence = exactAutomaticPassEvidence(finalValidation, binding ?? {});
  if (
    automaticPassCompletion?.finalAutomaticPassValidationStatus === 'valid' &&
    automaticPassCompletion.bindingStable === true &&
    evidence !== null
  ) {
    return {
      label: 'historical-automatic-pass-validation（immutable comparison；未启动当前 PF sampling）',
      status: 'pass',
      validation: { valid: true, violations: [] },
      descriptorDigest: evidence.descriptor.digest,
      provenance: {
        kind: 'fe-01-pf-01-automatic-pass',
        mode: AUTOMATIC_PASS_EXECUTION_MODE,
        record: evidence.record,
        comparison: evidence.comparison,
        baseline: evidence.baselineProvenance,
        current: evidence.currentProvenance,
        budget: evidence.budget,
        descriptor: evidence.descriptor,
      },
    };
  }
  return {
    label: 'historical-automatic-pass-validation invalid（未启动当前 PF sampling）',
    status: 'fail',
    validation: {
      valid: false,
      violations: [
        ...(Array.isArray(finalValidation?.violations) ? finalValidation.violations : []),
        ...(finalValidation?.automaticPassEvidence === undefined || (binding !== null && evidence === null)
          ? ['automatic-pass immutable comparison manifest evidence incomplete']
          : []),
        'automatic-pass 起止 current-HEAD binding 不精确或发生漂移',
      ],
    },
  };
}

/** manual disposition 保留历史 automatic fail/1，绝不伪装成 automatic budget pass。 */
export function subjectWaiverPf01BudgetState({ subjectWaiverCompletion }) {
  const validation = subjectWaiverCompletion?.finalSubjectWaiverValidation;
  const binding = subjectWaiverBinding(validation);
  if (
    subjectWaiverCompletion?.finalSubjectWaiverValidationStatus === 'valid' &&
    subjectWaiverCompletion.bindingStable === true &&
    binding !== null
  ) {
    return {
      label: 'historical-subject-waiver-validation（immutable automatic fail/exit 1；未启动当前 PF sampling）',
      status: 'accepted-with-waiver',
      validation: { valid: true, violations: [] },
      descriptorDigest: binding.measurementContract.descriptorDigest,
      automaticResult: binding.automaticResult,
      provenance: {
        kind: 'fe-01-pf-01-subject-waiver',
        mode: SUBJECT_WAIVER_EXECUTION_MODE,
        record: { path: binding.waiverPath, sha256: binding.waiverSha256 },
        budget: binding.budget,
        baseline: binding.baseline,
        subject: binding.subject,
        measurementContract: binding.measurementContract,
        artifacts: binding.artifacts,
      },
      performanceDebt: binding.performanceDebt,
    };
  }
  return {
    label: 'historical-subject-waiver-validation invalid（未启动当前 PF sampling）',
    status: 'fail',
    validation: {
      valid: false,
      violations: [
        ...(Array.isArray(validation?.violations) ? validation.violations : []),
        'subject waiver 起止 exact binding 不精确或发生漂移',
      ],
    },
  };
}

/** historical automatic step 不执行 perf.mjs；常规路径仍委托 runStep。 */
export async function executeTicketStep({ step, runStepImpl }) {
  if (isSubjectWaiverPerfStep(step)) {
    return {
      exitCode: 1,
      timedOut: false,
      durationMs: 0,
      stdout: 'historical subject waiver artifact validation; automatic fail/exit 1; samplingRun=false\n',
      stderr: '',
      historical: true,
    };
  }
  if (isAutomaticPassPerfStep(step)) {
    return {
      exitCode: 0,
      timedOut: false,
      durationMs: 0,
      stdout: 'historical automatic-pass artifact validation; samplingRun=false\n',
      stderr: '',
      historical: true,
    };
  }
  return runStepImpl();
}
