/**
 * FE-02 L2 read-only details journey.
 *
 * Provenance: rendered scripted FX-02 mock only; no IPC/disk credit. The
 * separate FX-02 L3 tracer is the sole actual-read evidence.
 */
import { describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

const ENTRY = '/tests/l2/workbench.html?scenario=fx02-read-surfaces';

async function openWorkbench(): Promise<void> {
  await browser.url(ENTRY);
  await $('.read-only-workbench').waitForDisplayed();
}

async function waitForDetail(testId: string): Promise<void> {
  await $(`[data-testid="${testId}"]`).waitForDisplayed();
}

async function assertReadOnlyCalls(): Promise<void> {
  const calls = await browser.execute(() => window.__fx01?.getCalls() ?? []);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((call) => call.method === 'read')).toBe(true);
  expect(
    calls.every((call) =>
      ['workbench', 'globalLocator', 'assetDetail', 'nativeFile'].includes(call.queryKind),
    ),
  ).toBe(true);
  // `canEdit`/draft 状态只可作为快照事实；所有 transport 调用仍必须是闭合的 read 集。
  expect(JSON.stringify(calls)).not.toMatch(
    /"(?:kind|queryKind)":"(?:edit|draft|prepare|apply|install|convert|delete)"/i,
  );
}

describe('FE-02 FX-02 type-specific read-only details L2 journey', () => {
  it('opens the multi-file Skill structure first, then reads source only after an explicit file selection', async () => {
    await openWorkbench();
    await $('[role="option"]').click();
    await waitForDetail('skill-readonly-detail');
    expect(await $('[data-testid="skill-readonly-detail"]').getText()).toContain('Multifile Skill');
    expect(await $$('[data-testid="native-file-tree-item"]')).toHaveLength(3);
    const primary = await $('button=查看源码：SKILL.md（主文件）');
    expect(await primary.getAttribute('aria-current')).toBeNull();
    expect(await $('[data-testid="native-file-text"]').isExisting()).toBe(false);
    const initialCalls = await browser.execute(() => window.__fx01?.getCalls() ?? []);
    expect(initialCalls.filter((call) => call.queryKind === 'nativeFile')).toHaveLength(0);

    await primary.click();
    const initialSource = await $('[data-testid="native-file-text"]').getText();
    expect(initialSource).toContain('••');
    expect(initialSource).not.toContain('SYNTHETIC-SECRET');

    await $('button=查看源码：references/usage.md').click();
    await browser.waitUntil(async () =>
      (await $('[data-testid="native-file-text"]').getText()).includes('usage.md'),
    );
    expect(await $('[data-testid="native-file-text"]').getText()).not.toContain('SYNTHETIC-SECRET');

    await $('button=查看源码：assets/opaque.bin').click();
    await $('[data-testid="native-file-nontext"]').waitForDisplayed();
    expect(await $('[data-testid="native-file-nontext"]').getText()).toContain(
      'NON_TEXT_UNPREVIEWABLE',
    );
    expect(await $('[data-testid="safety-finding"]').getText()).not.toContain('SYNTHETIC-SECRET');
    await assertReadOnlyCalls();
  });

  it('discloses only authoritative read-snapshot provenance, contexts, overrides, compatibility and revision facts', async () => {
    await openWorkbench();
    await $('[role="option"]').click();
    await waitForDetail('skill-readonly-detail');

    const disclosures = await $$('[aria-label="类型特定只读详情"] details');
    expect(disclosures).toHaveLength(2);
    await disclosures[0].click();
    const sourceFacts = await disclosures[0].getText();
    expect(sourceFacts).toContain('FX-02/native-root');
    expect(sourceFacts).toContain('来源锚点：FX-02 synthetic root');
    expect(sourceFacts).toContain('claude-code · global · FX-02 synthetic root · 优先级 0');
    expect(sourceFacts).toContain('覆盖关系：当前 read snapshot 未声明覆盖关系');

    expect(await $$('[data-testid="safety-finding"]')).toHaveText(
      expect.arrayContaining(['兼容性：recognizedReadOnly', 'UNKNOWN_FIELD_PRESERVED']),
    );
    await disclosures[1].click();
    const historyFacts = await disclosures[1].getText();
    expect(historyFacts).toContain('当前版本：rev-fx02-skill');
    for (const fact of ['漂移', '最近变更', '恢复点']) {
      expect(historyFacts).toContain(`${fact}：当前详情 snapshot 未提供权威事实`);
    }
  });

  it('opens a long-term instruction as a read-only Markdown detail with no edit/prepare/apply surface', async () => {
    await openWorkbench();
    await $('button=长期指令').click();
    await $('[role="option"]').waitForDisplayed();
    expect(await $('[role="option"]').getText()).toContain('Release notes');
    await $('[role="option"]').click();
    await waitForDetail('long-term-instruction-readonly-detail');
    expect(await $('[data-testid="long-term-instruction-readonly-detail"]').getText()).toContain(
      'Markdown（只读）',
    );
    expect(await $$('[data-testid="native-file-tree-item"]')).toHaveLength(1);
    expect(await $('[data-testid="native-file-text"]').getText()).not.toContain('SYNTHETIC-SECRET');
    expect(
      await $$('[data-testid="safety-finding"]').map((finding) => finding.getText()),
    ).toContain('敏感字段已遮蔽。');
    const controls = await browser.execute(() =>
      [...document.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? ''),
    );
    expect(
      controls.some((label) =>
        /编辑|创建|草稿|安装|删除|prepare|apply|draft|install|转换|convert|delete/i.test(label),
      ),
    ).toBe(false);
    await assertReadOnlyCalls();
  });

  it('opens a Subagent model/tools/permissions/body as a read-only detail', async () => {
    await openWorkbench();
    await $('button=Subagents').click();
    await $('[role="option"]').waitForDisplayed();
    expect(await $('[role="option"]').getText()).toContain('Researcher');
    await $('[role="option"]').click();
    await waitForDetail('subagent-readonly-detail');
    const detail = await $('[data-testid="subagent-readonly-detail"]').getText();
    expect(detail).toContain('模型：synthetic-readonly-model');
    expect(detail).toContain('工具：read');
    expect(detail).toContain('权限：readonly');
    expect(await $('[data-testid="native-file-text"]').getText()).not.toContain('SYNTHETIC-SECRET');
    expect(
      await $$('[data-testid="safety-finding"]').map((finding) => finding.getText()),
    ).toContain('敏感字段已遮蔽。');
    await assertReadOnlyCalls();
  });

  it('keeps Hook unreachable from primary navigation, global locator, create, detail and conversion controls', async () => {
    await openWorkbench();
    const tabs = await $$('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(await $('[role="tablist"]').getText()).toEqual('Skills长期指令Subagents');
    expect(await $$('[role="tab"]')).not.toHaveLength(4);

    await $('button=全局搜索').click();
    await $('#global-locator-input').setValue('FX-02');
    await browser.waitUntil(async () => (await $$('.global-locator section').length) === 3);
    expect(
      await $$('.global-locator section').map((section) => section.getAttribute('aria-label')),
    ).toEqual(['Skills', '长期指令', 'Subagents']);
    const visibleText = await browser.execute(() => document.body.innerText);
    expect(visibleText).not.toContain('Hook');
    const controls = await browser.execute(() =>
      [...document.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? ''),
    );
    expect(
      controls.some((label) =>
        /创建|编辑|草稿|安装|删除|prepare|apply|draft|install|转换|convert|delete/i.test(label),
      ),
    ).toBe(false);
    const calls = await browser.execute(() => window.__fx01?.getCalls() ?? []);
    const locator = [...calls].reverse().find((call) => call.queryKind === 'globalLocator');
    expect(locator?.query).toMatchObject({
      kind: 'globalLocator',
      assetTypes: ['skill', 'longTermInstruction', 'subagent'],
    });
    await assertReadOnlyCalls();
  });
});
