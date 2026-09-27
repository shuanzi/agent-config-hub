//! Skill directory placement ownership and safe file operations.
//!
//! This module deliberately models directory entries, not whether an Agent can
//! discover or use a Skill. The registry is the only source of application
//! ownership; pre-existing files are never inferred to be managed.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use crate::config;
use crate::database::Database;
use crate::error::AppError;
use crate::services::project::{ProjectService, ScopeTarget};
use crate::services::skill::{AgentType, InstalledSkill, SkillService};
use crate::settings::{get_settings, StorageLocation, SyncMethod};

const REGISTRY_KEY: &str = "skill_placement_registry_v1";
const REGISTRY_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillLocation {
    Shared,
    ClaudeCode,
    Codex,
    GeminiCli,
    #[serde(rename = "opencode")]
    OpenCode,
}

impl SkillLocation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
            Self::GeminiCli => "gemini-cli",
            Self::OpenCode => "opencode",
        }
    }

    pub fn from_str(value: &str) -> Result<Self, AppError> {
        match value.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "shared" | "agents" => Ok(Self::Shared),
            "claude" | "claude-code" => Ok(Self::ClaudeCode),
            "codex" => Ok(Self::Codex),
            "gemini" | "gemini-cli" => Ok(Self::GeminiCli),
            "opencode" => Ok(Self::OpenCode),
            other => Err(AppError::InvalidInput(format!(
                "不支持的 Skill 投放位置: {other}"
            ))),
        }
    }

    pub fn agent(self) -> Option<AgentType> {
        match self {
            Self::Shared => None,
            Self::ClaudeCode => Some(AgentType::ClaudeCode),
            Self::Codex => Some(AgentType::Codex),
            Self::GeminiCli => Some(AgentType::GeminiCli),
            Self::OpenCode => Some(AgentType::OpenCode),
        }
    }
}

