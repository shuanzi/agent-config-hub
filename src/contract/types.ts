/**
 * FrontendGateway 语言无关契约类型的 TypeScript 表达（FE-01 封闭子集）。
 *
 * 事实来源：`docs/frontend/Agent_Config_Manager_前端契约_v0.1.md` §4–§7。
 * 本文件只覆盖 FE-01（只读浏览）所需的 Query / Snapshot / Event 类型；
 * prepare / apply / SensitiveRevealQuery / ManagementQuery / OperationProgressQuery
 * 由对应后续票据扩展，本票据不提前声明。
 *
 * 不透明值约定：assetId / fileId / nativeUnitRef / adapterIdentity / revision /
 * segmentId 均为不透明字符串；路径只用于显示，不能充当身份。
 */

// ---------------------------------------------------------------------------
// 基础枚举
// ---------------------------------------------------------------------------

/** 四类一级资产（产品基线 §4.3） */
export type AssetType = 'skill' | 'longTermInstruction' | 'subagent' | 'hook';

/** 四个一等 Agent（产品基线 §6.1） */
export type AgentId = 'claude-code' | 'codex' | 'gemini-cli' | 'opencode';

/** 全局／项目作用域 */
export type AssetScope = 'global' | 'project';

/** 原生归属；项目 identity 始终 opaque，显示名/路径不能代替它。 */
export type NativeOwnership = { kind: 'global' } | { kind: 'project'; projectId: string };

/** 稳定原因码（契约 §6.13，FE-01 全量列出以保持封闭） */
export type ReasonCode =
  | 'UNKNOWN_AGENT_VERSION'
  | 'INCOMPATIBLE_STRUCTURE'
  | 'UNSUPPORTED_CAPABILITY'
  | 'READ_ONLY_POLICY'
  | 'PERMISSION_DENIED'
  | 'OUTSIDE_MANAGED_SCOPE'
  | 'PROJECT_UNAVAILABLE'
  | 'UNKNOWN_FIELD_PRESERVED'
  | 'NON_TEXT_UNPREVIEWABLE'
  | 'VALIDATION_FAILED'
  | 'EXECUTABLE_CONTENT_RISK'
  | 'INDEX_STALE'
  | 'EXTERNAL_CHANGE'
  | 'REPREPARE_REQUIRED'
  | 'MERGE_CONFLICT'
  | 'TARGET_NAME_CONFLICT'
  | 'CONVERSION_DEGRADED'
  | 'CONVERSION_BLOCKED'
  | 'READ_FAILED'
  | 'SNAPSHOT_REQUIRED'
  | 'SNAPSHOT_FAILED'
  | 'SECURE_STORAGE_UNAVAILABLE'
  | 'DISK_FULL'
  | 'WRITE_FAILED'
  | 'ROLLBACK_FAILED'
  | 'RECOVERY_TARGET_OCCUPIED'
  | 'ADAPTER_SIGNATURE_INVALID'
  | 'ADAPTER_COMPATIBILITY_MISMATCH'
  | 'ADAPTER_REGRESSION_FAILED'
  | 'IMPORT_SOURCE_UNAVAILABLE'
  | 'EXPORT_DESTINATION_INVALID'
  | 'GATEWAY_UNAVAILABLE';

/** 索引状态（契约 §6.4） */
export type IndexStatus = 'fresh' | 'stale' | 'rebuilding' | 'failed';

/** 兼容状态（契约 §6.4） */
export type CompatibilityStatus = 'verifiedWritable' | 'recognizedReadOnly' | 'incompatibleBlocked';

/** 敏感片段显示状态（契约 §6.4） */
export type SensitiveDisplayState = 'masked' | 'temporarilyRevealed' | 'changedMasked';

// ---------------------------------------------------------------------------
// 可用性与恢复动作
// ---------------------------------------------------------------------------

/** 用户恢复动作（FE-01 只需要重读；后续票据按契约扩展封闭集合） */
export interface RecoveryAction {
  kind: 'retryRead';
}

