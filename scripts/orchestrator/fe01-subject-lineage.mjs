/**
 * FE-01 Scheme B closure lineage。
 *
 * historical performance subject 只能服务其后代；final closure 不得改变 FE-01 product/SUT tree。
 */
import { execFileSync } from 'node:child_process';
import { assertNoGitAmbient, REPO_ROOT, sha256Text } from './lib.mjs';

export const FE01_SUBJECT_COMMIT = '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf';
export const FE01_PRODUCT_SUT_TREES = Object.freeze([
  'src',
  'src-tauri',
  'fixtures/fx-01',
]);

/** 从历史 L2 actual module graph 与 L3 build-input 中筛出的 FE-01 product/SUT Git blobs。 */
export const FE01_SUT_PROJECTION_PATHS = Object.freeze([
  'fixtures/fx-01/fixture.json',
  'fixtures/fx-01/native-root/skills/demo-skill/SKILL.md',
  'fixtures/sensitive-masking.ts',
  'index.html',
  'package-lock.json',
  'package.json',
  'rust-toolchain.toml',
  'src/App.tsx',
  'src/gateway/index.ts',
  'src/gateway/mock.ts',
  'src/gateway/perf-catalog.ts',
  'src/gateway/tauri.ts',
  'src/gateway/wire/gateway-wire.ts',
  'src/main.tsx',
  'src/session/ReadOnlyWorkbenchSession.ts',
  'src/ui/ReadOnlyWorkbench.tsx',
  'src/ui/workbench.css',
  'src/workbench/read-only-model.ts',
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/build.rs',
  'src-tauri/capabilities/default.json',
  'src-tauri/icons/icon.png',
  'src-tauri/src/adapter_registry.rs',
  'src-tauri/src/catalog.rs',
  'src-tauri/src/core.rs',
  'src-tauri/src/domain.rs',
  'src-tauri/src/ipc.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/main.rs',
  'src-tauri/src/project_applicability.rs',
  'src-tauri/src/wire.rs',
  'src-tauri/tauri.conf.json',
  'src-tauri/tauri.conf.test-harness.json',
  'tests/contract/frontend-gateway-contract.ts',
  'tests/l2/l2-main.tsx',
  'tests/l2/pf01-startup-eligibility.ts',
  'tests/l2/workbench.html',
  'tests/l3/contract-entry.ts',
  'tests/l3/contract.html',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'vite.l3.config.ts',
]);
export const FE01_SUT_PROJECTION_ALGORITHM = 'fe01-sut-git-blob-projection-v1';

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

function blobOid(repoRoot, commit, filePath) {
  try {
    const oid = git(repoRoot, ['rev-parse', `${commit}:${filePath}`]);
    return /^[0-9a-f]{40}$/i.test(oid) ? oid : null;
  } catch {
    return null;
  }
}

/** Git-object projection digest: only the frozen SUT paths participate; docs/tooling/evidence do not. */
export function computeFe01SutProjectionDigest(entries) {
  return sha256Text(
    `${JSON.stringify({ algorithm: FE01_SUT_PROJECTION_ALGORITHM, entries }, null, 2)}\n`,
  );
}

function sutProjection(repoRoot, commit) {
  const entries = {};
  for (const filePath of FE01_SUT_PROJECTION_PATHS) entries[filePath] = blobOid(repoRoot, commit, filePath);
  return { entries, digest: computeFe01SutProjectionDigest(entries) };
}

/** final commit 必须是指定 subject 的 descendant，且所有 FE-01 product/SUT tree OID 相同。 */
export function validateFe01SubjectClosureLineage({
  repoRoot = REPO_ROOT,
  finalCommit,
  subjectCommit = FE01_SUBJECT_COMMIT,
} = {}) {
  const violations = [];
  if (typeof finalCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(finalCommit)) {
    return { valid: false, violations: ['final commit invalid'] };
  }
  if (subjectCommit !== FE01_SUBJECT_COMMIT) {
    return { valid: false, violations: ['FE-01 subject commit is not exact'] };
  }
  if (!gitSucceeds(repoRoot, ['merge-base', '--is-ancestor', subjectCommit, finalCommit])) {
    violations.push('final commit is not an ancestor-descendant continuation of the historical subject');
  }
  const trees = {};
  for (const tree of FE01_PRODUCT_SUT_TREES) {
    const subjectTree = treeOid(repoRoot, subjectCommit, tree);
    const finalTree = treeOid(repoRoot, finalCommit, tree);
    trees[tree] = { subject: subjectTree, final: finalTree };
    if (subjectTree === null || finalTree === null || subjectTree !== finalTree) {
      violations.push(`FE-01 product/SUT tree changed or is unavailable: ${tree}`);
    }
  }
  const subjectProjection = sutProjection(repoRoot, subjectCommit);
  const finalProjection = sutProjection(repoRoot, finalCommit);
  const projectionEntries = {};
  for (const filePath of FE01_SUT_PROJECTION_PATHS) {
    projectionEntries[filePath] = {
      subject: subjectProjection.entries[filePath],
      final: finalProjection.entries[filePath],
    };
    if (
      subjectProjection.entries[filePath] === null ||
      finalProjection.entries[filePath] === null ||
      subjectProjection.entries[filePath] !== finalProjection.entries[filePath]
    ) {
      violations.push(`FE-01 product/SUT projection changed or is unavailable: ${filePath}`);
    }
  }
  return {
    valid: violations.length === 0,
    violations,
    subjectCommit,
    finalCommit,
    trees,
    projection: {
      algorithm: FE01_SUT_PROJECTION_ALGORITHM,
      subjectDigest: subjectProjection.digest,
      finalDigest: finalProjection.digest,
      entries: projectionEntries,
    },
  };
}
