use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

use crate::config;
use crate::database::Database;
use crate::error::{format_skill_error, is_structured_error_payload, AppError};
use crate::services::prompt::{prompt_file_path, prompt_state_write_guard};
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
/// 指令的 live 文件 -> 持久化设置 -> 在新目录重建投影。中途失败会尽力恢复
/// 设置、投影与 live 文件，使状态可解释后再重试。
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

pub(crate) fn set_agent_override_dir_inner(
    app: &str,
    dir: Option<String>,
    db: &Arc<Database>,
) -> Result<(), AppError> {
    let agent = AgentType::from_str(app)?;

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

    let mut commit = || -> Result<(), AppError> {
        // 搬迁启用中指令的 live 文件
        if let Some(prompt) = &enabled_prompt {
            if new_live_file != old_live_file {
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

        // 在新目录重建投影
        for skill in skills.values() {
            if skill.apps.is_enabled_for(&agent) {
                SkillService::sync_to_app_dir(&skill.directory, &agent)?;
            }
        }
        for subagent in subagents.values() {
            if subagent.apps.is_enabled_for(&agent) {
                SubagentService::sync_to_app_dir(&subagent.directory, &agent)?;
            }
        }

        Ok(())
    };

    if let Err(err) = commit() {
        // 尽力恢复：先还原设置，再重建旧投影、还原 live 文件
        if persisted {
            if let Err(restore_err) =
                set_agent_config_dir_override(agent.as_str(), previous_override)
            {
                log::error!("恢复旧的覆盖目录设置失败: {restore_err}");
            }
        }
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
            let _ = std::fs::remove_file(&new_live_file);
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
}
