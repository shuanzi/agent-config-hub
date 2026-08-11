import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { assertCleanPf01Baseline, collectCurrentPf01Attestation, pf01ComparisonProvenance, validateFrozenPf01Budget } from '../../scripts/orchestrator/pf01-budget.mjs';
// prettier-ignore
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { computePf01L3HarnessBuildInputsDigest } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { computePf01MeasurementInputsDigest, expectedPf01L2ViteDevModuleGraph, PF01_MEASUREMENT_INPUT_PATHS, PF01_MEASUREMENT_INPUTS } from '../../scripts/orchestrator/pf01-measurement-inputs.mjs';

const descriptor = JSON.parse(
  readFileSync(resolve('performance/descriptors/pf-01.catalog-browse.json'), 'utf8'),
) as Record<string, unknown>;

function measurementInputs(kind: 'clean-tracked-checkout' | 'git-object-tree') {
  const entries = PF01_MEASUREMENT_INPUT_PATHS.map((path: string, index: number) => ({
    path,
    sha256: (index + 1).toString(16).padStart(64, '0'),
  }));
  const l2DevModuleGraph = expectedPf01L2ViteDevModuleGraph();
  return {
    schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
    algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
    digest: computePf01MeasurementInputsDigest({
      schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
      algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
      entries,
      l2DevModuleGraph,
    }),
    entries,
    l2DevModuleGraph,
    source: {
      kind,
      method: PF01_MEASUREMENT_INPUTS.method,
      commit: 'f783568e73d70411f3a7ce1e5b982b99135b5e57',
    },
  };
}

function validBudget(): Record<string, unknown> {
  const digest = (descriptor.digest as { value: string }).value;
  const entries = [{ path: 'src/main.tsx', sha256: 'c'.repeat(64) }];
  return {
    schemaVersion: 4,
    descriptorId: 'PF-01',
    descriptorDigest: digest,
    profile: 'representative',
    baselineProvenance: {
      run: '.artifacts/performance/PF-01/20260811T000000000Z-000',
      collectedAt: '2026-08-11T00:00:00.000Z',
      statusBeforeBudgetFreeze: 'baseline-collected / budget-not-frozen',
      commit: 'f783568e73d70411f3a7ce1e5b982b99135b5e57',
      worktreeDirty: false,
      artifact: {
        identityPath: '.artifacts/test-harness/identity.json',
        kind: 'test-harness',
        identifier: 'io.github.shuanzi.agent-config-manager.test-harness',
        profile: 'debug',
        binary: 'src-tauri/target/debug/agent-config-manager',
        declaredBinarySha256: 'a'.repeat(64),
        actualBinarySha256: 'a'.repeat(64),
        provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
      },
      runner: {
        node: 'v24.18.0',
        npm: '11.16.0',
        platform: 'darwin',
        release: '25.0.0',
        macosProductVersion: '26.0',
        arch: 'arm64',
      },
      toolchain: { cargo: 'cargo 1.90.0', rustc: 'rustc 1.90.0' },
      fixture: { path: 'fixtures/fx-01/native-root', sha256: 'b'.repeat(64) },
      buildInputs: {
        schemaVersion: 2,
        algorithm: 'pf01-l3-harness-build-inputs-v2',
        digest: computePf01L3HarnessBuildInputsDigest({
          schemaVersion: 2,
          algorithm: 'pf01-l3-harness-build-inputs-v2',
          entries,
        }),
        source: {
          kind: 'git-object-tree',
          method: 'raw bytes SHA-256 / byte-sorted repo-relative paths',
          commit: 'f783568e73d70411f3a7ce1e5b982b99135b5e57',
        },
        entries,
      },
      measurementInputs: measurementInputs('git-object-tree'),
      resources: {
        metric: 'pf01.l3.peak_rss_bytes',
        layer: 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）',
        sampling:
          'agent-config-manager harness PID + 后代；50ms process-tree RSS bytes；排除 WDIO/Vite；成功启动至正常退出',
        rawPeaksBytes: [100, 120, 110],
        maxBytes: 120,
      },
    },
    formula: {
      absoluteCeilingMs: 'ceil(p95 * 1.5 / 10) * 10',
      regressionAllowance: 'current p50 <= baseline p50 * 1.25',
    },
    budgets: [
      'pf01.startup.first_list_visible',
      'pf01.search.results_visible',
      'pf01.filter.results_visible',
      'pf01.select.skill_cells_visible',
      'pf01.l3.cold_start.first_snapshot',
    ].map((metric) => ({
      metric,
      layer: metric.includes('.l3.')
        ? 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）'
        : 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
      baseline: {
        p50: 10,
        p95: 12,
        n: metric === 'pf01.startup.first_list_visible' ? 5 : metric.includes('.l3.') ? 3 : 20,
      },
      absoluteCeilingMs: 20,
      regressionAllowance: { relativeTo: 'baseline-p50', maxRatio: 1.25 },
    })),
  };
}

