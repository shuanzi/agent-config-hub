//! FE-02 / FX-02 的 L1 public-core 只读测试。
//!
//! 证据边界：本 target 只经 `GatewayCore::read` 观察隔离的 FX-02 fixture，
//! 不启动 WebView/IPC，不调用或模拟 write、draft、prepare、apply，更不执行
//! fixture 内容。L3 再单独证明真实 Tauri 的 read 路径。

use std::fs;
use std::path::PathBuf;

#[cfg(unix)]
use std::os::unix::fs::symlink;

use agent_config_manager_lib::catalog::{Catalog, SENSITIVE_MASK};
use agent_config_manager_lib::core::GatewayCore;
use agent_config_manager_lib::domain::{
    ActionAvailability, AssetListQuery, AssetListScope, AssetReadSurface, AssetRef, AssetType,
    FileKind, FileTreeNode, NativeFileContent, NativeFileQuery, NativeOwnership, NativeUnitKind,
    Query, ReadResult, ReasonCode, SensitiveDisplayState, Snapshot,
};
use agent_config_manager_lib::wire::{
    decode_hook_compatibility, HookCompatibilityDecodeError, ReadResponsePayload,
};
use serde_json::{json, Value};

fn core() -> GatewayCore {
    GatewayCore::new(Catalog::new(Some(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-02/native-root"),
    )))
}

fn mixed_skill() -> agent_config_manager_lib::domain::AssetRef {
    let ReadResult::Succeeded(Snapshot::AssetList(list)) =
        core().read(&Query::AssetList(AssetListQuery {
            scope: AssetListScope::CurrentAssetType {
                asset_type: AssetType::Skill,
            },
            search_text: None,
            filters: None,
        }))
    else {
        panic!("FX-02 mixed Skill must be listable through the public read seam");
    };

    assert_eq!(
        list.assets.len(),
        1,
        "FX-02 owns one isolated mixed multi-file Skill asset"
    );
    list.assets[0].asset.clone()
}

fn single_asset(core: &GatewayCore, asset_type: AssetType) -> AssetRef {
    let ReadResult::Succeeded(Snapshot::AssetList(list)) =
        core.read(&Query::AssetList(AssetListQuery {
            scope: AssetListScope::CurrentAssetType { asset_type },
            search_text: None,
            filters: None,
        }))
    else {
        panic!("FX-02 {asset_type:?} must be listable through the public read seam");
    };
    assert_eq!(
        list.assets.len(),
        1,
        "FX-02 owns one {asset_type:?} fixture"
    );
    list.assets[0].asset.clone()
}

fn assert_read_only(availability: &ActionAvailability) {
    assert!(matches!(
        availability,
        ActionAvailability::Disabled {
            reason_code: ReasonCode::ReadOnlyPolicy,
            ..
        }
    ));
}

fn assert_masked_text(snapshot: &agent_config_manager_lib::domain::NativeFileSnapshot) {
    let NativeFileContent::Source(content) = &snapshot.content else {
        panic!("type-specific primary file must stay a masked source surface");
    };
    assert!(content.masked_text.contains(SENSITIVE_MASK));
    assert!(!content.masked_text.contains("SYNTHETIC-SECRET"));
    assert!(
        !content.sensitive_segments.is_empty(),
        "masked type-specific content must retain sensitive-segment metadata"
    );
    assert!(content.sensitive_segments.iter().all(|segment| {
        segment.file_id == snapshot.file.file_id
            && segment.revision == snapshot.revision
            && segment.display_state == SensitiveDisplayState::Masked
    }));
    assert!(!snapshot.file.has_draft_changes);
    assert_read_only(&snapshot.file.can_edit);
}

fn read_serialized(core: &GatewayCore, query: &Query) -> (ReadResult<Snapshot>, String) {
    let result = core.read(query);
    let serialized = serde_json::to_string(&ReadResponsePayload::from(result.clone()))
        .expect("the public read response must serialize");
    (result, serialized)
}