/** 操作可用性（契约 §6.4）：allowed 或 disabled(稳定原因码, 可选恢复动作) */
export type ActionAvailability =
  | { kind: 'allowed' }
  | { kind: 'disabled'; reasonCode: ReasonCode; recoveryAction?: RecoveryAction };

// ---------------------------------------------------------------------------
// 身份与摘要
// ---------------------------------------------------------------------------

/** 不透明资产引用（契约 §6.3）：路径不能单独充当身份 */
export interface AssetRef {
  assetId: string;
  assetType: AssetType;
  nativeUnitRef: string;
  adapterIdentity: string;
  nativeOwnership: NativeOwnership;
}

/** 关键异常（第一行只附带会改变判断的异常；正常状态不常驻标签） */
export interface Anomaly {
  kind: 'readOnly' | 'incompatible' | 'conflict' | 'drift';
  reasonCode: ReasonCode;
  /** 用户可读说明；不得包含敏感明文或真实路径 */
  message: string;
}

/** 第二行消歧提示：优先项目名称，没有项目上下文时用原生路径提示（中部省略由 UI 处理） */
export type AssetContextHint =
  { kind: 'project'; projectName: string } | { kind: 'path'; pathHint: string };

/** 来源层级（产品基线 §7.4）：id 为不透明身份，label 为用户可读展示标签 */
export interface SourceTier {
  id: string;
  label: string;
}

/** 资产列表行（契约 §6.3 AssetSummary） */
export interface AssetSummary {
  asset: AssetRef;
  displayName: string;
  anomalies: Anomaly[];
  /** 可识别该资产的 Agent（去重，稳定顺序） */
  agents: AgentId[];
  scope: AssetScope;
  contextHint: AssetContextHint;
  sourceTier: SourceTier;
  availability: ActionAvailability;
}

// ---------------------------------------------------------------------------
// Query（FE-01 封闭子集：list / detail / nativeFile）
// ---------------------------------------------------------------------------

export type AssetListScope =
  { kind: 'currentAssetType'; assetType: AssetType } | { kind: 'allAssets' };

/** 状态筛选维度（可编辑/只读/不兼容 与 正常/覆盖/冲突/漂移） */
export type AssetStatusFilter =
  'editable' | 'readOnly' | 'incompatible' | 'normal' | 'overridden' | 'conflict' | 'drift';

/** 显式分组维度；'none' 为默认平铺 */
export type AssetGroupBy = 'none' | 'agent' | 'project' | 'scope' | 'source' | 'status';

export interface AssetListFilters {
  agents?: AgentId[];
  /** 不透明项目身份（合成 fixture 使用占位 id） */
  projects?: string[];
  scopes?: AssetScope[];
  /** 来源层级的不透明身份 */
  sources?: string[];
  statuses?: AssetStatusFilter[];
  groupBy?: AssetGroupBy;
}

export interface AssetListQuery {
  kind: 'assetList';
  scope: AssetListScope;
  searchText?: string;
  filters?: AssetListFilters;
}

export interface AssetDetailQuery {
  kind: 'assetDetail';
  asset: AssetRef;
}

export interface NativeFileQuery {
  kind: 'nativeFile';
  asset: AssetRef;
  fileId: string;
}

/** FE-07R 的只读 project applicability projection query。 */
export type ProjectApplicabilityView =
  { kind: 'all' } | { kind: 'global' } | { kind: 'project'; projectId: string };

export interface ProjectApplicabilityQuery {
  kind: 'projectApplicability';
  view: ProjectApplicabilityView;
}

export type Query = AssetListQuery | ProjectApplicabilityQuery | AssetDetailQuery | NativeFileQuery;

// ---------------------------------------------------------------------------
// ReadResult（契约 §6.2）
// ---------------------------------------------------------------------------

export type ReadResult<T> =
  | { kind: 'readSucceeded'; snapshot: T }
  | {
      kind: 'readFailed';
      reasonCode: ReasonCode;
      /** 用户可读说明；UI 不得从异常字符串分支 */
      message: string;
      recoveryAction?: RecoveryAction;
    };

