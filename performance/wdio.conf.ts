/**
 * PF-01 perf WebdriverIO 配置：headless Chrome + Vite programmatic dev server
 * （与 tests/l2 同一入口与端口；测试入口 ?scenario=perf-catalog）。
 * 采样数据由 spec 进程写入 process.env.PF01_OUTPUT_DIR。
 */
import type { Options } from '@wdio/types';
import { createServer, type ViteDevServer } from 'vite';
// 拉入 webdriverio 的全局 WebdriverIO namespace 类型（Capabilities 等）
import type {} from 'webdriverio';

let viteServer: ViteDevServer | null = null;

// 与 tests/l2/wdio.conf.ts 相同的 Options.Testrunner 类型断言补齐。
export const config = {
  runner: 'local',
  specs: ['./**/*.perf.test.ts'],
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
    viteServer = await createServer({ logLevel: 'warn' });
    await viteServer.listen();
  },
  onComplete: async () => {
    await viteServer?.close();
    viteServer = null;
  },
} as Options.Testrunner;