impl From<AgentType> for SkillLocation {
    fn from(value: AgentType) -> Self {
        match value {
            AgentType::ClaudeCode => Self::ClaudeCode,
            AgentType::Codex => Self::Codex,
            AgentType::GeminiCli => Self::GeminiCli,
            AgentType::OpenCode => Self::OpenCode,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPlacementTarget {
    pub location: SkillLocation,
    /// Every logical location resolving to this root, including `location`.
    pub aliases: Vec<SkillLocation>,
    pub path: PathBuf,
    pub physical_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPlacement {
    #[serde(flatten)]
    pub target: SkillPlacementTarget,
    /// `placed`, `absent`, `unmanaged`, or `conflict`.
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub withdrawable: bool,
    pub source_is_target: bool,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceRecord {
    target: ScopeTarget,
    id: String,
    directory: String,
    source_path: PathBuf,
    physical_source_path: PathBuf,
    fingerprint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum PlacementEntryType {
    Copy,
    Symlink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlacementRecord {
    target: ScopeTarget,
    id: String,
    directory: String,
    location: SkillLocation,
    source_path: PathBuf,
    destination_path: PathBuf,
    physical_destination_path: PathBuf,
    fingerprint: String,
    content_fingerprint: String,
    entry_type: PlacementEntryType,
    #[serde(skip_serializing_if = "Option::is_none")]
    symlink_target: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlacementRegistry {
    version: u32,
    #[serde(default)]
    sources: Vec<SourceRecord>,
    #[serde(default)]
    placements: Vec<PlacementRecord>,
}

impl Default for PlacementRegistry {
    fn default() -> Self {
        Self {
            version: REGISTRY_VERSION,
            sources: Vec::new(),
            placements: Vec::new(),
        }
    }
}

fn same_asset(record_target: &ScopeTarget, record_id: &str, skill: &InstalledSkill) -> bool {
    record_target == &skill.target && record_id == skill.id
}

pub(crate) fn source_root(db: &Arc<Database>, target: &ScopeTarget) -> Result<PathBuf, AppError> {
    match target {
        ScopeTarget::Global => Ok(match get_settings().storage_location {
            StorageLocation::Hub => config::get_hub_skills_dir(),
            StorageLocation::Unified => config::get_home_dir().join(".agents/skills"),
        }),
        ScopeTarget::Project { project_id } => {
            ProjectService::resolve_scope_target(db, target)?;
            let base = match get_settings().storage_location {
                StorageLocation::Hub => config::get_hub_dir(),
                StorageLocation::Unified => config::get_home_dir().join(".agents"),
            };
            Ok(base.join("projects").join(project_id).join("skills"))
        }
    }
}

fn source_path(db: &Arc<Database>, skill: &InstalledSkill) -> Result<PathBuf, AppError> {
    SkillService::require_valid_directory(&skill.directory)?;
    Ok(source_root(db, &skill.target)?.join(&skill.directory))
}

fn logical_targets(
    db: &Arc<Database>,
    target: &ScopeTarget,
) -> Result<Vec<(SkillLocation, PathBuf)>, AppError> {
    ProjectService::resolve_scope_target(db, target)?;
    let mut result = Vec::new();
    if matches!(target, ScopeTarget::Global) {
        result.push((
            SkillLocation::Shared,
            config::get_home_dir().join(".agents/skills"),
        ));
    }
    for agent in AgentType::all() {
        result.push((
            agent.into(),
            SkillService::get_app_skills_dir_for_target(db, target, &agent)?,
        ));
    }
    Ok(result)
}

/// Returns placement roots, merging logical aliases that resolve to one
/// physical directory. `aliases` contains the primary location as well.
pub fn targets(
    db: &Arc<Database>,
    target: &ScopeTarget,
) -> Result<Vec<SkillPlacementTarget>, AppError> {
    let mut grouped: Vec<SkillPlacementTarget> = Vec::new();
    for (location, path) in logical_targets(db, target)? {
        let resolved = physical_path(&path)?;
        if let Some(existing) = grouped
            .iter_mut()
            .find(|candidate| candidate.physical_path == resolved)
        {
            existing.aliases.push(location);
        } else {
            grouped.push(SkillPlacementTarget {
                location,
                aliases: vec![location],
                path,
                physical_path: resolved,
            });
        }
    }
    Ok(grouped)
}

fn target_for_location(
    db: &Arc<Database>,
    target: &ScopeTarget,
    location: SkillLocation,
) -> Result<SkillPlacementTarget, AppError> {
    targets(db, target)?
        .into_iter()
        .find(|candidate| candidate.aliases.contains(&location))
        .ok_or_else(|| {
            AppError::InvalidInput(format!(
                "{} scope 不支持 {} 投放位置",
                match target {
                    ScopeTarget::Global => "global",
                    ScopeTarget::Project { .. } => "project",
                },
                location.as_str()
            ))
        })
}

fn read_registry(db: &Database) -> Result<PlacementRegistry, AppError> {
    let Some(raw) = db.get_setting(REGISTRY_KEY)? else {
        return Ok(PlacementRegistry::default());
    };
    let registry: PlacementRegistry = serde_json::from_str(&raw)
        .map_err(|error| AppError::Database(format!("Skill 投放归属记录损坏: {error}")))?;
    if registry.version != REGISTRY_VERSION {
        return Err(AppError::Database(format!(
            "不支持的 Skill 投放归属记录版本: {}",
            registry.version
        )));
    }
    Ok(registry)
}

fn write_registry(db: &Database, registry: &PlacementRegistry) -> Result<(), AppError> {
    let raw =
        serde_json::to_string(registry).map_err(|source| AppError::JsonSerialize { source })?;
    db.set_setting(REGISTRY_KEY, &raw)
}

/// Includes missing and otherwise orphaned records so a project root cannot be
/// relinked while a managed placement would be left at the old root.
pub(crate) fn has_project_placements(db: &Database, project_id: &str) -> Result<bool, AppError> {
    let registry = read_registry(db)?;
    Ok(registry.placements.iter().any(|record| {
        matches!(
            &record.target,
            ScopeTarget::Project {
                project_id: record_project_id
            } if record_project_id == project_id
        )
    }))
}

/// Whether this asset has a placement ownership record associated with the
/// current logical location. The lexical destination check deliberately keeps
/// orphaned records visible when a root symlink is externally retargeted.
pub(crate) fn has_owned_records_for_location(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    location: SkillLocation,
) -> Result<bool, AppError> {
    let registry = read_registry(db)?;
    let target = target_for_location(db, &skill.target, location)?;
    let destination = target.path.join(&skill.directory);
    let physical_destination = physical_entry_path(&destination).ok();
    Ok(registry.placements.iter().any(|record| {
        same_asset(&record.target, &record.id, skill)
            && (record.location == location
                || record.destination_path == destination
                || physical_destination
                    .as_ref()
                    .map(|physical| record.physical_destination_path == *physical)
                    .unwrap_or(false))
    }))
}

fn source_record<'a>(
    registry: &'a PlacementRegistry,
    skill: &InstalledSkill,
) -> Option<&'a SourceRecord> {
    registry
        .sources
        .iter()
        .find(|record| same_asset(&record.target, &record.id, skill))
}

fn physical_entry_owned_by_other(
    registry: &PlacementRegistry,
    physical_entry: &Path,
    skill: &InstalledSkill,
) -> bool {
    registry.sources.iter().any(|record| {
        record.physical_source_path == physical_entry
            && !same_asset(&record.target, &record.id, skill)
    }) || registry.placements.iter().any(|record| {
        record.physical_destination_path == physical_entry
            && !same_asset(&record.target, &record.id, skill)
    })
}

fn source_fingerprint(path: &Path) -> Result<String, AppError> {
    let exact = fingerprint(path)?;
    if SkillService::is_symlink(path) {
        let canonical = path
            .canonicalize()
            .map_err(|error| AppError::io(path, error))?;
        let content = fingerprint(&canonical)?;
        Ok(hash_fields(&["source-link", &exact, &content]))
    } else {
        Ok(exact)
    }
}

fn validate_source_record(
    registry: &PlacementRegistry,
    skill: &InstalledSkill,
    source: &Path,
) -> Result<(), AppError> {
    let record = source_record(registry, skill).ok_or_else(|| {
        AppError::Conflict(format!("Skill 主副本尚未登记归属: {}", source.display()))
    })?;
    let physical = physical_entry_path(source)?;
    if record.physical_source_path != physical || record.source_path != source {
        return Err(AppError::Conflict(format!(
            "Skill 主副本路径与归属记录不一致: {}",
            source.display()
        )));
    }
    let current = source_fingerprint(source)?;
    if current != record.fingerprint {
        return Err(AppError::Conflict(format!(
            "Skill 主副本已被外部修改: {}",
            source.display()
        )));
    }
    Ok(())
}

pub(crate) fn register_source(db: &Arc<Database>, skill: &InstalledSkill) -> Result<(), AppError> {
    let source = source_path(db, skill)?;
    validate_skill_directory(&source)?;
    let fingerprint = source_fingerprint(&source)?;
    let physical_source_path = physical_entry_path(&source)?;
    let mut registry = read_registry(db)?;
    if let Some(existing) = source_record(&registry, skill) {
        if existing.source_path == source
            && existing.physical_source_path == physical_source_path
            && existing.fingerprint == fingerprint
        {
            return Ok(());
        }
        return Err(AppError::Conflict(format!(
            "Skill 主副本与既有归属记录冲突: {}",
            source.display()
        )));
    }
    if physical_entry_owned_by_other(&registry, &physical_source_path, skill) {
        return Err(AppError::Conflict(format!(
            "Skill 主副本物理路径已归属于其他资产或 scope: {}",
            source.display()
        )));
    }
    registry.sources.push(SourceRecord {
        target: skill.target.clone(),
        id: skill.id.clone(),
        directory: skill.directory.clone(),
        source_path: source,
        physical_source_path,
        fingerprint,
    });
    write_registry(db, &registry)
}

/// Refreshes the recorded source fingerprint after a caller has intentionally
/// and atomically replaced the managed source.
pub(crate) fn refresh_source(db: &Arc<Database>, skill: &InstalledSkill) -> Result<(), AppError> {
    let source = source_path(db, skill)?;
    validate_skill_directory(&source)?;
    let next_fingerprint = source_fingerprint(&source)?;
    let next_physical = physical_entry_path(&source)?;
    let mut registry = read_registry(db)?;
    if physical_entry_owned_by_other(&registry, &next_physical, skill) {
        return Err(AppError::Conflict(
            "Skill 主副本物理路径已归属于其他资产或 scope".to_string(),
        ));
    }
    let source_index = registry
        .sources
        .iter()
        .position(|record| same_asset(&record.target, &record.id, skill))
        .ok_or_else(|| AppError::Conflict("Skill 主副本尚未登记，无法刷新".to_string()))?;
    // The caller uses this after either an intentional content replacement or
    // an intentional storage migration. In both cases it must have called
    // ensure_owned_unchanged before mutating the source. Refreshing also moves
    // the recorded source address, while destination fingerprints stay intact
    // so stale links/copies can be safely rewritten by a following sync.
    registry.sources[source_index].source_path = source.clone();
    registry.sources[source_index].physical_source_path = next_physical;
    registry.sources[source_index].fingerprint = next_fingerprint;
    for placement in registry
        .placements
        .iter_mut()
        .filter(|record| same_asset(&record.target, &record.id, skill))
    {
        placement.source_path = source.clone();
        if placement.entry_type == PlacementEntryType::Symlink
            && placement
                .destination_path
                .canonicalize()
                .ok()
                .zip(source.canonicalize().ok())
                .map(|(destination, source)| destination == source)
                .unwrap_or(false)
        {
            placement.content_fingerprint = content_fingerprint(&placement.destination_path)?;
        }
    }
    write_registry(db, &registry)
}

/// Rebinds a source record after the caller has explicitly moved the storage
/// root. All ordinary placements must have been withdrawn first, and the bytes
/// at the newly resolved source must still match the last managed revision.
pub(crate) fn relocate_source(db: &Arc<Database>, skill: &InstalledSkill) -> Result<(), AppError> {
    let next_source = source_path(db, skill)?;
    validate_skill_directory(&next_source)?;
    let next_fingerprint = source_fingerprint(&next_source)?;
    let next_physical = physical_entry_path(&next_source)?;
    let mut registry = read_registry(db)?;
    if registry
        .placements
        .iter()
        .any(|record| same_asset(&record.target, &record.id, skill))
    {
        return Err(AppError::Conflict(
            "迁移主存储前必须先撤回该 Skill 的受管投放".to_string(),
        ));
    }
    let source_index = registry
        .sources
        .iter()
        .position(|record| same_asset(&record.target, &record.id, skill))
        .ok_or_else(|| AppError::Conflict("Skill 主副本尚未登记，不能迁移".to_string()))?;
    if registry.sources[source_index].fingerprint != next_fingerprint {
        return Err(AppError::Conflict(
            "迁移后的 Skill 主副本与迁移前内容不一致".to_string(),
        ));
    }
    if physical_entry_owned_by_other(&registry, &next_physical, skill) {
        return Err(AppError::Conflict(
            "迁移后的 Skill 主副本物理路径已归属于其他资产或 scope".to_string(),
        ));
    }
    let record = &mut registry.sources[source_index];
    record.source_path = next_source;
    record.physical_source_path = next_physical;
    write_registry(db, &registry)
}

pub(crate) fn forget_asset(db: &Arc<Database>, skill: &InstalledSkill) -> Result<(), AppError> {
    let mut registry = read_registry(db)?;
    registry
        .sources
        .retain(|record| !same_asset(&record.target, &record.id, skill));
    registry
        .placements
        .retain(|record| !same_asset(&record.target, &record.id, skill));
    write_registry(db, &registry)
}

pub(crate) fn owned_locations(
    db: &Arc<Database>,
    skill: &InstalledSkill,
) -> Result<Vec<SkillLocation>, AppError> {
    let registry = read_registry(db)?;
    let resolved_source_root = source_root(db, &skill.target)?;
    let source_root_physical = physical_path(&resolved_source_root)?;
    let source_identity = physical_entry_path(&resolved_source_root.join(&skill.directory))?;
    let source_owned = source_record(&registry, skill)
        .map(|record| record.physical_source_path == source_identity)
        .unwrap_or(false);
    let mut result = Vec::new();
    for target in targets(db, &skill.target)? {
        let identity = physical_entry_path(&target.path.join(&skill.directory))?;
        let owned = (target.physical_path == source_root_physical && source_owned)
            || registry.placements.iter().any(|record| {
                same_asset(&record.target, &record.id, skill)
                    && record.physical_destination_path == identity
            });
        if owned {
            for location in target.aliases {
                if !result.contains(&location) {
                    result.push(location);
                }
            }
        }
    }
    Ok(result)
}

pub(crate) fn ensure_owned_unchanged(
    db: &Arc<Database>,
    skill: &InstalledSkill,
) -> Result<(), AppError> {
    let registry = read_registry(db)?;
    let source = source_path(db, skill)?;
    validate_source_record(&registry, skill, &source)?;
    for record in registry
        .placements
        .iter()
        .filter(|record| same_asset(&record.target, &record.id, skill))
    {
        let current_identity = physical_entry_path(&record.destination_path)?;
        if current_identity != record.physical_destination_path {
            return Err(AppError::Conflict(format!(
                "投放路径已解析到其他物理位置: {}",
                record.destination_path.display()
            )));
        }
        let current = fingerprint(&record.destination_path).map_err(|_| {
            AppError::Conflict(format!(
                "受管投放已缺失: {}",
                record.destination_path.display()
            ))
        })?;
        let current_content = content_fingerprint(&record.destination_path).map_err(|_| {
            AppError::Conflict(format!(
                "受管投放内容不可读取: {}",
                record.destination_path.display()
            ))
        })?;
        if current != record.fingerprint
            || current_content != record.content_fingerprint
            || !entry_shape_matches(record)?
        {
            return Err(AppError::Conflict(format!(
                "受管投放已被外部修改: {}",
                record.destination_path.display()
            )));
        }
    }
    Ok(())
}

fn entry_shape_matches(record: &PlacementRecord) -> Result<bool, AppError> {
    match record.entry_type {
        PlacementEntryType::Copy => {
            Ok(!SkillService::is_symlink(&record.destination_path)
                && record.destination_path.is_dir())
        }
        PlacementEntryType::Symlink => {
            if !SkillService::is_symlink(&record.destination_path) {
                return Ok(false);
            }
            Ok(fs::read_link(&record.destination_path)
                .map_err(|error| AppError::io(&record.destination_path, error))?
                == record.symlink_target.clone().unwrap_or_default())
        }
    }
}

fn ensure_placement_entry_unchanged(
    record: &PlacementRecord,
    destination: &Path,
    context: &str,
) -> Result<(), AppError> {
    let current = fingerprint(destination)
        .map_err(|error| AppError::Conflict(format!("{context}: {error}")))?;
    let current_content = content_fingerprint(destination)
        .map_err(|error| AppError::Conflict(format!("{context}: {error}")))?;
    if current != record.fingerprint
        || current_content != record.content_fingerprint
        || !entry_shape_matches(record)?
    {
        return Err(AppError::Conflict(context.to_string()));
    }
    Ok(())
}

pub fn placements(
    db: &Arc<Database>,
    skill: &InstalledSkill,
) -> Result<Vec<SkillPlacement>, AppError> {
    SkillService::require_valid_directory(&skill.directory)?;
    let registry = read_registry(db)?;
    let source_root = source_root(db, &skill.target)?;
    let source = source_root.join(&skill.directory);
    let current_source_content = content_fingerprint(&source).ok();
    let source_root_physical = physical_path(&source_root)?;
    let source_record_conflict = match source_record(&registry, skill) {
        Some(record) => match source_fingerprint(&source) {
            Ok(current)
                if current == record.fingerprint
                    && physical_entry_path(&source).ok().as_ref()
                        == Some(&record.physical_source_path) =>
            {
                None
            }
            Ok(_) => Some("Skill 主副本已被外部修改".to_string()),
            Err(_) => Some("Skill 主副本缺失或不可读取".to_string()),
        },
        None => Some("Skill 主副本尚未登记归属".to_string()),
    };

    targets(db, &skill.target)?
        .into_iter()
        .map(|target| {
            let destination = target.path.join(&skill.directory);
            let source_is_target = target.physical_path == source_root_physical;
            let (revision, observation_error) = match revision_for_path(&destination) {
                Ok(revision) => (revision, None),
                Err(error) => (
                    hash_fields(&["unreadable", &destination.to_string_lossy()]),
                    Some(format!("无法读取投放条目: {error}")),
                ),
            };
            if source_is_target {
                let cross_owner = physical_entry_path(&source)
                    .ok()
                    .filter(|identity| physical_entry_owned_by_other(&registry, identity, skill))
                    .map(|_| "该物理目录条目已归属于其他 Skill 或 scope".to_string());
                if let Some(reason) = source_record_conflict
                    .clone()
                    .or(observation_error)
                    .or(cross_owner)
                {
                    return Ok(SkillPlacement {
                        target,
                        state: "conflict".to_string(),
                        reason: Some(reason),
                        withdrawable: false,
                        source_is_target: true,
                        revision,
                    });
                }
                return Ok(SkillPlacement {
                    target,
                    state: if source.exists() || SkillService::is_symlink(&source) {
                        "placed"
                    } else {
                        "absent"
                    }
                    .to_string(),
                    reason: Some("该投放位置同时保存主副本，不能独立撤回".to_string()),
                    withdrawable: false,
                    source_is_target: true,
                    revision,
                });
            }
            if let Some(reason) = target_root_issue(&target.path) {
                return Ok(SkillPlacement {
                    target,
                    state: "conflict".to_string(),
                    reason: Some(reason),
                    withdrawable: false,
                    source_is_target: false,
                    revision,
                });
            }
            if paths_overlap(&source_root_physical, &target.physical_path) {
                return Ok(SkillPlacement {
                    target,
                    state: "conflict".to_string(),
                    reason: Some("投放根目录与主存储目录重叠".to_string()),
                    withdrawable: false,
                    source_is_target: false,
                    revision,
                });
            }

            let destination_identity = match physical_entry_path(&destination) {
                Ok(identity) => identity,
                Err(error) => {
                    return Ok(SkillPlacement {
                        target,
                        state: "conflict".to_string(),
                        reason: Some(format!("无法解析投放条目: {error}")),
                        withdrawable: false,
                        source_is_target: false,
                        revision,
                    });
                }
            };
            if let Some(reason) = observation_error {
                return Ok(SkillPlacement {
                    target,
                    state: "conflict".to_string(),
                    reason: Some(reason),
                    withdrawable: false,
                    source_is_target: false,
                    revision,
                });
            }

            let owner = registry
                .placements
                .iter()
                .find(|record| record.physical_destination_path == destination_identity);
            if physical_entry_owned_by_other(&registry, &destination_identity, skill) {
                return Ok(SkillPlacement {
                    target,
                    state: "conflict".to_string(),
                    reason: Some("该物理目录条目已归属于其他 Skill 或 scope".to_string()),
                    withdrawable: false,
                    source_is_target: false,
                    revision,
                });
            }
            match owner {
                Some(record) if !same_asset(&record.target, &record.id, skill) => {
                    Ok(SkillPlacement {
                        target,
                        state: "conflict".to_string(),
                        reason: Some("该物理目录条目已归属于其他 Skill 或 scope".to_string()),
                        withdrawable: false,
                        source_is_target: false,
                        revision,
                    })
                }
                Some(record) => {
                    let current = fingerprint(&destination).ok();
                    if current.is_none()
                        && !(destination.exists() || SkillService::is_symlink(&destination))
                    {
                        if let Some(reason) = source_record_conflict.clone() {
                            return Ok(SkillPlacement {
                                target,
                                state: "conflict".to_string(),
                                reason: Some(reason),
                                withdrawable: false,
                                source_is_target: false,
                                revision,
                            });
                        }
                        return Ok(SkillPlacement {
                            target,
                            state: "absent".to_string(),
                            reason: Some("已登记投放缺失；可重新投放或撤回以清理记录".to_string()),
                            withdrawable: true,
                            source_is_target: false,
                            revision,
                        });
                    }
                    let current_content = content_fingerprint(&destination).ok();
                    let shape_ok = entry_shape_matches(record).unwrap_or(false);
                    let ownership_unchanged = current.as_deref()
                        == Some(record.fingerprint.as_str())
                        && current_content.as_deref() == Some(record.content_fingerprint.as_str())
                        && shape_ok;
                    let withdrawable = source_record_conflict.is_none() && ownership_unchanged;
                    let conflict = source_record_conflict.clone().or_else(|| {
                        if !ownership_unchanged {
                            Some(if current.is_none() {
                                "已登记投放缺失".to_string()
                            } else {
                                "已登记投放被外部修改".to_string()
                            })
                        } else if current_content != current_source_content {
                            Some("受管投放与主副本内容不一致，可重新投放".to_string())
                        } else {
                            None
                        }
                    });
                    Ok(SkillPlacement {
                        target,
                        state: if conflict.is_some() {
                            "conflict"
                        } else {
                            "placed"
                        }
                        .to_string(),
                        reason: conflict,
                        withdrawable,
                        source_is_target: false,
                        revision,
                    })
                }
                None if destination.exists() || SkillService::is_symlink(&destination) => {
                    Ok(SkillPlacement {
                        target,
                        state: "unmanaged".to_string(),
                        reason: Some("已存在·未接管".to_string()),
                        withdrawable: false,
                        source_is_target: false,
                        revision,
                    })
                }
                None => Ok(SkillPlacement {
                    target,
                    state: "absent".to_string(),
                    reason: None,
                    withdrawable: false,
                    source_is_target: false,
                    revision,
                }),
            }
        })
        .collect()
}

pub(crate) fn sync(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    location: SkillLocation,
) -> Result<SkillPlacement, AppError> {
    let placement_target = target_for_location(db, &skill.target, location)?;
    let source_root = source_root(db, &skill.target)?;
    let source = source_root.join(&skill.directory);
    validate_skill_directory(&source)?;
    let source_root_physical = physical_path(&source_root)?;
    let destination = placement_target.path.join(&skill.directory);

    let mut registry = read_registry(db)?;
    validate_source_record(&registry, skill, &source)?;
    if placement_target.physical_path == source_root_physical {
        return placement_for_location(db, skill, location);
    }
    if paths_overlap(&source_root_physical, &placement_target.physical_path) {
        return Err(AppError::Conflict(
            "投放根目录与主存储目录重叠，拒绝写入".to_string(),
        ));
    }
    let physical_destination = physical_entry_path(&destination)?;
    if physical_entry_owned_by_other(&registry, &physical_destination, skill) {
        return Err(AppError::Conflict(
            "该物理目录条目已归属于其他 Skill 或 scope".to_string(),
        ));
    }
    let existing_index = registry
        .placements
        .iter()
        .position(|record| record.physical_destination_path == physical_destination);
    match existing_index {
        Some(index)
            if !same_asset(
                &registry.placements[index].target,
                &registry.placements[index].id,
                skill,
            ) =>
        {
            return Err(AppError::Conflict(
                "该物理目录条目已归属于其他 Skill 或 scope".to_string(),
            ));
        }
        Some(index) => {
            let record = &registry.placements[index];
            if destination.exists() || SkillService::is_symlink(&destination) {
                let current = fingerprint(&destination).map_err(|error| {
                    AppError::Conflict(format!("已登记投放不可读取，拒绝覆盖: {error}"))
                })?;
                let current_content = content_fingerprint(&destination).map_err(|error| {
                    AppError::Conflict(format!("已登记投放内容不可读取，拒绝覆盖: {error}"))
                })?;
                if current != record.fingerprint
                    || current_content != record.content_fingerprint
                    || !entry_shape_matches(record)?
                {
                    return Err(AppError::Conflict(
                        "已登记投放被外部修改，拒绝覆盖".to_string(),
                    ));
                }
            }
        }
        None if destination.exists() || SkillService::is_symlink(&destination) => {
            return Err(AppError::Conflict(format!(
                "目标已存在但未接管: {}",
                destination.display()
            )));
        }
        None => {}
    }

    let destination_was_present = destination.exists() || SkillService::is_symlink(&destination);
    let checkpoint = PlacementCheckpoint::capture(db, std::slice::from_ref(&destination))?;
    let parent = destination.parent().ok_or_else(|| {
        AppError::InvalidInput(format!("无效投放路径: {}", destination.display()))
    })?;
    let parent_preexisted = parent.exists();
    let auto_copy_existing_directory = matches!(get_settings().sync_method, SyncMethod::Auto)
        && existing_index
            .and_then(|index| registry.placements.get(index))
            .map(|record| record.entry_type == PlacementEntryType::Copy)
            .unwrap_or(false);
    let mut target_mutated = false;
    let write_result = (|| {
        fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
        if physical_path(parent)? != placement_target.physical_path {
            return Err(AppError::Conflict(
                "投放根目录在写入前解析到了其他物理位置".to_string(),
            ));
        }
        if let Some(index) = existing_index {
            if destination_was_present {
                ensure_placement_entry_unchanged(
                    &registry.placements[index],
                    &destination,
                    "已登记投放在写入快照期间发生变化",
                )?;
            } else if destination.exists() || SkillService::is_symlink(&destination) {
                return Err(AppError::Conflict(
                    "缺失的已登记投放在写入快照期间被外部创建".to_string(),
                ));
            }
        } else if destination.exists() || SkillService::is_symlink(&destination) {
            return Err(AppError::Conflict(
                "投放目标在写入快照期间出现未接管条目".to_string(),
            ));
        }
        target_mutated = true;
        if destination.exists() || SkillService::is_symlink(&destination) {
            SkillService::remove_path(&destination)?;
        }
        place_source(&source, &destination, auto_copy_existing_directory)?;
        let record = build_placement_record(skill, location, &source, &destination)?;
        if let Some(index) = existing_index {
            registry.placements[index] = record;
        } else {
            registry.placements.push(record);
        }
        write_registry(db, &registry)
    })();
    if let Err(error) = write_result {
        if !target_mutated {
            if !parent_preexisted {
                let _ = fs::remove_dir(parent);
            }
            return Err(error);
        }
        return Err(rollback_after_error(
            checkpoint,
            db,
            parent,
            parent_preexisted,
            error,
        ));
    }
    placement_for_location(db, skill, location)
}

pub(crate) fn adopt(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    location: SkillLocation,
    expected_revision: &str,
) -> Result<SkillPlacement, AppError> {
    let placement_target = target_for_location(db, &skill.target, location)?;
    let source_root = source_root(db, &skill.target)?;
    let source = source_root.join(&skill.directory);
    validate_skill_directory(&source)?;
    let destination = placement_target.path.join(&skill.directory);
    if placement_target.physical_path == physical_path(&source_root)? {
        return placement_for_location(db, skill, location);
    }
    if paths_overlap(
        &physical_path(&source_root)?,
        &placement_target.physical_path,
    ) {
        return Err(AppError::Conflict(
            "投放根目录与主存储目录重叠，不能接管".to_string(),
        ));
    }
    if !(destination.exists() || SkillService::is_symlink(&destination)) {
        return Err(AppError::Conflict("待接管投放已不存在".to_string()));
    }
    let current_fingerprint = fingerprint(&destination)?;
    let preview_revision = placement_for_location(db, skill, location)?.revision;
    if preview_revision != expected_revision {
        return Err(AppError::Conflict("待接管投放在预览后发生变化".to_string()));
    }

    let mut registry = read_registry(db)?;
    validate_source_record(&registry, skill, &source)?;
    let physical_destination = physical_entry_path(&destination)?;
    if physical_entry_owned_by_other(&registry, &physical_destination, skill) {
        return Err(AppError::Conflict("该物理目录条目已有其他归属".to_string()));
    }
    if let Some(owner) = registry
        .placements
        .iter()
        .find(|record| record.physical_destination_path == physical_destination)
    {
        if same_asset(&owner.target, &owner.id, skill)
            && owner.fingerprint == current_fingerprint
            && entry_shape_matches(owner)?
        {
            return placement_for_location(db, skill, location);
        }
        return Err(AppError::Conflict(
            "该物理目录条目已有其他归属或已变化".to_string(),
        ));
    }
    if content_fingerprint(&source)? != content_fingerprint(&destination)? {
        return Err(AppError::Conflict(
            "同名目标与受管主副本内容不同，不能接管".to_string(),
        ));
    }
    if physical_entry_path(&destination)? != physical_destination {
        return Err(AppError::Conflict(
            "待接管投放在写入归属前解析到了其他物理位置".to_string(),
        ));
    }
    if revision_for_path(&destination)? != expected_revision {
        return Err(AppError::Conflict(
            "待接管投放在写入归属前发生变化".to_string(),
        ));
    }
    registry.placements.push(build_placement_record(
        skill,
        location,
        &source,
        &destination,
    )?);
    write_registry(db, &registry)?;
    placement_for_location(db, skill, location)
}

pub(crate) fn withdraw(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    location: SkillLocation,
) -> Result<SkillPlacement, AppError> {
    let placement_target = target_for_location(db, &skill.target, location)?;
    let source_root = source_root(db, &skill.target)?;
    if placement_target.physical_path == physical_path(&source_root)? {
        return Err(AppError::Conflict(
            "该位置同时保存 Skill 主副本，不能独立撤回".to_string(),
        ));
    }
    let source = source_root.join(&skill.directory);
    let destination = placement_target.path.join(&skill.directory);
    let physical_destination = physical_entry_path(&destination)?;
    let mut registry = read_registry(db)?;
    validate_source_record(&registry, skill, &source)?;
    let Some(index) = registry
        .placements
        .iter()
        .position(|record| record.physical_destination_path == physical_destination)
    else {
        if destination.exists() || SkillService::is_symlink(&destination) {
            return Err(AppError::Conflict(
                "目标已存在但未接管，不能撤回".to_string(),
            ));
        }
        return placement_for_location(db, skill, location);
    };
    if !same_asset(
        &registry.placements[index].target,
        &registry.placements[index].id,
        skill,
    ) {
        return Err(AppError::Conflict(
            "目标归属于其他 Skill 或 scope，不能撤回".to_string(),
        ));
    }
    if !(destination.exists() || SkillService::is_symlink(&destination)) {
        registry.placements.remove(index);
        write_registry(db, &registry)?;
        return placement_for_location(db, skill, location);
    }
    let current = fingerprint(&destination)?;
    if current != registry.placements[index].fingerprint
        || content_fingerprint(&destination)? != registry.placements[index].content_fingerprint
        || !entry_shape_matches(&registry.placements[index])?
    {
        return Err(AppError::Conflict(
            "受管投放已被外部修改，不能撤回".to_string(),
        ));
    }

    let checkpoint = PlacementCheckpoint::capture(db, std::slice::from_ref(&destination))?;
    let mut target_mutated = false;
    let result = (|| {
        if physical_entry_path(&destination)? != physical_destination {
            return Err(AppError::Conflict(
                "投放条目在撤回前解析到了其他物理位置".to_string(),
            ));
        }
        ensure_placement_entry_unchanged(
            &registry.placements[index],
            &destination,
            "受管投放在撤回快照期间发生变化",
        )?;
        target_mutated = true;
        // remove_path checks the leaf with symlink_metadata and never follows a
        // managed link into its external target.
        SkillService::remove_path(&destination)?;
        registry.placements.remove(index);
        write_registry(db, &registry)
    })();
    if let Err(error) = result {
        if !target_mutated {
            return Err(error);
        }
        return Err(rollback_after_error(
            checkpoint,
            db,
            destination.parent().unwrap_or(Path::new(".")),
            true,
            error,
        ));
    }
    placement_for_location(db, skill, location)
}

fn placement_for_location(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    location: SkillLocation,
) -> Result<SkillPlacement, AppError> {
    placements(db, skill)?
        .into_iter()
        .find(|placement| placement.target.aliases.contains(&location))
        .ok_or_else(|| AppError::InvalidInput("未知投放位置".to_string()))
}

fn build_placement_record(
    skill: &InstalledSkill,
    location: SkillLocation,
    source: &Path,
    destination: &Path,
) -> Result<PlacementRecord, AppError> {
    let symlink = SkillService::is_symlink(destination);
    let symlink_target = if symlink {
        Some(fs::read_link(destination).map_err(|error| AppError::io(destination, error))?)
    } else {
        None
    };
    Ok(PlacementRecord {
        target: skill.target.clone(),
        id: skill.id.clone(),
        directory: skill.directory.clone(),
        location,
        source_path: source.to_path_buf(),
        destination_path: destination.to_path_buf(),
        physical_destination_path: physical_entry_path(destination)?,
        fingerprint: fingerprint(destination)?,
        content_fingerprint: content_fingerprint(destination)?,
        entry_type: if symlink {
            PlacementEntryType::Symlink
        } else {
            PlacementEntryType::Copy
        },
        symlink_target,
    })
}

fn place_source(
    source: &Path,
    destination: &Path,
    auto_copy_existing_directory: bool,
) -> Result<(), AppError> {
    match get_settings().sync_method {
        SyncMethod::Symlink => SkillService::create_symlink(source, destination, false),
        SyncMethod::Copy => replace_with_copy(source, destination),
        SyncMethod::Auto if auto_copy_existing_directory => replace_with_copy(source, destination),
        SyncMethod::Auto => match SkillService::create_symlink(source, destination, false) {
            Ok(()) => Ok(()),
            Err(error) => {
                log::warn!(
                    "创建 Skill 投放链接失败，回退复制: {} -> {}: {error}",
                    source.display(),
                    destination.display()
                );
                replace_with_copy(source, destination)
            }
        },
    }
}

fn replace_with_copy(source: &Path, destination: &Path) -> Result<(), AppError> {
    let parent = destination.parent().ok_or_else(|| {
        AppError::InvalidInput(format!("无效投放路径: {}", destination.display()))
    })?;
    fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    let guard = tempfile::Builder::new()
        .prefix(".acm-skill-placement-")
        .tempdir_in(parent)
        .map_err(|error| AppError::io(parent, error))?;
    let staged = guard.path().join("skill");
    copy_source(source, &staged)?;
    if destination.exists() || SkillService::is_symlink(destination) {
        SkillService::remove_path(destination)?;
    }
    fs::rename(&staged, destination).map_err(|error| AppError::IoContext {
        context: format!(
            "替换 Skill 投放失败: {} -> {}",
            staged.display(),
            destination.display()
        ),
        source: error,
    })
}

fn rollback_after_error(
    checkpoint: PlacementCheckpoint,
    db: &Arc<Database>,
    parent: &Path,
    parent_preexisted: bool,
    original: AppError,
) -> AppError {
    match checkpoint.restore(db) {
        Ok(()) => {
            if !parent_preexisted {
                let _ = fs::remove_dir(parent);
            }
            original
        }
        Err(rollback) => {
            AppError::Conflict(format!("操作失败: {original}；回滚也失败: {rollback}"))
        }
    }
}

fn validate_skill_directory(path: &Path) -> Result<(), AppError> {
    let resolved = path
        .canonicalize()
        .map_err(|error| AppError::io(path, error))?;
    if !resolved.is_dir() || !resolved.join("SKILL.md").is_file() {
        return Err(AppError::InvalidInput(format!(
            "Skill 主副本不存在或缺少 SKILL.md: {}",
            path.display()
        )));
    }
    validate_symlink_graph(&resolved)
}

/// Fingerprints an entry without following symlinks. Hidden files, relative
/// paths, entry kinds, link targets, and file bytes are all included.
pub(crate) fn fingerprint(path: &Path) -> Result<String, AppError> {
    let mut hasher = Sha256::new();
    hash_entry(path, Path::new(""), &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Content comparison used by explicit adoption. A top-level source link is
/// treated as the explicitly selected source; links inside it remain identity
/// bearing entries and are not followed by the hash traversal.
pub(crate) fn content_fingerprint(path: &Path) -> Result<String, AppError> {
    let resolved = path
        .canonicalize()
        .map_err(|error| AppError::io(path, error))?;
    validate_symlink_graph(&resolved)?;
    let mut hasher = Sha256::new();
    hash_content_entry(&resolved, Path::new(""), &resolved, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_content_entry(
    path: &Path,
    relative: &Path,
    root: &Path,
    hasher: &mut Sha256,
) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| AppError::io(path, error))?;
    hash_path(relative, hasher);
    if metadata.file_type().is_symlink() {
        hasher.update(b"L\0");
        let resolved = path
            .canonicalize()
            .map_err(|error| AppError::io(path, error))?;
        let target_relative = resolved.strip_prefix(root).map_err(|_| {
            AppError::InvalidInput(format!("Skill 内部链接越出来源边界: {}", path.display()))
        })?;
        hash_path(target_relative, hasher);
        hasher.update(if resolved.is_dir() { b"D" } else { b"F" });
    } else if metadata.is_dir() {
        hasher.update(b"D\0");
        let mut entries = fs::read_dir(path)
            .map_err(|error| AppError::io(path, error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::io(path, error))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            hash_content_entry(
                &entry.path(),
                &relative.join(entry.file_name()),
                root,
                hasher,
            )?;
        }
    } else if metadata.is_file() {
        hasher.update(b"F\0");
        let mut file = fs::File::open(path).map_err(|error| AppError::io(path, error))?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| AppError::io(path, error))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
    } else {
        return Err(AppError::InvalidInput(format!(
            "Skill 包含不支持的文件类型: {}",
            path.display()
        )));
    }
    hasher.update(b"\0E\0");
    Ok(())
}

fn hash_entry(path: &Path, relative: &Path, hasher: &mut Sha256) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| AppError::io(path, error))?;
    hash_path(relative, hasher);
    if metadata.file_type().is_symlink() {
        hasher.update(b"L\0");
        let target = fs::read_link(path).map_err(|error| AppError::io(path, error))?;
        hash_os_path(&target, hasher);
    } else if metadata.is_dir() {
        hasher.update(b"D\0");
        let mut entries = fs::read_dir(path)
            .map_err(|error| AppError::io(path, error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::io(path, error))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            hash_entry(&entry.path(), &relative.join(entry.file_name()), hasher)?;
        }
    } else if metadata.is_file() {
        hasher.update(b"F\0");
        let mut file = fs::File::open(path).map_err(|error| AppError::io(path, error))?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| AppError::io(path, error))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
    } else {
        return Err(AppError::InvalidInput(format!(
            "Skill 包含不支持的文件类型: {}",
            path.display()
        )));
    }
    hasher.update(b"\0E\0");
    Ok(())
}

fn hash_path(path: &Path, hasher: &mut Sha256) {
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(b"\0");
}

fn hash_os_path(path: &Path, hasher: &mut Sha256) {
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(b"\0");
}

fn hash_fields(fields: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for field in fields {
        hasher.update(field.as_bytes());
        hasher.update(b"\0");
    }
    format!("{:x}", hasher.finalize())
}

fn revision_for_path(path: &Path) -> Result<String, AppError> {
    if path.exists() || SkillService::is_symlink(path) {
        let entry_fingerprint = fingerprint(path)?;
        let physical_entry = physical_entry_path(path)?;
        Ok(hash_fields(&[
            "present",
            &entry_fingerprint,
            &physical_entry.to_string_lossy(),
        ]))
    } else {
        Ok(hash_fields(&[
            "absent",
            &physical_entry_path(path)?.to_string_lossy(),
        ]))
    }
}

fn target_root_issue(path: &Path) -> Option<String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() && !path.is_dir() => Some(format!(
            "投放根目录链接不可用或未指向目录: {}",
            path.display()
        )),
        Ok(metadata) if !metadata.is_dir() && !metadata.file_type().is_symlink() => {
            Some(format!("投放根路径已被普通文件占用: {}", path.display()))
        }
        Ok(metadata) if metadata.is_dir() => fs::read_dir(path)
            .err()
            .map(|error| format!("无法读取投放根目录 {}: {error}", path.display())),
        Ok(_) => None,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => Some(format!("无法读取投放根目录 {}: {error}", path.display())),
    }
}

/// Resolves existing symlinked ancestors and appends a non-existing suffix.
pub(crate) fn physical_path(path: &Path) -> Result<PathBuf, AppError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| AppError::io(path, error))?
            .join(path)
    };
    if let Ok(canonical) = absolute.canonicalize() {
        return Ok(canonical);
    }
    let mut cursor = absolute.as_path();
    let mut suffix = Vec::new();
    loop {
        if let Ok(canonical) = cursor.canonicalize() {
            let mut result = canonical;
            for component in suffix.iter().rev() {
                result.push(component);
            }
            return Ok(lexical_normalize(&result));
        }
        let name = cursor.file_name().ok_or_else(|| {
            AppError::InvalidInput(format!("无法解析物理路径: {}", path.display()))
        })?;
        suffix.push(name.to_os_string());
        cursor = cursor.parent().ok_or_else(|| {
            AppError::InvalidInput(format!("无法解析物理路径: {}", path.display()))
        })?;
    }
}

