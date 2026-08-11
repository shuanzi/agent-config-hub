/**
 * PF-01 measurement-method inputs v1.
 *
 * This provenance is deliberately independent from L3 harness `buildInputs`: the latter
 * establishes the binary inputs, while this module pins the L2/L3 measurement protocol,
 * samplers, statistics and comparison logic that determine samples and verdicts.
 */
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { build } from 'vite';
import { REPO_ROOT } from './lib.mjs';

export const PF01_MEASUREMENT_INPUTS = Object.freeze({
  schemaVersion: 1,
  algorithm: 'pf01-measurement-inputs-v1',
  method: 'raw bytes SHA-256 / byte-sorted repo-relative paths',
});

/** `tests/l2/workbench.html` under the actual perf Vite server, excluding external/virtual modules. */
export const PF01_L2_VITE_MODULES = Object.freeze([
  'fixtures/fx-01/fixture.json',
  'fixtures/fx-01/native-root/skills/demo-skill/SKILL.md',
  'fixtures/sensitive-masking.ts',
  'src/App.tsx',
  'src/gateway/mock.ts',
  'src/gateway/perf-catalog.ts',
  'src/session/ReadOnlyWorkbenchSession.ts',
  'src/ui/ReadOnlyWorkbench.tsx',
  'src/ui/workbench.css',
  'src/workbench/read-only-model.ts',
  'tests/l2/l2-main.tsx',
  'tests/l2/pf01-startup-eligibility.ts',
  'tests/l2/workbench.html',
]);

const METHOD_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'performance/descriptors/pf-01.catalog-browse.json',
  'performance/pf-01.perf.test.ts',
  'performance/pf-01.coldstart.test.ts',
  'performance/wdio.conf.ts',
  'performance/wdio.l3.conf.ts',
  'scripts/orchestrator/build-harness.mjs',
  'scripts/orchestrator/lib.mjs',
  'scripts/orchestrator/perf.mjs',
  'scripts/orchestrator/pf01-budget.mjs',
  'scripts/orchestrator/pf01-build-inputs.mjs',
  'scripts/orchestrator/pf01-lifecycle.mjs',
  'scripts/orchestrator/pf01-measurement-inputs.mjs',
  'scripts/orchestrator/pf01-resource.mjs',
  'scripts/orchestrator/refresh-pf01-budget.mjs',
];

function sortPaths(paths) {
  return [...paths].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

export const PF01_MEASUREMENT_INPUT_PATHS = Object.freeze(
  sortPaths([...new Set([...METHOD_FILES, ...PF01_L2_VITE_MODULES])]),
);

const INPUT_PATH_SET = new Set(PF01_MEASUREMENT_INPUT_PATHS);

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value);
}

function canonicalPath(pathname) {
  if (
    typeof pathname !== 'string' ||
    pathname.length === 0 ||
    pathname.includes('\0') ||
    pathname.includes('\\') ||
    pathname.startsWith('/') ||
    pathname.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`PF-01 measurement-input path outside repository: ${String(pathname)}`);
  }
  return pathname;
}

function assertNoPathCollisions(paths) {
  const seen = new Map();
  for (const pathname of paths) {
    const key = pathname.normalize('NFC').toLocaleLowerCase('en-US');
    const prior = seen.get(key);
    if (prior !== undefined && prior !== pathname) {
      throw new Error(`PF-01 measurement-input path collision: ${prior} / ${pathname}`);
    }
    seen.set(key, pathname);
  }
}

function samePathList(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function assertExactPaths(paths) {
  if (!samePathList(paths, PF01_MEASUREMENT_INPUT_PATHS)) {
    throw new Error('PF-01 measurement-input set missing, extra, or out of order');
  }
}

function command(repoRoot, args, encoding = 'utf8') {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`PF-01 measurement-input Git 查询失败: ${args.join(' ')} (${String(error)})`);
  }
}

function formatResult(entries, source) {
  return {
    schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
    algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
    digest: computePf01MeasurementInputsDigest({
      schemaVersion: PF01_MEASUREMENT_INPUTS.schemaVersion,
      algorithm: PF01_MEASUREMENT_INPUTS.algorithm,
      entries,
    }),
    entries,
    source,
  };
}

