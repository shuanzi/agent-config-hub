//! FE-07R 的只读 ProjectApplicabilityResolver。

use crate::adapter_registry::{
    AdapterRegistry, AdapterRegistrySnapshot, FixtureContext, RegistrySource,
};
use crate::catalog::now_iso8601;
use crate::domain::{
    ActionAvailability, AdapterProvenance, ApplicabilityFinding, ApplicabilityResolution,
    AssetContextHint, AssetRef, AssetScope, AssetSummary, AssetType, EffectiveProjectContext,
    NativeOwnership, ProjectApplicabilityQuery, ProjectApplicabilitySegment,
    ProjectApplicabilitySegmentKind, ProjectApplicabilitySnapshot, ProjectApplicabilityView,
    ReadFailure, ReasonCode, RuleProvenance, SourceTier,
};

pub struct ProjectApplicabilityResolver {
    registry: AdapterRegistry,
}

impl ProjectApplicabilityResolver {
    pub fn new(registry: AdapterRegistry) -> Self {
        Self { registry }
    }

    pub fn read(
        &self,
        query: &ProjectApplicabilityQuery,
    ) -> Result<ProjectApplicabilitySnapshot, ReadFailure> {
        let registry = self.registry.read().map_err(|_| read_failed())?;
        let contexts = registry
            .contexts
            .iter()
            .map(|context| effective_context(&registry, context))
            .collect::<Result<Vec<_>, _>>()?;

        let selected_project = match &query.view {
            ProjectApplicabilityView::Project { project_id } => {
                if project_id.trim().is_empty()
                    || !registry
                        .projects
                        .iter()
                        .any(|project| project.project_id == *project_id)
                {
                    return Err(read_failed());
                }
                Some(project_id.as_str())
            }
            ProjectApplicabilityView::All | ProjectApplicabilityView::Global => None,
        };
        let global_asset = global_summary(&registry);
        let selected_contexts: Vec<_> = match selected_project {
            Some(project_id) => contexts
                .iter()
                .filter(|context| context.project_id == project_id)
                .cloned()
                .collect(),
            None => contexts.clone(),
        };
        let findings = if matches!(
            query.view,
            ProjectApplicabilityView::All | ProjectApplicabilityView::Global
        ) {
            selected_contexts
                .iter()
                .filter(|context| context.resolution != ApplicabilityResolution::Resolved)
                .cloned()
                .map(|context| ApplicabilityFinding {
                    asset: global_asset.asset.clone(),
                    context,
                })
                .collect()
        } else {
            Vec::new()
        };

        let mut segments = Vec::new();
        match &query.view {
            ProjectApplicabilityView::All => {
                segments.push(global_segment(&global_asset));
                let mut projects = registry.projects.clone();
                projects.sort_by(|left, right| {
                    left.display_name
                        .cmp(&right.display_name)
                        .then_with(|| left.project_id.as_bytes().cmp(right.project_id.as_bytes()))
                });
                for project in projects {
                    segments.push(project_native_segment(&registry, &project.project_id)?);
                }
            }
            ProjectApplicabilityView::Global => segments.push(global_segment(&global_asset)),
            ProjectApplicabilityView::Project { project_id } => {
                segments.push(project_native_segment(&registry, project_id)?);
                if selected_contexts
                    .iter()
                    .any(|context| context.resolution == ApplicabilityResolution::Resolved)
                {
                    segments.push(global_segment(&global_asset));
                }
            }
        }
        let aggregate_total = segments
            .iter()
            .map(|segment| segment.assets.len() as u32)
            .sum();
        Ok(ProjectApplicabilitySnapshot {
            query: query.clone(),
            authoritative_read_revision: registry.authoritative_read_revision,
            segments,
            findings,
            effective_contexts: selected_contexts,
            aggregate_total,
            read_at: now_iso8601(),
        })
    }
}

fn read_failed() -> ReadFailure {
    ReadFailure {
        reason_code: ReasonCode::ReadFailed,
        message: "项目适用性事实当前不可读，请重读。".to_string(),
        recovery_action: Some(crate::domain::RecoveryAction::RetryRead),
    }
}

fn provenance_adapter(
    registry: &AdapterRegistrySnapshot,
    source: RegistrySource,
) -> AdapterProvenance {
    match source {
        RegistrySource::BuiltIn => registry.built_in_adapter.clone(),
        RegistrySource::ActivePackage => registry.active_adapter.clone(),
    }
}

fn provenance_rule(registry: &AdapterRegistrySnapshot, source: RegistrySource) -> RuleProvenance {
    match source {
        RegistrySource::BuiltIn => registry.built_in_rule.clone(),
        RegistrySource::ActivePackage => registry.active_rule.clone(),
    }
}

fn resolution(value: &str) -> Result<ApplicabilityResolution, ReadFailure> {
    match value {
        "resolved" => Ok(ApplicabilityResolution::Resolved),
        "unknown" => Ok(ApplicabilityResolution::Unknown),
        "blocked" => Ok(ApplicabilityResolution::Blocked),
        "stale" => Ok(ApplicabilityResolution::Stale),
        _ => Err(read_failed()),
    }
}

