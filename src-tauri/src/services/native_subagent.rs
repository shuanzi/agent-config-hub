//! Native per-Agent Subagent discovery and lifecycle management.
//!
//! Unlike the legacy `subagent` service, this module never projects one Markdown
//! file into several incompatible runtimes. It discovers each runtime's native
//! format in place and keeps an explicit, per-Agent registry for files the user
//! chooses to manage.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::config;
use crate::database::Database;
use crate::error::{format_subagent_error, AppError};
use crate::services::project::{ConfigContext, ProjectService, ScopeTarget};
use crate::services::skill::{AgentType, SkillService};
use crate::services::subagent::subagent_state_write_guard;

const NATIVE_BACKUP_RETAIN_COUNT: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeSubagentFormat {
    Markdown,
    Toml,
    Json,
    JsoncEntry,
    LegacyMarkdown,
}

impl NativeSubagentFormat {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Toml => "toml",
            Self::Json => "json",
            Self::JsoncEntry => "jsonc-entry",
            Self::LegacyMarkdown => "legacy-markdown",
        }
    }

    pub(crate) fn from_db(value: &str) -> Result<Self, AppError> {
        match value {
            "markdown" => Ok(Self::Markdown),
            "toml" => Ok(Self::Toml),
            "json" => Ok(Self::Json),
            "jsonc-entry" => Ok(Self::JsoncEntry),
            "legacy-markdown" => Ok(Self::LegacyMarkdown),
            _ => Err(AppError::Database(format!(
                "未知原生 Subagent 格式: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeSubagentSourceKind {
    File,
    ConfigEntry,
    Legacy,
}

impl NativeSubagentSourceKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::ConfigEntry => "config-entry",
            Self::Legacy => "legacy",
        }
    }

    pub(crate) fn from_db(value: &str) -> Result<Self, AppError> {
        match value {
            "file" => Ok(Self::File),
            "config-entry" => Ok(Self::ConfigEntry),
            "legacy" => Ok(Self::Legacy),
            _ => Err(AppError::Database(format!(
                "未知原生 Subagent 来源类型: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeSubagentManagementStatus {
    Unmanaged,
    Managed,
    Disabled,
    Invalid,
    LegacyReview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentDiagnostic {
    pub severity: NativeDiagnosticSeverity,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentDefinition {
    pub identity: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub agent: String,
    pub target: ScopeTarget,
    pub format: NativeSubagentFormat,
    pub source_kind: NativeSubagentSourceKind,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_key: Option<String>,
    pub management_status: NativeSubagentManagementStatus,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    pub is_symlink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symlink_target: Option<String>,
    #[serde(default)]
    pub diagnostics: Vec<NativeSubagentDiagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentScanResult {
    pub definitions: Vec<NativeSubagentDefinition>,
    pub scan_errors: Vec<NativeSubagentDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentContent {
    pub definition: NativeSubagentDefinition,
    pub content: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentMutationResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<NativeSubagentDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentBackup {
    pub backup_id: String,
    pub identity: String,
    pub name: String,
    pub agent: String,
    pub target: ScopeTarget,
    pub format: NativeSubagentFormat,
    pub source_path: String,
    pub content_hash: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub legacy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentUpdateInfo {
    pub identity: String,
    pub name: String,
    pub has_update: bool,
    pub locally_modified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_hash: Option<String>,
    #[serde(default)]
    pub diagnostics: Vec<NativeSubagentDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentUpdatePreview {
    pub identity: String,
    pub current_content: String,
    pub next_content: String,
    pub current_hash: String,
    pub remote_hash: String,
    pub locally_modified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubagentDiscovery {
    pub key: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub repo_branch: String,
    pub format: NativeSubagentFormat,
    pub compatible_agents: Vec<String>,
}

/// Database representation. Kept crate-private so SQLite details cannot leak
/// into the Tauri wire contract.
#[derive(Debug, Clone)]
pub(crate) struct NativeSubagentRecord {
    pub definition: NativeSubagentDefinition,
    pub disabled_path: Option<String>,
    pub upstream_hash: Option<String>,
    pub adopted_symlink: bool,
    pub installed_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct NativeSubagentBackupRecord {
    pub backup: NativeSubagentBackup,
    pub definition_json: String,
    pub content: Vec<u8>,
    pub source_document_hash: String,
    pub unix_mode: Option<u32>,
}

pub struct NativeSubagentService;

impl Default for NativeSubagentService {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeSubagentService {
    pub fn new() -> Self {
        Self
    }

    pub async fn discover(
        db: &Arc<Database>,
        target: &ScopeTarget,
    ) -> Result<Vec<NativeSubagentDiscovery>, AppError> {
        ProjectService::resolve_scope_target(db, target)?;
        let repos = db.get_subagent_repos()?;
        let mut discovered = Vec::new();
        let enabled_repos: Vec<_> = repos.into_iter().filter(|repo| repo.enabled).collect();
        let mut failures = Vec::new();
        for repo in &enabled_repos {
            let skill_repo = crate::services::skill::SkillRepo {
                owner: repo.owner.clone(),
                name: repo.name.clone(),
                branch: repo.branch.clone(),
                enabled: true,
            };
            let skill_service = SkillService::new();
            let client = skill_service.download_client();
            let (temporary, resolved_branch) =
                match SkillService::download_repo_with_timeout(&client, &skill_repo).await {
                    Ok(result) => result,
                    Err(error) => {
                        log::warn!(
                            "发现原生 Subagent 时下载 {}/{} 失败: {error}",
                            repo.owner,
                            repo.name
                        );
                        failures.push(format!("{}/{}: {error}", repo.owner, repo.name));
                        continue;
                    }
                };
            scan_discovery_repo(
                temporary.path(),
                &repo.owner,
                &repo.name,
                &resolved_branch,
                &mut discovered,
            )?;
        }
        discovered.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.key.cmp(&right.key))
        });
        discovered.dedup_by(|left, right| left.key == right.key);
        if !enabled_repos.is_empty() && failures.len() == enabled_repos.len() {
            return Err(native_error(
                "NATIVE_SUBAGENT_DISCOVERY_FAILED",
                &[("failures", &failures.join("; "))],
                Some("checkNetwork"),
            ));
        }
        Ok(discovered)
    }

    pub async fn install(
        db: &Arc<Database>,
        subagent: &NativeSubagentDiscovery,
        target: &ScopeTarget,
        agent: AgentType,
    ) -> Result<NativeSubagentDefinition, AppError> {
        ProjectService::resolve_scope_target(db, target)?;
        if !subagent
            .compatible_agents
            .iter()
            .any(|candidate| AgentType::from_str(candidate).ok() == Some(agent))
        {
            return Err(native_error(
                "NATIVE_SUBAGENT_INCOMPATIBLE_AGENT",
                &[("agent", agent.as_str()), ("path", &subagent.path)],
                Some("selectCompatibleAgent"),
            ));
        }
        SkillService::validate_repo_ref(
            &subagent.repo_owner,
            &subagent.repo_name,
            &subagent.repo_branch,
        )?;
        let relative = safe_relative_path(&subagent.path)?;
        let repo = crate::services::skill::SkillRepo {
            owner: subagent.repo_owner.clone(),
            name: subagent.repo_name.clone(),
            branch: subagent.repo_branch.clone(),
            enabled: true,
        };
        let skill_service = SkillService::new();
        let client = skill_service.download_client();
        let (temporary, resolved_branch) =
            SkillService::download_repo_with_timeout(&client, &repo).await?;
        let source = temporary.path().join(&relative);
        let content = fs::read_to_string(&source).map_err(|error| AppError::io(&source, error))?;
        let source_kind = NativeSubagentSourceKind::File;
        validate_native_content(agent, subagent.format, source_kind, &content)?;
        let _guard = subagent_state_write_guard();
        // Target availability and ownership are revalidated after network I/O.
        let resolved = ProjectService::resolve_scope_target(db, target)?;
        let expected_extension = match subagent.format {
            NativeSubagentFormat::Markdown => "md",
            NativeSubagentFormat::Toml => "toml",
            _ => {
                return Err(AppError::InvalidInput(
                    "发现安装只支持独立 Markdown 或 TOML 文件".to_string(),
                ))
            }
        };
        let raw_stem = relative
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or_else(|| AppError::InvalidInput("发现项文件名无效".to_string()))?;
        let stem = SkillService::sanitize_install_name(raw_stem)
            .ok_or_else(|| AppError::InvalidInput("发现项安装名称无效".to_string()))?;
        let destination_dir = native_agents_dir(resolved.project_root.as_deref(), agent);
        let safety_root = native_safety_root(resolved.project_root.as_deref(), agent);
        let destination = destination_dir.join(format!("{stem}.{expected_extension}"));
        if let Some((ancestor, resolved_path)) = ancestor_symlink_within(&destination, &safety_root)
        {
            let ancestor = ancestor.display().to_string();
            let resolved_path = resolved_path.display().to_string();
            return Err(native_error(
                "NATIVE_SUBAGENT_ANCESTOR_SYMLINK_UNSAFE",
                &[("ancestor", &ancestor), ("resolvedPath", &resolved_path)],
                Some("useRegularAgentDirectory"),
            ));
        }
        if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
            return Err(native_error(
                "NATIVE_SUBAGENT_DESTINATION_CONFLICT",
                &[("path", &destination.display().to_string())],
                Some("adoptOrRename"),
            ));
        }
        fs::create_dir_all(&destination_dir)
            .map_err(|error| AppError::io(&destination_dir, error))?;
        config::atomic_write(&destination, content.as_bytes())?;
        let parsed = match agent {
            AgentType::Codex => {
                let value: toml::Value = toml::from_str(&content)
                    .map_err(|error| AppError::InvalidInput(format!("TOML 无效: {error}")))?;
                (
                    value
                        .get("name")
                        .and_then(toml::Value::as_str)
                        .unwrap_or(&subagent.name)
                        .to_string(),
                    value
                        .get("description")
                        .and_then(toml::Value::as_str)
                        .map(str::to_string),
                )
            }
            _ => {
                let metadata = parse_markdown_metadata(&content)?;
                (
                    metadata
                        .get("name")
                        .and_then(serde_yaml::Value::as_str)
                        .unwrap_or(&subagent.name)
                        .to_string(),
                    metadata
                        .get("description")
                        .and_then(serde_yaml::Value::as_str)
                        .map(str::to_string),
                )
            }
        };
        let mut definition = file_definition(
            target,
            agent,
            subagent.format,
            &destination,
            &safety_root,
            parsed.0,
            parsed.1,
            Vec::new(),
        )?;
        definition.management_status = NativeSubagentManagementStatus::Managed;
        definition.repo_owner = Some(subagent.repo_owner.clone());
        definition.repo_name = Some(subagent.repo_name.clone());
        definition.repo_branch = Some(resolved_branch);
        definition.repo_path = Some(subagent.path.clone());
        let record = NativeSubagentRecord {
            definition: definition.clone(),
            disabled_path: None,
            upstream_hash: definition.content_hash.clone(),
            adopted_symlink: false,
            installed_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
        };
        if let Err(error) = db.save_native_subagent_record(&record) {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
        Ok(definition)
    }

    pub fn scan(
        db: &Arc<Database>,
        context: &ConfigContext,
    ) -> Result<NativeSubagentScanResult, AppError> {
        let mut result = NativeSubagentScanResult {
            definitions: Vec::new(),
            scan_errors: Vec::new(),
        };

        match context {
            ConfigContext::Global => {
                Self::scan_target(db, &ScopeTarget::Global, &mut result)?;
            }
            ConfigContext::Project { project_id } => {
                Self::scan_target(
                    db,
                    &ScopeTarget::Project {
                        project_id: project_id.clone(),
                    },
                    &mut result,
                )?;
            }
            ConfigContext::All => {
                Self::scan_target(db, &ScopeTarget::Global, &mut result)?;
                for project in ProjectService::list_projects(db)? {
                    let target = ScopeTarget::Project {
                        project_id: project.project_id,
                    };
                    if let Err(error) = Self::scan_target(db, &target, &mut result) {
                        result.scan_errors.push(diagnostic(
                            NativeDiagnosticSeverity::Error,
                            "PROJECT_SCAN_FAILED",
                            error.to_string(),
                        ));
                    }
                }
            }
        }

        let records = db.get_native_subagent_records_for_context(context)?;
        Self::merge_records(&mut result.definitions, records);
        result
            .definitions
            .extend(db.get_legacy_native_subagent_definitions(context)?);

        let mut seen = HashSet::new();
        result
            .definitions
            .retain(|definition| seen.insert(definition.identity.clone()));
        append_name_collision_diagnostics(&mut result.definitions);
        result.definitions.sort_by(|a, b| {
            target_sort_key(&a.target)
                .cmp(&target_sort_key(&b.target))
                .then_with(|| a.agent.cmp(&b.agent))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.source_path.cmp(&b.source_path))
        });
        Ok(result)
    }

    fn scan_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        result: &mut NativeSubagentScanResult,
    ) -> Result<(), AppError> {
        let resolved = ProjectService::resolve_scope_target(db, target)?;
        let project_root = resolved.project_root.as_deref();

        for agent in AgentType::all() {
            let root = native_agents_dir(project_root, agent);
            let safety_root = native_safety_root(project_root, agent);
            match agent {
                AgentType::ClaudeCode => Self::scan_markdown_dir(
                    target,
                    agent,
                    &root,
                    &safety_root,
                    true,
                    MarkdownPolicy::RequireName,
                    result,
                ),
                AgentType::Codex => Self::scan_codex_dir(target, &root, &safety_root, result),
                AgentType::GeminiCli => Self::scan_markdown_dir(
                    target,
                    agent,
                    &root,
                    &safety_root,
                    false,
                    MarkdownPolicy::RequireName,
                    result,
                ),
                AgentType::OpenCode => {
                    Self::scan_markdown_dir(
                        target,
                        agent,
                        &root,
                        &safety_root,
                        true,
                        MarkdownPolicy::OpenCode,
                        result,
                    );
                    Self::scan_opencode_config(target, project_root, result);
                }
            }
        }
        Ok(())
    }

    fn scan_markdown_dir(
        target: &ScopeTarget,
        agent: AgentType,
        root: &Path,
        safety_root: &Path,
        recursive: bool,
        policy: MarkdownPolicy,
        result: &mut NativeSubagentScanResult,
    ) {
        if !root.exists() {
            return;
        }
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let entries = match fs::read_dir(&dir) {
                Ok(entries) => entries,
                Err(error) => {
                    result.scan_errors.push(diagnostic(
                        NativeDiagnosticSeverity::Error,
                        "DIRECTORY_UNREADABLE",
                        format!("{}: {error}", dir.display()),
                    ));
                    continue;
                }
            };
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => {
                        result.scan_errors.push(diagnostic(
                            NativeDiagnosticSeverity::Warning,
                            "DIRECTORY_ENTRY_UNREADABLE",
                            format!("{}: {error}", dir.display()),
                        ));
                        continue;
                    }
                };
                let path = entry.path();
                let metadata = match fs::symlink_metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        result.scan_errors.push(diagnostic(
                            NativeDiagnosticSeverity::Warning,
                            "METADATA_UNREADABLE",
                            format!("{}: {error}", path.display()),
                        ));
                        continue;
                    }
                };
                if metadata.file_type().is_symlink() && path.is_dir() {
                    result.scan_errors.push(diagnostic(
                        NativeDiagnosticSeverity::Info,
                        "SYMLINK_DIRECTORY_SKIPPED",
                        path.display().to_string(),
                    ));
                    continue;
                }
                if metadata.is_dir() {
                    if recursive {
                        stack.push(path);
                    }
                    continue;
                }
                if path.extension().and_then(|value| value.to_str()) != Some("md") {
                    continue;
                }
                match Self::definition_from_markdown(target, agent, &path, safety_root, policy) {
                    Ok(Some(definition)) => result.definitions.push(definition),
                    Ok(None) => {}
                    Err(error) => result.definitions.push(invalid_file_definition(
                        target,
                        agent,
                        NativeSubagentFormat::Markdown,
                        &path,
                        error.to_string(),
                    )),
                }
            }
        }
    }

    fn definition_from_markdown(
        target: &ScopeTarget,
        agent: AgentType,
        path: &Path,
        safety_root: &Path,
        policy: MarkdownPolicy,
    ) -> Result<Option<NativeSubagentDefinition>, AppError> {
        let content = fs::read_to_string(path).map_err(|error| AppError::io(path, error))?;
        let metadata = parse_markdown_metadata(&content)?;
        if policy == MarkdownPolicy::OpenCode {
            let mode = metadata
                .get("mode")
                .and_then(serde_yaml::Value::as_str)
                .unwrap_or("all");
            if !matches!(mode, "subagent" | "all") {
                return Ok(None);
            }
        }
        let stem = file_stem(path)?;
        let name = metadata
            .get("name")
            .and_then(serde_yaml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| (policy == MarkdownPolicy::OpenCode).then_some(stem.clone()))
            .ok_or_else(|| AppError::InvalidInput("缺少 name frontmatter".to_string()))?;
        let description = metadata
            .get("description")
            .and_then(serde_yaml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let mut definition = file_definition(
            target,
            agent,
            NativeSubagentFormat::Markdown,
            path,
            safety_root,
            name,
            description,
            Vec::new(),
        )?;
        if policy == MarkdownPolicy::OpenCode {
            definition.enabled = !metadata
                .get("disable")
                .and_then(serde_yaml::Value::as_bool)
                .unwrap_or(false);
        }
        Ok(Some(definition))
    }

    fn scan_codex_dir(
        target: &ScopeTarget,
        root: &Path,
        safety_root: &Path,
        result: &mut NativeSubagentScanResult,
    ) {
        if !root.exists() {
            return;
        }
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(error) => {
                result.scan_errors.push(diagnostic(
                    NativeDiagnosticSeverity::Error,
                    "DIRECTORY_UNREADABLE",
                    format!("{}: {error}", root.display()),
                ));
                return;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let parsed = (|| -> Result<NativeSubagentDefinition, AppError> {
                let content =
                    fs::read_to_string(&path).map_err(|error| AppError::io(&path, error))?;
                let value: toml::Value =
                    toml::from_str(&content).map_err(|error| AppError::toml(&path, error))?;
                let mut diagnostics = Vec::new();
                let name = value
                    .get("name")
                    .and_then(toml::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        diagnostics.push(diagnostic(
                            NativeDiagnosticSeverity::Warning,
                            "NAME_FROM_FILENAME",
                            "TOML 未声明 name，使用文件名展示".to_string(),
                        ));
                        file_stem(&path).unwrap_or_else(|_| "unnamed".to_string())
                    });
                let description = value
                    .get("description")
                    .and_then(toml::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                file_definition(
                    target,
                    AgentType::Codex,
                    NativeSubagentFormat::Toml,
                    &path,
                    safety_root,
                    name,
                    description,
                    diagnostics,
                )
            })();
            match parsed {
                Ok(definition) => result.definitions.push(definition),
                Err(error) => result.definitions.push(invalid_file_definition(
                    target,
                    AgentType::Codex,
                    NativeSubagentFormat::Toml,
                    &path,
                    error.to_string(),
                )),
            }
        }
    }

    fn scan_opencode_config(
        target: &ScopeTarget,
        project_root: Option<&Path>,
        result: &mut NativeSubagentScanResult,
    ) {
        let candidates = opencode_config_candidates(project_root);
        for path in candidates.into_iter().filter(|path| path.exists()) {
            let content = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(error) => {
                    result.scan_errors.push(diagnostic(
                        NativeDiagnosticSeverity::Error,
                        "CONFIG_UNREADABLE",
                        format!("{}: {error}", path.display()),
                    ));
                    continue;
                }
            };
            let value = match parse_jsonc(&content) {
                Ok(value) => value,
                Err(error) => {
                    result.scan_errors.push(diagnostic(
                        NativeDiagnosticSeverity::Error,
                        "CONFIG_INVALID",
                        format!("{}: {error}", path.display()),
                    ));
                    continue;
                }
            };
            let Some(entries) = value.get("agent").and_then(JsonValue::as_object) else {
                continue;
            };
            for (key, entry) in entries {
                let Some(object) = entry.as_object() else {
                    continue;
                };
                let mode = object
                    .get("mode")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("all");
                if !matches!(mode, "subagent" | "all") {
                    continue;
                }
                let description = object
                    .get("description")
                    .and_then(JsonValue::as_str)
                    .map(str::to_string);
                let hash = hash_bytes(content.as_bytes());
                let enabled = !object
                    .get("disable")
                    .and_then(JsonValue::as_bool)
                    .unwrap_or(false);
                let mut definition = NativeSubagentDefinition {
                    identity: native_identity(target, AgentType::OpenCode, &path, Some(key)),
                    name: key.clone(),
                    description,
                    agent: AgentType::OpenCode.as_str().to_string(),
                    target: target.clone(),
                    format: if path.extension().and_then(|v| v.to_str()) == Some("jsonc") {
                        NativeSubagentFormat::JsoncEntry
                    } else {
                        NativeSubagentFormat::Json
                    },
                    source_kind: NativeSubagentSourceKind::ConfigEntry,
                    source_path: path.display().to_string(),
                    source_key: Some(key.clone()),
                    management_status: NativeSubagentManagementStatus::Unmanaged,
                    enabled,
                    content_hash: Some(hash),
                    is_symlink: fs::symlink_metadata(&path)
                        .map(|metadata| metadata.file_type().is_symlink())
                        .unwrap_or(false),
                    symlink_target: fs::read_link(&path)
                        .ok()
                        .map(|target| target.display().to_string()),
                    diagnostics: Vec::new(),
                    repo_owner: None,
                    repo_name: None,
                    repo_branch: None,
                    repo_path: None,
                };
                let safety_root = project_root
                    .map(Path::to_path_buf)
                    .unwrap_or_else(config::get_opencode_config_dir);
                append_ancestor_symlink_diagnostic(&mut definition, &safety_root);
                result.definitions.push(definition);
            }
        }
    }

    fn merge_records(
        definitions: &mut Vec<NativeSubagentDefinition>,
        records: Vec<NativeSubagentRecord>,
    ) {
        let mut positions: HashMap<String, usize> = definitions
            .iter()
            .enumerate()
            .map(|(index, definition)| (definition.identity.clone(), index))
            .collect();
        for record in records {
            if let Some(index) = positions.get(&record.definition.identity).copied() {
                let scanned = &mut definitions[index];
                if scanned.management_status != NativeSubagentManagementStatus::Invalid {
                    // Scanned native state wins for in-place files/config entries.
                    // Physically disabled files are absent from the scan and take
                    // the separate missing-source branch below.
                    scanned.management_status = if scanned.enabled {
                        NativeSubagentManagementStatus::Managed
                    } else {
                        NativeSubagentManagementStatus::Disabled
                    };
                }
                scanned.repo_owner = record.definition.repo_owner.clone();
                scanned.repo_name = record.definition.repo_name.clone();
                scanned.repo_branch = record.definition.repo_branch.clone();
                scanned.repo_path = record.definition.repo_path.clone();
                if scanned.content_hash != record.definition.content_hash {
                    scanned.diagnostics.push(diagnostic(
                        NativeDiagnosticSeverity::Warning,
                        "EXTERNAL_MODIFICATION",
                        "文件内容自上次读取后已改变".to_string(),
                    ));
                }
            } else {
                let mut definition = record.definition;
                definition.management_status = if definition.enabled {
                    NativeSubagentManagementStatus::Invalid
                } else {
                    NativeSubagentManagementStatus::Disabled
                };
                if definition.enabled {
                    definition.diagnostics.push(diagnostic(
                        NativeDiagnosticSeverity::Error,
                        "MANAGED_SOURCE_MISSING",
                        "受管来源已不存在".to_string(),
                    ));
                }
                positions.insert(definition.identity.clone(), definitions.len());
                definitions.push(definition);
            }
        }
    }

    pub fn read(db: &Arc<Database>, identity: &str) -> Result<NativeSubagentContent, AppError> {
        let mut definition = Self::resolve_definition(db, identity)?;
        reject_legacy(&definition)?;
        let (content, content_hash) = read_definition_content(db, &definition)?;
        let path = effective_definition_path(db, &definition)?;
        let parsed = definition_from_existing_source(&definition, &path)?;
        definition.name = parsed.name;
        definition.description = parsed.description;
        if db
            .get_native_subagent_record(identity)?
            .and_then(|record| record.disabled_path)
            .is_none()
        {
            definition.enabled = parsed.enabled;
            definition.management_status = parsed.management_status;
        }
        definition.content_hash = Some(content_hash.clone());
        Ok(NativeSubagentContent {
            definition,
            content,
            content_hash,
        })
    }

    pub fn adopt(
        db: &Arc<Database>,
        identity: &str,
        expected_hash: &str,
        confirm_symlink: bool,
    ) -> Result<NativeSubagentDefinition, AppError> {
        let _guard = subagent_state_write_guard();
        let mut definition = Self::resolve_unmanaged_definition(db, identity)?;
        reject_legacy(&definition)?;
        validate_definition_scope(db, &definition)?;
        if definition.is_symlink && !confirm_symlink {
            return Err(native_error(
                "NATIVE_SUBAGENT_SYMLINK_CONFIRMATION_REQUIRED",
                &[("identity", identity)],
                Some("confirmSymlink"),
            ));
        }
        assert_expected_hash(definition.content_hash.as_deref(), expected_hash, identity)?;
        validate_definition_on_disk(&definition)?;
        let backup = Self::create_backup_unlocked(db, &definition)?;
        let adopted_symlink = definition.is_symlink;
        let original_link_target = definition.symlink_target.clone();
        if adopted_symlink {
            // Replace only the link entry with an independent regular file. Reading
            // follows the link, while atomic rename replaces the link itself and
            // leaves the external target untouched.
            let link_path = PathBuf::from(&definition.source_path);
            let target_content =
                fs::read(&link_path).map_err(|error| AppError::io(&link_path, error))?;
            config::atomic_write(&link_path, &target_content)?;
            definition.is_symlink = false;
            definition.symlink_target = None;
            definition.content_hash = Some(hash_bytes(&target_content));
            definition.diagnostics.push(diagnostic(
                NativeDiagnosticSeverity::Info,
                "SYMLINK_REPLACED_WITH_INDEPENDENT_COPY",
                "已在原链接位置建立独立副本，外部链接目标未修改".to_string(),
            ));
        }
        definition.management_status = if definition.enabled {
            NativeSubagentManagementStatus::Managed
        } else {
            NativeSubagentManagementStatus::Disabled
        };
        let record = NativeSubagentRecord {
            definition: definition.clone(),
            disabled_path: None,
            upstream_hash: None,
            adopted_symlink,
            installed_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
        };
        if let Err(error) = db.save_native_subagent_record(&record) {
            let _ = db.delete_native_subagent_backup(&backup.backup_id);
            if adopted_symlink {
                let link_path = PathBuf::from(&definition.source_path);
                let _ = fs::remove_file(&link_path);
                if let Some(target) = original_link_target {
                    let _ = create_symlink(Path::new(&target), &link_path);
                }
            }
            return Err(error);
        }
        Ok(definition)
    }

    pub fn save(
        db: &Arc<Database>,
        identity: &str,
        content: &str,
        expected_hash: &str,
    ) -> Result<NativeSubagentContent, AppError> {
        Self::save_with_upstream(db, identity, content, expected_hash, None)
    }

    fn save_with_upstream(
        db: &Arc<Database>,
        identity: &str,
        content: &str,
        expected_hash: &str,
        next_upstream_hash: Option<&str>,
    ) -> Result<NativeSubagentContent, AppError> {
        let _guard = subagent_state_write_guard();
        let mut record = require_managed_record(db, identity)?;
        reject_legacy(&record.definition)?;
        if record.definition.is_symlink {
            return Err(native_error(
                "NATIVE_SUBAGENT_SYMLINK_READ_ONLY",
                &[("identity", identity)],
                Some("replaceSymlinkWithFile"),
            ));
        }
        validate_native_content(
            AgentType::from_str(&record.definition.agent)?,
            record.definition.format,
            record.definition.source_kind,
            content,
        )?;
        let path = effective_record_path(&record);
        let source_document = fs::read(&path).map_err(|error| AppError::io(&path, error))?;
        let current_hash = hash_bytes(&source_document);
        assert_expected_hash(Some(&current_hash), expected_hash, identity)?;
        let _backup = Self::create_backup_unlocked(db, &record.definition)?;

        let new_document = if record.definition.source_kind == NativeSubagentSourceKind::ConfigEntry
        {
            replace_jsonc_entry_value(
                std::str::from_utf8(&source_document)
                    .map_err(|_| AppError::InvalidInput("配置文件不是 UTF-8".to_string()))?,
                record.definition.source_key.as_deref().ok_or_else(|| {
                    AppError::Database("config-entry 缺少 source_key".to_string())
                })?,
                content,
            )?
            .into_bytes()
        } else {
            content.as_bytes().to_vec()
        };
        config::atomic_write(&path, &new_document)?;
        let new_hash = hash_bytes(&new_document);
        let parsed = definition_from_existing_source(&record.definition, &path)?;
        record.definition.name = parsed.name;
        record.definition.description = parsed.description;
        // A file moved into the managed disabled store stays disabled even when
        // its source text itself has no native disable field. Config entries and
        // in-place OpenCode Markdown definitions derive state from their source.
        if record.definition.source_kind == NativeSubagentSourceKind::ConfigEntry
            || record.disabled_path.is_none()
        {
            record.definition.enabled = parsed.enabled;
            record.definition.management_status = parsed.management_status;
        }
        record.definition.content_hash = Some(new_hash.clone());
        if let Some(upstream_hash) = next_upstream_hash {
            record.upstream_hash = Some(upstream_hash.to_string());
        }
        record.updated_at = chrono::Utc::now().timestamp();
        if let Err(error) = db.save_native_subagent_record(&record) {
            if let Err(rollback_error) = config::atomic_write(&path, &source_document) {
                log::error!("原生 Subagent DB 写入失败后的文件回滚也失败: {rollback_error}");
            }
            return Err(error);
        }
        Ok(NativeSubagentContent {
            definition: record.definition,
            content: content.to_string(),
            content_hash: new_hash,
        })
    }

    pub fn set_enabled(
        db: &Arc<Database>,
        identity: &str,
        enabled: bool,
        expected_hash: &str,
    ) -> Result<NativeSubagentDefinition, AppError> {
        let mut record = require_managed_record(db, identity)?;
        if record.disabled_path.is_none() {
            let path = PathBuf::from(&record.definition.source_path);
            let parsed = definition_from_existing_source(&record.definition, &path)?;
            record.definition.enabled = parsed.enabled;
            record.definition.management_status = parsed.management_status;
        }
        if record.definition.enabled == enabled {
            return Ok(record.definition);
        }
        reject_legacy(&record.definition)?;
        if record.definition.source_kind == NativeSubagentSourceKind::ConfigEntry {
            let (content, current_hash) = read_definition_content(db, &record.definition)?;
            assert_expected_hash(Some(&current_hash), expected_hash, identity)?;
            let mut value: JsonValue = serde_json::from_str(&content)
                .map_err(|error| AppError::InvalidInput(format!("Agent JSON 条目无效: {error}")))?;
            let object = value.as_object_mut().ok_or_else(|| {
                AppError::InvalidInput("OpenCode Agent 条目必须是对象".to_string())
            })?;
            if enabled {
                object.remove("disable");
            } else {
                object.insert("disable".to_string(), JsonValue::Bool(true));
            }
            let content = serde_json::to_string_pretty(&value)
                .map_err(|error| AppError::JsonSerialize { source: error })?;
            return Self::save(db, identity, &content, expected_hash).map(|saved| saved.definition);
        }
        if enabled
            && !record.definition.enabled
            && record.disabled_path.is_none()
            && record.definition.format == NativeSubagentFormat::Markdown
            && AgentType::from_str(&record.definition.agent)? == AgentType::OpenCode
        {
            let path = PathBuf::from(&record.definition.source_path);
            let content = fs::read_to_string(&path).map_err(|error| AppError::io(&path, error))?;
            let next = set_markdown_native_disabled(&content, false)?;
            return Self::save(db, identity, &next, expected_hash).map(|saved| saved.definition);
        }
        let _guard = subagent_state_write_guard();
        let current = effective_record_path(&record);
        let current_hash = hash_file(&current)?;
        assert_expected_hash(Some(&current_hash), expected_hash, identity)?;
        let _backup = Self::create_backup_unlocked(db, &record.definition)?;
        let destination = if enabled {
            PathBuf::from(&record.definition.source_path)
        } else {
            disabled_path(identity, &record.definition.source_path)?
        };
        if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
            return Err(native_error(
                "NATIVE_SUBAGENT_DESTINATION_CONFLICT",
                &[("path", &destination.display().to_string())],
                Some("resolveConflict"),
            ));
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
        }
        fs::rename(&current, &destination).map_err(|error| AppError::IoContext {
            context: format!(
                "移动原生 Subagent 失败: {} -> {}",
                current.display(),
                destination.display()
            ),
            source: error,
        })?;
        let prior_disabled = record.disabled_path.clone();
        record.definition.enabled = enabled;
        record.definition.management_status = if enabled {
            NativeSubagentManagementStatus::Managed
        } else {
            NativeSubagentManagementStatus::Disabled
        };
        record.disabled_path = (!enabled).then(|| destination.display().to_string());
        record.definition.content_hash = Some(current_hash);
        record.updated_at = chrono::Utc::now().timestamp();
        if let Err(error) = db.save_native_subagent_record(&record) {
            let rollback_target = if enabled {
                prior_disabled.map(PathBuf::from).unwrap_or(current.clone())
            } else {
                PathBuf::from(&record.definition.source_path)
            };
            let _ = fs::rename(&destination, rollback_target);
            return Err(error);
        }
        Ok(record.definition)
    }

    pub fn create_backup(
        db: &Arc<Database>,
        identity: &str,
        expected_hash: &str,
    ) -> Result<NativeSubagentBackup, AppError> {
        let _guard = subagent_state_write_guard();
        let definition = Self::resolve_definition(db, identity)?;
        reject_legacy(&definition)?;
        let current = read_definition_document(db, &definition)?;
        let hash = hash_bytes(&current);
        assert_expected_hash(Some(&hash), expected_hash, identity)?;
        Self::create_backup_unlocked_with_reason(db, &definition, "manual")
    }

    fn create_backup_unlocked(
        db: &Arc<Database>,
        definition: &NativeSubagentDefinition,
    ) -> Result<NativeSubagentBackup, AppError> {
        Self::create_backup_unlocked_with_reason(db, definition, "before-mutation")
    }

    fn create_backup_unlocked_with_reason(
        db: &Arc<Database>,
        definition: &NativeSubagentDefinition,
        reason: &str,
    ) -> Result<NativeSubagentBackup, AppError> {
        let content = read_definition_document(db, definition)?;
        let source_document_hash = hash_bytes(&content);
        let entry_content = read_definition_content(db, definition)?.0;
        let content_hash = hash_bytes(entry_content.as_bytes());
        let created_at = chrono::Utc::now().timestamp();
        static BACKUP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let nonce = BACKUP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let backup_id = format!(
            "{}_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            nonce,
            &hash_bytes(definition.identity.as_bytes())[..12]
        );
        let backup = NativeSubagentBackup {
            backup_id: backup_id.clone(),
            identity: definition.identity.clone(),
            name: definition.name.clone(),
            agent: definition.agent.clone(),
            target: definition.target.clone(),
            format: definition.format,
            source_path: definition.source_path.clone(),
            content_hash,
            created_at,
            reason: Some(reason.to_string()),
            legacy: false,
        };
        let record = NativeSubagentBackupRecord {
            backup: backup.clone(),
            definition_json: serde_json::to_string(definition)
                .map_err(|error| AppError::JsonSerialize { source: error })?,
            content,
            source_document_hash,
            unix_mode: unix_mode_for_path(&effective_definition_path(db, definition)?),
        };
        db.save_native_subagent_backup(&record)?;
        db.prune_native_subagent_backups(NATIVE_BACKUP_RETAIN_COUNT)?;
        Ok(backup)
    }

    pub fn list_backups(
        db: &Arc<Database>,
        context: &ConfigContext,
    ) -> Result<Vec<NativeSubagentBackup>, AppError> {
        db.get_native_subagent_backups_for_context(context)
    }

    pub fn delete_backup(
        db: &Arc<Database>,
        backup_id: &str,
        expected_content_hash: &str,
    ) -> Result<(), AppError> {
        let _guard = subagent_state_write_guard();
        let backup = db
            .get_native_subagent_backup_record(backup_id)?
            .ok_or_else(|| AppError::InvalidInput(format!("备份不存在: {backup_id}")))?;
        if backup.backup.legacy {
            return Err(native_error(
                "NATIVE_SUBAGENT_LEGACY_BACKUP_READ_ONLY",
                &[("backupId", backup_id)],
                Some("keepLegacyBackup"),
            ));
        }
        assert_expected_hash(
            Some(&backup.backup.content_hash),
            expected_content_hash,
            &backup.backup.identity,
        )?;
        db.delete_native_subagent_backup(backup_id)
    }

    pub fn uninstall(
        db: &Arc<Database>,
        identity: &str,
        expected_hash: &str,
    ) -> Result<NativeSubagentMutationResult, AppError> {
        let _guard = subagent_state_write_guard();
        let record = require_managed_record(db, identity)?;
        reject_legacy(&record.definition)?;
        let path = effective_record_path(&record);
        let original = fs::read(&path).map_err(|error| AppError::io(&path, error))?;
        let current_hash = hash_bytes(&original);
        assert_expected_hash(Some(&current_hash), expected_hash, identity)?;
        let backup = Self::create_backup_unlocked(db, &record.definition)?;

        let post_document =
            if record.definition.source_kind == NativeSubagentSourceKind::ConfigEntry {
                remove_jsonc_entry(
                    std::str::from_utf8(&original)
                        .map_err(|_| AppError::InvalidInput("配置文件不是 UTF-8".to_string()))?,
                    record.definition.source_key.as_deref().ok_or_else(|| {
                        AppError::Database("config-entry 缺少 source_key".to_string())
                    })?,
                )?
                .into_bytes()
            } else {
                Vec::new()
            };
        if record.definition.source_kind == NativeSubagentSourceKind::ConfigEntry {
            config::atomic_write(&path, &post_document)?;
        } else {
            fs::remove_file(&path).map_err(|error| AppError::io(&path, error))?;
        }
        if let Err(error) = db.delete_native_subagent_record(identity) {
            let rollback = if record.definition.source_kind == NativeSubagentSourceKind::ConfigEntry
            {
                config::atomic_write(&path, &original)
            } else if record.definition.is_symlink {
                record
                    .definition
                    .symlink_target
                    .as_ref()
                    .ok_or_else(|| AppError::Config("符号链接目标缺失".to_string()))
                    .and_then(|target| create_symlink(Path::new(target), &path))
            } else {
                config::atomic_write(&path, &original)
            };
            if let Err(rollback_error) = rollback {
                log::error!("卸载落库失败后文件回滚也失败: {rollback_error}");
            }
            return Err(error);
        }
        Ok(NativeSubagentMutationResult {
            backup_id: Some(backup.backup_id),
            definition: None,
        })
    }

    pub fn restore_backup(
        db: &Arc<Database>,
        backup_id: &str,
        expected_destination_hash: Option<&str>,
    ) -> Result<NativeSubagentDefinition, AppError> {
        let _guard = subagent_state_write_guard();
        let backup = db
            .get_native_subagent_backup_record(backup_id)?
            .ok_or_else(|| AppError::InvalidInput(format!("备份不存在: {backup_id}")))?;
        let mut definition: NativeSubagentDefinition =
            serde_json::from_str(&backup.definition_json)
                .map_err(|error| AppError::json("native backup metadata", error))?;
        reject_legacy(&definition)?;
        ProjectService::resolve_scope_target(db, &definition.target)?;
        validate_definition_scope(db, &definition)?;
        let destination = PathBuf::from(&definition.source_path);
        if db
            .get_native_subagent_record(&definition.identity)?
            .is_some_and(|record| !record.definition.enabled)
        {
            return Err(native_error(
                "NATIVE_SUBAGENT_DISABLED_DESTINATION_CONFLICT",
                &[("identity", &definition.identity)],
                Some("enableOrUninstallFirst"),
            ));
        }
        let previous_bytes = if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
            Some(fs::read(&destination).map_err(|error| AppError::io(&destination, error))?)
        } else {
            None
        };
        let previous_link_target = fs::symlink_metadata(&destination)
            .ok()
            .filter(|metadata| metadata.file_type().is_symlink())
            .and_then(|_| fs::read_link(&destination).ok());
        let previous_mode = unix_mode_for_path(&destination);
        let destination_present =
            destination.exists() || fs::symlink_metadata(&destination).is_ok();
        let config_entry_missing = if destination_present
            && definition.source_kind == NativeSubagentSourceKind::ConfigEntry
        {
            let document = std::str::from_utf8(previous_bytes.as_deref().unwrap_or_default())
                .map_err(|_| AppError::InvalidInput("配置文件不是 UTF-8".to_string()))?;
            let parsed = parse_jsonc(document)?;
            let source_key = definition
                .source_key
                .as_deref()
                .ok_or_else(|| AppError::Database("config-entry 缺少 source_key".to_string()))?;
            !parsed
                .get("agent")
                .and_then(JsonValue::as_object)
                .is_some_and(|entries| entries.contains_key(source_key))
        } else {
            false
        };
        if destination_present {
            let current = previous_bytes.as_deref().unwrap_or_default();
            let current_hash = hash_bytes(current);
            if let Some(expected) = expected_destination_hash {
                assert_expected_hash(Some(&current_hash), expected, &definition.identity)?;
            } else if !config_entry_missing {
                return Err(native_error(
                    "NATIVE_SUBAGENT_RESTORE_CONFLICT",
                    &[("path", &destination.display().to_string())],
                    Some("reloadAndConfirm"),
                ));
            }
        } else if definition.source_kind == NativeSubagentSourceKind::ConfigEntry {
            return Err(native_error(
                "NATIVE_SUBAGENT_CONFIG_DOCUMENT_MISSING",
                &[("path", &destination.display().to_string())],
                Some("restoreConfigFile"),
            ));
        }
        // Keep a recoverable copy of the current definition before replacing it.
        // A removed config entry has no current asset to back up; in that case the
        // targeted insertion below leaves the rest of the config document intact.
        if previous_bytes.is_some()
            && (definition.source_kind != NativeSubagentSourceKind::ConfigEntry
                || read_definition_content_from_path(&definition, &destination).is_ok())
        {
            Self::create_backup_unlocked_with_reason(db, &definition, "before-restore")?;
        }
        if definition.is_symlink {
            if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
                fs::remove_file(&destination).map_err(|error| AppError::io(&destination, error))?;
            }
            let target = definition
                .symlink_target
                .as_ref()
                .ok_or_else(|| AppError::Config("备份中的符号链接目标缺失".to_string()))?;
            create_symlink(Path::new(target), &destination)?;
        } else if definition.source_kind == NativeSubagentSourceKind::ConfigEntry {
            let current_document =
                std::str::from_utf8(previous_bytes.as_deref().unwrap_or_default())
                    .map_err(|_| AppError::InvalidInput("配置文件不是 UTF-8".to_string()))?;
            let backup_document = std::str::from_utf8(&backup.content)
                .map_err(|_| AppError::InvalidInput("备份配置文件不是 UTF-8".to_string()))?;
            let source_key = definition
                .source_key
                .as_deref()
                .ok_or_else(|| AppError::Database("config-entry 缺少 source_key".to_string()))?;
            let backed_entry = extract_jsonc_entry_source(backup_document, source_key)?;
            let restored_document = upsert_jsonc_entry(current_document, source_key, backed_entry)?;
            config::atomic_write(&destination, restored_document.as_bytes())?;
        } else {
            config::atomic_write(&destination, &backup.content)?;
            restore_unix_mode(&destination, backup.unix_mode)?;
        }
        // Files placed back into an Agent scan directory are active by default.
        // OpenCode definitions can still carry a native `disable: true`; reparsing
        // the restored entry/file below preserves that state instead of forcing it.
        definition.enabled = true;
        definition.management_status = NativeSubagentManagementStatus::Managed;
        definition = definition_from_existing_source(&definition, &destination)?;
        definition.content_hash = Some(hash_file(&destination)?);
        let record = NativeSubagentRecord {
            definition: definition.clone(),
            disabled_path: None,
            upstream_hash: None,
            adopted_symlink: definition.is_symlink,
            installed_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
        };
        if let Err(error) = db.save_native_subagent_record(&record) {
            if destination.exists() || fs::symlink_metadata(&destination).is_ok() {
                let _ = fs::remove_file(&destination);
            }
            let rollback = if let Some(link_target) = previous_link_target {
                create_symlink(&link_target, &destination)
            } else if let Some(previous) = previous_bytes {
                config::atomic_write(&destination, &previous)
                    .and_then(|_| restore_unix_mode(&destination, previous_mode))
            } else {
                Ok(())
            };
            if let Err(rollback_error) = rollback {
                log::error!("恢复备份落库失败后文件回滚也失败: {rollback_error}");
            }
            return Err(error);
        }
        Ok(definition)
    }

    fn resolve_definition(
        db: &Arc<Database>,
        identity: &str,
    ) -> Result<NativeSubagentDefinition, AppError> {
        if let Some(record) = db.get_native_subagent_record(identity)? {
            return Ok(record.definition);
        }
        Self::resolve_unmanaged_definition(db, identity)
    }

    fn resolve_unmanaged_definition(
        db: &Arc<Database>,
        identity: &str,
    ) -> Result<NativeSubagentDefinition, AppError> {
        let scan = Self::scan(db, &ConfigContext::All)?;
        scan.definitions
            .into_iter()
            .find(|definition| definition.identity == identity)
            .ok_or_else(|| AppError::InvalidInput(format!("原生 Subagent 不存在: {identity}")))
    }

    pub async fn check_updates(
        db: &Arc<Database>,
        context: &ConfigContext,
    ) -> Result<Vec<NativeSubagentUpdateInfo>, AppError> {
        let mut updates = Vec::new();
        for record in db.get_native_subagent_records_for_context(context)? {
            let current_hash = read_definition_content(db, &record.definition)
                .ok()
                .map(|(_, hash)| hash);
            let locally_modified = record
                .upstream_hash
                .as_deref()
                .is_some_and(|upstream| current_hash.as_deref() != Some(upstream));
            match fetch_remote_content(&record).await {
                Ok((_, remote_hash)) => updates.push(NativeSubagentUpdateInfo {
                    identity: record.definition.identity,
                    name: record.definition.name,
                    has_update: current_hash.as_deref() != Some(remote_hash.as_str()),
                    locally_modified,
                    current_hash,
                    remote_hash: Some(remote_hash),
                    diagnostics: Vec::new(),
                }),
                Err(error) => updates.push(NativeSubagentUpdateInfo {
                    identity: record.definition.identity,
                    name: record.definition.name,
                    has_update: false,
                    locally_modified,
                    current_hash,
                    remote_hash: None,
                    diagnostics: vec![diagnostic(
                        NativeDiagnosticSeverity::Info,
                        "UPDATE_UNAVAILABLE",
                        error.to_string(),
                    )],
                }),
            }
        }
        Ok(updates)
    }

    pub async fn preview_update(
        db: &Arc<Database>,
        identity: &str,
    ) -> Result<NativeSubagentUpdatePreview, AppError> {
        let record = require_managed_record(db, identity)?;
        let (current_content, current_hash) = read_definition_content(db, &record.definition)?;
        let (next_content, remote_hash) = fetch_remote_content(&record).await?;
        validate_native_content(
            AgentType::from_str(&record.definition.agent)?,
            record.definition.format,
            record.definition.source_kind,
            &next_content,
        )?;
        Ok(NativeSubagentUpdatePreview {
            identity: identity.to_string(),
            current_content,
            next_content,
            current_hash: current_hash.clone(),
            remote_hash,
            locally_modified: record
                .upstream_hash
                .as_deref()
                .is_some_and(|upstream| current_hash != upstream),
        })
    }

    pub async fn apply_update(
        db: &Arc<Database>,
        identity: &str,
        expected_hash: &str,
        expected_remote_hash: &str,
    ) -> Result<NativeSubagentDefinition, AppError> {
        let record = require_managed_record(db, identity)?;
        let (remote_content, remote_hash) = fetch_remote_content(&record).await?;
        if remote_hash != expected_remote_hash {
            return Err(native_error(
                "NATIVE_SUBAGENT_REMOTE_CHANGED",
                &[("identity", identity)],
                Some("previewAgain"),
            ));
        }
        let saved = Self::save_with_upstream(
            db,
            identity,
            &remote_content,
            expected_hash,
            Some(&remote_hash),
        )?;
        Ok(saved.definition)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarkdownPolicy {
    RequireName,
    OpenCode,
}

fn target_sort_key(target: &ScopeTarget) -> String {
    match target {
        ScopeTarget::Global => "0".to_string(),
        ScopeTarget::Project { project_id } => format!("1:{project_id}"),
    }
}

fn append_name_collision_diagnostics(definitions: &mut [NativeSubagentDefinition]) {
    let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
    for (index, definition) in definitions.iter().enumerate() {
        if definition.management_status == NativeSubagentManagementStatus::LegacyReview {
            continue;
        }
        groups
            .entry((definition.agent.clone(), definition.name.to_lowercase()))
            .or_default()
            .push(index);
    }
    for indices in groups.values().filter(|indices| indices.len() > 1) {
        let crosses_global_project = indices
            .iter()
            .any(|index| matches!(definitions[*index].target, ScopeTarget::Global))
            && indices
                .iter()
                .any(|index| matches!(definitions[*index].target, ScopeTarget::Project { .. }));
        for index in indices {
            let same_target_duplicate = indices.iter().any(|other| {
                other != index
                    && definitions[*other].target == definitions[*index].target
                    && definitions[*other].identity != definitions[*index].identity
            });
            if same_target_duplicate {
                definitions[*index].diagnostics.push(diagnostic(
                    NativeDiagnosticSeverity::Warning,
                    "DUPLICATE_NAME_IN_TARGET",
                    "同一 Agent 与目标内存在同名原生定义，请通过来源路径区分".to_string(),
                ));
            }
            if crosses_global_project {
                definitions[*index].diagnostics.push(diagnostic(
                    NativeDiagnosticSeverity::Info,
                    "GLOBAL_PROJECT_NAME_SHADOWING",
                    "全局与项目配置存在同名定义，运行时可能由项目定义遮蔽".to_string(),
                ));
            }
        }
    }
}

fn scan_discovery_repo(
    root: &Path,
    owner: &str,
    repo: &str,
    branch: &str,
    output: &mut Vec<NativeSubagentDiscovery>,
) -> Result<(), AppError> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory).map_err(|error| AppError::io(&directory, error))? {
            let entry = entry.map_err(|error| AppError::io(&directory, error))?;
            let path = entry.path();
            let file_name = entry.file_name();
            if file_name.to_string_lossy().starts_with('.') {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let relative = path.strip_prefix(root).unwrap_or(&path);
            let extension = path.extension().and_then(|value| value.to_str());
            let content = match extension {
                Some("md" | "toml") => match fs::read_to_string(&path) {
                    Ok(content) => content,
                    Err(_) => continue,
                },
                _ => continue,
            };
            let (format, name, description, compatible_agents) = if extension == Some("toml") {
                let Ok(value) = toml::from_str::<toml::Value>(&content) else {
                    continue;
                };
                let name = value
                    .get("name")
                    .and_then(toml::Value::as_str)
                    .map(str::to_string)
                    .unwrap_or(file_stem(&path)?);
                let description = value
                    .get("description")
                    .and_then(toml::Value::as_str)
                    .unwrap_or("")
                    .to_string();
                (
                    NativeSubagentFormat::Toml,
                    name,
                    description,
                    vec![AgentType::Codex.as_str().to_string()],
                )
            } else {
                let Ok(metadata) = parse_markdown_metadata(&content) else {
                    continue;
                };
                let declared_name = metadata
                    .get("name")
                    .and_then(serde_yaml::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                let mode = metadata.get("mode").and_then(serde_yaml::Value::as_str);
                let mut compatible_agents = Vec::new();
                if declared_name.is_some() {
                    compatible_agents.push(AgentType::ClaudeCode.as_str().to_string());
                    compatible_agents.push(AgentType::GeminiCli.as_str().to_string());
                }
                if matches!(mode, Some("subagent" | "all")) {
                    compatible_agents.push(AgentType::OpenCode.as_str().to_string());
                }
                if compatible_agents.is_empty() {
                    continue;
                }
                let name = declared_name.unwrap_or(file_stem(&path)?);
                let description = metadata
                    .get("description")
                    .and_then(serde_yaml::Value::as_str)
                    .unwrap_or("")
                    .to_string();
                (
                    NativeSubagentFormat::Markdown,
                    name,
                    description,
                    compatible_agents,
                )
            };
            let relative_string = relative.to_string_lossy().replace('\\', "/");
            output.push(NativeSubagentDiscovery {
                key: format!("{owner}/{repo}:{relative_string}"),
                name,
                description,
                path: relative_string,
                repo_owner: owner.to_string(),
                repo_name: repo.to_string(),
                repo_branch: branch.to_string(),
                format,
                compatible_agents,
            });
        }
    }
    Ok(())
}

async fn fetch_remote_content(record: &NativeSubagentRecord) -> Result<(String, String), AppError> {
    if record.definition.source_kind != NativeSubagentSourceKind::File {
        return Err(AppError::InvalidInput(
            "配置内 Agent 条目没有独立远端更新源".to_string(),
        ));
    }
    let owner = record
        .definition
        .repo_owner
        .as_deref()
        .ok_or_else(|| AppError::InvalidInput("本地定义没有远端仓库来源".to_string()))?;
    let name = record
        .definition
        .repo_name
        .as_deref()
        .ok_or_else(|| AppError::InvalidInput("本地定义没有远端仓库来源".to_string()))?;
    let branch = record.definition.repo_branch.as_deref().unwrap_or("main");
    let repo_path = record
        .definition
        .repo_path
        .as_deref()
        .ok_or_else(|| AppError::InvalidInput("远端定义缺少仓库路径".to_string()))?;
    SkillService::validate_repo_ref(owner, name, branch)?;
    let relative = safe_relative_path(repo_path)?;
    let repo = crate::services::skill::SkillRepo {
        owner: owner.to_string(),
        name: name.to_string(),
        branch: branch.to_string(),
        enabled: true,
    };
    let skill_service = SkillService::new();
    let client = skill_service.download_client();
    let (temporary, _) = SkillService::download_repo_with_timeout(&client, &repo).await?;
    let path = temporary.path().join(relative);
    let content = fs::read_to_string(&path).map_err(|error| AppError::io(&path, error))?;
    let hash = hash_bytes(content.as_bytes());
    Ok((content, hash))
}

fn safe_relative_path(value: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(value);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(AppError::InvalidInput(format!(
            "远端 Subagent 路径无效: {value}"
        )));
    }
    Ok(path.to_path_buf())
}

fn native_agents_dir(project_root: Option<&Path>, agent: AgentType) -> PathBuf {
    match project_root {
        None => match agent {
            AgentType::ClaudeCode => config::get_claude_agents_dir(),
            AgentType::Codex => config::get_codex_agents_dir(),
            AgentType::GeminiCli => config::get_gemini_agents_dir(),
            AgentType::OpenCode => config::get_opencode_agents_dir(),
        },
        Some(root) => match agent {
            AgentType::ClaudeCode => root.join(".claude").join("agents"),
            AgentType::Codex => root.join(".codex").join("agents"),
            AgentType::GeminiCli => root.join(".gemini").join("agents"),
            AgentType::OpenCode => root.join(".opencode").join("agents"),
        },
    }
}

fn native_safety_root(project_root: Option<&Path>, agent: AgentType) -> PathBuf {
    match project_root {
        Some(root) => root.to_path_buf(),
        None => match agent {
            AgentType::ClaudeCode => config::get_claude_config_dir(),
            AgentType::Codex => config::get_codex_config_dir(),
            AgentType::GeminiCli => config::get_gemini_config_dir(),
            AgentType::OpenCode => config::get_opencode_config_dir(),
        },
    }
}

fn opencode_config_candidates(project_root: Option<&Path>) -> Vec<PathBuf> {
    match project_root {
        None => {
            let root = config::get_opencode_config_dir();
            vec![root.join("opencode.json"), root.join("opencode.jsonc")]
        }
        Some(root) => vec![
            root.join("opencode.json"),
            root.join("opencode.jsonc"),
            root.join(".opencode").join("opencode.json"),
            root.join(".opencode").join("opencode.jsonc"),
        ],
    }
}

fn native_identity(
    target: &ScopeTarget,
    agent: AgentType,
    source_path: &Path,
    source_key: Option<&str>,
) -> String {
    let target = match target {
        ScopeTarget::Global => "global".to_string(),
        ScopeTarget::Project { project_id } => format!("project:{project_id}"),
    };
    let material = format!(
        "{target}|{}|{}|{}",
        agent.as_str(),
        source_path.display(),
        source_key.unwrap_or("")
    );
    format!("native:{}", hash_bytes(material.as_bytes()))
}

#[allow(clippy::too_many_arguments)]
fn file_definition(
    target: &ScopeTarget,
    agent: AgentType,
    format: NativeSubagentFormat,
    path: &Path,
    safety_root: &Path,
    name: String,
    description: Option<String>,
    diagnostics: Vec<NativeSubagentDiagnostic>,
) -> Result<NativeSubagentDefinition, AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| AppError::io(path, error))?;
    let is_symlink = metadata.file_type().is_symlink();
    let mut definition = NativeSubagentDefinition {
        identity: native_identity(target, agent, path, None),
        name,
        description,
        agent: agent.as_str().to_string(),
        target: target.clone(),
        format,
        source_kind: NativeSubagentSourceKind::File,
        source_path: path.display().to_string(),
        source_key: None,
        management_status: NativeSubagentManagementStatus::Unmanaged,
        enabled: true,
        content_hash: Some(hash_file(path)?),
        is_symlink,
        symlink_target: if is_symlink {
            fs::read_link(path)
                .ok()
                .map(|target| target.display().to_string())
        } else {
            None
        },
        diagnostics,
        repo_owner: None,
        repo_name: None,
        repo_branch: None,
        repo_path: None,
    };
    append_ancestor_symlink_diagnostic(&mut definition, safety_root);
    Ok(definition)
}

fn ancestor_symlink_within(path: &Path, safety_root: &Path) -> Option<(PathBuf, PathBuf)> {
    let mut ancestor = path.parent();
    while let Some(candidate) = ancestor {
        if !config::path_is_within(safety_root, candidate) {
            break;
        }
        if fs::symlink_metadata(candidate)
            .ok()
            .is_some_and(|metadata| metadata.file_type().is_symlink())
        {
            let resolved = fs::canonicalize(path)
                .or_else(|_| fs::canonicalize(candidate))
                .unwrap_or_else(|_| candidate.to_path_buf());
            return Some((candidate.to_path_buf(), resolved));
        }
        if candidate == safety_root {
            break;
        }
        ancestor = candidate.parent();
    }
    None
}

fn append_ancestor_symlink_diagnostic(
    definition: &mut NativeSubagentDefinition,
    safety_root: &Path,
) {
    if let Some((ancestor, resolved)) =
        ancestor_symlink_within(Path::new(&definition.source_path), safety_root)
    {
        definition.diagnostics.push(diagnostic(
            NativeDiagnosticSeverity::Error,
            "ANCESTOR_SYMLINK_UNSAFE",
            format!(
                "配置目录包含祖先符号链接 {}，实际来源 {}；仅可查看，改为普通目录后才能纳入管理",
                ancestor.display(),
                resolved.display()
            ),
        ));
    }
}

fn invalid_file_definition(
    target: &ScopeTarget,
    agent: AgentType,
    format: NativeSubagentFormat,
    path: &Path,
    message: String,
) -> NativeSubagentDefinition {
    NativeSubagentDefinition {
        identity: native_identity(target, agent, path, None),
        name: file_stem(path).unwrap_or_else(|_| "invalid".to_string()),
        description: None,
        agent: agent.as_str().to_string(),
        target: target.clone(),
        format,
        source_kind: NativeSubagentSourceKind::File,
        source_path: path.display().to_string(),
        source_key: None,
        management_status: NativeSubagentManagementStatus::Invalid,
        enabled: true,
        content_hash: hash_file(path).ok(),
        is_symlink: fs::symlink_metadata(path)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false),
        symlink_target: fs::read_link(path)
            .ok()
            .map(|target| target.display().to_string()),
        diagnostics: vec![diagnostic(
            NativeDiagnosticSeverity::Error,
            "INVALID_NATIVE_DEFINITION",
            message,
        )],
        repo_owner: None,
        repo_name: None,
        repo_branch: None,
        repo_path: None,
    }
}

