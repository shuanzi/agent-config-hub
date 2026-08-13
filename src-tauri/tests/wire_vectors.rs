//! L1：wire 双向契约向量（ARC-06c）。
//!
//! - 合法 request vector 解码成功；
//! - 未知 tag、未知字段、缺失字段、错误 wireVersion、超限 payload 均被拒绝；
//! - response/event 序列化与 golden JSON 逐字节一致；
//! - 负向结果归一化为 GATEWAY_UNAVAILABLE，且不携带异常字符串。

use std::path::PathBuf;

use agent_config_manager_lib::adapter_registry::AdapterRegistry;
use agent_config_manager_lib::catalog::Catalog;
use agent_config_manager_lib::core::GatewayCore;
use agent_config_manager_lib::domain::{
    AgentId, ApplicabilityResolution, ReasonCode, SkillActivation, SkillCellAvailability,
    SkillPresence, SkillTargetState,
};
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

fn fx19_core() -> GatewayCore {
    GatewayCore::with_adapter_registry(
        Catalog::new(None),
        AdapterRegistry::from_root(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-19"),
        ),
    )
}

fn skill_state(
    presence: SkillPresence,
    activation: SkillActivation,
    applicability: ApplicabilityResolution,
    enable_availability: SkillCellAvailability,
    disable_availability: SkillCellAvailability,
) -> SkillTargetState {
    SkillTargetState {
        agent: AgentId::ClaudeCode,
        presence,
        activation,
        applicability,
        enable_availability,
        disable_availability,
        pending: None,
        stable_reason: None,
    }
}

fn unavailable() -> SkillCellAvailability {
    SkillCellAvailability::Disabled {
        reason_code: ReasonCode::ReadOnlyPolicy,
    }
}

#[test]
fn skill_cell_wire_domain_semantics_reject_contradictory_presence_activation_and_availability() {
    let valid = [
        skill_state(
            SkillPresence::Absent,
            SkillActivation::NotApplicable,
            ApplicabilityResolution::Resolved,
            SkillCellAvailability::Allowed,
            unavailable(),
        ),
        skill_state(
            SkillPresence::Present,
            SkillActivation::Enabled,
            ApplicabilityResolution::Resolved,
            unavailable(),
            SkillCellAvailability::Allowed,
        ),
        skill_state(
            SkillPresence::Present,
            SkillActivation::Disabled,
            ApplicabilityResolution::Resolved,
            SkillCellAvailability::Allowed,
            unavailable(),
        ),
        skill_state(
            SkillPresence::Unknown,
            SkillActivation::Unknown,
            ApplicabilityResolution::Unknown,
            unavailable(),
            unavailable(),
        ),
    ];
    assert!(valid.iter().all(SkillTargetState::is_semantically_valid));

    let invalid = [
        // absent iff notApplicable; present iff enabled/disabled.
        skill_state(
            SkillPresence::Absent,
            SkillActivation::Enabled,
            ApplicabilityResolution::Resolved,
            unavailable(),
            unavailable(),
        ),
        skill_state(
            SkillPresence::Present,
            SkillActivation::NotApplicable,
            ApplicabilityResolution::Resolved,
            unavailable(),
            unavailable(),
        ),
        // absent/disabled/enabled action availability contradictions.
        skill_state(
            SkillPresence::Absent,
            SkillActivation::NotApplicable,
            ApplicabilityResolution::Resolved,
            unavailable(),
            SkillCellAvailability::Allowed,
        ),
        skill_state(
            SkillPresence::Present,
            SkillActivation::Disabled,
            ApplicabilityResolution::Resolved,
            unavailable(),
            SkillCellAvailability::Allowed,
        ),
        skill_state(
            SkillPresence::Present,
            SkillActivation::Enabled,
            ApplicabilityResolution::Resolved,
            SkillCellAvailability::Allowed,
            unavailable(),
        ),
        // Any uncertainty makes both availability facts unavailable.
        skill_state(
            SkillPresence::Unknown,
            SkillActivation::Unknown,
            ApplicabilityResolution::Unknown,
            SkillCellAvailability::Allowed,
            unavailable(),
        ),
        skill_state(
            SkillPresence::Present,
            SkillActivation::Disabled,
            ApplicabilityResolution::Stale,
            SkillCellAvailability::Allowed,
            unavailable(),
        ),
    ];
    assert!(invalid.iter().all(|state| !state.is_semantically_valid()));
}

