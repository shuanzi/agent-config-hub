/**
 * FX-01 L3 tracer：启动 → 一次真实 read → event 失效后重读。
 *
 * 真实路径：React UI → TauriFrontendGateway → WebView IPC →
 * `frontend_gateway_read` command → Rust GatewayCore/Catalog → 隔离 fixture
 * 磁盘事实；失效路径：测试 command 追加合成标记 → `assetsInvalidated`
 * event → UI 原位重读。全程在 test-harness 构建与临时目录数据根内进行。
 *
 * Provenance：本 tracer 证明隔离测试构建的真实 command/event/磁盘路径；
 * 不代表生产签名/DMG（L4）。
 */
import { describe, it } from 'mocha';
import { $, browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

// 占位明文只允许存在于 fixture 原始文件；拼接构造避免字面值进入测试源码/日志
const SECRET_PLACEHOLDER = ['SYNTHETIC-SECRET', 'demo-skill-0001'].join('-');
const MASK = '••••••••';
const MARKER = 'fx01-external-change-1';

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: (command: string) => Promise<unknown> } };
  }
}

describe('FX-01 L3 真实 Tauri tracer', () => {
  it('启动 → 真实 read → 遮蔽 → 外部变化 event → 原位重读', async () => {
    // a. 启动 + 一次真实 read：列表出现 Demo Skill
    await $('.workbench').waitForDisplayed({ timeout: 60000 });
    const row = await $('[role="option"]');
    await row.waitForDisplayed({ timeout: 30000 });
    expect(await row.getText()).toContain('Demo Skill');

    // b. 选中后源码可见，默认遮蔽，页面无占位明文
    await row.click();
    const source = await $('pre.source-view');
    await source.waitForDisplayed({ timeout: 30000 });
    const beforeText = await source.getText();
    expect(beforeText).toContain('# Demo Skill');
    expect(beforeText).toContain(MASK);
    expect(beforeText.includes(SECRET_PLACEHOLDER)).toBe(false);

    // c. 通过测试 command 触发外部变化 + assetsInvalidated event
    const marker = await browser.execute(() => {
      const tauri = window.__TAURI__;
      if (tauri === undefined) {
        return null;
      }
      return tauri.core.invoke('test_fx01_external_change');
    });
    expect(marker).toBe(MARKER);

    // d. UI 不经用户操作原位重读：源码出现新标记行
    await browser.waitUntil(async () => (await $('pre.source-view').getText()).includes(MARKER), {
      timeout: 30000,
      timeoutMsg: '事件失效后详情未原位重读到外部变化标记',
    });

    // e. 重读后页面仍无占位明文（可见文本与 DOM）
    const { bodyText, bodyHtml } = await browser.execute(() => ({
      bodyText: document.body.innerText,
      bodyHtml: document.body.innerHTML,
    }));
    expect(bodyText.includes(SECRET_PLACEHOLDER)).toBe(false);
    expect(bodyHtml.includes(SECRET_PLACEHOLDER)).toBe(false);
  });
});
