//! Skills 服务层
//!
//! 统一管理架构：
//! - SSOT（单一事实源）：`~/.agent-config-manager/skills/` 或 `~/.agents/skills/`
//! - 安装时下载到 SSOT，按需同步到各 Agent 目录
//! - 数据库存储安装记录和启用状态
//!
//! 已裁剪：skills.sh 搜索、deeplink 导入、Pi/Hermes/GrokBuild/OpenClaw/ClaudeDesktop 分支。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config;
use crate::database::Database;
use crate::error::{format_skill_error, AppError};
use crate::settings::{get_settings, StorageLocation, SyncMethod};

// ========== Skills state coordination ==========

fn skill_state_lock() -> &'static RwLock<()> {
    static LOCK: OnceLock<RwLock<()>> = OnceLock::new();
    LOCK.get_or_init(|| RwLock::new(()))
}

pub(crate) fn skill_state_read_guard() -> RwLockReadGuard<'static, ()> {
    skill_state_lock().read().unwrap_or_else(|poisoned| {
        log::warn!("Skills state read lock was poisoned; recovering the protected state");
        poisoned.into_inner()
    })
}

pub(crate) fn skill_state_write_guard() -> RwLockWriteGuard<'static, ()> {
    skill_state_lock().write().unwrap_or_else(|poisoned| {
        log::warn!("Skills state write lock was poisoned; recovering the protected state");
        poisoned.into_inner()
    })
}

// ========== Agent type ==========

/// 受支持的一等 Agent 类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentType {
    ClaudeCode,
    Codex,
    GeminiCli,
    OpenCode,
}

impl AgentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "claude-code",
            AgentType::Codex => "codex",
            AgentType::GeminiCli => "gemini-cli",
            AgentType::OpenCode => "opencode",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, AppError> {
        let normalized = s.trim().to_lowercase().replace('_', "-");
        match normalized.as_str() {
            "claude-code" | "claude_code" | "claude" => Ok(AgentType::ClaudeCode),
            "codex" => Ok(AgentType::Codex),
            "gemini-cli" | "gemini_cli" | "gemini" => Ok(AgentType::GeminiCli),
            "opencode" => Ok(AgentType::OpenCode),
            other => Err(AppError::InvalidInput(format!(
                "不支持的 Agent 标识: '{other}'。可选值: claude-code, codex, gemini-cli, opencode。"
            ))),
        }
    }

    pub fn all() -> impl Iterator<Item = AgentType> {
        [
            AgentType::ClaudeCode,
            AgentType::Codex,
            AgentType::GeminiCli,
            AgentType::OpenCode,
        ]
        .into_iter()
    }
}

// ========== Data structures ==========

/// Skill 在各 Agent 上的启用状态。
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillApps {
    pub claude_code: bool,
    pub codex: bool,
    pub gemini_cli: bool,
    pub opencode: bool,
}

impl SkillApps {
    pub fn is_enabled_for(&self, app: &AgentType) -> bool {
        match app {
            AgentType::ClaudeCode => self.claude_code,
            AgentType::Codex => self.codex,
            AgentType::GeminiCli => self.gemini_cli,
            AgentType::OpenCode => self.opencode,
        }
    }

    pub fn set_enabled_for(&mut self, app: &AgentType, enabled: bool) {
        match app {
            AgentType::ClaudeCode => self.claude_code = enabled,
            AgentType::Codex => self.codex = enabled,
            AgentType::GeminiCli => self.gemini_cli = enabled,
            AgentType::OpenCode => self.opencode = enabled,
        }
    }

    pub fn enabled_apps(&self) -> Vec<AgentType> {
        let mut apps = Vec::new();
        if self.claude_code {
            apps.push(AgentType::ClaudeCode);
        }
        if self.codex {
            apps.push(AgentType::Codex);
        }
        if self.gemini_cli {
            apps.push(AgentType::GeminiCli);
        }
        if self.opencode {
            apps.push(AgentType::OpenCode);
        }
        apps
    }

    pub fn is_empty(&self) -> bool {
        !self.claude_code && !self.codex && !self.gemini_cli && !self.opencode
    }

    pub fn only(app: &AgentType) -> Self {
        let mut apps = Self::default();
        apps.set_enabled_for(app, true);
        apps
    }
}

/// 已安装的 Skill。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
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
    pub apps: SkillApps,
    pub installed_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub updated_at: i64,
}

/// 可发现的技能（来自仓库）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableSkill {
    pub key: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    pub readme_url: Option<String>,
    pub repo_owner: String,
    pub repo_name: String,
    pub repo_branch: String,
}

/// 仓库配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRepo {
    pub owner: String,
    pub name: String,
    pub branch: String,
    pub enabled: bool,
}

/// 未管理的 Skill。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmanagedSkill {
    pub directory: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub found_in: Vec<String>,
    pub path: String,
}

/// Skill 卸载结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUninstallResult {
    pub backup_path: Option<String>,
}

/// Skill 更新检测结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUpdateInfo {
    pub id: String,
    pub name: String,
    pub current_hash: Option<String>,
    pub remote_hash: String,
}

/// Skill 存储位置迁移结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated_count: usize,
    pub skipped_count: usize,
    pub errors: Vec<String>,
}

/// Skill 备份条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBackupEntry {
    pub backup_id: String,
    pub backup_path: String,
    pub created_at: i64,
    pub skill: InstalledSkill,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillBackupMetadata {
    skill: InstalledSkill,
    backup_created_at: i64,
    source_path: String,
}

/// 导入已有 Skill 时前端提交的启用选择。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillSelection {
    pub directory: String,
    /// 发现项的精确来源路径：同名不同内容的条目仅按 directory 无法区分。
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub apps: SkillApps,
}

#[derive(Debug, Clone, Deserialize)]
struct AgentsLockFile {
    skills: HashMap<String, AgentsLockSkill>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentsLockSkill {
    source: Option<String>,
    source_type: Option<String>,
    source_url: Option<String>,
    skill_path: Option<String>,
    branch: Option<String>,
    source_branch: Option<String>,
}

#[derive(Debug, Clone)]
struct LockRepoInfo {
    owner: String,
    repo: String,
    skill_path: Option<String>,
    branch: Option<String>,
}

const SKILL_BACKUP_RETAIN_COUNT: usize = 20;
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_ARCHIVE_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SYMLINK_TARGET_BYTES: u64 = 4 * 1024;
const DIRECTORY_BUDGET_COST: u64 = 4096;
const MAX_ARCHIVE_DOWNLOAD_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct SkillMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
}

// ========== Default repos ==========

pub fn default_skill_repos() -> Vec<SkillRepo> {
    vec![
        SkillRepo {
            owner: "anthropics".to_string(),
            name: "skills".to_string(),
            branch: "main".to_string(),
            enabled: true,
        },
        SkillRepo {
            owner: "ComposioHQ".to_string(),
            name: "awesome-claude-skills".to_string(),
            branch: "master".to_string(),
            enabled: true,
        },
        SkillRepo {
            owner: "cexll".to_string(),
            name: "myclaude".to_string(),
            branch: "master".to_string(),
            enabled: true,
        },
        SkillRepo {
            owner: "JimLiu".to_string(),
            name: "baoyu-skills".to_string(),
            branch: "main".to_string(),
            enabled: true,
        },
    ]
}

// ========== SkillService ==========

pub struct SkillService;

impl Default for SkillService {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) struct SkillMigrationOutcome {
    pub result: MigrationResult,
    pub moved: Vec<String>,
}

pub(crate) struct SkillMigrationFailure {
    pub moved: Vec<String>,
    pub failures: Vec<String>,
}

impl SkillMigrationFailure {
    pub(crate) fn into_error(self) -> AppError {
        AppError::Message(format_skill_error(
            "MIGRATION_ABORTED",
            &[("failures", &self.failures.join("; "))],
            Some("checkPermission"),
        ))
    }
}

/// 导入同步前记录的投影现场：失败回滚时据此决定是删除（调用前不存在）
/// 还是从快照恢复（调用前已存在，可能是用户的原始未托管来源本身）。
struct ProjectionSnapshot {
    app: AgentType,
    target: PathBuf,
    snapshot: Option<(tempfile::TempDir, PathBuf)>,
}

impl SkillService {
    pub fn new() -> Self {
        Self
    }

    pub(crate) fn build_skill_doc_url(
        owner: &str,
        repo: &str,
        branch: &str,
        doc_path: &str,
    ) -> Option<String> {
        if Self::validate_repo_ref(owner, repo, branch).is_err() {
            log::warn!("跳过非法仓库坐标的文档链接: {owner}/{repo}@{branch}");
            return None;
        }
        Some(format!(
            "https://github.com/{owner}/{repo}/blob/{branch}/{doc_path}"
        ))
    }

    pub(crate) fn extract_doc_path_from_url(url: &str) -> Option<String> {
        let marker = if url.contains("/blob/") {
            "/blob/"
        } else if url.contains("/tree/") {
            "/tree/"
        } else {
            return None;
        };

        let (_, tail) = url.split_once(marker)?;
        let (_, path) = tail.split_once('/')?;
        if path.is_empty() {
            return None;
        }
        Some(path.to_string())
    }

    // ========== Path management ==========

    pub fn get_ssot_dir() -> Result<PathBuf, AppError> {
        let location = get_settings().storage_location;
        let dir = match location {
            StorageLocation::Hub => config::get_hub_skills_dir(),
            StorageLocation::Unified => config::get_home_dir().join(".agents").join("skills"),
        };
        fs::create_dir_all(&dir).map_err(|e| AppError::io(&dir, e))?;
        Ok(dir)
    }

    fn get_backup_dir() -> Result<PathBuf, AppError> {
        let dir = config::get_hub_skill_backups_dir();
        fs::create_dir_all(&dir).map_err(|e| AppError::io(&dir, e))?;
        Ok(dir)
    }

    pub fn get_app_skills_dir(app: &AgentType) -> Result<PathBuf, AppError> {
        let dir = match app {
            AgentType::ClaudeCode => config::get_claude_skills_dir(),
            AgentType::Codex => config::get_codex_skills_dir(),
            AgentType::GeminiCli => config::get_gemini_skills_dir(),
            AgentType::OpenCode => config::get_opencode_skills_dir(),
        };
        Ok(dir)
    }

    pub(crate) fn paths_alias(left: &Path, right: &Path) -> bool {
        if left == right {
            return true;
        }

        matches!(
            (left.canonicalize(), right.canonicalize()),
            (Ok(left), Ok(right)) if left == right
        )
    }

    pub(crate) fn paths_overlap(left: &Path, right: &Path) -> bool {
        let overlaps = |left: &Path, right: &Path| {
            left == right || left.starts_with(right) || right.starts_with(left)
        };
        if overlaps(left, right) {
            return true;
        }

        if let (Ok(left), Ok(right)) = (left.canonicalize(), right.canonicalize()) {
            if overlaps(&left, &right) {
                return true;
            }
        }

        let canonical_entry =
            |path: &Path| Some(path.parent()?.canonicalize().ok()?.join(path.file_name()?));
        matches!(
            (canonical_entry(left), canonical_entry(right)),
            (Some(left), Some(right)) if overlaps(&left, &right)
        )
    }

