/**
 * FE-10 FX-12 renderer journey.
 *
 * Provenance: browser-mode ScriptedMockGateway only. It verifies visible,
 * read-only responsive navigation; it claims no IPC, disk, L3, or PF credit.
 */
import { $, $$, browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import type {} from 'webdriverio';

const ENTRY = '/tests/l2/workbench.html';
const FX02_READ_ENTRY = `${ENTRY}?scenario=fx02-read-surfaces`;
const FX12_VIEW_ENTRY = `${ENTRY}?scenario=fx12-sensitive-view`;
const FX12_VIEW_FAILURE_ENTRY = `${ENTRY}?scenario=fx12-sensitive-view-failed`;
const FE03_DRAFT_ENTRY = `${ENTRY}?scenario=fe03-drafts`;
const reducedMotionIt = process.env.FE10_REDUCED_MOTION === 'reduce' ? it : it.skip;

async function openWorkbench(width: number, waitForList = true, entry = ENTRY): Promise<void> {
  await browser.setWindowSize(width, 900);
  await browser.url(entry);
  await $('.read-only-workbench').waitForDisplayed();
  if (waitForList) await $('[role="option"]').waitForDisplayed();
}

async function openNarrowSkillDetail(): Promise<void> {
  await openWorkbench(360, false);
  await $('button=Skills').click();
  await $('[aria-label="作用域"]').waitForDisplayed();
  await $('button=全部').click();
  await browser.waitUntil(() =>
    browser.execute(() =>
      document.querySelector('.read-only-workbench')?.classList.contains('narrow-stage-list'),
    ),
  );
  const row = await $('[role="option"]');
  await row.waitForDisplayed();
  await row.click();
  await $('[data-testid="skill-detail-heading"]').waitForDisplayed();
}

async function visibleSurfaceState(): Promise<{
  assetType: boolean;
  scope: boolean;
  listProjection: boolean;
  list: boolean;
  detail: boolean;
  horizontalOverflow: boolean;
}> {
  return browser.execute(() => {
    const visible = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return false;
      for (
        let current: HTMLElement | null = element;
        current !== null;
        current = current.parentElement
      ) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    return {
      assetType: visible(document.querySelector('[aria-label="资产类型"]')),
      scope: visible(document.querySelector('[aria-label="作用域"]')),
      listProjection: visible(document.querySelector('[aria-label="列表投影"]')),
      list: visible(document.querySelector('.list-pane')),
      detail: visible(document.querySelector('[aria-label="资产详情"]')),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

async function visibleNarrowRootSurfaces(): Promise<string[]> {
  return browser.execute(() => {
    const visible = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return false;
      for (
        let current: HTMLElement | null = element;
        current !== null;
        current = current.parentElement
      ) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return (
        element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
      );
    };
    const workbench = document.querySelector<HTMLElement>('.read-only-workbench');
    if (workbench === null) throw new Error('只读工作台未挂载');
    return [...workbench.children].filter(visible).map((element) => {
      if (element.matches('.workbench-header')) return 'type';
      if (element.matches('.scope-pane')) return 'scope';
      if (element.matches('.toolbar')) return 'list-projection';
      if (element.matches('.workbench-main')) {
        if (visible(element.querySelector('.list-pane'))) return 'list';
        if (visible(element.querySelector('.detail-panel'))) return 'detail';
        return 'main-without-surface';
      }
      if (element.matches('[data-testid="authoritative-revision"]')) return 'revision';
      if (element.matches('[role="alert"]')) return 'state';
      if (element.textContent?.trim() === '重试') return 'retry';
      return `unexpected:${element.tagName.toLowerCase()}`;
    });
  });
}

async function tabUntilFocused(selector: string, description: string): Promise<void> {
  for (let attempts = 0; attempts < 16; attempts += 1) {
    const focused = await browser.execute(
      (candidate) =>
        document.activeElement instanceof Element && document.activeElement.matches(candidate),
      selector,
    );
    if (focused) return;
    await browser.keys('Tab');
  }
  throw new Error(`Tab 未能抵达 ${description}`);
}

async function toolbarControlBorderContrasts(): Promise<Array<{ id: string; contrast: number }>> {
  return browser.execute(() => {
    const parseColor = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (channels === undefined || channels.length < 3) return null;
      return { red: channels[0], green: channels[1], blue: channels[2], alpha: channels[3] ?? 1 };
    };
    const relativeLuminance = ({
      red,
      green,
      blue,
    }: {
      red: number;
      green: number;
      blue: number;
    }) => {
      const linear = (channel: number) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
    };
    const effectiveBackground = (element: HTMLElement) => {
      for (
        let current: HTMLElement | null = element;
        current !== null;
        current = current.parentElement
      ) {
        const color = parseColor(window.getComputedStyle(current).backgroundColor);
        if (color !== null && color.alpha > 0) return color;
      }
      return { red: 255, green: 255, blue: 255, alpha: 1 };
    };
    return [...document.querySelectorAll<HTMLSelectElement>('[aria-label="列表投影"] select')]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
      })
      .map((element) => {
        const border = parseColor(window.getComputedStyle(element).borderTopColor);
        if (border === null) throw new Error(`无法读取 ${element.id} 的可见边框颜色`);
        const background = effectiveBackground(element);
        const contrast =
          (Math.max(relativeLuminance(border), relativeLuminance(background)) + 0.05) /
          (Math.min(relativeLuminance(border), relativeLuminance(background)) + 0.05);
        return { id: element.id, contrast };
      });
  });
}

async function textAndFocusAccessibility(): Promise<{
  textContrast: number;
  focusContrast: number;
  focusVisible: boolean;
  focusOutlineWidth: string;
  namedControls: string[];
}> {
  return browser.execute(() => {
    const parseColor = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (channels === undefined || channels.length < 3) return null;
      return { red: channels[0], green: channels[1], blue: channels[2], alpha: channels[3] ?? 1 };
    };
    const relativeLuminance = ({
      red,
      green,
      blue,
    }: {
      red: number;
      green: number;
      blue: number;
    }) => {
      const linear = (channel: number) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
    };
    const effectiveBackground = (element: HTMLElement) => {
      for (
        let current: HTMLElement | null = element;
        current !== null;
        current = current.parentElement
      ) {
        const color = parseColor(window.getComputedStyle(current).backgroundColor);
        if (color !== null && color.alpha > 0) return color;
      }
      return { red: 255, green: 255, blue: 255, alpha: 1 };
    };
    const contrast = (foreground: string, element: HTMLElement) => {
      const color = parseColor(foreground);
      if (color === null) throw new Error('无法读取实际可见颜色');
      const background = effectiveBackground(element);
      return (
        (Math.max(relativeLuminance(color), relativeLuminance(background)) + 0.05) /
        (Math.min(relativeLuminance(color), relativeLuminance(background)) + 0.05)
      );
    };
    const text = document.querySelector<HTMLElement>('[role="option"]');
    const focused = document.activeElement;
    if (!(text instanceof HTMLElement) || !(focused instanceof HTMLElement))
      throw new Error('缺少代表性文本或键盘焦点控件');
    const focusStyle = window.getComputedStyle(focused);
    return {
      textContrast: contrast(window.getComputedStyle(text).color, text),
      focusContrast: contrast(focusStyle.outlineColor, focused),
      focusVisible: focused.matches(':focus-visible') && focusStyle.outlineStyle !== 'none',
      focusOutlineWidth: focusStyle.outlineWidth,
      namedControls: [
        document.querySelector<HTMLElement>('[role="tab"]'),
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent?.trim() === '全局搜索',
        ),
        document.querySelector<HTMLElement>('[aria-label="列表投影"] select'),
      ].map((control) => {
        if (control === undefined || control === null) throw new Error('缺少可访问控件');
        const labelledBy = control.getAttribute('aria-labelledby');
        const labelText =
          labelledBy
            ?.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .join(' ') ||
          (control instanceof HTMLLabelElement ? control.textContent?.trim() : undefined) ||
          (control instanceof HTMLSelectElement
            ? [...(control.labels ?? [])].map((label) => label.textContent?.trim() ?? '').join(' ')
            : undefined);
        return control.getAttribute('aria-label') ?? labelText ?? control.textContent?.trim() ?? '';
      }),
    };
  });
}