// ---------------------------------------------------------------------------
// 正向 request vector
// ---------------------------------------------------------------------------

#[test]
fn valid_request_vectors_decode() {
    let vectors = [
        json!({
            "wireVersion": 3,
            "requestId": "req-list-1",
            "payload": { "kind": "assetList", "scope": { "kind": "allAssets" } }
        }),
        json!({
            "wireVersion": 3,
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
            "wireVersion": 3,
            "requestId": "req-detail-1",
            "payload": {
                "kind": "assetDetail",
                "asset": {
                    "assetId": "asset-fx01-demo-skill",
                    "assetType": "skill",
                    "nativeUnitRef": "nunit-fx01-demo-skill",
                    "adapterIdentity": "claude-code@fixture",
                    "nativeOwnership": { "kind": "global" }
                }
            }
        }),
        json!({
            "wireVersion": 3,
            "requestId": "req-file-1",
            "payload": {
                "kind": "nativeFile",
                "asset": {
                    "assetId": "asset-fx01-demo-skill",
                    "assetType": "skill",
                    "nativeUnitRef": "nunit-fx01-demo-skill",
                    "adapterIdentity": "claude-code@fixture",
                    "nativeOwnership": { "kind": "global" }
                },
                "fileId": "file-fx01-skill-md"
            }
        }),
        json!({
            "wireVersion": 3,
            "requestId": "req-fx19-project",
            "payload": {
                "kind": "projectApplicability",
                "view": { "kind": "project", "projectId": "project-same-b" }
            }
        }),
        json!({
            "wireVersion": 3,
            "requestId": "req-workbench",
            "payload": {
                "kind": "workbench",
                "assetType": "skill",
                "viewContext": { "kind": "all" },
                "filters": { "agents": ["claude-code"], "statuses": ["editable"] }
            }
        }),
        json!({
            "wireVersion": 3,
            "requestId": "req-locator",
            "payload": {
                "kind": "globalLocator",
                "searchText": "demo",
                "assetTypes": ["skill", "longTermInstruction", "subagent"]
            }
        }),
    ];
    for vector in vectors {
        let envelope: ReadRequestEnvelope =
            serde_json::from_value(vector).expect("valid vector must decode");
        assert_eq!(envelope.wire_version, GATEWAY_WIRE_VERSION);
    }
}

