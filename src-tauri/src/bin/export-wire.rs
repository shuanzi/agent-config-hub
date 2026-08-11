//! export-wire — ts-rs declaration + GATEWAY_WIRE_VERSION 的唯一导出入口
//! （ARC-06c）。
//!
//! 用法：`cargo run --bin export-wire -- <输出目录>`，产出
//! `<输出目录>/gateway-wire.ts`。输出字节确定性：类型枚举顺序固定、
//! 内容不依赖时间或环境；同一输入两次导出逐字节相同。

use std::fs;
use std::path::Path;

use agent_config_manager_lib::wire;
use ts_rs::TS;

const HEADER: &str = "/**\n * GENERATED FILE — DO NOT EDIT.\n *\n * 由 src-tauri 的 export-wire 从 Rust wire DTO 生成（ARC-06c：Rust 是 wire\n * shape 的唯一事实源）。变更请修改 src-tauri/src/wire.rs 后重新导出；\n * verify:static 在临时目录重新生成并逐字节比对，任何手工编辑都会造成漂移失败。\n */\n\n";

fn declarations() -> Vec<String> {
    // 固定顺序是输出确定性的一部分；新增 wire DTO 时追加到末尾。
    vec![
        wire::AssetTypeWire::decl(),
        wire::AgentIdWire::decl(),
        wire::AssetScopeWire::decl(),
        wire::MvpAssetTypeWire::decl(),
        wire::SegmentSourceWire::decl(),
        wire::SkillPresenceWire::decl(),
        wire::SkillActivationWire::decl(),
        wire::ApplicabilityResolutionWire::decl(),
        wire::LocatorMatchedFieldWire::decl(),
        wire::ProjectApplicabilitySegmentKindWire::decl(),
        wire::ReasonCodeWire::decl(),
        wire::IndexStatusWire::decl(),
        wire::CompatibilityStatusWire::decl(),
        wire::SensitiveDisplayStateWire::decl(),
        wire::AnomalyKindWire::decl(),
        wire::AssetStatusFilterWire::decl(),
        wire::AssetGroupByWire::decl(),
        wire::NativeUnitKindWire::decl(),
        wire::OverrideRelationKindWire::decl(),
        wire::FileKindWire::decl(),
        wire::RecoveryActionWire::decl(),
        wire::DisabledAvailabilityWire::decl(),
        wire::ActionAvailabilityWire::decl(),
        wire::GlobalNativeOwnershipWire::decl(),
        wire::ProjectNativeOwnershipWire::decl(),
        wire::NativeOwnershipWire::decl(),
        wire::AssetRefWire::decl(),
        wire::AnomalyWire::decl(),
        wire::ProjectContextHintWire::decl(),
        wire::PathContextHintWire::decl(),
        wire::AssetContextHintWire::decl(),
        wire::CurrentAssetTypeScopeWire::decl(),
        wire::AllAssetsScopeWire::decl(),
        wire::AssetListScopeWire::decl(),
        wire::AssetListFiltersWire::decl(),
        wire::AssetListQueryWire::decl(),
        wire::AssetDetailQueryWire::decl(),
        wire::NativeFileQueryWire::decl(),
        wire::AllProjectApplicabilityViewWire::decl(),
        wire::GlobalProjectApplicabilityViewWire::decl(),
        wire::ProjectProjectApplicabilityViewWire::decl(),
        wire::ProjectApplicabilityViewWire::decl(),
        wire::ProjectApplicabilityQueryWire::decl(),
        wire::AllViewContextWire::decl(),
        wire::GlobalViewContextWire::decl(),
        wire::ProjectViewContextWire::decl(),
        wire::ViewContextWire::decl(),
        wire::WorkbenchFiltersWire::decl(),
        wire::WorkbenchQueryWire::decl(),
        wire::GlobalLocatorQueryWire::decl(),
        wire::ReadRequestPayload::decl(),
        wire::ReadRequestEnvelope::decl(),
        wire::AssetSummaryWire::decl(),
        wire::AssetListSnapshotWire::decl(),
        wire::SkillCellUnavailableWire::decl(),
        wire::SkillCellAvailabilityWire::decl(),
        wire::SkillTargetPendingWire::decl(),
        wire::SkillTargetStateWire::decl(),
        wire::WorkbenchRowWire::decl(),
        wire::WorkbenchSegmentWire::decl(),
        wire::EffectiveContextFactWire::decl(),
        wire::WorkbenchFindingWire::decl(),
        wire::WorkbenchActualReadSnapshotWire::decl(),
        wire::LocatorDestinationWire::decl(),
        wire::LocatorResultWire::decl(),
        wire::LocatorGroupWire::decl(),
        wire::GlobalLocatorSnapshotWire::decl(),
        wire::BuiltInProvenanceSourceWire::decl(),
        wire::ActivePackageProvenanceSourceWire::decl(),
        wire::ProvenanceSourceWire::decl(),
        wire::AdapterProvenanceWire::decl(),
        wire::RuleProvenanceWire::decl(),
        wire::EffectiveProjectContextWire::decl(),
        wire::ApplicabilityFindingWire::decl(),
        wire::ProjectApplicabilitySegmentWire::decl(),
        wire::ProjectApplicabilitySnapshotWire::decl(),
        wire::EffectiveContextWire::decl(),
        wire::AssetCapabilitiesWire::decl(),
        wire::NativeFileRefWire::decl(),
        wire::FileTreeNodeWire::decl(),
        wire::AssetDetailWire::decl(),
        wire::OverrideRelationWire::decl(),
        wire::ProjectSourceAnchorWire::decl(),
        wire::GlobalRootSourceAnchorWire::decl(),
        wire::SourceAnchorWire::decl(),
        wire::InspectorDataWire::decl(),
        wire::AssetDetailSnapshotWire::decl(),
        wire::SensitiveSegmentRefWire::decl(),
        wire::SourceContentWire::decl(),
        wire::NonTextMetadataContentWire::decl(),
        wire::NativeFileContentWire::decl(),
        wire::NativeFileSnapshotWire::decl(),
        wire::SnapshotWire::decl(),
        wire::ReadSucceededWire::decl(),
        wire::ReadFailedWire::decl(),
        wire::ReadResponsePayload::decl(),
        wire::ReadResponseEnvelope::decl(),
        wire::AssetsInvalidatedWire::decl(),
        wire::AssetDriftDetectedWire::decl(),
        wire::IndexStatusChangedWire::decl(),
        wire::CompatibilityChangedWire::decl(),
        wire::WorkspaceEventWire::decl(),
        wire::WorkspaceEventEnvelope::decl(),
        wire::SourceTierWire::decl(),
    ]
}

/// 生成 gateway-wire.ts 的完整内容（确定性）。
pub fn render_gateway_wire_ts() -> String {
    let mut out = String::from(HEADER);
    out.push_str(&format!(
        "export const GATEWAY_WIRE_VERSION = {} as const;\n\n",
        wire::GATEWAY_WIRE_VERSION
    ));
    for decl in declarations() {
        out.push_str("export ");
        out.push_str(&decl);
        out.push('\n');
    }
    out
}

fn main() {
    let out_dir = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: export-wire <output-dir>");
        std::process::exit(2);
    });
    fs::create_dir_all(&out_dir).expect("failed to create output directory");
    let path = Path::new(&out_dir).join("gateway-wire.ts");
    fs::write(&path, render_gateway_wire_ts()).expect("failed to write gateway-wire.ts");
    println!("wrote {}", path.display());
}
