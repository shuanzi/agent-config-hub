/**
 * L3：共享 FrontendGatewayContract 对真实 TauriFrontendGateway 运行。
 *
 * 断言本体在 tests/contract/frontend-gateway-contract.ts（与 L1 同一模块），
 * 经 vite.l3.config.ts 的 tests/l3/contract.html 入口加载进真实 Tauri
 * webview，本测试用 browser.execute 运行 window.__runGatewayContract() 并
 * 断言全部检查通过；与 fx-01.tracer.test.ts（用户可见旅程）互补。
 *
 * Provenance：test-harness 隔离构建上的真实 command/event/隔离磁盘路径；
 * 不代表生产签名/DMG（L4）。
 */
import { describe, it } from 'mocha';
import { browser, expect } from '@wdio/globals';
import type {} from 'webdriverio';

interface ContractOutcome {
  passed: string[];
  error: string | null;
}

const EXPECTED_CHECKS = ['list', 'detail', 'nativeFile', 'revisionInvalidation', 'masking'];

describe('L3 FrontendGateway 行为契约（真实 Tauri adapter）', () => {
  it('满足 FE-01 只读契约子集', async () => {
    // harness 首页是 index.html；契约入口随 harness 构建产出于
    // tests/l3/contract.html（相对当前页解析，不假定 origin）。
    const currentUrl = await browser.getUrl();
    await browser.url(new URL('tests/l3/contract.html', currentUrl).toString());
    await browser.waitUntil(
      async () => browser.execute(() => typeof window.__runGatewayContract === 'function'),
      { timeout: 30000, timeoutMsg: 'contract 入口未暴露 __runGatewayContract' },
    );

    const outcome = await browser.execute(async (): Promise<ContractOutcome> => {
      const run = window.__runGatewayContract;
      if (run === undefined) {
        return { passed: [], error: '__runGatewayContract 未定义' };
      }
      try {
        const result = await run();
        return { passed: result.passed, error: null };
      } catch (error) {
        // 失败时把 ContractAssertionError 的 [check] detail 带出到测试报告
        return {
          passed: [],
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        };
      }
    });

    expect(outcome.error).toBe(null);
    expect(outcome.passed).toEqual(EXPECTED_CHECKS);

    // 卫生：导航回应用首页。embedded provider 下所有 spec 共享同一 harness
    // 进程与窗口，本测试把窗口停在 contract.html 会影响后续 spec。
    await browser.url(currentUrl);
  });
});