fn physical_entry_path(path: &Path) -> Result<PathBuf, AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("无效目录条目路径: {}", path.display())))?;
    let name = path
        .file_name()
        .ok_or_else(|| AppError::InvalidInput(format!("无效目录条目路径: {}", path.display())))?;
    Ok(physical_path(parent)?.join(name))
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !result.pop() {
                    result.push(component.as_os_str());
                }
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

fn paths_overlap(left: &Path, right: &Path) -> bool {
    left == right || left.starts_with(right) || right.starts_with(left)
}

/// Copies one filesystem entry exactly for managed storage migration. Unlike
/// `copy_source`, this accepts generic directories and preserves top-level and
/// nested symlinks without following them.
pub(crate) fn copy_entry_exact(source: &Path, destination: &Path) -> Result<(), AppError> {
    if destination.exists() || SkillService::is_symlink(destination) {
        return Err(AppError::Conflict(format!(
            "精确复制目标已存在: {}",
            destination.display()
        )));
    }
    let source_identity = physical_entry_path(source)?;
    let destination_identity = physical_entry_path(destination)?;
    let current = std::env::current_dir().map_err(|error| AppError::io(source, error))?;
    let source_lexical = lexical_normalize(&if source.is_absolute() {
        source.to_path_buf()
    } else {
        current.join(source)
    });
    let destination_lexical = lexical_normalize(&if destination.is_absolute() {
        destination.to_path_buf()
    } else {
        current.join(destination)
    });
    if paths_overlap(&source_identity, &destination_identity)
        || paths_overlap(&source_lexical, &destination_lexical)
    {
        return Err(AppError::InvalidInput(
            "精确复制源与目标路径重叠".to_string(),
        ));
    }

    let metadata = fs::symlink_metadata(source).map_err(|error| AppError::io(source, error))?;
    let parent = destination.parent().ok_or_else(|| {
        AppError::InvalidInput(format!("无效精确复制目标: {}", destination.display()))
    })?;
    let parent_preexisted = parent.exists();
    fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    let guard = tempfile::Builder::new()
        .prefix(".acm-skill-exact-copy-")
        .tempdir_in(parent)
        .map_err(|error| AppError::io(parent, error))?;
    let staged = guard.path().join("entry");
    let result = (|| {
        if metadata.file_type().is_symlink() {
            let target = fs::read_link(source).map_err(|error| AppError::io(source, error))?;
            let is_file = source
                .metadata()
                .map(|value| value.is_file())
                .unwrap_or(false);
            SkillService::create_symlink(&target, &staged, is_file)?;
        } else if metadata.is_dir() {
            copy_tree_exact(source, &staged)?;
        } else if metadata.is_file() {
            fs::copy(source, &staged).map_err(|error| AppError::io(&staged, error))?;
            fs::set_permissions(&staged, metadata.permissions())
                .map_err(|error| AppError::io(&staged, error))?;
        } else {
            return Err(AppError::InvalidInput(format!(
                "无法精确复制不支持的文件类型: {}",
                source.display()
            )));
        }
        fs::rename(&staged, destination).map_err(|error| AppError::IoContext {
            context: format!(
                "提交精确复制失败: {} -> {}",
                staged.display(),
                destination.display()
            ),
            source: error,
        })
    })();
    if result.is_err() && !parent_preexisted {
        drop(guard);
        let _ = fs::remove_dir(parent);
    }
    result
}

