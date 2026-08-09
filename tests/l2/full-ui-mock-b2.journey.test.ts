import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

const ENTRY = '/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=0';

async function openTestingStrategyDetail(scenario = 'ready'): Promise<void> {
  await browser.setWindowSize(760, 900);
  await browser.url(ENTRY.replace('scenario=ready', `scenario=${scenario}`));
  await $('.mock-frame.variant-selected').waitForDisplayed();

  await $("//button[.//span[normalize-space()='Skills']]").click();
  await $("//button[.//span[normalize-space()='ReinventedWheelAgent']]").click();
  await $(
    "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='testing-strategy']]",
  ).click();
  await $('.b2-detail-surface').waitForDisplayed();
}

async function expectNoConfirmOrSuccess(): Promise<void> {
  expect(await $('.focused-dialog').isExisting()).toBe(false);
  expect(await $('.outcome-surface').isExisting()).toBe(false);
}

async function selectProjectAndSkill(project: string, skill: string): Promise<void> {
  await $("//button[.//span[normalize-space()='Skills']]").click();
  await $(`//button[.//span[normalize-space()='${project}']]`).click();
  await $(
    `//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='${skill}']]`,
  ).click();
  await $('.b2-detail-surface').waitForDisplayed();
}

async function selectPrototypeJourney(journey: string): Promise<void> {
  const journeySelect = await $(
    '.prototype-controller .controller-fields label:nth-child(1) select',
  );
  await journeySelect.selectByAttribute('value', journey);
}

async function selectPrototypeVariant(variant: string): Promise<void> {
  const variantSelect = await $('.prototype-controller .variant-switcher select');
  await variantSelect.selectByAttribute('value', variant);
}

async function expectActiveFocusMarker(marker: string): Promise<void> {
  await browser.waitUntil(() =>
    browser.execute((expected) => {
      const target = document.querySelector(`[data-b2-focus="${expected}"]`);
      return target !== null && document.activeElement === target;
    }, marker),
  );
}

describe('selected B2 Skill browse boundary', () => {
  it('renders Agent logos as lit, gray, or blocked list toggles', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();

    const enabledRow = await $(
      "//li[contains(@class,'b2-asset-row')][.//strong[normalize-space()='api-contract-audit']]",
    );
    expect(await enabledRow.$$('[data-b2-agent-logo]').length).toBe(4);
    const codex = await enabledRow.$('input[aria-label^="Codex："]');
    const claude = await enabledRow.$('input[aria-label^="Claude Code："]');
    expect(await codex.isSelected()).toBe(true);
    expect(await claude.isSelected()).toBe(false);
    expect(
      await enabledRow.$('label:has(input[aria-label^="Codex："])').getAttribute('class'),
    ).toContain('is-enabled');

    await enabledRow.$('label:has(input[aria-label^="Claude Code："])').click();
    expect(await claude.isSelected()).toBe(true);

    const blockedRow = await $(
      "//li[contains(@class,'b2-asset-row')][.//strong[normalize-space()='code-review-checklist']]",
    );
    const blocked = await blockedRow.$('input[aria-label^="OpenCode：不可用"]');
    expect(await blocked.isEnabled()).toBe(false);
    expect(
      await blockedRow.$('label:has(input[aria-label^="OpenCode："])').getAttribute('class'),
    ).toContain('is-blocked');
  });

  it('keeps a Skill in structured view and exposes keyboard-operable session toggles', async () => {
    await openTestingStrategyDetail();

    expect(await $("//button[normalize-space()='编辑源码']").isExisting()).toBe(false);
    expect(await $("//button[normalize-space()='跨 Agent 转换']").isExisting()).toBe(false);
    expect(await $('.b2-detail-surface').getText()).toContain('Mock 会话预览，不写入配置');

    const toggles = await $$('.b2-detail-toggle input[type="checkbox"]');
    expect(toggles).toHaveLength(4);
    const codex = await $('input[aria-label^="Codex："]');
    const wasChecked = await codex.isSelected();
    await codex.click();
    expect(await codex.isSelected()).toBe(!wasChecked);
  });

  it('keeps a blocked Skill target unavailable and avoids old Skill transaction CTAs', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='agent-config-manager']]").click();
    await $("//button[.//span[normalize-space()='Skills']]").click();
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='adapter-audit']]",
    ).click();
    await $('.b2-detail-surface').waitForDisplayed();

    const blocked = await $('input[aria-label^="OpenCode：不可用"]');
    expect(await blocked.isEnabled()).toBe(false);
    expect(await $("//button[normalize-space()='准备安装']").isExisting()).toBe(false);
    expect(await $("//button[normalize-space()='准备转换']").isExisting()).toBe(false);
    await expectNoConfirmOrSuccess();
  });

  it('blocks readonly and incompatible Management entry, direct URL, and controller routes', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(
      '/?prototype=full-ui&variant=selected&journey=browse&scenario=readonly&controls=0',
    );
    await $('.selected-catalog').waitForDisplayed();

    const readonlyManage = await $("//button[normalize-space()='纳入项目']");
    expect(await readonlyManage.isEnabled()).toBe(false);
    await browser.url(
      '/?prototype=full-ui&variant=selected&journey=manage&scenario=readonly&controls=0',
    );
    await $('.selected-catalog').waitForDisplayed();
    expect(await $('.management-surface').isExisting()).toBe(false);
    await expectNoConfirmOrSuccess();

    await browser.url(
      '/?prototype=full-ui&variant=selected&journey=browse&scenario=readonly&controls=1',
    );
    await $('.selected-catalog').waitForDisplayed();
    await selectPrototypeJourney('manage');
    await $('.selected-catalog').waitForDisplayed();
    expect(await $('.management-surface').isExisting()).toBe(false);
    await expectNoConfirmOrSuccess();

    await browser.url(
      '/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=1',
    );
    await $('.selected-catalog').waitForDisplayed();
    await selectProjectAndSkill('agent-config-manager', 'adapter-audit');

    const incompatibleManage = await $("//button[normalize-space()='纳入项目']");
    expect(await incompatibleManage.isEnabled()).toBe(false);
    await selectPrototypeJourney('manage');
    await $('.b2-detail-surface').waitForDisplayed();
    expect(await $('.management-surface').isExisting()).toBe(false);
    await expectNoConfirmOrSuccess();
  });
});

