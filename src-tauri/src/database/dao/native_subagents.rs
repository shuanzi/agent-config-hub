//! SQLite persistence for per-Agent native Subagents.

use rusqlite::{params, OptionalExtension, Row};
use std::path::Path;

use crate::config;
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::services::native_subagent::{
    NativeDiagnosticSeverity, NativeSubagentBackup, NativeSubagentBackupRecord,
    NativeSubagentDefinition, NativeSubagentDiagnostic, NativeSubagentFormat,
    NativeSubagentManagementStatus, NativeSubagentRecord, NativeSubagentSourceKind,
};
use crate::services::project::{ConfigContext, ScopeTarget};
use crate::services::skill::AgentType;

impl Database {
    pub(crate) fn has_native_subagent_state_for_project(
        &self,
        project_id: &str,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let has_record: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM native_subagents WHERE scope = 'project' AND project_id = ?1)",
                [project_id],
                |row| row.get(0),
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
        if has_record {
            return Ok(true);
        }
        let mut statement = conn
            .prepare("SELECT metadata_json FROM native_subagent_backups")
            .map_err(|error| AppError::Database(error.to_string()))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| AppError::Database(error.to_string()))?;
        for metadata in rows {
            let metadata = metadata.map_err(|error| AppError::Database(error.to_string()))?;
            let definition: NativeSubagentDefinition = serde_json::from_str(&metadata)
                .map_err(|error| AppError::json("native backup metadata", error))?;
            if matches!(
                definition.target,
                ScopeTarget::Project { project_id: ref stored } if stored == project_id
            ) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn save_native_subagent_record(
        &self,
        record: &NativeSubagentRecord,
    ) -> Result<(), AppError> {
        let (scope, project_id) = target_parts(&record.definition.target);
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO native_subagents (
                identity, name, description, agent, format, source_kind, source_path, source_key,
                scope, project_id, enabled, content_hash, upstream_hash, disabled_path, adopted_symlink,
                repo_owner, repo_name, repo_branch, repo_path, installed_at, updated_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
             ) ON CONFLICT(identity) DO UPDATE SET
                name=excluded.name, description=excluded.description, agent=excluded.agent,
                format=excluded.format, source_kind=excluded.source_kind, source_path=excluded.source_path,
                source_key=excluded.source_key, scope=excluded.scope, project_id=excluded.project_id,
                enabled=excluded.enabled, content_hash=excluded.content_hash, upstream_hash=excluded.upstream_hash,
                disabled_path=excluded.disabled_path, adopted_symlink=excluded.adopted_symlink,
                repo_owner=excluded.repo_owner, repo_name=excluded.repo_name,
                repo_branch=excluded.repo_branch, repo_path=excluded.repo_path,
                installed_at=excluded.installed_at, updated_at=excluded.updated_at",
            params![
                record.definition.identity,
                record.definition.name,
                record.definition.description,
                record.definition.agent,
                record.definition.format.as_str(),
                record.definition.source_kind.as_str(),
                record.definition.source_path,
                record.definition.source_key,
                scope,
                project_id,
                record.definition.enabled,
                record.definition.content_hash,
                record.upstream_hash,
                record.disabled_path,
                record.adopted_symlink,
                record.definition.repo_owner,
                record.definition.repo_name,
                record.definition.repo_branch,
                record.definition.repo_path,
                record.installed_at,
                record.updated_at,
            ],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(())
    }

    pub(crate) fn get_native_subagent_record(
        &self,
        identity: &str,
    ) -> Result<Option<NativeSubagentRecord>, AppError> {
        let conn = lock_conn!(self.conn);
        conn.query_row(
            "SELECT identity, name, description, agent, format, source_kind, source_path, source_key,
                    scope, project_id, enabled, content_hash, upstream_hash, disabled_path, adopted_symlink,
                    repo_owner, repo_name, repo_branch, repo_path, installed_at, updated_at
             FROM native_subagents WHERE identity = ?1",
            [identity],
            native_record_from_row,
        )
        .optional()
        .map_err(|error| AppError::Database(error.to_string()))
    }

    pub(crate) fn get_native_subagent_records_for_context(
        &self,
        context: &ConfigContext,
    ) -> Result<Vec<NativeSubagentRecord>, AppError> {
        let conn = lock_conn!(self.conn);
        let (sql, project_id): (&str, Option<&str>) = match context {
            ConfigContext::All => (
                "SELECT identity, name, description, agent, format, source_kind, source_path, source_key,
                        scope, project_id, enabled, content_hash, upstream_hash, disabled_path, adopted_symlink,
                        repo_owner, repo_name, repo_branch, repo_path, installed_at, updated_at
                 FROM native_subagents ORDER BY scope, project_id, agent, name",
                None,
            ),
            ConfigContext::Global => (
                "SELECT identity, name, description, agent, format, source_kind, source_path, source_key,
                        scope, project_id, enabled, content_hash, upstream_hash, disabled_path, adopted_symlink,
                        repo_owner, repo_name, repo_branch, repo_path, installed_at, updated_at
                 FROM native_subagents WHERE scope = 'global' ORDER BY agent, name",
                None,
            ),
            ConfigContext::Project { project_id } => (
                "SELECT identity, name, description, agent, format, source_kind, source_path, source_key,
                        scope, project_id, enabled, content_hash, upstream_hash, disabled_path, adopted_symlink,
                        repo_owner, repo_name, repo_branch, repo_path, installed_at, updated_at
                 FROM native_subagents WHERE scope = 'project' AND project_id = ?1 ORDER BY agent, name",
                Some(project_id.as_str()),
            ),
        };
        let mut statement = conn
            .prepare(sql)
            .map_err(|error| AppError::Database(error.to_string()))?;
        let rows = if let Some(project_id) = project_id {
            statement.query_map([project_id], native_record_from_row)
        } else {
            statement.query_map([], native_record_from_row)
        }
        .map_err(|error| AppError::Database(error.to_string()))?;
        rows.map(|row| row.map_err(|error| AppError::Database(error.to_string())))
            .collect()
    }

    pub(crate) fn delete_native_subagent_record(&self, identity: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM native_subagents WHERE identity = ?1",
            [identity],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(())
    }

    pub(crate) fn save_native_subagent_backup(
        &self,
        record: &NativeSubagentBackupRecord,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO native_subagent_backups (
                backup_id, identity, metadata_json, content, content_hash,
                source_document_hash, unix_mode, reason, legacy, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                record.backup.backup_id,
                record.backup.identity,
                record.definition_json,
                record.content,
                record.backup.content_hash,
                record.source_document_hash,
                record.unix_mode,
                record.backup.reason,
                record.backup.legacy,
                record.backup.created_at,
            ],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(())
    }

    pub(crate) fn delete_native_subagent_backup(&self, backup_id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM native_subagent_backups WHERE backup_id = ?1",
            [backup_id],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(())
    }

    pub(crate) fn prune_native_subagent_backups(&self, retain: usize) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM native_subagent_backups
             WHERE backup_id IN (
                SELECT backup_id FROM native_subagent_backups
                ORDER BY created_at DESC, backup_id DESC LIMIT -1 OFFSET ?1
             )",
            [retain as i64],
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
        Ok(())
    }

    pub(crate) fn get_native_subagent_backup_record(
        &self,
        backup_id: &str,
    ) -> Result<Option<NativeSubagentBackupRecord>, AppError> {
        let conn = lock_conn!(self.conn);
        conn.query_row(
            "SELECT backup_id, identity, metadata_json, content, content_hash,
                    source_document_hash, unix_mode, reason, legacy, created_at
             FROM native_subagent_backups WHERE backup_id = ?1",
            [backup_id],
            backup_record_from_row,
        )
        .optional()
        .map_err(|error| AppError::Database(error.to_string()))
    }

    pub(crate) fn get_native_subagent_backups_for_context(
        &self,
        context: &ConfigContext,
    ) -> Result<Vec<NativeSubagentBackup>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut statement = conn
            .prepare(
                "SELECT backup_id, identity, metadata_json, content, content_hash,
                        source_document_hash, unix_mode, reason, legacy, created_at
                 FROM native_subagent_backups ORDER BY created_at DESC, backup_id DESC",
            )
            .map_err(|error| AppError::Database(error.to_string()))?;
        let rows = statement
            .query_map([], backup_record_from_row)
            .map_err(|error| AppError::Database(error.to_string()))?;
        let mut backups = Vec::new();
        for row in rows {
            let record = row.map_err(|error| AppError::Database(error.to_string()))?;
            let definition: NativeSubagentDefinition =
                serde_json::from_str(&record.definition_json)
                    .map_err(|error| AppError::json("native backup metadata", error))?;
            if context_matches_target(context, &definition.target) {
                backups.push(NativeSubagentBackup {
                    backup_id: record.backup.backup_id,
                    identity: record.backup.identity,
                    name: definition.name,
                    agent: definition.agent,
                    target: definition.target,
                    format: definition.format,
                    source_path: definition.source_path,
                    content_hash: record.backup.content_hash,
                    created_at: record.backup.created_at,
                    reason: record.backup.reason,
                    legacy: record.backup.legacy,
                });
            }
        }
        Ok(backups)
    }

    /// Exposes legacy projection rows as read-only review items. Nothing is
    /// written back and no legacy backup is automatically restored.
    pub(crate) fn get_legacy_native_subagent_definitions(
        &self,
        context: &ConfigContext,
    ) -> Result<Vec<NativeSubagentDefinition>, AppError> {
        let conn = lock_conn!(self.conn);
        let (where_clause, project_param): (&str, Option<&str>) = match context {
            ConfigContext::All => ("", None),
            ConfigContext::Global => ("WHERE s.scope = 'global'", None),
            ConfigContext::Project { project_id } => (
                "WHERE s.scope = 'project' AND s.project_id = ?1",
                Some(project_id),
            ),
        };
        let sql = format!(
            "SELECT s.id, s.name, s.description, s.directory, s.scope, s.project_id,
                    s.enabled_claude_code, s.enabled_codex, s.enabled_gemini_cli, s.enabled_opencode,
                    p.root_path
             FROM subagents s LEFT JOIN projects p ON p.project_id = s.project_id {where_clause}
             ORDER BY s.scope, s.project_id, s.name, s.id"
        );
        let mut statement = conn
            .prepare(&sql)
            .map_err(|error| AppError::Database(error.to_string()))?;
        let mut definitions = Vec::new();
        let mut consume = |row: &Row<'_>| -> Result<(), rusqlite::Error> {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let description: Option<String> = row.get(2)?;
            let directory: String = row.get(3)?;
            let scope: String = row.get(4)?;
            let project_id: Option<String> = row.get(5)?;
            let flags: [bool; 4] = [row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?];
            let project_root: Option<String> = row.get(10)?;
            let target = db_target(&scope, project_id.clone());
            for (agent, enabled) in AgentType::all().zip(flags) {
                if !enabled {
                    continue;
                }
                let source_path = match project_root.as_deref() {
                    Some(root) => project_agent_dir(Path::new(root), agent),
                    None => global_agent_dir(agent),
                }
                .join(format!("{directory}.md"));
                let mut diagnostics = vec![NativeSubagentDiagnostic {
                    severity: NativeDiagnosticSeverity::Warning,
                    code: "LEGACY_CROSS_AGENT_RECORD".to_string(),
                    message: "旧版记录曾把同一 Markdown 投影到多个 Agent，需要人工核对".to_string(),
                }];
                if agent == AgentType::Codex {
                    diagnostics.push(NativeSubagentDiagnostic {
                        severity: NativeDiagnosticSeverity::Error,
                        code: "LEGACY_CODEX_MARKDOWN_INVALID".to_string(),
                        message: "Codex 原生 Subagent 必须是 TOML；旧 Markdown 投影不再视为有效"
                            .to_string(),
                    });
                }
                definitions.push(NativeSubagentDefinition {
                    identity: format!(
                        "legacy:{}:{}:{}:{}",
                        scope,
                        project_id.as_deref().unwrap_or("global"),
                        id,
                        agent.as_str()
                    ),
                    name: name.clone(),
                    description: description.clone(),
                    agent: agent.as_str().to_string(),
                    target: target.clone(),
                    format: NativeSubagentFormat::LegacyMarkdown,
                    source_kind: NativeSubagentSourceKind::Legacy,
                    source_path: source_path.display().to_string(),
                    source_key: None,
                    management_status: NativeSubagentManagementStatus::LegacyReview,
                    enabled: false,
                    content_hash: None,
                    is_symlink: false,
                    symlink_target: None,
                    diagnostics,
                    repo_owner: None,
                    repo_name: None,
                    repo_branch: None,
                    repo_path: None,
                });
            }
            Ok(())
        };
        if let Some(project_id) = project_param {
            let rows = statement.query_map([project_id], |row| {
                consume(row)?;
                Ok(())
            })?;
            for row in rows {
                row?;
            }
        } else {
            let rows = statement.query_map([], |row| {
                consume(row)?;
                Ok(())
            })?;
            for row in rows {
                row?;
            }
        }
        Ok(definitions)
    }
}

