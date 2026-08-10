import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error runtime verifier module is plain Node ESM.
import { maybeWriteLatestCleanPass } from '../../scripts/orchestrator/latest-clean-pass.mjs';
// @ts-expect-error runtime verifier module is plain Node ESM.
import { makeRunId } from '../../scripts/orchestrator/lib.mjs';

const roots: string[] = [];

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'acm-latest-clean-pass-'));
  roots.push(root);
  const evidenceRoot = join(root, '.artifacts/verification/FE-01/20260810T000000Z');
  const indexPath = join(root, '.artifacts/verification/FE-01/latest-clean-pass.json');
  const manifest = {
    runId: '20260810T000000Z',
    scope: 'FE-01',
    evidenceScope: 'ticket-closure',
    status: 'pass',
    commit: 'a'.repeat(40),
    worktreeDirty: false,
    completedAt: '2026-08-10T00:00:00.000Z',
    steps: [{ id: 'ui', layer: 'L2', provenance: 'L2 mock renderer journey' }],
  };
  return { root, evidenceRoot, indexPath, manifest };
}

function writeManifest(evidenceRoot: string, manifest: object): void {
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(
    join(evidenceRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('latest clean-pass evidence index', () => {
  it('only atomically advances a clean, matching pass and preserves prior index on every ineligible outcome', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    writeManifest(evidenceRoot, manifest);
    expect(
      await maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).toEqual({
      updated: true,
      indexPath: '.artifacts/verification/FE-01/latest-clean-pass.json',
    });
    const clean = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(clean).toMatchObject({
      ticket: 'FE-01',
      scope: 'FE-01',
      runId: manifest.runId,
      commit: manifest.commit,
      manifestPath: '.artifacts/verification/FE-01/20260810T000000Z/manifest.json',
      provenance: { evidenceScope: 'ticket-closure' },
    });

    for (const rejected of [
      { ...manifest, status: 'fail' },
      { ...manifest, status: 'inconclusive' },
      { ...manifest, worktreeDirty: true },
      { ...manifest, contamination: { hits: ['synthetic'] } },
      { ...manifest, runId: 'other-run' },
    ]) {
      expect(
        await maybeWriteLatestCleanPass({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: rejected,
        }),
      ).toEqual({
        updated: false,
      });
      expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toEqual(clean);
    }
    expect(existsSync(indexPath)).toBe(true);
  });

  it('never creates an index for an ineligible or non-physical manifest', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    for (const rejected of [
      { ...manifest, status: 'fail' },
      { ...manifest, status: 'inconclusive' },
      { ...manifest, worktreeDirty: true },
      { ...manifest, contamination: { hits: ['synthetic'] } },
      { ...manifest, runId: 'other-run' },
    ]) {
      writeManifest(evidenceRoot, rejected);
      expect(
        await maybeWriteLatestCleanPass({
          root,
          evidenceRoot,
          ticketId: 'FE-01',
          manifest: rejected,
        }),
      ).toEqual({
        updated: false,
      });
      expect(existsSync(indexPath)).toBe(false);
    }

    writeManifest(evidenceRoot, manifest);
    expect(
      await maybeWriteLatestCleanPass({
        root,
        evidenceRoot,
        ticketId: 'FE-01',
        manifest: { ...manifest, commit: 'b'.repeat(40) },
      }),
    ).toEqual({ updated: false });
    expect(existsSync(indexPath)).toBe(false);
  });

  it('不会由较早完成的 eligible run 覆盖较新的 clean pass，并以完成事实打破同秒顺序', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    const newer = {
      ...manifest,
      runId: '20260810T000001000Z-000',
      completedAt: '2026-08-10T00:00:01.000Z',
    };
    const newerRoot = join(root, '.artifacts/verification/FE-01', newer.runId);
    writeManifest(newerRoot, newer);
    expect(
      await maybeWriteLatestCleanPass({
        root,
        evidenceRoot: newerRoot,
        ticketId: 'FE-01',
        manifest: newer,
      }),
    ).toMatchObject({ updated: true });
    const saved = JSON.parse(readFileSync(indexPath, 'utf8'));

    writeManifest(evidenceRoot, manifest);
    expect(
      await maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest }),
    ).toEqual({
      updated: false,
    });
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toEqual(saved);
  });

  it('生成毫秒与序号绑定的 runId，避免同秒 evidence directory 碰撞', () => {
    const instant = new Date('2026-08-10T00:00:00.000Z');
    const first = makeRunId(instant);
    const second = makeRunId(instant);
    expect(first).not.toEqual(second);
    expect(first).toMatch(/^\d{8}T\d{9}Z-p\d+-\d{3}$/);
  });

  it('不同 process 在同一毫秒生成的 runId 仍唯一', () => {
    const source = `import { makeRunId } from './scripts/orchestrator/lib.mjs'; console.log(makeRunId(new Date('2026-08-10T00:00:00.000Z')));`;
    const one = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const two = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(one.status).toBe(0);
    expect(two.status).toBe(0);
    expect(one.stdout.trim()).not.toEqual(two.stdout.trim());
    expect(one.stdout.trim()).toMatch(/^20260810T000000000Z-p\d+-000$/);
  });

  it('锁被旧 run 短暂持有时等待并重读，使较新完成的 run 最终获胜', async () => {
    const { root, evidenceRoot, indexPath, manifest } = setup();
    const older = { ...manifest, completedAt: '2026-08-10T00:00:00.000Z' };
    const newer = {
      ...manifest,
      runId: '20260810T000001000Z-p123-000',
      completedAt: '2026-08-10T00:00:01.000Z',
    };
    const newerRoot = join(root, '.artifacts/verification/FE-01', newer.runId);
    writeManifest(evidenceRoot, older);
    writeManifest(newerRoot, newer);
    mkdirSync(join(root, '.artifacts/verification/FE-01'), { recursive: true });
    const lockPath = join(root, '.artifacts/verification/FE-01/latest-clean-pass.json.lock');
    writeFileSync(lockPath, 'old run owns lock');
    setTimeout(() => rmSync(lockPath, { force: true }), 5);

    const [olderResult, newerResult] = await Promise.all([
      maybeWriteLatestCleanPass({ root, evidenceRoot, ticketId: 'FE-01', manifest: older }),
      maybeWriteLatestCleanPass({
        root,
        evidenceRoot: newerRoot,
        ticketId: 'FE-01',
        manifest: newer,
      }),
    ]);
    expect(olderResult.updated || newerResult.updated).toBe(true);
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toMatchObject({
      runId: newer.runId,
      completedAt: newer.completedAt,
    });
  });
});
