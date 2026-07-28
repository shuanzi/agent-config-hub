/**
 * ScriptedMockGateway 行为测试（L1）：fixture 形状、脚本化能力、遮蔽与调用记录。
 */
import { describe, expect, it } from 'vitest';
import { containsSyntheticSecret, SENSITIVE_MASK } from '../../fixtures/sensitive-masking';
import { ScriptedMockGateway } from '../../src/gateway/mock';
import type { AssetDetailQuery, AssetListQuery, AssetRef } from '../../src/contract/types';

const LIST_QUERY: AssetListQuery = {
  kind: 'assetList',
  scope: { kind: 'currentAssetType', assetType: 'skill' },
};

async function readListOk(mock: ScriptedMockGateway, query: AssetListQuery = LIST_QUERY) {
  const result = await mock.read(query);
  if (result.kind !== 'readSucceeded') {
    throw new Error(`期望 readSucceeded，得到 ${result.kind}`);
  }
  return result.snapshot;
}

async function readDetailOk(mock: ScriptedMockGateway, asset: AssetRef) {
  const query: AssetDetailQuery = { kind: 'assetDetail', asset };
  const result = await mock.read(query);
  if (result.kind !== 'readSucceeded') {
    throw new Error(`期望 readSucceeded，得到 ${result.kind}`);
  }
  return result.snapshot;
}