// ---------------------------------------------------------------------------
// Snapshot：AssetList
// ---------------------------------------------------------------------------

export interface AssetListSnapshot {
  kind: 'assetList';
  assets: AssetSummary[];
  indexStatus: IndexStatus;
  scope: AssetListScope;
  /** 本次读取时间（ISO 8601） */
  queriedAt: string;
  /** 索引最近更新时间（ISO 8601）；stale 状态必须可读 */
  indexUpdatedAt: string;
}

/** 已解析项目适用性的四种封闭状态；非 resolved 必带稳定原因。 */
export type ApplicabilityResolution = 'resolved' | 'unknown' | 'blocked' | 'stale';

export type ProvenanceSource =
  { kind: 'builtIn' } | { kind: 'activePackage'; packageIdentity: string; packageVersion: string };

export interface AdapterProvenance {
  identity: string;
  version: string;
  source: ProvenanceSource;
}

export interface RuleProvenance {
  identity: string;
  version: string;
  source: ProvenanceSource;
}

export interface EffectiveProjectContext {
  asset: AssetRef;
  projectId: string;
  /** 仅展示；不得用它参与 identity 或 resolution。 */
  projectDisplayName: string;
  adapter: AdapterProvenance;
  rule: RuleProvenance;
  authoritativeReadRevision: string;
  sourceTierId: string;
  loadOrder: number;
  priority: number;
  overrideRelation?: OverrideRelation;
  resolution: ApplicabilityResolution;
  reasonCode?: ReasonCode;
}

export interface ApplicabilityFinding {
  asset: AssetRef;
  context: EffectiveProjectContext;
}

export interface ProjectApplicabilitySegment {
  id: string;
  kind: 'projectNative' | 'globalApplicable';
  displayLabel: string;
  projectId?: string;
  assets: AssetSummary[];
}

/** FE-07R actual-read snapshot；无任何 write intent 或 prepared payload。 */
export interface ProjectApplicabilitySnapshot {
  kind: 'projectApplicability';
  query: Omit<ProjectApplicabilityQuery, 'kind'>;
  authoritativeReadRevision: string;
  segments: ProjectApplicabilitySegment[];
  /** unknown/blocked/stale 仅在 all/global 可检查，绝不成为 project projection。 */
  findings: ApplicabilityFinding[];
  effectiveContexts: EffectiveProjectContext[];
  aggregateTotal: number;
  readAt: string;
}

// ---------------------------------------------------------------------------
// Snapshot：AssetDetail
// ---------------------------------------------------------------------------

export type NativeUnitKind = 'singleFile' | 'multiFileDirectory' | 'configBlock' | 'pluginModule';

/** 生效上下文条目（契约 §5.3） */
export interface EffectiveContext {
  agent: AgentId;
  scope: AssetScope;
  /** 来源层级展示标签（合成值） */
  sourceTierLabel: string;
  /** 加载顺序（数值越小越先加载） */
  precedence: number;
}

/** 资产操作能力（FE-01 仅作事实展示；编辑行为属于后续票据） */
export interface AssetCapabilities {
  edit: ActionAvailability;
  convert: ActionAvailability;
  export: ActionAvailability;
  delete: ActionAvailability;
}

/** 文件树节点（FE-01 单文件资产不渲染树；FE-02 起使用） */
export interface FileTreeNode {
  name: string;
  file?: NativeFileRef;
  children?: FileTreeNode[];
}

export interface AssetDetail {
  asset: AssetRef;
  displayName: string;
  nativeUnitKind: NativeUnitKind;
  revision: string;
  compatibility: CompatibilityStatus;
  capabilities: AssetCapabilities;
  effectiveContexts: EffectiveContext[];
  primaryFile: NativeFileRef;
  fileTreeRoot?: FileTreeNode;
}

