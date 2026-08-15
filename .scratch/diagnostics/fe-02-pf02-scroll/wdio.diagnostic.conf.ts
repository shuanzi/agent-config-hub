/**
 * PF-02 scroll 双峰噪声诊断 harness 的 WebdriverIO 配置。
 *
 * 本配置独立存在，不依赖 performance/ 下的任何文件；仅负责启动 Vite dev server
 * 并运行同目录 diagnostic.spec.ts。复制官方 PF-02/03 read-surface 的 chrome/vite
 * 参数，但不做 module graph attestation，也不要求 PF_READ_* 环境变量。
 */
import type { Options } from '@wdio/types';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import type {} from 'webdriverio';

let viteServer: ViteDevServer | null = null;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const config = {
  runner: 'local',
  specs: ['./diagnostic.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--window-size=1440,900',
        ],
      },
    },
  ],
  logLevel: 'warn',
  baseUrl: 'http://localhost:1420',
  waitforTimeout: 10000,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  onPrepare: async () => {
    viteServer = await createServer({
      root: repoRoot,
      logLevel: 'warn',
    });
    await viteServer.listen();
  },
  onComplete: async () => {
    await viteServer?.close();
    viteServer = null;
  },
} as Options.Testrunner;
