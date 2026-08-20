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

/// 原生归属与当前读取 view 分离。项目 identity 仅为 opaque id，展示名和路径
/// 不得参与 identity 或适用性判定。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeOwnership {
    Global,
    Project { project_id: String },
}

impl NativeOwnership {
    pub fn kind(&self) -> &'static str {
        match self {
            NativeOwnership::Global => "global",
            NativeOwnership::Project { .. } => "project",
        }
    }
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
    pub native_ownership: NativeOwnership,
}

/// Hook 只允许在 adapter compatibility 边界被解码为这一条安全记录。未知字段
/// 的原始值不属于任何 snapshot 或 UI surface：record 只公开稳定字段名和
/// `EXECUTABLE_CONTENT_RISK`，从而既不丢弃 adapter 扩展，也不泄露敏感内容。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookCompatibilityRecord {
    pub asset: AssetRef,
    pub reason_code: ReasonCode,
    pub unknown_field_names: Vec<String>,
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

/// FE-01 workbench status 的唯一权威输入。它刻意不复用 `AssetSummary`
/// 的 generic availability：editable 必须同时来自 editAsset-specific
/// availability 与 compatibility；缺失事实一律不猜测 membership。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkbenchStatusFacts {
    pub edit_asset_availability: Option<ActionAvailability>,
    pub compatibility: Option<CompatibilityStatus>,
    pub normal: Option<bool>,
    pub overridden: Option<bool>,
    pub conflict: Option<bool>,
    pub drift: Option<bool>,
}

