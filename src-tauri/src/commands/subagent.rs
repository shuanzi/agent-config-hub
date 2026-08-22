//! Subagents 命令层

use std::sync::Arc;

use crate::error::{format_subagent_error, AppError};
use crate::services::skill::{AgentType, SkillService};
use crate::services::subagent::{
    DiscoverableSubagent, InstalledSubagent, MigrationResult, SubagentBackupEntry, SubagentRepo,
    SubagentService, SubagentUninstallResult, SubagentUpdateInfo,
};
use crate::settings::StorageLocation;
use crate::AppState;

fn map_err(err: AppError) -> String {
    format_subagent_error(
        "subagent/error",
        &[("message", &err.to_string())],
        Some("请检查日志或重试。"),
    )
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
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<InstalledSubagent>, String> {
    SubagentService::get_all_installed(&app_state.db).map_err(map_err)
}

#[tauri::command]
pub async fn discover_available_subagents(
    service: tauri::State<'_, SubagentServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<DiscoverableSubagent>, String> {
    let repos = app_state.db.get_subagent_repos().map_err(map_err)?;
    service.0.discover_available(repos).await.map_err(map_err)
}

#[tauri::command]
pub async fn install_subagent(
    subagent: DiscoverableSubagent,
    current_app: String,
    service: tauri::State<'_, SubagentServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSubagent, String> {
    let app_type = parse_app_type(&current_app)?;

    service
        .0
        .install(&app_state.db, &subagent, &app_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn uninstall_subagent(
    id: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<SubagentUninstallResult, String> {
    SubagentService::uninstall(&app_state.db, &id).map_err(map_err)
}

#[tauri::command]
pub fn toggle_subagent_app(
    id: String,
    app: String,
    enabled: bool,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_type = parse_app_type(&app)?;
    SubagentService::toggle_app(&app_state.db, &id, &app_type, enabled).map_err(map_err)
}

#[tauri::command]
pub async fn check_subagent_updates(
    service: tauri::State<'_, SubagentServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<SubagentUpdateInfo>, String> {
    service
        .0
        .check_updates(&app_state.db)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn update_subagent(
    id: String,
    service: tauri::State<'_, SubagentServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSubagent, String> {
    service
        .0
        .update_subagent(&app_state.db, &id)
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
pub fn get_subagent_backups() -> Result<Vec<SubagentBackupEntry>, String> {
    SubagentService::list_backups().map_err(map_err)
}

#[tauri::command]
pub fn restore_subagent_backup(
    backup_id: String,
    current_app: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSubagent, String> {
    let app_type = parse_app_type(&current_app)?;
    SubagentService::restore_from_backup(&app_state.db, &backup_id, &app_type).map_err(map_err)
}

#[tauri::command]
pub fn delete_subagent_backup(backup_id: String) -> Result<(), String> {
    SubagentService::delete_backup(&backup_id).map_err(map_err)
}

#[tauri::command]
pub async fn migrate_subagent_storage(
    target: StorageLocation,
    app_state: tauri::State<'_, AppState>,
) -> Result<MigrationResult, String> {
    SubagentService::migrate_storage(&app_state.db, target).map_err(map_err)
}

pub struct SubagentServiceState(pub Arc<SubagentService>);