/** 覆盖关系（FX-01 为空集合） */
export interface OverrideRelation {
  kind: 'overrides' | 'overriddenBy' | 'shadowed';
  otherAssetId: string;
  note: string;
}

/** 检查器数据（契约 §6.3 InspectorData；FE-01 只展示关键摘要，分组为 FE-02） */
export interface InspectorData {
  agents: AgentId[];
  scope: AssetScope;
  effectiveContexts: EffectiveContext[];
  /** 来源锚点：项目资产锚定项目名，全局资产锚定用户目录或原生全局根 */
  sourceAnchor:
    | { kind: 'project'; projectName: string }
    | { kind: 'userHome' }
    | { kind: 'globalRoot'; label: string };
  /** 单行展示路径（中部省略后的合成路径） */
  pathDisplay: string;
  compatibility: CompatibilityStatus;
  overrides: OverrideRelation[];
}

export interface AssetDetailSnapshot {
  kind: 'assetDetail';
  detail: AssetDetail;
  inspector: InspectorData;
  revision: string;
}

// ---------------------------------------------------------------------------
// Snapshot：NativeFile
// ---------------------------------------------------------------------------

export interface NativeFileRef {
  fileId: string;
  name: string;
  relativePath: string;
  fileKind: 'text' | 'nonText' | 'unknown';
  isPrimary: boolean;
  canPreview: ActionAvailability;
  canEdit: ActionAvailability;
  hasDraftChanges: boolean;
}

/** 敏感片段引用（契约 §6.3）：默认不含明文，绑定资产/文件与 revision */
export interface SensitiveSegmentRef {
  segmentId: string;
  fileId: string;
  revision: string;
  displayState: SensitiveDisplayState;
}

/** 源码内容：gateway 返回的文本已完成默认遮蔽，sensitiveSegments 仅为元数据 */
export interface MaskedSourceContent {
  kind: 'source';
  maskedText: string;
  sensitiveSegments: SensitiveSegmentRef[];
}

/** 非文本只读元数据（契约 §7.5：类型、大小、原生路径与不可预览原因） */
export interface NonTextMetadataContent {
  kind: 'nonTextMetadata';
  fileKindLabel: string;
  sizeBytes: number;
  pathDisplay: string;
  reasonCode: ReasonCode;
  reason: string;
}

export type NativeFileContent = MaskedSourceContent | NonTextMetadataContent;

export interface NativeFileSnapshot {
  kind: 'nativeFile';
  file: NativeFileRef;
  /** 该文件的 revision */
  revision: string;
  /** 所属资产 revision */
  assetRevision: string;
  content: NativeFileContent;
  structuredView: ActionAvailability;
}

// ---------------------------------------------------------------------------
// Snapshot 封闭映射（契约 §6.2：Query 与 Snapshot 一一封闭对应）
// ---------------------------------------------------------------------------

export type SnapshotFor<Q extends Query> = Q extends AssetListQuery
  ? AssetListSnapshot
  : Q extends ProjectApplicabilityQuery
    ? ProjectApplicabilitySnapshot
    : Q extends AssetDetailQuery
      ? AssetDetailSnapshot
      : Q extends NativeFileQuery
        ? NativeFileSnapshot
        : never;

// ---------------------------------------------------------------------------
// observe（FE-01 封闭子集：WorkspaceSubscription + 失效类事件）
// ---------------------------------------------------------------------------

export interface WorkspaceSubscription {
  kind: 'workspace';
  /** 可选：只关心某一资产类型的失效 */
  assetType?: AssetType;
}

export type Subscription = WorkspaceSubscription;

/** 工作区事件（契约 §6.12，FE-01 子集）：只携带身份与类别，不携带事实 */
export type WorkspaceEvent =
  | { kind: 'assetsInvalidated'; assetType?: AssetType }
  | { kind: 'assetDriftDetected'; assetId: string }
  | { kind: 'indexStatusChanged'; indexStatus: IndexStatus }
  | { kind: 'compatibilityChanged'; assetId: string };
