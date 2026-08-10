/**
 * FE-01 L3 tracer: isolated FX-01 start → authoritative workbench read →
 * invalidation event → authoritative reread. The test-only command writes only
 * its temporary fixture copy; it is absent from production builds.
 */
import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

// 原始占位明文只允许在隔离 fixture；分段构造避免静态敏感值守卫自我命中。
const SECRET_PLACEHOLDER = ['SYNTHETIC-SECRET', 'demo-skill-0001'].join('-');

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: (command: string) => Promise<unknown> } };
  }
}

describe('FX-01 L3 actual read-session tracer', () => {
  it('start → read → only four read-only Skill cells → event → authoritative reread', async () => {
    await $('.read-only-workbench').waitForDisplayed({ timeout: 60000 });
    const row = await $('[role="option"]');
    await row.waitForDisplayed({ timeout: 30000 });
    expect(await row.getText()).toContain('Demo Skill');

    await row.click();
    expect(await $$('.skill-target-grid article')).toHaveLength(4);
    expect(await $$('.skill-target-cells button')).toHaveLength(0);
    expect(await $$('pre.source-view')).toHaveLength(0);
    const beforeMaskCheck = await browser.execute(() => ({
      bodyText: document.body.innerText,
      bodyHtml: document.body.innerHTML,
    }));
    expect(beforeMaskCheck.bodyText.includes(SECRET_PLACEHOLDER)).toBe(false);
    expect(beforeMaskCheck.bodyHtml.includes(SECRET_PLACEHOLDER)).toBe(false);
    const before = await $('[data-testid="authoritative-revision"]').getText();

    const marker = await browser.execute(() =>
      window.__TAURI__?.core.invoke('test_fx01_external_change'),
    );
    expect(marker).toMatch(/^fx01-external-change-\d+$/);

    await browser.waitUntil(
      async () => (await $('[data-testid="authoritative-revision"]').getText()) !== before,
      { timeout: 30000, timeoutMsg: 'event 后没有发生 authoritative reread' },
    );
    const afterMaskCheck = await browser.execute(() => ({
      bodyText: document.body.innerText,
      bodyHtml: document.body.innerHTML,
    }));
    expect(afterMaskCheck.bodyText.includes(SECRET_PLACEHOLDER)).toBe(false);
    expect(afterMaskCheck.bodyHtml.includes(SECRET_PLACEHOLDER)).toBe(false);
  });
});
