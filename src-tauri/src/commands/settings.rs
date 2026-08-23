use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::database::Database;
use crate::error::{format_skill_error, is_structured_error_payload, AppError};
use crate::services::skill::{AgentType, SkillService};
use crate::services::subagent::SubagentService;
use crate::settings::{
    get_settings, set_agent_config_dir_override, set_storage_location, update_settings,
    AppSettings, StorageLocation,
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
#[tauri::command]
pub async fn set_settings_command(
    settings: AppSettings,
    _state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    update_settings(settings).map_err(map_err)
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
    /// Per-agent projection rebuild failures after a successful migration.
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
/// The setting is persisted only after both inner migrations succeed.
/// If either fails, any already-moved items are rolled back and the setting
/// is left untouched.
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

    match (skill_result, subagent_result) {
        (Ok(skill_outcome), Ok(subagent_outcome)) => {
            set_storage_location(target)?;

            let mut projection_errors = Vec::new();
            for app in AgentType::all() {
                if let Err(e) = SkillService::sync_to_app_unlocked(db, &app) {
                    log::warn!("迁移后重建 {} 的 Skill 投影失败: {e}", app.as_str());
                    projection_errors.push(format!("skills/{}: {e}", app.as_str()));
                }
                if let Err(e) = SubagentService::sync_to_app_unlocked(db, &app) {
                    log::warn!("迁移后重建 {} 的 Subagent 投影失败: {e}", app.as_str());
                    projection_errors.push(format!("subagents/{}: {e}", app.as_str()));
                }
            }

            Ok(MigrationSummary {
                skill: skill_outcome.result,
                subagent: subagent_outcome.result,
                projection_errors,
            })
        }
        (skill_result, subagent_result) => {
            if let Ok(old_dir) = SkillService::get_ssot_dir() {
                SkillService::rollback_skill_moves(
                    &old_dir,
                    &skill_target_dir(target),
                    &skill_moved,
                );
            }
            if let Ok(old_dir) = SubagentService::get_ssot_dir() {
                SubagentService::rollback_subagent_moves(
                    &old_dir,
                    &subagent_target_dir(target),
                    &subagent_moved,
                );
            }

            if let Err(failure) = skill_result {
                return Err(failure.into_error());
            }
            if let Err(failure) = subagent_result {
                return Err(failure.into_error());
            }

            unreachable!()
        }
    }
}

/// Persist a per-agent config-dir override and relocate managed projections.
///
/// Removes the managed projections from the agent's OLD skills/subagents
/// directories (only assets tracked in the database), persists the new
/// override, then syncs enabled assets into the new directories.
#[tauri::command]
pub async fn set_agent_override_dir(
    app: String,
    dir: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    set_agent_override_dir_inner(&app, dir, &state.db).map_err(map_err)
}

pub(crate) fn set_agent_override_dir_inner(
    app: &str,
    dir: Option<String>,
    db: &Arc<Database>,
) -> Result<(), AppError> {
    let agent = AgentType::from_str(app)?;

    // Remove managed projections from the OLD directories (current override
    // still resolves them).
    let skills = db.get_all_installed_skills()?;
    for skill in skills.values() {
        if skill.apps.is_enabled_for(&agent) {
            SkillService::remove_from_app(&skill.directory, &agent)?;
        }
    }
    let subagents = db.get_all_installed_subagents()?;
    for subagent in subagents.values() {
        if subagent.apps.is_enabled_for(&agent) {
            SubagentService::remove_from_app(&subagent.directory, &agent)?;
        }
    }

    set_agent_config_dir_override(agent.as_str(), dir)?;

    // Rebuild projections in the NEW directories.
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
    fn migrate_storage_combined_reports_projection_errors() {
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

        let summary =
            migrate_storage_combined(&db, StorageLocation::Unified).expect("migration succeeds");
        assert_eq!(summary.skill.migrated_count, 1);
        assert!(
            summary
                .projection_errors
                .iter()
                .any(|e| e.contains("skills/claude-code")),
            "projection_errors must report the failed agent: {:?}",
            summary.projection_errors
        );
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
}
