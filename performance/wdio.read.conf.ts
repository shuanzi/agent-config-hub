/**
 * PF-02/PF-03 只读 read-surface L2 WebdriverIO 配置。
 *
 * 与 PF-01 config 隔离：仅启动 Vite mock renderer 与 pf-read spec，不导入
 * PF-01 的额外测量语义。descriptor/profile/output 均由 read runner
 * 显式注入；缺少 descriptor 立即 fail-closed。
 */
import type { Options } from '@wdio/types';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
// @ts-expect-error runtime verifier module is a plain Node ESM module.
import * as pfReadMeasurementInputs from '../scripts/orchestrator/pf-read-measurement-inputs.mjs';
import type {} from 'webdriverio';

const descriptorId = process.env.PF_READ_DESCRIPTOR_ID;
if (descriptorId !== 'PF-02' && descriptorId !== 'PF-03') {
  throw new Error('PF_READ_DESCRIPTOR_ID 必须为 PF-02 或 PF-03');
}
const profile = process.env.PF_READ_PROFILE;
if (profile !== 'representative' && profile !== 'stress') {
  throw new Error('PF_READ_PROFILE 必须为 representative 或 stress');
}
if (process.env.PF_READ_OUTPUT_DIR?.trim() === '') {
  throw new Error('PF_READ_OUTPUT_DIR 不得为空字符串');
}
if (process.env.PF_READ_OUTPUT_DIR === undefined) {
  throw new Error('PF_READ_OUTPUT_DIR 未指定');
}

let viteServer: ViteDevServer | null = null;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  runner: 'local',
  specs: ['./pf-read.collector.test.ts'],
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
      if (viteServer === null) throw new Error('PF read L2 Vite module graph unavailable');
      const modulePaths = pfReadMeasurementInputs.normalizePfReadL2ViteModuleGraphCandidates({
        moduleIds: [...viteServer.moduleGraph.idToModuleMap.keys()],
        repoRoot,
      });
      const l2DevModuleGraph = pfReadMeasurementInputs.attestPfReadL2ViteModuleGraph({
        moduleIds: modulePaths.map((modulePath: string) => path.join(repoRoot, modulePath)),
        repoRoot,
      });
      writeFileSync(
        path.join(process.env.PF_READ_OUTPUT_DIR as string, 'l2-dev-module-graph.json'),
        `${JSON.stringify(l2DevModuleGraph, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
    } finally {
      await viteServer?.close();
      viteServer = null;
    }
  },
} as Options.Testrunner;
