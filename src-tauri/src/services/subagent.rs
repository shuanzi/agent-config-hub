//! Subagent 服务层
//!
//! 统一管理架构：
//! - SSOT（单一事实源）：`~/.agent-config-manager/subagents/` 或 `~/.agents/subagents/`
//! - 安装时下载到 SSOT，按需以 symlink/copy 方式投影到各 Agent 的 subagents 目录
//! - 数据库存储安装记录和启用状态
//!
//! 与 skills 的区别：
//! - 发现对象是仓库中任意带 YAML frontmatter（至少含 `name:`）的 `.md` 文件。
//! - 每个文件即一个 subagent，身份为 `{owner}/{repo}:{path}`。
//! - SSOT 中只保存单个 `.md` 文件（`{install-name}.md`）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock, RwLockReadGuard, RwLockWriteGuard};

use crate::config;
use crate::database::Database;
use crate::error::{format_subagent_error, AppError};
use crate::services::project::{ConfigContext, ProjectService, ScopeTarget};
use crate::services::skill::{AgentType, SkillApps, SkillRepo, SkillService};
use crate::settings::{get_settings, StorageLocation, SyncMethod};

// ========== Subagent state coordination ==========

fn subagent_state_lock() -> &'static RwLock<()> {
    static LOCK: OnceLock<RwLock<()>> = OnceLock::new();
    LOCK.get_or_init(|| RwLock::new(()))
}

pub(crate) fn subagent_state_read_guard() -> RwLockReadGuard<'static, ()> {
    subagent_state_lock().read().unwrap_or_else(|poisoned| {
        log::warn!("Subagent state read lock was poisoned; recovering the protected state");
        poisoned.into_inner()
    })
}

pub(crate) fn subagent_state_write_guard() -> RwLockWriteGuard<'static, ()> {
    subagent_state_lock().write().unwrap_or_else(|poisoned| {
        log::warn!("Subagent state write lock was poisoned; recovering the protected state");
        poisoned.into_inner()
    })
}

// ========== Data structures ==========

/// Subagent 在各 Agent 上的启用状态（复用 skill 的 Agent 标志结构）。
pub type SubagentApps = SkillApps;

/// 已安装的 Subagent。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSubagent {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readme_url: Option<String>,
    pub apps: SubagentApps,
    pub installed_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub updated_at: i64,
    /// 资产的完整归属 target。旧备份 metadata 缺失该字段时按 global 读取。
    #[serde(default)]
    pub target: ScopeTarget,
}

/// 可发现的 Subagent（来自仓库中的单个 Markdown 文件）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableSubagent {
    pub key: String,
    pub name: String,
    pub description: String,
    /// 用于安装命名的文件干（file stem），不含 `.md` 后缀。
    pub directory: String,
    /// 文件在仓库中的相对路径（含 `.md`）。
    pub path: String,
    pub readme_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub repo_branch: String,
    /// 相对于当前明确 target 的安装状态；发现源本身不携带全局状态。
    #[serde(default)]
    pub installed: bool,
}

/// 仓库配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentRepo {
    pub owner: String,
    pub name: String,
    pub branch: String,
    pub enabled: bool,
}

/// Subagent 卸载结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentUninstallResult {
    pub backup_path: Option<String>,
}

/// Subagent 更新检测结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentUpdateInfo {
    pub id: String,
    pub name: String,
    pub current_hash: Option<String>,
    pub remote_hash: String,
}

/// Subagent 存储位置迁移结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated_count: usize,
    pub skipped_count: usize,
    pub errors: Vec<String>,
}

/// Subagent 备份条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentBackupEntry {
    pub backup_id: String,
    pub backup_path: String,
    pub created_at: i64,
    pub subagent: InstalledSubagent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubagentBackupMetadata {
    subagent: InstalledSubagent,
    backup_created_at: i64,
    source_path: String,
}

const SUBAGENT_BACKUP_RETAIN_COUNT: usize = 20;

// ========== SubagentService ==========

pub struct SubagentService;

impl Default for SubagentService {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) struct SubagentMigrationOutcome {
    pub result: MigrationResult,
    pub moved: Vec<String>,
    pub project_moved: Vec<String>,
}

pub(crate) struct SubagentMigrationFailure {
    pub moved: Vec<String>,
    pub project_moved: Vec<String>,
    pub failures: Vec<String>,
}

impl SubagentMigrationFailure {
    pub(crate) fn into_error(self) -> AppError {
        AppError::Message(format_subagent_error(
            "MIGRATION_ABORTED",
            &[("failures", &self.failures.join("; "))],
            Some("checkPermission"),
        ))
    }
}

impl SubagentService {
    pub fn new() -> Self {
        Self
    }

    // ========== Path management ==========

    pub fn get_ssot_dir() -> Result<PathBuf, AppError> {
        let location = get_settings().storage_location;
        let dir = match location {
            StorageLocation::Hub => config::get_hub_subagents_dir(),
            StorageLocation::Unified => config::get_home_dir().join(".agents").join("subagents"),
        };
        fs::create_dir_all(&dir).map_err(|e| AppError::io(&dir, e))?;
        Ok(dir)
    }

