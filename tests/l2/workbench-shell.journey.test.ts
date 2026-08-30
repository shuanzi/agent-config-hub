import { $, $$, browser, expect } from '@wdio/globals';

const ENTRY = '/tests/l2/workbench.html';

async function waitForStable(): Promise<void> {
  await browser.waitUntil(async () => {
    const loaders = await $$('.spin');
    return (await loaders.length) === 0;
  });
}

async function expectNoHorizontalOverflow(): Promise<void> {
  const hasOverflow = await browser.execute(() => {
    const root = document.documentElement;
    return root.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth;
  });
  expect(hasOverflow).toBe(false);
}

describe('Workbench shell and visual fixture', () => {
  it('shows the type rail, configuration-context rail and workspace at the desktop breakpoint', async () => {
    await browser.setWindowSize(1200, 900);
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    await $("[data-workbench-rail='asset-type']").waitForDisplayed();
    await $("[data-workbench-rail='context']").waitForDisplayed();
    expect(await $("[data-workbench-rail='agent']").isExisting()).toBe(false);
    await $('.app-main-surface').waitForDisplayed();
  });

  it('skips the context rail and places settings next to the type rail on desktop', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    const settings = await $(
      "//*[@data-workbench-rail='asset-type']//button[normalize-space()='设置']",
    );
    await settings.click();
    expect(await $("[data-workbench-rail='context']").isExisting()).toBe(false);
    await $('.app-main-surface').waitForDisplayed();

    const geometry = await browser.execute(() => {
      const assetTypeRail = document.querySelector<HTMLElement>(
        "[data-workbench-rail='asset-type']",
      );
      const settingsSurface = document.querySelector<HTMLElement>('.app-main-surface');
      return {
        assetRight: assetTypeRail?.getBoundingClientRect().right ?? Number.NaN,
        surfaceLeft: settingsSurface?.getBoundingClientRect().left ?? Number.NaN,
      };
    });
    expect(Math.abs(geometry.surfaceLeft - geometry.assetRight)).toBeLessThanOrEqual(1);
  });

  it('switches between all and real same-name project contexts by stable projectId on desktop', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    const contextRail = await $("nav[aria-label='配置上下文']");
    await contextRail.waitForDisplayed();

    const allContext = await contextRail.$(".//button[normalize-space()='全部']");
    const projectHeading = await contextRail.$(".//*[normalize-space()='项目配置']");
    const alphaProject = await contextRail.$("[data-project-id='visual-project-alpha']");
    const betaProject = await contextRail.$("[data-project-id='visual-project-beta']");

    await allContext.waitForDisplayed();
    await projectHeading.waitForDisplayed();
    await alphaProject.waitForDisplayed();
    await betaProject.waitForDisplayed();
    expect(await allContext.getAttribute('aria-current')).toBe('page');
    expect(await alphaProject.getText()).toContain('同名项目');
    expect(await betaProject.getText()).toContain('同名项目');

    await betaProject.click();
    expect(await betaProject.getAttribute('aria-current')).toBe('page');
    expect(await alphaProject.getAttribute('aria-current')).toBeNull();
    expect(await allContext.getAttribute('aria-current')).toBeNull();

    await allContext.click();
    expect(await allContext.getAttribute('aria-current')).toBe('page');
    expect(await betaProject.getAttribute('aria-current')).toBeNull();
  });

  it('manages an empty project from the rail by its opaque projectId', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(ENTRY);
    await waitForStable();

    const contextRail = await $("nav[aria-label='配置上下文']");
    await contextRail.waitForDisplayed();

    const addProject = await $("[data-workbench-rail='context'] button[aria-label='添加项目']");
    await addProject.click();
    const addDialog = await $("[role='dialog']");
    await addDialog.waitForDisplayed();
    const addInputs = await addDialog.$$('input');
    await addInputs[0].setValue('/workspaces/l2-project-alpha');
    await addInputs[1].setValue('L2 同名项目');
    await addDialog.$('button=添加项目').click();

    const firstProject = await contextRail.$("[data-project-id='mock-project-1']");
    await firstProject.waitForDisplayed();
    expect(await firstProject.getText()).toContain('L2 同名项目');

    await addProject.click();
    const secondAddDialog = await $("[role='dialog']");
    const secondAddInputs = await secondAddDialog.$$('input');
    await secondAddInputs[0].setValue('/workspaces/l2-project-beta');
    await secondAddInputs[1].setValue('L2 同名项目');
    await secondAddDialog.$('button=添加项目').click();

    const secondProject = await contextRail.$("[data-project-id='mock-project-2']");
    await secondProject.waitForDisplayed();
    expect(await secondProject.getText()).toContain('L2 同名项目');

    const relink = await contextRail.$(
      "button[aria-label='重新关联 L2 同名项目（/workspaces/l2-project-alpha）']",
    );
    await relink.click();
    const relinkDialog = await $("[role='dialog']");
    const relinkInput = await relinkDialog.$('input');
    await relinkInput.setValue('/workspaces/l2-project-alpha-relinked');
    await relinkDialog.$('button=重新关联').click();

    expect(await firstProject.getAttribute('data-project-id')).toBe('mock-project-1');
    expect(await firstProject.getAttribute('title')).toBe('/workspaces/l2-project-alpha-relinked');
    expect(await secondProject.getAttribute('title')).toBe('/workspaces/l2-project-beta');

    const remove = await contextRail.$(
      "button[aria-label='移除 L2 同名项目（/workspaces/l2-project-alpha-relinked）']",
    );
    await remove.click();
    const removeDialog = await $("[role='dialog']");
    await removeDialog.$('button=移除项目').click();
    await browser.waitUntil(async () => !(await firstProject.isExisting()));
    expect(await secondProject.isExisting()).toBe(true);
  });

  it('shows a structured unavailable-project-root error as an alert', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url(`${ENTRY}?fixture=visual&scenario=project-root-unavailable`);
    await waitForStable();

    const unavailableProject = await $("[data-project-id='visual-project-alpha']");
    await unavailableProject.click();

    const alert = await $("[role='alert']");
    await alert.waitForDisplayed();
    const alertText = await alert.getText();
    expect(alertText).toContain('项目目录不可用');
    expect(alertText).not.toContain('PROJECT_ROOT_UNAVAILABLE');
  });

  it('uses a type, context, content stack below the desktop breakpoint', async () => {
    await browser.setViewport({ width: 1199, height: 900 });
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    await $("[data-workbench-rail='asset-type']").waitForDisplayed();
    expect(await $("[data-workbench-rail='context']").isExisting()).toBe(false);
    expect(await $('.app-main-surface').isExisting()).toBe(false);

    const skills = await $(
      "//*[@data-workbench-rail='asset-type']//button[normalize-space()='Skills']",
    );
    await skills.click();
    await $("[data-workbench-rail='context']").waitForDisplayed();
    expect(await $("[data-workbench-rail='asset-type']").isExisting()).toBe(false);

    const allContext = await $(
      "//*[@data-workbench-rail='context']//button[normalize-space()='全部']",
    );
    await allContext.click();
    await $('.app-main-surface').waitForDisplayed();
    expect(await $("[data-workbench-rail='context']").isExisting()).toBe(false);
    await $('.skill-table').waitForDisplayed();
    const tableLayout = await browser.execute(() => {
      const table = document.querySelector<HTMLElement>('.skill-table');
      const row = document.querySelector<HTMLElement>('.skill-table .skill-row');
      const cell = document.querySelector<HTMLElement>('.skill-table .skill-row > td');
      const headers = Array.from(table?.querySelectorAll<HTMLElement>('th') ?? []);
      const tableRect = table?.getBoundingClientRect();
      return {
        tableDisplay: table ? getComputedStyle(table).display : '',
        rowDisplay: row ? getComputedStyle(row).display : '',
        cellDisplay: cell ? getComputedStyle(cell).display : '',
        headerCount: headers.length,
        tableLeft: tableRect?.left ?? Number.NaN,
        tableRight: tableRect?.right ?? Number.NaN,
        viewportWidth: window.innerWidth,
      };
    });
    expect(tableLayout.tableDisplay).toBe('table');
    expect(tableLayout.rowDisplay).toBe('table-row');
    expect(tableLayout.cellDisplay).toBe('table-cell');
    expect(tableLayout.headerCount).toBe(5);
    expect(tableLayout.tableLeft).toBeGreaterThanOrEqual(0);
    expect(tableLayout.tableRight).toBeLessThanOrEqual(tableLayout.viewportWidth + 1);
    await expectNoHorizontalOverflow();
  });

  it('does not overflow horizontally at 390px through the narrow navigation path', async () => {
    await browser.setViewport({ width: 390, height: 844 });
    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();

    await expectNoHorizontalOverflow();

    const skills = await $(
      "//*[@data-workbench-rail='asset-type']//button[normalize-space()='Skills']",
    );
    await skills.click();
    await expectNoHorizontalOverflow();

    const allContext = await $(
      "//*[@data-workbench-rail='context']//button[normalize-space()='全部']",
    );
    await allContext.click();
    await $('.app-main-surface').waitForDisplayed();
    await expectNoHorizontalOverflow();

    const compactTableLayout = await browser.execute(() => {
      const table = document.querySelector<HTMLElement>('.skill-table');
      const head = document.querySelector<HTMLElement>('.skill-table thead');
      const row = document.querySelector<HTMLElement>('.skill-table .skill-row');
      const rowRect = row?.getBoundingClientRect();
      return {
        tableDisplay: table ? getComputedStyle(table).display : '',
        headPosition: head ? getComputedStyle(head).position : '',
        rowDisplay: row ? getComputedStyle(row).display : '',
        agentCount: row?.querySelectorAll("input[type='checkbox']").length ?? 0,
        rowLeft: rowRect?.left ?? Number.NaN,
        rowRight: rowRect?.right ?? Number.NaN,
        viewportWidth: window.innerWidth,
      };
    });
    expect(compactTableLayout.tableDisplay).toBe('block');
    expect(compactTableLayout.headPosition).toBe('absolute');
    expect(compactTableLayout.rowDisplay).toBe('grid');
    expect(compactTableLayout.agentCount).toBe(4);
    expect(compactTableLayout.rowLeft).toBeGreaterThanOrEqual(0);
    expect(compactTableLayout.rowRight).toBeLessThanOrEqual(compactTableLayout.viewportWidth + 1);

    const skillRow = await $(
      "[data-skill-id='anthropics/skills:testing-strategy'] .skill-row-select",
    );
    await skillRow.click();
    const detail = await $("[data-skill-detail='anthropics/skills:testing-strategy']");
    await detail.waitForDisplayed();
    const backToList = await detail.$(".//button[normalize-space()='返回列表']");
    await backToList.waitForDisplayed();
    await backToList.click();
    await browser.waitUntil(async () =>
      browser.execute(
        (id) =>
          document.activeElement ===
          document.querySelector('[data-skill-id="' + id + '"] .skill-row-select'),
        'anthropics/skills:testing-strategy',
      ),
    );
    await expectNoHorizontalOverflow();
  });

  it('keeps the default fixture empty and enables visual data only with its query parameter', async () => {
    await browser.setViewport({ width: 1280, height: 900 });
    await browser.url(ENTRY);
    await waitForStable();
    expect(await $('.skill-empty h3').getText()).toContain('尚未安装');

    await browser.url(`${ENTRY}?fixture=visual`);
    await waitForStable();
    expect(await $$('.skill-list [data-skill-id]').length).toBe(3);

    const subagents = await $(
      "//*[@data-workbench-rail='asset-type']//button[normalize-space()='Subagents']",
    );
    await subagents.click();
    await $('.subagent-panel').waitForDisplayed();
    expect(await $$('.subagent-list [data-subagent-list-id]').length).toBe(2);
  });
});
