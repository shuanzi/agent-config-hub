import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime index module is a plain Node ESM module.
import { maybeWriteLatestCleanSubjectAcceptedWithWaiver, validateFe01SubjectAcceptedWithWaiverCandidate } from '../../scripts/orchestrator/latest-clean-subject-accepted-with-waiver.mjs';
// prettier-ignore
// @ts-expect-error runtime root seam module is a plain Node ESM module.
import { finalizeFe01SubjectWaiverPhysicalDisposition } from '../../scripts/orchestrator/fe01-subject-waiver-physical-disposition.mjs';
// prettier-ignore
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { ticketManifestExitCode } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// prettier-ignore
// @ts-expect-error runtime subject waiver module is a plain Node ESM module.
import { validateFe01Pf01SubjectWaiver } from '../../scripts/orchestrator/fe01-pf01-subject-waiver.mjs';
// prettier-ignore
// @ts-expect-error runtime lineage module is a plain Node ESM module.
import { validateFe01SubjectClosureLineage } from '../../scripts/orchestrator/fe01-subject-lineage.mjs';
// prettier-ignore
// @ts-expect-error runtime evidence helper is a plain Node ESM module.
import { digestDirectory, sha256File } from '../../scripts/orchestrator/lib.mjs';
// prettier-ignore
// @ts-expect-error runtime registry is a plain Node ESM module.
import { ticketConfig } from '../../scripts/orchestrator/ticket-registry.mjs';

const roots: string[] = [];

type Fe01Step = {
  id: string;
  layer: string;
  provenance: string;
  cmd: string;
  args: string[];
};