/// Copies a Skill directory without following internal links. Every internal
/// link must resolve inside the explicit source boundary and the link graph
/// must not contain a cycle. Relative links are preserved; absolute internal
/// links are rewritten as relative links inside the copy.
pub(crate) fn copy_source(source: &Path, destination: &Path) -> Result<(), AppError> {
    if destination.exists() || SkillService::is_symlink(destination) {
        return Err(AppError::Conflict(format!(
            "复制目标已存在: {}",
            destination.display()
        )));
    }
    let root = source
        .canonicalize()
        .map_err(|error| AppError::io(source, error))?;
    validate_skill_directory(&root)?;
    let destination_physical = physical_path(destination)?;
    if paths_overlap(&root, &destination_physical) {
        return Err(AppError::InvalidInput(
            "Skill 复制源与目标目录重叠".to_string(),
        ));
    }
    let parent = destination.parent().ok_or_else(|| {
        AppError::InvalidInput(format!("无效 Skill 复制目标: {}", destination.display()))
    })?;
    let parent_preexisted = parent.exists();
    fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    let guard = tempfile::Builder::new()
        .prefix(".acm-skill-copy-")
        .tempdir_in(parent)
        .map_err(|error| AppError::io(parent, error))?;
    let staged = guard.path().join("skill");
    let result = copy_tree_rewriting_links(&root, &root, &staged, &staged).and_then(|()| {
        fs::rename(&staged, destination).map_err(|error| AppError::IoContext {
            context: format!(
                "提交 Skill 复制失败: {} -> {}",
                staged.display(),
                destination.display()
            ),
            source: error,
        })
    });
    if result.is_err() && !parent_preexisted {
        drop(guard);
        let _ = fs::remove_dir(parent);
    }
    result
}

