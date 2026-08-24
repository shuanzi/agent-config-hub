use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::config;
use crate::database::Database;
use crate::error::{format_skill_error, is_structured_error_payload, AppError};
use crate::services::prompt::{
    prompt_file_path, prompt_state_write_guard, save_live_backup_prompt,
};
use crate::services::skill::{skill_state_write_guard, AgentType, SkillService};
use crate::services::subagent::{subagent_state_write_guard, SubagentService};
use crate::settings::{
    get_settings, resolve_override_path, set_agent_config_dir_override, set_storage_location,
    set_sync_method, update_settings, AppSettings, StorageLocation, SyncMethod,
};
use crate::AppState;

/// Request body for setting a single setting value in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSettingRequest {
    pub key: String,
    pub value: String,
}

fn map_err(err: AppError) -> String {
    if let AppError::Message(payload) = &err {
        if is_structured_error_payload(payload) {
            return payload.clone();
        }
    }

    log::warn!("Settings 命令未映射错误: {err:#}");
    format_skill_error("SETTINGS_INTERNAL", &[], Some("checkLogs"))
}

/// Returns the device-level settings.
#[tauri::command]
pub async fn get_settings_command(
    _state: tauri::State<'_, AppState>,
) -> Result<AppSettings, String> {
    Ok(get_settings())
}

/// Updates the entire device-level settings object.
///
/// `storageLocation` 与 `*ConfigDir` 覆盖字段只能经由专用命令
/// （`migrate_storage` / `set_agent_override_dir`）变更——它们需要联动搬迁
/// SSOT/投影，这里直接拒绝以防止绕过。
#[tauri::command]
pub async fn set_settings_command(
    settings: AppSettings,
    _state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    set_settings_guarded(settings).map_err(map_err)
}

pub(crate) fn set_settings_guarded(settings: AppSettings) -> Result<(), AppError> {
    let current = get_settings();

    if settings.storage_location != current.storage_location {
        return Err(AppError::Message(format_skill_error(
            "SETTINGS_FIELD_REQUIRES_COMMAND",
            &[("field", "storageLocation"), ("command", "migrate_storage")],
            Some("useDedicatedCommand"),
        )));
    }

    let override_fields = [
        (
            "claudeCodeConfigDir",
            &settings.claude_code_config_dir,
            &current.claude_code_config_dir,
        ),
        (
            "codexConfigDir",
            &settings.codex_config_dir,
            &current.codex_config_dir,
        ),
        (
            "geminiCliConfigDir",
            &settings.gemini_cli_config_dir,
            &current.gemini_cli_config_dir,
        ),
        (
            "opencodeConfigDir",
            &settings.opencode_config_dir,
            &current.opencode_config_dir,
        ),
    ];
    for (field, next, previous) in override_fields {
        if next != previous {
            return Err(AppError::Message(format_skill_error(
                "SETTINGS_FIELD_REQUIRES_COMMAND",
                &[("field", field), ("command", "set_agent_override_dir")],
                Some("useDedicatedCommand"),
            )));
        }
    }

    update_settings(settings)
}

/// Updates only the projection sync method (single-field path).
#[tauri::command]
pub async fn set_sync_method_command(
    method: SyncMethod,
    _state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    set_sync_method(method).map_err(map_err)
}

/// Returns a single value from the database settings table.
#[tauri::command]
pub async fn get_setting_command(
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    state.db.get_setting(&key).map_err(map_err)
}

/// Sets a single value in the database settings table.
#[tauri::command]
pub async fn set_setting_command(
    request: SetSettingRequest,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .set_setting(&request.key, &request.value)
        .map_err(map_err)
}

/// Result payload for the combined storage migration command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSummary {
    pub skill: crate::services::skill::MigrationResult,
    pub subagent: crate::services::subagent::MigrationResult,
    /// 投影重建失败信息（保留字段形状；现在重建失败会导致整个迁移回滚并报错，
    /// 因此成功时该字段恒为空）。
    pub projection_errors: Vec<String>,
}

fn skill_target_dir(target: StorageLocation) -> std::path::PathBuf {
    match target {
        crate::settings::StorageLocation::Hub => crate::config::get_hub_skills_dir(),
        crate::settings::StorageLocation::Unified => {
            crate::config::get_home_dir().join(".agents").join("skills")
        }
    }
}

fn subagent_target_dir(target: StorageLocation) -> std::path::PathBuf {
    match target {
        crate::settings::StorageLocation::Hub => crate::config::get_hub_subagents_dir(),
        crate::settings::StorageLocation::Unified => crate::config::get_home_dir()
            .join(".agents")
            .join("subagents"),
    }
}

/// Atomically migrate both skill and subagent SSOT storage to `target`.
///
/// 在固定顺序（skill -> subagent）的写锁下完成 移动 + 设置提交 + 投影重建；
/// 设置持久化与投影重建都在回滚边界内：任一失败都会搬回已移动项并恢复旧设置，
/// 即迁移失败时保持旧设置与旧文件布局。
#[tauri::command]
pub async fn migrate_storage(
    target: StorageLocation,
    state: tauri::State<'_, AppState>,
) -> Result<MigrationSummary, String> {
    migrate_storage_combined(&state.db, target).map_err(map_err)
}

