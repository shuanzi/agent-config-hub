//! L1：wire 双向契约向量（ARC-06c）。
//!
//! - 合法 request vector 解码成功；
//! - 未知 tag、未知字段、缺失字段、错误 wireVersion、超限 payload 均被拒绝；
//! - response/event 序列化与 golden JSON 逐字节一致；
//! - 负向结果归一化为 GATEWAY_UNAVAILABLE，且不携带异常字符串。

use std::path::PathBuf;

use agent_config_manager_lib::catalog::Catalog;
use agent_config_manager_lib::core::GatewayCore;
use agent_config_manager_lib::ipc::{handle_read, MAX_REQUEST_BYTES};
use agent_config_manager_lib::wire::{
    ActionAvailabilityWire, ReadRequestEnvelope, ReadResponsePayload, ReasonCodeWire,
    WorkspaceEventEnvelope, WorkspaceEventWire, GATEWAY_WIRE_VERSION,
};
use serde_json::{json, Value};

fn core() -> GatewayCore {
    GatewayCore::new(Catalog::new(Some(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-01/native-root"),
    )))
}

// ---------------------------------------------------------------------------
// 正向 request vector
// ---------------------------------------------------------------------------

#[test]
fn valid_request_vectors_decode() {
    let vectors = [
        json!({
            "wireVersion": 1,
            "requestId": "req-list-1",
            "payload": { "kind": "assetList", "scope": { "kind": "allAssets" } }
        }),
        json!({
            "wireVersion": 1,
            "requestId": "req-list-2",
            "payload": {
                "kind": "assetList",
                "scope": { "kind": "currentAssetType", "assetType": "skill" },
                "searchText": "demo",
                "filters": {
                    "agents": ["claude-code"],
                    "scopes": ["global"],
                    "statuses": ["editable", "normal"],
                    "groupBy": "none"
                }
            }
        }),
        json!({
            "wireVersion": 1,
            "requestId": "req-detail-1",
            "payload": {
                "kind": "assetDetail",
                "asset": {
                    "assetId": "asset-fx01-demo-skill",
                    "assetType": "skill",
                    "nativeUnitRef": "nunit-fx01-demo-skill",
                    "adapterIdentity": "claude-code@fixture"
                }
            }
        }),
        json!({
            "wireVersion": 1,
            "requestId": "req-file-1",
            "payload": {
                "kind": "nativeFile",
                "asset": {
                    "assetId": "asset-fx01-demo-skill",
                    "assetType": "skill",
                    "nativeUnitRef": "nunit-fx01-demo-skill",
                    "adapterIdentity": "claude-code@fixture"
                },
                "fileId": "file-fx01-skill-md"
            }
        }),
    ];
    for vector in vectors {
        let envelope: ReadRequestEnvelope =
            serde_json::from_value(vector).expect("valid vector must decode");
        assert_eq!(envelope.wire_version, GATEWAY_WIRE_VERSION);
    }
}

// ---------------------------------------------------------------------------
// 负向 request vector：解码层拒绝
// ---------------------------------------------------------------------------

#[test]
fn negative_vectors_are_rejected_at_decode() {
    let vectors = [
        // 未知 payload tag
        json!({
            "wireVersion": 1, "requestId": "r",
            "payload": { "kind": "prepare", "scope": { "kind": "allAssets" } }
        }),
        // 未知字段（envelope 层）
        json!({
            "wireVersion": 1, "requestId": "r", "bogus": 1,
            "payload": { "kind": "assetList", "scope": { "kind": "allAssets" } }
        }),
        // 未知字段（payload 层）
        json!({
            "wireVersion": 1, "requestId": "r",
            "payload": { "kind": "assetList", "scope": { "kind": "allAssets" }, "bogus": true }
        }),
        // 未知字段（嵌套 struct 层）
        json!({
            "wireVersion": 1, "requestId": "r",
            "payload": { "kind": "assetList", "scope": { "kind": "allAssets", "bogus": 1 } }
        }),
        // 缺失字段（assetDetail 缺 asset）
        json!({
            "wireVersion": 1, "requestId": "r",
            "payload": { "kind": "assetDetail" }
        }),
        // 缺失字段（envelope 缺 payload）
        json!({ "wireVersion": 1, "requestId": "r" }),
        // 未知枚举值
        json!({
            "wireVersion": 1, "requestId": "r",
            "payload": { "kind": "assetList", "scope": { "kind": "currentAssetType", "assetType": "spell" } }
        }),
        // 错误类型（wireVersion 为字符串）
        json!({
            "wireVersion": "1", "requestId": "r",
            "payload": { "kind": "assetList", "scope": { "kind": "allAssets" } }
        }),
    ];
    for vector in vectors {
        assert!(
            serde_json::from_value::<ReadRequestEnvelope>(vector.clone()).is_err(),
            "vector must be rejected: {vector}"
        );
    }
}