fn validate_symlink_graph(root: &Path) -> Result<(), AppError> {
    fn visit(
        directory: &Path,
        root: &Path,
        active: &mut HashSet<PathBuf>,
        complete: &mut HashSet<PathBuf>,
    ) -> Result<(), AppError> {
        let real = directory
            .canonicalize()
            .map_err(|error| AppError::io(directory, error))?;
        if !real.starts_with(root) {
            return Err(AppError::InvalidInput(format!(
                "Skill 内部链接越出来源边界: {}",
                directory.display()
            )));
        }
        if active.contains(&real) {
            return Err(AppError::InvalidInput(format!(
                "Skill 内部链接形成目录循环: {}",
                directory.display()
            )));
        }
        if complete.contains(&real) {
            return Ok(());
        }
        active.insert(real.clone());
        for entry in fs::read_dir(&real).map_err(|error| AppError::io(&real, error))? {
            let entry = entry.map_err(|error| AppError::io(&real, error))?;
            let path = entry.path();
            let metadata =
                fs::symlink_metadata(&path).map_err(|error| AppError::io(&path, error))?;
            if metadata.file_type().is_symlink() {
                let target = path
                    .canonicalize()
                    .map_err(|error| AppError::io(&path, error))?;
                if !target.starts_with(root) {
                    return Err(AppError::InvalidInput(format!(
                        "Skill 内部链接越出来源边界: {}",
                        path.display()
                    )));
                }
                if target.is_dir() {
                    visit(&target, root, active, complete)?;
                }
            } else if metadata.is_dir() {
                visit(&path, root, active, complete)?;
            } else if !metadata.is_file() {
                return Err(AppError::InvalidInput(format!(
                    "Skill 包含不支持的文件类型: {}",
                    path.display()
                )));
            }
        }
        active.remove(&real);
        complete.insert(real);
        Ok(())
    }

    let canonical = root
        .canonicalize()
        .map_err(|error| AppError::io(root, error))?;
    let mut active = HashSet::new();
    let mut complete = HashSet::new();
    visit(&canonical, &canonical, &mut active, &mut complete)
}

