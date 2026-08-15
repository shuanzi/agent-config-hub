/**
 * FE-02 closure lineage。
 *
 * historical performance subject 只能服务其后代；final closure 不得改变 FE-02 product/SUT tree。
 * closure commit 新增的 orchestrator 脚本、waiver record 与测试不属于 SUT，不参与零漂移比较。
 */
import { execFileSync } from 'node:child_process';
import { assertNoGitAmbient, REPO_ROOT } from './lib.mjs';

export const FE02_SUBJECT_COMMIT = '7936cb91f54c94e836124b0d46337247776431d2';
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

/** final commit 必须是 subject 的 descendant，且 FE-02 product/SUT tree 相对 subject 零漂移。 */
export function validateFe02SubjectClosureLineage({
  repoRoot = REPO_ROOT,
  finalCommit,
  subjectCommit = FE02_SUBJECT_COMMIT,
} = {}) {
  const violations = [];
  if (typeof finalCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(finalCommit)) {
    return { valid: false, violations: ['final commit invalid'] };
  }
  if (subjectCommit !== FE02_SUBJECT_COMMIT) {
    return { valid: false, violations: ['FE-02 subject commit is not exact'] };
  }
  if (!gitSucceeds(repoRoot, ['merge-base', '--is-ancestor', subjectCommit, finalCommit])) {
    violations.push('final commit is not an ancestor-descendant continuation of the historical subject');
  }
  const trees = {};
  for (const tree of FE02_PRODUCT_SUT_TREES) {
    const subjectTree = treeOid(repoRoot, subjectCommit, tree);
    const finalTree = treeOid(repoRoot, finalCommit, tree);
    trees[tree] = { subject: subjectTree, final: finalTree };
    if (subjectTree === null || finalTree === null || subjectTree !== finalTree) {
      violations.push(`FE-02 product/SUT tree changed or is unavailable: ${tree}`);
    }
  }
  if (
    !gitSucceeds(repoRoot, [
      'diff',
      '--quiet',
      subjectCommit,
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
    subjectCommit,
    finalCommit,
    trees,
  };
}
