/* global process, setTimeout */
/**
 * FE-01 accepted-with-waiver 的独立稳定入口。
 * 它绝不触碰 latest-clean-pass.json，因后者只代表普通 automated pass。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FE01_PF01_WAIVER_ARTIFACT_SHA256,
  FE01_PF01_WAIVER_PATH,
  FE01_PF01_WAIVER_SHA256,
} from './fe01-pf01-waiver.mjs';
import { hasExactFe01ClosureSteps } from './fe01-ticket-waiver-verdict.mjs';

const WAIVER_PATH = FE01_PF01_WAIVER_PATH;
const PERFORMANCE_COMMIT = '40009202e2e88e946dadf82a71816e10338da639';
const AUTOMATED_EXIT_SOURCE =
  'authorized manual disposition + reproducible raw-samples/frozen-budget comparison; summary.json did not record exitCode/status';
const MANUAL_DISPOSITION_SOURCE =
  '用户授权的 exact FE-01 PF-01 disposition；automated fail/exit 1 由 immutable artifact 的 raw samples 与 frozen budget 重算，非本次 perf sampling。';

function relativeFrom(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? null
    : relative.split(path.sep).join('/');
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

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactArtifactHashes(value) {
  const expected = Object.keys(FE01_PF01_WAIVER_ARTIFACT_SHA256);
  return (
    value !== null &&
    typeof value === 'object' &&
    sameJson(Object.keys(value).sort(), expected) &&
    expected.every((file) => value[file] === FE01_PF01_WAIVER_ARTIFACT_SHA256[file])
  );
}

function exactWaiverManifest(manifest) {
  return (
    manifest?.status === 'accepted-with-waiver' &&
    manifest?.manualDisposition?.status === 'accepted-with-waiver' &&
    manifest?.manualDisposition?.waiverValidation === 'valid' &&
    manifest?.manualDisposition?.waiverPath === WAIVER_PATH &&
    manifest?.manualDisposition?.waiverSha256 === FE01_PF01_WAIVER_SHA256 &&
    manifest?.manualDisposition?.source === MANUAL_DISPOSITION_SOURCE &&
    manifest?.pfAutomaticResult?.status === 'fail' &&
    manifest?.pfAutomaticResult?.exitCode === 1 &&
    manifest?.pfAutomaticResult?.automatedExitCode === 1 &&
    manifest?.pfAutomaticResult?.automatedExitCodeSource === AUTOMATED_EXIT_SOURCE &&
    manifest?.pfAutomaticResult?.runId === '20260811T024255740Z-p14989-000' &&
    manifest?.pfAutomaticResult?.run ===
      '.artifacts/performance/PF-01/20260811T024255740Z-p14989-000' &&
    manifest?.pfAutomaticResult?.commit === PERFORMANCE_COMMIT &&
    manifest?.pfAutomaticResult?.worktreeDirty === false &&
    sameJson(manifest?.pfAutomaticResult?.violation, {
      metric: 'pf01.l3.cold_start.first_snapshot',
      statistic: 'p50',
      observedMs: 612,
      thresholdMs: 610,
      deltaMs: 2,
    }) &&
    manifest?.pfAutomaticResult?.artifactDirectory ===
      '.artifacts/performance/PF-01/20260811T024255740Z-p14989-000' &&
    exactArtifactHashes(manifest?.pfAutomaticResult?.artifactSha256)
  );
}

function isNewerCompletion(candidate, existing) {
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

/** 仅 clean、physical、已验证的 exact FE-01 waiver manifest 可前进此独立 index。 */
export async function maybeWriteLatestCleanAcceptedWithWaiver({
  root,
  evidenceRoot,
  ticketId,
  manifest,
}) {
  if (
    ticketId !== 'FE-01' ||
    manifest === null ||
    typeof manifest !== 'object' ||
    manifest.scope !== ticketId ||
    manifest.worktreeDirty !== false ||
    manifest.contamination !== undefined ||
    manifest.runId !== path.basename(evidenceRoot) ||
    typeof manifest.commit !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(manifest.commit) ||
    typeof manifest.evidenceScope !== 'string' ||
    !validCompletedAt(manifest.completedAt) ||
    !validProvenance(manifest.steps) ||
    !hasExactFe01ClosureSteps(manifest.steps) ||
    !exactWaiverManifest(manifest)
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

  const indexPath = path.join(
    root,
    '.artifacts',
    'verification',
    ticketId,
    'latest-clean-accepted-with-waiver.json',
  );
  if (!hasPhysicalPath(root, path.dirname(indexPath))) return { updated: false };
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const lockHandle = await acquireIndexLock(`${indexPath}.lock`);
  if (lockHandle === null) return { updated: false };
  try {
    let existing = null;
    if (fs.existsSync(indexPath)) {
      existing = readPhysicalJson(indexPath);
      if (existing === null) {
        return { updated: false };
      }
    }
    const candidate = { completedAt: manifest.completedAt, runId: manifest.runId };
    if (!isNewerCompletion(candidate, existing)) return { updated: false };
    const index = {
      schemaVersion: 1,
      ticket: ticketId,
      scope: manifest.scope,
      status: 'accepted-with-waiver',
      runId: manifest.runId,
      commit: manifest.commit,
      completedAt: manifest.completedAt,
      manifestPath,
      manualDisposition: manifest.manualDisposition,
      pfAutomaticResult: manifest.pfAutomaticResult,
      provenance: {
        evidenceScope: manifest.evidenceScope,
        steps: manifest.steps.map(({ id, layer, provenance }) => ({ id, layer, provenance })),
        statement:
          '仅指向 exact FE-01 PF-01 waiver：automated PF fail/exit 1、授权 manual disposition、worktreeDirty=false、runId/manifest directory 一致且无 contamination。',
      },
    };
    const temporaryPath = path.join(
      path.dirname(indexPath),
      `.latest-clean-accepted-with-waiver-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`,
    );
    fs.writeFileSync(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, indexPath);
    return { updated: true, indexPath: relativeFrom(root, indexPath) };
  } finally {
    await lockHandle.close();
    await fs.promises.rm(`${indexPath}.lock`, { force: true });
  }
}