fn copy_tree_rewriting_links(
    current: &Path,
    source_root: &Path,
    destination: &Path,
    destination_root: &Path,
) -> Result<(), AppError> {
    fs::create_dir(destination).map_err(|error| AppError::io(destination, error))?;
    let mut entries = fs::read_dir(current)
        .map_err(|error| AppError::io(current, error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::io(current, error))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let source_entry = entry.path();
        let destination_entry = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_entry)
            .map_err(|error| AppError::io(&source_entry, error))?;
        if metadata.file_type().is_symlink() {
            let raw =
                fs::read_link(&source_entry).map_err(|error| AppError::io(&source_entry, error))?;
            let resolved = source_entry
                .canonicalize()
                .map_err(|error| AppError::io(&source_entry, error))?;
            if !resolved.starts_with(source_root) {
                return Err(AppError::InvalidInput(format!(
                    "Skill 内部链接越出来源边界: {}",
                    source_entry.display()
                )));
            }
            let target = if raw.is_absolute() {
                let relative_in_source = resolved.strip_prefix(source_root).map_err(|_| {
                    AppError::InvalidInput("无法重写 Skill 内部绝对链接".to_string())
                })?;
                let mapped = destination_root.join(relative_in_source);
                relative_path(
                    destination_entry.parent().unwrap_or(destination_root),
                    &mapped,
                )?
            } else {
                raw
            };
            SkillService::create_symlink(&target, &destination_entry, resolved.is_file())?;
        } else if metadata.is_dir() {
            copy_tree_rewriting_links(
                &source_entry,
                source_root,
                &destination_entry,
                destination_root,
            )?;
        } else if metadata.is_file() {
            fs::copy(&source_entry, &destination_entry)
                .map_err(|error| AppError::io(&destination_entry, error))?;
            fs::set_permissions(&destination_entry, metadata.permissions())
                .map_err(|error| AppError::io(&destination_entry, error))?;
        } else {
            return Err(AppError::InvalidInput(format!(
                "Skill 包含不支持的文件类型: {}",
                source_entry.display()
            )));
        }
    }
    Ok(())
}

fn relative_path(from_directory: &Path, to: &Path) -> Result<PathBuf, AppError> {
    let from: Vec<_> = from_directory.components().collect();
    let to: Vec<_> = to.components().collect();
    if from.first().map(|part| part.as_os_str()) != to.first().map(|part| part.as_os_str()) {
        return Err(AppError::InvalidInput(
            "无法跨文件系统重写 Skill 内部绝对链接".to_string(),
        ));
    }
    let common = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    let mut result = PathBuf::new();
    for _ in common..from.len() {
        result.push("..");
    }
    for component in &to[common..] {
        result.push(component.as_os_str());
    }
    if result.as_os_str().is_empty() {
        result.push(".");
    }
    Ok(result)
}

#[derive(Debug)]
enum SnapshotKind {
    Missing,
    Symlink { target: PathBuf, is_file: bool },
    File { backup: PathBuf },
    Directory { backup: PathBuf },
}

#[derive(Debug)]
struct PathSnapshot {
    path: PathBuf,
    physical_entry_path: PathBuf,
    kind: SnapshotKind,
}

/// File and registry checkpoint for a caller's wider import/update/uninstall
/// transaction. On restore failure, the temporary recovery directory is kept
/// and its path is included in the returned error.
#[derive(Debug)]
pub(crate) struct PlacementCheckpoint {
    registry_json: Option<String>,
    snapshots: Vec<PathSnapshot>,
    temp: Option<tempfile::TempDir>,
}

impl PlacementCheckpoint {
    pub(crate) fn capture(db: &Arc<Database>, paths: &[PathBuf]) -> Result<Self, AppError> {
        let temp = tempfile::Builder::new()
            .prefix("acm-skill-placement-checkpoint-")
            .tempdir_in(config::get_hub_dir().parent().unwrap_or(Path::new(".")))
            .or_else(|_| tempfile::tempdir())
            .map_err(|error| AppError::IoContext {
                context: "创建 Skill 投放恢复快照失败".to_string(),
                source: error,
            })?;
        let mut snapshots = Vec::new();
        let mut seen = BTreeSet::new();
        for path in paths {
            let identity = physical_entry_path(path)?;
            if !seen.insert(identity.clone()) {
                continue;
            }
            let kind = snapshot_entry(path, temp.path(), snapshots.len())?;
            if physical_entry_path(path)? != identity {
                return Err(AppError::Conflict(format!(
                    "Skill 投放路径在快照期间解析到了其他物理条目: {}",
                    path.display()
                )));
            }
            snapshots.push(PathSnapshot {
                path: path.clone(),
                physical_entry_path: identity,
                kind,
            });
        }
        Ok(Self {
            registry_json: db.get_setting(REGISTRY_KEY)?,
            snapshots,
            temp: Some(temp),
        })
    }

    pub(crate) fn restore(mut self, db: &Arc<Database>) -> Result<(), AppError> {
        let mut errors = Vec::new();
        for snapshot in self.snapshots.iter().rev() {
            match physical_entry_path(&snapshot.path) {
                Ok(current) if current == snapshot.physical_entry_path => {}
                Ok(current) => {
                    errors.push(format!(
                        "回滚路径已解析到其他物理条目，拒绝操作: {} (captured: {}, current: {})",
                        snapshot.path.display(),
                        snapshot.physical_entry_path.display(),
                        current.display()
                    ));
                    continue;
                }
                Err(error) => {
                    errors.push(format!(
                        "回滚前无法核验物理条目 {}: {error}",
                        snapshot.path.display()
                    ));
                    continue;
                }
            }
            if snapshot_matches(snapshot).unwrap_or(false) {
                continue;
            }
            if let Err(error) = restore_snapshot(snapshot) {
                errors.push(error.to_string());
            }
        }
        if let Err(error) = restore_registry_json(db, self.registry_json.as_deref()) {
            errors.push(error.to_string());
        }
        if errors.is_empty() {
            return Ok(());
        }
        let recovery = self
            .temp
            .take()
            .map(|guard| guard.keep())
            .unwrap_or_default();
        Err(AppError::Conflict(format!(
            "Skill 投放回滚失败；恢复材料保留在 {}：{}",
            recovery.display(),
            errors.join("；")
        )))
    }
}

