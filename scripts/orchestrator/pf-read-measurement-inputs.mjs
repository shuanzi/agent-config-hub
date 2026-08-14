/** PF-02/PF-03 L2 SUT + measurement-method input attestation. */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, sha256File } from './lib.mjs';
import { comparePfReadPaths, pfReadMeasurementInputDigest } from './pf-read-evidence.mjs';

export const PF_READ_REQUIRED_L2_MODULES = Object.freeze([
  'tests/l2/l2-main.tsx',
  'src/App.tsx',
  'src/ui/ReadOnlyWorkbench.tsx',
  'src/session/ReadOnlyWorkbenchSession.ts',
  'src/workbench/read-only-model.ts',
  'src/ui/workbench.css',
  'src/gateway/mock.ts',
  'src/gateway/pf-read-fixtures.ts',
  'fixtures/sensitive-masking.ts',
]);

function isCanonicalRelative(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.normalize('NFC') &&
    !value.includes('\0') &&
    !value.includes('\\') &&
    !value.startsWith('/') &&
    !value.toLowerCase().includes('file:') &&
    value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}

function relativeUnder(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function physicalDirectoryChain(root, target) {
  if (!relativeUnder(root, target) && path.resolve(root) !== path.resolve(target)) {
    throw new Error('physical path 越出 trusted root');
  }
  let current = path.resolve(root);
  const rootStat = fs.lstatSync(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('trusted root 必须是物理目录');
  }
  const relative = path.relative(current, target);
  if (relative.length === 0) return;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('path ancestry 必须全部为物理目录');
    }
  }
}

export function physicalPfReadRepoFile(relativePath, { repoRoot = REPO_ROOT } = {}) {
  if (!isCanonicalRelative(relativePath)) {
    throw new Error('PF read module path 必须是规范 repo-relative path');
  }
  const absolute = path.resolve(repoRoot, relativePath);
  if (!relativeUnder(repoRoot, absolute)) throw new Error('PF read module path 越出 repo root');
  const parent = path.dirname(absolute);
  physicalDirectoryChain(repoRoot, parent);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('PF read module 必须是物理 regular file');
  }
  const realRoot = fs.realpathSync(repoRoot);
  const realFile = fs.realpathSync(absolute);
  if (!relativeUnder(realRoot, realFile)) throw new Error('PF read module realpath 越出 repo root');
  return { relativePath, absolute };
}

function canonicalModuleId(moduleId) {
  if (typeof moduleId !== 'string' || moduleId.length === 0) {
    throw new Error('Vite module id 无效');
  }
  return moduleId.split('?')[0]?.split('#')[0] ?? '';
}

function isKnownExternalOrVirtualModuleId(canonical) {
  return (
    canonical.includes('\0') ||
    canonical.startsWith('node:') ||
    canonical.startsWith('virtual:') ||
    (canonical.startsWith('/@') && !canonical.startsWith('/@fs/')) ||
    canonical.includes('node_modules')
  );
}

function physicalModuleId(moduleId, repoRoot) {
  const canonical = canonicalModuleId(moduleId);
  if (isKnownExternalOrVirtualModuleId(canonical) || !path.isAbsolute(canonical)) {
    throw new Error('Vite module id 必须是 repo-owned physical module');
  }
  const absolute = canonical.startsWith('/@fs/')
    ? path.resolve(canonical.slice('/@fs'.length))
    : path.resolve(canonical);
  if (!relativeUnder(repoRoot, absolute)) throw new Error('Vite module graph 越出 repo root');
  return path
    .relative(repoRoot, physicalPfReadRepoFile(path.relative(repoRoot, absolute), { repoRoot }).absolute)
    .split(path.sep)
    .join('/');
}

function assertNoCasefoldCollisions(paths, label) {
  const seen = new Set();
  for (const modulePath of paths) {
    const key = modulePath.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error(`${label} path 不得重复或发生 casefold collision`);
    seen.add(key);
  }
}

/**
 * Config-side normalization for Vite's raw graph. Known framework/external
 * IDs are intentionally not measurement inputs; every other id must resolve
 * to a physical repo file. Query/hash aliases are deduplicated only after
 * canonical physical resolution, then UTF-8-byte sorted.
 */
export function normalizePfReadL2ViteModuleGraphCandidates({ moduleIds, repoRoot = REPO_ROOT }) {
  if (!Array.isArray(moduleIds) || moduleIds.length === 0) {
    throw new Error('actual Vite ModuleGraph 不能为空');
  }
  const modulePaths = [];
  for (const moduleId of moduleIds) {
    const canonical = canonicalModuleId(moduleId);
    if (isKnownExternalOrVirtualModuleId(canonical)) continue;
    if (!path.isAbsolute(canonical)) {
      throw new Error('Vite module graph 含未知非物理 module id');
    }
    modulePaths.push(physicalModuleId(moduleId, repoRoot));
  }
  const unique = [...new Set(modulePaths)].sort(comparePfReadPaths);
  assertNoCasefoldCollisions(unique, 'actual Vite ModuleGraph');
  return unique;
}

