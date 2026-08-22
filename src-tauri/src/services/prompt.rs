//! 长期指令（Prompt）服务层
//!
//! 为每个一等 Agent 维护指令预设库，支持互斥激活并将启用内容原子写入 live 文件。
//!
//! 已裁剪：仅支持 claude-code / codex / gemini-cli / opencode。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::config;
use crate::error::AppError;
use crate::services::skill::AgentType;
use crate::AppState;
use indexmap::IndexMap;

/// 单一指令预设。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub id: String,
    pub name: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

/// 返回指定 Agent 的 live 指令文件路径。
pub fn prompt_file_path(app: &AgentType) -> PathBuf {
    match app {
        AgentType::ClaudeCode => config::get_claude_prompt_file(),
        AgentType::Codex => config::get_codex_prompt_file(),
        AgentType::GeminiCli => config::get_gemini_prompt_file(),
        AgentType::OpenCode => config::get_opencode_prompt_file(),
    }
}

fn get_unix_timestamp() -> Result<i64, AppError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .map_err(|e| AppError::Message(format!("获取系统时间失败: {e}")))
}

pub struct PromptService;

impl PromptService {
    /// 获取指定 Agent 的所有指令预设。
    pub fn get_prompts(
        state: &AppState,
        app: AgentType,
    ) -> Result<IndexMap<String, Prompt>, AppError> {
        state.db.get_prompts(app.as_str())
    }

    /// 新建或更新指令预设。
    pub fn upsert_prompt(
        state: &AppState,
        app: AgentType,
        id: &str,
        prompt: Prompt,
    ) -> Result<(), AppError> {
        if prompt.id != id {
            return Err(AppError::InvalidInput(
                "预设 ID 与请求 ID 不一致".to_string(),
            ));
        }

        let is_enabled = prompt.enabled;
        state.db.save_prompt(app.as_str(), &prompt)?;

        if is_enabled {
            let target_path = prompt_file_path(&app);
            config::write_text_file(&target_path, &prompt.content)?;
        }

        Ok(())
    }

    /// 删除指令预设。已启用的预设不可删除。
    pub fn delete_prompt(state: &AppState, app: AgentType, id: &str) -> Result<(), AppError> {
        let prompts = Self::get_prompts(state, app)?;
        if let Some(prompt) = prompts.get(id) {
            if prompt.enabled {
                return Err(AppError::InvalidInput(
                    "无法删除已启用的指令预设".to_string(),
                ));
            }
        }

        state.db.delete_prompt(app.as_str(), id)?;
        Ok(())
    }

    /// 启用指定预设：先备份 live 文件内容，再互斥启用并原子写入。
    pub fn enable_prompt(state: &AppState, app: AgentType, id: &str) -> Result<(), AppError> {
        let target_path = prompt_file_path(&app);

        // 1. 备份当前 live 文件内容（若与已启用预设不同）。
        if target_path.exists() {
            if let Ok(live_content) = std::fs::read_to_string(&target_path) {
                if !live_content.trim().is_empty() {
                    let mut prompts = state.db.get_prompts(app.as_str())?;

                    if let Some((enabled_id, enabled_prompt)) = prompts
                        .iter_mut()
                        .find(|(_, p)| p.enabled)
                        .map(|(id, p)| (id.clone(), p))
                    {
                        if enabled_prompt.content.trim() != live_content.trim() {
                            let timestamp = get_unix_timestamp()?;
                            enabled_prompt.content = live_content;
                            enabled_prompt.updated_at = Some(timestamp);
                            log::info!("备份 live 内容到已启用预设: {enabled_id}");
                            state.db.save_prompt(app.as_str(), enabled_prompt)?;
                        }
                    } else {
                        let content_exists = prompts
                            .values()
                            .any(|p| p.content.trim() == live_content.trim());
                        if !content_exists {
                            let timestamp = get_unix_timestamp()?;
                            let backup_id = format!("backup-{timestamp}");
                            let backup_prompt = Prompt {
                                id: backup_id.clone(),
                                name: format!(
                                    "原始指令 {}",
                                    chrono::Local::now().format("%Y-%m-%d %H:%M")
                                ),
                                content: live_content,
                                description: Some("自动备份的原始指令".to_string()),
                                enabled: false,
                                created_at: Some(timestamp),
                                updated_at: Some(timestamp),
                            };
                            log::info!("创建 live 内容备份: {backup_id}");
                            state.db.save_prompt(app.as_str(), &backup_prompt)?;
                        }
                    }
                }
            }
        }

        // 2. 禁用该 Agent 的全部预设。
        let mut prompts = state.db.get_prompts(app.as_str())?;
        for prompt in prompts.values_mut() {
            prompt.enabled = false;
        }

        // 3. 启用目标预设并写入 live 文件。
        if let Some(prompt) = prompts.get_mut(id) {
            prompt.enabled = true;
            config::write_text_file(&target_path, &prompt.content)?;
        } else {
            return Err(AppError::InvalidInput(format!("指令预设 {id} 不存在")));
        }

        // 4. 持久化所有变更。
        for prompt in prompts.values() {
            state.db.save_prompt(app.as_str(), prompt)?;
        }

        Ok(())
    }