fn native_record_from_row(row: &Row<'_>) -> Result<NativeSubagentRecord, rusqlite::Error> {
    let scope: String = row.get(8)?;
    let project_id: Option<String> = row.get(9)?;
    let enabled: bool = row.get(10)?;
    let format_string: String = row.get(4)?;
    let source_kind_string: String = row.get(5)?;
    let format = NativeSubagentFormat::from_db(&format_string).map_err(to_sql_error)?;
    let source_kind =
        NativeSubagentSourceKind::from_db(&source_kind_string).map_err(to_sql_error)?;
    let source_path: String = row.get(6)?;
    let is_symlink = std::fs::symlink_metadata(&source_path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false);
    Ok(NativeSubagentRecord {
        definition: NativeSubagentDefinition {
            identity: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            agent: row.get(3)?,
            target: db_target(&scope, project_id),
            format,
            source_kind,
            source_path: source_path.clone(),
            source_key: row.get(7)?,
            management_status: if enabled {
                NativeSubagentManagementStatus::Managed
            } else {
                NativeSubagentManagementStatus::Disabled
            },
            enabled,
            content_hash: row.get(11)?,
            is_symlink,
            symlink_target: if is_symlink {
                std::fs::read_link(&source_path)
                    .ok()
                    .map(|path| path.display().to_string())
            } else {
                None
            },
            diagnostics: Vec::new(),
            repo_owner: row.get(15)?,
            repo_name: row.get(16)?,
            repo_branch: row.get(17)?,
            repo_path: row.get(18)?,
        },
        upstream_hash: row.get(12)?,
        disabled_path: row.get(13)?,
        adopted_symlink: row.get(14)?,
        installed_at: row.get(19)?,
        updated_at: row.get(20)?,
    })
}

