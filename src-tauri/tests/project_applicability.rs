//! FE-07R L1：项目适用性 resolver 的只读、fail-closed 投影。

use std::fs;
use std::path::PathBuf;

use agent_config_manager_lib::adapter_registry::AdapterRegistry;
use agent_config_manager_lib::domain::{
    ApplicabilityResolution, ProjectApplicabilityQuery, ProjectApplicabilitySegmentKind,
    ProjectApplicabilityView, ReasonCode,
};
use agent_config_manager_lib::project_applicability::ProjectApplicabilityResolver;

fn resolver() -> ProjectApplicabilityResolver {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-19");
    ProjectApplicabilityResolver::new(AdapterRegistry::from_root(root))
}

fn resolver_from_fixture(root: PathBuf) -> ProjectApplicabilityResolver {
    ProjectApplicabilityResolver::new(AdapterRegistry::from_root(root))
}

fn copied_fx19_fixture() -> tempfile::TempDir {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/fx-19/fixture.json");
    let temp = tempfile::tempdir().expect("temporary FX-19 fixture root");
    fs::copy(fixture, temp.path().join("fixture.json")).expect("copy FX-19 fixture");
    temp
}

fn context<'a>(fixture: &'a mut serde_json::Value, project_id: &str) -> &'a mut serde_json::Value {
    fixture["contexts"]
        .as_array_mut()
        .expect("contexts array")
        .iter_mut()
        .find(|context| context["projectId"] == project_id)
        .expect("fixture context")
}

fn adapter_identity_drift(fixture: &mut serde_json::Value) {
    fixture["adapterRegistry"]["builtIn"]["adapter"]["identity"] =
        serde_json::json!("claude-code-drifted");
}

fn adapter_version_drift(fixture: &mut serde_json::Value) {
    fixture["adapterRegistry"]["builtIn"]["adapter"]["version"] = serde_json::json!("9.9.9");
}

fn active_package_identity_drift(fixture: &mut serde_json::Value) {
    fixture["adapterRegistry"]["activePackage"]["packageIdentity"] =
        serde_json::json!("fixture-adapter-package-drifted");
}

fn active_package_version_drift(fixture: &mut serde_json::Value) {
    fixture["adapterRegistry"]["activePackage"]["packageVersion"] = serde_json::json!("9.9.9");
}

fn rule_identity_drift(fixture: &mut serde_json::Value) {
    fixture["adapterRegistry"]["builtIn"]["rule"]["identity"] =
        serde_json::json!("claude-skill-rule-drifted");
}

fn rule_version_drift(fixture: &mut serde_json::Value) {
    fixture["adapterRegistry"]["builtIn"]["rule"]["version"] = serde_json::json!("9.9.9");
}

fn rule_source_drift(fixture: &mut serde_json::Value) {
    context(fixture, "project-same-b")["bound"]["rule"]["source"] = serde_json::json!({
        "kind": "activePackage",
        "packageIdentity": "fixture-adapter-package",
        "packageVersion": "2.1.0"
    });
}

fn authoritative_revision_drift(fixture: &mut serde_json::Value) {
    fixture["authoritativeReadRevision"] = serde_json::json!("rev-fx19-drifted");
}

