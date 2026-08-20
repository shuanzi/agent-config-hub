//! ARC-03 GatewayCore 的 FE-01 最小切片：只实现 `read`。
//!
//! 不实现 prepare/apply，也不预留 stub command（FE-01 硬边界）。
//! core 只使用 domain 类型，不知道 Tauri、wire DTO 或 IPC 细节。

use crate::catalog::{
    locator_match_field, mask_synthetic_secrets, now_plus_seconds_iso8601, Catalog,
    LocatorDisplayFields,
};
use crate::domain::{
    derive_workbench_status_memberships, AgentId, ApplicabilityResolution, AssetStatusFilter,
    AssetType, GlobalLocatorQuery, GlobalLocatorSnapshot, LocatorDestination, LocatorGroup,
    LocatorMatchedField, LocatorResult, MvpAssetType, ProjectApplicabilityQuery,
    ProjectApplicabilitySegmentKind, ProjectApplicabilitySnapshot, ProjectApplicabilityView, Query,
    ReadFailure, ReadResult, ReasonCode, RecoveryAction, SegmentSource, SensitiveAccessGrant,
    SensitiveAccessScope, SensitiveRevealQuery, SensitiveRevealSnapshot, SensitiveWorkbenchSurface,
    SkillActivation, SkillPresence, SkillTargetState, Snapshot, WorkbenchActualReadSnapshot,
    WorkbenchFinding, WorkbenchQuery, WorkbenchRow, WorkbenchSegment, WorkbenchStatusFacts,
};
use crate::{
    adapter_registry::AdapterRegistry, project_applicability::ProjectApplicabilityResolver,
};

pub struct GatewayCore {
    catalog: Catalog,
    adapter_registry: AdapterRegistry,
}

impl GatewayCore {
    pub fn new(catalog: Catalog) -> Self {
        GatewayCore {
            catalog,
            adapter_registry: AdapterRegistry::from_env(),
        }
    }

    pub fn with_adapter_registry(catalog: Catalog, adapter_registry: AdapterRegistry) -> Self {
        GatewayCore {
            catalog,
            adapter_registry,
        }
    }

    /// 唯一 verb（FE-01）。domain 失败统一为稳定原因码 + retryRead。
    pub fn read(&self, query: &Query) -> ReadResult<Snapshot> {
        match query {
            Query::AssetList(list_query) => {
                ReadResult::Succeeded(Snapshot::AssetList(self.catalog.asset_list(list_query)))
            }
            Query::Workbench(query) => self.read_workbench(query),
            Query::GlobalLocator(query) => self.read_global_locator(query),
            Query::ProjectApplicability(query) => {
                let resolver = ProjectApplicabilityResolver::new(self.adapter_registry.clone());
                match resolver.read(query) {
                    Ok(snapshot) => ReadResult::Succeeded(Snapshot::ProjectApplicability(snapshot)),
                    Err(failure) => ReadResult::Failed(failure),
                }
            }
            Query::AssetDetail(detail_query) => {
                if detail_query.asset.asset_type == AssetType::Hook {
                    return Self::executable_content_risk();
                }
                match self.catalog.asset_detail(&detail_query.asset) {
                    Some(snapshot) => ReadResult::Succeeded(Snapshot::AssetDetail(snapshot)),
                    None => Self::read_failed("资产不存在或当前不可读，请重读。"),
                }
            }
            Query::NativeFile(file_query) => {
                if file_query.asset.asset_type == AssetType::Hook {
                    return Self::executable_content_risk();
                }
                match self
                    .catalog
                    .native_file(&file_query.asset, &file_query.file_id)
                {
                    Some(snapshot) => ReadResult::Succeeded(Snapshot::NativeFile(snapshot)),
                    None => Self::read_failed("文件不存在或当前不可读，请重读。"),
                }
            }
            Query::SensitiveReveal(query) => self.read_sensitive_reveal(query),
        }
    }

    fn read_failed(message: &str) -> ReadResult<Snapshot> {
        ReadResult::Failed(ReadFailure {
            reason_code: ReasonCode::ReadFailed,
            // 人类可读 message 统一过出口遮蔽（当前为固定文案，遮蔽是恒等防御）。
            message: mask_synthetic_secrets(message),
            recovery_action: Some(RecoveryAction::RetryRead),
        })
    }

    fn executable_content_risk() -> ReadResult<Snapshot> {
        ReadResult::Failed(ReadFailure {
            reason_code: ReasonCode::ExecutableContentRisk,
            message: "可执行 Hook 内容不提供只读展示。".to_string(),
            recovery_action: Some(RecoveryAction::RetryRead),
        })
    }