describe('selected B2 Skill write-route boundary', () => {
  it('fails closed from Skill write-route links and controller resets', async () => {
    await browser.setWindowSize(1280, 900);

    for (const journey of ['edit', 'create', 'convert', 'manage']) {
      await browser.url(
        `/?prototype=full-ui&variant=selected&journey=${journey}&scenario=ready&controls=0`,
      );
      await $('.selected-catalog').waitForDisplayed();
      expect(await browser.getUrl()).toContain('journey=browse');
      expect(await $('.b2-editor-surface').isExisting()).toBe(false);
      expect(await $('.target-surface').isExisting()).toBe(false);
      expect(await $('.mapping-surface').isExisting()).toBe(false);
      expect(await $('.management-surface').isExisting()).toBe(false);
      await expectNoConfirmOrSuccess();
    }

    await browser.url(
      '/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=1',
    );
    await $('.selected-catalog').waitForDisplayed();
    for (const journey of ['edit', 'create', 'convert', 'manage']) {
      await selectPrototypeJourney(journey);
      await $('.selected-catalog').waitForDisplayed();
      expect(await browser.getUrl()).toContain('journey=browse');
      expect(await $('.b2-editor-surface').isExisting()).toBe(false);
      expect(await $('.target-surface').isExisting()).toBe(false);
      expect(await $('.mapping-surface').isExisting()).toBe(false);
      expect(await $('.management-surface').isExisting()).toBe(false);
      await expectNoConfirmOrSuccess();
    }

    for (const journey of ['edit', 'create', 'convert', 'manage']) {
      await browser.url(
        `/?prototype=full-ui&variant=A&journey=${journey}&scenario=ready&controls=1`,
      );
      await selectPrototypeVariant('selected');
      await $('.selected-catalog').waitForDisplayed();
      expect(await browser.getUrl()).toContain('journey=browse');
      expect(await $('.b2-editor-surface').isExisting()).toBe(false);
      expect(await $('.target-surface').isExisting()).toBe(false);
      expect(await $('.mapping-surface').isExisting()).toBe(false);
      expect(await $('.management-surface').isExisting()).toBe(false);
      await expectNoConfirmOrSuccess();
    }
  });

  it('keeps global Skills in structured view without old installation CTAs', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='全局配置']]").click();
    await $("//button[.//span[normalize-space()='Skills']]").click();
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='security-review']]",
    ).click();
    await $('.b2-detail-surface').waitForDisplayed();
    expect(await $("//button[normalize-space()='准备安装']").isExisting()).toBe(false);
    expect(await $("//button[normalize-space()='准备转换']").isExisting()).toBe(false);
    await expectNoConfirmOrSuccess();
  });

  it('restores project-owned and applicable global Skills after clearing project filters', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='ReinventedWheelAgent']]").click();
    await $('.selected-catalog').waitForDisplayed();
    await $('.selected-catalog .filter-button').click();
    await $(
      "//div[contains(@class,'b2-filter-popover')]//label[normalize-space()='不兼容']/input",
    ).click();
    await $(
      "//div[contains(@class,'b2-filter-popover')]//button[normalize-space()='清除']",
    ).click();

    await browser.waitUntil(
      async () => (await $('.selected-catalog .filter-button').getText()) === '筛选',
    );
    expect(await $('.b2-source-section[aria-label="项目自有资产"]').isExisting()).toBe(true);
    expect(await $('.b2-source-section[aria-label="全局适用资产"]').isExisting()).toBe(true);
    expect((await $$('.selected-asset-list .b2-source-badge.is-project')).length).toBeGreaterThan(
      0,
    );
    expect((await $$('.selected-asset-list .b2-source-badge.is-global')).length).toBeGreaterThan(0);
  });
});