fn snapshot_matches(snapshot: &PathSnapshot) -> Result<bool, AppError> {
    match &snapshot.kind {
        SnapshotKind::Missing => {
            Ok(!(snapshot.path.exists() || SkillService::is_symlink(&snapshot.path)))
        }
        SnapshotKind::Symlink { target, .. } => {
            if !SkillService::is_symlink(&snapshot.path) {
                return Ok(false);
            }
            Ok(fs::read_link(&snapshot.path)
                .map_err(|error| AppError::io(&snapshot.path, error))?
                == *target)
        }
        SnapshotKind::File { backup } | SnapshotKind::Directory { backup } => {
            if !(snapshot.path.exists() || SkillService::is_symlink(&snapshot.path)) {
                return Ok(false);
            }
            Ok(fingerprint(&snapshot.path)? == fingerprint(backup)?)
        }
    }
}

fn restore_registry_json(db: &Database, raw: Option<&str>) -> Result<(), AppError> {
    if db.get_setting(REGISTRY_KEY)?.as_deref() == raw {
        return Ok(());
    }
    db.transact(|connection| {
        match raw {
            Some(value) => {
                connection.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                    rusqlite::params![REGISTRY_KEY, value],
                )?;
            }
            None => {
                connection.execute(
                    "DELETE FROM settings WHERE key = ?1",
                    rusqlite::params![REGISTRY_KEY],
                )?;
            }
        }
        Ok(())
    })
}

fn snapshot_entry(path: &Path, root: &Path, index: usize) -> Result<SnapshotKind, AppError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SnapshotKind::Missing)
        }
        Err(error) => return Err(AppError::io(path, error)),
    };
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(path).map_err(|error| AppError::io(path, error))?;
        let is_file = path.metadata().map(|meta| meta.is_file()).unwrap_or(false);
        return Ok(SnapshotKind::Symlink { target, is_file });
    }
    let backup = root.join(format!("entry-{index}"));
    if metadata.is_dir() {
        copy_tree_exact(path, &backup)?;
        Ok(SnapshotKind::Directory { backup })
    } else if metadata.is_file() {
        fs::copy(path, &backup).map_err(|error| AppError::io(&backup, error))?;
        fs::set_permissions(&backup, metadata.permissions())
            .map_err(|error| AppError::io(&backup, error))?;
        Ok(SnapshotKind::File { backup })
    } else {
        Err(AppError::InvalidInput(format!(
            "无法快照不支持的文件类型: {}",
            path.display()
        )))
    }
}

fn restore_snapshot(snapshot: &PathSnapshot) -> Result<(), AppError> {
    if snapshot.path.exists() || SkillService::is_symlink(&snapshot.path) {
        SkillService::remove_path(&snapshot.path)?;
    }
    match &snapshot.kind {
        SnapshotKind::Missing => Ok(()),
        SnapshotKind::Symlink { target, is_file } => {
            let parent = snapshot
                .path
                .parent()
                .ok_or_else(|| AppError::InvalidInput("无效快照恢复路径".to_string()))?;
            fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
            SkillService::create_symlink(target, &snapshot.path, *is_file)
        }
        SnapshotKind::File { backup } => {
            let parent = snapshot
                .path
                .parent()
                .ok_or_else(|| AppError::InvalidInput("无效快照恢复路径".to_string()))?;
            fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
            fs::copy(backup, &snapshot.path)
                .map_err(|error| AppError::io(&snapshot.path, error))?;
            let permissions = fs::metadata(backup)
                .map_err(|error| AppError::io(backup, error))?
                .permissions();
            fs::set_permissions(&snapshot.path, permissions)
                .map_err(|error| AppError::io(&snapshot.path, error))
        }
        SnapshotKind::Directory { backup } => copy_tree_exact(backup, &snapshot.path),
    }
}