    /// 敏感 `view` / `modify` 均沿唯一 read verb；两种 scope 在 core/catalog
    /// 独立授权，不能通过新增 enum 值静默扩大已有 modify 行为。
    fn read_sensitive_reveal(&self, query: &SensitiveRevealQuery) -> ReadResult<Snapshot> {
        match (query.scope, query.surface) {
            (SensitiveAccessScope::Modify, SensitiveWorkbenchSurface::Source) => {
                self.read_sensitive_modify(query)
            }
            (SensitiveAccessScope::View, SensitiveWorkbenchSurface::Source) => {
                self.read_sensitive_view(query)
            }
        }
    }

    /// FE-03 modify 仍只接受 catalog 的 editable source，保留既有路径与语义。
    fn read_sensitive_modify(&self, query: &SensitiveRevealQuery) -> ReadResult<Snapshot> {
        let Some(plaintext) = self.catalog.sensitive_modify_reveal(
            &query.asset,
            &query.file_id,
            &query.segment_id,
            &query.file_revision,
            &query.asset_revision,
        ) else {
            return Self::sensitive_reveal_denied();
        };
        self.issue_sensitive_reveal_grant(query, plaintext)
    }

    /// FE-10 view 只读独立路径：不依赖 modify 的 can_edit 或授权语义。
    fn read_sensitive_view(&self, query: &SensitiveRevealQuery) -> ReadResult<Snapshot> {
        let Some(plaintext) = self.catalog.sensitive_view_reveal(
            &query.asset,
            &query.file_id,
            &query.segment_id,
            &query.file_revision,
            &query.asset_revision,
        ) else {
            return Self::sensitive_reveal_denied();
        };
        self.issue_sensitive_reveal_grant(query, plaintext)
    }

    fn issue_sensitive_reveal_grant(
        &self,
        query: &SensitiveRevealQuery,
        plaintext: String,
    ) -> ReadResult<Snapshot> {
        let Some(grant_id) = opaque_grant_id() else {
            return Self::sensitive_reveal_denied();
        };

        ReadResult::Succeeded(Snapshot::SensitiveReveal(SensitiveRevealSnapshot {
            plaintext,
            grant: SensitiveAccessGrant {
                grant_id,
                asset: query.asset.clone(),
                file_id: query.file_id.clone(),
                segment_id: query.segment_id.clone(),
                file_revision: query.file_revision.clone(),
                asset_revision: query.asset_revision.clone(),
                scope: query.scope,
                surface: query.surface,
                expires_at: now_plus_seconds_iso8601(30),
            },
        }))
    }

    /// 这是后续 stale/mismatch/expired grant 行为的稳定 failure 边界：不区分
    /// 哪一个 binding 失败，也不回显 segment、revision、grant 或任何明文。
    fn sensitive_reveal_denied() -> ReadResult<Snapshot> {
        ReadResult::Failed(ReadFailure {
            reason_code: ReasonCode::PermissionDenied,
            message: "敏感片段当前不可用，请重新读取并显式授权。".to_string(),
            recovery_action: Some(RecoveryAction::RetryRead),
        })
    }
}

/// 从 OS entropy 取得仅用于 Rust authority 的 opaque identifier。不保留输入、
/// 不派生可重放 payload；无法取得 entropy 时以稳定失败关闭 sensitive reveal。
#[cfg(unix)]
fn opaque_grant_id() -> Option<String> {
    use std::io::Read;

    let mut bytes = [0_u8; 32];
    std::fs::File::open("/dev/urandom")
        .ok()?
        .read_exact(&mut bytes)
        .ok()?;
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(not(unix))]
fn opaque_grant_id() -> Option<String> {
    None
}

