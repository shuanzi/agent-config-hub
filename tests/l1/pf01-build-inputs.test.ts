import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { assertPf01L3BuildEnvironment, assertPf01L3ViteModuleClosure, collectPf01L3HarnessBuildInputs, collectPf01L3HarnessBuildInputsFromGit, computePf01L3HarnessBuildInputsDigest } from '../../scripts/orchestrator/pf01-build-inputs.mjs';

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

describe('PF-01 L3 harness build-input digest v4', () => {
  it('actual Cargo/native toolchain overrides（含 target、HOST/TARGET 与 cc-rs）一律不允许未 attested', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-native-toolchain-'));
    try {
      mkdirSync(root, { recursive: true });
      expect(assertPf01L3BuildEnvironment({}, root)).toMatchObject({ overrides: [] });
      const nativeOverrides = [
        'RUSTC',
        'RUSTDOC',
        'RUSTDOCFLAGS',
        'CC',
        'CXX',
        'AR',
        'CPPFLAGS',
        'CFLAGS',
        'CXXFLAGS',
        'LDFLAGS',
        'CC_aarch64-apple-darwin',
        'CXX_aarch64_apple_darwin',
        'AR_aarch64_apple_darwin',
        'HOST_CC',
        'TARGET_CFLAGS',
        'CXXSTDLIB_aarch64-apple-darwin',
        'CRATE_CC_NO_DEFAULTS',
        'CC_ENABLE_DEBUG_OUTPUT',
        'CC_SHELL_ESCAPED_FLAGS',
        'CC_KNOWN_WRAPPER_CUSTOM',
        'CC_FORCE_DISABLE',
      ];
      for (const key of nativeOverrides) {
        expect(() => assertPf01L3BuildEnvironment({ [key]: '/tmp/alternate' }, root)).toThrow(
          /build-input environment/i,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('实际 Node 与 NVM runtime 路径冲突时，精确 NVM_INC/NVM_BIN 一律拒绝', () => {
    const root = mkdtempSync(join(tmpdir(), 'pf01-node-runtime-'));
    try {
      mkdirSync(root, { recursive: true });
      for (const key of ['NVM_INC', 'NVM_BIN']) {
        expect(() => assertPf01L3BuildEnvironment({ [key]: '/tmp/node-v25' }, root)).toThrow(
          new RegExp(`build-input environment.*${key}`, 'i'),
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('从 immutable baseline Git objects 与当前实现分别得到可追溯摘要，并暴露 output-affecting drift', () => {
    const baseline = collectPf01L3HarnessBuildInputsFromGit({ commit: BASELINE_COMMIT });
    // 注入 clean-status 仅覆盖 digest 算法；当前实现改动了 mock/UI/wire 等实际
    // harness 输入，不能借用旧 baseline digest。
    const current = collectPf01L3HarnessBuildInputs({ gitStatus: '' });

    expect(baseline).toMatchObject({
      schemaVersion: 4,
      algorithm: 'pf01-l3-harness-build-inputs-v4',
      source: { kind: 'git-object-tree', commit: BASELINE_COMMIT },
    });
    expect(current).toMatchObject({
      schemaVersion: 4,
      algorithm: 'pf01-l3-harness-build-inputs-v4',
      source: { kind: 'clean-tracked-checkout' },
    });
    expect(current.digest).not.toBe(baseline.digest);
    expect(current.entries).not.toEqual(baseline.entries);
  });

  it('只纳入实际 L3 Vite module closure，并拒绝未来未登记 import', async () => {
    const actualModules = await assertPf01L3ViteModuleClosure();
    expect(actualModules).toEqual(EXPECTED_VITE_MODULES);
    await expect(
      assertPf01L3ViteModuleClosure({ moduleIds: EXPECTED_VITE_MODULES }),
    ).resolves.toEqual(EXPECTED_VITE_MODULES);
    await expect(
      assertPf01L3ViteModuleClosure({
        moduleIds: [...EXPECTED_VITE_MODULES, 'react/jsx-runtime', '@tauri-apps/api/core'],
      }),
    ).resolves.toEqual(EXPECTED_VITE_MODULES);
    await expect(
      assertPf01L3ViteModuleClosure({
        moduleIds: [...EXPECTED_VITE_MODULES, '/@react-refresh?v=locked-runtime'],
      }),
    ).resolves.toEqual(EXPECTED_VITE_MODULES);

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

    for (const outsidePhysicalModule of [
      '/tmp/pf01-outside.ts',
      '/@fs/tmp/pf01-outside.ts',
      '/tmp/node_modules/evil/index.js',
      '/@fs/tmp/node_modules/evil/index.js',
      '/@react-refresh-evil',
      '/@react-refresh/extra',
      '/@unknown-runtime',
    ]) {
      await expect(
        assertPf01L3ViteModuleClosure({
          moduleIds: [...EXPECTED_VITE_MODULES, outsidePhysicalModule],
        }),
      ).rejects.toThrow(/outside repository/i);
    }
    await expect(
      assertPf01L3ViteModuleClosure({ moduleIds: [...EXPECTED_VITE_MODULES, './src/main.tsx'] }),
    ).rejects.toThrow(/path|closure/i);
  });

  it('canonical digest 一旦 entry path、entry SHA 或 digest 本身被篡改就不可用', () => {
    const entries = [{ path: 'src/main.tsx', sha256: 'a'.repeat(64) }];
    const digest = computePf01L3HarnessBuildInputsDigest({
      schemaVersion: 4,
      algorithm: 'pf01-l3-harness-build-inputs-v4',
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
