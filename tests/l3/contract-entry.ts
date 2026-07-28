/**
 * L3 契约入口（仅 harness 前端构建包含，见 vite.l3.config.ts；生产构建不含）。
 *
 * 把共享 FrontendGatewayContract（tests/contract/frontend-gateway-contract.ts，
 * 与 L1 同一断言模块）挂到 window.__runGatewayContract，由
 * tests/l3/contract.test.ts 在真实 Tauri webview 内经 browser.execute 驱动。
 * 本入口的 gateway 与 UI（index.html）的 gateway 各自独立创建，互不冲突。
 */
import {
  runGatewayContract,
  type GatewayContractResult,
} from '../contract/frontend-gateway-contract';
import { createTauriGateway } from '../../src/gateway/tauri';

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: (command: string) => Promise<unknown> } };
    __runGatewayContract?: () => Promise<GatewayContractResult>;
  }
}

/**
 * 测试 command `test_fx01_external_change` 一次调用同时完成「磁盘外部变化
 * （追加合成标记）+ assetsInvalidated 事件」，故两个 capability 共用。
 */
async function invokeExternalChange(): Promise<void> {
  const tauri = window.__TAURI__;
  if (tauri === undefined) {
    throw new Error('window.__TAURI__ 不可用（需要 withGlobalTauri 的 harness 构建）');
  }
  await tauri.core.invoke('test_fx01_external_change');
}

window.__runGatewayContract = () =>
  runGatewayContract({
    createGateway: () => Promise.resolve(createTauriGateway()),
    capabilities: {
      simulateExternalChange: invokeExternalChange,
      triggerInvalidation: invokeExternalChange,
    },
  });