fn definition_from_existing_source(
    template: &NativeSubagentDefinition,
    path: &Path,
) -> Result<NativeSubagentDefinition, AppError> {
    let agent = AgentType::from_str(&template.agent)?;
    match template.source_kind {
        NativeSubagentSourceKind::File => match agent {
            AgentType::Codex => {
                let content =
                    fs::read_to_string(path).map_err(|error| AppError::io(path, error))?;
                let value: toml::Value =
                    toml::from_str(&content).map_err(|error| AppError::toml(path, error))?;
                let mut next = template.clone();
                next.name = value
                    .get("name")
                    .and_then(toml::Value::as_str)
                    .map(str::to_string)
                    .unwrap_or(file_stem(path)?);
                next.description = value
                    .get("description")
                    .and_then(toml::Value::as_str)
                    .map(str::to_string);
                Ok(next)
            }
            _ => {
                let content =
                    fs::read_to_string(path).map_err(|error| AppError::io(path, error))?;
                let meta = parse_markdown_metadata(&content)?;
                let mut next = template.clone();
                next.name = meta
                    .get("name")
                    .and_then(serde_yaml::Value::as_str)
                    .map(str::to_string)
                    .unwrap_or(file_stem(path)?);
                next.description = meta
                    .get("description")
                    .and_then(serde_yaml::Value::as_str)
                    .map(str::to_string);
                if agent == AgentType::OpenCode {
                    next.enabled = !meta
                        .get("disable")
                        .and_then(serde_yaml::Value::as_bool)
                        .unwrap_or(false);
                    next.management_status = if next.enabled {
                        NativeSubagentManagementStatus::Managed
                    } else {
                        NativeSubagentManagementStatus::Disabled
                    };
                }
                Ok(next)
            }
        },
        NativeSubagentSourceKind::ConfigEntry => {
            let content = fs::read_to_string(path).map_err(|error| AppError::io(path, error))?;
            let value = parse_jsonc(&content)?;
            let key = template
                .source_key
                .as_deref()
                .ok_or_else(|| AppError::Database("config-entry 缺少 source_key".to_string()))?;
            let entry = value
                .get("agent")
                .and_then(JsonValue::as_object)
                .and_then(|entries| entries.get(key))
                .ok_or_else(|| {
                    AppError::InvalidInput(format!("OpenCode agent 条目不存在: {key}"))
                })?;
            let mut next = template.clone();
            next.description = entry
                .get("description")
                .and_then(JsonValue::as_str)
                .map(str::to_string);
            next.enabled = !entry
                .get("disable")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false);
            next.management_status = if next.enabled {
                NativeSubagentManagementStatus::Managed
            } else {
                NativeSubagentManagementStatus::Disabled
            };
            Ok(next)
        }
        NativeSubagentSourceKind::Legacy => Err(AppError::InvalidInput(
            "旧版 Subagent 不能作为原生定义解析".to_string(),
        )),
    }
}