pub(crate) fn migrate_storage_combined(
    db: &Arc<Database>,
    target: StorageLocation,
) -> Result<MigrationSummary, AppError> {
    // 复合 DB+FS 写串行化：固定锁顺序 skill -> subagent，防止迁移中途有
    // 并发安装/更新写入旧 SSOT（set_agent_override_dir 遵循同一顺序）。
    let _skill_guard = skill_state_write_guard();
    let _subagent_guard = subagent_state_write_guard();

    let old_location = get_settings().storage_location;
    let skill_old_dir = skill_target_dir(old_location);
    let skill_new_dir = skill_target_dir(target);
    let subagent_old_dir = subagent_target_dir(old_location);
    let subagent_new_dir = subagent_target_dir(target);

    let rollback_moves = |skill_moved: &[String], subagent_moved: &[String]| {
        let _ = std::fs::create_dir_all(&skill_old_dir);
        let _ = std::fs::create_dir_all(&subagent_old_dir);
        SkillService::rollback_skill_moves(&skill_old_dir, &skill_new_dir, skill_moved);
        SubagentService::rollback_subagent_moves(
            &subagent_old_dir,
            &subagent_new_dir,
            subagent_moved,
        );
    };

    let rebuild_projections = |db: &Arc<Database>| -> Vec<String> {
        let mut projection_errors = Vec::new();
        for app in AgentType::all() {
            if let Err(e) = SkillService::sync_to_app_unlocked(db, &app) {
                log::warn!("迁移后重建 {} 的 Skill 投影失败: {e}", app.as_str());
                projection_errors.push(format!("skills/{}", app.as_str()));
            }
            if let Err(e) = SubagentService::sync_to_app_unlocked(db, &app) {
                log::warn!("迁移后重建 {} 的 Subagent 投影失败: {e}", app.as_str());
                projection_errors.push(format!("subagents/{}", app.as_str()));
            }
        }
        projection_errors
    };

    let skill_result = SkillService::migrate_storage_inner(db, target);
    let subagent_result = SubagentService::migrate_storage_inner(db, target);

    let skill_moved = match &skill_result {
        Ok(outcome) => outcome.moved.clone(),
        Err(failure) => failure.moved.clone(),
    };
    let subagent_moved = match &subagent_result {
        Ok(outcome) => outcome.moved.clone(),
        Err(failure) => failure.moved.clone(),
    };

    let (skill_outcome, subagent_outcome) = match (skill_result, subagent_result) {
        (Ok(skill_outcome), Ok(subagent_outcome)) => (skill_outcome, subagent_outcome),
        (skill_result, subagent_result) => {
            rollback_moves(&skill_moved, &subagent_moved);

            if let Err(failure) = skill_result {
                return Err(failure.into_error());
            }
            if let Err(failure) = subagent_result {
                return Err(failure.into_error());
            }

            unreachable!()
        }
    };

    // 设置持久化进入同一回滚边界：失败则搬回全部已移动项
    if let Err(e) = set_storage_location(target) {
        rollback_moves(&skill_outcome.moved, &subagent_outcome.moved);
        return Err(e);
    }

    // 投影重建是提交条件：失败则恢复旧设置、搬回 SSOT 并尽力重建旧投影
    let projection_errors = rebuild_projections(db);
    if !projection_errors.is_empty() {
        if let Err(e) = set_storage_location(old_location) {
            log::error!("投影重建失败后恢复旧存储设置失败: {e}");
        }
        rollback_moves(&skill_outcome.moved, &subagent_outcome.moved);
        let _ = rebuild_projections(db);

        return Err(AppError::Message(format_skill_error(
            "MIGRATION_ABORTED",
            &[
                ("reason", "projectionRebuild"),
                ("failures", &projection_errors.join("; ")),
            ],
            Some("checkPermission"),
        )));
    }

    Ok(MigrationSummary {
        skill: skill_outcome.result,
        subagent: subagent_outcome.result,
        projection_errors: vec![],
    })
}

/// Persist a per-agent config-dir override and relocate managed projections.
///
/// 流程：预校验新目标目录 -> 移除旧投影（失败则恢复已移除项）-> 搬迁启用中
/// 指令的 live 文件 -> 持久化设置 -> 在新目录重建投影（逐目标快照）。中途失败
/// 会尽力恢复设置、投影与 live 文件，并清理/恢复新目录中已重建的投影，
/// 使状态可解释后再重试。
#[tauri::command]
pub async fn set_agent_override_dir(
    app: String,
    dir: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    set_agent_override_dir_inner(&app, dir, &state.db).map_err(map_err)
}

fn default_agent_config_dir(app: &AgentType) -> PathBuf {
    let home = config::get_home_dir();
    match app {
        AgentType::ClaudeCode => home.join(".claude"),
        AgentType::Codex => home.join(".codex"),
        AgentType::GeminiCli => home.join(".gemini"),
        AgentType::OpenCode => home.join(".config").join("opencode"),
    }
}

fn current_override_for(app: &AgentType) -> Option<String> {
    let settings = get_settings();
    match app {
        AgentType::ClaudeCode => settings.claude_code_config_dir,
        AgentType::Codex => settings.codex_config_dir,
        AgentType::GeminiCli => settings.gemini_cli_config_dir,
        AgentType::OpenCode => settings.opencode_config_dir,
    }
}

/// 新目录投影目标的同步前快照。顶层 symlink 单独记录其 link target，避免
/// 回滚时将其指向的内容固化为实体副本；普通目录和文件备份到临时目录。
/// （skill.rs 中有同名私有实现，这里为命令层本地副本：skill 投影是目录、
/// subagent 投影是文件，统一按路径类型处理。）
enum NewTargetSnapshot {
    Absent,
    Symlink {
        link_target: PathBuf,
        is_file: bool,
    },
    Contents {
        _guard: tempfile::TempDir,
        path: PathBuf,
    },
}

fn snapshot_projection_target(target: &Path) -> Result<NewTargetSnapshot, AppError> {
    if SkillService::is_symlink(target) {
        return Ok(NewTargetSnapshot::Symlink {
            link_target: std::fs::read_link(target).map_err(|e| AppError::io(target, e))?,
            is_file: target.is_file(),
        });
    }
    if !target.exists() {
        return Ok(NewTargetSnapshot::Absent);
    }
    let guard = tempfile::tempdir().map_err(|e| AppError::io(target, e))?;
    let snapshot = guard.path().join("snapshot");
    if target.is_dir() {
        SkillService::copy_dir_recursive(target, &snapshot)?;
    } else {
        std::fs::copy(target, &snapshot).map_err(|e| AppError::io(target, e))?;
    }
    Ok(NewTargetSnapshot::Contents {
        _guard: guard,
        path: snapshot,
    })
}