fn reason_code(value: Option<&str>) -> Result<Option<ReasonCode>, ReadFailure> {
    let code = match value {
        None => return Ok(None),
        Some("UNKNOWN_AGENT_VERSION") => ReasonCode::UnknownAgentVersion,
        Some("PERMISSION_DENIED") => ReasonCode::PermissionDenied,
        Some("EXTERNAL_CHANGE") => ReasonCode::ExternalChange,
        _ => return Err(read_failed()),
    };
    Ok(Some(code))
}

fn effective_context(
    registry: &AdapterRegistrySnapshot,
    context: &FixtureContext,
) -> Result<EffectiveProjectContext, ReadFailure> {
    let project = registry
        .projects
        .iter()
        .find(|project| project.project_id == context.project_id)
        .ok_or_else(read_failed)?;
    let declared_resolution = resolution(&context.resolution)?;
    let declared_reason_code = reason_code(context.reason_code.as_deref())?;
    if (declared_resolution == ApplicabilityResolution::Resolved) != declared_reason_code.is_none()
    {
        return Err(read_failed());
    }
    let adapter = provenance_adapter(registry, context.adapter);
    let rule = provenance_rule(registry, context.rule);
    let binding_matches = adapter == context.bound_adapter
        && rule == context.bound_rule
        && registry.authoritative_read_revision == context.bound_authoritative_read_revision;
    let (resolution, reason_code) =
        if declared_resolution == ApplicabilityResolution::Resolved && !binding_matches {
            (
                ApplicabilityResolution::Stale,
                Some(ReasonCode::ExternalChange),
            )
        } else {
            (declared_resolution, declared_reason_code)
        };
    Ok(EffectiveProjectContext {
        asset: global_summary(registry).asset,
        project_id: project.project_id.clone(),
        project_display_name: project.display_name.clone(),
        adapter,
        rule,
        authoritative_read_revision: registry.authoritative_read_revision.clone(),
        source_tier_id: registry.global_asset.source_tier_id.clone(),
        load_order: context.load_order,
        priority: context.priority,
        override_relation: None,
        resolution,
        reason_code,
    })
}

fn global_summary(registry: &AdapterRegistrySnapshot) -> AssetSummary {
    AssetSummary {
        asset: AssetRef {
            asset_id: registry.global_asset.asset_id.clone(),
            asset_type: AssetType::Skill,
            native_unit_ref: registry.global_asset.native_unit_ref.clone(),
            adapter_identity: registry.built_in_adapter.identity.clone(),
            native_ownership: NativeOwnership::Global,
        },
        display_name: registry.global_asset.display_name.clone(),
        anomalies: Vec::new(),
        agents: vec![crate::domain::AgentId::ClaudeCode],
        scope: AssetScope::Global,
        context_hint: AssetContextHint::Path {
            path_hint: "fixture://fx-19/global-skill".to_string(),
        },
        source_tier: SourceTier {
            id: registry.global_asset.source_tier_id.clone(),
            label: registry.global_asset.source_tier_label.clone(),
        },
        availability: ActionAvailability::Disabled {
            reason_code: ReasonCode::ReadOnlyPolicy,
            recovery_action: None,
        },
    }
}

fn global_segment(asset: &AssetSummary) -> ProjectApplicabilitySegment {
    ProjectApplicabilitySegment {
        id: "segment-fx19-global-applicable".to_string(),
        kind: ProjectApplicabilitySegmentKind::GlobalApplicable,
        display_label: "Global applicable".to_string(),
        project_id: None,
        assets: vec![asset.clone()],
    }
}

fn project_native_segment(
    registry: &AdapterRegistrySnapshot,
    project_id: &str,
) -> Result<ProjectApplicabilitySegment, ReadFailure> {
    let project = registry
        .projects
        .iter()
        .find(|project| project.project_id == project_id)
        .ok_or_else(read_failed)?;
    let asset = AssetSummary {
        asset: AssetRef {
            asset_id: format!("asset-fx19-native-{}", project.project_id),
            asset_type: AssetType::Skill,
            native_unit_ref: format!("nunit-fx19-native-{}", project.project_id),
            adapter_identity: registry.built_in_adapter.identity.clone(),
            native_ownership: NativeOwnership::Project {
                project_id: project.project_id.clone(),
            },
        },
        display_name: format!("{} native skill", project.display_name),
        anomalies: Vec::new(),
        agents: vec![crate::domain::AgentId::ClaudeCode],
        scope: AssetScope::Project,
        context_hint: AssetContextHint::Project {
            project_name: project.display_name.clone(),
        },
        source_tier: SourceTier {
            id: format!("source-fx19-{}", project.project_id),
            label: format!("{} project root", project.display_name),
        },
        availability: ActionAvailability::Disabled {
            reason_code: ReasonCode::ReadOnlyPolicy,
            recovery_action: None,
        },
    };
    Ok(ProjectApplicabilitySegment {
        id: format!("segment-fx19-project-native-{}", project.project_id),
        kind: ProjectApplicabilitySegmentKind::ProjectNative,
        display_label: project.display_name.clone(),
        project_id: Some(project.project_id.clone()),
        assets: vec![asset],
    })
}
