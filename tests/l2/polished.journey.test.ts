import { describe, it } from 'mocha';
import { $, browser, expect } from '@wdio/globals';
import { saveEvidence } from './evidence';

const entry = '/tests/l2/workbench.html?fixture=polished';
const button = (label: string) => $(`//button[normalize-space()='${label}']`);
async function open(query = '') {
  await browser.url(entry + query);
  await $('.app-header').waitForDisplayed();
  const params = new URLSearchParams(query);
  if (!params.has('page') && !params.has('step') && params.get('tab') !== 'discovery') {
    await button('目录与维护').waitForDisplayed();
    await button('目录与维护').click();
  }
}
async function capture(name: string) {
  expect(await browser.execute(() => document.documentElement.scrollWidth > innerWidth)).toBe(
    false,
  );
  await saveEvidence(name);
}
async function nativeDetail() {
  await $('[data-native-identity="codex:repo-reviewer"]').click();
  await button('查看原生源码').click();
  await $('[aria-label="Subagent 原生源码"]').waitForDisplayed();
}
async function skillInstall() {
  await open('&tab=discovery');
  await $('[aria-label="选择 Skill 发现目标"]').selectByAttribute('value', 'global');
  const install = $("//button[normalize-space()='安装']");
  await install.waitForDisplayed();
  await install.click();
  await $('[role="dialog"]').waitForDisplayed();
}

