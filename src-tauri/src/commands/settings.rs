use serde::{Deserialize, Serialize};

use crate::error::{format_skill_error, is_structured_error_payload, AppError};
use crate::services::skill::{AgentType, SkillService};
use crate::services::subagent::SubagentService;
use crate::settings::{
    get_settings, set_storage_location, update_settings, AppSettings, StorageLocation,
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
    let skill_result = SkillService::migrate_storage_inner(&state.db, target);
    let subagent_result = SubagentService::migrate_storage_inner(&state.db, target);

    match (&skill_result, &subagent_result) {
        (Ok(skill_outcome), Ok(subagent_outcome)) => {
            set_storage_location(target).map_err(map_err)?;

            for app in AgentType::all() {
                let _ = SkillService::sync_to_app_unlocked(&state.db, &app);
                let _ = SubagentService::sync_to_app_unlocked(&state.db, &app);
            }

            Ok(MigrationSummary {
                skill: skill_outcome.result.clone(),
                subagent: subagent_outcome.result.clone(),
            })
        }
        _ => {
            if let Ok(skill_outcome) = &skill_result {
                if let Ok(old_dir) = SkillService::get_ssot_dir() {
                    SkillService::rollback_skill_moves(
                        &old_dir,
                        &skill_target_dir(target),
                        &skill_outcome.moved,
                    );
                }
            }
            if let Ok(subagent_outcome) = &subagent_result {
                if let Ok(old_dir) = SubagentService::get_ssot_dir() {
                    SubagentService::rollback_subagent_moves(
                        &old_dir,
                        &subagent_target_dir(target),
                        &subagent_outcome.moved,
                    );
                }
            }

            if let Err(failure) = skill_result {
                return Err(map_err(failure.into_error()));
            }
            if let Err(failure) = subagent_result {
                return Err(map_err(failure.into_error()));
            }

            unreachable!()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::format_skill_error;

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
}
