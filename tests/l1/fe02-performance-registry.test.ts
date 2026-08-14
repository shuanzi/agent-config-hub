import { describe, expect, it } from 'vitest';

// @ts-expect-error runtime registry module is a plain Node ESM module.
import { TICKET_REGISTRY } from '../../scripts/orchestrator/ticket-registry.mjs';
// @ts-expect-error runtime execution seam is a plain Node ESM module.
import { planTicketExecutionSteps } from '../../scripts/orchestrator/verify-ticket-execution.mjs';

const PF_PROVENANCE = 'PF synthetic performance descriptor；独立于 ticket actual-read provenance';

const expected = [
  {
    id: 'perf-pf02-representative',
    descriptorId: 'PF-02',
    profile: 'representative',
    descriptorPath: 'performance/descriptors/pf-02.source-large.json',
    budgetPath: 'performance/budgets/pf-02.representative.budgets.json',
    evidenceRelativeDir: 'performance/PF-02/representative',
  },
  {
    id: 'perf-pf02-stress',
    descriptorId: 'PF-02',
    profile: 'stress',
    descriptorPath: 'performance/descriptors/pf-02.source-large.json',
    budgetPath: 'performance/budgets/pf-02.stress.budgets.json',
    evidenceRelativeDir: 'performance/PF-02/stress',
  },
  {
    id: 'perf-pf03-representative',
    descriptorId: 'PF-03',
    profile: 'representative',
    descriptorPath: 'performance/descriptors/pf-03.multifile-workbench.json',
    budgetPath: 'performance/budgets/pf-03.representative.budgets.json',
    evidenceRelativeDir: 'performance/PF-03/representative',
  },
  {
    id: 'perf-pf03-stress',
    descriptorId: 'PF-03',
    profile: 'stress',
    descriptorPath: 'performance/descriptors/pf-03.multifile-workbench.json',
    budgetPath: 'performance/budgets/pf-03.stress.budgets.json',
    evidenceRelativeDir: 'performance/PF-03/stress',
  },
];

describe('FE-02 PF-02/PF-03 registry metadata', () => {
  it('把四个 profile 各自登记为独立 PF evidence step，且不伪造 actual-read credit', () => {
    const ticket = TICKET_REGISTRY['FE-02'];
    const steps = ticket.steps.filter((step: { layer: string }) => step.layer === 'PF');

    expect(steps).toHaveLength(4);
    expect(
      steps.map(
        (step: {
          id: string;
          layer: string;
          provenance: string;
          cmd: string;
          args: string[];
          evidenceOutput: unknown;
        }) => ({
          id: step.id,
          layer: step.layer,
          provenance: step.provenance,
          cmd: step.cmd,
          args: step.args,
          evidenceOutput: step.evidenceOutput,
        }),
      ),
    ).toEqual(
      expected.map(({ id, descriptorId, profile, evidenceRelativeDir }) => ({
        id,
        layer: 'PF',
        provenance: PF_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/perf.mjs', descriptorId, `--profile=${profile}`],
        evidenceOutput: { env: 'PERF_OUTPUT_DIR', relativeDir: evidenceRelativeDir },
      })),
    );
  });

  it('把所有 PF-02/PF-03 ticket-owned contract tests 固定在独立 L1 step，避免 closure 时漏跑', () => {
    const step = TICKET_REGISTRY['FE-02'].steps.find(
      (candidate: { id: string }) => candidate.id === 'perf-read-contract',
    );

    expect(step).toMatchObject({
      layer: 'L1',
      provenance:
        'L1 frontend/Vitest public seam tests；无 browser/WebView/IPC/磁盘 runtime credit',
      cmd: 'corepack',
      args: [
        'npm',
        'exec',
        '--',
        'vitest',
        'run',
        'tests/l1/pf02-pf03-descriptor.test.ts',
        'tests/l1/pf-read-fixtures.test.ts',
        'tests/l1/pf-read-evidence.test.ts',
        'tests/l1/fe02-performance-registry.test.ts',
        'tests/l1/verify-ticket-performance.test.ts',
        'tests/l1/pf-read-collector-contract.test.ts',
      ],
    });
  });

  it('将每个 descriptor/profile 的未冻结与冻结 provenance 显式分开', () => {
    const ticket = TICKET_REGISTRY['FE-02'];

    expect(ticket.performance).toBeUndefined();
    expect(ticket.performances).toHaveLength(4);
    expect(
      ticket.performances.map((performance: Record<string, string>) => ({
        descriptorId: performance.descriptorId,
        profile: performance.profile,
        descriptorPath: performance.descriptorPath,
        budgetPath: performance.budgetPath,
        evidenceRelativeDir: performance.evidenceRelativeDir,
      })),
    ).toEqual(
      expected.map(
        ({ descriptorId, profile, descriptorPath, budgetPath, evidenceRelativeDir }) => ({
          descriptorId,
          profile,
          descriptorPath,
          budgetPath,
          evidenceRelativeDir,
        }),
      ),
    );
    for (const performance of ticket.performances as Array<Record<string, string>>) {
      expect(performance.unfrozenLabel).toMatch(/baseline-collected/);
      expect(performance.unfrozenLabel).toMatch(/budget-not-frozen/);
      expect(performance.unfrozenLabel).toMatch(/inconclusive/);
      expect(performance.frozenLabel).toContain(performance.budgetPath);
    }
  });

  it('保持 FE-01 唯一 legacy performance/subject-waiver 自动执行模型不变', () => {
    const fe01 = TICKET_REGISTRY['FE-01'];

    expect(fe01.performances).toBeUndefined();
    expect(fe01.performance).toMatchObject({
      descriptorPath: 'performance/descriptors/pf-01.catalog-browse.json',
      budgetPath: 'performance/budgets/pf-01.budgets.json',
      profile: 'representative',
      subjectWaiverPath: 'performance/waivers/fe-01-pf-01-subject-startup-p50.json',
      automaticPassPath: 'performance/automatic-passes/fe-01-pf-01.json',
    });
    expect(fe01.steps.find((step: { id: string }) => step.id === 'perf')).toMatchObject({
      args: ['scripts/orchestrator/perf.mjs', 'PF-01'],
      evidenceOutput: { env: 'PERF_OUTPUT_DIR', relativeDir: 'performance' },
    });
  });

  it('multi-PF metadata 不取得 FE-01-only automatic-pass 或 waiver 的不采样特权', () => {
    const steps = planTicketExecutionSteps({
      ticketId: 'FE-02',
      ticket: {
        performances: expected,
        steps: expected.map(({ id, descriptorId, profile }) => ({
          id,
          layer: 'PF',
          cmd: 'node',
          args: ['scripts/orchestrator/perf.mjs', descriptorId, `--profile=${profile}`],
        })),
      },
      automaticPassValidation: { valid: true },
      subjectWaiverValidation: { valid: true },
    });

    expect(steps).toEqual(
      expected.map(({ id, descriptorId, profile }) => ({
        id,
        layer: 'PF',
        cmd: 'node',
        args: ['scripts/orchestrator/perf.mjs', descriptorId, `--profile=${profile}`],
      })),
    );
    expect(steps).not.toContainEqual(expect.objectContaining({ samplingRun: false }));
  });
});
