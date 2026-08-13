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
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { maybeWriteLatestCleanAcceptedWithWaiver } from '../../scripts/orchestrator/latest-clean-accepted-with-waiver.mjs';
// @ts-expect-error runtime waiver module is a plain Node ESM module.
import { FE01_PF01_ACTIVE_WAIVER_ARTIFACT_SHA256 } from '../../scripts/orchestrator/fe01-pf01-active-waiver.mjs';
// @ts-expect-error runtime waiver module is a plain Node ESM module.
import { FE01_PF01_ACTIVE_WAIVER_SHA256 } from '../../scripts/orchestrator/fe01-pf01-active-waiver.mjs';
// @ts-expect-error runtime verdict module is a plain Node ESM module.
import { FE01_ACTIVE_WAIVER_CLOSURE_STEPS } from '../../scripts/orchestrator/fe01-active-waiver-verdict.mjs';

const roots: string[] = [];
type ClosureStep = { id: string; status: string; exitCode: number };

const layers: Record<string, string> = {
  toolchain: 'L0',
  static: 'L0',
  rust: 'L1',
  frontend: 'L1',
  ui: 'L2',
  tauri: 'L3',
  perf: 'PF',
};

function closureSteps() {
  return (FE01_ACTIVE_WAIVER_CLOSURE_STEPS as ClosureStep[]).map((step: ClosureStep) => ({
    ...step,
    layer: layers[step.id],
    provenance: 'actual test',
    ...(step.id === 'perf'
      ? {
          execution: {
            mode: 'historical-artifact-validation',
            samplingRun: false,
            historicalRunId: '20260811T112008912Z-p30755-000',
            initialWaiverValidation: 'valid',
            finalWaiverValidation: 'valid',
            bindingStable: true,
          },
        }
      : {}),
  }));
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'acm-latest-clean-waiver-'));
  roots.push(root);
  const runId = '20260811T030000000Z-p1-000';
  const evidenceRoot = join(root, '.artifacts/verification/FE-01', runId);
  const acceptedIndexPath = join(
    root,
    '.artifacts/verification/FE-01/latest-clean-accepted-with-waiver.json',
  );
  const passIndexPath = join(root, '.artifacts/verification/FE-01/latest-clean-pass.json');
  const manifest = {
    runId,
    scope: 'FE-01',
    evidenceScope: 'ticket-closure',
    status: 'accepted-with-waiver',
    commit: 'a'.repeat(40),
    worktreeDirty: false,
    completedAt: '2026-08-11T03:00:00.000Z',
    steps: closureSteps(),
    pfAutomaticResult: {
      status: 'fail',
      exitCode: 1,
      automatedExitCode: 1,
      automatedExitCodeSource:
        'immutable active waiver artifact validation; no current perf sampling was started',
      runId: '20260811T112008912Z-p30755-000',
      run: '.artifacts/performance/PF-01/20260811T112008912Z-p30755-000',
      commit: 'ef1fd9823d286616ed108576c543b6f4980b5fcd',
      worktreeDirty: false,
      violation: {
        metric: 'pf01.search.results_visible',
        statistic: 'p95',
        observedMs: 11.645,
        thresholdMs: 10,
        deltaMs: 1.645,
      },
      artifactDirectory: '.artifacts/performance/PF-01/20260811T112008912Z-p30755-000',
      artifactSha256: { ...FE01_PF01_ACTIVE_WAIVER_ARTIFACT_SHA256 },
    },
    manualDisposition: {
      status: 'accepted-with-waiver',
      waiverValidation: 'valid',
      initialWaiverValidation: 'valid',
      finalWaiverValidation: 'valid',
      bindingStable: true,
      waiverPath: 'performance/waivers/fe-01-pf-01-search-results-active.json',
      waiverSha256: FE01_PF01_ACTIVE_WAIVER_SHA256,
      source:
        '用户授权的 exact FE-01 PF-01 disposition；immutable active artifact 的 raw samples 与 frozen budget 重算，非本次 perf sampling。',
    },
  };
  return { root, evidenceRoot, acceptedIndexPath, passIndexPath, manifest };
}

