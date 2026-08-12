import { describe, expect, it, vi } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { AUTOMATIC_PASS_EXECUTION_MODE, automaticPassPf01BudgetState, executeTicketStep, finalizeAutomaticPassValidation, isAutomaticPassPerfStep, planTicketExecutionSteps } from '../../scripts/orchestrator/verify-ticket-execution.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { computePf01L3HarnessBuildInputsDigest, PF01_BUILD_ENVIRONMENT, PF01_L3_BUILD_INPUT_PATHS, PF01_L3_BUILD_INPUTS } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { computePf01MeasurementInputsDigest, expectedPf01L2ViteDevModuleGraph, PF01_MEASUREMENT_INPUT_PATHS, PF01_MEASUREMENT_INPUTS } from '../../scripts/orchestrator/pf01-measurement-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { PF01_BUDGET_CONSTANTS } from '../../scripts/orchestrator/pf01-budget.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { validateFe01Pf01SubjectWaiver } from '../../scripts/orchestrator/fe01-pf01-subject-waiver.mjs';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function automaticInput(
  commit: string,
  kind: 'clean-tracked-checkout' | 'git-object-tree',
  binarySha256 = 'd'.repeat(64),
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
      declaredBinarySha256: binarySha256,
      actualBinarySha256: binarySha256,
      provenance: 'L3 test harness',
    },
    fixture: { path: 'fixtures/fx-01/native-root', sha256: 'e'.repeat(64) },
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
  };
}

const automaticPassValidation = {
  valid: true,
  recordPath: 'performance/automatic-passes/fe-01-pf-01.json',
  recordSha256: '7'.repeat(64),
  comparison: {
    runId: '20260811T130000000Z-p1-000',
    run: '.artifacts/performance/PF-01/20260811T130000000Z-p1-000',
    commit: 'a'.repeat(40),
    worktreeDirty: false,
    status: 'pass',
    exitCode: 0,
  },
  automaticPassEvidence: {
    record: {
      path: 'performance/automatic-passes/fe-01-pf-01.json',
      sha256: '7'.repeat(64),
    },
    comparison: {
      runId: '20260811T130000000Z-p1-000',
      run: '.artifacts/performance/PF-01/20260811T130000000Z-p1-000',
      commit: 'a'.repeat(40),
      worktreeDirty: false,
      status: 'pass',
      exitCode: 0,
    },
    budget: { path: 'performance/budgets/pf-01.budgets.json', sha256: 'b'.repeat(64) },
    descriptor: {
      path: 'performance/descriptors/pf-01.catalog-browse.json',
      digest: 'c'.repeat(64),
    },
    baselineProvenance: {
      run: '.artifacts/performance/PF-01/20260811T120000000Z-p1-000',
      collectedAt: '2026-08-11T12:00:00.000Z',
      statusBeforeBudgetFreeze: 'baseline-collected / budget-not-frozen',
      commit: 'b'.repeat(40),
      worktreeDirty: false,
      ...automaticInput('b'.repeat(40), 'git-object-tree'),
      resources: {
        metric: 'pf01.l3.peak_rss_bytes',
        layer: PF01_BUDGET_CONSTANTS.L3_LAYER,
        sampling: PF01_BUDGET_CONSTANTS.RESOURCE_SAMPLING,
        rawPeaksBytes: [100, 120, 110],
        maxBytes: 120,
      },
    },
    currentProvenance: {
      ...automaticInput('a'.repeat(40), 'clean-tracked-checkout'),
      buildEnvironment: { ...PF01_BUILD_ENVIRONMENT },
    },
  },
};

const ticket = {
  performance: {
    automaticPassPath: 'performance/automatic-passes/fe-01-pf-01.json',
  },
  steps: [
    { id: 'ui', layer: 'L2', cmd: 'corepack', args: ['npm', 'run', 'test:ui'] },
    { id: 'perf', layer: 'PF', cmd: 'node', args: ['scripts/orchestrator/perf.mjs', 'PF-01'] },
  ],
};