#[test]
fn resolved_projection_is_stale_when_any_bound_provenance_or_revision_drifts() {
    type Mutate = fn(&mut serde_json::Value);
    let cases: [(&str, &str, Mutate); 8] = [
        ("adapter identity", "project-same-b", adapter_identity_drift),
        ("adapter version", "project-same-b", adapter_version_drift),
        (
            "active package identity",
            "project-same-a",
            active_package_identity_drift,
        ),
        (
            "active package version",
            "project-same-a",
            active_package_version_drift,
        ),
        ("rule identity", "project-same-b", rule_identity_drift),
        ("rule version", "project-same-b", rule_version_drift),
        ("rule source", "project-same-b", rule_source_drift),
        (
            "authoritative revision",
            "project-same-b",
            authoritative_revision_drift,
        ),
    ];

    for (label, project_id, mutate) in cases {
        let temp = copied_fx19_fixture();
        let fixture_path = temp.path().join("fixture.json");
        let mut fixture: serde_json::Value =
            serde_json::from_slice(&fs::read(&fixture_path).expect("read copied fixture"))
                .expect("fixture JSON");
        mutate(&mut fixture);
        fs::write(
            &fixture_path,
            serde_json::to_vec_pretty(&fixture).expect("serialize drift fixture"),
        )
        .expect("write drift fixture");

        let resolver = resolver_from_fixture(temp.path().to_path_buf());
        let project = resolver
            .read(&ProjectApplicabilityQuery {
                view: ProjectApplicabilityView::Project {
                    project_id: project_id.to_string(),
                },
            })
            .expect("drifted project remains readable");
        assert!(
            project
                .segments
                .iter()
                .all(|segment| segment.kind != ProjectApplicabilitySegmentKind::GlobalApplicable),
            "{label} drift must fail-closed for project projection"
        );

        for view in [
            ProjectApplicabilityView::All,
            ProjectApplicabilityView::Global,
        ] {
            let snapshot = resolver
                .read(&ProjectApplicabilityQuery { view })
                .expect("all/global drift finding remains readable");
            assert!(
                snapshot.findings.iter().any(|finding| {
                    finding.context.project_id == project_id
                        && finding.context.resolution == ApplicabilityResolution::Stale
                        && finding.context.reason_code == Some(ReasonCode::ExternalChange)
                }),
                "{label} drift must be inspectable as stale finding"
            );
        }
    }
}

#[test]
fn resolved_contexts_project_global_asset_but_unknown_blocked_and_stale_fail_closed() {
    let snapshot = resolver()
        .read(&ProjectApplicabilityQuery {
            view: ProjectApplicabilityView::Project {
                project_id: "project-same-b".to_string(),
            },
        })
        .expect("FX-19 resolved project must be readable");

    assert_eq!(snapshot.segments.len(), 2);
    assert!(snapshot
        .segments
        .iter()
        .any(|segment| segment.kind == ProjectApplicabilitySegmentKind::ProjectNative));
    let global = snapshot
        .segments
        .iter()
        .find(|segment| segment.kind == ProjectApplicabilitySegmentKind::GlobalApplicable)
        .expect("resolved context projects the global asset");
    assert_eq!(global.assets.len(), 1);
    assert_eq!(global.assets[0].asset.native_ownership.kind(), "global");

    for project_id in [
        "project-provenance-drift",
        "project-unknown",
        "project-blocked",
        "project-stale",
    ] {
        let snapshot = resolver()
            .read(&ProjectApplicabilityQuery {
                view: ProjectApplicabilityView::Project {
                    project_id: project_id.to_string(),
                },
            })
            .expect("known fixture project must be readable");
        assert!(snapshot
            .segments
            .iter()
            .all(|segment| segment.kind != ProjectApplicabilitySegmentKind::GlobalApplicable));
    }
}

#[test]
fn all_and_global_keep_non_resolved_contexts_as_findings_with_active_and_builtin_provenance() {
    let resolver = resolver();
    let all = resolver
        .read(&ProjectApplicabilityQuery {
            view: ProjectApplicabilityView::All,
        })
        .expect("all projection must be readable");
    let global = resolver
        .read(&ProjectApplicabilityQuery {
            view: ProjectApplicabilityView::Global,
        })
        .expect("global projection must be readable");

    for snapshot in [&all, &global] {
        assert_eq!(snapshot.findings.len(), 4);
        assert!(snapshot.findings.iter().any(|finding| {
            finding.context.resolution == ApplicabilityResolution::Unknown
                && finding.context.reason_code.is_some()
        }));
        assert!(snapshot.findings.iter().any(|finding| {
            finding.context.resolution == ApplicabilityResolution::Blocked
                && finding.context.reason_code.is_some()
        }));
        assert!(snapshot.findings.iter().any(|finding| {
            finding.context.resolution == ApplicabilityResolution::Stale
                && finding.context.reason_code.is_some()
        }));
        assert!(snapshot.findings.iter().any(|finding| {
            finding.context.project_id == "project-provenance-drift"
                && finding.context.resolution == ApplicabilityResolution::Stale
                && finding.context.reason_code == Some(ReasonCode::ExternalChange)
        }));
    }

    assert!(all
        .effective_contexts
        .iter()
        .any(|context| context.adapter.source.kind() == "builtIn"));
    assert!(all
        .effective_contexts
        .iter()
        .any(|context| context.adapter.source.kind() == "activePackage"));
}

