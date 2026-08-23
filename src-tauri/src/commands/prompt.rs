//! 长期指令（Prompt）命令层

use std::collections::HashMap;

use crate::error::{format_skill_error, is_structured_error_payload, AppError};
use crate::services::prompt::{Prompt, PromptService};
use crate::services::skill::AgentType;
use crate::AppState;

fn map_err(err: AppError) -> String {
    if let AppError::Message(payload) = &err {
        if is_structured_error_payload(payload) {
            return payload.clone();
        }
    }

    log::warn!("Prompt 命令未映射错误: {err:#}");
    format_skill_error("PROMPT_INTERNAL", &[], Some("checkLogs"))
}

fn parse_app_type(app: &str) -> Result<AgentType, String> {
    AgentType::from_str(app).map_err(|e| {
        format_skill_error(
            "INVALID_APP_TYPE",
            &[("app", app), ("message", &e.to_string())],
            Some("checkAppType"),
        )
    })
}

#[tauri::command]
pub async fn get_prompts(
    app: String,
    state: tauri::State<'_, AppState>,
) -> Result<HashMap<String, Prompt>, String> {
    let app_type = parse_app_type(&app)?;
    let prompts = PromptService::get_prompts(&state, app_type).map_err(map_err)?;
    Ok(prompts.into_iter().collect())
}

#[tauri::command]
pub async fn upsert_prompt(
    app: String,
    id: String,
    prompt: Prompt,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_type = parse_app_type(&app)?;
    PromptService::upsert_prompt(&state, app_type, &id, prompt).map_err(map_err)
}

#[tauri::command]
pub async fn delete_prompt(
    app: String,
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_type = parse_app_type(&app)?;
    PromptService::delete_prompt(&state, app_type, &id).map_err(map_err)
}

#[tauri::command]
pub async fn enable_prompt(
    app: String,
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let app_type = parse_app_type(&app)?;
    PromptService::enable_prompt(&state, app_type, &id).map_err(map_err)
}

#[tauri::command]
pub async fn import_prompt_from_file(
    app: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let app_type = parse_app_type(&app)?;
    PromptService::import_from_file(&state, app_type).map_err(map_err)
}

#[tauri::command]
pub async fn get_current_prompt_file_content(app: String) -> Result<Option<String>, String> {
    let app_type = parse_app_type(&app)?;
    PromptService::get_current_file_content(app_type).map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::format_skill_error;

    #[test]
    fn map_err_passes_through_structured_errors() {
        let structured =
            format_skill_error("PROMPT_NOT_FOUND", &[("id", "p1")], Some("retryLater"));
        let err = AppError::Message(structured.clone());
        assert_eq!(map_err(err), structured);
    }

    #[test]
    fn map_err_masks_plain_errors() {
        let err = AppError::InvalidInput("raw details".to_string());
        let mapped = map_err(err);
        assert!(mapped.contains("PROMPT_INTERNAL"));
        assert!(!mapped.contains("raw details"));
    }
}