fn backup_record_from_row(row: &Row<'_>) -> Result<NativeSubagentBackupRecord, rusqlite::Error> {
    let definition_json: String = row.get(2)?;
    let definition: NativeSubagentDefinition =
        serde_json::from_str(&definition_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(NativeSubagentBackupRecord {
        backup: NativeSubagentBackup {
            backup_id: row.get(0)?,
            identity: row.get(1)?,
            name: definition.name,
            agent: definition.agent,
            target: definition.target,
            format: definition.format,
            source_path: definition.source_path,
            content_hash: row.get(4)?,
            reason: row.get(7)?,
            legacy: row.get(8)?,
            created_at: row.get(9)?,
        },
        definition_json,
        content: row.get(3)?,
        source_document_hash: row.get(5)?,
        unix_mode: row.get::<_, Option<i64>>(6)?.map(|mode| mode as u32),
    })
}

fn to_sql_error(error: AppError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn target_parts(target: &ScopeTarget) -> (&str, Option<&str>) {
    match target {
        ScopeTarget::Global => ("global", None),
        ScopeTarget::Project { project_id } => ("project", Some(project_id)),
    }
}

fn db_target(scope: &str, project_id: Option<String>) -> ScopeTarget {
    if scope == "project" {
        ScopeTarget::Project {
            project_id: project_id.unwrap_or_default(),
        }
    } else {
        ScopeTarget::Global
    }
}

fn context_matches_target(context: &ConfigContext, target: &ScopeTarget) -> bool {
    match (context, target) {
        (ConfigContext::All, _) | (ConfigContext::Global, ScopeTarget::Global) => true,
        (
            ConfigContext::Project { project_id: left },
            ScopeTarget::Project { project_id: right },
        ) => left == right,
        _ => false,
    }
}

fn global_agent_dir(agent: AgentType) -> std::path::PathBuf {
    match agent {
        AgentType::ClaudeCode => config::get_claude_agents_dir(),
        AgentType::Codex => config::get_codex_agents_dir(),
        AgentType::GeminiCli => config::get_gemini_agents_dir(),
        AgentType::OpenCode => config::get_opencode_agents_dir(),
    }
}

fn project_agent_dir(root: &Path, agent: AgentType) -> std::path::PathBuf {
    match agent {
        AgentType::ClaudeCode => root.join(".claude/agents"),
        AgentType::Codex => root.join(".codex/agents"),
        AgentType::GeminiCli => root.join(".gemini/agents"),
        AgentType::OpenCode => root.join(".opencode/agents"),
    }
}
