//! L1：GatewayCore::read 三种 query 的成功分支 + 未知身份的稳定失败。

use std::path::PathBuf;

use agent_config_manager_lib::catalog::Catalog;
use agent_config_manager_lib::core::GatewayCore;
use agent_config_manager_lib::domain::{
    AssetDetailQuery, AssetListQuery, AssetListScope, AssetRef, AssetType, NativeFileContent,
    NativeFileQuery, NativeOwnership, Query, ReadResult, ReasonCode, RecoveryAction, Snapshot,
};

fn core() -> GatewayCore {
    GatewayCore::new(Catalog::new(Some(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-01/native-root"),
    )))
}

fn demo_asset_ref() -> AssetRef {
    let core = core();
    let ReadResult::Succeeded(Snapshot::AssetList(list)) =
        core.read(&Query::AssetList(AssetListQuery {
            scope: AssetListScope::AllAssets,
            search_text: None,
            filters: None,
        }))
    else {
        panic!("asset list must succeed");
    };
    assert_eq!(list.assets.len(), 1);
    list.assets[0].asset.clone()
}

#[test]
fn read_asset_list_succeeds() {
    let core = core();
    let result = core.read(&Query::AssetList(AssetListQuery {
        scope: AssetListScope::CurrentAssetType {
            asset_type: AssetType::Skill,
        },
        search_text: None,
        filters: None,
    }));
    let ReadResult::Succeeded(Snapshot::AssetList(snapshot)) = result else {
        panic!("asset list must succeed");
    };
    assert_eq!(snapshot.assets.len(), 1);
    assert_eq!(snapshot.assets[0].display_name, "Demo Skill");
}

#[test]
fn read_asset_detail_succeeds() {
    let core = core();
    let asset = demo_asset_ref();
    let result = core.read(&Query::AssetDetail(AssetDetailQuery {
        asset: asset.clone(),
    }));
    let ReadResult::Succeeded(Snapshot::AssetDetail(snapshot)) = result else {
        panic!("asset detail must succeed");
    };
    assert_eq!(snapshot.detail.asset, asset);
    assert!(snapshot.revision.starts_with("rev-"));
}

#[test]
fn read_native_file_succeeds_and_is_masked() {
    let core = core();
    let asset = demo_asset_ref();
    let ReadResult::Succeeded(Snapshot::AssetDetail(detail)) =
        core.read(&Query::AssetDetail(AssetDetailQuery {
            asset: asset.clone(),
        }))
    else {
        panic!("asset detail must succeed");
    };
    let result = core.read(&Query::NativeFile(NativeFileQuery {
        asset,
        file_id: detail.detail.primary_file.file_id.clone(),
    }));
    let ReadResult::Succeeded(Snapshot::NativeFile(snapshot)) = result else {
        panic!("native file must succeed");
    };
    let NativeFileContent::Source(content) = &snapshot.content else {
        panic!("must be source content");
    };
    assert!(!content.masked_text.contains("SYNTHETIC-SECRET"));
    assert!(content.masked_text.contains('•'));
}

#[test]
fn unknown_asset_id_fails_with_stable_reason() {
    let core = core();
    let unknown = AssetRef {
        asset_id: "asset-fx01-does-not-exist".to_string(),
        asset_type: AssetType::Skill,
        native_unit_ref: "nunit-fx01-does-not-exist".to_string(),
        adapter_identity: "claude-code@fixture".to_string(),
        native_ownership: NativeOwnership::Global,
    };
    let result = core.read(&Query::AssetDetail(AssetDetailQuery { asset: unknown }));
    let ReadResult::Failed(failure) = result else {
        panic!("unknown asset must fail");
    };
    assert_eq!(failure.reason_code, ReasonCode::ReadFailed);
    assert_eq!(failure.recovery_action, Some(RecoveryAction::RetryRead));
    assert!(!failure.message.is_empty());
}

#[test]
fn unknown_file_id_fails_with_stable_reason() {
    let core = core();
    let asset = demo_asset_ref();
    let result = core.read(&Query::NativeFile(NativeFileQuery {
        asset,
        file_id: "file-fx01-nope".to_string(),
    }));
    let ReadResult::Failed(failure) = result else {
        panic!("unknown file must fail");
    };
    assert_eq!(failure.reason_code, ReasonCode::ReadFailed);
}