    fn ensure_distinct_skill_roots(
        ssot_dir: &Path,
        app_dir: &Path,
        app: &AgentType,
    ) -> Result<(), AppError> {
        // 判等之外还必须拒绝父子重叠：目标落在 SSOT 内部时，symlink 会造成
        // 文件系统环，copy 会把临时目标递归拷进自身直至耗尽资源
        if Self::paths_overlap(ssot_dir, app_dir) {
            let ssot = ssot_dir.display().to_string();
            let app_dir = app_dir.display().to_string();
            return Err(AppError::Message(format_skill_error(
                "SKILL_STORAGE_OVERLAP",
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

    fn get_distinct_app_skills_dir(ssot_dir: &Path, app: &AgentType) -> Result<PathBuf, AppError> {
        let app_dir = Self::get_app_skills_dir(app)?;
        Self::ensure_distinct_skill_roots(ssot_dir, &app_dir, app)?;
        Ok(app_dir)
    }

    fn validate_skill_storage_destination(ssot_dir: &Path) -> Result<(), AppError> {
        for app in AgentType::all() {
            let app_dir = Self::get_app_skills_dir(&app)?;
            Self::ensure_distinct_skill_roots(ssot_dir, &app_dir, &app)?;
        }
        Ok(())
    }

    // ========== Installed skill queries ==========

    pub fn get_all_installed(db: &Arc<Database>) -> Result<Vec<InstalledSkill>, AppError> {
        let skills = db.get_all_installed_skills()?;
        Ok(skills.into_values().collect())
    }

    fn reuse_existing_install(
        db: &Arc<Database>,
        skill: &DiscoverableSkill,
        install_name: &str,
        current_app: &AgentType,
    ) -> Result<Option<InstalledSkill>, AppError> {
        let existing_skills = db.get_all_installed_skills()?;
        for existing in existing_skills.values() {
            if !existing.directory.eq_ignore_ascii_case(install_name) {
                continue;
            }

            let same_repo = existing.repo_owner.as_deref() == Some(&skill.repo_owner)
                && existing.repo_name.as_deref() == Some(&skill.repo_name);
            if same_repo {
                // 同一仓库可能含多个同名不同内容的 skill（如 a/reviewer 与
                // b/reviewer，sanitize 后安装名相同）：复用前必须比对完整来源
                // 身份，身份不同即冲突，绝不冒名启用另一来源的内容
                if existing.id == skill.key {
                    let mut updated = existing.clone();
                    updated.apps.set_enabled_for(current_app, true);
                    // 先同步投影成功再落库：同步失败时 DB 保持原启用标志，
                    // 避免出现"已启用但无可用投影"的中间状态
                    Self::sync_to_app_dir(&updated.directory, current_app)?;
                    if let Err(error) = db.save_skill(&updated) {
                        // 落库失败：移除本次新建的投影，恢复到操作前状态；
                        // 操作前已启用的投影先于本次操作存在，保留不动
                        if !existing.apps.is_enabled_for(current_app) {
                            if let Err(rollback_error) =
                                Self::remove_from_app(&updated.directory, current_app)
                            {
                                log::error!(
                                    "保存 Skill {} 失败后移除 {} 投影也失败: {rollback_error}",
                                    updated.name,
                                    current_app.as_str()
                                );
                            }
                        }
                        return Err(error);
                    }
                    log::info!(
                        "Skill {} 已存在，更新 {} 启用状态",
                        updated.name,
                        current_app.as_str()
                    );
                    return Ok(Some(updated));
                }

                return Err(AppError::Message(format_skill_error(
                    "SKILL_DIRECTORY_CONFLICT",
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
                            &format!("{}/{}", skill.repo_owner, skill.repo_name),
                        ),
                    ],
                    Some("uninstallFirst"),
                )));
            }

            return Err(AppError::Message(format_skill_error(
                "SKILL_DIRECTORY_CONFLICT",
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
                        &format!("{}/{}", skill.repo_owner, skill.repo_name),
                    ),
                ],
                Some("uninstallFirst"),
            )));
        }

        Ok(None)
    }

    /// 目标位置已存在但数据库无记录：属于未托管内容，绝不覆盖/冒名记录。
    fn unmanaged_destination_conflict(install_name: &str) -> AppError {
        AppError::Message(format_skill_error(
            "SKILL_DIRECTORY_CONFLICT",
            &[("directory", install_name), ("existingRepo", "unmanaged")],
            Some("importFirst"),
        ))
    }

    fn ensure_no_unmanaged_destination(dest: &Path, install_name: &str) -> Result<(), AppError> {
        if dest.exists() || Self::is_symlink(dest) {
            return Err(Self::unmanaged_destination_conflict(install_name));
        }
        Ok(())
    }

    // ========== Install ==========

    pub async fn install(
        &self,
        db: &Arc<Database>,
        skill: &DiscoverableSkill,
        current_app: &AgentType,
    ) -> Result<InstalledSkill, AppError> {
        let ssot_dir = Self::get_ssot_dir()?;

        let source_rel = Self::sanitize_skill_source_path(&skill.directory).ok_or_else(|| {
            AppError::Message(format_skill_error(
                "INVALID_SKILL_DIRECTORY",
                &[("directory", &skill.directory)],
                Some("checkZipContent"),
            ))
        })?;

        let install_name = source_rel
            .file_name()
            .and_then(|name| Self::sanitize_install_name(&name.to_string_lossy()))
            .ok_or_else(|| {
                AppError::Message(format_skill_error(
                    "INVALID_SKILL_DIRECTORY",
                    &[("directory", &skill.directory)],
                    Some("checkZipContent"),
                ))
            })?;

        {
            let _state_guard = skill_state_write_guard();
            if let Some(existing) =
                Self::reuse_existing_install(db, skill, &install_name, current_app)?
            {
                return Ok(existing);
            }
        }

        // 该 dest 仅用于决定是否需要下载；真正落盘的目标路径在写锁内重新解析，
        // 避免下载期间发生的存储迁移把新 skill 写入旧根。
        let dest = ssot_dir.join(&install_name);

        let mut repo_branch = skill.repo_branch.clone();
        let mut resolved_doc_path: Option<String> = None;
        let mut downloaded_source: Option<(tempfile::TempDir, PathBuf)> = None;
        if !dest.exists() {
            let repo = SkillRepo {
                owner: skill.repo_owner.clone(),
                name: skill.repo_name.clone(),
                branch: skill.repo_branch.clone(),
                enabled: true,
            };

            let (temp_guard, used_branch) =
                Self::download_repo_with_timeout(&self.download_client(), &repo).await?;
            let temp_dir = temp_guard.path();
            repo_branch = used_branch;

            let source =
                Self::resolve_skill_source_dir(temp_dir, &skill.directory).ok_or_else(|| {
                    let missing = temp_dir.join(&source_rel).display().to_string();
                    AppError::Message(format_skill_error(
                        "SKILL_DIR_NOT_FOUND",
                        &[("path", &missing)],
                        Some("checkRepoUrl"),
                    ))
                })?;

            let canonical_temp = temp_dir
                .canonicalize()
                .unwrap_or_else(|_| temp_dir.to_path_buf());
            let canonical_source = source.canonicalize().map_err(|_| {
                AppError::Message(format_skill_error(
                    "SKILL_DIR_NOT_FOUND",
                    &[("path", &source.display().to_string())],
                    Some("checkRepoUrl"),
                ))
            })?;
            if !canonical_source.starts_with(&canonical_temp) || !canonical_source.is_dir() {
                return Err(AppError::Message(format_skill_error(
                    "INVALID_SKILL_DIRECTORY",
                    &[("directory", &skill.directory)],
                    Some("checkZipContent"),
                )));
            }

            resolved_doc_path = Self::doc_path_for_source(&canonical_temp, &canonical_source);
            downloaded_source = Some((temp_guard, canonical_source));

            if repo_branch != skill.repo_branch {
                log::info!(
                    "Skill {}/{} 分支自动回退: {} -> {}",
                    skill.repo_owner,
                    skill.repo_name,
                    skill.repo_branch,
                    repo_branch
                );
            }
        }

        Self::finish_install_under_lock(
            db,
            skill,
            &install_name,
            current_app,
            repo_branch,
            resolved_doc_path,
            downloaded_source
                .as_ref()
                .map(|(_, source)| source.as_path()),
        )
    }

    /// 安装落盘段：持写锁执行。目标 SSOT 路径在锁内重新解析，
    /// 避免下载期间发生的存储迁移把新 skill 写入旧根。
    fn finish_install_under_lock(
        db: &Arc<Database>,
        skill: &DiscoverableSkill,
        install_name: &str,
        current_app: &AgentType,
        repo_branch: String,
        resolved_doc_path: Option<String>,
        downloaded_source: Option<&Path>,
    ) -> Result<InstalledSkill, AppError> {
        let _state_guard = skill_state_write_guard();
        if let Some(existing) = Self::reuse_existing_install(db, skill, install_name, current_app)?
        {
            return Ok(existing);
        }

        // 写锁内重新解析目标 SSOT：下载期间存储位置可能已迁移
        let dest = Self::get_ssot_dir()?.join(install_name);

        // 磁盘上已有同名目录但 DB 无记录：未托管内容，拒绝冒名接管
        Self::ensure_no_unmanaged_destination(&dest, install_name)?;

        if !dest.exists() {
            let source = downloaded_source.ok_or_else(|| {
                AppError::Message(
                    "Skill directory changed during install; please retry".to_string(),
                )
            })?;
            Self::copy_dir_recursive(source, &dest)?;
        }

        let doc_path = Self::choose_doc_path(
            resolved_doc_path,
            skill.readme_url.as_deref(),
            &skill.directory,
        );

        let readme_url =
            Self::build_skill_doc_url(&skill.repo_owner, &skill.repo_name, &repo_branch, &doc_path);

        let content_hash = Self::compute_dir_hash(&dest).map(Some).unwrap_or_else(|e| {
            log::warn!("Failed to compute content hash for {}: {e}", install_name);
            None
        });

        let installed_skill = InstalledSkill {
            id: skill.key.clone(),
            name: skill.name.clone(),
            description: if skill.description.is_empty() {
                None
            } else {
                Some(skill.description.clone())
            },
            directory: install_name.to_string(),
            repo_owner: Some(skill.repo_owner.clone()),
            repo_name: Some(skill.repo_name.clone()),
            repo_branch: Some(repo_branch),
            readme_url,
            apps: SkillApps::only(current_app),
            installed_at: chrono::Utc::now().timestamp(),
            content_hash,
            updated_at: 0,
        };

        Self::persist_and_sync_new_skill(db, &installed_skill, current_app, Some(&dest))?;

        log::info!(
            "Skill {} 安装成功，已启用 {}",
            installed_skill.name,
            current_app.as_str()
        );

        Ok(installed_skill)
    }

    /// `fresh_ssot_dir` 仅当是本次安装新建的 SSOT 目录时传入：
    /// 回滚时连同该目录一起删除，避免残留"非受管内容"导致下次安装被拒。
    /// 接管/复用的既有目录绝不删除。
    fn persist_and_sync_new_skill(
        db: &Arc<Database>,
        skill: &InstalledSkill,
        app: &AgentType,
        fresh_ssot_dir: Option<&Path>,
    ) -> Result<(), AppError> {
        let cleanup_fresh_ssot_dir = || {
            if let Some(dir) = fresh_ssot_dir {
                if let Err(e) = fs::remove_dir_all(dir) {
                    log::error!("回滚新建 Skill SSOT 目录失败 {}: {e}", dir.display());
                }
            }
        };

        if let Err(error) = db.save_skill(skill) {
            cleanup_fresh_ssot_dir();
            return Err(error);
        }
        if let Err(error) = Self::sync_to_app_dir(&skill.directory, app) {
            if let Err(rollback_error) = db.delete_skill(&skill.id) {
                log::error!(
                    "Failed to roll back Skill {} after sync error: {rollback_error}",
                    skill.id
                );
            }
            cleanup_fresh_ssot_dir();
            return Err(error);
        }
        Ok(())
    }

    // ========== Uninstall ==========

    pub fn uninstall(db: &Arc<Database>, id: &str) -> Result<SkillUninstallResult, AppError> {
        let _state_guard = skill_state_write_guard();

        let skill = db
            .get_installed_skill(id)?
            .ok_or_else(|| AppError::InvalidInput(format!("Skill not found: {id}")))?;

        let directory = match Self::require_valid_directory(&skill.directory) {
            Ok(directory) => directory,
            Err(err) => {
                log::warn!(
                    "Skill {id} 的 directory 非法（{:?}），跳过文件清理，仅删除数据库记录: {err}",
                    skill.directory
                );
                db.delete_skill(id)?;
                return Ok(SkillUninstallResult { backup_path: None });
            }
        };

        let ssot_dir = Self::get_ssot_dir()?;

        let mut projection_failures: Vec<AgentType> = Vec::new();
        // 只清理实际启用的 Agent 投影：未启用 Agent 下的同名路径可能是用户自有内容
        for app in skill.apps.enabled_apps() {
            if let Err(e) = Self::remove_from_app(&directory, &app) {
                log::warn!(
                    "移除 Skill {} 在 {} 上的投影失败: {e}",
                    skill.name,
                    app.as_str()
                );
                projection_failures.push(app);
            }
        }
        if !projection_failures.is_empty() {
            return Err(AppError::Message(format_skill_error(
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

        let backup_path =
            Self::create_uninstall_backup(&skill)?.map(|path| path.to_string_lossy().to_string());

        let skill_path = ssot_dir.join(&directory);
        if skill_path.exists() {
            fs::remove_dir_all(&skill_path).map_err(|e| AppError::io(&skill_path, e))?;
        }

        db.delete_skill(id)?;

        log::info!(
            "Skill {} 卸载成功{}",
            skill.name,
            backup_path
                .as_deref()
                .map(|path| format!(", backup: {path}"))
                .unwrap_or_default()
        );

        Ok(SkillUninstallResult { backup_path })
    }

    // ========== Hash & metadata ==========

    pub fn compute_dir_hash(dir: &Path) -> Result<String, AppError> {
        use sha2::{Digest, Sha256};

        let mut files: Vec<PathBuf> = Vec::new();
        Self::collect_files_for_hash(dir, dir, &mut files)?;
        files.sort();

        let mut hasher = Sha256::new();
        for file_path in &files {
            let relative = file_path.strip_prefix(dir).unwrap_or(file_path);
            let rel_str = relative.to_string_lossy().replace('\\', "/");
            hasher.update(rel_str.as_bytes());
            hasher.update(b"\0");
            let content = fs::read(file_path).map_err(|e| AppError::io(file_path, e))?;
            hasher.update(&content);
            hasher.update(b"\0");
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    pub fn compute_file_hash(path: &Path) -> Result<String, AppError> {
        use sha2::{Digest, Sha256};

        let content = fs::read(path).map_err(|e| AppError::io(path, e))?;
        let mut hasher = Sha256::new();
        hasher.update(&content);
        Ok(format!("{:x}", hasher.finalize()))
    }

    #[allow(clippy::only_used_in_recursion)]
    fn collect_files_for_hash(
        base: &Path,
        current: &Path,
        files: &mut Vec<PathBuf>,
    ) -> Result<(), AppError> {
        let entries = fs::read_dir(current).map_err(|e| AppError::io(current, e))?;
        for entry in entries {
            let entry = entry.map_err(|e| AppError::io(current, e))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                Self::collect_files_for_hash(base, &path, files)?;
            } else {
                files.push(path);
            }
        }
        Ok(())
    }

    fn local_hash_for_update_check(
        ssot_dir: &Path,
        raw_directory: &str,
        cached_hash: Option<&str>,
    ) -> Option<(String, bool)> {
        let directory = match Self::require_valid_directory(raw_directory) {
            Ok(d) => d,
            Err(err) => {
                log::warn!("Skill directory 非法，跳过本地目录检查: {err}");
                return cached_hash.map(|h| (h.to_string(), false));
            }
        };

        let local_dir = ssot_dir.join(&directory);
        if !local_dir.exists() {
            return None;
        }

        if let Some(h) = cached_hash {
            return Some((h.to_string(), false));
        }

        match Self::compute_dir_hash(&local_dir) {
            Ok(h) => Some((h, true)),
            Err(_) => None,
        }
    }

    // ========== Updates ==========

    pub async fn check_updates(
        &self,
        db: &Arc<Database>,
    ) -> Result<Vec<SkillUpdateInfo>, AppError> {
        let skills = db.get_all_installed_skills()?;
        let mut updates = Vec::new();

        let mut repo_groups: HashMap<(String, String, String), Vec<InstalledSkill>> =
            HashMap::new();

        for skill in skills.into_values() {
            let (owner, name, branch) =
                match (&skill.repo_owner, &skill.repo_name, &skill.repo_branch) {
                    (Some(o), Some(n), Some(b)) => (o.clone(), n.clone(), b.clone()),
                    (Some(o), Some(n), None) => (o.clone(), n.clone(), "main".to_string()),
                    _ => continue,
                };
            repo_groups
                .entry((owner, name, branch))
                .or_default()
                .push(skill);
        }

        let ssot_dir = Self::get_ssot_dir()?;
        let client = self.download_client();

        for ((owner, name, branch), group_skills) in &repo_groups {
            let repo = SkillRepo {
                owner: owner.clone(),
                name: name.clone(),
                branch: branch.clone(),
                enabled: true,
            };

            let (temp_guard, _used_branch) =
                match Self::download_repo_with_timeout(&client, &repo).await {
                    Ok(result) => result,
                    Err(e) => {
                        log::warn!("检查更新时下载 {}/{} 失败: {e}", owner, name);
                        continue;
                    }
                };
            let temp_dir = temp_guard.path();

            let mut remote_skills: Vec<DiscoverableSkill> = Vec::new();
            let _ = Self::scan_dir_recursive_static(temp_dir, temp_dir, &repo, &mut remote_skills);

            let _state_guard = skill_state_read_guard();

            for skill in group_skills {
                let remote_match = remote_skills.iter().find(|rs| {
                    let remote_install_name =
                        rs.directory.rsplit('/').next().unwrap_or(&rs.directory);
                    remote_install_name.eq_ignore_ascii_case(&skill.directory)
                });

                let remote_skill_dir = match remote_match {
                    Some(rs) => match Self::resolve_skill_source_dir(temp_dir, &rs.directory) {
                        Some(path) => path,
                        None => continue,
                    },
                    None => continue,
                };

                let remote_hash = match Self::compute_dir_hash(&remote_skill_dir) {
                    Ok(h) => h,
                    Err(e) => {
                        log::warn!("计算远程哈希失败 {}: {e}", skill.id);
                        continue;
                    }
                };

                let local_hash = match Self::local_hash_for_update_check(
                    &ssot_dir,
                    &skill.directory,
                    skill.content_hash.as_deref(),
                ) {
                    Some((h, freshly_computed)) => {
                        if freshly_computed {
                            let _ = db.update_skill_hash(&skill.id, &h, 0);
                        }
                        Some(h)
                    }
                    None => None,
                };

                if local_hash.as_deref() != Some(&remote_hash) {
                    updates.push(SkillUpdateInfo {
                        id: skill.id.clone(),
                        name: skill.name.clone(),
                        current_hash: local_hash,
                        remote_hash,
                    });
                }
            }
        }

        Ok(updates)
    }

    fn persist_updated_skill_metadata(
        db: &Arc<Database>,
        updated_skill: &InstalledSkill,
    ) -> Result<InstalledSkill, AppError> {
        if !db.update_skill_metadata(updated_skill)? {
            return Err(AppError::InvalidInput(format!(
                "Skill no longer installed: {}",
                updated_skill.id
            )));
        }

        db.get_installed_skill(&updated_skill.id)?.ok_or_else(|| {
            AppError::InvalidInput(format!("Skill no longer installed: {}", updated_skill.id))
        })
    }

    /// 用 `source` 整体替换 SSOT 目录 `dest`。
    fn replace_ssot_dir(source: &Path, dest: &Path) -> Result<(), AppError> {
        if dest.exists() {
            fs::remove_dir_all(dest).map_err(|e| AppError::io(dest, e))?;
        }
        Self::copy_dir_recursive(source, dest)
    }

    /// 最佳努力：从更新前创建的备份恢复 SSOT 目录。
    fn restore_ssot_from_backup(backup_path: Option<&PathBuf>, dest: &Path) {
        let Some(backup) = backup_path else { return };
        let backup_skill_dir = backup.join("skill");
        if !backup_skill_dir.exists() {
            return;
        }
        if dest.exists() {
            let _ = fs::remove_dir_all(dest);
        }
        if let Err(e) = Self::copy_dir_recursive(&backup_skill_dir, dest) {
            log::error!("从备份恢复 SSOT 目录失败 {}: {e}", dest.display());
        }
    }

    /// 持久化更新后的元数据；失败时从备份恢复 SSOT、还原数据库记录并重新同步投影，
    /// 避免磁盘上是新版本而 DB 保留旧哈希/元数据的分叉状态。
    fn persist_skill_update_or_restore(
        db: &Arc<Database>,
        previous: &InstalledSkill,
        updated_metadata: &InstalledSkill,
        backup_path: Option<&PathBuf>,
        dest: &Path,
    ) -> Result<InstalledSkill, AppError> {
        match Self::persist_updated_skill_metadata(db, updated_metadata) {
            Ok(updated) => Ok(updated),
            Err(err) => {
                Self::restore_ssot_from_backup(backup_path, dest);
                let _ = db.save_skill(previous);
                for app in previous.apps.enabled_apps() {
                    let _ = Self::sync_to_app_dir(&previous.directory, &app);
                }
                Err(err)
            }
        }
    }

    pub async fn update_skill(
        &self,
        db: &Arc<Database>,
        skill_id: &str,
    ) -> Result<InstalledSkill, AppError> {
        let skill = db
            .get_installed_skill(skill_id)?
            .ok_or_else(|| AppError::InvalidInput(format!("Skill not found: {skill_id}")))?;

        Self::require_valid_directory(&skill.directory)?;

        let (owner, name, branch) = match (&skill.repo_owner, &skill.repo_name) {
            (Some(o), Some(n)) => (
                o.clone(),
                n.clone(),
                skill
                    .repo_branch
                    .clone()
                    .unwrap_or_else(|| "main".to_string()),
            ),
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "Cannot update local skill: {skill_id}"
                )))
            }
        };

        let repo = SkillRepo {
            owner: owner.clone(),
            name: name.clone(),
            branch: branch.clone(),
            enabled: true,
        };

        let client = self.download_client();
        let (temp_guard, used_branch) = Self::download_repo_with_timeout(&client, &repo).await?;
        let temp_dir = temp_guard.path();

        let mut remote_skills: Vec<DiscoverableSkill> = Vec::new();
        let _ = Self::scan_dir_recursive_static(temp_dir, temp_dir, &repo, &mut remote_skills);

        let remote_match = remote_skills
            .iter()
            .find(|rs| {
                let remote_install_name = rs.directory.rsplit('/').next().unwrap_or(&rs.directory);
                remote_install_name.eq_ignore_ascii_case(&skill.directory)
            })
            .ok_or_else(|| {
                AppError::Message(format_skill_error(
                    "SKILL_DIR_NOT_FOUND",
                    &[("path", &skill.directory)],
                    Some("checkRepoUrl"),
                ))
            })?;

        let source =
            Self::resolve_skill_source_dir(temp_dir, &remote_match.directory).ok_or_else(|| {
                let missing = temp_dir.join(&remote_match.directory).display().to_string();
                AppError::Message(format_skill_error(
                    "SKILL_DIR_NOT_FOUND",
                    &[("path", &missing)],
                    Some("checkRepoUrl"),
                ))
            })?;

        Self::apply_downloaded_update(db, &skill, &owner, &name, used_branch, &source)
    }

    /// 更新落盘段：持写锁执行。目标 SSOT 路径在锁内才解析，
    /// 避免下载期间发生的存储迁移把新版本写入旧根（而备份/投影解析的是新根）。
    fn apply_downloaded_update(
        db: &Arc<Database>,
        expected: &InstalledSkill,
        owner: &str,
        name: &str,
        used_branch: String,
        source: &Path,
    ) -> Result<InstalledSkill, AppError> {
        let _state_guard = skill_state_write_guard();

        let current_skill = db.get_installed_skill(&expected.id)?.ok_or_else(|| {
            AppError::InvalidInput(format!("Skill no longer installed: {}", expected.id))
        })?;
        if current_skill.directory != expected.directory
            || current_skill.repo_owner != expected.repo_owner
            || current_skill.repo_name != expected.repo_name
            || current_skill.repo_branch != expected.repo_branch
            || current_skill.installed_at != expected.installed_at
        {
            return Err(AppError::InvalidInput(format!(
                "Skill changed during update: {}",
                expected.id
            )));
        }
        Self::require_valid_directory(&current_skill.directory)?;
        let skill = current_skill;

        // 写锁内解析目标 SSOT：下载期间存储位置可能已迁移
        let dest = Self::get_ssot_dir()?.join(&skill.directory);

        let backup_path = Self::create_uninstall_backup(&skill)?;

        // SSOT 替换失败时必须先从备份恢复，避免 SSOT 目录丢失
        if let Err(err) = Self::replace_ssot_dir(source, &dest) {
            Self::restore_ssot_from_backup(backup_path.as_ref(), &dest);
            return Err(err);
        }

        let new_hash = Self::compute_dir_hash(&dest).ok();
        let skill_md = dest.join("SKILL.md");
        let (new_name, new_description) = Self::read_skill_name_desc(&skill_md, &skill.directory);

        let doc_path = skill
            .readme_url
            .as_deref()
            .and_then(Self::extract_doc_path_from_url)
            .unwrap_or_else(|| format!("{}/SKILL.md", skill.directory.trim_end_matches('/')));
        let readme_url = Self::build_skill_doc_url(owner, name, &used_branch, &doc_path);

        let updated_metadata = InstalledSkill {
            id: skill.id.clone(),
            name: new_name,
            description: new_description,
            directory: skill.directory.clone(),
            repo_owner: skill.repo_owner.clone(),
            repo_name: skill.repo_name.clone(),
            repo_branch: Some(used_branch),
            readme_url,
            apps: skill.apps.clone(),
            installed_at: skill.installed_at,
            content_hash: new_hash,
            updated_at: chrono::Utc::now().timestamp(),
        };

        let updated_skill = Self::persist_skill_update_or_restore(
            db,
            &skill,
            &updated_metadata,
            backup_path.as_ref(),
            &dest,
        )?;

        let mut sync_failures: Vec<AgentType> = Vec::new();
        for app in updated_skill.apps.enabled_apps() {
            if let Err(e) = Self::sync_to_app_dir(&updated_skill.directory, &app) {
                log::warn!("同步更新后的 skill 到 {} 失败: {e}", app.as_str());
                sync_failures.push(app);
            }
        }

        if !sync_failures.is_empty() {
            // 最佳努力回滚：从备份恢复 SSOT，还原数据库记录，重新同步
            Self::restore_ssot_from_backup(backup_path.as_ref(), &dest);
            let _ = db.save_skill(&skill);
            for app in skill.apps.enabled_apps() {
                let _ = Self::sync_to_app_dir(&skill.directory, &app);
            }

            return Err(AppError::Message(format_skill_error(
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

        log::info!("Skill {} 更新成功", updated_skill.name);
        Ok(updated_skill)
    }

    pub fn backfill_content_hashes(db: &Arc<Database>) -> Result<usize, AppError> {
        let _state_guard = skill_state_write_guard();
        let skills = db.get_all_installed_skills()?;
        let ssot_dir = Self::get_ssot_dir()?;
        let mut count = 0;

        for skill in skills.values() {
            if skill.content_hash.is_some() {
                continue;
            }
            let Ok(directory) = Self::require_valid_directory(&skill.directory) else {
                log::warn!("跳过非法 directory 的哈希回填: {:?}", skill.directory);
                continue;
            };
            let skill_dir = ssot_dir.join(&directory);
            if !skill_dir.exists() {
                continue;
            }
            match Self::compute_dir_hash(&skill_dir) {
                Ok(hash) => {
                    let _ = db.update_skill_hash(&skill.id, &hash, 0);
                    count += 1;
                }
                Err(e) => {
                    log::warn!("补算哈希失败 {}: {e}", skill.id);
                }
            }
        }

        if count > 0 {
            log::info!("已为 {count} 个 Skill 补算内容哈希");
        }
        Ok(count)
    }

    // ========== Storage migration ==========

    pub(crate) fn rollback_skill_moves(old_dir: &Path, new_dir: &Path, moved: &[String]) {
        for directory in moved {
            let dst = new_dir.join(directory);
            let src = old_dir.join(directory);
            if !dst.exists() {
                continue;
            }
            if src.exists() {
                log::warn!("无法将 {directory} 回滚：源目录和目标目录均已存在");
                continue;
            }
            if fs::rename(&dst, &src).is_err() {
                // 跨文件系统回退为复制：只有复制完整成功才删除 dst；
                // 复制失败（或只拷出部分内容，如旧盘满）时保留 dst——
                // 它可能是该 skill 唯一完整副本，并清理复制产生的残缺 src。
                match Self::copy_dir_recursive(&dst, &src) {
                    Ok(()) => {
                        let _ = fs::remove_dir_all(&dst);
                    }
                    Err(e) => {
                        log::error!(
                            "回滚 Skill {directory} 失败：复制回源目录出错，保留目标目录以免数据丢失: {e}"
                        );
                        let _ = fs::remove_dir_all(&src);
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
    ) -> Result<SkillMigrationOutcome, SkillMigrationFailure> {
        let old_dir = Self::get_ssot_dir().map_err(|e| {
            log::warn!("读取 Skill SSOT 目录失败: {e}");
            SkillMigrationFailure {
                moved: vec![],
                failures: vec!["resolveSourceDir".to_string()],
            }
        })?;
        let new_dir = match target {
            StorageLocation::Hub => config::get_hub_skills_dir(),
            StorageLocation::Unified => config::get_home_dir().join(".agents").join("skills"),
        };
        if let Err(e) = fs::create_dir_all(&new_dir) {
            log::warn!("创建 Skill 迁移目标目录失败: {e}");
            return Err(SkillMigrationFailure {
                moved: vec![],
                failures: vec!["createTargetDir".to_string()],
            });
        }
        if let Err(e) = Self::validate_skill_storage_destination(&new_dir) {
            log::warn!("Skill 迁移目标校验失败: {e}");
            return Err(SkillMigrationFailure {
                moved: vec![],
                failures: vec!["validateDestination".to_string()],
            });
        }

        let skills = match db.get_all_installed_skills() {
            Ok(skills) => skills,
            Err(e) => {
                log::warn!("读取已安装 Skill 列表失败: {e}");
                return Err(SkillMigrationFailure {
                    moved: vec![],
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
        let mut failures = Vec::new();

        for skill in skills.values() {
            let directory = match Self::require_valid_directory(&skill.directory) {
                Ok(directory) => directory,
                Err(err) => {
                    log::warn!("跳过非法 directory 的迁移: {err}");
                    failures.push(skill.directory.escape_debug().to_string());
                    continue;
                }
            };
            let src = old_dir.join(&directory);
            let dst = new_dir.join(&directory);

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
                Err(_) => match Self::copy_dir_recursive(&src, &dst) {
                    Ok(()) => {
                        // 源删除失败视为迁移失败：目标副本已验证完整可删，回滚之。
                        // 若残留旧副本仍计成功，之后迁回会因目标已存在而中止
                        if let Err(e) = fs::remove_dir_all(&src) {
                            log::warn!("迁移 Skill {directory} 失败：源目录删除失败: {e}");
                            if let Err(rollback_error) = fs::remove_dir_all(&dst) {
                                log::error!(
                                    "回滚 Skill 迁移目标副本失败 {}: {rollback_error}",
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
                        log::warn!("迁移 Skill {directory} 失败: {e}");
                        failures.push(directory);
                    }
                },
            }
        }

        if failures.is_empty() {
            Ok(SkillMigrationOutcome { result, moved })
        } else {
            Err(SkillMigrationFailure { moved, failures })
        }
    }

    // ========== Backups ==========

    pub fn list_backups() -> Result<Vec<SkillBackupEntry>, AppError> {
        let backup_dir = Self::get_backup_dir()?;
        let mut entries = Vec::new();

        for entry in fs::read_dir(&backup_dir).map_err(|e| AppError::io(&backup_dir, e))? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    log::warn!("读取 Skill 备份目录项失败: {err}");
                    continue;
                }
            };
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            match Self::read_backup_metadata(&path) {
                Ok(metadata) => entries.push(SkillBackupEntry {
                    backup_id: entry.file_name().to_string_lossy().to_string(),
                    backup_path: path.to_string_lossy().to_string(),
                    created_at: metadata.backup_created_at,
                    skill: metadata.skill,
                }),
                Err(err) => {
                    log::warn!("解析 Skill 备份失败 {}: {err:#}", path.display());
                }
            }
        }

        entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_at));
        Ok(entries)
    }

    pub fn delete_backup(backup_id: &str) -> Result<(), AppError> {
        let backup_path = Self::backup_path_for_id(backup_id)?;
        let metadata =
            fs::symlink_metadata(&backup_path).map_err(|e| AppError::io(&backup_path, e))?;

        if !metadata.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "Skill backup is not a directory: {}",
                backup_path.display()
            )));
        }

        fs::remove_dir_all(&backup_path).map_err(|e| AppError::io(&backup_path, e))?;

        log::info!("Skill 备份已删除: {}", backup_path.display());
        Ok(())
    }

    pub fn restore_from_backup(
        db: &Arc<Database>,
        backup_id: &str,
        // 恢复以备份中记录的启用状态为准；current_app 仅保留以维持命令层签名
        _current_app: &AgentType,
    ) -> Result<InstalledSkill, AppError> {
        let _state_guard = skill_state_write_guard();
        let backup_path = Self::backup_path_for_id(backup_id)?;
        let metadata = Self::read_backup_metadata(&backup_path)?;
        let backup_skill_dir = backup_path.join("skill");
        if !backup_skill_dir.join("SKILL.md").exists() {
            return Err(AppError::InvalidInput(format!(
                "Skill backup is invalid or missing SKILL.md: {}",
                backup_path.display()
            )));
        }

        let existing_skills = db.get_all_installed_skills()?;
        if existing_skills.contains_key(&metadata.skill.id)
            || existing_skills.values().any(|skill| {
                skill
                    .directory
                    .eq_ignore_ascii_case(&metadata.skill.directory)
            })
        {
            return Err(AppError::InvalidInput(format!(
                "Skill already exists, please uninstall the current one first: {}",
                metadata.skill.directory
            )));
        }

        let directory = Self::require_valid_directory(&metadata.skill.directory)?;

        let ssot_dir = Self::get_ssot_dir()?;
        let restore_path = ssot_dir.join(&directory);
        if restore_path.exists() || Self::is_symlink(&restore_path) {
            return Err(AppError::InvalidInput(format!(
                "Restore target already exists: {}",
                restore_path.display()
            )));
        }

        let mut restored_skill = metadata.skill;
        restored_skill.directory = directory;
        restored_skill.installed_at = chrono::Utc::now().timestamp();
        // 保留备份中记录的 apps 启用标志：恢复多 Agent 启用状态，而非仅 UI 当前 Agent
        restored_skill.updated_at = 0;

        Self::copy_dir_recursive(&backup_skill_dir, &restore_path)?;

        restored_skill.content_hash = Self::compute_dir_hash(&restore_path).ok();

        if let Err(err) = db.save_skill(&restored_skill) {
            let _ = fs::remove_dir_all(&restore_path);
            return Err(err);
        }

        // 为所有启用的 Agent 重建投影；任一失败时连同本次已创建的前序投影一并清理
        let mut synced_apps: Vec<AgentType> = Vec::new();
        for app in restored_skill.apps.enabled_apps() {
            if let Err(err) = Self::sync_to_app_dir(&restored_skill.directory, &app) {
                for synced_app in &synced_apps {
                    if let Err(rollback_error) =
                        Self::remove_from_app(&restored_skill.directory, synced_app)
                    {
                        log::error!(
                            "恢复 Skill {} 失败后移除 {} 投影也失败: {rollback_error}",
                            restored_skill.name,
                            synced_app.as_str()
                        );
                    }
                }
                let _ = db.delete_skill(&restored_skill.id);
                let _ = fs::remove_dir_all(&restore_path);
                return Err(err);
            }
            synced_apps.push(app);
        }

        log::info!(
            "Skill {} 已从备份恢复到 {}",
            restored_skill.name,
            restore_path.display()
        );

        Ok(restored_skill)
    }

    // ========== Toggle ==========

    pub fn toggle_app(
        db: &Arc<Database>,
        id: &str,
        app: &AgentType,
        enabled: bool,
    ) -> Result<(), AppError> {
        let _state_guard = skill_state_write_guard();

        let mut skill = db
            .get_installed_skill(id)?
            .ok_or_else(|| AppError::InvalidInput(format!("Skill not found: {id}")))?;

        let was_enabled = skill.apps.is_enabled_for(app);
        skill.apps.set_enabled_for(app, enabled);

        if enabled {
            Self::sync_to_app_dir(&skill.directory, app)?;
        } else {
            Self::remove_from_app(&skill.directory, app)?;
        }

        if let Err(error) = db.update_skill_apps(id, &skill.apps) {
            // 落库失败：撤销刚才的投影变更，恢复到操作前状态；
            // 撤销失败仅记日志，不掩盖原始的落库错误
            if was_enabled != enabled {
                let rollback_result = if enabled {
                    Self::remove_from_app(&skill.directory, app)
                } else {
                    Self::sync_to_app_dir(&skill.directory, app)
                };
                if let Err(rollback_error) = rollback_result {
                    log::error!(
                        "Skill {} 落库失败后撤销 {} 的投影变更也失败: {rollback_error}",
                        skill.name,
                        app.as_str()
                    );
                }
            }
            return Err(error);
        }

        log::info!(
            "Skill {} 的 {} 状态已更新为 {}",
            skill.name,
            app.as_str(),
            enabled
        );

        Ok(())
    }

    // ========== Unmanaged scan & import ==========

    pub fn scan_unmanaged(db: &Arc<Database>) -> Result<Vec<UnmanagedSkill>, AppError> {
        let _state_guard = skill_state_read_guard();
        let managed_skills = db.get_all_installed_skills()?;
        let managed_dirs: HashSet<String> = managed_skills
            .values()
            .map(|s| s.directory.clone())
            .collect();

        let mut scan_sources: Vec<(PathBuf, String)> = Vec::new();
        for app in AgentType::all() {
            if let Ok(d) = Self::get_app_skills_dir(&app) {
                scan_sources.push((d, app.as_str().to_string()));
            }
        }
        if let Some(agents_dir) = get_agents_skills_dir() {
            scan_sources.push((agents_dir, "agents".to_string()));
        }
        if let Ok(ssot_dir) = Self::get_ssot_dir() {
            scan_sources.push((ssot_dir, "hub".to_string()));
        }

        let mut unmanaged: HashMap<(String, String), UnmanagedSkill> = HashMap::new();

        for (scan_dir, label) in &scan_sources {
            let entries = match fs::read_dir(scan_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if dir_name.starts_with('.') || managed_dirs.contains(&dir_name) {
                    continue;
                }

                let skill_md = path.join("SKILL.md");
                if !skill_md.exists() {
                    continue;
                }
                let (name, description) = Self::read_skill_name_desc(&skill_md, &dir_name);

                // 按目录名 + 内容身份归并：内容不同的同名目录是互相独立的发现项，
                // 导入其一不得覆盖其余位置的不同内容；哈希失败时以具体路径兜底，
                // 绝不把无法确认的内容误并为同一份
                let identity = Self::compute_dir_hash(&path).unwrap_or_else(|e| {
                    log::warn!("计算未受管 Skill {} 的内容哈希失败: {e}", path.display());
                    format!("path:{}", path.display())
                });

                unmanaged
                    .entry((dir_name.clone(), identity))
                    .and_modify(|s| s.found_in.push(label.clone()))
                    .or_insert(UnmanagedSkill {
                        directory: dir_name,
                        name,
                        description,
                        found_in: vec![label.clone()],
                        path: path.display().to_string(),
                    });
            }
        }

        Ok(unmanaged.into_values().collect())
    }

    pub fn import_from_apps(
        db: &Arc<Database>,
        imports: Vec<ImportSkillSelection>,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        let _state_guard = skill_state_write_guard();

        // 批次级校验：同一 directory 出现两次时，两个选择映射到同一 SSOT 目标，
        // 后者会静默重导前者内容并覆盖其启用标志——直接拒绝整个批次
        let mut seen_directories: HashMap<String, &str> = HashMap::new();
        for selection in &imports {
            let key = selection.directory.to_lowercase();
            if let Some(conflicting) = seen_directories.insert(key, selection.directory.as_str()) {
                return Err(AppError::Message(format_skill_error(
                    "IMPORT_DUPLICATE_DIRECTORY",
                    &[("directory", conflicting)],
                    None,
                )));
            }
        }

        let ssot_dir = Self::get_ssot_dir()?;
        let agents_lock = parse_agents_lock();
        let mut imported = Vec::new();

        save_repos_from_lock(
            db,
            &agents_lock,
            imports.iter().map(|selection| selection.directory.as_str()),
        );

        let mut search_sources: Vec<(PathBuf, String)> = Vec::new();
        for app in AgentType::all() {
            if let Ok(d) = Self::get_app_skills_dir(&app) {
                search_sources.push((d, app.as_str().to_string()));
            }
        }
        if let Some(agents_dir) = get_agents_skills_dir() {
            search_sources.push((agents_dir, "agents".to_string()));
        }
        search_sources.push((ssot_dir.clone(), "hub".to_string()));

        for selection in imports {
            let dir_name = match Self::require_valid_directory(&selection.directory) {
                Ok(dir_name) => dir_name,
                Err(err) => {
                    log::warn!("跳过导入：{err}");
                    continue;
                }
            };

            let mut source_path: Option<PathBuf> = None;
            // 前端回传发现项的 source_path 时优先精确匹配来源：
            // 同名不同内容的发现项仅按 directory 会错取扫描顺序中的第一个，
            // 导致选第二条却导入第一条、并在投影时覆盖另一来源的内容
            if let Some(hint) = selection.source_path.as_deref() {
                let candidate = PathBuf::from(hint);
                let matches_directory = candidate
                    .file_name()
                    .is_some_and(|name| name == dir_name.as_str());
                if matches_directory && candidate.is_dir() {
                    source_path = Some(candidate);
                } else {
                    log::warn!("导入 '{dir_name}' 的 source_path 无效（{hint}），回退为按目录扫描");
                }
            }
            if source_path.is_none() {
                for (base, label) in &search_sources {
                    let skill_path = base.join(&dir_name);
                    if skill_path.exists() {
                        if source_path.is_none() {
                            source_path = Some(skill_path);
                        }
                        log::debug!("Skill '{dir_name}' found in source '{label}'");
                    }
                }
            }

            let source = match source_path {
                Some(p) => p,
                None => continue,
            };
            if !source.join("SKILL.md").exists() {
                log::warn!(
                    "Skip importing '{}' because source '{}' has no SKILL.md",
                    dir_name,
                    source.display()
                );
                continue;
            }

            let dest = ssot_dir.join(&dir_name);
            // 记录本次是否新建 SSOT 目录：失败回滚时只删本次新建，绝不删除既有内容
            let created_ssot = !dest.exists();
            if created_ssot {
                Self::copy_dir_recursive(&source, &dest)?;
            } else if !Self::paths_alias(&source, &dest) {
                // SSOT 已有未纳管同名内容：落库/投影前比对内容身份。
                // 内容不同则拒绝导入、双方保持不变——否则会跳过复制后从 A
                // 读元数据/hash 落库，并把 A 投影回去覆盖所选来源 B
                let source_hash = Self::compute_dir_hash(&source)?;
                let dest_hash = Self::compute_dir_hash(&dest)?;
                if source_hash != dest_hash {
                    return Err(Self::unmanaged_destination_conflict(&dir_name));
                }
            }

            let skill_md = dest.join("SKILL.md");
            let (name, description) = Self::read_skill_name_desc(&skill_md, &dir_name);

            let (id, repo_owner, repo_name, repo_branch, readme_url) =
                build_repo_info_from_lock(&agents_lock, &dir_name);

            let ssot_skill_dir = ssot_dir.join(&dir_name);
            let content_hash = Self::compute_dir_hash(&ssot_skill_dir).ok();

            let skill = InstalledSkill {
                id,
                name,
                description,
                directory: dir_name,
                repo_owner,
                repo_name,
                repo_branch,
                readme_url,
                apps: selection.apps,
                installed_at: chrono::Utc::now().timestamp(),
                content_hash,
                updated_at: 0,
            };

            if let Err(e) = db.save_skill(&skill) {
                if created_ssot {
                    if let Err(rollback_error) = fs::remove_dir_all(&dest) {
                        log::error!(
                            "导入 Skill {} 落库失败，且回滚本次新建的 SSOT 目录也失败: {rollback_error}",
                            skill.id
                        );
                    }
                }
                return Err(e);
            }

            // 记录本次导入已成功的投影及其同步前快照：任一 Agent 同步失败时，
            // 只删除调用前不存在的投影；调用前已存在的内容（可能是用户的原始
            // 未托管来源本身）从快照恢复，绝不因回滚而丢失
            let mut synced_apps: Vec<ProjectionSnapshot> = Vec::new();
            for app in skill.apps.enabled_apps() {
                let app_dir = Self::get_app_skills_dir(&app)?;
                let target = app_dir.join(&skill.directory);
                let snapshot = Self::snapshot_projection_target(&target)?;
                if let Err(e) = Self::sync_to_app_dir(&skill.directory, &app) {
                    // 先恢复本次同步失败的 Agent 的现场（同步可能已破坏其原目标），
                    // 再回滚前序已成功的 Agent
                    Self::restore_projection_target(&target, snapshot.as_ref());
                    for synced in &synced_apps {
                        if let Err(rollback_error) =
                            Self::remove_from_app(&skill.directory, &synced.app)
                        {
                            log::error!(
                                "导入 Skill {} 后同步失败，且移除 {} 投影也失败: {rollback_error}",
                                skill.id,
                                synced.app.as_str()
                            );
                        }
                        Self::restore_projection_target(&synced.target, synced.snapshot.as_ref());
                    }
                    if let Err(rollback_error) = db.delete_skill(&skill.id) {
                        log::error!(
                            "导入 Skill {} 后同步失败，且回滚数据库记录也失败: {rollback_error}",
                            skill.id
                        );
                    }
                    if created_ssot {
                        if let Err(rollback_error) = fs::remove_dir_all(&dest) {
                            log::error!(
                                "导入 Skill {} 后同步失败，且回滚本次新建的 SSOT 目录也失败: {rollback_error}",
                                skill.id
                            );
                        }
                    }
                    return Err(e);
                }
                synced_apps.push(ProjectionSnapshot {
                    app,
                    target,
                    snapshot,
                });
            }

            imported.push(skill);
        }

        log::info!("成功导入 {} 个 Skills", imported.len());

        Ok(imported)
    }

    /// 同步前快照投影目标：目标已存在（用户自有内容，或本次导入的来源本身）时
    /// 先复制到临时目录，供失败回滚恢复；不存在则无需快照。
    fn snapshot_projection_target(
        target: &Path,
    ) -> Result<Option<(tempfile::TempDir, PathBuf)>, AppError> {
        if !target.exists() && !Self::is_symlink(target) {
            return Ok(None);
        }
        let guard = tempfile::tempdir().map_err(|e| AppError::io(target, e))?;
        let snapshot = guard.path().join("snapshot");
        Self::copy_dir_recursive(target, &snapshot)?;
        Ok(Some((guard, snapshot)))
    }

    /// 最佳努力恢复同步前的投影目标内容。
    fn restore_projection_target(target: &Path, snapshot: Option<&(tempfile::TempDir, PathBuf)>) {
        let Some((_, snapshot_dir)) = snapshot else {
            return;
        };
        if target.exists() || Self::is_symlink(target) {
            if let Err(e) = Self::remove_path(target) {
                log::error!("回滚投影目标失败 {}: {e}", target.display());
            }
        }
        if let Err(e) = Self::copy_dir_recursive(snapshot_dir, target) {
            log::error!("恢复投影目标快照失败 {}: {e}", target.display());
        }
    }

    // ========== File sync methods ==========

    #[cfg(unix)]
    pub(crate) fn create_symlink(src: &Path, dest: &Path, _is_file: bool) -> Result<(), AppError> {
        std::os::unix::fs::symlink(src, dest).map_err(|e| AppError::IoContext {
            context: format!("创建符号链接失败: {} -> {}", src.display(), dest.display()),
            source: e,
        })
    }

    #[cfg(windows)]
    pub(crate) fn create_symlink(src: &Path, dest: &Path, is_file: bool) -> Result<(), AppError> {
        let result = if is_file {
            std::os::windows::fs::symlink_file(src, dest)
        } else {
            std::os::windows::fs::symlink_dir(src, dest)
        };
        result.map_err(|e| AppError::IoContext {
            context: format!("创建符号链接失败: {} -> {}", src.display(), dest.display()),
            source: e,
        })
    }

    pub(crate) fn is_symlink(path: &Path) -> bool {
        path.symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
    }

    pub(crate) fn get_sync_method() -> SyncMethod {
        get_settings().sync_method
    }

    pub fn sync_to_app_dir(directory: &str, app: &AgentType) -> Result<(), AppError> {
        let directory = Self::require_valid_directory(directory)?;

        let ssot_dir = Self::get_ssot_dir()?;
        let source = ssot_dir.join(&directory);

        Self::validate_sync_source_dir(&source, &directory)?;

        let app_dir = Self::get_distinct_app_skills_dir(&ssot_dir, app)?;
        fs::create_dir_all(&app_dir).map_err(|e| AppError::io(&app_dir, e))?;

        let dest = app_dir.join(&directory);

        let sync_method = Self::get_sync_method();

        match sync_method {
            SyncMethod::Auto => {
                if dest.exists() && !Self::is_symlink(&dest) {
                    Self::replace_dest_with_copy(&source, &dest, &directory)?;
                    log::debug!("Skill {directory} 已通过复制同步到 {}", app.as_str());
                    return Ok(());
                }

                if Self::is_symlink(&dest) {
                    Self::remove_path(&dest)?;
                }

                match Self::create_symlink(&source, &dest, false) {
                    Ok(()) => {
                        log::debug!("Skill {directory} 已通过 symlink 同步到 {}", app.as_str());
                        return Ok(());
                    }
                    Err(err) => {
                        log::warn!(
                            "Symlink 创建失败，将回退到文件复制: {} -> {}. 错误: {err:#}",
                            source.display(),
                            dest.display()
                        );
                    }
                }
                Self::replace_dest_with_copy(&source, &dest, &directory)?;
                log::debug!("Skill {directory} 已通过复制同步到 {}", app.as_str());
            }
            SyncMethod::Symlink => {
                if dest.exists() || Self::is_symlink(&dest) {
                    Self::remove_path(&dest)?;
                }
                Self::create_symlink(&source, &dest, false)?;
                log::debug!("Skill {directory} 已通过 symlink 同步到 {}", app.as_str());
            }
            SyncMethod::Copy => {
                Self::replace_dest_with_copy(&source, &dest, &directory)?;
                log::debug!("Skill {directory} 已通过复制同步到 {}", app.as_str());
            }
        }

        Ok(())
    }

    pub(crate) fn remove_path(path: &Path) -> Result<(), AppError> {
        if Self::is_symlink(path) {
            #[cfg(unix)]
            fs::remove_file(path).map_err(|e| AppError::io(path, e))?;
            #[cfg(windows)]
            fs::remove_dir(path).map_err(|e| AppError::io(path, e))?;
        } else if path.is_dir() {
            fs::remove_dir_all(path).map_err(|e| AppError::io(path, e))?;
        } else if path.exists() {
            fs::remove_file(path).map_err(|e| AppError::io(path, e))?;
        }
        Ok(())
    }

    fn validate_sync_source_dir(source: &Path, directory: &str) -> Result<(), AppError> {
        if !source.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "Skill 不存在于 SSOT: {directory}"
            )));
        }

        let manifest = source.join("SKILL.md");
        if !manifest.is_file() {
            return Err(AppError::InvalidInput(format!(
                "Skill 源目录缺少 SKILL.md，拒绝同步以避免覆盖目标目录: {}",
                source.display()
            )));
        }

        Ok(())
    }

    fn replace_dest_with_copy(source: &Path, dest: &Path, directory: &str) -> Result<(), AppError> {
        Self::validate_sync_source_dir(source, directory)?;

        let parent = dest.parent().ok_or_else(|| {
            AppError::InvalidInput(format!("Invalid skill destination: {}", dest.display()))
        })?;
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp_name = Self::sanitize_backup_segment(directory);
        let tmp = parent.join(format!(".{tmp_name}.tmp-{}-{nonce}", std::process::id()));

        if tmp.exists() || Self::is_symlink(&tmp) {
            Self::remove_path(&tmp)?;
        }

        let copy_result = Self::copy_dir_recursive(source, &tmp);
        if let Err(err) = copy_result {
            let _ = Self::remove_path(&tmp);
            return Err(err);
        }

        if dest.exists() || Self::is_symlink(dest) {
            Self::remove_path(dest)?;
        }

        fs::rename(&tmp, dest).map_err(|e| {
            let _ = Self::remove_path(&tmp);
            AppError::IoContext {
                context: format!(
                    "替换 Skill 目录失败: {} -> {}",
                    tmp.display(),
                    dest.display()
                ),
                source: e,
            }
        })?;

        Ok(())
    }

    fn is_symlink_to_ssot(path: &Path, ssot_dir: &Path) -> bool {
        if !Self::is_symlink(path) {
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

    pub fn remove_from_app(directory: &str, app: &AgentType) -> Result<(), AppError> {
        let directory = Self::require_valid_directory(directory)?;

        let ssot_dir = Self::get_ssot_dir()?;
        let app_dir = Self::get_distinct_app_skills_dir(&ssot_dir, app)?;
        let skill_path = app_dir.join(&directory);

        if skill_path.exists() || Self::is_symlink(&skill_path) {
            Self::remove_path(&skill_path)?;
            log::debug!("Skill {directory} 已从 {} 删除", app.as_str());
        }

        Ok(())
    }

    pub fn sync_to_app(db: &Arc<Database>, app: &AgentType) -> Result<(), AppError> {
        let _state_guard = skill_state_read_guard();
        Self::sync_to_app_unlocked(db, app)
    }

    pub(crate) fn sync_to_app_unlocked(
        db: &Arc<Database>,
        app: &AgentType,
    ) -> Result<(), AppError> {
        let skills = db.get_all_installed_skills()?;
        let ssot_dir = Self::get_ssot_dir()?;
        let app_dir = Self::get_distinct_app_skills_dir(&ssot_dir, app)?;

        let indexed_skills: HashMap<String, &InstalledSkill> = skills
            .values()
            .map(|skill| (skill.directory.to_lowercase(), skill))
            .collect();

        if app_dir.exists() {
            for entry in fs::read_dir(&app_dir).map_err(|e| AppError::io(&app_dir, e))? {
                let entry = entry.map_err(|e| AppError::io(&app_dir, e))?;
                let path = entry.path();
                let dir_name = entry.file_name().to_string_lossy().to_string();

                if dir_name.starts_with('.') {
                    continue;
                }

                if let Some(skill) = indexed_skills.get(&dir_name.to_lowercase()) {
                    if !skill.apps.is_enabled_for(app) {
                        Self::remove_path(&path)?;
                    }
                    continue;
                }

                if Self::is_symlink_to_ssot(&path, &ssot_dir) {
                    Self::remove_path(&path)?;
                }
            }
        }

        let mut sync_failures: Vec<String> = Vec::new();
        for skill in skills.values() {
            if skill.apps.is_enabled_for(app) {
                if let Err(err) = Self::sync_to_app_dir(&skill.directory, app) {
                    log::warn!(
                        "同步 skill {} 到 {} 失败: {err}",
                        skill.directory,
                        app.as_str()
                    );
                    sync_failures.push(skill.directory.clone());
                }
            }
        }

        if !sync_failures.is_empty() {
            return Err(AppError::Message(format_skill_error(
                "PROJECTION_SYNC_FAILED",
                &[("app", app.as_str()), ("items", &sync_failures.join(", "))],
                Some("checkPermission"),
            )));
        }

        Ok(())
    }

    // ========== Discovery ==========

    pub async fn discover_available(
        &self,
        repos: Vec<SkillRepo>,
    ) -> Result<Vec<DiscoverableSkill>, AppError> {
        let mut skills = Vec::new();

        let enabled_repos: Vec<SkillRepo> = repos.into_iter().filter(|repo| repo.enabled).collect();

        let fetch_tasks = enabled_repos
            .iter()
            .map(|repo| self.fetch_repo_skills(repo));

        let results: Vec<Result<Vec<DiscoverableSkill>, AppError>> =
            futures::future::join_all(fetch_tasks).await;

        for (repo, result) in enabled_repos.into_iter().zip(results) {
            match result {
                Ok(repo_skills) => skills.extend(repo_skills),
                Err(e) => log::warn!("获取仓库 {}/{} 技能失败: {}", repo.owner, repo.name, e),
            }
        }

        Self::deduplicate_discoverable_skills(&mut skills);
        skills.sort_by_key(|skill| skill.name.to_lowercase());

        Ok(skills)
    }

    async fn fetch_repo_skills(
        &self,
        repo: &SkillRepo,
    ) -> Result<Vec<DiscoverableSkill>, AppError> {
        let client = self.download_client();
        let (temp_guard, resolved_branch) = Self::download_repo_with_timeout(&client, repo).await?;

        let mut skills = Vec::new();
        let scan_dir = temp_guard.path();
        let mut resolved_repo = repo.clone();
        resolved_repo.branch = resolved_branch;
        Self::scan_dir_recursive_static(scan_dir, scan_dir, &resolved_repo, &mut skills)?;

        Ok(skills)
    }

    fn scan_dir_recursive_static(
        current_dir: &Path,
        base_dir: &Path,
        repo: &SkillRepo,
        skills: &mut Vec<DiscoverableSkill>,
    ) -> Result<(), AppError> {
        let skill_md = current_dir.join("SKILL.md");

        if skill_md.exists() {
            let directory = if current_dir == base_dir {
                repo.name.clone()
            } else {
                current_dir
                    .strip_prefix(base_dir)
                    .unwrap_or(current_dir)
                    .to_string_lossy()
                    .replace('\\', "/")
            };

            let doc_path = skill_md
                .strip_prefix(base_dir)
                .unwrap_or(skill_md.as_path())
                .to_string_lossy()
                .replace('\\', "/");

            if let Ok(skill) =
                Self::build_skill_from_metadata(&skill_md, &directory, &doc_path, repo)
            {
                skills.push(skill);
            }

            return Ok(());
        }

        for entry in fs::read_dir(current_dir).map_err(|e| AppError::io(current_dir, e))? {
            let entry = entry.map_err(|e| AppError::io(current_dir, e))?;
            let path = entry.path();

            if path.is_dir() {
                Self::scan_dir_recursive_static(&path, base_dir, repo, skills)?;
            }
        }

        Ok(())
    }

    fn build_skill_from_metadata(
        skill_md: &Path,
        directory: &str,
        doc_path: &str,
        repo: &SkillRepo,
    ) -> Result<DiscoverableSkill, AppError> {
        let meta = Self::parse_skill_metadata_static(skill_md)?;

        Ok(DiscoverableSkill {
            key: format!("{}/{}:{}", repo.owner, repo.name, directory),
            name: meta.name.unwrap_or_else(|| directory.to_string()),
            description: meta.description.unwrap_or_default(),
            directory: directory.to_string(),
            readme_url: Self::build_skill_doc_url(&repo.owner, &repo.name, &repo.branch, doc_path),
            repo_owner: repo.owner.clone(),
            repo_name: repo.name.clone(),
            repo_branch: repo.branch.clone(),
        })
    }

    pub(crate) fn parse_skill_metadata_static(path: &Path) -> Result<SkillMetadata, AppError> {
        let content = fs::read_to_string(path).map_err(|e| AppError::io(path, e))?;
        let content = content.trim_start_matches('\u{feff}');

        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() < 3 {
            return Ok(SkillMetadata {
                name: None,
                description: None,
            });
        }

        let front_matter = parts[1].trim();
        let meta: SkillMetadata = serde_yaml::from_str(front_matter).unwrap_or(SkillMetadata {
            name: None,
            description: None,
        });

        Ok(meta)
    }

    fn read_skill_name_desc(skill_md: &Path, fallback_name: &str) -> (String, Option<String>) {
        if skill_md.exists() {
            match Self::parse_skill_metadata_static(skill_md) {
                Ok(meta) => (
                    meta.name.unwrap_or_else(|| fallback_name.to_string()),
                    meta.description,
                ),
                Err(_) => (fallback_name.to_string(), None),
            }
        } else {
            (fallback_name.to_string(), None)
        }
    }

    fn deduplicate_discoverable_skills(skills: &mut Vec<DiscoverableSkill>) {
        let mut seen = HashMap::new();
        skills.retain(|skill| {
            let unique_key = skill.key.to_lowercase();
            if let std::collections::hash_map::Entry::Vacant(e) = seen.entry(unique_key) {
                e.insert(true);
                true
            } else {
                false
            }
        });
    }

    // ========== Validation & sanitization ==========

    fn sanitize_skill_source_path(raw: &str) -> Option<PathBuf> {
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

    pub(crate) fn sanitize_install_name(raw: &str) -> Option<String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }

        if trimmed.contains('/') || trimmed.contains('\\') {
            return None;
        }

        let path = Path::new(trimmed);
        let mut components = path.components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) => {
                let normalized = name.to_string_lossy().trim().to_string();
                if normalized.is_empty()
                    || normalized == "."
                    || normalized == ".."
                    || normalized.starts_with('.')
                {
                    None
                } else {
                    Some(normalized)
                }
            }
            _ => None,
        }
    }

    pub(crate) fn require_valid_directory(directory: &str) -> Result<String, AppError> {
        match Self::sanitize_install_name(directory) {
            Some(normalized) if normalized == directory => Ok(normalized),
            _ => Err(AppError::InvalidInput(format!(
                "Invalid skill directory (possible path traversal): {directory:?}"
            ))),
        }
    }

    fn is_valid_github_owner(owner: &str) -> bool {
        !owner.is_empty()
            && owner.len() <= 39
            && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    }

    fn is_valid_github_repo_name(name: &str) -> bool {
        !name.is_empty()
            && name.len() <= 100
            && name != "."
            && name != ".."
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    }

    fn is_valid_git_branch(branch: &str) -> bool {
        if branch.is_empty() || branch.eq_ignore_ascii_case("HEAD") {
            return true;
        }
        if branch.len() > 255 {
            return false;
        }
        if branch.starts_with('/') || branch.ends_with('/') || branch.contains("//") {
            return false;
        }
        if branch.contains("@{") {
            return false;
        }
        if branch
            .chars()
            .any(|c| c.is_ascii_control() || " ~^:?*[\\#%".contains(c))
        {
            return false;
        }
        branch.split('/').all(|segment| {
            !segment.is_empty()
                && !segment.starts_with('.')
                && !segment.ends_with('.')
                && !segment.ends_with(".lock")
        })
    }

    pub(crate) fn validate_repo_ref(owner: &str, name: &str, branch: &str) -> Result<(), AppError> {
        if !Self::is_valid_github_owner(owner) || !Self::is_valid_github_repo_name(name) {
            return Err(AppError::Message(format_skill_error(
                "INVALID_REPO_REF",
                &[("owner", owner), ("name", name)],
                Some("checkRepoUrl"),
            )));
        }
        if !Self::is_valid_git_branch(branch) {
            return Err(AppError::Message(format_skill_error(
                "INVALID_REPO_REF",
                &[("owner", owner), ("name", name), ("branch", branch)],
                Some("checkRepoUrl"),
            )));
        }
        Ok(())
    }

    pub(crate) fn assert_github_archive_url(
        url: &str,
        owner: &str,
        name: &str,
    ) -> Result<(), AppError> {
        let parsed = url::Url::parse(url)
            .map_err(|e| AppError::InvalidInput(format!("Invalid archive URL: {e}")))?;
        let expected_prefix = format!("/{owner}/{name}/archive/refs/heads/");
        if parsed.scheme() != "https"
            || parsed.host_str() != Some("github.com")
            || !parsed.path().starts_with(&expected_prefix)
        {
            return Err(AppError::Message(format_skill_error(
                "INVALID_REPO_REF",
                &[("owner", owner), ("name", name)],
                Some("checkRepoUrl"),
            )));
        }
        Ok(())
    }

    fn find_skill_dir_by_name(root: &Path, target_name: &str) -> Option<PathBuf> {
        fn walk(dir: &Path, target: &str, depth: usize) -> Option<PathBuf> {
            if depth > 3 {
                return None;
            }
            let entries = fs::read_dir(dir).ok()?;
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with('.') {
                    continue;
                }
                if name_str.eq_ignore_ascii_case(target) && path.join("SKILL.md").exists() {
                    return Some(path);
                }
                if let Some(found) = walk(&path, target, depth + 1) {
                    return Some(found);
                }
            }
            None
        }
        walk(root, target_name, 0)
    }

    fn resolve_skill_source_dir(root: &Path, raw_directory: &str) -> Option<PathBuf> {
        let source_rel = Self::sanitize_skill_source_path(raw_directory)?;
        let install_name = source_rel
            .file_name()
            .map(|n| n.to_string_lossy().to_string())?;

        let direct = root.join(&source_rel);
        if direct.is_dir() && direct.join("SKILL.md").is_file() {
            return Some(direct);
        }

        if let Some(found) = Self::find_skill_dir_by_name(root, &install_name) {
            log::info!(
                "Skill directory '{}' not found at direct path, using fallback: {}",
                install_name,
                found.display()
            );
            return Some(found);
        }

        if root.join("SKILL.md").is_file() {
            log::info!(
                "Skill directory '{}' not found, but SKILL.md exists at root, using repo root",
                install_name,
            );
            return Some(root.to_path_buf());
        }

        None
    }

    fn doc_path_for_source(repo_root: &Path, source: &Path) -> Option<String> {
        let rel = source.strip_prefix(repo_root).ok()?;
        let mut parts: Vec<String> = rel
            .components()
            .filter_map(|component| match component {
                Component::Normal(part) => Some(part.to_string_lossy().to_string()),
                _ => None,
            })
            .collect();
        parts.push("SKILL.md".to_string());
        Some(parts.join("/"))
    }

    fn choose_doc_path(
        resolved_source_doc_path: Option<String>,
        readme_url: Option<&str>,
        directory: &str,
    ) -> String {
        if let Some(path) = resolved_source_doc_path {
            return path;
        }
        if let Some(path) = readme_url.and_then(Self::extract_doc_path_from_url) {
            if path.ends_with("/SKILL.md") || path == "SKILL.md" {
                return path;
            }
            return format!("{}/SKILL.md", path.trim_end_matches('/'));
        }
        format!("{}/SKILL.md", directory.trim_end_matches('/'))
    }

    // ========== Download ==========

    pub(crate) fn download_client(&self) -> reqwest::Client {
        reqwest::Client::new()
    }

    pub(crate) async fn download_repo_with_timeout(
        client: &reqwest::Client,
        repo: &SkillRepo,
    ) -> Result<(tempfile::TempDir, String), AppError> {
        match tokio::time::timeout(
            std::time::Duration::from_secs(60),
            Self::download_repo(client, repo),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AppError::Message(format_skill_error(
                "DOWNLOAD_TIMEOUT",
                &[
                    ("owner", &repo.owner),
                    ("name", &repo.name),
                    ("timeout", "60"),
                ],
                Some("checkNetwork"),
            ))),
        }
    }

