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
  it('FX-01 列表形状：单资产、名称、Agent、作用域、来源层级、可用性', async () => {
    const mock = new ScriptedMockGateway();
    const list = await readListOk(mock);
    expect(list.assets).toHaveLength(1);
    const summary = list.assets[0];
    expect(summary.displayName).toBe('Demo Skill');
    expect(summary.asset.assetType).toBe('skill');
    expect(summary.agents).toEqual(['claude-code']);
    expect(summary.scope).toBe('global');
    expect(summary.sourceTier).toEqual({
      id: 'user-global-root',
      label: 'User global root (synthetic)',
    });
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

  it('项目与来源筛选约束列表结果；groupBy 不改变结果集', async () => {
    const mock = new ScriptedMockGateway();
    // FX-01 资产无项目上下文（contextHint 为 path）：任何项目筛选都不匹配
    expect(
      (await readListOk(mock, { ...LIST_QUERY, filters: { projects: ['any-project'] } })).assets,
    ).toHaveLength(0);
    // 来源筛选按 sourceTier.id 匹配
    expect(
      (await readListOk(mock, { ...LIST_QUERY, filters: { sources: ['user-global-root'] } }))
        .assets,
    ).toHaveLength(1);
    expect(
      (await readListOk(mock, { ...LIST_QUERY, filters: { sources: ['project-root'] } })).assets,
    ).toHaveLength(0);
    // groupBy 是展示行为，不改变结果集
    expect(
      (await readListOk(mock, { ...LIST_QUERY, filters: { groupBy: 'scope' } })).assets,
    ).toHaveLength(1);
  });

  it('gateway 出口统一遮蔽：注入的人类可读占位文本不出现在任何结果中', async () => {
    // 占位明文拼接构造，避免字面值进入测试源码/日志（对齐 verify:static 守卫）
    const PLACEHOLDER = ['SYNTHETIC-SECRET', 'x1'].join('-');
    const mock = new ScriptedMockGateway();
    mock.setFixtureTextOverrides({
      displayName: `Demo ${PLACEHOLDER}`,
      pathHint: `~/…/${PLACEHOLDER}`,
      pathDisplay: `~/…/${PLACEHOLDER}/SKILL.md`,
      sourceTierLabel: `Tier ${PLACEHOLDER}`,
      readFailedMessage: `读取失败：${PLACEHOLDER}`,
      anomalies: [{ kind: 'drift', reasonCode: 'EXTERNAL_CHANGE', message: `异常 ${PLACEHOLDER}` }],
    });

    const list = await readListOk(mock);
    expect(containsSyntheticSecret(JSON.stringify(list))).toBe(false);
    expect(list.assets[0].displayName).toContain(SENSITIVE_MASK);
    expect(list.assets[0].anomalies[0].message).toContain(SENSITIVE_MASK);

    const detail = await readDetailOk(mock, list.assets[0].asset);
    expect(containsSyntheticSecret(JSON.stringify(detail))).toBe(false);
    expect(detail.inspector.pathDisplay).toContain(SENSITIVE_MASK);
    expect(detail.detail.effectiveContexts[0].sourceTierLabel).toContain(SENSITIVE_MASK);

    const fileResult = await mock.read({
      kind: 'nativeFile',
      asset: list.assets[0].asset,
      fileId: detail.detail.primaryFile.fileId,
    });
    expect(containsSyntheticSecret(JSON.stringify(fileResult))).toBe(false);

    mock.failNext('assetList', 'READ_FAILED');
    const failed = await mock.read(LIST_QUERY);
    expect(failed.kind).toBe('readFailed');
    expect(containsSyntheticSecret(JSON.stringify(failed))).toBe(false);
    if (failed.kind === 'readFailed') {
      expect(failed.message).toContain(SENSITIVE_MASK);
    }
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

  it('调用日志只含 read；observe 返回句柄可退订且 ready 默认已 resolve', async () => {
    const mock = new ScriptedMockGateway();
    let events = 0;
    const handle = mock.observe({ kind: 'workspace' }, () => {
      events += 1;
    });
    await expect(handle.ready).resolves.toBeUndefined();
    mock.emitEvent({ kind: 'assetsInvalidated' });
    handle.unlisten();
    mock.emitEvent({ kind: 'assetsInvalidated' });
    expect(events).toBe(1);

    await readListOk(mock);
    const calls = mock.getCallLog();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === 'read')).toBe(true);
  });
});
