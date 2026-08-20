//! FE-10：`view` 是绑定 current read 的独立只读 scope，不能取得 FE-03 modify
//! 权限或可编辑 capability。测试不序列化 reveal response，以免将临时内容写入
//! fixture/vector/log；只观察 opaque binding 与稳定结果。

use std::path::PathBuf;

use agent_config_manager_lib::catalog::Catalog;
use agent_config_manager_lib::core::GatewayCore;
use agent_config_manager_lib::domain::{
    AssetDetailQuery, AssetListQuery, AssetListScope, AssetType, NativeFileContent,
    NativeFileQuery, Query, ReadResult, ReasonCode, SensitiveAccessScope, SensitiveRevealQuery,
    SensitiveWorkbenchSurface, Snapshot,
};
use agent_config_manager_lib::wire::{
    AssetRefWire, ReadRequestPayload, SensitiveAccessScopeWire, SensitiveRevealQueryWire,
    SensitiveWorkbenchSurfaceWire,
};

fn core() -> GatewayCore {
    GatewayCore::new(Catalog::new(Some(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-02/native-root"),
    )))
}

#[test]
fn readonly_view_is_bound_to_the_masked_read_and_does_not_enable_modify() {
    let core = core();
    let ReadResult::Succeeded(Snapshot::AssetList(list)) =
        core.read(&Query::AssetList(AssetListQuery {
            scope: AssetListScope::CurrentAssetType {
                asset_type: AssetType::LongTermInstruction,
            },
            search_text: None,
            filters: None,
        }))
    else {
        panic!("FX-02 read-only long-term instruction must be listed");
    };
    let asset = list
        .assets
        .into_iter()
        .next()
        .expect("FX-02 exposes one long-term instruction")
        .asset;
    let ReadResult::Succeeded(Snapshot::AssetDetail(detail)) =
        core.read(&Query::AssetDetail(AssetDetailQuery {
            asset: asset.clone(),
        }))
    else {
        panic!("read-only detail must remain available before view reveal");
    };
    let ReadResult::Succeeded(Snapshot::NativeFile(file)) =
        core.read(&Query::NativeFile(NativeFileQuery {
            asset: asset.clone(),
            file_id: detail.detail.primary_file.file_id.clone(),
        }))
    else {
        panic!("read-only primary source must remain available before view reveal");
    };
    let NativeFileContent::Source(source) = &file.content else {
        panic!("FX-02 primary file must be a masked source");
    };
    let segment = source
        .sensitive_segments
        .first()
        .expect("masked source must expose an opaque segment");

    let view_query = Query::from(ReadRequestPayload::SensitiveReveal(
        SensitiveRevealQueryWire {
            asset: AssetRefWire::from(asset.clone()),
            file_id: file.file.file_id.clone(),
            segment_id: segment.segment_id.clone(),
            file_revision: file.revision.clone(),
            asset_revision: file.asset_revision.clone(),
            scope: SensitiveAccessScopeWire::View,
            surface: SensitiveWorkbenchSurfaceWire::Source,
        },
    ));
    let Query::SensitiveReveal(view_request) = &view_query else {
        panic!("view request must decode into the closed sensitive read query");
    };
    assert_eq!(view_request.scope, SensitiveAccessScope::View);
    assert_eq!(view_request.surface, SensitiveWorkbenchSurface::Source);

    let ReadResult::Succeeded(Snapshot::SensitiveReveal(view_snapshot)) = core.read(&view_query)
    else {
        panic!("matching readonly view binding must reveal only through the read seam");
    };
    assert_eq!(view_snapshot.grant.asset, asset);
    assert_eq!(view_snapshot.grant.file_id, file.file.file_id);
    assert_eq!(view_snapshot.grant.segment_id, segment.segment_id);
    assert_eq!(view_snapshot.grant.file_revision, file.revision);
    assert_eq!(view_snapshot.grant.asset_revision, file.asset_revision);
    assert_eq!(view_snapshot.grant.scope, SensitiveAccessScope::View);
    assert_eq!(
        view_snapshot.grant.surface,
        SensitiveWorkbenchSurface::Source
    );

    let Query::SensitiveReveal(view_request) = view_query.clone() else {
        unreachable!();
    };
    let assert_closed = |request: SensitiveRevealQuery| {
        assert!(matches!(
            core.read(&Query::SensitiveReveal(request)),
            ReadResult::Failed(_)
        ));
    };
    let mut wrong_asset = view_request.clone();
    wrong_asset.asset.native_unit_ref = "nunit-fx12-wrong".into();
    assert_closed(wrong_asset);
    let mut wrong_file = view_request.clone();
    wrong_file.file_id = "file-fx12-wrong".into();
    assert_closed(wrong_file);
    let mut wrong_segment = view_request.clone();
    wrong_segment.segment_id = "segment-fx12-wrong".into();
    assert_closed(wrong_segment);
    let mut wrong_file_revision = view_request.clone();
    wrong_file_revision.file_revision = "revision-fx12-wrong".into();
    assert_closed(wrong_file_revision);
    let mut wrong_asset_revision = view_request.clone();
    wrong_asset_revision.asset_revision = "asset-revision-fx12-wrong".into();
    assert_closed(wrong_asset_revision);
    let mut hook_request = view_request.clone();
    hook_request.asset.asset_type = AssetType::Hook;
    assert_closed(hook_request);

    let Query::SensitiveReveal(mut modify_request) = view_query else {
        unreachable!();
    };
    modify_request.scope = SensitiveAccessScope::Modify;
    let ReadResult::Failed(denied) = core.read(&Query::SensitiveReveal(modify_request)) else {
        panic!("read-only view scope must not inherit FE-03 modify authorization");
    };
    assert_eq!(denied.reason_code, ReasonCode::PermissionDenied);
}