fn parse_markdown_metadata(content: &str) -> Result<serde_yaml::Mapping, AppError> {
    let content = content.trim_start_matches('\u{feff}');
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return Err(AppError::InvalidInput("缺少 YAML frontmatter".to_string()));
    }
    let mut yaml = String::new();
    let mut closed = false;
    for line in lines {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        yaml.push_str(line);
        yaml.push('\n');
    }
    if !closed {
        return Err(AppError::InvalidInput(
            "YAML frontmatter 未闭合".to_string(),
        ));
    }
    let value: serde_yaml::Value = serde_yaml::from_str(&yaml)
        .map_err(|error| AppError::InvalidInput(format!("YAML frontmatter 无效: {error}")))?;
    value
        .as_mapping()
        .cloned()
        .ok_or_else(|| AppError::InvalidInput("YAML frontmatter 必须是对象".to_string()))
}

/// Removes the native OpenCode `disable` key from a top-level YAML
/// frontmatter mapping. This is used only when adopting an already-disabled
/// in-place Markdown definition; ordinary file disablement still moves the
/// file out of the Agent scan directory.
fn set_markdown_native_disabled(content: &str, disabled: bool) -> Result<String, AppError> {
    let normalized = content.trim_start_matches('\u{feff}');
    let bom_len = content.len() - normalized.len();
    let mut line_start = 0usize;
    let mut delimiter_count = 0usize;
    let mut closing_start = None;
    for line in normalized.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']).trim();
        if trimmed == "---" {
            delimiter_count += 1;
            if delimiter_count == 2 {
                closing_start = Some(line_start);
                break;
            }
        }
        line_start += line.len();
    }
    let closing_start = closing_start
        .ok_or_else(|| AppError::InvalidInput("YAML frontmatter 未闭合".to_string()))?;
    let frontmatter = &normalized[..closing_start];
    let mut found = false;
    let mut rewritten = String::with_capacity(content.len());
    rewritten.push_str(&content[..bom_len]);
    for (index, line) in frontmatter.split_inclusive('\n').enumerate() {
        if index > 0 {
            let without_newline = line.trim_end_matches(['\r', '\n']);
            let is_top_level_disable = without_newline
                .strip_prefix("disable")
                .is_some_and(|tail| tail.trim_start().starts_with(':'));
            if is_top_level_disable {
                found = true;
                if disabled {
                    rewritten.push_str("disable: true\n");
                }
                continue;
            }
        }
        rewritten.push_str(line);
    }
    if disabled && !found {
        rewritten.push_str("disable: true\n");
    }
    rewritten.push_str(&normalized[closing_start..]);
    parse_markdown_metadata(&rewritten)?;
    Ok(rewritten)
}