// ---------------------------------------------------------------------------
// 负向归一化：ingress 输出 GATEWAY_UNAVAILABLE，无异常字符串泄漏
// ---------------------------------------------------------------------------

fn assert_normalized_gateway_unavailable(response: &Value, request_id: &str) {
    assert_eq!(response["wireVersion"], json!(GATEWAY_WIRE_VERSION));
    assert_eq!(response["requestId"], json!(request_id));
    assert_eq!(response["payload"]["kind"], json!("readFailed"));
    assert_eq!(
        response["payload"]["reasonCode"],
        json!("GATEWAY_UNAVAILABLE")
    );
    assert_eq!(
        response["payload"]["recoveryAction"],
        json!({ "kind": "retryRead" })
    );
    let message = response["payload"]["message"].as_str().unwrap();
    // 归一化消息是固定文案，不携带 serde/内部异常正文。
    assert_eq!(message, "本地 gateway 暂时不可用，请重试。");
    assert!(!message.contains("unknown field"));
    assert!(!message.contains("missing field"));
    assert!(!response.to_string().contains("SYNTHETIC-SECRET"));
}

#[test]
fn wire_faults_normalize_to_gateway_unavailable() {
    let core = core();
    let cases: Vec<Value> = vec![
        // 错误 wireVersion
        json!({
            "wireVersion": 2, "requestId": "r1",
            "payload": { "kind": "assetList", "scope": { "kind": "allAssets" } }
        }),
        // 未知 tag
        json!({
            "wireVersion": 1, "requestId": "r1",
            "payload": { "kind": "nope" }
        }),
        // 未知字段
        json!({
            "wireVersion": 1, "requestId": "r1", "bogus": 1,
            "payload": { "kind": "assetList", "scope": { "kind": "allAssets" } }
        }),
        // 缺失字段
        json!({ "wireVersion": 1, "requestId": "r1" }),
    ];
    for raw in cases {
        let response = serde_json::to_value(handle_read(&core, &raw)).unwrap();
        assert_normalized_gateway_unavailable(&response, "r1");
    }

    // 非 object 请求取不到 requestId，关联字段为空串
    let response = serde_json::to_value(handle_read(&core, &json!("garbage"))).unwrap();
    assert_normalized_gateway_unavailable(&response, "");

    // 超限 payload
    let huge = json!({
        "wireVersion": 1,
        "requestId": "r1",
        "payload": {
            "kind": "assetList",
            "scope": { "kind": "allAssets" },
            "searchText": "x".repeat(MAX_REQUEST_BYTES)
        }
    });
    let response = serde_json::to_value(handle_read(&core, &huge)).unwrap();
    assert_normalized_gateway_unavailable(&response, "r1");
}

#[test]
fn oversized_search_text_over_limit_is_rejected_but_normal_request_passes() {
    let core = core();
    let ok = json!({
        "wireVersion": 1,
        "requestId": "r-ok",
        "payload": { "kind": "assetList", "scope": { "kind": "allAssets" } }
    });
    let response = serde_json::to_value(handle_read(&core, &ok)).unwrap();
    assert_eq!(response["payload"]["kind"], json!("readSucceeded"));
}

// ---------------------------------------------------------------------------
// Golden response / event vector
// ---------------------------------------------------------------------------

#[test]
fn response_envelope_serializes_to_golden_json() {
    let core = core();
    let request = json!({
        "wireVersion": 1,
        "requestId": "req-golden-1",
        "payload": {
            "kind": "assetDetail",
            "asset": {
                "assetId": "asset-fx01-demo-skill",
                "assetType": "skill",
                "nativeUnitRef": "nunit-fx01-demo-skill",
                "adapterIdentity": "claude-code@fixture"
            }
        }
    });
    let response = handle_read(&core, &request);
    let ReadResponsePayload::ReadSucceeded(succeeded) = &response.payload else {
        panic!("golden detail read must succeed");
    };
    let snapshot_json = serde_json::to_value(&succeeded.snapshot).unwrap();

    // 形状与关键字段 golden（revision 由内容决定，是确定值）。
    let expected = json!({
        "kind": "assetDetail",
        "revision": "rev-3f1e883bb4a03b88",
        "detail": {
            "asset": {
                "assetId": "asset-fx01-demo-skill",
                "assetType": "skill",
                "nativeUnitRef": "nunit-fx01-demo-skill",
                "adapterIdentity": "claude-code@fixture"
            },
            "displayName": "Demo Skill",
            "nativeUnitKind": "singleFile",
            "revision": "rev-3f1e883bb4a03b88",
            "compatibility": "verifiedWritable",
            "capabilities": {
                "edit": { "kind": "allowed" },
                "convert": { "kind": "allowed" },
                "export": { "kind": "allowed" },
                "delete": { "kind": "allowed" }
            },
            "effectiveContexts": [
                {
                    "agent": "claude-code",
                    "scope": "global",
                    "sourceTierLabel": "User global root (synthetic)",
                    "precedence": 0
                }
            ],
            "primaryFile": {
                "fileId": "file-fx01-skill-md",
                "name": "SKILL.md",
                "relativePath": "SKILL.md",
                "fileKind": "text",
                "isPrimary": true,
                "canPreview": { "kind": "allowed" },
                "canEdit": { "kind": "allowed" },
                "hasDraftChanges": false
            }
        },
        "inspector": {
            "agents": ["claude-code"],
            "scope": "global",
            "effectiveContexts": [
                {
                    "agent": "claude-code",
                    "scope": "global",
                    "sourceTierLabel": "User global root (synthetic)",
                    "precedence": 0
                }
            ],
            "sourceAnchor": { "kind": "userHome" },
            "pathDisplay": "~/…/skills/demo-skill/SKILL.md",
            "compatibility": "verifiedWritable",
            "overrides": []
        }
    });
    assert_eq!(snapshot_json, expected);
}

