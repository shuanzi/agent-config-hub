/**
 * PF-01 L3 冷启动采样：process start → first trusted snapshot。
 *
 * Provenance：L3 test-harness debug 构建（非 release-like artifact）。
 * main.rs 进程启动即记录 Instant；首次 `frontend_gateway_read` 成功完成时
 * 记录 elapsed millis；本测试等待列表可见（workspace 可交互、首个可信
 * snapshot 已渲染）后经 test-only command `test_fx01_cold_start_millis`
 * 取回样本。
 *
 * 每次 wdio run 取 1 个样本（tauri service 在 onPrepare 新起 harness 进程）；
 * perf.mjs 串行运行 3 次汇总（embedded provider 下 reloadSession 只换
 * WebDriver session，不重启应用进程，进程级冷启动样本必须跨 run 取得）。
 * 样本追加写入 PF01_OUTPUT_DIR/l3-samples.json，指标名稳定、只含毫秒数值。
 */
import { after, describe, it } from 'mocha';
import { $, browser } from '@wdio/globals';
// 拉入 webdriverio 的全局 WebdriverIO namespace 类型
import type {} from 'webdriverio';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = process.env.PF01_OUTPUT_DIR;
const METRIC = 'pf01.l3.cold_start.first_snapshot';

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: (command: string) => Promise<unknown> } };
  }
}

let sample: number | null = null;

describe('PF-01 L3 冷启动采样（test-harness）', () => {
  it('process start → first trusted snapshot', async () => {
    // workspace 可交互：首屏列表可见意味着首个可信 snapshot 已完成渲染
    await $('.workbench').waitForDisplayed({ timeout: 60000 });
    await $('[role="option"]').waitForDisplayed({ timeout: 60000 });
    const ms = await browser.execute(async () => {
      const tauri = window.__TAURI__;
      if (tauri === undefined) return null;
      return (await tauri.core.invoke('test_fx01_cold_start_millis')) as number | null;
    });
    if (typeof ms !== 'number') {
      throw new Error(`冷启动记点缺失（test_fx01_cold_start_millis 返回 ${String(ms)}）`);
    }
    sample = ms;
  });

  after(() => {
    if (OUTPUT_DIR === undefined || sample === null) return;
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const samplesPath = join(OUTPUT_DIR, 'l3-samples.json');
    const existing = existsSync(samplesPath)
      ? (JSON.parse(readFileSync(samplesPath, 'utf8')) as {
          metrics?: Record<string, { samples?: number[] }>;
        })
      : null;
    const samples = [...(existing?.metrics?.[METRIC]?.samples ?? []), sample];
    const payload = {
      schemaVersion: 1,
      descriptorId: 'PF-01',
      layer: 'L3 test-harness debug（非 release-like artifact）',
      collectedAt: new Date().toISOString(),
      unit: 'ms',
      metrics: {
        [METRIC]: { samples: samples.map((value) => Math.round(value * 1000) / 1000) },
      },
    };
    writeFileSync(samplesPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  });
});
