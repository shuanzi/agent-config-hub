/**
 * FE-01 FX-01 L2 read-session journey.
 *
 * Provenance: mock FrontendGateway renderer journey only; it never claims IPC,
 * disk, or ticket-closure credit. The assertions use visible read-only behavior
 * and the mock's public call log, never Tauri or fixture files directly.
 */
import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

const ENTRY = '/tests/l2/workbench.html';

async function openWorkbench(scenario?: string): Promise<void> {
  await browser.url(scenario === undefined ? ENTRY : `${ENTRY}?scenario=${scenario}`);
  await $('.read-only-workbench').waitForDisplayed();
}

describe('FX-01 只读 workbench L2 journey', () => {
  it('默认进入 Skills + All，只呈现三类 MVP 导航与 global segment', async () => {
    await openWorkbench();
    const tabs = await $$('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(await $('[role="tablist"]').getText()).toEqual('Skills长期指令Subagents');
    const row = await $('[role="option"]');
    await row.waitForDisplayed();
    expect(await row.getText()).toContain('Demo Skill');
    expect(await row.getText()).toContain('claude-code');
    expect(await $('.readonly-segment h2').getText()).toEqual('Global');
  });

  it('选中 Skill 只显示四个 authoritative Agent cells，不出现写入控件', async () => {
    const row = await $('[role="option"]');
    await row.click();
    const cells = await $$('.skill-target-grid article');
    expect(cells).toHaveLength(4);
    expect(await $('.skill-target-cells').getText()).toContain('claude-code');
    expect(await $('.skill-target-cells').getText()).toContain('存在：present');
    expect(await $('.skill-target-cells').getText()).toContain('激活：enabled');
    expect(await $('.skill-target-cells').getText()).toContain('适用性：resolved');
    expect(await $$('.skill-target-cells button')).toHaveLength(0);
  });

  it('unknown / blocked / stale Skill cells 显式显示 stableReason，且不变成 toggle', async () => {
    await openWorkbench('unknown-skill-cell');
    await $('[role="option"]').click();
    expect(await $('.skill-target-cells').getText()).toContain('存在：unknown');
    expect(await $('.skill-target-cells').getText()).toContain('原因：UNKNOWN_FIELD_PRESERVED');
    expect(await $$('.skill-target-cells button')).toHaveLength(0);

    await openWorkbench('blocked-skill-cell');
    await $('[role="option"]').click();
    expect(await $('.skill-target-cells').getText()).toContain('存在：blocked');
    expect(await $('.skill-target-cells').getText()).toContain('原因：READ_ONLY_POLICY');

    await openWorkbench('stale-index');
    await $('[role="option"]').click();
    expect(await $('.skill-target-cells').getText()).toContain('存在：stale');
    expect(await $('.skill-target-cells').getText()).toContain('原因：INDEX_STALE');
  });

  it('All / Global 段序可切换，Global 只保留 global segment', async () => {
    await openWorkbench();
    const scopes = await $$('[aria-label="作用域"] button');
    expect(scopes).toHaveLength(2);
    await scopes[1].click();
    await $('.readonly-segment h2').waitForDisplayed();
    expect(await $('.readonly-segment h2').getText()).toEqual('Global');
  });

  it('Project 入口只使用 opaque projectId，并按 project-native → resolved global 段序读取', async () => {
    await openWorkbench('project-projection');
    const projectButton = await $('button=项目 project-fx01-opaque');
    await projectButton.waitForDisplayed();
    await projectButton.click();
    await browser.waitUntil(async () => (await $$('.readonly-segment h2').length) === 2);
    expect(await $$('.readonly-segment h2').map((heading) => heading.getText())).toEqual([
      'project-fx01-opaque',
      'Global',
    ]);
    const ownership = await $$('[role="option"] small');
    expect(await ownership.map((item) => item.getText())).toContain('全局');
  });

  it('多个 Project 入口的 pressed state 必须按 opaque projectId 区分', async () => {
    await openWorkbench('multi-project-projection');
    const first = await $('button=项目 project-fx01-opaque');
    const second = await $('button=项目 project-fx01-second-opaque');
    await first.click();
    expect(await first.getAttribute('aria-pressed')).toEqual('true');
    expect(await second.getAttribute('aria-pressed')).toEqual('false');
    await second.click();
    expect(await first.getAttribute('aria-pressed')).toEqual('false');
    expect(await second.getAttribute('aria-pressed')).toEqual('true');
  });

  it('global locator 只读定位并以三固定分组返回 native destination', async () => {
    await openWorkbench();
    await $('button=全局搜索').click();
    const input = await $('#global-locator-input');
    await input.setValue('Demo');
    await browser.waitUntil(
      async () => (await (await $$('[aria-label="Skills"] button')).length) === 1,
    );
    expect(await $$('.global-locator section')).toHaveLength(3);
    await $('[aria-label="Skills"] button').click();
    await $('.skill-target-cells').waitForDisplayed();
    expect(await $('.readonly-segment h2').getText()).toEqual('Global');
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-testid')),
    ).toEqual('skill-detail-heading');
  });

  it('⌘K 与右上按钮打开同一 locator，Escape 返回触发按钮', async () => {
    await openWorkbench();
    await browser.keys(['Meta', 'k']);
    await $('.global-locator').waitForDisplayed();
    await browser.keys('Escape');
    await browser.waitUntil(async () => (await $$('.global-locator').length) === 0);
    expect(await browser.execute(() => document.activeElement?.textContent)).toContain('全局搜索');

    await $('button=全局搜索').click();
    await $('.global-locator').waitForDisplayed();
  });

  it('⌘K 从任意有效焦点打开 locator 后，Escape 返回原焦点而非搜索按钮', async () => {
    await openWorkbench();
    await browser.execute(() => document.querySelector<HTMLSelectElement>('#name-sort')?.focus());
    expect(await browser.execute(() => document.activeElement?.id)).toEqual('name-sort');

    await browser.keys(['Meta', 'k']);
    await $('.global-locator').waitForDisplayed();
    await browser.keys('Escape');
    await browser.waitUntil(async () => (await $$('.global-locator').length) === 0);
    expect(await browser.execute(() => document.activeElement?.id)).toEqual('name-sort');
  });

  it('locator 结果只呈现已遮蔽的可显示 facts，读取失败时聚焦可编程错误标题', async () => {
    await openWorkbench('masked-text');
    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('••••');
    const result = await $('[data-testid="locator-result"]');
    await result.waitForDisplayed();
    const text = await result.getText();
    expect(text).toContain('••••••••');
    expect(text).toContain('全局');
    expect(text).toContain('claude-code');
    expect(text).not.toContain('SYNTHETIC-SECRET');

    await openWorkbench('fail-locator');
    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('Demo');
    const heading = await $('[data-testid="locator-error-heading"]');
    await heading.waitForDisplayed();
    expect(await heading.getText()).toContain('全局搜索读取失败');
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-testid')),
    ).toEqual('locator-error-heading');
  });

  it('非 Skill locator destination 原子切换上下文，关闭搜索并聚焦只读详情错误', async () => {
    await openWorkbench('unsupported-locator');
    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('Instruction');
    const result = await $('[aria-label="长期指令"] [data-testid="locator-result"]');
    await result.waitForDisplayed();
    await result.click();
    await browser.waitUntil(async () => (await $$('.global-locator').length) === 0);
    const heading = await $('[data-testid="detail-error-heading"]');
    await heading.waitForDisplayed();
    expect(await heading.getText()).toEqual('无法打开只读详情');
    expect(await $('[role="tab"][aria-selected="true"]').getText()).toEqual('长期指令');
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-testid')),
    ).toEqual('detail-error-heading');
  });

  it('stale 与 ReadFailed 仍为可解释的只读 state', async () => {
    await openWorkbench('stale-index');
    expect(await $('[role="status"]').getText()).toContain('索引已过期');
    await openWorkbench('fail-list');
    expect(await $('[role="alert"]').getText()).toContain('读取失败');
    await $('[role="alert"] + button').click();
    await $('[role="option"]').waitForDisplayed();
  });

  it('整个 journey 只调用 FrontendGateway read，未调用 prepare/apply', async () => {
    const { calls, observeCount } = await browser.execute(() => ({
      calls: window.__fx01?.getCalls() ?? [],
      observeCount: window.__fx01?.getObserveCallCount() ?? 0,
    }));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === 'read')).toBe(true);
    expect(observeCount).toBe(1);
  });

  it('遮蔽后的列表提示与失败文案不泄露占位敏感值，且 DOM 不含源码 surface', async () => {
    await openWorkbench('masked-text');
    const body = await $('body').getText();
    expect(body).not.toContain('SYNTHETIC-SECRET');
    expect(body).toContain('••••••••');
    expect(await $$('pre.source-view')).toHaveLength(0);

    await openWorkbench('masked-fail-list');
    expect(await $('[role="alert"]').getText()).not.toContain('SYNTHETIC-SECRET');
  });
});