describe('selected B2 long-term instruction boundary', () => {
  it('shows editable Markdown and display-only Agent status without conversion actions', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='全局配置']]").click();
    await $("//button[.//span[normalize-space()='长期指令']]").click();
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='Global AGENTS.md']]",
    ).click();
    await $('.b2-instruction-editor').waitForDisplayed();

    const textarea = await $('textarea[aria-label="AGENTS.md Markdown 草稿"]');
    expect(await textarea.isEnabled()).toBe(true);
    expect(await $('.b2-instruction-status').getText()).toContain('Codex');
    expect(await $$('.b2-instruction-status button, .b2-instruction-status input').length).toBe(0);
    const statusGeometry = await browser.execute(() => {
      const status = document.querySelector<HTMLElement>('.b2-instruction-status');
      if (status === null) return null;
      const statusRect = status.getBoundingClientRect();
      return {
        flexDirection: getComputedStyle(status).flexDirection,
        hasHorizontalOverflow: status.scrollWidth > status.clientWidth,
        childrenFit: Array.from(status.children).every((child) => {
          const childRect = child.getBoundingClientRect();
          return childRect.left >= statusRect.left && childRect.right <= statusRect.right + 1;
        }),
      };
    });
    expect(statusGeometry).toEqual({
      flexDirection: 'column',
      hasHorizontalOverflow: false,
      childrenFit: true,
    });
    expect(await $$("//button[normalize-space()='跨 Agent 转换']").length).toBe(0);
    expect(await $$("//button[normalize-space()='准备安装']").length).toBe(0);
    expect(await $$("//button[normalize-space()='准备转换']").length).toBe(0);

    await textarea.setValue((await textarea.getValue()) + '\n\n- 浏览器草稿');
    const review = await $("//button[normalize-space()='审查更改']");
    expect(await review.isEnabled()).toBe(true);
    await review.click();
    await $('.review-surface').waitForDisplayed();
    expect(await $('.review-surface').getText()).toContain('浏览器草稿');

    await $(`//button[normalize-space()='返回草稿']`).click();
    await $('.b2-instruction-editor').waitForDisplayed();
    const returnedTextarea = await $('textarea[aria-label="AGENTS.md Markdown 草稿"]');
    expect(await returnedTextarea.getValue()).toContain('浏览器草稿');
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'AGENTS.md Markdown 草稿',
    );

    await $(`//button[normalize-space()='审查更改']`).click();
    await $(`//button[normalize-space()='继续确认']`).click();
    await $(`//button[normalize-space()='确认并应用']`).click();
    await $('.outcome-surface').waitForDisplayed();
    expect(await $('.outcome-surface').getText()).toContain('APPLIED');
    expect(await $('.outcome-surface').getText()).toContain('1 个原生文件');

    await $(`//button[normalize-space()='返回资产']`).click();
    await $('.b2-instruction-editor').waitForDisplayed();
    const persistedTextarea = await $('textarea[aria-label="AGENTS.md Markdown 草稿"]');
    expect(await persistedTextarea.getValue()).toContain('浏览器草稿');
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'AGENTS.md Markdown 草稿',
    );

    await persistedTextarea.setValue((await persistedTextarea.getValue()) + '\n- dirty guard');
    await $(`//button[.//span[normalize-space()='Skills']]`).click();
    await $(`//button[normalize-space()='继续编辑']`).click();
    await $('.b2-instruction-editor').waitForDisplayed();
    expect(await $('.b2-editor-surface').isExisting()).toBe(false);
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'AGENTS.md Markdown 草稿',
    );
  });

  it('fails closed when the prototype controller requests conversion', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY.replace('controls=0', 'controls=1'));
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='全局配置']]").click();
    await $("//button[.//span[normalize-space()='长期指令']]").click();
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='Global AGENTS.md']]",
    ).click();
    await $('.b2-instruction-editor').waitForDisplayed();

    await selectPrototypeJourney('convert');
    await $('.selected-catalog').waitForDisplayed();
    expect(await browser.getUrl()).toContain('journey=browse');
    expect(await $('.target-surface').isExisting()).toBe(false);
    expect(await $('.mapping-surface').isExisting()).toBe(false);
    await expectNoConfirmOrSuccess();
  });
});

describe('selected B2 state isolation and destination truthfulness', () => {
  it('resets shared filters across selected and every legacy visual system boundary', async () => {
    await browser.setWindowSize(1440, 900);

    for (const variant of ['A', 'B', 'C']) {
      await browser.url(
        '/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=1',
      );
      await $('.selected-catalog').waitForDisplayed();
      await $('.selected-catalog .filter-button').click();
      await $(
        "//div[contains(@class,'b2-filter-popover')]//label[normalize-space()='不兼容']/input",
      ).click();
      expect(await $('.selected-catalog .filter-button').getText()).toContain('1');

      await selectPrototypeVariant(variant);
      await $('.asset-library').waitForDisplayed();

      const legacyFilter = await $('.asset-library .filter-button');
      expect(await legacyFilter.getText()).toBe('筛选');
      expect(await legacyFilter.getAttribute('aria-expanded')).toBe('false');
      expect((await $$('.asset-library .filter-popover input:checked')).length).toBe(0);
      const legacyRowCount = await $$('.asset-list .asset-row').length;
      expect(legacyRowCount).toBeGreaterThan(0);
    }

    await browser.url('/?prototype=full-ui&variant=A&journey=browse&scenario=ready&controls=1');
    await $('.asset-library').waitForDisplayed();
    await $('.asset-library .filter-button').click();
    await $(
      "//div[contains(@class,'filter-popover')]//label[normalize-space()='冲突']/input",
    ).click();
    await selectPrototypeVariant('selected');
    await $('.selected-catalog').waitForDisplayed();

    const selectedFilter = await $('.selected-catalog .filter-button');
    expect(await selectedFilter.getText()).toBe('筛选');
    expect(await selectedFilter.getAttribute('aria-expanded')).toBe('false');
    expect((await $$('.selected-catalog .b2-filter-popover input:checked')).length).toBe(0);
    const selectedRowCount = await $$('.b2-asset-row').length;
    expect(selectedRowCount).toBeGreaterThan(0);
  });

  it('resets selected filters when Alt+Arrow crosses into legacy', async () => {
    await browser.setWindowSize(1440, 900);
    await browser.url(
      '/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=0',
    );
    await $('.selected-catalog').waitForDisplayed();
    await $('.selected-catalog .filter-button').click();
    await $(
      "//div[contains(@class,'b2-filter-popover')]//label[normalize-space()='不兼容']/input",
    ).click();

    await browser.execute(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          altKey: true,
          bubbles: true,
        }),
      );
    });
    await $('.asset-library').waitForDisplayed();

    const legacyFilter = await $('.asset-library .filter-button');
    expect(await legacyFilter.getText()).toBe('筛选');
    expect(await legacyFilter.getAttribute('aria-expanded')).toBe('false');
    expect(await $$('.asset-library .filter-popover input:checked').length).toBe(0);
    const rowCount = await $$('.asset-list .asset-row').length;
    expect(rowCount).toBeGreaterThan(0);
    expect(await browser.getUrl()).toContain('variant=B');
  });
});