describe('Polished 实际 App 页面与交互验收', () => {
  for (const [width, height] of [
    [1586, 992],
    [1280, 800],
    [390, 844],
  ]) {
    it(`${width} 页面清单、行高和位置按钮`, async () => {
      await browser.setViewport({ width, height, devicePixelRatio: 1 });
      const prefix = width === 390 ? 'mobile-390' : `desktop-${width}`;
      await open();
      await $('.skill-row').waitForDisplayed();
      const metrics = await browser.execute(() => ({
        rows: [...document.querySelectorAll('.skill-row')].map(
          (x) => x.getBoundingClientRect().height,
        ),
        icons: [...document.querySelectorAll('.skill-placement-icon')].map((x) => ({
          width: x.getBoundingClientRect().width,
          height: x.getBoundingClientRect().height,
        })),
        firstGroupCount: document.querySelector('.skill-row .skill-placement-controls')?.children
          .length,
      }));
      expect(metrics.rows.every((h) => Math.abs(h - (width === 390 ? 140 : 64)) < 1)).toBe(true);
      expect(
        metrics.icons.every((s) => s.width === (width === 390 ? 44 : 32) && s.height === s.width),
      ).toBe(true);
      expect(metrics.firstGroupCount).toBe(5);
      await $('[aria-label="选择 Skill 操作目标"]').selectByAttribute('value', 'global');
      await capture(`${prefix}-skills-installed`);
      await $('[aria-label^="详情 code-review，"]').click();
      await $('.skill-detail').waitForDisplayed();
      expect(await $('.skill-detail').getText()).toContain('共享目录');
      await capture(`${prefix}-skill-detail`);
      await open('&page=instructions');
      await $('[data-instruction-kind="agents"]').waitForDisplayed();
      if (width === 390) await capture(`${prefix}-instructions`);
      await $('[data-instruction-kind="agents"]').click();
      await $('#instruction-document-content').waitForDisplayed();
      await capture(`${prefix}-${width === 390 ? 'instruction-detail' : 'instructions'}`);
      await open('&page=subagents');
      await $('.native-row').waitForDisplayed();
      if (width === 390) await capture(`${prefix}-subagents-installed`);
      await nativeDetail();
      await capture(`${prefix}-${width === 390 ? 'subagent-detail' : 'subagents-installed'}`);
      await open('&page=settings');
      await $('.settings-page-header').waitForDisplayed();
      await capture(`${prefix}-settings`);
      if (width !== 390) {
        await open('&tab=discovery');
        await $('.discovery-target-card').waitForDisplayed();
        await capture(`${prefix}-skills-discovery`);
        await open('&page=subagents&tab=discovery');
        await $('[aria-label="选择 Subagent 发现目标"]').selectByAttribute(
          'value',
          'project:visual-project-alpha',
        );
        await $('.native-discovery-card').waitForDisplayed();
        await capture(`${prefix}-subagents-discovery`);
      } else {
        await open('&step=type');
        await capture(`${prefix}-asset-types`);
        await button('Skills').click();
        await capture(`${prefix}-contexts`);
        await button('全部').click();
        await button('目录与维护').click();
        await button('更多操作').click();
        await capture(`${prefix}-skills-actions`);
        await browser.keys('Escape');
        expect(await $('[role="dialog"]').isExisting()).toBe(false);
        await skillInstall();
        await capture(`${prefix}-install-dialog`);
      }
    });
  }

  it('8 个弹窗、焦点循环、导入预览与文件选择取消', async () => {
    await browser.setViewport({ width: 1280, height: 800, devicePixelRatio: 1 });
    await skillInstall();
    await $('[role="dialog"] input[value="shared"]').click();
    await capture('dialog-skill-install');
    await browser.keys(['Shift', 'Tab']);
    await browser.keys('Tab');
    expect(await browser.execute(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
      true,
    );
    await browser.keys('Escape');
    await open();
    await $('[aria-label="选择 Skill 操作目标"]').selectByAttribute('value', 'global');
    await button('从 ZIP 安装').click();
    await button('选择 ZIP 文件').click();
    await button('取消选择').click();
    expect(await $('[role="dialog"] .focused-dialog-footer button:last-child').isEnabled()).toBe(
      false,
    );
    await button('选择 ZIP 文件').click();
    await button('选择样例文件').click();
    await $('[role="dialog"] input[value="shared"]').click();
    await capture('dialog-zip-install');
    await browser.keys('Escape');
    await button('导入已有').click();
    await $('[aria-label^="选择 local-helper，"]').click();
    await $('[role="dialog"] input[aria-label*="共享目录"]').click();
    await capture('dialog-import-existing');
    await $("//button[contains(normalize-space(),'预览接管 (')]").click();
    await button('确认接管').waitForDisplayed();
    await capture('dialog-import-preview');
    await button('确认接管').click();
    await $('[data-skill-id="import:local-helper"]').waitForDisplayed();
    await $('[aria-label^="更多操作 local-helper，"]').click();
    await $('[aria-label^="卸载 local-helper，"]').click();
    await $("//*[@role='dialog']//button[normalize-space()='卸载']").click();
    await $('[data-skill-id="import:local-helper"]').waitForExist({ reverse: true });
    await button('从备份恢复').click();
    await $('.skill-backup-item').waitForDisplayed();
    await capture('dialog-backup-restore');
    await open('&page=subagents&tab=discovery');
    await $('[aria-label="选择 Subagent 发现目标"]').selectByAttribute(
      'value',
      'project:visual-project-alpha',
    );
    await $('.native-discovery-card').waitForDisplayed();
    await button('安装').click();
    await $('[role="dialog"] input[value="codex"]').click();
    await capture('dialog-project-subagent-install');
    await open('&page=subagents');
    await nativeDetail();
    await button('检查更新').click();
    await $('[role="dialog"]').waitForDisplayed();
    await capture('dialog-subagent-update');
    await browser.keys('Escape');
    await open('&page=subagents&scenario=backup-conflict');
    await nativeDetail();
    await button('备份').click();
    await button('备份恢复').click();
    await $('.native-backup-item').waitForDisplayed();
    await $('.native-backup-item input[type="radio"]').click();
    await button('确认恢复所选备份').click();
    await $('[role="dialog"] [role="alert"]').waitForDisplayed();
    await capture('dialog-subagent-backup');
  });

  it('设置的即时保存保留覆盖草稿，显式保存后回读', async () => {
    await open('&page=settings');
    await $('#claudeCodeConfigDir').waitForDisplayed();
    await $('#claudeCodeConfigDir').setValue('/mock/draft');
    await $('[aria-label="复制"]').click();
    await $('.settings-success').waitForDisplayed();
    expect(await $('#claudeCodeConfigDir').getValue()).toBe('/mock/draft');
    await button('保存覆盖路径').click();
    await browser.waitUntil(async () =>
      (await $('.settings-success').getText()).includes('覆盖路径已保存'),
    );
    await button('Skills').click();
    await button('设置').click();
    expect(await $('#claudeCodeConfigDir').getValue()).toBe('/mock/draft');
  });

  it('错误重试、空与加载状态、冲突禁止写入及行目标隔离', async () => {
    await browser.setViewport({ width: 1280, height: 800, devicePixelRatio: 1 });
    await open('&scenario=empty');
    await $('.skill-empty').waitForDisplayed();
    await capture('state-empty');
    await open('&scenario=loading');
    await $('.skill-empty').waitForDisplayed();
    await capture('state-loading');
    await open('&scenario=error');
    await $('[role="alert"]').waitForDisplayed();
    await capture('state-error');
    await button('重新读取投放状态').click();
    await $('.skill-row').waitForDisplayed();
    await open('&scenario=isolation');
    await $('.skill-row').waitForDisplayed();
    const blocked = $('[aria-label^="投放位置：react-best-practices，OpenCode"]');
    expect(await blocked.getAttribute('aria-disabled')).toBe('true');
    await blocked.click();
    await $('[role="tooltip"]').waitForDisplayed();
    expect(await $('[role="tooltip"]').getText()).toContain('目标目录与受管副本内容不同');
    await browser.keys('Escape');
    expect(await $('[role="tooltip"]').isExisting()).toBe(false);
    await browser.keys('Enter');
    expect(await blocked.getAttribute('aria-disabled')).toBe('true');
    await $('[aria-label="选择 Skill 操作目标"]').selectByAttribute(
      'value',
      'project:visual-project-beta',
    );
    const global = $('[data-skill-target="global"] [aria-label^="投放位置：code-review，Codex"]');
    await global.click();
    await browser.waitUntil(async () => (await global.getAttribute('aria-pressed')) === 'true');
    const assets = await browser.execute(() =>
      window.__ACM_MOCK_STATE__!.skillPlacements.filter((x) => x.id === 'polished:code-review'),
    );
    expect(
      assets
        .find((x) => x.target.scope === 'global')
        ?.placements.find((x) => x.location === 'codex')?.state,
    ).toBe('placed');
    expect(
      assets
        .find((x) => x.target.scope === 'project')
        ?.placements.find((x) => x.location === 'codex')?.state,
    ).toBe('absent');
    await $('[aria-label^="投放位置：react-best-practices，Gemini CLI"]').click();
    await $('.skill-detail').waitForDisplayed();
    expect(await $('.skill-detail').getText()).toContain('接管');
  });
});
