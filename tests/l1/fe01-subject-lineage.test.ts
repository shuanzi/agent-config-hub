import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime lineage validator is a plain Node ESM module.
import { computeFe01SutProjectionDigest, FE01_SUBJECT_COMMIT, FE01_SUT_PROJECTION_PATHS, validateFe01SubjectClosureLineage } from '../../scripts/orchestrator/fe01-subject-lineage.mjs';

describe('FE-01 subject waiver final lineage', () => {
  it('只接受 subject 的后代且 FE-01 product/SUT tree 未变化的 final commit', () => {
    expect(FE01_SUBJECT_COMMIT).toBe('9c91e042c39023d7a30fcc04fbd1d0e36985fdbf');
    expect(validateFe01SubjectClosureLineage({ finalCommit: FE01_SUBJECT_COMMIT })).toMatchObject({
      valid: true,
      subjectCommit: FE01_SUBJECT_COMMIT,
      finalCommit: FE01_SUBJECT_COMMIT,
    });
  });

  it('拒绝非 subject 后代，避免把其他历史 evidence 借为本次 closure', () => {
    expect(
      validateFe01SubjectClosureLineage({
        finalCommit: '114298a619af40d00941efec4c959e0b13d6be83',
      }),
    ).toMatchObject({ valid: false });
  });

  it('projection 覆盖历史 L2/L3 的 SUT 输入；任一 SUT blob 漂移拒绝，而 docs/tooling/closure state 不参与 digest', () => {
    expect(FE01_SUT_PROJECTION_PATHS).toContain('tests/l2/workbench.html');
    expect(FE01_SUT_PROJECTION_PATHS).toContain('package.json');
    expect(FE01_SUT_PROJECTION_PATHS).toContain('vite.l3.config.ts');
    expect(FE01_SUT_PROJECTION_PATHS).not.toContain('scripts/orchestrator/perf.mjs');
    expect(FE01_SUT_PROJECTION_PATHS).not.toContain(
      'docs/architecture/adr/0013-evidence-calibrated-performance-budgets.md',
    );

    const subject = Object.fromEntries(
      FE01_SUT_PROJECTION_PATHS.map((filePath: string) => [filePath, 'a'.repeat(40)]),
    );
    const changedSut = { ...subject, 'src/App.tsx': 'b'.repeat(40) };
    const docsAndToolingOnly = { ...subject };
    expect(computeFe01SutProjectionDigest(changedSut)).not.toBe(
      computeFe01SutProjectionDigest(subject),
    );
    expect(computeFe01SutProjectionDigest(docsAndToolingOnly)).toBe(
      computeFe01SutProjectionDigest(subject),
    );
  });
});
