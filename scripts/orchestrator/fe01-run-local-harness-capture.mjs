/** FE-01 root verification 的 L3-gated run-local harness capture projection。 */
import {
  captureFe01RunLocalHarnessAttestation,
  readExactPhysicalJson,
} from './fe01-run-local-harness-attestation.mjs';

function unavailableArtifactIdentity(artifact, reason) {
  return {
    kind: artifact?.fallback?.kind ?? 'test-harness',
    identifier: 'unavailable',
    profile: 'unavailable',
    provenance: `本次 FE-01 L3 harness 未经 attestation：${reason}`,
    production: artifact?.production,
  };
}

function tauriStep(steps) {
  const step = Array.isArray(steps) ? steps.find((candidate) => candidate?.id === 'tauri') : undefined;
  return step === undefined
    ? { id: 'tauri', status: 'missing', exitCode: null }
    : { id: 'tauri', status: step.status, exitCode: step.exitCode };
}

function exactTauriPass(step) {
  return step.status === 'pass' && step.exitCode === 0;
}

/**
 * Captures global harness evidence only after this run's L3 tauri step passed.
 * Any capture failure is evidence failure: it is projected into the manifest instead of throwing.
 */
export function finalizeFe01RunLocalHarnessCapture({
  ticketId,
  overallStatus,
  steps,
  repoRoot,
  evidenceRoot,
  artifact,
}) {
  if (ticketId !== 'FE-01') return null;
  const tauri = tauriStep(steps);
  if (!exactTauriPass(tauri)) {
    return {
      status: overallStatus,
      artifactIdentity: unavailableArtifactIdentity(artifact, 'tauri-step-not-pass'),
      capture: { disposition: 'not-attempted', reason: 'tauri-step-not-pass', tauri },
    };
  }
  try {
    const runLocalHarnessAttestation = captureFe01RunLocalHarnessAttestation({
      repoRoot,
      evidenceRoot,
      artifact,
    });
    const capturedIdentity = readExactPhysicalJson(
      repoRoot,
      `${evidenceRoot}/${runLocalHarnessAttestation.identityPath}`,
    ).value;
    if (capturedIdentity === null) throw new Error('captured run-local identity cannot be reread');
    return {
      status: overallStatus,
      artifactIdentity: { ...capturedIdentity, production: artifact.production },
      runLocalHarnessAttestation,
      capture: {
        disposition: 'captured',
        reason: 'tauri-pass-run-local-attestation-exact',
        tauri,
      },
    };
  } catch {
    return {
      status: 'fail',
      artifactIdentity: unavailableArtifactIdentity(artifact, 'run-local-harness-capture-failed'),
      capture: { disposition: 'failed', reason: 'run-local-harness-capture-failed', tauri },
    };
  }
}