    pub(crate) async fn download_repo(
        client: &reqwest::Client,
        repo: &SkillRepo,
    ) -> Result<(tempfile::TempDir, String), AppError> {
        Self::validate_repo_ref(&repo.owner, &repo.name, &repo.branch)?;

        let temp_dir = tempfile::tempdir()?;
        let temp_path = temp_dir.path().to_path_buf();

        let mut branches = Vec::new();
        if !repo.branch.is_empty() && !repo.branch.eq_ignore_ascii_case("HEAD") {
            branches.push(repo.branch.as_str());
        }
        if !branches.contains(&"main") {
            branches.push("main");
        }
        if !branches.contains(&"master") {
            branches.push("master");
        }

        let mut last_error = None;
        for branch in branches {
            let url = format!(
                "https://github.com/{}/{}/archive/refs/heads/{}.zip",
                repo.owner, repo.name, branch
            );
            Self::assert_github_archive_url(&url, &repo.owner, &repo.name)?;

            match Self::download_and_extract(client, &url, &temp_path).await {
                Ok(_) => return Ok((temp_dir, branch.to_string())),
                Err(e) => {
                    let _ = fs::remove_dir_all(&temp_path);
                    let _ = fs::create_dir_all(&temp_path);
                    last_error = Some(e);
                    continue;
                }
            }
        }

        Err(last_error.unwrap_or_else(|| AppError::InvalidInput("所有分支下载失败".to_string())))
    }

