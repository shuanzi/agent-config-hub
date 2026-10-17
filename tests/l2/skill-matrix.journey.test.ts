import { describe, it } from 'mocha';
import { $, browser, expect } from '@wdio/globals';

describe('Skills matrix scope journey', () => {
  it('uses direct checkboxes and changes only the selected project after review', async () => {
    await browser.setWindowSize(1586, 992);
    await browser.url('/tests/l2/workbench.html?fixture=polished');
    await $("//button[normalize-space()='使用矩阵']").waitForDisplayed();
    await $('[aria-label="配置上下文"] button[title="/workspaces/visual-alpha"]').click();
    const checkbox = $(
      '[aria-label="code-review，同名项目（/workspaces/visual-alpha），Claude Code"]',
    );
    await checkbox.waitForDisplayed();
    expect(await checkbox.isSelected()).toBe(true);
    await checkbox.click();
    await $("//button[normalize-space()='预览变更']").click();
    const apply = $("//button[normalize-space()='应用可执行项（1）']");
    await apply.waitForDisplayed();
    await apply.click();
    await browser.waitUntil(async () => !(await $('[role="dialog"]').isExisting()));
    expect(await checkbox.isSelected()).toBe(false);
    await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
    expect(await $('[aria-label="code-review，全局，Claude Code"]').isSelected()).toBe(true);
    await $('[aria-label="配置上下文"] button[title="/workspaces/visual-beta"]').click();
    expect(
      await $(
        '[aria-label="code-review，同名项目（/workspaces/visual-beta），Claude Code"]',
      ).isSelected(),
    ).toBe(true);
    const codex = $('[aria-label="code-review，同名项目（/workspaces/visual-beta），Codex"]');
    expect(await codex.isSelected()).toBe(true);
    expect(await codex.isEnabled()).toBe(true);
    await $('[aria-label="code-review，Codex，查看生效说明"]').click();
    expect(await $('[role="dialog"]').getText()).toContain('启动 Codex');
    await $('[aria-label="关闭对话框"]').click();
    await codex.click();
    await $("//button[normalize-space()='预览变更']").click();
    await $("//button[normalize-space()='应用可执行项（1）']").click();
    await browser.waitUntil(async () => !(await $('[role="dialog"]').isExisting()));
    await $("//button[normalize-space()='启动 Codex']").click();
    await browser.waitUntil(async () =>
      (await $('[role="dialog"]').getText()).includes('已保存的排除项（1）'),
    );
    expect(await $('[role="dialog"]').getText()).toContain('/workspaces/visual-beta');
    await $("//button[normalize-space()='在终端启动']").click();
    await browser.waitUntil(async () => !(await $('[role="dialog"]').isExisting()));
    expect(await $('.skill-status').getText()).toContain('交给终端');
  });
  it('keeps project drafts through narrow navigation and avoids document overflow with one Agent', async () => {
    await browser.setViewport({ width: 390, height: 844 });
    await browser.url('/tests/l2/workbench.html?fixture=polished&viewport=narrow&step=type');
    await $(
      "//*[@data-workbench-rail='asset-type']//button[normalize-space()='Skills']",
    ).waitForDisplayed();
    await $("//*[@data-workbench-rail='asset-type']//button[normalize-space()='Skills']").click();
    await $('[aria-label="配置上下文"] button[title="/workspaces/visual-alpha"]').click();
    const first = $(
      '[aria-label="code-review，同名项目（/workspaces/visual-alpha），Claude Code"]',
    );
    await first.waitForDisplayed();
    await first.click();
    await $('[aria-label="返回上一步"]').click();
    await $('[aria-label="配置上下文"] button[title="/workspaces/visual-beta"]').click();
    const second = $(
      '[aria-label="code-review，同名项目（/workspaces/visual-beta），Claude Code"]',
    );
    await second.waitForDisplayed();
    expect(await second.isSelected()).toBe(true);
    expect(await $('.matrix-draft-bar').getText()).toContain('1 项待应用');
    await $('[aria-label="返回上一步"]').click();
    await $('[aria-label="配置上下文"] button[title="/workspaces/visual-alpha"]').click();
    const returned = $(
      '[aria-label="code-review，同名项目（/workspaces/visual-alpha），Claude Code"]',
    );
    await returned.waitForDisplayed();
    expect(await returned.isSelected()).toBe(false);
    await $('[aria-label="筛选矩阵 Agent"]').selectByAttribute('value', 'codex');
    const bounds = await browser.execute(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
    }));
    expect(bounds.width).toBeLessThanOrEqual(bounds.viewport);
  });
});
