import { invoke as tauriInvoke } from '@tauri-apps/api/core';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    /** 测试注入的 invoke 钩子；存在时代替真实 Tauri bridge。 */
    __ACM_MOCK_INVOKE__?: (cmd: string, args?: Record<string, unknown>) => unknown;
  }
}

/**
 * 统一 invoke 入口。
 * 优先使用 window.__ACM_MOCK_INVOKE__（L2 注入的 mock 层），否则回退到 @tauri-apps/api/core。
 */
export const invoke: InvokeFn = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (typeof window !== 'undefined' && window.__ACM_MOCK_INVOKE__ !== undefined) {
    const result = window.__ACM_MOCK_INVOKE__(cmd, args);
    return Promise.resolve(result) as Promise<T>;
  }
  return tauriInvoke<T>(cmd, args);
};