fn validate_native_content(
    agent: AgentType,
    format: NativeSubagentFormat,
    source_kind: NativeSubagentSourceKind,
    content: &str,
) -> Result<(), AppError> {
    match (agent, format, source_kind) {
        (AgentType::Codex, NativeSubagentFormat::Toml, NativeSubagentSourceKind::File) => {
            let _: toml::Value = toml::from_str(content)
                .map_err(|error| AppError::InvalidInput(format!("TOML 无效: {error}")))?;
        }
        (
            AgentType::ClaudeCode | AgentType::GeminiCli,
            NativeSubagentFormat::Markdown,
            NativeSubagentSourceKind::File,
        ) => {
            let meta = parse_markdown_metadata(content)?;
            if meta
                .get("name")
                .and_then(serde_yaml::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
            {
                return Err(AppError::InvalidInput("缺少 name frontmatter".to_string()));
            }
        }
        (AgentType::OpenCode, NativeSubagentFormat::Markdown, NativeSubagentSourceKind::File) => {
            let meta = parse_markdown_metadata(content)?;
            let mode = meta
                .get("mode")
                .and_then(serde_yaml::Value::as_str)
                .unwrap_or("all");
            if !matches!(mode, "subagent" | "all") {
                return Err(AppError::InvalidInput(
                    "OpenCode agent 的 mode 必须是 subagent 或 all".to_string(),
                ));
            }
        }
        (
            AgentType::OpenCode,
            NativeSubagentFormat::Json | NativeSubagentFormat::JsoncEntry,
            NativeSubagentSourceKind::ConfigEntry,
        ) => {
            let value: JsonValue = serde_json::from_str(content)
                .map_err(|error| AppError::InvalidInput(format!("Agent JSON 条目无效: {error}")))?;
            let mode = value
                .get("mode")
                .and_then(JsonValue::as_str)
                .unwrap_or("all");
            if !matches!(mode, "subagent" | "all") {
                return Err(AppError::InvalidInput(
                    "OpenCode agent 的 mode 必须是 subagent 或 all".to_string(),
                ));
            }
        }
        _ => {
            return Err(AppError::InvalidInput(format!(
                "{} 不支持 {:?}/{:?}",
                agent.as_str(),
                format,
                source_kind
            )))
        }
    }
    Ok(())
}

fn validate_definition_on_disk(definition: &NativeSubagentDefinition) -> Result<(), AppError> {
    if definition.management_status == NativeSubagentManagementStatus::Invalid {
        return Err(native_error(
            "NATIVE_SUBAGENT_INVALID",
            &[("identity", &definition.identity)],
            Some("fixDefinition"),
        ));
    }
    let (content, _) =
        read_definition_content_from_path(definition, Path::new(&definition.source_path))?;
    validate_native_content(
        AgentType::from_str(&definition.agent)?,
        definition.format,
        definition.source_kind,
        &content,
    )
}

fn read_definition_content(
    db: &Arc<Database>,
    definition: &NativeSubagentDefinition,
) -> Result<(String, String), AppError> {
    let path = effective_definition_path(db, definition)?;
    read_definition_content_from_path(definition, &path)
}

fn read_definition_content_from_path(
    definition: &NativeSubagentDefinition,
    path: &Path,
) -> Result<(String, String), AppError> {
    let document = fs::read_to_string(path).map_err(|error| AppError::io(path, error))?;
    let hash = hash_bytes(document.as_bytes());
    if definition.source_kind == NativeSubagentSourceKind::ConfigEntry {
        let value = parse_jsonc(&document)?;
        let key = definition
            .source_key
            .as_deref()
            .ok_or_else(|| AppError::Database("config-entry 缺少 source_key".to_string()))?;
        let entry = value
            .get("agent")
            .and_then(JsonValue::as_object)
            .and_then(|entries| entries.get(key))
            .ok_or_else(|| AppError::InvalidInput(format!("OpenCode agent 条目不存在: {key}")))?;
        let pretty = serde_json::to_string_pretty(entry)
            .map_err(|error| AppError::JsonSerialize { source: error })?;
        Ok((pretty, hash))
    } else {
        Ok((document, hash))
    }
}

fn read_definition_document(
    db: &Arc<Database>,
    definition: &NativeSubagentDefinition,
) -> Result<Vec<u8>, AppError> {
    let path = effective_definition_path(db, definition)?;
    fs::read(&path).map_err(|error| AppError::io(&path, error))
}

fn effective_definition_path(
    db: &Arc<Database>,
    definition: &NativeSubagentDefinition,
) -> Result<PathBuf, AppError> {
    validate_definition_scope(db, definition)?;
    if let Some(record) = db.get_native_subagent_record(&definition.identity)? {
        Ok(effective_record_path(&record))
    } else {
        Ok(PathBuf::from(&definition.source_path))
    }
}

fn effective_record_path(record: &NativeSubagentRecord) -> PathBuf {
    if record.definition.enabled {
        PathBuf::from(&record.definition.source_path)
    } else {
        record
            .disabled_path
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&record.definition.source_path))
    }
}

