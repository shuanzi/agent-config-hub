/** 将本次 FE-01 subject waiver 的 final physical eligibility 显式投影到最终 manifest。 */
export const FE01_SUBJECT_PHYSICAL_CANDIDATE = Object.freeze({
  disposition: 'candidate',
  eligible: null,
  validated: null,
  reason: 'pending-final-physical-evidence-validation',
});

export const FE01_SUBJECT_PHYSICAL_VALIDATED = Object.freeze({
  disposition: 'validated',
  eligible: true,
  validated: true,
  reason: 'final-physical-evidence-exact',
});

/** physical candidate 失败不能维持 waiver closure；index 未前进不影响已验证 candidate。 */
export function finalizeFe01SubjectWaiverPhysicalDisposition({ manifest, eligibility }) {
  if (manifest?.status !== 'accepted-with-waiver') {
    return { manifest, exactSubjectWaiver: false };
  }
  if (eligibility?.eligible === true && eligibility.validated === true) {
    return {
      manifest: { ...manifest, physicalValidation: FE01_SUBJECT_PHYSICAL_VALIDATED },
      exactSubjectWaiver: true,
    };
  }
  return {
    manifest: {
      ...manifest,
      status: 'fail',
      physicalValidation: {
        disposition: 'rejected',
        eligible: false,
        validated: false,
        reason: eligibility?.reason ?? 'final-physical-evidence-validation-failed',
      },
    },
    exactSubjectWaiver: false,
  };
}