    pub(crate) async fn download_and_extract(
        client: &reqwest::Client,
        url: &str,
        dest: &Path,
    ) -> Result<(), AppError> {
        let response = client.get(url).send().await.map_err(|e| {
            AppError::Message(format_skill_error(
                "DOWNLOAD_FAILED",
                &[("url", url), ("error", &e.to_string())],
                Some("checkNetwork"),
            ))
        })?;
        if !response.status().is_success() {
            let status = response.status().as_u16().to_string();
            return Err(AppError::Message(format_skill_error(
                "DOWNLOAD_FAILED",
                &[("status", &status)],
                match status.as_str() {
                    "403" => Some("http403"),
                    "404" => Some("http404"),
                    "429" => Some("http429"),
                    _ => Some("checkNetwork"),
                },
            )));
        }

        let mut response = response;
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| AppError::Message(e.to_string()))?
        {
            if body.len().saturating_add(chunk.len()) as u64 > MAX_ARCHIVE_DOWNLOAD_BYTES {
                let limit_mb = (MAX_ARCHIVE_DOWNLOAD_BYTES / 1024 / 1024).to_string();
                return Err(AppError::Message(format_skill_error(
                    "ARCHIVE_TOO_LARGE",
                    &[("limit_mb", &limit_mb)],
                    Some("checkZipContent"),
                )));
            }
            body.extend_from_slice(&chunk);
        }

