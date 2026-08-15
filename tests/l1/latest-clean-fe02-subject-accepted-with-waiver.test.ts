import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime index module is a plain Node ESM module.
import { maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver, validateFe02SubjectAcceptedWithWaiverCandidate } from '../../scripts/orchestrator/latest-clean-fe02-subject-accepted-with-waiver.mjs';
// prettier-ignore
// @ts-expect-error runtime root seam module is a plain Node ESM module.
import { FE02_SUBJECT_PHYSICAL_VALIDATED, finalizeFe02SubjectWaiverPhysicalDisposition } from '../../scripts/orchestrator/fe02-subject-waiver-physical-disposition.mjs';
// prettier-ignore
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { ticketManifestExitCode } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// prettier-ignore
// @ts-expect-error runtime subject waiver module is a plain Node ESM module.
import { validateFe02Pf02SubjectWaiver } from '../../scripts/orchestrator/fe02-pf02-subject-waiver.mjs';
// prettier-ignore
// @ts-expect-error runtime lineage module is a plain Node ESM module.
import { validateFe02SubjectClosureLineage } from '../../scripts/orchestrator/fe02-subject-lineage.mjs';
// prettier-ignore
// @ts-expect-error runtime evidence helper is a plain Node ESM module.
import { digestDirectory } from '../../scripts/orchestrator/lib.mjs';
// prettier-ignore
// @ts-expect-error runtime registry is a plain Node ESM module.
import { ticketConfig } from '../../scripts/orchestrator/ticket-registry.mjs';

const roots: string[] = [];
const SUBJECT_RUN_ID = '20260815T060139784Z-p84684-000';
const SUBJECT_COMMIT = '7936cb91f54c94e836124b0d46337247776431d2';
const WAIVER_PATH = 'performance/waivers/fe-02-pf-02-representative-scroll-render-stable.json';
const INDEX_PATH = '.artifacts/verification/FE-02/latest-clean-subject-accepted-with-waiver.json';
const MANUAL_DISPOSITION_SOURCE =
  '用户授权的 exact FE-02 subject PF-02 representative disposition；immutable subject artifact raw samples 与 frozen budget 重算，非本次 perf sampling。';

type Fe02Step = {
  id: string;
  layer: string;
  provenance: string;
  cmd: string;
  args: string[];
};

function headCommit(repoRoot: string) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function sampledPerformanceResult(pfId: string, profile: string) {
  const descriptorId = pfId.toLowerCase();
  return {
    pfId,
    profile,
    step: { id: `perf-${descriptorId.replace('-', '')}-${profile}`, exitCode: 0, status: 'pass' },
    descriptor: {
      path: `performance/descriptors/${descriptorId}.${profile === 'representative' ? 'source-large' : 'multifile-workbench'}.json`,
      digest: 'd'.repeat(64),
    },
    fixtureDigest: 'e'.repeat(64),
    metrics: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
    summaryRelativePath: `performance/${pfId}/${profile}/summary.json`,
    budgetState: `budget-frozen（performance/budgets/${descriptorId}.${profile}.budgets.json）`,
    validation: { valid: true },
    budgetValidation: { valid: true, comparisons: [] },
    runner: {},
    toolchain: {},
    measurementInputDigest: 'f'.repeat(64),
  };
}

