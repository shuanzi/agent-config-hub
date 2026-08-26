import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';

const ENTRY = '/tests/l2/workbench.html';

async function waitForStable(): Promise<void> {
  await browser.waitUntil(async () => {
    const loaders = await $$('.spin');
    return (await loaders.length) === 0;
  });
}

async function openInstructionsInContext(contextSelector: string) {
  const instructionsTab = await $(
    "//*[@data-workbench-rail='asset-type']//button[normalize-space()='长期指令']",
  );
  await instructionsTab.waitForDisplayed();
  await instructionsTab.click();
  const contextButton = await $(contextSelector);
  await contextButton.waitForDisplayed();
  await contextButton.click();
  await $('.instructions-panel').waitForDisplayed();
  await waitForStable();
}

describe('长期指令文档管理旅程', () => {
  it('在全局上下文直接编辑 CLAUDE.md，并保留固定 AGENTS.md 行', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    await openInstructionsInContext(
      "//*[@data-workbench-rail='context']//button[normalize-space()='全局配置']",
    );

    const panel = await $('.instructions-panel');
    const claudeRow = await panel.$("button[data-instruction-kind='claude']");
    const agentsRow = await panel.$(
      "button[data-instruction-kind='agents'][data-instruction-target='global']",
    );
    await claudeRow.waitForDisplayed();
    await agentsRow.waitForDisplayed();
    expect(await claudeRow.getText()).toContain('CLAUDE.md');
    expect(await agentsRow.getText()).toContain('AGENTS.md');

    await claudeRow.click();
    const content = await $('#instruction-document-content');
    await content.setValue('# Updated global Claude instructions');
    await (await panel.$("//button[normalize-space()='保存 CLAUDE.md']")).click();
    await waitForStable();

    const status = await panel.$("[role='status']");
    await status.waitForDisplayed();
    expect(await status.getText()).toContain('CLAUDE.md');

    await agentsRow.click();
    expect(await content.getValue()).toBe('');
    expect(await panel.getText()).toContain('未创建');
  });

  it('在项目上下文直接编辑共享 AGENTS.md，Codex 和 OpenCode 使用同一文档', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    await openInstructionsInContext(
      "[data-workbench-rail='context'] [data-project-id='visual-project-alpha']",
    );

    const panel = await $('.instructions-panel');
    const agentsRow = await panel.$(
      "button[data-instruction-kind='agents'][data-instruction-target='project:visual-project-alpha']",
    );
    await agentsRow.click();

    const content = await $('#instruction-document-content');
    expect(await content.getValue()).toContain('Project shared instructions');
    expect(await panel.getText()).toContain('Codex');
    expect(await panel.getText()).toContain('OpenCode');
    expect(await panel.getText()).not.toContain('Gemini');

    await content.setValue('# Updated shared project instructions');
    await (await panel.$("//button[normalize-space()='保存 AGENTS.md']")).click();
    await waitForStable();
    expect(await content.getValue()).toBe('# Updated shared project instructions');
  });

  it('不显示旧的预设、Agent enable 或 Gemini 控件', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    await openInstructionsInContext(
      "//*[@data-workbench-rail='context']//button[normalize-space()='全局配置']",
    );

    const panel = await $('.instructions-panel');
    for (const label of ['新建预设', '从 live 文件导入', '查看 live 内容', '启用']) {
      expect(await panel.$(`//button[normalize-space()='${label}']`).isExisting()).toBe(false);
    }
    expect(await panel.getText()).not.toContain('Gemini');
  });
});
