/** PF-01 sampling outcome is explicit, versioned, and independent of summary.status. */

export const PF01_AUTOMATED_RESULT_SCHEMA_VERSION = 1;
export const PF01_CLEAN_CONTAMINATION = Object.freeze({
  schemaVersion: 1,
  syntheticSecretHits: 0,
  personalPathHits: 0,
});

export function derivePf01AutomatedResult({
  complete,
  budgetExistedBeforeRun,
  budgetValid,
  comparisonViolations,
} = {}) {
  if (complete !== true || budgetExistedBeforeRun !== true) {
    return { schemaVersion: PF01_AUTOMATED_RESULT_SCHEMA_VERSION, status: 'inconclusive', exitCode: 2 };
  }
  if (budgetValid !== true || !Array.isArray(comparisonViolations) || comparisonViolations.length > 0) {
    return { schemaVersion: PF01_AUTOMATED_RESULT_SCHEMA_VERSION, status: 'fail', exitCode: 1 };
  }
  return { schemaVersion: PF01_AUTOMATED_RESULT_SCHEMA_VERSION, status: 'pass', exitCode: 0 };
}

export function isPf01AutomatedPassResult(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.schemaVersion === PF01_AUTOMATED_RESULT_SCHEMA_VERSION &&
    value.status === 'pass' &&
    value.exitCode === 0 &&
    Object.keys(value).sort().join(',') === 'exitCode,schemaVersion,status'
  );
}