fn require_managed_record(
    db: &Arc<Database>,
    identity: &str,
) -> Result<NativeSubagentRecord, AppError> {
    let record = db.get_native_subagent_record(identity)?.ok_or_else(|| {
        native_error(
            "NATIVE_SUBAGENT_NOT_MANAGED",
            &[("identity", identity)],
            Some("adoptFirst"),
        )
    })?;
    validate_definition_scope(db, &record.definition)?;
    Ok(record)
}

fn validate_definition_scope(
    db: &Arc<Database>,
    definition: &NativeSubagentDefinition,
) -> Result<(), AppError> {
    reject_legacy(definition)?;
    let resolved = ProjectService::resolve_scope_target(db, &definition.target)?;
    let agent = AgentType::from_str(&definition.agent)?;
    let source = Path::new(&definition.source_path);
    let safety_root = if definition.source_kind == NativeSubagentSourceKind::ConfigEntry {
        resolved
            .project_root
            .clone()
            .unwrap_or_else(config::get_opencode_config_dir)
    } else {
        native_safety_root(resolved.project_root.as_deref(), agent)
    };
    if let Some((ancestor, resolved_path)) = ancestor_symlink_within(source, &safety_root) {
        let ancestor = ancestor.display().to_string();
        let resolved_path = resolved_path.display().to_string();
        return Err(native_error(
            "NATIVE_SUBAGENT_ANCESTOR_SYMLINK_UNSAFE",
            &[
                ("identity", &definition.identity),
                ("ancestor", &ancestor),
                ("resolvedPath", &resolved_path),
            ],
            Some("useRegularAgentDirectory"),
        ));
    }
    let valid = if definition.source_kind == NativeSubagentSourceKind::ConfigEntry {
        agent == AgentType::OpenCode
            && opencode_config_candidates(resolved.project_root.as_deref())
                .iter()
                .any(|candidate| candidate == source)
    } else {
        let root = native_agents_dir(resolved.project_root.as_deref(), agent);
        config::path_is_within(&root, source)
    };
    if !valid {
        return Err(native_error(
            "NATIVE_SUBAGENT_SOURCE_OUTSIDE_CURRENT_SCOPE",
            &[
                ("identity", &definition.identity),
                ("path", &definition.source_path),
            ],
            Some("rescanAfterRelink"),
        ));
    }
    Ok(())
}

