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

  it('换页后回到列表顶端并聚焦该页首个 authoritative 行', async () => {
    await browser.setWindowSize(1280, 560);
    await openWorkbench('perf-catalog');
    await $('[role="option"]').waitForDisplayed();
    expect(await $('nav[aria-label="全局分页"]').getText()).toContain('第 1 /');

    const scrolled = await browser.execute(() => {
      const list = document.querySelector<HTMLElement>('.list-pane');
      if (list === null) return 0;
      list.scrollTop = list.scrollHeight;
      return list.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    await $("//nav[@aria-label='全局分页']//button[normalize-space()='下一页']").click();
    await browser.waitUntil(() =>
      browser.execute(() =>
        document.querySelector('nav[aria-label="全局分页"] span')?.textContent?.includes('第 2 /'),
      ),
    );
    const afterPageChange = await browser.execute(() => {
      const list = document.querySelector<HTMLElement>('.list-pane');
      const firstRow = document.querySelector<HTMLButtonElement>('[role="option"]');
      return {
        scrollTop: list?.scrollTop ?? -1,
        firstRowFocused: document.activeElement === firstRow,
      };
    });
    expect(afterPageChange.scrollTop).toBe(0);
    expect(afterPageChange.firstRowFocused).toBe(true);
  });

  it('authoritative 空结果聚焦可编程空标题', async () => {
    await openWorkbench();
    await $('#filter-agent').selectByAttribute('value', 'codex');
    const heading = await $('[data-testid="workbench-empty-heading"]');
    await heading.waitForDisplayed();
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-testid')),
    ).toEqual('workbench-empty-heading');
  });

  it('PF startup 不在首屏代表性列表行隐藏时记点', async () => {
    await browser.setWindowSize(1440, 900);
    await browser.url(`${ENTRY}?scenario=perf-catalog&startupRowsHidden=1`);
    await $('.read-only-workbench').waitForDisplayed();
    await browser.pause(100);
    expect(await browser.execute(() => window.__pf01?.getStartupMs())).toBeNull();

    await browser.execute(() =>
      document.querySelector('[data-testid="pf01-startup-hidden"]')?.remove(),
    );
    await browser.pause(200);
    await browser.waitUntil(async () => {
      const [rowVisible, startupMs] = await browser.execute(() => [
        document.querySelector<HTMLElement>('[role="option"]')?.offsetParent !== null,
        window.__pf01?.getStartupMs(),
      ]);
      return rowVisible === true && startupMs !== null;
    });
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

  it('All 的 projectIds 筛选不会阻断 global/project locator destination 的详情焦点', async () => {
    const projectId = 'project-fx01-opaque';
    await openWorkbench();
    await browser.execute((id) => window.__fx01?.setAllProjectFilter(id), projectId);
    await browser.waitUntil(async () => {
      const calls = await browser.execute(() => window.__fx01?.getCalls() ?? []);
      const last = [...calls].reverse().find((call) => call.queryKind === 'workbench');
      return last?.query.kind === 'workbench' && last.query.filters?.projectIds?.[0] === projectId;
    });
    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('Demo');
    await $('[aria-label="Skills"] [data-testid="locator-result"]').click();
    await $('.skill-target-cells').waitForDisplayed();
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-testid')),
    ).toEqual('skill-detail-heading');
    const globalQuery = await browser.execute(() => {
      const calls = window.__fx01?.getCalls() ?? [];
      return [...calls].reverse().find((call) => call.queryKind === 'workbench')?.query;
    });
    expect(globalQuery).toMatchObject({
      kind: 'workbench',
      viewContext: { kind: 'global' },
      filters: { agents: ['claude-code'] },
    });
    expect(globalQuery?.kind === 'workbench' && globalQuery.filters?.projectIds).toBeUndefined();

    await openWorkbench('project-projection');
    await browser.execute((id) => window.__fx01?.setAllProjectFilter(id), projectId);
    await browser.waitUntil(async () => {
      const calls = await browser.execute(() => window.__fx01?.getCalls() ?? []);
      const last = [...calls].reverse().find((call) => call.queryKind === 'workbench');
      return last?.query.kind === 'workbench' && last.query.filters?.projectIds?.[0] === projectId;
    });
    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('Project Native Skill');
    await $('[aria-label="Skills"] [data-testid="locator-result"]').click();
    await $('.skill-target-cells').waitForDisplayed();
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-testid')),
    ).toEqual('skill-detail-heading');
    const projectQuery = await browser.execute(() => {
      const calls = window.__fx01?.getCalls() ?? [];
      return [...calls].reverse().find((call) => call.queryKind === 'workbench')?.query;
    });
    expect(projectQuery).toMatchObject({
      kind: 'workbench',
      viewContext: { kind: 'project', projectId },
      filters: { agents: ['claude-code'] },
    });
    expect(projectQuery?.kind === 'workbench' && projectQuery.filters?.projectIds).toBeUndefined();
  });

  it('workspace event 使打开的 locator 立即失效并以相同 searchText 重读', async () => {
    await openWorkbench();
    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('Demo');
    await $('[data-testid="locator-result"]').waitForDisplayed();
    const immediate = await browser.execute(() => {
      const before = (window.__fx01?.getCalls() ?? []).filter(
        (call) => call.queryKind === 'globalLocator',
      ).length;
      window.__fx01?.emitWorkspaceInvalidation();
      return { before, locator: window.__fx01?.getLocator() };
    });
    expect(immediate.locator).toMatchObject({ kind: 'open', searchText: 'Demo', snapshot: null });

    await browser.waitUntil(async () => {
      const current = await browser.execute(() => ({
        locator: window.__fx01?.getLocator(),
        locatorReads: (window.__fx01?.getCalls() ?? []).filter(
          (call) => call.queryKind === 'globalLocator',
        ).length,
      }));
      return (
        current.locatorReads === immediate.before + 1 &&
        current.locator?.kind === 'open' &&
        current.locator.snapshot !== null
      );
    });
    expect(await $('#global-locator-input').getValue()).toEqual('Demo');
  });

  it('locator 项目结果只显示安全摘要与项目展示提示，并为零结果保留稳定空态', async () => {
    await openWorkbench('project-projection');
    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('Project Native Skill');
    const result = await $('[data-testid="locator-result"]');
    await result.waitForDisplayed();
    const text = await result.getText();
    expect(text).toContain('结构化只读项目 Skill 摘要');
    expect(text).toContain('项目 Fixture project（只读）');
    expect(text).not.toContain('project-fx01-opaque');

    await $('#global-locator-input').setValue('no-locator-match');
    const empty = await $('[data-testid="locator-empty"]');
    await empty.waitForDisplayed();
    expect(await empty.getText()).toEqual('没有匹配的资产。');
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

  it('合法 Skill locator destination 的 authoritative reread 失败时聚焦详情错误，而非仅显示列表读取错误', async () => {
    await openWorkbench('fail-locator-detail');
    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('Demo');
    const result = await $('[aria-label="Skills"] [data-testid="locator-result"]');
    await result.waitForDisplayed();
    await result.click();
    await browser.waitUntil(async () => (await $$('.global-locator').length) === 0);
    const heading = await $('[data-testid="detail-error-heading"]');
    await heading.waitForDisplayed();
    expect(await heading.getText()).toEqual('无法打开只读详情');
    expect(await $('[role="alert"]').getText()).toContain('读取失败');
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