pub fn derive_workbench_status_memberships(facts: &WorkbenchStatusFacts) -> Vec<AssetStatusFilter> {
    let mut memberships = Vec::new();
    if matches!(
        (&facts.edit_asset_availability, facts.compatibility),
        (
            Some(ActionAvailability::Allowed),
            Some(CompatibilityStatus::VerifiedWritable)
        )
    ) {
        memberships.push(AssetStatusFilter::Editable);
    }
    match facts.compatibility {
        Some(CompatibilityStatus::RecognizedReadOnly) => {
            memberships.push(AssetStatusFilter::ReadOnly)
        }
        Some(CompatibilityStatus::IncompatibleBlocked) => {
            memberships.push(AssetStatusFilter::Incompatible)
        }
        Some(CompatibilityStatus::VerifiedWritable) | None => {}
    }
    if facts.normal == Some(true) {
        memberships.push(AssetStatusFilter::Normal);
    }
    if facts.overridden == Some(true) {
        memberships.push(AssetStatusFilter::Overridden);
    }
    if facts.conflict == Some(true) {
        memberships.push(AssetStatusFilter::Conflict);
    }
    if facts.drift == Some(true) {
        memberships.push(AssetStatusFilter::Drift);
    }
    memberships
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

// ---------------------------------------------------------------------------
// FE-01 B2 read-only workbench query/snapshot
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MvpAssetType {
    Skill,
    LongTermInstruction,
    Subagent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViewContext {
    All,
    Global,
    Project { project_id: String },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkbenchFilters {
    pub agents: Option<Vec<AgentId>>,
    pub source_ids: Option<Vec<String>>,
    pub statuses: Option<Vec<AssetStatusFilter>>,
    pub project_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbenchQuery {
    pub asset_type: MvpAssetType,
    pub view_context: ViewContext,
    pub filters: Option<WorkbenchFilters>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalLocatorQuery {
    pub search_text: String,
    pub asset_types: Vec<MvpAssetType>,
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

/// FE-03 当前只开放敏感段的 `modify` read；`view` 仍属于后续 FE-10 范围。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SensitiveAccessScope {
    Modify,
}

/// FE-03 当前只允许 source 编辑表面消费短生命周期的敏感段结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SensitiveWorkbenchSurface {
    Source,
}

/// 敏感段访问仍是既有 `read` verb 的封闭 query。调用方必须带回刚读取到的
/// asset/file/segment/revision 事实；core 不从路径或前端状态推断任何绑定。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SensitiveRevealQuery {
    pub asset: AssetRef,
    pub file_id: String,
    pub segment_id: String,
    pub file_revision: String,
    pub asset_revision: String,
    pub scope: SensitiveAccessScope,
    pub surface: SensitiveWorkbenchSurface,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Query {
    AssetList(AssetListQuery),
    Workbench(WorkbenchQuery),
    GlobalLocator(GlobalLocatorQuery),
    AssetDetail(AssetDetailQuery),
    NativeFile(NativeFileQuery),
    SensitiveReveal(SensitiveRevealQuery),
    ProjectApplicability(ProjectApplicabilityQuery),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentSource {
    GlobalApplicable,
    ProjectNative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillPresence {
    Absent,
    Present,
    Unknown,
    Blocked,
    Stale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillActivation {
    NotApplicable,
    Enabled,
    Disabled,
    Unknown,
    Blocked,
    Stale,
}

/// FE-01 只读 Skill cell 的操作可用性事实。它独立于通用 AssetCapabilities，
/// 以免把未来 ticket 的 write command 映射进本 read-only slice。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillCellAvailability {
    Allowed,
    Disabled { reason_code: ReasonCode },
    Blocked { reason_code: ReasonCode },
}

/// 可选的权威事务观察值。FE-01 只展示它，绝不创建或推进该事务。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillTargetPending {
    pub operation_id: String,
    pub phase: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillTargetState {
    pub agent: AgentId,
    pub presence: SkillPresence,
    pub activation: SkillActivation,
    pub applicability: ApplicabilityResolution,
    pub enable_availability: SkillCellAvailability,
    pub disable_availability: SkillCellAvailability,
    pub pending: Option<SkillTargetPending>,
    pub stable_reason: Option<String>,
}

impl SkillTargetState {
    /// FE-01 cell facts are read-only, but their authority still has a closed semantic form.
    pub fn is_semantically_valid(&self) -> bool {
        let absent = matches!(self.presence, SkillPresence::Absent);
        let present = matches!(self.presence, SkillPresence::Present);
        let not_applicable = matches!(self.activation, SkillActivation::NotApplicable);
        let active = matches!(
            self.activation,
            SkillActivation::Enabled | SkillActivation::Disabled
        );
        if absent != not_applicable || present != active {
            return false;
        }

        let unresolved = matches!(
            self.presence,
            SkillPresence::Unknown | SkillPresence::Blocked | SkillPresence::Stale
        ) || matches!(
            self.activation,
            SkillActivation::Unknown | SkillActivation::Blocked | SkillActivation::Stale
        ) || matches!(
            self.applicability,
            ApplicabilityResolution::Unknown
                | ApplicabilityResolution::Blocked
                | ApplicabilityResolution::Stale
        );
        if unresolved {
            return !matches!(self.enable_availability, SkillCellAvailability::Allowed)
                && !matches!(self.disable_availability, SkillCellAvailability::Allowed);
        }

        match (self.presence, self.activation) {
            (SkillPresence::Absent, SkillActivation::NotApplicable) => {
                !matches!(self.disable_availability, SkillCellAvailability::Allowed)
            }
            (SkillPresence::Present, SkillActivation::Enabled) => {
                !matches!(self.enable_availability, SkillCellAvailability::Allowed)
            }
            (SkillPresence::Present, SkillActivation::Disabled) => {
                !matches!(self.disable_availability, SkillCellAvailability::Allowed)
            }
            _ => true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbenchRow {
    pub summary: AssetSummary,
    pub sort_base_name: String,
    pub authoritative_input_order: u32,
    pub status_memberships: Vec<AssetStatusFilter>,
    pub skill_target_states: Vec<SkillTargetState>,
    pub redacted_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbenchSegment {
    pub id: String,
    pub source: SegmentSource,
    pub display_label: String,
    pub project_id: Option<String>,
    pub rows: Vec<WorkbenchRow>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbenchFinding {
    pub asset_id: String,
    pub reason_code: ReasonCode,
    pub context: EffectiveProjectContext,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbenchActualReadSnapshot {
    pub query: WorkbenchQuery,
    pub authoritative_read_revision: String,
    pub segments: Vec<WorkbenchSegment>,
    pub effective_contexts: Vec<EffectiveProjectContext>,
    pub findings: Vec<WorkbenchFinding>,
    pub aggregate_total: u32,
    pub index_status: IndexStatus,
    pub read_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocatorResult {
    pub row: WorkbenchRow,
    pub destination_view_context: ViewContext,
    pub destination: LocatorDestination,
    pub matched_field: LocatorMatchedField,
}

/// FE-01 locator 只有 Skill cells detail 是可消费 destination；其余只读类型
/// 不伪装成 Skill detail，而以稳定失败 surface 返回给 UI。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocatorDestination {
    SkillDetail {
        asset: AssetRef,
    },
    /// FE-02：长期指令和 Subagent 使用同一只读详情 destination。Hook 永远
    /// 不会构造此 variant。
    TypeSpecificDetail {
        asset: AssetRef,
    },
    UnsupportedReadOnly {
        asset: AssetRef,
        reason_code: ReasonCode,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocatorMatchedField {
    DisplayName,
    AssetType,
    Agent,
    Ownership,
    ProjectHint,
    RedactedSummary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocatorGroup {
    pub asset_type: MvpAssetType,
    pub results: Vec<LocatorResult>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalLocatorSnapshot {
    pub groups: Vec<LocatorGroup>,
    pub aggregate_total: u32,
    pub read_at: String,
}

// ---------------------------------------------------------------------------
// FE-07R：只读项目适用性 actual-read projection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectApplicabilityView {
    All,
    Global,
    Project { project_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectApplicabilityQuery {
    pub view: ProjectApplicabilityView,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplicabilityResolution {
    Resolved,
    Unknown,
    Blocked,
    Stale,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProvenanceSource {
    BuiltIn,
    ActivePackage {
        package_identity: String,
        package_version: String,
    },
}

impl ProvenanceSource {
    pub fn kind(&self) -> &'static str {
        match self {
            ProvenanceSource::BuiltIn => "builtIn",
            ProvenanceSource::ActivePackage { .. } => "activePackage",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterProvenance {
    pub identity: String,
    pub version: String,
    pub source: ProvenanceSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleProvenance {
    pub identity: String,
    pub version: String,
    pub source: ProvenanceSource,
}

/// 某全局原生资产对某个具体项目的 versioned resolver fact。非 resolved
/// 状态一定携带稳定 reason code，并且绝不产生 project global projection。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveProjectContext {
    pub asset: AssetRef,
    pub project_id: String,
    pub project_display_name: String,
    pub adapter: AdapterProvenance,
    pub rule: RuleProvenance,
    pub authoritative_read_revision: String,
    pub source_tier_id: String,
    pub load_order: u32,
    pub priority: i32,
    pub override_relation: Option<OverrideRelation>,
    pub resolution: ApplicabilityResolution,
    pub reason_code: Option<ReasonCode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicabilityFinding {
    pub asset: AssetRef,
    pub context: EffectiveProjectContext,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectApplicabilitySegmentKind {
    ProjectNative,
    GlobalApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectApplicabilitySegment {
    pub id: String,
    pub kind: ProjectApplicabilitySegmentKind,
    pub display_label: String,
    pub project_id: Option<String>,
    pub assets: Vec<AssetSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectApplicabilitySnapshot {
    pub query: ProjectApplicabilityQuery,
    pub authoritative_read_revision: String,
    pub segments: Vec<ProjectApplicabilitySegment>,
    pub findings: Vec<ApplicabilityFinding>,
    pub effective_contexts: Vec<EffectiveProjectContext>,
    pub aggregate_total: u32,
    /// ISO 8601
    pub read_at: String,
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
    /// 类型特定的只读事实；不含 draft、intent 或任何可执行 payload。
    pub read_surface: AssetReadSurface,
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

/// FE-02 类型特定只读详情。Subagent 的未知/扩展内容不解析为可编辑字段；
/// 正文仍只通过 NativeFile 在遮蔽后读取。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetReadSurface {
    Skill {
        agent_target_states: Vec<SkillTargetState>,
        source_read_availability: ActionAvailability,
        unknown_content_reason: Option<ReasonCode>,
    },
    LongTermInstruction {
        markdown_file: NativeFileRef,
    },
    Subagent {
        model: Option<String>,
        tools: Vec<String>,
        permissions: Vec<String>,
        body_file: NativeFileRef,
        read_only_reason: Option<ReasonCode>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SensitiveSegmentRef {
    pub segment_id: String,
    pub file_id: String,
    pub revision: String,
    pub display_state: SensitiveDisplayState,
}

/// 已遮蔽 source 的有序安全投影；敏感内容只以当前 read 的 opaque segment identity 表示。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MaskedSourcePart {
    Text { text: String },
    SensitivePlaceholder { segment_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaskedSourceContent {
    pub masked_text: String,
    pub sensitive_segments: Vec<SensitiveSegmentRef>,
    /// 加性字段：无敏感文件保持 None，以兼容只消费 legacy masked_text 的 read consumer。
    pub masked_parts: Option<Vec<MaskedSourcePart>>,
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

/// 仅供当前 read response 消费的 opaque grant metadata。它不携带可重放操作、
/// 草稿或写入内容；未来的权威 write consumer 必须复验全部 binding 与 expiry。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SensitiveAccessGrant {
    pub grant_id: String,
    pub asset: AssetRef,
    pub file_id: String,
    pub segment_id: String,
    pub file_revision: String,
    pub asset_revision: String,
    pub scope: SensitiveAccessScope,
    pub surface: SensitiveWorkbenchSurface,
    /// ISO 8601 UTC；由 Rust authority 签发，前端不得自行延展。
    pub expires_at: String,
}

/// 只存在于一次 `SensitiveRevealQuery` response 的短生命周期结果。前端后续
/// 只能转入私有 ephemeral sensitive buffer，绝不可放进 session snapshot 或 draft。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SensitiveRevealSnapshot {
    pub plaintext: String,
    pub grant: SensitiveAccessGrant,
}

// ---------------------------------------------------------------------------
// Snapshot 封闭 union 与 WorkspaceEvent（FE-01 子集）
// ---------------------------------------------------------------------------

// 每次 read 只在栈上构造一次，variant 大小差异不是热点，不做装箱。
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Snapshot {
    AssetList(AssetListSnapshot),
    Workbench(WorkbenchActualReadSnapshot),
    GlobalLocator(GlobalLocatorSnapshot),
    ProjectApplicability(ProjectApplicabilitySnapshot),
    AssetDetail(AssetDetailSnapshot),
    NativeFile(NativeFileSnapshot),
    SensitiveReveal(SensitiveRevealSnapshot),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceEvent {
    AssetsInvalidated { asset_type: Option<AssetType> },
    AssetDriftDetected { asset_id: String },
    IndexStatusChanged { index_status: IndexStatus },
    CompatibilityChanged { asset_id: String },
}