impl GatewayCore {
    fn read_workbench(&self, query: &WorkbenchQuery) -> ReadResult<Snapshot> {
        let query = match canonical_workbench_query(query) {
            Ok(query) => query,
            Err(failure) => return ReadResult::Failed(failure),
        };
        // 有登记的 FE-07R read seam 时，只组合其已验证的 actual-read projection；
        // 未登记时保持 FX-01 global-only catalog，绝不按路径或展示名推测 project。
        if self.adapter_registry.is_configured() {
            let resolver = ProjectApplicabilityResolver::new(self.adapter_registry.clone());
            let view = match &query.view_context {
                crate::domain::ViewContext::All => ProjectApplicabilityView::All,
                crate::domain::ViewContext::Global => ProjectApplicabilityView::Global,
                crate::domain::ViewContext::Project { project_id } => {
                    ProjectApplicabilityView::Project {
                        project_id: project_id.clone(),
                    }
                }
            };
            return match resolver.read(&ProjectApplicabilityQuery { view }) {
                Ok(snapshot) => {
                    let workbench = workbench_from_applicability(&query, snapshot);
                    if workbench_skill_cells_valid(&workbench) {
                        ReadResult::Succeeded(Snapshot::Workbench(workbench))
                    } else {
                        ReadResult::Failed(workbench_read_failed())
                    }
                }
                Err(failure) => ReadResult::Failed(failure),
            };
        }
        match self.catalog.workbench(&query) {
            Ok(snapshot) if workbench_skill_cells_valid(&snapshot) => {
                ReadResult::Succeeded(Snapshot::Workbench(snapshot))
            }
            Ok(_) => ReadResult::Failed(workbench_read_failed()),
            Err(failure) => ReadResult::Failed(failure),
        }
    }

    fn read_global_locator(&self, query: &GlobalLocatorQuery) -> ReadResult<Snapshot> {
        if !valid_locator_asset_types(query) {
            return ReadResult::Failed(workbench_read_failed());
        }
        // 配置 FE-07R registry 后，locator 与 workbench 都只消费同一次 resolver
        // actual-read universe；不能回退到 FX-01 catalog 或从路径重建事实。
        if self.adapter_registry.is_configured() {
            let resolver = ProjectApplicabilityResolver::new(self.adapter_registry.clone());
            return match resolver.read(&ProjectApplicabilityQuery {
                view: ProjectApplicabilityView::All,
            }) {
                Ok(snapshot) => ReadResult::Succeeded(Snapshot::GlobalLocator(
                    locator_from_applicability(query, snapshot),
                )),
                Err(failure) => ReadResult::Failed(failure),
            };
        }
        match self.catalog.global_locator(query) {
            Ok(snapshot) => ReadResult::Succeeded(Snapshot::GlobalLocator(snapshot)),
            Err(failure) => ReadResult::Failed(failure),
        }
    }
}

fn workbench_skill_cells_valid(snapshot: &WorkbenchActualReadSnapshot) -> bool {
    snapshot
        .segments
        .iter()
        .flat_map(|segment| segment.rows.iter())
        .flat_map(|row| row.skill_target_states.iter())
        .all(SkillTargetState::is_semantically_valid)
}

fn valid_locator_asset_types(query: &GlobalLocatorQuery) -> bool {
    query.asset_types.as_slice()
        == [
            MvpAssetType::Skill,
            MvpAssetType::LongTermInstruction,
            MvpAssetType::Subagent,
        ]
}

fn locator_from_applicability(
    query: &GlobalLocatorQuery,
    snapshot: ProjectApplicabilitySnapshot,
) -> GlobalLocatorSnapshot {
    let workbench = workbench_from_applicability(
        &WorkbenchQuery {
            asset_type: MvpAssetType::Skill,
            view_context: crate::domain::ViewContext::All,
            filters: None,
        },
        snapshot,
    );
    let mut results = Vec::new();
    for segment in workbench.segments {
        for row in segment.rows {
            let ownership = match &row.summary.asset.native_ownership {
                crate::domain::NativeOwnership::Global => "global".to_string(),
                crate::domain::NativeOwnership::Project { .. } => "project".to_string(),
            };
            let project_hint = match &row.summary.context_hint {
                crate::domain::AssetContextHint::Project { project_name } => {
                    Some(project_name.clone())
                }
                crate::domain::AssetContextHint::Path { path_hint } => Some(path_hint.clone()),
            };
            let fields = LocatorDisplayFields {
                display_name: row.summary.display_name.clone(),
                asset_type_label: "skill".to_string(),
                agents: row
                    .summary
                    .agents
                    .iter()
                    .map(|agent| match agent {
                        AgentId::ClaudeCode => "claude-code",
                        AgentId::Codex => "codex",
                        AgentId::GeminiCli => "gemini-cli",
                        AgentId::Opencode => "opencode",
                    })
                    .map(str::to_string)
                    .collect(),
                ownership,
                project_hint,
                redacted_summary: row.redacted_summary.clone(),
            };
            let matched_field = match locator_match_field(&query.search_text, &fields) {
                Some("displayName") => LocatorMatchedField::DisplayName,
                Some("assetType") => LocatorMatchedField::AssetType,
                Some("agent") => LocatorMatchedField::Agent,
                Some("ownership") => LocatorMatchedField::Ownership,
                Some("projectHint") => LocatorMatchedField::ProjectHint,
                Some("redactedSummary") => LocatorMatchedField::RedactedSummary,
                _ => continue,
            };
            let asset = row.summary.asset.clone();
            let destination_view_context = match &asset.native_ownership {
                crate::domain::NativeOwnership::Global => crate::domain::ViewContext::Global,
                crate::domain::NativeOwnership::Project { project_id } => {
                    crate::domain::ViewContext::Project {
                        project_id: project_id.clone(),
                    }
                }
            };
            results.push(LocatorResult {
                row,
                destination_view_context,
                destination: LocatorDestination::SkillDetail { asset },
                matched_field,
            });
        }
    }
    let aggregate_total = results.len() as u32;
    GlobalLocatorSnapshot {
        groups: vec![
            LocatorGroup {
                asset_type: MvpAssetType::Skill,
                results,
            },
            LocatorGroup {
                asset_type: MvpAssetType::LongTermInstruction,
                results: Vec::new(),
            },
            LocatorGroup {
                asset_type: MvpAssetType::Subagent,
                results: Vec::new(),
            },
        ],
        aggregate_total,
        read_at: workbench.read_at,
    }
}

