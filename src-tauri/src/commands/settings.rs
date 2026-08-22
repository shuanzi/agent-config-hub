use serde::{Deserialize, Serialize};

use crate::error::{format_skill_error, AppError};
use crate::settings::{get_settings, update_settings, AppSettings};
use crate::AppState;

/// Request body for setting a single setting value in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSettingRequest {
    pub key: String,
    pub value: String,
}

fn map_err(err: AppError) -> String {
    format_skill_error(
        "settings/error",
        &[("message", &err.to_string())],
        Some("请检查日志或重试。"),
    )
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
