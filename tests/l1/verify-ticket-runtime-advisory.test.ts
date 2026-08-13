import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime registry module is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';

const executionModule =
  (await import('../../scripts/orchestrator/verify-ticket-execution.mjs')) as {
    deriveStepRuntimeAdvisory: (input: {
      step: {
        id: string;
        softRuntimeBudget?: { thresholdMs: number; classification: string };
      };
      result: { exitCode: number; timedOut: boolean; durationMs: number };
    }) => unknown;
  };

describe('verify:ticket step runtime advisory public seam', () => {
  const frontendStep = TICKET_REGISTRY['FE-01'].steps.find(
    (step: { id: string }) => step.id === 'frontend',
  );

  it('只对成功完成且超过 soft budget 的 frontend 测试返回非阻塞债务 warning', () => {
    const manifest = {
      steps: [
        {
          id: 'frontend',
          status: 'pass',
          exitCode: 0,
          timedOut: false,
          durationMs: 600_001,
        },
      ],
    };
    const frontendResult = manifest.steps.find((step) => step.id === 'frontend');

    expect(manifest.steps.filter((step) => step.id === 'frontend')).toHaveLength(1);
    expect(
      executionModule.deriveStepRuntimeAdvisory({
        step: frontendStep,
        result: frontendResult,
      }),
    ).toEqual({
      level: 'warning',
      blocking: false,
      classification: 'test-infrastructure-debt',
      thresholdMs: 600_000,
      durationMs: 600_001,
    });
  });

  it('恰好等于 soft budget 时不产生 warning', () => {
    expect(
      executionModule.deriveStepRuntimeAdvisory({
        step: frontendStep,
        result: { exitCode: 0, timedOut: false, durationMs: 600_000 },
      }),
    ).toBeUndefined();
  });

  it('失败或 hard timeout 时不产生 soft advisory，避免掩盖硬失败', () => {
    for (const result of [
      { exitCode: 1, timedOut: false, durationMs: 600_001 },
      { exitCode: 124, timedOut: true, durationMs: 1_200_000 },
    ]) {
      expect(
        executionModule.deriveStepRuntimeAdvisory({ step: frontendStep, result }),
      ).toBeUndefined();
    }
  });
});
