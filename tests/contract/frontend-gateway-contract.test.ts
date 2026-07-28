/**
 * FrontendGateway 行为契约（FE-01 子集）对 ScriptedMockGateway 的 L1 运行。
 * 断言本体在 ./frontend-gateway-contract.ts（framework-neutral），L3 复用同一模块。
 */
import { describe, expect, it } from 'vitest';
import { ScriptedMockGateway } from '../../src/gateway/mock';
import { runGatewayContract } from './frontend-gateway-contract';

describe('FrontendGateway 行为契约（FX-01，ScriptedMockGateway）', () => {
  it('满足 FE-01 只读契约子集', async () => {
    const mock = new ScriptedMockGateway();
    const result = await runGatewayContract({
      createGateway: () => Promise.resolve(mock),
      capabilities: {
        triggerInvalidation: () => {
          mock.emitEvent({ kind: 'assetsInvalidated', assetType: 'skill' });
          return Promise.resolve();
        },
        simulateExternalChange: () => {
          mock.simulateExternalChange();
          return Promise.resolve();
        },
      },
    });
    expect(result.passed).toEqual([
      'list',
      'detail',
      'nativeFile',
      'revisionInvalidation',
      'masking',
    ]);
  });

  it('脚本化失败返回带 retryRead 恢复动作的 ReadFailed', async () => {
    const mock = new ScriptedMockGateway();
    mock.failNext('assetList', 'READ_FAILED');
    const failed = await mock.read({
      kind: 'assetList',
      scope: { kind: 'currentAssetType', assetType: 'skill' },
    });
    expect(failed.kind).toBe('readFailed');
    if (failed.kind === 'readFailed') {
      expect(failed.reasonCode).toBe('READ_FAILED');
      expect(failed.recoveryAction).toEqual({ kind: 'retryRead' });
    }
    // 一次性失败被消费后恢复成功
    const recovered = await mock.read({
      kind: 'assetList',
      scope: { kind: 'currentAssetType', assetType: 'skill' },
    });
    expect(recovered.kind).toBe('readSucceeded');
  });
});
