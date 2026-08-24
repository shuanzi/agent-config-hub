import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('L3 smoke fixture path', () => {
  it('the fixture exists at the repo-relative location', () => {
    expect(existsSync(resolve(repoRoot, 'fixtures/l3/l3-smoke-skills.zip'))).toBe(true);
  });

  it('smoke.tsx does not hardcode a machine-specific absolute path', () => {
    const source = readFileSync(resolve(repoRoot, 'tests/l3/smoke.tsx'), 'utf8');
    expect(source).not.toMatch(/\/Users\/|\/worktrees\//);
    expect(source).toContain('__L3_SMOKE_FIXTURE_ZIP__');
  });

  it('vite.l3.config.ts injects the fixture path resolved from the repo root', () => {
    const source = readFileSync(resolve(repoRoot, 'vite.l3.config.ts'), 'utf8');
    expect(source).toContain('__L3_SMOKE_FIXTURE_ZIP__');
    expect(source).toContain('fixtures/l3/l3-smoke-skills.zip');
  });
});