function setup() {
  const rootParent = mkdtempSync(join(tmpdir(), 'acm-latest-clean-subject-waiver-'));
  roots.push(rootParent);
  const root = join(rootParent, 'repo');
  execFileSync('git', ['clone', '--no-hardlinks', '--quiet', resolve('.'), root]);
  cpSync('.artifacts/performance/PF-01', join(root, '.artifacts/performance/PF-01'), {
    recursive: true,
  });
  for (const relativePath of [
    'performance/budgets/pf-01.freeze.json',
    'performance/waivers/fe-01-pf-01-subject-startup-p50.json',
  ]) {
    mkdirSync(dirname(join(root, relativePath)), { recursive: true });
    copyFileSync(relativePath, join(root, relativePath));
  }
  const identityPath = '.artifacts/test-harness/identity.json';
  const sourceIdentity = JSON.parse(readFileSync(identityPath, 'utf8'));
  mkdirSync(dirname(join(root, identityPath)), { recursive: true });
  const testBinary = join(root, sourceIdentity.binary);
  mkdirSync(dirname(testBinary), { recursive: true });
  writeFileSync(testBinary, 'physical test-harness binary for accepted-index evidence\n');
  const identity = { ...sourceIdentity, binarySha256: sha256File(testBinary) };
  writeFileSync(join(root, identityPath), `${JSON.stringify(identity, null, 2)}\n`);
  const runId = '20260812T060000000Z-p1-000';
  const evidenceRoot = join(root, '.artifacts/verification/FE-01', runId);
  const waiver = validateFe01Pf01SubjectWaiver({ repoRoot: root });
  const lineage = validateFe01SubjectClosureLineage({
    repoRoot: root,
    finalCommit: '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf',
  });
  if (!waiver.valid || !lineage.valid) {
    throw new Error(
      `test root immutable waiver/lineage unavailable: ${JSON.stringify({ waiver, lineage })}`,
    );
  }
  const expectedSteps = ticketConfig('FE-01').steps as Fe01Step[];
  const perfStep = expectedSteps.find((step) => step.id === 'perf');
  if (perfStep === undefined) throw new Error('FE-01 perf step missing from registry');
  const manifest = {
    schemaVersion: 1,
    runId,
    scope: 'FE-01',
    evidenceScope: 'ticket-closure',
    status: 'accepted-with-waiver',
    commit: '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf',
    worktreeDirty: false,
    runIdentity: {
      startCommit: '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf',
      startWorktreeDirty: false,
      endCommit: '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf',
      endWorktreeDirty: false,
      consistent: true,
    },
    verificationEnvironment: {
      verification: {
        policy: 'no ambient Git/PERF_OUTPUT_DIR/PF01_*/ACM_* overrides',
        overrides: [],
      },
      build: {
        schemaVersion: 1,
        policy:
          'no ambient Git/VITE_/TAURI_/CARGO_/Rust/SDK/Node build overrides or root .env files',
        overrides: [],
      },
    },
    toolchain: {
      node: 'v24.18.0',
      npm: '11.16.0',
      rustc: 'rustc 1.97.1',
      os: 'macOS 26.6.1',
      arch: 'arm64',
    },
    fixtureDigests: {
      'FX-01': digestDirectory(join(root, 'fixtures/fx-01')),
    },
    completedAt: '2026-08-12T06:00:00.000Z',
    startAt: '2026-08-12T05:59:00.000Z',
    endAt: '2026-08-12T06:00:00.000Z',
    steps: [
      ...expectedSteps
        .filter((step) => step.id !== 'perf')
        .map((step) => ({
          id: step.id,
          layer: step.layer,
          status: 'pass',
          exitCode: 0,
          provenance: step.provenance,
          command: [step.cmd, ...step.args],
          timedOut: false,
          durationMs: 0,
          logs: {
            stdout: `steps/${step.id}/stdout.log`,
            stderr: `steps/${step.id}/stderr.log`,
            meta: `steps/${step.id}/meta.json`,
          },
        })),
      {
        id: 'perf',
        layer: perfStep.layer,
        status: 'fail',
        exitCode: 1,
        provenance: perfStep.provenance,
        command: [perfStep.cmd, ...perfStep.args],
        timedOut: false,
        durationMs: 0,
        logs: {
          stdout: 'steps/perf/stdout.log',
          stderr: 'steps/perf/stderr.log',
          meta: 'steps/perf/meta.json',
        },
        execution: {
          mode: 'historical-subject-waiver-validation',
          samplingRun: false,
          historicalRunId: '20260812T035717854Z-p74069-000',
          initialWaiverValidation: 'valid',
          finalWaiverValidation: 'valid',
          bindingStable: true,
        },
      },
    ],
    artifactIdentity: {
      kind: 'test-harness',
      ...identity,
      production: 'N/A（FE-01 不产出生产 artifact）',
    },
    budgetState:
      'historical-subject-waiver-validation（immutable automatic fail/exit 1；未启动当前 PF sampling）',
    budgetValidation: { valid: true, violations: [] },
    subjectLineage: lineage,
    pfAutomaticResult: waiver.automaticResult,
    manualDisposition: {
      status: waiver.manualDisposition,
      waiverValidation: 'valid',
      initialWaiverValidation: 'valid',
      finalWaiverValidation: 'valid',
      bindingStable: true,
      waiverPath: waiver.waiverPath,
      waiverSha256: waiver.waiverSha256,
      source:
        '用户授权的 exact FE-01 subject PF-01 disposition；immutable subject artifact raw samples 与 frozen budget 重算，非本次 perf sampling。',
    },
    pfDescriptorDigest: waiver.measurementContract?.descriptorDigest,
    pf01Provenance: {
      kind: 'fe-01-pf-01-subject-waiver',
      mode: 'historical-subject-waiver-validation',
      record: { path: waiver.waiverPath, sha256: waiver.waiverSha256 },
      budget: waiver.budget,
      baseline: waiver.baseline,
      subject: waiver.subject,
      measurementContract: waiver.measurementContract,
      artifacts: waiver.artifacts,
    },
    performanceDebt: waiver.performanceDebt,
    physicalValidation: {
      disposition: 'validated',
      eligible: true,
      validated: true,
      reason: 'final-physical-evidence-exact',
    },
    uncoveredBoundaries: [
      'PF-01 仅为 L2 Vite dev/mock 与 L3 debug test-harness 的 development acceptance profile',
      '不证明 reference-Mac、release-like 或 production artifact',
      '不更新 automatic-pass index，不能解除 RELEASE-GATE；仍需独立 release/reference evidence',
    ],
  };
  return { root, evidenceRoot, manifest };
}

