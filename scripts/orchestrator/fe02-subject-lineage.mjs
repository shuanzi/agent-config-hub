/**
 * FE-02 closure lineage。
 *
 * 两份 historical performance waiver 各绑定一个 subject commit：representative 为
 * 7936cb9、stress 为 222efc4（222efc4 本身是 7936cb9 的 descendant）。final closure
 * 必须是两者的共同后代；SUT 零漂移相对较晚的 subject commit（222efc4）判定即可——
 * 校验时先断言两个 subject 的 SUT tree OID 逐一相等（两次测量之间 SUT 未变），
 * 因此相对 222efc4 的零漂移蕴含相对 7936cb9 的零漂移。
 * closure commit 新增的 orchestrator 脚本、waiver record 与测试不属于 SUT，不参与零漂移比较。
 */
import { execFileSync } from 'node:child_process';
import { assertNoGitAmbient, REPO_ROOT } from './lib.mjs';

export const FE02_REPRESENTATIVE_SUBJECT_COMMIT =
  '7936cb91f54c94e836124b0d46337247776431d2';
export const FE02_STRESS_SUBJECT_COMMIT = '222efc489f85a9efe9997f19badc350f23f50bb2';
/** 较晚的 subject commit 是 SUT 零漂移基线。 */
export const FE02_SUBJECT_COMMIT = FE02_STRESS_SUBJECT_COMMIT;
export const FE02_SUBJECT_COMMITS = Object.freeze([
  FE02_REPRESENTATIVE_SUBJECT_COMMIT,
  FE02_STRESS_SUBJECT_COMMIT,
]);
export const FE02_PRODUCT_SUT_TREES = Object.freeze([
  'src',
  'src-tauri',
  'fixtures/fx-02',
  'fixtures/fx-03',
]);

function git(repoRoot, args) {
  assertNoGitAmbient();
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function gitSucceeds(repoRoot, args) {
  try {
    git(repoRoot, args);
    return true;
  } catch {
    return false;
  }
}

function treeOid(repoRoot, commit, tree) {
  try {
    return git(repoRoot, ['rev-parse', `${commit}:${tree}`]);
  } catch {
    return null;
  }
}

/**
 * final commit 必须是两个 subject 的共同后代，且 FE-02 product/SUT tree 相对
 * 较晚 subject（222efc4）零漂移；两个 subject 自身的 SUT tree 必须逐一相等，
 * 使该零漂移同时覆盖较早 subject（7936cb9）。
 */
export function validateFe02SubjectClosureLineage({
  repoRoot = REPO_ROOT,
  finalCommit,
  subjectCommits = FE02_SUBJECT_COMMITS,
} = {}) {
  const violations = [];
  if (typeof finalCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(finalCommit)) {
    return { valid: false, violations: ['final commit invalid'] };
  }
  if (
    !Array.isArray(subjectCommits) ||
    subjectCommits.length !== FE02_SUBJECT_COMMITS.length ||
    !FE02_SUBJECT_COMMITS.every((commit, index) => subjectCommits[index] === commit)
  ) {
    return { valid: false, violations: ['FE-02 subject commits are not exact'] };
  }
  for (const subjectCommit of FE02_SUBJECT_COMMITS) {
    if (!gitSucceeds(repoRoot, ['merge-base', '--is-ancestor', subjectCommit, finalCommit])) {
      violations.push('final commit is not an ancestor-descendant continuation of the historical subject');
    }
  }
  const driftBaseline = FE02_SUBJECT_COMMIT;
  const trees = {};
  for (const tree of FE02_PRODUCT_SUT_TREES) {
    const subjectTree = treeOid(repoRoot, driftBaseline, tree);
    const finalTree = treeOid(repoRoot, finalCommit, tree);
    trees[tree] = { subject: subjectTree, final: finalTree };
    if (subjectTree === null || finalTree === null || subjectTree !== finalTree) {
      violations.push(`FE-02 product/SUT tree changed or is unavailable: ${tree}`);
    }
    const earlierSubjectTree = treeOid(repoRoot, FE02_REPRESENTATIVE_SUBJECT_COMMIT, tree);
    if (earlierSubjectTree === null || earlierSubjectTree !== subjectTree) {
      violations.push(`FE-02 subject-to-subject product/SUT tree changed or is unavailable: ${tree}`);
    }
  }
  if (
    !gitSucceeds(repoRoot, [
      'diff',
      '--quiet',
      driftBaseline,
      finalCommit,
      '--',
      ...FE02_PRODUCT_SUT_TREES,
    ])
  ) {
    violations.push('FE-02 product/SUT diff is not empty');
  }
  return {
    valid: violations.length === 0,
    violations,
    subjectCommit: driftBaseline,
    subjectCommits: [...FE02_SUBJECT_COMMITS],
    finalCommit,
    trees,
  };
}
