//! 项目 registry 直接命令。

use crate::error::{format_structured_error, is_structured_error_payload, AppError};
use crate::services::project::{ProjectService, ProjectSummary};
use crate::AppState;

fn map_err(err: AppError) -> String {
    if let AppError::Message(payload) = &err {
        if is_structured_error_payload(payload) {
            return payload.clone();
        }
    }

    log::warn!("Project 命令未映射错误: {err:#}");
    format_structured_error("PROJECT_INTERNAL", &[], Some("checkLogs"))
}

#[tauri::command]
pub fn add_project(
    root_path: String,
    display_name: Option<String>,
    app_state: tauri::State<'_, AppState>,
) -> Result<ProjectSummary, String> {
    ProjectService::add_project(&app_state.db, root_path, display_name).map_err(map_err)
}

#[tauri::command]
pub fn list_projects(app_state: tauri::State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    ProjectService::list_projects(&app_state.db).map_err(map_err)
}

#[tauri::command]
pub fn relink_project_root(
    project_id: String,
    root_path: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<ProjectSummary, String> {
    ProjectService::relink_project_root(&app_state.db, &project_id, root_path).map_err(map_err)
}

#[tauri::command]
pub fn remove_project(
    project_id: String,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    ProjectService::remove_project(&app_state.db, &project_id).map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::map_err;
    use crate::error::{format_structured_error, AppError};

    #[test]
    fn project_commands_pass_through_structured_errors() {
        let structured = format_structured_error(
            "PROJECT_ROOT_UNAVAILABLE",
            &[("projectId", "project-a")],
            Some("relinkProject"),
        );
        assert_eq!(map_err(AppError::Message(structured.clone())), structured);
    }
}
