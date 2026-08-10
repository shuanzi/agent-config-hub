/** FE-07R L3：bare WebView → production gateway → IPC → Rust/core/disk actual-read。 */
import { describe, it } from 'mocha';
import { browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

interface Fx19Outcome {
  passed: string[];
  error: string | null;
}

describe('FX-19 L3 bare actual-read tracer', () => {
  it('通过真实 WebView/IPC/Rust/core 读取隔离 fixture 并 fail-closed 投影', async () => {
    const currentUrl = await browser.getUrl();
    await browser.url(new URL('tests/l3/fx19.html', currentUrl).toString());
    await browser.waitUntil(
      async () => browser.execute(() => typeof window.__runFx19ActualRead === 'function'),
      { timeout: 30000, timeoutMsg: 'FX-19 bare entry 未暴露 actual-read runner' },
    );
    const outcome = await browser.execute(async (): Promise<Fx19Outcome> => {
      const run = window.__runFx19ActualRead;
      return run === undefined ? { passed: [], error: 'runner 未定义' } : run();
    });
    expect(outcome.error).toBe(null);
    expect(outcome.passed).toEqual([
      'all/global findings',
      'resolved global ownership',
      'bound provenance drift',
      'fail-closed project exclusion',
      'opaque identity and provenance',
    ]);
  });
});
