//! Skills 命令层

use std::path::Path;
use std::sync::Arc;

use crate::error::{format_skill_error, is_structured_error_payload, AppError};
use crate::services::project::{ConfigContext, ScopeTarget};
use crate::services::skill::{skill_state_read_guard, skill_state_write_guard, SkillImportPreview};
use crate::services::skill::{
    DiscoverableSkill, ImportSkillSelection, InstalledSkill, SkillBackupEntry, SkillRepo,
    SkillService, SkillUninstallResult, SkillUpdateInfo, UnmanagedSkill,
};
use crate::services::skill_placement::{
    self as placement, SkillLocation, SkillPlacement, SkillPlacementTarget,
};
use crate::AppState;
use serde::Serialize;

fn map_err(err: AppError) -> String {
    if let AppError::Message(payload) = &err {
        if is_structured_error_payload(payload) {
            return payload.clone();
        }
    }

    if let AppError::Conflict(message) = &err {
        return format_skill_error("SKILL_PLACEMENT_CONFLICT", &[("message", message)], None);
    }
    log::warn!("Skill 命令未映射错误: {err:#}");
    format_skill_error("SKILL_INTERNAL", &[], Some("checkLogs"))
}

#[tauri::command]
pub fn get_installed_skills(
    context: ConfigContext,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<InstalledSkill>, String> {
    SkillService::get_installed_for_context(&app_state.db, &context).map_err(map_err)
}

#[tauri::command]
pub async fn discover_available_skills(
    target: ScopeTarget,
    service: tauri::State<'_, SkillServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<DiscoverableSkill>, String> {
    let repos = app_state.db.get_skill_repos().map_err(map_err)?;
    service
        .0
        .discover_available_for_target(&app_state.db, &target, repos)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn install_skill(
    skill: DiscoverableSkill,
    target: ScopeTarget,
    initial_location: SkillLocation,
    service: tauri::State<'_, SkillServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSkill, String> {
    service
        .0
        .install_for_target(&app_state.db, &target, &skill, &initial_location)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn uninstall_skill(
    id: String,
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<SkillUninstallResult, String> {
    SkillService::uninstall_for_target(&app_state.db, &target, &id).map_err(map_err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPlacementAsset {
    id: String,
    target: ScopeTarget,
    placements: Vec<SkillPlacement>,
}

#[tauri::command]
pub fn get_skill_placement_targets(
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<SkillPlacementTarget>, String> {
    let _guard = skill_state_read_guard();
    placement::targets(&app_state.db, &target).map_err(map_err)
}

#[tauri::command]
pub fn get_skill_placements(
    context: ConfigContext,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<SkillPlacementAsset>, String> {
    let _guard = skill_state_read_guard();
    SkillService::get_installed_for_context(&app_state.db, &context)
        .map_err(map_err)?
        .into_iter()
        .map(|skill| {
            let placements = placement::placements(&app_state.db, &skill).map_err(map_err)?;
            Ok(SkillPlacementAsset {
                id: skill.id,
                target: skill.target,
                placements,
            })
        })
        .collect()
}

#[tauri::command]
pub fn set_skill_placement(
    id: String,
    target: ScopeTarget,
    location: SkillLocation,
    placed: bool,
    expected_revision: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let _guard = skill_state_write_guard();
    let skill = app_state
        .db
        .get_installed_skill_for_target(&id, &target)
        .map_err(map_err)?
        .ok_or_else(|| format_skill_error("SKILL_NOT_FOUND", &[], None))?;
    let states = placement::placements(&app_state.db, &skill).map_err(map_err)?;
    let state = states
        .iter()
        .find(|p| p.target.aliases.contains(&location))
        .ok_or_else(|| format_skill_error("SKILL_LOCATION_INVALID", &[], None))?;
    if state.revision != expected_revision {
        return Err(format_skill_error("SKILL_EXTERNAL_MODIFICATION", &[], None));
    }
    if placed {
        placement::sync(&app_state.db, &skill, location)
    } else {
        placement::withdraw(&app_state.db, &skill, location)
    }
    .map(|_| ())
    .map_err(map_err)
}

#[tauri::command]
pub async fn check_skill_updates(
    target: ScopeTarget,
    service: tauri::State<'_, SkillServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<SkillUpdateInfo>, String> {
    service
        .0
        .check_updates_for_target(&app_state.db, &target)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn update_skill(
    id: String,
    target: ScopeTarget,
    service: tauri::State<'_, SkillServiceState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSkill, String> {
    service
        .0
        .update_skill_for_target(&app_state.db, &target, &id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn get_skill_repos(app_state: tauri::State<'_, AppState>) -> Result<Vec<SkillRepo>, String> {
    app_state.db.get_skill_repos().map_err(map_err)
}

#[tauri::command]
pub fn add_skill_repo(
    repo: SkillRepo,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    SkillService::validate_repo_ref(&repo.owner, &repo.name, &repo.branch).map_err(map_err)?;
    app_state.db.save_skill_repo(&repo).map_err(map_err)
}

#[tauri::command]
pub fn remove_skill_repo(
    owner: String,
    name: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    app_state
        .db
        .delete_skill_repo(&owner, &name)
        .map_err(map_err)
}

#[tauri::command]
pub fn scan_unmanaged_skills(
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<UnmanagedSkill>, String> {
    SkillService::scan_unmanaged_for_target(&app_state.db, &target).map_err(map_err)
}

#[tauri::command]
pub fn preview_skill_import(
    selections: Vec<ImportSkillSelection>,
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<SkillImportPreview, String> {
    SkillService::preview_import_for_target(&app_state.db, &target, &selections).map_err(map_err)
}

#[tauri::command]
pub fn import_skills_from_apps(
    selections: Vec<ImportSkillSelection>,
    target: ScopeTarget,
    expected_revision: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<InstalledSkill>, String> {
    SkillService::import_from_apps_for_target(
        &app_state.db,
        &target,
        selections,
        &expected_revision,
    )
    .map_err(map_err)
}

#[tauri::command]
pub fn install_skills_from_zip(
    file_path: String,
    initial_location: SkillLocation,
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<InstalledSkill>, String> {
    let path = Path::new(&file_path);

    SkillService::install_from_zip_for_target(&app_state.db, &target, path, &initial_location)
        .map_err(map_err)
}

#[tauri::command]
pub fn get_skill_backups(target: ScopeTarget) -> Result<Vec<SkillBackupEntry>, String> {
    SkillService::list_backups_for_target(&target).map_err(map_err)
}

#[tauri::command]
pub fn restore_skill_backup(
    backup_id: String,
    target: ScopeTarget,
    app_state: tauri::State<'_, AppState>,
) -> Result<InstalledSkill, String> {
    SkillService::restore_from_backup_for_target(&app_state.db, &backup_id, &target)
        .map_err(map_err)
}

#[tauri::command]
pub fn delete_skill_backup(backup_id: String, target: ScopeTarget) -> Result<(), String> {
    SkillService::delete_backup_for_target(&backup_id, &target).map_err(map_err)
}

pub struct SkillServiceState(pub Arc<SkillService>);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::format_skill_error;

    #[test]
    fn map_err_passes_through_structured_errors() {
        let structured = format_skill_error(
            "SKILL_DIRECTORY_CONFLICT",
            &[("directory", "foo")],
            Some("uninstallFirst"),
        );
        let err = AppError::Message(structured.clone());
        assert_eq!(map_err(err), structured);
    }

    #[test]
    fn map_err_masks_io_errors_without_paths() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "no permission");
        let err = AppError::io(Path::new("/secret/path"), io_err);
        let mapped = map_err(err);
        assert!(mapped.contains("SKILL_INTERNAL"));
        assert!(!mapped.contains("/secret/path"));
        assert!(!mapped.contains("PermissionDenied"));
    }
}