#[test]
fn fx19_query_bound_identity_provenance_reasons_and_segment_order_are_stable() {
    let resolver = resolver();
    let all = resolver
        .read(&ProjectApplicabilityQuery {
            view: ProjectApplicabilityView::All,
        })
        .expect("FX-19 all projection must be readable");
    let global = resolver
        .read(&ProjectApplicabilityQuery {
            view: ProjectApplicabilityView::Global,
        })
        .expect("FX-19 global projection must be readable");
    let same_a = resolver
        .read(&ProjectApplicabilityQuery {
            view: ProjectApplicabilityView::Project {
                project_id: "project-same-a".to_string(),
            },
        })
        .expect("first same-name project must be readable");
    let same_b = resolver
        .read(&ProjectApplicabilityQuery {
            view: ProjectApplicabilityView::Project {
                project_id: "project-same-b".to_string(),
            },
        })
        .expect("second same-name project must be readable");

    assert_eq!(all.authoritative_read_revision, "rev-fx19-20260810");
    assert_eq!(
        all.segments
            .iter()
            .map(|segment| segment.id.as_str())
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
        global
            .segments
            .iter()
            .map(|segment| segment.kind)
            .collect::<Vec<_>>(),
        vec![ProjectApplicabilitySegmentKind::GlobalApplicable]
    );
    for (snapshot, project_id) in [(&same_a, "project-same-a"), (&same_b, "project-same-b")] {
        assert_eq!(
            snapshot
                .segments
                .iter()
                .map(|segment| segment.kind)
                .collect::<Vec<_>>(),
            vec![
                ProjectApplicabilitySegmentKind::ProjectNative,
                ProjectApplicabilitySegmentKind::GlobalApplicable,
            ]
        );
        assert_eq!(snapshot.segments[0].project_id.as_deref(), Some(project_id));
        assert_eq!(
            snapshot.segments[0].assets[0].asset.native_ownership,
            agent_config_manager_lib::domain::NativeOwnership::Project {
                project_id: project_id.to_string(),
            }
        );
    }
    assert_eq!(
        same_a.segments[0].display_label,
        same_b.segments[0].display_label
    );
    assert_ne!(same_a.segments[0].id, same_b.segments[0].id);

    let active = all
        .effective_contexts
        .iter()
        .find(|context| context.project_id == "project-same-a")
        .expect("FX-19 active package context must be present");
    assert_eq!(active.adapter.identity, "claude-code");
    assert_eq!(active.adapter.version, "2.1.0");
    assert_eq!(active.adapter.source.kind(), "activePackage");
    assert_eq!(active.rule.identity, "claude-skill-rule");
    assert_eq!(active.rule.version, "2.1.0");
    assert_eq!(active.rule.source.kind(), "activePackage");

    let built_in = all
        .effective_contexts
        .iter()
        .find(|context| context.project_id == "project-same-b")
        .expect("FX-19 built-in context must be present");
    assert_eq!(built_in.adapter.identity, "claude-code");
    assert_eq!(built_in.adapter.version, "1.0.0");
    assert_eq!(built_in.adapter.source.kind(), "builtIn");
    assert_eq!(built_in.rule.identity, "claude-skill-rule");
    assert_eq!(built_in.rule.version, "1.0.0");
    assert_eq!(built_in.rule.source.kind(), "builtIn");

    let expected_findings = [
        (
            "project-provenance-drift",
            ApplicabilityResolution::Stale,
            ReasonCode::ExternalChange,
        ),
        (
            "project-unknown",
            ApplicabilityResolution::Unknown,
            ReasonCode::UnknownAgentVersion,
        ),
        (
            "project-blocked",
            ApplicabilityResolution::Blocked,
            ReasonCode::PermissionDenied,
        ),
        (
            "project-stale",
            ApplicabilityResolution::Stale,
            ReasonCode::ExternalChange,
        ),
    ];
    for snapshot in [&all, &global] {
        assert_eq!(
            snapshot
                .findings
                .iter()
                .map(|finding| {
                    (
                        finding.context.project_id.as_str(),
                        finding.context.resolution,
                        finding.context.reason_code,
                    )
                })
                .collect::<Vec<_>>(),
            expected_findings
                .iter()
                .map(|(project_id, resolution, reason)| {
                    (*project_id, *resolution, Some(*reason))
                })
                .collect::<Vec<_>>()
        );
    }
}