function setup() {
  const rootParent = mkdtempSync(join(tmpdir(), 'acm-fe02-latest-clean-subject-waiver-'));
  roots.push(rootParent);
  const root = join(rootParent, 'repo');
  execFileSync('git', ['clone', '--no-hardlinks', '--quiet', resolve('.'), root]);
  // waiver record 与 PF evidence 不被 git 跟踪；显式复制 immutable inputs。
  mkdirSync(dirname(join(root, WAIVER_PATH)), { recursive: true });
  copyFileSync(WAIVER_PATH, join(root, WAIVER_PATH));
  cpSync(
    `.artifacts/verification/FE-02/${SUBJECT_RUN_ID}/performance`,
    join(root, '.artifacts/verification/FE-02', SUBJECT_RUN_ID, 'performance'),
    { recursive: true },
  );
  cpSync('.artifacts/performance/PF-02', join(root, '.artifacts/performance/PF-02'), {
    recursive: true,
  });

  const commit = headCommit(root);
  const waiver = validateFe02Pf02SubjectWaiver({ repoRoot: root });
  const lineage = validateFe02SubjectClosureLineage({ repoRoot: root, finalCommit: commit });
  if (!waiver.valid || !lineage.valid) {
    throw new Error(
      `test root immutable waiver/lineage unavailable: ${JSON.stringify({ waiver, lineage })}`,
    );
  }
  const runId = '20260815T120000000Z-p1-000';
  const evidenceRoot = join(root, '.artifacts/verification/FE-02', runId);
  const expectedSteps = ticketConfig('FE-02').steps as Fe02Step[];
  const manifest = {
    schemaVersion: 1,
    runId,
    scope: 'FE-02',
    evidenceScope: 'ticket-closure',
    status: 'accepted-with-waiver',
    commit,
    worktreeDirty: false,
    runIdentity: {
      startCommit: commit,
      startWorktreeDirty: false,
      endCommit: commit,
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
      'FX-02': digestDirectory(join(root, 'fixtures/fx-02')),
      'FX-03': digestDirectory(join(root, 'fixtures/fx-03')),
    },
    steps: expectedSteps.map((step) => ({
      id: step.id,
      layer: step.layer,
      provenance: step.provenance,
      command: [step.cmd, ...step.args],
      exitCode: step.id === 'perf-pf02-representative' ? 1 : 0,
      status: step.id === 'perf-pf02-representative' ? 'fail' : 'pass',
      timedOut: false,
      durationMs: 0,
      logs: {
        stdout: `steps/${step.id}/stdout.log`,
        stderr: `steps/${step.id}/stderr.log`,
        meta: `steps/${step.id}/meta.json`,
      },
      ...(step.id === 'perf-pf02-representative'
        ? {
            execution: {
              mode: 'historical-subject-waiver-validation',
              samplingRun: false,
              historicalRunId: SUBJECT_RUN_ID,
              initialWaiverValidation: 'valid',
              finalWaiverValidation: 'valid',
              bindingStable: true,
            },
          }
        : {}),
    })),
    artifactIdentity: {
      kind: 'test-harness',
      identifier: 'com.agentconfigmanager.testharness',
      profile: 'debug',
      binary: 'src-tauri/target/debug/agent-config-manager',
      binarySha256: 'a'.repeat(64),
      provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
      production: 'N/A（FE-02 不产出生产 artifact）',
    },
    performanceResults: [
      {
        pfId: 'PF-02',
        profile: 'representative',
        step: { id: 'perf-pf02-representative', exitCode: 1, status: 'fail' },
        descriptor: {
          path: 'performance/descriptors/pf-02.source-large.json',
          digest: '53df623aeb8538e1ad8e2821c287603241647de870dcd2c04c8816cb1beff86e',
        },
        fixtureDigest: 'fc1100b4835e795128117099bc6c246497a26ef0d37bbbb941c3b87d41989e56',
        metrics: [],
        summaryRelativePath: 'performance/PF-02/representative/summary.json',
        budgetState:
          'historical-subject-waiver-validation（immutable automatic fail/exit 1；未启动当前 PF sampling）',
        validation: { valid: true },
        budgetValidation: {
          status: 'historical-subject-waiver-validation',
          automaticResult: { status: 'fail', exitCode: 1 },
        },
        runner: {
          node: 'v24.18.0',
          npm: '11.16.0',
          platform: 'darwin',
          release: '25.6.0',
          macosProductVersion: '26.6.1',
          arch: 'arm64',
        },
        toolchain: {
          cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)',
          rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)',
        },
        measurementInputDigest: 'a1b474199c61bf46c769d83f22c6b7953be7f1053db0c1cbf3ed108e9259de45',
        subjectWaiver: {
          waiverPath: WAIVER_PATH,
          waiverSha256: '60a6f7dbb89da3b6a2a4c955af796a41c7b5ec5d87dc765177056fc9c4e0eb8b',
          runId: SUBJECT_RUN_ID,
          commit: SUBJECT_COMMIT,
          violation: {
            metric: 'pf02.source.scroll.render_stable',
            statistic: 'p50',
            observedMs: 12.95,
            thresholdMs: 3.9375,
            deltaMs: 9.0125,
          },
        },
      },
      sampledPerformanceResult('PF-02', 'stress'),
      sampledPerformanceResult('PF-03', 'representative'),
      sampledPerformanceResult('PF-03', 'stress'),
    ],
    performanceEvidence: { valid: true, notes: [] },
    startAt: '2026-08-15T11:59:00.000Z',
    endAt: '2026-08-15T12:00:00.000Z',
    completedAt: '2026-08-15T12:00:00.000Z',
    uncoveredBoundaries: ticketConfig('FE-02').uncoveredBoundaries,
    subjectLineage: lineage,
    manualDisposition: {
      status: waiver.manualDisposition,
      waiverValidation: 'valid',
      initialWaiverValidation: 'valid',
      finalWaiverValidation: 'valid',
      bindingStable: true,
      waiverPath: waiver.waiverPath,
      waiverSha256: waiver.waiverSha256,
      source: MANUAL_DISPOSITION_SOURCE,
    },
    pfAutomaticResult: waiver.automaticResult,
    performanceDebt: waiver.performanceDebt,
    physicalValidation: FE02_SUBJECT_PHYSICAL_VALIDATED,
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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('FE-02 latest clean subject accepted-with-waiver index', () => {
  it('只为 clean、physical、exact subject lineage manifest 写独立 index，不触碰 latest-clean-pass', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-02',
        manifest,
      }),
    ).resolves.toMatchObject({
      eligible: true,
      validated: true,
      updated: true,
      indexPath: INDEX_PATH,
    });
    const acceptedIndex = JSON.parse(readFileSync(join(root, INDEX_PATH), 'utf8'));
    expect(acceptedIndex).toMatchObject({
      schemaVersion: 1,
      ticket: 'FE-02',
      status: 'accepted-with-waiver',
      runId: manifest.runId,
      physicalValidation: manifest.physicalValidation,
      pfAutomaticResult: { status: 'fail', exitCode: 1, runId: SUBJECT_RUN_ID },
    });
    expect(existsSync(join(root, '.artifacts/verification/FE-02/latest-clean-pass.json'))).toBe(
      false,
    );
    // 同一 candidate 重放不前进也不报错。
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-02',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: false });
  });

  it('candidate disposition 未 finalize 时不前进 index；eligibility 失败时 manifest 回退 fail', async () => {
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
    const eligibility = validateFe02SubjectAcceptedWithWaiverCandidate({
      root,
      evidenceRoot,
      ticketId: 'FE-02',
      manifest: candidateManifest,
    });
    expect(eligibility).toMatchObject({ eligible: true, validated: true });
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-02',
        manifest: candidateManifest,
      }),
    ).resolves.toMatchObject({
      eligible: true,
      validated: true,
      updated: false,
      reason: 'physical-validation-disposition-not-finalized',
    });
    const accepted = finalizeFe02SubjectWaiverPhysicalDisposition({
      manifest: candidateManifest,
      eligibility,
    });
    expect(accepted.manifest.status).toBe('accepted-with-waiver');
    expect(
      ticketManifestExitCode(accepted.manifest.status, {
        ticketId: 'FE-02',
        exactSubjectWaiver: accepted.exactSubjectWaiver,
      }),
    ).toBe(0);
    writeCompleteManifest(evidenceRoot, accepted.manifest);
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-02',
        manifest: accepted.manifest,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: true });

    const rejected = finalizeFe02SubjectWaiverPhysicalDisposition({
      manifest: candidateManifest,
      eligibility: { eligible: false, validated: false, reason: 'probe' },
    });
    expect(rejected.manifest.status).toBe('fail');
    expect(
      ticketManifestExitCode(rejected.manifest.status, {
        ticketId: 'FE-02',
        exactSubjectWaiver: rejected.exactSubjectWaiver,
      }),
    ).toBe(1);
  });

  it('重新锚定实际 waiver record 与 subject artifact SHA，拒绝 drift 且不写 index', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    const record = join(root, WAIVER_PATH);
    writeFileSync(record, `${readFileSync(record, 'utf8')}\n`);
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-02',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
    expect(existsSync(join(root, INDEX_PATH))).toBe(false);

    copyFileSync(WAIVER_PATH, record);
    const samples = join(
      root,
      '.artifacts/verification/FE-02',
      SUBJECT_RUN_ID,
      'performance/PF-02/representative/samples.json',
    );
    writeFileSync(samples, `${readFileSync(samples, 'utf8')}\n`);
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-02',
        manifest,
      }),
    ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
    expect(existsSync(join(root, INDEX_PATH))).toBe(false);
  });

  it('拒绝硬门禁失败、自动 pass 伪装、dirty 或缺失 step physical evidence', async () => {
    const { root, evidenceRoot, manifest } = setup();
    const invalids = [
      { ...manifest, status: 'fail' },
      { ...manifest, worktreeDirty: true },
      {
        ...manifest,
        pfAutomaticResult: { ...manifest.pfAutomaticResult, status: 'pass', exitCode: 0 },
      },
      {
        ...manifest,
        steps: (manifest.steps as Array<Record<string, unknown>>).map((step) =>
          step.id === 'static' ? { ...step, status: 'fail', exitCode: 1 } : step,
        ),
      },
    ];
    for (const invalid of invalids) {
      writeCompleteManifest(evidenceRoot, invalid);
      await expect(
        maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-02',
          manifest: invalid,
        }),
      ).resolves.toMatchObject({ eligible: false, validated: false, updated: false });
      expect(existsSync(join(root, INDEX_PATH))).toBe(false);
    }
    writeCompleteManifest(evidenceRoot, manifest);
    rmSync(join(evidenceRoot, 'steps/static/stdout.log'));
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-02',
        manifest,
      }),
    ).resolves.toMatchObject({
      eligible: false,
      validated: false,
      reason: 'step-static-physical-file-missing-or-symlink',
      updated: false,
    });
  });

  it('existing index 被篡改或较旧 candidate 都不得覆盖 latest truth', async () => {
    const { root, evidenceRoot, manifest } = setup();
    writeCompleteManifest(evidenceRoot, manifest);
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-02',
        manifest,
      }),
    ).resolves.toMatchObject({ updated: true });
    const indexPath = join(root, INDEX_PATH);
    const originalIndex = readFileSync(indexPath, 'utf8');

    // 较旧 candidate：eligible 但不前进。
    const older = {
      ...manifest,
      runId: '20260815T110000000Z-p0-000',
      startAt: '2026-08-15T10:59:00.000Z',
      endAt: '2026-08-15T11:00:00.000Z',
      completedAt: '2026-08-15T11:00:00.000Z',
    };
    const olderEvidenceRoot = join(root, '.artifacts/verification/FE-02', older.runId);
    writeCompleteManifest(olderEvidenceRoot, older);
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot: olderEvidenceRoot,
        ticketId: 'FE-02',
        manifest: older,
      }),
    ).resolves.toMatchObject({ eligible: true, validated: true, updated: false });
    expect(readFileSync(indexPath, 'utf8')).toBe(originalIndex);

    // existing index 夹带额外顶层字段：拒绝且不覆盖。
    const tampered = `${JSON.stringify({ ...JSON.parse(originalIndex), forged: true }, null, 2)}\n`;
    writeFileSync(indexPath, tampered);
    await expect(
      maybeWriteLatestCleanFe02SubjectAcceptedWithWaiver({
        root,
        evidenceRoot: olderEvidenceRoot,
        ticketId: 'FE-02',
        manifest: older,
      }),
    ).resolves.toMatchObject({
      eligible: false,
      validated: false,
      reason: 'existing-accepted-index-schema-or-physical-validation-invalid',
      updated: false,
    });
    expect(readFileSync(indexPath, 'utf8')).toBe(tampered);
  });
});
