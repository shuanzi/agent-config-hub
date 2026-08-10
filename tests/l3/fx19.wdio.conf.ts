/** FE-07R 专用 L3 runner；仅复制 FX-19 到临时根，绝不读取真实用户目录。 */
import type { Options } from '@wdio/types';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {} from 'webdriverio';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const appBinary = join(repoRoot, 'src-tauri/target/debug/agent-config-manager');

let fixtureSandbox: string | null = null;

export const config = {
  runner: 'local',
  specs: ['./fx19.tracer.test.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': { application: appBinary },
    },
  ],
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath: appBinary,
        driverProvider: 'embedded',
      },
    ],
  ],
  logLevel: 'warn',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120000 },
  onPrepare: () => {
    fixtureSandbox = mkdtempSync(join(tmpdir(), 'acm-l3-fx19-'));
    const fixtureRoot = join(fixtureSandbox, 'fx-19');
    cpSync(join(repoRoot, 'fixtures/fx-19'), fixtureRoot, { recursive: true });
    process.env.ACM_FX19_ROOT = fixtureRoot;
  },
  onComplete: () => {
    if (fixtureSandbox !== null) {
      rmSync(fixtureSandbox, { recursive: true, force: true });
      fixtureSandbox = null;
    }
    delete process.env.ACM_FX19_ROOT;
  },
} as Options.Testrunner;
