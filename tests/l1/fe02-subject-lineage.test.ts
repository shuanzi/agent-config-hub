import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime lineage validator is a plain Node ESM module.
import { FE02_PRODUCT_SUT_TREES, FE02_SUBJECT_COMMIT, validateFe02SubjectClosureLineage } from '../../scripts/orchestrator/fe02-subject-lineage.mjs';

const roots: string[] = [];

function headCommit(repoRoot?: string) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot ?? resolve('.'),
    encoding: 'utf8',
  }).trim();
}

/** 在临时 clone 上创建一个提交，用于构造 SUT/非 SUT 漂移场景。 */
function cloneWithCommit(mutate: (root: string) => void, message: string) {
  const rootParent = mkdtempSync(join(tmpdir(), 'acm-fe02-lineage-'));
  roots.push(rootParent);
  const root = join(rootParent, 'repo');
  execFileSync('git', ['clone', '--no-hardlinks', '--quiet', resolve('.'), root]);
  mutate(root);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=fe02-lineage-test',
      '-c',
      'user.email=fe02-lineage-test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      message,
    ],
    { cwd: root },
  );
  return { root, finalCommit: headCommit(root) };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('FE-02 subject waiver final lineage', () => {
  it('subject 自身与零 SUT 漂移的后代都通过；closure 新增的 orchestrator/docs 不属于 SUT', () => {
    expect(FE02_SUBJECT_COMMIT).toBe('7936cb91f54c94e836124b0d46337247776431d2');
    expect(FE02_PRODUCT_SUT_TREES).toEqual([
      'src',
      'src-tauri',
      'fixtures/fx-02',
      'fixtures/fx-03',
    ]);
    expect(validateFe02SubjectClosureLineage({ finalCommit: FE02_SUBJECT_COMMIT })).toMatchObject({
      valid: true,
      subjectCommit: FE02_SUBJECT_COMMIT,
      finalCommit: FE02_SUBJECT_COMMIT,
    });
    // 当前 HEAD 是 subject 的后代且 src/src-tauri/fixtures 零漂移。
    expect(validateFe02SubjectClosureLineage({ finalCommit: headCommit() })).toMatchObject({
      valid: true,
    });
  });

  it('拒绝非 subject 后代，避免把其他历史 evidence 借为本次 closure', () => {
    expect(
      validateFe02SubjectClosureLineage({
        finalCommit: '9470f64e9b1edb4695092675fbfbd2043ac7b354',
      }),
    ).toMatchObject({ valid: false });
  });

  it('SUT tree 漂移拒绝；orchestrator/docs 漂移不拒绝', () => {
    const sut = cloneWithCommit(
      (root) => appendFileSync(join(root, 'src/App.tsx'), '// fe02 lineage SUT drift probe\n'),
      'sut drift probe',
    );
    expect(
      validateFe02SubjectClosureLineage({ repoRoot: sut.root, finalCommit: sut.finalCommit }),
    ).toMatchObject({ valid: false });

    const tooling = cloneWithCommit((root) => {
      writeFileSync(join(root, 'scripts/orchestrator/fe02-lineage-probe.mjs'), '// probe\n');
      appendFileSync(join(root, 'design-qa.md'), '\nfe02 lineage non-SUT drift probe\n');
    }, 'non-sut drift probe');
    expect(
      validateFe02SubjectClosureLineage({
        repoRoot: tooling.root,
        finalCommit: tooling.finalCommit,
      }),
    ).toMatchObject({ valid: true });
  });
});
