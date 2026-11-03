import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';

const ENTRY = '/tests/l2/workbench.html';

async function waitForStable(): Promise<void> {
  await browser.waitUntil(async () => {
    const loaders = await $$('.spin');
    return (await loaders.length) === 0;
  });
}

describe('Skill management journey', () => {
  it('lands on installed view, discovers, installs, withdraws one placement and uninstalls', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $("//button[normalize-space()='目录与维护']").waitForDisplayed();
    await $("//button[normalize-space()='目录与维护']").click();

    // 默认落地 Skills 已安装视图
    await $('.skills-view').waitForDisplayed();
    expect(await $('.sub-tab.active').getText()).toContain('已安装');

    // 默认「全部」不是 mutation target；先进入全局配置再执行安装旅程。
    await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
    await waitForStable();

    // 切换到发现页签
    const discoveryTab = await $("//button[contains(@class,'sub-tab')][normalize-space()='发现']");
    await discoveryTab.click();
    await waitForStable();

    // 搜索并安装
    const searchInput = await $('#skill-discovery-search');
    await searchInput.setValue('commit');

    const discoveryRow = await $("[data-skill-key='anthropics/skills:commit-conventions']");
    await discoveryRow.$('.skill-row-select').click();
    const discoveryDetail = await $("[data-skill-detail='anthropics/skills:commit-conventions']");
    await discoveryDetail.waitForDisplayed();
    const installButton = await discoveryDetail.$(".//button[normalize-space()='安装']");
    await installButton.waitForDisplayed();
    await installButton.click();
    const installDialog = await $("[role='dialog']");
    await installDialog.waitForDisplayed();
    await installDialog.$(".//input[@type='radio' and @value='codex']").click();
    await installDialog.$(".//button[normalize-space()='确认安装']").click();

    // 等待安装完成并切换回已安装视图
    await browser.waitUntil(async () => (await (await $$('.spin')).length) === 0);
    const installedTab = await $(
      "//button[contains(@class,'sub-tab')][normalize-space()='已安装']",
    );
    await installedTab.click();
    await waitForStable();

    await $("//button[normalize-space()='目录与维护']").click();
    const installedCard = await $("[data-skill-id='anthropics/skills:commit-conventions']");
    await installedCard.waitForDisplayed();
    expect(await installedCard.$('.skill-card-title').getText()).toContain('Commit Conventions');
    await installedCard.$('.skill-row-select').click();

    const installedDetail = await $("[data-skill-detail='anthropics/skills:commit-conventions']");
    await installedDetail.waitForDisplayed();

    // 撤回 Codex 目录投放；这只改变该目录，不表达 Agent 使用权限。
    const codexToggle = await installedDetail.$(
      ".//div[contains(@class,'skill-placement-row')][contains(.,'Codex')]//input",
    );
    expect(await codexToggle.isSelected()).toBe(true);
    await codexToggle.click();
    await browser.waitUntil(async () => (await codexToggle.isSelected()) === false);

    // 卸载
    const uninstallButton = await installedDetail.$(".//button[normalize-space()='卸载']");
    await uninstallButton.click();
    const uninstallDialog = await $("[role='dialog']");
    await uninstallDialog.waitForDisplayed();
    expect(await uninstallDialog.$('h2').getText()).toBe('确认卸载');
    await uninstallDialog.$(".//button[normalize-space()='卸载']").click();
    await browser.waitUntil(
      async () =>
        (await $("[data-skill-id='anthropics/skills:commit-conventions']").isExisting()) === false,
    );

    // 验证回到空状态提示
    expect(await $('.skill-empty h3').getText()).toContain('尚未安装');
  });

  it('uses the visual fixture for installed detail update, placement and uninstall paths', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(`${ENTRY}?fixture=visual`);
    await $("//button[normalize-space()='目录与维护']").waitForDisplayed();
    await $("//button[normalize-space()='目录与维护']").click();
    await waitForStable();

    // 更新和写操作必须具有明确 target；视觉 fixture 的 Testing Strategy 属于全局目标。
    await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
    await waitForStable();

    const installedRows = await $$('.skill-list [data-skill-id]');
    expect(await installedRows.length).toBe(2);

    const checkUpdates = await $("//button[normalize-space()='检查更新']");
    await checkUpdates.click();
    await waitForStable();

    const installedRow = await $("[data-skill-id='anthropics/skills:testing-strategy']");
    const actionBounds = await browser.execute(() => {
      const actionCell = document.querySelector<HTMLElement>(
        "[data-skill-id='anthropics/skills:testing-strategy'] .skill-row-actions",
      );
      if (actionCell === null) return { cellLeft: Number.NaN, cellRight: Number.NaN, controls: [] };
      const cellRect = actionCell.getBoundingClientRect();
      const controls = Array.from(actionCell.querySelectorAll<HTMLElement>('button')).map(
        (control) => {
          const rect = control.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        },
      );
      return { cellLeft: cellRect.left, cellRight: cellRect.right, controls };
    });
    expect(actionBounds.controls.length).toBe(2);
    for (const control of actionBounds.controls) {
      expect(control.left).toBeGreaterThanOrEqual(actionBounds.cellLeft - 1);
      expect(control.right).toBeLessThanOrEqual(actionBounds.cellRight + 1);
    }
    await installedRow.$('.skill-row-select').click();
    const detail = await $("[data-skill-detail='anthropics/skills:testing-strategy']");
    await detail.waitForDisplayed();

    const updateButton = await detail.$(".//button[normalize-space()='更新']");
    await updateButton.waitForDisplayed();
    await updateButton.click();
    await browser.waitUntil(async () => (await $('.skill-status').getText()).includes('已更新'));

    const codexToggle = await detail.$(
      ".//div[contains(@class,'skill-placement-row')][contains(.,'Codex')]//input",
    );
    expect(await codexToggle.isSelected()).toBe(true);
    await codexToggle.click();
    await browser.waitUntil(async () => (await codexToggle.isSelected()) === false);

    const uninstallButton = await detail.$(".//button[normalize-space()='卸载']");
    await uninstallButton.click();
    const uninstallDialog = await $("[role='dialog']");
    await uninstallDialog.waitForDisplayed();
    await uninstallDialog.$(".//button[normalize-space()='卸载']").click();
    await browser.waitUntil(
      async () =>
        (await $("[data-skill-id='anthropics/skills:testing-strategy']").isExisting()) === false,
    );
  });

  it('shows all five global placement directories without horizontal clipping on a narrow viewport', async () => {
    await browser.setViewport({ width: 390, height: 844 });
    await browser.url(`${ENTRY}?fixture=visual&viewport=narrow`);
    await waitForStable();
    await $("//*[@data-workbench-rail='asset-type']//button[normalize-space()='Skills']").click();
    await $("[data-workbench-rail='context']").waitForDisplayed();
    await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
    await waitForStable();

    await $("//button[normalize-space()='目录与维护']").click();
    const row = await $("[data-skill-id='anthropics/skills:testing-strategy']");
    await row.$('.skill-row-select').click();
    const detail = await $("[data-skill-detail='anthropics/skills:testing-strategy']");
    await detail.waitForDisplayed();

    expect((await detail.$$('.skill-placement-row')).length).toBe(5);
    expect(await detail.getText()).toContain('/Users/mock/.agents/skills');
    const overflow = await browser.execute(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