/** Config-side: attest a pre-normalized set of physical Vite module IDs. */
export function attestPfReadL2ViteModuleGraph({ moduleIds, repoRoot = REPO_ROOT }) {
  if (!Array.isArray(moduleIds) || moduleIds.length === 0) {
    throw new Error('actual Vite ModuleGraph 不能为空');
  }
  const modulePaths = moduleIds.map((moduleId) => physicalModuleId(moduleId, repoRoot));
  if (modulePaths.length === 0) throw new Error('actual Vite ModuleGraph 无 repo-owned L2 modules');
  modulePaths.sort(comparePfReadPaths);
  if (modulePaths.some((modulePath, index) => index > 0 && modulePath === modulePaths[index - 1])) {
    throw new Error('actual Vite ModuleGraph path 不得重复');
  }
  assertNoCasefoldCollisions(modulePaths, 'actual Vite ModuleGraph');
  for (const required of PF_READ_REQUIRED_L2_MODULES) {
    if (!modulePaths.includes(required)) throw new Error(`actual Vite ModuleGraph 缺少 L2 SUT: ${required}`);
  }
  return { schemaVersion: 1, modulePaths };
}

/** Runner-side: reread the persisted graph and revalidate physical paths/order. */
export function readPfReadL2ViteModuleGraph({ graphPath, repoRoot = REPO_ROOT }) {
  const graphAbsolute = path.resolve(graphPath);
  const graphStat = fs.lstatSync(graphAbsolute);
  if (!graphStat.isFile() || graphStat.isSymbolicLink()) {
    throw new Error('actual Vite ModuleGraph 必须是物理 regular file');
  }
  const graph = JSON.parse(fs.readFileSync(graphAbsolute, 'utf8'));
  if (
    Object.keys(graph).sort().join(',') !== 'modulePaths,schemaVersion' ||
    graph.schemaVersion !== 1 ||
    !Array.isArray(graph.modulePaths) ||
    graph.modulePaths.length === 0
  ) {
    throw new Error('actual Vite ModuleGraph schema 无效');
  }
  const modulePaths = graph.modulePaths;
  if (
    modulePaths.some(
      (modulePath, index) =>
        !isCanonicalRelative(modulePath) ||
        (index > 0 && comparePfReadPaths(modulePaths[index - 1], modulePath) >= 0),
    )
  ) {
    throw new Error('actual Vite ModuleGraph paths 必须 canonical sorted unique');
  }
  assertNoCasefoldCollisions(modulePaths, 'actual Vite ModuleGraph');
  for (const required of PF_READ_REQUIRED_L2_MODULES) {
    if (!modulePaths.includes(required)) throw new Error(`actual Vite ModuleGraph 缺少 L2 SUT: ${required}`);
  }
  return modulePaths.map((modulePath) => physicalPfReadRepoFile(modulePath, { repoRoot }));
}

function staticMethodPaths(descriptorPath) {
  return [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'tests/l2/workbench.html',
    descriptorPath,
    'performance/wdio.read.conf.ts',
    'performance/pf-read.collector.test.ts',
    'scripts/orchestrator/perf.mjs',
    'scripts/orchestrator/perf-read.mjs',
    'scripts/orchestrator/pf-read-evidence.mjs',
    'scripts/orchestrator/pf-read-measurement-inputs.mjs',
    'scripts/orchestrator/lib.mjs',
  ];
}

/** Union actual L2 graph with the static measurement method and hash every physical input. */
export function collectPfReadMeasurementInputs({ graphPath, descriptorPath, repoRoot = REPO_ROOT }) {
  const actual = readPfReadL2ViteModuleGraph({ graphPath, repoRoot }).map(({ relativePath }) => relativePath);
  const allPaths = [...new Set([...actual, ...staticMethodPaths(descriptorPath)])].sort(comparePfReadPaths);
  assertNoCasefoldCollisions(allPaths, 'PF read measurement inputs');
  const entries = allPaths.map((relativePath) => {
    const { absolute } = physicalPfReadRepoFile(relativePath, { repoRoot });
    return { path: relativePath, sha256: sha256File(absolute) };
  });
  return {
    schemaVersion: 1,
    algorithm: 'pf-read-measurement-contract-v1',
    digest: pfReadMeasurementInputDigest(entries),
    entries,
  };
}