describe('ScriptedMockGateway', () => {
  it('FX-01 列表形状：单资产、名称、Agent、作用域、可用性', async () => {
    const mock = new ScriptedMockGateway();
    const list = await readListOk(mock);
    expect(list.assets).toHaveLength(1);
    const summary = list.assets[0];
    expect(summary.displayName).toBe('Demo Skill');
    expect(summary.asset.assetType).toBe('skill');
    expect(summary.agents).toEqual(['claude-code']);
    expect(summary.scope).toBe('global');
    expect(summary.availability.kind).toBe('allowed');
    expect(summary.anomalies).toEqual([]);
    expect(list.indexStatus).toBe('fresh');
  });

  it('搜索与筛选约束列表结果', async () => {
    const mock = new ScriptedMockGateway();
    // 搜索：大小写不敏感匹配名称
    expect((await readListOk(mock, { ...LIST_QUERY, searchText: 'demo' })).assets).toHaveLength(1);
    expect((await readListOk(mock, { ...LIST_QUERY, searchText: 'nomatch' })).assets).toHaveLength(
      0,
    );
    // Agent 筛选
    expect(
      (await readListOk(mock, { ...LIST_QUERY, filters: { agents: ['codex'] } })).assets,
    ).toHaveLength(0);
    expect(
      (await readListOk(mock, { ...LIST_QUERY, filters: { agents: ['claude-code'] } })).assets,
    ).toHaveLength(1);
    // 作用域筛选
    expect(
      (await readListOk(mock, { ...LIST_QUERY, filters: { scopes: ['project'] } })).assets,
    ).toHaveLength(0);
    // 全部资产范围仍可见该资产
    expect(
      (await readListOk(mock, { kind: 'assetList', scope: { kind: 'allAssets' } })).assets,
    ).toHaveLength(1);
    // 非 skill 的当前类型范围不可见
    expect(
      (
        await readListOk(mock, {
          kind: 'assetList',
          scope: { kind: 'currentAssetType', assetType: 'subagent' },
        })
      ).assets,
    ).toHaveLength(0);
  });

  it('revision 稳定且为不透明字符串；external change 后变化', async () => {
    const mock = new ScriptedMockGateway();
    const list = await readListOk(mock);
    const asset = list.assets[0].asset;
    const first = await readDetailOk(mock, asset);
    const second = await readDetailOk(mock, asset);
    expect(first.revision).toBeTruthy();
    expect(second.revision).toBe(first.revision);

    mock.simulateExternalChange();
    const afterChange = await readDetailOk(mock, asset);
    expect(afterChange.revision).not.toBe(first.revision);
  });

  it('nativeFile 默认遮蔽：无占位明文、含遮蔽标记、段全 masked、结构化禁用带原因', async () => {
    const mock = new ScriptedMockGateway();
    const list = await readListOk(mock);
    const detail = await readDetailOk(mock, list.assets[0].asset);
    const fileResult = await mock.read({
      kind: 'nativeFile',
      asset: list.assets[0].asset,
      fileId: detail.detail.primaryFile.fileId,
    });
    if (fileResult.kind !== 'readSucceeded') {
      throw new Error('unreachable');
    }
    const file = fileResult.snapshot;
    expect(file.content.kind).toBe('source');
    if (file.content.kind === 'source') {
      expect(containsSyntheticSecret(file.content.maskedText)).toBe(false);
      expect(file.content.maskedText).toContain(SENSITIVE_MASK);
      expect(file.content.sensitiveSegments.every((s) => s.displayState === 'masked')).toBe(true);
    }
    expect(file.structuredView).toEqual({
      kind: 'disabled',
      reasonCode: 'UNKNOWN_FIELD_PRESERVED',
    });
    // 整个 snapshot 序列化不得出现占位明文（rawValue 不出 gateway）
    expect(containsSyntheticSecret(JSON.stringify(file))).toBe(false);
    expect(containsSyntheticSecret(JSON.stringify(detail))).toBe(false);
  });

  it('failNext 只消费一次；detail/nativeFile 可分别脚本化', async () => {
    const mock = new ScriptedMockGateway();
    const list = await readListOk(mock);
    const asset = list.assets[0].asset;

    mock.failNext('assetDetail', 'READ_FAILED');
    const failed = await mock.read({ kind: 'assetDetail', asset });
    expect(failed.kind).toBe('readFailed');
    if (failed.kind === 'readFailed') {
      expect(failed.reasonCode).toBe('READ_FAILED');
      expect(failed.recoveryAction).toEqual({ kind: 'retryRead' });
    }
    const recovered = await mock.read({ kind: 'assetDetail', asset });
    expect(recovered.kind).toBe('readSucceeded');
  });

  it('未知资产/文件 id 返回封闭 ReadFailed', async () => {
    const mock = new ScriptedMockGateway();
    const list = await readListOk(mock);
    const bogus: AssetRef = { ...list.assets[0].asset, assetId: 'asset-nope' };
    const result = await mock.read({ kind: 'assetDetail', asset: bogus });
    expect(result.kind).toBe('readFailed');
  });

  it('setIndexStatus(stale) 后 indexUpdatedAt 为过去时刻', async () => {
    const mock = new ScriptedMockGateway();
    mock.setIndexStatus('stale');
    const list = await readListOk(mock);
    expect(list.indexStatus).toBe('stale');
    expect(Date.parse(list.indexUpdatedAt)).toBeLessThan(Date.parse(list.queriedAt));
  });

  it('applyScenario 映射 L2 场景参数', async () => {
    const failList = new ScriptedMockGateway();
    failList.applyScenario('fail-list');
    expect((await failList.read(LIST_QUERY)).kind).toBe('readFailed');

    const stale = new ScriptedMockGateway();
    stale.applyScenario('stale-index');
    expect((await readListOk(stale)).indexStatus).toBe('stale');

    const plain = new ScriptedMockGateway();
    plain.applyScenario(null);
    expect((await readListOk(plain)).indexStatus).toBe('fresh');
  });

  it('调用日志只含 read；observe 可退订', async () => {
    const mock = new ScriptedMockGateway();
    let events = 0;
    const unobserve = mock.observe({ kind: 'workspace' }, () => {
      events += 1;
    });
    mock.emitEvent({ kind: 'assetsInvalidated' });
    unobserve();
    mock.emitEvent({ kind: 'assetsInvalidated' });
    expect(events).toBe(1);

    await readListOk(mock);
    const calls = mock.getCallLog();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === 'read')).toBe(true);
  });
});
