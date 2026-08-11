import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error runtime verifier module is plain Node ESM.
import { maybeWriteLatestCleanPass } from '../../scripts/orchestrator/latest-clean-pass.mjs';
// @ts-expect-error runtime verifier module is plain Node ESM.
import { makeRunId } from '../../scripts/orchestrator/lib.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { computePf01L3HarnessBuildInputsDigest, PF01_BUILD_ENVIRONMENT, PF01_L3_BUILD_INPUT_PATHS, PF01_L3_BUILD_INPUTS } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { computePf01MeasurementInputsDigest, expectedPf01L2ViteDevModuleGraph, PF01_MEASUREMENT_INPUT_PATHS, PF01_MEASUREMENT_INPUTS } from '../../scripts/orchestrator/pf01-measurement-inputs.mjs';
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { PF01_BUDGET_CONSTANTS } from '../../scripts/orchestrator/pf01-budget.mjs';

const roots: string[] = [];

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'acm-latest-clean-pass-'));
  roots.push(root);
  const evidenceRoot = join(root, '.artifacts/verification/FE-01/20260810T000000Z');
  const indexPath = join(root, '.artifacts/verification/FE-01/latest-clean-pass.json');
  const manifest = {
    runId: '20260810T000000Z',
    scope: 'FE-01',
    evidenceScope: 'ticket-closure',
    status: 'pass',
    commit: 'a'.repeat(40),
    worktreeDirty: false,
    completedAt: '2026-08-10T00:00:00.000Z',
    steps: [{ id: 'ui', layer: 'L2', provenance: 'L2 mock renderer journey' }],
  };
  return { root, evidenceRoot, indexPath, manifest };
}