fn canonical_workbench_query(query: &WorkbenchQuery) -> Result<WorkbenchQuery, ReadFailure> {
    let mut filters = query.filters.clone().unwrap_or_default();
    let invalid_id = |values: &Option<Vec<String>>| {
        values
            .as_ref()
            .is_some_and(|values| values.iter().any(|value| value.trim().is_empty()))
    };
    if invalid_id(&filters.source_ids)
        || invalid_id(&filters.project_ids)
        || matches!(&query.view_context, crate::domain::ViewContext::Project { project_id } if project_id.trim().is_empty())
        || (!matches!(query.view_context, crate::domain::ViewContext::All)
            && filters
                .project_ids
                .as_ref()
                .is_some_and(|ids| !ids.is_empty()))
    {
        return Err(workbench_read_failed());
    }
    if let Some(agents) = filters.agents.as_mut() {
        agents.sort_by_key(agent_order);
        agents.dedup();
    }
    if let Some(statuses) = filters.statuses.as_mut() {
        statuses.sort_by_key(status_order);
        statuses.dedup();
    }
    for ids in [&mut filters.source_ids, &mut filters.project_ids] {
        if let Some(ids) = ids.as_mut() {
            ids.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
            ids.dedup();
        }
    }
    if filters.agents.as_ref().is_some_and(Vec::is_empty) {
        filters.agents = None;
    }
    if filters.statuses.as_ref().is_some_and(Vec::is_empty) {
        filters.statuses = None;
    }
    if filters.source_ids.as_ref().is_some_and(Vec::is_empty) {
        filters.source_ids = None;
    }
    if filters.project_ids.as_ref().is_some_and(Vec::is_empty) {
        filters.project_ids = None;
    }
    Ok(WorkbenchQuery {
        asset_type: query.asset_type,
        view_context: query.view_context.clone(),
        filters: if filters.agents.is_none()
            && filters.source_ids.is_none()
            && filters.statuses.is_none()
            && filters.project_ids.is_none()
        {
            None
        } else {
            Some(filters)
        },
    })
}

fn workbench_read_failed() -> ReadFailure {
    ReadFailure {
        reason_code: ReasonCode::ReadFailed,
        message: "读取条件无效或当前不可读，请重读。".to_string(),
        recovery_action: Some(RecoveryAction::RetryRead),
    }
}

fn agent_order(agent: &AgentId) -> u8 {
    match agent {
        AgentId::ClaudeCode => 0,
        AgentId::Codex => 1,
        AgentId::GeminiCli => 2,
        AgentId::Opencode => 3,
    }
}

fn status_order(status: &AssetStatusFilter) -> u8 {
    match status {
        AssetStatusFilter::Editable => 0,
        AssetStatusFilter::ReadOnly => 1,
        AssetStatusFilter::Incompatible => 2,
        AssetStatusFilter::Normal => 3,
        AssetStatusFilter::Overridden => 4,
        AssetStatusFilter::Conflict => 5,
        AssetStatusFilter::Drift => 6,
    }
}