/// 尽力还原新目录中的单个投影目标：有快照则覆盖恢复（sync 可能已破坏目标），
/// 无快照（原本不存在）则删除本次新建的内容。
fn restore_projection_target(target: &Path, snapshot: &NewTargetSnapshot) {
    if let Err(e) = SkillService::remove_path(target) {
        log::error!("清理新目录投影目标失败 {}: {e}", target.display());
    }
    let result = match snapshot {
        NewTargetSnapshot::Absent => Ok(()),
        NewTargetSnapshot::Symlink {
            link_target,
            is_file,
        } => SkillService::create_symlink(link_target, target, *is_file),
        NewTargetSnapshot::Contents { path, .. } => {
            if path.is_dir() {
                SkillService::copy_dir_recursive(path, target)
            } else {
                std::fs::copy(path, target)
                    .map(|_| ())
                    .map_err(|e| AppError::io(target, e))
            }
        }
    };
    if let Err(e) = result {
        log::error!("恢复新目录投影目标快照失败 {}: {e}", target.display());
    }
}

/// 逆序回滚本次在新目录中已重建的全部投影；调用后列表被排空，重复调用安全。
fn rollback_new_projections(snapshots: &mut Vec<(PathBuf, NewTargetSnapshot)>) {
    while let Some((target, snapshot)) = snapshots.pop() {
        restore_projection_target(&target, &snapshot);
    }
}

