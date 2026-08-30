//! Agent Config Manager — Tauri assembly.
//!
//! cc-switch-style module layout (ADR-0020): SQLite-backed `AppState` plus
//! per-feature command groups (settings / skill / prompt / subagent).

mod commands;
mod config;
mod database;
mod error;
mod services;
mod settings;

use std::sync::Arc;

use crate::services::skill::SkillService;
use crate::services::subagent::SubagentService;

pub use commands::*;
pub use config::{
    get_claude_agents_dir, get_claude_config_dir, get_claude_prompt_file, get_claude_skills_dir,
    get_codex_agents_dir, get_codex_config_dir, get_codex_prompt_file, get_codex_skills_dir,
    get_gemini_agents_dir, get_gemini_config_dir, get_gemini_prompt_file, get_gemini_skills_dir,
    get_hub_dir, get_opencode_agents_dir, get_opencode_config_dir, get_opencode_prompt_file,
    get_opencode_skills_dir, read_json_file, write_json_file,
};
pub use database::Database;
pub use error::AppError;
pub use services::instruction::{
    InstructionDocument, InstructionDocumentKind, InstructionDocumentService,
};
pub use services::project::{
    ConfigContext, ProjectService, ProjectSummary, ResolvedScopeTarget, ScopeTarget,
};
pub use services::prompt::{Prompt, PromptService};

/// Shared application state exposed to Tauri commands.
pub struct AppState {
    pub db: Arc<Database>,
}

impl AppState {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

/// Process startup timestamp (PF-01 L3 cold-start anchor).
static PROCESS_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Records the process start time; idempotent.
pub fn note_process_start() {
    let _ = PROCESS_START.set(std::time::Instant::now());
}

/// Elapsed milliseconds since process start, if recorded.
pub fn process_start_elapsed_millis() -> Option<u64> {
    PROCESS_START
        .get()
        .map(|start| start.elapsed().as_millis() as u64)
}

#[cfg(feature = "test-harness")]
#[tauri::command]
async fn test_fx01_cold_start_millis() -> Result<u64, String> {
    Ok(process_start_elapsed_millis().unwrap_or(0))
}

pub fn run() {
    let db = match Database::init() {
        Ok(db) => Arc::new(db),
        Err(e) => {
            eprintln!("Failed to initialize database: {e}");
            std::process::exit(1);
        }
    };

    if let Err(e) = db.init_default_skill_repos() {
        log::warn!("初始化默认 Skill 仓库失败: {e}");
    }

    let app_state = AppState::new(db);
    let skill_service_state = SkillServiceState(Arc::new(SkillService::new()));
    let subagent_service_state = SubagentServiceState(Arc::new(SubagentService::new()));

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .manage(skill_service_state)
        .manage(subagent_service_state);

    #[cfg(feature = "test-harness")]
    {
        builder = builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    #[cfg(not(feature = "test-harness"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_settings_command,
        set_settings_command,
        set_sync_method_command,
        get_setting_command,
        set_setting_command,
        set_agent_override_dir,
        add_project,
        list_projects,
        relink_project_root,
        remove_project,
        migrate_storage,
        get_installed_skills,
        discover_available_skills,
        install_skill,
        uninstall_skill,
        toggle_skill_app,
        check_skill_updates,
        update_skill,
        get_skill_repos,
        add_skill_repo,
        remove_skill_repo,
        scan_unmanaged_skills,
        import_skills_from_apps,
        install_skills_from_zip,
        get_skill_backups,
        restore_skill_backup,
        delete_skill_backup,
        get_installed_subagents,
        discover_available_subagents,
        install_subagent,
        uninstall_subagent,
        toggle_subagent_app,
        check_subagent_updates,
        update_subagent,
        get_subagent_repos,
        add_subagent_repo,
        remove_subagent_repo,
        get_subagent_backups,
        restore_subagent_backup,
        delete_subagent_backup,
        get_instruction_documents,
        upsert_instruction_document,
    ]);

    #[cfg(feature = "test-harness")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_settings_command,
        set_settings_command,
        set_sync_method_command,
        get_setting_command,
        set_setting_command,
        set_agent_override_dir,
        add_project,
        list_projects,
        relink_project_root,
        remove_project,
        migrate_storage,
        test_fx01_cold_start_millis,
        get_installed_skills,
        discover_available_skills,
        install_skill,
        uninstall_skill,
        toggle_skill_app,
        check_skill_updates,
        update_skill,
        get_skill_repos,
        add_skill_repo,
        remove_skill_repo,
        scan_unmanaged_skills,
        import_skills_from_apps,
        install_skills_from_zip,
        get_skill_backups,
        restore_skill_backup,
        delete_skill_backup,
        get_installed_subagents,
        discover_available_subagents,
        install_subagent,
        uninstall_subagent,
        toggle_subagent_app,
        check_subagent_updates,
        update_subagent,
        get_subagent_repos,
        add_subagent_repo,
        remove_subagent_repo,
        get_subagent_backups,
        restore_subagent_backup,
        delete_subagent_backup,
        get_instruction_documents,
        upsert_instruction_document,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