function currentAttestation(budget = validBudget()): Record<string, unknown> {
  const provenance = budget.baselineProvenance as Record<string, Record<string, unknown>>;
  const artifact = provenance.artifact;
  return {
    artifact: { ...artifact },
    fixture: { ...provenance.fixture },
    runner: { ...provenance.runner },
    toolchain: { ...provenance.toolchain },
    measurementInputs: {
      ...JSON.parse(JSON.stringify(provenance.measurementInputs)),
      source: {
        kind: 'clean-tracked-checkout',
        method: PF01_MEASUREMENT_INPUTS.method,
        commit: 'f783568e73d70411f3a7ce1e5b982b99135b5e57',
      },
    },
    buildInputs: {
      ...JSON.parse(JSON.stringify(provenance.buildInputs)),
      source: {
        kind: 'clean-tracked-checkout',
        method: 'raw bytes SHA-256 / byte-sorted repo-relative paths',
        commit: 'f783568e73d70411f3a7ce1e5b982b99135b5e57',
      },
    },
  };
}

describe('PF-01 frozen budget validator', () => {
  it('只接受 descriptor/profile/metric 集合、阈值和 ADR-0013 provenance 完整的预算', () => {
    const budget = validBudget();
    expect(
      validateFrozenPf01Budget(budget, descriptor, 'representative', currentAttestation(budget)),
    ).toEqual({
      valid: true,
      violations: [],
    });
  });

  it('当前 binary/identity/fixture attestation 任一漂移时拒绝冻结或 clean evidence', () => {
    const declaredHashMismatch = validBudget();
    const declaredHashAttestation = currentAttestation(declaredHashMismatch);
    ((declaredHashAttestation.artifact as Record<string, unknown>).actualBinarySha256 as string) =
      'c'.repeat(64);

    const fixtureMismatch = validBudget();
    const fixtureAttestation = currentAttestation(fixtureMismatch);
    ((fixtureAttestation.fixture as Record<string, unknown>).sha256 as string) = 'c'.repeat(64);

    const identityMismatch = validBudget();
    const identityAttestation = currentAttestation(identityMismatch);
    ((identityAttestation.artifact as Record<string, unknown>).identifier as string) =
      'io.github.shuanzi.other.test-harness';

    const malformedCurrentIdentity = validBudget();
    const malformedIdentityAttestation = currentAttestation(malformedCurrentIdentity);
    ((malformedIdentityAttestation.artifact as Record<string, unknown>).binary as string) =
      'src-tauri/target/debug/not-agent-config-manager';

    for (const [budget, attestation] of [
      [declaredHashMismatch, declaredHashAttestation],
      [fixtureMismatch, fixtureAttestation],
      [identityMismatch, identityAttestation],
      [malformedCurrentIdentity, malformedIdentityAttestation],
    ]) {
      expect(
        validateFrozenPf01Budget(budget, descriptor, 'representative', attestation).valid,
      ).toBe(false);
    }
  });

  it('从当前 harness binary 与 FX-01 fixture 重算 attestation，而不信任 identity 声明 hash', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-attestation-'));
    try {
      const binary = join(root, 'src-tauri/target/debug/agent-config-manager');
      const fixture = join(root, 'fixtures/fx-01/native-root/fixture.txt');
      const identityPath = join(root, '.artifacts/test-harness/identity.json');
      mkdirSync(join(root, 'src-tauri/target/debug'), { recursive: true });
      mkdirSync(join(root, 'fixtures/fx-01/native-root'), { recursive: true });
      mkdirSync(join(root, '.artifacts/test-harness'), { recursive: true });
      writeFileSync(binary, 'actual-harness-binary');
      writeFileSync(fixture, 'fixture-file');
      writeFileSync(
        identityPath,
        JSON.stringify({
          kind: 'test-harness',
          identifier: 'io.github.shuanzi.agent-config-manager.test-harness',
          profile: 'debug',
          binary: 'src-tauri/target/debug/agent-config-manager',
          binarySha256: 'a'.repeat(64),
          provenance: 'L3 专用隔离测试构建；非生产签名/DMG，不取得 L4 credit',
        }),
      );

      const first = collectCurrentPf01Attestation({
        repoRoot: root,
        artifactsRoot: join(root, '.artifacts'),
      });
      writeFileSync(fixture, 'changed-fixture-file');
      const second = collectCurrentPf01Attestation({
        repoRoot: root,
        artifactsRoot: join(root, '.artifacts'),
      });

      expect(first.artifact.actualBinarySha256).toBe(
        'f31314114e659732305563618e25d577242a25dd7fe1b6395222f94b81400982',
      );
      expect(first.artifact.declaredBinarySha256).toBe('a'.repeat(64));
      expect(second.fixture.sha256).not.toBe(first.fixture.sha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('拒绝 descriptor/profile/metric/provenance 任一漂移，不能误判为 PASS', () => {
    const invalid = validBudget();
    invalid.profile = 'stress';
    (invalid.budgets as Array<Record<string, unknown>>)[0].absoluteCeilingMs = 19;
    delete (invalid.baselineProvenance as Record<string, unknown>).resources;
    const result = validateFrozenPf01Budget(
      invalid,
      descriptor,
      'representative',
      currentAttestation(invalid),
    );
    expect(result.valid).toBe(false);
    expect(result.violations.join('\n')).toMatch(/profile|absoluteCeilingMs|resources/);
  });

  it('dirty baseline、重复 metric 或错误的每项样本量绝不能冻结', () => {
    const dirty = validBudget();
    (dirty.baselineProvenance as Record<string, unknown>).worktreeDirty = true;
    const duplicate = validBudget();
    (duplicate.budgets as Array<Record<string, unknown>>).push(
      (duplicate.budgets as Array<Record<string, unknown>>)[0],
    );
    const wrongSampleCount = validBudget();
    (wrongSampleCount.budgets as Array<Record<string, unknown>>)[0].baseline = {
      p50: 10,
      p95: 12,
      n: 20,
    };

    for (const invalid of [dirty, duplicate, wrongSampleCount]) {
      expect(
        validateFrozenPf01Budget(invalid, descriptor, 'representative', currentAttestation(invalid))
          .valid,
      ).toBe(false);
    }
  });

  it('只允许每次各自声明/实际 binary 一致且 build-input/fixture 相同的跨构建比较', () => {
    const budget = validBudget();
    const comparable = currentAttestation(budget);
    const artifact = comparable.artifact as Record<string, unknown>;
    artifact.declaredBinarySha256 = 'd'.repeat(64);
    artifact.actualBinarySha256 = 'd'.repeat(64);

    expect(validateFrozenPf01Budget(budget, descriptor, 'representative', comparable)).toEqual({
      valid: true,
      violations: [],
    });

    const inputMismatch = currentAttestation(budget);
    ((inputMismatch.buildInputs as Record<string, unknown>).digest as string) = 'd'.repeat(64);
    const fixtureMismatch = currentAttestation(budget);
    ((fixtureMismatch.fixture as Record<string, unknown>).sha256 as string) = 'd'.repeat(64);

    for (const invalid of [inputMismatch, fixtureMismatch]) {
      expect(validateFrozenPf01Budget(budget, descriptor, 'representative', invalid).valid).toBe(
        false,
      );
    }
  });

  it('baseline/current 的 Node、OS、arch 与 Rust toolchain 任一精确漂移都拒绝比较', () => {
    const budget = validBudget();
    const bogusNode = currentAttestation(budget);
    (bogusNode.runner as Record<string, unknown>).node = 'v99.0.0';
    const alienOs = currentAttestation(budget);
    (alienOs.runner as Record<string, unknown>).platform = 'linux';
    const bogusRust = currentAttestation(budget);
    (bogusRust.toolchain as Record<string, unknown>).rustc = 'rustc 99.0.0';

    for (const invalid of [bogusNode, alienOs, bogusRust]) {
      expect(validateFrozenPf01Budget(budget, descriptor, 'representative', invalid).valid).toBe(
        false,
      );
    }
  });

  it('measurementInputs 必须独立完整且 baseline/current digest 精确一致，不能借 buildInputs 冒充', () => {
    const budget = validBudget();
    const missing = currentAttestation(budget);
    delete missing.measurementInputs;
    const drift = currentAttestation(budget);
    ((drift.measurementInputs as Record<string, unknown>).digest as string) = 'f'.repeat(64);
    const extra = currentAttestation(budget);
    (
      (extra.measurementInputs as Record<string, unknown>).entries as Array<Record<string, unknown>>
    ).push({
      path: 'source-digest-is-not-method-input.ts',
      sha256: 'f'.repeat(64),
    });

    for (const invalid of [missing, drift, extra]) {
      expect(validateFrozenPf01Budget(budget, descriptor, 'representative', invalid).valid).toBe(
        false,
      );
    }
  });

  it('build-input provenance 缺少版本化 entries 或篡改 method 时拒绝比较', () => {
    const missingEntries = currentAttestation();
    delete (missingEntries.buildInputs as Record<string, unknown>).entries;
    const wrongMethod = currentAttestation();
    (
      (wrongMethod.buildInputs as Record<string, unknown>).source as Record<string, unknown>
    ).method = 'unknown';

    for (const invalid of [missingEntries, wrongMethod]) {
      expect(
        validateFrozenPf01Budget(validBudget(), descriptor, 'representative', invalid).valid,
      ).toBe(false);
    }
  });

  it('entry path/SHA 或 canonical digest 被篡改时拒绝 baseline 与 current comparison', () => {
    const alteredBaselineEntry = validBudget();
    (
      (
        (alteredBaselineEntry.baselineProvenance as Record<string, unknown>).buildInputs as Record<
          string,
          unknown
        >
      ).entries as Array<Record<string, unknown>>
    )[0].sha256 = 'd'.repeat(64);

    const alteredCurrentPath = currentAttestation();
    (
      (alteredCurrentPath.buildInputs as Record<string, unknown>).entries as Array<
        Record<string, unknown>
      >
    )[0].path = 'src/not-main.tsx';

    const alteredCurrentDigest = currentAttestation();
    ((alteredCurrentDigest.buildInputs as Record<string, unknown>).digest as string) = 'd'.repeat(
      64,
    );

    for (const [budget, attestation] of [
      [alteredBaselineEntry, currentAttestation(alteredBaselineEntry)],
      [validBudget(), alteredCurrentPath],
      [validBudget(), alteredCurrentDigest],
    ]) {
      expect(
        validateFrozenPf01Budget(budget, descriptor, 'representative', attestation).valid,
      ).toBe(false);
    }
  });

  it('comparison provenance 始终同时保留 baseline/current binary、build-input 与 fixture', () => {
    const budget = validBudget();
    const current = currentAttestation(budget);
    expect(pf01ComparisonProvenance(budget, current)).toEqual({
      baseline: {
        run: (budget.baselineProvenance as Record<string, unknown>).run,
        collectedAt: (budget.baselineProvenance as Record<string, unknown>).collectedAt,
        commit: (budget.baselineProvenance as Record<string, unknown>).commit,
        worktreeDirty: (budget.baselineProvenance as Record<string, unknown>).worktreeDirty,
        artifact: (budget.baselineProvenance as Record<string, unknown>).artifact,
        buildInputs: (budget.baselineProvenance as Record<string, unknown>).buildInputs,
        measurementInputs: (budget.baselineProvenance as Record<string, unknown>).measurementInputs,
        fixture: (budget.baselineProvenance as Record<string, unknown>).fixture,
        runner: (budget.baselineProvenance as Record<string, unknown>).runner,
        toolchain: (budget.baselineProvenance as Record<string, unknown>).toolchain,
      },
      current: {
        artifact: current.artifact,
        buildInputs: current.buildInputs,
        measurementInputs: current.measurementInputs,
        fixture: current.fixture,
        runner: current.runner,
        toolchain: current.toolchain,
      },
    });
    expect(pf01ComparisonProvenance(null, current).baseline).toBeNull();
  });

  it('在采样/写预算前拒绝 dirty 或未知 worktree 状态', () => {
    expect(() => assertCleanPf01Baseline({ worktreeDirty: true })).toThrow('clean worktree');
    expect(() => assertCleanPf01Baseline({ worktreeDirty: null })).toThrow('clean worktree');
    expect(assertCleanPf01Baseline({ worktreeDirty: false })).toBeUndefined();
  });

  it('artifact identity、npm 与 macOS product version 缺失时拒绝 provenance', () => {
    const invalid = validBudget();
    delete (
      (invalid.baselineProvenance as Record<string, unknown>).artifact as Record<string, unknown>
    ).identifier;
    delete (
      (invalid.baselineProvenance as Record<string, unknown>).runner as Record<string, unknown>
    ).npm;
    delete (
      (invalid.baselineProvenance as Record<string, unknown>).runner as Record<string, unknown>
    ).macosProductVersion;
    expect(
      validateFrozenPf01Budget(invalid, descriptor, 'representative', currentAttestation(invalid)),
    ).toMatchObject({ valid: false });
  });
});