describe('selected B2 incompatible status and list accessibility', () => {
  it('shows one visible block reason and keeps every interactive list control as a button', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='agent-config-manager']]").click();
    await $("//button[.//span[normalize-space()='Skills']]").click();
    await $('.selected-catalog').waitForDisplayed();

    const rowSelector =
      "//li[contains(@class,'b2-asset-row')][.//strong[normalize-space()='adapter-audit']]";
    const row = await $(rowSelector);
    await row.waitForDisplayed();
    const rowText = await row.getText();
    expect(rowText).toContain('不兼容');
    expect(rowText).toContain('原因：适配器未覆盖此 Skill 结构。');
    expect(await row.$('[data-b2-icon="alert-triangle"]').isExisting()).toBe(true);
    expect(rowText).not.toContain('正常');

    const invalidRoleCount = await $$(
      '.selected-catalog [role="rowgroup"], .selected-catalog [role="row"], .selected-catalog [role="columnheader"], .selected-catalog [role="gridcell"]',
    ).length;
    expect(invalidRoleCount).toBe(0);

    const primary = await $(`${rowSelector}//button[contains(@class,'b2-row-primary')]`);
    const path = await $(`${rowSelector}//button[contains(@class,'b2-row-path')]`);
    expect(await primary.getTagName()).toBe('button');
    expect(await path.getTagName()).toBe('button');

    const primaryFocused = await browser.execute(() => {
      const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('.b2-row-primary'));
      const target = rows.find((button) => button.textContent?.includes('adapter-audit'));
      target?.focus();
      return target !== undefined && document.activeElement === target;
    });
    expect(primaryFocused).toBe(true);

    const targetToggles = await row.$$('input[type="checkbox"]');
    expect(targetToggles).toHaveLength(4);
    expect(await $('input[aria-label^="OpenCode：不可用"]').isEnabled()).toBe(false);
    await primary.click();
    await $('.b2-detail-surface').waitForDisplayed();
    expect(await $('.b2-write-block-reason').getText()).toContain('适配器未覆盖此 Skill 结构。');
    expect(await $("//button[normalize-space()='跨 Agent 转换']").isExisting()).toBe(false);
  });
});

describe('selected B2 rendered pagination focus', () => {
  it('scrolls page two to the top and focuses its first row with a multi-page fixture', async () => {
    await browser.setWindowSize(1280, 560);
    await browser.url(
      '/tests/l2/full-ui-mock-b2-pagination.html?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=0',
    );
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='ReinventedWheelAgent']]").click();
    await $('.selected-catalog').waitForDisplayed();
    expect(await $('.selected-catalog-footer').getText()).toContain('共 23 项');
    expect(await $('.b2-pagination button[aria-current="page"]').getText()).toBe('1');
    expect(await $$('.selected-asset-list .b2-asset-row').length).toBe(20);

    const scrolled = await browser.execute(() => {
      const list = document.querySelector<HTMLElement>('.selected-catalog-list');
      if (list === null) return 0;
      list.scrollTop = list.scrollHeight;
      return list.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    await $('button[aria-label="下一页"]').click();
    await browser.waitUntil(() =>
      browser.execute(() => {
        const current = document.querySelector('.b2-pagination button[aria-current="page"]');
        const list = document.querySelector<HTMLElement>('.selected-catalog-list');
        const first = document.querySelector<HTMLButtonElement>(
          '.selected-asset-list .b2-row-primary',
        );
        return (
          current?.textContent?.trim() === '2' &&
          list?.scrollTop === 0 &&
          first !== null &&
          document.activeElement === first
        );
      }),
    );

    expect(await $$('.selected-asset-list .b2-asset-row').length).toBe(3);
    expect(await $('.b2-pagination button[aria-current="page"]').getText()).toBe('2');
    expect(
      await browser.execute(
        () => document.querySelector<HTMLElement>('.selected-catalog-list')?.scrollTop ?? -1,
      ),
    ).toBe(0);
    expect(
      await browser.execute(
        () =>
          document.activeElement ===
          document.querySelector<HTMLButtonElement>('.selected-asset-list .b2-row-primary'),
      ),
    ).toBe(true);
  });
});

describe('selected B2 responsive Agent target geometry', () => {
  it('keeps chips and target rows uncut across the compact/wide boundary', async () => {
    for (const width of [1280, 1320, 1321, 1360, 1361, 1373, 1374, 1499, 1500, 1540, 1560, 1586]) {
      await browser.setWindowSize(width, 900);
      await browser.url(ENTRY);
      await $('.b2-row-targets').waitForDisplayed();

      const metrics = await browser.execute(() => ({
        viewportWidth: window.innerWidth,
        documentOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        chips: Array.from(document.querySelectorAll<HTMLElement>('.b2-agent-toggle')).map(
          (chip) => ({
            clientWidth: chip.clientWidth,
            scrollWidth: chip.scrollWidth,
          }),
        ),
        rows: Array.from(document.querySelectorAll<HTMLElement>('.b2-row-targets')).map((row) => ({
          clientWidth: row.clientWidth,
          scrollWidth: row.scrollWidth,
        })),
      }));

      expect(metrics.documentOverflow).toBe(false);
      expect(metrics.chips.length > 0).toBe(true);
      expect(
        metrics.chips.every(({ clientWidth, scrollWidth }) => clientWidth >= scrollWidth),
      ).toBe(true);
      expect(metrics.rows.every(({ clientWidth, scrollWidth }) => clientWidth >= scrollWidth)).toBe(
        true,
      );
    }
  });

  it('aligns every Agent column header logo with its first-row toggle on the wide layout', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.b2-table-head').waitForDisplayed();

    const pairs = await browser.execute(() => {
      const head = document.querySelector<HTMLElement>('.b2-table-head');
      const firstRow = document.querySelector<HTMLElement>('.selected-asset-list .b2-asset-row');
      const list = document.querySelector<HTMLElement>('.selected-catalog-list');
      return {
        headInsideList: list !== null && head !== null && list.contains(head),
        heads: Array.from(document.querySelectorAll<HTMLElement>('.b2-head-agent')).map(
          (el) => el.getBoundingClientRect().x,
        ),
        toggles: firstRow
          ? Array.from(firstRow.querySelectorAll<HTMLElement>('.b2-agent-toggle')).map(
              (el) => el.getBoundingClientRect().x,
            )
          : [],
      };
    });

    expect(pairs.headInsideList).toBe(true);
    expect(pairs.heads).toHaveLength(4);
    expect(pairs.toggles).toHaveLength(4);
    pairs.heads.forEach((x, index) => {
      expect(Math.abs(x - pairs.toggles[index])).toBeLessThanOrEqual(1);
    });
  });
});

