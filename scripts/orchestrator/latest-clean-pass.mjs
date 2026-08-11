/* global process, setTimeout */
/**
 * 动态 evidence 的稳定入口：只指向已完成、clean 的 ticket pass。
 * 此模块不参与 verdict；调用方写完 manifest 后才可调用。
 */
import fs from 'node:fs';
import path from 'node:path';

function relativeFrom(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? null
    : relative.split(path.sep).join('/');
}

function validProvenance(steps) {
  return (
    Array.isArray(steps) &&
    steps.every(
      (step) =>
        step !== null &&
        typeof step === 'object' &&
        typeof step.id === 'string' &&
        typeof step.layer === 'string' &&
        typeof step.provenance === 'string',
    )
  );
}

function validCompletedAt(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function readPhysicalJson(filePath) {
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

/** 证据与 index 均须位于逐级 lstat 的物理目录中；不得让父目录 symlink 改写写入目标。 */
function hasPhysicalPath(root, target) {
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

function isNewerCompletion(candidate, existing) {
  if (existing === null || typeof existing !== 'object') return true;
  if (!validCompletedAt(existing.completedAt) || typeof existing.runId !== 'string') return false;
  const candidateTime = Date.parse(candidate.completedAt);
  const existingTime = Date.parse(existing.completedAt);
  if (candidateTime !== existingTime) return candidateTime > existingTime;
  // 同一 completedAt 以唯一 runId 作稳定 tie-break，永不回退。
  return candidate.runId > existing.runId;
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
 * `manifest` 唯一在 pass + clean + 本 evidence dir matching + 无污染时前进。
 * 所有拒绝路径不创建目录、不触碰已有 index，因而不能覆盖历史 clean pass。
 */
export async function maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId, manifest }) {
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    manifest.status !== 'pass' ||
    manifest.worktreeDirty !== false ||
    manifest.contamination !== undefined ||
    manifest.scope !== ticketId ||
    manifest.runId !== path.basename(evidenceRoot) ||
    typeof manifest.commit !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(manifest.commit) ||
    typeof manifest.evidenceScope !== 'string' ||
    !validCompletedAt(manifest.completedAt) ||
    !validProvenance(manifest.steps)
  ) {
    return { updated: false };
  }
  const expectedEvidence = path.join(root, '.artifacts', 'verification', ticketId, manifest.runId);
  if (path.resolve(expectedEvidence) !== path.resolve(evidenceRoot)) return { updated: false };
  const absoluteManifestPath = path.join(evidenceRoot, 'manifest.json');
  if (
    !hasPhysicalPath(root, evidenceRoot) ||
    !hasPhysicalPath(root, absoluteManifestPath) ||
    !hasPhysicalPath(root, path.dirname(expectedEvidence))
  ) {
    return { updated: false };
  }
  const writtenManifest = readPhysicalJson(absoluteManifestPath);
  if (writtenManifest === null) return { updated: false };
  if (JSON.stringify(writtenManifest) !== JSON.stringify(manifest)) return { updated: false };
  const manifestPath = relativeFrom(root, absoluteManifestPath);
  if (manifestPath === null) return { updated: false };

  const indexPath = path.join(root, '.artifacts', 'verification', ticketId, 'latest-clean-pass.json');
  if (!hasPhysicalPath(root, path.dirname(indexPath))) return { updated: false };
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const lockPath = `${indexPath}.lock`;
  const lockHandle = await acquireIndexLock(lockPath);
  if (lockHandle === null) return { updated: false };
  try {
    let existing = null;
    if (fs.existsSync(indexPath)) {
      existing = readPhysicalJson(indexPath);
      if (existing === null) {
        // 已损坏的 index 不具可比较完成事实，fail-closed 保留以便人工诊断。
        return { updated: false };
      }
    }
    const candidate = { completedAt: manifest.completedAt, runId: manifest.runId };
    if (!isNewerCompletion(candidate, existing)) return { updated: false };
    const index = {
      schemaVersion: 2,
      ticket: ticketId,
      scope: manifest.scope,
      runId: manifest.runId,
      commit: manifest.commit,
      completedAt: manifest.completedAt,
      manifestPath,
      provenance: {
        evidenceScope: manifest.evidenceScope,
        steps: manifest.steps.map(({ id, layer, provenance }) => ({ id, layer, provenance })),
        statement: '仅指向 overall pass、worktreeDirty=false、runId 与 evidence directory 一致且无 contamination 的实际运行。',
      },
    };
    const temporaryPath = path.join(
      path.dirname(indexPath),
      `.latest-clean-pass-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`,
    );
    fs.writeFileSync(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, indexPath);
    return { updated: true, indexPath: relativeFrom(root, indexPath) };
  } finally {
    await lockHandle.close();
    await fs.promises.rm(lockPath, { force: true });
  }
}
