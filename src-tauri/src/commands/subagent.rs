//! Subagents 命令层

use std::sync::Arc;

use crate::error::{format_subagent_error, is_structured_error_payload, AppError};
use crate::services::project::{ConfigContext, ScopeTarget};
use crate::services::skill::{AgentType, SkillService};
use crate::services::subagent::{
    DiscoverableSubagent, InstalledSubagent, SubagentBackupEntry, SubagentRepo, SubagentService,
    SubagentUninstallResult, SubagentUpdateInfo,
};
use crate::AppState;

fn map_err(err: AppError) -> String {
    if let AppError::Message(payload) = &err {
        if is_structured_error_payload(payload) {
            return payload.clone();
        }
    }

    log::warn!("Subagent 命令未映射错误: {err:#}");
    format_subagent_error("SUBAGENT_INTERNAL", &[], Some("checkLogs"))
}

fn parse_app_type(app: &str) -> Result<AgentType, String> {
    AgentType::from_str(app).map_err(|e| {
        format_subagent_error(
            "INVALID_APP_TYPE",
            &[("app", app), ("message", &e.to_string())],
            Some("checkAppType"),
        )
    })
}

#[tauri::command]
pub fn get_installed_subagents(
    context: ConfigContext,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<InstalledSubagent>, String> {
    SubagentService::get_installed_for_context(&app_state.db, &context).map_err(map_err)
}

#[tauri::command]
pub async fn discover_available_subagents(
    target: ScopeTarget,
    service: tauri::State<'_, SubagentServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<DiscoverableSubagent>, String> {
    let repos = app_state.db.get_subagent_repos().map_err(map_err)?;
    service
        .0
        .discover_available_for_target(&app_state.db, &target, repos)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn install_subagent(
    subagent: DiscoverableSubagent,
    target: ScopeTarget,
    current_app: String,
    service: tauri::State<'_, SubagentServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSubagent, String> {
    let app_type = parse_app_type(&current_app)?;

    service
        .0
        .install_for_target(&app_state.db, &target, &subagent, &app_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn uninstall_subagent(
    id: String,
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<SubagentUninstallResult, String> {
    SubagentService::uninstall_for_target(&app_state.db, &target, &id).map_err(map_err)
}

#[tauri::command]
pub fn toggle_subagent_app(
    id: String,
    target: ScopeTarget,
    app: String,
    enabled: bool,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_type = parse_app_type(&app)?;
    SubagentService::toggle_app_for_target(&app_state.db, &target, &id, &app_type, enabled)
        .map_err(map_err)
}

#[tauri::command]
pub async fn check_subagent_updates(
    target: ScopeTarget,
    service: tauri::State<'_, SubagentServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<SubagentUpdateInfo>, String> {
    service
        .0
        .check_updates_for_target(&app_state.db, &target)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn update_subagent(
    id: String,
    target: ScopeTarget,
    service: tauri::State<'_, SubagentServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSubagent, String> {
    service
        .0
        .update_subagent_for_target(&app_state.db, &target, &id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn get_subagent_repos(
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<SubagentRepo>, String> {
    app_state.db.get_subagent_repos().map_err(map_err)
}

#[tauri::command]
pub fn add_subagent_repo(
    repo: SubagentRepo,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    SkillService::validate_repo_ref(&repo.owner, &repo.name, &repo.branch).map_err(map_err)?;
    app_state.db.save_subagent_repo(&repo).map_err(map_err)
}

#[tauri::command]
pub fn remove_subagent_repo(
    owner: String,
    name: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .delete_subagent_repo(&owner, &name)
        .map_err(map_err)
}

#[tauri::command]
pub fn get_subagent_backups(target: ScopeTarget) -> Result<Vec<SubagentBackupEntry>, String> {
    SubagentService::list_backups_for_target(&target).map_err(map_err)
}

#[tauri::command]
pub fn restore_subagent_backup(
    backup_id: String,
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSubagent, String> {
    SubagentService::restore_from_backup_for_target(&app_state.db, &backup_id, &target)
        .map_err(map_err)
}

#[tauri::command]
pub fn delete_subagent_backup(backup_id: String, target: ScopeTarget) -> Result<(), String> {
    SubagentService::delete_backup_for_target(&backup_id, &target).map_err(map_err)
}

pub struct SubagentServiceState(pub Arc<SubagentService>);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::format_subagent_error;

    #[test]
    fn map_err_passes_through_structured_errors() {
        let structured = format_subagent_error(
            "SUBAGENT_DIRECTORY_CONFLICT",
            &[("directory", "foo")],
            Some("uninstallFirst"),
        );
        let err = AppError::Message(structured.clone());
        assert_eq!(map_err(err), structured);
    }

    #[test]
    fn map_err_masks_plain_errors() {
        let err = AppError::InvalidInput("raw details".to_string());
        let mapped = map_err(err);
        assert!(mapped.contains("SUBAGENT_INTERNAL"));
        assert!(!mapped.contains("raw details"));
    }
}
