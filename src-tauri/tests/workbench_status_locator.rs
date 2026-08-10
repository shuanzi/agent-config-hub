use agent_config_manager_lib::catalog::{locator_match_field, LocatorDisplayFields};
use agent_config_manager_lib::domain::{
    derive_workbench_status_memberships, ActionAvailability, AssetCapabilities, AssetStatusFilter,
    CompatibilityStatus, ReasonCode, WorkbenchStatusFacts,
};

fn disabled() -> ActionAvailability {
    ActionAvailability::Disabled {
        reason_code: ReasonCode::ReadOnlyPolicy,
        recovery_action: None,
    }
}

#[test]
fn workbench_status_membership_requires_exact_edit_and_compatibility_facts() {
    assert_eq!(
        derive_workbench_status_memberships(&WorkbenchStatusFacts {
            edit_asset_availability: Some(ActionAvailability::Allowed),
            compatibility: Some(CompatibilityStatus::VerifiedWritable),
            normal: Some(true),
            ..Default::default()
        }),
        vec![AssetStatusFilter::Editable, AssetStatusFilter::Normal]
    );

    // 真实 AssetCapabilities 中 export/delete/convert 全部 allowed 也不能替代
    // edit-specific availability；derive 只接收 edit 字段。
    let detail_capabilities = AssetCapabilities {
        edit: disabled(),
        convert: ActionAvailability::Allowed,
        export: ActionAvailability::Allowed,
        delete: ActionAvailability::Allowed,
    };
    assert_eq!(
        derive_workbench_status_memberships(&WorkbenchStatusFacts {
            edit_asset_availability: Some(detail_capabilities.edit.clone()),
            compatibility: Some(CompatibilityStatus::VerifiedWritable),
            normal: Some(true),
            ..Default::default()
        }),
        vec![AssetStatusFilter::Normal]
    );
    assert_eq!(
        derive_workbench_status_memberships(&WorkbenchStatusFacts {
            compatibility: Some(CompatibilityStatus::RecognizedReadOnly),
            ..Default::default()
        }),
        vec![AssetStatusFilter::ReadOnly]
    );
    assert_eq!(
        derive_workbench_status_memberships(&WorkbenchStatusFacts {
            compatibility: Some(CompatibilityStatus::IncompatibleBlocked),
            ..Default::default()
        }),
        vec![AssetStatusFilter::Incompatible]
    );
    assert!(derive_workbench_status_memberships(&WorkbenchStatusFacts::default()).is_empty());
}

#[test]
fn locator_matches_only_visible_masked_fields_with_nfc_full_casefold_and_codepoint_substrings() {
    let fields = LocatorDisplayFields {
        display_name: "Café Straße".to_string(),
        asset_type_label: "Skill".to_string(),
        agents: vec!["Claude-Code".to_string()],
        ownership: "Global".to_string(),
        project_hint: Some("Projet Café".to_string()),
        redacted_summary: Some("credential •••••••• visible metadata".to_string()),
    };

    // NFC 等价（分解 e + acute）和 trim 都适用。
    assert_eq!(
        locator_match_field("  cafe\u{301}  ", &fields),
        Some("displayName")
    );
    // full non-Turkic case-fold expansion: Straße → strasse。
    assert_eq!(locator_match_field("STRASSE", &fields), Some("displayName"));
    // code-point substring，不按 byte offset 切片。
    assert_eq!(locator_match_field("é S", &fields), Some("displayName"));
    assert_eq!(locator_match_field("skill", &fields), Some("assetType"));
    assert_eq!(locator_match_field("claude", &fields), Some("agent"));
    assert_eq!(locator_match_field("global", &fields), Some("ownership"));
    assert_eq!(locator_match_field("projet", &fields), Some("projectHint"));
    assert_eq!(
        locator_match_field("••••", &fields),
        Some("redactedSummary")
    );
    assert_eq!(locator_match_field("SYNTHETIC-SECRET", &fields), None);
}
