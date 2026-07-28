//! L1：catalog 对 fixtures/fx-01/native-root 的事实一致性 + revision 语义。
//!
//! 仓库内 fixture 只读；任何“文件变化”测试都先复制到临时目录。

use std::fs;
use std::path::PathBuf;

use agent_config_manager_lib::catalog::{mask_synthetic_secrets, Catalog, SENSITIVE_MASK};
use agent_config_manager_lib::domain::{
    ActionAvailability, AssetListQuery, AssetListScope, AssetType, CompatibilityStatus,
    IndexStatus, NativeFileContent, SensitiveDisplayState,
};

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-01/native-root")
}

fn fixture_json() -> serde_json::Value {
    let text = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-01/fixture.json"),
    )
    .expect("fixture.json readable");
    serde_json::from_str(&text).expect("fixture.json valid json")
}

fn list_query() -> AssetListQuery {
    AssetListQuery {
        scope: AssetListScope::CurrentAssetType {
            asset_type: AssetType::Skill,
        },
        search_text: None,
        filters: None,
    }
}

#[test]
fn reads_fixture_facts_consistent_with_fixture_json() {
    let fx = fixture_json();
    let catalog = Catalog::new(Some(fixture_root()));

    let list = catalog.asset_list(&list_query());
    assert_eq!(list.index_status, IndexStatus::Fresh);
    assert_eq!(list.assets.len(), 1);
    let summary = &list.assets[0];

    assert_eq!(summary.asset.asset_id, fx["asset"]["assetId"]);
    assert_eq!(summary.asset.native_unit_ref, fx["asset"]["nativeUnitRef"]);
    assert_eq!(
        summary.asset.adapter_identity,
        fx["asset"]["adapterIdentity"]
    );
    assert_eq!(summary.display_name, fx["displayName"]);
    assert_eq!(
        summary.anomalies.len(),
        fx["anomalies"].as_array().unwrap().len()
    );
    assert_eq!(summary.agents.len(), 1);
    assert_eq!(summary.context_hint, {
        let hint = &fx["contextHint"];
        agent_config_manager_lib::domain::AssetContextHint::Path {
            path_hint: hint["pathHint"].as_str().unwrap().to_string(),
        }
    });
    assert_eq!(summary.availability, ActionAvailability::Allowed);

    let detail = catalog
        .asset_detail(&summary.asset)
        .expect("fixture asset readable");
    assert_eq!(detail.detail.display_name, fx["displayName"]);
    assert_eq!(
        detail.detail.compatibility,
        CompatibilityStatus::VerifiedWritable
    );
    assert_eq!(detail.detail.capabilities.edit, ActionAvailability::Allowed);
    assert_eq!(
        detail.detail.capabilities.convert,
        ActionAvailability::Allowed
    );
    assert_eq!(
        detail.detail.capabilities.export,
        ActionAvailability::Allowed
    );
    assert_eq!(
        detail.detail.capabilities.delete,
        ActionAvailability::Allowed
    );
    assert_eq!(detail.detail.effective_contexts.len(), 1);
    assert_eq!(
        detail.detail.effective_contexts[0].source_tier_label,
        fx["effectiveContexts"][0]["sourceTierLabel"]
    );
    assert_eq!(
        detail.detail.effective_contexts[0].precedence,
        fx["effectiveContexts"][0]["precedence"].as_u64().unwrap() as u32
    );
    assert_eq!(detail.inspector.path_display, fx["pathDisplay"]);
    assert_eq!(
        detail.detail.primary_file.file_id,
        fx["primaryFile"]["fileId"]
    );

    let file = catalog
        .native_file(
            &summary.asset,
            fx["primaryFile"]["fileId"].as_str().unwrap(),
        )
        .expect("fixture file readable");
    let NativeFileContent::Source(content) = &file.content else {
        panic!("fixture primary file must be source content");
    };
    assert!(content.masked_text.contains(SENSITIVE_MASK));
    assert!(!content.masked_text.contains("SYNTHETIC-SECRET"));
    assert_eq!(content.sensitive_segments.len(), 1);
    assert_eq!(
        content.sensitive_segments[0].segment_id,
        fx["sensitiveSegments"][0]["segmentId"]
    );
    assert_eq!(
        content.sensitive_segments[0].display_state,
        SensitiveDisplayState::Masked
    );
    assert_eq!(file.structured_view, {
        ActionAvailability::Disabled {
            reason_code: agent_config_manager_lib::domain::ReasonCode::UnknownFieldPreserved,
            recovery_action: None,
        }
    });
}

#[test]
fn revision_stable_across_consecutive_reads() {
    let catalog = Catalog::new(Some(fixture_root()));
    let list = catalog.asset_list(&list_query());
    let asset = &list.assets[0].asset;
    let first = catalog.asset_detail(asset).expect("readable");
    let second = catalog.asset_detail(asset).expect("readable");
    assert_eq!(first.revision, second.revision);
    assert!(first.revision.starts_with("rev-"));
    assert_eq!(first.revision.len(), "rev-".len() + 16);
}

#[test]
fn revision_changes_after_file_change() {
    // 复制到临时目录再修改；仓库内 fixture 保持只读。
    let temp = tempfile::tempdir().expect("tempdir");
    let src = fixture_root().join("skills/demo-skill/SKILL.md");
    let dst_dir = temp.path().join("skills/demo-skill");
    fs::create_dir_all(&dst_dir).unwrap();
    let dst = dst_dir.join("SKILL.md");
    fs::copy(&src, &dst).unwrap();

    let catalog = Catalog::new(Some(temp.path().to_path_buf()));
    let list = catalog.asset_list(&list_query());
    let asset = &list.assets[0].asset;
    let before = catalog.asset_detail(asset).expect("readable").revision;

    fs::write(
        &dst,
        format!("{}\n<!-- touched -->\n", fs::read_to_string(&dst).unwrap()),
    )
    .unwrap();
    let after = catalog.asset_detail(asset).expect("readable").revision;
    assert_ne!(before, after);
}

#[test]
fn masked_output_matches_ts_masking_semantics_on_fixture() {
    // 与 fixtures/sensitive-masking.ts 同一语义：整份 fixture 源码遮蔽后
    // 不含占位明文，且遮蔽位置只剩固定标记。
    let raw = fs::read_to_string(fixture_root().join("skills/demo-skill/SKILL.md")).unwrap();
    assert!(raw.contains(["SYNTHETIC-SECRET", "demo-skill-0001"].join("-").as_str()));
    let masked = mask_synthetic_secrets(&raw);
    assert!(!masked.contains("SYNTHETIC-SECRET"));
    assert_eq!(masked.matches(SENSITIVE_MASK).count(), 1);
}

#[test]
fn empty_catalog_when_native_root_unset() {
    let catalog = Catalog::new(None);
    let list = catalog.asset_list(&list_query());
    assert_eq!(list.assets.len(), 0);
    assert_eq!(list.index_status, IndexStatus::Fresh);
}
