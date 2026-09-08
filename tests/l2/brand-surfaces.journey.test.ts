import { describe, it } from 'mocha';
import { $, browser, expect } from '@wdio/globals';
import { mkdir } from 'node:fs/promises';

describe('共享品牌入口视觉回归', () => {
  for (const [width, height] of [
    [1586, 992],
    [1280, 800],
    [390, 844],
  ]) {
    it(`${width} Skills、长期指令与添加项目`, async () => {
      await browser.setViewport({ width, height, devicePixelRatio: 1 });
      await browser.url('/tests/l2/workbench.html?fixture=visual');
      await $('[data-workbench-rail="asset-type"]').waitForDisplayed();
      await $("//*[@data-workbench-rail='asset-type']//button[normalize-space()='Skills']").click();
      await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
      await $('.skill-count-bar').waitForDisplayed();
      const marks = await browser.execute(() =>
        [...document.querySelectorAll<HTMLImageElement>('.skill-count-bar img')].map((image) => {
          const rect = image.getBoundingClientRect();
          const parent = image.parentElement!.getBoundingClientRect();
          return {
            ready: image.complete && image.naturalWidth > 0,
            centered: Math.abs(rect.x + rect.width / 2 - parent.x - parent.width / 2) < 1,
          };
        }),
      );
      expect(marks.length).toBe(4);
      expect(marks.every((mark) => mark.ready && mark.centered)).toBe(true);
      await mkdir('output/playwright', { recursive: true });
      await browser.saveScreenshot(`output/playwright/brands-skills-${width}.png`);

      // Reload to exercise the narrow single-surface navigation from its first step.
      await browser.url('/tests/l2/workbench.html?fixture=visual');
      await $(
        "//*[@data-workbench-rail='asset-type']//button[normalize-space()='长期指令']",
      ).waitForDisplayed();
      await $(
        "//*[@data-workbench-rail='asset-type']//button[normalize-space()='长期指令']",
      ).click();
      await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
      await $('[data-instruction-kind="agents"]').waitForDisplayed();
      await $('[data-instruction-kind="agents"]').click();
      await $('#instruction-document-content').waitForDisplayed();
      expect(await $('.instructions-panel [data-agent-brand="codex"] img').isDisplayed()).toBe(
        true,
      );
      await browser.saveScreenshot(`output/playwright/brands-instructions-${width}.png`);

      await browser.url('/tests/l2/workbench.html?fixture=visual');
      await $(
        "//*[@data-workbench-rail='asset-type']//button[normalize-space()='Skills']",
      ).waitForDisplayed();
      await $("//*[@data-workbench-rail='asset-type']//button[normalize-space()='Skills']").click();
      await $('[aria-label="添加项目"]').waitForDisplayed();
      await $('[aria-label="添加项目"]').click();
      await $('[aria-label="选择项目文件夹"]').waitForDisplayed();
      expect(await browser.execute(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await browser.saveScreenshot(`output/playwright/project-picker-${width}.png`);
    });
  }
});