fn workbench_from_applicability(
    query: &WorkbenchQuery,
    snapshot: ProjectApplicabilitySnapshot,
) -> WorkbenchActualReadSnapshot {
    if query.asset_type != MvpAssetType::Skill {
        return WorkbenchActualReadSnapshot {
            query: query.clone(),
            authoritative_read_revision: snapshot.authoritative_read_revision,
            segments: Vec::new(),
            effective_contexts: Vec::new(),
            findings: Vec::new(),
            aggregate_total: 0,
            index_status: crate::domain::IndexStatus::Fresh,
            read_at: snapshot.read_at,
        };
    }
    let filters = query.filters.as_ref();
    let segments = snapshot
        .segments
        .into_iter()
        .map(|segment| {
            let source = match segment.kind {
                ProjectApplicabilitySegmentKind::GlobalApplicable => {
                    SegmentSource::GlobalApplicable
                }
                ProjectApplicabilitySegmentKind::ProjectNative => SegmentSource::ProjectNative,
            };
            let rows = segment
                .assets
                .into_iter()
                .enumerate()
                .filter(|(_, summary)| {
                    matches_workbench_filters(
                        summary,
                        source,
                        segment.project_id.as_deref(),
                        filters,
                        &derive_workbench_status_memberships(&WorkbenchStatusFacts::default()),
                    )
                })
                .map(|(order, summary)| WorkbenchRow {
                    sort_base_name: summary.display_name.clone(),
                    authoritative_input_order: order as u32,
                    // FE-07R summary seam does not expose edit-specific availability,
                    // compatibility, or cell facts. Preserve the actual projection but
                    // fail closed instead of deriving membership from generic availability.
                    status_memberships: derive_workbench_status_memberships(
                        &WorkbenchStatusFacts::default(),
                    ),
                    skill_target_states: unknown_skill_target_states(),
                    summary,
                    redacted_summary: Some("结构化只读 Skill 摘要".to_string()),
                })
                .collect();
            WorkbenchSegment {
                id: segment.id,
                source,
                display_label: segment.display_label,
                project_id: segment.project_id,
                rows,
            }
        })
        .filter(|segment: &WorkbenchSegment| !segment.rows.is_empty())
        .collect::<Vec<_>>();
    let aggregate_total = segments
        .iter()
        .map(|segment| segment.rows.len() as u32)
        .sum();
    let findings = snapshot
        .findings
        .into_iter()
        .filter_map(|finding| {
            finding
                .context
                .reason_code
                .map(|reason_code| WorkbenchFinding {
                    asset_id: finding.asset.asset_id,
                    reason_code,
                    context: finding.context,
                })
        })
        .collect();
    WorkbenchActualReadSnapshot {
        query: query.clone(),
        authoritative_read_revision: snapshot.authoritative_read_revision,
        segments,
        effective_contexts: snapshot.effective_contexts,
        findings,
        aggregate_total,
        index_status: crate::domain::IndexStatus::Fresh,
        read_at: snapshot.read_at,
    }
}

fn matches_workbench_filters(
    summary: &crate::domain::AssetSummary,
    source: SegmentSource,
    project_id: Option<&str>,
    filters: Option<&crate::domain::WorkbenchFilters>,
    status_memberships: &[AssetStatusFilter],
) -> bool {
    let Some(filters) = filters else { return true };
    if filters.agents.as_ref().is_some_and(|agents| {
        !agents.is_empty() && !agents.iter().any(|agent| summary.agents.contains(agent))
    }) {
        return false;
    }
    if filters
        .source_ids
        .as_ref()
        .is_some_and(|sources| !sources.is_empty() && !sources.contains(&summary.source_tier.id))
    {
        return false;
    }
    if filters.statuses.as_ref().is_some_and(|statuses| {
        !statuses.is_empty()
            && !statuses
                .iter()
                .any(|status| status_memberships.contains(status))
    }) {
        return false;
    }
    !(source == SegmentSource::ProjectNative
        && filters.project_ids.as_ref().is_some_and(|ids| {
            !ids.is_empty() && !ids.iter().any(|id| Some(id.as_str()) == project_id)
        }))
}

fn unknown_skill_target_states() -> Vec<SkillTargetState> {
    [
        AgentId::ClaudeCode,
        AgentId::Codex,
        AgentId::GeminiCli,
        AgentId::Opencode,
    ]
    .into_iter()
    .map(|agent| SkillTargetState {
        agent,
        presence: SkillPresence::Unknown,
        activation: SkillActivation::Unknown,
        applicability: ApplicabilityResolution::Unknown,
        enable_availability: crate::domain::SkillCellAvailability::Disabled {
            reason_code: ReasonCode::UnknownFieldPreserved,
        },
        disable_availability: crate::domain::SkillCellAvailability::Disabled {
            reason_code: ReasonCode::UnknownFieldPreserved,
        },
        pending: None,
        stable_reason: Some("UNKNOWN_FIELD_PRESERVED".to_string()),
    })
    .collect()
}
