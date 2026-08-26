//! 两类长期指令文档的 live 文件管理。
//!
//! 长期指令不再是按 Agent 维护的预设库：每个完整 ownership target 固定有
//! `CLAUDE.md` 与 `AGENTS.md` 两项。前者只作用于 Claude Code；后者在全局
//! target 投影到 Codex 与 OpenCode，在项目 target 只写项目根的同一文件。

use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock, RwLockWriteGuard};

use serde::{Deserialize, Serialize};

use crate::config;
use crate::error::{format_structured_error, AppError};
use crate::services::project::{ConfigContext, ProjectService, ScopeTarget};
use crate::AppState;

fn instruction_state_lock() -> &'static RwLock<()> {
    static LOCK: OnceLock<RwLock<()>> = OnceLock::new();
    LOCK.get_or_init(|| RwLock::new(()))
}

pub(crate) fn instruction_state_write_guard() -> RwLockWriteGuard<'static, ()> {
    instruction_state_lock()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 仅有的两种长期指令文档。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstructionDocumentKind {
    Claude,
    Agents,
}

impl InstructionDocumentKind {
    pub fn file_name(self) -> &'static str {
        match self {
            Self::Claude => "CLAUDE.md",
            Self::Agents => "AGENTS.md",
        }
    }

    fn applies_to(self) -> Vec<String> {
        match self {
            Self::Claude => vec!["claude-code".to_string()],
            Self::Agents => vec!["codex".to_string(), "opencode".to_string()],
        }
    }

    fn all() -> [Self; 2] {
        [Self::Claude, Self::Agents]
    }
}

/// 一个完整 target 下的 live 指令文档镜像。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionDocument {
    pub kind: InstructionDocumentKind,
    pub file_name: String,
    pub applies_to: Vec<String>,
    pub target: ScopeTarget,
    pub content: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

fn instruction_error(code: &str, suggestion: &str) -> AppError {
    AppError::Message(format_structured_error(code, &[], Some(suggestion)))
}

fn is_project_root_unavailable(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Message(payload) if serde_json::from_str::<serde_json::Value>(payload)
            .ok()
            .and_then(|value| value.get("code").and_then(|code| code.as_str()).map(str::to_owned))
            .as_deref()
            == Some("PROJECT_ROOT_UNAVAILABLE")
    )
}

fn read_optional_file(path: &Path) -> Result<Option<String>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|error| AppError::io(path, error))
}

