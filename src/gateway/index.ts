/**
 * createGateway — 按运行环境选择 FrontendGateway 实现。
 *
 * Tauri WebView（window.__TAURI_INTERNALS__ 存在）动态加载真实 adapter；
 * 浏览器/测试环境使用 FX-01 scripted mock，并按 URL `scenario` 参数应用脚本
 * （fail-list / fail-detail / stale-index），供 L2 旅程注入失败与过期场景。
 */
import type { FrontendGateway } from '../contract/gateway';
import { ScriptedMockGateway } from './mock';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function createGateway(): Promise<FrontendGateway> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { createTauriGateway } = await import('./tauri');
    return createTauriGateway();
  }
  const mock = new ScriptedMockGateway();
  if (typeof window !== 'undefined') {
    mock.applyScenario(new URLSearchParams(window.location.search).get('scenario'));
  }
  return mock;
}