/** The canonical, versioned digest is intentionally not the harness binary/source digest. */
export function computePf01MeasurementInputsDigest({ schemaVersion, algorithm, entries }) {
  if (
    schemaVersion !== PF01_MEASUREMENT_INPUTS.schemaVersion ||
    algorithm !== PF01_MEASUREMENT_INPUTS.algorithm ||
    !Array.isArray(entries)
  ) {
    throw new Error('PF-01 measurement-input canonical payload schema invalid');
  }
  return sha256Bytes(
    Buffer.from(`${JSON.stringify({ schemaVersion, algorithm, entries })}\n`, 'utf8'),
  );
}

function relativeViteModuleId(moduleId, repoRoot) {
  if (typeof moduleId !== 'string' || moduleId.startsWith('\0')) return null;
  const physical = moduleId.split('?')[0];
  if (!path.isAbsolute(physical)) return canonicalPath(physical);
  const relative = path.relative(repoRoot, physical);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const normalized = relative.split(path.sep).join('/');
  if (normalized.startsWith('node_modules/')) return null;
  return canonicalPath(normalized);
}

/** Rebuild the actual L2 perf entry closure; a changed method module cannot silently evade the digest. */
export async function assertPf01L2ViteModuleClosure({ repoRoot = REPO_ROOT, moduleIds } = {}) {
  let discovered = moduleIds;
  if (discovered === undefined) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf01-l2-measurement-'));
    const moduleSet = new Set();
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await build({
        root: repoRoot,
        logLevel: 'silent',
        build: {
          outDir: outputDir,
          emptyOutDir: true,
          rollupOptions: { input: path.join(repoRoot, 'tests/l2/workbench.html') },
        },
        plugins: [
          {
            name: 'pf01-l2-measurement-module-closure',
            generateBundle(_, bundle) {
              for (const output of Object.values(bundle)) {
                if (output.type !== 'chunk') continue;
                for (const id of Object.keys(output.modules)) moduleSet.add(id);
              }
            },
          },
        ],
      });
      discovered = [...moduleSet];
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }
  const actual = sortPaths(
    [...new Set(discovered.map((id) => relativeViteModuleId(id, repoRoot)).filter(Boolean))],
  );
  const expected = sortPaths(PF01_L2_VITE_MODULES);
  if (!samePathList(actual, expected)) {
    throw new Error(
      `PF-01 L2 Vite module closure mismatch: actual=${actual.join(',')} expected=${expected.join(',')}`,
    );
  }
  return actual;
}

function matchesEntries(entries) {
  if (!Array.isArray(entries)) return false;
  const paths = [];
  const seen = new Set();
  let prior = null;
  for (const entry of entries) {
    try {
      const pathname = canonicalPath(entry?.path);
      if (!isSha256(entry?.sha256)) return false;
      if (prior !== null && Buffer.compare(Buffer.from(prior), Buffer.from(pathname)) >= 0) return false;
      prior = pathname;
      const collision = pathname.normalize('NFC').toLocaleLowerCase('en-US');
      if (seen.has(collision)) return false;
      seen.add(collision);
      paths.push(pathname);
    } catch {
      return false;
    }
  }
  return samePathList(paths, PF01_MEASUREMENT_INPUT_PATHS);
}

/** Schema validation is shared by budget/refresh/verify paths and rejects missing, extra or self-inconsistent inputs. */
export function validatePf01MeasurementInputs(value, sourceKind) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.schemaVersion === PF01_MEASUREMENT_INPUTS.schemaVersion &&
    value.algorithm === PF01_MEASUREMENT_INPUTS.algorithm &&
    isSha256(value.digest) &&
    value.source !== null &&
    typeof value.source === 'object' &&
    value.source.kind === sourceKind &&
    value.source.method === PF01_MEASUREMENT_INPUTS.method &&
    isCommit(value.source.commit) &&
    matchesEntries(value.entries) &&
    value.digest ===
      computePf01MeasurementInputsDigest({
        schemaVersion: value.schemaVersion,
        algorithm: value.algorithm,
        entries: value.entries,
      })
  );
}

function defaultTrackedPaths(repoRoot) {
  return command(repoRoot, ['ls-files', '-z'], 'buffer')
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((pathname) => INPUT_PATH_SET.has(pathname));
}