fn reject_legacy(definition: &NativeSubagentDefinition) -> Result<(), AppError> {
    if definition.source_kind == NativeSubagentSourceKind::Legacy
        || definition.format == NativeSubagentFormat::LegacyMarkdown
    {
        return Err(native_error(
            "NATIVE_SUBAGENT_LEGACY_REVIEW_REQUIRED",
            &[("identity", &definition.identity)],
            Some("reviewLegacyRecord"),
        ));
    }
    Ok(())
}

fn assert_expected_hash(
    actual: Option<&str>,
    expected: &str,
    identity: &str,
) -> Result<(), AppError> {
    if expected.trim().is_empty() || actual != Some(expected) {
        return Err(native_error(
            "NATIVE_SUBAGENT_EXTERNAL_MODIFICATION",
            &[("identity", identity)],
            Some("reload"),
        ));
    }
    Ok(())
}

fn disabled_path(identity: &str, source_path: &str) -> Result<PathBuf, AppError> {
    let file_name = Path::new(source_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::InvalidInput("原生 Subagent 文件名无效".to_string()))?;
    Ok(config::get_hub_dir()
        .join("native-subagents-disabled")
        .join(format!(
            "{}-{file_name}",
            identity.trim_start_matches("native:")
        )))
}

fn file_stem(path: &Path) -> Result<String, AppError> {
    path.file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::InvalidInput(format!("文件名无效: {}", path.display())))
}

fn hash_file(path: &Path) -> Result<String, AppError> {
    let bytes = fs::read(path).map_err(|error| AppError::io(path, error))?;
    Ok(hash_bytes(&bytes))
}

fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(unix)]
fn unix_mode_for_path(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .ok()
        .map(|metadata| metadata.permissions().mode())
}

#[cfg(not(unix))]
fn unix_mode_for_path(_path: &Path) -> Option<u32> {
    None
}

#[cfg(unix)]
fn restore_unix_mode(path: &Path, mode: Option<u32>) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|error| AppError::io(path, error))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn restore_unix_mode(_path: &Path, _mode: Option<u32>) -> Result<(), AppError> {
    Ok(())
}

fn diagnostic(
    severity: NativeDiagnosticSeverity,
    code: impl Into<String>,
    message: impl Into<String>,
) -> NativeSubagentDiagnostic {
    NativeSubagentDiagnostic {
        severity,
        code: code.into(),
        message: message.into(),
    }
}

fn native_error(code: &str, context: &[(&str, &str)], suggestion: Option<&str>) -> AppError {
    AppError::Message(format_subagent_error(code, context, suggestion))
}

fn parse_jsonc(content: &str) -> Result<JsonValue, AppError> {
    let normalized = normalize_jsonc(content)?;
    serde_json::from_str(&normalized)
        .map_err(|error| AppError::InvalidInput(format!("JSON/JSONC 无效: {error}")))
}

/// Replaces comments and trailing commas with spaces without changing byte
/// offsets. This keeps parser diagnostics meaningful and lets targeted edits
/// preserve the original JSONC document.
fn normalize_jsonc(content: &str) -> Result<String, AppError> {
    let bytes = content.as_bytes();
    let mut out = bytes.to_vec();
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if byte == b'"' {
            in_string = true;
            index += 1;
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'/') {
            out[index] = b' ';
            out[index + 1] = b' ';
            index += 2;
            while index < bytes.len() && !matches!(bytes[index], b'\n' | b'\r') {
                out[index] = b' ';
                index += 1;
            }
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            out[index] = b' ';
            out[index + 1] = b' ';
            index += 2;
            let mut closed = false;
            while index + 1 < bytes.len() {
                if bytes[index] == b'*' && bytes[index + 1] == b'/' {
                    out[index] = b' ';
                    out[index + 1] = b' ';
                    index += 2;
                    closed = true;
                    break;
                }
                if !matches!(bytes[index], b'\n' | b'\r') {
                    out[index] = b' ';
                }
                index += 1;
            }
            if !closed {
                return Err(AppError::InvalidInput("JSONC 块注释未闭合".to_string()));
            }
            continue;
        }
        index += 1;
    }
    let mut index = 0;
    while index < out.len() {
        if out[index] == b',' {
            let mut next = index + 1;
            while next < out.len() && out[next].is_ascii_whitespace() {
                next += 1;
            }
            if matches!(out.get(next), Some(b'}' | b']')) {
                out[index] = b' ';
            }
        }
        index += 1;
    }
    String::from_utf8(out).map_err(|_| AppError::InvalidInput("配置文件不是 UTF-8".to_string()))
}

fn replace_jsonc_entry_value(
    document: &str,
    key: &str,
    new_value: &str,
) -> Result<String, AppError> {
    parse_jsonc(new_value)
        .map_err(|error| AppError::InvalidInput(format!("Agent JSON 条目无效: {error}")))?;
    let (_, value_start, value_end, _) = find_jsonc_agent_entry(document, key)?;
    let mut output = String::with_capacity(document.len() + new_value.len());
    output.push_str(&document[..value_start]);
    output.push_str(new_value);
    output.push_str(&document[value_end..]);
    parse_jsonc(&output)?;
    Ok(output)
}

fn extract_jsonc_entry_source<'a>(document: &'a str, key: &str) -> Result<&'a str, AppError> {
    let (_, value_start, value_end, _) = find_jsonc_agent_entry(document, key)?;
    Ok(&document[value_start..value_end])
}

/// Replaces an existing OpenCode agent entry or inserts a missing one at the
/// beginning of the root `agent` object. Inserting at the beginning avoids
/// disturbing trailing commas and comments near the object's closing brace.
fn upsert_jsonc_entry(document: &str, key: &str, new_value: &str) -> Result<String, AppError> {
    parse_jsonc(new_value)
        .map_err(|error| AppError::InvalidInput(format!("Agent JSON 条目无效: {error}")))?;
    if find_jsonc_agent_entry(document, key).is_ok() {
        return replace_jsonc_entry_value(document, key, new_value);
    }

    let root = skip_jsonc_space(document, 0)?;
    if document.as_bytes().get(root) != Some(&b'{') {
        return Err(AppError::InvalidInput(
            "OpenCode 配置根必须是对象".to_string(),
        ));
    }
    let (_, agent_value_start, _, _) = find_object_property(document, root, "agent")?
        .ok_or_else(|| AppError::InvalidInput("OpenCode 配置缺少 agent 对象".to_string()))?;
    if document.as_bytes().get(agent_value_start) != Some(&b'{') {
        return Err(AppError::InvalidInput(
            "OpenCode agent 必须是对象".to_string(),
        ));
    }
    let parsed = parse_jsonc(document)?;
    let agent_entries = parsed
        .get("agent")
        .and_then(JsonValue::as_object)
        .ok_or_else(|| AppError::InvalidInput("OpenCode agent 必须是对象".to_string()))?;
    let encoded_key =
        serde_json::to_string(key).map_err(|error| AppError::JsonSerialize { source: error })?;
    let separator = if agent_entries.is_empty() { "" } else { "," };
    let insertion = format!("\n    {encoded_key}: {new_value}{separator}");
    let insert_at = agent_value_start + 1;
    let mut output = String::with_capacity(document.len() + insertion.len());
    output.push_str(&document[..insert_at]);
    output.push_str(&insertion);
    output.push_str(&document[insert_at..]);
    parse_jsonc(&output)?;
    Ok(output)
}

fn remove_jsonc_entry(document: &str, key: &str) -> Result<String, AppError> {
    let (property_start, _, _, property_end) = find_jsonc_agent_entry(document, key)?;
    let mut output = String::with_capacity(document.len());
    output.push_str(&document[..property_start]);
    output.push_str(&document[property_end..]);
    parse_jsonc(&output)?;
    Ok(output)
}

/// Returns `(property_start, value_start, value_end, property_end)` for one
/// member of the root `agent` object. The scanner understands strings and JSONC
/// comments and therefore does not rewrite unrelated keys/comments.
fn find_jsonc_agent_entry(
    document: &str,
    wanted_key: &str,
) -> Result<(usize, usize, usize, usize), AppError> {
    let root = skip_jsonc_space(document, 0)?;
    if document.as_bytes().get(root) != Some(&b'{') {
        return Err(AppError::InvalidInput(
            "OpenCode 配置根必须是对象".to_string(),
        ));
    }
    let (_, agent_value_start, _, _) = find_object_property(document, root, "agent")?
        .ok_or_else(|| AppError::InvalidInput("OpenCode 配置缺少 agent 对象".to_string()))?;
    if document.as_bytes().get(agent_value_start) != Some(&b'{') {
        return Err(AppError::InvalidInput(
            "OpenCode agent 必须是对象".to_string(),
        ));
    }
    find_object_property(document, agent_value_start, wanted_key)?
        .ok_or_else(|| AppError::InvalidInput(format!("OpenCode agent 条目不存在: {wanted_key}")))
}

fn find_object_property(
    document: &str,
    object_start: usize,
    wanted_key: &str,
) -> Result<Option<(usize, usize, usize, usize)>, AppError> {
    let bytes = document.as_bytes();
    let mut cursor = object_start + 1;
    loop {
        cursor = skip_jsonc_space(document, cursor)?;
        if bytes.get(cursor) == Some(&b'}') {
            return Ok(None);
        }
        let property_start = cursor;
        let (decoded_key, after_key) = parse_json_string_at(document, cursor)?;
        cursor = skip_jsonc_space(document, after_key)?;
        if bytes.get(cursor) != Some(&b':') {
            return Err(AppError::InvalidInput("JSON 属性缺少冒号".to_string()));
        }
        cursor = skip_jsonc_space(document, cursor + 1)?;
        let value_start = cursor;
        let value_end = scan_json_value_end(document, cursor)?;
        let mut after_value = skip_jsonc_space(document, value_end)?;
        let property_end = if bytes.get(after_value) == Some(&b',') {
            after_value += 1;
            after_value
        } else {
            // When removing the last property, consume the preceding comma.
            let mut start = property_start;
            let mut previous = property_start;
            while previous > object_start + 1 && bytes[previous - 1].is_ascii_whitespace() {
                previous -= 1;
            }
            if previous > object_start + 1 && bytes[previous - 1] == b',' {
                start = previous - 1;
            }
            if decoded_key == wanted_key {
                return Ok(Some((start, value_start, value_end, after_value)));
            }
            after_value
        };
        if decoded_key == wanted_key {
            return Ok(Some((property_start, value_start, value_end, property_end)));
        }
        cursor = after_value;
    }
}

fn skip_jsonc_space(document: &str, mut cursor: usize) -> Result<usize, AppError> {
    let bytes = document.as_bytes();
    loop {
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) == Some(&b'/') {
            cursor += 2;
            while cursor < bytes.len() && !matches!(bytes[cursor], b'\n' | b'\r') {
                cursor += 1;
            }
            continue;
        }
        if bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) == Some(&b'*') {
            cursor += 2;
            while cursor + 1 < bytes.len() && !(bytes[cursor] == b'*' && bytes[cursor + 1] == b'/')
            {
                cursor += 1;
            }
            if cursor + 1 >= bytes.len() {
                return Err(AppError::InvalidInput("JSONC 块注释未闭合".to_string()));
            }
            cursor += 2;
            continue;
        }
        return Ok(cursor);
    }
}