describe('FE-10 FX-12 responsive read-only journey', () => {
  it('keeps the read-only list and detail available together at wide and medium widths', async () => {
    await openWorkbench(1280);
    expect(await visibleSurfaceState()).toEqual({
      assetType: true,
      scope: true,
      listProjection: true,
      list: true,
      detail: true,
      horizontalOverflow: false,
    });

    await openWorkbench(760);
    expect(await visibleSurfaceState()).toEqual({
      assetType: true,
      scope: true,
      listProjection: true,
      list: true,
      detail: true,
      horizontalOverflow: false,
    });
  });

  it('keeps each type-specific read-only detail surface reachable at wide and medium widths', async () => {
    for (const width of [1280, 760]) {
      for (const type of [
        {
          tab: 'Skills',
          detail: 'skill-readonly-detail',
          heading: 'Multifile Skill',
        },
        {
          tab: '长期指令',
          detail: 'long-term-instruction-readonly-detail',
          heading: '长期指令详情：Release notes',
        },
        {
          tab: 'Subagents',
          detail: 'subagent-readonly-detail',
          heading: 'Subagent 详情：Researcher',
        },
      ] as const) {
        await openWorkbench(width, true, FX02_READ_ENTRY);
        await $(`button=${type.tab}`).click();
        const row = await $('[role="option"]');
        await row.waitForDisplayed();
        await row.click();
        const detail = await $(`[data-testid="${type.detail}"]`);
        await detail.waitForDisplayed();
        expect(await detail.getText()).toContain(type.heading);
      }
    }
  });

  reducedMotionIt(
    'reaches the 360px scope surface directly when reduced motion is requested',
    async () => {
      expect(
        await browser.execute(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(true);
      await openWorkbench(360, false);
      await tabUntilFocused('button[role="tab"]', '资产类型');
      await browser.keys('Space');
      await $('[aria-label="作用域"]').waitForDisplayed();

      expect(await visibleNarrowRootSurfaces()).toEqual(['scope']);
      expect(
        await browser.execute(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '.read-only-workbench, .read-only-workbench *',
            ),
          ]
            .filter((element) => element.getClientRects().length > 0)
            .every((element) => {
              const style = window.getComputedStyle(element);
              return (
                style.animationName === 'none' &&
                style.animationDuration === '0s' &&
                style.transitionDuration === '0s'
              );
            }),
        ),
      ).toBe(true);
    },
  );

  it('changes narrow detail navigation into one visible surface without horizontal overflow', async () => {
    await openNarrowSkillDetail();

    expect(await visibleSurfaceState()).toEqual({
      assetType: false,
      scope: false,
      listProjection: false,
      list: false,
      detail: true,
      horizontalOverflow: false,
    });
  });

  it('offers an accessible return-to-list control after a narrow detail is opened', async () => {
    await openNarrowSkillDetail();

    const backToList = await $('button[aria-label="返回列表"]');
    expect(await backToList.isExisting()).toBe(true);
    await backToList.click();
    expect(await browser.execute(() => document.activeElement?.getAttribute('role'))).toBe(
      'option',
    );
    expect(await visibleSurfaceState()).toMatchObject({
      assetType: false,
      scope: false,
      listProjection: true,
      list: true,
      detail: false,
    });
  });

  it('uses a 360px type-to-scope-to-list-to-detail single-surface stack', async () => {
    await openWorkbench(360, false);
    expect(await visibleNarrowRootSurfaces()).toEqual(['type']);
    expect(await visibleSurfaceState()).toEqual({
      assetType: true,
      scope: false,
      listProjection: false,
      list: false,
      detail: false,
      horizontalOverflow: false,
    });

    await $('button=Skills').click();
    await $('[aria-label="作用域"]').waitForDisplayed();
    expect(await visibleNarrowRootSurfaces()).toEqual(['scope']);
    expect(await visibleSurfaceState()).toEqual({
      assetType: false,
      scope: true,
      listProjection: false,
      list: false,
      detail: false,
      horizontalOverflow: false,
    });

    await $('button=全部').click();
    await browser.waitUntil(() =>
      browser.execute(() =>
        document.querySelector('.read-only-workbench')?.classList.contains('narrow-stage-list'),
      ),
    );
    await $('[role="option"]').waitForDisplayed();
    expect(await visibleNarrowRootSurfaces()).toEqual(['list-projection', 'list']);
    expect(await visibleSurfaceState()).toEqual({
      assetType: false,
      scope: false,
      listProjection: true,
      list: true,
      detail: false,
      horizontalOverflow: false,
    });

    await $('[role="option"]').click();
    await $('[data-testid="skill-detail-heading"]').waitForDisplayed();
    expect(await visibleNarrowRootSurfaces()).toEqual(['detail']);
    expect(await visibleSurfaceState()).toEqual({
      assetType: false,
      scope: false,
      listProjection: false,
      list: false,
      detail: true,
      horizontalOverflow: false,
    });
  });

  it('does not expose failed-state retry controls outside the active 360px type or scope surface', async () => {
    await openWorkbench(360, false, `${ENTRY}?scenario=fail-list`);
    await $('button=重试').waitForDisplayed();
    expect(await visibleNarrowRootSurfaces()).toEqual(['type']);

    await $('button=Skills').click();
    await $('[aria-label="作用域"]').waitForDisplayed();
    expect(await visibleNarrowRootSurfaces()).toEqual(['scope']);
  });

  it('uses actual Tab, Enter, and Space keys for every 360px stack stage and return', async () => {
    await openWorkbench(360, false);

    await tabUntilFocused('button[role="tab"]', '资产类型');
    await browser.keys('Space');
    await $('[aria-label="作用域"]').waitForDisplayed();

    await tabUntilFocused('[aria-label="作用域"] button[aria-pressed="true"]', '当前作用域');
    await browser.keys('Enter');
    await $('[role="option"]').waitForDisplayed();

    await tabUntilFocused('[role="option"]', '资产列表首行');
    await browser.keys('Enter');
    await $('[data-testid="skill-detail-heading"]').waitForDisplayed();

    await tabUntilFocused('button[aria-label="返回列表"]', '返回列表');
    await browser.keys('Space');
    await $('[role="option"]').waitForDisplayed();

    await tabUntilFocused('button[aria-label="返回作用域"]', '返回作用域');
    await browser.keys('Enter');
    await $('[aria-label="作用域"]').waitForDisplayed();

    await tabUntilFocused('button[aria-label="返回资产类型"]', '返回资产类型');
    await browser.keys('Space');
    await $('[role="tablist"]').waitForDisplayed();
    expect(await visibleNarrowRootSurfaces()).toEqual(['type']);
  });

  it('returns a disconnected narrow locator origin to the visible global-search trigger', async () => {
    await openWorkbench(1280);
    await browser.execute(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="作用域"] button[aria-pressed="true"]')
        ?.focus(),
    );
    await browser.keys(['Meta', 'k']);
    await $('#global-locator-input').waitForDisplayed();

    await browser.setWindowSize(360, 900);
    await browser.keys('Escape');
    await browser.waitUntil(async () => !(await $('.global-locator').isExisting()));

    expect(await $('button=全局搜索').isDisplayed()).toBe(true);
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe(
      '全局搜索',
    );
  });

  it('returns an invalidated 360px list locator origin to the visible global-search trigger', async () => {
    await openWorkbench(360, false);
    await tabUntilFocused('button[role="tab"]', '资产类型');
    await browser.keys('Space');
    await $('[aria-label="作用域"]').waitForDisplayed();
    await tabUntilFocused('[aria-label="作用域"] button[aria-pressed="true"]', '当前作用域');
    await browser.keys('Enter');
    await $('[role="option"]').waitForDisplayed();
    await tabUntilFocused('[role="option"]', '资产列表首行');

    await browser.keys(['Meta', 'k']);
    await $('#global-locator-input').waitForDisplayed();
    await browser.execute(() => window.__fx01?.emitWorkspaceInvalidation());
    await browser.keys('Escape');
    await browser.waitUntil(async () => !(await $('.global-locator').isExisting()));

    expect(await $('button=全局搜索').isDisplayed()).toBe(true);
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe(
      '全局搜索',
    );
  });

  it('returns through the 360px list, scope, and type stack with restored focus', async () => {
    await openNarrowSkillDetail();

    await $('button[aria-label="返回列表"]').click();
    expect(await browser.execute(() => document.activeElement?.getAttribute('role'))).toBe(
      'option',
    );
    expect(await visibleSurfaceState()).toMatchObject({
      assetType: false,
      scope: false,
      listProjection: true,
      list: true,
      detail: false,
    });

    const backToScope = await $('button[aria-label="返回作用域"]');
    await backToScope.click();
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-pressed'))).toBe(
      'true',
    );
    expect(await visibleSurfaceState()).toMatchObject({
      assetType: false,
      scope: true,
      listProjection: false,
      list: false,
      detail: false,
    });

    const backToType = await $('button[aria-label="返回资产类型"]');
    await backToType.click();
    expect(await browser.execute(() => document.activeElement?.getAttribute('role'))).toBe('tab');
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-selected'))).toBe(
      'true',
    );
    expect(await visibleSurfaceState()).toMatchObject({
      assetType: true,
      scope: false,
      listProjection: false,
      list: false,
      detail: false,
    });
  });

  it('keeps visible list-projection control boundaries at a non-text contrast of at least 3:1', async () => {
    await openWorkbench(1280);
    const controls = await toolbarControlBorderContrasts();
    expect(controls).toHaveLength(3);
    expect(controls.filter((control) => control.contrast < 3)).toEqual([]);
  });

  it('keeps representative text, keyboard focus, and visible controls independently accessible', async () => {
    await openWorkbench(1280);
    await browser.keys('Tab');
    const accessibility = await textAndFocusAccessibility();

    expect(accessibility.textContrast).toBeGreaterThanOrEqual(4.5);
    expect(accessibility.focusContrast).toBeGreaterThanOrEqual(3);
    expect(accessibility.focusVisible).toBe(true);
    expect(accessibility.focusOutlineWidth).toBe('2px');
    expect(accessibility.namedControls).toEqual(['Skills', '全局搜索', 'Agent 筛选']);
  });

  it('flips the FX-12 global page at 20 rows, scrolls to top, and focuses the new first row', async () => {
    await openWorkbench(1280, false, FX12_VIEW_ENTRY);
    await $('button=长期指令').click();
    await $('[role="option"]').waitForDisplayed();
    expect(await $('nav[aria-label="全局分页"]').getText()).toContain('第 1 / 2 页');
    expect(await $$('[role="option"]')).toHaveLength(20);

    const scrollTop = await browser.execute(() => {
      const list = document.querySelector<HTMLElement>('.list-pane');
      if (list === null) return 0;
      list.scrollTop = list.scrollHeight;
      return list.scrollTop;
    });
    expect(scrollTop).toBeGreaterThan(0);

    await $('//nav[@aria-label="全局分页"]//button[normalize-space()="下一页"]').click();
    await browser.waitUntil(async () =>
      (await $('nav[aria-label="全局分页"]').getText()).includes('第 2 / 2 页'),
    );
    expect(await $$('[role="option"]')).toHaveLength(3);
    expect(
      await browser.execute(() => {
        const list = document.querySelector<HTMLElement>('.list-pane');
        const firstRow = document.querySelector<HTMLButtonElement>('[role="option"]');
        return list?.scrollTop === 0 && document.activeElement === firstRow;
      }),
    ).toBe(true);
  });

  it('focuses the authoritative empty heading after an FX-12 filter removes every row', async () => {
    await openWorkbench(1280, false, FX12_VIEW_ENTRY);
    await $('button=长期指令').click();
    await $('[role="option"]').waitForDisplayed();
    await $('#filter-agent').selectByAttribute('value', 'claude-code');
    const emptyHeading = await $('[data-testid="workbench-empty-heading"]');
    await emptyHeading.waitForDisplayed();
    expect(await browser.execute(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'workbench-empty-heading',
    );
  });

  it('focuses the visible empty heading after the 360px keyboard type-to-scope-to-list route', async () => {
    await openWorkbench(360, false, FX12_VIEW_ENTRY);

    await tabUntilFocused('button[role="tab"]', '资产类型');
    await browser.keys('Space');
    await $('[aria-label="作用域"]').waitForDisplayed();

    await tabUntilFocused('[aria-label="作用域"] button[aria-pressed="true"]', '当前作用域');
    await browser.keys('Enter');
    const emptyHeading = await $('[data-testid="workbench-empty-heading"]');
    await emptyHeading.waitForDisplayed();

    expect(await visibleNarrowRootSurfaces()).toEqual(['list-projection', 'list']);
    expect(await browser.execute(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'workbench-empty-heading',
    );
  });

  it('opens auxiliary context from a named keyboard-operable control on a wide read-only detail', async () => {
    await openWorkbench(1280);
    await $('[role="option"]').click();
    await $('[data-testid="skill-detail-heading"]').waitForDisplayed();

    const auxiliary = await $('button=查看辅助信息');
    expect(await auxiliary.isExisting()).toBe(true);
    await browser.execute(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-controls="detail-source-context"]')
        ?.focus(),
    );
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe(
      '查看辅助信息',
    );
    await browser.keys('Enter');
    await browser.waitUntil(() =>
      browser.execute(() => document.querySelector('details[open]') !== null),
    );
    const copyControl = await browser.execute(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
        /复制.*路径/.test(
          `${candidate.getAttribute('aria-label') ?? ''} ${candidate.textContent ?? ''}`,
        ),
      );
      button?.focus();
      return button === undefined
        ? null
        : {
            disabled: button.disabled,
            label: button.getAttribute('aria-label') ?? button.textContent,
          };
    });
    expect(copyControl).toMatchObject({ disabled: false });
    await browser.keys('Enter');
    await browser.waitUntil(() =>
      browser.execute(() =>
        [...document.querySelectorAll('[role="status"]')].some((status) =>
          ['来源路径已复制。', '无法复制来源路径。'].includes(status.textContent?.trim() ?? ''),
        ),
      ),
    );
    await browser.keys('Escape');
    await browser.waitUntil(() =>
      browser.execute(() => document.querySelector('details[open]') === null),
    );
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe(
      '查看辅助信息',
    );
  });

  it('exposes all four Skill Agent cells as labelled keyboard tab stops with stable text reasons', async () => {
    await openWorkbench(1280, true, `${ENTRY}?scenario=unknown-skill-cell`);
    await $('[role="option"]').click();
    await $('[data-testid="skill-detail-heading"]').waitForDisplayed();

    const cells = await browser.execute(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[aria-label="Skill Agent 状态（只读）"] article',
        ),
      ].map((cell) => ({
        label: cell.getAttribute('aria-label'),
        tabIndex: cell.tabIndex,
        text: cell.innerText,
      })),
    );
    expect(cells).toHaveLength(4);
    expect(cells.map((cell) => cell.label)).toEqual([
      'claude-code 状态',
      'codex 状态',
      'gemini-cli 状态',
      'opencode 状态',
    ]);
    expect(cells.every((cell) => cell.tabIndex === 0)).toBe(true);
    expect(cells.every((cell) => cell.text.includes('原因：UNKNOWN_FIELD_PRESERVED'))).toBe(true);

    await browser.execute(() =>
      document.querySelector<HTMLElement>('[aria-label="claude-code 状态"]')?.focus(),
    );
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'claude-code 状态',
    );
    await browser.keys('Tab');
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'codex 状态',
    );
  });

  it('closes only the focused history disclosure with Escape when both detail disclosures are open', async () => {
    await openWorkbench(1280, true, FE03_DRAFT_ENTRY);
    await $('button=长期指令').click();
    await $('[role="option"]').click();
    const draft = await $('[data-testid="fe03-draft-textarea"]');
    await draft.waitForDisplayed();
    const draftBefore = await draft.getValue();
    await draft.addValue('\n# fx12-disclosure-draft');
    const draftAfterEdit = await draft.getValue();

    const auxiliary = await $('button=查看辅助信息');
    await browser.execute(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-controls="detail-source-context"]')
        ?.focus(),
    );
    await browser.keys('Enter');
    await $('#detail-source-context').waitForDisplayed();
    await browser.execute(() =>
      document.querySelector<HTMLElement>('#detail-history-recovery summary')?.focus(),
    );
    await browser.keys('Enter');
    expect(await $('#detail-history-recovery').getAttribute('open')).toBe('true');
    await browser.keys('Escape');
    expect(await $('#detail-history-recovery').getAttribute('open')).toBeNull();
    expect(await $('#detail-source-context').getAttribute('open')).toBe('true');
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe(
      '历史与恢复',
    );
    expect(await draft.getValue()).toBe(draftAfterEdit);

    await browser.execute(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-controls="detail-source-context"]')
        ?.focus(),
    );
    await browser.keys('Escape');
    expect(await $('#detail-source-context').getAttribute('open')).toBeNull();
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe(
      '查看辅助信息',
    );
    expect(await draft.getValue()).toBe(draftAfterEdit);
    expect(draftAfterEdit).not.toBe(draftBefore);
    expect(await auxiliary.isDisplayed()).toBe(true);
  });

  it('keeps a dirty FE-03 detail editor as the active 360px detail surface after a viewport resize', async () => {
    await openWorkbench(1280, true, FE03_DRAFT_ENTRY);
    await $('button=长期指令').click();
    await $('[role="option"]').click();
    const editor = await $('[data-testid="fe03-draft-textarea"]');
    await editor.waitForDisplayed();
    await editor.click();
    await editor.addValue('\n# narrow-resize-dirty-draft');
    await $('[data-testid="fe03-draft-discard"]').waitForDisplayed();

    await browser.setWindowSize(360, 900);
    const narrowedEditor = await $('[data-testid="fe03-draft-textarea"]');
    await narrowedEditor.waitForDisplayed();
    expect(await visibleNarrowRootSurfaces()).toEqual(['detail']);
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute('data-testid') === 'fe03-draft-textarea',
      ),
    ).toBe(true);
    expect(await $('[data-testid="fe03-dirty-guard"]').isExisting()).toBe(false);
  });

  it('restores a dirty 360px detail editor when its current type is chosen after list and scope back navigation', async () => {
    await openWorkbench(1280, true, FE03_DRAFT_ENTRY);
    await $('button=长期指令').click();
    await $('[role="option"]').click();
    const editor = await $('[data-testid="fe03-draft-textarea"]');
    await editor.waitForDisplayed({ timeout: 4_000, timeoutMsg: '初始 FE-03 编辑器未显示' });
    await editor.click();
    await editor.addValue('\n# narrow-return-dirty-draft');
    await $('[data-testid="fe03-draft-discard"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: 'dirty draft 未显示丢弃控件',
    });

    await browser.setWindowSize(360, 900);
    await $('[data-testid="fe03-draft-textarea"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '缩窄后编辑器未保留',
    });
    await $('button[aria-label="返回列表"]').click();
    await $('[role="option"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '返回列表后未显示行',
    });
    await $('button[aria-label="返回作用域"]').click();
    await $('[aria-label="作用域"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '返回作用域后未显示作用域面',
    });
    await $('button[aria-label="返回资产类型"]').click();
    await $('[role="tablist"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '返回类型后未显示类型面',
    });

    await $('button=长期指令').click();
    const restoredEditor = await $('[data-testid="fe03-draft-textarea"]');
    await restoredEditor.waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '选择当前类型后未恢复原 dirty 编辑器',
    });
    expect(await $('[data-testid="fe03-draft-discard"]').isDisplayed()).toBe(true);
    expect(await visibleNarrowRootSurfaces()).toEqual(['detail']);
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute('data-testid') === 'fe03-draft-textarea',
      ),
    ).toBe(true);
  });

  it('restores a dirty 360px detail editor after a different type defers to keyboard continue editing', async () => {
    await openWorkbench(1280, true, FE03_DRAFT_ENTRY);
    await $('button=长期指令').click();
    await $('[role="option"]').click();
    const editor = await $('[data-testid="fe03-draft-textarea"]');
    await editor.waitForDisplayed({ timeout: 4_000, timeoutMsg: '初始 FE-03 编辑器未显示' });
    await editor.click();
    await editor.addValue('\n# narrow-continue-dirty-draft');
    await $('[data-testid="fe03-draft-discard"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: 'dirty draft 未显示丢弃控件',
    });

    await browser.setWindowSize(360, 900);
    await $('[data-testid="fe03-draft-textarea"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '缩窄后编辑器未保留',
    });
    await $('button[aria-label="返回列表"]').click();
    await $('[role="option"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '返回列表后未显示行',
    });
    await $('button[aria-label="返回作用域"]').click();
    await $('[aria-label="作用域"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '返回作用域后未显示作用域面',
    });
    await $('button[aria-label="返回资产类型"]').click();
    await $('[role="tablist"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '返回类型后未显示类型面',
    });

    const differentType = await $('button[role="tab"][aria-selected="false"]');
    await differentType.waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '返回类型后未提供可切换的其他资产类型',
    });
    await differentType.click();
    const continueEditing = await $('[data-testid="fe03-dirty-guard-continue"]');
    await continueEditing.waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '切换不同类型后未显示 dirty guard',
    });
    await tabUntilFocused('[data-testid="fe03-dirty-guard-continue"]', '继续编辑');
    await browser.keys('Enter');

    const restoredEditor = await $('[data-testid="fe03-draft-textarea"]');
    await restoredEditor.waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '继续编辑后未恢复原 dirty 编辑器',
    });
    expect(await $('[data-testid="fe03-draft-discard"]').isDisplayed()).toBe(true);
    expect(await visibleNarrowRootSurfaces()).toEqual(['detail']);
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute('data-testid') === 'fe03-draft-textarea',
      ),
    ).toBe(true);
  });

  it('keeps a reachable 360px recovery path when the next authoritative workbench read fails', async () => {
    await openWorkbench(360, false);
    await $('button=Skills').click();
    await $('[aria-label="作用域"]').waitForDisplayed();
    await $('button=全部').click();
    const row = await $('[role="option"]');
    await row.waitForDisplayed();
    await row.click();
    await $('[data-testid="skill-detail-heading"]').waitForDisplayed();

    await browser.execute(() => window.__fx01?.failNextWorkbenchRead());
    await browser.execute(() => window.__fx01?.emitWorkspaceInvalidation());
    const failure = await $('[role="alert"]');
    await failure.waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '失效后未公布可访问的 READ_FAILED 提示',
    });
    expect(await failure.getText()).toContain('READ_FAILED');
    const retry = await $('button=重试');
    await retry.waitForDisplayed();
    expect(await retry.isDisplayed()).toBe(true);
    await retry.click();

    const restoredDetail = await $('[data-testid="skill-detail-heading"]');
    await restoredDetail.waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '重试后未恢复可返回的只读详情',
    });
    const returnToList = await $('button[aria-label="返回列表"]');
    await returnToList.waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '重试成功后未提供返回列表路径',
    });
    await returnToList.click();
    const restoredList = await $('[role="option"]');
    await restoredList.waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '重试后无法重新抵达窄屏列表',
    });
    expect(await visibleNarrowRootSurfaces()).toEqual(['list-projection', 'list']);
    await restoredList.click();
    await $('[data-testid="skill-detail-heading"]').waitForDisplayed({
      timeout: 4_000,
      timeoutMsg: '从重试后的列表重新选择行时无法抵达只读详情',
    });
  });

  it('uses a separate keyboard-operable sensitive view grant that re-masks on TTL, file, asset, and revision changes', async () => {
    await openWorkbench(1280, false, FX12_VIEW_ENTRY);
    await $('button=长期指令').click();
    const maskedRow = await $(
      '//button[@role="option"][.//span[normalize-space()="Masked local instruction"]]',
    );
    await maskedRow.waitForDisplayed();
    await maskedRow.click();
    await $('[data-testid="fe10-fx12-masked-placeholder"]').waitForDisplayed();

    const callsBeforeView = await browser.execute(() => window.__fx01?.getCalls() ?? []);
    const view = await $('button=查看敏感内容');
    expect(await view.isExisting()).toBe(true);
    await browser.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === '查看敏感内容')
        ?.focus(),
    );
    await browser.keys('Enter');
    const viewSurface = await $('[aria-label="敏感内容（临时查看）"]');
    await viewSurface.waitForDisplayed();
    const viewCalls = (await browser.execute(() => window.__fx01?.getCalls() ?? [])).slice(
      callsBeforeView.length,
    );
    expect(viewCalls).toHaveLength(1);
    expect(viewCalls[0]).toMatchObject({
      method: 'read',
      queryKind: 'sensitiveReveal',
      query: { kind: 'sensitiveReveal', scope: 'view', surface: 'source' },
    });
    expect(JSON.stringify(viewCalls)).not.toContain('plaintext');
    expect(JSON.stringify(viewCalls)).not.toContain('grantId');

    await browser.waitUntil(
      async () => !(await $('[aria-label="敏感内容（临时查看）"]').isExisting()),
      { timeout: 3_500 },
    );
    expect(await $('[data-testid="fe10-fx12-masked-placeholder"]').isDisplayed()).toBe(true);

    await browser.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === '查看敏感内容')
        ?.focus(),
    );
    await browser.keys('Enter');
    await $('[aria-label="敏感内容（临时查看）"]').waitForDisplayed();

    const alternateFile = await $('button=查看源码：view-context.md');
    await alternateFile.waitForDisplayed();
    await alternateFile.click();
    await browser.waitUntil(
      async () => !(await $('[aria-label="敏感内容（临时查看）"]').isExisting()),
    );
    await $('//button[contains(normalize-space(), "查看源码：view.md")]').click();
    await $('[data-testid="fe10-fx12-masked-placeholder"]').waitForDisplayed();
    expect(await (await $('[aria-label="敏感内容（临时查看）"]')).isExisting()).toBe(false);

    await $('button=Skills').click();
    await browser.waitUntil(
      async () => !(await $('[aria-label="敏感内容（临时查看）"]').isExisting()),
    );
    await $('button=长期指令').click();
    await $('[role="option"]').waitForDisplayed();
    const remaskedRow = await $(
      '//button[@role="option"][.//span[normalize-space()="Masked local instruction"]]',
    );
    await remaskedRow.waitForDisplayed();
    await remaskedRow.click();
    expect(await (await $('[aria-label="敏感内容（临时查看）"]')).isExisting()).toBe(false);
    expect(await $('[data-testid="fe10-fx12-masked-placeholder"]').isDisplayed()).toBe(true);

    await browser.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === '查看敏感内容')
        ?.focus(),
    );
    await browser.keys('Enter');
    await $('[aria-label="敏感内容（临时查看）"]').waitForDisplayed();
    await browser.execute(() => window.__fx01?.emitWorkspaceInvalidation());
    await browser.waitUntil(
      async () => !(await $('[aria-label="敏感内容（临时查看）"]').isExisting()),
    );
    const revisionRemaskedRow = await $(
      '//button[@role="option"][.//span[normalize-space()="Masked local instruction"]]',
    );
    await revisionRemaskedRow.waitForDisplayed();
    await revisionRemaskedRow.click();
    await $('[data-testid="fe10-fx12-masked-placeholder"]').waitForDisplayed();
    expect(await (await $('[aria-label="敏感内容（临时查看）"]')).isExisting()).toBe(false);
    expect(await $('[data-testid="fe10-fx12-masked-placeholder"]').isDisplayed()).toBe(true);
  });

  it('resets detail disclosures and copy feedback when an equal asset revision changes complete AssetRef', async () => {
    await openWorkbench(1280, false, FX12_VIEW_ENTRY);
    await $('button=长期指令').click();
    await $('#page-size').selectByAttribute('value', '50');
    const globalRow = await $(
      '//button[@role="option"][.//span[normalize-space()="Masked local instruction"]]',
    );
    await globalRow.waitForDisplayed();
    await globalRow.click();
    await $('[data-testid="long-term-instruction-readonly-detail"]').waitForDisplayed();
    expect(await $('[data-testid="fe03-draft-textarea"]').isExisting()).toBe(false);

    await $('button=查看辅助信息').click();
    await browser.waitUntil(
      async () => (await $('#detail-source-context').getAttribute('open')) === 'true',
    );
    await $('#detail-history-recovery summary').click();
    await browser.waitUntil(
      async () => (await $('#detail-history-recovery').getAttribute('open')) === 'true',
    );
    await $('button=复制来源路径').click();
    const copyStatus = await $('#detail-source-context [role="status"]');
    await browser.waitUntil(async () => (await copyStatus.getText()).trim() !== '');

    const projectRow = await $(
      '//button[@role="option"][.//span[normalize-space()="Masked local instruction (project)"]]',
    );
    await projectRow.waitForDisplayed();
    await projectRow.click();
    await browser.waitUntil(async () =>
      (await $('[data-testid="long-term-instruction-readonly-detail"] h2').getText()).includes(
        'Masked local instruction (project)',
      ),
    );

    expect(
      await browser.execute(() => ({
        sourceOpen: document.querySelector('#detail-source-context')?.hasAttribute('open') ?? false,
        historyOpen:
          document.querySelector('#detail-history-recovery')?.hasAttribute('open') ?? false,
        copyStatus:
          document.querySelector('#detail-source-context [role="status"]')?.textContent?.trim() ??
          '',
      })),
    ).toEqual({ sourceOpen: false, historyOpen: false, copyStatus: '' });
    expect(await $('[data-testid="fe03-draft-textarea"]').isExisting()).toBe(false);
  });

  it('announces a failed sensitive view read with a stable accessible reason while preserving masking', async () => {
    await openWorkbench(1280, false, FX12_VIEW_FAILURE_ENTRY);
    await $('button=长期指令').click();
    const maskedRow = await $(
      '//button[@role="option"][.//span[normalize-space()="Masked local instruction"]]',
    );
    await maskedRow.waitForDisplayed();
    await maskedRow.click();
    await $('[data-testid="fe10-fx12-masked-placeholder"]').waitForDisplayed();

    const callsBeforeView = await browser.execute(() => window.__fx01?.getCalls() ?? []);
    await browser.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === '查看敏感内容')
        ?.focus(),
    );
    await browser.keys('Enter');

    const failure = await $('[role="alert"]');
    await failure.waitForDisplayed();
    expect(await failure.getText()).toContain('READ_FAILED');
    expect(await $('[data-testid="fe10-fx12-masked-placeholder"]').isDisplayed()).toBe(true);
    expect(await $('[aria-label="敏感内容（临时查看）"]').isExisting()).toBe(false);
    expect(await $('[data-testid="fe03-draft-textarea"]').isExisting()).toBe(false);

    const viewCalls = (await browser.execute(() => window.__fx01?.getCalls() ?? [])).slice(
      callsBeforeView.length,
    );
    expect(viewCalls).toHaveLength(1);
    expect(viewCalls[0]).toMatchObject({
      method: 'read',
      queryKind: 'sensitiveReveal',
      query: { kind: 'sensitiveReveal', scope: 'view', surface: 'source' },
    });
    expect(JSON.stringify(viewCalls)).not.toContain('plaintext');
    expect(JSON.stringify(viewCalls)).not.toContain('grantId');
  });
});