fn collect_files(
    node: &FileTreeNode,
    files: &mut Vec<agent_config_manager_lib::domain::NativeFileRef>,
) {
    if let Some(file) = &node.file {
        files.push(file.clone());
    }
    if let Some(children) = &node.children {
        for child in children {
            collect_files(child, files);
        }
    }
}

#[test]
fn fx02_mixed_multifile_skill_exposes_a_complete_stable_read_only_tree() {
    let core = core();
    let asset = mixed_skill();
    let ReadResult::Succeeded(Snapshot::AssetDetail(first)) = core.read(&Query::AssetDetail(
        agent_config_manager_lib::domain::AssetDetailQuery {
            asset: asset.clone(),
        },
    )) else {
        panic!("FX-02 detail must be readable");
    };
    let ReadResult::Succeeded(Snapshot::AssetDetail(second)) = core.read(&Query::AssetDetail(
        agent_config_manager_lib::domain::AssetDetailQuery { asset },
    )) else {
        panic!("a repeated FX-02 detail read must remain readable");
    };

    assert_eq!(
        first.detail.native_unit_kind,
        NativeUnitKind::MultiFileDirectory
    );
    let tree = first
        .detail
        .file_tree_root
        .as_ref()
        .expect("multi-file asset must retain its native file tree");
    let mut files = Vec::new();
    collect_files(tree, &mut files);
    assert!(
        files.len() >= 3,
        "fixture must include primary, text, and non-text files"
    );

    let primaries: Vec<_> = files.iter().filter(|file| file.is_primary).collect();
    assert_eq!(
        primaries.len(),
        1,
        "exactly one native primary file is selectable"
    );
    let primary = primaries[0];
    assert_eq!(primary.name, "SKILL.md");
    assert_eq!(primary.file_kind, FileKind::Text);
    assert_eq!(first.detail.primary_file, *primary);
    assert_eq!(
        first.detail.primary_file.file_id, second.detail.primary_file.file_id,
        "repeated reads must not change the native primary selection"
    );
    assert!(
        files
            .iter()
            .any(|file| !file.is_primary && file.file_kind == FileKind::Text),
        "fixture must contain a secondary text file"
    );
    assert!(
        files.iter().any(|file| file.file_kind == FileKind::NonText),
        "fixture must contain a non-text file"
    );
    assert!(files.iter().all(|file| !file.has_draft_changes));
}

#[test]
fn fx02_text_and_nontext_reads_preserve_read_only_fallbacks_and_masking() {
    let core = core();
    let asset = mixed_skill();
    let ReadResult::Succeeded(Snapshot::AssetDetail(detail)) = core.read(&Query::AssetDetail(
        agent_config_manager_lib::domain::AssetDetailQuery {
            asset: asset.clone(),
        },
    )) else {
        panic!("FX-02 detail must be readable");
    };
    let tree = detail
        .detail
        .file_tree_root
        .as_ref()
        .expect("multi-file asset must retain its native file tree");
    let mut files = Vec::new();
    collect_files(tree, &mut files);
    let text = files
        .iter()
        .find(|file| !file.is_primary && file.file_kind == FileKind::Text)
        .expect("fixture secondary text file");
    let non_text = files
        .iter()
        .find(|file| file.file_kind == FileKind::NonText)
        .expect("fixture non-text file");

    let ReadResult::Succeeded(Snapshot::NativeFile(text_snapshot)) =
        core.read(&Query::NativeFile(NativeFileQuery {
            asset: asset.clone(),
            file_id: text.file_id.clone(),
        }))
    else {
        panic!("secondary text file must be readable");
    };
    assert_eq!(text_snapshot.file, *text);
    let NativeFileContent::Source(text_content) = &text_snapshot.content else {
        panic!("text file must remain a statically displayable source surface");
    };
    assert!(!text_content.masked_text.contains("SYNTHETIC-SECRET"));

    let ReadResult::Succeeded(Snapshot::NativeFile(primary_snapshot)) =
        core.read(&Query::NativeFile(NativeFileQuery {
            asset: asset.clone(),
            file_id: detail.detail.primary_file.file_id.clone(),
        }))
    else {
        panic!("primary text file must be readable");
    };
    let NativeFileContent::Source(primary_content) = &primary_snapshot.content else {
        panic!("primary text file must remain a statically displayable source surface");
    };
    assert!(primary_content.masked_text.contains(SENSITIVE_MASK));
    assert!(!primary_content.masked_text.contains("SYNTHETIC-SECRET"));
    assert!(primary_content
        .sensitive_segments
        .iter()
        .all(|segment| segment.display_state == SensitiveDisplayState::Masked));

    let ReadResult::Succeeded(Snapshot::NativeFile(non_text_snapshot)) =
        core.read(&Query::NativeFile(NativeFileQuery {
            asset: asset.clone(),
            file_id: non_text.file_id.clone(),
        }))
    else {
        panic!("non-text file must return a read-only metadata fallback");
    };
    assert_eq!(non_text_snapshot.file, *non_text);
    let NativeFileContent::NonTextMetadata(metadata) = &non_text_snapshot.content else {
        panic!("non-text content must never be coerced to text");
    };
    assert_eq!(metadata.reason_code, ReasonCode::NonTextUnpreviewable);
    assert!(!metadata.file_kind_label.is_empty());
    assert!(metadata.size_bytes > 0);
    assert!(!metadata.path_display.is_empty());

    let ReadResult::Failed(failure) = core.read(&Query::NativeFile(NativeFileQuery {
        asset,
        file_id: "file-fx02-does-not-exist".to_string(),
    })) else {
        panic!("unknown native file must fail closed");
    };
    assert_eq!(failure.reason_code, ReasonCode::ReadFailed);
}