/** Current checkout collector: only a clean, physical regular-file measurement method can self-attest. */
export function collectPf01MeasurementInputs({
  repoRoot = REPO_ROOT,
  trackedPaths,
  gitStatus,
} = {}) {
  const status =
    gitStatus === undefined
      ? command(repoRoot, ['status', '--porcelain', '--untracked-files=all'])
      : gitStatus;
  if (status.trim() !== '') {
    throw new Error('PF-01 measurement-input collection requires clean tracked checkout (untracked/modified input)');
  }
  const selected = trackedPaths === undefined ? defaultTrackedPaths(repoRoot) : trackedPaths;
  const paths = sortPaths(selected.map(canonicalPath));
  assertNoPathCollisions(paths);
  assertExactPaths(paths);
  if (trackedPaths === undefined) {
    // The current checkout alone can execute Vite; an old Git tree is attested by raw blobs below.
    return assertPf01L2ViteModuleClosure({ repoRoot }).then(() =>
      collectPf01MeasurementInputs({ repoRoot, trackedPaths: paths, gitStatus: '' }),
    );
  }

  const root = path.resolve(repoRoot);
  const entries = paths.map((pathname) => {
    const fullPath = path.resolve(root, pathname);
    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`PF-01 measurement-input path outside repository: ${pathname}`);
    }
    let stats;
    try {
      stats = fs.lstatSync(fullPath);
    } catch {
      throw new Error(`PF-01 measurement-input missing: ${pathname}`);
    }
    if (stats.isSymbolicLink()) throw new Error(`PF-01 measurement-input symlink rejected: ${pathname}`);
    if (!stats.isFile()) throw new Error(`PF-01 measurement-input must be a regular file: ${pathname}`);
    return { path: pathname, sha256: sha256Bytes(fs.readFileSync(fullPath)) };
  });
  const commit = command(repoRoot, ['rev-parse', 'HEAD']).trim();
  return formatResult(entries, {
    kind: 'clean-tracked-checkout',
    method: PF01_MEASUREMENT_INPUTS.method,
    commit,
  });
}

function decodeGitPath(bytes) {
  const pathname = bytes.toString('utf8');
  if (!Buffer.from(pathname, 'utf8').equals(bytes)) {
    throw new Error('PF-01 measurement-input Git path must be UTF-8');
  }
  return pathname;
}

/** Immutable baseline collector: Git blobs must be the same fixed regular-file method input set. */
export function collectPf01MeasurementInputsFromGit({ repoRoot = REPO_ROOT, commit } = {}) {
  if (!/^[a-f0-9]{40}$/i.test(commit ?? '') && commit !== 'HEAD') {
    throw new Error('PF-01 measurement-input baseline commit invalid');
  }
  const resolvedCommit = command(repoRoot, ['rev-parse', commit]).trim();
  const raw = command(repoRoot, ['ls-tree', '-r', '-z', '--full-tree', resolvedCommit], 'buffer');
  const selected = [];
  for (const record of raw.toString('binary').split('\0').filter(Boolean)) {
    const bytes = Buffer.from(record, 'binary');
    const tab = bytes.indexOf(0x09);
    if (tab <= 0) throw new Error('PF-01 measurement-input Git tree record malformed');
    const header = bytes.subarray(0, tab).toString('ascii').split(' ');
    const pathname = decodeGitPath(bytes.subarray(tab + 1));
    if (!INPUT_PATH_SET.has(pathname)) continue;
    selected.push({ mode: header[0], type: header[1], object: header[2], path: canonicalPath(pathname) });
  }
  const paths = sortPaths(selected.map((entry) => entry.path));
  assertNoPathCollisions(paths);
  assertExactPaths(paths);
  const byPath = new Map(selected.map((entry) => [entry.path, entry]));
  const entries = paths.map((pathname) => {
    const entry = byPath.get(pathname);
    if (
      entry === undefined ||
      !/^100[0-7]{3}$/.test(entry.mode) ||
      entry.type !== 'blob' ||
      !/^[a-f0-9]{40}$/i.test(entry.object)
    ) {
      throw new Error(`PF-01 measurement-input Git object invalid: ${pathname}`);
    }
    return { path: pathname, sha256: sha256Bytes(command(repoRoot, ['cat-file', 'blob', entry.object], 'buffer')) };
  });
  return formatResult(entries, {
    kind: 'git-object-tree',
    method: PF01_MEASUREMENT_INPUTS.method,
    commit: resolvedCommit,
  });
}
