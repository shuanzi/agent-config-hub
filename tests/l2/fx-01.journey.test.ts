/**
 * FX-01 single-skill-ready 浏览器旅程（L2）。
 *
 * 驱动：tests/l2/workbench.html + 按 URL scenario 脚本化的 ScriptedMockGateway。
 * 断言以用户可见状态为主；敏感占位值断言同时覆盖可见文本与 innerHTML；
 * 末尾通过 browser.execute 读 mock 调用序列，确认全程只有 read。
 *
 * Provenance：本旅程只证明 renderer 行为，不构成真实 IPC/磁盘证据。
 */
import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';
// 拉入 webdriverio 的全局 WebdriverIO namespace 类型（browser/url/execute 等）
import type {} from 'webdriverio';

const ENTRY = '/tests/l2/workbench.html';
// 占位明文只允许存在于 fixture 原始文件；断言目标拼接构造，避免字面值进入测试源码/日志
const SECRET_PLACEHOLDER = ['SYNTHETIC-SECRET', 'demo-skill-0001'].join('-');
const MASK = '••••••••';

async function openWorkbench(scenario?: string): Promise<void> {
  await browser.url(scenario === undefined ? ENTRY : `${ENTRY}?scenario=${scenario}`);
  await $('.workbench').waitForDisplayed();
}

describe('FX-01 只读工作台旅程', () => {
  it('a. 默认进入 Skills，列表出现 Demo Skill 两行结构', async () => {
    await openWorkbench();
    const row = await $('[role="option"]');
    await row.waitForDisplayed();
    const text = await row.getText();
    expect(text).toContain('Demo Skill');
    expect(text).toContain('claude-code');
    expect(text).toContain('全局');
    // 一级导航仅四项
    const tabs = await $$('[role="tab"]');
    expect(tabs).toHaveLength(4);
    const navText = await $('[role="tablist"]').getText();
    expect(navText).toContain('Skills');
    expect(navText).toContain('长期指令');
    expect(navText).toContain('Subagents');
    expect(navText).toContain('Hooks');
  });

  it('b. 选中后详情原位显示磁盘源码；遮蔽标记可见；页面无明文占位值', async () => {
    const row = await $('[role="option"]');
    await row.waitForDisplayed();
    await row.click();

    const source = await $('pre.source-view');
    await source.waitForDisplayed();
    const sourceText = await source.getText();
    expect(sourceText).toContain('# Demo Skill');
    expect(sourceText).toContain(MASK);
    // 磁盘内容标识与禁用的结构化视图（含原因）
    const detailText = await $('.detail-panel').getText();
    expect(detailText).toContain('磁盘内容');
    expect(detailText).toContain('结构化视图不可用');
    // 页面任何可见文本与 DOM 都不得包含占位明文
    const { bodyText, bodyHtml } = await browser.execute(() => ({
      bodyText: document.body.innerText,
      bodyHtml: document.body.innerHTML,
    }));
    expect(bodyText.includes(SECRET_PLACEHOLDER)).toBe(false);
    expect(bodyHtml.includes(SECRET_PLACEHOLDER)).toBe(false);
  });

  it('c. 搜索不匹配 → empty 态解释可见；清空恢复', async () => {
    const search = await $('#asset-search');
    await search.waitForDisplayed();
    await search.setValue('不存在的资产xyz');
    await $('.state-empty').waitForDisplayed();
    expect(await $('.state-empty').getText()).toContain('当前范围内没有匹配的资产');

    // WebDriver Element Clear 不派发 input 事件，React 受控输入不更新；
    // 用逐键 Backspace 清空（可信 key event 会触发 onChange）
    const typed = await search.getValue();
    await search.click();
    for (let index = 0; index < typed.length; index += 1) {
      await browser.keys('Backspace');
    }
    await $('[role="option"]').waitForDisplayed();
  });

  it('d. 范围切换全部资产仍可见；筛选 Agent=codex → empty', async () => {
    await $('#scope-all').click();
    const row = await $('[role="option"]');
    await row.waitForDisplayed();
    expect(await row.getText()).toContain('Demo Skill');

    await $('#filter-agent').selectByAttribute('value', 'codex');
    await $('.state-empty').waitForDisplayed();
  });

  it('g. 全程 gateway 调用序列只含 read（observe 仅会话建立一次）', async () => {
    const { calls, observeCount } = await browser.execute(() => ({
      calls: window.__fx01?.getCalls() ?? [],
      observeCount: window.__fx01?.getObserveCallCount() ?? 0,
    }));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === 'read')).toBe(true);
    expect(observeCount).toBe(1);
  });

  it('e. scenario=stale-index：stale 提示与最近更新时间可见，数据仍展示', async () => {
    await openWorkbench('stale-index');
    const stale = await $('.state-stale');
    await stale.waitForDisplayed();
    const text = await stale.getText();
    expect(text).toContain('索引已过期');
    expect(text).toContain('最近更新');
    await $('[role="option"]').waitForDisplayed();
    expect(await $('[role="option"]').getText()).toContain('Demo Skill');
  });

  it('f. scenario=fail-list：failed 态可见含重试；点击重试恢复 ready', async () => {
    await openWorkbench('fail-list');
    const alert = await $('[role="alert"]');
    await alert.waitForDisplayed();
    expect(await alert.getText()).toContain('读取失败');

    const retry = await $('[role="alert"] button');
    expect(await retry.getText()).toContain('重试');
    await retry.click();

    // 一次性脚本化失败被消费后恢复
    await $('[role="option"]').waitForDisplayed();
    expect(await $('[role="option"]').getText()).toContain('Demo Skill');
  });

  it('h. 分组与来源筛选：按作用域分组出现标题，来源筛选选唯一值列表不变', async () => {
    await openWorkbench();
    await $('[role="option"]').waitForDisplayed();

    // 项目筛选：FX-01 无项目上下文 → 仅“全部”，控件仍可用
    expect(await $$('#filter-project option')).toHaveLength(1);
    expect(await $('#filter-project').isEnabled()).toBe(true);

    // 来源筛选：选项从 snapshot 的 sourceTier 推导（“全部” + 唯一来源）
    expect(await $$('#filter-source option')).toHaveLength(2);

    // 默认不分组：无分组标题
    expect(await $('.asset-group-heading').isExisting()).toBe(false);

    // 选择“按作用域分组”→ 出现分组标题且资产仍在
    await $('#group-by').selectByAttribute('value', 'scope');
    const heading = await $('.asset-group-heading');
    await heading.waitForDisplayed();
    expect(await heading.getText()).toContain('全局');
    await $('[role="option"]').waitForDisplayed();
    expect(await $('[role="option"]').getText()).toContain('Demo Skill');

    // 恢复“不分组”→ 标题消失
    await $('#group-by').selectByAttribute('value', 'none');
    await browser.waitUntil(async () => !(await $('.asset-group-heading').isExisting()));
    await $('[role="option"]').waitForDisplayed();

    // 来源筛选选唯一存在的值 → 列表不变
    await $('#filter-source').selectByAttribute('value', 'user-global-root');
    await $('[role="option"]').waitForDisplayed();
    expect(await $('[role="option"]').getText()).toContain('Demo Skill');
  });
});
