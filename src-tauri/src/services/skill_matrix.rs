//! Scope-aware matrix over existing target-bound assets. Configuration state is
//! deliberately distinct from evidence that an Agent session loaded a skill.
use super::{
    project::{ConfigContext, ProjectService, ScopeTarget},
    skill::{InstalledSkill, SkillService},
    skill_placement::{self as placement, SkillLocation, SkillPlacement},
};
use crate::{database::Database, error::AppError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

const AGENTS: [SkillLocation; 4] = [
    SkillLocation::ClaudeCode,
    SkillLocation::Codex,
    SkillLocation::GeminiCli,
    SkillLocation::OpenCode,
];

const UNVERIFIED_EXCLUSION: &str =
    "该 Agent 的原生局部停用能力尚未验证；其他扫描目录中的 Skill 不能仅靠撤回此目录停用。";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixCell {
    pub agent: SkillLocation,
    pub checked: bool,
    pub origin: String,
    pub reason: Option<String>,
    pub revision: String,
    pub activation_mode: String,
    pub notice: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixRow {
    pub skill: InstalledSkill,
    pub target: ScopeTarget,
    pub cells: Vec<MatrixCell>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assignment {
    pub id: String,
    pub source_target: ScopeTarget,
    pub target: ScopeTarget,
    pub agent: SkillLocation,
    pub enabled: bool,
    pub expected_revision: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentResult {
    pub request: Assignment,
    pub applied: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentPreview {
    pub request: Assignment,
    pub checked: bool,
    pub reason: Option<String>,
}

pub fn preview(db: &Arc<Database>, requests: Vec<Assignment>) -> Vec<AssignmentPreview> {
    let mut previews = requests
        .into_iter()
        .map(|mut request| {
            let result = (|| {
                let skill = db
                    .get_installed_skill_for_target(&request.id, &request.source_target)?
                    .ok_or_else(|| conflict("来源 Skill 已不存在。"))?;
                cell(db, &skill, &request.target, request.agent)
            })();
            match result {
                Ok(cell) => {
                    request.expected_revision = cell.revision;
                    AssignmentPreview {
                        request,
                        checked: cell.checked,
                        reason: cell.reason,
                    }
                }
                Err(error) => AssignmentPreview {
                    request,
                    checked: false,
                    reason: Some(error.to_string()),
                },
            }
        })
        .collect::<Vec<_>>();
    let ambiguous = previews
        .iter()
        .map(|item| {
            previews.iter().any(|other| {
                other.request.id == item.request.id
                    && other.request.target == item.request.target
                    && other.request.agent == item.request.agent
                    && (other.request.enabled != item.request.enabled
                        || (!other.request.expected_revision.is_empty()
                            && !item.request.expected_revision.is_empty()
                            && other.request.expected_revision != item.request.expected_revision))
            })
        })
        .collect::<Vec<_>>();
    for (item, ambiguous) in previews.iter_mut().zip(ambiguous) {
        if ambiguous {
            item.reason =
                Some("同一目标同时选择了不同来源、版本或相反动作，请仅保留一种分配。".into());
        }
    }
    previews
}

fn conflict(message: impl Into<String>) -> AppError {
    AppError::Conflict(message.into())
}
fn source(db: &Arc<Database>, skill: &InstalledSkill) -> Result<PathBuf, AppError> {
    SkillService::require_valid_directory(&skill.directory)?;
    Ok(placement::source_root(db, &skill.target)?.join(&skill.directory))
}
fn compatible(a: &InstalledSkill, b: &InstalledSkill) -> bool {
    a.id == b.id
        && a.directory == b.directory
        && a.name == b.name
        && a.repo_owner == b.repo_owner
        && a.repo_name == b.repo_name
        && a.repo_branch.as_deref().unwrap_or("main") == b.repo_branch.as_deref().unwrap_or("main")
        && a.content_hash == b.content_hash
}
fn same_revision(db: &Arc<Database>, a: &InstalledSkill, b: &InstalledSkill) -> bool {
    compatible(a, b)
        && source(db, a)
            .and_then(|path| placement::content_fingerprint(&path))
            .ok()
            .zip(
                source(db, b)
                    .and_then(|path| placement::content_fingerprint(&path))
                    .ok(),
            )
            .is_some_and(|(left, right)| left == right)
}
fn own(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    target: &ScopeTarget,
) -> Result<Option<InstalledSkill>, AppError> {
    let found = db.get_installed_skill_for_target(&skill.id, target)?;
    if found
        .as_ref()
        .is_some_and(|other| !same_revision(db, skill, other))
    {
        return Err(conflict("目标已有同身份的不同版本，请在原目标核对版本。"));
    }
    Ok(found)
}
fn reads(agent: SkillLocation, location: SkillLocation, project: bool) -> bool {
    agent == location
        || match agent {
            SkillLocation::Codex => location == SkillLocation::Shared,
            SkillLocation::GeminiCli => {
                location == SkillLocation::Shared || (project && location == SkillLocation::Codex)
            }
            SkillLocation::OpenCode => {
                location == SkillLocation::Shared
                    || location == SkillLocation::ClaudeCode
                    || (project && location == SkillLocation::Codex)
            }
            _ => false,
        }
}
fn shared_with_other_agents(state: &SkillPlacement, agent: SkillLocation, project: bool) -> bool {
    AGENTS.iter().any(|other| {
        *other != agent
            && state
                .target
                .aliases
                .iter()
                .any(|location| reads(*other, *location, project))
    })
}

fn readable(
    states: &[SkillPlacement],
    agent: SkillLocation,
    project: bool,
) -> Vec<&SkillPlacement> {
    states
        .iter()
        .filter(|state| {
            state
                .target
                .aliases
                .iter()
                .any(|location| reads(agent, *location, project))
        })
        .collect()
}

// Config writes reject symbolic-link ancestors; application overrides must not
// give the matrix implicit ownership of arbitrary external config targets.
pub(crate) fn safe_path(path: &Path) -> Result<(), AppError> {
    for ancestor in path.ancestors().take(2) {
        if let Ok(meta) = fs::symlink_metadata(ancestor) {
            if meta.file_type().is_symlink() {
                return Err(conflict("配置路径包含符号链接，请在原生 Agent 中管理。"));
            }
            if ancestor != path && !meta.is_dir() {
                return Err(conflict("配置路径被文件占用。"));
            }
        }
    }
    Ok(())
}
fn document(path: &Path) -> Result<Value, AppError> {
    safe_path(path)?;
    let value = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| conflict("原生配置不是有效 JSON，请先在 Agent 中修复。"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(error) => return Err(AppError::io(path, error)),
    };
    if !value.is_object() {
        return Err(conflict("原生配置必须是 JSON 对象。"));
    }
    Ok(value)
}
fn policy_paths(
    db: &Arc<Database>,
    target: &ScopeTarget,
    agent: SkillLocation,
) -> Result<Vec<PathBuf>, AppError> {
    let Some(app) = agent.agent() else {
        return Err(conflict("共享目录不是 Agent。"));
    };
    let global = SkillService::get_app_skills_dir_for_target(db, &ScopeTarget::Global, &app)?;
    let mut paths = vec![global.parent().unwrap().join("settings.json")];
    if let Some(root) = ProjectService::resolve_scope_target(db, target)?.project_root {
        let dir = root.join(if agent == SkillLocation::ClaudeCode {
            ".claude"
        } else {
            ".gemini"
        });
        paths.push(dir.join("settings.json"));
        if agent == SkillLocation::ClaudeCode {
            paths.push(dir.join("settings.local.json"));
        }
    }
    Ok(paths)
}
fn policy_entry(value: &Value, agent: SkillLocation, name: &str) -> Result<Value, AppError> {
    if agent == SkillLocation::ClaudeCode {
        if let Some(overrides) = value.get("skillOverrides") {
            let map = overrides
                .as_object()
                .ok_or_else(|| conflict("skillOverrides 必须是对象。"))?;
            let entry = map.get(name).cloned().unwrap_or(Value::Null);
            if !entry.is_null()
                && !matches!(
                    entry.as_str(),
                    Some("on" | "off" | "name-only" | "user-invocable-only")
                )
            {
                return Err(conflict("该 Skill 的原生可见性配置无法识别。"));
            }
            return Ok(entry);
        }
    } else if let Some(skills) = value.get("skills") {
        if !skills.is_object() {
            return Err(conflict("skills 必须是对象。"));
        }
        if skills
            .get("enabled")
            .is_some_and(|flag| flag != &json!(true))
        {
            return Err(conflict(
                "Agent Skills 总开关已停用或无法识别，请在 Gemini CLI 中管理。",
            ));
        }
        if let Some(disabled) = skills.get("disabled") {
            let entries = disabled
                .as_array()
                .ok_or_else(|| conflict("skills.disabled 必须是数组。"))?;
            if entries.iter().any(|entry| !entry.is_string()) {
                return Err(conflict("skills.disabled 含有无法识别的条目。"));
            }
            return Ok(json!(entries
                .iter()
                .any(|entry| entry.as_str() == Some(name))));
        }
    }
    Ok(Value::Null)
}
fn policies(
    db: &Arc<Database>,
    target: &ScopeTarget,
    agent: SkillLocation,
    name: &str,
) -> Result<Vec<Value>, AppError> {
    if !matches!(agent, SkillLocation::ClaudeCode | SkillLocation::GeminiCli) {
        return Ok(vec![]);
    }
    policy_paths(db, target, agent)?
        .iter()
        .map(|path| policy_entry(&document(path)?, agent, name))
        .collect()
}
fn excluded(entries: &[Value], agent: SkillLocation) -> bool {
    if agent == SkillLocation::ClaudeCode {
        entries
            .iter()
            .rev()
            .find(|entry| !entry.is_null())
            .is_some_and(|entry| entry == "off")
    } else {
        entries.iter().any(|entry| entry == &json!(true))
    }
}

pub fn cell(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    target: &ScopeTarget,
    agent: SkillLocation,
) -> Result<MatrixCell, AppError> {
    if !AGENTS.contains(&agent) {
        return Err(conflict("共享目录不是 Agent。"));
    }
    ProjectService::resolve_scope_target(db, target)?;
    let local = own(db, skill, target)?;
    let states = local
        .as_ref()
        .map(|asset| placement::placements(db, asset))
        .transpose()?
        .unwrap_or_default();
    let globals = if matches!(target, ScopeTarget::Project { .. }) {
        db.get_all_installed_skills_for_target(&ScopeTarget::Global)?
            .into_values()
            .filter(|asset| same_revision(db, asset, skill))
            .map(|asset| placement::placements(db, &asset))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect()
    } else {
        vec![]
    };
    let project = matches!(target, ScopeTarget::Project { .. });
    let local_read = readable(&states, agent, project);
    let global_read = readable(&globals, agent, false);
    let inherited = global_read.iter().any(|state| state.state == "placed");
    let present = local_read.iter().any(|state| state.state == "placed") || inherited;
    let policy = policies(db, target, agent, &skill.name)?;
    let extra = if matches!(agent, SkillLocation::Codex | SkillLocation::OpenCode) {
        Some(super::skill_policy::state(
            db,
            skill,
            target,
            agent,
            &policy_skill_paths(db, skill, target, agent)?,
        )?)
    } else {
        None
    };
    let off = extra
        .as_ref()
        .map_or_else(|| excluded(&policy, agent), |state| state.excluded);
    let own_placement = states
        .iter()
        .find(|state| state.target.aliases.contains(&agent));
    let foreign_local = local_read.iter().any(|state| {
        state.state == "placed"
            && (!state.target.aliases.contains(&agent)
                || shared_with_other_agents(state, agent, project))
    });
    let mut reason = local_read
        .iter()
        .chain(global_read.iter())
        .find(|state| matches!(state.state.as_str(), "conflict" | "unmanaged"))
        .map(|state| {
            state
                .reason
                .clone()
                .unwrap_or_else(|| "目录需要核对或接管。".into())
        });
    if local.is_none() && !present {
        if let Err(error) = placement::ensure_owned_unchanged(db, skill) {
            reason = Some(error.to_string());
        }
    }
    if reason.is_none()
        && present
        && (inherited || foreign_local || own_placement.is_some_and(|state| !state.withdrawable))
        && !matches!(agent, SkillLocation::ClaudeCode | SkillLocation::GeminiCli)
        && !project
    {
        reason = Some(UNVERIFIED_EXCLUSION.into());
    }
    if let Some(policy_reason) = extra.as_ref().and_then(|state| state.reason.clone()) {
        reason = Some(policy_reason);
    }
    // Name-based policies also affect same-name local versions; never claim a
    // project/global version can be disabled independently in this case.
    let duplicates = db
        .get_all_installed_skills_for_target(target)?
        .values()
        .filter(|asset| asset.name == skill.name && asset.id != skill.id)
        .count();
    if reason.is_none() && duplicates > 0 {
        reason = Some("目标中存在同名的其他 Skill，原生按名称停用会同时影响它们。".into());
    }
    if project
        && db
            .get_all_installed_skills_for_target(&ScopeTarget::Global)?
            .values()
            .any(|asset| {
                asset.name == skill.name
                    && !same_revision(db, asset, skill)
                    && placement::placements(db, asset).is_ok_and(|states| {
                        readable(&states, agent, false)
                            .iter()
                            .any(|state| state.state == "placed")
                    })
            })
    {
        reason = Some(
            "存在同名的不同全局来源或版本，无法按此行独立停用，请先在目录与维护中核对。".into(),
        );
    }
    if agent == SkillLocation::GeminiCli
        && off
        && policy.len() > 1
        && excluded(&policy[..policy.len() - 1], agent)
    {
        reason = Some("上级原生配置仍停用此 Skill，请先在对应全局或项目配置中解除。".into());
    }
    if agent == SkillLocation::ClaudeCode
        && policy
            .iter()
            .rev()
            .find(|entry| !entry.is_null())
            .is_some_and(|entry| {
                matches!(entry.as_str(), Some("name-only" | "user-invocable-only"))
            })
    {
        reason = Some("该 Skill 使用原生精细可见性设置，请在 Claude Code 中管理。".into());
    }
    if skill.name.contains(':')
        || source(db, skill)?
            .join(".claude-plugin/plugin.json")
            .exists()
    {
        reason = Some("插件 Skill 的启停请在原生插件管理中处理。".into());
    }
    let observed = placement::targets(db, target)?
        .into_iter()
        .filter(|root| {
            root.aliases
                .iter()
                .any(|location| reads(agent, *location, project))
        })
        .map(|root| {
            let path = root.path.join(&skill.directory);
            let signature = if path.exists() || SkillService::is_symlink(&path) {
                Some((
                    placement::fingerprint(&path)?,
                    placement::content_fingerprint(&path)?,
                ))
            } else {
                None
            };
            Ok(json!({"path": root.physical_path.join(&skill.directory), "signature": signature}))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let revision = format!("{:x}", Sha256::digest(json!({"id":skill.id,"directory":skill.directory,"name":skill.name,"contentHash":skill.content_hash,"repoOwner":skill.repo_owner,"repoName":skill.repo_name,"repoBranch":skill.repo_branch.as_deref().unwrap_or("main"),"target":target,"agent":agent,"source":placement::content_fingerprint(&source(db, skill)?)?,"local":observed,"global":global_read,"policy":policy,"extra":extra.as_ref().map(|state| &state.revision)}).to_string().as_bytes()));
    Ok(MatrixCell {
        agent,
        checked: present && !off,
        origin: if off {
            "excluded"
        } else if agent == SkillLocation::ClaudeCode
            && project
            && policy
                .iter()
                .enumerate()
                .rev()
                .find(|(_, entry)| !entry.is_null())
                .is_some_and(|(index, entry)| index > 0 && entry == "on")
            && present
        {
            "enabled"
        } else if inherited && !local_read.iter().any(|state| state.state == "placed") {
            "inherited"
        } else if present {
            "placed"
        } else {
            "absent"
        }
        .into(),
        reason,
        revision,
        activation_mode: if agent == SkillLocation::Codex && project {
            "projectLauncher"
        } else {
            "native"
        }
        .into(),
        notice: extra.and_then(|state| state.notice),
    })
}

pub(crate) fn policy_skill_paths(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    target: &ScopeTarget,
    agent: SkillLocation,
) -> Result<Vec<PathBuf>, AppError> {
    let mut states = own(db, skill, target)?
        .map(|asset| placement::placements(db, &asset))
        .transpose()?
        .unwrap_or_default();
    let project = matches!(target, ScopeTarget::Project { .. });
    let mut paths = readable(&states, agent, project)
        .into_iter()
        .filter(|state| state.state == "placed")
        .map(|state| state.target.path.join(&skill.directory).join("SKILL.md"))
        .collect::<Vec<_>>();
    if project {
        states = db
            .get_all_installed_skills_for_target(&ScopeTarget::Global)?
            .into_values()
            .filter(|asset| same_revision(db, asset, skill))
            .map(|asset| placement::placements(db, &asset))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect();
        paths.extend(
            readable(&states, agent, false)
                .into_iter()
                .filter(|state| state.state == "placed")
                .map(|state| state.target.path.join(&skill.directory).join("SKILL.md")),
        );
    }
    let mut paths = paths
        .into_iter()
        .map(|path| fs::canonicalize(&path).map_err(|error| AppError::io(&path, error)))
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort();
    paths.dedup();
    Ok(paths)
}

pub fn rows(db: &Arc<Database>, context: &ConfigContext) -> Result<Vec<MatrixRow>, AppError> {
    matrix_rows(db, context, None)
}
pub(crate) fn rows_for_ids(
    db: &Arc<Database>,
    context: &ConfigContext,
    ids: &[String],
) -> Result<Vec<MatrixRow>, AppError> {
    matrix_rows(db, context, Some(ids))
}
fn matrix_rows(
    db: &Arc<Database>,
    context: &ConfigContext,
    ids: Option<&[String]>,
) -> Result<Vec<MatrixRow>, AppError> {
    let included = |asset: &InstalledSkill| ids.is_none_or(|ids| ids.contains(&asset.id));
    let mut assets = SkillService::get_installed_for_context(db, context)?
        .into_iter()
        .filter(included)
        .collect::<Vec<_>>();
    if matches!(context, ConfigContext::Project { .. }) {
        // A neutral collected global asset is still available for assignment.
        for global in db
            .get_all_installed_skills_for_target(&ScopeTarget::Global)?
            .into_values()
            .filter(included)
        {
            if !assets.iter().any(|asset| same_revision(db, asset, &global)) {
                assets.push(global);
            }
        }
        let project_assets = assets
            .iter()
            .filter(|asset| matches!(asset.target, ScopeTarget::Project { .. }))
            .cloned()
            .collect::<Vec<_>>();
        assets.retain(|asset| {
            !matches!(asset.target, ScopeTarget::Global)
                || !project_assets
                    .iter()
                    .any(|local| same_revision(db, asset, local))
        });
    }
    assets
        .into_iter()
        .map(|skill| {
            let target = if matches!(context, ConfigContext::All) {
                skill.target.clone()
            } else {
                context.require_mutation_target()?
            };
            let cells = AGENTS
                .iter()
                .map(|agent| {
                    cell(db, &skill, &target, *agent).unwrap_or_else(|error| MatrixCell {
                        agent: *agent,
                        checked: false,
                        origin: "unknown".into(),
                        reason: Some(error.to_string()),
                        revision: String::new(),
                        activation_mode: if *agent == SkillLocation::Codex
                            && matches!(target, ScopeTarget::Project { .. })
                        {
                            "projectLauncher"
                        } else {
                            "native"
                        }
                        .into(),
                        notice: None,
                    })
                })
                .collect();
            Ok(MatrixRow {
                skill,
                target,
                cells,
            })
        })
        .collect()
}

fn write_policy(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    target: &ScopeTarget,
    agent: SkillLocation,
    enabled: bool,
) -> Result<(), AppError> {
    if matches!(agent, SkillLocation::Codex | SkillLocation::OpenCode) {
        return super::skill_policy::apply(db, skill, target, agent, enabled);
    }
    let paths = policy_paths(db, target, agent)?;
    let path = paths.last().unwrap();
    let original = fs::read(path).ok();
    let mut value = document(path)?;
    policy_entry(&value, agent, &skill.name)?;
    if agent == SkillLocation::ClaudeCode {
        let overrides = value
            .as_object_mut()
            .unwrap()
            .entry("skillOverrides")
            .or_insert_with(|| json!({}));
        if enabled {
            if excluded(
                &policies(db, target, agent, &skill.name)?[..paths.len() - 1],
                agent,
            ) {
                overrides
                    .as_object_mut()
                    .unwrap()
                    .insert(skill.name.clone(), json!("on"));
            } else {
                overrides.as_object_mut().unwrap().remove(&skill.name);
            }
        } else {
            overrides
                .as_object_mut()
                .unwrap()
                .insert(skill.name.clone(), json!("off"));
        }
    } else {
        // Gemini merges disabled lists as a union. Enabling removes only the
        // local exclusion; it cannot override a user-level exclusion.
        if enabled
            && paths[..paths.len() - 1].iter().any(|parent| {
                document(parent)
                    .and_then(|doc| policy_entry(&doc, agent, &skill.name))
                    .is_ok_and(|entry| entry == json!(true))
            })
        {
            return Err(conflict(
                "Gemini CLI 的上级配置仍停用此 Skill，请在全局解除停用。",
            ));
        }
        let skills = value
            .as_object_mut()
            .unwrap()
            .entry("skills")
            .or_insert_with(|| json!({}));
        let disabled = skills
            .as_object_mut()
            .unwrap()
            .entry("disabled")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .unwrap();
        disabled.retain(|entry| entry.as_str() != Some(&skill.name));
        if !enabled {
            disabled.push(json!(skill.name));
        }
    }
    fs::create_dir_all(path.parent().unwrap()).map_err(|error| AppError::io(path, error))?;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap())
        .map_err(|error| AppError::io(path, error))?;
    use std::io::Write;
    temp.write_all(&value.to_string().into_bytes())
        .map_err(|error| AppError::io(path, error))?;
    safe_path(path)?;
    if fs::read(path).ok() != original {
        return Err(conflict("原生配置在写入前被外部修改，本次没有覆盖。"));
    }
    if let Ok(meta) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(meta.permissions())
            .map_err(|error| AppError::io(path, error))?;
    }
    temp.persist(path)
        .map_err(|error| AppError::io(path, error.error))?;
    Ok(())
}

fn apply_one(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    request: &Assignment,
) -> Result<(), AppError> {
    let current = cell(db, skill, &request.target, request.agent)?;
    if current.revision != request.expected_revision {
        return Err(conflict("目录、版本或原生策略已变化，请重新读取后预览。"));
    }
    if let Some(reason) = current.reason {
        return Err(conflict(reason));
    }
    if current.checked == request.enabled {
        return Ok(());
    }
    if current.origin == "excluded" && request.enabled {
        write_policy(db, skill, &request.target, request.agent, true)?;
        if cell(db, skill, &request.target, request.agent)?.checked {
            return Ok(());
        }
    }
    if !request.enabled
        && matches!(request.target, ScopeTarget::Project { .. })
        && matches!(
            request.agent,
            SkillLocation::Codex | SkillLocation::OpenCode
        )
    {
        return write_policy(db, skill, &request.target, request.agent, false);
    }
    if !request.enabled {
        let local = own(db, skill, &request.target)?;
        let inherited = matches!(request.target, ScopeTarget::Project { .. })
            && db
                .get_all_installed_skills_for_target(&ScopeTarget::Global)?
                .values()
                .filter(|asset| asset.name == skill.name)
                .any(|asset| {
                    placement::placements(db, asset).is_ok_and(|states| {
                        readable(&states, request.agent, false)
                            .iter()
                            .any(|state| state.state == "placed")
                    })
                });
        if inherited
            || current.origin == "inherited"
            || local.as_ref().is_some_and(|asset| {
                placement::placements(db, asset).is_ok_and(|states| {
                    readable(
                        &states,
                        request.agent,
                        matches!(request.target, ScopeTarget::Project { .. }),
                    )
                    .iter()
                    .any(|state| {
                        state.state == "placed"
                            && (!state.target.aliases.contains(&request.agent)
                                || shared_with_other_agents(
                                    state,
                                    request.agent,
                                    matches!(request.target, ScopeTarget::Project { .. }),
                                )
                                || !state.withdrawable)
                    })
                })
            })
        {
            return write_policy(db, skill, &request.target, request.agent, false);
        }
        if let Some(local) = local {
            placement::withdraw(db, &local, request.agent)?;
        }
        return Ok(());
    }
    if let Some(local) = own(db, skill, &request.target)? {
        return placement::sync(db, &local, request.agent).map(|_| ());
    }
    placement::ensure_owned_unchanged(db, skill)?;
    let mut copy = skill.clone();
    copy.target = request.target.clone();
    copy.apps = Default::default();
    copy.installed_at = chrono::Utc::now().timestamp();
    copy.updated_at = 0;
    let dest = source(db, &copy)?;
    if dest.exists() || SkillService::is_symlink(&dest) {
        return Err(conflict("目标主资产目录已存在，不会覆盖。"));
    }
    placement::copy_source(&source(db, skill)?, &dest)?;
    SkillService::persist_and_sync_new_skill_for_target(
        db,
        &request.target,
        &copy,
        &request.agent,
        Some(&dest),
    )
}

pub fn apply(db: &Arc<Database>, requests: Vec<Assignment>) -> Vec<AssignmentResult> {
    // Validate every reviewed cell before any write. Changes caused by this
    // command then use the same locked service state; disk ownership guards are
    // still enforced by every placement operation and native config write.
    let conflict_reasons = preview(db, requests.clone())
        .into_iter()
        .map(|item| item.reason)
        .collect::<Vec<_>>();
    let prepared = requests
        .into_iter()
        .zip(conflict_reasons)
        .map(|(request, reason)| {
            let validation = (|| {
                if let Some(reason) = reason {
                    return Err(conflict(reason));
                }
                let skill = db
                    .get_installed_skill_for_target(&request.id, &request.source_target)?
                    .ok_or_else(|| conflict("来源 Skill 已不存在。"))?;
                let current = cell(db, &skill, &request.target, request.agent)?;
                if current.revision != request.expected_revision {
                    return Err(conflict("目录、版本或原生策略已变化，请重新读取后预览。"));
                }
                if let Some(reason) = current.reason {
                    return Err(conflict(reason));
                }
                Ok(skill)
            })();
            (request, validation)
        })
        .collect::<Vec<_>>();
    let mut applied_targets: Vec<(String, ScopeTarget)> = Vec::new();
    prepared
        .into_iter()
        .map(|(request, validation)| {
            let result = validation.and_then(|skill| {
                if applied_targets
                    .iter()
                    .any(|(id, target)| id == &request.id && target == &request.target)
                {
                    let current = cell(db, &skill, &request.target, request.agent)?;
                    if current.checked == request.enabled
                        && (current.reason.is_none()
                            || (request.enabled
                                && current.reason.as_deref() == Some(UNVERIFIED_EXCLUSION)))
                    {
                        return Ok(());
                    }
                }
                apply_one(db, &skill, &request)
            });
            if result.is_ok() {
                applied_targets.push((request.id.clone(), request.target.clone()));
            }
            AssignmentResult {
                request,
                applied: result.is_ok(),
                error: result.err().map(|error| error.to_string()),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{config, services::skill::SkillApps};
    use serial_test::serial;
    struct Home {
        temp: tempfile::TempDir,
        previous: Option<std::ffi::OsString>,
    }
    impl Home {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let previous = std::env::var_os(config::ACM_HOME_ENV);
            std::env::set_var(config::ACM_HOME_ENV, temp.path());
            crate::settings::reset_settings_store_for_test();
            Self { temp, previous }
        }
    }
    impl Drop for Home {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                std::env::set_var(config::ACM_HOME_ENV, previous);
            } else {
                std::env::remove_var(config::ACM_HOME_ENV);
            }
            crate::settings::reset_settings_store_for_test();
        }
    }
    fn setup() -> (
        Home,
        Arc<Database>,
        InstalledSkill,
        ScopeTarget,
        ScopeTarget,
    ) {
        setup_with_database(false)
    }
    fn setup_with_database(
        persistent: bool,
    ) -> (
        Home,
        Arc<Database>,
        InstalledSkill,
        ScopeTarget,
        ScopeTarget,
    ) {
        let home = Home::new();
        let db = Arc::new(if persistent {
            Database::init().unwrap()
        } else {
            Database::memory().unwrap()
        });
        let targets = ["one", "two"].map(|name| {
            let path = home.temp.path().join(name);
            fs::create_dir(&path).unwrap();
            let project = ProjectService::add_project(&db, path, Some(name.to_string())).unwrap();
            ScopeTarget::Project {
                project_id: project.project_id,
            }
        });
        let skill = InstalledSkill {
            id: "code-review".into(),
            name: "code-review".into(),
            description: None,
            directory: "code-review".into(),
            repo_owner: None,
            repo_name: None,
            repo_branch: None,
            readme_url: None,
            apps: SkillApps::default(),
            installed_at: 1,
            content_hash: None,
            updated_at: 1,
            target: ScopeTarget::Global,
        };
        let path = source(&db, &skill).unwrap();
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            "---\nname: code-review\ndescription: review\n---\n# review",
        )
        .unwrap();
        db.save_skill(&skill).unwrap();
        placement::register_source(&db, &skill).unwrap();
        (home, db, skill, targets[0].clone(), targets[1].clone())
    }
    fn request(
        db: &Arc<Database>,
        skill: &InstalledSkill,
        target: &ScopeTarget,
        agent: SkillLocation,
        enabled: bool,
    ) -> Assignment {
        Assignment {
            id: skill.id.clone(),
            source_target: skill.target.clone(),
            target: target.clone(),
            agent,
            enabled,
            expected_revision: cell(db, skill, target, agent).unwrap().revision,
        }
    }
    #[test]
    #[serial]
    fn project_exclusion_preserves_global_and_other_project() {
        let (_home, db, skill, one, two) = setup();
        placement::sync(&db, &skill, SkillLocation::ClaudeCode).unwrap();
        let global = config::get_claude_skills_dir().join(&skill.directory);
        let before = placement::fingerprint(&global).unwrap();
        let path = policy_paths(&db, &one, SkillLocation::ClaudeCode)
            .unwrap()
            .pop()
            .unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"permissions":{"allow":["Read"]},"skillOverrides":{"other":"name-only"}}"#,
        )
        .unwrap();
        let results = apply(
            &db,
            vec![request(&db, &skill, &one, SkillLocation::ClaudeCode, false)],
        );
        assert!(results[0].applied, "{:?}", results[0].error);
        assert!(
            !cell(&db, &skill, &one, SkillLocation::ClaudeCode)
                .unwrap()
                .checked
        );
        assert!(
            cell(&db, &skill, &two, SkillLocation::ClaudeCode)
                .unwrap()
                .checked
        );
        assert_eq!(placement::fingerprint(&global).unwrap(), before);
        let value = document(&path).unwrap();
        assert_eq!(value["permissions"]["allow"], json!(["Read"]));
        assert_eq!(value["skillOverrides"]["other"], "name-only");
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::ClaudeCode, true)]
            )[0]
            .applied
        );
        assert!(
            cell(&db, &skill, &one, SkillLocation::ClaudeCode)
                .unwrap()
                .checked
        );
        assert!(document(&path).unwrap()["skillOverrides"]
            .get(&skill.name)
            .is_none());
    }
    #[test]
    #[serial]
    fn bulk_copies_independent_project_assets_and_rejects_stale_policy() {
        let (_home, db, skill, one, two) = setup();
        let changes = [SkillLocation::ClaudeCode, SkillLocation::GeminiCli]
            .map(|agent| request(&db, &skill, &one, agent, true));
        let results = apply(&db, changes.into());
        assert!(
            results.iter().all(|result| result.applied),
            "{:?}",
            results
                .iter()
                .map(|result| &result.error)
                .collect::<Vec<_>>()
        );
        let copy = db
            .get_installed_skill_for_target(&skill.id, &one)
            .unwrap()
            .unwrap();
        assert!(!SkillService::is_symlink(&source(&db, &copy).unwrap()));
        assert_eq!(
            fs::read(source(&db, &copy).unwrap().join("SKILL.md")).unwrap(),
            fs::read(source(&db, &skill).unwrap().join("SKILL.md")).unwrap()
        );
        assert!(db
            .get_installed_skill_for_target(&skill.id, &two)
            .unwrap()
            .is_none());
        let change = request(&db, &skill, &one, SkillLocation::ClaudeCode, false);
        let path = policy_paths(&db, &one, SkillLocation::ClaudeCode)
            .unwrap()
            .pop()
            .unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"skillOverrides":{"code-review":"name-only"}}"#).unwrap();
        assert!(!apply(&db, vec![change])[0].applied);
        assert_eq!(
            document(&path).unwrap()["skillOverrides"]["code-review"],
            "name-only"
        );
    }
    #[test]
    #[serial]
    fn inherited_codex_uses_project_launcher_and_shared_discovery_is_visible() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        for agent in [
            SkillLocation::Codex,
            SkillLocation::GeminiCli,
            SkillLocation::OpenCode,
        ] {
            assert!(cell(&db, &skill, &one, agent).unwrap().checked);
        }
        let change = request(&db, &skill, &one, SkillLocation::Codex, false);
        assert!(apply(&db, vec![change])[0].applied);
        assert!(
            !cell(&db, &skill, &one, SkillLocation::Codex)
                .unwrap()
                .checked
        );
    }
    #[test]
    #[serial]
    fn gemini_union_and_unknown_json_are_preserved() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::GeminiCli).unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::GeminiCli, false)]
            )[0]
            .applied
        );
        let path = policy_paths(&db, &one, SkillLocation::GeminiCli)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            document(&path).unwrap()["skills"]["disabled"],
            json!([skill.name])
        );
        fs::write(
            config::get_gemini_config_dir().join("settings.json"),
            r#"{"skills":{"disabled":["code-review"]}}"#,
        )
        .unwrap();
        assert!(
            !apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::GeminiCli, true)]
            )[0]
            .applied
        );
        let before = fs::read(&path).unwrap();
        assert_eq!(
            document(&path).unwrap()["skills"]["disabled"],
            json!([skill.name])
        );
        fs::write(&path, "// external JSONC").unwrap();
        assert!(cell(&db, &skill, &one, SkillLocation::GeminiCli).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"// external JSONC");
        assert!(!before.is_empty());
    }
    #[test]
    #[serial]
    fn unassigned_global_asset_remains_in_project_catalog_and_aliases_use_policies() {
        let (_home, db, skill, one, _) = setup();
        let ScopeTarget::Project { project_id } = &one else {
            unreachable!()
        };
        let entries = rows(
            &db,
            &ConfigContext::Project {
                project_id: project_id.clone(),
            },
        )
        .unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].cells.iter().all(|cell| !cell.checked));
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::Codex, true)]
            )[0]
            .applied
        );
        assert!(
            cell(&db, &skill, &one, SkillLocation::GeminiCli)
                .unwrap()
                .checked
        );
        assert!(cell(&db, &skill, &one, SkillLocation::OpenCode)
            .unwrap()
            .reason
            .is_none());
    }
    #[test]
    #[serial]
    fn equal_metadata_does_not_merge_different_content_and_ambiguous_batch_is_blocked() {
        let (_home, db, skill, one, two) = setup();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::ClaudeCode, true)]
            )[0]
            .applied
        );
        let mut copy = db
            .get_installed_skill_for_target(&skill.id, &one)
            .unwrap()
            .unwrap();
        let copy_source = source(&db, &copy).unwrap();
        fs::write(copy_source.join("SKILL.md"), "# different project version").unwrap();
        assert!(cell(&db, &skill, &one, SkillLocation::ClaudeCode).is_err());
        assert_eq!(
            fs::read_to_string(copy_source.join("SKILL.md")).unwrap(),
            "# different project version"
        );
        // Opposite actions on one cell are also rejected before any write.
        let enable = request(&db, &skill, &two, SkillLocation::ClaudeCode, true);
        let mut disable = enable.clone();
        disable.enabled = false;
        let results = apply(&db, vec![enable, disable]);
        assert!(results.iter().all(|item| !item.applied));
        assert!(db
            .get_installed_skill_for_target(&skill.id, &two)
            .unwrap()
            .is_none());
        // Equal bytes on a different source branch are not the same provenance.
        fs::write(
            copy_source.join("SKILL.md"),
            fs::read(source(&db, &skill).unwrap().join("SKILL.md")).unwrap(),
        )
        .unwrap();
        copy.repo_branch = Some("feature".into());
        db.save_skill(&copy).unwrap();
        let from_global = request(&db, &skill, &two, SkillLocation::ClaudeCode, true);
        let from_project = request(&db, &copy, &two, SkillLocation::ClaudeCode, true);
        assert_ne!(
            from_global.expected_revision,
            from_project.expected_revision
        );
        assert!(
            preview(&db, vec![from_global.clone(), from_project.clone()])
                .iter()
                .all(|item| item.reason.is_some())
        );
        assert!(apply(&db, vec![from_global, from_project])
            .iter()
            .all(|item| !item.applied));
        // The explicit project version remains a separately addressable row.
        copy.content_hash = Some("project-version".into());
        db.save_skill(&copy).unwrap();
        let ScopeTarget::Project { project_id } = &one else {
            unreachable!()
        };
        let rows = rows(
            &db,
            &ConfigContext::Project {
                project_id: project_id.clone(),
            },
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
    }
    #[test]
    #[serial]
    fn claude_global_off_preserves_other_readers_and_project_can_enable_only_itself() {
        let (_home, db, skill, one, two) = setup();
        placement::sync(&db, &skill, SkillLocation::ClaudeCode).unwrap();
        let path = config::get_claude_skills_dir().join(&skill.directory);
        let before = placement::fingerprint(&path).unwrap();
        assert!(
            apply(
                &db,
                vec![request(
                    &db,
                    &skill,
                    &ScopeTarget::Global,
                    SkillLocation::ClaudeCode,
                    false
                )]
            )[0]
            .applied
        );
        assert_eq!(placement::fingerprint(&path).unwrap(), before);
        assert!(
            !cell(&db, &skill, &ScopeTarget::Global, SkillLocation::ClaudeCode)
                .unwrap()
                .checked
        );
        assert!(
            cell(&db, &skill, &ScopeTarget::Global, SkillLocation::OpenCode)
                .unwrap()
                .checked
        );
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::ClaudeCode, true)]
            )[0]
            .applied
        );
        let state = cell(&db, &skill, &one, SkillLocation::ClaudeCode).unwrap();
        assert!(state.checked);
        assert_eq!(state.origin, "enabled");
        assert!(
            !cell(&db, &skill, &two, SkillLocation::ClaudeCode)
                .unwrap()
                .checked
        );
        let local = policy_paths(&db, &one, SkillLocation::ClaudeCode)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            document(&local).unwrap()["skillOverrides"]["code-review"],
            "on"
        );
    }
    #[test]
    #[serial]
    fn bulk_all_agents_reuses_shared_scan_state_and_does_not_remove_shared_project_directory() {
        let (_home, db, skill, one, _) = setup();
        let requests = AGENTS
            .iter()
            .map(|agent| request(&db, &skill, &one, *agent, true))
            .collect();
        let results = apply(&db, requests);
        assert!(
            results.iter().all(|item| item.applied),
            "{:?}",
            results.iter().map(|item| &item.error).collect::<Vec<_>>()
        );
        assert!(AGENTS
            .iter()
            .all(|agent| cell(&db, &skill, &one, *agent).unwrap().checked));
        assert!(cell(&db, &skill, &one, SkillLocation::Codex)
            .unwrap()
            .reason
            .is_none());
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::Codex, false)]
            )[0]
            .applied
        );
    }

    #[test]
    #[serial]
    fn codex_and_opencode_exclude_only_one_project_and_restore_inheritance() {
        let (_home, db, skill, one, two) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let before = placement::content_fingerprint(&source(&db, &skill).unwrap()).unwrap();
        let requests = [SkillLocation::Codex, SkillLocation::OpenCode]
            .map(|agent| request(&db, &skill, &one, agent, false));
        assert!(apply(&db, requests.into()).iter().all(|r| r.applied));
        for agent in [SkillLocation::Codex, SkillLocation::OpenCode] {
            let state = cell(&db, &skill, &one, agent).unwrap();
            assert!(!state.checked);
            assert_eq!(state.origin, "excluded");
            assert!(cell(&db, &skill, &two, agent).unwrap().checked);
        }
        let project = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        assert_eq!(
            document(&project.join(".codex/acm-skills.json")).unwrap()["excludedSkillIds"],
            json!([skill.id])
        );
        assert_eq!(
            document(&project.join("opencode.json")).unwrap()["permission"]["skill"][&skill.name],
            "deny"
        );
        let requests = [SkillLocation::Codex, SkillLocation::OpenCode]
            .map(|agent| request(&db, &skill, &one, agent, true));
        assert!(apply(&db, requests.into()).iter().all(|r| r.applied));
        for agent in [SkillLocation::Codex, SkillLocation::OpenCode] {
            assert!(cell(&db, &skill, &one, agent).unwrap().checked);
        }
        assert_eq!(
            placement::content_fingerprint(&source(&db, &skill).unwrap()).unwrap(),
            before
        );
    }
    #[test]
    #[serial]
    fn codex_launch_resolves_independent_copies_and_rejects_stale_plan() {
        let (_home, db, skill, one, two) = setup();
        crate::settings::set_sync_method(crate::settings::SyncMethod::Copy).unwrap();
        placement::sync(&db, &skill, SkillLocation::Codex).unwrap();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        assert_eq!(
            policy_skill_paths(&db, &skill, &one, SkillLocation::Codex)
                .unwrap()
                .len(),
            2
        );
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::Codex, false)]
            )[0]
            .applied
        );
        let ScopeTarget::Project { project_id } = &one else {
            unreachable!()
        };
        let plan = super::super::codex_launch::get(&db, project_id).unwrap();
        let value: toml::Value = toml::from_str(plan.args.last().unwrap()).unwrap();
        assert_eq!(value["skills"]["config"].as_array().unwrap().len(), 2);
        assert_eq!(plan.excluded_skills.len(), 1);
        assert!(
            cell(&db, &skill, &two, SkillLocation::Codex)
                .unwrap()
                .checked
        );
        let path = super::super::skill_policy::codex_project_path(&db, &one).unwrap();
        fs::write(&path, r#"{"version":1,"excludedSkillIds":[]}"#).unwrap();
        assert!(super::super::codex_launch::launch(&db, project_id, &plan.revision).is_err());
        fs::write(
            config::get_codex_config_dir().join("config.toml"),
            format!(
                "[[skills.config]]\nname = {:?}\nenabled = false\n",
                skill.name
            ),
        )
        .unwrap();
        assert!(cell(&db, &skill, &one, SkillLocation::Codex)
            .unwrap()
            .reason
            .unwrap()
            .contains("用户配置"));
    }
    #[test]
    #[serial]
    fn opencode_legacy_ask_survives_disable_and_enable() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"ask"}}}"#;
        fs::write(&path, original).unwrap();
        for enabled in [false, true] {
            let result = apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, enabled)],
            );
            assert!(result[0].applied, "{:?}", result[0].error);
            let value = super::super::jsonc_document::parse(&fs::read_to_string(&path).unwrap())
                .unwrap()
                .value;
            assert_eq!(
                value["permission"]["skill"][&skill.name],
                if enabled { "ask" } else { "deny" }
            );
        }
        assert!(cell(&db, &skill, &one, SkillLocation::OpenCode)
            .unwrap()
            .notice
            .is_some());
    }
    #[test]
    #[serial]
    fn opencode_legacy_roundtrips_keep_native_values_order_and_comments() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.jsonc");
        for exact in [r#", "code-review":"ask""#, r#", "code-review":"allow""#, ""] {
            let original = format!(
                r#"{{ // header
                  "permission": {{ "skill": {{ "*":"deny"{exact}, "other":"ask" }} }},
                  "unknown": "keep", // tail
                }}"#
            );
            // Absence inherits ask, while the exact permissions override deny.
            let original = if exact.is_empty() {
                original.replace(r#""*":"deny""#, r#""*":"ask""#)
            } else {
                original
            };
            fs::write(&path, &original).unwrap();
            for _ in 0..2 {
                for enabled in [false, true] {
                    let result = apply(
                        &db,
                        vec![request(&db, &skill, &one, SkillLocation::OpenCode, enabled)],
                    );
                    assert!(result[0].applied, "{:?}", result[0].error);
                    // Exercise the adapter's own idempotence too, bypassing
                    // the matrix's checked-state no-op.
                    super::super::skill_policy::apply(
                        &db,
                        &skill,
                        &one,
                        SkillLocation::OpenCode,
                        enabled,
                    )
                    .unwrap();
                }
                let restored = fs::read_to_string(&path).unwrap();
                assert_eq!(
                    super::super::jsonc_document::parse(&restored)
                        .unwrap()
                        .value,
                    super::super::jsonc_document::parse(&original)
                        .unwrap()
                        .value
                );
                if !exact.is_empty() {
                    assert_eq!(restored, original);
                }
                assert!(restored.contains("// header"));
                assert!(restored.contains("// tail"));
            }
        }
    }
    #[test]
    #[serial]
    fn opencode_legacy_native_deny_without_backup_is_never_removed() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"deny"}}}"#;
        fs::write(&path, original).unwrap();
        let state = cell(&db, &skill, &one, SkillLocation::OpenCode).unwrap();
        assert!(!state.checked);
        assert!(state.reason.unwrap().contains("原权限记录"));
        let result = apply(
            &db,
            vec![request(&db, &skill, &one, SkillLocation::OpenCode, true)],
        );
        assert!(!result[0].applied);
        assert!(super::super::skill_policy::apply(
            &db,
            &skill,
            &one,
            SkillLocation::OpenCode,
            true
        )
        .is_err());
        super::super::skill_policy::apply(&db, &skill, &one, SkillLocation::OpenCode, false)
            .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
    }
    #[test]
    #[serial]
    fn opencode_legacy_backup_survives_database_reopen() {
        let (_home, db, skill, one, _) = setup_with_database(true);
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"ask"}}}"#;
        fs::write(&path, original).unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)],
            )[0]
            .applied
        );
        drop(db);
        let db = Arc::new(Database::init().unwrap());
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, true)],
            )[0]
            .applied
        );
        assert_eq!(fs::read_to_string(path).unwrap(), original);
    }
    #[test]
    #[serial]
    fn opencode_legacy_restore_preserves_unrelated_edits_and_rejects_relevant_edits() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.jsonc");
        fs::write(
            &path,
            r#"{"permission":{"skill":{"code-review":"ask"}},"unknown":1}"#,
        )
        .unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)],
            )[0]
            .applied
        );
        let enable = request(&db, &skill, &one, SkillLocation::OpenCode, true);
        let disabled = fs::read_to_string(&path).unwrap();
        for changed in [
            disabled.replace(r#""code-review":"deny""#, r#""code-review":"allow""#),
            disabled.replace(r#""code-review":"deny""#, r#""code-review":"ask""#),
            disabled.replace(r#""code-review":"deny""#, ""),
            disabled.replace(
                r#""code-review":"deny""#,
                r#""*":"deny","code-review":"deny""#,
            ),
        ] {
            fs::write(&path, &changed).unwrap();
            assert!(!apply(&db, vec![enable.clone()])[0].applied);
            assert!(super::super::skill_policy::apply(
                &db,
                &skill,
                &one,
                SkillLocation::OpenCode,
                true
            )
            .is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), changed);
        }
        // Changes to another Skill and unknown fields don't invalidate this
        // row; restoring it must retain those external edits.
        let changed = disabled
            .replace(
                r#""code-review":"deny""#,
                r#""code-review":"deny","other":"ask""#,
            )
            .replace(r#""unknown":1"#, r#""unknown":2 /* external */"#);
        fs::write(&path, changed).unwrap();
        assert!(apply(&db, vec![enable])[0].applied);
        let restored = fs::read_to_string(&path).unwrap();
        assert!(restored.contains("/* external */"));
        let value = super::super::jsonc_document::parse(&restored)
            .unwrap()
            .value;
        assert_eq!(value["permission"]["skill"]["code-review"], "ask");
        assert_eq!(value["permission"]["skill"]["other"], "ask");
        assert_eq!(value["unknown"], 2);
    }
    #[test]
    #[serial]
    fn opencode_legacy_restore_rejects_external_inherited_rule_changes_after_refresh() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let global = config::get_opencode_config_dir().join("opencode.json");
        fs::create_dir_all(global.parent().unwrap()).unwrap();
        let inherited = r#"{"permission":{"skill":{"*":"ask"}},"unknown":1}"#;
        fs::write(&global, inherited).unwrap();
        let original = r#"{"permission":{"skill":{"code-review":"allow"}}}"#;
        fs::write(&path, original).unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)],
            )[0]
            .applied
        );
        let disabled = fs::read_to_string(&path).unwrap();
        let unrelated = inherited.replace(r#""unknown":1"#, r#""unknown":2"#);
        fs::write(&global, &unrelated).unwrap();
        assert!(cell(&db, &skill, &one, SkillLocation::OpenCode)
            .unwrap()
            .reason
            .is_none());
        fs::write(&global, unrelated.replace(r#""*":"ask""#, r#""*":"deny""#)).unwrap();
        // Refreshing the row cannot adopt an ancestor change as consent to
        // restore the saved allow over the newly added deny.
        let rows = rows(
            &db,
            &ConfigContext::Project {
                project_id: match &one {
                    ScopeTarget::Project { project_id } => project_id.clone(),
                    _ => unreachable!(),
                },
            },
        )
        .unwrap();
        let row = rows.iter().find(|row| row.skill.id == skill.id).unwrap();
        let state = row
            .cells
            .iter()
            .find(|cell| cell.agent == SkillLocation::OpenCode)
            .unwrap();
        assert!(state.reason.is_some());
        assert!(super::super::skill_policy::apply(
            &db,
            &skill,
            &one,
            SkillLocation::OpenCode,
            true
        )
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), disabled);
        fs::write(&global, &unrelated).unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, true)],
            )[0]
            .applied
        );
        assert_eq!(fs::read_to_string(path).unwrap(), original);
        assert_eq!(fs::read_to_string(global).unwrap(), unrelated);
    }
    #[test]
    #[serial]
    fn opencode_legacy_incomplete_backup_cannot_be_treated_as_original_absence() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"ask"}}}"#;
        fs::write(&path, original).unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)],
            )[0]
            .applied
        );
        let enable = request(&db, &skill, &one, SkillLocation::OpenCode, true);
        let disabled = fs::read_to_string(&path).unwrap();
        let key: String = db
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT key FROM settings WHERE key LIKE 'opencode_skill_exclusion_v1:%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let saved = db.get_setting(&key).unwrap().unwrap();
        let mut incomplete: Value = serde_json::from_str(&saved).unwrap();
        incomplete.as_object_mut().unwrap().remove("previous");
        db.set_setting(&key, &incomplete.to_string()).unwrap();
        assert!(!apply(&db, vec![enable.clone()])[0].applied);
        assert_eq!(fs::read_to_string(&path).unwrap(), disabled);
        db.set_setting(&key, &saved).unwrap();
        assert!(apply(&db, vec![enable])[0].applied);
        assert_eq!(fs::read_to_string(path).unwrap(), original);
    }
    #[test]
    #[serial]
    fn opencode_legacy_backup_failure_keeps_native_permission_unchanged() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"ask"}}}"#;
        fs::write(&path, original).unwrap();
        db.conn
            .lock()
            .unwrap()
            .execute_batch("PRAGMA query_only=ON")
            .unwrap();
        let result = apply(
            &db,
            vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)],
        );
        assert!(!result[0].applied);
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
    }
    #[test]
    #[serial]
    fn opencode_legacy_restore_database_failure_can_retry_without_partial_enable() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"ask"}}}"#;
        fs::write(&path, original).unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)],
            )[0]
            .applied
        );
        let disabled = fs::read_to_string(&path).unwrap();
        let enable = request(&db, &skill, &one, SkillLocation::OpenCode, true);
        db.conn
            .lock()
            .unwrap()
            .execute_batch("PRAGMA query_only=ON")
            .unwrap();
        let result = apply(&db, vec![enable]);
        db.conn
            .lock()
            .unwrap()
            .execute_batch("PRAGMA query_only=OFF")
            .unwrap();
        assert!(!result[0].applied);
        assert_eq!(fs::read_to_string(&path).unwrap(), disabled);
        let state = cell(&db, &skill, &one, SkillLocation::OpenCode).unwrap();
        assert!(!state.checked);
        assert!(state.reason.is_none());
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, true)],
            )[0]
            .applied
        );
        assert_eq!(fs::read_to_string(path).unwrap(), original);
    }
    #[cfg(unix)]
    #[test]
    #[serial]
    fn opencode_legacy_native_write_failure_rolls_back_backup_and_can_retry() {
        use std::os::unix::fs::PermissionsExt;
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"ask"}}}"#;
        fs::write(&path, original).unwrap();
        let disable = request(&db, &skill, &one, SkillLocation::OpenCode, false);
        let permissions = fs::metadata(&root).unwrap().permissions();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o500)).unwrap();
        let result = apply(&db, vec![disable]);
        fs::set_permissions(&root, permissions).unwrap();
        assert!(!result[0].applied);
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert!(cell(&db, &skill, &one, SkillLocation::OpenCode)
            .unwrap()
            .reason
            .is_none());
        for enabled in [false, true] {
            assert!(
                apply(
                    &db,
                    vec![request(&db, &skill, &one, SkillLocation::OpenCode, enabled)],
                )[0]
                .applied
            );
        }
        assert_eq!(fs::read_to_string(path).unwrap(), original);
    }
    #[test]
    #[serial]
    fn opencode_legacy_later_wildcard_cannot_turn_disable_into_a_noop() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"ask","*":"allow"}}}"#;
        fs::write(&path, original).unwrap();
        assert!(cell(&db, &skill, &one, SkillLocation::OpenCode)
            .unwrap()
            .reason
            .unwrap()
            .contains("顺序"));
        assert!(
            !apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)],
            )[0]
            .applied
        );
        assert!(super::super::skill_policy::apply(
            &db,
            &skill,
            &one,
            SkillLocation::OpenCode,
            false
        )
        .is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), original);
    }
    #[test]
    #[serial]
    fn opencode_jsonc_priority_order_and_modern_rules_preserve_text() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join(".opencode/opencode.jsonc");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            root.join("opencode.json"),
            r#"{"permission":{"skill":{"*":"ask"}}}"#,
        )
        .unwrap();
        let original = r#"{ // keep header
          "model": "unchanged", "permission": { "skill": { "*":"allow", "other":"ask", } },
          "unknown": "literal ,} // text", // keep tail
        }"#;
        fs::write(&path, original).unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)]
            )[0]
            .applied
        );
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("// keep header"));
        assert!(text.contains("// keep tail"));
        assert!(text.contains("literal ,} // text"));
        assert!(
            !cell(&db, &skill, &one, SkillLocation::OpenCode)
                .unwrap()
                .checked
        );
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, true)]
            )[0]
            .applied
        );
        assert!(
            cell(&db, &skill, &one, SkillLocation::OpenCode)
                .unwrap()
                .checked
        );
        fs::write(&path,r#"{"permissions":[{"action":"skill","resource":"*","effect":"ask"}],"agents":{},"unknown":42}"#).unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)]
            )[0]
            .applied
        );
        let value = super::super::jsonc_document::parse(&fs::read_to_string(&path).unwrap())
            .unwrap()
            .value;
        assert_eq!(value["permissions"].as_array().unwrap().len(), 2);
        assert_eq!(value["unknown"], 42);
        assert!(value.get("permission").is_none());
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, true)]
            )[0]
            .applied
        );
        assert_eq!(
            super::super::jsonc_document::parse(&fs::read_to_string(&path).unwrap())
                .unwrap()
                .value["permissions"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    #[serial]
    fn native_roles_invalid_formats_links_and_changed_policy_are_blocked() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.json");
        for text in [
            r#"{"permission":{"skill":{"*":"allow"}},"agent":{"plan":{"permission":{"skill":{"*":"allow"}}}}}"#,
            r#"{"permission":{},"permissions":[]}"#,
            r#"{"permission":{"skill":{"code-review":"invalid"}}}"#,
            r#"{"permission":{,,,}"#,
        ] {
            fs::write(&path, text).unwrap();
            let result = cell(&db, &skill, &one, SkillLocation::OpenCode);
            assert!(result.is_err() || result.unwrap().reason.is_some());
            assert_eq!(fs::read_to_string(&path).unwrap(), text);
        }
        fs::write(&path, "{}").unwrap();
        let change = request(&db, &skill, &one, SkillLocation::OpenCode, false);
        fs::write(&path, r#"{"permission":{"skill":{"*":"ask"}}}"#).unwrap();
        assert!(!apply(&db, vec![change])[0].applied);
        let original = fs::read_to_string(&path).unwrap();
        fs::write(&path, "{}").unwrap();
        assert!(super::super::skill_policy::write(&path, Some(&original), "changed").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{}");
        let role = root.join(".opencode/agents/review.md");
        fs::create_dir_all(role.parent().unwrap()).unwrap();
        fs::write(
            &role,
            "---\npermission:\n  skill:\n    code-*: allow\n---\nrole",
        )
        .unwrap();
        assert!(cell(&db, &skill, &one, SkillLocation::OpenCode)
            .unwrap()
            .reason
            .unwrap()
            .contains("角色"));
        fs::remove_file(role).unwrap();
        #[cfg(unix)]
        {
            fs::remove_file(&path).unwrap();
            let external = root.join("external.json");
            fs::write(&external, "{}").unwrap();
            std::os::unix::fs::symlink(&external, &path).unwrap();
            assert!(cell(&db, &skill, &one, SkillLocation::OpenCode).is_err());
            assert_eq!(fs::read_to_string(external).unwrap(), "{}");
        }
    }
    #[test]
    #[serial]
    fn bulk_distinct_skills_share_policy_files_without_false_stale_errors() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let mut other = skill.clone();
        other.id = "other".into();
        other.name = "other".into();
        other.directory = "other".into();
        let path = source(&db, &other).unwrap();
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            "---\nname: other\ndescription: other\n---\nother",
        )
        .unwrap();
        db.save_skill(&other).unwrap();
        placement::register_source(&db, &other).unwrap();
        placement::sync(&db, &other, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let policy = root.join("opencode.json");
        let original = r#"{"permission":{"skill":{"code-review":"ask","other":"allow"}}}"#;
        fs::write(&policy, original).unwrap();
        for enabled in [false, true] {
            let requests = [&skill, &other]
                .into_iter()
                .flat_map(|skill| {
                    [SkillLocation::Codex, SkillLocation::OpenCode]
                        .map(|agent| request(&db, skill, &one, agent, enabled))
                })
                .collect();
            let results = apply(&db, requests);
            assert!(
                results.iter().all(|item| item.applied),
                "{:?}",
                results.iter().map(|r| &r.error).collect::<Vec<_>>()
            );
        }
        assert_eq!(fs::read_to_string(policy).unwrap(), original);
    }

    #[test]
    #[serial]
    fn wildcard_precedence_and_upper_denial_do_not_broaden_permissions() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
        let root = ProjectService::resolve_scope_target(&db, &one)
            .unwrap()
            .project_root
            .unwrap();
        let path = root.join("opencode.jsonc");
        fs::write(
            &path,
            r#"{"permission":{"skill":{"*":"deny","code-*":"allow","code-review":"ask"}}}"#,
        )
        .unwrap();
        let state = cell(&db, &skill, &one, SkillLocation::OpenCode).unwrap();
        assert!(state.checked);
        assert!(state.notice.unwrap().contains("确认"));
        let change = request(&db, &skill, &one, SkillLocation::OpenCode, false);
        assert!(apply(&db, vec![change])[0].applied);
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, true)]
            )[0]
            .applied
        );
        fs::write(
            &path,
            r#"{"permission":{"skill":{"*":"allow"},"*":"allow"}}"#,
        )
        .unwrap();
        let before = fs::read_to_string(&path).unwrap();
        assert!(cell(&db, &skill, &one, SkillLocation::OpenCode)
            .unwrap()
            .reason
            .unwrap()
            .contains("顺序"));
        assert!(
            !apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, false)]
            )[0]
            .applied
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        fs::write(&path, r#"{"permission":{"skill":{"code-review":"deny"}}}"#).unwrap();
        let global = config::get_opencode_config_dir().join("opencode.json");
        fs::create_dir_all(global.parent().unwrap()).unwrap();
        fs::write(&global, r#"{"permission":{"skill":{"*":"deny"}}}"#).unwrap();
        assert!(cell(&db, &skill, &one, SkillLocation::OpenCode)
            .unwrap()
            .reason
            .unwrap()
            .contains("上级"));
        assert!(
            !apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::OpenCode, true)]
            )[0]
            .applied
        );
    }
    #[test]
    #[serial]
    fn invalid_codex_rules_block_launch_and_project_file_keeps_unknown_fields() {
        let (_home, db, skill, one, _) = setup();
        placement::sync(&db, &skill, SkillLocation::Codex).unwrap();
        let path = super::super::skill_policy::codex_project_path(&db, &one).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"version":1,"excludedSkillIds":[],"unknown":{"keep":true}}"#,
        )
        .unwrap();
        assert!(
            apply(
                &db,
                vec![request(&db, &skill, &one, SkillLocation::Codex, false)]
            )[0]
            .applied
        );
        assert_eq!(document(&path).unwrap()["unknown"]["keep"], true);
        let ScopeTarget::Project { project_id } = &one else {
            unreachable!()
        };
        fs::write(&path, r#"{"version":2,"excludedSkillIds":[]}"#).unwrap();
        assert!(super::super::codex_launch::get(&db, project_id).is_err());
        fs::write(&path, r#"{"version":1,"excludedSkillIds":[]}"#).unwrap();
        fs::write(
            config::get_codex_config_dir().join("config.toml"),
            "[broken",
        )
        .unwrap();
        assert!(super::super::codex_launch::get(&db, project_id).is_err());
    }
}