#[test]
fn workbench_and_locator_are_read_only_wire_variants() {
    let workbench = json!({
        "wireVersion": GATEWAY_WIRE_VERSION,
        "requestId": "req-workbench-read",
        "payload": {
            "kind": "workbench",
            "assetType": "skill",
            "viewContext": { "kind": "all" }
        }
    });
    let response = serde_json::to_value(handle_read(&core(), &workbench)).unwrap();
    assert_eq!(response["payload"]["kind"], json!("readSucceeded"));
    let snapshot = &response["payload"]["snapshot"];
    assert_eq!(snapshot["kind"], json!("workbench"));
    assert_eq!(snapshot["segments"][0]["source"], json!("globalApplicable"));
    assert_eq!(
        snapshot["segments"][0]["rows"][0]["statusMemberships"],
        json!(["editable", "normal"])
    );
    assert_eq!(
        snapshot["segments"][0]["rows"][0]["skillTargetStates"]
            .as_array()
            .unwrap()
            .len(),
        4
    );

    let locator = json!({
        "wireVersion": GATEWAY_WIRE_VERSION,
        "requestId": "req-locator-read",
        "payload": {
            "kind": "globalLocator",
            "searchText": "demo",
            "assetTypes": ["skill", "longTermInstruction", "subagent"]
        }
    });
    let response = serde_json::to_value(handle_read(&core(), &locator)).unwrap();
    assert_eq!(
        response["payload"]["snapshot"]["kind"],
        json!("globalLocator")
    );
    assert_eq!(
        response["payload"]["snapshot"]["groups"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let result = &response["payload"]["snapshot"]["groups"][0]["results"][0];
    assert_eq!(result["matchedField"], json!("displayName"));
    assert_eq!(result["destination"]["kind"], json!("skillDetail"));
    assert_eq!(
        result["destination"]["assetRef"],
        result["row"]["summary"]["asset"]
    );

    let fx19_workbench = json!({
        "wireVersion": GATEWAY_WIRE_VERSION,
        "requestId": "req-workbench-fx19",
        "payload": {
            "kind": "workbench",
            "assetType": "skill",
            "viewContext": { "kind": "all" }
        }
    });
    let response = serde_json::to_value(handle_read(&fx19_core(), &fx19_workbench)).unwrap();
    let snapshot = &response["payload"]["snapshot"];
    assert_eq!(snapshot["kind"], json!("workbench"));
    assert!(snapshot["effectiveContexts"].as_array().unwrap().len() >= 2);
    assert!(!snapshot["findings"].as_array().unwrap().is_empty());
    assert_eq!(snapshot["segments"][0]["source"], json!("globalApplicable"));
    // FE-07R 的 summary seam 未带 edit-specific/compatibility facts；绝不从其
    // generic availability 猜测 status membership。
    assert_eq!(
        snapshot["segments"][0]["rows"][0]["statusMemberships"],
        json!([])
    );

    let fx19_locator = json!({
        "wireVersion": GATEWAY_WIRE_VERSION,
        "requestId": "req-locator-fx19",
        "payload": {
            "kind": "globalLocator",
            "searchText": "FX-19 global",
            "assetTypes": ["skill", "longTermInstruction", "subagent"]
        }
    });
    let locator_response = serde_json::to_value(handle_read(&fx19_core(), &fx19_locator)).unwrap();
    let locator_result = &locator_response["payload"]["snapshot"]["groups"][0]["results"][0];
    assert_eq!(
        locator_result["row"]["summary"]["asset"],
        snapshot["segments"][0]["rows"][0]["summary"]["asset"],
        "configured registry locator must use the same resolver actual-read universe"
    );
    assert_eq!(locator_result["destination"]["kind"], json!("skillDetail"));
    assert_eq!(
        locator_result["destination"]["assetRef"],
        locator_result["row"]["summary"]["asset"]
    );
    assert_eq!(
        locator_result["row"]["redactedSummary"],
        json!("结构化只读 Skill 摘要"),
        "FE-07R actual locator must export the safe, redacted display summary"
    );
}

#[test]
fn workbench_rejects_invalid_project_filter_and_echoes_canonical_filters() {
    let invalid = json!({
        "wireVersion": GATEWAY_WIRE_VERSION,
        "requestId": "req-workbench-invalid-filter",
        "payload": {
            "kind": "workbench",
            "assetType": "skill",
            "viewContext": { "kind": "project", "projectId": "project-same-a" },
            "filters": { "projectIds": ["project-same-a"] }
        }
    });
    let response = serde_json::to_value(handle_read(&fx19_core(), &invalid)).unwrap();
    assert_eq!(response["payload"]["kind"], json!("readFailed"));
    assert_eq!(response["payload"]["reasonCode"], json!("READ_FAILED"));

    let canonical = json!({
        "wireVersion": GATEWAY_WIRE_VERSION,
        "requestId": "req-workbench-canonical-filter",
        "payload": {
            "kind": "workbench",
            "assetType": "skill",
            "viewContext": { "kind": "all" },
            "filters": {
                "agents": ["opencode", "claude-code", "opencode"],
                "sourceIds": ["z", "a", "a"],
                "statuses": ["drift", "editable", "drift"]
            }
        }
    });
    let response = serde_json::to_value(handle_read(&fx19_core(), &canonical)).unwrap();
    let filters = &response["payload"]["snapshot"]["query"]["filters"];
    assert_eq!(filters["agents"], json!(["claude-code", "opencode"]));
    assert_eq!(filters["sourceIds"], json!(["a", "z"]));
    assert_eq!(filters["statuses"], json!(["editable", "drift"]));
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
        // project view 的 opaque identity shape 不可扩展
        json!({
            "wireVersion": 3, "requestId": "r",
            "payload": {
                "kind": "projectApplicability",
                "view": { "kind": "project", "projectId": "project-same-b", "bogus": true }
            }
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
        // breaking bump 的精确前一版 V2：ingress 不协商、不 fallback。
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
        "wireVersion": 3,
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
        "wireVersion": 3,
        "requestId": "r-ok",
        "payload": { "kind": "assetList", "scope": { "kind": "allAssets" } }
    });
    let response = serde_json::to_value(handle_read(&core, &ok)).unwrap();
    assert_eq!(response["payload"]["kind"], json!("readSucceeded"));
}

#[test]
fn fx19_projection_round_trips_through_gateway_core_wire() {
    let request = json!({
        "wireVersion": GATEWAY_WIRE_VERSION,
        "requestId": "req-fx19-core",
        "payload": {
            "kind": "projectApplicability",
            "view": { "kind": "project", "projectId": "project-same-b" }
        }
    });
    let response = serde_json::to_value(handle_read(&fx19_core(), &request)).unwrap();
    assert_eq!(response["payload"]["kind"], json!("readSucceeded"));
    let snapshot = &response["payload"]["snapshot"];
    assert_eq!(snapshot["kind"], json!("projectApplicability"));
    assert_eq!(snapshot["segments"][1]["kind"], json!("globalApplicable"));
    assert_eq!(
        snapshot["segments"][1]["assets"][0]["asset"]["nativeOwnership"],
        json!({ "kind": "global" })
    );
}

#[test]
fn fx19_all_projection_wire_keeps_registry_provenance_and_stable_findings() {
    let request = json!({
        "wireVersion": GATEWAY_WIRE_VERSION,
        "requestId": "req-fx19-all",
        "payload": {
            "kind": "projectApplicability",
            "view": { "kind": "all" }
        }
    });
    let response = serde_json::to_value(handle_read(&fx19_core(), &request)).unwrap();
    let snapshot = &response["payload"]["snapshot"];
    assert_eq!(
        snapshot["authoritativeReadRevision"],
        json!("rev-fx19-20260810")
    );
    assert_eq!(
        snapshot["segments"]
            .as_array()
            .expect("wire segments must be an array")
            .iter()
            .map(|segment| segment["id"].as_str().expect("wire segment id"))
            .collect::<Vec<_>>(),
        vec![
            "segment-fx19-global-applicable",
            "segment-fx19-project-native-project-blocked",
            "segment-fx19-project-native-project-provenance-drift",
            "segment-fx19-project-native-project-same-a",
            "segment-fx19-project-native-project-same-b",
            "segment-fx19-project-native-project-stale",
            "segment-fx19-project-native-project-unknown",
        ]
    );
    assert_eq!(
        snapshot["effectiveContexts"]
            .as_array()
            .expect("wire contexts must be an array")
            .iter()
            .find(|context| context["projectId"] == "project-same-a")
            .expect("active-package context")["adapter"],
        json!({
            "identity": "claude-code",
            "version": "2.1.0",
            "source": {
                "kind": "activePackage",
                "packageIdentity": "fixture-adapter-package",
                "packageVersion": "2.1.0"
            }
        })
    );
    assert_eq!(
        snapshot["effectiveContexts"]
            .as_array()
            .expect("wire contexts must be an array")
            .iter()
            .find(|context| context["projectId"] == "project-same-b")
            .expect("built-in context")["rule"],
        json!({
            "identity": "claude-skill-rule",
            "version": "1.0.0",
            "source": { "kind": "builtIn" }
        })
    );
    assert_eq!(
        snapshot["findings"],
        json!([
            {
                "asset": snapshot["findings"][0]["asset"],
                "context": {
                    "asset": snapshot["findings"][0]["context"]["asset"],
                    "projectId": "project-provenance-drift",
                    "projectDisplayName": "Drifted project",
                    "adapter": {
                        "identity": "claude-code",
                        "version": "1.0.0",
                        "source": { "kind": "builtIn" }
                    },
                    "rule": {
                        "identity": "claude-skill-rule",
                        "version": "1.0.0",
                        "source": { "kind": "builtIn" }
                    },
                    "authoritativeReadRevision": "rev-fx19-20260810",
                    "sourceTierId": "source-fx19-global",
                    "loadOrder": 25,
                    "priority": 20,
                    "resolution": "stale",
                    "reasonCode": "EXTERNAL_CHANGE"
                }
            },
            {
                "asset": snapshot["findings"][1]["asset"],
                "context": {
                    "asset": snapshot["findings"][1]["context"]["asset"],
                    "projectId": "project-unknown",
                    "projectDisplayName": "Unknown project",
                    "adapter": {
                        "identity": "claude-code",
                        "version": "2.1.0",
                        "source": {
                            "kind": "activePackage",
                            "packageIdentity": "fixture-adapter-package",
                            "packageVersion": "2.1.0"
                        }
                    },
                    "rule": {
                        "identity": "claude-skill-rule",
                        "version": "2.1.0",
                        "source": {
                            "kind": "activePackage",
                            "packageIdentity": "fixture-adapter-package",
                            "packageVersion": "2.1.0"
                        }
                    },
                    "authoritativeReadRevision": "rev-fx19-20260810",
                    "sourceTierId": "source-fx19-global",
                    "loadOrder": 30,
                    "priority": 10,
                    "resolution": "unknown",
                    "reasonCode": "UNKNOWN_AGENT_VERSION"
                }
            },
            {
                "asset": snapshot["findings"][2]["asset"],
                "context": {
                    "asset": snapshot["findings"][2]["context"]["asset"],
                    "projectId": "project-blocked",
                    "projectDisplayName": "Blocked project",
                    "adapter": {
                        "identity": "claude-code",
                        "version": "1.0.0",
                        "source": { "kind": "builtIn" }
                    },
                    "rule": {
                        "identity": "claude-skill-rule",
                        "version": "1.0.0",
                        "source": { "kind": "builtIn" }
                    },
                    "authoritativeReadRevision": "rev-fx19-20260810",
                    "sourceTierId": "source-fx19-global",
                    "loadOrder": 40,
                    "priority": 10,
                    "resolution": "blocked",
                    "reasonCode": "PERMISSION_DENIED"
                }
            },
            {
                "asset": snapshot["findings"][3]["asset"],
                "context": {
                    "asset": snapshot["findings"][3]["context"]["asset"],
                    "projectId": "project-stale",
                    "projectDisplayName": "Stale project",
                    "adapter": {
                        "identity": "claude-code",
                        "version": "2.1.0",
                        "source": {
                            "kind": "activePackage",
                            "packageIdentity": "fixture-adapter-package",
                            "packageVersion": "2.1.0"
                        }
                    },
                    "rule": {
                        "identity": "claude-skill-rule",
                        "version": "2.1.0",
                        "source": {
                            "kind": "activePackage",
                            "packageIdentity": "fixture-adapter-package",
                            "packageVersion": "2.1.0"
                        }
                    },
                    "authoritativeReadRevision": "rev-fx19-20260810",
                    "sourceTierId": "source-fx19-global",
                    "loadOrder": 50,
                    "priority": 10,
                    "resolution": "stale",
                    "reasonCode": "EXTERNAL_CHANGE"
                }
            }
        ])
    );
}

// ---------------------------------------------------------------------------
// Golden response / event vector
// ---------------------------------------------------------------------------

#[test]
fn response_envelope_serializes_to_golden_json() {
    let core = core();
    let request = json!({
        "wireVersion": 3,
        "requestId": "req-golden-1",
        "payload": {
            "kind": "assetDetail",
            "asset": {
                "assetId": "asset-fx01-demo-skill",
                "assetType": "skill",
                "nativeUnitRef": "nunit-fx01-demo-skill",
                "adapterIdentity": "claude-code@fixture",
                "nativeOwnership": { "kind": "global" }
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
                "adapterIdentity": "claude-code@fixture",
                "nativeOwnership": { "kind": "global" }
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
        "wireVersion": 3,
        "requestId": "req-golden-2",
        "payload": {
            "kind": "nativeFile",
            "asset": {
                "assetId": "asset-fx01-demo-skill",
                "assetType": "skill",
                "nativeUnitRef": "nunit-fx01-demo-skill",
                "adapterIdentity": "claude-code@fixture",
                "nativeOwnership": { "kind": "global" }
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
        r#"{"wireVersion":3,"event":{"kind":"assetsInvalidated","assetType":"skill"}}"#
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
        r#"{"wireVersion":3,"event":{"kind":"assetsInvalidated"}}"#
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
