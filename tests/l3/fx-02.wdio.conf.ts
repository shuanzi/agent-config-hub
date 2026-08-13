/** FE-02 专用 L3 runner：只复制隔离 FX-02 多文件根，绝不配置 Hook 或 write path。 */
import type { Options } from '@wdio/types';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
  specs: ['./fx-02.tracer.test.ts'],
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
    fixtureSandbox = mkdtempSync(join(tmpdir(), 'acm-l3-fx02-'));
    // Catalog identity derives from the direct parent of `native-root`; retain
    // FX-02's fixture identity inside the isolated per-run sandbox.
    const fixtureRoot = join(fixtureSandbox, 'fx-02');
    const nativeRoot = join(fixtureRoot, 'native-root');
    mkdirSync(fixtureRoot);
    cpSync(join(repoRoot, 'fixtures/fx-02/native-root'), nativeRoot, { recursive: true });
    process.env.ACM_NATIVE_ROOT = nativeRoot;
  },
  onComplete: () => {
    if (fixtureSandbox !== null) {
      rmSync(fixtureSandbox, { recursive: true, force: true });
      fixtureSandbox = null;
    }
    delete process.env.ACM_NATIVE_ROOT;
  },
} as Options.Testrunner;
