import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error runtime verifier helper is a plain Node ESM module.
import { maybeAdvancePhysicalJsonIndex } from '../../scripts/orchestrator/clean-evidence-index.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('shared clean evidence index safety', () => {
  it('仅以 physical regular index 原子前进，拒绝 symlink 且不会覆盖已有事实', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acm-clean-evidence-index-'));
    roots.push(root);
    const indexDirectory = join(root, '.artifacts/verification/FE-01');
    const indexPath = join(indexDirectory, 'latest.json');
    mkdirSync(indexDirectory, { recursive: true });

    await expect(
      maybeAdvancePhysicalJsonIndex({
        root,
        indexPath,
        candidate: { completedAt: '2026-08-11T01:00:00.000Z', runId: 'later' },
        temporaryPrefix: 'latest',
        createIndex: () => ({ completedAt: '2026-08-11T01:00:00.000Z', runId: 'later' }),
      }),
    ).resolves.toEqual({ updated: true, indexPath: '.artifacts/verification/FE-01/latest.json' });

    await expect(
      maybeAdvancePhysicalJsonIndex({
        root,
        indexPath,
        candidate: { completedAt: '2026-08-11T00:00:00.000Z', runId: 'earlier' },
        temporaryPrefix: 'latest',
        createIndex: () => ({ completedAt: '2026-08-11T00:00:00.000Z', runId: 'earlier' }),
      }),
    ).resolves.toEqual({ updated: false });
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))).toMatchObject({ runId: 'later' });

    rmSync(indexPath);
    const physicalIndex = join(root, 'physical-index.json');
    writeFileSync(physicalIndex, '{"runId":"physical"}\n', 'utf8');
    symlinkSync(physicalIndex, indexPath);
    await expect(
      maybeAdvancePhysicalJsonIndex({
        root,
        indexPath,
        candidate: { completedAt: '2026-08-11T02:00:00.000Z', runId: 'forged' },
        temporaryPrefix: 'latest',
        createIndex: () => ({ completedAt: '2026-08-11T02:00:00.000Z', runId: 'forged' }),
      }),
    ).resolves.toEqual({ updated: false });
    expect(existsSync(indexPath)).toBe(true);
    expect(JSON.parse(readFileSync(physicalIndex, 'utf8'))).toMatchObject({ runId: 'physical' });
  });
});