describe('selected B2 browser QA correction contracts', () => {
  it('keeps critical reachable text at 12px or above', async () => {
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $('.selected-catalog .filter-button').click();
    await $('.b2-filter-popover').waitForDisplayed();
    const filterFontSizes = await browser.execute(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.variant-selected .b2-filter-popover legend, .variant-selected .b2-filter-popover label',
        ),
        (element) => Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    );
    expect(filterFontSizes.length).toBeGreaterThan(0);
    expect(filterFontSizes.every((fontSize) => fontSize >= 12)).toBe(true);

    await browser.url(ENTRY);
    await browser.execute(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
      );
    });
    await $('.global-search-dialog').waitForDisplayed();
    const globalSearchFontSizes = await browser.execute(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.global-search-results section > button strong, .global-search-results section > button small',
        ),
        (element) => Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    );
    expect(globalSearchFontSizes.length).toBeGreaterThan(0);
    expect(globalSearchFontSizes.every((fontSize) => fontSize >= 12)).toBe(true);

    await browser.url(ENTRY.replace('scenario=ready', 'scenario=stale'));
    const staleStatus = await $('.selected-header-status .status-dot.warning');
    await staleStatus.waitForDisplayed();
    const staleFontSize = await browser.execute(() => {
      const element = document.querySelector<HTMLElement>(
        '.selected-header-status .status-dot.warning',
      );
      return element === null ? 0 : Number.parseFloat(getComputedStyle(element).fontSize);
    });
    expect(staleFontSize).toBeGreaterThanOrEqual(12);
  });

  it('keeps 1280 three-column and sends 840 and 760 through the existing narrow steps', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    expect(await $('.mock-frame.variant-selected').getAttribute('data-b2-narrow')).toBe(null);
    expect(await $('.config-context-sidebar').isDisplayed()).toBe(true);
    expect(await $('.b2-layout > .asset-type-rail').isDisplayed()).toBe(true);
    expect(await $('.selected-catalog').isDisplayed()).toBe(true);

    for (const width of [840, 760]) {
      await browser.setWindowSize(width, 900);
      await browser.url(ENTRY);
      const frame = await $('.mock-frame.variant-selected');
      await frame.waitForDisplayed();
      expect(await frame.getAttribute('data-b2-narrow')).toBe('true');
      await $('.b2-layout > .asset-type-rail').waitForDisplayed();
      expect(await $('.config-context-sidebar').isExisting()).toBe(false);
      expect(await $('.selected-catalog').isExisting()).toBe(false);

      await $(`//button[.//span[normalize-space()='Skills']]`).click();
      await $('.config-context-sidebar').waitForDisplayed();
      expect(await $('.b2-layout > .asset-type-rail').isExisting()).toBe(false);

      await $(`//button[.//span[normalize-space()='ReinventedWheelAgent']]`).click();
      await $('.selected-catalog').waitForDisplayed();
      expect(await $('.config-context-sidebar').isExisting()).toBe(false);
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
  });

  it('restores filter focus on Escape and keeps one nonvisual accessible list heading', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();

    const heading = await browser.execute(() => {
      const element = document.querySelector<HTMLElement>(
        '.selected-catalog-heading h1.b2-visually-hidden',
      );
      if (element === null) return null;
      const style = getComputedStyle(element);
      return {
        text: element.textContent?.trim() ?? '',
        tagName: element.tagName,
        ariaHidden: element.getAttribute('aria-hidden'),
        position: style.position,
        width: style.width,
        height: style.height,
        visualHeadingCount: document.querySelectorAll(
          '.selected-catalog-heading h1:not(.b2-visually-hidden)',
        ).length,
      };
    });
    expect(heading).toEqual({
      text: 'Skills 资产列表',
      tagName: 'H1',
      ariaHidden: null,
      position: 'absolute',
      width: '1px',
      height: '1px',
      visualHeadingCount: 0,
    });

    const filterButton = await $('.selected-catalog .filter-button');
    await filterButton.click();
    await $('.b2-filter-popover').waitForDisplayed();
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await $('.b2-filter-popover').waitForExist({ reverse: true });
    await browser.waitUntil(
      async () =>
        await browser.execute(
          () =>
            document.activeElement ===
            document.querySelector<HTMLButtonElement>('.selected-catalog .filter-button'),
        ),
    );
  });
});

