import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error runtime classifier module is a plain Node ESM module.
import { classifyPf01ViteModuleId } from '../../scripts/orchestrator/lib.mjs';

const roots: string[] = [];

function declaredPackageRoot() {
  const root = mkdtempSync(join(tmpdir(), 'pf01-vite-module-id-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      dependencies: { react: '18.3.1', 'lodash.merge': '4.6.2' },
      devDependencies: { '@scope/package': '1.0.0' },
    }),
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PF-01 Vite module-id package allowlist', () => {
  it('只把 package.json 明确声明的 package root（含 subpath）视为 external', () => {
    const root = declaredPackageRoot();
    for (const moduleId of [
      'react/jsx-runtime',
      'lodash.merge',
      '@scope/package',
      '@scope/package/subpath',
      'node:fs',
      '\0vite/client',
      '/@id/__x00__vite/client',
    ]) {
      expect(classifyPf01ViteModuleId(moduleId, { repoRoot: root })).toEqual({ kind: 'external' });
    }
  });

  it('只将锁定 plugin-react 的精确 virtual runtime ID（query 标准化后）视为 external', () => {
    const root = declaredPackageRoot();
    for (const moduleId of ['/@react-refresh', '/@react-refresh?v=locked-runtime']) {
      expect(classifyPf01ViteModuleId(moduleId, { repoRoot: root })).toEqual({ kind: 'external' });
    }
  });

  it('unknown/bare/dotted/repo-local/absolute IDs 都进入 candidate 路径，而非静默 external', () => {
    const root = declaredPackageRoot();
    for (const moduleId of [
      'unknown/package',
      'unknown.merge',
      'index.html',
      './src/main.tsx',
      'src/untracked',
      '/tmp/node_modules/evil/index.js',
      '/@fs/tmp/node_modules/evil/index.js',
      '/@react-refresh-evil',
      '/@react-refresh/extra',
      '/@unknown-runtime',
    ]) {
      expect(classifyPf01ViteModuleId(moduleId, { repoRoot: root })).toMatchObject({
        kind: 'candidate',
      });
    }
  });
});