function writeManifest(evidenceRoot: string, manifest: object): void {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(
    join(evidenceRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

function automaticInput(
  commit: string,
  kind: 'clean-tracked-checkout' | 'git-object-tree',
  { buildEnvironment = false } = {},
) {
  const buildEntries = PF01_L3_BUILD_INPUT_PATHS.map((path: string, index: number) => ({
    path,
    sha256: (index + 1).toString(16).padStart(64, '0'),
  }));
  const l2DevModuleGraph = expectedPf01L2ViteDevModuleGraph();
  const measurementEntries = PF01_MEASUREMENT_INPUT_PATHS.map((path: string, index: number) => ({
    path,
    sha256: (index + 101).toString(16).padStart(64, '0'),
  }));
  return {
    artifact: {
      identityPath: '.artifacts/test-harness/identity.json',
      kind: 'test-harness',
      identifier: 'io.github.shuanzi.agent-config-manager.test-harness',
      profile: 'debug',
      binary: 'src-tauri/target/debug/agent-config-manager',
      declaredBinarySha256: 'e'.repeat(64),
      actualBinarySha256: 'e'.repeat(64),
      provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
    },
    fixture: { path: 'fixtures/fx-01/native-root', sha256: 'f'.repeat(64) },
    buildInputs: {
      schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
      algorithm: PF01_L3_BUILD_INPUTS.algorithm,
      digest: computePf01L3HarnessBuildInputsDigest({
        schemaVersion: PF01_L3_BUILD_INPUTS.schemaVersion,
        algorithm: PF01_L3_BUILD_INPUTS.algorithm,
        entries: buildEntries,
      }),
      entries: buildEntries,
      source: { kind, method: PF01_L3_BUILD_INPUTS.method, commit },
    },
    measurementInputs: {
      schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
      algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
      digest: computePf01MeasurementInputsDigest({
        schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
        algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
        entries: measurementEntries,
        l2DevModuleGraph,
      }),
      entries: measurementEntries,
      source: { kind, method: PF01_MEASUREMENT_INPUTS.method, commit },
      l2DevModuleGraph,
    },
    runner: {
      node: 'v24.18.0',
      npm: '11.16.0',
      platform: 'darwin',
      release: '25.6.0',
      macosProductVersion: '26.6.1',
      arch: 'arm64',
    },
    toolchain: { cargo: 'cargo 1.97.1', rustc: 'rustc 1.97.1' },
    ...(buildEnvironment ? { buildEnvironment: { ...PF01_BUILD_ENVIRONMENT } } : {}),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('latest clean-pass evidence index', () => {
  it('FE-01 perf step 明示 no-sampling 时不能在缺少或漂移 automatic markers/provenance 下回退为普通 pass', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    for (const execution of [
      { samplingRun: false },
      { mode: 'unknown-automatic-mode', samplingRun: false },
    ]) {
      const noSampling = {
        ...manifest,
        steps: [
          {
            id: 'perf',
            layer: 'PF',
            provenance: 'immutable automatic-pass comparison validation',
            execution,
          },
        ],
      };
      writeManifest(evidenceRoot, noSampling);
      await expect(
        maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest: noSampling }),
      ).resolves.toEqual({ updated: false });
    }
    expect(existsSync(indexPath)).toBe(false);
  });

  it('FE-01 no-sampling automatic pass 缺少 comparison provenance 时绝不更新 index', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    const automatic = {
      ...manifest,
      automaticPassValidation: {
        initial: 'valid',
        final: 'valid',
        bindingStable: true,
        recordPath: 'performance/automatic-passes/fe-01-pf-01.json',
        recordSha256: 'a'.repeat(64),
      },
      pfAutomaticResult: {
        status: 'pass',
        exitCode: 0,
        automatedExitCode: 0,
        runId: '20260811T130000000Z-p1-000',
        run: '.artifacts/performance/PF-01/20260811T130000000Z-p1-000',
        commit: 'b'.repeat(40),
        worktreeDirty: false,
      },
      budgetValidation: { valid: true, violations: [] },
      pfDescriptorDigest: 'c'.repeat(64),
    };
    writeManifest(evidenceRoot, automatic);
    await expect(
      maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest: automatic }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(indexPath)).toBe(false);
    const strippedValidation = { ...automatic } as Record<string, unknown>;
    Reflect.deleteProperty(strippedValidation, 'automaticPassValidation');
    writeManifest(evidenceRoot, strippedValidation);
    await expect(
      maybeWriteLatestCleanPass({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: strippedValidation,
      }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(indexPath)).toBe(false);

    const complete = {
      ...automatic,
      steps: [
        ...manifest.steps,
        {
          id: 'perf',
          layer: 'PF',
          provenance: 'immutable automatic-pass comparison validation',
          execution: {
            mode: 'historical-automatic-pass-validation',
            samplingRun: false,
          },
        },
      ],
      pf01Provenance: {
        kind: 'fe-01-pf-01-automatic-pass',
        mode: 'historical-automatic-pass-validation',
        record: {
          path: 'performance/automatic-passes/fe-01-pf-01.json',
          sha256: 'a'.repeat(64),
        },
        comparison: {
          runId: '20260811T130000000Z-p1-000',
          run: '.artifacts/performance/PF-01/20260811T130000000Z-p1-000',
          commit: 'b'.repeat(40),
          worktreeDirty: false,
          status: 'pass',
          exitCode: 0,
        },
        budget: { path: 'performance/budgets/pf-01.budgets.json', sha256: 'd'.repeat(64) },
        descriptor: {
          path: 'performance/descriptors/pf-01.catalog-browse.json',
          digest: 'c'.repeat(64),
        },
        baseline: {
          run: '.artifacts/performance/PF-01/20260811T120000000Z-p1-000',
          commit: 'd'.repeat(40),
          worktreeDirty: false,
          collectedAt: '2026-08-11T12:00:00.000Z',
          statusBeforeBudgetFreeze: 'baseline-collected / budget-not-frozen',
          ...automaticInput('d'.repeat(40), 'git-object-tree'),
          resources: {
            metric: 'pf01.l3.peak_rss_bytes',
            layer: PF01_BUDGET_CONSTANTS.L3_LAYER,
            sampling: PF01_BUDGET_CONSTANTS.RESOURCE_SAMPLING,
            rawPeaksBytes: [100, 120, 110],
            maxBytes: 120,
          },
        },
        current: automaticInput('b'.repeat(40), 'clean-tracked-checkout', {
          buildEnvironment: true,
        }),
      },
    };
    const missingDescriptor = {
      ...complete,
      pf01Provenance: { ...complete.pf01Provenance },
    };
    Reflect.deleteProperty(missingDescriptor.pf01Provenance, 'descriptor');
    writeManifest(evidenceRoot, missingDescriptor);
    await expect(
      maybeWriteLatestCleanPass({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: missingDescriptor,
      }),
    ).resolves.toEqual({ updated: false });

    const mismatchedDescriptor = {
      ...complete,
      pf01Provenance: {
        ...complete.pf01Provenance,
        descriptor: {
          ...complete.pf01Provenance.descriptor,
          digest: 'f'.repeat(64),
        },
      },
    };
    writeManifest(evidenceRoot, mismatchedDescriptor);
    await expect(
      maybeWriteLatestCleanPass({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: mismatchedDescriptor,
      }),
    ).resolves.toEqual({ updated: false });

    for (const field of ['baseline', 'current'] as const) {
      const truncated = {
        ...complete,
        pf01Provenance: {
          ...complete.pf01Provenance,
          [field]: { ...complete.pf01Provenance[field] },
        },
      };
      Reflect.deleteProperty(truncated.pf01Provenance[field], 'measurementInputs');
      writeManifest(evidenceRoot, truncated);
      await expect(
        maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest: truncated }),
      ).resolves.toEqual({ updated: false });
    }

    const invalidProvenance = [
      (provenance: typeof complete.pf01Provenance) => (provenance.current.buildInputs.entries = []),
      (provenance: typeof complete.pf01Provenance) =>
        (provenance.current.buildInputs.schemaVersion = 99),
      (provenance: typeof complete.pf01Provenance) =>
        Reflect.deleteProperty(provenance.current.measurementInputs, 'l2DevModuleGraph'),
      (provenance: typeof complete.pf01Provenance) =>
        Reflect.deleteProperty(provenance.current.buildInputs, 'source'),
      (provenance: typeof complete.pf01Provenance) =>
        Reflect.deleteProperty(provenance.baseline, 'resources'),
    ];
    for (const mutate of invalidProvenance) {
      const invalid = JSON.parse(JSON.stringify(complete)) as typeof complete;
      mutate(invalid.pf01Provenance);
      writeManifest(evidenceRoot, invalid);
      await expect(
        maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest: invalid }),
      ).resolves.toEqual({ updated: false });
    }

    writeManifest(evidenceRoot, complete);
    await expect(
      maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest: complete }),
    ).resolves.toMatchObject({ updated: true });
  });

  it('only atomically advances a clean, matching pass and preserves prior index on every ineligible outcome', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    writeManifest(evidenceRoot, manifest);
    expect(
      await maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).toEqual({
      updated: true,
      indexPath: '.artifacts/verification/FE-01/latest-clean-pass.json',
    });
    const clean = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(clean).toMatchObject({
      ticket: 'FE-01',
      scope: 'FE-01',
      runId: manifest.runId,
      commit: manifest.commit,
      manifestPath: '.artifacts/verification/FE-01/20260810T000000Z/manifest.json',
      provenance: { evidenceScope: 'ticket-closure' },
    });

    for (const rejected of [
      { ...manifest, status: 'fail' },
      { ...manifest, status: 'inconclusive' },
      { ...manifest, worktreeDirty: true },
      { ...manifest, contamination: { hits: ['synthetic'] } },
      { ...manifest, runId: 'other-run' },
    ]) {
      expect(
        await maybeWriteLatestCleanPass({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: rejected,
        }),
      ).toEqual({
        updated: false,
      });
      expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toEqual(clean);
    }
    expect(existsSync(indexPath)).toBe(true);
  });

  it('never creates an index for an ineligible or non-physical manifest', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    for (const rejected of [
      { ...manifest, status: 'fail' },
      { ...manifest, status: 'inconclusive' },
      { ...manifest, worktreeDirty: true },
      { ...manifest, contamination: { hits: ['synthetic'] } },
      { ...manifest, runId: 'other-run' },
    ]) {
      writeManifest(evidenceRoot, rejected);
      expect(
        await maybeWriteLatestCleanPass({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: rejected,
        }),
      ).toEqual({
        updated: false,
      });
      expect(existsSync(indexPath)).toBe(false);
    }

    writeManifest(evidenceRoot, manifest);
    expect(
      await maybeWriteLatestCleanPass({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: { ...manifest, commit: 'b'.repeat(40) },
      }),
    ).toEqual({ updated: false });
    expect(existsSync(indexPath)).toBe(false);
  });

  it('拒绝 symlink manifest 或 index，只接受 lstat 为 regular file 的物理 JSON', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    const physicalManifest = join(root, 'physical-manifest.json');
    writeFileSync(physicalManifest, `${JSON.stringify(manifest)}\n`, 'utf8');
    mkdirSync(evidenceRoot, { recursive: true });
    symlinkSync(physicalManifest, join(evidenceRoot, 'manifest.json'));
    await expect(
      maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(indexPath)).toBe(false);

    rmSync(join(evidenceRoot, 'manifest.json'));
    writeManifest(evidenceRoot, manifest);
    const physicalIndex = join(root, 'physical-index.json');
    writeFileSync(
      physicalIndex,
      `${JSON.stringify({ completedAt: '2026-08-11T00:00:00.000Z' })}\n`,
    );
    symlinkSync(physicalIndex, indexPath);
    await expect(
      maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).resolves.toEqual({ updated: false });
    expect(JSON.parse(readFileSync(physicalIndex, 'utf8'))).toEqual({
      completedAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('拒绝 symlink evidence run 或其任一已有父目录，即使 manifest 本身是 regular file', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    const verificationRoot = join(root, '.artifacts/verification');
    const physicalRun = join(root, 'physical-run');
    writeManifest(physicalRun, manifest);
    mkdirSync(join(verificationRoot, 'FE-01'), { recursive: true });
    symlinkSync(physicalRun, evidenceRoot);
    await expect(
      maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(indexPath)).toBe(false);

    rmSync(evidenceRoot);
    const physicalTicket = join(root, 'physical-ticket');
    writeManifest(join(physicalTicket, manifest.runId), manifest);
    rmSync(join(verificationRoot, 'FE-01'), { recursive: true });
    symlinkSync(physicalTicket, join(verificationRoot, 'FE-01'));
    await expect(
      maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(indexPath)).toBe(false);
  });

  it('不会由较早完成的 eligible run 覆盖较新的 clean pass，并以完成事实打破同秒顺序', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    const newer = {
      ...manifest,
      runId: '20260810T000001000Z-000',
      completedAt: '2026-08-10T00:00:01.000Z',
    };
    const newerRoot = join(root, '.artifacts/verification/FE-01', newer.runId);
    writeManifest(newerRoot, newer);
    expect(
      await maybeWriteLatestCleanPass({
        root,
        evidenceRoot: newerRoot,
        ticketId: 'FE-01',
        manifest: newer,
      }),
    ).toMatchObject({ updated: true });
    const saved = JSON.parse(readFileSync(indexPath, 'utf8'));

    writeManifest(evidenceRoot, manifest);
    expect(
      await maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).toEqual({
      updated: false,
    });
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toEqual(saved);
  });

  it('生成毫秒与序号绑定的 runId，避免同秒 evidence directory 碰撞', () => {
    const instant = new Date('2026-08-10T00:00:00.000Z');
    const first = makeRunId(instant);
    const second = makeRunId(instant);
    expect(first).not.toEqual(second);
    expect(first).toMatch(/^\d{8}T\d{9}Z-p\d+-\d{3}$/);
  });

  it('不同 process 在同一毫秒生成的 runId 仍唯一', () => {
    const source = `import { makeRunId } from './scripts/orchestrator/lib.mjs'; console.log(makeRunId(new Date('2026-08-10T00:00:00.000Z')));`;
    const one = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const two = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(one.status).toBe(0);
    expect(two.status).toBe(0);
    expect(one.stdout.trim()).not.toEqual(two.stdout.trim());
    expect(one.stdout.trim()).toMatch(/^20260810T000000000Z-p\d+-000$/);
  });

  it('锁被旧 run 短暂持有时等待并重读，使较新完成的 run 最终获胜', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    const older = { ...manifest, completedAt: '2026-08-10T00:00:00.000Z' };
    const newer = {
      ...manifest,
      runId: '20260810T000001000Z-p123-000',
      completedAt: '2026-08-10T00:00:01.000Z',
    };
    const newerRoot = join(root, '.artifacts/verification/FE-01', newer.runId);
    writeManifest(evidenceRoot, older);
    writeManifest(newerRoot, newer);
    mkdirSync(join(root, '.artifacts/verification/FE-01'), { recursive: true });
    const lockPath = join(root, '.artifacts/verification/FE-01/latest-clean-pass.json.lock');
    writeFileSync(lockPath, 'old run owns lock');
    setTimeout(() => rmSync(lockPath, { force: true }), 5);

    const [olderResult, newerResult] = await Promise.all([
      maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest: older }),
      maybeWriteLatestCleanPass({
        root,
        evidenceRoot: newerRoot,
        ticketId: 'FE-01',
        manifest: newer,
      }),
    ]);
    expect(olderResult.updated || newerResult.updated).toBe(true);
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toMatchObject({
      runId: newer.runId,
      completedAt: newer.completedAt,
    });
  });
});
