//! FE-01 只读切片的 Rust domain 类型。
//!
//! 与 `src/contract/types.ts` 的 FE-01 封闭子集一一对应。domain 类型不 derive
//! serde / TS，不依赖 Tauri；wire 形状完全由 `wire.rs` 的独立 DTO 层拥有
//! （ARC-06c），两侧通过显式转换衔接。不透明 id（assetId / fileId /
//! nativeUnitRef / adapterIdentity / revision / segmentId）一律为 String。

// ---------------------------------------------------------------------------
// 基础枚举
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetType {
    Skill,
    LongTermInstruction,
    Subagent,
    Hook,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentId {
    ClaudeCode,
    Codex,
    GeminiCli,
    Opencode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetScope {
    Global,
    Project,
}

/// 稳定原因码全集（契约 §6.13，FE-01 封闭列出）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasonCode {
    UnknownAgentVersion,
    IncompatibleStructure,
    UnsupportedCapability,
    ReadOnlyPolicy,
    PermissionDenied,
    OutsideManagedScope,
    ProjectUnavailable,
    UnknownFieldPreserved,
    NonTextUnpreviewable,
    ValidationFailed,
    ExecutableContentRisk,
    IndexStale,
    ExternalChange,
    ReprepareRequired,
    MergeConflict,
    TargetNameConflict,
    ConversionDegraded,
    ConversionBlocked,
    ReadFailed,
    SnapshotRequired,
    SnapshotFailed,
    SecureStorageUnavailable,
    DiskFull,
    WriteFailed,
    RollbackFailed,
    RecoveryTargetOccupied,
    AdapterSignatureInvalid,
    AdapterCompatibilityMismatch,
    AdapterRegressionFailed,
    ImportSourceUnavailable,
    ExportDestinationInvalid,
    GatewayUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexStatus {
    Fresh,
    Stale,
    Rebuilding,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompatibilityStatus {
    VerifiedWritable,
    RecognizedReadOnly,
    IncompatibleBlocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SensitiveDisplayState {
    Masked,
    TemporarilyRevealed,
    ChangedMasked,
}

// ---------------------------------------------------------------------------
// 可用性与恢复动作
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecoveryAction {
    RetryRead,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionAvailability {
    Allowed,
    Disabled {
        reason_code: ReasonCode,
        recovery_action: Option<RecoveryAction>,
    },
}

// ---------------------------------------------------------------------------
// 身份与摘要
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetRef {
    pub asset_id: String,
    pub asset_type: AssetType,
    pub native_unit_ref: String,
    pub adapter_identity: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnomalyKind {
    ReadOnly,
    Incompatible,
    Conflict,
    Drift,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Anomaly {
    pub kind: AnomalyKind,
    pub reason_code: ReasonCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetContextHint {
    Project { project_name: String },
    Path { path_hint: String },
}

/// 来源层级（产品基线 §7.4）：id 为不透明身份，label 为用户可读展示标签。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceTier {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetSummary {
    pub asset: AssetRef,
    pub display_name: String,
    pub anomalies: Vec<Anomaly>,
    pub agents: Vec<AgentId>,
    pub scope: AssetScope,
    pub context_hint: AssetContextHint,
    pub source_tier: SourceTier,
    pub availability: ActionAvailability,
}

// ---------------------------------------------------------------------------
// Query（FE-01 封闭子集：assetList / assetDetail / nativeFile）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetListScope {
    CurrentAssetType { asset_type: AssetType },
    AllAssets,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetStatusFilter {
    Editable,
    ReadOnly,
    Incompatible,
    Normal,
    Overridden,
    Conflict,
    Drift,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetGroupBy {
    None,
    Agent,
    Project,
    Scope,
    Source,
    Status,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AssetListFilters {
    pub agents: Option<Vec<AgentId>>,
    pub projects: Option<Vec<String>>,
    pub scopes: Option<Vec<AssetScope>>,
    pub sources: Option<Vec<String>>,
    pub statuses: Option<Vec<AssetStatusFilter>>,
    pub group_by: Option<AssetGroupBy>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetListQuery {
    pub scope: AssetListScope,
    pub search_text: Option<String>,
    pub filters: Option<AssetListFilters>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetDetailQuery {
    pub asset: AssetRef,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeFileQuery {
    pub asset: AssetRef,
    pub file_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Query {
    AssetList(AssetListQuery),
    AssetDetail(AssetDetailQuery),
    NativeFile(NativeFileQuery),
}

// ---------------------------------------------------------------------------
// ReadResult
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadFailure {
    pub reason_code: ReasonCode,
    pub message: String,
    pub recovery_action: Option<RecoveryAction>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadResult<T> {
    Succeeded(T),
    Failed(ReadFailure),
}

// ---------------------------------------------------------------------------
// Snapshot：AssetList
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetListSnapshot {
    pub assets: Vec<AssetSummary>,
    pub index_status: IndexStatus,
    pub scope: AssetListScope,
    /// ISO 8601
    pub queried_at: String,
    /// ISO 8601
    pub index_updated_at: String,
}

// ---------------------------------------------------------------------------
// Snapshot：AssetDetail
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeUnitKind {
    SingleFile,
    MultiFileDirectory,
    ConfigBlock,
    PluginModule,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveContext {
    pub agent: AgentId,
    pub scope: AssetScope,
    pub source_tier_label: String,
    pub precedence: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetCapabilities {
    pub edit: ActionAvailability,
    pub convert: ActionAvailability,
    pub export: ActionAvailability,
    pub delete: ActionAvailability,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileTreeNode {
    pub name: String,
    pub file: Option<NativeFileRef>,
    pub children: Option<Vec<FileTreeNode>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetDetail {
    pub asset: AssetRef,
    pub display_name: String,
    pub native_unit_kind: NativeUnitKind,
    pub revision: String,
    pub compatibility: CompatibilityStatus,
    pub capabilities: AssetCapabilities,
    pub effective_contexts: Vec<EffectiveContext>,
    pub primary_file: NativeFileRef,
    pub file_tree_root: Option<FileTreeNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverrideRelationKind {
    Overrides,
    OverriddenBy,
    Shadowed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverrideRelation {
    pub kind: OverrideRelationKind,
    pub other_asset_id: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceAnchor {
    Project { project_name: String },
    UserHome,
    GlobalRoot { label: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectorData {
    pub agents: Vec<AgentId>,
    pub scope: AssetScope,
    pub effective_contexts: Vec<EffectiveContext>,
    pub source_anchor: SourceAnchor,
    pub path_display: String,
    pub compatibility: CompatibilityStatus,
    pub overrides: Vec<OverrideRelation>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetDetailSnapshot {
    pub detail: AssetDetail,
    pub inspector: InspectorData,
    pub revision: String,
}

// ---------------------------------------------------------------------------
// Snapshot：NativeFile
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Text,
    NonText,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeFileRef {
    pub file_id: String,
    pub name: String,
    pub relative_path: String,
    pub file_kind: FileKind,
    pub is_primary: bool,
    pub can_preview: ActionAvailability,
    pub can_edit: ActionAvailability,
    pub has_draft_changes: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SensitiveSegmentRef {
    pub segment_id: String,
    pub file_id: String,
    pub revision: String,
    pub display_state: SensitiveDisplayState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaskedSourceContent {
    pub masked_text: String,
    pub sensitive_segments: Vec<SensitiveSegmentRef>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NonTextMetadataContent {
    pub file_kind_label: String,
    pub size_bytes: u64,
    pub path_display: String,
    pub reason_code: ReasonCode,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeFileContent {
    Source(MaskedSourceContent),
    NonTextMetadata(NonTextMetadataContent),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeFileSnapshot {
    pub file: NativeFileRef,
    pub revision: String,
    pub asset_revision: String,
    pub content: NativeFileContent,
    pub structured_view: ActionAvailability,
}

// ---------------------------------------------------------------------------
// Snapshot 封闭 union 与 WorkspaceEvent（FE-01 子集）
// ---------------------------------------------------------------------------

// 每次 read 只在栈上构造一次，variant 大小差异不是热点，不做装箱。
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Snapshot {
    AssetList(AssetListSnapshot),
    AssetDetail(AssetDetailSnapshot),
    NativeFile(NativeFileSnapshot),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceEvent {
    AssetsInvalidated { asset_type: Option<AssetType> },
    AssetDriftDetected { asset_id: String },
    IndexStatusChanged { index_status: IndexStatus },
    CompatibilityChanged { asset_id: String },
}
