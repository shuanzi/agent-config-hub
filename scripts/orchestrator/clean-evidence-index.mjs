/* global process, setTimeout */
/** Shared physical-file/lock/atomic-write mechanics for immutable evidence indexes. */
import fs from 'node:fs';
import path from 'node:path';

export function relativeFrom(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? null
    : relative.split(path.sep).join('/');
}

export function validCompletedAt(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function readPhysicalJson(filePath) {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Existing evidence/index path components must be physical directories, never a followed symlink. */
export function hasPhysicalPath(root, target) {
  const relative = relativeFrom(root, target);
  if (relative === null) return false;
  let current = path.resolve(root);
  try {
    const rootStats = fs.lstatSync(current);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return false;
    for (const segment of relative.split('/')) {
      if (segment === '') continue;
      current = path.join(current, segment);
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isNewerCompletion(candidate, existing) {
  if (existing === null || typeof existing !== 'object') return true;
  if (!validCompletedAt(existing.completedAt) || typeof existing.runId !== 'string') return false;
  const candidateTime = Date.parse(candidate.completedAt);
  const existingTime = Date.parse(existing.completedAt);
  return candidateTime !== existingTime
    ? candidateTime > existingTime
    : candidate.runId > existing.runId;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireIndexLock(lockPath, { attempts = 40, delayMs = 10 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fs.promises.open(lockPath, 'wx');
    } catch (error) {
      if (error?.code !== 'EEXIST') return null;
      await wait(delayMs);
    }
  }
  return null;
}

/**
 * The caller keeps eligibility and index shape local; this helper owns only the shared
 * physical-path check, regular-file read, serialization lock, completion ordering, and atomic rename.
 */
export async function maybeAdvancePhysicalJsonIndex({
  root,
  indexPath,
  candidate,
  temporaryPrefix,
  createIndex,
}) {
  if (
    !validCompletedAt(candidate?.completedAt) ||
    typeof candidate?.runId !== 'string' ||
    candidate.runId.length === 0 ||
    typeof temporaryPrefix !== 'string' ||
    temporaryPrefix.length === 0 ||
    typeof createIndex !== 'function' ||
    !hasPhysicalPath(root, path.dirname(indexPath))
  ) {
    return { updated: false };
  }
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  if (!hasPhysicalPath(root, path.dirname(indexPath))) return { updated: false };

  const lockPath = `${indexPath}.lock`;
  const lockHandle = await acquireIndexLock(lockPath);
  if (lockHandle === null) return { updated: false };
  try {
    let existing = null;
    if (fs.existsSync(indexPath)) {
      existing = readPhysicalJson(indexPath);
      if (existing === null) return { updated: false };
    }
    if (!isNewerCompletion(candidate, existing)) return { updated: false };

    const index = createIndex();
    if (index === null || typeof index !== 'object') return { updated: false };
    const temporaryPath = path.join(
      path.dirname(indexPath),
      `.${temporaryPrefix}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`,
    );
    fs.writeFileSync(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, indexPath);
    return { updated: true, indexPath: relativeFrom(root, indexPath) };
  } finally {
    await lockHandle.close();
    await fs.promises.rm(lockPath, { force: true });
  }
}