#[test]
fn fx02_long_term_instruction_and_subagent_use_actual_type_specific_read_surfaces() {
    let core = core();
    let instruction = single_asset(&core, AssetType::LongTermInstruction);
    let ReadResult::Succeeded(Snapshot::AssetDetail(instruction_detail)) = core.read(
        &Query::AssetDetail(agent_config_manager_lib::domain::AssetDetailQuery {
            asset: instruction.clone(),
        }),
    ) else {
        panic!("FX-02 long-term instruction detail must be readable");
    };
    assert_eq!(
        instruction_detail.detail.native_unit_kind,
        NativeUnitKind::SingleFile
    );
    assert!(instruction_detail.detail.file_tree_root.is_none());
    match &instruction_detail.detail.read_surface {
        AssetReadSurface::LongTermInstruction { markdown_file } => {
            assert_eq!(markdown_file, &instruction_detail.detail.primary_file);
        }
        other => panic!("expected long-term instruction read surface, got {other:?}"),
    }
    assert_read_only(&instruction_detail.detail.capabilities.edit);
    assert_read_only(&instruction_detail.detail.capabilities.convert);
    assert_read_only(&instruction_detail.detail.capabilities.export);
    assert_read_only(&instruction_detail.detail.capabilities.delete);
    let ReadResult::Succeeded(Snapshot::NativeFile(instruction_file)) =
        core.read(&Query::NativeFile(NativeFileQuery {
            asset: instruction,
            file_id: instruction_detail.detail.primary_file.file_id.clone(),
        }))
    else {
        panic!("long-term instruction primary file must be readable");
    };
    assert_masked_text(&instruction_file);

    let subagent = single_asset(&core, AssetType::Subagent);
    let ReadResult::Succeeded(Snapshot::AssetDetail(subagent_detail)) = core.read(
        &Query::AssetDetail(agent_config_manager_lib::domain::AssetDetailQuery {
            asset: subagent.clone(),
        }),
    ) else {
        panic!("FX-02 Subagent detail must be readable");
    };
    assert_eq!(
        subagent_detail.detail.native_unit_kind,
        NativeUnitKind::ConfigBlock
    );
    assert!(subagent_detail.detail.file_tree_root.is_none());
    match &subagent_detail.detail.read_surface {
        AssetReadSurface::Subagent {
            model,
            tools,
            permissions,
            body_file,
            read_only_reason,
        } => {
            assert_eq!(model.as_deref(), Some("synthetic-research-model"));
            assert_eq!(tools, &["read"]);
            assert_eq!(permissions, &["readOnly"]);
            assert_eq!(body_file, &subagent_detail.detail.primary_file);
            assert_eq!(*read_only_reason, Some(ReasonCode::UnknownFieldPreserved));
        }
        other => panic!("expected Subagent read surface, got {other:?}"),
    }
    assert_read_only(&subagent_detail.detail.capabilities.edit);
    assert_read_only(&subagent_detail.detail.capabilities.convert);
    assert_read_only(&subagent_detail.detail.capabilities.export);
    assert_read_only(&subagent_detail.detail.capabilities.delete);
    let ReadResult::Succeeded(Snapshot::NativeFile(subagent_file)) =
        core.read(&Query::NativeFile(NativeFileQuery {
            asset: subagent,
            file_id: subagent_detail.detail.primary_file.file_id.clone(),
        }))
    else {
        panic!("Subagent body file must be readable");
    };
    assert_masked_text(&subagent_file);
}

