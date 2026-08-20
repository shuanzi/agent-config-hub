//! L1：FE-03 sensitive reveal 沿既有 read seam 返回绑定的短生命周期 grant。

use std::path::PathBuf;

use agent_config_manager_lib::catalog::Catalog;
use agent_config_manager_lib::core::GatewayCore;
use agent_config_manager_lib::domain::{
    AssetListQuery, AssetListScope, MaskedSourcePart, NativeFileContent, NativeFileQuery, Query,
    ReadResult, SensitiveAccessScope, SensitiveRevealQuery, SensitiveWorkbenchSurface, Snapshot,
};
use agent_config_manager_lib::wire::{
    AssetRefWire, ReadRequestPayload, ReadResponsePayload, SensitiveAccessScopeWire,
    SensitiveRevealQueryWire, SensitiveWorkbenchSurfaceWire,
};
use serde_json::json;

fn core() -> GatewayCore {
    GatewayCore::new(Catalog::new(Some(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-01/native-root"),
    )))
}

#[test]
fn modify_reveal_uses_existing_read_seam_for_a_bound_opaque_grant() {
    let core = core();
    let ReadResult::Succeeded(Snapshot::AssetList(list)) =
        core.read(&Query::AssetList(AssetListQuery {
            scope: AssetListScope::AllAssets,
            search_text: None,
            filters: None,
        }))
    else {
        panic!("FX-01 asset identity must be readable before sensitive reveal");
    };
    let asset = list
        .assets
        .into_iter()
        .next()
        .expect("FX-01 must supply an asset identity");

    let ReadResult::Succeeded(Snapshot::NativeFile(file)) =
        core.read(&Query::NativeFile(NativeFileQuery {
            asset: asset.asset.clone(),
            file_id: "file-fx01-skill-md".to_string(),
        }))
    else {
        panic!("FX-01 source must be readable and masked before sensitive reveal");
    };
    let NativeFileContent::Source(source) = &file.content else {
        panic!("FX-01 primary file must be text source");
    };
    let segment = source
        .sensitive_segments
        .first()
        .expect("FX-01 must expose a masked sensitive segment");

    let query = Query::from(ReadRequestPayload::SensitiveReveal(
        SensitiveRevealQueryWire {
            asset: AssetRefWire::from(asset.asset.clone()),
            file_id: file.file.file_id.clone(),
            segment_id: segment.segment_id.clone(),
            file_revision: file.revision.clone(),
            asset_revision: file.asset_revision.clone(),
            scope: SensitiveAccessScopeWire::Modify,
            surface: SensitiveWorkbenchSurfaceWire::Source,
        },
    ));
    let Query::SensitiveReveal(SensitiveRevealQuery { scope, surface, .. }) = &query else {
        panic!("modify request must remain a closed SensitiveRevealQuery");
    };
    assert_eq!(*scope, SensitiveAccessScope::Modify);
    assert_eq!(*surface, SensitiveWorkbenchSurface::Source);

    let ReadResult::Succeeded(Snapshot::SensitiveReveal(snapshot)) = core.read(&query) else {
        panic!("matching modify request must return a sensitive reveal snapshot");
    };
    assert_eq!(snapshot.grant.asset, asset.asset);
    assert_eq!(snapshot.grant.file_id, file.file.file_id);
    assert_eq!(snapshot.grant.segment_id, segment.segment_id);
    assert_eq!(snapshot.grant.file_revision, file.revision);
    assert_eq!(snapshot.grant.asset_revision, file.asset_revision);
    assert_eq!(snapshot.grant.scope, SensitiveAccessScope::Modify);
    assert_eq!(snapshot.grant.surface, SensitiveWorkbenchSurface::Source);
    assert!(!snapshot.grant.grant_id.is_empty());
    assert!(!snapshot.grant.expires_at.is_empty());

    let wire = serde_json::to_value(ReadResponsePayload::from(ReadResult::Succeeded(
        Snapshot::SensitiveReveal(snapshot),
    )))
    .expect("the Rust wire source must serialize the read result");
    assert_eq!(wire["kind"], json!("readSucceeded"));
    assert_eq!(wire["snapshot"]["kind"], json!("sensitiveReveal"));
    assert_eq!(wire["snapshot"]["grant"]["scope"], json!("modify"));
    assert_eq!(wire["snapshot"]["grant"]["surface"], json!("source"));
    assert!(wire["snapshot"].get("draft").is_none());
    assert!(wire["snapshot"].get("replayPayload").is_none());
}