describe('verify:ticket automatic-pass execution seam', () => {
  it('future exact automatic pass 与本次 subject waiver 并存时优先 automatic pass；无效 automatic 才可回退 waiver', () => {
    const both = {
      ...ticket,
      performance: {
        automaticPassPath: 'performance/automatic-passes/fe-01-pf-01.json',
        subjectWaiverPath: 'performance/waivers/fe-01-pf-01-subject-startup-p50.json',
      },
    };
    const subjectWaiverValidation = validateFe01Pf01SubjectWaiver();

    expect(
      planTicketExecutionSteps({
        ticketId: 'FE-01',
        ticket: both,
        automaticPassValidation,
        subjectWaiverValidation,
      }).find((step: { id: string }) => step.id === 'perf'),
    ).toMatchObject({ executionMode: AUTOMATIC_PASS_EXECUTION_MODE, samplingRun: false });

    expect(
      planTicketExecutionSteps({
        ticketId: 'FE-01',
        ticket: both,
        automaticPassValidation: { ...automaticPassValidation, valid: false },
        subjectWaiverValidation,
      }).find((step: { id: string }) => step.id === 'perf'),
    ).toMatchObject({ executionMode: 'historical-subject-waiver-validation', samplingRun: false });
  });

  it('仅 exact validated automatic-pass record 可把 perf 变为 no-sampling automatic pass', async () => {
    const perf = planTicketExecutionSteps({
      ticketId: 'FE-01',
      ticket,
      automaticPassValidation,
    }).find((step: { id: string }) => step.id === 'perf');
    expect(perf).toMatchObject({
      executionMode: AUTOMATIC_PASS_EXECUTION_MODE,
      samplingRun: false,
      historicalRunId: '20260811T130000000Z-p1-000',
      initialAutomaticPassValidation: 'valid',
    });
    expect(isAutomaticPassPerfStep(perf)).toBe(true);
    const runStepImpl = vi.fn(async () => {
      throw new Error('automatic-pass must not sample');
    });
    await expect(executeTicketStep({ step: perf, runStepImpl })).resolves.toMatchObject({
      exitCode: 0,
      historical: true,
    });
    expect(runStepImpl).not.toHaveBeenCalled();
  });

  it('仅 samplingRun=false 的 exact automatic mode 可跳过真实 perf step', async () => {
    for (const step of [
      { id: 'perf', executionMode: AUTOMATIC_PASS_EXECUTION_MODE, samplingRun: true },
      { id: 'perf', executionMode: AUTOMATIC_PASS_EXECUTION_MODE },
    ]) {
      const runStepImpl = vi.fn(async () => ({ exitCode: 17 }));
      expect(isAutomaticPassPerfStep(step)).toBe(false);
      await expect(executeTicketStep({ step, runStepImpl })).resolves.toEqual({ exitCode: 17 });
      expect(runStepImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('automatic evidence 允许每侧自洽的不同 binary SHA，但拒绝身份或可重算输入漂移', () => {
    const differentBinary = clone(automaticPassValidation);
    differentBinary.automaticPassEvidence.currentProvenance.artifact.declaredBinarySha256 =
      'f'.repeat(64);
    differentBinary.automaticPassEvidence.currentProvenance.artifact.actualBinarySha256 =
      'f'.repeat(64);
    expect(
      planTicketExecutionSteps({
        ticketId: 'FE-01',
        ticket,
        automaticPassValidation: differentBinary,
      }).find((step: { id: string }) => step.id === 'perf'),
    ).toMatchObject({ executionMode: AUTOMATIC_PASS_EXECUTION_MODE, samplingRun: false });

    const invalids = [
      (candidate: typeof automaticPassValidation) => {
        candidate.automaticPassEvidence.currentProvenance.artifact.identifier =
          'io.example.changed';
      },
      (candidate: typeof automaticPassValidation) => {
        candidate.automaticPassEvidence.currentProvenance.artifact.binary = 'target/other-harness';
      },
      (candidate: typeof automaticPassValidation) => {
        candidate.automaticPassEvidence.currentProvenance.buildInputs.digest = '0'.repeat(64);
      },
      (candidate: typeof automaticPassValidation) => {
        candidate.automaticPassEvidence.currentProvenance.buildInputs.entries[0].sha256 =
          '0'.repeat(64);
      },
      (candidate: typeof automaticPassValidation) => {
        candidate.automaticPassEvidence.currentProvenance.buildInputs.entries[0].path =
          'src/unapproved-input.ts';
      },
      (candidate: typeof automaticPassValidation) => {
        candidate.automaticPassEvidence.currentProvenance.measurementInputs.l2DevModuleGraph.actualModulePaths[0] =
          'src/unapproved-dev-module.ts';
      },
    ];
    for (const mutate of invalids) {
      const candidate = clone(automaticPassValidation);
      mutate(candidate);
      const perf = planTicketExecutionSteps({
        ticketId: 'FE-01',
        ticket,
        automaticPassValidation: candidate,
      }).find((step: { id: string }) => step.id === 'perf');
      expect(perf).not.toHaveProperty('executionMode');
    }
  });

  it('absent/incomplete/invalid automatic record 与旧 manual waiver 都只会保留真实 perf sampling', () => {
    const withoutEvidence = { ...automaticPassValidation } as Record<string, unknown>;
    Reflect.deleteProperty(withoutEvidence, 'automaticPassEvidence');
    for (const candidateValidation of [
      undefined,
      withoutEvidence,
      { ...automaticPassValidation, valid: false },
    ]) {
      const perf = planTicketExecutionSteps({
        ticketId: 'FE-01',
        ticket,
        automaticPassValidation: candidateValidation,
      }).find((step: { id: string }) => step.id === 'perf');
      expect(perf).toMatchObject({ cmd: 'node', args: ['scripts/orchestrator/perf.mjs', 'PF-01'] });
      expect(perf).not.toHaveProperty('executionMode');
    }
    const oldManualWaiverTicket = {
      ...ticket,
      performance: {
        historicalActiveWaiverPath: 'performance/waivers/fe-01-pf-01-search-results-active.json',
      },
    };
    const perf = planTicketExecutionSteps({
      ticketId: 'FE-01',
      ticket: oldManualWaiverTicket,
      automaticPassValidation,
    }).find((step: { id: string }) => step.id === 'perf');
    expect(perf).not.toHaveProperty('executionMode');
  });

  it('结束时 current HEAD binding、record SHA 或 comparison 任一漂移都不能维持 automatic pass', async () => {
    const finalInvalid = {
      ...automaticPassValidation,
      valid: false,
      recordSha256: '8'.repeat(64),
    };
    const validateAutomaticPass = vi.fn(async () => finalInvalid);
    await expect(
      finalizeAutomaticPassValidation({
        initialAutomaticPassValidation: automaticPassValidation,
        validateAutomaticPass,
      }),
    ).resolves.toEqual({
      finalAutomaticPassValidation: finalInvalid,
      finalAutomaticPassValidationStatus: 'invalid',
      bindingStable: false,
    });
    expect(validateAutomaticPass).toHaveBeenCalledTimes(1);
  });

  it('起止 evidence 的 runner/toolchain 同步漂移也不能维持 automatic pass', async () => {
    const finalWithDifferentRuntime = clone(automaticPassValidation);
    for (const provenance of [
      finalWithDifferentRuntime.automaticPassEvidence.baselineProvenance,
      finalWithDifferentRuntime.automaticPassEvidence.currentProvenance,
    ]) {
      provenance.runner.node = 'v99.0.0';
      provenance.toolchain.rustc = 'rustc 99.0.0';
    }
    await expect(
      finalizeAutomaticPassValidation({
        initialAutomaticPassValidation: automaticPassValidation,
        validateAutomaticPass: async () => finalWithDifferentRuntime,
      }),
    ).resolves.toMatchObject({
      finalAutomaticPassValidationStatus: 'invalid',
      bindingStable: false,
    });
  });

  it('only stable final validation can report a historical automatic budget pass', async () => {
    const stable = await finalizeAutomaticPassValidation({
      initialAutomaticPassValidation: automaticPassValidation,
      validateAutomaticPass: async () => automaticPassValidation,
    });
    expect(automaticPassPf01BudgetState({ automaticPassCompletion: stable })).toMatchObject({
      status: 'pass',
      validation: { valid: true, violations: [] },
      descriptorDigest: 'c'.repeat(64),
      provenance: {
        record: { path: 'performance/automatic-passes/fe-01-pf-01.json', sha256: '7'.repeat(64) },
        comparison: { runId: '20260811T130000000Z-p1-000' },
      },
    });
    expect(
      automaticPassPf01BudgetState({
        automaticPassCompletion: {
          finalAutomaticPassValidation: { valid: false, violations: ['current input drift'] },
          finalAutomaticPassValidationStatus: 'invalid',
          bindingStable: false,
        },
      }),
    ).toMatchObject({
      status: 'fail',
      validation: { valid: false, violations: expect.arrayContaining(['current input drift']) },
    });
  });

  it('no-sampling automatic pass 缺少 immutable comparison provenance 时拒绝报告预算 pass', async () => {
    const stableWithoutEvidence = await finalizeAutomaticPassValidation({
      initialAutomaticPassValidation: {
        ...automaticPassValidation,
        automaticPassEvidence: undefined,
      },
      validateAutomaticPass: async () => ({
        ...automaticPassValidation,
        automaticPassEvidence: undefined,
      }),
    });
    expect(
      automaticPassPf01BudgetState({ automaticPassCompletion: stableWithoutEvidence }),
    ).toMatchObject({
      status: 'fail',
      validation: {
        valid: false,
        violations: expect.arrayContaining([
          'automatic-pass immutable comparison manifest evidence incomplete',
        ]),
      },
    });
  });
});