    /// 从 live 文件导入为一条新预设。
    pub fn import_from_file(state: &AppState, app: AgentType) -> Result<String, AppError> {
        let file_path = prompt_file_path(&app);
        if !file_path.exists() {
            return Err(AppError::Message("指令文件不存在".to_string()));
        }
        let content =
            std::fs::read_to_string(&file_path).map_err(|e| AppError::io(&file_path, e))?;
        let timestamp = get_unix_timestamp()?;

        let id = format!("imported-{timestamp}");
        let prompt = Prompt {
            id: id.clone(),
            name: format!(
                "导入的指令 {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M")
            ),
            content,
            description: Some("从现有配置文件导入".to_string()),
            enabled: false,
            created_at: Some(timestamp),
            updated_at: Some(timestamp),
        };

        Self::upsert_prompt(state, app, &id, prompt)?;
        Ok(id)
    }

    /// 读取 live 文件当前内容。文件不存在时返回 `None`（非错误）。
    pub fn get_current_file_content(app: AgentType) -> Result<Option<String>, AppError> {
        let file_path = prompt_file_path(&app);
        if !file_path.exists() {
            return Ok(None);
        }
        let content =
            std::fs::read_to_string(&file_path).map_err(|e| AppError::io(&file_path, e))?;
        Ok(Some(content))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;
    use serial_test::serial;
    use std::sync::Arc;

    fn prompt(id: &str, content: &str, enabled: bool) -> Prompt {
        Prompt {
            id: id.to_string(),
            name: id.to_string(),
            content: content.to_string(),
            description: None,
            enabled,
            created_at: Some(1),
            updated_at: Some(1),
        }
    }

    fn state() -> AppState {
        AppState::new(Arc::new(Database::memory().expect("memory db")))
    }

    fn setup_temp_home() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::env::set_var(config::ACM_HOME_ENV, tmp.path().as_os_str());
        tmp
    }

    #[test]
    #[serial]
    fn crud_is_isolated_per_app() {
        let _tmp = setup_temp_home();
        let state = state();

        let claude = prompt("p1", "claude content", false);
        let codex = prompt("p1", "codex content", false);

        PromptService::upsert_prompt(&state, AgentType::ClaudeCode, "p1", claude.clone())
            .expect("save claude");
        PromptService::upsert_prompt(&state, AgentType::Codex, "p1", codex.clone())
            .expect("save codex");

        let claude_prompts =
            PromptService::get_prompts(&state, AgentType::ClaudeCode).expect("get claude");
        assert_eq!(claude_prompts.len(), 1);
        assert_eq!(claude_prompts["p1"].content, "claude content");

        let codex_prompts =
            PromptService::get_prompts(&state, AgentType::Codex).expect("get codex");
        assert_eq!(codex_prompts.len(), 1);
        assert_eq!(codex_prompts["p1"].content, "codex content");

        let mut updated = claude;
        updated.content = "updated".to_string();
        PromptService::upsert_prompt(&state, AgentType::ClaudeCode, "p1", updated).expect("update");
        let claude_prompts =
            PromptService::get_prompts(&state, AgentType::ClaudeCode).expect("get claude");
        assert_eq!(claude_prompts["p1"].content, "updated");

        PromptService::delete_prompt(&state, AgentType::ClaudeCode, "p1").expect("delete");
        assert!(PromptService::get_prompts(&state, AgentType::ClaudeCode)
            .expect("get claude")
            .is_empty());
        assert_eq!(
            PromptService::get_prompts(&state, AgentType::Codex)
                .expect("get codex")
                .len(),
            1
        );

        std::env::remove_var(config::ACM_HOME_ENV);
    }

    #[test]
    #[serial]
    fn enable_is_mutually_exclusive_and_writes_live_file() {
        let _tmp = setup_temp_home();
        let state = state();

        let first = prompt("first", "first body", false);
        let second = prompt("second", "second body", false);
        PromptService::upsert_prompt(&state, AgentType::Codex, "first", first).expect("save first");
        PromptService::upsert_prompt(&state, AgentType::Codex, "second", second)
            .expect("save second");

        PromptService::enable_prompt(&state, AgentType::Codex, "first").expect("enable first");
        let prompts = PromptService::get_prompts(&state, AgentType::Codex).expect("get prompts");
        assert!(prompts["first"].enabled);
        assert!(!prompts["second"].enabled);
        assert_eq!(
            std::fs::read_to_string(prompt_file_path(&AgentType::Codex)).expect("read live"),
            "first body"
        );

        PromptService::enable_prompt(&state, AgentType::Codex, "second").expect("enable second");
        let prompts = PromptService::get_prompts(&state, AgentType::Codex).expect("get prompts");
        assert!(!prompts["first"].enabled);
        assert!(prompts["second"].enabled);
        assert_eq!(
            std::fs::read_to_string(prompt_file_path(&AgentType::Codex)).expect("read live"),
            "second body"
        );

        std::env::remove_var(config::ACM_HOME_ENV);
    }

    #[test]
    #[serial]
    fn enable_backs_up_live_content_before_overwrite() {
        let _tmp = setup_temp_home();
        let state = state();

        // 模拟外部已存在的 live 内容。
        let live_path = prompt_file_path(&AgentType::Codex);
        config::write_text_file(&live_path, "external live content").expect("seed live");

        let preset = prompt("preset", "preset body", false);
        PromptService::upsert_prompt(&state, AgentType::Codex, "preset", preset)
            .expect("save preset");

        PromptService::enable_prompt(&state, AgentType::Codex, "preset").expect("enable preset");

        let prompts = PromptService::get_prompts(&state, AgentType::Codex).expect("get prompts");
        assert!(prompts["preset"].enabled);
        assert_eq!(prompts["preset"].content, "preset body");

        // 备份预设应包含被覆盖的 live 内容。
        let backup = prompts
            .values()
            .find(|p| p.id.starts_with("backup-") && p.content == "external live content");
        assert!(backup.is_some(), "live content should be backed up in DB");

        std::env::remove_var(config::ACM_HOME_ENV);
    }

    #[test]
    #[serial]
    fn import_from_file_creates_preset_from_live_content() {
        let _tmp = setup_temp_home();
        let state = state();

        let live_path = prompt_file_path(&AgentType::ClaudeCode);
        config::write_text_file(&live_path, "existing claude instructions").expect("seed live");

        let id = PromptService::import_from_file(&state, AgentType::ClaudeCode).expect("import");
        let prompts =
            PromptService::get_prompts(&state, AgentType::ClaudeCode).expect("get prompts");
        assert_eq!(prompts[&id].content, "existing claude instructions");
        assert!(!prompts[&id].enabled);

        std::env::remove_var(config::ACM_HOME_ENV);
    }

    #[test]
    #[serial]
    fn missing_live_file_returns_none() {
        let _tmp = setup_temp_home();

        let content =
            PromptService::get_current_file_content(AgentType::GeminiCli).expect("get content");
        assert_eq!(content, None);

        std::env::remove_var(config::ACM_HOME_ENV);
    }

    #[test]
    #[serial]
    fn cannot_delete_enabled_prompt() {
        let _tmp = setup_temp_home();
        let state = state();

        let preset = prompt("enabled", "enabled body", false);
        PromptService::upsert_prompt(&state, AgentType::OpenCode, "enabled", preset).expect("save");
        PromptService::enable_prompt(&state, AgentType::OpenCode, "enabled").expect("enable");

        let result = PromptService::delete_prompt(&state, AgentType::OpenCode, "enabled");
        assert!(result.is_err());

        std::env::remove_var(config::ACM_HOME_ENV);
    }
}
