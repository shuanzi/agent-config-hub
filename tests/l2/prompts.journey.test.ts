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
  it('全局只显示一个 AGENTS.md，展示双路径并可创建、保存和重新读取', async () => {
    await browser.setViewport({ width: 1280, height: 900, devicePixelRatio: 1 });
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();
    await openInstructionsInContext(
      "//*[@data-workbench-rail='context']//button[normalize-space()='全局配置']",
    );
    const panel = await $('.instructions-panel');
    const agentsRow = await panel.$(
      "button[data-instruction-kind='agents'][data-instruction-target='global']",
    );
    await agentsRow.waitForDisplayed();
    expect((await panel.$$('button[data-instruction-kind]')).length).toBe(1);
    expect(await panel.$("button[data-instruction-kind='claude']").isExisting()).toBe(false);
    expect(await agentsRow.getText()).toContain('未创建');
    await agentsRow.click();
    const paths = await $('.instruction-document-paths');
    expect(await paths.getText()).toContain('/isolated/.codex/AGENTS.md');
    expect(await paths.getText()).toContain('/isolated/.config/opencode/AGENTS.md');
    expect(await paths.getText()).toContain('Agent 是否加载此文件，由其自身机制和配置决定。');
    const content = await $('#instruction-document-content');
    await content.setValue('# Updated global shared instructions');
    await (await panel.$("//button[normalize-space()='保存 AGENTS.md']")).click();
    const status = await panel.$("[role='status']");
    await status.waitForDisplayed();
    expect(await status.getText()).toContain('AGENTS.md 已保存');
    await $("[data-workbench-rail='context'] [data-project-id='visual-project-alpha']").click();
    await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
    await $('#instruction-document-content').waitForDisplayed();
    expect(await $('#instruction-document-content').getValue()).toBe(
      '# Updated global shared instructions',
    );
  });

  it('项目上下文只保存项目 AGENTS.md，并展示项目路径', async () => {
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
    expect(await $('.instruction-document-paths').getText()).toContain('/AGENTS.md');
    expect(await $('.instruction-document-paths').getText()).not.toContain('/isolated/.codex');
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
  it('390px 窄屏完整展示路径、编辑和保存操作', async () => {
    await browser.setViewport({ width: 390, height: 844, devicePixelRatio: 1 });
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();
    await openInstructionsInContext(
      "//*[@data-workbench-rail='context']//button[normalize-space()='全局配置']",
    );
    await $('[data-instruction-kind="agents"]').click();
    await $('#instruction-document-content').waitForDisplayed();
    expect(await $('.instruction-document-paths').getText()).toContain(
      '/isolated/.config/opencode/AGENTS.md',
    );
    expect(
      await browser.execute(() => ({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      })),
    ).toEqual({ width: 390, overflow: false });
    await $('#instruction-document-content').setValue('# Narrow saved instructions');
    const save = await $("//button[normalize-space()='保存 AGENTS.md']");
    await save.scrollIntoView();
    await save.click();
    await $('.instructions-success').waitForExist();
    expect(await $('.instructions-success').getText()).toContain('AGENTS.md 已保存');
  });
});
