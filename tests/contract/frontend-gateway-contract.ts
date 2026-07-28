/**
 * FrontendGateway 行为契约断言（FE-01 封闭子集，framework-neutral）。
 *
 * 同一组断言先由 Vitest 对 ScriptedMockGateway 运行（L1），后续 L3 对真实
 * TauriFrontendGateway 复用。本模块不 import vitest/wdio；断言失败自抛
 * ContractAssertionError。输入只有 adapter factory 与 fixture capability。
 *
 * FE-01 断言范围（对应前端契约 §10.2 FX-01 可验收断言）：
 * - list snapshot 身份与形状（恰好一个资产、名称、类型、Agent、作用域、可用性、无异常）；
 * - detail 与 list 的 assetId 一致；revision 非空不透明；连续 read revision 稳定；
 * - nativeFile 默认遮蔽（maskedText 无占位明文、含遮蔽标记、sensitiveSegments 全 masked、
 *   structuredView disabled 且带稳定 reasonCode）；
 * - 外部变化 + 失效后重读 revision 已变化；
 * - 全部 snapshot 的 JSON 序列化经合成敏感占位值扫描。
 */
import { containsSyntheticSecret, SENSITIVE_MASK } from '../../fixtures/sensitive-masking';
import type { FrontendGateway } from '../../src/contract/gateway';
import type {
  AssetDetailQuery,
  AssetDetailSnapshot,
  AssetListQuery,
  AssetListSnapshot,
  NativeFileQuery,
  NativeFileSnapshot,
} from '../../src/contract/types';

export interface GatewayContractCapabilities {
  /** 触发一次失效（事件或 core 侧等价物），使受影响 query 需要重读 */
  triggerInvalidation(): Promise<void>;
  /** 模拟磁盘外部变化：后续 read 应反映新的 revision */
  simulateExternalChange(): Promise<void>;
}

export interface GatewayContractInput {
  createGateway: () => Promise<FrontendGateway>;
  capabilities: GatewayContractCapabilities;
}

export interface GatewayContractResult {
  passed: string[];
}

export class ContractAssertionError extends Error {
  constructor(check: string, detail: string) {
    super(`[${check}] ${detail}`);
    this.name = 'ContractAssertionError';
  }
}

function assert(check: string, condition: boolean, detail: string): void {
  if (!condition) {
    throw new ContractAssertionError(check, detail);
  }
}

function assertNoSyntheticSecret(check: string, label: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  assert(
    check,
    !containsSyntheticSecret(serialized),
    `${label} 的 JSON 序列化包含合成敏感占位明文`,
  );
}

const LIST_QUERY: AssetListQuery = {
  kind: 'assetList',
  scope: { kind: 'currentAssetType', assetType: 'skill' },
};

/**
 * 运行 FE-01 契约断言；全部通过时返回通过的检查名列表，任一失败抛出
 * ContractAssertionError。
 */
