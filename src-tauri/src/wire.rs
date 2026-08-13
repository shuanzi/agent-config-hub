//! ARC-06c wire DTO 层：`frontend_gateway_read` command 与
//! `acm://workspace-invalidation` event 的唯一 wire shape 事实源。
//!
//! - envelope 固定为 `{ wireVersion, requestId, payload }`；
//! - payload 均为带显式 `kind` tag 的封闭 union，全部 `deny_unknown_fields`；
//! - 仅本文件中的 DTO derive `ts_rs::TS`，domain 类型不直接导出；
//! - domain↔wire 转换为显式 `From` impl，集中在 `convert` 模块；
//! - `GATEWAY_WIRE_VERSION` 由 `export-wire` bin 一并导出到 TypeScript，
//!   TS 侧不手写第二份版本号。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::domain;

/// 当前唯一支持的 wire 版本；不匹配在 ingress 封闭失败，不做协商或 fallback。
pub const GATEWAY_WIRE_VERSION: u32 = 3;

// ---------------------------------------------------------------------------
// 字符串枚举 DTO
// ---------------------------------------------------------------------------

macro_rules! wire_string_enum {
    ($name:ident, $rename:literal, $( $variant:ident ),* $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
        #[serde(rename_all = $rename)]
        pub enum $name {
            $( $variant ),*
        }
    };
}

wire_string_enum!(
    AssetTypeWire,
    "camelCase",
    Skill,
    LongTermInstruction,
    Subagent,
    Hook
);
wire_string_enum!(AssetScopeWire, "camelCase", Global, Project);
wire_string_enum!(
    MvpAssetTypeWire,
    "camelCase",
    Skill,
    LongTermInstruction,
    Subagent
);
wire_string_enum!(
    SegmentSourceWire,
    "camelCase",
    GlobalApplicable,
    ProjectNative
);
wire_string_enum!(
    SkillPresenceWire,
    "camelCase",
    Absent,
    Present,
    Unknown,
    Blocked,
    Stale
);
wire_string_enum!(
    SkillActivationWire,
    "camelCase",
    NotApplicable,
    Enabled,
    Disabled,
    Unknown,
    Blocked,
    Stale
);
wire_string_enum!(
    ApplicabilityResolutionWire,
    "camelCase",
    Resolved,
    Unknown,
    Blocked,
    Stale
);
wire_string_enum!(
    LocatorMatchedFieldWire,
    "camelCase",
    DisplayName,
    AssetType,
    Agent,
    Ownership,
    ProjectHint,
    RedactedSummary
);
wire_string_enum!(
    ProjectApplicabilitySegmentKindWire,
    "camelCase",
    ProjectNative,
    GlobalApplicable
);
wire_string_enum!(
    IndexStatusWire,
    "camelCase",
    Fresh,
    Stale,
    Rebuilding,
    Failed
);
wire_string_enum!(
    CompatibilityStatusWire,
    "camelCase",
    VerifiedWritable,
    RecognizedReadOnly,
    IncompatibleBlocked
);
wire_string_enum!(
    SensitiveDisplayStateWire,
    "camelCase",
    Masked,
    TemporarilyRevealed,
    ChangedMasked
);
wire_string_enum!(
    AnomalyKindWire,
    "camelCase",
    ReadOnly,
    Incompatible,
    Conflict,
    Drift
);
wire_string_enum!(
    AssetStatusFilterWire,
    "camelCase",
    Editable,
    ReadOnly,
    Incompatible,
    Normal,
    Overridden,
    Conflict,
    Drift
);
wire_string_enum!(
    AssetGroupByWire,
    "camelCase",
    None,
    Agent,
    Project,
    Scope,
    Source,
    Status
);
wire_string_enum!(
    NativeUnitKindWire,
    "camelCase",
    SingleFile,
    MultiFileDirectory,
    ConfigBlock,
    PluginModule
);
wire_string_enum!(
    OverrideRelationKindWire,
    "camelCase",
    Overrides,
    OverriddenBy,
    Shadowed
);
wire_string_enum!(FileKindWire, "camelCase", Text, NonText, Unknown);

/// AgentId 含连字符值，不能走 rename_all。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum AgentIdWire {
    #[serde(rename = "claude-code")]
    ClaudeCode,
    #[serde(rename = "codex")]
    Codex,
    #[serde(rename = "gemini-cli")]
    GeminiCli,
    #[serde(rename = "opencode")]
    Opencode,
}

/// 稳定原因码全集（契约 §6.13）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReasonCodeWire {
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

// ---------------------------------------------------------------------------
// 可用性 / 恢复动作 / 身份
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum RecoveryActionWire {
    RetryRead,
}