function writeManifest(evidenceRoot: string, manifest: Record<string, unknown>) {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeStepEvidence(evidenceRoot: string, manifest: Record<string, unknown>) {
  const steps = manifest.steps as Array<Record<string, unknown>>;
  for (const step of steps) {
    const logs = step.logs as Record<string, string>;
    const stepDir = join(evidenceRoot, 'steps', step.id as string);
    mkdirSync(stepDir, { recursive: true });
    writeFileSync(join(evidenceRoot, logs.stdout), `actual ${step.id} stdout\n`);
    writeFileSync(join(evidenceRoot, logs.stderr), '');
    const { logs: _logs, ...meta } = step;
    writeFileSync(join(evidenceRoot, logs.meta), `${JSON.stringify(meta, null, 2)}\n`);
  }
}

function writeCompleteManifest(evidenceRoot: string, manifest: Record<string, unknown>) {
  writeManifest(evidenceRoot, manifest);
  writeStepEvidence(evidenceRoot, manifest);
}

function rawWithDuplicateStatus(raw: string) {
  return raw.replace('{\n', '{\n  "status": "accepted-with-waiver",\n');
}

function rawWithNestedDuplicateKey(raw: string) {
  return raw.replace('{\n', '{\n  "rawAudit": { "duplicate": "first", "duplicate": "second" },\n');
}

function rawWithContaminatedStatus(raw: string, text: string) {
  return raw.replace('"status": "accepted-with-waiver"', `"status": "${text}"`);
}

function rawWithContaminatedIdentityProvenance(raw: string, text: string) {
  return raw.replace(/"provenance":\s*"[^"]*"/, `"provenance": "${text}"`);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('latest clean subject accepted-with-waiver index', () => {
  it('root seam 将 invalid final physical candidate 降为 nonzero，已验证但 index 不前进仍保持 accepted 0', async () => {
    const { root, evidenceRoot, manifest } = setup();
    const candidateManifest = {
      ...manifest,
      physicalValidation: {
        disposition: 'candidate',
        eligible: null,
        validated: null,
        reason: 'pending-final-physical-evidence-validation',
      },
    };
    writeCompleteManifest(evidenceRoot, candidateManifest);
    const valid = validateFe01SubjectAcceptedWithWaiverCandidate({
      root,
      evidenceRoot,
      ticketId: 'FE-01',
      manifest: candidateManifest,
    });
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: candidateManifest,
      }),
    ).resolves.toMatchObject({
      eligible: true,
      validated: true,
      updated: false,
      reason: 'physical-validation-disposition-not-finalized',
    });
    const accepted = finalizeFe01SubjectWaiverPhysicalDisposition({
      manifest: candidateManifest,
      eligibility: valid,
    });
    expect(accepted.manifest.status).toBe('accepted-with-waiver');
    expect(accepted.manifest.physicalValidation).toMatchObject({
      disposition: 'validated',
      eligible: true,
      validated: true,
    });
    expect(
      ticketManifestExitCode(accepted.manifest.status, {
        ticketId: 'FE-01',
        exactSubjectWaiver: accepted.exactSubjectWaiver,
      }),
    ).toBe(0);
    writeCompleteManifest(evidenceRoot, accepted.manifest);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: accepted.manifest,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: true });
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: accepted.manifest,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: false });

    const invalidEvidence = [
      () => rmSync(join(evidenceRoot, 'steps/static/stdout.log')),
      () => writeFileSync(join(evidenceRoot, 'steps/static/meta.json'), '{"tampered":true}\n'),
      () => {
        const stdout = join(evidenceRoot, 'steps/static/stdout.log');
        const source = join(evidenceRoot, 'physical-source.log');
        writeFileSync(source, 'physical source\n');
        rmSync(stdout, { force: true });
        symlinkSync(source, stdout);
      },
      () => {
        const identity = join(root, '.artifacts/test-harness/identity.json');
        const value = JSON.parse(readFileSync(identity, 'utf8'));
        value.binarySha256 = '0'.repeat(64);
        writeFileSync(identity, `${JSON.stringify(value)}\n`);
      },
    ];
    for (const mutate of invalidEvidence) {
      writeCompleteManifest(evidenceRoot, candidateManifest);
      const identity = join(root, '.artifacts/test-harness/identity.json');
      const originalIdentity = readFileSync(identity, 'utf8');
      mutate();
      const rejected = finalizeFe01SubjectWaiverPhysicalDisposition({
        manifest: candidateManifest,
        eligibility: validateFe01SubjectAcceptedWithWaiverCandidate({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: candidateManifest,
        }),
      });
      expect(rejected.manifest.status).toBe('fail');
      expect(rejected.manifest.physicalValidation).toMatchObject({
        disposition: 'rejected',
        eligible: false,
        validated: false,
      });
      expect(
        ticketManifestExitCode(rejected.manifest.status, {
          ticketId: 'FE-01',
          exactSubjectWaiver: rejected.exactSubjectWaiver,
        }),
      ).toBe(1);
      if (existsSync(identity)) writeFileSync(identity, originalIdentity);
    }
  }, 60_000);

  it('缺少 final 侧任一步 physical stdout/stderr/meta evidence 时不推进 index', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeManifest(evidenceRoot, manifest);

    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
    expect(
      existsSync(
        join(root, '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json'),
      ),
    ).toBe(false);
  });

  it('只为 clean、physical、exact subject lineage manifest 写独立 index，不触碰 latest-clean-pass', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({
      eligible: true,
      validated: true,
      updated: true,
      indexPath: '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    });
    const acceptedIndex = JSON.parse(
      readFileSync(
        join(root, '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json'),
        'utf8',
      ),
    );
    expect(acceptedIndex).toMatchObject({
      status: 'accepted-with-waiver',
      runId: manifest.runId,
      physicalValidation: manifest.physicalValidation,
    });
    expect(existsSync(join(root, '.artifacts/verification/FE-01/latest-clean-pass.json'))).toBe(
      false,
    );
  });

  it('拒绝 existing accepted index 缺失、夹带或漂移 physical validation，且不覆盖', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ updated: true });
    const indexPath = join(
      root,
      '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    );
    const original = JSON.parse(readFileSync(indexPath, 'utf8'));
    const invalidIndexes = [
      (() => {
        const index = structuredClone(original);
        delete index.physicalValidation;
        return index;
      })(),
      {
        ...structuredClone(original),
        physicalValidation: { ...original.physicalValidation, unexpected: true },
      },
      {
        ...structuredClone(original),
        physicalValidation: {
          ...original.physicalValidation,
          reason: 'forged-final-physical-evidence-validation',
        },
      },
      { ...structuredClone(original), unexpectedTopLevel: true },
    ];
    for (const invalidIndex of invalidIndexes) {
      const written = `${JSON.stringify(invalidIndex, null, 2)}\n`;
      writeFileSync(indexPath, written);
      await expect(
        maybeWriteLatestCleanSubjectAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest,
        }),
      ).resolves.toMatchObject({
        eligible: false,
        validated: false,
        reason: 'existing-accepted-index-schema-or-physical-validation-invalid',
        updated: false,
      });
      expect(readFileSync(indexPath, 'utf8')).toBe(written);
    }
  });

  it('candidate manifest 原始 bytes 含 duplicate key、synthetic secret 或个人路径时拒绝且 root 非零', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    const manifestPath = join(evidenceRoot, 'manifest.json');
    const originalManifest = readFileSync(manifestPath, 'utf8');
    const rawMutations: Array<[string, (raw: string) => string, string]> = [
      ['duplicate key', rawWithDuplicateStatus, 'physical-manifest-raw-invalid-or-duplicate-key'],
      [
        'synthetic secret',
        (raw) => rawWithContaminatedStatus(raw, 'SYNTHETIC-SECRET-candidate-manifest'),
        'physical-manifest-raw-contaminated',
      ],
      [
        'personal path',
        (raw) => rawWithContaminatedStatus(raw, '/Users/reviewer/candidate-manifest'),
        'physical-manifest-raw-contaminated',
      ],
    ];
    for (const [_name, mutate, reason] of rawMutations) {
      writeFileSync(manifestPath, mutate(originalManifest));
      const rejected = await maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      });
      expect(rejected).toMatchObject({ eligible: false, validated: false, reason, updated: false });
      const final = finalizeFe01SubjectWaiverPhysicalDisposition({
        manifest,
        eligibility: rejected,
      });
      expect(
        ticketManifestExitCode(final.manifest.status, {
          ticketId: 'FE-01',
          exactSubjectWaiver: final.exactSubjectWaiver,
        }),
      ).toBe(1);
      expect(
        existsSync(
          join(
            root,
            '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
          ),
        ),
      ).toBe(false);
    }
  });

  it('existing index 与 backing manifest 的原始 bytes 含 duplicate key 或污染时拒绝且不覆盖', async () => {
    const { root, evidenceRoot, manifest } = setup();
    const olderManifest = {
      ...manifest,
      runId: '20260812T055900000Z-p0-000',
      startAt: '2026-08-12T05:58:00.000Z',
      endAt: '2026-08-12T05:59:00.000Z',
      completedAt: '2026-08-12T05:59:00.000Z',
    };
    const olderEvidenceRoot = join(root, '.artifacts/verification/FE-01', olderManifest.runId);
    writeCompleteManifest(evidenceRoot, manifest);
    writeCompleteManifest(olderEvidenceRoot, olderManifest);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: true });
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot: olderEvidenceRoot,
        ticketId: 'FE-01',
        manifest: olderManifest,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: false });
    const indexPath = join(
      root,
      '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    );
    const manifestPath = join(evidenceRoot, 'manifest.json');
    const originalIndex = readFileSync(indexPath, 'utf8');
    const originalManifest = readFileSync(manifestPath, 'utf8');
    const rawMutations: Array<[string, (raw: string) => string]> = [
      ['duplicate key', rawWithDuplicateStatus],
      ['synthetic secret', (raw) => rawWithContaminatedStatus(raw, 'SYNTHETIC-SECRET-existing')],
      ['personal path', (raw) => rawWithContaminatedStatus(raw, '/Users/reviewer/existing')],
    ];
    for (const [_name, mutate] of rawMutations) {
      const indexRaw = mutate(originalIndex);
      writeFileSync(indexPath, indexRaw);
      const indexRejected = await maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot: olderEvidenceRoot,
        ticketId: 'FE-01',
        manifest: olderManifest,
      });
      expect(indexRejected).toMatchObject({
        eligible: false,
        validated: false,
        reason: 'existing-accepted-index-raw-invalid-or-contaminated',
        updated: false,
      });
      const indexFinal = finalizeFe01SubjectWaiverPhysicalDisposition({
        manifest: olderManifest,
        eligibility: indexRejected,
      });
      expect(
        ticketManifestExitCode(indexFinal.manifest.status, {
          ticketId: 'FE-01',
          exactSubjectWaiver: indexFinal.exactSubjectWaiver,
        }),
      ).toBe(1);
      expect(readFileSync(indexPath, 'utf8')).toBe(indexRaw);
      writeFileSync(indexPath, originalIndex);

      const manifestRaw = mutate(originalManifest);
      writeFileSync(manifestPath, manifestRaw);
      const manifestRejected = await maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot: olderEvidenceRoot,
        ticketId: 'FE-01',
        manifest: olderManifest,
      });
      expect(manifestRejected).toMatchObject({
        eligible: false,
        validated: false,
        reason: 'existing-accepted-index-manifest-raw-invalid-or-contaminated',
        updated: false,
      });
      const final = finalizeFe01SubjectWaiverPhysicalDisposition({
        manifest: olderManifest,
        eligibility: manifestRejected,
      });
      expect(
        ticketManifestExitCode(final.manifest.status, {
          ticketId: 'FE-01',
          exactSubjectWaiver: final.exactSubjectWaiver,
        }),
      ).toBe(1);
      expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
      writeFileSync(manifestPath, originalManifest);
    }
  });

  it('嵌套 raw JSON、harness identity 与 physical containment 皆不能覆盖 existing index', async () => {
    const { root, evidenceRoot, manifest } = setup();
    const olderManifest = {
      ...manifest,
      runId: '20260812T055900000Z-p0-000',
      startAt: '2026-08-12T05:58:00.000Z',
      endAt: '2026-08-12T05:59:00.000Z',
      completedAt: '2026-08-12T05:59:00.000Z',
    };
    const olderEvidenceRoot = join(root, '.artifacts/verification/FE-01', olderManifest.runId);
    writeCompleteManifest(evidenceRoot, manifest);
    writeCompleteManifest(olderEvidenceRoot, olderManifest);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: true });
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot: olderEvidenceRoot,
        ticketId: 'FE-01',
        manifest: olderManifest,
      }),
    ).resolves.toMatchObject({
      eligible: true,
      validated: true,
      updated: false,
      reason: 'final-physical-evidence-validated-not-advanced',
    });

    const indexPath = join(
      root,
      '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    );
    const currentManifestPath = join(evidenceRoot, 'manifest.json');
    const olderManifestPath = join(olderEvidenceRoot, 'manifest.json');
    const identityPath = join(root, '.artifacts/test-harness/identity.json');
    const originalIndex = readFileSync(indexPath, 'utf8');
    const originalCurrentManifest = readFileSync(currentManifestPath, 'utf8');
    const originalOlderManifest = readFileSync(olderManifestPath, 'utf8');
    const originalIdentity = readFileSync(identityPath, 'utf8');

    const assertRejected = async () => {
      const rejected = await maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot: olderEvidenceRoot,
        ticketId: 'FE-01',
        manifest: olderManifest,
      });
      expect(rejected).toMatchObject({ eligible: false, validated: false, updated: false });
      const final = finalizeFe01SubjectWaiverPhysicalDisposition({
        manifest: olderManifest,
        eligibility: rejected,
      });
      expect(final.manifest.status).toBe('fail');
      expect(
        ticketManifestExitCode(final.manifest.status, {
          ticketId: 'FE-01',
          exactSubjectWaiver: final.exactSubjectWaiver,
        }),
      ).toBe(1);
    };

    writeFileSync(olderManifestPath, rawWithNestedDuplicateKey(originalOlderManifest));
    await assertRejected();
    expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    writeFileSync(olderManifestPath, originalOlderManifest);

    writeFileSync(indexPath, rawWithNestedDuplicateKey(originalIndex));
    await assertRejected();
    expect(readFileSync(indexPath, 'utf8')).toBe(rawWithNestedDuplicateKey(originalIndex));
    writeFileSync(indexPath, originalIndex);

    writeFileSync(currentManifestPath, rawWithNestedDuplicateKey(originalCurrentManifest));
    await assertRejected();
    expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    writeFileSync(currentManifestPath, originalCurrentManifest);

    for (const raw of [
      rawWithNestedDuplicateKey(originalIdentity),
      rawWithContaminatedIdentityProvenance(originalIdentity, 'SYNTHETIC-SECRET-harness-identity'),
      rawWithContaminatedIdentityProvenance(originalIdentity, '/Users/reviewer/harness-identity'),
    ]) {
      writeFileSync(identityPath, raw);
      await assertRejected();
      expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
      writeFileSync(identityPath, originalIdentity);
    }

    const identitySource = join(root, 'identity-source.json');
    writeFileSync(identitySource, originalIdentity);
    rmSync(identityPath);
    symlinkSync(identitySource, identityPath);
    await assertRejected();
    expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    rmSync(identityPath);
    writeFileSync(identityPath, originalIdentity);

    const candidateManifestSource = join(root, 'candidate-manifest-source.json');
    writeFileSync(candidateManifestSource, originalOlderManifest);
    rmSync(olderManifestPath);
    symlinkSync(candidateManifestSource, olderManifestPath);
    await assertRejected();
    expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    rmSync(olderManifestPath);
    writeFileSync(olderManifestPath, originalOlderManifest);

    const indexSource = join(root, 'index-source.json');
    writeFileSync(indexSource, originalIndex);
    rmSync(indexPath);
    symlinkSync(indexSource, indexPath);
    await assertRejected();
    expect(lstatSync(indexPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    rmSync(indexPath);
    writeFileSync(indexPath, originalIndex);

    const containedIndex = JSON.parse(originalIndex);
    containedIndex.manifestPath = '../outside/manifest.json';
    writeFileSync(indexPath, `${JSON.stringify(containedIndex, null, 2)}\n`);
    await assertRejected();
    expect(readFileSync(indexPath, 'utf8')).toContain('../outside/manifest.json');
  }, 45_000);

  it('existing latest 的 backing physical evidence 漂移时，拒绝较旧但自身完整的 candidate 且不覆盖', async () => {
    const { root, evidenceRoot, manifest } = setup();
    const olderManifest = {
      ...manifest,
      runId: '20260812T055900000Z-p0-000',
      startAt: '2026-08-12T05:58:00.000Z',
      endAt: '2026-08-12T05:59:00.000Z',
      completedAt: '2026-08-12T05:59:00.000Z',
    };
    const olderEvidenceRoot = join(root, '.artifacts/verification/FE-01', olderManifest.runId);
    writeCompleteManifest(evidenceRoot, manifest);
    writeCompleteManifest(olderEvidenceRoot, olderManifest);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: true });
    const indexPath = join(
      root,
      '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    );
    const originalIndex = readFileSync(indexPath, 'utf8');
    const mutations: Array<[() => void, string]> = [
      [
        () => rmSync(join(evidenceRoot, 'steps/static/stdout.log')),
        'existing-accepted-index-backing-step-static-physical-file-missing-or-symlink',
      ],
      [
        () => writeFileSync(join(evidenceRoot, 'steps/static/meta.json'), '{"tampered":true}\n'),
        'existing-accepted-index-backing-step-static-meta-does-not-match-manifest',
      ],
      [
        () => {
          const tampered = structuredClone(manifest);
          tampered.manualDisposition.source = 'forged accepted-index backing waiver binding';
          writeCompleteManifest(evidenceRoot, tampered);
        },
        'existing-accepted-index-backing-immutable-waiver-or-lineage-binding-invalid',
      ],
      [
        () => {
          const tampered = structuredClone(manifest);
          tampered.subjectLineage.projection.subjectDigest = 'a'.repeat(64);
          tampered.subjectLineage.projection.finalDigest = 'a'.repeat(64);
          writeCompleteManifest(evidenceRoot, tampered);
        },
        'existing-accepted-index-backing-immutable-waiver-or-lineage-binding-invalid',
      ],
    ];
    for (const [mutate, reason] of mutations) {
      mutate();
      const rejected = await maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot: olderEvidenceRoot,
        ticketId: 'FE-01',
        manifest: olderManifest,
      });
      expect(rejected).toMatchObject({ eligible: false, validated: false, reason, updated: false });
      const final = finalizeFe01SubjectWaiverPhysicalDisposition({
        manifest: olderManifest,
        eligibility: rejected,
      });
      expect(final.manifest.status).toBe('fail');
      expect(
        ticketManifestExitCode(final.manifest.status, {
          ticketId: 'FE-01',
          exactSubjectWaiver: final.exactSubjectWaiver,
        }),
      ).toBe(1);
      expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
      writeCompleteManifest(evidenceRoot, manifest);
    }
  });

  it('拒绝篡改、污染、symlink 或 final fixture/harness identity 漂移的 physical evidence，且不覆盖既有 index', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ updated: true });
    const indexPath = join(
      root,
      '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    );
    const originalIndex = readFileSync(indexPath, 'utf8');
    const assertNotUpdated = async () => {
      await expect(
        maybeWriteLatestCleanSubjectAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest,
        }),
      ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
      expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    };

    writeFileSync(join(evidenceRoot, 'steps/static/meta.json'), '{"tampered":true}\n');
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({
      reason: 'step-static-meta-does-not-match-manifest',
      updated: false,
    });
    expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    writeStepEvidence(evidenceRoot, manifest);

    const staticStep = manifest.steps.find((step) => step.id === 'static')!;
    for (const alteredStep of [
      { ...staticStep, layer: 'L9' },
      { ...staticStep, provenance: 'untrusted but clean provenance' },
      { ...staticStep, command: ['node', 'scripts/orchestrator/untrusted.mjs'] },
    ]) {
      const altered = {
        ...manifest,
        steps: manifest.steps.map((step) => (step.id === 'static' ? alteredStep : step)),
      };
      writeCompleteManifest(evidenceRoot, altered);
      await expect(
        maybeWriteLatestCleanSubjectAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: altered,
        }),
      ).resolves.toMatchObject({
        eligible: false,
        validated: false,
        reason: 'manifest-schema-or-step-identity-invalid',
        updated: false,
      });
    }
    writeCompleteManifest(evidenceRoot, manifest);

    writeFileSync(join(evidenceRoot, 'steps/static/meta.json'), '{"id":"static","id":"static"}\n');
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({
      reason: 'step-static-meta-invalid-or-duplicate-key',
      updated: false,
    });
    writeStepEvidence(evidenceRoot, manifest);

    const { logs: _logs, ...expectedStaticMeta } = staticStep;
    writeFileSync(
      join(evidenceRoot, 'steps/static/meta.json'),
      `${JSON.stringify({ ...expectedStaticMeta, rawLeak: 'SYNTHETIC-SECRET-meta' })}\n`,
    );
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ reason: 'step-static-meta-raw-contaminated', updated: false });
    writeStepEvidence(evidenceRoot, manifest);

    const contaminated = {
      ...manifest,
      steps: manifest.steps.map((step) =>
        step.id === 'static' ? { ...step, provenance: '/Users/evidence-leak' } : step,
      ),
    };
    writeCompleteManifest(evidenceRoot, contaminated);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: contaminated,
      }),
    ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
    expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    writeCompleteManifest(evidenceRoot, manifest);

    writeFileSync(
      join(evidenceRoot, 'steps/static/stdout.log'),
      'SYNTHETIC-SECRET-final-evidence\n',
    );
    await assertNotUpdated();
    writeStepEvidence(evidenceRoot, manifest);

    const stdout = join(evidenceRoot, 'steps/static/stdout.log');
    const source = join(evidenceRoot, 'step-source.log');
    writeFileSync(source, 'physical source\n');
    rmSync(stdout);
    symlinkSync(source, stdout);
    await assertNotUpdated();
    rmSync(stdout);
    writeStepEvidence(evidenceRoot, manifest);

    const fixture = join(root, 'fixtures/fx-01/fixture.json');
    const fixtureOriginal = readFileSync(fixture, 'utf8');
    writeFileSync(fixture, `${fixtureOriginal}\n`);
    await assertNotUpdated();
    writeFileSync(fixture, fixtureOriginal);

    const identity = join(root, '.artifacts/test-harness/identity.json');
    const identityOriginal = readFileSync(identity, 'utf8');
    const forgedIdentity = JSON.parse(identityOriginal);
    forgedIdentity.binarySha256 = '0'.repeat(64);
    writeFileSync(identity, `${JSON.stringify(forgedIdentity, null, 2)}\n`);
    await assertNotUpdated();
    writeFileSync(identity, identityOriginal);

    const binary = join(root, manifest.artifactIdentity.binary);
    const binaryOriginal = readFileSync(binary);
    writeFileSync(binary, 'tampered test-harness binary\n');
    await assertNotUpdated();
    writeFileSync(binary, binaryOriginal);
  });

  it('拒绝硬门禁失败、自动 pass、dirty、contamination 或 lineage 漂移', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    await maybeWriteLatestCleanSubjectAcceptedWithWaiver({
      root,
      evidenceRoot,
      ticketId: 'FE-01',
      manifest,
    });
    const indexPath = join(
      root,
      '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    );
    const originalIndex = readFileSync(indexPath, 'utf8');
    const forgedProvenance = structuredClone(manifest);
    const forgedArtifacts = forgedProvenance.pf01Provenance.artifacts as Record<
      string,
      Record<string, string>
    >;
    for (const [index, artifact] of Object.entries(forgedArtifacts)) {
      for (const file of Object.keys(artifact)) {
        artifact[file] = (index === 'baseline' ? 'a' : 'b').repeat(64);
      }
    }
    for (const tree of Object.keys(forgedProvenance.subjectLineage.trees)) {
      forgedProvenance.subjectLineage.trees[tree] = {
        subject: 'c'.repeat(40),
        final: 'c'.repeat(40),
      };
    }
    forgedProvenance.subjectLineage.projection.subjectDigest = 'd'.repeat(64);
    forgedProvenance.subjectLineage.projection.finalDigest = 'd'.repeat(64);
    for (const file of Object.keys(forgedProvenance.subjectLineage.projection.entries)) {
      forgedProvenance.subjectLineage.projection.entries[file] = {
        subject: 'e'.repeat(40),
        final: 'e'.repeat(40),
      };
    }
    const invalids = [
      { ...manifest, status: 'fail' },
      { ...manifest, worktreeDirty: true },
      { ...manifest, contamination: { hits: ['x'] } },
      {
        ...manifest,
        pfAutomaticResult: { ...manifest.pfAutomaticResult, status: 'pass', exitCode: 0 },
      },
      { ...manifest, subjectLineage: { ...manifest.subjectLineage, valid: false } },
      {
        ...manifest,
        pf01Provenance: {
          ...manifest.pf01Provenance,
          artifacts: { baseline: manifest.pf01Provenance.artifacts.baseline },
        },
      },
      {
        ...manifest,
        subjectLineage: {
          ...manifest.subjectLineage,
          trees: { src: manifest.subjectLineage.trees.src },
        },
      },
      {
        ...manifest,
        subjectLineage: {
          ...manifest.subjectLineage,
          projection: {
            ...manifest.subjectLineage.projection,
            entries: { 'src/App.tsx': manifest.subjectLineage.projection.entries['src/App.tsx'] },
          },
        },
      },
      forgedProvenance,
      {
        ...manifest,
        steps: manifest.steps.map((step: { id: string; execution?: { samplingRun: boolean } }) =>
          step.id === 'static' ? { ...step, status: 'fail', exitCode: 1 } : step,
        ),
      },
      {
        ...manifest,
        steps: manifest.steps.map((step) => {
          if (step.id !== 'perf') return step;
          return {
            ...step,
            execution: { ...('execution' in step ? step.execution : {}), samplingRun: true },
          };
        }),
      },
    ];
    for (const invalid of invalids) {
      writeCompleteManifest(evidenceRoot, invalid);
      await expect(
        maybeWriteLatestCleanSubjectAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: invalid,
        }),
      ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
      expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    }
  });

  it('重新锚定实际 waiver record、14 SHA 与 lineage，拒绝 record/artifact drift', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    const record = join(root, 'performance/waivers/fe-01-pf-01-subject-startup-p50.json');
    writeFileSync(record, `${readFileSync(record, 'utf8')}\n`);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
    expect(
      existsSync(
        join(root, '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json'),
      ),
    ).toBe(false);

    copyFileSync('performance/waivers/fe-01-pf-01-subject-startup-p50.json', record);
    const samples = join(
      root,
      '.artifacts/performance/PF-01/20260812T035717854Z-p74069-000/samples.json',
    );
    writeFileSync(samples, `${readFileSync(samples, 'utf8')}\n`);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
    expect(
      existsSync(
        join(root, '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json'),
      ),
    ).toBe(false);
  });

  it('无论 index 是否已存在，均拒绝未声明或缺失的 manifest 顶层字段', async () => {
    const { root, evidenceRoot, manifest } = setup();
    const indexPath = join(
      root,
      '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    );
    const invalids = [
      { ...manifest, untrustedTopLevelClaim: 'must not advance accepted index' },
      Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'toolchain')),
    ];
    for (const invalid of invalids) {
      writeCompleteManifest(evidenceRoot, invalid as typeof manifest);
      await expect(
        maybeWriteLatestCleanSubjectAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: invalid,
        }),
      ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
      expect(existsSync(indexPath)).toBe(false);
    }

    writeCompleteManifest(evidenceRoot, manifest);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ updated: true });
    const originalIndex = readFileSync(indexPath, 'utf8');
    for (const invalid of invalids) {
      writeCompleteManifest(evidenceRoot, invalid as typeof manifest);
      await expect(
        maybeWriteLatestCleanSubjectAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: invalid,
        }),
      ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
      expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);
    }
  });

  it('拒绝与入参不一致或经 symlink 提供的 physical manifest', async () => {
    const { root, evidenceRoot, manifest } = setup();
    const indexPath = join(
      root,
      '.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json',
    );
    writeCompleteManifest(evidenceRoot, { ...manifest, completedAt: '2026-08-12T06:00:01.000Z' });
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
    expect(existsSync(indexPath)).toBe(false);

    const manifestPath = join(evidenceRoot, 'manifest.json');
    const sourcePath = join(root, 'manifest-source.json');
    writeFileSync(sourcePath, `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(manifestPath);
    symlinkSync(sourcePath, manifestPath);
    await expect(
      maybeWriteLatestCleanSubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
    expect(existsSync(indexPath)).toBe(false);
  });
});
