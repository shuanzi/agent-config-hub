/**
 * 动态 evidence 的稳定入口：只指向已完成、clean 的 ticket pass。
 * 此模块不参与 verdict；调用方写完 manifest 后才可调用。
 */
import path from 'node:path';
import { validateFe01Pf01AutomaticPassManifest } from './fe01-pf01-automatic-pass-validation.mjs';
import {
  hasPhysicalPath,
  maybeAdvancePhysicalJsonIndex,
  readPhysicalJson,
  relativeFrom,
  validCompletedAt,
} from './clean-evidence-index.mjs';

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
    !validProvenance(manifest.steps) ||
    !validateFe01Pf01AutomaticPassManifest({ ticketId, manifest }).valid
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
  return maybeAdvancePhysicalJsonIndex({
    root,
    indexPath,
    candidate: { completedAt: manifest.completedAt, runId: manifest.runId },
    temporaryPrefix: 'latest-clean-pass',
    createIndex: () => ({
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
    }),
  });
}
