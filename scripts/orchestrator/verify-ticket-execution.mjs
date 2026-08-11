/** verify:ticket 的 performance execution seam；仅未来 exact automatic-pass record 可跳过 perf.mjs。 */
import {
  FE01_PF01_AUTOMATIC_PASS_MODE,
  FE01_PF01_AUTOMATIC_PASS_PATH,
  validateFe01Pf01AutomaticPassEvidence,
} from './fe01-pf01-automatic-pass-validation.mjs';

export const AUTOMATIC_PASS_EXECUTION_MODE = FE01_PF01_AUTOMATIC_PASS_MODE;

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
export function planTicketExecutionSteps({ ticketId, ticket, automaticPassValidation }) {
  if (!hasExactAutomaticPassConfiguration({ ticketId, ticket })) return ticket.steps;
  const binding = stableBinding(automaticPassValidation);
  if (binding === null) return ticket.steps;
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

/** verify:ticket 与 execution seam 共用同一判定，禁止字符串分叉。 */
export function isAutomaticPassPerfStep(step) {
  return (
    step?.id === 'perf' &&
    step.executionMode === AUTOMATIC_PASS_EXECUTION_MODE &&
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

/** historical automatic step 不执行 perf.mjs；常规路径仍委托 runStep。 */
export async function executeTicketStep({ step, runStepImpl }) {
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
