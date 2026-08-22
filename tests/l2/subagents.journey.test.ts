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
    const subagentsTab = await $("//button[contains(@class,'tab')][normalize-space()='Subagents']");
    await subagentsTab.waitForDisplayed();
    await subagentsTab.click();
    await waitForStable();

    expect(await $('.sub-tab.active').getText()).toContain('已安装');

    // 切换到发现页签
    const discoveryTab = await $("//button[contains(@class,'sub-tab')][normalize-space()='发现']");
    await discoveryTab.click();
    await waitForStable();

    // 搜索并安装
    const searchInput = await $('#subagent-discovery-search');
    await searchInput.setValue('pr');

    const installButton = await $(
      "[data-subagent-key='anthropics/subagents:pr-reviewer'] button.install",
    );
    await installButton.waitForDisplayed();
    await installButton.click();

    // 等待安装完成并切换回已安装视图
    await browser.waitUntil(async () => (await (await $$('.spin')).length) === 0);
    const installedTab = await $(
      "//button[contains(@class,'sub-tab')][normalize-space()='已安装']",
    );
    await installedTab.click();
    await waitForStable();

    const installedCard = await $("[data-subagent-id='anthropics/subagents:pr-reviewer']");
    await installedCard.waitForDisplayed();
    expect(await installedCard.$('.skill-card-title').getText()).toContain('PR Reviewer');

    // 切换 Codex 启用开关
    const codexToggle = await installedCard.$("//label[contains(text(),'Codex')]//input");
    const wasChecked = await codexToggle.isSelected();
    await codexToggle.click();
    await browser.waitUntil(async () => (await codexToggle.isSelected()) === !wasChecked);

    // 卸载
    const uninstallButton = await installedCard.$('button.uninstall');
    await uninstallButton.click();
    await browser.waitUntil(
      async () =>
        (await $("[data-subagent-id='anthropics/subagents:pr-reviewer']").isExisting()) === false,
    );

    // 验证回到空状态提示
    expect(await $('.subagent-empty h3').getText()).toContain('尚未安装');
  });
});