describe('selected B2 content master-detail', () => {
  it('selects instruction rows in place and guards the dirty draft across selection', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='长期指令']]").click();
    await $('.b2-master-detail').waitForDisplayed();

    expect(await $('.b2-master-detail .selected-catalog').isDisplayed()).toBe(true);
    expect(await $('.b2-master-detail .b2-instruction-editor').isDisplayed()).toBe(true);
    const initialRow = await $('.b2-master-detail .b2-asset-row.is-selected');
    expect(await initialRow.getText()).toContain('AGENTS.md');
    expect(await initialRow.$('button[aria-current="true"]').isExisting()).toBe(true);

    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='Global AGENTS.md']]",
    ).click();
    await browser.waitUntil(
      async () => (await $('.b2-detail-surface h1').getText()) === 'Global AGENTS.md',
    );
    expect(await $('.b2-master-detail .selected-catalog').isDisplayed()).toBe(true);
    expect(await $('.b2-master-detail .b2-asset-row.is-selected').getText()).toContain(
      'Global AGENTS.md',
    );

    const textarea = await $('textarea[aria-label="AGENTS.md Markdown 草稿"]');
    await textarea.setValue((await textarea.getValue()) + '\n\n- 主从草稿');
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='AGENTS.md']]",
    ).click();
    await $('.focused-dialog').waitForDisplayed();

    await $("//button[normalize-space()='继续编辑']").click();
    await $('.focused-dialog').waitForExist({ reverse: true });
    expect(await $('.b2-detail-surface h1').getText()).toBe('Global AGENTS.md');
    expect(await $('.b2-master-detail .b2-asset-row.is-selected').getText()).toContain(
      'Global AGENTS.md',
    );
    expect(await $('textarea[aria-label="AGENTS.md Markdown 草稿"]').getValue()).toContain(
      '主从草稿',
    );
    expect(await browser.execute(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'AGENTS.md Markdown 草稿',
    );

    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='AGENTS.md']]",
    ).click();
    await $('.focused-dialog').waitForDisplayed();
    await $("//button[normalize-space()='放弃更改并继续']").click();
    await browser.waitUntil(
      async () => (await $('.b2-detail-surface h1').getText()) === 'AGENTS.md',
    );
    expect(await $('textarea[aria-label="AGENTS.md Markdown 草稿"]').getValue()).not.toContain(
      '主从草稿',
    );
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('aria-label') ?? null),
    ).toBe('查看资产：AGENTS.md');
  });

  it('shows Subagents structured info with a read-only body in master-detail', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='Subagents']]").click();
    await $('.b2-master-detail').waitForDisplayed();

    expect(await $('.b2-master-detail .selected-catalog').isDisplayed()).toBe(true);
    expect(await $('.b2-detail-surface').getText()).toContain('结构化信息');
    const body = await $('.b2-subagent-body');
    expect(await body.isDisplayed()).toBe(true);
    const bodyText = await browser.execute(() => {
      const section = document.querySelector('.b2-subagent-body');
      return section?.textContent ?? '';
    });
    expect(bodyText).toContain('migration-reviewer');
    expect(await body.$$('textarea').length).toBe(0);

    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='research-scout']]",
    ).click();
    await browser.waitUntil(
      async () => (await $('.b2-detail-surface h1').getText()) === 'research-scout',
    );
    expect(
      await browser.execute(() => document.querySelector('.b2-subagent-body')?.textContent ?? ''),
    ).toContain('research-scout');
    expect(await $('.b2-master-detail .selected-catalog').isDisplayed()).toBe(true);
  });

  it('falls back to the single-surface stack below the narrow breakpoint', async () => {
    await browser.setWindowSize(840, 900);
    await browser.url(ENTRY);
    const frame = await $('.mock-frame.variant-selected');
    await frame.waitForDisplayed();
    expect(await frame.getAttribute('data-b2-narrow')).toBe('true');

    await $("//button[.//span[normalize-space()='长期指令']]").click();
    await $("//button[.//span[normalize-space()='ReinventedWheelAgent']]").click();
    await $('.selected-catalog').waitForDisplayed();
    expect(await $('.b2-master-detail').isExisting()).toBe(false);
    expect(await $('.b2-instruction-editor').isExisting()).toBe(false);

    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='Global AGENTS.md']]",
    ).click();
    await $('.b2-instruction-editor').waitForDisplayed();
    expect(await $('.b2-master-detail').isExisting()).toBe(false);
    expect(await $('.selected-catalog').isExisting()).toBe(false);

    await $('.b2-stack-back').click();
    await $('.selected-catalog').waitForDisplayed();
    expect(await $('.b2-instruction-editor').isExisting()).toBe(false);
  });
});

describe('legacy A/B/C keyboard and dirty-guard behavior', () => {
  for (const variant of ['A', 'B', 'C'] as const) {
    it(`preserves ${variant} search, Escape, focus restoration, and Continue Editing`, async () => {
      await browser.setWindowSize(1440, 900);
      await browser.url(
        `/?prototype=full-ui&variant=${variant}&journey=edit&scenario=dirty&controls=0`,
      );
      await $('.asset-workspace').waitForDisplayed();

      await browser.execute(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: true,
            bubbles: true,
          }),
        );
      });
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => document.activeElement?.getAttribute('aria-label') ?? null,
          )) === '搜索资产',
      );

      const convertButton = await $(
        "//div[contains(@class,'asset-workspace')]//button[normalize-space()='转换…']",
      );
      await convertButton.click();
      await $('.focused-dialog').waitForDisplayed();

      await browser.execute(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await $('.focused-dialog').waitForExist({ reverse: true });
      await browser.waitUntil(
        async () =>
          (await browser.execute(() => document.activeElement?.textContent?.trim() ?? null)) ===
          '转换…',
      );

      const convertButtonAfterEscape = await $(
        "//div[contains(@class,'asset-workspace')]//button[normalize-space()='转换…']",
      );
      await convertButtonAfterEscape.click();
      await $('.focused-dialog').waitForDisplayed();
      await $("//button[normalize-space()='继续编辑']").click();
      await $('.focused-dialog').waitForExist({ reverse: true });
      expect(await browser.getUrl()).toContain('journey=edit');
      await browser.waitUntil(
        async () =>
          (await browser.execute(() => document.activeElement?.textContent?.trim() ?? null)) ===
          '转换…',
      );
    });
  }
});

