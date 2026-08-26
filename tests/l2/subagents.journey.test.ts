import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';

const ENTRY = '/tests/l2/workbench.html';

async function waitForStable(): Promise<void> {
  await browser.waitUntil(async () => {
    const loaders = await $$('.spin');
    return (await loaders.length) === 0;
  });
}

describe('Subagent management journey', () => {
  it('navigates to subagents, discovers, installs, toggles agent and uninstalls', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);

    // 切换到 Subagents 视图
    const subagentsTab = await $(
      "//*[@data-workbench-rail='asset-type']//button[normalize-space()='Subagents']",
    );
    await subagentsTab.waitForDisplayed();
    await subagentsTab.click();
    await waitForStable();

    // 「全部」不能作为 mutation target；先选择全局配置执行安装旅程。
    await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
    await waitForStable();

    expect(await $('.sub-tab.active').getText()).toContain('已安装');

    // 切换到发现页签
    const discoveryTab = await $("//button[contains(@class,'sub-tab')][normalize-space()='发现']");
    await discoveryTab.click();
    await waitForStable();

    // 搜索并安装
    const searchInput = await $('#subagent-discovery-search');
    await searchInput.setValue('pr');

    const discoveryRow = await $("[data-subagent-key='anthropics/subagents:pr-reviewer']");
    await discoveryRow.$('.subagent-list-row-select').click();
    const discoveryDetail = await $(
      "[data-subagent-detail-key='anthropics/subagents:pr-reviewer']",
    );
    await discoveryDetail.waitForDisplayed();
    const installButton = await discoveryDetail.$(".//button[normalize-space()='安装']");
    await installButton.waitForDisplayed();
    await installButton.click();

    // 等待安装完成并切换回已安装视图
    await browser.waitUntil(async () => (await (await $$('.spin')).length) === 0);
    const installedTab = await $(
      "//button[contains(@class,'sub-tab')][normalize-space()='已安装']",
    );
    await installedTab.click();
    await waitForStable();

    const installedCard = await $("[data-subagent-list-id='anthropics/subagents:pr-reviewer']");
    await installedCard.waitForDisplayed();
    expect(await installedCard.$('.skill-card-title').getText()).toContain('PR Reviewer');
    await installedCard.$('.subagent-list-row-select').click();

    const installedDetail = await $("[data-subagent-detail-id='anthropics/subagents:pr-reviewer']");
    await installedDetail.waitForDisplayed();

    // 切换 Codex 启用开关
    const codexToggle = await installedDetail.$(".//label[contains(@title,'Codex')]//input");
    const wasChecked = await codexToggle.isSelected();
    await codexToggle.click();
    await browser.waitUntil(async () => (await codexToggle.isSelected()) === !wasChecked);

    // 卸载
    const uninstallButton = await installedDetail.$(".//button[normalize-space()='卸载']");
    await uninstallButton.click();
    const uninstallDialog = await $("[role='dialog']");
    await uninstallDialog.waitForDisplayed();
    expect(await uninstallDialog.$('h2').getText()).toBe('确认卸载');
    await uninstallDialog.$(".//button[normalize-space()='卸载']").click();
    await browser.waitUntil(
      async () =>
        (await $("[data-subagent-list-id='anthropics/subagents:pr-reviewer']").isExisting()) ===
        false,
    );

    // 验证回到空状态提示
    expect(await $('.subagent-empty h3').getText()).toContain('尚未安装');
  });

  it('uses the visual fixture for installed detail update', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    const subagentsTab = await $(
      "//*[@data-workbench-rail='asset-type']//button[normalize-space()='Subagents']",
    );
    await subagentsTab.click();
    await waitForStable();

    // fixture 中 PR Reviewer 是全局记录，更新前先具备明确操作目标。
    await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
    await waitForStable();

    const checkUpdates = await $("//button[normalize-space()='检查更新']");
    await checkUpdates.click();
    await browser.waitUntil(async () =>
      (await $('.subagent-status-message').getText()).includes('发现 1 个可更新的 Subagent。'),
    );

    const installedRow = await $("[data-subagent-list-id='anthropics/subagents:pr-reviewer']");
    await installedRow.$('.subagent-list-row-select').click();
    const detail = await $("[data-subagent-detail-id='anthropics/subagents:pr-reviewer']");
    await detail.waitForDisplayed();

    const updateButton = await detail.$(".//button[normalize-space()='更新']");
    await updateButton.waitForDisplayed();
    await updateButton.click();

    await browser.waitUntil(async () =>
      (await $('.subagent-status-message').getText()).includes('已更新 PR Reviewer。'),
    );
    expect(
      await browser.execute(() => window.__ACM_MOCK_STATE__?.subagentUpdates.length ?? -1),
    ).toBe(0);
  });
});
