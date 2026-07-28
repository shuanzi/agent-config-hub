/**
 * 用户可见文案映射：稳定 reasonCode / 枚举 → 中文说明。
 * failed 状态只消费 reasonCode（不解析异常字符串），文案只按 reasonCode 分支。
 */
import type {
  AgentId,
  AssetScope,
  AssetStatusFilter,
  AssetType,
  CompatibilityStatus,
  ReasonCode,
} from '../contract/types';

export function assetTypeLabel(assetType: AssetType): string {
  switch (assetType) {
    case 'skill':
      return 'Skills';
    case 'longTermInstruction':
      return '长期指令';
    case 'subagent':
      return 'Subagents';
    case 'hook':
      return 'Hooks';
  }
}

export function agentLabel(agent: AgentId): string {
  return agent;
}

export function scopeLabel(scope: AssetScope): string {
  return scope === 'global' ? '全局' : '项目';
}

export function statusFilterLabel(status: AssetStatusFilter): string {
  switch (status) {
    case 'editable':
      return '可编辑';
    case 'readOnly':
      return '只读';
    case 'incompatible':
      return '不兼容';
    case 'normal':
      return '正常';
    case 'overridden':
      return '被覆盖';
    case 'conflict':
      return '冲突';
    case 'drift':
      return '漂移';
  }
}

export function compatibilityLabel(status: CompatibilityStatus): string {
  switch (status) {
    case 'verifiedWritable':
      return '已验证可写';
    case 'recognizedReadOnly':
      return '已识别（只读）';
    case 'incompatibleBlocked':
      return '不兼容（已阻断）';
  }
}

/** 稳定原因码 → 用户可读说明（不依赖错误文本） */
export function reasonCodeExplanation(reasonCode: ReasonCode): string {
  switch (reasonCode) {
    case 'READ_FAILED':
      return '读取未能完成，磁盘内容可能暂时不可访问。';
    case 'GATEWAY_UNAVAILABLE':
      return '整机能力暂时不可用。';
    case 'PERMISSION_DENIED':
      return '当前系统权限不允许读取该内容。';
    case 'INDEX_STALE':
      return '索引已过期，结果可能不是最新。';
    case 'EXTERNAL_CHANGE':
      return '内容已被外部修改。';
    case 'UNKNOWN_FIELD_PRESERVED':
      return '该内容包含需原样保留的未知字段。';
    case 'NON_TEXT_UNPREVIEWABLE':
      return '非文本内容，无法预览。';
    case 'INCOMPATIBLE_STRUCTURE':
      return '结构不兼容，已阻断。';
    case 'UNKNOWN_AGENT_VERSION':
      return 'Agent 版本未知，仅可只读浏览。';
    default:
      return `操作不可用（原因码：${reasonCode}）。`;
  }
}

export function anomalyLabel(kind: 'readOnly' | 'incompatible' | 'conflict' | 'drift'): string {
  switch (kind) {
    case 'readOnly':
      return '只读';
    case 'incompatible':
      return '不兼容';
    case 'conflict':
      return '冲突';
    case 'drift':
      return '漂移';
  }
}