#[cfg(unix)]
#[test]
fn fx02_symlinked_primary_files_do_not_escape_or_enumerate_native_assets() {
    let sandbox = tempfile::tempdir().expect("temporary symlink fixture root");
    let root = sandbox.path().join("fx-escape/native-root");
    let outside = sandbox.path().join("outside");
    fs::create_dir_all(root.join("skills/symlinked-skill")).expect("skill fixture directory");
    fs::create_dir_all(root.join("subagents/escaped-subagent"))
        .expect("subagent fixture directory");
    fs::create_dir_all(&outside).expect("outside directory");
    fs::write(
        root.join("skills/symlinked-skill/notes.md"),
        "ordinary auxiliary file",
    )
    .expect("ordinary auxiliary file");
    fs::write(outside.join("SKILL.md"), "outside Skill content").expect("outside Skill target");
    fs::write(outside.join("SUBAGENT.md"), "outside Subagent content")
        .expect("outside Subagent target");
    symlink(
        outside.join("SKILL.md"),
        root.join("skills/symlinked-skill/SKILL.md"),
    )
    .expect("symlinked Skill primary");
    symlink(
        outside.join("SUBAGENT.md"),
        root.join("subagents/escaped-subagent/SUBAGENT.md"),
    )
    .expect("symlinked Subagent primary");
    let core = GatewayCore::new(Catalog::new(Some(root)));

    for asset_type in [AssetType::Skill, AssetType::Subagent] {
        let ReadResult::Succeeded(Snapshot::AssetList(list)) =
            core.read(&Query::AssetList(AssetListQuery {
                scope: AssetListScope::CurrentAssetType { asset_type },
                search_text: None,
                filters: None,
            }))
        else {
            panic!("symlink escape list must stay readable and fail closed");
        };
        assert!(
            list.assets.is_empty(),
            "{asset_type:?} whose primary file is a symlink must not be enumerated"
        );
    }

    let skill = AssetRef {
        asset_id: "asset-fxescape-symlinked-skill".to_string(),
        asset_type: AssetType::Skill,
        native_unit_ref: "nunit-fxescape-symlinked-skill".to_string(),
        adapter_identity: "claude-code@fixture".to_string(),
        native_ownership: NativeOwnership::Global,
    };
    let ReadResult::Failed(skill_failure) = core.read(&Query::AssetDetail(
        agent_config_manager_lib::domain::AssetDetailQuery { asset: skill },
    )) else {
        panic!("symlinked Skill must not form a readable detail");
    };
    assert_eq!(skill_failure.reason_code, ReasonCode::ReadFailed);

    let subagent = AssetRef {
        asset_id: "asset-fxescape-subagent-escaped-subagent".to_string(),
        asset_type: AssetType::Subagent,
        native_unit_ref: "nunit-fxescape-subagent-escaped-subagent".to_string(),
        adapter_identity: "claude-code@fixture".to_string(),
        native_ownership: NativeOwnership::Global,
    };
    let ReadResult::Failed(subagent_failure) = core.read(&Query::NativeFile(NativeFileQuery {
        asset: subagent,
        file_id: "file-fxescape-subagents-escaped-subagent-subagent-md".to_string(),
    })) else {
        panic!("symlinked Subagent must not form a readable native file");
    };
    assert_eq!(subagent_failure.reason_code, ReasonCode::ReadFailed);
}

