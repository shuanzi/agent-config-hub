import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';

const ENTRY = '/tests/l2/workbench.html';

async function waitForStable(): Promise<void> {
  await browser.waitUntil(async () => {
    const loaders = await $$('.spin');
    return (await loaders.length) === 0;
  });
}

describe('Prompt management journey', () => {
  it('creates a preset, enables it, shows live content, then switches to another', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);

    // 切换到长期指令视图
    const instructionsTab = await $(
      "//button[contains(@class,'tab')][normalize-space()='长期指令']",
    );
    await instructionsTab.waitForDisplayed();
    await instructionsTab.click();

    const panel = await $('.instructions-panel');
    await panel.waitForDisplayed();

    // 新建第一条预设
    const createButton = await panel.$("//button[normalize-space()='新建预设']");
    await createButton.click();

    const nameInput = await $('#prompt-name');
    await nameInput.setValue('First Prompt');

    const contentInput = await $('#prompt-content');
    await contentInput.setValue('first live body');

    const saveButton = await panel.$("//button[normalize-space()='保存']");
    await saveButton.click();
    await waitForStable();

    const error = await $('.instructions-error');
    if (await error.isExisting()) {
      throw new Error(`Save failed: ${await error.getText()}`);
    }

    // 列表应出现该预设
    const firstRow = await $("//li[contains(.,'First Prompt')]");
    await firstRow.waitForDisplayed();

    // 启用它
    const enableButton = await panel.$("//button[normalize-space()='启用']");
    await enableButton.click();
    await waitForStable();

    // 查看 live 内容
    const viewLiveButton = await panel.$("//button[normalize-space()='查看 live 内容']");
    await viewLiveButton.click();
    await waitForStable();

    const livePre = await $('.live-content-view .source-view');
    await livePre.waitForDisplayed();
    expect(await livePre.getText()).toContain('first live body');

    // 隐藏 live 视图，创建第二条预设
    const hideLiveButton = await panel.$("//button[normalize-space()='隐藏 live 内容']");
    await hideLiveButton.click();

    await createButton.click();
    await nameInput.setValue('Second Prompt');
    await contentInput.setValue('second live body');
    await saveButton.click();
    await waitForStable();

    // 切换到第二条并启用
    const secondRow = await $("//li[contains(.,'Second Prompt')]");
    await secondRow.click();
    await enableButton.click();
    await waitForStable();

    // 验证第一条显示未启用，第二条显示已启用
    const firstEnabled = await firstRow.$('.enabled-badge');
    expect(await firstEnabled.isExisting()).toBe(false);

    const secondEnabled = await secondRow.$('.enabled-badge');
    expect(await secondEnabled.isExisting()).toBe(true);

    // live 内容应更新
    await viewLiveButton.click();
    await waitForStable();
    expect(await livePre.getText()).toContain('second live body');
  });
});
