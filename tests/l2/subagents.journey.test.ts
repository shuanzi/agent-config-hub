import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';
import { mkdir } from 'node:fs/promises';

const ENTRY = '/tests/l2/workbench.html';
async function openSubagents() {
  await browser.url(ENTRY);
  const navigation = $(
    "//*[@data-workbench-rail='asset-type']//button[normalize-space()='Subagents']",
  );
  await navigation.waitForDisplayed();
  await navigation.click();
  if (await $('[data-narrow-step="context"]').isExisting()) {
    await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
  }
  await $('.native-row').waitForDisplayed();
}

describe('原生 Subagent 管理旅程', () => {
  it('发现已有定义，接管、编辑、停用、启用、卸载并从备份恢复', async () => {
    await browser.setWindowSize(1280, 900);
    await openSubagents();
    expect(await $$('.native-row').length).toBe(8);
    await $('[data-native-identity="codex:reviewer"]').click();
    const detail = $('[aria-label="reviewer 详情"]');
    await detail.$(".//button[normalize-space()='查看原生源码']").click();
    const editor = $('[aria-label="Subagent 原生源码"]');
    await editor.waitForDisplayed();
    expect(await editor.getAttribute('readonly')).not.toBeNull();
    await detail.$(".//button[normalize-space()='纳入管理']").click();
    await $("//*[@role='dialog']//button[normalize-space()='确认纳入管理']").click();
    await browser.waitUntil(async () => !(await editor.getAttribute('readonly')));
    const content = await editor.getValue();
    await editor.setValue(`${content}\n# Preserved native edit\n`);
    await detail.$(".//button[normalize-space()='保存原生源码']").click();
    await browser.waitUntil(
      async () => !(await detail.$(".//button[normalize-space()='保存原生源码']").isEnabled()),
    );
    await detail.$(".//button[normalize-space()='停用']").click();
    await detail.$(".//button[normalize-space()='启用']").waitForDisplayed();
    await detail.$(".//button[normalize-space()='启用']").click();
    await detail.$(".//button[normalize-space()='停用']").waitForDisplayed();
    expect(await detail.$$('input[type="checkbox"]').length).toBe(0);
    await detail.$(".//button[normalize-space()='卸载']").click();
    await $("//*[@role='dialog']//button[normalize-space()='备份并卸载']").click();
    await browser.waitUntil(async () => (await $$('.native-row').length) === 7);
    await $("//button[normalize-space()='备份恢复']").click();
    const radio = $('.native-backup-item input[type="radio"]');
    await radio.waitForDisplayed();
    await radio.click();
    await $("//button[normalize-space()='确认恢复所选备份']").click();
    await browser.waitUntil(async () => (await $$('.native-row').length) === 8);
    await $("//*[@role='dialog']//button[normalize-space()='关闭']").click();
  });

  it('原生 Codex TOML 安装要求明确目标和 Agent', async () => {
    await browser.setWindowSize(1280, 800);
    await openSubagents();
    await $("//button[contains(@class,'sub-tab')][normalize-space()='发现']").click();
    expect(await $('.subagent-empty').getText()).toContain('先选择发现目标');
    await $('[aria-label="选择 Subagent 发现目标"]').selectByAttribute('value', 'global');
    const row = $('[data-subagent-key="example/agents:reviewer.toml"]');
    await row.waitForDisplayed();
    await row.click();
    await $("//button[normalize-space()='安装']").click();
    const confirm = $("//*[@role='dialog']//button[normalize-space()='确认安装']");
    expect(await confirm.isEnabled()).toBe(false);
    await $("//*[@role='dialog']//input[@value='codex']").click();
    await confirm.click();
    await $('[role="status"]').waitForDisplayed();
    expect(await $('[role="status"]').getText()).toContain('已为 Codex 安装');
  });

  for (const [width, height] of [
    [1586, 992],
    [1280, 800],
    [390, 844],
  ]) {
    it(`${width} 宽度四品牌可见、无横向溢出`, async () => {
      await browser.setViewport({ width, height, devicePixelRatio: 1 });
      await openSubagents();
      if (!(await $('.native-row').isDisplayed())) {
        await $("//button[normalize-space()='全局配置']").click();
      }
      const result = await browser.execute(() => ({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        logos: [...document.querySelectorAll<HTMLImageElement>('.subagent-agent-counts img')].map(
          (image) => ({
            complete: image.complete && image.naturalWidth > 0,
            width: image.getBoundingClientRect().width,
          }),
        ),
      }));
      expect(result.viewportWidth).toBe(width);
      expect(result.viewportHeight).toBe(height);
      expect(result.overflow).toBe(false);
      expect(result.logos.length).toBe(4);
      expect(result.logos.every((logo) => logo.complete && logo.width > 0)).toBe(true);
      await mkdir('output/playwright', { recursive: true });
      await browser.saveScreenshot(`output/playwright/native-subagents-${width}.png`);
      await $('[data-native-identity="codex:reviewer"]').click();
      await $("//button[normalize-space()='查看原生源码']").click();
      await $('[aria-label="Subagent 原生源码"]').waitForDisplayed();
      await browser.saveScreenshot(`output/playwright/native-subagent-detail-${width}.png`);
      await $("//button[contains(@class,'sub-tab')][normalize-space()='发现']").click();
      const target = $('[aria-label="选择 Subagent 发现目标"]');
      if (await target.isExisting()) await target.selectByAttribute('value', 'global');
      await $('[data-subagent-key="example/agents:reviewer.toml"]').waitForDisplayed();
      await $('[data-subagent-key="example/agents:reviewer.toml"]').click();
      await $("//button[normalize-space()='安装']").click();
      const dialogMetrics = await browser.execute(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        logos: document.querySelectorAll('.focused-dialog .agent-brand-mark img').length,
        targets: [
          ...document.querySelectorAll('.focused-dialog .initial-agent-radio-options label'),
        ].map((label) => label.getBoundingClientRect().height),
        closeHeight: document.querySelector('.focused-dialog-close')?.getBoundingClientRect()
          .height,
      }));
      expect(dialogMetrics.overflow).toBe(false);
      expect(dialogMetrics.targets.length).toBe(4);
      if (width === 390) expect(dialogMetrics.targets.every((height) => height >= 44)).toBe(true);
      if (width === 390) expect(dialogMetrics.closeHeight).toBeGreaterThanOrEqual(44);
      await browser.saveScreenshot(`output/playwright/native-subagent-install-${width}.png`);
    });
  }
});