#[test]
fn fx02_sensitive_secondary_file_identity_and_content_are_masked_at_every_public_read_surface() {
    let sandbox = tempfile::tempdir().expect("temporary sensitive-path fixture root");
    let root = sandbox.path().join("fx-sensitive/native-root");
    let marker = "SYNTHETIC-SECRET";
    let secondary_name = format!("{marker}-secondary.md");
    fs::create_dir_all(root.join("skills/sensitive-skill/references"))
        .expect("sensitive multi-file Skill fixture directory");
    fs::write(
        root.join("skills/sensitive-skill/SKILL.md"),
        "name: safe skill\n",
    )
    .expect("safe Skill primary");
    fs::write(
        root.join("skills/sensitive-skill/references")
            .join(&secondary_name),
        format!("SECONDARY_TOKEN={marker}-secondary-content\n"),
    )
    .expect("sensitive secondary fixture content");
    let core = GatewayCore::new(Catalog::new(Some(root)));

    let list_query = Query::AssetList(AssetListQuery {
        scope: AssetListScope::CurrentAssetType {
            asset_type: AssetType::Skill,
        },
        search_text: None,
        filters: None,
    });
    let (list_result, list_serialized) = read_serialized(&core, &list_query);
    assert!(
        !list_serialized.contains(marker),
        "serialized Skill list must not expose sensitive derived identity"
    );
    let ReadResult::Succeeded(Snapshot::AssetList(list)) = list_result else {
        panic!("sensitive-path Skill must remain listable through the public read seam");
    };
    let asset = list.assets[0].asset.clone();

    let detail_query = Query::AssetDetail(agent_config_manager_lib::domain::AssetDetailQuery {
        asset: asset.clone(),
    });
    let (detail_result, detail_serialized) = read_serialized(&core, &detail_query);
    assert!(
        !detail_serialized.contains(marker),
        "serialized Skill detail/tree must not expose a sensitive secondary filename"
    );
    let ReadResult::Succeeded(Snapshot::AssetDetail(detail)) = detail_result else {
        panic!("masked Skill identity must round-trip to its detail");
    };
    assert_eq!(detail.detail.asset, asset);
    let mut files = Vec::new();
    collect_files(
        detail
            .detail
            .file_tree_root
            .as_ref()
            .expect("multi-file sensitive fixture must expose a tree"),
        &mut files,
    );
    let secondary = files
        .iter()
        .find(|file| !file.is_primary && file.file_kind == FileKind::Text)
        .expect("sensitive secondary file must remain selectable by masked identity");

    let native_query = Query::NativeFile(NativeFileQuery {
        asset,
        file_id: secondary.file_id.clone(),
    });
    let (native_result, native_serialized) = read_serialized(&core, &native_query);
    assert!(
        !native_serialized.contains(marker),
        "serialized secondary native-file response must not expose sensitive path/content"
    );
    let ReadResult::Succeeded(Snapshot::NativeFile(native)) = native_result else {
        panic!("masked secondary identity must round-trip to an actual read");
    };
    assert_eq!(native.file, *secondary);
    let NativeFileContent::Source(content) = native.content else {
        panic!("sensitive secondary fixture must remain a text source surface");
    };
    assert!(!content.masked_text.contains(marker));
    assert!(!content.sensitive_segments.is_empty());
    assert!(content.sensitive_segments.iter().all(|segment| {
        segment.file_id == native.file.file_id
            && segment.revision == native.revision
            && segment.display_state == SensitiveDisplayState::Masked
    }));
}

