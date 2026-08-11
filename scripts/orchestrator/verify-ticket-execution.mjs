/** verify:ticket 的 performance execution seam；historical waiver 绝不启动 perf.mjs。 */
import {
  activePf01StepMetadata,
  FE01_PF01_ACTIVE_WAIVER_PATH,
} from './fe01-pf01-active-waiver.mjs';
import { isExactFe01ActiveWaiverValidation } from './fe01-active-waiver-verdict.mjs';

function hasActiveWaiverConfiguration({ ticketId, ticket }) {
  return (
    ticketId === 'FE-01' &&
    ticket?.performance !== null &&
    typeof ticket?.performance === 'object' &&
    Object.hasOwn(ticket.performance, 'activeWaiverPath')
  );
}

export function hasExactActiveWaiverConfiguration({ ticketId, ticket }) {
  return (
    hasActiveWaiverConfiguration({ ticketId, ticket }) &&
    ticket.performance.activeWaiverPath === FE01_PF01_ACTIVE_WAIVER_PATH
  );
}

function stableBinding(value) {
  if (!isExactFe01ActiveWaiverValidation(value)) return null;
  return {
    waiverPath: value.waiverPath,
    waiverSha256: value.waiverSha256,
    manualDisposition: value.manualDisposition,
    automaticResult: value.automaticResult,
  };
}

/** 只要 FE-01 registry 配置 active waiver，perf 都不能回退为 automatic sampling。 */
export function planTicketExecutionSteps({ ticketId, ticket, waiverValidation }) {
  if (!hasActiveWaiverConfiguration({ ticketId, ticket })) return ticket.steps;
  const metadataValidation = hasExactActiveWaiverConfiguration({ ticketId, ticket })
    ? waiverValidation
    : undefined;
  return ticket.steps.map((step) =>
    step.id === 'perf' ? { ...step, ...activePf01StepMetadata(metadataValidation) } : step,
  );
}

/** 长步骤结束后必须重新读取 immutable waiver；起止 binding 不完全相同即拒绝 closure。 */
export function finalizeActiveWaiverValidation({
  initialWaiverValidation,
  validateActiveWaiver,
  activeWaiverPathExact = true,
}) {
  if (!activeWaiverPathExact) {
    return {
      finalWaiverValidation: undefined,
      finalWaiverValidationStatus: 'invalid',
      bindingStable: false,
    };
  }
  let finalWaiverValidation;
  try {
    finalWaiverValidation = validateActiveWaiver();
  } catch {
    finalWaiverValidation = undefined;
  }
  const initialBinding = stableBinding(initialWaiverValidation);
  const finalBinding = stableBinding(finalWaiverValidation);
  const bindingStable =
    initialBinding !== null &&
    finalBinding !== null &&
    JSON.stringify(initialBinding) === JSON.stringify(finalBinding);
  return {
    finalWaiverValidation,
    finalWaiverValidationStatus: bindingStable ? 'valid' : 'invalid',
    bindingStable,
  };
}

/** historical PF evidence 不得把 invalid active waiver 伪装成 budget pass。 */
export function historicalPf01BudgetState({ initialWaiverValidation, waiverCompletion }) {
  const valid =
    waiverCompletion?.finalWaiverValidationStatus === 'valid' &&
    waiverCompletion.bindingStable === true;
  if (valid) {
    return {
      label: 'historical-artifact-validation（immutable active waiver；未启动当前 PF sampling）',
      status: 'pass',
      validation: { valid: true, violations: [] },
    };
  }
  const violations = [
    ...(Array.isArray(initialWaiverValidation?.violations)
      ? initialWaiverValidation.violations
      : []),
    ...(Array.isArray(waiverCompletion?.finalWaiverValidation?.violations)
      ? waiverCompletion.finalWaiverValidation.violations
      : []),
    'active waiver 起止 binding 不精确或发生漂移',
  ];
  return {
    label: 'historical-artifact-validation invalid（未启动当前 PF sampling）',
    status: 'fail',
    validation: { valid: false, violations: [...new Set(violations)] },
  };
}

/** historical step 合成已知 automatic fail metadata，避免调用任何 sampling command。 */
export async function executeTicketStep({ step, runStepImpl }) {
  if (step.executionMode === 'historical-artifact-validation') {
    const initialValid = step.initialWaiverValidation === 'valid';
    return {
      exitCode: initialValid ? 1 : 2,
      timedOut: false,
      durationMs: 0,
      stdout: initialValid
        ? 'historical active waiver artifact validation; samplingRun=false\n'
        : 'active waiver validation invalid; samplingRun=false\n',
      stderr: '',
      historical: true,
    };
  }
  return runStepImpl();
}
