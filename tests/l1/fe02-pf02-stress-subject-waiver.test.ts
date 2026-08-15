import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { isExactFe02Pf02StressSubjectWaiverRecord, validateFe02Pf02StressSubjectWaiver } from '../../scripts/orchestrator/fe02-pf02-stress-subject-waiver.mjs';

describe('FE-02 PF-02 stress subject accepted-with-waiver', () => {
  it('从冻结预算、Git object 与两份 immutable run 重算唯一 scroll.render_stable p50 失败', () => {
    expect(validateFe02Pf02StressSubjectWaiver()).toMatchObject({
      valid: true,
      automaticResult: {
        status: 'fail',
        exitCode: 1,
        runId: '20260815T094047023Z-p76378-000',
        commit: '222efc489f85a9efe9997f19badc350f23f50bb2',
        violation: {
          metric: 'pf02.source.scroll.render_stable',
          statistic: 'p50',
          observedMs: 12.25,
          thresholdMs: 8.5,
          deltaMs: 3.75,
        },
      },
    });
  });

  it('测试本身直接读取 subject Git budget 与 immutable raw samples，重算唯一 scroll p50 fail', () => {
    const subjectCommit = '222efc489f85a9efe9997f19badc350f23f50bb2';
    const budget = JSON.parse(
      execFileSync(
        'git',
        ['show', `${subjectCommit}:performance/budgets/pf-02.stress.budgets.json`],
        { encoding: 'utf8' },
      ),
    );
    const samples = JSON.parse(
      fs.readFileSync(
        '.artifacts/verification/FE-02/20260815T094047023Z-p76378-000/performance/PF-02/stress/samples.json',
        'utf8',
      ),
    );
    const scroll = [...samples.metrics['pf02.source.scroll.render_stable'].samples].sort(
      (left: number, right: number) => left - right,
    );
    const rank = 0.5 * (scroll.length - 1);
    const p50 = (scroll[Math.floor(rank)]! + scroll[Math.ceil(rank)]!) / 2;
    const entry = budget.metrics['pf02.source.scroll.render_stable'];

    expect(p50).toBe(12.25);
    expect(entry.regressionP50CeilingMs).toBe(8.5);
    expect(p50 - entry.regressionP50CeilingMs).toBeCloseTo(3.75, 8);
    // p95 不得超过 absolute ceiling（fail-closed 唯一 violation 语义的一部分）。
    const rank95 = 0.95 * (scroll.length - 1);
    const p95 = (scroll[Math.floor(rank95)]! + scroll[Math.ceil(rank95)]!) / 2;
    expect(p95).toBeLessThanOrEqual(entry.absoluteCeilingMs);
  });

  it('closed exact record 拒绝 authorization、automaticResult、预算、SHA 与 nested contract/debt 的额外、缺失或漂移字段', () => {
    const record = JSON.parse(
      fs.readFileSync('performance/waivers/fe-02-pf-02-stress-scroll-render-stable.json', 'utf8'),
    );
    // recordDigest 复算已包含在 isExact 内：真实记录必须通过。
    expect(isExactFe02Pf02StressSubjectWaiverRecord(record)).toBe(true);

    const mutations = [
      (value: typeof record) => (value.authorization.extraScope = 'not authorized'),
      (value: typeof record) => delete value.automaticResult.violation.deltaMs,
      (value: typeof record) => (value.automaticResult.runId = '20260815T000000000Z-p0-000'),
      (value: typeof record) => (value.automaticResult.violation.observedMs = 12.26),
      (value: typeof record) => (value.profile = 'representative'),
      (value: typeof record) => (value.budget.sha256 = '0'.repeat(64)),
      (value: typeof record) => (value.artifacts.subject['samples.json'] = '0'.repeat(64)),
      (value: typeof record) => (value.artifacts.baseline['summary.json'] = '0'.repeat(64)),
      (value: typeof record) => (value.measurementContract.runner.node = 'v99.0.0'),
      (value: typeof record) =>
        (value.measurementContract.measurementInputs.digest = '0'.repeat(64)),
      (value: typeof record) => (value.recordDigest.value = '0'.repeat(64)),
      (value: typeof record) => delete value.performanceDebt.scope,
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(record);
      mutate(invalid);
      expect(isExactFe02Pf02StressSubjectWaiverRecord(invalid)).toBe(false);
    }
  });
});