describe('selected B2 all-source aggregation', () => {
  it('lands on Skills + 全部 with fixed sections, sticky aligned head, and aggregate pagination', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();

    // 默认落地：第一栏 Skills，第二栏 全部
    const selectedType = await $("//nav[@aria-label='资产类型']//button[@aria-current='page']");
    expect(await selectedType.getText()).toContain('Skills');
    const selectedScope = await $('.config-context-sidebar .context-primary.is-selected');
    expect(await selectedScope.getText()).toContain('全部');
    expect(await selectedScope.getAttribute('aria-current')).toBe('page');

    // 面包屑与摘要
    const breadcrumb = await $('.selected-catalog-heading .asset-breadcrumb').getText();
    expect(breadcrumb).toContain('全部');
    expect(breadcrumb).toContain('Skills');
    expect(await $('.selected-catalog-heading p').getText()).toBe('14 项全部来源资产');

    // 分段顺序与计数：全局适用 → agent-config-manager → mobile-tooling → ReinventedWheelAgent
    const sectionTexts = await browser.execute(() =>
      Array.from(
        document.querySelectorAll('.selected-asset-list > li.b2-source-section'),
        (element) => element.textContent?.trim() ?? '',
      ),
    );
    expect(sectionTexts).toEqual([
      '全局适用 · 2 项',
      'agent-config-manager · 2 项',
      'mobile-tooling · 2 项',
      'ReinventedWheelAgent · 8 项',
    ]);
    expect(await $$('.selected-asset-list .b2-asset-row').length).toBe(14);

    // 分页基数 = 聚合总数：单页且翻页按钮禁用
    expect(await $('.selected-catalog-footer').getText()).toContain('共 14 项');
    const currentPages = await $$('.b2-pagination button[aria-current="page"]');
    expect(currentPages).toHaveLength(1);
    expect(await currentPages[0].getText()).toBe('1');
    expect(await $('.b2-pagination button[aria-label="上一页"]').isEnabled()).toBe(false);
    expect(await $('.b2-pagination button[aria-label="下一页"]').isEnabled()).toBe(false);

    // sticky 表头与 Agent 分列在聚合视图下几何对齐
    const geometry = await browser.execute(() => {
      const head = document.querySelector<HTMLElement>('.b2-table-head');
      const firstRow = document.querySelector<HTMLElement>('.selected-asset-list .b2-asset-row');
      const list = document.querySelector<HTMLElement>('.selected-catalog-list');
      return {
        headPosition: head === null ? '' : getComputedStyle(head).position,
        headInsideList: list !== null && head !== null && list.contains(head),
        heads: Array.from(document.querySelectorAll<HTMLElement>('.b2-head-agent')).map(
          (el) => el.getBoundingClientRect().x,
        ),
        toggles: firstRow
          ? Array.from(firstRow.querySelectorAll<HTMLElement>('.b2-agent-toggle')).map(
              (el) => el.getBoundingClientRect().x,
            )
          : [],
      };
    });
    expect(geometry.headPosition).toBe('sticky');
    expect(geometry.headInsideList).toBe(true);
    expect(geometry.heads).toHaveLength(4);
    expect(geometry.toggles).toHaveLength(4);
    geometry.heads.forEach((x, index) => {
      expect(Math.abs(x - geometry.toggles[index])).toBeLessThanOrEqual(1);
    });
  });

  it('narrows to a project scope and restores the aggregate with type and sort kept', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();

    const firstRowName = async (): Promise<string> =>
      $('.selected-asset-list .b2-asset-row .b2-row-primary strong').getText();
    expect(await firstRowName()).toBe('security-review');

    // 切到降序：排序状态应跨作用域保持
    await $('.b2-sort-button').click();
    await browser.waitUntil(
      async () =>
        (await $('.b2-sort-button').getAttribute('aria-label'))?.includes('降序') === true,
    );
    expect(await firstRowName()).toBe('technical-writing');

    // 全部 → ReinventedWheelAgent：A 布局两段，排序保持
    await $("//button[.//span[normalize-space()='ReinventedWheelAgent']]").click();
    await $('.b2-source-section[aria-label="项目自有资产"]').waitForDisplayed();
    expect(await $('.b2-source-section[aria-label="全局适用资产"]').isExisting()).toBe(true);
    expect(await $$('.b2-source-section').length).toBe(2);
    expect(await $('.selected-catalog-heading p').getText()).toBe('10 项项目自有与全局适用资产');
    expect(await $('.b2-sort-button').getAttribute('aria-label')).toContain('降序');

    // 回到全部：聚合恢复，类型与排序不变
    await $(
      "//button[contains(@class,'context-primary')][.//span[normalize-space()='全部']]",
    ).click();
    await browser.waitUntil(async () => (await $$('.b2-source-section').length) === 4);
    const sectionTexts = await browser.execute(() =>
      Array.from(
        document.querySelectorAll('.selected-asset-list > li.b2-source-section'),
        (element) => element.textContent?.trim() ?? '',
      ),
    );
    expect(sectionTexts).toEqual([
      '全局适用 · 2 项',
      'agent-config-manager · 2 项',
      'mobile-tooling · 2 项',
      'ReinventedWheelAgent · 8 项',
    ]);
    expect(await $('.selected-catalog-heading p').getText()).toBe('14 项全部来源资产');
    expect(await $('.b2-sort-button').getAttribute('aria-label')).toContain('降序');
    expect(await firstRowName()).toBe('technical-writing');
    const selectedType = await $("//nav[@aria-label='资产类型']//button[@aria-current='page']");
    expect(await selectedType.getText()).toContain('Skills');
  });
});