fn assert_sensitive_static_asset_path_is_masked(asset_type: AssetType) {
    let sandbox = tempfile::tempdir().expect("temporary sensitive static fixture root");
    let root = sandbox.path().join("fx-sensitive/native-root");
    let marker = "SYNTHETIC-SECRET";
    match asset_type {
        AssetType::LongTermInstruction => {
            fs::create_dir_all(root.join("long-term-instructions"))
                .expect("long-term instruction fixture directory");
            fs::write(
                root.join("long-term-instructions")
                    .join(format!("{marker}-instruction.md")),
                format!("INSTRUCTION_TOKEN={marker}-instruction-content\n"),
            )
            .expect("sensitive long-term instruction fixture");
        }
        AssetType::Subagent => {
            fs::create_dir_all(root.join("subagents").join(format!("{marker}-subagent")))
                .expect("Subagent fixture directory");
            fs::write(
                root.join("subagents")
                    .join(format!("{marker}-subagent"))
                    .join("SUBAGENT.md"),
                format!("SUBAGENT_TOKEN={marker}-subagent-content\n"),
            )
            .expect("sensitive Subagent fixture");
        }
        _ => panic!("only static FE-02 asset types use this assertion helper"),
    }
    let core = GatewayCore::new(Catalog::new(Some(root)));
    let list_query = Query::AssetList(AssetListQuery {
        scope: AssetListScope::CurrentAssetType { asset_type },
        search_text: None,
        filters: None,
    });
    let (list_result, list_serialized) = read_serialized(&core, &list_query);
    assert!(
        !list_serialized.contains(marker),
        "serialized {asset_type:?} list must not expose sensitive filename/directory identity"
    );
    let ReadResult::Succeeded(Snapshot::AssetList(list)) = list_result else {
        panic!("sensitive {asset_type:?} must remain listable through the public read seam");
    };
    let asset = list.assets[0].asset.clone();

    let detail_query = Query::AssetDetail(agent_config_manager_lib::domain::AssetDetailQuery {
        asset: asset.clone(),
    });
    let (detail_result, detail_serialized) = read_serialized(&core, &detail_query);
    assert!(
        !detail_serialized.contains(marker),
        "serialized {asset_type:?} detail must not expose sensitive derived identity"
    );
    let ReadResult::Succeeded(Snapshot::AssetDetail(detail)) = detail_result else {
        panic!("masked {asset_type:?} identity must round-trip to its detail");
    };
    assert_eq!(detail.detail.asset, asset);

    let native_query = Query::NativeFile(NativeFileQuery {
        asset,
        file_id: detail.detail.primary_file.file_id.clone(),
    });
    let (native_result, native_serialized) = read_serialized(&core, &native_query);
    assert!(
        !native_serialized.contains(marker),
        "serialized {asset_type:?} native file must not expose sensitive path/content"
    );
    let ReadResult::Succeeded(Snapshot::NativeFile(native)) = native_result else {
        panic!("masked {asset_type:?} identity must round-trip to a native read");
    };
    assert_eq!(native.file, detail.detail.primary_file);
    assert_masked_text(&native);
}

#[test]
fn fx02_sensitive_long_term_instruction_filename_is_masked_without_breaking_identity() {
    assert_sensitive_static_asset_path_is_masked(AssetType::LongTermInstruction);
}

#[test]
fn fx02_sensitive_subagent_directory_is_masked_without_breaking_identity() {
    assert_sensitive_static_asset_path_is_masked(AssetType::Subagent);
}