// 注：serde 对内部 tag 枚举的容器级 `deny_unknown_fields` 不生效（上游
// issue #1547），因此所有带字段的 variant 一律以 newtype 包裹独立 struct，
// 由 struct 级 `deny_unknown_fields` 在 ingress 拒绝未知字段。

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisabledAvailabilityWire {
    pub reason_code: ReasonCodeWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub recovery_action: Option<RecoveryActionWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum ActionAvailabilityWire {
    Allowed,
    Disabled(DisabledAvailabilityWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetRefWire {
    pub asset_id: String,
    pub asset_type: AssetTypeWire,
    pub native_unit_ref: String,
    pub adapter_identity: String,
    pub native_ownership: NativeOwnershipWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct GlobalNativeOwnershipWire {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectNativeOwnershipWire {
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum NativeOwnershipWire {
    Global(GlobalNativeOwnershipWire),
    Project(ProjectNativeOwnershipWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnomalyWire {
    pub kind: AnomalyKindWire,
    pub reason_code: ReasonCodeWire,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectContextHintWire {
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PathContextHintWire {
    pub path_hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum AssetContextHintWire {
    Project(ProjectContextHintWire),
    Path(PathContextHintWire),
}

// ---------------------------------------------------------------------------
// Query DTO（request payload 封闭 union）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentAssetTypeScopeWire {
    pub asset_type: AssetTypeWire,
}

/// 空 struct 使 `{"kind":"allAssets", …多余字段}` 在 ingress 被拒绝
/// （unit variant 无法挂 deny_unknown_fields）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AllAssetsScopeWire {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum AssetListScopeWire {
    CurrentAssetType(CurrentAssetTypeScopeWire),
    AllAssets(AllAssetsScopeWire),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetListFiltersWire {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agents: Option<Vec<AgentIdWire>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub projects: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scopes: Option<Vec<AssetScopeWire>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sources: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub statuses: Option<Vec<AssetStatusFilterWire>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group_by: Option<AssetGroupByWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetListQueryWire {
    pub scope: AssetListScopeWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub search_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub filters: Option<AssetListFiltersWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetDetailQueryWire {
    pub asset: AssetRefWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileQueryWire {
    pub asset: AssetRefWire,
    pub file_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AllProjectApplicabilityViewWire {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct GlobalProjectApplicabilityViewWire {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectProjectApplicabilityViewWire {
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum ProjectApplicabilityViewWire {
    All(AllProjectApplicabilityViewWire),
    Global(GlobalProjectApplicabilityViewWire),
    Project(ProjectProjectApplicabilityViewWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectApplicabilityQueryWire {
    pub view: ProjectApplicabilityViewWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AllViewContextWire {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct GlobalViewContextWire {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectViewContextWire {
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum ViewContextWire {
    All(AllViewContextWire),
    Global(GlobalViewContextWire),
    Project(ProjectViewContextWire),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchFiltersWire {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agents: Option<Vec<AgentIdWire>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub statuses: Option<Vec<AssetStatusFilterWire>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchQueryWire {
    pub asset_type: MvpAssetTypeWire,
    pub view_context: ViewContextWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub filters: Option<WorkbenchFiltersWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlobalLocatorQueryWire {
    pub search_text: String,
    pub asset_types: Vec<MvpAssetTypeWire>,
}

/// request payload 封闭 union（ARC-02b：显式 tag，不用字符串 route）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum ReadRequestPayload {
    AssetList(AssetListQueryWire),
    Workbench(WorkbenchQueryWire),
    GlobalLocator(GlobalLocatorQueryWire),
    ProjectApplicability(ProjectApplicabilityQueryWire),
    AssetDetail(AssetDetailQueryWire),
    NativeFile(NativeFileQueryWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadRequestEnvelope {
    pub wire_version: u32,
    pub request_id: String,
    pub payload: ReadRequestPayload,
}

// ---------------------------------------------------------------------------
// Snapshot DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceTierWire {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetSummaryWire {
    pub asset: AssetRefWire,
    pub display_name: String,
    pub anomalies: Vec<AnomalyWire>,
    pub agents: Vec<AgentIdWire>,
    pub scope: AssetScopeWire,
    pub context_hint: AssetContextHintWire,
    pub source_tier: SourceTierWire,
    pub availability: ActionAvailabilityWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetListSnapshotWire {
    pub assets: Vec<AssetSummaryWire>,
    pub index_status: IndexStatusWire,
    pub scope: AssetListScopeWire,
    /// ISO 8601
    pub queried_at: String,
    /// ISO 8601
    pub index_updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillTargetStateWire {
    pub agent: AgentIdWire,
    pub presence: SkillPresenceWire,
    pub activation: SkillActivationWire,
    pub applicability: ApplicabilityResolutionWire,
    pub enable_availability: SkillCellAvailabilityWire,
    pub disable_availability: SkillCellAvailabilityWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending: Option<SkillTargetPendingWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stable_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum SkillCellAvailabilityWire {
    Allowed,
    Disabled(SkillCellUnavailableWire),
    Blocked(SkillCellUnavailableWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillCellUnavailableWire {
    pub reason_code: ReasonCodeWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillTargetPendingWire {
    pub operation_id: String,
    pub phase: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchRowWire {
    pub summary: AssetSummaryWire,
    pub sort_base_name: String,
    pub authoritative_input_order: u32,
    pub status_memberships: Vec<AssetStatusFilterWire>,
    pub skill_target_states: Vec<SkillTargetStateWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub redacted_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchSegmentWire {
    pub id: String,
    pub source: SegmentSourceWire,
    pub display_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_id: Option<String>,
    pub rows: Vec<WorkbenchRowWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectiveContextFactWire {
    pub asset: AssetRefWire,
    pub asset_id: String,
    pub project_id: String,
    pub project_display_name: String,
    pub adapter: AdapterProvenanceWire,
    pub rule: RuleProvenanceWire,
    pub authoritative_read_revision: String,
    pub source_tier_id: String,
    pub load_order: u32,
    pub priority: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub override_relation: Option<OverrideRelationWire>,
    pub resolution: ApplicabilityResolutionWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason_code: Option<ReasonCodeWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchFindingWire {
    pub asset_id: String,
    pub reason_code: ReasonCodeWire,
    pub context: EffectiveContextFactWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkbenchActualReadSnapshotWire {
    pub query: WorkbenchQueryWire,
    pub authoritative_read_revision: String,
    pub segments: Vec<WorkbenchSegmentWire>,
    pub effective_contexts: Vec<EffectiveContextFactWire>,
    pub findings: Vec<WorkbenchFindingWire>,
    pub aggregate_total: u32,
    pub index_status: IndexStatusWire,
    pub read_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocatorResultWire {
    pub row: WorkbenchRowWire,
    pub destination_view_context: ViewContextWire,
    pub destination: LocatorDestinationWire,
    pub matched_field: LocatorMatchedFieldWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum LocatorDestinationWire {
    SkillDetail {
        #[serde(rename = "assetRef")]
        #[ts(rename = "assetRef")]
        asset_ref: AssetRefWire,
    },
    UnsupportedReadOnly {
        #[serde(rename = "assetRef")]
        #[ts(rename = "assetRef")]
        asset_ref: AssetRefWire,
        #[serde(rename = "reasonCode")]
        #[ts(rename = "reasonCode")]
        reason_code: ReasonCodeWire,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocatorGroupWire {
    pub asset_type: MvpAssetTypeWire,
    pub count: u32,
    pub results: Vec<LocatorResultWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlobalLocatorSnapshotWire {
    pub groups: Vec<LocatorGroupWire>,
    pub aggregate_total: u32,
    pub read_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivePackageProvenanceSourceWire {
    pub package_identity: String,
    pub package_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct BuiltInProvenanceSourceWire {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum ProvenanceSourceWire {
    BuiltIn(BuiltInProvenanceSourceWire),
    ActivePackage(ActivePackageProvenanceSourceWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterProvenanceWire {
    pub identity: String,
    pub version: String,
    pub source: ProvenanceSourceWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleProvenanceWire {
    pub identity: String,
    pub version: String,
    pub source: ProvenanceSourceWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectiveProjectContextWire {
    pub asset: AssetRefWire,
    pub project_id: String,
    pub project_display_name: String,
    pub adapter: AdapterProvenanceWire,
    pub rule: RuleProvenanceWire,
    pub authoritative_read_revision: String,
    pub source_tier_id: String,
    pub load_order: u32,
    pub priority: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub override_relation: Option<OverrideRelationWire>,
    pub resolution: ApplicabilityResolutionWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason_code: Option<ReasonCodeWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicabilityFindingWire {
    pub asset: AssetRefWire,
    pub context: EffectiveProjectContextWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectApplicabilitySegmentWire {
    pub id: String,
    pub kind: ProjectApplicabilitySegmentKindWire,
    pub display_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_id: Option<String>,
    pub assets: Vec<AssetSummaryWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectApplicabilitySnapshotWire {
    pub query: ProjectApplicabilityQueryWire,
    pub authoritative_read_revision: String,
    pub segments: Vec<ProjectApplicabilitySegmentWire>,
    pub findings: Vec<ApplicabilityFindingWire>,
    pub effective_contexts: Vec<EffectiveProjectContextWire>,
    pub aggregate_total: u32,
    pub read_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectiveContextWire {
    pub agent: AgentIdWire,
    pub scope: AssetScopeWire,
    pub source_tier_label: String,
    pub precedence: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetCapabilitiesWire {
    pub edit: ActionAvailabilityWire,
    pub convert: ActionAvailabilityWire,
    pub export: ActionAvailabilityWire,
    pub delete: ActionAvailabilityWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileRefWire {
    pub file_id: String,
    pub name: String,
    pub relative_path: String,
    pub file_kind: FileKindWire,
    pub is_primary: bool,
    pub can_preview: ActionAvailabilityWire,
    pub can_edit: ActionAvailabilityWire,
    pub has_draft_changes: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileTreeNodeWire {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file: Option<NativeFileRefWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub children: Option<Vec<FileTreeNodeWire>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetDetailWire {
    pub asset: AssetRefWire,
    pub display_name: String,
    pub native_unit_kind: NativeUnitKindWire,
    pub revision: String,
    pub compatibility: CompatibilityStatusWire,
    pub capabilities: AssetCapabilitiesWire,
    pub effective_contexts: Vec<EffectiveContextWire>,
    pub primary_file: NativeFileRefWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_tree_root: Option<FileTreeNodeWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverrideRelationWire {
    pub kind: OverrideRelationKindWire,
    pub other_asset_id: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectSourceAnchorWire {
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlobalRootSourceAnchorWire {
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum SourceAnchorWire {
    Project(ProjectSourceAnchorWire),
    UserHome,
    GlobalRoot(GlobalRootSourceAnchorWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectorDataWire {
    pub agents: Vec<AgentIdWire>,
    pub scope: AssetScopeWire,
    pub effective_contexts: Vec<EffectiveContextWire>,
    pub source_anchor: SourceAnchorWire,
    pub path_display: String,
    pub compatibility: CompatibilityStatusWire,
    pub overrides: Vec<OverrideRelationWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetDetailSnapshotWire {
    pub detail: AssetDetailWire,
    pub inspector: InspectorDataWire,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SensitiveSegmentRefWire {
    pub segment_id: String,
    pub file_id: String,
    pub revision: String,
    pub display_state: SensitiveDisplayStateWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceContentWire {
    pub masked_text: String,
    pub sensitive_segments: Vec<SensitiveSegmentRefWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NonTextMetadataContentWire {
    pub file_kind_label: String,
    /// 受 JS safe-integer 约束；FE-01 fixture 文件远小于该上限。
    /// serde 序列化为 JSON number，TS 侧同为 number（非 bigint）。
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub path_display: String,
    pub reason_code: ReasonCodeWire,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum NativeFileContentWire {
    Source(SourceContentWire),
    NonTextMetadata(NonTextMetadataContentWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSnapshotWire {
    pub file: NativeFileRefWire,
    pub revision: String,
    pub asset_revision: String,
    pub content: NativeFileContentWire,
    pub structured_view: ActionAvailabilityWire,
}

/// 成功 snapshot 封闭 union；tag 与 request payload 一一对应。
// wire DTO 每次请求只序列化/反序列化一次，不为 variant 大小差异引入装箱。
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum SnapshotWire {
    AssetList(AssetListSnapshotWire),
    Workbench(WorkbenchActualReadSnapshotWire),
    GlobalLocator(GlobalLocatorSnapshotWire),
    ProjectApplicability(ProjectApplicabilitySnapshotWire),
    AssetDetail(AssetDetailSnapshotWire),
    NativeFile(NativeFileSnapshotWire),
}

// ---------------------------------------------------------------------------
// Response DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadSucceededWire {
    pub snapshot: SnapshotWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadFailedWire {
    pub reason_code: ReasonCodeWire,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub recovery_action: Option<RecoveryActionWire>,
}

// 同上：response 每请求构造一次，不装箱。
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum ReadResponsePayload {
    ReadSucceeded(ReadSucceededWire),
    ReadFailed(ReadFailedWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadResponseEnvelope {
    pub wire_version: u32,
    pub request_id: String,
    pub payload: ReadResponsePayload,
}

// ---------------------------------------------------------------------------
// Event DTO（acm://workspace-invalidation，FE-01 子集）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetsInvalidatedWire {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asset_type: Option<AssetTypeWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetDriftDetectedWire {
    pub asset_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexStatusChangedWire {
    pub index_status: IndexStatusWire,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompatibilityChangedWire {
    pub asset_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum WorkspaceEventWire {
    AssetsInvalidated(AssetsInvalidatedWire),
    AssetDriftDetected(AssetDriftDetectedWire),
    IndexStatusChanged(IndexStatusChangedWire),
    CompatibilityChanged(CompatibilityChangedWire),
}

/// 事件 envelope：wireVersion + 最小事件，不携带任何事实内容。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceEventEnvelope {
    pub wire_version: u32,
    pub event: WorkspaceEventWire,
}

// ---------------------------------------------------------------------------
// domain ↔ wire 显式转换
// ---------------------------------------------------------------------------

macro_rules! enum_convert_both {
    ($wire:ident, $domain:ident, $( ($w:ident, $d:ident) ),* $(,)?) => {
        impl From<domain::$domain> for $wire {
            fn from(value: domain::$domain) -> Self {
                match value {
                    $( domain::$domain::$d => $wire::$w ),*
                }
            }
        }
        impl From<$wire> for domain::$domain {
            fn from(value: $wire) -> Self {
                match value {
                    $( $wire::$w => domain::$domain::$d ),*
                }
            }
        }
    };
}

enum_convert_both!(
    AssetTypeWire,
    AssetType,
    (Skill, Skill),
    (LongTermInstruction, LongTermInstruction),
    (Subagent, Subagent),
    (Hook, Hook)
);
enum_convert_both!(
    AssetScopeWire,
    AssetScope,
    (Global, Global),
    (Project, Project)
);
enum_convert_both!(
    MvpAssetTypeWire,
    MvpAssetType,
    (Skill, Skill),
    (LongTermInstruction, LongTermInstruction),
    (Subagent, Subagent)
);
enum_convert_both!(
    SegmentSourceWire,
    SegmentSource,
    (GlobalApplicable, GlobalApplicable),
    (ProjectNative, ProjectNative)
);
enum_convert_both!(
    SkillPresenceWire,
    SkillPresence,
    (Absent, Absent),
    (Present, Present),
    (Unknown, Unknown),
    (Blocked, Blocked),
    (Stale, Stale)
);
enum_convert_both!(
    SkillActivationWire,
    SkillActivation,
    (NotApplicable, NotApplicable),
    (Enabled, Enabled),
    (Disabled, Disabled),
    (Unknown, Unknown),
    (Blocked, Blocked),
    (Stale, Stale)
);
enum_convert_both!(
    ApplicabilityResolutionWire,
    ApplicabilityResolution,
    (Resolved, Resolved),
    (Unknown, Unknown),
    (Blocked, Blocked),
    (Stale, Stale)
);
enum_convert_both!(
    LocatorMatchedFieldWire,
    LocatorMatchedField,
    (DisplayName, DisplayName),
    (AssetType, AssetType),
    (Agent, Agent),
    (Ownership, Ownership),
    (ProjectHint, ProjectHint),
    (RedactedSummary, RedactedSummary)
);
enum_convert_both!(
    ProjectApplicabilitySegmentKindWire,
    ProjectApplicabilitySegmentKind,
    (ProjectNative, ProjectNative),
    (GlobalApplicable, GlobalApplicable)
);
enum_convert_both!(
    IndexStatusWire,
    IndexStatus,
    (Fresh, Fresh),
    (Stale, Stale),
    (Rebuilding, Rebuilding),
    (Failed, Failed)
);
enum_convert_both!(
    CompatibilityStatusWire,
    CompatibilityStatus,
    (VerifiedWritable, VerifiedWritable),
    (RecognizedReadOnly, RecognizedReadOnly),
    (IncompatibleBlocked, IncompatibleBlocked)
);
enum_convert_both!(
    SensitiveDisplayStateWire,
    SensitiveDisplayState,
    (Masked, Masked),
    (TemporarilyRevealed, TemporarilyRevealed),
    (ChangedMasked, ChangedMasked)
);
enum_convert_both!(
    AnomalyKindWire,
    AnomalyKind,
    (ReadOnly, ReadOnly),
    (Incompatible, Incompatible),
    (Conflict, Conflict),
    (Drift, Drift)
);
enum_convert_both!(
    AssetStatusFilterWire,
    AssetStatusFilter,
    (Editable, Editable),
    (ReadOnly, ReadOnly),
    (Incompatible, Incompatible),
    (Normal, Normal),
    (Overridden, Overridden),
    (Conflict, Conflict),
    (Drift, Drift)
);
enum_convert_both!(
    AssetGroupByWire,
    AssetGroupBy,
    (None, None),
    (Agent, Agent),
    (Project, Project),
    (Scope, Scope),
    (Source, Source),
    (Status, Status)
);
enum_convert_both!(
    NativeUnitKindWire,
    NativeUnitKind,
    (SingleFile, SingleFile),
    (MultiFileDirectory, MultiFileDirectory),
    (ConfigBlock, ConfigBlock),
    (PluginModule, PluginModule)
);
enum_convert_both!(
    OverrideRelationKindWire,
    OverrideRelationKind,
    (Overrides, Overrides),
    (OverriddenBy, OverriddenBy),
    (Shadowed, Shadowed)
);
enum_convert_both!(
    FileKindWire,
    FileKind,
    (Text, Text),
    (NonText, NonText),
    (Unknown, Unknown)
);
enum_convert_both!(
    AgentIdWire,
    AgentId,
    (ClaudeCode, ClaudeCode),
    (Codex, Codex),
    (GeminiCli, GeminiCli),
    (Opencode, Opencode)
);
enum_convert_both!(
    ReasonCodeWire,
    ReasonCode,
    (UnknownAgentVersion, UnknownAgentVersion),
    (IncompatibleStructure, IncompatibleStructure),
    (UnsupportedCapability, UnsupportedCapability),
    (ReadOnlyPolicy, ReadOnlyPolicy),
    (PermissionDenied, PermissionDenied),
    (OutsideManagedScope, OutsideManagedScope),
    (ProjectUnavailable, ProjectUnavailable),
    (UnknownFieldPreserved, UnknownFieldPreserved),
    (NonTextUnpreviewable, NonTextUnpreviewable),
    (ValidationFailed, ValidationFailed),
    (ExecutableContentRisk, ExecutableContentRisk),
    (IndexStale, IndexStale),
    (ExternalChange, ExternalChange),
    (ReprepareRequired, ReprepareRequired),
    (MergeConflict, MergeConflict),
    (TargetNameConflict, TargetNameConflict),
    (ConversionDegraded, ConversionDegraded),
    (ConversionBlocked, ConversionBlocked),
    (ReadFailed, ReadFailed),
    (SnapshotRequired, SnapshotRequired),
    (SnapshotFailed, SnapshotFailed),
    (SecureStorageUnavailable, SecureStorageUnavailable),
    (DiskFull, DiskFull),
    (WriteFailed, WriteFailed),
    (RollbackFailed, RollbackFailed),
    (RecoveryTargetOccupied, RecoveryTargetOccupied),
    (AdapterSignatureInvalid, AdapterSignatureInvalid),
    (AdapterCompatibilityMismatch, AdapterCompatibilityMismatch),
    (AdapterRegressionFailed, AdapterRegressionFailed),
    (ImportSourceUnavailable, ImportSourceUnavailable),
    (ExportDestinationInvalid, ExportDestinationInvalid),
    (GatewayUnavailable, GatewayUnavailable)
);

impl From<domain::RecoveryAction> for RecoveryActionWire {
    fn from(value: domain::RecoveryAction) -> Self {
        match value {
            domain::RecoveryAction::RetryRead => RecoveryActionWire::RetryRead,
        }
    }
}

impl From<domain::ActionAvailability> for ActionAvailabilityWire {
    fn from(value: domain::ActionAvailability) -> Self {
        match value {
            domain::ActionAvailability::Allowed => ActionAvailabilityWire::Allowed,
            domain::ActionAvailability::Disabled {
                reason_code,
                recovery_action,
            } => ActionAvailabilityWire::Disabled(DisabledAvailabilityWire {
                reason_code: reason_code.into(),
                recovery_action: recovery_action.map(Into::into),
            }),
        }
    }
}

impl From<domain::AssetRef> for AssetRefWire {
    fn from(value: domain::AssetRef) -> Self {
        AssetRefWire {
            asset_id: value.asset_id,
            asset_type: value.asset_type.into(),
            native_unit_ref: value.native_unit_ref,
            adapter_identity: value.adapter_identity,
            native_ownership: value.native_ownership.into(),
        }
    }
}

impl From<AssetRefWire> for domain::AssetRef {
    fn from(value: AssetRefWire) -> Self {
        domain::AssetRef {
            asset_id: value.asset_id,
            asset_type: value.asset_type.into(),
            native_unit_ref: value.native_unit_ref,
            adapter_identity: value.adapter_identity,
            native_ownership: value.native_ownership.into(),
        }
    }
}

impl From<domain::NativeOwnership> for NativeOwnershipWire {
    fn from(value: domain::NativeOwnership) -> Self {
        match value {
            domain::NativeOwnership::Global => {
                NativeOwnershipWire::Global(GlobalNativeOwnershipWire {})
            }
            domain::NativeOwnership::Project { project_id } => {
                NativeOwnershipWire::Project(ProjectNativeOwnershipWire { project_id })
            }
        }
    }
}

impl From<NativeOwnershipWire> for domain::NativeOwnership {
    fn from(value: NativeOwnershipWire) -> Self {
        match value {
            NativeOwnershipWire::Global(_) => domain::NativeOwnership::Global,
            NativeOwnershipWire::Project(project) => domain::NativeOwnership::Project {
                project_id: project.project_id,
            },
        }
    }
}

impl From<domain::Anomaly> for AnomalyWire {
    fn from(value: domain::Anomaly) -> Self {
        AnomalyWire {
            kind: value.kind.into(),
            reason_code: value.reason_code.into(),
            message: value.message,
        }
    }
}

impl From<domain::AssetContextHint> for AssetContextHintWire {
    fn from(value: domain::AssetContextHint) -> Self {
        match value {
            domain::AssetContextHint::Project { project_name } => {
                AssetContextHintWire::Project(ProjectContextHintWire { project_name })
            }
            domain::AssetContextHint::Path { path_hint } => {
                AssetContextHintWire::Path(PathContextHintWire { path_hint })
            }
        }
    }
}

impl From<domain::AssetListScope> for AssetListScopeWire {
    fn from(value: domain::AssetListScope) -> Self {
        match value {
            domain::AssetListScope::CurrentAssetType { asset_type } => {
                AssetListScopeWire::CurrentAssetType(CurrentAssetTypeScopeWire {
                    asset_type: asset_type.into(),
                })
            }
            domain::AssetListScope::AllAssets => {
                AssetListScopeWire::AllAssets(AllAssetsScopeWire {})
            }
        }
    }
}

impl From<AssetListScopeWire> for domain::AssetListScope {
    fn from(value: AssetListScopeWire) -> Self {
        match value {
            AssetListScopeWire::CurrentAssetType(scope) => {
                domain::AssetListScope::CurrentAssetType {
                    asset_type: scope.asset_type.into(),
                }
            }
            AssetListScopeWire::AllAssets(_) => domain::AssetListScope::AllAssets,
        }
    }
}

impl From<domain::ProjectApplicabilityView> for ProjectApplicabilityViewWire {
    fn from(value: domain::ProjectApplicabilityView) -> Self {
        match value {
            domain::ProjectApplicabilityView::All => {
                ProjectApplicabilityViewWire::All(AllProjectApplicabilityViewWire {})
            }
            domain::ProjectApplicabilityView::Global => {
                ProjectApplicabilityViewWire::Global(GlobalProjectApplicabilityViewWire {})
            }
            domain::ProjectApplicabilityView::Project { project_id } => {
                ProjectApplicabilityViewWire::Project(ProjectProjectApplicabilityViewWire {
                    project_id,
                })
            }
        }
    }
}

impl From<ProjectApplicabilityViewWire> for domain::ProjectApplicabilityView {
    fn from(value: ProjectApplicabilityViewWire) -> Self {
        match value {
            ProjectApplicabilityViewWire::All(_) => domain::ProjectApplicabilityView::All,
            ProjectApplicabilityViewWire::Global(_) => domain::ProjectApplicabilityView::Global,
            ProjectApplicabilityViewWire::Project(project) => {
                domain::ProjectApplicabilityView::Project {
                    project_id: project.project_id,
                }
            }
        }
    }
}

impl From<domain::ViewContext> for ViewContextWire {
    fn from(value: domain::ViewContext) -> Self {
        match value {
            domain::ViewContext::All => ViewContextWire::All(AllViewContextWire {}),
            domain::ViewContext::Global => ViewContextWire::Global(GlobalViewContextWire {}),
            domain::ViewContext::Project { project_id } => {
                ViewContextWire::Project(ProjectViewContextWire { project_id })
            }
        }
    }
}

impl From<ViewContextWire> for domain::ViewContext {
    fn from(value: ViewContextWire) -> Self {
        match value {
            ViewContextWire::All(_) => domain::ViewContext::All,
            ViewContextWire::Global(_) => domain::ViewContext::Global,
            ViewContextWire::Project(project) => domain::ViewContext::Project {
                project_id: project.project_id,
            },
        }
    }
}

impl From<WorkbenchFiltersWire> for domain::WorkbenchFilters {
    fn from(value: WorkbenchFiltersWire) -> Self {
        domain::WorkbenchFilters {
            agents: value
                .agents
                .map(|items| items.into_iter().map(Into::into).collect()),
            source_ids: value.source_ids,
            statuses: value
                .statuses
                .map(|items| items.into_iter().map(Into::into).collect()),
            project_ids: value.project_ids,
        }
    }
}

impl From<domain::WorkbenchFilters> for WorkbenchFiltersWire {
    fn from(value: domain::WorkbenchFilters) -> Self {
        WorkbenchFiltersWire {
            agents: value
                .agents
                .map(|items| items.into_iter().map(Into::into).collect()),
            source_ids: value.source_ids,
            statuses: value
                .statuses
                .map(|items| items.into_iter().map(Into::into).collect()),
            project_ids: value.project_ids,
        }
    }
}

impl From<AssetListFiltersWire> for domain::AssetListFilters {
    fn from(value: AssetListFiltersWire) -> Self {
        domain::AssetListFilters {
            agents: value
                .agents
                .map(|items| items.into_iter().map(Into::into).collect()),
            projects: value.projects,
            scopes: value
                .scopes
                .map(|items| items.into_iter().map(Into::into).collect()),
            sources: value.sources,
            statuses: value
                .statuses
                .map(|items| items.into_iter().map(Into::into).collect()),
            group_by: value.group_by.map(Into::into),
        }
    }
}

impl From<ReadRequestPayload> for domain::Query {
    fn from(value: ReadRequestPayload) -> Self {
        match value {
            ReadRequestPayload::AssetList(query) => {
                domain::Query::AssetList(domain::AssetListQuery {
                    scope: query.scope.into(),
                    search_text: query.search_text,
                    filters: query.filters.map(Into::into),
                })
            }
            ReadRequestPayload::Workbench(query) => {
                domain::Query::Workbench(domain::WorkbenchQuery {
                    asset_type: query.asset_type.into(),
                    view_context: query.view_context.into(),
                    filters: query.filters.map(Into::into),
                })
            }
            ReadRequestPayload::GlobalLocator(query) => {
                domain::Query::GlobalLocator(domain::GlobalLocatorQuery {
                    search_text: query.search_text,
                    asset_types: query.asset_types.into_iter().map(Into::into).collect(),
                })
            }
            ReadRequestPayload::ProjectApplicability(query) => {
                domain::Query::ProjectApplicability(domain::ProjectApplicabilityQuery {
                    view: query.view.into(),
                })
            }
            ReadRequestPayload::AssetDetail(query) => {
                domain::Query::AssetDetail(domain::AssetDetailQuery {
                    asset: query.asset.into(),
                })
            }
            ReadRequestPayload::NativeFile(query) => {
                domain::Query::NativeFile(domain::NativeFileQuery {
                    asset: query.asset.into(),
                    file_id: query.file_id,
                })
            }
        }
    }
}

impl From<domain::SourceTier> for SourceTierWire {
    fn from(value: domain::SourceTier) -> Self {
        SourceTierWire {
            id: value.id,
            label: value.label,
        }
    }
}

impl From<domain::AssetSummary> for AssetSummaryWire {
    fn from(value: domain::AssetSummary) -> Self {
        AssetSummaryWire {
            asset: value.asset.into(),
            display_name: value.display_name,
            anomalies: value.anomalies.into_iter().map(Into::into).collect(),
            agents: value.agents.into_iter().map(Into::into).collect(),
            scope: value.scope.into(),
            context_hint: value.context_hint.into(),
            source_tier: value.source_tier.into(),
            availability: value.availability.into(),
        }
    }
}

impl From<domain::AssetListSnapshot> for AssetListSnapshotWire {
    fn from(value: domain::AssetListSnapshot) -> Self {
        AssetListSnapshotWire {
            assets: value.assets.into_iter().map(Into::into).collect(),
            index_status: value.index_status.into(),
            scope: value.scope.into(),
            queried_at: value.queried_at,
            index_updated_at: value.index_updated_at,
        }
    }
}

impl From<domain::WorkbenchQuery> for WorkbenchQueryWire {
    fn from(value: domain::WorkbenchQuery) -> Self {
        WorkbenchQueryWire {
            asset_type: value.asset_type.into(),
            view_context: value.view_context.into(),
            filters: value.filters.map(Into::into),
        }
    }
}

impl From<domain::SkillTargetState> for SkillTargetStateWire {
    fn from(value: domain::SkillTargetState) -> Self {
        SkillTargetStateWire {
            agent: value.agent.into(),
            presence: value.presence.into(),
            activation: value.activation.into(),
            applicability: value.applicability.into(),
            enable_availability: value.enable_availability.into(),
            disable_availability: value.disable_availability.into(),
            pending: value.pending.map(Into::into),
            stable_reason: value.stable_reason,
        }
    }
}

impl From<domain::SkillCellAvailability> for SkillCellAvailabilityWire {
    fn from(value: domain::SkillCellAvailability) -> Self {
        match value {
            domain::SkillCellAvailability::Allowed => Self::Allowed,
            domain::SkillCellAvailability::Disabled { reason_code } => {
                Self::Disabled(SkillCellUnavailableWire {
                    reason_code: reason_code.into(),
                })
            }
            domain::SkillCellAvailability::Blocked { reason_code } => {
                Self::Blocked(SkillCellUnavailableWire {
                    reason_code: reason_code.into(),
                })
            }
        }
    }
}

impl From<domain::SkillTargetPending> for SkillTargetPendingWire {
    fn from(value: domain::SkillTargetPending) -> Self {
        Self {
            operation_id: value.operation_id,
            phase: value.phase,
        }
    }
}

impl From<domain::WorkbenchRow> for WorkbenchRowWire {
    fn from(value: domain::WorkbenchRow) -> Self {
        WorkbenchRowWire {
            summary: value.summary.into(),
            sort_base_name: value.sort_base_name,
            authoritative_input_order: value.authoritative_input_order,
            status_memberships: value
                .status_memberships
                .into_iter()
                .map(Into::into)
                .collect(),
            skill_target_states: value
                .skill_target_states
                .into_iter()
                .map(Into::into)
                .collect(),
            redacted_summary: value.redacted_summary,
        }
    }
}

impl From<domain::WorkbenchSegment> for WorkbenchSegmentWire {
    fn from(value: domain::WorkbenchSegment) -> Self {
        WorkbenchSegmentWire {
            id: value.id,
            source: value.source.into(),
            display_label: value.display_label,
            project_id: value.project_id,
            rows: value.rows.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<domain::WorkbenchFinding> for WorkbenchFindingWire {
    fn from(value: domain::WorkbenchFinding) -> Self {
        WorkbenchFindingWire {
            asset_id: value.asset_id,
            reason_code: value.reason_code.into(),
            context: value.context.into(),
        }
    }
}

impl From<domain::EffectiveProjectContext> for EffectiveContextFactWire {
    fn from(value: domain::EffectiveProjectContext) -> Self {
        let asset_id = value.asset.asset_id.clone();
        EffectiveContextFactWire {
            asset: value.asset.into(),
            asset_id,
            project_id: value.project_id,
            project_display_name: value.project_display_name,
            adapter: value.adapter.into(),
            rule: value.rule.into(),
            authoritative_read_revision: value.authoritative_read_revision,
            source_tier_id: value.source_tier_id,
            load_order: value.load_order,
            priority: value.priority,
            override_relation: value.override_relation.map(Into::into),
            resolution: value.resolution.into(),
            reason_code: value.reason_code.map(Into::into),
        }
    }
}

impl From<domain::WorkbenchActualReadSnapshot> for WorkbenchActualReadSnapshotWire {
    fn from(value: domain::WorkbenchActualReadSnapshot) -> Self {
        WorkbenchActualReadSnapshotWire {
            query: value.query.into(),
            authoritative_read_revision: value.authoritative_read_revision,
            segments: value.segments.into_iter().map(Into::into).collect(),
            effective_contexts: value
                .effective_contexts
                .into_iter()
                .map(Into::into)
                .collect(),
            findings: value.findings.into_iter().map(Into::into).collect(),
            aggregate_total: value.aggregate_total,
            index_status: value.index_status.into(),
            read_at: value.read_at,
        }
    }
}

impl From<domain::LocatorResult> for LocatorResultWire {
    fn from(value: domain::LocatorResult) -> Self {
        LocatorResultWire {
            row: value.row.into(),
            destination_view_context: value.destination_view_context.into(),
            destination: value.destination.into(),
            matched_field: value.matched_field.into(),
        }
    }
}

impl From<domain::LocatorDestination> for LocatorDestinationWire {
    fn from(value: domain::LocatorDestination) -> Self {
        match value {
            domain::LocatorDestination::SkillDetail { asset } => {
                LocatorDestinationWire::SkillDetail {
                    asset_ref: asset.into(),
                }
            }
            domain::LocatorDestination::UnsupportedReadOnly { asset, reason_code } => {
                LocatorDestinationWire::UnsupportedReadOnly {
                    asset_ref: asset.into(),
                    reason_code: reason_code.into(),
                }
            }
        }
    }
}

impl From<domain::LocatorGroup> for LocatorGroupWire {
    fn from(value: domain::LocatorGroup) -> Self {
        LocatorGroupWire {
            asset_type: value.asset_type.into(),
            count: value.results.len() as u32,
            results: value.results.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<domain::GlobalLocatorSnapshot> for GlobalLocatorSnapshotWire {
    fn from(value: domain::GlobalLocatorSnapshot) -> Self {
        GlobalLocatorSnapshotWire {
            groups: value.groups.into_iter().map(Into::into).collect(),
            aggregate_total: value.aggregate_total,
            read_at: value.read_at,
        }
    }
}

impl From<domain::ProvenanceSource> for ProvenanceSourceWire {
    fn from(value: domain::ProvenanceSource) -> Self {
        match value {
            domain::ProvenanceSource::BuiltIn => {
                ProvenanceSourceWire::BuiltIn(BuiltInProvenanceSourceWire {})
            }
            domain::ProvenanceSource::ActivePackage {
                package_identity,
                package_version,
            } => ProvenanceSourceWire::ActivePackage(ActivePackageProvenanceSourceWire {
                package_identity,
                package_version,
            }),
        }
    }
}

impl From<domain::AdapterProvenance> for AdapterProvenanceWire {
    fn from(value: domain::AdapterProvenance) -> Self {
        AdapterProvenanceWire {
            identity: value.identity,
            version: value.version,
            source: value.source.into(),
        }
    }
}

impl From<domain::RuleProvenance> for RuleProvenanceWire {
    fn from(value: domain::RuleProvenance) -> Self {
        RuleProvenanceWire {
            identity: value.identity,
            version: value.version,
            source: value.source.into(),
        }
    }
}

impl From<domain::EffectiveProjectContext> for EffectiveProjectContextWire {
    fn from(value: domain::EffectiveProjectContext) -> Self {
        EffectiveProjectContextWire {
            asset: value.asset.into(),
            project_id: value.project_id,
            project_display_name: value.project_display_name,
            adapter: value.adapter.into(),
            rule: value.rule.into(),
            authoritative_read_revision: value.authoritative_read_revision,
            source_tier_id: value.source_tier_id,
            load_order: value.load_order,
            priority: value.priority,
            override_relation: value.override_relation.map(Into::into),
            resolution: value.resolution.into(),
            reason_code: value.reason_code.map(Into::into),
        }
    }
}

impl From<domain::ApplicabilityFinding> for ApplicabilityFindingWire {
    fn from(value: domain::ApplicabilityFinding) -> Self {
        ApplicabilityFindingWire {
            asset: value.asset.into(),
            context: value.context.into(),
        }
    }
}

impl From<domain::ProjectApplicabilitySegment> for ProjectApplicabilitySegmentWire {
    fn from(value: domain::ProjectApplicabilitySegment) -> Self {
        ProjectApplicabilitySegmentWire {
            id: value.id,
            kind: value.kind.into(),
            display_label: value.display_label,
            project_id: value.project_id,
            assets: value.assets.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<domain::ProjectApplicabilitySnapshot> for ProjectApplicabilitySnapshotWire {
    fn from(value: domain::ProjectApplicabilitySnapshot) -> Self {
        ProjectApplicabilitySnapshotWire {
            query: ProjectApplicabilityQueryWire {
                view: value.query.view.into(),
            },
            authoritative_read_revision: value.authoritative_read_revision,
            segments: value.segments.into_iter().map(Into::into).collect(),
            findings: value.findings.into_iter().map(Into::into).collect(),
            effective_contexts: value
                .effective_contexts
                .into_iter()
                .map(Into::into)
                .collect(),
            aggregate_total: value.aggregate_total,
            read_at: value.read_at,
        }
    }
}

impl From<domain::EffectiveContext> for EffectiveContextWire {
    fn from(value: domain::EffectiveContext) -> Self {
        EffectiveContextWire {
            agent: value.agent.into(),
            scope: value.scope.into(),
            source_tier_label: value.source_tier_label,
            precedence: value.precedence,
        }
    }
}

impl From<domain::AssetCapabilities> for AssetCapabilitiesWire {
    fn from(value: domain::AssetCapabilities) -> Self {
        AssetCapabilitiesWire {
            edit: value.edit.into(),
            convert: value.convert.into(),
            export: value.export.into(),
            delete: value.delete.into(),
        }
    }
}

impl From<domain::NativeFileRef> for NativeFileRefWire {
    fn from(value: domain::NativeFileRef) -> Self {
        NativeFileRefWire {
            file_id: value.file_id,
            name: value.name,
            relative_path: value.relative_path,
            file_kind: value.file_kind.into(),
            is_primary: value.is_primary,
            can_preview: value.can_preview.into(),
            can_edit: value.can_edit.into(),
            has_draft_changes: value.has_draft_changes,
        }
    }
}

impl From<domain::FileTreeNode> for FileTreeNodeWire {
    fn from(value: domain::FileTreeNode) -> Self {
        FileTreeNodeWire {
            name: value.name,
            file: value.file.map(Into::into),
            children: value
                .children
                .map(|nodes| nodes.into_iter().map(Into::into).collect()),
        }
    }
}

impl From<domain::AssetDetail> for AssetDetailWire {
    fn from(value: domain::AssetDetail) -> Self {
        AssetDetailWire {
            asset: value.asset.into(),
            display_name: value.display_name,
            native_unit_kind: value.native_unit_kind.into(),
            revision: value.revision,
            compatibility: value.compatibility.into(),
            capabilities: value.capabilities.into(),
            effective_contexts: value
                .effective_contexts
                .into_iter()
                .map(Into::into)
                .collect(),
            primary_file: value.primary_file.into(),
            file_tree_root: value.file_tree_root.map(Into::into),
        }
    }
}

impl From<domain::OverrideRelation> for OverrideRelationWire {
    fn from(value: domain::OverrideRelation) -> Self {
        OverrideRelationWire {
            kind: value.kind.into(),
            other_asset_id: value.other_asset_id,
            note: value.note,
        }
    }
}

impl From<domain::SourceAnchor> for SourceAnchorWire {
    fn from(value: domain::SourceAnchor) -> Self {
        match value {
            domain::SourceAnchor::Project { project_name } => {
                SourceAnchorWire::Project(ProjectSourceAnchorWire { project_name })
            }
            domain::SourceAnchor::UserHome => SourceAnchorWire::UserHome,
            domain::SourceAnchor::GlobalRoot { label } => {
                SourceAnchorWire::GlobalRoot(GlobalRootSourceAnchorWire { label })
            }
        }
    }
}

impl From<domain::InspectorData> for InspectorDataWire {
    fn from(value: domain::InspectorData) -> Self {
        InspectorDataWire {
            agents: value.agents.into_iter().map(Into::into).collect(),
            scope: value.scope.into(),
            effective_contexts: value
                .effective_contexts
                .into_iter()
                .map(Into::into)
                .collect(),
            source_anchor: value.source_anchor.into(),
            path_display: value.path_display,
            compatibility: value.compatibility.into(),
            overrides: value.overrides.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<domain::AssetDetailSnapshot> for AssetDetailSnapshotWire {
    fn from(value: domain::AssetDetailSnapshot) -> Self {
        AssetDetailSnapshotWire {
            detail: value.detail.into(),
            inspector: value.inspector.into(),
            revision: value.revision,
        }
    }
}

impl From<domain::SensitiveSegmentRef> for SensitiveSegmentRefWire {
    fn from(value: domain::SensitiveSegmentRef) -> Self {
        SensitiveSegmentRefWire {
            segment_id: value.segment_id,
            file_id: value.file_id,
            revision: value.revision,
            display_state: value.display_state.into(),
        }
    }
}

impl From<domain::NativeFileContent> for NativeFileContentWire {
    fn from(value: domain::NativeFileContent) -> Self {
        match value {
            domain::NativeFileContent::Source(content) => {
                NativeFileContentWire::Source(SourceContentWire {
                    masked_text: content.masked_text,
                    sensitive_segments: content
                        .sensitive_segments
                        .into_iter()
                        .map(Into::into)
                        .collect(),
                })
            }
            domain::NativeFileContent::NonTextMetadata(meta) => {
                NativeFileContentWire::NonTextMetadata(NonTextMetadataContentWire {
                    file_kind_label: meta.file_kind_label,
                    size_bytes: meta.size_bytes,
                    path_display: meta.path_display,
                    reason_code: meta.reason_code.into(),
                    reason: meta.reason,
                })
            }
        }
    }
}

impl From<domain::NativeFileSnapshot> for NativeFileSnapshotWire {
    fn from(value: domain::NativeFileSnapshot) -> Self {
        NativeFileSnapshotWire {
            file: value.file.into(),
            revision: value.revision,
            asset_revision: value.asset_revision,
            content: value.content.into(),
            structured_view: value.structured_view.into(),
        }
    }
}

impl From<domain::Snapshot> for SnapshotWire {
    fn from(value: domain::Snapshot) -> Self {
        match value {
            domain::Snapshot::AssetList(snapshot) => SnapshotWire::AssetList(snapshot.into()),
            domain::Snapshot::Workbench(snapshot) => SnapshotWire::Workbench(snapshot.into()),
            domain::Snapshot::GlobalLocator(snapshot) => {
                SnapshotWire::GlobalLocator(snapshot.into())
            }
            domain::Snapshot::ProjectApplicability(snapshot) => {
                SnapshotWire::ProjectApplicability(snapshot.into())
            }
            domain::Snapshot::AssetDetail(snapshot) => SnapshotWire::AssetDetail(snapshot.into()),
            domain::Snapshot::NativeFile(snapshot) => SnapshotWire::NativeFile(snapshot.into()),
        }
    }
}

impl From<domain::ReadResult<domain::Snapshot>> for ReadResponsePayload {
    fn from(value: domain::ReadResult<domain::Snapshot>) -> Self {
        match value {
            domain::ReadResult::Succeeded(snapshot) => {
                ReadResponsePayload::ReadSucceeded(ReadSucceededWire {
                    snapshot: snapshot.into(),
                })
            }
            domain::ReadResult::Failed(failure) => {
                ReadResponsePayload::ReadFailed(ReadFailedWire {
                    reason_code: failure.reason_code.into(),
                    message: failure.message,
                    recovery_action: failure.recovery_action.map(Into::into),
                })
            }
        }
    }
}

impl From<domain::WorkspaceEvent> for WorkspaceEventWire {
    fn from(value: domain::WorkspaceEvent) -> Self {
        match value {
            domain::WorkspaceEvent::AssetsInvalidated { asset_type } => {
                WorkspaceEventWire::AssetsInvalidated(AssetsInvalidatedWire {
                    asset_type: asset_type.map(Into::into),
                })
            }
            domain::WorkspaceEvent::AssetDriftDetected { asset_id } => {
                WorkspaceEventWire::AssetDriftDetected(AssetDriftDetectedWire { asset_id })
            }
            domain::WorkspaceEvent::IndexStatusChanged { index_status } => {
                WorkspaceEventWire::IndexStatusChanged(IndexStatusChangedWire {
                    index_status: index_status.into(),
                })
            }
            domain::WorkspaceEvent::CompatibilityChanged { asset_id } => {
                WorkspaceEventWire::CompatibilityChanged(CompatibilityChangedWire { asset_id })
            }
        }
    }
}