        let cursor = std::io::Cursor::new(body);
        let archive = zip::ZipArchive::new(cursor)
            .map_err(|e| AppError::InvalidInput(format!("Failed to read ZIP archive: {e}")))?;
        Self::extract_repo_archive(archive, dest)
    }

    // ========== Archive extraction ==========

    fn copy_entry_within_budget<R: std::io::Read, W: std::io::Write>(
        reader: &mut R,
        writer: &mut W,
        total_bytes: &mut u64,
    ) -> Result<(), AppError> {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|e| AppError::Message(e.to_string()))?;
            if read == 0 {
                return Ok(());
            }
            Self::charge_archive_budget(total_bytes, read as u64)?;
            writer
                .write_all(&buffer[..read])
                .map_err(|e| AppError::Message(e.to_string()))?;
        }
    }

    fn read_symlink_target<R: std::io::Read>(
        reader: &mut R,
        total_bytes: &mut u64,
    ) -> Result<Option<String>, AppError> {
        let mut raw = Vec::new();
        let mut limited = std::io::Read::take(reader, MAX_SYMLINK_TARGET_BYTES + 1);
        limited
            .read_to_end(&mut raw)
            .map_err(|e| AppError::Message(e.to_string()))?;
        if raw.len() as u64 > MAX_SYMLINK_TARGET_BYTES {
            return Ok(None);
        }
        Self::charge_archive_budget(total_bytes, raw.len() as u64)?;
        Ok(String::from_utf8(raw)
            .ok()
            .map(|target| target.trim().to_string()))
    }

    fn create_dir_all_within_budget(path: &Path, total_bytes: &mut u64) -> Result<(), AppError> {
        let missing = path.ancestors().take_while(|p| !p.exists()).count() as u64;
        if missing > 0 {
            Self::charge_archive_budget(total_bytes, missing * DIRECTORY_BUDGET_COST)?;
        }
        fs::create_dir_all(path).map_err(|e| AppError::io(path, e))
    }

    fn charge_archive_budget(total_bytes: &mut u64, amount: u64) -> Result<(), AppError> {
        if total_bytes.saturating_add(amount) > MAX_ARCHIVE_TOTAL_BYTES {
            let limit_mb = (MAX_ARCHIVE_TOTAL_BYTES / 1024 / 1024).to_string();
            return Err(AppError::Message(format_skill_error(
                "ARCHIVE_TOO_LARGE",
                &[("limit_mb", &limit_mb)],
                Some("checkZipContent"),
            )));
        }
        *total_bytes += amount;
        Ok(())
    }

    pub(crate) fn extract_repo_archive<R: std::io::Read + std::io::Seek>(
        mut archive: zip::ZipArchive<R>,
        dest: &Path,
    ) -> Result<(), AppError> {
        let root_name = if !archive.is_empty() {
            let first_file = archive
                .by_index(0)
                .map_err(|e| AppError::Message(e.to_string()))?;
            let name = first_file.name();
            name.split('/').next().unwrap_or("").to_string()
        } else {
            return Err(AppError::Message(format_skill_error(
                "EMPTY_ARCHIVE",
                &[],
                Some("checkRepoUrl"),
            )));
        };

        if archive.len() > MAX_ARCHIVE_ENTRIES {
            let count = archive.len().to_string();
            let limit = MAX_ARCHIVE_ENTRIES.to_string();
            return Err(AppError::Message(format_skill_error(
                "ARCHIVE_TOO_MANY_ENTRIES",
                &[("count", &count), ("limit", &limit)],
                Some("checkZipContent"),
            )));
        }
        let mut total_bytes: u64 = 0;

        let mut symlinks: Vec<(PathBuf, String)> = Vec::new();

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::Message(e.to_string()))?;
            let Some(safe_path) = file.enclosed_name() else {
                log::warn!("跳过不安全的压缩包条目: {}", file.name());
                continue;
            };

            let Ok(relative_path) = safe_path.strip_prefix(&root_name) else {
                continue;
            };

            if relative_path
                .components()
                .any(|c| matches!(c, Component::ParentDir))
            {
                log::warn!("跳过越界的压缩包条目: {}", file.name());
                continue;
            }

            if relative_path.as_os_str().is_empty() {
                continue;
            }

            let outpath = dest.join(relative_path);

            if file.is_symlink() {
                let Some(target) = Self::read_symlink_target(&mut file, &mut total_bytes)? else {
                    log::warn!("跳过目标不合法的 symlink 条目: {}", file.name());
                    continue;
                };
                symlinks.push((outpath, target));
            } else if file.is_dir() {
                Self::create_dir_all_within_budget(&outpath, &mut total_bytes)?;
            } else {
                if let Some(parent) = outpath.parent() {
                    Self::create_dir_all_within_budget(parent, &mut total_bytes)?;
                }
                let mut outfile =
                    fs::File::create(&outpath).map_err(|e| AppError::io(&outpath, e))?;
                Self::copy_entry_within_budget(&mut file, &mut outfile, &mut total_bytes)?;
            }
        }

        Self::resolve_symlinks_in_dir(dest, &symlinks, &mut total_bytes)?;

        Ok(())
    }

    fn copy_dir_within_budget(
        src: &Path,
        dest: &Path,
        total_bytes: &mut u64,
    ) -> Result<(), AppError> {
        Self::create_dir_all_within_budget(dest, total_bytes)?;

        for entry in fs::read_dir(src).map_err(|e| AppError::io(src, e))? {
            let entry = entry.map_err(|e| AppError::io(src, e))?;
            let path = entry.path();
            let dest_path = dest.join(entry.file_name());

            if path.is_dir() {
                Self::copy_dir_within_budget(&path, &dest_path, total_bytes)?;
            } else {
                Self::copy_file_within_budget(&path, &dest_path, total_bytes)?;
            }
        }

        Ok(())
    }

    fn copy_file_within_budget(
        src: &Path,
        dest: &Path,
        total_bytes: &mut u64,
    ) -> Result<(), AppError> {
        let mut reader = fs::File::open(src).map_err(|e| AppError::io(src, e))?;
        let mut writer = fs::File::create(dest).map_err(|e| AppError::io(dest, e))?;
        Self::copy_entry_within_budget(&mut reader, &mut writer, total_bytes)
    }

    pub(crate) fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), AppError> {
        fs::create_dir_all(dest).map_err(|e| AppError::io(dest, e))?;

        for entry in fs::read_dir(src).map_err(|e| AppError::io(src, e))? {
            let entry = entry.map_err(|e| AppError::io(src, e))?;
            let path = entry.path();
            let dest_path = dest.join(entry.file_name());

            if path.is_dir() {
                Self::copy_dir_recursive(&path, &dest_path)?;
            } else {
                fs::copy(&path, &dest_path).map_err(|e| AppError::io(&dest_path, e))?;
            }
        }

        Ok(())
    }

    pub(crate) fn resolve_symlinks_in_dir(
        base_dir: &Path,
        symlinks: &[(PathBuf, String)],
        total_bytes: &mut u64,
    ) -> Result<(), AppError> {
        let canonical_base = base_dir
            .canonicalize()
            .unwrap_or_else(|_| base_dir.to_path_buf());

        for (link_path, target) in symlinks {
            let parent = link_path.parent().unwrap_or(base_dir);
            let resolved = parent.join(target);

            let resolved = match resolved.canonicalize() {
                Ok(p) => p,
                Err(_) => {
                    log::warn!(
                        "Symlink 目标不存在，跳过: {} -> {}",
                        link_path.display(),
                        target
                    );
                    continue;
                }
            };

            if !resolved.starts_with(&canonical_base) {
                log::warn!(
                    "Symlink 目标超出仓库范围，跳过: {} -> {}",
                    link_path.display(),
                    resolved.display()
                );
                continue;
            }

            let canonical_link = match parent.canonicalize() {
                Ok(canonical_parent) => match link_path.file_name() {
                    Some(name) => canonical_parent.join(name),
                    None => canonical_parent,
                },
                Err(_) => match link_path.strip_prefix(base_dir) {
                    Ok(relative) => canonical_base.join(relative),
                    Err(_) => link_path.clone(),
                },
            };
            if canonical_link.starts_with(&resolved) {
                log::warn!(
                    "Symlink 目标包含链接自身，跳过（会导致递归自复制）: {} -> {}",
                    link_path.display(),
                    resolved.display()
                );
                continue;
            }

            if resolved.is_dir() {
                Self::copy_dir_within_budget(&resolved, link_path, total_bytes)?;
            } else if resolved.is_file() {
                if let Some(parent) = link_path.parent() {
                    Self::create_dir_all_within_budget(parent, total_bytes)?;
                }
                Self::copy_file_within_budget(&resolved, link_path, total_bytes)?;
            }
        }
        Ok(())
    }

    // ========== ZIP install ==========

    pub fn install_from_zip(
        db: &Arc<Database>,
        zip_path: &Path,
        current_app: &AgentType,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        let temp_guard = Self::extract_local_zip(zip_path)?;
        let temp_dir = temp_guard.path();

        let skill_dirs = Self::scan_skills_in_dir(temp_dir)?;

        if skill_dirs.is_empty() {
            return Err(AppError::Message(format_skill_error(
                "NO_SKILLS_IN_ZIP",
                &[],
                Some("checkZipContent"),
            )));
        }

        let _state_guard = skill_state_write_guard();
        let ssot_dir = Self::get_ssot_dir()?;
        let mut installed = Vec::new();
        let existing_skills = db.get_all_installed_skills()?;
        let zip_stem = zip_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());

        // 预扫描：计算每个条目的最终安装名，先检测批内/磁盘冲突再落盘，
        // 冲突时整个批次不产生任何 SSOT/投影变更。
        struct ZipEntry {
            skill_dir: PathBuf,
            meta: Option<SkillMetadata>,
            install_name: String,
        }
        let mut entries: Vec<ZipEntry> = Vec::new();
        let mut claimed_names: HashSet<String> = HashSet::new();

        for skill_dir in skill_dirs {
            let skill_md = skill_dir.join("SKILL.md");
            let meta = if skill_md.exists() {
                Self::parse_skill_metadata_static(&skill_md).ok()
            } else {
                None
            };

            let install_name = {
                let dir_name = skill_dir
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

                if skill_dir.as_path() == temp_dir
                    || dir_name.is_empty()
                    || dir_name.starts_with('.')
                {
                    meta.as_ref()
                        .and_then(|m| m.name.as_deref())
                        .and_then(Self::sanitize_install_name)
                        .or_else(|| zip_stem.as_deref().and_then(Self::sanitize_install_name))
                } else {
                    Self::sanitize_install_name(&dir_name)
                        .or_else(|| {
                            meta.as_ref()
                                .and_then(|m| m.name.as_deref())
                                .and_then(Self::sanitize_install_name)
                        })
                        .or_else(|| zip_stem.as_deref().and_then(Self::sanitize_install_name))
                }
            };
            let install_name = match install_name {
                Some(name) => name,
                None => {
                    return Err(AppError::Message(format_skill_error(
                        "INVALID_SKILL_DIRECTORY",
                        &[("zip", &zip_path.display().to_string())],
                        Some("checkZipContent"),
                    )));
                }
            };

            let conflict = existing_skills
                .values()
                .find(|s| s.directory.eq_ignore_ascii_case(&install_name));

            if let Some(existing) = conflict {
                log::warn!(
                    "Skill directory '{}' already exists (from {}), skipping",
                    install_name,
                    existing.id
                );
                continue;
            }

            // 同一 ZIP 内两个条目解析出相同的最终安装名：拒绝整个批次
            if !claimed_names.insert(install_name.to_lowercase()) {
                return Err(AppError::Message(format_skill_error(
                    "SKILL_DIRECTORY_CONFLICT",
                    &[("directory", &install_name), ("existingRepo", "archive")],
                    Some("checkZipContent"),
                )));
            }

            // 目标目录已存在但数据库无记录：属于未托管内容，绝不覆盖删除
            Self::ensure_no_unmanaged_destination(&ssot_dir.join(&install_name), &install_name)?;

            entries.push(ZipEntry {
                skill_dir,
                meta,
                install_name,
            });
        }

        for entry in entries {
            let ZipEntry {
                skill_dir,
                meta,
                install_name,
            } = entry;

            let (name, description) = match meta {
                Some(m) => (
                    m.name.unwrap_or_else(|| install_name.clone()),
                    m.description,
                ),
                None => (install_name.clone(), None),
            };

            let dest = ssot_dir.join(&install_name);
            Self::copy_dir_recursive(&skill_dir, &dest)?;

            let content_hash = Self::compute_dir_hash(&dest).ok();

            let skill = InstalledSkill {
                id: format!("local:{install_name}"),
                name,
                description,
                directory: install_name.clone(),
                repo_owner: None,
                repo_name: None,
                repo_branch: None,
                readme_url: None,
                apps: SkillApps::only(current_app),
                installed_at: chrono::Utc::now().timestamp(),
                content_hash,
                updated_at: 0,
            };

            Self::persist_and_sync_new_skill(db, &skill, current_app, Some(&dest))?;

            log::info!(
                "Skill {} installed from ZIP, enabled for {:?}",
                skill.name,
                current_app
            );
            installed.push(skill);
        }

        Ok(installed)
    }

    fn extract_local_zip(zip_path: &Path) -> Result<tempfile::TempDir, AppError> {
        Self::extract_local_zip_in(zip_path, &std::env::temp_dir())
    }

    fn extract_local_zip_in(
        zip_path: &Path,
        base_dir: &Path,
    ) -> Result<tempfile::TempDir, AppError> {
        let file = fs::File::open(zip_path).map_err(|e| AppError::io(zip_path, e))?;

        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AppError::Message(format!("Failed to read ZIP file: {e}")))?;

        if archive.is_empty() {
            return Err(AppError::Message(format_skill_error(
                "EMPTY_ARCHIVE",
                &[],
                Some("checkZipContent"),
            )));
        }

        if archive.len() > MAX_ARCHIVE_ENTRIES {
            let count = archive.len().to_string();
            let limit = MAX_ARCHIVE_ENTRIES.to_string();
            return Err(AppError::Message(format_skill_error(
                "ARCHIVE_TOO_MANY_ENTRIES",
                &[("count", &count), ("limit", &limit)],
                Some("checkZipContent"),
            )));
        }

        let temp_dir = tempfile::tempdir_in(base_dir)?;
        let temp_path = temp_dir.path().to_path_buf();

        let mut symlinks: Vec<(PathBuf, String)> = Vec::new();
        let mut total_bytes: u64 = 0;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::Message(e.to_string()))?;
            let file_path = match file.enclosed_name() {
                Some(path) => path.to_owned(),
                None => continue,
            };

            if file_path
                .components()
                .any(|c| matches!(c, Component::ParentDir))
            {
                log::warn!("跳过越界的压缩包条目: {}", file.name());
                continue;
            }

            let outpath = temp_path.join(&file_path);

            if file.is_symlink() {
                let Some(target) = Self::read_symlink_target(&mut file, &mut total_bytes)? else {
                    log::warn!("跳过目标不合法的 symlink 条目: {}", file.name());
                    continue;
                };
                symlinks.push((outpath, target));
            } else if file.is_dir() {
                Self::create_dir_all_within_budget(&outpath, &mut total_bytes)?;
            } else {
                if let Some(parent) = outpath.parent() {
                    Self::create_dir_all_within_budget(parent, &mut total_bytes)?;
                }
                let mut outfile =
                    fs::File::create(&outpath).map_err(|e| AppError::io(&outpath, e))?;
                Self::copy_entry_within_budget(&mut file, &mut outfile, &mut total_bytes)?;
            }
        }

        Self::resolve_symlinks_in_dir(&temp_path, &symlinks, &mut total_bytes)?;

        Ok(temp_dir)
    }

    fn scan_skills_in_dir(dir: &Path) -> Result<Vec<PathBuf>, AppError> {
        let mut skill_dirs = Vec::new();
        Self::scan_skills_recursive(dir, &mut skill_dirs)?;
        Ok(skill_dirs)
    }

    fn scan_skills_recursive(current: &Path, results: &mut Vec<PathBuf>) -> Result<(), AppError> {
        let skill_md = current.join("SKILL.md");
        if skill_md.exists() {
            results.push(current.to_path_buf());
            return Ok(());
        }

        if let Ok(entries) = fs::read_dir(current) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let dir_name = entry.file_name().to_string_lossy().to_string();
                    if dir_name.starts_with('.') {
                        continue;
                    }
                    Self::scan_skills_recursive(&path, results)?;
                }
            }
        }

        Ok(())
    }

    // ========== Backup helpers ==========

    fn resolve_uninstall_backup_source(
        skill: &InstalledSkill,
    ) -> Result<Option<PathBuf>, AppError> {
        let directory = Self::require_valid_directory(&skill.directory)?;

        let ssot_path = Self::get_ssot_dir()?.join(&directory);
        if ssot_path.is_dir() {
            return Ok(Some(ssot_path));
        }

        for app in AgentType::all() {
            let app_dir = match Self::get_app_skills_dir(&app) {
                Ok(dir) => dir,
                Err(_) => continue,
            };
            let candidate = app_dir.join(&directory);
            if candidate.is_dir() {
                return Ok(Some(candidate));
            }
        }

        Ok(None)
    }

    pub(crate) fn sanitize_backup_segment(segment: &str) -> String {
        let sanitized = segment
            .chars()
            .map(|c| match c {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
                _ => '-',
            })
            .collect::<String>()
            .trim_matches('-')
            .to_string();

        if sanitized.is_empty() {
            "skill".to_string()
        } else {
            sanitized
        }
    }

    fn cleanup_old_skill_backups(dir: &Path) -> Result<(), AppError> {
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

        if entries.len() <= SKILL_BACKUP_RETAIN_COUNT {
            return Ok(());
        }

        entries.sort_by_key(|(_, modified)| *modified);
        let remove_count = entries.len().saturating_sub(SKILL_BACKUP_RETAIN_COUNT);

        for (path, _) in entries.into_iter().take(remove_count) {
            fs::remove_dir_all(&path).map_err(|e| AppError::io(&path, e))?;
        }

        Ok(())
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

    fn read_backup_metadata(backup_path: &Path) -> Result<SkillBackupMetadata, AppError> {
        let metadata_path = backup_path.join("meta.json");
        let content =
            fs::read_to_string(&metadata_path).map_err(|e| AppError::io(&metadata_path, e))?;
        serde_json::from_str(&content).map_err(|e| AppError::json(&metadata_path, e))
    }

    fn create_uninstall_backup(skill: &InstalledSkill) -> Result<Option<PathBuf>, AppError> {
        let Some(source_path) = Self::resolve_uninstall_backup_source(skill)? else {
            log::warn!(
                "Skill {} 卸载前未找到可备份的目录，将跳过备份",
                skill.directory
            );
            return Ok(None);
        };

        let backup_root = Self::get_backup_dir()?;
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let slug = Self::sanitize_backup_segment(&skill.directory);
        let mut backup_path = backup_root.join(format!("{timestamp}_{slug}"));
        let mut counter = 1;
        while backup_path.exists() {
            backup_path = backup_root.join(format!("{timestamp}_{slug}_{counter}"));
            counter += 1;
        }

        let write_backup = || -> Result<(), AppError> {
            let skill_backup_dir = backup_path.join("skill");
            Self::copy_dir_recursive(&source_path, &skill_backup_dir)?;

            let metadata = SkillBackupMetadata {
                skill: skill.clone(),
                backup_created_at: chrono::Utc::now().timestamp(),
                source_path: source_path.to_string_lossy().to_string(),
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

        if let Err(err) = Self::cleanup_old_skill_backups(&backup_root) {
            log::warn!("清理旧 Skill 备份失败: {err:#}");
        }

        log::info!(
            "Skill {} 已在卸载前备份到 {}",
            skill.name,
            backup_path.display()
        );

        Ok(Some(backup_path))
    }
}

// ========== Agents lock helpers ==========

fn normalize_optional_branch(branch: Option<String>) -> Option<String> {
    branch.and_then(|b| {
        let trimmed = b.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn parse_branch_from_source_url(source_url: Option<&str>) -> Option<String> {
    let source_url = source_url?;
    let source_url = source_url.trim();
    if source_url.is_empty() {
        return None;
    }

    if let Some((_, after_tree)) = source_url.split_once("/tree/") {
        let branch = after_tree
            .split('/')
            .next()
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        return Some(branch.to_string());
    }

    if let Some((_, fragment)) = source_url.split_once('#') {
        let branch = fragment
            .split('&')
            .next()
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        return Some(branch.to_string());
    }

    if let Some((_, query)) = source_url.split_once('?') {
        for pair in query.split('&') {
            let Some((key, value)) = pair.split_once('=') else {
                continue;
            };
            if matches!(key, "branch" | "ref") {
                let branch = value.trim();
                if !branch.is_empty() {
                    return Some(branch.to_string());
                }
            }
        }
    }

    None
}

fn get_agents_skills_dir() -> Option<PathBuf> {
    let dir = config::get_home_dir().join(".agents").join("skills");
    dir.exists().then_some(dir)
}

fn parse_agents_lock() -> HashMap<String, LockRepoInfo> {
    let path = config::get_home_dir()
        .join(".agents")
        .join(".skill-lock.json");
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                log::debug!("未找到 agents lock 文件: {}", path.display());
            } else {
                log::warn!("读取 agents lock 文件失败 ({}): {}", path.display(), e);
            }
            return HashMap::new();
        }
    };
    let lock: AgentsLockFile = match serde_json::from_str(&content) {
        Ok(l) => l,
        Err(e) => {
            log::warn!("解析 agents lock 文件失败 ({}): {}", path.display(), e);
            return HashMap::new();
        }
    };
    let parsed: HashMap<String, LockRepoInfo> = lock
        .skills
        .into_iter()
        .filter_map(|(name, skill)| {
            let source = skill.source?;
            if skill.source_type.as_deref() != Some("github") {
                return None;
            }
            let (owner, repo) = source.split_once('/')?;
            let branch = normalize_optional_branch(skill.branch)
                .or_else(|| normalize_optional_branch(skill.source_branch))
                .or_else(|| parse_branch_from_source_url(skill.source_url.as_deref()));
            Some((
                name,
                LockRepoInfo {
                    owner: owner.to_string(),
                    repo: repo.to_string(),
                    skill_path: skill.skill_path,
                    branch,
                },
            ))
        })
        .collect();
    log::info!(
        "agents lock 文件解析完成，共识别 {} 个 github skill",
        parsed.len()
    );
    parsed
}

fn build_repo_info_from_lock(
    lock: &HashMap<String, LockRepoInfo>,
    dir_name: &str,
) -> (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    match lock.get(dir_name) {
        Some(info) => {
            let branch = info.branch.clone();
            let url_branch = branch.clone().unwrap_or_else(|| "HEAD".to_string());
            let fallback = format!("{dir_name}/SKILL.md");
            let doc_path = info.skill_path.as_deref().unwrap_or(&fallback);
            let url =
                SkillService::build_skill_doc_url(&info.owner, &info.repo, &url_branch, doc_path);
            (
                format!("{}/{}:{dir_name}", info.owner, info.repo),
                Some(info.owner.clone()),
                Some(info.repo.clone()),
                branch,
                url,
            )
        }
        None => (format!("local:{dir_name}"), None, None, None, None),
    }
}

fn save_repos_from_lock(
    db: &Arc<Database>,
    lock: &HashMap<String, LockRepoInfo>,
    directories: impl Iterator<Item = impl AsRef<str>>,
) {
    let existing_repos: HashSet<(String, String)> = db
        .get_skill_repos()
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.owner, r.name))
        .collect();
    let mut added = HashSet::new();

    for dir_name in directories {
        if let Some(info) = lock.get(dir_name.as_ref()) {
            let key = (info.owner.clone(), info.repo.clone());
            if !existing_repos.contains(&key) && added.insert(key) {
                let skill_repo = SkillRepo {
                    owner: info.owner.clone(),
                    name: info.repo.clone(),
                    branch: info.branch.clone().unwrap_or_else(|| "HEAD".to_string()),
                    enabled: true,
                };
                if SkillService::validate_repo_ref(
                    &skill_repo.owner,
                    &skill_repo.name,
                    &skill_repo.branch,
                )
                .is_err()
                {
                    log::warn!(
                        "跳过 agents lock 中坐标非法的仓库: {}/{}@{}",
                        skill_repo.owner,
                        skill_repo.name,
                        skill_repo.branch
                    );
                    continue;
                }
                if let Err(e) = db.save_skill_repo(&skill_repo) {
                    log::warn!("保存 skill 仓库 {}/{} 失败: {}", info.owner, info.repo, e);
                } else {
                    log::info!(
                        "从 agents lock 文件发现并添加仓库: {}/{} ({})",
                        info.owner,
                        info.repo,
                        skill_repo.branch
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::io::Write;
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

    fn write_skill(dir: &Path, name: &str) {
        fs::create_dir_all(dir).expect("create skill dir");
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: Test skill\n---\n"),
        )
        .expect("write SKILL.md");
    }

    fn build_zip_with_traversal_entry() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();

            zip.start_file("repo-main/SKILL.md", opts).unwrap();
            zip.write_all(b"---\nname: ok\n---\n").unwrap();

            zip.start_file("repo-main/../../escaped.txt", opts).unwrap();
            zip.write_all(b"pwned").unwrap();

            zip.start_file("repo-main/../escaped-one-level.txt", opts)
                .unwrap();
            zip.write_all(b"pwned").unwrap();

            zip.finish().unwrap();
        }
        buf
    }

    #[test]
    fn skill_state_lock_allows_snapshots_but_excludes_writers() {
        let first_reader = skill_state_read_guard();
        let second_reader = skill_state_read_guard();
        assert!(
            skill_state_lock().try_write().is_err(),
            "a Skill mutation must wait for every snapshot reader"
        );

        drop(second_reader);
        drop(first_reader);
        assert!(skill_state_lock().try_write().is_ok());
    }

    #[test]
    fn validate_repo_ref_accepts_real_world_coordinates() {
        for branch in [
            "main",
            "master",
            "HEAD",
            "feature/new-thing",
            "release/v1.2.3",
            "fix-123",
            "user.name/topic",
        ] {
            assert!(
                SkillService::validate_repo_ref("anthropics", "skills", branch).is_ok(),
                "must accept branch: {branch:?}"
            );
        }
        assert!(SkillService::validate_repo_ref("a", "b.c_d-e", "main").is_ok());
    }

    #[test]
    fn validate_repo_ref_accepts_the_empty_branch_sentinel() {
        assert!(
            SkillService::validate_repo_ref("anthropics", "skills", "").is_ok(),
            "the empty-branch sentinel must stay usable"
        );
    }

    #[test]
    fn validate_repo_ref_rejects_url_hijacking_branches() {
        for branch in [
            "../../../releases/download/v1/evil",
            "..",
            "../x",
            "a/../../b",
            "a/./b",
            "..\\..\\releases\\download\\v1\\evil",
            "/leading",
            "trailing/",
            "double//slash",
            "with space",
            "frag#ment",
            "pct%2e%2e",
            "ref@{0}",
            "seg.lock",
            ".hidden/x",
        ] {
            assert!(
                SkillService::validate_repo_ref("owner", "repo", branch).is_err(),
                "must reject branch: {branch:?}"
            );
        }
        for (owner, name) in [
            ("..", "repo"),
            ("own/er", "repo"),
            ("owner", ".."),
            ("owner", "re/po"),
            ("owner", "re po"),
            ("", "repo"),
            ("owner", ""),
        ] {
            assert!(
                SkillService::validate_repo_ref(owner, name, "main").is_err(),
                "must reject coordinates: {owner:?}/{name:?}"
            );
        }
    }

    #[test]
    fn assert_github_archive_url_pins_host_and_path() {
        let ok = "https://github.com/owner/repo/archive/refs/heads/main.zip";
        assert!(SkillService::assert_github_archive_url(ok, "owner", "repo").is_ok());

        for bad in [
            "https://github.com/owner/repo/releases/download/v1/evil.zip",
            "https://evil.example/owner/repo/archive/refs/heads/main.zip",
            "http://github.com/owner/repo/archive/refs/heads/main.zip",
            "https://github.com/other/repo/archive/refs/heads/main.zip",
        ] {
            assert!(
                SkillService::assert_github_archive_url(bad, "owner", "repo").is_err(),
                "must reject url: {bad}"
            );
        }
    }

    #[test]
    fn build_skill_doc_url_drops_illegal_coordinates() {
        assert_eq!(
            SkillService::build_skill_doc_url("owner", "repo", "main", "a/SKILL.md").as_deref(),
            Some("https://github.com/owner/repo/blob/main/a/SKILL.md")
        );
        assert!(
            SkillService::build_skill_doc_url("owner", "repo", "../../../issues", "x").is_none()
        );
    }

    #[test]
    fn parse_skill_metadata_reads_frontmatter() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("SKILL.md");
        fs::write(
            &md,
            "---\nname: My Skill\ndescription: Does things\n---\n# Body\n",
        )
        .unwrap();

        let meta = SkillService::parse_skill_metadata_static(&md).unwrap();
        assert_eq!(meta.name, Some("My Skill".to_string()));
        assert_eq!(meta.description, Some("Does things".to_string()));
    }

    #[test]
    fn parse_skill_metadata_falls_back_when_no_frontmatter() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("SKILL.md");
        fs::write(&md, "# Just a body\n").unwrap();

        let meta = SkillService::parse_skill_metadata_static(&md).unwrap();
        assert!(meta.name.is_none());
        assert!(meta.description.is_none());
    }

    #[test]
    fn read_skill_name_desc_uses_fallback() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("SKILL.md");
        fs::write(&md, "# Title\n").unwrap();
        let (name, desc) = SkillService::read_skill_name_desc(&md, "fallback");
        assert_eq!(name, "fallback");
        assert!(desc.is_none());
    }

    #[test]
    fn extract_repo_archive_rejects_path_traversal_entries() {
        let temp = tempdir().expect("tempdir");
        let dest = temp.path().join("nested").join("dest");
        fs::create_dir_all(&dest).expect("create dest");

        let bytes = build_zip_with_traversal_entry();
        let archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("archive parses");

        SkillService::extract_repo_archive(archive, &dest).expect("extract must not fail");

        assert!(
            dest.join("SKILL.md").is_file(),
            "legitimate entry should be extracted"
        );
        assert!(
            !temp.path().join("escaped.txt").exists(),
            "zip-slip entry must not escape dest (temp root)"
        );
        assert!(
            !temp.path().join("nested").join("escaped.txt").exists(),
            "zip-slip entry must not escape dest (parent dir)"
        );
        assert!(
            !temp
                .path()
                .join("nested")
                .join("escaped-one-level.txt")
                .exists(),
            "single-`..` entry must not escape dest (enclosed_name allows it)"
        );
    }

    #[test]
    fn extract_repo_archive_skips_a_symlink_that_contains_itself() {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("repo-main/SKILL.md", opts).unwrap();
            zip.write_all(b"---\nname: t\ndescription: d\n---\n")
                .unwrap();
            zip.add_directory("repo-main/dir/", opts).unwrap();
            zip.add_symlink("repo-main/dir/link", "..", opts).unwrap();
            zip.finish().unwrap();
        }

        let temp = tempdir().expect("tempdir");
        let dest = temp.path().join("dest");
        fs::create_dir_all(&dest).expect("create dest");
        let archive = zip::ZipArchive::new(std::io::Cursor::new(buf)).expect("archive parses");

        SkillService::extract_repo_archive(archive, &dest)
            .expect("a self-containing symlink must be skipped, not blow up the extraction");

        assert!(
            dest.join("SKILL.md").is_file(),
            "legitimate entries must still be extracted"
        );
        assert!(
            !dest.join("dir").join("link").exists(),
            "a symlink whose target contains the link itself must not be materialized"
        );
    }

    #[test]
    fn symlink_materialization_is_charged_to_the_archive_budget() {
        let temp = tempdir().expect("tempdir");
        let base = temp.path().join("base");
        fs::create_dir_all(base.join("payload")).expect("create payload dir");
        fs::write(base.join("payload").join("big.bin"), vec![b'x'; 4096]).expect("write payload");

        let symlinks = vec![(base.join("copy"), "payload".to_string())];
        let mut total_bytes = MAX_ARCHIVE_TOTAL_BYTES - 1024;

        let err = SkillService::resolve_symlinks_in_dir(&base, &symlinks, &mut total_bytes)
            .expect_err("materializing 4 KiB with 1 KiB of budget left must fail");
        assert!(
            err.to_string().contains("ARCHIVE_TOO_LARGE"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn extract_local_zip_hands_back_a_guard_that_owns_the_tree() {
        let holder = tempdir().expect("tempdir");
        let scratch = tempdir().expect("tempdir");

        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("s/SKILL.md", opts).unwrap();
            zip.write_all(b"# skill").unwrap();
            zip.finish().unwrap();
        }
        let zip_path = holder.path().join("ok.zip");
        fs::write(&zip_path, &buf).expect("write zip");

        let extracted = SkillService::extract_local_zip_in(&zip_path, scratch.path())
            .expect("extract must succeed");
        assert!(
            extracted.path().join("s").join("SKILL.md").exists(),
            "the fixture must actually extract something worth cleaning up"
        );

        drop(extracted);

        let leftovers: Vec<_> = fs::read_dir(scratch.path())
            .expect("read scratch")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        assert!(
            leftovers.is_empty(),
            "dropping the extraction result must take the whole tree with it: {leftovers:?}"
        );
    }

    #[test]
    #[serial]
    fn install_from_zip_creates_ssot_and_projection() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let holder = tempdir().unwrap();
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("my-skill/SKILL.md", opts).unwrap();
            zip.write_all(b"---\nname: My Skill\n---\n").unwrap();
            zip.finish().unwrap();
        }
        let zip_path = holder.path().join("skill.zip");
        fs::write(&zip_path, &buf).unwrap();

        let db = Arc::new(Database::memory().unwrap());
        let installed = SkillService::install_from_zip(&db, &zip_path, &AgentType::ClaudeCode)
            .expect("install");

        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].name, "My Skill");
        assert!(installed[0].apps.claude_code);

        let ssot = SkillService::get_ssot_dir().unwrap().join("my-skill");
        assert!(ssot.join("SKILL.md").exists());

        let projection = config::get_claude_skills_dir().join("my-skill");
        assert!(projection.exists());
    }

    #[test]
    #[serial]
    fn install_from_zip_conflicts_with_unmanaged_ssot_dir() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        // 预置未托管的同名 SSOT 目录（数据库中无记录）
        let dest = SkillService::get_ssot_dir().unwrap().join("my-skill");
        write_skill(&dest, "Unmanaged");
        fs::write(dest.join("user-data.txt"), "do not delete").unwrap();

        let holder = tempdir().unwrap();
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("my-skill/SKILL.md", opts).unwrap();
            zip.write_all(b"---\nname: My Skill\n---\n").unwrap();
            zip.finish().unwrap();
        }
        let zip_path = holder.path().join("skill.zip");
        fs::write(&zip_path, &buf).unwrap();

        let db = Arc::new(Database::memory().unwrap());
        let err = SkillService::install_from_zip(&db, &zip_path, &AgentType::ClaudeCode)
            .expect_err("must conflict with unmanaged on-disk directory");
        assert!(err.to_string().contains("SKILL_DIRECTORY_CONFLICT"));

        // 未托管内容保持原样，绝不被删除
        assert_eq!(
            fs::read_to_string(dest.join("user-data.txt")).unwrap(),
            "do not delete"
        );
    }

    #[test]
    #[serial]
    fn update_replace_failure_restores_ssot_from_backup() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let dest = tmp.path().join("ssot").join("my-skill");
        write_skill(&dest, "Old");
        fs::write(dest.join("old.txt"), "old content").unwrap();

        let backup = tmp.path().join("backup");
        write_skill(&backup.join("skill"), "Old");
        fs::write(backup.join("skill").join("old.txt"), "old content").unwrap();

        // 源缺失导致复制失败：dest 先被清空，随后必须从备份恢复
        let missing_source = tmp.path().join("missing-source");
        let result = SkillService::replace_ssot_dir(&missing_source, &dest);
        assert!(result.is_err(), "copy from a missing source must fail");
        assert!(!dest.join("old.txt").exists());

        SkillService::restore_ssot_from_backup(Some(&backup), &dest);

        assert_eq!(
            fs::read_to_string(dest.join("old.txt")).unwrap(),
            "old content"
        );
        assert!(dest.join("SKILL.md").exists());
    }

    #[test]
    #[serial]
    fn install_conflict_rejects_same_name_from_different_repo() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        let existing = InstalledSkill {
            id: "owner1/repo1:my-skill".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "my-skill".to_string(),
            repo_owner: Some("owner1".to_string()),
            repo_name: Some("repo1".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&existing).unwrap();

        let discoverable = DiscoverableSkill {
            key: "owner2/repo2:my-skill".to_string(),
            name: "New".to_string(),
            description: "".to_string(),
            directory: "my-skill".to_string(),
            readme_url: None,
            repo_owner: "owner2".to_string(),
            repo_name: "repo2".to_string(),
            repo_branch: "main".to_string(),
        };

        let err =
            SkillService::reuse_existing_install(&db, &discoverable, "my-skill", &AgentType::Codex)
                .expect_err("must conflict");
        assert!(err.to_string().contains("SKILL_DIRECTORY_CONFLICT"));
    }

    #[test]
    #[serial]
    fn install_same_repo_reuses_and_enables_current_app() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("my-skill"),
            "My Skill",
        );

        let existing = InstalledSkill {
            id: "owner/repo:my-skill".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "my-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&existing).unwrap();

        let discoverable = DiscoverableSkill {
            key: "owner/repo:my-skill".to_string(),
            name: "Existing".to_string(),
            description: "".to_string(),
            directory: "my-skill".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
        };

        let updated =
            SkillService::reuse_existing_install(&db, &discoverable, "my-skill", &AgentType::Codex)
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
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("my-skill"),
            "My Skill",
        );

        let existing = InstalledSkill {
            id: "owner/repo:my-skill".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "my-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&existing).unwrap();

        // 故障注入：codex 的 skills 目录路径被普通文件占用，投影同步必然失败
        let codex_dir = config::get_codex_skills_dir();
        fs::create_dir_all(codex_dir.parent().unwrap()).unwrap();
        fs::write(&codex_dir, "blocked").unwrap();

        let discoverable = DiscoverableSkill {
            key: "owner/repo:my-skill".to_string(),
            name: "Existing".to_string(),
            description: "".to_string(),
            directory: "my-skill".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
        };

        SkillService::reuse_existing_install(&db, &discoverable, "my-skill", &AgentType::Codex)
            .expect_err("sync failure must surface as an error");

        let stored = db.get_installed_skill(&existing.id).unwrap().unwrap();
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
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("my-skill"),
            "My Skill",
        );

        let existing = InstalledSkill {
            id: "owner/repo:my-skill".to_string(),
            name: "Existing".to_string(),
            description: None,
            directory: "my-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&existing).unwrap();

        // 故障注入：DB 只读，保存必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        let discoverable = DiscoverableSkill {
            key: "owner/repo:my-skill".to_string(),
            name: "Existing".to_string(),
            description: "".to_string(),
            directory: "my-skill".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
        };

        SkillService::reuse_existing_install(&db, &discoverable, "my-skill", &AgentType::Codex)
            .expect_err("保存失败必须返回错误");

        assert!(
            !config::get_codex_skills_dir().join("my-skill").exists(),
            "保存失败时本次新建的投影必须被移除"
        );
        let stored = db.get_installed_skill(&existing.id).unwrap().unwrap();
        assert!(stored.apps.claude_code);
        assert!(!stored.apps.codex, "保存失败时 codex 的启用标志不得落库");
    }

    #[test]
    #[serial]
    fn uninstall_removes_only_enabled_app_projections() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("scoped-skill"),
            "Scoped",
        );

        let skill = InstalledSkill {
            id: "owner/repo:scoped-skill".to_string(),
            name: "Scoped".to_string(),
            description: None,
            directory: "scoped-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&skill).unwrap();
        SkillService::sync_to_app_dir("scoped-skill", &AgentType::ClaudeCode).unwrap();

        // Codex 下同名的"用户自有"目录，与受管投影无关
        let codex_owned = config::get_codex_skills_dir().join("scoped-skill");
        fs::create_dir_all(&codex_owned).unwrap();
        fs::write(codex_owned.join("SKILL.md"), "user-owned content").unwrap();

        SkillService::uninstall(&db, &skill.id).expect("uninstall");

        assert_eq!(
            fs::read_to_string(codex_owned.join("SKILL.md")).unwrap(),
            "user-owned content",
            "卸载不得触碰未启用 Agent 下的同名用户内容"
        );
        assert!(!config::get_claude_skills_dir()
            .join("scoped-skill")
            .exists());
        assert!(!SkillService::get_ssot_dir()
            .unwrap()
            .join("scoped-skill")
            .exists());
        assert!(db.get_installed_skill(&skill.id).unwrap().is_none());
    }

    #[test]
    #[serial]
    fn sync_to_app_dir_creates_symlink_in_symlink_mode() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        crate::settings::set_sync_method(SyncMethod::Symlink).unwrap();

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("sym-skill"),
            "Sym Skill",
        );

        SkillService::sync_to_app_dir("sym-skill", &AgentType::ClaudeCode).expect("sync");

        let projection = config::get_claude_skills_dir().join("sym-skill");
        assert!(SkillService::is_symlink(&projection));
    }

    #[test]
    #[serial]
    fn sync_to_app_dir_copies_in_copy_mode() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("copy-skill"),
            "Copy Skill",
        );

        SkillService::sync_to_app_dir("copy-skill", &AgentType::ClaudeCode).expect("sync");

        let projection = config::get_claude_skills_dir().join("copy-skill");
        assert!(projection.is_dir());
        assert!(!SkillService::is_symlink(&projection));
        assert!(projection.join("SKILL.md").is_file());
    }

    #[test]
    #[serial]
    fn auto_mode_replaces_real_dir_with_copy() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        crate::settings::set_sync_method(SyncMethod::Auto).unwrap();

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("auto-skill"),
            "Auto Skill",
        );

        let projection = config::get_claude_skills_dir().join("auto-skill");
        fs::create_dir_all(&projection).unwrap();
        fs::write(projection.join("stale.txt"), "old").unwrap();

        SkillService::sync_to_app_dir("auto-skill", &AgentType::ClaudeCode).expect("sync");

        assert!(projection.join("SKILL.md").exists());
        assert!(!projection.join("stale.txt").exists());
    }

    #[test]
    #[serial]
    fn uninstall_removes_projections_and_creates_backup() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(
            &SkillService::get_ssot_dir()
                .unwrap()
                .join("uninstall-skill"),
            "Uninstall",
        );

        let skill = InstalledSkill {
            id: "owner/repo:uninstall-skill".to_string(),
            name: "Uninstall".to_string(),
            description: None,
            directory: "uninstall-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&skill).unwrap();
        SkillService::sync_to_app_dir("uninstall-skill", &AgentType::ClaudeCode).unwrap();

        let result = SkillService::uninstall(&db, &skill.id).expect("uninstall");
        assert!(result.backup_path.is_some());

        assert!(!SkillService::get_ssot_dir()
            .unwrap()
            .join("uninstall-skill")
            .exists());
        assert!(!config::get_claude_skills_dir()
            .join("uninstall-skill")
            .exists());
        assert!(db.get_installed_skill(&skill.id).unwrap().is_none());

        let backups = SkillService::list_backups().expect("list backups");
        assert_eq!(backups.len(), 1);
    }

    #[test]
    #[serial]
    fn restore_from_backup_recreates_ssot_and_projection() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("restore-skill"),
            "Restore",
        );

        let skill = InstalledSkill {
            id: "owner/repo:restore-skill".to_string(),
            name: "Restore".to_string(),
            description: None,
            directory: "restore-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&skill).unwrap();
        SkillService::sync_to_app_dir("restore-skill", &AgentType::ClaudeCode).unwrap();

        let result = SkillService::uninstall(&db, &skill.id).expect("uninstall");
        let backup_id = result
            .backup_path
            .unwrap()
            .split('/')
            .next_back()
            .unwrap()
            .to_string();

        // current_app 与备份启用状态不同：恢复以备份中记录的启用标志为准
        let restored =
            SkillService::restore_from_backup(&db, &backup_id, &AgentType::Codex).expect("restore");
        assert_eq!(restored.directory, "restore-skill");
        assert!(restored.apps.claude_code);
        assert!(!restored.apps.codex);

        assert!(SkillService::get_ssot_dir()
            .unwrap()
            .join("restore-skill")
            .exists());
        assert!(config::get_claude_skills_dir()
            .join("restore-skill")
            .exists());
    }

    #[test]
    #[serial]
    fn restore_from_backup_restores_all_enabled_apps() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("multi-skill"),
            "Multi",
        );

        // 卸载前对 ClaudeCode 与 Codex 两个 Agent 启用
        let mut skill = InstalledSkill {
            id: "owner/repo:multi-skill".to_string(),
            name: "Multi".to_string(),
            description: None,
            directory: "multi-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        skill.apps.set_enabled_for(&AgentType::Codex, true);
        db.save_skill(&skill).unwrap();
        SkillService::sync_to_app_dir("multi-skill", &AgentType::ClaudeCode).unwrap();
        SkillService::sync_to_app_dir("multi-skill", &AgentType::Codex).unwrap();

        let result = SkillService::uninstall(&db, &skill.id).expect("uninstall");
        let backup_id = result
            .backup_path
            .unwrap()
            .split('/')
            .next_back()
            .unwrap()
            .to_string();

        let restored = SkillService::restore_from_backup(&db, &backup_id, &AgentType::ClaudeCode)
            .expect("restore");

        // apps 标志与卸载前一致
        assert!(restored.apps.claude_code);
        assert!(restored.apps.codex);
        assert!(!restored.apps.gemini_cli);
        let stored = db.get_installed_skill(&skill.id).unwrap().unwrap();
        assert!(stored.apps.claude_code);
        assert!(stored.apps.codex);

        // 各启用 Agent 的投影均重建
        assert!(config::get_claude_skills_dir().join("multi-skill").exists());
        assert!(config::get_codex_skills_dir().join("multi-skill").exists());
    }

    #[test]
    #[serial]
    fn compute_dir_hash_detects_content_changes() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("skill");
        write_skill(&dir, "Hashable");

        let first = SkillService::compute_dir_hash(&dir).unwrap();

        fs::write(dir.join("extra.txt"), "more").unwrap();
        let second = SkillService::compute_dir_hash(&dir).unwrap();
        assert_ne!(first, second);
    }

    #[test]
    #[serial]
    fn migrate_storage_moves_ssot_and_refreshes_projections() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Symlink).unwrap();

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("migrate-skill"),
            "Migrate",
        );
        let skill = InstalledSkill {
            id: "owner/repo:migrate-skill".to_string(),
            name: "Migrate".to_string(),
            description: None,
            directory: "migrate-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&skill).unwrap();
        SkillService::sync_to_app_dir("migrate-skill", &AgentType::ClaudeCode).unwrap();

        let result = crate::commands::migrate_storage_combined(&db, StorageLocation::Unified)
            .expect("migrate");
        assert_eq!(result.skill.migrated_count, 1);
        assert_eq!(result.skill.skipped_count, 0);

        let new_ssot = config::get_home_dir()
            .join(".agents")
            .join("skills")
            .join("migrate-skill");
        assert!(new_ssot.exists());

        let projection = config::get_claude_skills_dir().join("migrate-skill");
        assert!(projection.exists());
        assert!(SkillService::is_symlink(&projection));

        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Unified
        );
    }

    #[test]
    #[serial]
    fn scan_unmanaged_finds_skills_outside_db() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(&config::get_claude_skills_dir().join("orphan"), "Orphan");

        let unmanaged = SkillService::scan_unmanaged(&db).expect("scan");
        assert!(unmanaged.iter().any(|s| s.directory == "orphan"));
    }

    #[test]
    #[serial]
    fn scan_unmanaged_splits_same_name_with_different_content() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(&config::get_claude_skills_dir().join("shared"), "Alpha");
        write_skill(&config::get_codex_skills_dir().join("shared"), "Beta");

        let unmanaged = SkillService::scan_unmanaged(&db).expect("scan");
        let matches: Vec<_> = unmanaged
            .iter()
            .filter(|s| s.directory == "shared")
            .collect();
        assert_eq!(
            matches.len(),
            2,
            "同名但内容不同的未受管 Skill 必须呈现为两条独立发现项"
        );
        assert!(matches
            .iter()
            .any(|s| s.found_in == vec!["claude-code".to_string()]));
        assert!(matches
            .iter()
            .any(|s| s.found_in == vec!["codex".to_string()]));
    }

    #[test]
    #[serial]
    fn scan_unmanaged_merges_same_name_with_identical_content() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(&config::get_claude_skills_dir().join("twin"), "Twin");
        write_skill(&config::get_codex_skills_dir().join("twin"), "Twin");

        let unmanaged = SkillService::scan_unmanaged(&db).expect("scan");
        let matches: Vec<_> = unmanaged.iter().filter(|s| s.directory == "twin").collect();
        assert_eq!(matches.len(), 1, "内容一致的同名 Skill 仍合并为一条发现项");
        let item = matches[0];
        assert_eq!(item.found_in.len(), 2);
        assert!(item.found_in.contains(&"claude-code".to_string()));
        assert!(item.found_in.contains(&"codex".to_string()));
    }

    #[test]
    #[serial]
    fn import_from_apps_copies_and_persists() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(&config::get_claude_skills_dir().join("native"), "Native");

        let imported = SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "native".to_string(),
                source_path: None,
                apps: SkillApps::only(&AgentType::ClaudeCode),
            }],
        )
        .expect("import");

        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].directory, "native");
        assert!(SkillService::get_ssot_dir()
            .unwrap()
            .join("native")
            .exists());
    }

    #[test]
    #[serial]
    fn import_from_apps_prefers_exact_source_path() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        // 同名不同内容的两条发现项：claude 下为 Alpha，codex 下为 Beta
        write_skill(&config::get_claude_skills_dir().join("shared"), "Alpha");
        write_skill(&config::get_codex_skills_dir().join("shared"), "Beta");
        let claude_path = config::get_claude_skills_dir().join("shared");
        let codex_path = config::get_codex_skills_dir().join("shared");

        // 选第二条（codex 的 Beta）导入：SSOT 必须是该来源内容，
        // 而不是扫描顺序中的第一个（claude 的 Alpha）
        let imported = SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "shared".to_string(),
                source_path: Some(codex_path.to_string_lossy().to_string()),
                apps: SkillApps::default(),
            }],
        )
        .expect("import codex variant");
        assert_eq!(imported.len(), 1);
        let ssot_md = fs::read_to_string(
            SkillService::get_ssot_dir()
                .unwrap()
                .join("shared")
                .join("SKILL.md"),
        )
        .unwrap();
        assert!(
            ssot_md.contains("name: Beta"),
            "source_path 指定的来源内容必须进入 SSOT: {ssot_md}"
        );

        // 两个来源保持原样，互不覆盖
        assert!(fs::read_to_string(claude_path.join("SKILL.md"))
            .unwrap()
            .contains("name: Alpha"));
        assert!(fs::read_to_string(codex_path.join("SKILL.md"))
            .unwrap()
            .contains("name: Beta"));

        // 再选第一条（claude 的 Alpha）导入：同样以各自来源内容为准
        SkillService::uninstall(&db, &imported[0].id).expect("uninstall first import");
        let imported = SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "shared".to_string(),
                source_path: Some(claude_path.to_string_lossy().to_string()),
                apps: SkillApps::default(),
            }],
        )
        .expect("import claude variant");
        assert_eq!(imported.len(), 1);
        let ssot_md = fs::read_to_string(
            SkillService::get_ssot_dir()
                .unwrap()
                .join("shared")
                .join("SKILL.md"),
        )
        .unwrap();
        assert!(
            ssot_md.contains("name: Alpha"),
            "source_path 指定的来源内容必须进入 SSOT: {ssot_md}"
        );
    }

    #[test]
    #[serial]
    fn import_from_apps_without_source_path_uses_first_match() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(&config::get_claude_skills_dir().join("shared"), "Alpha");
        write_skill(&config::get_codex_skills_dir().join("shared"), "Beta");

        // 旧调用不带 source_path：保持按目录取第一个匹配来源的行为（claude 先于 codex）
        let imported = SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "shared".to_string(),
                source_path: None,
                apps: SkillApps::default(),
            }],
        )
        .expect("import");
        assert_eq!(imported.len(), 1);
        let ssot_md = fs::read_to_string(
            SkillService::get_ssot_dir()
                .unwrap()
                .join("shared")
                .join("SKILL.md"),
        )
        .unwrap();
        assert!(
            ssot_md.contains("name: Alpha"),
            "不带 source_path 时必须维持旧的首个匹配行为: {ssot_md}"
        );
    }

    #[test]
    #[serial]
    fn toggle_app_enable_rolls_back_projection_on_db_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("toggle-skill"),
            "Toggle",
        );

        let mut skill = installed_skill_fixture("owner/repo:toggle-skill", "toggle-skill");
        skill.apps = SkillApps::default();
        db.save_skill(&skill).unwrap();

        // 故障注入：DB 只读，update_skill_apps 必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        SkillService::toggle_app(&db, &skill.id, &AgentType::ClaudeCode, true)
            .expect_err("落库失败必须返回错误");

        // 启用方向：新建的投影必须被撤销，DB 保持禁用
        assert!(
            !config::get_claude_skills_dir()
                .join("toggle-skill")
                .exists(),
            "落库失败时本次新建的投影必须被移除"
        );
        let stored = db.get_installed_skill(&skill.id).unwrap().unwrap();
        assert!(!stored.apps.claude_code, "落库失败时启用标志不得改变");
    }

    #[test]
    #[serial]
    fn toggle_app_disable_restores_projection_on_db_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("toggle-skill"),
            "Toggle",
        );

        let mut skill = installed_skill_fixture("owner/repo:toggle-skill", "toggle-skill");
        skill.apps = SkillApps::only(&AgentType::ClaudeCode);
        db.save_skill(&skill).unwrap();
        SkillService::sync_to_app_dir("toggle-skill", &AgentType::ClaudeCode).unwrap();

        // 故障注入：DB 只读，update_skill_apps 必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        SkillService::toggle_app(&db, &skill.id, &AgentType::ClaudeCode, false)
            .expect_err("落库失败必须返回错误");

        // 禁用方向：已删除的投影必须被恢复，DB 保持启用
        assert!(
            config::get_claude_skills_dir()
                .join("toggle-skill")
                .join("SKILL.md")
                .exists(),
            "落库失败时被删除的投影必须恢复"
        );
        let stored = db.get_installed_skill(&skill.id).unwrap().unwrap();
        assert!(stored.apps.claude_code, "落库失败时启用标志不得改变");
    }

    #[test]
    fn sanitize_install_name_rejects_dangerous_values() {
        for bad in ["", ".", "..", ".hidden", "a/b", "a\\b"] {
            assert!(
                SkillService::sanitize_install_name(bad).is_none(),
                "must reject {bad:?}"
            );
        }
        assert_eq!(
            SkillService::sanitize_install_name("good-name"),
            Some("good-name".to_string())
        );
        assert_eq!(
            SkillService::sanitize_install_name(" spaced "),
            Some("spaced".to_string())
        );
    }

    #[test]
    fn require_valid_directory_rejects_traversal() {
        assert!(SkillService::require_valid_directory("../etc").is_err());
        assert!(SkillService::require_valid_directory("normal").is_ok());
    }

    #[test]
    #[serial]
    fn migrate_storage_aborts_on_conflict_and_rolls_back() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());

        for name in ["skill-a", "skill-b"] {
            write_skill(&SkillService::get_ssot_dir().unwrap().join(name), name);
            let skill = InstalledSkill {
                id: format!("owner/repo:{name}"),
                name: name.to_string(),
                description: None,
                directory: name.to_string(),
                repo_owner: Some("owner".to_string()),
                repo_name: Some("repo".to_string()),
                repo_branch: Some("main".to_string()),
                readme_url: None,
                apps: SkillApps::default(),
                installed_at: 1,
                content_hash: None,
                updated_at: 0,
            };
            db.save_skill(&skill).unwrap();
        }

        // 在统一目录中预建冲突目录，使 skill-b 迁移失败
        let conflict_dir = config::get_home_dir()
            .join(".agents")
            .join("skills")
            .join("skill-b");
        fs::create_dir_all(&conflict_dir).unwrap();

        let result = crate::commands::migrate_storage_combined(&db, StorageLocation::Unified);
        assert!(result.is_err(), "冲突时应中止迁移");
        let err_string = result.unwrap_err().to_string();
        assert!(err_string.contains("MIGRATION_ABORTED"));

        // skill-a 应被回滚到原位置
        assert!(SkillService::get_ssot_dir()
            .unwrap()
            .join("skill-a")
            .exists());
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("skills")
            .join("skill-a")
            .exists());

        // 设置保持原值
        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Hub
        );
    }

    #[test]
    #[serial]
    fn migration_aborted_payload_hides_raw_paths() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        // 让 claude 的 skills 目录与统一目录目标重合，触发目标校验失败（原始错误含绝对路径）
        let agents_dir = config::get_home_dir().join(".agents");
        fs::create_dir_all(agents_dir.join("skills")).unwrap();
        crate::settings::set_agent_config_dir_override(
            "claude-code",
            Some(agents_dir.to_string_lossy().to_string()),
        )
        .unwrap();

        let db = Arc::new(Database::memory().unwrap());
        let failure = match SkillService::migrate_storage_inner(&db, StorageLocation::Unified) {
            Err(failure) => failure,
            Ok(_) => panic!("destination validation must abort"),
        };
        let payload = failure.into_error().to_string();

        assert!(payload.contains("MIGRATION_ABORTED"));
        assert!(payload.contains("validateDestination"));
        assert!(
            !payload.contains(tmp.path().to_string_lossy().as_ref()),
            "payload must not leak absolute paths: {payload}"
        );
    }

    #[test]
    #[serial]
    fn install_from_zip_rejects_duplicate_install_names_within_archive() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let holder = tempdir().unwrap();
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("x/dup/SKILL.md", opts).unwrap();
            zip.write_all(b"---\nname: Dup A\n---\n").unwrap();
            zip.start_file("y/dup/SKILL.md", opts).unwrap();
            zip.write_all(b"---\nname: Dup B\n---\n").unwrap();
            zip.finish().unwrap();
        }
        let zip_path = holder.path().join("dup.zip");
        fs::write(&zip_path, &buf).unwrap();

        let db = Arc::new(Database::memory().unwrap());
        let err = SkillService::install_from_zip(&db, &zip_path, &AgentType::ClaudeCode)
            .expect_err("two entries resolving to the same install name must be rejected");
        assert!(err.to_string().contains("SKILL_DIRECTORY_CONFLICT"));

        // 整个批次不产生任何 SSOT/DB 变更
        assert!(!SkillService::get_ssot_dir().unwrap().join("dup").exists());
        assert!(db.get_all_installed_skills().unwrap().is_empty());
    }

    #[test]
    #[serial]
    fn install_repo_skill_rejects_unmanaged_on_disk_destination() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        // 未托管的同名目录（数据库无记录）
        let dest = SkillService::get_ssot_dir().unwrap().join("my-skill");
        write_skill(&dest, "Unmanaged");
        fs::write(dest.join("user-data.txt"), "do not delete").unwrap();

        let err = SkillService::ensure_no_unmanaged_destination(&dest, "my-skill")
            .expect_err("unmanaged on-disk destination must conflict");
        let payload = err.to_string();
        assert!(payload.contains("SKILL_DIRECTORY_CONFLICT"));
        assert!(payload.contains("unmanaged"));
        assert!(payload.contains("importFirst"));

        // 未托管内容保持原样
        assert_eq!(
            fs::read_to_string(dest.join("user-data.txt")).unwrap(),
            "do not delete"
        );
    }

    #[test]
    #[serial]
    fn persist_skill_update_or_restore_reverts_ssot_and_db_on_persist_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        let previous = InstalledSkill {
            id: "owner/repo:upd-skill".to_string(),
            name: "Old".to_string(),
            description: None,
            directory: "upd-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::default(),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&previous).unwrap();

        // 旧 SSOT 与更新前备份
        let dest = SkillService::get_ssot_dir().unwrap().join("upd-skill");
        write_skill(&dest, "Old");
        fs::write(dest.join("old.txt"), "old content").unwrap();
        let backup = tmp.path().join("backup");
        write_skill(&backup.join("skill"), "Old");
        fs::write(backup.join("skill").join("old.txt"), "old content").unwrap();

        // 模拟 SSOT 替换已成功：dest 现在是新版本
        fs::remove_dir_all(&dest).unwrap();
        write_skill(&dest, "New");

        // 故障注入：DB 只读，元数据持久化必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        let updated_metadata = InstalledSkill {
            name: "New".to_string(),
            content_hash: Some("newhash".to_string()),
            ..previous.clone()
        };
        let result = SkillService::persist_skill_update_or_restore(
            &db,
            &previous,
            &updated_metadata,
            Some(&backup),
            &dest,
        );
        assert!(result.is_err(), "persist failure must propagate");

        // SSOT 从备份恢复为旧版本
        assert_eq!(
            fs::read_to_string(dest.join("old.txt")).unwrap(),
            "old content"
        );
        // DB 保留旧记录（无部分写入的新元数据）
        let stored = db.get_installed_skill(&previous.id).unwrap().unwrap();
        assert_eq!(stored.name, "Old");
        assert_eq!(stored.content_hash, None);
    }

    #[test]
    #[serial]
    fn sync_to_app_unlocked_aggregates_per_skill_failures() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // DB 记录为 claude 启用，但 SSOT 目录不存在 → 该项同步必然失败
        let skill = InstalledSkill {
            id: "owner/repo:ghost-skill".to_string(),
            name: "Ghost".to_string(),
            description: None,
            directory: "ghost-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&skill).unwrap();

        let err = SkillService::sync_to_app_unlocked(&db, &AgentType::ClaudeCode)
            .expect_err("per-skill failures must surface instead of being swallowed");
        let payload = err.to_string();
        assert!(payload.contains("PROJECTION_SYNC_FAILED"));
        assert!(payload.contains("ghost-skill"));
    }

    #[test]
    #[serial]
    fn import_from_apps_creates_projections() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();
        write_skill(&config::get_claude_skills_dir().join("native"), "Native");

        SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "native".to_string(),
                source_path: None,
                apps: SkillApps::only(&AgentType::ClaudeCode),
            }],
        )
        .expect("import");

        assert!(SkillService::get_ssot_dir()
            .unwrap()
            .join("native")
            .exists());
        assert!(config::get_claude_skills_dir().join("native").exists());
        assert!(db.get_installed_skill("local:native").unwrap().is_some());
    }

    #[test]
    #[serial]
    fn import_from_apps_rolls_back_db_row_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        // 先在可写的覆盖目录中放置源 skill
        let read_only_root = tmp.path().join("readonly-claude");
        let skills_dir = read_only_root.join("skills");
        write_skill(&skills_dir.join("native"), "Native");

        // 再将覆盖目录及其 skills 子目录设为只读，使投影同步必然失败
        for dir in [&read_only_root, &skills_dir] {
            let mut permissions = std::fs::metadata(dir).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(dir, permissions).unwrap();
        }

        crate::settings::update_settings(crate::settings::AppSettings {
            claude_code_config_dir: Some(read_only_root.to_string_lossy().to_string()),
            ..Default::default()
        })
        .unwrap();

        let result = SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "native".to_string(),
                source_path: None,
                apps: SkillApps::only(&AgentType::ClaudeCode),
            }],
        );
        assert!(result.is_err(), "同步失败应返回错误");

        // 数据库记录应被回滚
        assert!(db.get_installed_skill("local:native").unwrap().is_none());

        // 恢复写权限以便临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&read_only_root, &skills_dir] {
                let mut permissions = std::fs::metadata(dir).unwrap().permissions();
                permissions.set_mode(permissions.mode() | 0o200);
                let _ = fs::set_permissions(dir, permissions);
            }
        }
        crate::settings::reset_settings_store_for_test();
    }

    #[test]
    #[serial]
    fn uninstall_aborts_when_projection_removal_fails() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        write_skill(
            &SkillService::get_ssot_dir()
                .unwrap()
                .join("uninstall-skill"),
            "Uninstall",
        );
        let skill = InstalledSkill {
            id: "owner/repo:uninstall-skill".to_string(),
            name: "Uninstall".to_string(),
            description: None,
            directory: "uninstall-skill".to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        };
        db.save_skill(&skill).unwrap();
        SkillService::sync_to_app_dir("uninstall-skill", &AgentType::ClaudeCode).unwrap();

        // 将 claude skills 目录设为只读，使投影移除失败
        let claude_skills = config::get_claude_skills_dir();
        let mut permissions = std::fs::metadata(&claude_skills).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&claude_skills, permissions).unwrap();

        let result = SkillService::uninstall(&db, &skill.id);
        assert!(result.is_err(), "投影移除失败应中止卸载");
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("UNINSTALL_PROJECTION_FAILED"));

        // SSOT 与数据库记录应保持不变
        assert!(SkillService::get_ssot_dir()
            .unwrap()
            .join("uninstall-skill")
            .exists());
        assert!(db.get_installed_skill(&skill.id).unwrap().is_some());
    }

    #[test]
    #[serial]
    fn import_from_apps_rejects_duplicate_directory_in_batch() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        // 同名不同内容的两条发现项
        write_skill(&config::get_claude_skills_dir().join("shared"), "Alpha");
        write_skill(&config::get_codex_skills_dir().join("shared"), "Beta");

        let result = SkillService::import_from_apps(
            &db,
            vec![
                ImportSkillSelection {
                    directory: "shared".to_string(),
                    source_path: Some(
                        config::get_claude_skills_dir()
                            .join("shared")
                            .to_string_lossy()
                            .to_string(),
                    ),
                    apps: SkillApps::default(),
                },
                ImportSkillSelection {
                    directory: "shared".to_string(),
                    source_path: Some(
                        config::get_codex_skills_dir()
                            .join("shared")
                            .to_string_lossy()
                            .to_string(),
                    ),
                    apps: SkillApps::default(),
                },
            ],
        );
        let payload = result
            .expect_err("同批次重复 directory 必须被拒绝")
            .to_string();
        assert!(payload.contains("IMPORT_DUPLICATE_DIRECTORY"));
        assert!(payload.contains("shared"));

        // 整个批次被拒绝：SSOT 与 DB 均无任何变化
        assert!(!SkillService::get_ssot_dir()
            .unwrap()
            .join("shared")
            .exists());
        assert!(db.get_all_installed_skills().unwrap().is_empty());
    }

    #[test]
    #[serial]
    fn import_from_apps_rolls_back_projections_and_ssot_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();
        write_skill(&config::get_claude_skills_dir().join("native"), "Native");

        // 故障注入：codex 配置目录只读，第二个 Agent 的投影同步必然失败
        let read_only_root = tmp.path().join("readonly-codex");
        let skills_dir = read_only_root.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        for dir in [&read_only_root, &skills_dir] {
            let mut permissions = std::fs::metadata(dir).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(dir, permissions).unwrap();
        }
        crate::settings::set_agent_config_dir_override(
            "codex",
            Some(read_only_root.to_string_lossy().to_string()),
        )
        .unwrap();

        let mut apps = SkillApps::only(&AgentType::ClaudeCode);
        apps.set_enabled_for(&AgentType::Codex, true);
        let result = SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "native".to_string(),
                source_path: None,
                apps,
            }],
        );
        assert!(result.is_err(), "第二个 Agent 同步失败必须返回错误");

        // Claude 目录是用户的原始未托管来源：回滚必须从同步前快照恢复，
        // 绝不允许把原始 skill 的唯一副本一并删除
        let claude_native = config::get_claude_skills_dir().join("native");
        let content = fs::read_to_string(claude_native.join("SKILL.md"))
            .expect("同步失败时原始来源目录必须被保留");
        assert!(
            content.contains("name: Native"),
            "同步失败时原始来源内容必须原样保留"
        );
        // 本次新建的 SSOT 目录必须一并删除，避免残留未受管内容导致重试被拒
        assert!(
            !SkillService::get_ssot_dir()
                .unwrap()
                .join("native")
                .exists(),
            "同步失败时本次新建的 SSOT 目录必须被删除"
        );
        // 数据库记录必须回滚
        assert!(db.get_installed_skill("local:native").unwrap().is_none());

        // 恢复写权限以便临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&read_only_root, &skills_dir] {
                let mut permissions = std::fs::metadata(dir).unwrap().permissions();
                permissions.set_mode(permissions.mode() | 0o200);
                let _ = fs::set_permissions(dir, permissions);
            }
        }
        crate::settings::reset_settings_store_for_test();
    }

    #[test]
    #[serial]
    fn restore_from_backup_removes_prior_projections_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("restore-rb"),
            "RestoreRB",
        );

        // 卸载前对 ClaudeCode 与 Codex 两个 Agent 启用
        let mut skill = installed_skill_fixture("owner/repo:restore-rb", "restore-rb");
        skill.apps = SkillApps::only(&AgentType::ClaudeCode);
        skill.apps.set_enabled_for(&AgentType::Codex, true);
        db.save_skill(&skill).unwrap();
        SkillService::sync_to_app_dir("restore-rb", &AgentType::ClaudeCode).unwrap();
        SkillService::sync_to_app_dir("restore-rb", &AgentType::Codex).unwrap();

        let result = SkillService::uninstall(&db, &skill.id).expect("uninstall");
        let backup_id = result
            .backup_path
            .unwrap()
            .split('/')
            .next_back()
            .unwrap()
            .to_string();

        // 故障注入：codex 配置目录只读，恢复时第二个 Agent 的投影同步必然失败
        let read_only_root = tmp.path().join("readonly-codex");
        let skills_dir = read_only_root.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        for dir in [&read_only_root, &skills_dir] {
            let mut permissions = std::fs::metadata(dir).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(dir, permissions).unwrap();
        }
        crate::settings::set_agent_config_dir_override(
            "codex",
            Some(read_only_root.to_string_lossy().to_string()),
        )
        .unwrap();

        SkillService::restore_from_backup(&db, &backup_id, &AgentType::ClaudeCode)
            .expect_err("第二个 Agent 同步失败必须返回错误");

        // 本次恢复创建的前序投影必须被移除
        assert!(
            !config::get_claude_skills_dir().join("restore-rb").exists(),
            "同步失败时前序 Agent 的投影必须被移除"
        );
        // DB 与 SSOT 已清理
        assert!(db.get_installed_skill(&skill.id).unwrap().is_none());
        assert!(!SkillService::get_ssot_dir()
            .unwrap()
            .join("restore-rb")
            .exists());

        // 恢复写权限以便临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&read_only_root, &skills_dir] {
                let mut permissions = std::fs::metadata(dir).unwrap().permissions();
                permissions.set_mode(permissions.mode() | 0o200);
                let _ = fs::set_permissions(dir, permissions);
            }
        }
        crate::settings::reset_settings_store_for_test();
    }

    fn installed_skill_fixture(id: &str, directory: &str) -> InstalledSkill {
        InstalledSkill {
            id: id.to_string(),
            name: directory.to_string(),
            description: None,
            directory: directory.to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::default(),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        }
    }

    #[test]
    fn rollback_skill_moves_keeps_dst_when_fallback_copy_fails() {
        let tmp = tempdir().unwrap();

        // old_root 是一个普通文件：rename 与回退复制都会失败（ENOTDIR），
        // 模拟跨文件系统回滚时回退复制也失败（如旧盘满）的场景
        let old_root = tmp.path().join("old-root");
        fs::write(&old_root, "not a directory").unwrap();
        let new_root = tmp.path().join("new-root");
        write_skill(&new_root.join("skill-a"), "Skill A");
        fs::write(new_root.join("skill-a").join("data.txt"), "precious").unwrap();

        SkillService::rollback_skill_moves(&old_root, &new_root, &["skill-a".to_string()]);

        // 回退复制失败时必须保留 dst：它可能是该 skill 唯一完整副本
        assert_eq!(
            fs::read_to_string(new_root.join("skill-a").join("data.txt")).unwrap(),
            "precious"
        );
        assert!(new_root.join("skill-a").join("SKILL.md").exists());
    }

    #[test]
    #[serial]
    fn apply_downloaded_update_lands_in_current_ssot_after_migration_during_download() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 下载开始时存储在 Hub：旧版 skill 位于 Hub SSOT
        let hub_ssot = SkillService::get_ssot_dir().unwrap();
        write_skill(&hub_ssot.join("upd-skill"), "Old");
        let previous = installed_skill_fixture("owner/repo:upd-skill", "upd-skill");
        db.save_skill(&previous).unwrap();

        // 模拟下载期间完成存储迁移：目录物理移动 + 设置切换
        let unified_root = config::get_home_dir().join(".agents").join("skills");
        fs::create_dir_all(&unified_root).unwrap();
        fs::rename(hub_ssot.join("upd-skill"), unified_root.join("upd-skill")).unwrap();
        crate::settings::set_storage_location(StorageLocation::Unified).unwrap();

        // 模拟已下载完成的新版本源
        let download = tmp.path().join("download");
        write_skill(&download.join("upd-skill"), "New");

        let updated = SkillService::apply_downloaded_update(
            &db,
            &previous,
            "owner",
            "repo",
            "main".to_string(),
            &download.join("upd-skill"),
        )
        .expect("update");

        // 新版本落在迁移后的 Unified 根，旧根不被写入新版本
        let new_content =
            fs::read_to_string(unified_root.join("upd-skill").join("SKILL.md")).unwrap();
        assert!(new_content.contains("name: New"));
        let old_root_file = hub_ssot.join("upd-skill").join("SKILL.md");
        if old_root_file.exists() {
            let old_content = fs::read_to_string(&old_root_file).unwrap();
            assert!(
                old_content.contains("name: Old"),
                "新版本绝不能写入迁移前的旧根"
            );
        }

        // 新 hash 落库，且与当前 SSOT 内容一致
        let stored = db.get_installed_skill(&previous.id).unwrap().unwrap();
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
        let hub_ssot = SkillService::get_ssot_dir().unwrap();
        crate::settings::set_storage_location(StorageLocation::Unified).unwrap();

        let download = tmp.path().join("download");
        write_skill(&download.join("new-skill"), "New Skill");

        let skill = DiscoverableSkill {
            key: "owner/repo:new-skill".to_string(),
            name: "New Skill".to_string(),
            description: "".to_string(),
            directory: "new-skill".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
        };

        let installed = SkillService::finish_install_under_lock(
            &db,
            &skill,
            "new-skill",
            &AgentType::ClaudeCode,
            "main".to_string(),
            None,
            Some(&download.join("new-skill")),
        )
        .expect("install");

        // 新版本落在迁移后的 Unified 根，旧根不被写入
        let unified = config::get_home_dir()
            .join(".agents")
            .join("skills")
            .join("new-skill");
        assert!(unified.join("SKILL.md").exists());
        assert!(!hub_ssot.join("new-skill").exists());

        assert!(db.get_installed_skill(&installed.id).unwrap().is_some());
        assert!(config::get_claude_skills_dir().join("new-skill").exists());
    }

    #[test]
    #[serial]
    fn persist_and_sync_new_skill_removes_fresh_ssot_dir_on_save_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        let dest = SkillService::get_ssot_dir().unwrap().join("doomed-skill");
        write_skill(&dest, "Doomed");

        let mut skill = installed_skill_fixture("owner/repo:doomed-skill", "doomed-skill");
        skill.apps = SkillApps::only(&AgentType::ClaudeCode);

        // 故障注入：DB 只读，保存必然失败
        {
            let conn = db.conn.lock().expect("lock conn");
            conn.execute("PRAGMA query_only = ON;", [])
                .expect("enable query_only");
        }

        let result = SkillService::persist_and_sync_new_skill(
            &db,
            &skill,
            &AgentType::ClaudeCode,
            Some(&dest),
        );
        assert!(result.is_err(), "保存失败必须返回错误");
        assert!(!dest.exists(), "保存失败时本次新建的 SSOT 目录必须一并删除");
        assert!(db.get_installed_skill(&skill.id).unwrap().is_none());
    }

    #[test]
    #[serial]
    fn persist_and_sync_new_skill_removes_fresh_ssot_dir_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        let dest = SkillService::get_ssot_dir()
            .unwrap()
            .join("sync-fail-skill");
        write_skill(&dest, "SyncFail");

        // 只读 claude 配置目录 → 投影同步必然失败
        let read_only_root = tmp.path().join("readonly-claude");
        let skills_dir = read_only_root.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        for dir in [&read_only_root, &skills_dir] {
            let mut permissions = std::fs::metadata(dir).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(dir, permissions).unwrap();
        }
        crate::settings::update_settings(crate::settings::AppSettings {
            claude_code_config_dir: Some(read_only_root.to_string_lossy().to_string()),
            ..Default::default()
        })
        .unwrap();

        let mut skill = installed_skill_fixture("owner/repo:sync-fail-skill", "sync-fail-skill");
        skill.apps = SkillApps::only(&AgentType::ClaudeCode);

        let result = SkillService::persist_and_sync_new_skill(
            &db,
            &skill,
            &AgentType::ClaudeCode,
            Some(&dest),
        );
        assert!(result.is_err(), "同步失败必须返回错误");
        assert!(!dest.exists(), "同步失败时本次新建的 SSOT 目录必须一并删除");
        assert!(db.get_installed_skill(&skill.id).unwrap().is_none());

        // 恢复写权限以便临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&read_only_root, &skills_dir] {
                let mut permissions = std::fs::metadata(dir).unwrap().permissions();
                permissions.set_mode(permissions.mode() | 0o200);
                let _ = fs::set_permissions(dir, permissions);
            }
        }
        crate::settings::reset_settings_store_for_test();
    }

    #[test]
    #[serial]
    fn persist_and_sync_new_skill_preserves_adopted_dir_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();

        let dest = SkillService::get_ssot_dir().unwrap().join("adopted-skill");
        write_skill(&dest, "Adopted");

        let read_only_root = tmp.path().join("readonly-claude");
        let skills_dir = read_only_root.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        for dir in [&read_only_root, &skills_dir] {
            let mut permissions = std::fs::metadata(dir).unwrap().permissions();
            permissions.set_readonly(true);
            fs::set_permissions(dir, permissions).unwrap();
        }
        crate::settings::update_settings(crate::settings::AppSettings {
            claude_code_config_dir: Some(read_only_root.to_string_lossy().to_string()),
            ..Default::default()
        })
        .unwrap();

        let mut skill = installed_skill_fixture("owner/repo:adopted-skill", "adopted-skill");
        skill.apps = SkillApps::only(&AgentType::ClaudeCode);

        // fresh_ssot_dir 为 None：目录是接管/既有的，回滚时绝不能删除
        let result =
            SkillService::persist_and_sync_new_skill(&db, &skill, &AgentType::ClaudeCode, None);
        assert!(result.is_err(), "同步失败必须返回错误");
        assert!(
            dest.join("SKILL.md").exists(),
            "接管/既有的 SSOT 目录绝不能被回滚删除"
        );
        assert!(db.get_installed_skill(&skill.id).unwrap().is_none());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&read_only_root, &skills_dir] {
                let mut permissions = std::fs::metadata(dir).unwrap().permissions();
                permissions.set_mode(permissions.mode() | 0o200);
                let _ = fs::set_permissions(dir, permissions);
            }
        }
        crate::settings::reset_settings_store_for_test();
    }

    #[test]
    #[serial]
    fn sync_rejects_overlapping_app_skills_dir() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        // override 的 skills 目录落在 SSOT 内部（父子重叠）：symlink 会造成
        // 文件系统环，copy 会把临时目标递归拷进自身，必须拒绝
        let ssot = SkillService::get_ssot_dir().unwrap();
        crate::settings::set_agent_config_dir_override(
            "claude-code",
            Some(ssot.join("nested").to_string_lossy().to_string()),
        )
        .unwrap();
        write_skill(&ssot.join("overlap-skill"), "Overlap");

        let err = SkillService::sync_to_app_dir("overlap-skill", &AgentType::ClaudeCode)
            .expect_err("父子重叠的 skills 目录必须被拒绝");
        assert!(err.to_string().contains("SKILL_STORAGE_OVERLAP"));
    }

    #[test]
    #[serial]
    fn install_same_repo_different_source_conflicts() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("reviewer"),
            "ReviewerA",
        );

        let mut existing = installed_skill_fixture("owner/repo:a/reviewer", "reviewer");
        existing.apps = SkillApps::only(&AgentType::ClaudeCode);
        db.save_skill(&existing).unwrap();

        // 同一仓库的 b/reviewer：sanitize 后安装名相同，但来源身份不同，
        // 必须报冲突而不是复用并启用第一个的内容
        let discoverable = DiscoverableSkill {
            key: "owner/repo:b/reviewer".to_string(),
            name: "Reviewer B".to_string(),
            description: "".to_string(),
            directory: "b/reviewer".to_string(),
            readme_url: None,
            repo_owner: "owner".to_string(),
            repo_name: "repo".to_string(),
            repo_branch: "main".to_string(),
        };

        let err =
            SkillService::reuse_existing_install(&db, &discoverable, "reviewer", &AgentType::Codex)
                .expect_err("同名不同来源必须报冲突");
        assert!(err.to_string().contains("SKILL_DIRECTORY_CONFLICT"));

        // 已装内容未被覆盖，启用状态未变
        let stored = db.get_installed_skill(&existing.id).unwrap().unwrap();
        assert!(stored.apps.claude_code);
        assert!(!stored.apps.codex);
        let content = fs::read_to_string(
            SkillService::get_ssot_dir()
                .unwrap()
                .join("reviewer")
                .join("SKILL.md"),
        )
        .unwrap();
        assert!(content.contains("name: ReviewerA"));
    }

    #[test]
    #[serial]
    fn migrate_storage_fails_when_source_dir_not_removable() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        let old_dir = SkillService::get_ssot_dir().unwrap();
        write_skill(&old_dir.join("mig-src"), "MigSrc");
        let skill = installed_skill_fixture("owner/repo:mig-src", "mig-src");
        db.save_skill(&skill).unwrap();

        // 故障注入：旧根只读 → rename 失败回退为 copy，copy 成功但源目录删除失败
        let mut permissions = std::fs::metadata(&old_dir).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&old_dir, permissions).unwrap();

        let result = crate::commands::migrate_storage_combined(&db, StorageLocation::Unified);

        // 恢复写权限以便断言与临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&old_dir).unwrap().permissions();
            permissions.set_mode(permissions.mode() | 0o200);
            let _ = fs::set_permissions(&old_dir, permissions);
        }

        assert!(result.is_err(), "源目录删除失败必须按迁移失败处理");
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("MIGRATION_ABORTED"));

        // 目标副本必须被回滚删除，源目录保留，存储设置未切换
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("skills")
            .join("mig-src")
            .exists());
        assert!(old_dir.join("mig-src").exists());
        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Hub
        );
    }

    #[test]
    #[serial]
    fn import_from_apps_conflicts_with_different_unmanaged_ssot_content() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        // SSOT 预置未纳管 shared=A，Agent 预置同名不同内容 shared=B，用户只选 B
        let ssot = SkillService::get_ssot_dir().unwrap();
        write_skill(&ssot.join("shared"), "Alpha");
        let codex_shared = config::get_codex_skills_dir().join("shared");
        write_skill(&codex_shared, "Beta");

        let result = SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "shared".to_string(),
                source_path: Some(codex_shared.to_string_lossy().to_string()),
                apps: SkillApps::default(),
            }],
        );
        let payload = result
            .expect_err("SSOT 与所选来源内容不同必须报冲突")
            .to_string();
        assert!(payload.contains("SKILL_DIRECTORY_CONFLICT"));

        // 双方内容均保持不变，且未落库
        let ssot_content = fs::read_to_string(ssot.join("shared").join("SKILL.md")).unwrap();
        assert!(ssot_content.contains("name: Alpha"));
        let agent_content = fs::read_to_string(codex_shared.join("SKILL.md")).unwrap();
        assert!(agent_content.contains("name: Beta"));
        assert!(db.get_all_installed_skills().unwrap().is_empty());
    }

    #[test]
    #[serial]
    fn import_from_apps_adopts_when_unmanaged_ssot_content_matches() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        let db = Arc::new(Database::memory().unwrap());
        crate::settings::set_sync_method(SyncMethod::Copy).unwrap();
        // SSOT 与所选 Agent 来源内容一致：正常完成导入
        let ssot = SkillService::get_ssot_dir().unwrap();
        write_skill(&ssot.join("shared"), "Same");
        let claude_shared = config::get_claude_skills_dir().join("shared");
        write_skill(&claude_shared, "Same");

        let imported = SkillService::import_from_apps(
            &db,
            vec![ImportSkillSelection {
                directory: "shared".to_string(),
                source_path: Some(claude_shared.to_string_lossy().to_string()),
                apps: SkillApps::only(&AgentType::ClaudeCode),
            }],
        )
        .expect("内容一致应正常完成导入");
        assert_eq!(imported.len(), 1);
        assert!(db.get_installed_skill("local:shared").unwrap().is_some());
        assert!(claude_shared.join("SKILL.md").exists());
    }
}