fn copy_tree_exact(source: &Path, destination: &Path) -> Result<(), AppError> {
    fs::create_dir(destination).map_err(|error| AppError::io(destination, error))?;
    for entry in fs::read_dir(source).map_err(|error| AppError::io(source, error))? {
        let entry = entry.map_err(|error| AppError::io(source, error))?;
        let source_entry = entry.path();
        let destination_entry = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_entry)
            .map_err(|error| AppError::io(&source_entry, error))?;
        if metadata.file_type().is_symlink() {
            let target =
                fs::read_link(&source_entry).map_err(|error| AppError::io(&source_entry, error))?;
            let is_file = source_entry
                .metadata()
                .map(|meta| meta.is_file())
                .unwrap_or(false);
            SkillService::create_symlink(&target, &destination_entry, is_file)?;
        } else if metadata.is_dir() {
            copy_tree_exact(&source_entry, &destination_entry)?;
        } else if metadata.is_file() {
            fs::copy(&source_entry, &destination_entry)
                .map_err(|error| AppError::io(&destination_entry, error))?;
            fs::set_permissions(&destination_entry, metadata.permissions())
                .map_err(|error| AppError::io(&destination_entry, error))?;
        } else {
            return Err(AppError::InvalidInput(format!(
                "无法快照不支持的文件类型: {}",
                source_entry.display()
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::skill::SkillApps;
    use serial_test::serial;
    use std::ffi::OsString;

    struct TestHome {
        _temp: tempfile::TempDir,
        previous: Option<OsString>,
    }

    impl TestHome {
        fn new() -> Self {
            let temp = tempfile::tempdir().expect("temp home");
            let previous = std::env::var_os(config::ACM_HOME_ENV);
            std::env::set_var(config::ACM_HOME_ENV, temp.path());
            crate::settings::reset_settings_store_for_test();
            Self {
                _temp: temp,
                previous,
            }
        }
    }

    impl Drop for TestHome {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                std::env::set_var(config::ACM_HOME_ENV, previous);
            } else {
                std::env::remove_var(config::ACM_HOME_ENV);
            }
            crate::settings::reset_settings_store_for_test();
        }
    }

    fn test_skill() -> InstalledSkill {
        InstalledSkill {
            id: "test-skill".to_string(),
            name: "Test Skill".to_string(),
            description: None,
            directory: "test-skill".to_string(),
            repo_owner: None,
            repo_name: None,
            repo_branch: None,
            readme_url: None,
            apps: SkillApps::default(),
            installed_at: 1,
            content_hash: None,
            updated_at: 1,
            target: ScopeTarget::Global,
        }
    }

    fn prepare_source(db: &Arc<Database>, skill: &InstalledSkill) -> PathBuf {
        let source = source_root(db, &skill.target)
            .unwrap()
            .join(&skill.directory);
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "# test\n").unwrap();
        fs::write(source.join(".hidden"), "one").unwrap();
        register_source(db, skill).unwrap();
        source
    }

    fn location_placement(
        db: &Arc<Database>,
        skill: &InstalledSkill,
        location: SkillLocation,
    ) -> SkillPlacement {
        placements(db, skill)
            .unwrap()
            .into_iter()
            .find(|placement| placement.target.aliases.contains(&location))
            .unwrap()
    }

    #[test]
    #[serial]
    fn shared_and_codex_are_independent_owned_entries() {
        let _home = TestHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let skill = test_skill();
        prepare_source(&db, &skill);

        sync(&db, &skill, SkillLocation::Shared).unwrap();
        sync(&db, &skill, SkillLocation::Codex).unwrap();
        withdraw(&db, &skill, SkillLocation::Codex).unwrap();

        assert_eq!(
            location_placement(&db, &skill, SkillLocation::Shared).state,
            "placed"
        );
        assert_eq!(
            location_placement(&db, &skill, SkillLocation::Codex).state,
            "absent"
        );
    }

    #[test]
    #[serial]
    fn unmanaged_same_content_requires_explicit_adopt() {
        let _home = TestHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let skill = test_skill();
        let source = prepare_source(&db, &skill);
        let shared = target_for_location(&db, &skill.target, SkillLocation::Shared).unwrap();
        let destination = shared.path.join(&skill.directory);
        copy_source(&source, &destination).unwrap();

        let preview = location_placement(&db, &skill, SkillLocation::Shared);
        assert_eq!(preview.state, "unmanaged");
        adopt(&db, &skill, SkillLocation::Shared, &preview.revision).unwrap();
        assert_eq!(
            location_placement(&db, &skill, SkillLocation::Shared).state,
            "placed"
        );
    }

    #[test]
    #[serial]
    fn different_same_name_content_is_never_overwritten_or_adopted() {
        let _home = TestHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let skill = test_skill();
        prepare_source(&db, &skill);
        let shared = target_for_location(&db, &skill.target, SkillLocation::Shared).unwrap();
        let destination = shared.path.join(&skill.directory);
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("SKILL.md"), "# other\n").unwrap();

        let preview = location_placement(&db, &skill, SkillLocation::Shared);
        assert_eq!(preview.state, "unmanaged");
        assert!(sync(&db, &skill, SkillLocation::Shared).is_err());
        assert!(adopt(&db, &skill, SkillLocation::Shared, &preview.revision).is_err());
        assert_eq!(
            fs::read_to_string(destination.join("SKILL.md")).unwrap(),
            "# other\n"
        );
    }

    #[test]
    #[serial]
    fn hidden_external_change_conflicts_and_missing_entry_can_be_reconciled() {
        let _home = TestHome::new();
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();
        let db = Arc::new(Database::memory().unwrap());
        let skill = test_skill();
        prepare_source(&db, &skill);
        sync(&db, &skill, SkillLocation::Codex).unwrap();
        let codex = target_for_location(&db, &skill.target, SkillLocation::Codex).unwrap();
        let destination = codex.path.join(&skill.directory);

        fs::write(destination.join(".hidden"), "changed").unwrap();
        assert_eq!(
            location_placement(&db, &skill, SkillLocation::Codex).state,
            "conflict"
        );
        assert!(withdraw(&db, &skill, SkillLocation::Codex).is_err());

        fs::write(destination.join(".hidden"), "one").unwrap();
        SkillService::remove_path(&destination).unwrap();
        let missing = location_placement(&db, &skill, SkillLocation::Codex);
        assert_eq!(missing.state, "absent");
        assert!(missing.withdrawable);
        sync(&db, &skill, SkillLocation::Codex).unwrap();
        SkillService::remove_path(&destination).unwrap();
        withdraw(&db, &skill, SkillLocation::Codex).unwrap();
        let cleared = location_placement(&db, &skill, SkillLocation::Codex);
        assert_eq!(cleared.state, "absent");
        assert!(cleared.reason.is_none());
    }

    #[test]
    #[serial]
    fn physical_root_aliases_are_one_linked_target() {
        let home = TestHome::new();
        let shared_config = home._temp.path().join(".agents");
        crate::settings::set_agent_config_dir_override(
            "codex",
            Some(shared_config.display().to_string()),
        )
        .unwrap();
        let db = Arc::new(Database::memory().unwrap());
        let grouped = targets(&db, &ScopeTarget::Global).unwrap();
        let shared = grouped
            .iter()
            .find(|target| target.aliases.contains(&SkillLocation::Shared))
            .unwrap();
        assert!(shared.aliases.contains(&SkillLocation::Shared));
        assert!(shared.aliases.contains(&SkillLocation::Codex));
        assert_eq!(
            grouped
                .iter()
                .filter(|target| target.aliases.contains(&SkillLocation::Codex))
                .count(),
            1
        );
    }

    #[test]
    #[serial]
    fn master_root_overlap_is_placed_but_not_withdrawable() {
        let _home = TestHome::new();
        crate::settings::set_storage_location(StorageLocation::Unified).unwrap();
        let db = Arc::new(Database::memory().unwrap());
        let skill = test_skill();
        prepare_source(&db, &skill);

        let shared = location_placement(&db, &skill, SkillLocation::Shared);
        assert_eq!(shared.state, "placed");
        assert!(shared.source_is_target);
        assert!(!shared.withdrawable);
        assert!(withdraw(&db, &skill, SkillLocation::Shared).is_err());
    }

    #[test]
    #[serial]
    fn unregistered_master_overlap_is_not_reported_as_owned() {
        let _home = TestHome::new();
        crate::settings::set_storage_location(StorageLocation::Unified).unwrap();
        let db = Arc::new(Database::memory().unwrap());
        let skill = test_skill();
        let source = source_root(&db, &skill.target)
            .unwrap()
            .join(&skill.directory);
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "# unregistered\n").unwrap();

        assert!(owned_locations(&db, &skill).unwrap().is_empty());
        assert_eq!(
            location_placement(&db, &skill, SkillLocation::Shared).state,
            "conflict"
        );
    }

    #[test]
    #[serial]
    fn placement_revision_includes_physical_entry_identity() {
        let _home = TestHome::new();
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first/skill");
        let second = temp.path().join("second/skill");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("SKILL.md"), "# same\n").unwrap();
        fs::write(second.join("SKILL.md"), "# same\n").unwrap();

        assert_eq!(fingerprint(&first).unwrap(), fingerprint(&second).unwrap());
        assert_ne!(
            revision_for_path(&first).unwrap(),
            revision_for_path(&second).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn physical_path_resolves_symlink_before_parent_components() {
        let _home = TestHome::new();
        let temp = tempfile::tempdir().unwrap();
        let logical_root = temp.path().join("logical");
        let physical_parent = temp.path().join("physical/child");
        fs::create_dir_all(&logical_root).unwrap();
        fs::create_dir_all(&physical_parent).unwrap();
        std::os::unix::fs::symlink(&physical_parent, logical_root.join("alias")).unwrap();

        let unresolved = logical_root.join("alias/../new-target");
        assert_eq!(
            physical_path(&unresolved).unwrap(),
            physical_parent
                .parent()
                .unwrap()
                .canonicalize()
                .unwrap()
                .join("new-target")
        );
    }

    #[test]
    #[serial]
    fn project_placement_guard_includes_missing_owned_entries() {
        let home = TestHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let project_root = home._temp.path().join("project");
        fs::create_dir_all(&project_root).unwrap();
        let project =
            ProjectService::add_project(&db, &project_root, Some("Project".to_string())).unwrap();
        let mut skill = test_skill();
        skill.target = ScopeTarget::Project {
            project_id: project.project_id.clone(),
        };
        prepare_source(&db, &skill);
        sync(&db, &skill, SkillLocation::Codex).unwrap();
        let destination = target_for_location(&db, &skill.target, SkillLocation::Codex)
            .unwrap()
            .path
            .join(&skill.directory);
        SkillService::remove_path(&destination).unwrap();

        assert!(has_project_placements(&db, &project.project_id).unwrap());
    }

    #[test]
    #[serial]
    fn registry_write_failure_restores_new_filesystem_entry() {
        let _home = TestHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let skill = test_skill();
        prepare_source(&db, &skill);
        let destination = target_for_location(&db, &skill.target, SkillLocation::Shared)
            .unwrap()
            .path
            .join(&skill.directory);
        db.transact(|connection| {
            connection.execute_batch(
                "CREATE TRIGGER fail_skill_placement_update
                 BEFORE UPDATE ON settings
                 WHEN NEW.key = 'skill_placement_registry_v1'
                 BEGIN SELECT RAISE(ABORT, 'injected registry failure'); END;
                 CREATE TRIGGER fail_skill_placement_insert
                 BEFORE INSERT ON settings
                 WHEN NEW.key = 'skill_placement_registry_v1'
                 BEGIN SELECT RAISE(ABORT, 'injected registry failure'); END;",
            )?;
            Ok(())
        })
        .unwrap();

        let error = sync(&db, &skill, SkillLocation::Shared).unwrap_err();
        assert!(error.to_string().contains("injected registry failure"));
        assert!(!destination.exists());
        assert!(!SkillService::is_symlink(&destination));
        assert_eq!(
            location_placement(&db, &skill, SkillLocation::Shared).state,
            "absent"
        );
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn checkpoint_refuses_restore_after_parent_alias_retarget() {
        let _home = TestHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let temp = tempfile::tempdir().unwrap();
        let first_root = temp.path().join("first-root");
        let second_root = temp.path().join("second-root");
        let alias = temp.path().join("alias");
        fs::create_dir_all(&first_root).unwrap();
        fs::create_dir_all(&second_root).unwrap();
        std::os::unix::fs::symlink(&first_root, &alias).unwrap();
        let managed = alias.join("managed");
        fs::create_dir_all(&managed).unwrap();
        fs::write(managed.join("SKILL.md"), "# original\n").unwrap();
        let checkpoint = PlacementCheckpoint::capture(&db, std::slice::from_ref(&managed)).unwrap();

        fs::remove_file(&alias).unwrap();
        std::os::unix::fs::symlink(&second_root, &alias).unwrap();
        let external = second_root.join("managed");
        fs::create_dir_all(&external).unwrap();
        fs::write(external.join("KEEP"), "external").unwrap();

        let error = checkpoint.restore(&db).unwrap_err();
        assert!(error.to_string().contains("其他物理条目"));
        assert_eq!(
            fs::read_to_string(external.join("KEEP")).unwrap(),
            "external"
        );
        assert_eq!(
            fs::read_to_string(first_root.join("managed/SKILL.md")).unwrap(),
            "# original\n"
        );
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn exact_entry_copy_preserves_generic_and_top_level_symlinks() {
        let _home = TestHome::new();
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("generic-source");
        fs::create_dir_all(source.join("data")).unwrap();
        fs::write(source.join("data/value.txt"), "value").unwrap();
        std::os::unix::fs::symlink("data/value.txt", source.join("internal-link")).unwrap();

        let directory_copy = temp.path().join("copies/generic-copy");
        copy_entry_exact(&source, &directory_copy).unwrap();
        assert_eq!(
            fs::read_link(directory_copy.join("internal-link")).unwrap(),
            PathBuf::from("data/value.txt")
        );
        assert_eq!(
            fingerprint(&source).unwrap(),
            fingerprint(&directory_copy).unwrap()
        );

        let source_link = temp.path().join("source-link");
        std::os::unix::fs::symlink(&source, &source_link).unwrap();
        let link_copy = temp.path().join("copies/link-copy");
        copy_entry_exact(&source_link, &link_copy).unwrap();
        assert!(SkillService::is_symlink(&link_copy));
        assert_eq!(
            fs::read_link(&source_link).unwrap(),
            fs::read_link(&link_copy).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn safe_copy_keeps_internal_links_and_rejects_external_links() {
        let _home = TestHome::new();
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir_all(source.join("assets")).unwrap();
        fs::write(source.join("SKILL.md"), "# links\n").unwrap();
        fs::write(source.join("assets/data.txt"), "data").unwrap();
        std::os::unix::fs::symlink("assets/data.txt", source.join("data-link")).unwrap();
        let destination = temp.path().join("nested/copy");

        copy_source(&source, &destination).unwrap();
        assert!(SkillService::is_symlink(&destination.join("data-link")));
        assert_eq!(
            content_fingerprint(&source).unwrap(),
            content_fingerprint(&destination).unwrap()
        );

        std::os::unix::fs::symlink(temp.path(), source.join("external")).unwrap();
        let rejected = temp.path().join("rejected");
        assert!(copy_source(&source, &rejected).is_err());
        assert!(!rejected.exists());
    }
}
