//! Tauri commands for native, per-Agent Subagent management.

use crate::error::{format_subagent_error, is_structured_error_payload, AppError};
use crate::services::native_subagent::{
    NativeSubagentBackup, NativeSubagentContent, NativeSubagentDefinition, NativeSubagentDiscovery,
    NativeSubagentMutationResult, NativeSubagentScanResult, NativeSubagentService,
    NativeSubagentUpdateInfo, NativeSubagentUpdatePreview,
};
use crate::services::project::ConfigContext;
use crate::services::project::ScopeTarget;
use crate::services::skill::AgentType;
use crate::AppState;

fn map_err(error: AppError) -> String {
    if let AppError::Message(payload) = &error {
        if is_structured_error_payload(payload) {
            return payload.clone();
        }
    }
    if let AppError::InvalidInput(message) = &error {
        return format_subagent_error(
            "NATIVE_SUBAGENT_INVALID",
            &[("message", message)],
            Some("fixDefinition"),
        );
    }
    log::warn!("原生 Subagent 命令未映射错误: {error:#}");
    format_subagent_error("NATIVE_SUBAGENT_INTERNAL", &[], Some("checkLogs"))
}

#[tauri::command]
pub fn scan_native_subagents(
    context: ConfigContext,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentScanResult, String> {
    NativeSubagentService::scan(&app_state.db, &context).map_err(map_err)
}

#[tauri::command]
pub async fn discover_native_subagents(
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<NativeSubagentDiscovery>, String> {
    NativeSubagentService::discover(&app_state.db, &target)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn install_native_subagent(
    subagent: NativeSubagentDiscovery,
    target: ScopeTarget,
    agent: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentDefinition, String> {
    let agent = AgentType::from_str(&agent).map_err(map_err)?;
    NativeSubagentService::install(&app_state.db, &subagent, &target, agent)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn read_native_subagent(
    identity: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentContent, String> {
    NativeSubagentService::read(&app_state.db, &identity).map_err(map_err)
}

#[tauri::command]
pub fn adopt_native_subagent(
    identity: String,
    expected_hash: String,
    confirm_symlink: bool,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentDefinition, String> {
    NativeSubagentService::adopt(&app_state.db, &identity, &expected_hash, confirm_symlink)
        .map_err(map_err)
}

#[tauri::command]
pub fn save_native_subagent(
    identity: String,
    content: String,
    expected_hash: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentContent, String> {
    NativeSubagentService::save(&app_state.db, &identity, &content, &expected_hash).map_err(map_err)
}

#[tauri::command]
pub fn set_native_subagent_enabled(
    identity: String,
    enabled: bool,
    expected_hash: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentDefinition, String> {
    NativeSubagentService::set_enabled(&app_state.db, &identity, enabled, &expected_hash)
        .map_err(map_err)
}

#[tauri::command]
pub fn uninstall_native_subagent(
    identity: String,
    expected_hash: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentMutationResult, String> {
    NativeSubagentService::uninstall(&app_state.db, &identity, &expected_hash).map_err(map_err)
}

#[tauri::command]
pub fn backup_native_subagent(
    identity: String,
    expected_hash: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentBackup, String> {
    NativeSubagentService::create_backup(&app_state.db, &identity, &expected_hash).map_err(map_err)
}

#[tauri::command]
pub fn get_native_subagent_backups(
    context: ConfigContext,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<NativeSubagentBackup>, String> {
    NativeSubagentService::list_backups(&app_state.db, &context).map_err(map_err)
}

#[tauri::command]
pub fn delete_native_subagent_backup(
    backup_id: String,
    expected_content_hash: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    NativeSubagentService::delete_backup(&app_state.db, &backup_id, &expected_content_hash)
        .map_err(map_err)
}

#[tauri::command]
pub fn restore_native_subagent_backup(
    backup_id: String,
    expected_destination_hash: Option<String>,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentDefinition, String> {
    NativeSubagentService::restore_backup(
        &app_state.db,
        &backup_id,
        expected_destination_hash.as_deref(),
    )
    .map_err(map_err)
}

#[tauri::command]
pub async fn check_native_subagent_updates(
    context: ConfigContext,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<NativeSubagentUpdateInfo>, String> {
    NativeSubagentService::check_updates(&app_state.db, &context)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn preview_native_subagent_update(
    identity: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentUpdatePreview, String> {
    NativeSubagentService::preview_update(&app_state.db, &identity)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn apply_native_subagent_update(
    identity: String,
    expected_hash: String,
    expected_remote_hash: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<NativeSubagentDefinition, String> {
    NativeSubagentService::apply_update(
        &app_state.db,
        &identity,
        &expected_hash,
        &expected_remote_hash,
    )
    .await
    .map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_errors_keep_structured_native_codes() {
        let payload = format_subagent_error(
            "NATIVE_SUBAGENT_EXTERNAL_MODIFICATION",
            &[("identity", "native:test")],
            Some("reload"),
        );
        assert_eq!(map_err(AppError::Message(payload.clone())), payload);
    }
}