function writeManifest(evidenceRoot: string, manifest: object): void {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('latest clean accepted-with-waiver evidence index', () => {
  it('does not create an accepted index for a manifest that omits closure steps or immutable hash bindings', async () => {
    const { root, evidenceRoot, acceptedIndexPath, manifest } = setup();
    const rejected = [
      { ...manifest, steps: manifest.steps.filter((step: ClosureStep) => step.id !== 'static') },
      {
        ...manifest,
        steps: manifest.steps.map((step: ClosureStep) =>
          step.id === 'ui' ? { ...step, exitCode: 1 } : step,
        ),
      },
      {
        ...manifest,
        steps: [
          ...manifest.steps,
          { id: 'extra', status: 'pass', exitCode: 0, layer: 'L1', provenance: 'actual test' },
        ],
      },
      {
        ...manifest,
        pfAutomaticResult: { ...manifest.pfAutomaticResult, artifactSha256: {} },
      },
      {
        ...manifest,
        pfAutomaticResult: {
          ...manifest.pfAutomaticResult,
          artifactSha256: {
            ...manifest.pfAutomaticResult.artifactSha256,
            'proposed-budgets.json': 'a'.repeat(64),
          },
        },
      },
      {
        ...manifest,
        manualDisposition: { ...manifest.manualDisposition, waiverSha256: 'a'.repeat(64) },
      },
      {
        ...manifest,
        manualDisposition: {
          ...manifest.manualDisposition,
          finalWaiverValidation: 'invalid',
        },
      },
      {
        ...manifest,
        manualDisposition: {
          ...manifest.manualDisposition,
          waiverPath: 'performance/waivers/fe-01-pf-01-l3-cold-start.json',
        },
      },
      {
        ...manifest,
        steps: manifest.steps.map((step: ClosureStep & { execution?: unknown }) =>
          step.id === 'perf' ? { ...step, execution: undefined } : step,
        ),
      },
      {
        ...manifest,
        steps: manifest.steps.map((step: ClosureStep & { execution?: Record<string, unknown> }) =>
          step.id === 'perf'
            ? {
                ...step,
                execution: { ...step.execution, finalWaiverValidation: 'invalid' },
              }
            : step,
        ),
      },
    ];
    for (const invalid of rejected) {
      writeManifest(evidenceRoot, invalid);
      await expect(
        maybeWriteLatestCleanAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: invalid,
        }),
      ).resolves.toEqual({ updated: false });
      expect(existsSync(acceptedIndexPath)).toBe(false);
    }
  });

  it('only atomically advances a physical, clean, exact waiver manifest and never writes latest-clean-pass', async () => {
    const { root, evidenceRoot, acceptedIndexPath, passIndexPath, manifest } = setup();
    writeManifest(evidenceRoot, manifest);
    await expect(
      maybeWriteLatestCleanAcceptedWithWaiver({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest,
      }),
    ).resolves.toEqual({
      updated: true,
      indexPath: '.artifacts/verification/FE-01/latest-clean-accepted-with-waiver.json',
    });
    expect(JSON.parse(readFileSync(acceptedIndexPath, 'utf8'))).toMatchObject({
      ticket: 'FE-01',
      status: 'accepted-with-waiver',
      runId: manifest.runId,
      manualDisposition: { status: 'accepted-with-waiver', waiverValidation: 'valid' },
    });
    expect(existsSync(passIndexPath)).toBe(false);
  });

  it('拒绝 symlink manifest 或 accepted index，只接受 lstat 为 regular file 的物理 JSON', async () => {
    const { root, evidenceRoot, acceptedIndexPath, manifest } = setup();
    const physicalManifest = join(root, 'physical-manifest.json');
    writeFileSync(physicalManifest, `${JSON.stringify(manifest)}\n`, 'utf8');
    mkdirSync(evidenceRoot, { recursive: true });
    symlinkSync(physicalManifest, join(evidenceRoot, 'manifest.json'));
    await expect(
      maybeWriteLatestCleanAcceptedWithWaiver({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(acceptedIndexPath)).toBe(false);

    rmSync(join(evidenceRoot, 'manifest.json'));
    writeManifest(evidenceRoot, manifest);
    const physicalIndex = join(root, 'physical-accepted-index.json');
    writeFileSync(
      physicalIndex,
      `${JSON.stringify({ completedAt: '2026-08-11T00:00:00.000Z' })}\n`,
    );
    symlinkSync(physicalIndex, acceptedIndexPath);
    await expect(
      maybeWriteLatestCleanAcceptedWithWaiver({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).resolves.toEqual({ updated: false });
    expect(JSON.parse(readFileSync(physicalIndex, 'utf8'))).toEqual({
      completedAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('拒绝 symlink evidence run 或其任一已有父目录，即使 manifest 本身是 regular file', async () => {
    const { root, evidenceRoot, acceptedIndexPath, manifest } = setup();
    const verificationRoot = join(root, '.artifacts/verification');
    const physicalRun = join(root, 'physical-run');
    writeManifest(physicalRun, manifest);
    mkdirSync(join(verificationRoot, 'FE-01'), { recursive: true });
    symlinkSync(physicalRun, evidenceRoot);
    await expect(
      maybeWriteLatestCleanAcceptedWithWaiver({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(acceptedIndexPath)).toBe(false);

    rmSync(evidenceRoot);
    const physicalTicket = join(root, 'physical-ticket');
    writeManifest(join(physicalTicket, manifest.runId), manifest);
    rmSync(join(verificationRoot, 'FE-01'), { recursive: true });
    symlinkSync(physicalTicket, join(verificationRoot, 'FE-01'));
    await expect(
      maybeWriteLatestCleanAcceptedWithWaiver({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(acceptedIndexPath)).toBe(false);
  });

  it('rejects dirty, contaminated, mismatched, non-waiver and invalid manual disposition without covering an existing index', async () => {
    const { root, evidenceRoot, acceptedIndexPath, manifest } = setup();
    writeManifest(evidenceRoot, manifest);
    await maybeWriteLatestCleanAcceptedWithWaiver({
      root,
      evidenceRoot,
      ticketId: 'FE-01',
      manifest,
    });
    const saved = JSON.parse(readFileSync(acceptedIndexPath, 'utf8'));
    for (const rejected of [
      { ...manifest, status: 'pass' },
      { ...manifest, worktreeDirty: true },
      { ...manifest, contamination: { hits: ['synthetic'] } },
      { ...manifest, runId: 'other-run' },
      {
        ...manifest,
        manualDisposition: { ...manifest.manualDisposition, waiverValidation: 'invalid' },
      },
      { ...manifest, pfAutomaticResult: { ...manifest.pfAutomaticResult, exitCode: 0 } },
      {
        ...manifest,
        pfAutomaticResult: { ...manifest.pfAutomaticResult, artifactSha256: {} },
      },
      {
        ...manifest,
        pfAutomaticResult: {
          ...manifest.pfAutomaticResult,
          artifactSha256: {
            ...manifest.pfAutomaticResult.artifactSha256,
            'samples.json': 'a'.repeat(64),
          },
        },
      },
      {
        ...manifest,
        manualDisposition: { ...manifest.manualDisposition, waiverSha256: 'a'.repeat(64) },
      },
    ]) {
      expect(
        await maybeWriteLatestCleanAcceptedWithWaiver({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: rejected,
        }),
      ).toEqual({ updated: false });
      expect(JSON.parse(readFileSync(acceptedIndexPath, 'utf8'))).toEqual(saved);
    }
  });

  it('does not let an older eligible completion cover a newer waiver index even when both wait for the lock', async () => {
    const { root, evidenceRoot, acceptedIndexPath, manifest } = setup();
    const newer = {
      ...manifest,
      runId: '20260811T030001000Z-p2-000',
      completedAt: '2026-08-11T03:00:01.000Z',
    };
    const newerRoot = join(root, '.artifacts/verification/FE-01', newer.runId);
    writeManifest(evidenceRoot, manifest);
    writeManifest(newerRoot, newer);
    mkdirSync(join(root, '.artifacts/verification/FE-01'), { recursive: true });
    const lockPath = `${acceptedIndexPath}.lock`;
    writeFileSync(lockPath, 'temporary lock');
    setTimeout(() => rmSync(lockPath, { force: true }), 5);
    await Promise.all([
      maybeWriteLatestCleanAcceptedWithWaiver({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
      maybeWriteLatestCleanAcceptedWithWaiver({
        root,
        evidenceRoot: newerRoot,
        ticketId: 'FE-01',
        manifest: newer,
      }),
    ]);
    expect(JSON.parse(readFileSync(acceptedIndexPath, 'utf8'))).toMatchObject({
      runId: newer.runId,
      completedAt: newer.completedAt,
    });
  });
});