export async function runGatewayContract(
  input: GatewayContractInput,
): Promise<GatewayContractResult> {
  const passed: string[] = [];
  const gateway = await input.createGateway();

  // --- list snapshot -------------------------------------------------------
  const listResult = await gateway.read(LIST_QUERY);
  assert('list.readSucceeded', listResult.kind === 'readSucceeded', 'AssetListQuery 未成功');
  if (listResult.kind !== 'readSucceeded') {
    throw new ContractAssertionError('list.readSucceeded', 'unreachable');
  }
  const list: AssetListSnapshot = listResult.snapshot;
  assert('list.singleAsset', list.assets.length === 1, `资产数=${list.assets.length}，期望 1`);
  const summary = list.assets[0];
  assert('list.displayName', summary.displayName === 'Demo Skill', summary.displayName);
  assert('list.assetType', summary.asset.assetType === 'skill', summary.asset.assetType);
  assert(
    'list.agents',
    summary.agents.length === 1 && summary.agents[0] === 'claude-code',
    JSON.stringify(summary.agents),
  );
  assert('list.scope', summary.scope === 'global', summary.scope);
  assert('list.availability', summary.availability.kind === 'allowed', summary.availability.kind);
  assert('list.noAnomalies', summary.anomalies.length === 0, JSON.stringify(summary.anomalies));
  assert(
    'list.sourceTier',
    summary.sourceTier.id === 'user-global-root' && summary.sourceTier.label.length > 0,
    JSON.stringify(summary.sourceTier),
  );
  passed.push('list');

  // --- detail snapshot -----------------------------------------------------
  const detailQuery: AssetDetailQuery = { kind: 'assetDetail', asset: summary.asset };
  const detailResult = await gateway.read(detailQuery);
  assert('detail.readSucceeded', detailResult.kind === 'readSucceeded', 'AssetDetailQuery 未成功');
  if (detailResult.kind !== 'readSucceeded') {
    throw new ContractAssertionError('detail.readSucceeded', 'unreachable');
  }
  const detail: AssetDetailSnapshot = detailResult.snapshot;
  assert(
    'detail.assetIdConsistent',
    detail.detail.asset.assetId === summary.asset.assetId,
    `${detail.detail.asset.assetId} !== ${summary.asset.assetId}`,
  );
  assert(
    'detail.revisionOpaque',
    typeof detail.revision === 'string' && detail.revision.length > 0,
    'revision 为空或非字符串',
  );
  const detailAgain = await gateway.read(detailQuery);
  assert(
    'detail.revisionStable',
    detailAgain.kind === 'readSucceeded' && detailAgain.snapshot.revision === detail.revision,
    '连续两次 read 的 revision 不稳定',
  );
  passed.push('detail');

  // --- nativeFile snapshot -------------------------------------------------
  const fileQuery: NativeFileQuery = {
    kind: 'nativeFile',
    asset: summary.asset,
    fileId: detail.detail.primaryFile.fileId,
  };
  const fileResult = await gateway.read(fileQuery);
  assert('file.readSucceeded', fileResult.kind === 'readSucceeded', 'NativeFileQuery 未成功');
  if (fileResult.kind !== 'readSucceeded') {
    throw new ContractAssertionError('file.readSucceeded', 'unreachable');
  }
  const file: NativeFileSnapshot = fileResult.snapshot;
  assert('file.sourceKind', file.content.kind === 'source', file.content.kind);
  if (file.content.kind === 'source') {
    assert(
      'file.maskedTextClean',
      !containsSyntheticSecret(file.content.maskedText),
      'maskedText 含合成敏感占位明文',
    );
    assert(
      'file.maskMarkerPresent',
      file.content.maskedText.includes(SENSITIVE_MASK),
      'maskedText 不含遮蔽标记',
    );
    assert(
      'file.segmentsMasked',
      file.content.sensitiveSegments.every((segment) => segment.displayState === 'masked'),
      '存在非 masked 的 sensitiveSegment',
    );
  }
  assert(
    'file.structuredViewDisabled',
    file.structuredView.kind === 'disabled' && file.structuredView.reasonCode.length > 0,
    'structuredView 不是带稳定 reasonCode 的 disabled',
  );
  passed.push('nativeFile');

  // --- 外部变化 + 失效 → 重读 revision 变化 ---------------------------------
  await input.capabilities.simulateExternalChange();
  await input.capabilities.triggerInvalidation();
  const detailAfterChange = await gateway.read(detailQuery);
  assert(
    'revision.changedAfterExternalChange',
    detailAfterChange.kind === 'readSucceeded' &&
      detailAfterChange.snapshot.revision !== detail.revision,
    '外部变化后重读的 revision 未变化',
  );
  passed.push('revisionInvalidation');

  // --- 全部 snapshot 敏感占位值扫描 -----------------------------------------
  assertNoSyntheticSecret('masking', 'AssetListSnapshot', list);
  assertNoSyntheticSecret('masking', 'AssetDetailSnapshot', detail);
  assertNoSyntheticSecret('masking', 'NativeFileSnapshot', file);
  if (detailAfterChange.kind === 'readSucceeded') {
    assertNoSyntheticSecret(
      'masking',
      'AssetDetailSnapshot(afterChange)',
      detailAfterChange.snapshot,
    );
  }
  passed.push('masking');

  return { passed };
}
