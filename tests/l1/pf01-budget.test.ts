import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { formatPf01BudgetJson, freezePf01Budget, migratePf01BudgetV2 } from '../../scripts/orchestrator/pf01-budget.mjs';
// prettier-ignore
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { computePf01L3HarnessBuildInputsDigest } from '../../scripts/orchestrator/pf01-build-inputs.mjs';
// prettier-ignore
// @ts-expect-error runtime provenance module is a plain Node ESM module.
import { computePf01MeasurementInputsDigest, expectedPf01L2ViteDevModuleGraph, PF01_MEASUREMENT_INPUT_PATHS, PF01_MEASUREMENT_INPUTS } from '../../scripts/orchestrator/pf01-measurement-inputs.mjs';

const HISTORICAL_BUDGET_PATH = 'performance/budgets/history/pf-01.budgets.20260810T124356Z.json';

function baselineBuildInputs(): Record<string, unknown> {
  const entries = [{ path: 'src/main.tsx', sha256: 'c'.repeat(64) }];
  return {
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
      commit: '4fdff98be42065936bcfff462302f033de5d6b4a',
    },
    entries,
  };
}

function baselineMeasurementInputs(): Record<string, unknown> {
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
    source: {
      kind: 'git-object-tree',
      method: PF01_MEASUREMENT_INPUTS.method,
      commit: '4fdff98be42065936bcfff462302f033de5d6b4a',
    },
    entries,
    l2DevModuleGraph,
  };
}

describe('PF-01 frozen representative budget', () => {
  it('仅以完整实际统计生成预算，严格应用授权公式', () => {
    const descriptor = { descriptorId: 'PF-01', digest: { value: 'd'.repeat(64) } };
    const budget = freezePf01Budget({
      descriptor,
      profile: 'representative',
      metrics: Object.fromEntries(
        [
          'pf01.startup.first_list_visible',
          'pf01.search.results_visible',
          'pf01.filter.results_visible',
          'pf01.select.skill_cells_visible',
          'pf01.l3.cold_start.first_snapshot',
        ].map((metric) => [
          metric,
          {
            p50: 10,
            p95: 12,
            n: metric === 'pf01.startup.first_list_visible' ? 5 : metric.includes('.l3.') ? 3 : 20,
          },
        ]),
      ),
      baselineProvenance: { run: 'actual-run' },
    });
    expect(budget.descriptorId).toBe('PF-01');
    expect(budget.profile).toBe('representative');
    expect(budget.formula).toEqual({
      absoluteCeilingMs: 'ceil(p95 * 1.5 / 10) * 10',
      regressionAllowance: 'current p50 <= baseline p50 * 1.25',
    });
    expect(budget.budgets).toHaveLength(5);
    for (const entry of budget.budgets) {
      expect(entry.metric).toMatch(/^pf01\./);
      expect(entry.layer).toMatch(/^L[23] /);
      expect(entry.baseline.n).toBeGreaterThan(0);
      expect(entry.absoluteCeilingMs).toBe(Math.ceil((entry.baseline.p95 * 1.5) / 10) * 10);
      expect(entry.regressionAllowance).toEqual({ relativeTo: 'baseline-p50', maxRatio: 1.25 });
    }
  });

  it('样本不完整时拒绝生成预算', () => {
    expect(() =>
      freezePf01Budget({
        descriptor: { digest: { value: 'd'.repeat(64) } },
        profile: 'representative',
        metrics: {},
        baselineProvenance: {},
      }),
    ).toThrow('baseline metric incomplete');
  });

  it('生成器输出的版本化 budget 天然通过仓库 Prettier check', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-budget-prettier-'));
    try {
      const budgetPath = join(root, 'pf-01.budgets.json');
      writeFileSync(
        budgetPath,
        await formatPf01BudgetJson(
          freezePf01Budget({
            descriptor: { descriptorId: 'PF-01', digest: { value: 'd'.repeat(64) } },
            profile: 'representative',
            metrics: Object.fromEntries(
              [
                'pf01.startup.first_list_visible',
                'pf01.search.results_visible',
                'pf01.filter.results_visible',
                'pf01.select.skill_cells_visible',
                'pf01.l3.cold_start.first_snapshot',
              ].map((metric) => [
                metric,
                {
                  p50: 10,
                  p95: 12,
                  n: metric.includes('.l3.') ? 3 : metric.includes('startup') ? 5 : 20,
                },
              ]),
            ),
            baselineProvenance: {
              run: 'actual-run',
              resources: { rawPeaksBytes: [111575040, 111640576, 111771648] },
            },
          }),
        ),
      );
      const prettier = spawnSync('npm', ['exec', '--', 'prettier', '--check', budgetPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      expect(prettier.status, prettier.stderr).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('迁移器拒绝把非 PF-01 legacy budget 伪装成新的 frozen provenance', () => {
    const legacy = JSON.parse(readFileSync(resolve(HISTORICAL_BUDGET_PATH), 'utf8')) as Record<
      string,
      unknown
    >;
    legacy.descriptorId = 'PF-02';
    expect(() =>
      migratePf01BudgetV2({
        budget: legacy,
        baselineBuildInputs: baselineBuildInputs(),
        baselineMeasurementInputs: baselineMeasurementInputs(),
      }),
    ).toThrow(/PF-01/);
  });

  it('生成路径可幂等刷新已迁移 budget 的格式与 Git-object provenance', () => {
    const current = JSON.parse(readFileSync(resolve(HISTORICAL_BUDGET_PATH), 'utf8')) as Record<
      string,
      unknown
    >;
    const refreshed = migratePf01BudgetV2({
      budget: current,
      baselineBuildInputs: baselineBuildInputs(),
      baselineMeasurementInputs: baselineMeasurementInputs(),
    });
    expect(refreshed.schemaVersion).toBe(4);
    expect(refreshed.baselineProvenance.buildInputs.digest).toBe(
      baselineBuildInputs().digest as string,
    );
  });

  it('迁移器拒绝 canonical entries 与声明 digest 不一致的 provenance', () => {
    const current = JSON.parse(readFileSync(resolve(HISTORICAL_BUDGET_PATH), 'utf8')) as Record<
      string,
      unknown
    >;
    const invalidInputs = baselineBuildInputs();
    invalidInputs.digest = 'd'.repeat(64);
    expect(() =>
      migratePf01BudgetV2({ budget: current, baselineBuildInputs: invalidInputs }),
    ).toThrow(/build-input/i);
  });
});