#[test]
fn native_file_read_exposes_ordered_opaque_masked_parts_without_sensitive_values() {
    const PREFIX: &str = "---\nname: demo-skill\ndescription: Synthetic FX-01 fixture skill. Not a real skill.\n---\n\n# Demo Skill\n\nThis is a synthetic fixture asset used by the FX-01 read-only journey.\nIt is not installed anywhere and is never executed.\n\n## Configuration\n\nSet the API credential before use:\n\nAPI_KEY=";
    const SUFFIX: &str = "\n\nNever commit real credentials.\n";
    const MASK: &str = "••••••••";

    let core = core();
    let ReadResult::Succeeded(Snapshot::AssetList(list)) =
        core.read(&Query::AssetList(AssetListQuery {
            scope: AssetListScope::AllAssets,
            search_text: None,
            filters: None,
        }))
    else {
        panic!("FX-01 asset must be readable before its masked source is projected");
    };
    let asset = list
        .assets
        .into_iter()
        .next()
        .expect("FX-01 must supply an asset identity");

    let ReadResult::Succeeded(Snapshot::NativeFile(file)) =
        core.read(&Query::NativeFile(NativeFileQuery {
            asset: asset.asset,
            file_id: "file-fx01-skill-md".to_string(),
        }))
    else {
        panic!("FX-01 source must be available through the public nativeFile read seam");
    };
    let NativeFileContent::Source(source) = &file.content else {
        panic!("FX-01 primary file must be a masked text source");
    };

    let expected_parts = [
        MaskedSourcePart::Text {
            text: PREFIX.to_string(),
        },
        MaskedSourcePart::SensitivePlaceholder {
            segment_id: "seg-fx01-api-key".to_string(),
        },
        MaskedSourcePart::Text {
            text: SUFFIX.to_string(),
        },
    ];
    assert_eq!(
        source.masked_parts.as_deref(),
        Some(expected_parts.as_slice()),
        "有序 parts 必须保留普通文本与单个 opaque 敏感占位符"
    );
    assert_eq!(source.masked_text, format!("{PREFIX}{MASK}{SUFFIX}"));

    let wire = serde_json::to_value(ReadResponsePayload::from(ReadResult::Succeeded(
        Snapshot::NativeFile(file),
    )))
    .expect("nativeFile read result must retain a Rust-first wire form");
    let content = &wire["snapshot"]["content"];
    assert_eq!(content["kind"], json!("source"));
    assert_eq!(
        content["maskedText"],
        json!(format!("{PREFIX}{MASK}{SUFFIX}"))
    );
    assert_eq!(
        content["maskedParts"],
        json!([
            { "kind": "text", "text": PREFIX },
            { "kind": "sensitivePlaceholder", "segmentId": "seg-fx01-api-key" },
            { "kind": "text", "text": SUFFIX },
        ]),
        "placeholder 只能携带 segmentId，不得变成第二份敏感或路径 DTO"
    );

    let wire_text = wire.to_string();
    let real_manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .display()
        .to_string();
    for forbidden in [
        "SYNTHETIC-SECRET",
        "rawValue",
        "plaintext",
        "grant",
        real_manifest_path.as_str(),
    ] {
        assert!(
            !wire_text.contains(forbidden),
            "masked nativeFile wire must not contain {forbidden}"
        );
    }
}