fn parse_json_string_at(document: &str, start: usize) -> Result<(String, usize), AppError> {
    let bytes = document.as_bytes();
    if bytes.get(start) != Some(&b'"') {
        return Err(AppError::InvalidInput(
            "JSON 属性名必须是字符串".to_string(),
        ));
    }
    let mut cursor = start + 1;
    let mut escaped = false;
    while cursor < bytes.len() {
        if escaped {
            escaped = false;
        } else if bytes[cursor] == b'\\' {
            escaped = true;
        } else if bytes[cursor] == b'"' {
            let raw = &document[start..=cursor];
            let decoded: String = serde_json::from_str(raw)
                .map_err(|error| AppError::InvalidInput(format!("JSON 属性名无效: {error}")))?;
            return Ok((decoded, cursor + 1));
        }
        cursor += 1;
    }
    Err(AppError::InvalidInput("JSON 字符串未闭合".to_string()))
}

fn scan_json_value_end(document: &str, start: usize) -> Result<usize, AppError> {
    let bytes = document.as_bytes();
    if start >= bytes.len() {
        return Err(AppError::InvalidInput("JSON 值缺失".to_string()));
    }
    if bytes[start] == b'"' {
        return parse_json_string_at(document, start).map(|(_, end)| end);
    }
    if matches!(bytes[start], b'{' | b'[') {
        let open = bytes[start];
        let close = if open == b'{' { b'}' } else { b']' };
        let mut depth = 0usize;
        let mut cursor = start;
        let mut in_string = false;
        let mut escaped = false;
        while cursor < bytes.len() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if bytes[cursor] == b'\\' {
                    escaped = true;
                } else if bytes[cursor] == b'"' {
                    in_string = false;
                }
                cursor += 1;
                continue;
            }
            if bytes[cursor] == b'"' {
                in_string = true;
            } else if bytes[cursor] == b'/' && matches!(bytes.get(cursor + 1), Some(b'/' | b'*')) {
                cursor = skip_jsonc_space(document, cursor)?;
                continue;
            } else if bytes[cursor] == open {
                depth += 1;
            } else if bytes[cursor] == close {
                depth -= 1;
                if depth == 0 {
                    return Ok(cursor + 1);
                }
            } else if (open == b'{' && bytes[cursor] == b'[')
                || (open == b'[' && bytes[cursor] == b'{')
            {
                let nested_end = scan_json_value_end(document, cursor)?;
                cursor = nested_end;
                continue;
            }
            cursor += 1;
        }
        return Err(AppError::InvalidInput("JSON 复合值未闭合".to_string()));
    }
    let mut cursor = start;
    while cursor < bytes.len() && !matches!(bytes[cursor], b',' | b'}' | b']') {
        cursor += 1;
    }
    let mut end = cursor;
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    Ok(end)
}

#[cfg(unix)]
fn create_symlink(target: &Path, link: &Path) -> Result<(), AppError> {
    std::os::unix::fs::symlink(target, link).map_err(|error| AppError::io(link, error))
}