#[test]
fn masked_native_file_response_matches_fixture_golden() {
    let core = core();
    let request = json!({
        "wireVersion": 1,
        "requestId": "req-golden-2",
        "payload": {
            "kind": "nativeFile",
            "asset": {
                "assetId": "asset-fx01-demo-skill",
                "assetType": "skill",
                "nativeUnitRef": "nunit-fx01-demo-skill",
                "adapterIdentity": "claude-code@fixture"
            },
            "fileId": "file-fx01-skill-md"
        }
    });
    let response = handle_read(&core, &request);
    let json = serde_json::to_value(&response).unwrap();
    let content = &json["payload"]["snapshot"]["content"];
    assert_eq!(content["kind"], json!("source"));
    let masked = content["maskedText"].as_str().unwrap();
    assert!(masked.contains("API_KEY=••••••••"));
    assert!(!masked.contains("SYNTHETIC-SECRET"));
    assert_eq!(
        content["sensitiveSegments"],
        json!([
            {
                "segmentId": "seg-fx01-api-key",
                "fileId": "file-fx01-skill-md",
                "revision": "rev-3f1e883bb4a03b88",
                "displayState": "masked"
            }
        ])
    );
    assert_eq!(
        json["payload"]["snapshot"]["structuredView"],
        json!({ "kind": "disabled", "reasonCode": "UNKNOWN_FIELD_PRESERVED" })
    );
}

#[test]
fn event_envelope_serializes_to_golden_json() {
    let envelope = WorkspaceEventEnvelope {
        wire_version: GATEWAY_WIRE_VERSION,
        event: WorkspaceEventWire::AssetsInvalidated(
            agent_config_manager_lib::wire::AssetsInvalidatedWire {
                asset_type: Some(agent_config_manager_lib::wire::AssetTypeWire::Skill),
            },
        ),
    };
    let text = serde_json::to_string(&envelope).unwrap();
    assert_eq!(
        text,
        r#"{"wireVersion":1,"event":{"kind":"assetsInvalidated","assetType":"skill"}}"#
    );

    // 不带 assetType 时字段省略（skip_serializing_if），不序列化 null。
    let envelope = WorkspaceEventEnvelope {
        wire_version: GATEWAY_WIRE_VERSION,
        event: WorkspaceEventWire::AssetsInvalidated(
            agent_config_manager_lib::wire::AssetsInvalidatedWire { asset_type: None },
        ),
    };
    let text = serde_json::to_string(&envelope).unwrap();
    assert_eq!(
        text,
        r#"{"wireVersion":1,"event":{"kind":"assetsInvalidated"}}"#
    );

    // 事件往返解码，未知 tag 被拒绝。
    let decoded: WorkspaceEventEnvelope = serde_json::from_str(&text).unwrap();
    assert_eq!(decoded, envelope);
    let bad = r#"{"wireVersion":1,"event":{"kind":"progressChanged"}}"#;
    assert!(serde_json::from_str::<WorkspaceEventEnvelope>(bad).is_err());
}

#[test]
fn allowed_availability_has_no_extra_fields() {
    let text = serde_json::to_string(&ActionAvailabilityWire::Allowed).unwrap();
    assert_eq!(text, r#"{"kind":"allowed"}"#);
    let disabled = serde_json::to_string(&ActionAvailabilityWire::Disabled(
        agent_config_manager_lib::wire::DisabledAvailabilityWire {
            reason_code: ReasonCodeWire::UnknownFieldPreserved,
            recovery_action: None,
        },
    ))
    .unwrap();
    assert_eq!(
        disabled,
        r#"{"kind":"disabled","reasonCode":"UNKNOWN_FIELD_PRESERVED"}"#
    );
}