    /// 按完整 target 解析 Subagent SSOT。项目 target 使用与当前 storage
    /// location 同级的独立 sibling，绝不回退到 global SSOT。
    pub(crate) fn get_ssot_dir_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
    ) -> Result<PathBuf, AppError> {
        match target {
            ScopeTarget::Global => Self::get_ssot_dir(),
            ScopeTarget::Project { project_id } => {
                ProjectService::resolve_scope_target(db, target)?;
                let dir = Self::project_ssot_dir_for_location(
                    get_settings().storage_location,
                    project_id,
                );
                fs::create_dir_all(&dir).map_err(|e| AppError::io(&dir, e))?;
                Ok(dir)
            }
        }
    }

    fn project_ssot_dir_for_location(location: StorageLocation, project_id: &str) -> PathBuf {
        let base = match location {
            StorageLocation::Hub => config::get_hub_dir(),
            StorageLocation::Unified => config::get_home_dir().join(".agents"),
        };
        base.join("projects").join(project_id).join("subagents")
    }

    pub(crate) fn rollback_project_subagent_moves(
        old_location: StorageLocation,
        new_location: StorageLocation,
        project_ids: &[String],
    ) {
        for project_id in project_ids {
            let old_ssot = Self::project_ssot_dir_for_location(old_location, project_id);
            let new_ssot = Self::project_ssot_dir_for_location(new_location, project_id);
            if !new_ssot.exists() || old_ssot.exists() {
                continue;
            }
            if let Some(parent) = old_ssot.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if fs::rename(&new_ssot, &old_ssot).is_err() {
                match SkillService::copy_dir_recursive(&new_ssot, &old_ssot) {
                    Ok(()) => {
                        if let Err(error) = fs::remove_dir_all(&new_ssot) {
                            log::error!(
                                "回滚项目 Subagent sibling 后清理新位置失败 {}: {error}",
                                new_ssot.display()
                            );
                        }
                    }
                    Err(error) => log::error!(
                        "回滚项目 Subagent sibling 失败 {} -> {}: {error}",
                        new_ssot.display(),
                        old_ssot.display()
                    ),
                }
            }
        }
    }

    fn get_backup_dir() -> Result<PathBuf, AppError> {
        let dir = config::get_hub_subagent_backups_dir();
        fs::create_dir_all(&dir).map_err(|e| AppError::io(&dir, e))?;
        Ok(dir)
    }

    pub fn get_app_subagents_dir(app: &AgentType) -> Result<PathBuf, AppError> {
        let dir = match app {
            AgentType::ClaudeCode => config::get_claude_agents_dir(),
            AgentType::Codex => config::get_codex_agents_dir(),
            AgentType::GeminiCli => config::get_gemini_agents_dir(),
            AgentType::OpenCode => config::get_opencode_agents_dir(),
        };
        Ok(dir)
    }

    fn app_is_supported_for_target(target: &ScopeTarget, app: &AgentType) -> bool {
        !matches!(
            (target, app),
            (ScopeTarget::Project { .. }, AgentType::Codex)
        )
    }

    fn ensure_app_supported_for_target(
        target: &ScopeTarget,
        app: &AgentType,
    ) -> Result<(), AppError> {
        if Self::app_is_supported_for_target(target, app) {
            return Ok(());
        }
        Err(AppError::Message(format_subagent_error(
            "SUBAGENT_UNSUPPORTED",
            &[("app", app.as_str()), ("scope", "project")],
            Some("selectSupportedAgent"),
        )))
    }

    fn ensure_enabled_apps_supported_for_target(
        target: &ScopeTarget,
        apps: &SubagentApps,
    ) -> Result<(), AppError> {
        for app in apps.enabled_apps() {
            Self::ensure_app_supported_for_target(target, &app)?;
        }
        Ok(())
    }

    /// 按完整 target 解析 Agent 投影目录。项目目录只取 registry 中的 root，
    /// 不读取 global override；Codex 项目 Subagent 是封闭 Unsupported。
    pub(crate) fn get_app_subagents_dir_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        app: &AgentType,
    ) -> Result<PathBuf, AppError> {
        match target {
            ScopeTarget::Global => Self::get_app_subagents_dir(app),
            ScopeTarget::Project { .. } => {
                Self::ensure_app_supported_for_target(target, app)?;
                let resolved = ProjectService::resolve_scope_target(db, target)?;
                let root = resolved
                    .project_root
                    .expect("project target resolution always has a project root");
                let dir = match app {
                    AgentType::ClaudeCode => root.join(".claude").join("agents"),
                    AgentType::Codex => unreachable!("Codex project Subagent is unsupported"),
                    AgentType::GeminiCli => root.join(".gemini").join("agents"),
                    AgentType::OpenCode => root.join(".opencode").join("agents"),
                };
                Ok(dir)
            }
        }
    }

    fn ensure_distinct_subagent_roots(
        ssot_dir: &Path,
        app_dir: &Path,
        app: &AgentType,
    ) -> Result<(), AppError> {
        // 判等之外还必须拒绝父子重叠：目标落在 SSOT 内部时，symlink 会造成
        // 文件系统环，copy 会把临时目标递归拷进自身
        if SkillService::paths_overlap(ssot_dir, app_dir) {
            let ssot = ssot_dir.display().to_string();
            let app_dir = app_dir.display().to_string();
            return Err(AppError::Message(format_subagent_error(
                "SUBAGENT_STORAGE_OVERLAP",
                &[
                    ("app", app.as_str()),
                    ("ssotDir", &ssot),
                    ("appDir", &app_dir),
                ],
                None,
            )));
        }
        Ok(())
    }

    fn get_distinct_app_subagents_dir(
        ssot_dir: &Path,
        app: &AgentType,
    ) -> Result<PathBuf, AppError> {
        let app_dir = Self::get_app_subagents_dir(app)?;
        Self::ensure_distinct_subagent_roots(ssot_dir, &app_dir, app)?;
        Ok(app_dir)
    }

    fn get_distinct_app_subagents_dir_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        ssot_dir: &Path,
        app: &AgentType,
    ) -> Result<PathBuf, AppError> {
        let app_dir = Self::get_app_subagents_dir_for_target(db, target, app)?;
        Self::ensure_distinct_subagent_roots(ssot_dir, &app_dir, app)?;
        Ok(app_dir)
    }

    fn validate_subagent_storage_destination(ssot_dir: &Path) -> Result<(), AppError> {
        for app in AgentType::all() {
            let app_dir = Self::get_app_subagents_dir(&app)?;
            Self::ensure_distinct_subagent_roots(ssot_dir, &app_dir, &app)?;
        }
        Ok(())
    }

    fn ssot_file_path(ssot_dir: &Path, directory: &str) -> PathBuf {
        ssot_dir.join(format!("{directory}.md"))
    }

    /// 项目 target 只投影已由路径矩阵确认兼容的 Subagent 文件。全局 target
    /// 保持既有行为；项目 Claude/Gemini 继续使用发现阶段已要求的 `name`，
    /// OpenCode 额外要求其原生的 `mode: subagent|all`。
    fn validate_project_subagent_file_for_app(
        target: &ScopeTarget,
        source: &Path,
        app: &AgentType,
    ) -> Result<(), AppError> {
        if !matches!(target, ScopeTarget::Project { .. }) {
            return Ok(());
        }
        Self::ensure_app_supported_for_target(target, app)?;

        let content = fs::read_to_string(source).map_err(|error| AppError::io(source, error))?;
        let content = content.trim_start_matches('\u{feff}');
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        let front_matter = if parts.len() == 3 && parts[0].trim().is_empty() {
            parts[1].trim()
        } else {
            return Err(Self::project_subagent_incompatible_error(
                app,
                "missingFrontmatter",
            ));
        };
        let metadata: serde_yaml::Value = serde_yaml::from_str(front_matter)
            .map_err(|_| Self::project_subagent_incompatible_error(app, "invalidFrontmatter"))?;
        let Some(mapping) = metadata.as_mapping() else {
            return Err(Self::project_subagent_incompatible_error(
                app,
                "invalidFrontmatter",
            ));
        };
        let name_key = serde_yaml::Value::String("name".to_string());
        let has_name = mapping
            .get(&name_key)
            .and_then(serde_yaml::Value::as_str)
            .map(|name| !name.trim().is_empty())
            .unwrap_or(false);
        if !has_name {
            return Err(Self::project_subagent_incompatible_error(
                app,
                "missingName",
            ));
        }

        if *app == AgentType::OpenCode {
            let mode_key = serde_yaml::Value::String("mode".to_string());
            let valid_mode = mapping
                .get(&mode_key)
                .and_then(serde_yaml::Value::as_str)
                .map(|mode| matches!(mode, "subagent" | "all"))
                .unwrap_or(false);
            if !valid_mode {
                return Err(Self::project_subagent_incompatible_error(
                    app,
                    "invalidMode",
                ));
            }
        }

        Ok(())
    }

    fn project_subagent_incompatible_error(app: &AgentType, reason: &str) -> AppError {
        AppError::Message(format_subagent_error(
            "SUBAGENT_INCOMPATIBLE",
            &[("app", app.as_str()), ("reason", reason)],
            Some("fixFrontmatter"),
        ))
    }

    /// 目标位置已存在但数据库无记录：属于未托管内容，绝不覆盖/冒名记录。
    fn ensure_no_unmanaged_destination(dest: &Path, install_name: &str) -> Result<(), AppError> {
        if dest.exists() || SkillService::is_symlink(dest) {
            return Err(AppError::Message(format_subagent_error(
                "SUBAGENT_DIRECTORY_CONFLICT",
                &[("directory", install_name), ("existingRepo", "unmanaged")],
                Some("importFirst"),
            )));
        }
        Ok(())
    }

    // ========== Installed subagent queries ==========

    pub fn get_all_installed(db: &Arc<Database>) -> Result<Vec<InstalledSubagent>, AppError> {
        let subagents = db.get_all_installed_subagents()?;
        Ok(subagents.into_values().collect())
    }

    /// 按 UI 读取上下文组装 Subagents。返回顺序就是展示顺序；记录自身携带完整
    /// target，因此不需要新增跨资产 section 抽象。
    pub fn get_installed_for_context(
        db: &Arc<Database>,
        context: &ConfigContext,
    ) -> Result<Vec<InstalledSubagent>, AppError> {
        match context {
            ConfigContext::Global => Ok(db
                .get_all_installed_subagents_for_target(&ScopeTarget::Global)?
                .into_values()
                .collect()),
            ConfigContext::All => {
                let mut subagents: Vec<InstalledSubagent> = db
                    .get_all_installed_subagents_for_target(&ScopeTarget::Global)?
                    .into_values()
                    .collect();
                for project in ProjectService::list_projects(db)? {
                    let target = ScopeTarget::Project {
                        project_id: project.project_id,
                    };
                    // all 视图跳过不可用项目段；不能借此返回缓存记录或 global fallback。
                    if ProjectService::resolve_scope_target(db, &target).is_err() {
                        continue;
                    }
                    subagents.extend(
                        db.get_all_installed_subagents_for_target(&target)?
                            .into_values(),
                    );
                }
                Ok(subagents)
            }
            ConfigContext::Project { .. } => {
                let target = context.require_mutation_target()?;
                ProjectService::resolve_scope_target(db, &target)?;
                let mut subagents: Vec<InstalledSubagent> = db
                    .get_all_installed_subagents_for_target(&target)?
                    .into_values()
                    .collect();
                subagents.extend(
                    db.get_all_installed_subagents_for_target(&ScopeTarget::Global)?
                        .into_values()
                        .filter(|subagent| {
                            Self::global_subagent_is_explicitly_applicable(&target, subagent)
                        }),
                );
                Ok(subagents)
            }
        }
    }

    fn global_subagent_is_explicitly_applicable(
        project_target: &ScopeTarget,
        subagent: &InstalledSubagent,
    ) -> bool {
        subagent
            .apps
            .enabled_apps()
            .into_iter()
            .any(|app| Self::app_is_supported_for_target(project_target, &app))
    }

    fn reuse_existing_install_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        subagent: &DiscoverableSubagent,
        install_name: &str,
        current_app: &AgentType,
    ) -> Result<Option<InstalledSubagent>, AppError> {
        let existing_subagents = db.get_all_installed_subagents_for_target(target)?;
        for existing in existing_subagents.values() {
            if !existing.directory.eq_ignore_ascii_case(install_name) {
                continue;
            }

            let same_repo = existing.repo_owner.as_deref() == Some(&subagent.repo_owner)
                && existing.repo_name.as_deref() == Some(&subagent.repo_name);
            if same_repo {
                if existing.id == subagent.key {
                    let mut updated = existing.clone();
                    updated.apps.set_enabled_for(current_app, true);
                    // 先同步投影成功再落库：同步失败时 DB 保持原启用标志，
                    // 避免出现"已启用但无可用投影"的中间状态
                    Self::sync_to_app_dir_for_target(db, target, &updated.directory, current_app)?;
                    if let Err(error) = db.save_subagent(&updated) {
                        // 落库失败：移除本次新建的投影，恢复到操作前状态；
                        // 操作前已启用的投影先于本次操作存在，保留不动
                        if !existing.apps.is_enabled_for(current_app) {
                            if let Err(rollback_error) = Self::remove_from_app_for_target(
                                db,
                                target,
                                &updated.directory,
                                current_app,
                            ) {
                                log::error!(
                                    "保存 Subagent {} 失败后移除 {} 投影也失败: {rollback_error}",
                                    updated.name,
                                    current_app.as_str()
                                );
                            }
                        }
                        return Err(error);
                    }
                    log::info!(
                        "Subagent {} 已存在，更新 {} 启用状态",
                        updated.name,
                        current_app.as_str()
                    );
                    return Ok(Some(updated));
                }

                return Err(AppError::Message(format_subagent_error(
                    "SUBAGENT_DIRECTORY_CONFLICT",
                    &[
                        ("directory", install_name),
                        (
                            "existingRepo",
                            &format!(
                                "{}/{}:{}",
                                existing.repo_owner.as_deref().unwrap_or("unknown"),
                                existing.repo_name.as_deref().unwrap_or("unknown"),
                                existing.id
                            ),
                        ),
                        (
                            "newRepo",
                            &format!("{}/{}", subagent.repo_owner, subagent.repo_name),
                        ),
                    ],
                    Some("uninstallFirst"),
                )));
            }

            return Err(AppError::Message(format_subagent_error(
                "SUBAGENT_DIRECTORY_CONFLICT",
                &[
                    ("directory", install_name),
                    (
                        "existingRepo",
                        &format!(
                            "{}/{}",
                            existing.repo_owner.as_deref().unwrap_or("unknown"),
                            existing.repo_name.as_deref().unwrap_or("unknown")
                        ),
                    ),
                    (
                        "newRepo",
                        &format!("{}/{}", subagent.repo_owner, subagent.repo_name),
                    ),
                ],
                Some("uninstallFirst"),
            )));
        }

        Ok(None)
    }

    // ========== Discovery ==========

    pub async fn discover_available(
        &self,
        repos: Vec<SubagentRepo>,
    ) -> Result<Vec<DiscoverableSubagent>, AppError> {
        let mut subagents = Vec::new();
        let enabled_repos: Vec<SubagentRepo> =
            repos.into_iter().filter(|repo| repo.enabled).collect();

        let fetch_tasks = enabled_repos
            .iter()
            .map(|repo| self.fetch_repo_subagents(repo));

        let results: Vec<Result<Vec<DiscoverableSubagent>, AppError>> =
            futures::future::join_all(fetch_tasks).await;

        for (repo, result) in enabled_repos.into_iter().zip(results) {
            match result {
                Ok(repo_subagents) => subagents.extend(repo_subagents),
                Err(e) => log::warn!(
                    "获取仓库 {}/{} subagents 失败: {}",
                    repo.owner,
                    repo.name,
                    e
                ),
            }
        }

        Self::deduplicate_discoverable_subagents(&mut subagents);
        subagents.sort_by_key(|subagent| subagent.name.to_lowercase());

        Ok(subagents)
    }

    /// 远端发现内容不因 target 改变；installed 状态只相对于调用方明确选择的
    /// ownership target 计算。
    pub async fn discover_available_for_target(
        &self,
        db: &Arc<Database>,
        target: &ScopeTarget,
        repos: Vec<SubagentRepo>,
    ) -> Result<Vec<DiscoverableSubagent>, AppError> {
        // 在远端下载前先核验 project root；不可用 target 不应触发网络扫描，
        // 更不能在扫描结果上标记任何缓存安装状态。
        ProjectService::resolve_scope_target(db, target)?;
        let mut subagents = self.discover_available(repos).await?;
        Self::set_discoverable_installed_state_for_target(db, target, &mut subagents)?;
        Ok(subagents)
    }

    /// 为已获取的发现候选标记明确 target 的安装状态。网络扫描和 ownership
    /// 判断保持分离，避免 global 记录错误地污染 project discovery。
    fn set_discoverable_installed_state_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        subagents: &mut [DiscoverableSubagent],
    ) -> Result<(), AppError> {
        ProjectService::resolve_scope_target(db, target)?;
        let installed = db.get_all_installed_subagents_for_target(target)?;
        for subagent in subagents {
            subagent.installed = installed.contains_key(&subagent.key);
        }
        Ok(())
    }

    async fn fetch_repo_subagents(
        &self,
        repo: &SubagentRepo,
    ) -> Result<Vec<DiscoverableSubagent>, AppError> {
        let client = SkillService.download_client();
        let skill_repo = SkillRepo {
            owner: repo.owner.clone(),
            name: repo.name.clone(),
            branch: repo.branch.clone(),
            enabled: true,
        };
        let (temp_guard, resolved_branch) =
            SkillService::download_repo_with_timeout(&client, &skill_repo).await?;

        let mut subagents = Vec::new();
        let scan_dir = temp_guard.path();
        let resolved_repo = SubagentRepo {
            owner: repo.owner.clone(),
            name: repo.name.clone(),
            branch: resolved_branch,
            enabled: true,
        };
        Self::scan_dir_recursive_static(scan_dir, scan_dir, &resolved_repo, &mut subagents)?;

        Ok(subagents)
    }

    fn scan_dir_recursive_static(
        current_dir: &Path,
        base_dir: &Path,
        repo: &SubagentRepo,
        subagents: &mut Vec<DiscoverableSubagent>,
    ) -> Result<(), AppError> {
        let entries = fs::read_dir(current_dir).map_err(|e| AppError::io(current_dir, e))?;
        for entry in entries {
            let entry = entry.map_err(|e| AppError::io(current_dir, e))?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name.starts_with('.') {
                continue;
            }

            if path.is_dir() {
                Self::scan_dir_recursive_static(&path, base_dir, repo, subagents)?;
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Ok(subagent) = Self::build_subagent_from_file(&path, base_dir, repo) {
                    subagents.push(subagent);
                }
            }
        }

        Ok(())
    }

    fn build_subagent_from_file(
        file: &Path,
        base_dir: &Path,
        repo: &SubagentRepo,
    ) -> Result<DiscoverableSubagent, AppError> {
        let meta = SkillService::parse_skill_metadata_static(file)?;
        let name = meta.name.ok_or_else(|| {
            AppError::InvalidInput(format!("缺少 name frontmatter: {}", file.display()))
        })?;

        let rel_path = file
            .strip_prefix(base_dir)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");

        let install_name = file
            .file_stem()
            .and_then(|s| SkillService::sanitize_install_name(&s.to_string_lossy()))
            .unwrap_or_else(|| name.replace(' ', "-").to_lowercase());

        let description = meta.description.unwrap_or_else(|| {
            file.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default()
        });

        let readme_url =
            SkillService::build_skill_doc_url(&repo.owner, &repo.name, &repo.branch, &rel_path);

        Ok(DiscoverableSubagent {
            key: format!("{}/{}:{}", repo.owner, repo.name, rel_path),
            name,
            description,
            directory: install_name,
            path: rel_path,
            readme_url,
            repo_owner: repo.owner.clone(),
            repo_name: repo.name.clone(),
            repo_branch: repo.branch.clone(),
            installed: false,
        })
    }

    fn deduplicate_discoverable_subagents(subagents: &mut Vec<DiscoverableSubagent>) {
        let mut seen = HashMap::new();
        subagents.retain(|subagent| {
            let unique_key = subagent.key.to_lowercase();
            if let std::collections::hash_map::Entry::Vacant(e) = seen.entry(unique_key) {
                e.insert(true);
                true
            } else {
                false
            }
        });
    }

    fn sanitize_subagent_source_path(raw: &str) -> Option<PathBuf> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }

        let mut normalized = PathBuf::new();
        let mut has_component = false;

        for component in Path::new(trimmed).components() {
            match component {
                Component::Normal(name) => {
                    let segment = name.to_string_lossy().trim().to_string();
                    if segment.is_empty() || segment == "." || segment == ".." {
                        return None;
                    }
                    normalized.push(segment);
                    has_component = true;
                }
                Component::CurDir
                | Component::ParentDir
                | Component::RootDir
                | Component::Prefix(_) => {
                    return None;
                }
            }
        }

        has_component.then_some(normalized)
    }

    // ========== Install ==========

    pub async fn install(
        &self,
        db: &Arc<Database>,
        subagent: &DiscoverableSubagent,
        current_app: &AgentType,
    ) -> Result<InstalledSubagent, AppError> {
        self.install_for_target(db, &ScopeTarget::Global, subagent, current_app)
            .await
    }

    pub async fn install_for_target(
        &self,
        db: &Arc<Database>,
        target: &ScopeTarget,
        subagent: &DiscoverableSubagent,
        current_app: &AgentType,
    ) -> Result<InstalledSubagent, AppError> {
        Self::ensure_app_supported_for_target(target, current_app)?;
        ProjectService::resolve_scope_target(db, target)?;
        let ssot_dir = Self::get_ssot_dir_for_target(db, target)?;

        let source_rel = Self::sanitize_subagent_source_path(&subagent.path).ok_or_else(|| {
            AppError::Message(format_subagent_error(
                "INVALID_SUBAGENT_PATH",
                &[("path", &subagent.path)],
                Some("checkRepoUrl"),
            ))
        })?;

        let install_name = source_rel
            .file_stem()
            .and_then(|name| SkillService::sanitize_install_name(&name.to_string_lossy()))
            .ok_or_else(|| {
                AppError::Message(format_subagent_error(
                    "INVALID_SUBAGENT_NAME",
                    &[("path", &subagent.path)],
                    Some("checkRepoUrl"),
                ))
            })?;

        {
            let _state_guard = subagent_state_write_guard();
            if let Some(existing) = Self::reuse_existing_install_for_target(
                db,
                target,
                subagent,
                &install_name,
                current_app,
            )? {
                return Ok(existing);
            }
        }

        // 该 dest_file 仅用于决定是否需要下载；真正落盘的目标路径在写锁内重新解析，
        // 避免下载期间发生的存储迁移把新 subagent 写入旧根。
        let dest_file = Self::ssot_file_path(&ssot_dir, &install_name);
        let mut repo_branch = subagent.repo_branch.clone();
        let mut downloaded_source: Option<(tempfile::TempDir, PathBuf)> = None;

        if !dest_file.exists() {
            let skill_repo = SkillRepo {
                owner: subagent.repo_owner.clone(),
                name: subagent.repo_name.clone(),
                branch: subagent.repo_branch.clone(),
                enabled: true,
            };

            let client = SkillService.download_client();
            let (temp_guard, used_branch) =
                SkillService::download_repo_with_timeout(&client, &skill_repo).await?;
            let temp_dir = temp_guard.path();
            repo_branch = used_branch;

            let source_file = temp_dir.join(&source_rel);
            let canonical_temp = temp_dir
                .canonicalize()
                .unwrap_or_else(|_| temp_dir.to_path_buf());
            let canonical_source = source_file.canonicalize().map_err(|_| {
                AppError::Message(format_subagent_error(
                    "SUBAGENT_FILE_NOT_FOUND",
                    &[("path", &subagent.path)],
                    Some("checkRepoUrl"),
                ))
            })?;
            if !canonical_source.starts_with(&canonical_temp) || !canonical_source.is_file() {
                return Err(AppError::Message(format_subagent_error(
                    "INVALID_SUBAGENT_PATH",
                    &[("path", &subagent.path)],
                    Some("checkRepoUrl"),
                )));
            }
            Self::validate_project_subagent_file_for_app(target, &canonical_source, current_app)?;

            downloaded_source = Some((temp_guard, canonical_source));

            if repo_branch != subagent.repo_branch {
                log::info!(
                    "Subagent {}/{} 分支自动回退: {} -> {}",
                    subagent.repo_owner,
                    subagent.repo_name,
                    subagent.repo_branch,
                    repo_branch
                );
            }
        }

        Self::finish_install_under_lock(
            db,
            target,
            subagent,
            &install_name,
            current_app,
            repo_branch,
            downloaded_source
                .as_ref()
                .map(|(_, source)| source.as_path()),
        )
    }

    /// 安装落盘段：持写锁执行。目标 SSOT 路径在锁内重新解析，
    /// 避免下载期间发生的存储迁移把新 subagent 写入旧根。
    fn finish_install_under_lock(
        db: &Arc<Database>,
        target: &ScopeTarget,
        subagent: &DiscoverableSubagent,
        install_name: &str,
        current_app: &AgentType,
        repo_branch: String,
        downloaded_source: Option<&Path>,
    ) -> Result<InstalledSubagent, AppError> {
        let _state_guard = subagent_state_write_guard();
        Self::ensure_app_supported_for_target(target, current_app)?;
        ProjectService::resolve_scope_target(db, target)?;
        if let Some(existing) = Self::reuse_existing_install_for_target(
            db,
            target,
            subagent,
            install_name,
            current_app,
        )? {
            return Ok(existing);
        }

        // 写锁内重新解析目标 SSOT：下载期间存储位置可能已迁移
        let dest_file =
            Self::ssot_file_path(&Self::get_ssot_dir_for_target(db, target)?, install_name);

        // 磁盘上已有同名文件但 DB 无记录：未托管内容，拒绝冒名接管
        Self::ensure_no_unmanaged_destination(&dest_file, install_name)?;

        if !dest_file.exists() {
            let source_file = downloaded_source.ok_or_else(|| {
                AppError::Message("Subagent file changed during install; please retry".to_string())
            })?;
            config::copy_file(source_file, &dest_file)?;
        }

        let content_hash = SkillService::compute_file_hash(&dest_file)
            .map(Some)
            .unwrap_or_else(|e| {
                log::warn!("Failed to compute content hash for {}: {e}", install_name);
                None
            });

        let readme_url = SkillService::build_skill_doc_url(
            &subagent.repo_owner,
            &subagent.repo_name,
            &repo_branch,
            &subagent.path,
        );

        let installed_subagent = InstalledSubagent {
            id: subagent.key.clone(),
            name: subagent.name.clone(),
            description: if subagent.description.is_empty() {
                None
            } else {
                Some(subagent.description.clone())
            },
            directory: install_name.to_string(),
            repo_owner: Some(subagent.repo_owner.clone()),
            repo_name: Some(subagent.repo_name.clone()),
            repo_branch: Some(repo_branch),
            readme_url,
            apps: SubagentApps::only(current_app),
            installed_at: chrono::Utc::now().timestamp(),
            content_hash,
            updated_at: 0,
            target: target.clone(),
        };

        Self::persist_and_sync_new_subagent(
            db,
            target,
            &installed_subagent,
            current_app,
            Some(&dest_file),
        )?;

        log::info!(
            "Subagent {} 安装成功，已启用 {}",
            installed_subagent.name,
            current_app.as_str()
        );

        Ok(installed_subagent)
    }

    /// `fresh_ssot_file` 仅当是本次安装新建的 SSOT 文件时传入：
    /// 回滚时连同该文件一起删除，避免残留"非受管内容"导致下次安装被拒。
    /// 接管/复用的既有文件绝不删除。
    fn persist_and_sync_new_subagent(
        db: &Arc<Database>,
        target: &ScopeTarget,
        subagent: &InstalledSubagent,
        app: &AgentType,
        fresh_ssot_file: Option<&Path>,
    ) -> Result<(), AppError> {
        let cleanup_fresh_ssot_file = || {
            if let Some(file) = fresh_ssot_file {
                if let Err(e) = fs::remove_file(file) {
                    log::error!("回滚新建 Subagent SSOT 文件失败 {}: {e}", file.display());
                }
            }
        };

        if let Err(error) = db.save_subagent(subagent) {
            cleanup_fresh_ssot_file();
            return Err(error);
        }
        if let Err(error) = Self::sync_to_app_dir_for_target(db, target, &subagent.directory, app) {
            if let Err(rollback_error) = db.delete_subagent_for_target(&subagent.id, target) {
                log::error!(
                    "Failed to roll back Subagent {} after sync error: {rollback_error}",
                    subagent.id
                );
            }
            cleanup_fresh_ssot_file();
            return Err(error);
        }
        Ok(())
    }

    // ========== File sync methods ==========

    fn copy_file_atomic(source: &Path, dest: &Path) -> Result<(), AppError> {
        let parent = dest.parent().ok_or_else(|| {
            AppError::InvalidInput(format!("Invalid destination: {}", dest.display()))
        })?;
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;

        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp = parent.join(format!(
            ".{}.tmp-{}-{}",
            dest.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("subagent"),
            std::process::id(),
            nonce
        ));

        if let Err(e) = fs::copy(source, &tmp) {
            let _ = SkillService::remove_path(&tmp);
            return Err(AppError::io(&tmp, e));
        }

        if dest.exists() || SkillService::is_symlink(dest) {
            SkillService::remove_path(dest)?;
        }

        fs::rename(&tmp, dest).map_err(|e| {
            let _ = SkillService::remove_path(&tmp);
            AppError::IoContext {
                context: format!(
                    "替换 subagent 文件失败: {} -> {}",
                    tmp.display(),
                    dest.display()
                ),
                source: e,
            }
        })
    }

    pub fn sync_to_app_dir(directory: &str, app: &AgentType) -> Result<(), AppError> {
        let ssot_dir = Self::get_ssot_dir()?;
        let app_dir = Self::get_distinct_app_subagents_dir(&ssot_dir, app)?;
        Self::sync_to_app_dir_with_roots(directory, app, ssot_dir, app_dir)
    }

    /// 将明确 target 的 SSOT Subagent 同步到该 target 的 Agent 投影。
    pub(crate) fn sync_to_app_dir_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        directory: &str,
        app: &AgentType,
    ) -> Result<(), AppError> {
        Self::ensure_app_supported_for_target(target, app)?;
        let directory = SkillService::require_valid_directory(directory)?;
        let ssot_dir = Self::get_ssot_dir_for_target(db, target)?;
        let app_dir = Self::get_distinct_app_subagents_dir_for_target(db, target, &ssot_dir, app)?;
        let source = Self::ssot_file_path(&ssot_dir, &directory);
        Self::validate_sync_source_file(&source, &directory)?;
        Self::validate_project_subagent_file_for_app(target, &source, app)?;
        Self::sync_to_app_dir_with_roots(&directory, app, ssot_dir, app_dir)
    }

    fn sync_to_app_dir_with_roots(
        directory: &str,
        _app: &AgentType,
        ssot_dir: PathBuf,
        app_dir: PathBuf,
    ) -> Result<(), AppError> {
        let directory = SkillService::require_valid_directory(directory)?;
        let source = Self::ssot_file_path(&ssot_dir, &directory);
        Self::validate_sync_source_file(&source, &directory)?;
        fs::create_dir_all(&app_dir).map_err(|e| AppError::io(&app_dir, e))?;

        let dest = app_dir.join(format!("{directory}.md"));
        let sync_method = SkillService::get_sync_method();

        match sync_method {
            SyncMethod::Auto => {
                if dest.exists() && !SkillService::is_symlink(&dest) {
                    Self::copy_file_atomic(&source, &dest)?;
                    return Ok(());
                }

                if SkillService::is_symlink(&dest) {
                    SkillService::remove_path(&dest)?;
                }

                match SkillService::create_symlink(&source, &dest, true) {
                    Ok(()) => return Ok(()),
                    Err(err) => {
                        log::warn!(
                            "Subagent symlink 创建失败，将回退到复制: {} -> {}. 错误: {err:#}",
                            source.display(),
                            dest.display()
                        );
                    }
                }
                Self::copy_file_atomic(&source, &dest)?;
            }
            SyncMethod::Symlink => {
                if dest.exists() || SkillService::is_symlink(&dest) {
                    SkillService::remove_path(&dest)?;
                }
                SkillService::create_symlink(&source, &dest, true)?;
            }
            SyncMethod::Copy => {
                Self::copy_file_atomic(&source, &dest)?;
            }
        }

        Ok(())
    }

    fn validate_sync_source_file(source: &Path, directory: &str) -> Result<(), AppError> {
        if !source.is_file() {
            return Err(AppError::InvalidInput(format!(
                "Subagent 不存在于 SSOT: {directory}"
            )));
        }
        Ok(())
    }

    pub fn remove_from_app(directory: &str, app: &AgentType) -> Result<(), AppError> {
        let directory = SkillService::require_valid_directory(directory)?;

        let ssot_dir = Self::get_ssot_dir()?;
        let app_dir = Self::get_distinct_app_subagents_dir(&ssot_dir, app)?;
        Self::remove_from_app_with_roots(&directory, app, app_dir)
    }

    /// 从明确 target 的 Agent 投影删除 Subagent。项目 root 无法解析时失败，绝不触碰
    /// global 投影。
    pub(crate) fn remove_from_app_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        directory: &str,
        app: &AgentType,
    ) -> Result<(), AppError> {
        Self::ensure_app_supported_for_target(target, app)?;
        let directory = SkillService::require_valid_directory(directory)?;
        let ssot_dir = Self::get_ssot_dir_for_target(db, target)?;
        let app_dir = Self::get_distinct_app_subagents_dir_for_target(db, target, &ssot_dir, app)?;
        Self::remove_from_app_with_roots(&directory, app, app_dir)
    }

    fn remove_from_app_with_roots(
        directory: &str,
        app: &AgentType,
        app_dir: PathBuf,
    ) -> Result<(), AppError> {
        let subagent_path = app_dir.join(format!("{directory}.md"));

        if subagent_path.exists() || SkillService::is_symlink(&subagent_path) {
            SkillService::remove_path(&subagent_path)?;
            log::debug!("Subagent {directory} 已从 {} 删除", app.as_str());
        }

        Ok(())
    }

    pub fn sync_to_app(db: &Arc<Database>, app: &AgentType) -> Result<(), AppError> {
        let _state_guard = subagent_state_read_guard();
        Self::sync_to_app_unlocked(db, app)
    }

    pub(crate) fn sync_to_app_unlocked(
        db: &Arc<Database>,
        app: &AgentType,
    ) -> Result<(), AppError> {
        let subagents = db.get_all_installed_subagents()?;
        let ssot_dir = Self::get_ssot_dir()?;
        let app_dir = Self::get_distinct_app_subagents_dir(&ssot_dir, app)?;

        let indexed_subagents: HashMap<String, &InstalledSubagent> = subagents
            .values()
            .map(|subagent| (subagent.directory.to_lowercase(), subagent))
            .collect();

        if app_dir.exists() {
            for entry in fs::read_dir(&app_dir).map_err(|e| AppError::io(&app_dir, e))? {
                let entry = entry.map_err(|e| AppError::io(&app_dir, e))?;
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();

                if !file_name.ends_with(".md") {
                    continue;
                }
                let stem = file_name.trim_end_matches(".md").to_lowercase();

                if let Some(subagent) = indexed_subagents.get(&stem) {
                    if !subagent.apps.is_enabled_for(app) {
                        SkillService::remove_path(&path)?;
                    }
                    continue;
                }

                if Self::is_symlink_to_ssot(&path, &ssot_dir) {
                    SkillService::remove_path(&path)?;
                }
            }
        }

        let mut sync_failures: Vec<String> = Vec::new();
        for subagent in subagents.values() {
            if subagent.apps.is_enabled_for(app) {
                if let Err(err) = Self::sync_to_app_dir(&subagent.directory, app) {
                    log::warn!(
                        "同步 subagent {} 到 {} 失败: {err}",
                        subagent.directory,
                        app.as_str()
                    );
                    sync_failures.push(subagent.directory.clone());
                }
            }
        }

        if !sync_failures.is_empty() {
            return Err(AppError::Message(format_subagent_error(
                "PROJECTION_SYNC_FAILED",
                &[("app", app.as_str()), ("items", &sync_failures.join(", "))],
                Some("checkPermission"),
            )));
        }

        Ok(())
    }

    /// 在外部已持有 Subagent 写锁时，重建一个明确 target 的单个 Agent 投影。
    /// Codex 项目 Subagent 不参与重建；它没有可投影的受支持路径。
    pub(crate) fn sync_target_to_app_unlocked(
        db: &Arc<Database>,
        target: &ScopeTarget,
        app: &AgentType,
    ) -> Result<(), AppError> {
        if !Self::app_is_supported_for_target(target, app) {
            return Ok(());
        }
        ProjectService::resolve_scope_target(db, target)?;
        let subagents = db.get_all_installed_subagents_for_target(target)?;
        let mut sync_failures = Vec::new();
        for subagent in subagents.values() {
            if !subagent.apps.is_enabled_for(app) {
                continue;
            }
            if let Err(error) =
                Self::sync_to_app_dir_for_target(db, target, &subagent.directory, app)
            {
                log::warn!(
                    "同步 {} target 的 Subagent {} 到 {} 失败: {error}",
                    match target {
                        ScopeTarget::Global => "global",
                        ScopeTarget::Project { .. } => "project",
                    },
                    subagent.directory,
                    app.as_str()
                );
                sync_failures.push(subagent.directory.clone());
            }
        }
        if !sync_failures.is_empty() {
            return Err(AppError::Message(format_subagent_error(
                "PROJECTION_SYNC_FAILED",
                &[("app", app.as_str()), ("items", &sync_failures.join(", "))],
                Some("checkPermission"),
            )));
        }
        Ok(())
    }

    fn is_symlink_to_ssot(path: &Path, ssot_dir: &Path) -> bool {
        if !SkillService::is_symlink(path) {
            return false;
        }

        let Ok(target) = fs::read_link(path) else {
            return false;
        };

        if target.is_absolute() && target.starts_with(ssot_dir) {
            return true;
        }

        let resolved = path
            .parent()
            .map(|parent| parent.join(&target))
            .unwrap_or(target.clone());

        let canonical_ssot = ssot_dir
            .canonicalize()
            .unwrap_or_else(|_| ssot_dir.to_path_buf());
        let canonical_target = resolved.canonicalize().unwrap_or(resolved);

        canonical_target.starts_with(&canonical_ssot)
    }

    // ========== Toggle ==========

    pub fn toggle_app(
        db: &Arc<Database>,
        id: &str,
        app: &AgentType,
        enabled: bool,
    ) -> Result<(), AppError> {
        Self::toggle_app_for_target(db, &ScopeTarget::Global, id, app, enabled)
    }

    pub fn toggle_app_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        id: &str,
        app: &AgentType,
        enabled: bool,
    ) -> Result<(), AppError> {
        let _state_guard = subagent_state_write_guard();
        Self::ensure_app_supported_for_target(target, app)?;
        ProjectService::resolve_scope_target(db, target)?;

        let mut subagent = db
            .get_installed_subagent_for_target(id, target)?
            .ok_or_else(|| AppError::InvalidInput(format!("Subagent not found: {id}")))?;

        let was_enabled = subagent.apps.is_enabled_for(app);
        subagent.apps.set_enabled_for(app, enabled);

        if enabled {
            Self::sync_to_app_dir_for_target(db, target, &subagent.directory, app)?;
        } else {
            Self::remove_from_app_for_target(db, target, &subagent.directory, app)?;
        }

        if let Err(error) = db.update_subagent_apps_for_target(id, target, &subagent.apps) {
            // 落库失败：撤销刚才的投影变更，恢复到操作前状态；
            // 撤销失败仅记日志，不掩盖原始的落库错误
            if was_enabled != enabled {
                let rollback_result = if enabled {
                    Self::remove_from_app_for_target(db, target, &subagent.directory, app)
                } else {
                    Self::sync_to_app_dir_for_target(db, target, &subagent.directory, app)
                };
                if let Err(rollback_error) = rollback_result {
                    log::error!(
                        "Subagent {} 落库失败后撤销 {} 的投影变更也失败: {rollback_error}",
                        subagent.name,
                        app.as_str()
                    );
                }
            }
            return Err(error);
        }

        log::info!(
            "Subagent {} 的 {} 状态已更新为 {}",
            subagent.name,
            app.as_str(),
            enabled
        );

        Ok(())
    }

    // ========== Uninstall ==========

    pub fn uninstall(db: &Arc<Database>, id: &str) -> Result<SubagentUninstallResult, AppError> {
        Self::uninstall_for_target(db, &ScopeTarget::Global, id)
    }

    pub fn uninstall_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        id: &str,
    ) -> Result<SubagentUninstallResult, AppError> {
        let _state_guard = subagent_state_write_guard();
        ProjectService::resolve_scope_target(db, target)?;

        let subagent = db
            .get_installed_subagent_for_target(id, target)?
            .ok_or_else(|| AppError::InvalidInput(format!("Subagent not found: {id}")))?;
        Self::ensure_enabled_apps_supported_for_target(target, &subagent.apps)?;

        let directory = match SkillService::require_valid_directory(&subagent.directory) {
            Ok(directory) => directory,
            Err(err) => {
                log::warn!(
                    "Subagent {id} 的 directory 非法（{:?}），跳过文件清理，仅删除数据库记录: {err}",
                    subagent.directory
                );
                db.delete_subagent_for_target(id, target)?;
                return Ok(SubagentUninstallResult { backup_path: None });
            }
        };

        let ssot_dir = Self::get_ssot_dir_for_target(db, target)?;

        let mut projection_failures: Vec<AgentType> = Vec::new();
        // 只清理实际启用的 Agent 投影：未启用 Agent 下的同名路径可能是用户自有内容
        for app in subagent.apps.enabled_apps() {
            if let Err(e) = Self::remove_from_app_for_target(db, target, &directory, &app) {
                log::warn!(
                    "移除 Subagent {} 在 {} 上的投影失败: {e}",
                    subagent.name,
                    app.as_str()
                );
                projection_failures.push(app);
            }
        }
        if !projection_failures.is_empty() {
            return Err(AppError::Message(format_subagent_error(
                "UNINSTALL_PROJECTION_FAILED",
                &[(
                    "apps",
                    &projection_failures
                        .iter()
                        .map(|a| a.as_str())
                        .collect::<Vec<_>>()
                        .join(", "),
                )],
                Some("checkPermission"),
            )));
        }

        let backup_path = Self::create_uninstall_backup_for_target(db, target, &subagent)?
            .map(|path| path.to_string_lossy().to_string());

        let subagent_file = Self::ssot_file_path(&ssot_dir, &directory);
        if subagent_file.exists() {
            fs::remove_file(&subagent_file).map_err(|e| AppError::io(&subagent_file, e))?;
        }

        db.delete_subagent_for_target(id, target)?;

        log::info!(
            "Subagent {} 卸载成功{}",
            subagent.name,
            backup_path
                .as_deref()
                .map(|path| format!(", backup: {path}"))
                .unwrap_or_default()
        );

        Ok(SubagentUninstallResult { backup_path })
    }

    // ========== Hash & metadata ==========

    fn local_hash_for_update_check(
        ssot_dir: &Path,
        raw_directory: &str,
        cached_hash: Option<&str>,
    ) -> Option<(String, bool)> {
        let directory = match SkillService::require_valid_directory(raw_directory) {
            Ok(d) => d,
            Err(err) => {
                log::warn!("Subagent directory 非法，跳过本地文件检查: {err}");
                return cached_hash.map(|h| (h.to_string(), false));
            }
        };

        let local_file = Self::ssot_file_path(ssot_dir, &directory);
        if !local_file.exists() {
            return None;
        }

        if let Some(h) = cached_hash {
            return Some((h.to_string(), false));
        }

        match SkillService::compute_file_hash(&local_file) {
            Ok(h) => Some((h, true)),
            Err(_) => None,
        }
    }

    /// 按完整身份 `{owner}/{repo}:{path}` 匹配远程候选。
    ///
    /// 不能用 stem 推导的 `directory` 匹配：同一仓库可能同时存在
    /// `a/reviewer.md` 与 `b/reviewer.md`，stem 匹配会更新错文件。
    fn remote_match_for_installed<'a>(
        remote: &'a [DiscoverableSubagent],
        installed: &InstalledSubagent,
    ) -> Option<&'a DiscoverableSubagent> {
        let installed_path = installed
            .id
            .split_once(':')
            .map(|(_, path)| path)
            .unwrap_or(&installed.directory);
        remote
            .iter()
            .find(|rs| rs.key.eq_ignore_ascii_case(&installed.id))
            .or_else(|| {
                remote
                    .iter()
                    .find(|rs| rs.path.eq_ignore_ascii_case(installed_path))
            })
    }

    // ========== Updates ==========

    pub async fn check_updates(
        &self,
        db: &Arc<Database>,
    ) -> Result<Vec<SubagentUpdateInfo>, AppError> {
        self.check_updates_for_target(db, &ScopeTarget::Global)
            .await
    }

    pub async fn check_updates_for_target(
        &self,
        db: &Arc<Database>,
        target: &ScopeTarget,
    ) -> Result<Vec<SubagentUpdateInfo>, AppError> {
        ProjectService::resolve_scope_target(db, target)?;
        let subagents = db.get_all_installed_subagents_for_target(target)?;
        let mut updates = Vec::new();

        let mut repo_groups: HashMap<(String, String, String), Vec<InstalledSubagent>> =
            HashMap::new();

        for subagent in subagents.into_values() {
            let (owner, name, branch) = match (
                &subagent.repo_owner,
                &subagent.repo_name,
                &subagent.repo_branch,
            ) {
                (Some(o), Some(n), Some(b)) => (o.clone(), n.clone(), b.clone()),
                (Some(o), Some(n), None) => (o.clone(), n.clone(), "main".to_string()),
                _ => continue,
            };
            repo_groups
                .entry((owner, name, branch))
                .or_default()
                .push(subagent);
        }

        let ssot_dir = Self::get_ssot_dir_for_target(db, target)?;
        let client = SkillService.download_client();

        for ((owner, name, branch), group_subagents) in &repo_groups {
            let skill_repo = SkillRepo {
                owner: owner.clone(),
                name: name.clone(),
                branch: branch.clone(),
                enabled: true,
            };

            let (temp_guard, _used_branch) =
                match SkillService::download_repo_with_timeout(&client, &skill_repo).await {
                    Ok(result) => result,
                    Err(e) => {
                        log::warn!("检查 subagent 更新时下载 {}/{} 失败: {e}", owner, name);
                        continue;
                    }
                };
            let temp_dir = temp_guard.path();

            let mut remote_subagents: Vec<DiscoverableSubagent> = Vec::new();
            let resolved_repo = SubagentRepo {
                owner: owner.clone(),
                name: name.clone(),
                branch: branch.clone(),
                enabled: true,
            };
            let _ = Self::scan_dir_recursive_static(
                temp_dir,
                temp_dir,
                &resolved_repo,
                &mut remote_subagents,
            );

            let _state_guard = subagent_state_read_guard();

            for subagent in group_subagents {
                let remote_match = Self::remote_match_for_installed(&remote_subagents, subagent);

                let remote_file = match remote_match {
                    Some(rs) => temp_dir.join(&rs.path),
                    None => continue,
                };

                let remote_hash = match SkillService::compute_file_hash(&remote_file) {
                    Ok(h) => h,
                    Err(e) => {
                        log::warn!("计算远程 subagent 哈希失败 {}: {e}", subagent.id);
                        continue;
                    }
                };

                let local_hash = match Self::local_hash_for_update_check(
                    &ssot_dir,
                    &subagent.directory,
                    subagent.content_hash.as_deref(),
                ) {
                    Some((h, freshly_computed)) => {
                        if freshly_computed {
                            let _ = db.update_subagent_hash_for_target(&subagent.id, target, &h, 0);
                        }
                        Some(h)
                    }
                    None => None,
                };

                if local_hash.as_deref() != Some(&remote_hash) {
                    updates.push(SubagentUpdateInfo {
                        id: subagent.id.clone(),
                        name: subagent.name.clone(),
                        current_hash: local_hash,
                        remote_hash,
                    });
                }
            }
        }

        Ok(updates)
    }

    fn persist_updated_subagent_metadata(
        db: &Arc<Database>,
        updated_subagent: &InstalledSubagent,
    ) -> Result<InstalledSubagent, AppError> {
        if !db.update_subagent_metadata(updated_subagent)? {
            return Err(AppError::InvalidInput(format!(
                "Subagent no longer installed: {}",
                updated_subagent.id
            )));
        }

        db.get_installed_subagent_for_target(&updated_subagent.id, &updated_subagent.target)?
            .ok_or_else(|| {
                AppError::InvalidInput(format!(
                    "Subagent no longer installed: {}",
                    updated_subagent.id
                ))
            })
    }

    /// 用 `source` 替换 SSOT 文件 `dest`。
    fn replace_ssot_file(source: &Path, dest: &Path) -> Result<(), AppError> {
        if dest.exists() {
            fs::remove_file(dest).map_err(|e| AppError::io(dest, e))?;
        }
        config::copy_file(source, dest)
    }

    /// 最佳努力：从更新前创建的备份恢复 SSOT 文件。
    fn restore_ssot_from_backup(backup_path: Option<&PathBuf>, dest: &Path, directory: &str) {
        let Some(backup) = backup_path else { return };
        let backup_subagent_file = backup.join(format!("{directory}.md"));
        if !backup_subagent_file.exists() {
            return;
        }
        let _ = fs::remove_file(dest);
        if let Err(e) = config::copy_file(&backup_subagent_file, dest) {
            log::error!("从备份恢复 SSOT 文件失败 {}: {e}", dest.display());
        }
    }

    /// 持久化更新后的元数据；失败时从备份恢复 SSOT、还原数据库记录并重新同步投影，
    /// 避免磁盘上是新版本而 DB 保留旧哈希/元数据的分叉状态。
    fn persist_subagent_update_or_restore(
        db: &Arc<Database>,
        previous: &InstalledSubagent,
        updated_metadata: &InstalledSubagent,
        backup_path: Option<&PathBuf>,
        dest: &Path,
    ) -> Result<InstalledSubagent, AppError> {
        match Self::persist_updated_subagent_metadata(db, updated_metadata) {
            Ok(updated) => Ok(updated),
            Err(err) => {
                Self::restore_ssot_from_backup(backup_path, dest, &previous.directory);
                let _ = db.save_subagent(previous);
                for app in previous.apps.enabled_apps() {
                    let _ = Self::sync_to_app_dir_for_target(
                        db,
                        &previous.target,
                        &previous.directory,
                        &app,
                    );
                }
                Err(err)
            }
        }
    }

    pub async fn update_subagent(
        &self,
        db: &Arc<Database>,
        subagent_id: &str,
    ) -> Result<InstalledSubagent, AppError> {
        self.update_subagent_for_target(db, &ScopeTarget::Global, subagent_id)
            .await
    }

    pub async fn update_subagent_for_target(
        &self,
        db: &Arc<Database>,
        target: &ScopeTarget,
        subagent_id: &str,
    ) -> Result<InstalledSubagent, AppError> {
        ProjectService::resolve_scope_target(db, target)?;
        let subagent = db
            .get_installed_subagent_for_target(subagent_id, target)?
            .ok_or_else(|| AppError::InvalidInput(format!("Subagent not found: {subagent_id}")))?;
        Self::ensure_enabled_apps_supported_for_target(target, &subagent.apps)?;

        SkillService::require_valid_directory(&subagent.directory)?;

        let (owner, name, branch) = match (&subagent.repo_owner, &subagent.repo_name) {
            (Some(o), Some(n)) => (
                o.clone(),
                n.clone(),
                subagent
                    .repo_branch
                    .clone()
                    .unwrap_or_else(|| "main".to_string()),
            ),
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "Cannot update local subagent: {subagent_id}"
                )))
            }
        };

        let skill_repo = SkillRepo {
            owner: owner.clone(),
            name: name.clone(),
            branch: branch.clone(),
            enabled: true,
        };

        let client = SkillService.download_client();
        let (temp_guard, used_branch) =
            SkillService::download_repo_with_timeout(&client, &skill_repo).await?;
        let temp_dir = temp_guard.path();

        let mut remote_subagents: Vec<DiscoverableSubagent> = Vec::new();
        let resolved_repo = SubagentRepo {
            owner: owner.clone(),
            name: name.clone(),
            branch: used_branch.clone(),
            enabled: true,
        };
        Self::scan_dir_recursive_static(temp_dir, temp_dir, &resolved_repo, &mut remote_subagents)?;

        let remote_match = Self::remote_match_for_installed(&remote_subagents, &subagent)
            .ok_or_else(|| {
                AppError::Message(format_subagent_error(
                    "SUBAGENT_FILE_NOT_FOUND",
                    &[("directory", &subagent.directory)],
                    Some("checkRepoUrl"),
                ))
            })?;

        let remote_file = temp_dir.join(&remote_match.path);

        Self::apply_downloaded_update(
            db,
            target,
            &subagent,
            &owner,
            &name,
            used_branch,
            &remote_file,
            &remote_match.path,
        )
    }

    /// 更新落盘段：持写锁执行。目标 SSOT 路径在锁内才解析，
    /// 避免下载期间发生的存储迁移把新版本写入旧根（而备份/投影解析的是新根）。
    // 保持事务输入显式，避免仅为 clippy 创建一次性参数对象。
    #[allow(clippy::too_many_arguments)]
    fn apply_downloaded_update(
        db: &Arc<Database>,
        target: &ScopeTarget,
        expected: &InstalledSubagent,
        owner: &str,
        name: &str,
        used_branch: String,
        remote_file: &Path,
        remote_path: &str,
    ) -> Result<InstalledSubagent, AppError> {
        let _state_guard = subagent_state_write_guard();
        ProjectService::resolve_scope_target(db, target)?;

        let current_subagent = db
            .get_installed_subagent_for_target(&expected.id, target)?
            .ok_or_else(|| {
                AppError::InvalidInput(format!("Subagent no longer installed: {}", expected.id))
            })?;
        if current_subagent.directory != expected.directory
            || current_subagent.repo_owner != expected.repo_owner
            || current_subagent.repo_name != expected.repo_name
            || current_subagent.repo_branch != expected.repo_branch
            || current_subagent.installed_at != expected.installed_at
        {
            return Err(AppError::InvalidInput(format!(
                "Subagent changed during update: {}",
                expected.id
            )));
        }
        Self::ensure_enabled_apps_supported_for_target(target, &current_subagent.apps)?;
        SkillService::require_valid_directory(&current_subagent.directory)?;
        let subagent = current_subagent;
        for app in subagent.apps.enabled_apps() {
            Self::validate_project_subagent_file_for_app(target, remote_file, &app)?;
        }

        // 写锁内解析目标 SSOT：下载期间存储位置可能已迁移
        let dest_file = Self::ssot_file_path(
            &Self::get_ssot_dir_for_target(db, target)?,
            &subagent.directory,
        );

        let backup_path = Self::create_uninstall_backup_for_target(db, target, &subagent)?;

        // SSOT 替换失败时必须先从备份恢复，避免 SSOT 文件丢失
        if let Err(err) = Self::replace_ssot_file(remote_file, &dest_file) {
            Self::restore_ssot_from_backup(backup_path.as_ref(), &dest_file, &subagent.directory);
            return Err(err);
        }

        let new_hash = SkillService::compute_file_hash(&dest_file).ok();

        let (new_name, new_description) = {
            let meta = SkillService::parse_skill_metadata_static(&dest_file).ok();
            (
                meta.as_ref()
                    .and_then(|m| m.name.clone())
                    .unwrap_or_else(|| subagent.name.clone()),
                meta.and_then(|m| m.description),
            )
        };

        let doc_path = subagent
            .readme_url
            .as_deref()
            .and_then(SkillService::extract_doc_path_from_url)
            .unwrap_or_else(|| remote_path.trim_start_matches('/').to_string());
        let readme_url = SkillService::build_skill_doc_url(owner, name, &used_branch, &doc_path);

        let updated_metadata = InstalledSubagent {
            id: subagent.id.clone(),
            name: new_name,
            description: new_description,
            directory: subagent.directory.clone(),
            repo_owner: subagent.repo_owner.clone(),
            repo_name: subagent.repo_name.clone(),
            repo_branch: Some(used_branch),
            readme_url,
            apps: subagent.apps.clone(),
            installed_at: subagent.installed_at,
            content_hash: new_hash,
            updated_at: chrono::Utc::now().timestamp(),
            target: target.clone(),
        };

        let updated_subagent = Self::persist_subagent_update_or_restore(
            db,
            &subagent,
            &updated_metadata,
            backup_path.as_ref(),
            &dest_file,
        )?;

        let mut sync_failures: Vec<AgentType> = Vec::new();
        for app in updated_subagent.apps.enabled_apps() {
            if let Err(e) =
                Self::sync_to_app_dir_for_target(db, target, &updated_subagent.directory, &app)
            {
                log::warn!("同步更新后的 subagent 到 {} 失败: {e}", app.as_str());
                sync_failures.push(app);
            }
        }

        if !sync_failures.is_empty() {
            Self::restore_ssot_from_backup(backup_path.as_ref(), &dest_file, &subagent.directory);
            let _ = db.save_subagent(&subagent);
            for app in subagent.apps.enabled_apps() {
                let _ = Self::sync_to_app_dir_for_target(db, target, &subagent.directory, &app);
            }

            return Err(AppError::Message(format_subagent_error(
                "UPDATE_SYNC_FAILED",
                &[(
                    "apps",
                    &sync_failures
                        .iter()
                        .map(|a| a.as_str())
                        .collect::<Vec<_>>()
                        .join(", "),
                )],
                Some("checkPermission"),
            )));
        }

        log::info!("Subagent {} 更新成功", updated_subagent.name);
        Ok(updated_subagent)
    }

    // ========== Storage migration ==========

    pub(crate) fn rollback_subagent_moves(old_dir: &Path, new_dir: &Path, moved: &[String]) {
        for directory in moved {
            let dst = Self::ssot_file_path(new_dir, directory);
            let src = Self::ssot_file_path(old_dir, directory);
            if !dst.exists() {
                continue;
            }
            if src.exists() {
                log::warn!("无法将 {directory} 回滚：源文件和目标文件均已存在");
                continue;
            }
            if fs::rename(&dst, &src).is_err() {
                // 跨文件系统回退为复制：只有复制完整成功才删除 dst；
                // 复制失败（或只拷出部分内容，如旧盘满）时保留 dst——
                // 它可能是该 subagent 唯一完整副本，并清理复制产生的残缺 src。
                match config::copy_file(&dst, &src) {
                    Ok(()) => {
                        let _ = fs::remove_file(&dst);
                    }
                    Err(e) => {
                        log::error!(
                            "回滚 Subagent {directory} 失败：复制回源目录出错，保留目标文件以免数据丢失: {e}"
                        );
                        let _ = fs::remove_file(&src);
                    }
                }
            }
        }
    }

    /// 执行实际的文件移动，不持久化设置、不刷新投影。
    ///
    /// `failures` 只携带稳定标识（目录名/阶段名），原始错误（可能含绝对路径）
    /// 只写日志，绝不进入跨 IPC 的结构化错误负载。
    pub(crate) fn migrate_storage_inner(
        db: &Arc<Database>,
        target: StorageLocation,
    ) -> Result<SubagentMigrationOutcome, SubagentMigrationFailure> {
        // 任何 project sibling 文件移动之前，先确认所有已登记项目仍可解析。
        // 失败时不创建目标 SSOT、不变更设置、也不移动 global 文件。
        let projects = match ProjectService::list_projects(db) {
            Ok(projects) => projects,
            Err(error) => {
                log::warn!("读取项目 registry 失败: {error}");
                return Err(SubagentMigrationFailure {
                    moved: vec![],
                    project_moved: vec![],
                    failures: vec!["readProjects".to_string()],
                });
            }
        };
        for project in &projects {
            let project_target = ScopeTarget::Project {
                project_id: project.project_id.clone(),
            };
            if let Err(error) = ProjectService::resolve_scope_target(db, &project_target) {
                log::warn!(
                    "项目 {} 不可用于 Subagent 存储迁移: {error}",
                    project.project_id
                );
                return Err(SubagentMigrationFailure {
                    moved: vec![],
                    project_moved: vec![],
                    failures: vec!["resolveProject".to_string()],
                });
            }
        }

        let old_location = get_settings().storage_location;
        let old_dir = Self::get_ssot_dir().map_err(|e| {
            log::warn!("读取 Subagent SSOT 目录失败: {e}");
            SubagentMigrationFailure {
                moved: vec![],
                project_moved: vec![],
                failures: vec!["resolveSourceDir".to_string()],
            }
        })?;
        let new_dir = match target {
            StorageLocation::Hub => config::get_hub_subagents_dir(),
            StorageLocation::Unified => config::get_home_dir().join(".agents").join("subagents"),
        };
        if let Err(e) = fs::create_dir_all(&new_dir) {
            log::warn!("创建 Subagent 迁移目标目录失败: {e}");
            return Err(SubagentMigrationFailure {
                moved: vec![],
                project_moved: vec![],
                failures: vec!["createTargetDir".to_string()],
            });
        }
        if let Err(e) = Self::validate_subagent_storage_destination(&new_dir) {
            log::warn!("Subagent 迁移目标校验失败: {e}");
            return Err(SubagentMigrationFailure {
                moved: vec![],
                project_moved: vec![],
                failures: vec!["validateDestination".to_string()],
            });
        }

        let subagents = match db.get_all_installed_subagents_for_target(&ScopeTarget::Global) {
            Ok(subagents) => subagents,
            Err(e) => {
                log::warn!("读取已安装 Subagent 列表失败: {e}");
                return Err(SubagentMigrationFailure {
                    moved: vec![],
                    project_moved: vec![],
                    failures: vec!["readInstalled".to_string()],
                });
            }
        };

        let mut result = MigrationResult {
            migrated_count: 0,
            skipped_count: 0,
            errors: vec![],
        };
        let mut moved = Vec::new();
        let mut project_moved = Vec::new();
        let mut failures = Vec::new();

        for subagent in subagents.values() {
            let directory = match SkillService::require_valid_directory(&subagent.directory) {
                Ok(directory) => directory,
                Err(err) => {
                    log::warn!("跳过非法 directory 的迁移: {err}");
                    failures.push(subagent.directory.escape_debug().to_string());
                    continue;
                }
            };
            let src = Self::ssot_file_path(&old_dir, &directory);
            let dst = Self::ssot_file_path(&new_dir, &directory);

            if !src.exists() {
                result.skipped_count += 1;
                continue;
            }
            if dst.exists() {
                failures.push(directory);
                continue;
            }

            match fs::rename(&src, &dst) {
                Ok(()) => {
                    result.migrated_count += 1;
                    moved.push(directory);
                }
                Err(_) => match config::copy_file(&src, &dst) {
                    Ok(()) => {
                        // 源删除失败视为迁移失败：目标副本已验证完整可删，回滚之。
                        // 若残留旧副本仍计成功，之后迁回会因目标已存在而中止
                        if let Err(e) = fs::remove_file(&src) {
                            log::warn!("迁移 Subagent {directory} 失败：源文件删除失败: {e}");
                            if let Err(rollback_error) = fs::remove_file(&dst) {
                                log::error!(
                                    "回滚 Subagent 迁移目标副本失败 {}: {rollback_error}",
                                    dst.display()
                                );
                            }
                            failures.push(directory);
                            continue;
                        }
                        result.migrated_count += 1;
                        moved.push(directory);
                    }
                    Err(e) => {
                        log::warn!("迁移 Subagent {directory} 失败: {e}");
                        failures.push(directory);
                    }
                },
            }
        }

        // 项目 SSOT 以 sibling 整体迁移，保留受管记录之外仍位于该 target 的文件。
        // 固定 backup root 不参与存储位置迁移。
        for project in &projects {
            let src = Self::project_ssot_dir_for_location(old_location, &project.project_id);
            let dst = Self::project_ssot_dir_for_location(target, &project.project_id);
            if !src.exists() {
                continue;
            }
            if dst.exists() {
                failures.push(format!("project:{}", project.project_id));
                continue;
            }
            let Some(parent) = dst.parent() else {
                failures.push(format!("project:{}", project.project_id));
                continue;
            };
            if let Err(error) = fs::create_dir_all(parent) {
                log::warn!("创建项目 Subagent 迁移目标目录失败: {error}");
                failures.push(format!("project:{}", project.project_id));
                continue;
            }

            match fs::rename(&src, &dst) {
                Ok(()) => {
                    result.migrated_count += 1;
                    project_moved.push(project.project_id.clone());
                }
                Err(_) => match SkillService::copy_dir_recursive(&src, &dst) {
                    Ok(()) => {
                        if let Err(error) = fs::remove_dir_all(&src) {
                            log::warn!("迁移项目 Subagent sibling 后删除源目录失败: {error}");
                            // 尝试用完整目标副本重建源；重建失败时保留目标副本，避免
                            // 仅剩残缺源目录。
                            let restored = if fs::remove_dir_all(&src).is_ok() {
                                SkillService::copy_dir_recursive(&dst, &src).is_ok()
                            } else {
                                false
                            };
                            if restored {
                                if let Err(cleanup_error) = fs::remove_dir_all(&dst) {
                                    log::error!(
                                        "回滚项目 Subagent sibling 后清理目标失败 {}: {cleanup_error}",
                                        dst.display()
                                    );
                                }
                            }
                            failures.push(format!("project:{}", project.project_id));
                            continue;
                        }
                        result.migrated_count += 1;
                        project_moved.push(project.project_id.clone());
                    }
                    Err(error) => {
                        log::warn!("迁移项目 Subagent sibling 失败: {error}");
                        failures.push(format!("project:{}", project.project_id));
                    }
                },
            }
        }

        if failures.is_empty() {
            Ok(SubagentMigrationOutcome {
                result,
                moved,
                project_moved,
            })
        } else {
            Err(SubagentMigrationFailure {
                moved,
                project_moved,
                failures,
            })
        }
    }

    // ========== Backups ==========

    pub fn list_backups() -> Result<Vec<SubagentBackupEntry>, AppError> {
        Self::list_backups_for_target(&ScopeTarget::Global)
    }

    /// 只读取固定 backup root 中属于明确 target 的 metadata；此操作不解析项目 root，
    /// 以便根不可用时仍能清理项目备份并解除项目登记。
    pub fn list_backups_for_target(
        target: &ScopeTarget,
    ) -> Result<Vec<SubagentBackupEntry>, AppError> {
        target.validate()?;
        let _state_guard = subagent_state_read_guard();
        let backup_dir = Self::get_backup_dir()?;
        let mut entries = Vec::new();

        for entry in fs::read_dir(&backup_dir).map_err(|e| AppError::io(&backup_dir, e))? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    log::warn!("读取 Subagent 备份目录项失败: {err}");
                    continue;
                }
            };
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            match Self::read_backup_metadata(&path) {
                Ok(metadata) if metadata.subagent.target == *target => {
                    entries.push(SubagentBackupEntry {
                        backup_id: entry.file_name().to_string_lossy().to_string(),
                        backup_path: path.to_string_lossy().to_string(),
                        created_at: metadata.backup_created_at,
                        subagent: metadata.subagent,
                    })
                }
                Ok(_) => {}
                Err(err) => {
                    log::warn!("解析 Subagent 备份失败 {}: {err:#}", path.display());
                }
            }
        }

        entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_at));
        Ok(entries)
    }

    pub fn delete_backup(backup_id: &str) -> Result<(), AppError> {
        Self::delete_backup_for_target(backup_id, &ScopeTarget::Global)
    }

    /// 删除归属于明确 target 的备份，不访问项目 root。
    pub fn delete_backup_for_target(backup_id: &str, target: &ScopeTarget) -> Result<(), AppError> {
        target.validate()?;
        let _state_guard = subagent_state_write_guard();
        let backup_path = Self::backup_path_for_id(backup_id)?;
        let metadata =
            fs::symlink_metadata(&backup_path).map_err(|e| AppError::io(&backup_path, e))?;

        if !metadata.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "Subagent backup is not a directory: {}",
                backup_path.display()
            )));
        }

        let backup = Self::read_backup_metadata(&backup_path)?;
        if backup.subagent.target != *target {
            return Err(AppError::Message(format_subagent_error(
                "BACKUP_TARGET_MISMATCH",
                &[],
                Some("selectOriginalTarget"),
            )));
        }

        fs::remove_dir_all(&backup_path).map_err(|e| AppError::io(&backup_path, e))?;

        log::info!("Subagent 备份已删除: {}", backup_path.display());
        Ok(())
    }

    /// 项目移除前使用的窄查询：只检查固定 Subagent backup root，不扫描项目 root。
    /// 调用者负责持有 Subagent state read lock，保持与卸载一致的锁顺序。
    pub(crate) fn has_backup_for_target(project_id: &str) -> Result<bool, AppError> {
        let target = ScopeTarget::Project {
            project_id: project_id.to_string(),
        };
        target.validate()?;
        let backup_dir = Self::get_backup_dir()?;
        for entry in fs::read_dir(&backup_dir).map_err(|e| AppError::io(&backup_dir, e))? {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Ok(metadata) = Self::read_backup_metadata(&path) {
                if metadata.subagent.target == target {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    pub fn restore_from_backup(
        db: &Arc<Database>,
        backup_id: &str,
        // 恢复以备份中记录的启用状态为准；current_app 仅保留以维持命令层签名
        _current_app: &AgentType,
    ) -> Result<InstalledSubagent, AppError> {
        Self::restore_from_backup_for_target(db, backup_id, &ScopeTarget::Global)
    }

    /// 恢复只接受 metadata 记录的原 target；调用方 target 仅用于确认，不得 retarget。
    pub fn restore_from_backup_for_target(
        db: &Arc<Database>,
        backup_id: &str,
        target: &ScopeTarget,
    ) -> Result<InstalledSubagent, AppError> {
        target.validate()?;
        let _state_guard = subagent_state_write_guard();
        let backup_path = Self::backup_path_for_id(backup_id)?;
        let metadata = Self::read_backup_metadata(&backup_path)?;
        if metadata.subagent.target != *target {
            return Err(AppError::Message(format_subagent_error(
                "BACKUP_TARGET_MISMATCH",
                &[],
                Some("selectOriginalTarget"),
            )));
        }
        // 项目 root 不可用必须在 DB/SSOT/投影写入前失败，且保留 backup。
        ProjectService::resolve_scope_target(db, target)?;
        Self::ensure_enabled_apps_supported_for_target(target, &metadata.subagent.apps)?;
        let backup_subagent_file = backup_path.join(format!("{}.md", metadata.subagent.directory));
        if !backup_subagent_file.exists() {
            return Err(AppError::InvalidInput(format!(
                "Subagent backup is invalid or missing file: {}",
                backup_path.display()
            )));
        }
        for app in metadata.subagent.apps.enabled_apps() {
            Self::validate_project_subagent_file_for_app(target, &backup_subagent_file, &app)?;
        }

        let existing_subagents = db.get_all_installed_subagents_for_target(target)?;
        if existing_subagents.contains_key(&metadata.subagent.id)
            || existing_subagents.values().any(|subagent| {
                subagent
                    .directory
                    .eq_ignore_ascii_case(&metadata.subagent.directory)
            })
        {
            return Err(AppError::InvalidInput(format!(
                "Subagent already exists, please uninstall the current one first: {}",
                metadata.subagent.directory
            )));
        }

        let directory = SkillService::require_valid_directory(&metadata.subagent.directory)?;

        let ssot_dir = Self::get_ssot_dir_for_target(db, target)?;
        let restore_path = Self::ssot_file_path(&ssot_dir, &directory);
        if restore_path.exists() || SkillService::is_symlink(&restore_path) {
            return Err(AppError::InvalidInput(format!(
                "Restore target already exists: {}",
                restore_path.display()
            )));
        }

        config::copy_file(&backup_subagent_file, &restore_path)?;

        let mut restored_subagent = metadata.subagent;
        restored_subagent.directory = directory;
        restored_subagent.target = target.clone();
        restored_subagent.installed_at = chrono::Utc::now().timestamp();
        // 保留备份中记录的 apps 启用标志：恢复多 Agent 启用状态，而非仅 UI 当前 Agent
        restored_subagent.updated_at = 0;
        restored_subagent.content_hash = SkillService::compute_file_hash(&restore_path).ok();

        if let Err(err) = db.save_subagent(&restored_subagent) {
            let _ = fs::remove_file(&restore_path);
            return Err(err);
        }

        // 为所有启用的 Agent 重建投影；任一失败时连同本次已创建的前序投影一并清理
        let mut synced_apps: Vec<AgentType> = Vec::new();
        for app in restored_subagent.apps.enabled_apps() {
            if let Err(err) =
                Self::sync_to_app_dir_for_target(db, target, &restored_subagent.directory, &app)
            {
                for synced_app in &synced_apps {
                    if let Err(rollback_error) = Self::remove_from_app_for_target(
                        db,
                        target,
                        &restored_subagent.directory,
                        synced_app,
                    ) {
                        log::error!(
                            "恢复 Subagent {} 失败后移除 {} 投影也失败: {rollback_error}",
                            restored_subagent.name,
                            synced_app.as_str()
                        );
                    }
                }
                let _ = db.delete_subagent_for_target(&restored_subagent.id, target);
                let _ = fs::remove_file(&restore_path);
                return Err(err);
            }
            synced_apps.push(app);
        }

        log::info!(
            "Subagent {} 已从备份恢复到 {}",
            restored_subagent.name,
            restore_path.display()
        );

        Ok(restored_subagent)
    }

    fn backup_path_for_id(backup_id: &str) -> Result<PathBuf, AppError> {
        if backup_id.contains("..")
            || backup_id.contains('/')
            || backup_id.contains('\\')
            || backup_id.trim().is_empty()
        {
            return Err(AppError::InvalidInput(format!(
                "Invalid backup id: {backup_id}"
            )));
        }

        Ok(Self::get_backup_dir()?.join(backup_id))
    }

    fn read_backup_metadata(backup_path: &Path) -> Result<SubagentBackupMetadata, AppError> {
        let metadata_path = backup_path.join("meta.json");
        let content =
            fs::read_to_string(&metadata_path).map_err(|e| AppError::io(&metadata_path, e))?;
        serde_json::from_str(&content).map_err(|e| AppError::json(&metadata_path, e))
    }

    fn create_uninstall_backup_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        subagent: &InstalledSubagent,
    ) -> Result<Option<PathBuf>, AppError> {
        if subagent.target != *target {
            return Err(AppError::Message(format_subagent_error(
                "BACKUP_TARGET_MISMATCH",
                &[],
                Some("selectOriginalTarget"),
            )));
        }
        let directory = match SkillService::require_valid_directory(&subagent.directory) {
            Ok(d) => d,
            Err(err) => {
                log::warn!(
                    "Subagent {} directory 非法，跳过备份: {err}",
                    subagent.directory
                );
                return Ok(None);
            }
        };

        let ssot_dir = Self::get_ssot_dir_for_target(db, target)?;
        let source_file = Self::ssot_file_path(&ssot_dir, &directory);
        if !source_file.exists() {
            log::warn!(
                "Subagent {} 卸载前未找到可备份的文件，将跳过备份",
                subagent.directory
            );
            return Ok(None);
        }

        let backup_root = Self::get_backup_dir()?;
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let slug = SkillService::sanitize_backup_segment(&subagent.directory);
        let mut backup_path = backup_root.join(format!("{timestamp}_{slug}"));
        let mut counter = 1;
        while backup_path.exists() {
            backup_path = backup_root.join(format!("{timestamp}_{slug}_{counter}"));
            counter += 1;
        }

        let write_backup = || -> Result<(), AppError> {
            fs::create_dir_all(&backup_path).map_err(|e| AppError::io(&backup_path, e))?;
            let backup_file = backup_path.join(format!("{directory}.md"));
            config::copy_file(&source_file, &backup_file)?;

            let metadata = SubagentBackupMetadata {
                subagent: subagent.clone(),
                backup_created_at: chrono::Utc::now().timestamp(),
                source_path: source_file.to_string_lossy().to_string(),
            };
            let metadata_path = backup_path.join("meta.json");
            let metadata_json = serde_json::to_string_pretty(&metadata)
                .map_err(|e| AppError::JsonSerialize { source: e })?;
            fs::write(&metadata_path, metadata_json)
                .map_err(|e| AppError::io(&metadata_path, e))?;
            Ok(())
        };

        if let Err(err) = write_backup() {
            let _ = fs::remove_dir_all(&backup_path);
            return Err(err);
        }

        if let Err(err) = Self::cleanup_old_subagent_backups(&backup_root) {
            log::warn!("清理旧 Subagent 备份失败: {err:#}");
        }

        log::info!(
            "Subagent {} 已在卸载前备份到 {}",
            subagent.name,
            backup_path.display()
        );

        Ok(Some(backup_path))
    }

    fn cleanup_old_subagent_backups(dir: &Path) -> Result<(), AppError> {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .map_err(|e| AppError::io(dir, e))?
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                if !metadata.is_dir() {
                    return None;
                }
                Some((entry.path(), metadata.modified().ok()))
            })
            .collect();

        if entries.len() <= SUBAGENT_BACKUP_RETAIN_COUNT {
            return Ok(());
        }

        entries.sort_by_key(|(_, modified)| *modified);
        let remove_count = entries.len().saturating_sub(SUBAGENT_BACKUP_RETAIN_COUNT);

        for (path, _) in entries.into_iter().take(remove_count) {
            fs::remove_dir_all(&path).map_err(|e| AppError::io(&path, e))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::tempdir;

    struct TestHomeGuard;

    impl TestHomeGuard {
        fn set(path: &Path) -> Self {
            std::env::set_var(config::ACM_HOME_ENV, path.as_os_str());
            crate::settings::reset_settings_store_for_test();
            TestHomeGuard
        }
    }

    impl Drop for TestHomeGuard {
        fn drop(&mut self) {
            std::env::remove_var(config::ACM_HOME_ENV);
        }
    }

    fn write_subagent(dir: &Path, file_name: &str, name: &str) -> PathBuf {
        fs::create_dir_all(dir).expect("create subagent dir");
        let path = dir.join(file_name);
        fs::write(
            &path,
            format!("---\nname: {name}\ndescription: Test subagent\n---\n"),
        )
        .expect("write subagent md");
        path
    }

    fn installed_subagent(id: &str, directory: &str) -> InstalledSubagent {
        InstalledSubagent {
            id: id.to_string(),
            name: directory.to_string(),
            description: None,
            directory: directory.to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::default(),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        }
    }

    fn discoverable(key: &str, directory: &str, path: &str) -> DiscoverableSubagent {
        DiscoverableSubagent {
            key: key.to_string(),
            name: directory.to_string(),
            description: String::new(),
            directory: directory.to_string(),
            path: path.to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
            installed: false,
        }
    }

    #[test]
    fn remote_match_uses_full_source_path_not_stem() {
        // 同一仓库存在 a/reviewer.md 与 b/reviewer.md：stem 相同，身份不同
        let remote = vec![
            discoverable("owner/repo:a/reviewer.md", "reviewer", "a/reviewer.md"),
            discoverable("owner/repo:b/reviewer.md", "reviewer", "b/reviewer.md"),
        ];

        let installed = installed_subagent("owner/repo:b/reviewer.md", "reviewer");
        let matched = SubagentService::remote_match_for_installed(&remote, &installed)
            .expect("must match by full path");
        assert_eq!(matched.path, "b/reviewer.md");

        let installed = installed_subagent("owner/repo:a/reviewer.md", "reviewer");
        let matched = SubagentService::remote_match_for_installed(&remote, &installed)
            .expect("must match by full path");
        assert_eq!(matched.path, "a/reviewer.md");

        // 完整身份在远程不存在时不得回退到 stem 匹配（避免更新错文件）
        let installed = installed_subagent("owner/repo:c/reviewer.md", "reviewer");
        assert!(SubagentService::remote_match_for_installed(&remote, &installed).is_none());
    }

    #[test]
    #[serial]
    fn migration_aborted_payload_hides_raw_paths() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        // 故障注入：统一目录目标已存在且是普通文件，create_dir_all 的原始错误含绝对路径
        let target = config::get_home_dir().join(".agents").join("subagents");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "not a directory").unwrap();

        let db = Arc::new(Database::memory().unwrap());
        let failure = match SubagentService::migrate_storage_inner(&db, StorageLocation::Unified) {
            Err(failure) => failure,
            Ok(_) => panic!("unwritable destination must abort"),
        };
        let payload = failure.into_error().to_string();

        assert!(payload.contains("MIGRATION_ABORTED"));
        assert!(payload.contains("createTargetDir"));
        assert!(
            !payload.contains(tmp.path().to_string_lossy().as_ref()),
            "payload must not leak absolute paths: {payload}"
        );
    }

    #[test]
    #[serial]
    fn install_repo_subagent_rejects_unmanaged_on_disk_destination() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        // 未托管的同名文件（数据库无记录）
        let dest = write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "review.md",
            "Unmanaged",
        );

        let err = SubagentService::ensure_no_unmanaged_destination(&dest, "review")
            .expect_err("unmanaged on-disk destination must conflict");
        let payload = err.to_string();
        assert!(payload.contains("SUBAGENT_DIRECTORY_CONFLICT"));
        assert!(payload.contains("unmanaged"));
        assert!(payload.contains("importFirst"));

        assert!(dest.exists(), "unmanaged file must stay untouched");
    }

    #[test]
    #[serial]
    fn persist_subagent_update_or_restore_reverts_ssot_and_db_on_persist_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        let previous = installed_subagent("owner/repo:upd.md", "upd");
        db.save_subagent(&previous).unwrap();

        // 旧 SSOT 文件与更新前备份
        let dest = write_subagent(&SubagentService::get_ssot_dir().unwrap(), "upd.md", "Old");
        let backup = tmp.path().join("backup");
        write_subagent(&backup, "upd.md", "Old");

        // 模拟 SSOT 替换已成功：dest 现在是新版本
        fs::write(&dest, "---\nname: New\ndescription: new\n---\n").unwrap();

        // 故障注入：DB 只读，元数据持久化必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        let updated_metadata = InstalledSubagent {
            name: "New".to_string(),
            content_hash: Some("newhash".to_string()),
            ..previous.clone()
        };
        let result = SubagentService::persist_subagent_update_or_restore(
            &db,
            &previous,
            &updated_metadata,
            Some(&backup),
            &dest,
        );
        assert!(result.is_err(), "persist failure must propagate");

        // SSOT 从备份恢复为旧版本
        assert!(
            fs::read_to_string(&dest).unwrap().contains("name: Old"),
            "SSOT must be restored from backup"
        );
        // DB 保留旧记录（无部分写入的新元数据）
        let stored = db.get_installed_subagent(&previous.id).unwrap().unwrap();
        assert_eq!(stored.name, "upd");
        assert_eq!(stored.content_hash, None);
    }

    #[test]
    #[serial]
    fn sync_to_app_unlocked_aggregates_per_subagent_failures() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // DB 记录为 claude 启用，但 SSOT 文件不存在 → 该项同步必然失败
        let mut ghost = installed_subagent("owner/repo:ghost.md", "ghost");
        ghost.apps = SubagentApps::only(&AgentType::ClaudeCode);
        db.save_subagent(&ghost).unwrap();

        let err = SubagentService::sync_to_app_unlocked(&db, &AgentType::ClaudeCode)
            .expect_err("per-subagent failures must surface instead of being swallowed");
        let payload = err.to_string();
        assert!(payload.contains("PROJECTION_SYNC_FAILED"));
        assert!(payload.contains("ghost"));
    }

    #[test]
    fn subagent_state_lock_allows_snapshots_but_excludes_writers() {
        let first_reader = subagent_state_read_guard();
        let second_reader = subagent_state_read_guard();
        assert!(
            subagent_state_lock().try_write().is_err(),
            "a Subagent mutation must wait for every snapshot reader"
        );

        drop(second_reader);
        drop(first_reader);
        assert!(subagent_state_lock().try_write().is_ok());
    }

    #[test]
    #[serial]
    fn project_target_uses_hub_sibling_and_supported_agent_projections() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let db = Arc::new(Database::memory().expect("memory db"));
        let project = ProjectService::add_project(&db, &project_root, Some("Workspace".into()))
            .expect("register project");
        let target = ScopeTarget::Project {
            project_id: project.project_id.clone(),
        };
        let canonical_project_root = PathBuf::from(&project.root_path);

        assert_eq!(
            SubagentService::get_ssot_dir_for_target(&db, &target).expect("project ssot"),
            config::get_hub_dir()
                .join("projects")
                .join(&project.project_id)
                .join("subagents")
        );

        for (app, expected) in [
            (
                AgentType::ClaudeCode,
                canonical_project_root.join(".claude").join("agents"),
            ),
            (
                AgentType::GeminiCli,
                canonical_project_root.join(".gemini").join("agents"),
            ),
            (
                AgentType::OpenCode,
                canonical_project_root.join(".opencode").join("agents"),
            ),
        ] {
            assert_eq!(
                SubagentService::get_app_subagents_dir_for_target(&db, &target, &app)
                    .expect("project projection"),
                expected,
                "{} projection must be project-local",
                app.as_str()
            );
        }

        let error =
            SubagentService::get_app_subagents_dir_for_target(&db, &target, &AgentType::Codex)
                .expect_err("Codex project Subagent must remain unsupported");
        assert!(error.to_string().contains("SUBAGENT_UNSUPPORTED"));
    }

    #[test]
    #[serial]
    fn project_toggle_and_uninstall_do_not_touch_global_subagent_with_same_id() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let db = Arc::new(Database::memory().expect("memory db"));
        let project = ProjectService::add_project(&db, &project_root, None).expect("project");
        let project_target = ScopeTarget::Project {
            project_id: project.project_id,
        };

        let global = installed_subagent("owner/repo:shared", "shared");
        write_subagent(
            &SubagentService::get_ssot_dir().expect("global ssot"),
            "shared.md",
            "Global",
        );
        db.save_subagent(&global).expect("save global");

        let mut project_subagent = installed_subagent("owner/repo:shared", "shared");
        project_subagent.target = project_target.clone();
        write_subagent(
            &SubagentService::get_ssot_dir_for_target(&db, &project_target).expect("project ssot"),
            "shared.md",
            "Project",
        );
        db.save_subagent(&project_subagent).expect("save project");

        let unsupported = SubagentService::toggle_app_for_target(
            &db,
            &project_target,
            &project_subagent.id,
            &AgentType::Codex,
            true,
        )
        .expect_err("Codex project Subagent must be closed unsupported");
        assert!(unsupported.to_string().contains("SUBAGENT_UNSUPPORTED"));
        assert!(
            !db.get_installed_subagent_for_target(&project_subagent.id, &project_target)
                .expect("project query")
                .expect("project subagent")
                .apps
                .codex,
            "unsupported toggle must not change the project record"
        );
        assert!(
            !config::get_codex_agents_dir().join("shared.md").exists(),
            "unsupported project toggle must not create a global projection"
        );

        SubagentService::toggle_app_for_target(
            &db,
            &project_target,
            &project_subagent.id,
            &AgentType::ClaudeCode,
            true,
        )
        .expect("toggle project subagent");
        assert!(project_root
            .join(".claude")
            .join("agents")
            .join("shared.md")
            .exists());
        assert!(
            !config::get_claude_agents_dir().join("shared.md").exists(),
            "project toggle must not create a global projection"
        );

        SubagentService::uninstall_for_target(&db, &project_target, &project_subagent.id)
            .expect("uninstall project subagent");
        assert!(db
            .get_installed_subagent_for_target(&project_subagent.id, &project_target)
            .expect("project query")
            .is_none());
        assert!(db
            .get_installed_subagent_for_target(&global.id, &ScopeTarget::Global)
            .expect("global query")
            .is_some());
        assert!(SubagentService::get_ssot_dir()
            .expect("global ssot")
            .join("shared.md")
            .exists());
    }

    #[test]
    #[serial]
    fn project_opencode_subagent_requires_native_mode_before_projection() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let db = Arc::new(Database::memory().expect("memory db"));
        let project = ProjectService::add_project(&db, &project_root, None).expect("project");
        let target = ScopeTarget::Project {
            project_id: project.project_id,
        };
        let ssot = SubagentService::get_ssot_dir_for_target(&db, &target).expect("project ssot");
        let source = write_subagent(&ssot, "open.md", "Open");
        let mut subagent = installed_subagent("owner/repo:open", "open");
        subagent.target = target.clone();
        db.save_subagent(&subagent).expect("save project subagent");

        let error = SubagentService::toggle_app_for_target(
            &db,
            &target,
            &subagent.id,
            &AgentType::OpenCode,
            true,
        )
        .expect_err("OpenCode project Subagent requires mode frontmatter");
        assert!(error.to_string().contains("SUBAGENT_INCOMPATIBLE"));
        assert!(
            !project_root
                .join(".opencode")
                .join("agents")
                .join("open.md")
                .exists(),
            "incompatible file must not be projected"
        );
        assert!(
            !db.get_installed_subagent_for_target(&subagent.id, &target)
                .expect("project query")
                .expect("project subagent")
                .apps
                .opencode,
            "incompatible toggle must not change the project record"
        );

        fs::write(&source, "---\nname: Open\nmode: subagent\n---\n").expect("valid mode");
        SubagentService::toggle_app_for_target(
            &db,
            &target,
            &subagent.id,
            &AgentType::OpenCode,
            true,
        )
        .expect("compatible OpenCode subagent projects");
        assert!(project_root
            .join(".opencode")
            .join("agents")
            .join("open.md")
            .is_file());
    }

    #[test]
    #[serial]
    fn unavailable_project_target_does_not_toggle_same_id_global_subagent() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let db = Arc::new(Database::memory().expect("memory db"));
        let project = ProjectService::add_project(&db, &project_root, None).expect("project");
        let project_target = ScopeTarget::Project {
            project_id: project.project_id,
        };

        let mut global = installed_subagent("owner/repo:shared", "shared");
        global.apps = SubagentApps::only(&AgentType::ClaudeCode);
        db.save_subagent(&global).expect("save global subagent");
        let mut project_subagent = installed_subagent("owner/repo:shared", "shared");
        project_subagent.target = project_target.clone();
        db.save_subagent(&project_subagent)
            .expect("save project subagent");
        fs::remove_dir_all(&project_root).expect("project root unavailable");

        let error = SubagentService::toggle_app_for_target(
            &db,
            &project_target,
            &project_subagent.id,
            &AgentType::ClaudeCode,
            true,
        )
        .expect_err("unavailable project target must fail before any global work");
        assert!(error.to_string().contains("PROJECT_ROOT_UNAVAILABLE"));
        let stored_global = db
            .get_installed_subagent_for_target(&global.id, &ScopeTarget::Global)
            .expect("global query")
            .expect("global subagent remains");
        assert!(stored_global.apps.is_enabled_for(&AgentType::ClaudeCode));
        assert!(!config::get_claude_agents_dir().join("shared.md").exists());
    }

    #[test]
    #[serial]
    fn project_backup_blocks_removal_but_lists_and_deletes_without_project_root() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let db = Arc::new(Database::memory().expect("memory db"));
        let project = ProjectService::add_project(&db, &project_root, None).expect("project");
        let target = ScopeTarget::Project {
            project_id: project.project_id.clone(),
        };
        let mut subagent = installed_subagent("owner/repo:backup", "backup");
        subagent.target = target.clone();
        write_subagent(
            &SubagentService::get_ssot_dir_for_target(&db, &target).expect("project ssot"),
            "backup.md",
            "Project backup",
        );
        db.save_subagent(&subagent).expect("save project subagent");

        let uninstall = SubagentService::uninstall_for_target(&db, &target, &subagent.id)
            .expect("uninstall and backup");
        let backup_id = Path::new(uninstall.backup_path.as_deref().expect("backup path"))
            .file_name()
            .expect("backup id")
            .to_string_lossy()
            .to_string();
        let mismatch =
            SubagentService::restore_from_backup_for_target(&db, &backup_id, &ScopeTarget::Global)
                .expect_err("backup must not be retargeted to global");
        assert!(mismatch.to_string().contains("BACKUP_TARGET_MISMATCH"));
        fs::remove_dir_all(&project_root).expect("project root becomes unavailable");

        let backups = SubagentService::list_backups_for_target(&target).expect("list without root");
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].subagent.target, target);
        assert!(ProjectService::remove_project(&db, &project.project_id)
            .expect_err("backup must block remove")
            .to_string()
            .contains("PROJECT_HAS_MANAGED_ASSETS"));

        SubagentService::delete_backup_for_target(&backup_id, &target)
            .expect("delete backup without root");
        ProjectService::remove_project(&db, &project.project_id)
            .expect("empty unavailable project is removable after backup deletion");
    }

    #[test]
    #[serial]
    fn project_backup_restore_rejects_unavailable_root_and_keeps_backup() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let db = Arc::new(Database::memory().expect("memory db"));
        let project = ProjectService::add_project(&db, &project_root, None).expect("project");
        let target = ScopeTarget::Project {
            project_id: project.project_id,
        };
        let mut subagent = installed_subagent("owner/repo:restore", "restore");
        subagent.target = target.clone();
        write_subagent(
            &SubagentService::get_ssot_dir_for_target(&db, &target).expect("project ssot"),
            "restore.md",
            "Project restore",
        );
        db.save_subagent(&subagent).expect("save project subagent");
        let uninstall =
            SubagentService::uninstall_for_target(&db, &target, &subagent.id).expect("backup");
        let backup_id = Path::new(uninstall.backup_path.as_deref().expect("backup path"))
            .file_name()
            .expect("backup id")
            .to_string_lossy()
            .to_string();
        fs::remove_dir_all(&project_root).expect("project root unavailable");

        let error = SubagentService::restore_from_backup_for_target(&db, &backup_id, &target)
            .expect_err("unavailable project root must reject restore");
        assert!(error.to_string().contains("PROJECT_ROOT_UNAVAILABLE"));
        assert_eq!(
            SubagentService::list_backups_for_target(&target)
                .expect("retained backup")
                .len(),
            1
        );
        assert!(db
            .get_installed_subagent_for_target(&subagent.id, &ScopeTarget::Global)
            .expect("global query")
            .is_none());
    }

    #[test]
    #[serial]
    fn installed_list_respects_context_order_project_applicability_and_unavailable_roots() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let root_b = home.path().join("b-root");
        let root_a = home.path().join("a-root");
        let root_missing = home.path().join("missing-root");
        fs::create_dir(&root_b).expect("b root");
        fs::create_dir(&root_a).expect("a root");
        fs::create_dir(&root_missing).expect("missing root");
        let db = Arc::new(Database::memory().expect("memory db"));
        let project_b =
            ProjectService::add_project(&db, &root_b, Some("Beta".into())).expect("project b");
        let project_a =
            ProjectService::add_project(&db, &root_a, Some("Alpha".into())).expect("project a");
        let missing = ProjectService::add_project(&db, &root_missing, Some("Gone".into()))
            .expect("missing project");

        for directory in ["global-z", "global-a"] {
            let mut subagent = installed_subagent(&format!("owner/repo:{directory}"), directory);
            subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);
            db.save_subagent(&subagent).expect("save global");
        }
        let mut codex_only = installed_subagent("owner/repo:global-codex", "global-codex");
        codex_only.apps = SubagentApps::only(&AgentType::Codex);
        db.save_subagent(&codex_only)
            .expect("save unsupported global");
        for (directory, project_id) in [
            ("project-b", project_b.project_id.clone()),
            ("project-a", project_a.project_id.clone()),
            ("project-gone", missing.project_id.clone()),
        ] {
            let mut subagent = installed_subagent(&format!("owner/repo:{directory}"), directory);
            subagent.target = ScopeTarget::Project { project_id };
            db.save_subagent(&subagent).expect("save project subagent");
        }
        fs::remove_dir_all(&root_missing).expect("make project unavailable");

        let all = SubagentService::get_installed_for_context(&db, &ConfigContext::All)
            .expect("all context");
        assert_eq!(
            all.iter()
                .map(|subagent| subagent.directory.as_str())
                .collect::<Vec<_>>(),
            vec![
                "global-a",
                "global-codex",
                "global-z",
                "project-a",
                "project-b"
            ]
        );

        let project = SubagentService::get_installed_for_context(
            &db,
            &ConfigContext::Project {
                project_id: project_a.project_id,
            },
        )
        .expect("project context");
        assert_eq!(
            project
                .iter()
                .map(|subagent| subagent.directory.as_str())
                .collect::<Vec<_>>(),
            vec!["project-a", "global-a", "global-z"]
        );
    }

    #[test]
    #[serial]
    fn discovery_installed_state_is_scoped_to_the_requested_target() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let db = Arc::new(Database::memory().expect("memory db"));
        let project = ProjectService::add_project(&db, &project_root, None).expect("project");
        let project_target = ScopeTarget::Project {
            project_id: project.project_id,
        };
        let global = installed_subagent("owner/repo:shared", "shared");
        db.save_subagent(&global).expect("save global subagent");

        let mut candidates = vec![discoverable("owner/repo:shared", "shared", "shared.md")];
        SubagentService::set_discoverable_installed_state_for_target(
            &db,
            &project_target,
            &mut candidates,
        )
        .expect("project discovery status");
        assert!(
            !candidates[0].installed,
            "a global record must not mark the same project target as installed"
        );

        let mut project_subagent = global.clone();
        project_subagent.target = project_target.clone();
        db.save_subagent(&project_subagent)
            .expect("save project subagent");
        SubagentService::set_discoverable_installed_state_for_target(
            &db,
            &project_target,
            &mut candidates,
        )
        .expect("project discovery status");
        assert!(candidates[0].installed);
    }

    #[test]
    #[serial]
    fn migrate_storage_moves_project_subagent_sibling_and_rebuilds_projection() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let db = Arc::new(Database::memory().expect("memory db"));
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let project = ProjectService::add_project(&db, &project_root, None).expect("project");
        let target = ScopeTarget::Project {
            project_id: project.project_id.clone(),
        };

        let old_project_ssot =
            SubagentService::get_ssot_dir_for_target(&db, &target).expect("project ssot");
        write_subagent(&old_project_ssot, "project-agent.md", "Project agent");
        let mut subagent = installed_subagent("owner/repo:project-agent", "project-agent");
        subagent.target = target.clone();
        subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);
        db.save_subagent(&subagent).expect("save project subagent");

        SubagentService::sync_to_app_dir_for_target(
            &db,
            &target,
            "project-agent",
            &AgentType::ClaudeCode,
        )
        .expect("project projection");
        let project_projection = project_root
            .join(".claude")
            .join("agents")
            .join("project-agent.md");
        assert!(project_projection.is_file());
        let backup_marker = config::get_hub_subagent_backups_dir().join("fixed-marker");
        fs::create_dir_all(backup_marker.parent().expect("backup parent")).expect("backup root");
        fs::write(&backup_marker, "keep").expect("backup marker");

        crate::commands::migrate_storage_combined(&db, StorageLocation::Unified)
            .expect("project Subagent migration succeeds");

        let new_project_ssot = config::get_home_dir()
            .join(".agents")
            .join("projects")
            .join(&project.project_id)
            .join("subagents");
        assert!(new_project_ssot.join("project-agent.md").is_file());
        assert!(!old_project_ssot.exists());
        assert!(
            project_projection.is_file(),
            "project projection must be rebuilt against the moved sibling"
        );
        assert!(
            backup_marker.is_file(),
            "fixed backup root must not migrate"
        );
    }

    #[test]
    #[serial]
    fn migrate_storage_rolls_back_project_subagent_sibling_when_projection_rebuild_fails() {
        let home = tempdir().expect("home");
        let _home_guard = TestHomeGuard::set(home.path());
        let db = Arc::new(Database::memory().expect("memory db"));
        let project_root = home.path().join("workspace");
        fs::create_dir(&project_root).expect("project root");
        let project = ProjectService::add_project(&db, &project_root, None).expect("project");
        let target = ScopeTarget::Project {
            project_id: project.project_id.clone(),
        };

        let old_project_ssot =
            SubagentService::get_ssot_dir_for_target(&db, &target).expect("project ssot");
        write_subagent(&old_project_ssot, "project-agent.md", "Project agent");
        let mut subagent = installed_subagent("owner/repo:project-agent", "project-agent");
        subagent.target = target.clone();
        subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);
        db.save_subagent(&subagent).expect("save project subagent");

        let claude_dir = project_root.join(".claude");
        fs::create_dir_all(&claude_dir).expect("claude parent");
        fs::write(claude_dir.join("agents"), "not a directory").expect("block project projection");

        let error = crate::commands::migrate_storage_combined(&db, StorageLocation::Unified)
            .expect_err("project projection failure must roll back Subagent sibling");
        assert!(error.to_string().contains("MIGRATION_ABORTED"));
        assert!(old_project_ssot.join("project-agent.md").is_file());
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("projects")
            .join(&project.project_id)
            .join("subagents")
            .exists());
        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Hub
        );
    }

    #[test]
    fn build_subagent_from_file_requires_name_frontmatter() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("ok.md");
        fs::write(
            &md,
            "---\nname: My Agent\ndescription: Does things\n---\n# Body\n",
        )
        .unwrap();

        let subagent = SubagentService::build_subagent_from_file(
            &md,
            tmp.path(),
            &SubagentRepo {
                owner: "o".to_string(),
                name: "r".to_string(),
                branch: "main".to_string(),
                enabled: true,
            },
        )
        .unwrap();
        assert_eq!(subagent.name, "My Agent");
        assert_eq!(subagent.description, "Does things");
        assert_eq!(subagent.directory, "ok");
    }

    #[test]
    fn build_subagent_uses_file_stem_as_fallback_description() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("reviewer.md");
        fs::write(&md, "---\nname: Reviewer\n---\n").unwrap();

        let subagent = SubagentService::build_subagent_from_file(
            &md,
            tmp.path(),
            &SubagentRepo {
                owner: "o".to_string(),
                name: "r".to_string(),
                branch: "main".to_string(),
                enabled: true,
            },
        )
        .unwrap();
        assert_eq!(subagent.description, "reviewer");
    }

    #[test]
    fn build_subagent_skips_files_without_name() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("plain.md");
        fs::write(&md, "# Just body\n").unwrap();

        assert!(SubagentService::build_subagent_from_file(
            &md,
            tmp.path(),
            &SubagentRepo {
                owner: "o".to_string(),
                name: "r".to_string(),
                branch: "main".to_string(),
                enabled: true,
            },
        )
        .is_err());
    }

    #[test]
    #[serial]
    fn install_conflict_rejects_same_name_from_different_repo() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        let existing = InstalledSubagent {
            id: "owner1/repo1:review.md".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "review".to_string(),
            repo_owner: Some("owner1".to_string()),
            repo_name: Some("repo1".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&existing).unwrap();

        let discoverable = DiscoverableSubagent {
            key: "owner2/repo2:review.md".to_string(),
            name: "New".to_string(),
            description: "".to_string(),
            directory: "review".to_string(),
            path: "review.md".to_string(),
            readme_url: None,
            repo_owner: "owner2".to_string(),
            repo_name: "repo2".to_string(),
            repo_branch: "main".to_string(),
            installed: false,
        };

        let err = SubagentService::reuse_existing_install_for_target(
            &db,
            &ScopeTarget::Global,
            &discoverable,
            "review",
            &AgentType::Codex,
        )
        .expect_err("must conflict");
        assert!(err.to_string().contains("SUBAGENT_DIRECTORY_CONFLICT"));
    }

    #[test]
    #[serial]
    fn install_same_repo_reuses_and_enables_current_app() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "review.md",
            "Review",
        );

        let existing = InstalledSubagent {
            id: "owner/repo:review.md".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "review".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&existing).unwrap();

        let discoverable = DiscoverableSubagent {
            key: "owner/repo:review.md".to_string(),
            name: "Existing".to_string(),
            description: "".to_string(),
            directory: "review".to_string(),
            path: "review.md".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
            installed: false,
        };

        let updated = SubagentService::reuse_existing_install_for_target(
            &db,
            &ScopeTarget::Global,
            &discoverable,
            "review",
            &AgentType::Codex,
        )
        .expect("reuse")
        .expect("returns existing");
        assert!(updated.apps.claude_code);
        assert!(updated.apps.codex);
    }

    #[test]
    #[serial]
    fn reuse_existing_install_sync_failure_keeps_db_flags() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "review.md",
            "Review",
        );

        let existing = InstalledSubagent {
            id: "owner/repo:review.md".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "review".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&existing).unwrap();

        // 故障注入：codex 的 subagents 目录路径被普通文件占用，投影同步必然失败
        let codex_dir = config::get_codex_agents_dir();
        fs::create_dir_all(codex_dir.parent().unwrap()).unwrap();
        fs::write(&codex_dir, "blocked").unwrap();

        let discoverable = DiscoverableSubagent {
            key: "owner/repo:review.md".to_string(),
            name: "Existing".to_string(),
            description: "".to_string(),
            directory: "review".to_string(),
            path: "review.md".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
            installed: false,
        };

        SubagentService::reuse_existing_install_for_target(
            &db,
            &ScopeTarget::Global,
            &discoverable,
            "review",
            &AgentType::Codex,
        )
        .expect_err("sync failure must surface as an error");

        let stored = db.get_installed_subagent(&existing.id).unwrap().unwrap();
        assert!(stored.apps.claude_code);
        assert!(
            !stored.apps.codex,
            "同步失败时 codex 的启用标志不得提前落库"
        );
    }

    #[test]
    #[serial]
    fn reuse_existing_install_save_failure_removes_projection() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "review.md",
            "Review",
        );

        let existing = InstalledSubagent {
            id: "owner/repo:review.md".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "review".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&existing).unwrap();

        // 故障注入：DB 只读，保存必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        let discoverable = DiscoverableSubagent {
            key: "owner/repo:review.md".to_string(),
            name: "Existing".to_string(),
            description: "".to_string(),
            directory: "review".to_string(),
            path: "review.md".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
            installed: false,
        };

        SubagentService::reuse_existing_install_for_target(
            &db,
            &ScopeTarget::Global,
            &discoverable,
            "review",
            &AgentType::Codex,
        )
        .expect_err("保存失败必须返回错误");

        assert!(
            !config::get_codex_agents_dir().join("review.md").exists(),
            "保存失败时本次新建的投影必须被移除"
        );
        let stored = db.get_installed_subagent(&existing.id).unwrap().unwrap();
        assert!(stored.apps.claude_code);
        assert!(!stored.apps.codex, "保存失败时 codex 的启用标志不得落库");
    }

    #[test]
    #[serial]
    fn uninstall_removes_only_enabled_app_projections() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "scoped-agent.md",
            "Scoped",
        );

        let subagent = InstalledSubagent {
            id: "owner/repo:scoped-agent.md".to_string(),
            name: "Scoped".to_string(),
            description: None,
            directory: "scoped-agent".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&subagent).unwrap();
        SubagentService::sync_to_app_dir("scoped-agent", &AgentType::ClaudeCode).unwrap();

        // Codex 下同名的"用户自有"文件，与受管投影无关
        let codex_owned = config::get_codex_agents_dir().join("scoped-agent.md");
        fs::create_dir_all(config::get_codex_agents_dir()).unwrap();
        fs::write(&codex_owned, "user-owned content").unwrap();

        SubagentService::uninstall(&db, &subagent.id).expect("uninstall");

        assert_eq!(
            fs::read_to_string(&codex_owned).unwrap(),
            "user-owned content",
            "卸载不得触碰未启用 Agent 下的同名用户内容"
        );
        assert!(!config::get_claude_agents_dir()
            .join("scoped-agent.md")
            .exists());
        assert!(!SubagentService::get_ssot_dir()
            .unwrap()
            .join("scoped-agent.md")
            .exists());
        assert!(db.get_installed_subagent(&subagent.id).unwrap().is_none());
    }

    #[test]
    #[serial]
    fn sync_to_app_dir_creates_symlink_in_symlink_mode() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        crate::settings::set_sync_method(SyncMethod::Symlink).unwrap();

        let ssot = SubagentService::get_ssot_dir().unwrap();
        write_subagent(&ssot, "sym-agent.md", "Sym Agent");

        SubagentService::sync_to_app_dir("sym-agent", &AgentType::ClaudeCode).expect("sync");

        let projection = config::get_claude_agents_dir().join("sym-agent.md");
        assert!(SkillService::is_symlink(&projection));
    }

    #[test]
    #[serial]
    fn sync_to_app_dir_copies_in_copy_mode() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        let ssot = SubagentService::get_ssot_dir().unwrap();
        write_subagent(&ssot, "copy-agent.md", "Copy Agent");

        SubagentService::sync_to_app_dir("copy-agent", &AgentType::ClaudeCode).expect("sync");

        let projection = config::get_claude_agents_dir().join("copy-agent.md");
        assert!(projection.is_file());
        assert!(!SkillService::is_symlink(&projection));
    }

    #[test]
    #[serial]
    fn uninstall_removes_projections_and_creates_backup() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "uninstall-agent.md",
            "Uninstall",
        );

        let subagent = InstalledSubagent {
            id: "owner/repo:uninstall-agent.md".to_string(),
            name: "Uninstall".to_string(),
            description: None,
            directory: "uninstall-agent".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&subagent).unwrap();
        SubagentService::sync_to_app_dir("uninstall-agent", &AgentType::ClaudeCode).unwrap();

        let result = SubagentService::uninstall(&db, &subagent.id).expect("uninstall");
        assert!(result.backup_path.is_some());

        assert!(!SubagentService::get_ssot_dir()
            .unwrap()
            .join("uninstall-agent.md")
            .exists());
        assert!(!config::get_claude_agents_dir()
            .join("uninstall-agent.md")
            .exists());
        assert!(db.get_installed_subagent(&subagent.id).unwrap().is_none());

        let backups = SubagentService::list_backups().expect("list backups");
        assert_eq!(backups.len(), 1);
    }

    #[test]
    #[serial]
    fn restore_from_backup_recreates_ssot_and_projection() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "restore-agent.md",
            "Restore",
        );

        let subagent = InstalledSubagent {
            id: "owner/repo:restore-agent.md".to_string(),
            name: "Restore".to_string(),
            description: None,
            directory: "restore-agent".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&subagent).unwrap();
        SubagentService::sync_to_app_dir("restore-agent", &AgentType::ClaudeCode).unwrap();

        let result = SubagentService::uninstall(&db, &subagent.id).expect("uninstall");
        let backup_id = result
            .backup_path
            .unwrap()
            .split('/')
            .next_back()
            .unwrap()
            .to_string();

        let restored = SubagentService::restore_from_backup(&db, &backup_id, &AgentType::Codex)
            .expect("restore");
        assert_eq!(restored.directory, "restore-agent");
        // 恢复以备份中记录的启用标志为准，而非仅 UI 当前 Agent
        assert!(restored.apps.claude_code);
        assert!(!restored.apps.codex);

        assert!(SubagentService::get_ssot_dir()
            .unwrap()
            .join("restore-agent.md")
            .exists());
        assert!(config::get_claude_agents_dir()
            .join("restore-agent.md")
            .exists());
    }

    #[test]
    #[serial]
    fn restore_from_backup_restores_all_enabled_apps() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "multi-agent.md",
            "Multi",
        );

        // 卸载前对 ClaudeCode 与 Codex 两个 Agent 启用
        let mut subagent = installed_subagent("owner/repo:multi-agent.md", "multi-agent");
        subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);
        subagent.apps.set_enabled_for(&AgentType::Codex, true);
        db.save_subagent(&subagent).unwrap();
        SubagentService::sync_to_app_dir("multi-agent", &AgentType::ClaudeCode).unwrap();
        SubagentService::sync_to_app_dir("multi-agent", &AgentType::Codex).unwrap();

        let result = SubagentService::uninstall(&db, &subagent.id).expect("uninstall");
        let backup_id = result
            .backup_path
            .unwrap()
            .split('/')
            .next_back()
            .unwrap()
            .to_string();

        let restored =
            SubagentService::restore_from_backup(&db, &backup_id, &AgentType::ClaudeCode)
                .expect("restore");

        // apps 标志与卸载前一致
        assert!(restored.apps.claude_code);
        assert!(restored.apps.codex);
        assert!(!restored.apps.gemini_cli);
        let stored = db.get_installed_subagent(&subagent.id).unwrap().unwrap();
        assert!(stored.apps.claude_code);
        assert!(stored.apps.codex);

        // 各启用 Agent 的投影均重建
        assert!(config::get_claude_agents_dir()
            .join("multi-agent.md")
            .exists());
        assert!(config::get_codex_agents_dir()
            .join("multi-agent.md")
            .exists());
    }

    #[test]
    #[serial]
    fn restore_from_backup_removes_prior_projections_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "restore-rb-agent.md",
            "RestoreRB",
        );

        // 卸载前对 ClaudeCode 与 Codex 两个 Agent 启用
        let mut subagent = installed_subagent("owner/repo:restore-rb-agent.md", "restore-rb-agent");
        subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);
        subagent.apps.set_enabled_for(&AgentType::Codex, true);
        db.save_subagent(&subagent).unwrap();
        SubagentService::sync_to_app_dir("restore-rb-agent", &AgentType::ClaudeCode).unwrap();
        SubagentService::sync_to_app_dir("restore-rb-agent", &AgentType::Codex).unwrap();

        let result = SubagentService::uninstall(&db, &subagent.id).expect("uninstall");
        let backup_id = result
            .backup_path
            .unwrap()
            .split('/')
            .next_back()
            .unwrap()
            .to_string();

        // 故障注入：codex 配置目录只读，恢复时第二个 Agent 的投影同步必然失败
        let read_only_root = tmp.path().join("readonly-codex");
        let agents_dir = read_only_root.join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        for dir in [&read_only_root, &agents_dir] {
            let mut permissions = std::fs::metadata(dir).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(dir, permissions).unwrap();
        }
        crate::settings::set_agent_config_dir_override(
            "codex",
            Some(read_only_root.to_string_lossy().to_string()),
        )
        .unwrap();

        SubagentService::restore_from_backup(&db, &backup_id, &AgentType::ClaudeCode)
            .expect_err("第二个 Agent 同步失败必须返回错误");

        // 本次恢复创建的前序投影必须被移除
        assert!(
            !config::get_claude_agents_dir()
                .join("restore-rb-agent.md")
                .exists(),
            "同步失败时前序 Agent 的投影必须被移除"
        );
        // DB 与 SSOT 已清理
        assert!(db.get_installed_subagent(&subagent.id).unwrap().is_none());
        assert!(!SubagentService::get_ssot_dir()
            .unwrap()
            .join("restore-rb-agent.md")
            .exists());

        // 恢复写权限以便临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&read_only_root, &agents_dir] {
                let mut permissions = std::fs::metadata(dir).unwrap().permissions();
                permissions.set_mode(permissions.mode() | 0o200);
                let _ = fs::set_permissions(dir, permissions);
            }
        }
        crate::settings::reset_settings_store_for_test();
    }

    #[test]
    #[serial]
    fn toggle_app_enable_rolls_back_projection_on_db_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "toggle-agent.md",
            "Toggle",
        );

        let mut subagent = installed_subagent("owner/repo:toggle-agent.md", "toggle-agent");
        subagent.apps = SubagentApps::default();
        db.save_subagent(&subagent).unwrap();

        // 故障注入：DB 只读，update_subagent_apps 必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        SubagentService::toggle_app(&db, &subagent.id, &AgentType::ClaudeCode, true)
            .expect_err("落库失败必须返回错误");

        // 启用方向：新建的投影必须被撤销，DB 保持禁用
        assert!(
            !config::get_claude_agents_dir()
                .join("toggle-agent.md")
                .exists(),
            "落库失败时本次新建的投影必须被移除"
        );
        let stored = db.get_installed_subagent(&subagent.id).unwrap().unwrap();
        assert!(!stored.apps.claude_code, "落库失败时启用标志不得改变");
    }

    #[test]
    #[serial]
    fn toggle_app_disable_restores_projection_on_db_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "toggle-agent.md",
            "Toggle",
        );

        let mut subagent = installed_subagent("owner/repo:toggle-agent.md", "toggle-agent");
        subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);
        db.save_subagent(&subagent).unwrap();
        SubagentService::sync_to_app_dir("toggle-agent", &AgentType::ClaudeCode).unwrap();

        // 故障注入：DB 只读，update_subagent_apps 必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        SubagentService::toggle_app(&db, &subagent.id, &AgentType::ClaudeCode, false)
            .expect_err("落库失败必须返回错误");

        // 禁用方向：已删除的投影必须被恢复，DB 保持启用
        assert!(
            config::get_claude_agents_dir()
                .join("toggle-agent.md")
                .exists(),
            "落库失败时被删除的投影必须恢复"
        );
        let stored = db.get_installed_subagent(&subagent.id).unwrap().unwrap();
        assert!(stored.apps.claude_code, "落库失败时启用标志不得改变");
    }

    #[test]
    #[serial]
    fn migrate_storage_moves_ssot_and_refreshes_projections() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        crate::settings::set_sync_method(SyncMethod::Symlink).unwrap();

        let db = Arc::new(Database::memory().unwrap());
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "migrate-agent.md",
            "Migrate",
        );

        let subagent = InstalledSubagent {
            id: "owner/repo:migrate-agent.md".to_string(),
            name: "Migrate".to_string(),
            description: None,
            directory: "migrate-agent".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&subagent).unwrap();
        SubagentService::sync_to_app_dir("migrate-agent", &AgentType::ClaudeCode).unwrap();

        let result = crate::commands::migrate_storage_combined(&db, StorageLocation::Unified)
            .expect("migrate");
        assert_eq!(result.subagent.migrated_count, 1);
        assert_eq!(result.subagent.skipped_count, 0);

        let new_ssot = config::get_home_dir()
            .join(".agents")
            .join("subagents")
            .join("migrate-agent.md");
        assert!(new_ssot.exists());

        let projection = config::get_claude_agents_dir().join("migrate-agent.md");
        assert!(projection.exists());
        assert!(SkillService::is_symlink(&projection));

        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Unified
        );
    }

    #[test]
    #[serial]
    fn migrate_storage_aborts_on_conflict_and_rolls_back() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());

        for name in ["agent-a", "agent-b"] {
            write_subagent(
                &SubagentService::get_ssot_dir().unwrap(),
                &format!("{name}.md"),
                name,
            );
            let subagent = InstalledSubagent {
                id: format!("owner/repo:{name}.md"),
                name: name.to_string(),
                description: None,
                directory: name.to_string(),
                repo_owner: Some("owner".to_string()),
                repo_name: Some("repo".to_string()),
                repo_branch: Some("main".to_string()),
                readme_url: None,
                apps: SubagentApps::default(),
                installed_at: 1,
                content_hash: None,
                updated_at: 0,
                target: ScopeTarget::Global,
            };
            db.save_subagent(&subagent).unwrap();
        }

        let conflict_file = config::get_home_dir()
            .join(".agents")
            .join("subagents")
            .join("agent-b.md");
        fs::create_dir_all(conflict_file.parent().unwrap()).unwrap();
        fs::write(&conflict_file, "conflict").unwrap();

        let result = crate::commands::migrate_storage_combined(&db, StorageLocation::Unified);
        assert!(result.is_err(), "冲突时应中止迁移");
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("MIGRATION_ABORTED"));

        assert!(SubagentService::get_ssot_dir()
            .unwrap()
            .join("agent-a.md")
            .exists());
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("subagents")
            .join("agent-a.md")
            .exists());

        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Hub
        );
    }

    #[test]
    #[serial]
    fn update_replace_failure_restores_ssot_from_backup() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let dest_file = tmp.path().join("ssot").join("my-agent.md");
        write_subagent(dest_file.parent().unwrap(), "my-agent.md", "Old");

        let backup = tmp.path().join("backup");
        write_subagent(&backup, "my-agent.md", "Old");

        // 源缺失导致复制失败：dest 先被删除，随后必须从备份恢复
        let missing_source = tmp.path().join("missing-source.md");
        let result = SubagentService::replace_ssot_file(&missing_source, &dest_file);
        assert!(result.is_err(), "copy from a missing source must fail");
        assert!(!dest_file.exists());

        SubagentService::restore_ssot_from_backup(Some(&backup), &dest_file, "my-agent");

        assert!(dest_file.exists());
        assert!(fs::read_to_string(&dest_file)
            .unwrap()
            .contains("name: Old"));
    }

    #[test]
    #[serial]
    fn install_same_repo_different_path_returns_conflict() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        let existing = InstalledSubagent {
            id: "owner/repo:team/review.md".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "review".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&existing).unwrap();

        let discoverable = DiscoverableSubagent {
            key: "owner/repo:personal/review.md".to_string(),
            name: "New".to_string(),
            description: "".to_string(),
            directory: "review".to_string(),
            path: "personal/review.md".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
            installed: false,
        };

        let err = SubagentService::reuse_existing_install_for_target(
            &db,
            &ScopeTarget::Global,
            &discoverable,
            "review",
            &AgentType::Codex,
        )
        .expect_err("must conflict");
        assert!(err.to_string().contains("SUBAGENT_DIRECTORY_CONFLICT"));
    }

    #[test]
    #[serial]
    fn uninstall_aborts_when_projection_removal_fails() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "uninstall-agent.md",
            "Uninstall",
        );
        let subagent = InstalledSubagent {
            id: "owner/repo:uninstall-agent.md".to_string(),
            name: "Uninstall".to_string(),
            description: None,
            directory: "uninstall-agent".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
            target: ScopeTarget::Global,
        };
        db.save_subagent(&subagent).unwrap();
        SubagentService::sync_to_app_dir("uninstall-agent", &AgentType::ClaudeCode).unwrap();

        let claude_agents = config::get_claude_agents_dir();
        let mut permissions = std::fs::metadata(&claude_agents).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&claude_agents, permissions).unwrap();

        let result = SubagentService::uninstall(&db, &subagent.id);
        assert!(result.is_err(), "投影移除失败应中止卸载");
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("UNINSTALL_PROJECTION_FAILED"));

        assert!(SubagentService::get_ssot_dir()
            .unwrap()
            .join("uninstall-agent.md")
            .exists());
        assert!(db.get_installed_subagent(&subagent.id).unwrap().is_some());
    }

    #[test]
    fn rollback_subagent_moves_keeps_dst_when_fallback_copy_fails() {
        let tmp = tempdir().unwrap();

        // old_root 是一个普通文件：rename 与回退复制都会失败（ENOTDIR），
        // 模拟跨文件系统回滚时回退复制也失败（如旧盘满）的场景
        let old_root = tmp.path().join("old-root");
        fs::write(&old_root, "not a directory").unwrap();
        let new_root = tmp.path().join("new-root");
        write_subagent(&new_root, "agent-a.md", "Agent A");

        SubagentService::rollback_subagent_moves(&old_root, &new_root, &["agent-a".to_string()]);

        // 回退复制失败时必须保留 dst：它可能是该 subagent 唯一完整副本
        assert!(fs::read_to_string(new_root.join("agent-a.md"))
            .unwrap()
            .contains("name: Agent A"));
    }

    #[test]
    #[serial]
    fn apply_downloaded_update_lands_in_current_ssot_after_migration_during_download() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 下载开始时存储在 Hub：旧版 subagent 位于 Hub SSOT
        let hub_ssot = SubagentService::get_ssot_dir().unwrap();
        write_subagent(&hub_ssot, "upd.md", "Old");
        let previous = installed_subagent("owner/repo:upd.md", "upd");
        db.save_subagent(&previous).unwrap();

        // 模拟下载期间完成存储迁移：文件物理移动 + 设置切换
        let unified_root = config::get_home_dir().join(".agents").join("subagents");
        fs::create_dir_all(&unified_root).unwrap();
        fs::rename(hub_ssot.join("upd.md"), unified_root.join("upd.md")).unwrap();
        crate::settings::set_storage_location(StorageLocation::Unified).unwrap();

        // 模拟已下载完成的新版本源
        let download = tmp.path().join("download");
        write_subagent(&download, "upd.md", "New");

        let updated = SubagentService::apply_downloaded_update(
            &db,
            &ScopeTarget::Global,
            &previous,
            "owner",
            "repo",
            "main".to_string(),
            &download.join("upd.md"),
            "upd.md",
        )
        .expect("update");

        // 新版本落在迁移后的 Unified 根，旧根不被写入新版本
        assert!(fs::read_to_string(unified_root.join("upd.md"))
            .unwrap()
            .contains("name: New"));
        let old_root_file = hub_ssot.join("upd.md");
        if old_root_file.exists() {
            assert!(
                fs::read_to_string(&old_root_file)
                    .unwrap()
                    .contains("name: Old"),
                "新版本绝不能写入迁移前的旧根"
            );
        }

        // 新 hash 落库，且与当前 SSOT 内容一致
        let stored = db.get_installed_subagent(&previous.id).unwrap().unwrap();
        assert_eq!(stored.content_hash, updated.content_hash);
        assert!(stored.content_hash.is_some());
    }

    #[test]
    #[serial]
    fn finish_install_lands_in_current_ssot_after_migration_during_download() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 下载期间存储从 Hub 迁移到 Unified
        let hub_ssot = SubagentService::get_ssot_dir().unwrap();
        crate::settings::set_storage_location(StorageLocation::Unified).unwrap();

        let download = tmp.path().join("download");
        write_subagent(&download, "new-agent.md", "New Agent");

        let subagent = discoverable("owner/repo:new-agent.md", "new-agent", "new-agent.md");

        let installed = SubagentService::finish_install_under_lock(
            &db,
            &ScopeTarget::Global,
            &subagent,
            "new-agent",
            &AgentType::ClaudeCode,
            "main".to_string(),
            Some(&download.join("new-agent.md")),
        )
        .expect("install");

        // 新版本落在迁移后的 Unified 根，旧根不被写入
        let unified = config::get_home_dir()
            .join(".agents")
            .join("subagents")
            .join("new-agent.md");
        assert!(unified.exists());
        assert!(!hub_ssot.join("new-agent.md").exists());

        assert!(db.get_installed_subagent(&installed.id).unwrap().is_some());
        assert!(config::get_claude_agents_dir()
            .join("new-agent.md")
            .exists());
    }

    /// 把 claude agents 目录换成只读目录，使投影同步必然失败；返回需恢复权限的目录。
    fn make_readonly_claude_agents_dir(tmp: &Path) -> (PathBuf, PathBuf) {
        let read_only_root = tmp.join("readonly-claude");
        let agents_dir = read_only_root.join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        for dir in [&read_only_root, &agents_dir] {
            let mut permissions = std::fs::metadata(dir).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(dir, permissions).unwrap();
        }
        crate::settings::update_settings(crate::settings::AppSettings {
            claude_code_config_dir: Some(read_only_root.to_string_lossy().to_string()),
            ..Default::default()
        })
        .unwrap();
        (read_only_root, agents_dir)
    }

    fn restore_writable(dirs: [&Path; 2]) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in dirs {
                let mut permissions = std::fs::metadata(dir).unwrap().permissions();
                permissions.set_mode(permissions.mode() | 0o200);
                let _ = fs::set_permissions(dir, permissions);
            }
        }
        crate::settings::reset_settings_store_for_test();
    }

    #[test]
    #[serial]
    fn persist_and_sync_new_subagent_removes_fresh_ssot_file_on_save_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        let dest = write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "doomed.md",
            "Doomed",
        );

        let mut subagent = installed_subagent("owner/repo:doomed.md", "doomed");
        subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);

        // 故障注入：DB 只读，保存必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        let result = SubagentService::persist_and_sync_new_subagent(
            &db,
            &ScopeTarget::Global,
            &subagent,
            &AgentType::ClaudeCode,
            Some(&dest),
        );
        assert!(result.is_err(), "保存失败必须返回错误");
        assert!(!dest.exists(), "保存失败时本次新建的 SSOT 文件必须一并删除");
        assert!(db.get_installed_subagent(&subagent.id).unwrap().is_none());
    }

    #[test]
    #[serial]
    fn persist_and_sync_new_subagent_removes_fresh_ssot_file_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        let dest = write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "sync-fail.md",
            "SyncFail",
        );
        let (read_only_root, agents_dir) = make_readonly_claude_agents_dir(tmp.path());

        let mut subagent = installed_subagent("owner/repo:sync-fail.md", "sync-fail");
        subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);

        let result = SubagentService::persist_and_sync_new_subagent(
            &db,
            &ScopeTarget::Global,
            &subagent,
            &AgentType::ClaudeCode,
            Some(&dest),
        );
        assert!(result.is_err(), "同步失败必须返回错误");
        assert!(!dest.exists(), "同步失败时本次新建的 SSOT 文件必须一并删除");
        assert!(db.get_installed_subagent(&subagent.id).unwrap().is_none());

        restore_writable([&read_only_root, &agents_dir]);
    }

    #[test]
    #[serial]
    fn persist_and_sync_new_subagent_preserves_adopted_file_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        let dest = write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "adopted.md",
            "Adopted",
        );
        let (read_only_root, agents_dir) = make_readonly_claude_agents_dir(tmp.path());

        let mut subagent = installed_subagent("owner/repo:adopted.md", "adopted");
        subagent.apps = SubagentApps::only(&AgentType::ClaudeCode);

        // fresh_ssot_file 为 None：文件是接管/既有的，回滚时绝不能删除
        let result = SubagentService::persist_and_sync_new_subagent(
            &db,
            &ScopeTarget::Global,
            &subagent,
            &AgentType::ClaudeCode,
            None,
        );
        assert!(result.is_err(), "同步失败必须返回错误");
        assert!(dest.exists(), "接管/既有的 SSOT 文件绝不能被回滚删除");
        assert!(db.get_installed_subagent(&subagent.id).unwrap().is_none());

        restore_writable([&read_only_root, &agents_dir]);
    }

    #[test]
    #[serial]
    fn sync_rejects_overlapping_app_agents_dir() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        // override 的 agents 目录落在 SSOT 内部（父子重叠）：symlink 会造成
        // 文件系统环，copy 会反复写自身，必须拒绝
        let ssot = SubagentService::get_ssot_dir().unwrap();
        crate::settings::update_settings(crate::settings::AppSettings {
            claude_code_config_dir: Some(ssot.join("nested").to_string_lossy().to_string()),
            ..Default::default()
        })
        .unwrap();
        write_subagent(&ssot, "overlap.md", "Overlap");

        let err = SubagentService::sync_to_app_dir("overlap", &AgentType::ClaudeCode)
            .expect_err("父子重叠的 agents 目录必须被拒绝");
        assert!(err.to_string().contains("SUBAGENT_STORAGE_OVERLAP"));
    }

    #[test]
    #[serial]
    fn migrate_storage_fails_when_source_file_not_removable() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        let old_dir = SubagentService::get_ssot_dir().unwrap();
        write_subagent(&old_dir, "mig-src.md", "MigSrc");
        db.save_subagent(&installed_subagent("owner/repo:mig-src.md", "mig-src"))
            .unwrap();

        // 故障注入：旧根只读 → rename 失败回退为 copy，copy 成功但源文件删除失败
        let mut permissions = std::fs::metadata(&old_dir).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&old_dir, permissions).unwrap();

        let result = crate::commands::migrate_storage_combined(&db, StorageLocation::Unified);

        // 恢复写权限以便断言与临时目录清理
        restore_writable([&old_dir, &old_dir]);

        assert!(result.is_err(), "源文件删除失败必须按迁移失败处理");
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("MIGRATION_ABORTED"));

        // 目标副本必须被回滚删除，源文件保留，存储设置未切换
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("subagents")
            .join("mig-src.md")
            .exists());
        assert!(old_dir.join("mig-src.md").exists());
        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Hub
        );
    }
}
