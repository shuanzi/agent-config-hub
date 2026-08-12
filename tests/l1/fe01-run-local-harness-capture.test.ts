import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime ticket-root seam is a plain Node ESM module.
import { finalizeFe01RunLocalHarnessCapture } from '../../scripts/orchestrator/fe01-run-local-harness-capture.mjs';
// prettier-ignore
// @ts-expect-error runtime ticket-root seam is a plain Node ESM module.
import { ticketManifestExitCode } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// prettier-ignore
// @ts-expect-error runtime helper is a plain Node ESM module.
import { sha256File } from '../../scripts/orchestrator/lib.mjs';

const roots: string[] = [];
const artifact = {
  identityPath: '.artifacts/test-harness/identity.json',
  fallback: { kind: 'test-harness', identifier: 'unknown', profile: 'unknown' },
  production: 'N/A（FE-01 不产出生产 artifact）',
};

function harnessRoot() {
  const root = mkdtempSync(join(tmpdir(), 'acm-fe01-run-local-capture-'));
  roots.push(root);
  const binary = join(root, 'src-tauri/target/debug/agent-config-manager');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'fresh L3 harness binary\n');
  const identity = {
    kind: 'test-harness',
    identifier: 'com.agentconfigmanager.testharness',
    profile: 'debug',
    binary: 'src-tauri/target/debug/agent-config-manager',
    binarySha256: sha256File(binary),
    provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
  };
  const identityPath = join(root, artifact.identityPath);
  mkdirSync(dirname(identityPath), { recursive: true });
  writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`);
  return {
    root,
    binary,
    identityPath,
    evidenceRoot: join(root, '.artifacts/verification/FE-01/run'),
  };
}

function tauri(exitCode: 0 | 1 | 2) {
  return {
    id: 'tauri',
    status: exitCode === 0 ? 'pass' : exitCode === 2 ? 'inconclusive' : 'fail',
    exitCode,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('FE-01 verify-ticket run-local harness capture seam', () => {
  it.each([
    ['tauri fail', tauri(1), 'fail'],
    ['tauri inconclusive', tauri(2), 'inconclusive'],
  ])(
    '%s 保留根 verdict，且不把 stale global identity 记为本次 artifact',
    (_name, tauriStep, status) => {
      const { root, evidenceRoot } = harnessRoot();
      const outcome = finalizeFe01RunLocalHarnessCapture({
        ticketId: 'FE-01',
        overallStatus: status,
        steps: [tauriStep],
        repoRoot: root,
        evidenceRoot,
        artifact,
      });

      expect(outcome).toMatchObject({
        status,
        artifactIdentity: { identifier: 'unavailable', profile: 'unavailable' },
        capture: { disposition: 'not-attempted', reason: 'tauri-step-not-pass', tauri: tauriStep },
      });
      expect(outcome).not.toHaveProperty('runLocalHarnessAttestation');
      expect(
        ticketManifestExitCode(outcome.status, { ticketId: 'FE-01', exactSubjectWaiver: false }),
      ).toBe(tauriStep.exitCode);
    },
  );

  it.each([
    ['missing identity', ({ identityPath }: { identityPath: string }) => rmSync(identityPath)],
    ['missing binary', ({ binary }: { binary: string }) => rmSync(binary)],
    [
      'identity symlink',
      ({ root, identityPath }: { root: string; identityPath: string }) => {
        const source = join(root, 'identity-source.json');
        writeFileSync(source, readFileSync(identityPath));
        rmSync(identityPath);
        symlinkSync(source, identityPath);
      },
    ],
    [
      'identity pollution',
      ({ identityPath }: { identityPath: string }) =>
        writeFileSync(
          identityPath,
          readFileSync(identityPath, 'utf8').replace(
            'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
            'SYNTHETIC-SECRET-capture-identity',
          ),
        ),
    ],
    [
      'identity binary hash mismatch',
      ({ identityPath }: { identityPath: string }) => {
        const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
        identity.binarySha256 = '0'.repeat(64);
        writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`);
      },
    ],
  ])('tauri pass 但 %s 时写 evidence-fail manifest projection', (_name, mutate) => {
    const fixture = harnessRoot();
    mutate(fixture);
    const outcome = finalizeFe01RunLocalHarnessCapture({
      ticketId: 'FE-01',
      overallStatus: 'accepted-with-waiver',
      steps: [tauri(0)],
      repoRoot: fixture.root,
      evidenceRoot: fixture.evidenceRoot,
      artifact,
    });

    expect(outcome).toMatchObject({
      status: 'fail',
      artifactIdentity: { identifier: 'unavailable', profile: 'unavailable' },
      capture: {
        disposition: 'failed',
        reason: 'run-local-harness-capture-failed',
        tauri: tauri(0),
      },
    });
    expect(outcome).not.toHaveProperty('runLocalHarnessAttestation');
    expect(
      ticketManifestExitCode(outcome.status, { ticketId: 'FE-01', exactSubjectWaiver: false }),
    ).toBe(1);
  });

  it('tauri pass 时捕获本 run 的 v2 identity/binary，而非 unavailable 或全局路径声明', () => {
    const fixture = harnessRoot();
    const outcome = finalizeFe01RunLocalHarnessCapture({
      ticketId: 'FE-01',
      overallStatus: 'accepted-with-waiver',
      steps: [tauri(0)],
      repoRoot: fixture.root,
      evidenceRoot: fixture.evidenceRoot,
      artifact,
    });

    expect(outcome).toMatchObject({
      status: 'accepted-with-waiver',
      artifactIdentity: {
        identifier: 'com.agentconfigmanager.testharness',
        binary: 'src-tauri/target/debug/agent-config-manager',
      },
      capture: {
        disposition: 'captured',
        reason: 'tauri-pass-run-local-attestation-exact',
        tauri: tauri(0),
      },
    });
    expect(outcome?.runLocalHarnessAttestation).toMatchObject({
      schemaVersion: 1,
      identityPath: expect.stringMatching(
        /^attestations\/test-harness\/[a-f0-9]{64}\.identity\.json$/,
      ),
      binaryPath: expect.stringMatching(/^attestations\/test-harness\/[a-f0-9]{64}\.bin$/),
    });
    expect(
      existsSync(join(fixture.evidenceRoot, outcome!.runLocalHarnessAttestation!.identityPath)),
    ).toBe(true);
    expect(
      existsSync(join(fixture.evidenceRoot, outcome!.runLocalHarnessAttestation!.binaryPath)),
    ).toBe(true);
  });
});