fn restore_optional_file(path: &Path, previous_content: Option<&str>) {
    match previous_content {
        Some(content) => {
            let _ = config::write_text_file(path, content);
        }
        None => {
            if path.exists() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn modified_at(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

/// 固定解析一个 target 的文档 live 文件。项目 target 只能由 registry root
/// 定位，绝不回退至全局文件。
pub(crate) fn instruction_document_paths(
    state: &AppState,
    target: &ScopeTarget,
    kind: InstructionDocumentKind,
) -> Result<Vec<PathBuf>, AppError> {
    match target {
        ScopeTarget::Global => Ok(match kind {
            InstructionDocumentKind::Claude => vec![config::get_claude_prompt_file()],
            InstructionDocumentKind::Agents => {
                vec![
                    config::get_codex_prompt_file(),
                    config::get_opencode_prompt_file(),
                ]
            }
        }),
        ScopeTarget::Project { .. } => {
            let resolved = ProjectService::resolve_scope_target(&state.db, target)?;
            let root = resolved
                .project_root
                .expect("project target resolution always contains a root");
            Ok(vec![root.join(kind.file_name())])
        }
    }
}

fn document_for_target(
    state: &AppState,
    target: &ScopeTarget,
    kind: InstructionDocumentKind,
) -> Result<InstructionDocument, AppError> {
    let paths = instruction_document_paths(state, target, kind)?;
    let contents: Vec<Option<String>> = paths
        .iter()
        .map(|path| read_optional_file(path))
        .collect::<Result<_, _>>()?;

    let present: Vec<(usize, &String)> = contents
        .iter()
        .enumerate()
        .filter_map(|(index, content)| content.as_ref().map(|content| (index, content)))
        .collect();

    if kind == InstructionDocumentKind::Agents && present.len() == 2 && present[0].1 != present[1].1
    {
        return Err(instruction_error(
            "INSTRUCTION_PROJECTIONS_DIVERGED",
            "resolveInstructionProjectionConflict",
        ));
    }

    let (content, exists, updated_at) = match present.first() {
        Some((index, content)) => (content.to_string(), true, modified_at(&paths[*index])),
        None => (String::new(), false, None),
    };

    Ok(InstructionDocument {
        kind,
        file_name: kind.file_name().to_string(),
        applies_to: kind.applies_to(),
        target: target.clone(),
        content,
        exists,
        updated_at,
    })
}

/// 在某个 Agent 的有效全局配置目录改变时，迁移它所负责的一个 live 文件投影。
///
/// 调用方已经确定 `old_path` 属于即将改变的 Agent；`peer_path` 仅用于全局
/// `AGENTS.md` 的另一投影。任何现存内容冲突都会封闭失败，避免选择一方或
/// 覆盖用户内容。
pub(crate) fn relocate_global_projection_for_override(
    kind: InstructionDocumentKind,
    old_path: &Path,
    new_path: &Path,
    peer_path: Option<&Path>,
) -> Result<(), AppError> {
    if old_path == new_path {
        return Ok(());
    }

    let old_content = read_optional_file(old_path)?;
    let peer_content = match (kind, peer_path) {
        (InstructionDocumentKind::Agents, Some(peer)) if peer != old_path => {
            read_optional_file(peer)?
        }
        _ => None,
    };

    if kind == InstructionDocumentKind::Agents
        && old_content.is_some()
        && peer_content.is_some()
        && old_content != peer_content
    {
        return Err(instruction_error(
            "INSTRUCTION_PROJECTIONS_DIVERGED",
            "resolveInstructionProjectionConflict",
        ));
    }

    let source_content = old_content.as_ref().or(peer_content.as_ref());
    let Some(source_content) = source_content else {
        return Ok(());
    };
    let new_content = read_optional_file(new_path)?;
    if new_content
        .as_deref()
        .is_some_and(|content| content != source_content)
    {
        return Err(instruction_error(
            "INSTRUCTION_OVERRIDE_TARGET_CONFLICT",
            "resolveInstructionOverrideConflict",
        ));
    }

    let wrote_new = new_content.is_none();
    if wrote_new {
        config::write_text_file(new_path, source_content)?;
    }

    // 当 old path 同时仍是另一 Agent 的投影时，保留它给该 Agent 使用。
    let old_is_peer = peer_path.is_some_and(|peer| peer == old_path);
    if old_content.is_some() && !old_is_peer {
        if let Err(error) =
            std::fs::remove_file(old_path).map_err(|source| AppError::io(old_path, source))
        {
            if wrote_new {
                restore_optional_file(new_path, new_content.as_deref());
            }
            return Err(error);
        }
    }

    Ok(())
}

pub struct InstructionDocumentService;

impl InstructionDocumentService {
    /// 返回 context 内固定的两种文档；`all` 按 global、再可访问项目的稳定顺序展开。
    pub fn get_documents_for_context(
        state: &AppState,
        context: &ConfigContext,
    ) -> Result<Vec<InstructionDocument>, AppError> {
        match context {
            ConfigContext::Global => InstructionDocumentKind::all()
                .into_iter()
                .map(|kind| document_for_target(state, &ScopeTarget::Global, kind))
                .collect(),
            ConfigContext::Project { .. } => {
                let target = context.require_mutation_target()?;
                let mut documents = InstructionDocumentKind::all()
                    .into_iter()
                    .map(|kind| document_for_target(state, &target, kind))
                    .collect::<Result<Vec<_>, _>>()?;
                documents.extend(
                    InstructionDocumentKind::all()
                        .into_iter()
                        .map(|kind| document_for_target(state, &ScopeTarget::Global, kind))
                        .collect::<Result<Vec<_>, _>>()?,
                );
                Ok(documents)
            }
            ConfigContext::All => {
                let mut documents = InstructionDocumentKind::all()
                    .into_iter()
                    .map(|kind| document_for_target(state, &ScopeTarget::Global, kind))
                    .collect::<Result<Vec<_>, _>>()?;
                for project in ProjectService::list_projects(&state.db)? {
                    let target = ScopeTarget::Project {
                        project_id: project.project_id,
                    };
                    match InstructionDocumentKind::all()
                        .into_iter()
                        .map(|kind| document_for_target(state, &target, kind))
                        .collect::<Result<Vec<_>, _>>()
                    {
                        Ok(project_documents) => documents.extend(project_documents),
                        Err(error) if is_project_root_unavailable(&error) => continue,
                        Err(error) => return Err(error),
                    }
                }
                Ok(documents)
            }
        }
    }

    /// 直接保存一个固定文档。全局 `AGENTS.md` 会在先确认两个现存投影不冲突后，
    /// 写入 Codex 与 OpenCode；任一写失败都会恢复已经写入的投影。
    pub fn upsert_document(
        state: &AppState,
        target: &ScopeTarget,
        kind: InstructionDocumentKind,
        content: &str,
    ) -> Result<(), AppError> {
        target.validate()?;
        let _state_guard = instruction_state_write_guard();
        let paths = instruction_document_paths(state, target, kind)?;
        let previous_contents: Vec<Option<String>> = paths
            .iter()
            .map(|path| read_optional_file(path))
            .collect::<Result<_, _>>()?;

        if kind == InstructionDocumentKind::Agents
            && previous_contents.len() == 2
            && previous_contents[0].is_some()
            && previous_contents[1].is_some()
            && previous_contents[0] != previous_contents[1]
        {
            return Err(instruction_error(
                "INSTRUCTION_PROJECTIONS_DIVERGED",
                "resolveInstructionProjectionConflict",
            ));
        }

        let mut written_paths: Vec<usize> = Vec::new();
        for (index, path) in paths.iter().enumerate() {
            if let Err(error) = config::write_text_file(path, content) {
                for written_index in written_paths.into_iter().rev() {
                    restore_optional_file(
                        &paths[written_index],
                        previous_contents[written_index].as_deref(),
                    );
                }
                return Err(error);
            }
            written_paths.push(index);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serial_test::serial;

    use super::*;
    use crate::config;
    use crate::error::AppError;
    use crate::services::project::{ConfigContext, ProjectService};
    use crate::{AppState, Database};

    fn state() -> AppState {
        AppState::new(Arc::new(Database::memory().expect("memory db")))
    }

    struct TestHomeGuard {
        _temp: tempfile::TempDir,
    }

    impl Drop for TestHomeGuard {
        fn drop(&mut self) {
            std::env::remove_var(config::ACM_HOME_ENV);
            crate::settings::reset_settings_store_for_test();
        }
    }

    fn setup_temp_home() -> TestHomeGuard {
        let temp = tempfile::tempdir().expect("temp home");
        std::env::set_var(config::ACM_HOME_ENV, temp.path().as_os_str());
        crate::settings::reset_settings_store_for_test();
        TestHomeGuard { _temp: temp }
    }

    fn error_code(error: AppError) -> String {
        let AppError::Message(payload) = error else {
            panic!("expected structured error, got {error}");
        };
        serde_json::from_str::<serde_json::Value>(&payload).expect("structured JSON")["code"]
            .as_str()
            .expect("error code")
            .to_string()
    }

    #[test]
    #[serial]
    fn global_read_returns_two_fixed_documents_when_no_live_files_exist() {
        let _temp = setup_temp_home();
        let state = state();

        let documents =
            InstructionDocumentService::get_documents_for_context(&state, &ConfigContext::Global)
                .expect("read documents");

        assert_eq!(documents.len(), 2);
        assert_eq!(documents[0].kind, InstructionDocumentKind::Claude);
        assert_eq!(documents[0].file_name, "CLAUDE.md");
        assert_eq!(documents[0].applies_to, vec!["claude-code"]);
        assert!(!documents[0].exists);
        assert_eq!(documents[0].content, "");
        assert_eq!(documents[1].kind, InstructionDocumentKind::Agents);
        assert_eq!(documents[1].file_name, "AGENTS.md");
        assert_eq!(documents[1].applies_to, vec!["codex", "opencode"]);
        assert!(!documents[1].exists);
        assert_eq!(documents[1].content, "");
    }

    #[test]
    #[serial]
    fn saving_global_agents_writes_the_same_content_to_codex_and_opencode() {
        let _temp = setup_temp_home();
        let state = state();

        InstructionDocumentService::upsert_document(
            &state,
            &ScopeTarget::Global,
            InstructionDocumentKind::Agents,
            "shared instructions",
        )
        .expect("save AGENTS document");

        assert_eq!(
            std::fs::read_to_string(config::get_codex_prompt_file()).expect("codex projection"),
            "shared instructions"
        );
        assert_eq!(
            std::fs::read_to_string(config::get_opencode_prompt_file())
                .expect("opencode projection"),
            "shared instructions"
        );
    }

    #[test]
    #[serial]
    fn project_context_lists_its_two_documents_before_the_global_two_documents() {
        let _temp = setup_temp_home();
        let state = state();
        let root = tempfile::tempdir().expect("project root");
        let project = ProjectService::add_project(&state.db, root.path(), None).expect("project");
        let project_target = ScopeTarget::Project {
            project_id: project.project_id.clone(),
        };

        config::write_text_file(&root.path().join("CLAUDE.md"), "project claude")
            .expect("project CLAUDE");
        config::write_text_file(&config::get_claude_prompt_file(), "global claude")
            .expect("global CLAUDE");

        let documents = InstructionDocumentService::get_documents_for_context(
            &state,
            &ConfigContext::Project {
                project_id: project.project_id,
            },
        )
        .expect("read project documents");

        assert_eq!(documents.len(), 4);
        assert_eq!(documents[0].target, project_target);
        assert_eq!(documents[0].kind, InstructionDocumentKind::Claude);
        assert_eq!(documents[0].content, "project claude");
        assert_eq!(documents[1].target, documents[0].target);
        assert_eq!(documents[1].kind, InstructionDocumentKind::Agents);
        assert_eq!(documents[2].target, ScopeTarget::Global);
        assert_eq!(documents[2].kind, InstructionDocumentKind::Claude);
        assert_eq!(documents[2].content, "global claude");
        assert_eq!(documents[3].target, ScopeTarget::Global);
        assert_eq!(documents[3].kind, InstructionDocumentKind::Agents);
    }

    #[test]
    #[serial]
    fn global_agents_reads_the_only_existing_projection() {
        let _temp = setup_temp_home();
        let state = state();
        config::write_text_file(&config::get_opencode_prompt_file(), "only OpenCode exists")
            .expect("seed OpenCode projection");

        let documents =
            InstructionDocumentService::get_documents_for_context(&state, &ConfigContext::Global)
                .expect("read documents");
        let agents = documents
            .into_iter()
            .find(|document| document.kind == InstructionDocumentKind::Agents)
            .expect("AGENTS document");

        assert!(agents.exists);
        assert_eq!(agents.content, "only OpenCode exists");
    }

    #[test]
    #[serial]
    fn divergent_global_agents_projections_fail_without_writing_either_file() {
        let _temp = setup_temp_home();
        let state = state();
        let codex_path = config::get_codex_prompt_file();
        let opencode_path = config::get_opencode_prompt_file();
        config::write_text_file(&codex_path, "Codex version").expect("seed Codex projection");
        config::write_text_file(&opencode_path, "OpenCode version")
            .expect("seed OpenCode projection");

        let read_error =
            InstructionDocumentService::get_documents_for_context(&state, &ConfigContext::Global)
                .expect_err("divergence must not pick a projection");
        assert_eq!(error_code(read_error), "INSTRUCTION_PROJECTIONS_DIVERGED");

        let write_error = InstructionDocumentService::upsert_document(
            &state,
            &ScopeTarget::Global,
            InstructionDocumentKind::Agents,
            "replacement",
        )
        .expect_err("divergence must reject a save");
        assert_eq!(error_code(write_error), "INSTRUCTION_PROJECTIONS_DIVERGED");
        assert_eq!(
            std::fs::read_to_string(codex_path).unwrap(),
            "Codex version"
        );
        assert_eq!(
            std::fs::read_to_string(opencode_path).unwrap(),
            "OpenCode version"
        );
    }

    #[test]
    #[serial]
    fn global_agents_save_restores_codex_when_opencode_write_fails() {
        let _temp = setup_temp_home();
        let state = state();
        let codex_path = config::get_codex_prompt_file();
        config::write_text_file(&codex_path, "before save").expect("seed Codex projection");

        let invalid_override = config::get_home_dir().join("not-a-directory");
        std::fs::write(&invalid_override, "file").expect("create invalid override path");
        crate::settings::set_agent_config_dir_override(
            "opencode",
            Some(invalid_override.to_string_lossy().to_string()),
        )
        .expect("set invalid override for write failure");

        let result = InstructionDocumentService::upsert_document(
            &state,
            &ScopeTarget::Global,
            InstructionDocumentKind::Agents,
            "new content",
        );

        assert!(result.is_err(), "second projection write must fail");
        assert_eq!(
            std::fs::read_to_string(codex_path).unwrap(),
            "before save",
            "the first projection must be restored"
        );
    }

    #[test]
    #[serial]
    fn saving_project_agents_writes_only_the_project_root_file() {
        let _temp = setup_temp_home();
        let state = state();
        let root = tempfile::tempdir().expect("project root");
        let project = ProjectService::add_project(&state.db, root.path(), None).expect("project");
        let target = ScopeTarget::Project {
            project_id: project.project_id,
        };
        config::write_text_file(&config::get_codex_prompt_file(), "global instructions")
            .expect("seed global projection");

        InstructionDocumentService::upsert_document(
            &state,
            &target,
            InstructionDocumentKind::Agents,
            "project instructions",
        )
        .expect("save project AGENTS");

        assert_eq!(
            std::fs::read_to_string(root.path().join("AGENTS.md")).unwrap(),
            "project instructions"
        );
        assert_eq!(
            std::fs::read_to_string(config::get_codex_prompt_file()).unwrap(),
            "global instructions"
        );
        assert!(!config::get_opencode_prompt_file().exists());
    }

    #[test]
    #[serial]
    fn override_relocation_does_not_overwrite_a_different_new_agents_projection() {
        let _temp = setup_temp_home();
        let codex_path = config::get_codex_prompt_file();
        let opencode_path = config::get_opencode_prompt_file();
        config::write_text_file(&codex_path, "shared instructions").expect("seed Codex");
        config::write_text_file(&opencode_path, "shared instructions").expect("seed OpenCode");
        let custom_dir = config::get_home_dir().join("custom-codex");
        let new_path = custom_dir.join("AGENTS.md");
        config::write_text_file(&new_path, "different user content").expect("seed new target");

        let error = relocate_global_projection_for_override(
            InstructionDocumentKind::Agents,
            &codex_path,
            &new_path,
            Some(&opencode_path),
        )
        .expect_err("different target content must not be overwritten");

        assert_eq!(error_code(error), "INSTRUCTION_OVERRIDE_TARGET_CONFLICT");
        assert_eq!(
            std::fs::read_to_string(&codex_path).unwrap(),
            "shared instructions"
        );
        assert_eq!(
            std::fs::read_to_string(&opencode_path).unwrap(),
            "shared instructions"
        );
        assert_eq!(
            std::fs::read_to_string(&new_path).unwrap(),
            "different user content"
        );
    }
}
