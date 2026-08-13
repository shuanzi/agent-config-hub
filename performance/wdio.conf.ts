/**
 * PF-01 perf WebdriverIO 配置：headless Chrome + Vite programmatic dev server
 * （与 tests/l2 同一入口与端口；测试入口 ?scenario=perf-catalog）。
 * 采样数据由 spec 进程写入 process.env.PF01_OUTPUT_DIR。
 */
import type { Options } from '@wdio/types';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import { attestPf01L2ViteDevModuleGraph } from '../scripts/orchestrator/pf01-measurement-inputs.mjs';
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
    try {
      const outputDir = process.env.PF01_OUTPUT_DIR;
      if (outputDir === undefined || viteServer === null) {
        throw new Error('PF-01 L2 Vite dev module graph evidence unavailable');
      }
      // ModuleGraph 仅在本 config 的 createServer 及真实浏览器采样完成后读取；
      // virtual/external id 的稳定排除、repo physical path 与 exact closure 均由
      // 公共 attestation seam fail-closed 验证。
      const l2DevModuleGraph = attestPf01L2ViteDevModuleGraph({
        moduleIds: [...viteServer.moduleGraph.idToModuleMap.keys()],
      });
      writeFileSync(
        join(outputDir, 'l2-dev-module-graph.json'),
        `${JSON.stringify(l2DevModuleGraph, null, 2)}\n`,
        'utf8',
      );
    } finally {
      await viteServer?.close();
      viteServer = null;
    }
  },
} as Options.Testrunner;
