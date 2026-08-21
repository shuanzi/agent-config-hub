/**
 * FE-03 本地草稿 L2 journey。
 *
 * 仅经 workbench.html 的 ScriptedMockGateway 验证；没有 Tauri IPC、真实授权、磁盘
 * 或写入 credit。所有 draft/guard 均应留在 frontend-local session。
 */
import { beforeEach, describe, it } from 'mocha';
import { $, $$, browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

const ENTRY = '/tests/l2/workbench.html?scenario=fe03-drafts';
const STALE_ENTRY = '/tests/l2/workbench.html?scenario=fe03-drafts-stale';
const LTI_MARKER = '\n# l2-local-instruction-change';
const PRIMARY_MARKER = '\n# l2-primary-change';
const SECONDARY_MARKER = '\n# l2-secondary-change';
const MODEL_MARKER = '-l2-local';
const SECOND_MASKED_SEGMENT_ID = 'seg-fe03-masked-instruction-secondary';

async function expectDraftDiscard(visible: boolean): Promise<void> {
  const discard = await $('[data-testid="fe03-draft-discard"]');
  if (visible) {
    await discard.waitForDisplayed();
  } else {
    expect(await discard.isExisting()).toBe(false);
  }
}

async function expectNoDirtyGuard(): Promise<void> {
  expect(await $('[data-testid="fe03-dirty-guard"]').isDisplayed()).toBe(false);
}

async function selectNativeFile(label: string): Promise<void> {
  const nodes = await $$('[data-testid="native-file-tree-item"]');
  for (const node of nodes) {
    if ((await node.getText()) === label) {
      await node.click();
      return;
    }
  }
  throw new Error(`NativeFileTree node not found: ${label}`);
}

async function assertMockOnlyTransport(allowSensitiveReveal = false): Promise<void> {
  const { calls, observeCount, bodyText } = await browser.execute(() => ({
    calls: window.__fx01?.getCalls() ?? [],
    observeCount: window.__fx01?.getObserveCallCount() ?? 0,
    bodyText: document.body.innerText,
  }));
  expect(calls.length).toBeGreaterThan(0);
  expect(observeCount).toBeGreaterThan(0);
  expect(calls.every((call) => call.method === 'read')).toBe(true);
  expect(
    calls.every((call) =>
      [
        'workbench',
        'assetDetail',
        'nativeFile',
        ...(allowSensitiveReveal ? ['sensitiveReveal'] : []),
      ].includes(call.queryKind),
    ),
  ).toBe(true);
  const serializedCalls = JSON.stringify(calls);
  for (const forbidden of ['prepare', 'review', 'confirm', 'replay', 'apply', 'write']) {
    expect(serializedCalls.toLowerCase()).not.toContain(forbidden);
    expect(bodyText.toLowerCase()).not.toContain(forbidden);
  }
}

describe('FE-03 frontend-local drafts mock L2 journey', () => {
  it('keeps editable drafts local through guard, same-asset file/view switches, and ordinary discard', async () => {
    await browser.url(ENTRY);
    await $('.read-only-workbench').waitForDisplayed();

    await $('button=长期指令').click();
    await $('[role="option"]').waitForDisplayed();
    await $('[role="option"]').click();
    const instructionEditor = await $('[data-testid="fe03-draft-textarea"]');
    await instructionEditor.waitForDisplayed();
    const instructionBeforeEdit = await instructionEditor.getValue();
    await instructionEditor.click();
    await expectDraftDiscard(false);
    await browser.keys(['Meta', 'a']);
    await instructionEditor.addValue(instructionBeforeEdit);
    await expectDraftDiscard(false);
    await instructionEditor.addValue(LTI_MARKER);
    await expectDraftDiscard(true);

    await $('button=Skills').click();
    await $('[data-testid="fe03-dirty-guard"]').waitForDisplayed();
    await $('[data-testid="fe03-dirty-guard-continue"]').click();
    await expectNoDirtyGuard();
    expect(await $('button=长期指令').getAttribute('aria-selected')).toBe('true');
    expect(await instructionEditor.getValue()).toBe(`${instructionBeforeEdit}${LTI_MARKER}`);

    await $('button=Skills').click();
    await $('[data-testid="fe03-dirty-guard"]').waitForDisplayed();
    await $('[data-testid="fe03-dirty-guard-discard"]').click();
    expect(await $('button=Skills').getAttribute('aria-selected')).toBe('true');
    await expectDraftDiscard(false);

    await $('[role="option"]').waitForDisplayed();
    await $('[role="option"]').click();
    expect(await $$('[data-testid="native-file-tree-item"]')).toHaveLength(2);
    await selectNativeFile('查看源码：SKILL.md（主文件）');
    await $('[data-testid="fe03-detail-view-source"]').click();
    const skillEditor = await $('[data-testid="fe03-draft-textarea"]');
    await skillEditor.waitForDisplayed();
    await skillEditor.addValue(PRIMARY_MARKER);
    await expectDraftDiscard(true);

    await $('[data-testid="fe03-detail-view-structured"]').click();
    expect(await $('[data-testid="fe03-draft-textarea"]').isDisplayed()).toBe(false);
    const disclosures = await $$('[aria-label="类型特定只读详情"] details');
    expect(disclosures.length).toBeGreaterThan(0);
    const sourceContext = disclosures[0];
    await sourceContext.click();
    expect(await sourceContext.getAttribute('open')).toBe('true');
    expect(await sourceContext.getText()).toContain('来源路径：');

    await selectNativeFile('查看源码：references/usage.md');
    await $('[data-testid="fe03-detail-view-source"]').click();
    await expectNoDirtyGuard();
    const secondaryEditor = await $('[data-testid="fe03-draft-textarea"]');
    await secondaryEditor.waitForDisplayed();
    await secondaryEditor.addValue(SECONDARY_MARKER);
    await expectDraftDiscard(true);
    await $('[data-testid="fe03-detail-view-structured"]').click();
    await expectNoDirtyGuard();
    const switchedSourceContext = (await $$('[aria-label="类型特定只读详情"] details'))[0];
    expect(await switchedSourceContext.getAttribute('open')).toBe('true');
    expect(await switchedSourceContext.getText()).toContain('来源路径：');

    await selectNativeFile('查看源码：SKILL.md（主文件）');
    await $('[data-testid="fe03-detail-view-source"]').click();
    const primaryEditor = await $('[data-testid="fe03-draft-textarea"]');
    await primaryEditor.waitForDisplayed();
    expect(await primaryEditor.getValue()).toContain(PRIMARY_MARKER);
    const returnedSourceContext = (await $$('[aria-label="类型特定只读详情"] details'))[0];
    expect(await returnedSourceContext.getAttribute('open')).toBe('true');
    expect(await returnedSourceContext.getText()).toContain('来源路径：');
    await expectNoDirtyGuard();

    await $('button=Subagents').click();
    await $('[data-testid="fe03-dirty-guard"]').waitForDisplayed();
    await $('[data-testid="fe03-dirty-guard-discard"]').click();
    expect(await $('button=Subagents').getAttribute('aria-selected')).toBe('true');
    await expectDraftDiscard(false);

    await $('[role="option"]').waitForDisplayed();
    await $('[role="option"]').click();
    expect(await $('[data-testid="subagent-readonly-detail"]').isDisplayed()).toBe(true);
    expect(await $('[data-testid="fe03-subagent-model"]').isExisting()).toBe(false);
    await $('[data-testid="fe03-subagent-edit"]').click();
    const modelInput = await $('[data-testid="fe03-subagent-model"]');
    await modelInput.waitForDisplayed();
    const originalModel = await modelInput.getValue();
    await modelInput.click();
    await browser.keys(['Meta', 'a']);
    await browser.keys(originalModel);
    await expectDraftDiscard(false);
    await modelInput.addValue(MODEL_MARKER);
    await expectDraftDiscard(true);
    await $('[data-testid="fe03-draft-discard"]').click();
    await expectDraftDiscard(false);
    expect(await $('button=Subagents').getAttribute('aria-selected')).toBe('true');
    expect(await modelInput.getValue()).toBe(originalModel);

    await assertMockOnlyTransport();
  });

  it('renders stale editable detail surfaces as read-only without edit controls', async () => {
    await browser.url(STALE_ENTRY);
    await $('.read-only-workbench').waitForDisplayed();
    await $('[role="status"]').waitForDisplayed();
    expect(await $('[role="status"]').getText()).toContain('索引已过期');
    await $('button=长期指令').click();
    const ordinaryRow = await $(
      '//button[@role="option"][.//span[normalize-space()="FE-03 Instruction"]]',
    );
    await ordinaryRow.waitForDisplayed();
    await ordinaryRow.click();
    await $('[data-testid="long-term-instruction-readonly-detail"]').waitForDisplayed();
    const ordinaryTextarea = await $('[data-testid="fe03-draft-textarea"]').isExisting();
    const ordinaryReadOnly = await $('[data-testid="native-file-text"]').isDisplayed();

    await browser.url(STALE_ENTRY);
    await $('.read-only-workbench').waitForDisplayed();
    await $('button=长期指令').click();
    const maskedRow = await $(
      '//button[@role="option"][.//span[normalize-space()="Masked local instruction"]]',
    );
    await maskedRow.waitForDisplayed();
    await maskedRow.click();
    await $('[data-testid="long-term-instruction-readonly-detail"]').waitForDisplayed();
    const maskedTextInput = await $('[data-testid="fe03-masked-text-part-0"]').isExisting();
    const maskedModify = await $('[data-testid="fe03-sensitive-modify"]').isExisting();
    const maskedReadOnly = await $('[data-testid="native-file-text"]').isDisplayed();

    await browser.url(STALE_ENTRY);
    await $('.read-only-workbench').waitForDisplayed();
    await $('button=Subagents').click();
    await $('[role="option"]').waitForDisplayed();
    await $('[role="option"]').click();
    await $('[data-testid="subagent-readonly-detail"]').waitForDisplayed();
    const subagentEdit = await $('[data-testid="fe03-subagent-edit"]').isExisting();
    const subagentModel = await $('[data-testid="fe03-subagent-model"]').isExisting();
    const subagentReadOnly =
      (await $('[data-testid="subagent-readonly-detail"]').isDisplayed()) &&
      (await $('[data-testid="native-file-text"]').isDisplayed());

    expect({
      ordinaryTextarea,
      maskedTextInput,
      maskedModify,
      subagentEdit,
      subagentModel,
    }).toEqual({
      ordinaryTextarea: false,
      maskedTextInput: false,
      maskedModify: false,
      subagentEdit: false,
      subagentModel: false,
    });
    expect({ ordinaryReadOnly, maskedReadOnly, subagentReadOnly }).toEqual({
      ordinaryReadOnly: true,
      maskedReadOnly: true,
      subagentReadOnly: true,
    });
  });

  describe('masked long-term instruction', () => {
    beforeEach(async () => {
      await browser.url(ENTRY);
      await $('.read-only-workbench').waitForDisplayed();
    });

    it('keeps a masked segment ephemeral across binding switches and a short authoritative TTL', async () => {
      await $('button=长期指令').click();
      const maskedRow = await $(
        '//button[@role="option"][.//span[normalize-space()="Masked local instruction"]]',
      );
      await maskedRow.waitForDisplayed();
      await maskedRow.click();

      const ordinaryPart = await $('[data-testid="fe03-masked-text-part-0"]');
      await ordinaryPart.waitForDisplayed();
      await $('[data-testid="fe03-masked-placeholder"]').waitForDisplayed();
      await ordinaryPart.addValue('~');
      await expectDraftDiscard(true);
      expect(await $('[data-testid="fe03-masked-placeholder"]').isDisplayed()).toBe(true);

      const callsBeforeReveal = await browser.execute(() => window.__fx01?.getCalls() ?? []);
      await $('[data-testid="fe03-sensitive-modify"]').click();
      const sensitiveEditor = await $('[data-testid="fe03-sensitive-editor"]');
      await sensitiveEditor.waitForDisplayed();
      await browser.waitUntil(async () => {
        const calls = await browser.execute(() => window.__fx01?.getCalls() ?? []);
        return calls.length > callsBeforeReveal.length;
      });
      const newCalls = (await browser.execute(() => window.__fx01?.getCalls() ?? [])).slice(
        callsBeforeReveal.length,
      );
      expect(newCalls).not.toHaveLength(0);
      expect(newCalls.every((call) => call.queryKind === 'sensitiveReveal')).toBe(true);
      const reveal = newCalls[0];
      if (reveal === undefined) throw new Error('sensitive reveal read must be recorded');
      expect(reveal.query).toMatchObject({
        kind: 'sensitiveReveal',
        scope: 'modify',
        surface: 'source',
      });
      const queryText = JSON.stringify(reveal.query);
      for (const forbiddenKey of [['plain', 'text'].join(''), ['gr', 'ant'].join('')]) {
        expect(queryText).not.toContain(forbiddenKey);
      }

      await sensitiveEditor.click();
      await sensitiveEditor.addValue('~');
      expect(await sensitiveEditor.isDisplayed()).toBe(true);
      expect(await $('[data-testid="fe03-masked-placeholder"]').isDisplayed()).toBe(true);
      await expectDraftDiscard(true);

      await $('[data-testid="fe03-detail-view-structured"]').click();
      await browser.waitUntil(
        async () => !(await $('[data-testid="fe03-sensitive-editor"]').isExisting()),
      );
      await $('[data-testid="fe03-detail-view-source"]').click();
      expect(await $('[data-testid="fe03-sensitive-editor"]').isExisting()).toBe(false);
      expect(await $('[data-testid="fe03-masked-placeholder"]').isDisplayed()).toBe(true);
      await expectDraftDiscard(true);

      await $('[data-testid="fe03-sensitive-modify"]').click();
      await $('[data-testid="fe03-sensitive-editor"]').waitForDisplayed();
      await browser.waitUntil(
        async () => !(await $('[data-testid="fe03-sensitive-editor"]').isExisting()),
        { timeout: 5_000, interval: 20 },
      );
      expect(await $('[data-testid="fe03-masked-placeholder"]').isDisplayed()).toBe(true);
      await expectDraftDiscard(true);
      await assertMockOnlyTransport(true);
    });

    it('keeps the current opaque sensitive editor on B after A becomes changed', async () => {
      await $('button=长期指令').click();
      const maskedRow = await $(
        '//button[@role="option"][.//span[normalize-space()="Masked local instruction"]]',
      );
      await maskedRow.waitForDisplayed();
      await maskedRow.click();

      const firstModify = (await $$('[data-testid="fe03-sensitive-modify"]'))[0];
      if (firstModify === undefined) throw new Error('first masked segment control is required');
      await firstModify.click();
      const editorA = await $('[data-testid="fe03-sensitive-editor"]');
      await editorA.waitForDisplayed();
      await editorA.addValue('~');
      expect(await editorA.isDisplayed()).toBe(true);

      const secondModify = (await $$('[data-testid="fe03-sensitive-modify"]'))[1];
      if (secondModify === undefined) throw new Error('second masked segment control is required');
      const callsBeforeB = await browser.execute(() => window.__fx01?.getCalls() ?? []);
      await secondModify.click();
      await browser.waitUntil(async () => {
        const segmentId = await browser.execute(() => {
          const latest = [...(window.__fx01?.getCalls() ?? [])]
            .reverse()
            .find((call) => call.queryKind === 'sensitiveReveal');
          return latest?.query.kind === 'sensitiveReveal' ? latest.query.segmentId : undefined;
        });
        return segmentId === SECOND_MASKED_SEGMENT_ID;
      });
      await $('[data-testid="fe03-sensitive-editor"]').waitForDisplayed({
        timeout: 4_000,
        timeoutMsg: 'B modify reveal 后当前敏感编辑器未保留',
      });

      const newCalls = (await browser.execute(() => window.__fx01?.getCalls() ?? [])).slice(
        callsBeforeB.length,
      );
      const latestReveal = [...newCalls]
        .reverse()
        .find((call) => call.queryKind === 'sensitiveReveal');
      expect(latestReveal?.query).toMatchObject({
        kind: 'sensitiveReveal',
        segmentId: SECOND_MASKED_SEGMENT_ID,
        scope: 'modify',
        surface: 'source',
      });
      const queryText = JSON.stringify(latestReveal?.query);
      for (const forbiddenKey of [['plain', 'text'].join(''), ['gr', 'ant'].join('')]) {
        expect(queryText).not.toContain(forbiddenKey);
      }
      await assertMockOnlyTransport(true);
    });
  });
});