#[test]
fn fx03_hook_compatibility_preserves_unknown_fields_without_exposing_or_executing_content() {
    let fixture: Value = serde_json::from_str(include_str!("../../fixtures/fx-03/fixture.json"))
        .expect("FX-03 fixture must be valid JSON");
    let asset = fixture
        .get("asset")
        .cloned()
        .expect("FX-03 fixture must contain an adapter Hook descriptor");
    let expected_unknown = json!("SYNTHETIC-SECRET-fx03-hook-option");

    let decoded = decode_hook_compatibility(asset)
        .expect("Hook compatibility decoder must accept the fixture descriptor");
    assert_eq!(decoded.record.asset.asset_type, AssetType::Hook);
    assert_eq!(
        decoded.record.reason_code,
        ReasonCode::ExecutableContentRisk
    );
    assert_eq!(decoded.record.unknown_field_names, vec!["futureHookOption"]);
    assert_eq!(decoded.preserved_unknown_field_count(), 1);
    assert!(decoded.preserves_unknown_field("futureHookOption", &expected_unknown));
    assert!(
        !decoded.preserves_unknown_field("futureHookOption", &json!("changed")),
        "the private compatibility value must be retained exactly, not projected or normalized"
    );

    let public_record = format!("{:?}", decoded.record);
    assert!(public_record.contains("ExecutableContentRisk"));
    assert!(!public_record.contains("SYNTHETIC-SECRET"));
    assert!(
        !public_record.contains("on-save.sh"),
        "the compatibility record has no Hook body/path surface"
    );
    assert!(
        matches!(
            decode_hook_compatibility(json!({ "assetType": "skill" })),
            Err(HookCompatibilityDecodeError::InvalidPayload)
        ),
        "malformed non-Hook inputs remain fail-closed"
    );
}

#[test]
fn fx03_hook_compatibility_masks_sensitive_unknown_field_names_but_retains_private_equality() {
    let fixture: Value = serde_json::from_str(include_str!("../../fixtures/fx-03/fixture.json"))
        .expect("FX-03 fixture must be valid JSON");
    let mut asset = fixture
        .get("asset")
        .cloned()
        .expect("FX-03 fixture must contain an adapter Hook descriptor");
    let sensitive_name = ["SYNTHETIC-SECRET", "fx03-hook-future-option"].join("-");
    let sensitive_value = json!(["SYNTHETIC-SECRET", "fx03-hook-private-value"].join("-"));
    let mut unknown_fields = serde_json::Map::new();
    unknown_fields.insert(sensitive_name.clone(), sensitive_value.clone());
    asset["unknownFields"] = Value::Object(unknown_fields);

    let decoded = decode_hook_compatibility(asset)
        .expect("Hook compatibility decoder must preserve opaque unknown fields");
    assert_eq!(decoded.preserved_unknown_field_count(), 1);
    assert!(decoded.preserves_unknown_field(&sensitive_name, &sensitive_value));
    assert!(
        !decoded
            .record
            .unknown_field_names
            .iter()
            .any(|name| name.contains("SYNTHETIC-SECRET")),
        "the public compatibility record must not expose a sensitive unknown key"
    );
    let public_record = format!("{:?}", decoded.record);
    assert!(!public_record.contains("SYNTHETIC-SECRET"));
    assert!(!public_record.contains("fx03-hook-private-value"));
}

#[test]
fn fx03_hook_detail_and_native_file_queries_fail_closed_without_reading_content() {
    let fixture: Value = serde_json::from_str(include_str!("../../fixtures/fx-03/fixture.json"))
        .expect("FX-03 fixture must be valid JSON");
    let decoded = decode_hook_compatibility(
        fixture
            .get("asset")
            .cloned()
            .expect("FX-03 fixture must contain an adapter Hook descriptor"),
    )
    .expect("Hook compatibility decoder must accept the fixture descriptor");
    let core = GatewayCore::new(Catalog::new(Some(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-03/native-root"),
    )));

    let ReadResult::Failed(detail_failure) = core.read(&Query::AssetDetail(
        agent_config_manager_lib::domain::AssetDetailQuery {
            asset: decoded.record.asset.clone(),
        },
    )) else {
        panic!("Hook cannot form an asset detail destination");
    };
    assert_eq!(
        detail_failure.reason_code,
        ReasonCode::ExecutableContentRisk
    );
    assert!(!detail_failure.message.contains("SYNTHETIC-SECRET"));

    let ReadResult::Failed(file_failure) = core.read(&Query::NativeFile(NativeFileQuery {
        asset: decoded.record.asset,
        file_id: "hooks/on-save.sh".to_string(),
    })) else {
        panic!("Hook native content must never be read or executed");
    };
    assert_eq!(file_failure.reason_code, ReasonCode::ExecutableContentRisk);
    assert!(!file_failure.message.contains("SYNTHETIC-SECRET"));
}
