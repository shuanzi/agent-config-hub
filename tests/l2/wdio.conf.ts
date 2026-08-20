/**
 * L2 WebdriverIO 配置：headless Chrome + Vite programmatic dev server（port 1420）。
 * 测试入口页为 tests/l2/workbench.html（scripted mock 注入）。
 */
import type { Options } from '@wdio/types';
import { createServer, type ViteDevServer } from 'vite';
// 拉入 webdriverio 的全局 WebdriverIO namespace 类型（Capabilities 等）
import type {} from 'webdriverio';

let viteServer: ViteDevServer | null = null;
const forceReducedMotion = process.env.FE10_REDUCED_MOTION === 'reduce';

// 注：@wdio/types 9.30 的 Options.Testrunner 漏声明 `capabilities`（运行时仍读取），
// 故此处用类型断言补齐，不改依赖。
export const config = {
  runner: 'local',
  specs: ['./**/*.test.ts'],
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
          ...(forceReducedMotion ? ['--force-prefers-reduced-motion=reduce'] : []),
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
    timeout: 60000,
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