describe('selected B2 narrow type-first stack', () => {
  it('walks type → context → list → detail and back with focus landing on each step', async () => {
    await browser.setWindowSize(840, 900);
    await browser.url(ENTRY);
    const frame = await $('.mock-frame.variant-selected');
    await frame.waitForDisplayed();
    expect(await frame.getAttribute('data-b2-narrow')).toBe('true');

    // 类型栏为栈底
    await $('.b2-layout > .asset-type-rail').waitForDisplayed();
    expect(await $('.config-context-sidebar').isExisting()).toBe(false);
    expect(await $('.selected-catalog').isExisting()).toBe(false);
    await expectActiveFocusMarker('type');

    // 类型 → 作用域
    await $("//nav[@aria-label='资产类型']//button[.//span[normalize-space()='Skills']]").click();
    await $('.config-context-sidebar').waitForDisplayed();
    expect(await $('.b2-layout > .asset-type-rail').isExisting()).toBe(false);
    await expectActiveFocusMarker('context');
    expect(await browser.execute(() => document.activeElement?.textContent ?? '')).toContain(
      '全部',
    );

    // 作用域 → 列表
    await $(
      "//button[contains(@class,'context-primary')][.//span[normalize-space()='全部']]",
    ).click();
    await $('.selected-catalog').waitForDisplayed();
    expect(await $('.config-context-sidebar').isExisting()).toBe(false);
    await expectActiveFocusMarker('list');
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('aria-label') ?? ''),
    ).toBe('查看 Skill：commit-conventions');

    // 列表 → 详情
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='security-review']]",
    ).click();
    await $('.b2-detail-surface').waitForDisplayed();
    expect(await $('.selected-catalog').isExisting()).toBe(false);
    await expectActiveFocusMarker('detail');
    expect(await browser.execute(() => document.activeElement?.textContent ?? '')).toContain(
      '返回列表',
    );

    // 详情 → 列表：选择保持
    await $('.b2-detail-surface .b2-stack-back').click();
    await $('.selected-catalog').waitForDisplayed();
    expect(await $('.b2-detail-surface').isExisting()).toBe(false);
    expect(await $('.b2-asset-row.is-selected').getText()).toContain('security-review');
    await expectActiveFocusMarker('list');
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('aria-label') ?? ''),
    ).toBe('查看 Skill：security-review');

    // 列表 → 作用域：作用域选择保持
    await $('.selected-catalog .b2-stack-back').click();
    await $('.config-context-sidebar').waitForDisplayed();
    expect(await $('.selected-catalog').isExisting()).toBe(false);
    expect(await $('.config-context-sidebar .context-primary.is-selected').getText()).toContain(
      '全部',
    );
    await expectActiveFocusMarker('context');

    // 作用域 → 类型：类型选择保持
    await $('.rail-context-back').click();
    await $('.b2-layout > .asset-type-rail').waitForDisplayed();
    expect(await $('.config-context-sidebar').isExisting()).toBe(false);
    expect(
      await $("//nav[@aria-label='资产类型']//button[@aria-current='page']").getText(),
    ).toContain('Skills');
    await expectActiveFocusMarker('type');
  });
});

describe('selected B2 all-scope master-detail', () => {
  it('shows each instruction its own source and guards drafts across cross-source selection', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await $('.selected-catalog').waitForDisplayed();
    await $("//button[.//span[normalize-space()='长期指令']]").click();
    await $('.b2-master-detail').waitForDisplayed();

    // 全部作用域下的四个来源分段
    const sectionTexts = await browser.execute(() =>
      Array.from(
        document.querySelectorAll('.b2-master-detail .b2-source-section'),
        (element) => element.textContent?.trim() ?? '',
      ),
    );
    expect(sectionTexts).toEqual([
      '全局适用 · 1 项',
      'agent-config-manager · 1 项',
      'mobile-tooling · 1 项',
      'ReinventedWheelAgent · 1 项',
    ]);

    const sourceValue = async (): Promise<string> =>
      $(
        "//section[contains(@class,'b2-instruction-status')]//dt[normalize-space()='来源']/following-sibling::dd",
      ).getText();

    // 默认选中项目资产：来源显示自身项目名而非“全部”
    expect(await $('.b2-detail-surface h1').getText()).toBe('AGENTS.md');
    expect(await sourceValue()).toBe('ReinventedWheelAgent');
    expect(await $('.selected-detail-header .asset-breadcrumb').getText()).toContain('全部');

    // 切到全局资产：来源显示全局配置
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='Global AGENTS.md']]",
    ).click();
    await browser.waitUntil(
      async () => (await $('.b2-detail-surface h1').getText()) === 'Global AGENTS.md',
    );
    expect(await sourceValue()).toBe('全局配置');

    // 草稿产生后跨来源切换被 guard 拦截
    const textarea = await $('textarea[aria-label="AGENTS.md Markdown 草稿"]');
    await textarea.setValue((await textarea.getValue()) + '\n\n- 全部视图草稿');
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='GEMINI.md']]",
    ).click();
    await $('.focused-dialog').waitForDisplayed();
    await $("//button[normalize-space()='继续编辑']").click();
    await $('.focused-dialog').waitForExist({ reverse: true });
    expect(await $('.b2-detail-surface h1').getText()).toBe('Global AGENTS.md');
    expect(await sourceValue()).toBe('全局配置');
    expect(await $('textarea[aria-label="AGENTS.md Markdown 草稿"]').getValue()).toContain(
      '全部视图草稿',
    );

    // 放弃更改后切换生效，来源跟随新资产
    await $(
      "//button[contains(@class,'b2-row-primary')][.//strong[normalize-space()='GEMINI.md']]",
    ).click();
    await $('.focused-dialog').waitForDisplayed();
    await $("//button[normalize-space()='放弃更改并继续']").click();
    await browser.waitUntil(
      async () => (await $('.b2-detail-surface h1').getText()) === 'GEMINI.md',
    );
    expect(await sourceValue()).toBe('mobile-tooling');
  });
});