pub(crate) fn set_agent_override_dir_inner(
    app: &str,
    dir: Option<String>,
    db: &Arc<Database>,
) -> Result<(), AppError> {
    let agent = AgentType::from_str(app)?;

    // 在任何文件副作用之前统一规范化 override 文本：与 normalize_paths 的
    // 规则一致（trim，空白归 None），后续路径解析与持久化只使用该值。
    let dir = dir
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    // 与 migrate_storage_combined 相同的固定锁顺序：skill -> subagent -> prompt
    let _skill_guard = skill_state_write_guard();
    let _subagent_guard = subagent_state_write_guard();
    let _prompt_guard = prompt_state_write_guard();

    let skills = db.get_all_installed_skills()?;
    let subagents = db.get_all_installed_subagents()?;
    let enabled_prompt = db
        .get_prompts(agent.as_str())?
        .into_values()
        .find(|p| p.enabled);
    let old_live_file = prompt_file_path(&agent);
    let previous_override = current_override_for(&agent);

    let new_config_dir = dir
        .as_deref()
        .map(resolve_override_path)
        .unwrap_or_else(|| default_agent_config_dir(&agent));
    let new_live_file = old_live_file
        .file_name()
        .map(|name| new_config_dir.join(name))
        .unwrap_or_else(|| new_config_dir.clone());

    // 预校验新目标目录可写，再移除任何旧投影（skills/agents/指令文件均以此为准）
    for target_dir in [new_config_dir.join("skills"), new_config_dir.join("agents")] {
        if let Err(e) = std::fs::create_dir_all(&target_dir) {
            log::warn!("新覆盖目录不可写 {}: {e}", target_dir.display());
            return Err(AppError::Message(format_skill_error(
                "SETTINGS_VALIDATION_FAILED",
                &[("field", "configDir"), ("reason", "notWritable")],
                Some("checkPermission"),
            )));
        }
    }

    // 移除旧目录中的受管投影；失败时恢复已移除的投影（设置尚未变更，仍指向旧目录）
    let mut removed_skills: Vec<String> = Vec::new();
    let mut removed_subagents: Vec<String> = Vec::new();
    let removal_result = (|| -> Result<(), AppError> {
        for skill in skills.values() {
            if skill.apps.is_enabled_for(&agent) {
                SkillService::remove_from_app(&skill.directory, &agent)?;
                removed_skills.push(skill.directory.clone());
            }
        }
        for subagent in subagents.values() {
            if subagent.apps.is_enabled_for(&agent) {
                SubagentService::remove_from_app(&subagent.directory, &agent)?;
                removed_subagents.push(subagent.directory.clone());
            }
        }
        Ok(())
    })();
    if let Err(err) = removal_result {
        for directory in &removed_skills {
            let _ = SkillService::sync_to_app_dir(directory, &agent);
        }
        for directory in &removed_subagents {
            let _ = SubagentService::sync_to_app_dir(directory, &agent);
        }
        return Err(err);
    }

    let mut persisted = false;
    let mut new_live_written = false;
    let mut removed_old_live: Option<String> = None;
    // 新目录已有用户 live 文件时的备份（None 表示原本不存在）；失败回滚时
    // 用于恢复磁盘内容，成功提交时转存为禁用的备份预设
    let mut new_live_backup: Option<String> = None;
    // 新目录中已重建投影的快照（按重建顺序）；sync 中途失败或后续
    // save_live_backup_prompt 失败时，据此清理/恢复新目录中的目标
    let mut new_projection_snapshots: Vec<(PathBuf, NewTargetSnapshot)> = Vec::new();

    let mut commit = || -> Result<(), AppError> {
        // 搬迁启用中指令的 live 文件
        if let Some(prompt) = &enabled_prompt {
            if new_live_file != old_live_file {
                // 目标已存在用户自己的 live 文件时先备份内容：失败回滚用于恢复，
                // 成功提交后转存为禁用备份预设
                if new_live_backup.is_none() && new_live_file.exists() {
                    new_live_backup = Some(
                        std::fs::read_to_string(&new_live_file)
                            .map_err(|e| AppError::io(&new_live_file, e))?,
                    );
                }
                config::write_text_file(&new_live_file, &prompt.content)?;
                new_live_written = true;

                // 旧 live 仅在与启用预设内容一致时移除；否则保留并记录
                if old_live_file.exists() {
                    match std::fs::read_to_string(&old_live_file) {
                        Ok(content) if content == prompt.content => {
                            std::fs::remove_file(&old_live_file)
                                .map_err(|e| AppError::io(&old_live_file, e))?;
                            removed_old_live = Some(content);
                        }
                        _ => {
                            log::warn!(
                                "旧 live 文件内容与启用预设不一致，已保留（{}）",
                                agent.as_str()
                            );
                        }
                    }
                }
            }
        }

        set_agent_config_dir_override(agent.as_str(), dir.clone())?;
        persisted = true;

        // 在新目录重建投影：每个目标先快照，任一 sync 失败时先恢复当前
        // 目标（sync 可能已破坏它），再回滚此前已重建的目标，避免新目录
        // 残留半更新状态或丢失被覆盖的用户内容
        let skills_root = new_config_dir.join("skills");
        let agents_root = new_config_dir.join("agents");
        let rebuild_result = (|| -> Result<(), AppError> {
            for skill in skills.values() {
                if skill.apps.is_enabled_for(&agent) {
                    let target = skills_root.join(&skill.directory);
                    let snapshot = snapshot_projection_target(&target)?;
                    if let Err(e) = SkillService::sync_to_app_dir(&skill.directory, &agent) {
                        restore_projection_target(&target, &snapshot);
                        return Err(e);
                    }
                    new_projection_snapshots.push((target, snapshot));
                }
            }
            for subagent in subagents.values() {
                if subagent.apps.is_enabled_for(&agent) {
                    let target = agents_root.join(format!("{}.md", subagent.directory));
                    let snapshot = snapshot_projection_target(&target)?;
                    if let Err(e) = SubagentService::sync_to_app_dir(&subagent.directory, &agent) {
                        restore_projection_target(&target, &snapshot);
                        return Err(e);
                    }
                    new_projection_snapshots.push((target, snapshot));
                }
            }
            Ok(())
        })();
        if let Err(e) = rebuild_result {
            rollback_new_projections(&mut new_projection_snapshots);
            return Err(e);
        }

        // 被启用预设覆盖的用户原有 live 内容持久化为禁用备份预设
        // （幂等：内容为空或已存在相同内容的预设时跳过）。失败会走整体回滚，
        // 用户内容仍由 new_live_backup 恢复到磁盘。
        if let Some(content) = &new_live_backup {
            save_live_backup_prompt(db, &agent, content)?;
        }

        Ok(())
    };

    if let Err(err) = commit() {
        // 尽力恢复：先还原设置，再清理/恢复新目录投影、重建旧投影、还原 live 文件
        if persisted {
            if let Err(restore_err) =
                set_agent_config_dir_override(agent.as_str(), previous_override)
            {
                log::error!("恢复旧的覆盖目录设置失败: {restore_err}");
            }
        }
        // 清理/恢复新目录中已重建的投影（sync 中途失败时 commit 内已回滚，
        // 这里覆盖 save_live_backup_prompt 等后续失败路径；列表已排空时为 no-op）
        rollback_new_projections(&mut new_projection_snapshots);
        for directory in &removed_skills {
            let _ = SkillService::sync_to_app_dir(directory, &agent);
        }
        for directory in &removed_subagents {
            let _ = SubagentService::sync_to_app_dir(directory, &agent);
        }
        if let Some(content) = &removed_old_live {
            let _ = config::write_text_file(&old_live_file, content);
        }
        if new_live_written && new_live_file != old_live_file {
            match &new_live_backup {
                // 原本存在用户 live 文件：恢复备份内容而不是删除
                Some(content) => {
                    let _ = config::write_text_file(&new_live_file, content);
                }
                None => {
                    let _ = std::fs::remove_file(&new_live_file);
                }
            }
        }
        return Err(err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config;
    use crate::error::format_skill_error;
    use crate::services::skill::{InstalledSkill, SkillApps};
    use crate::services::subagent::{InstalledSubagent, SubagentApps};
    use serial_test::serial;
    use std::fs;
    use std::path::Path;
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
            crate::settings::reset_settings_store_for_test();
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

    fn write_subagent(dir: &Path, file_name: &str, name: &str) {
        fs::create_dir_all(dir).expect("create subagent dir");
        fs::write(
            dir.join(file_name),
            format!("---\nname: {name}\ndescription: Test subagent\n---\n"),
        )
        .expect("write subagent md");
    }

    fn skill_fixture(directory: &str) -> InstalledSkill {
        InstalledSkill {
            id: format!("owner/repo:{directory}"),
            name: directory.to_string(),
            description: None,
            directory: directory.to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SkillApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        }
    }

    fn subagent_fixture(directory: &str) -> InstalledSubagent {
        InstalledSubagent {
            id: format!("owner/repo:{directory}.md"),
            name: directory.to_string(),
            description: None,
            directory: directory.to_string(),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: None,
            apps: SubagentApps::only(&AgentType::ClaudeCode),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        }
    }

    #[test]
    fn map_err_passes_through_structured_errors() {
        let structured = format_skill_error(
            "SETTINGS_VALIDATION_FAILED",
            &[("field", "storageLocation")],
            Some("retryLater"),
        );
        let err = AppError::Message(structured.clone());
        assert_eq!(map_err(err), structured);
    }

    #[test]
    fn map_err_masks_plain_errors() {
        let err = AppError::InvalidInput("raw details".to_string());
        let mapped = map_err(err);
        assert!(mapped.contains("SETTINGS_INTERNAL"));
        assert!(!mapped.contains("raw details"));
    }

    #[test]
    #[serial]
    fn migrate_storage_combined_rolls_back_moves_carried_by_failed_outcome() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        for name in ["skill-a", "skill-b"] {
            write_skill(&SkillService::get_ssot_dir().unwrap().join(name), name);
            db.save_skill(&skill_fixture(name)).unwrap();
        }
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "agent-a.md",
            "agent-a",
        );
        db.save_subagent(&subagent_fixture("agent-a")).unwrap();

        // skill-b 在目标位置冲突：skill 内部迁移在移动 skill-a 之后失败
        let conflict_dir = config::get_home_dir()
            .join(".agents")
            .join("skills")
            .join("skill-b");
        fs::create_dir_all(&conflict_dir).unwrap();

        let result = migrate_storage_combined(&db, StorageLocation::Unified);
        let err = result.expect_err("conflict must abort migration");
        assert!(err.to_string().contains("MIGRATION_ABORTED"));

        // Err 结果携带的已移动项（skill-a）必须回滚
        assert!(SkillService::get_ssot_dir()
            .unwrap()
            .join("skill-a")
            .exists());
        assert!(!conflict_dir.parent().unwrap().join("skill-a").exists());

        // Ok 结果携带的已移动项（agent-a）同样回滚
        assert!(SubagentService::get_ssot_dir()
            .unwrap()
            .join("agent-a.md")
            .exists());
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("subagents")
            .join("agent-a.md")
            .exists());

        // 设置保持原值
        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Hub
        );
    }

    #[test]
    #[serial]
    fn migrate_storage_combined_aborts_when_projection_rebuild_fails() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("proj-skill"),
            "Proj",
        );
        db.save_skill(&skill_fixture("proj-skill")).unwrap();

        // 把 claude 的覆盖目录指向一个绝对路径，并让其中的 skills 目录
        // 成为一个普通文件，迫使投影重建失败（不依赖 HOME 解析）。
        let custom_dir = tmp.path().join("custom-claude");
        fs::create_dir_all(&custom_dir).unwrap();
        fs::write(custom_dir.join("skills"), "not a directory").unwrap();
        crate::settings::set_agent_config_dir_override(
            "claude-code",
            Some(custom_dir.to_string_lossy().to_string()),
        )
        .unwrap();

        let err = migrate_storage_combined(&db, StorageLocation::Unified)
            .expect_err("projection rebuild failure must abort the migration");
        let payload = err.to_string();
        assert!(payload.contains("MIGRATION_ABORTED"));
        assert!(payload.contains("skills/claude-code"));

        // 迁移失败保持旧设置与旧文件布局
        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Hub
        );
        assert!(SkillService::get_ssot_dir()
            .unwrap()
            .join("proj-skill")
            .exists());
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("skills")
            .join("proj-skill")
            .exists());
    }

    #[test]
    #[serial]
    fn migrate_storage_combined_rolls_back_moves_when_setting_persist_fails() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("skill-a"),
            "skill-a",
        );
        db.save_skill(&skill_fixture("skill-a")).unwrap();
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "agent-a.md",
            "agent-a",
        );
        db.save_subagent(&subagent_fixture("agent-a")).unwrap();

        // 故障注入：settings.json 是目录，set_storage_location 写盘必然失败
        let settings_path = config::get_hub_dir().join("settings.json");
        fs::create_dir_all(&settings_path).unwrap();

        let err = migrate_storage_combined(&db, StorageLocation::Unified)
            .expect_err("setting persist failure must abort the migration");

        // 错误详情不跨 IPC（非结构化负载由 map_err 统一掩盖），这里只验证状态
        let _ = err;
        assert!(SkillService::get_ssot_dir()
            .unwrap()
            .join("skill-a")
            .exists());
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("skills")
            .join("skill-a")
            .exists());
        assert!(SubagentService::get_ssot_dir()
            .unwrap()
            .join("agent-a.md")
            .exists());
        assert!(!config::get_home_dir()
            .join(".agents")
            .join("subagents")
            .join("agent-a.md")
            .exists());

        // 设置保持原值（清理目录障碍后读到的仍是 Hub）
        fs::remove_dir_all(&settings_path).unwrap();
        crate::settings::reset_settings_store_for_test();
        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Hub
        );
    }

    #[test]
    #[serial]
    fn migrate_storage_combined_waits_for_skill_and_subagent_readers() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 读锁存续期间，组合迁移必须阻塞在写锁上（固定顺序 skill -> subagent）
        let _skill_reader = crate::services::skill::skill_state_read_guard();
        let _subagent_reader = crate::services::subagent::subagent_state_read_guard();

        let worker_db = Arc::clone(&db);
        let handle = std::thread::spawn(move || {
            migrate_storage_combined(&worker_db, StorageLocation::Unified)
        });
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(
            !handle.is_finished(),
            "combined migration must wait for the skill/subagent write locks"
        );

        drop(_skill_reader);
        drop(_subagent_reader);
        handle
            .join()
            .expect("migration thread panicked")
            .expect("migration succeeds after readers release");
        assert_eq!(
            crate::settings::get_settings().storage_location,
            StorageLocation::Unified
        );
    }

    #[test]
    #[serial]
    fn set_settings_guarded_rejects_storage_location_and_override_changes() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());

        // 非受控字段（syncMethod）可以正常保存
        let mut next = crate::settings::get_settings();
        next.sync_method = crate::settings::SyncMethod::Copy;
        set_settings_guarded(next).expect("sync method change must be accepted");
        assert_eq!(
            crate::settings::get_settings().sync_method,
            crate::settings::SyncMethod::Copy
        );

        // storageLocation 只能经由 migrate_storage
        let mut next = crate::settings::get_settings();
        next.storage_location = StorageLocation::Unified;
        let err = set_settings_guarded(next).expect_err("storage change must be rejected");
        assert!(err.to_string().contains("SETTINGS_FIELD_REQUIRES_COMMAND"));
        assert!(err.to_string().contains("migrate_storage"));

        // 覆盖目录只能经由 set_agent_override_dir
        let mut next = crate::settings::get_settings();
        next.claude_code_config_dir = Some("/tmp/custom-claude".to_string());
        let err = set_settings_guarded(next).expect_err("override change must be rejected");
        assert!(err.to_string().contains("SETTINGS_FIELD_REQUIRES_COMMAND"));
        assert!(err.to_string().contains("set_agent_override_dir"));

        // 与当前值相同的提交不受影响
        set_settings_guarded(crate::settings::get_settings())
            .expect("unchanged settings must be accepted");
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_relocates_managed_projections() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("reloc-skill"),
            "Reloc",
        );
        db.save_skill(&skill_fixture("reloc-skill")).unwrap();
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "reloc-agent.md",
            "reloc-agent",
        );
        db.save_subagent(&subagent_fixture("reloc-agent")).unwrap();

        SkillService::sync_to_app_dir("reloc-skill", &AgentType::ClaudeCode).unwrap();
        SubagentService::sync_to_app_dir("reloc-agent", &AgentType::ClaudeCode).unwrap();

        let old_skill_projection = config::get_claude_skills_dir().join("reloc-skill");
        let old_subagent_projection = config::get_claude_agents_dir().join("reloc-agent.md");
        assert!(old_skill_projection.exists());
        assert!(old_subagent_projection.exists());

        let custom_dir = tmp.path().join("custom-claude");
        let custom_str = custom_dir.to_string_lossy().to_string();
        set_agent_override_dir_inner("claude-code", Some(custom_str.clone()), &db)
            .expect("set override");

        // 旧目录中的受管投影被移除，新目录中重建
        assert!(!old_skill_projection.exists());
        assert!(!old_subagent_projection.exists());
        assert!(custom_dir.join("skills").join("reloc-skill").exists());
        assert!(custom_dir.join("agents").join("reloc-agent.md").exists());

        assert_eq!(
            crate::settings::get_settings()
                .claude_code_config_dir
                .as_deref(),
            Some(custom_str.as_str())
        );
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_relocates_enabled_prompt_live_file() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 启用一个 claude 指令预设，并把 live 文件写成同样的内容
        let prompt = crate::services::prompt::Prompt {
            id: "p1".to_string(),
            name: "P1".to_string(),
            content: "enabled instructions".to_string(),
            description: None,
            enabled: true,
            created_at: Some(1),
            updated_at: Some(1),
        };
        db.save_prompt("claude-code", &prompt).unwrap();
        let old_live = config::get_claude_prompt_file();
        config::write_text_file(&old_live, "enabled instructions").unwrap();

        let custom_dir = tmp.path().join("custom-claude");
        let custom_str = custom_dir.to_string_lossy().to_string();
        set_agent_override_dir_inner("claude-code", Some(custom_str.clone()), &db)
            .expect("set override");

        // 新位置写出启用预设的 live 文件；旧 live 因内容一致被移除
        assert_eq!(
            fs::read_to_string(custom_dir.join("CLAUDE.md")).unwrap(),
            "enabled instructions"
        );
        assert!(!old_live.exists());
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_keeps_diverged_old_live_file() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        let prompt = crate::services::prompt::Prompt {
            id: "p1".to_string(),
            name: "P1".to_string(),
            content: "enabled instructions".to_string(),
            description: None,
            enabled: true,
            created_at: Some(1),
            updated_at: Some(1),
        };
        db.save_prompt("claude-code", &prompt).unwrap();
        // 用户手动改过 live 文件：内容与启用预设不一致
        let old_live = config::get_claude_prompt_file();
        config::write_text_file(&old_live, "user edited content").unwrap();

        let custom_dir = tmp.path().join("custom-claude");
        set_agent_override_dir_inner(
            "claude-code",
            Some(custom_dir.to_string_lossy().to_string()),
            &db,
        )
        .expect("set override");

        // 新 live 写入启用预设内容；旧 live 保留不动
        assert_eq!(
            fs::read_to_string(custom_dir.join("CLAUDE.md")).unwrap(),
            "enabled instructions"
        );
        assert_eq!(
            fs::read_to_string(&old_live).unwrap(),
            "user edited content"
        );
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_prevalidates_and_keeps_old_projections_on_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("pre-skill"),
            "Pre",
        );
        db.save_skill(&skill_fixture("pre-skill")).unwrap();
        SkillService::sync_to_app_dir("pre-skill", &AgentType::ClaudeCode).unwrap();
        let old_skill_projection = config::get_claude_skills_dir().join("pre-skill");
        assert!(old_skill_projection.exists());

        // 预校验失败：新覆盖目录中的 skills 已存在且是普通文件
        let custom_dir = tmp.path().join("custom-claude");
        fs::create_dir_all(&custom_dir).unwrap();
        fs::write(custom_dir.join("skills"), "not a directory").unwrap();

        let err = set_agent_override_dir_inner(
            "claude-code",
            Some(custom_dir.to_string_lossy().to_string()),
            &db,
        )
        .expect_err("unwritable new target must be rejected before any removal");
        assert!(err.to_string().contains("SETTINGS_VALIDATION_FAILED"));

        // 旧投影原样保留，设置未变更
        assert!(old_skill_projection.exists());
        assert_eq!(crate::settings::get_settings().claude_code_config_dir, None);
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_restores_preexisting_new_live_on_commit_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 启用一个 claude 指令预设，旧 live 与启用预设内容一致
        let prompt = crate::services::prompt::Prompt {
            id: "p1".to_string(),
            name: "P1".to_string(),
            content: "enabled instructions".to_string(),
            description: None,
            enabled: true,
            created_at: Some(1),
            updated_at: Some(1),
        };
        db.save_prompt("claude-code", &prompt).unwrap();
        let old_live = config::get_claude_prompt_file();
        config::write_text_file(&old_live, "enabled instructions").unwrap();

        // 新目录已经存在用户自己的 live 文件
        let custom_dir = tmp.path().join("custom-claude");
        fs::create_dir_all(&custom_dir).unwrap();
        let new_live = custom_dir.join("CLAUDE.md");
        fs::write(&new_live, "user's own instructions").unwrap();

        // 故障注入：settings.json 是目录，设置持久化必然失败
        let settings_path = config::get_hub_dir().join("settings.json");
        fs::create_dir_all(&settings_path).unwrap();

        let err = set_agent_override_dir_inner(
            "claude-code",
            Some(custom_dir.to_string_lossy().to_string()),
            &db,
        )
        .expect_err("persist failure must abort the command");
        let _ = err;

        // 用户原有的 live 文件内容被恢复，而不是被删除
        assert_eq!(
            fs::read_to_string(&new_live).unwrap(),
            "user's own instructions"
        );
        // 旧 live 也被还原
        assert_eq!(
            fs::read_to_string(&old_live).unwrap(),
            "enabled instructions"
        );

        // 清理目录障碍后读到的设置未变更
        fs::remove_dir_all(&settings_path).unwrap();
        crate::settings::reset_settings_store_for_test();
        assert_eq!(crate::settings::get_settings().claude_code_config_dir, None);
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_normalizes_trailing_whitespace() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 启用一个 claude 指令预设，旧 live 与启用预设内容一致
        let prompt = crate::services::prompt::Prompt {
            id: "p1".to_string(),
            name: "P1".to_string(),
            content: "enabled instructions".to_string(),
            description: None,
            enabled: true,
            created_at: Some(1),
            updated_at: Some(1),
        };
        db.save_prompt("claude-code", &prompt).unwrap();
        let old_live = config::get_claude_prompt_file();
        config::write_text_file(&old_live, "enabled instructions").unwrap();

        // UI 输入带尾随空格：所有副作用都必须落在 trim 后的目录上
        let custom_dir = tmp.path().join("custom-claude");
        let custom_str = custom_dir.to_string_lossy().to_string();
        set_agent_override_dir_inner("claude-code", Some(format!("{custom_str} ")), &db)
            .expect("set override");

        // live 文件写入 trim 后的目录，带尾随空格的目录从未被创建
        assert_eq!(
            fs::read_to_string(custom_dir.join("CLAUDE.md")).unwrap(),
            "enabled instructions"
        );
        assert!(!tmp.path().join("custom-claude ").exists());
        assert!(!old_live.exists());

        // 持久化的设置与文件副作用指向同一目录
        assert_eq!(
            crate::settings::get_settings()
                .claude_code_config_dir
                .as_deref(),
            Some(custom_str.as_str())
        );

        // 纯空白输入归一为 None（恢复默认目录）
        set_agent_override_dir_inner("claude-code", Some("   ".to_string()), &db)
            .expect("clear override");
        assert_eq!(crate::settings::get_settings().claude_code_config_dir, None);
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_restores_removed_projections_on_removal_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        write_skill(
            &SkillService::get_ssot_dir().unwrap().join("rest-skill"),
            "Rest",
        );
        db.save_skill(&skill_fixture("rest-skill")).unwrap();
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "rest-agent.md",
            "rest-agent",
        );
        db.save_subagent(&subagent_fixture("rest-agent")).unwrap();
        SkillService::sync_to_app_dir("rest-skill", &AgentType::ClaudeCode).unwrap();
        SubagentService::sync_to_app_dir("rest-agent", &AgentType::ClaudeCode).unwrap();

        let old_skill_projection = config::get_claude_skills_dir().join("rest-skill");
        let old_subagent_projection = config::get_claude_agents_dir().join("rest-agent.md");
        assert!(old_skill_projection.exists());
        assert!(old_subagent_projection.exists());

        // 故障注入：旧 agents 目录只读，subagent 投影移除在 skill 移除之后失败
        let old_agents_dir = config::get_claude_agents_dir();
        let mut permissions = fs::metadata(&old_agents_dir).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&old_agents_dir, permissions).unwrap();

        let custom_dir = tmp.path().join("custom-claude");
        let result = set_agent_override_dir_inner(
            "claude-code",
            Some(custom_dir.to_string_lossy().to_string()),
            &db,
        );
        assert!(result.is_err(), "removal failure must abort the command");

        // 已移除的 skill 投影被恢复；设置未变更
        assert!(old_skill_projection.exists());
        assert_eq!(crate::settings::get_settings().claude_code_config_dir, None);

        // 恢复写权限以便临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&old_agents_dir).unwrap().permissions();
            permissions.set_mode(permissions.mode() | 0o200);
            let _ = fs::set_permissions(&old_agents_dir, permissions);
        }
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_backs_up_overwritten_live_as_disabled_preset() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 启用一个 claude 指令预设，旧 live 与启用预设内容一致
        let prompt = crate::services::prompt::Prompt {
            id: "p1".to_string(),
            name: "P1".to_string(),
            content: "enabled instructions".to_string(),
            description: None,
            enabled: true,
            created_at: Some(1),
            updated_at: Some(1),
        };
        db.save_prompt("claude-code", &prompt).unwrap();
        let old_live = config::get_claude_prompt_file();
        config::write_text_file(&old_live, "enabled instructions").unwrap();

        // 新目录预置用户自己的 live 文件
        let custom_dir = tmp.path().join("custom-claude");
        fs::create_dir_all(&custom_dir).unwrap();
        let new_live = custom_dir.join("CLAUDE.md");
        fs::write(&new_live, "user's own instructions").unwrap();

        set_agent_override_dir_inner(
            "claude-code",
            Some(custom_dir.to_string_lossy().to_string()),
            &db,
        )
        .expect("set override");

        // 新 live 是启用预设内容
        assert_eq!(
            fs::read_to_string(&new_live).unwrap(),
            "enabled instructions"
        );

        // 被覆盖的用户内容保存为一个禁用的备份预设
        let prompts = db.get_prompts("claude-code").unwrap();
        let backups: Vec<_> = prompts
            .values()
            .filter(|p| p.id.starts_with("backup-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].content, "user's own instructions");
        assert!(!backups[0].enabled);
        // 启用预设不受影响
        assert!(prompts["p1"].enabled);
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_skips_backup_when_content_already_exists() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // 启用预设 + 一个内容与新目录 live 相同的既有预设（去重对象）
        let prompt = crate::services::prompt::Prompt {
            id: "p1".to_string(),
            name: "P1".to_string(),
            content: "enabled instructions".to_string(),
            description: None,
            enabled: true,
            created_at: Some(1),
            updated_at: Some(1),
        };
        db.save_prompt("claude-code", &prompt).unwrap();
        let existing = crate::services::prompt::Prompt {
            id: "existing".to_string(),
            name: "Existing".to_string(),
            content: "user's own instructions".to_string(),
            description: None,
            enabled: false,
            created_at: Some(1),
            updated_at: Some(1),
        };
        db.save_prompt("claude-code", &existing).unwrap();
        let old_live = config::get_claude_prompt_file();
        config::write_text_file(&old_live, "enabled instructions").unwrap();

        // 新目录预置的用户 live 内容与既有预设一致
        let custom_dir = tmp.path().join("custom-claude");
        fs::create_dir_all(&custom_dir).unwrap();
        fs::write(custom_dir.join("CLAUDE.md"), "user's own instructions").unwrap();

        set_agent_override_dir_inner(
            "claude-code",
            Some(custom_dir.to_string_lossy().to_string()),
            &db,
        )
        .expect("set override");

        // 不新增备份预设：预设总数不变，且没有任何 backup-* 预设
        let prompts = db.get_prompts("claude-code").unwrap();
        assert_eq!(prompts.len(), 2);
        assert!(!prompts.keys().any(|id| id.starts_with("backup-")));
    }

    #[test]
    #[serial]
    fn set_agent_override_dir_rolls_back_new_dir_projections_on_sync_failure() {
        let tmp = tempdir().unwrap();
        let _guard = TestHomeGuard::set(tmp.path());
        let db = Arc::new(Database::memory().unwrap());

        // dir-skill：新目录中已存在用户自有同名目录（会被 sync 覆盖，需恢复内容）
        // snap-skill：新目录中已存在指向用户目录的同名 symlink（会被 sync 覆盖，
        // 回滚后必须恢复为同一个 symlink，而非实体副本）
        // fresh-skill：新目录中不存在（sync 新建，回滚需删除）
        for name in ["dir-skill", "snap-skill", "fresh-skill"] {
            write_skill(&SkillService::get_ssot_dir().unwrap().join(name), name);
            db.save_skill(&skill_fixture(name)).unwrap();
        }
        write_subagent(
            &SubagentService::get_ssot_dir().unwrap(),
            "fail-agent.md",
            "fail-agent",
        );
        db.save_subagent(&subagent_fixture("fail-agent")).unwrap();

        // 旧目录中的投影在搬迁前存在，失败回滚后必须完好
        SkillService::sync_to_app_dir("dir-skill", &AgentType::ClaudeCode).unwrap();
        SkillService::sync_to_app_dir("snap-skill", &AgentType::ClaudeCode).unwrap();
        SkillService::sync_to_app_dir("fresh-skill", &AgentType::ClaudeCode).unwrap();
        SubagentService::sync_to_app_dir("fail-agent", &AgentType::ClaudeCode).unwrap();
        let old_dir_skill = config::get_claude_skills_dir().join("dir-skill");
        let old_snap_skill = config::get_claude_skills_dir().join("snap-skill");
        let old_fresh_skill = config::get_claude_skills_dir().join("fresh-skill");
        let old_subagent = config::get_claude_agents_dir().join("fail-agent.md");
        assert!(
            old_dir_skill.exists()
                && old_snap_skill.exists()
                && old_fresh_skill.exists()
                && old_subagent.exists()
        );

        // 新目录预置一个普通目录与一个 symlink：二者都会被重建覆盖。
        let custom_dir = tmp.path().join("custom-claude");
        let new_dir_skill = custom_dir.join("skills").join("dir-skill");
        fs::create_dir_all(&new_dir_skill).unwrap();
        fs::write(new_dir_skill.join("USER.md"), "user directory content").unwrap();
        let user_skill_dir = tmp.path().join("user-skill-content");
        fs::create_dir_all(&user_skill_dir).unwrap();
        fs::write(user_skill_dir.join("USER.md"), "user skill content").unwrap();
        let new_snap_skill = custom_dir.join("skills").join("snap-skill");
        fs::create_dir_all(new_snap_skill.parent().unwrap()).unwrap();
        SkillService::create_symlink(&user_skill_dir, &new_snap_skill, false).unwrap();
        let original_link_target = fs::read_link(&new_snap_skill).unwrap();

        // 故障注入：新目录的 agents 只读，第二次 sync（subagent 文件）必然失败，
        // 此时三个 skill 投影已在新目录重建完成
        let new_agents_dir = custom_dir.join("agents");
        fs::create_dir_all(&new_agents_dir).unwrap();
        let mut permissions = fs::metadata(&new_agents_dir).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&new_agents_dir, permissions).unwrap();

        let err = set_agent_override_dir_inner(
            "claude-code",
            Some(custom_dir.to_string_lossy().to_string()),
            &db,
        )
        .expect_err("sync failure in the new dir must abort the command");
        let _ = err;

        // 恢复写权限以便临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&new_agents_dir).unwrap().permissions();
            permissions.set_mode(permissions.mode() | 0o200);
            let _ = fs::set_permissions(&new_agents_dir, permissions);
        }

        // 新目录无残留投影：本次新建的 fresh-skill 被删除、失败目标未留下文件。
        assert!(!custom_dir.join("skills").join("fresh-skill").exists());
        assert!(!SkillService::is_symlink(
            &custom_dir.join("skills").join("fresh-skill")
        ));
        assert!(!custom_dir.join("agents").join("fail-agent.md").exists());

        // 被 sync 覆盖的普通目录内容已按快照恢复。
        assert!(new_dir_skill.is_dir());
        assert!(!SkillService::is_symlink(&new_dir_skill));
        assert_eq!(
            fs::read_to_string(new_dir_skill.join("USER.md")).unwrap(),
            "user directory content"
        );
        assert!(
            !new_dir_skill.join("SKILL.md").exists(),
            "restored directory snapshot must not retain the synced projection"
        );

        // 被 sync 覆盖的用户自有 symlink 与其 link target 已按快照恢复。
        assert!(
            SkillService::is_symlink(&new_snap_skill),
            "rollback must restore the top-level symlink rather than a copied directory"
        );
        assert_eq!(
            fs::read_link(&new_snap_skill).unwrap(),
            original_link_target
        );
        assert_eq!(
            fs::read_to_string(user_skill_dir.join("USER.md")).unwrap(),
            "user skill content"
        );
        assert!(
            !user_skill_dir.join("SKILL.md").exists(),
            "restored snapshot must not retain the synced projection"
        );

        // 旧目录投影被重建，设置已还原
        assert!(
            old_dir_skill.exists()
                && old_snap_skill.exists()
                && old_fresh_skill.exists()
                && old_subagent.exists()
        );
        assert_eq!(crate::settings::get_settings().claude_code_config_dir, None);
    }
}
