import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { isExactFe01Pf01SubjectWaiverRecord, validateFe01Pf01SubjectWaiver } from '../../scripts/orchestrator/fe01-pf01-subject-waiver.mjs';

describe('FE-01 PF-01 subject accepted-with-waiver', () => {
  it('从提交的预算、Git object 与两份 immutable run 重新计算唯一 startup p50 失败', () => {
    expect(validateFe01Pf01SubjectWaiver()).toMatchObject({
      valid: true,
      automaticResult: {
        status: 'fail',
        exitCode: 1,
        runId: '20260812T035717854Z-p74069-000',
        commit: '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf',
        violation: {
          metric: 'pf01.startup.first_list_visible',
          statistic: 'p50',
          observedMs: 16.2,
          thresholdMs: 15.75,
          deltaMs: 0.45,
        },
      },
    });
  });

  it('测试本身直接读取 subject Git budget 与 immutable raw samples，重算唯一 startup p50 fail', () => {
    const subjectCommit = '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf';
    const budget = JSON.parse(
      execFileSync('git', ['show', `${subjectCommit}:performance/budgets/pf-01.budgets.json`], {
        encoding: 'utf8',
      }),
    );
    const samples = JSON.parse(
      fs.readFileSync(
        '.artifacts/performance/PF-01/20260812T035717854Z-p74069-000/samples.json',
        'utf8',
      ),
    );
    const startup = [...samples.metrics['pf01.startup.first_list_visible'].samples].sort(
      (left, right) => left - right,
    );
    const p50 = startup[(startup.length - 1) / 2];
    const entry = budget.budgets.find(
      (candidate: { metric: string }) => candidate.metric === 'pf01.startup.first_list_visible',
    );
    const limit = entry.baseline.p50 * entry.regressionAllowance.maxRatio;

    expect(p50).toBe(16.2);
    expect(limit).toBe(15.75);
    expect(p50 - limit).toBeCloseTo(0.45, 8);
  });

  it('closed exact record 拒绝 authorization、automaticResult、预算、14 SHA 与 nested contract/debt 的额外、缺失或漂移字段', () => {
    const record = JSON.parse(
      fs.readFileSync('performance/waivers/fe-01-pf-01-subject-startup-p50.json', 'utf8'),
    );
    expect(isExactFe01Pf01SubjectWaiverRecord(record)).toBe(true);

    const mutations = [
      (value: typeof record) => (value.authorization.extraScope = 'not authorized'),
      (value: typeof record) => delete value.automaticResult.violation.deltaMs,
      (value: typeof record) => (value.automaticResult.runId = '20260812T000000000Z-p0-000'),
      (value: typeof record) => (value.budget.sha256 = '0'.repeat(64)),
      (value: typeof record) => (value.artifacts.subject['proposed-budgets.json'] = '0'.repeat(64)),
      (value: typeof record) => (value.measurementContract.runner.node = 'v99.0.0'),
      (value: typeof record) => value.measurementContract.buildEnvironment.overrides.push('VITE_X'),
      (value: typeof record) => delete value.performanceDebt.scope,
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(record);
      mutate(invalid);
      expect(isExactFe01Pf01SubjectWaiverRecord(invalid)).toBe(false);
    }
  });
});
