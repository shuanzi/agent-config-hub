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
  it('lands on installed view, discovers, installs, toggles agent and uninstalls', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);

    // 默认落地 Skills 已安装视图
    await $('.skills-view').waitForDisplayed();
    expect(await $('.sub-tab.active').getText()).toContain('已安装');

    // 切换到发现页签
    const discoveryTab = await $("//button[contains(@class,'sub-tab')][normalize-space()='发现']");
    await discoveryTab.click();
    await waitForStable();

    // 搜索并安装
    const searchInput = await $('#skill-discovery-search');
    await searchInput.setValue('commit');

    const installButton = await $(
      "[data-skill-key='anthropics/skills:commit-conventions'] button.install",
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

    const installedCard = await $("[data-skill-id='anthropics/skills:commit-conventions']");
    await installedCard.waitForDisplayed();
    expect(await installedCard.$('.skill-card-title').getText()).toContain('Commit Conventions');

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
        (await $("[data-skill-id='anthropics/skills:commit-conventions']").isExisting()) === false,
    );

    // 验证回到空状态提示
    expect(await $('.skill-empty h3').getText()).toContain('尚未安装');
  });
});
