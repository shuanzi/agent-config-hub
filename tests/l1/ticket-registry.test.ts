import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime registry module is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';

describe('FE-01 ticket registry', () => {
  it('将完整 L1 frontend 检查的 hard timeout 设为 20 分钟', () => {
    const frontend = TICKET_REGISTRY['FE-01'].steps.find(
      (step: { id: string }) => step.id === 'frontend',
    );

    expect(frontend).toMatchObject({
      cmd: 'corepack',
      args: ['npm', 'run', 'test:frontend'],
      timeoutMs: 1_200_000,
    });
  });

  it('将 10 分钟保留为 frontend 测试基础设施债务的 soft runtime budget，而非 hard timeout', () => {
    const frontend = TICKET_REGISTRY['FE-01'].steps.find(
      (step: { id: string }) => step.id === 'frontend',
    );

    expect(frontend).toMatchObject({
      softRuntimeBudget: {
        thresholdMs: 600_000,
        classification: 'test-infrastructure-debt',
      },
    });
  });

  it('在 FE-01 issue 中保留可从 stable index backing manifest 重建的 frontend runtime debt policy', () => {
    const frontend = TICKET_REGISTRY['FE-01'].steps.find(
      (step: { id: string }) => step.id === 'frontend',
    );
    const thresholdMs = frontend?.softRuntimeBudget?.thresholdMs;
    const issue = readFileSync(
      '.scratch/agent-config-manager-frontend/issues/01-read-only-workbench.md',
      'utf8',
    );

    expect(thresholdMs).toBe(600_000);
    expect(issue).toContain(
      [
        '## FE-01 frontend test runtime debt（non-status record）',
        '',
        `仅当 stable index \`.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json\` 解析的 backing manifest 的 \`steps\` 数组中唯一 \`id=frontend\` 的 step 同时满足 \`status=pass\`、\`exitCode=0\`、\`timedOut=false\`，且 \`durationMs > ${thresholdMs}\`（按该 manifest \`commit\` 对应 registry 的 \`steps\` 数组中唯一 \`id=frontend\` step 的 \`softRuntimeBudget.thresholdMs\`）时，才记录 \`deferred / post-optimization\` 的 \`test-infrastructure-debt\`。`,
        '',
        '该记录为 \`non-blocking\`，不改变 PF-01 automatic \`fail\`/exit \`1\`、FE-01 closure 或 \`RELEASE-GATE\`。',
      ].join('\n'),
    );
  });

  it('将未冻结预算准确表述为首次完整 clean baseline 只收集样本但本次仍 inconclusive', () => {
    expect(TICKET_REGISTRY['FE-01'].performance.unfrozenLabel).toBe(
      'budget-not-frozen（首次完整 clean representative baseline 只收集样本；该次仍为 inconclusive）',
    );
  });

  it('旧 waiver 仅保留为历史审计；本次 subject waiver 与未来 automatic-pass 都使用独立路径', () => {
    expect(TICKET_REGISTRY['FE-01'].performance.historicalWaiverPath).toBe(
      'performance/waivers/fe-01-pf-01-l3-cold-start.json',
    );
    expect(TICKET_REGISTRY['FE-01'].performance.historicalActiveWaiverPath).toBe(
      'performance/waivers/fe-01-pf-01-search-results-active.json',
    );
    expect(TICKET_REGISTRY['FE-01'].performance.activeWaiverPath).toBeUndefined();
    expect(TICKET_REGISTRY['FE-01'].performance.subjectWaiverPath).toBe(
      'performance/waivers/fe-01-pf-01-subject-startup-p50.json',
    );
    expect(TICKET_REGISTRY['FE-01'].performance.automaticPassPath).toBe(
      'performance/automatic-passes/fe-01-pf-01.json',
    );
    expect(
      TICKET_REGISTRY['FE-01'].steps.find((step: { id: string }) => step.id === 'perf'),
    ).toMatchObject({
      cmd: 'node',
      args: ['scripts/orchestrator/perf.mjs', 'PF-01'],
    });
    expect(TICKET_REGISTRY['FE-07R'].performance).toBeUndefined();
  });
});