#[cfg(windows)]
fn create_symlink(target: &Path, link: &Path) -> Result<(), AppError> {
    std::os::windows::fs::symlink_file(target, link).map_err(|error| AppError::io(link, error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    fn with_home<T>(run: impl FnOnce(&TempDir, Arc<Database>) -> T) -> T {
        let root = TempDir::new().unwrap();
        std::env::set_var(config::ACM_HOME_ENV, root.path());
        crate::settings::reset_settings_store_for_test();
        let db = Arc::new(Database::memory().unwrap());
        let output = run(&root, db);
        std::env::remove_var(config::ACM_HOME_ENV);
        crate::settings::reset_settings_store_for_test();
        output
    }

    #[test]
    #[serial]
    fn scans_each_native_file_format_and_ignores_opencode_primary() {
        with_home(|root, db| {
            let claude = root.path().join(".claude/agents/nested");
            let codex = root.path().join(".codex/agents");
            let gemini = root.path().join(".gemini/agents");
            let opencode = root.path().join(".config/opencode/agents");
            fs::create_dir_all(&claude).unwrap();
            fs::create_dir_all(&codex).unwrap();
            fs::create_dir_all(&gemini).unwrap();
            fs::create_dir_all(&opencode).unwrap();
            fs::write(
                claude.join("review.md"),
                "---\nname: reviewer\ndescription: Review\n---\nbody",
            )
            .unwrap();
            fs::write(
                codex.join("worker.toml"),
                "name = \"worker\"\ndescription = \"Work\"\ndeveloper_instructions = \"Do work\"\n",
            )
            .unwrap();
            fs::write(
                gemini.join("research.md"),
                "---\nname: research\ndescription: Research\n---\nbody",
            )
            .unwrap();
            fs::write(
                opencode.join("sub.md"),
                "---\nmode: subagent\ndescription: Sub\n---\nbody",
            )
            .unwrap();
            fs::write(
                opencode.join("implicit.md"),
                "---\ndescription: Implicit all\n---\nbody",
            )
            .unwrap();
            fs::write(opencode.join("primary.md"), "---\nmode: primary\n---\nbody").unwrap();

            let result = NativeSubagentService::scan(&db, &ConfigContext::Global).unwrap();
            assert_eq!(result.definitions.len(), 5);
            assert!(result
                .definitions
                .iter()
                .any(|item| item.agent == "codex" && item.format == NativeSubagentFormat::Toml));
            assert!(result
                .definitions
                .iter()
                .any(|item| item.agent == "opencode" && item.name == "sub"));
            assert!(result
                .definitions
                .iter()
                .any(|item| item.agent == "opencode" && item.name == "implicit"));
            assert!(!result.definitions.iter().any(|item| item.name == "primary"));
        });
    }

    #[test]
    #[serial]
    fn jsonc_entry_edit_preserves_comments_and_other_entries() {
        let document = "{\n // keep me\n \"agent\": {\n  \"review\": {\"mode\":\"subagent\",\"prompt\":\"old\"},\n  \"other\": {\"mode\":\"all\"},\n },\n \"theme\": \"dark\"\n}\n";
        let replaced = replace_jsonc_entry_value(
            document,
            "review",
            "{\n  \"mode\": \"subagent\",\n  \"prompt\": \"new\"\n}",
        )
        .unwrap();
        assert!(replaced.contains("// keep me"));
        assert!(replaced.contains("\"other\""));
        assert!(replaced.contains("\"theme\": \"dark\""));
        assert!(replaced.contains("\"prompt\": \"new\""));
        let removed = remove_jsonc_entry(&replaced, "review").unwrap();
        assert!(!removed.contains("\"review\""));
        assert!(removed.contains("// keep me"));
        assert!(removed.contains("\"other\""));
    }

    #[test]
    #[serial]
    fn adopt_save_and_occ_conflict_are_isolated() {
        with_home(|root, db| {
            let agents = root.path().join(".codex/agents");
            fs::create_dir_all(&agents).unwrap();
            let path = agents.join("worker.toml");
            fs::write(
                &path,
                "name = \"worker\"\ndeveloper_instructions = \"old\"\n",
            )
            .unwrap();
            let scan = NativeSubagentService::scan(&db, &ConfigContext::Global).unwrap();
            let candidate = scan.definitions.into_iter().next().unwrap();
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            let saved = NativeSubagentService::save(
                &db,
                &adopted.identity,
                "name = \"worker\"\ndeveloper_instructions = \"new\"\n",
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(saved.content.contains("new"));
            fs::write(
                &path,
                "name = \"worker\"\ndeveloper_instructions = \"external\"\n",
            )
            .unwrap();
            let error = NativeSubagentService::save(
                &db,
                &adopted.identity,
                "name = \"worker\"\ndeveloper_instructions = \"overwrite\"\n",
                &saved.content_hash,
            )
            .unwrap_err();
            assert!(error
                .to_string()
                .contains("NATIVE_SUBAGENT_EXTERNAL_MODIFICATION"));
            assert!(fs::read_to_string(path).unwrap().contains("external"));
        });
    }

    #[test]
    #[serial]
    fn file_disable_enable_uninstall_and_restore_roundtrip() {
        with_home(|root, db| {
            let agents = root.path().join(".claude/agents");
            fs::create_dir_all(&agents).unwrap();
            let path = agents.join("reviewer.md");
            fs::write(
                &path,
                "---\nname: reviewer\ndescription: Review\n---\nbody\n",
            )
            .unwrap();
            let candidate = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "reviewer")
                .unwrap();
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            let disabled = NativeSubagentService::set_enabled(
                &db,
                &adopted.identity,
                false,
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(!disabled.enabled);
            assert!(!path.exists());
            let enabled = NativeSubagentService::set_enabled(
                &db,
                &adopted.identity,
                true,
                disabled.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(enabled.enabled);
            assert!(path.exists());
            let result = NativeSubagentService::uninstall(
                &db,
                &adopted.identity,
                enabled.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(!path.exists());
            let restored = NativeSubagentService::restore_backup(
                &db,
                result.backup_id.as_deref().unwrap(),
                None,
            )
            .unwrap();
            assert!(restored.enabled);
            assert!(path.exists());
            assert!(fs::read_to_string(path).unwrap().contains("body"));
        });
    }

    #[test]
    #[serial]
    fn opencode_config_entry_toggle_preserves_jsonc_neighbors() {
        with_home(|root, db| {
            let config_dir = root.path().join(".config/opencode");
            fs::create_dir_all(&config_dir).unwrap();
            let path = config_dir.join("opencode.jsonc");
            fs::write(
                &path,
                "{\n // durable comment\n \"agent\": {\n  \"review\": {\"mode\":\"subagent\",\"prompt\":\"keep\"},\n  \"primary\": {\"mode\":\"primary\"}\n },\n \"theme\":\"dark\"\n}\n",
            )
            .unwrap();
            let candidate = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "review")
                .unwrap();
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            let disabled = NativeSubagentService::set_enabled(
                &db,
                &adopted.identity,
                false,
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(!disabled.enabled);
            let document = fs::read_to_string(&path).unwrap();
            assert!(document.contains("durable comment"));
            assert!(document.contains("\"primary\""));
            assert!(document.contains("\"theme\":\"dark\""));
            assert!(document.contains("\"disable\": true"));
            let enabled = NativeSubagentService::set_enabled(
                &db,
                &adopted.identity,
                true,
                disabled.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(enabled.enabled);
            assert!(!fs::read_to_string(&path)
                .unwrap()
                .contains("\"disable\": true"));

            // External native state changes must be read before deciding that a
            // toggle is an idempotent no-op; the registry may be stale.
            let externally_disabled = fs::read_to_string(&path).unwrap().replace(
                "\"prompt\": \"keep\"",
                "\"prompt\": \"keep\", \"disable\": true",
            );
            fs::write(&path, externally_disabled).unwrap();
            let rescanned = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "review")
                .unwrap();
            assert!(!rescanned.enabled);
            NativeSubagentService::set_enabled(
                &db,
                &adopted.identity,
                true,
                rescanned.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(!fs::read_to_string(&path)
                .unwrap()
                .contains("\"disable\": true"));
        });
    }

    #[test]
    #[serial]
    fn opencode_config_entry_uninstall_restore_preserves_neighbors_and_native_state() {
        with_home(|root, db| {
            let config_dir = root.path().join(".config/opencode");
            fs::create_dir_all(&config_dir).unwrap();
            let path = config_dir.join("opencode.jsonc");
            fs::write(
                &path,
                "{\n // keep\n \"agent\": {\n  \"review\": {\"prompt\":\"old\",\"disable\":true},\n  \"other\": {\"prompt\":\"before\"}\n },\n \"theme\":\"dark\"\n}\n",
            )
            .unwrap();
            let candidate = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "review")
                .unwrap();
            assert!(!candidate.enabled);
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            let uninstall = NativeSubagentService::uninstall(
                &db,
                &adopted.identity,
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            let after_uninstall = fs::read_to_string(&path).unwrap();
            assert!(!after_uninstall.contains("\"review\""));
            let externally_updated = after_uninstall
                .replace("\"before\"", "\"after\"")
                .replace("\"dark\"", "\"light\"");
            fs::write(&path, externally_updated).unwrap();

            let restored = NativeSubagentService::restore_backup(
                &db,
                uninstall.backup_id.as_deref().unwrap(),
                None,
            )
            .unwrap();
            assert!(!restored.enabled);
            assert_eq!(
                restored.management_status,
                NativeSubagentManagementStatus::Disabled
            );
            let document = fs::read_to_string(&path).unwrap();
            assert!(document.contains("// keep"));
            assert!(document.contains("\"review\""));
            assert!(document.contains("\"disable\":true"));
            assert!(document.contains("\"after\""));
            assert!(document.contains("\"light\""));
        });
    }

    #[test]
    #[serial]
    fn restore_with_expected_hash_persists_before_restore_backup() {
        with_home(|root, db| {
            let agents = root.path().join(".codex/agents");
            fs::create_dir_all(&agents).unwrap();
            let path = agents.join("worker.toml");
            fs::write(
                &path,
                "name = \"worker\"\ndeveloper_instructions = \"old\"\n",
            )
            .unwrap();
            let candidate = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "worker")
                .unwrap();
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            let old_backup = NativeSubagentService::create_backup(
                &db,
                &adopted.identity,
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            let saved = NativeSubagentService::save(
                &db,
                &adopted.identity,
                "name = \"worker\"\ndeveloper_instructions = \"new\"\n",
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(
                NativeSubagentService::restore_backup(&db, &old_backup.backup_id, None)
                    .unwrap_err()
                    .to_string()
                    .contains("NATIVE_SUBAGENT_RESTORE_CONFLICT")
            );
            NativeSubagentService::restore_backup(
                &db,
                &old_backup.backup_id,
                Some(&saved.content_hash),
            )
            .unwrap();
            assert!(fs::read_to_string(&path).unwrap().contains("old"));
            let backups = NativeSubagentService::list_backups(&db, &ConfigContext::Global).unwrap();
            let guard = backups
                .iter()
                .find(|backup| backup.reason.as_deref() == Some("before-restore"))
                .expect("restore must persist the overwritten current version");
            let guard_record = db
                .get_native_subagent_backup_record(&guard.backup_id)
                .unwrap()
                .unwrap();
            assert!(String::from_utf8(guard_record.content)
                .unwrap()
                .contains("new"));
        });
    }

    #[test]
    #[serial]
    fn legacy_codex_projection_remains_review_only() {
        with_home(|_, db| {
            db.conn
                .lock()
                .unwrap()
                .execute(
                    "INSERT INTO subagents (
                        id, name, directory, enabled_codex, scope, project_id
                     ) VALUES (?1, ?2, ?3, 1, 'global', NULL)",
                    rusqlite::params!["legacy", "Legacy worker", "legacy-worker"],
                )
                .unwrap();
            let scan = NativeSubagentService::scan(&db, &ConfigContext::Global).unwrap();
            let legacy = scan
                .definitions
                .into_iter()
                .find(|item| item.identity.starts_with("legacy:"))
                .unwrap();
            assert_eq!(
                legacy.management_status,
                NativeSubagentManagementStatus::LegacyReview
            );
            assert_eq!(legacy.format, NativeSubagentFormat::LegacyMarkdown);
            assert!(legacy
                .diagnostics
                .iter()
                .any(|item| item.code == "LEGACY_CODEX_MARKDOWN_INVALID"));
            assert!(
                NativeSubagentService::adopt(&db, &legacy.identity, "ignored", false)
                    .unwrap_err()
                    .to_string()
                    .contains("NATIVE_SUBAGENT_LEGACY_REVIEW_REQUIRED")
            );
        });
    }

    #[test]
    #[serial]
    fn opencode_moved_disabled_save_stays_disabled_and_native_disable_can_enable() {
        with_home(|root, db| {
            let agents = root.path().join(".config/opencode/agents");
            fs::create_dir_all(&agents).unwrap();
            let moved_path = agents.join("moved.md");
            fs::write(&moved_path, "---\nmode: subagent\n---\nold\n").unwrap();
            let native_path = agents.join("native.md");
            fs::write(
                &native_path,
                "---\ndisable: true\ndescription: Native disabled\n---\nbody\n",
            )
            .unwrap();
            let scan = NativeSubagentService::scan(&db, &ConfigContext::Global).unwrap();
            let moved = scan
                .definitions
                .iter()
                .find(|item| item.name == "moved")
                .unwrap();
            let native = scan
                .definitions
                .iter()
                .find(|item| item.name == "native")
                .unwrap();
            let moved = NativeSubagentService::adopt(
                &db,
                &moved.identity,
                moved.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            let moved = NativeSubagentService::set_enabled(
                &db,
                &moved.identity,
                false,
                moved.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            let saved = NativeSubagentService::save(
                &db,
                &moved.identity,
                "---\nmode: subagent\n---\nupdated\n",
                moved.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(!saved.definition.enabled);
            assert!(!moved_path.exists());
            assert!(NativeSubagentService::read(&db, &moved.identity)
                .unwrap()
                .content
                .contains("updated"));

            let native = NativeSubagentService::adopt(
                &db,
                &native.identity,
                native.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            assert!(!native.enabled);
            let enabled = NativeSubagentService::set_enabled(
                &db,
                &native.identity,
                true,
                native.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(enabled.enabled);
            assert!(!fs::read_to_string(native_path)
                .unwrap()
                .contains("disable: true"));
        });
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn ancestor_symlink_definitions_are_visible_but_cannot_be_adopted() {
        with_home(|root, db| {
            let project_root = root.path().join("project");
            let project_external = root.path().join("project-external-codex");
            fs::create_dir_all(project_external.join("agents")).unwrap();
            fs::create_dir_all(&project_root).unwrap();
            fs::write(
                project_external.join("agents/project-worker.toml"),
                "name = \"project-worker\"\ndeveloper_instructions = \"safe read\"\n",
            )
            .unwrap();
            std::os::unix::fs::symlink(&project_external, project_root.join(".codex")).unwrap();
            let project = ProjectService::add_project(&db, &project_root, None).unwrap();
            let context = ConfigContext::Project {
                project_id: project.project_id.clone(),
            };
            let candidate = NativeSubagentService::scan(&db, &context)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "project-worker")
                .unwrap();
            assert!(candidate
                .diagnostics
                .iter()
                .any(|item| item.code == "ANCESTOR_SYMLINK_UNSAFE"));
            let error = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap_err();
            assert!(error
                .to_string()
                .contains("NATIVE_SUBAGENT_ANCESTOR_SYMLINK_UNSAFE"));
            assert!(db
                .get_native_subagent_record(&candidate.identity)
                .unwrap()
                .is_none());

            let global_external = root.path().join("global-external-codex");
            fs::create_dir_all(global_external.join("agents")).unwrap();
            fs::write(
                global_external.join("agents/global-worker.toml"),
                "name = \"global-worker\"\ndeveloper_instructions = \"safe read\"\n",
            )
            .unwrap();
            std::os::unix::fs::symlink(&global_external, root.path().join(".codex")).unwrap();
            let global = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "global-worker")
                .unwrap();
            assert!(global.diagnostics.iter().any(|item| item
                .message
                .contains(&global_external.display().to_string())));
            assert!(NativeSubagentService::adopt(
                &db,
                &global.identity,
                global.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap_err()
            .to_string()
            .contains("NATIVE_SUBAGENT_ANCESTOR_SYMLINK_UNSAFE"));
        });
    }

    #[test]
    #[serial]
    fn scan_keeps_same_names_distinct_reports_invalid_and_project_codex_is_manageable() {
        with_home(|root, db| {
            let global_codex = root.path().join(".codex/agents");
            fs::create_dir_all(&global_codex).unwrap();
            fs::write(
                global_codex.join("one.toml"),
                "name = \"worker\"\ndeveloper_instructions = \"one\"\n",
            )
            .unwrap();
            fs::write(
                global_codex.join("two.toml"),
                "name = \"worker\"\ndeveloper_instructions = \"two\"\n",
            )
            .unwrap();
            let gemini = root.path().join(".gemini/agents");
            fs::create_dir_all(&gemini).unwrap();
            fs::write(
                gemini.join("invalid.md"),
                "---\ndescription: no name\n---\nbody\n",
            )
            .unwrap();
            fs::create_dir_all(root.path().join(".claude")).unwrap();
            fs::write(root.path().join(".claude/agents"), "not a directory").unwrap();

            let project_root = root.path().join("project");
            let project_codex = project_root.join(".codex/agents");
            fs::create_dir_all(&project_codex).unwrap();
            fs::write(
                project_codex.join("worker.toml"),
                "name = \"worker\"\ndeveloper_instructions = \"project\"\n",
            )
            .unwrap();
            let project = ProjectService::add_project(&db, &project_root, None).unwrap();
            let scan = NativeSubagentService::scan(&db, &ConfigContext::All).unwrap();
            let workers: Vec<_> = scan
                .definitions
                .iter()
                .filter(|item| item.agent == "codex" && item.name == "worker")
                .collect();
            assert_eq!(workers.len(), 3);
            assert_eq!(
                workers
                    .iter()
                    .map(|item| item.identity.as_str())
                    .collect::<HashSet<_>>()
                    .len(),
                3
            );
            assert!(workers.iter().any(|item| item
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "DUPLICATE_NAME_IN_TARGET")));
            assert!(workers.iter().all(|item| item
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "GLOBAL_PROJECT_NAME_SHADOWING")));
            assert!(scan.definitions.iter().any(|item| {
                item.name == "invalid"
                    && item.management_status == NativeSubagentManagementStatus::Invalid
            }));
            assert!(scan
                .scan_errors
                .iter()
                .any(|item| item.code == "DIRECTORY_UNREADABLE"));

            let project_worker = workers
                .into_iter()
                .find(|item| {
                    item.target
                        == ScopeTarget::Project {
                            project_id: project.project_id.clone(),
                        }
                })
                .unwrap();
            let adopted = NativeSubagentService::adopt(
                &db,
                &project_worker.identity,
                project_worker.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            assert_eq!(adopted.agent, "codex");
            assert_eq!(adopted.target, project_worker.target);
        });
    }

    #[test]
    #[serial]
    fn db_failure_rolls_back_file_and_upstream_hash_together() {
        with_home(|root, db| {
            let agents = root.path().join(".codex/agents");
            fs::create_dir_all(&agents).unwrap();
            let path = agents.join("worker.toml");
            let original = "name = \"worker\"\ndeveloper_instructions = \"old\"\n";
            fs::write(&path, original).unwrap();
            let candidate = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "worker")
                .unwrap();
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            db.conn
                .lock()
                .unwrap()
                .execute_batch(
                    "CREATE TRIGGER fail_native_update BEFORE UPDATE ON native_subagents
                     BEGIN SELECT RAISE(FAIL, 'forced native DB failure'); END;",
                )
                .unwrap();
            let error = NativeSubagentService::save_with_upstream(
                &db,
                &adopted.identity,
                "name = \"worker\"\ndeveloper_instructions = \"remote\"\n",
                adopted.content_hash.as_deref().unwrap(),
                Some("remote-hash"),
            )
            .unwrap_err();
            assert!(error.to_string().contains("forced native DB failure"));
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
            let record = db
                .get_native_subagent_record(&adopted.identity)
                .unwrap()
                .unwrap();
            assert_eq!(record.upstream_hash, None);
        });
    }

    #[test]
    #[serial]
    fn project_native_state_blocks_relink_and_remove_until_backups_are_deleted() {
        with_home(|root, db| {
            let project_root = root.path().join("project");
            let replacement_root = root.path().join("replacement");
            let agents = project_root.join(".codex/agents");
            fs::create_dir_all(&agents).unwrap();
            fs::create_dir_all(&replacement_root).unwrap();
            fs::write(
                agents.join("worker.toml"),
                "name = \"worker\"\ndeveloper_instructions = \"project\"\n",
            )
            .unwrap();
            let project = ProjectService::add_project(&db, &project_root, None).unwrap();
            let context = ConfigContext::Project {
                project_id: project.project_id.clone(),
            };
            let candidate = NativeSubagentService::scan(&db, &context)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "worker")
                .unwrap();
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            assert!(ProjectService::relink_project_root(
                &db,
                &project.project_id,
                &replacement_root,
            )
            .unwrap_err()
            .to_string()
            .contains("PROJECT_HAS_NATIVE_SUBAGENT_STATE"));
            let uninstall = NativeSubagentService::uninstall(
                &db,
                &adopted.identity,
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(uninstall.backup_id.is_some());
            assert!(ProjectService::remove_project(&db, &project.project_id)
                .unwrap_err()
                .to_string()
                .contains("PROJECT_HAS_NATIVE_SUBAGENT_STATE"));
            for backup in NativeSubagentService::list_backups(&db, &context).unwrap() {
                NativeSubagentService::delete_backup(&db, &backup.backup_id, &backup.content_hash)
                    .unwrap();
            }
            ProjectService::remove_project(&db, &project.project_id).unwrap();
        });
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn symlink_adoption_creates_independent_copy_without_touching_target() {
        with_home(|root, db| {
            let external = root.path().join("external.toml");
            fs::write(
                &external,
                "name = \"worker\"\ndeveloper_instructions = \"external\"\n",
            )
            .unwrap();
            let agents = root.path().join(".codex/agents");
            fs::create_dir_all(&agents).unwrap();
            let link = agents.join("worker.toml");
            std::os::unix::fs::symlink(&external, &link).unwrap();
            let candidate = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "worker")
                .unwrap();
            let error = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap_err();
            assert!(error.to_string().contains("SYMLINK_CONFIRMATION_REQUIRED"));
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                true,
            )
            .unwrap();
            assert!(!fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink());
            assert!(!adopted.is_symlink);
            NativeSubagentService::save(
                &db,
                &adopted.identity,
                "name = \"worker\"\ndeveloper_instructions = \"managed\"\n",
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert!(fs::read_to_string(link).unwrap().contains("managed"));
            assert!(fs::read_to_string(external).unwrap().contains("external"));
        });
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn save_and_restore_preserve_private_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        with_home(|root, db| {
            let agents = root.path().join(".codex/agents");
            fs::create_dir_all(&agents).unwrap();
            let path = agents.join("private.toml");
            fs::write(
                &path,
                "name = \"private\"\ndeveloper_instructions = \"old\"\n",
            )
            .unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
            let candidate = NativeSubagentService::scan(&db, &ConfigContext::Global)
                .unwrap()
                .definitions
                .into_iter()
                .find(|item| item.name == "private")
                .unwrap();
            let adopted = NativeSubagentService::adopt(
                &db,
                &candidate.identity,
                candidate.content_hash.as_deref().unwrap(),
                false,
            )
            .unwrap();
            let saved = NativeSubagentService::save(
                &db,
                &adopted.identity,
                "name = \"private\"\ndeveloper_instructions = \"new\"\n",
                adopted.content_hash.as_deref().unwrap(),
            )
            .unwrap();
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            let uninstall =
                NativeSubagentService::uninstall(&db, &adopted.identity, &saved.content_hash)
                    .unwrap();
            NativeSubagentService::restore_backup(
                &db,
                uninstall.backup_id.as_deref().unwrap(),
                None,
            )
            .unwrap();
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        });
    }

    /// Manual acceptance probe. It uses an in-memory registry, performs no
    /// adopt/mutation, and prints metadata only (never source content).
    #[test]
    #[ignore = "reads the current host's configured Agent directories"]
    #[serial]
    fn scan_real_host_is_read_only_and_prints_metadata_only() {
        std::env::remove_var(config::ACM_HOME_ENV);
        crate::settings::reset_settings_store_for_test();
        let db = Arc::new(Database::memory().unwrap());
        let result = NativeSubagentService::scan(&db, &ConfigContext::Global).unwrap();
        println!("native subagents: {}", result.definitions.len());
        for definition in result.definitions {
            println!(
                "{}\t{}\t{}\t{}",
                definition.agent,
                definition.name,
                definition.format.as_str(),
                definition.source_path
            );
        }
        for error in result.scan_errors {
            println!("scan-error\t{}\t{}", error.code, error.message);
        }
    }
}
