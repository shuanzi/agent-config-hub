import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { assertPf01L3ViteModuleClosure, collectPf01L3HarnessBuildInputs, collectPf01L3HarnessBuildInputsFromGit, computePf01L3HarnessBuildInputsDigest } from '../../scripts/orchestrator/pf01-build-inputs.mjs';

const BASELINE_COMMIT = '4fdff98be42065936bcfff462302f033de5d6b4a';

const EXPECTED_VITE_MODULES = [
  'fixtures/fx-01/fixture.json',
  'fixtures/fx-01/native-root/skills/demo-skill/SKILL.md',
  'fixtures/sensitive-masking.ts',
  'index.html',
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
  'tests/contract/frontend-gateway-contract.ts',
  'tests/l3/contract-entry.ts',
  'tests/l3/contract.html',
];

describe('PF-01 L3 harness build-input digest v2', () => {
  it('从 immutable baseline Git objects 与 clean checkout 得到同一版本化输入摘要', () => {
    const baseline = collectPf01L3HarnessBuildInputsFromGit({ commit: BASELINE_COMMIT });
    // 当前 TDD 修改本身不属于 output-affecting input set；这里注入已确认的
    // clean-status，单独的下一例覆盖真实 status 含 untracked 时 fail-closed。
    const current = collectPf01L3HarnessBuildInputs({ gitStatus: '' });

    expect(baseline).toMatchObject({
      schemaVersion: 2,
      algorithm: 'pf01-l3-harness-build-inputs-v2',
      source: { kind: 'git-object-tree', commit: BASELINE_COMMIT },
    });
    expect(current).toMatchObject({
      schemaVersion: 2,
      algorithm: 'pf01-l3-harness-build-inputs-v2',
      source: { kind: 'clean-tracked-checkout' },
    });
    expect(current.digest).toBe(baseline.digest);
    expect(current.entries).toEqual(baseline.entries);
  });

  it('只纳入实际 L3 Vite module closure，并拒绝未来未登记 import', async () => {
    const actualModules = await assertPf01L3ViteModuleClosure();
    expect(actualModules).toEqual(EXPECTED_VITE_MODULES);

    const entries = collectPf01L3HarnessBuildInputs({ gitStatus: '' }).entries.map(
      (entry: { path: string }) => entry.path,
    );
    expect(entries).toEqual(expect.arrayContaining(EXPECTED_VITE_MODULES));
    expect(entries).not.toEqual(
      expect.arrayContaining([
        'vite.config.ts',
        'src/prototypes/full-ui-mock/FullUiMock.tsx',
        'src/session/WorkspaceSession.ts',
        'src/ui/AssetList.tsx',
        'src/ui/DetailPanel.tsx',
        'src/ui/Toolbar.tsx',
        'src/ui/TopNav.tsx',
      ]),
    );

    await expect(
      assertPf01L3ViteModuleClosure({
        moduleIds: [...EXPECTED_VITE_MODULES, 'src/prototypes/full-ui-mock/FullUiMock.tsx'],
      }),
    ).rejects.toThrow(/closure/i);
  });

  it('canonical digest 一旦 entry path、entry SHA 或 digest 本身被篡改就不可用', () => {
    const entries = [{ path: 'src/main.tsx', sha256: 'a'.repeat(64) }];
    const digest = computePf01L3HarnessBuildInputsDigest({
      schemaVersion: 2,
      algorithm: 'pf01-l3-harness-build-inputs-v2',
      entries,
    });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('对 missing、untracked、symlink、outside 与 path collision 一律 fail-closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-build-inputs-'));
    try {
      expect(() =>
        collectPf01L3HarnessBuildInputs({
          repoRoot: root,
          trackedPaths: ['package.json'],
          gitStatus: '',
        }),
      ).toThrow(/missing/i);

      expect(() =>
        collectPf01L3HarnessBuildInputs({
          repoRoot: root,
          trackedPaths: ['package.json'],
          gitStatus: '?? local-only-input\n',
        }),
      ).toThrow(/untracked|clean/i);

      writeFileSync(join(root, 'outside.ts'), 'outside');
      expect(() =>
        collectPf01L3HarnessBuildInputs({
          repoRoot: root,
          trackedPaths: ['../outside.ts'],
          gitStatus: '',
        }),
      ).toThrow(/outside/i);

      writeFileSync(join(root, 'real.ts'), 'export {}');
      symlinkSync(join(root, 'real.ts'), join(root, 'linked.ts'));
      expect(() =>
        collectPf01L3HarnessBuildInputs({
          repoRoot: root,
          trackedPaths: ['linked.ts'],
          gitStatus: '',
        }),
      ).toThrow(/symlink/i);

      expect(() =>
        collectPf01L3HarnessBuildInputs({
          repoRoot: root,
          trackedPaths: ['src/Foo.ts', 'src/foo.ts'],
          gitStatus: '',
        }),
      ).toThrow(/collision/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
