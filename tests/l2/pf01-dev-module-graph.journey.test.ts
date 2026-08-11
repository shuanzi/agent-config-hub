/**
 * 非采样的 PF-01 dev-server graph probe。
 * 它由开发态命令以 performance/wdio.conf.ts + --spec 单独运行，证明该 config
 * 的真实 createServer/browser 生命周期会在 onComplete 生成可验证的 graph evidence；
 * 不执行 performance/pf-01.perf.test.ts，不写 samples，也不生成 baseline/comparison。
 */
import { $, browser } from '@wdio/globals';
import { describe, it } from 'mocha';
import type {} from 'webdriverio';

describe('PF-01 actual Vite dev module graph probe', () => {
  it('loads the performance catalog browser entry before lifecycle evidence is captured', async () => {
    await browser.url('/tests/l2/workbench.html?scenario=perf-catalog');
    await $('.workbench').waitForDisplayed();
    await $('[role="option"]').waitForDisplayed();
  });
});
