//! 显式登记项目与配置上下文的窄服务层。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::database::{Database, ProjectRemoval};
use crate::error::{format_structured_error, AppError};
use crate::services::skill::{skill_state_read_guard, SkillService};
use crate::services::subagent::{subagent_state_read_guard, SubagentService};

/// 项目 registry 对前端的最小镜像。`project_id` 是唯一身份。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub project_id: String,
    pub display_name: String,
    pub root_path: String,
}

/// 单个资产读写目标。项目目标只能携带已登记的 opaque `projectId`。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "lowercase", deny_unknown_fields)]
pub enum ScopeTarget {
    #[default]
    Global,
    Project {
        #[serde(rename = "projectId")]
        project_id: String,
    },
}

impl ScopeTarget {
    pub fn validate(&self) -> Result<(), AppError> {
        match self {
            Self::Global => Ok(()),
            Self::Project { project_id } if !project_id.trim().is_empty() => Ok(()),
            Self::Project { .. } => Err(project_error(
                "INVALID_SCOPE_TARGET",
                &[("reason", "projectId must be non-empty for project scope")],
                Some("selectProject"),
            )),
        }
    }
}

/// 列表读取上下文。`all` 不可被用于创建新的 mutation target。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum ConfigContext {
    All,
    Global,
    Project {
        #[serde(rename = "projectId")]
        project_id: String,
    },
}

impl ConfigContext {
    pub fn require_mutation_target(&self) -> Result<ScopeTarget, AppError> {
        match self {
            Self::All => Err(project_error(
                "ALL_REQUIRES_TARGET",
                &[],
                Some("selectTarget"),
            )),
            Self::Global => Ok(ScopeTarget::Global),
            Self::Project { project_id } => {
                let target = ScopeTarget::Project {
                    project_id: project_id.clone(),
                };
                target.validate()?;
                Ok(target)
            }
        }
    }
}

/// 已由 registry 核验的 scope target。项目 root 始终来自数据库而非调用方。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedScopeTarget {
    pub target: ScopeTarget,
    pub project_root: Option<PathBuf>,
}

pub struct ProjectService;

impl ProjectService {
    pub fn add_project(
        db: &Database,
        root_path: impl AsRef<Path>,
        display_name: Option<String>,
    ) -> Result<ProjectSummary, AppError> {
        let canonical_root = canonical_existing_directory(root_path.as_ref())?;
        let root_path = canonical_root.display().to_string();
        if db.get_project_by_root_path(&root_path)?.is_some() {
            return Err(project_error(
                "PROJECT_ROOT_ALREADY_REGISTERED",
                &[("rootPath", &root_path)],
                Some("chooseAnotherDirectory"),
            ));
        }

        let display_name = display_name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| default_display_name(&canonical_root));
        match db.create_project(&display_name, &root_path) {
            Ok(project) => Ok(project),
            Err(AppError::Database(message)) if is_unique_root_constraint(&message) => {
                Err(project_error(
                    "PROJECT_ROOT_ALREADY_REGISTERED",
                    &[("rootPath", &root_path)],
                    Some("chooseAnotherDirectory"),
                ))
            }
            Err(error) => Err(error),
        }
    }

    pub fn list_projects(db: &Database) -> Result<Vec<ProjectSummary>, AppError> {
        db.list_projects()
    }

    pub fn relink_project_root(
        db: &Database,
        project_id: &str,
        root_path: impl AsRef<Path>,
    ) -> Result<ProjectSummary, AppError> {
        let project = db
            .get_project(project_id)?
            .ok_or_else(|| project_not_found(project_id))?;
        let canonical_root = canonical_existing_directory(root_path.as_ref())?;
        let root_path = canonical_root.display().to_string();

        if let Some(other) = db.get_project_by_root_path(&root_path)? {
            if other.project_id != project.project_id {
                return Err(project_error(
                    "PROJECT_ROOT_ALREADY_REGISTERED",
                    &[("rootPath", &root_path)],
                    Some("chooseAnotherDirectory"),
                ));
            }
        }

        if !db.update_project_root(project_id, &root_path)? {
            return Err(project_not_found(project_id));
        }

        Ok(ProjectSummary {
            project_id: project.project_id,
            display_name: project.display_name,
            root_path,
        })
    }

    /// 仅解除 registry；不得访问项目 root 或处理文件系统备份。
    pub fn remove_project(db: &Database, project_id: &str) -> Result<(), AppError> {
        // 锁顺序固定为 Skill state -> Subagent state -> DB：卸载在对应写锁内创建
        // backup 并删除数据库行，项目移除在同一快照检查两类 backup 与关联行，避免
        // 漏掉刚创建的项目 backup。
        let _skill_state_guard = skill_state_read_guard();
        let _subagent_state_guard = subagent_state_read_guard();
        if db.get_project(project_id)?.is_none() {
            return Err(project_not_found(project_id));
        }
        if SkillService::has_backup_for_target(project_id)?
            || SubagentService::has_backup_for_target(project_id)?
        {
            return Err(project_error(
                "PROJECT_HAS_MANAGED_ASSETS",
                &[("projectId", project_id)],
                Some("removeManagedAssets"),
            ));
        }
        match db.remove_project_if_empty(project_id)? {
            ProjectRemoval::Missing => Err(project_not_found(project_id)),
            ProjectRemoval::HasManagedAssets => Err(project_error(
                "PROJECT_HAS_MANAGED_ASSETS",
                &[("projectId", project_id)],
                Some("removeManagedAssets"),
            )),
            ProjectRemoval::Removed => Ok(()),
        }
    }

    /// 将项目 target 解析为 registry 中已登记且当前仍可访问的 root。
    pub fn resolve_scope_target(
        db: &Database,
        target: &ScopeTarget,
    ) -> Result<ResolvedScopeTarget, AppError> {
        target.validate()?;
        match target {
            ScopeTarget::Global => Ok(ResolvedScopeTarget {
                target: ScopeTarget::Global,
                project_root: None,
            }),
            ScopeTarget::Project { project_id } => {
                let project = db
                    .get_project(project_id)?
                    .ok_or_else(|| project_not_found(project_id))?;
                let root = PathBuf::from(&project.root_path);
                if !project_root_is_accessible(&root) {
                    return Err(project_error(
                        "PROJECT_ROOT_UNAVAILABLE",
                        &[("projectId", project_id)],
                        Some("relinkProject"),
                    ));
                }
                Ok(ResolvedScopeTarget {
                    target: target.clone(),
                    project_root: Some(root),
                })
            }
        }
    }
}

/// 项目 root 必须能列出内容并进入目录；存在但权限已失效时不能返回缓存资产。
fn project_root_is_accessible(root: &Path) -> bool {
    if !root.is_dir() {
        return false;
    }
    let mut entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    if entries.next().is_some_and(|entry| entry.is_err()) {
        return false;
    }
    std::fs::metadata(root.join(".")).is_ok()
}

fn canonical_existing_directory(path: &Path) -> Result<PathBuf, AppError> {
    let requested_root = path.display().to_string();
    let canonical = std::fs::canonicalize(path).map_err(|_| {
        project_error(
            "PROJECT_ROOT_UNAVAILABLE",
            &[("rootPath", &requested_root)],
            Some("selectExistingDirectory"),
        )
    })?;
    if !canonical.is_dir() {
        return Err(project_error(
            "PROJECT_ROOT_UNAVAILABLE",
            &[("rootPath", &requested_root)],
            Some("selectExistingDirectory"),
        ));
    }
    Ok(canonical)
}

fn default_display_name(root_path: &Path) -> String {
    root_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| root_path.to_string_lossy().into_owned())
}

fn project_not_found(project_id: &str) -> AppError {
    project_error(
        "PROJECT_NOT_FOUND",
        &[("projectId", project_id)],
        Some("refreshProjects"),
    )
}

fn project_error(code: &str, context: &[(&str, &str)], suggestion: Option<&str>) -> AppError {
    AppError::Message(format_structured_error(code, context, suggestion))
}

fn is_unique_root_constraint(message: &str) -> bool {
    message.contains("projects.root_path")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::params;
    use serde_json::json;

    use super::{ConfigContext, ProjectService, ScopeTarget};
    use crate::database::Database;
    use crate::error::AppError;

    fn error_code(error: AppError) -> String {
        let AppError::Message(payload) = error else {
            panic!("expected structured project error");
        };
        serde_json::from_str::<serde_json::Value>(&payload).unwrap()["code"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn scope_and_context_serde_are_stable_and_all_cannot_mutate() {
        assert_eq!(
            serde_json::to_value(ScopeTarget::Global).unwrap(),
            json!({ "scope": "global" })
        );
        assert_eq!(
            serde_json::to_value(ScopeTarget::Project {
                project_id: "project-a".to_string(),
            })
            .unwrap(),
            json!({ "scope": "project", "projectId": "project-a" })
        );
        assert_eq!(
            serde_json::to_value(ConfigContext::Project {
                project_id: "project-a".to_string(),
            })
            .unwrap(),
            json!({ "kind": "project", "projectId": "project-a" })
        );
        assert_eq!(
            error_code(ConfigContext::All.require_mutation_target().unwrap_err()),
            "ALL_REQUIRES_TARGET"
        );
    }

    #[test]
    fn add_lists_same_named_projects_with_distinct_opaque_ids() {
        let temp = tempfile::tempdir().unwrap();
        let first_root = temp.path().join("first");
        let second_root = temp.path().join("second");
        fs::create_dir(&first_root).unwrap();
        fs::create_dir(&second_root).unwrap();
        let db = Database::memory().unwrap();

        let first =
            ProjectService::add_project(&db, &first_root, Some("Workspace".to_string())).unwrap();
        let second =
            ProjectService::add_project(&db, &second_root, Some("Workspace".to_string())).unwrap();

        assert_ne!(first.project_id, second.project_id);
        assert_eq!(first.display_name, "Workspace");
        assert_eq!(second.display_name, "Workspace");
        assert_eq!(ProjectService::list_projects(&db).unwrap().len(), 2);
        assert_eq!(first.project_id.len(), 32);
        assert!(first
            .project_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit()));
    }

    #[test]
    fn add_rejects_missing_file_and_duplicate_canonical_roots() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let file = temp.path().join("file");
        fs::create_dir(&root).unwrap();
        fs::write(&file, "not a directory").unwrap();
        let db = Database::memory().unwrap();

        assert_eq!(
            error_code(
                ProjectService::add_project(&db, temp.path().join("missing"), None).unwrap_err()
            ),
            "PROJECT_ROOT_UNAVAILABLE"
        );
        assert_eq!(
            error_code(ProjectService::add_project(&db, &file, None).unwrap_err()),
            "PROJECT_ROOT_UNAVAILABLE"
        );

        let registered = ProjectService::add_project(&db, &root, None).unwrap();
        assert_eq!(registered.display_name, "root");
        assert_eq!(
            error_code(ProjectService::add_project(&db, root.join("."), None).unwrap_err()),
            "PROJECT_ROOT_ALREADY_REGISTERED"
        );
    }

    #[test]
    fn relink_keeps_identity_and_project_owned_rows() {
        let temp = tempfile::tempdir().unwrap();
        let old_root = temp.path().join("old-root");
        let new_root = temp.path().join("new-root");
        fs::create_dir(&old_root).unwrap();
        fs::create_dir(&new_root).unwrap();
        let db = Database::memory().unwrap();
        let project =
            ProjectService::add_project(&db, &old_root, Some("Kept name".to_string())).unwrap();

        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO skills (id, name, directory, scope, project_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["project-skill", "Project skill", "project-skill", "project", project.project_id],
            )
            .unwrap();
        }

        let relinked =
            ProjectService::relink_project_root(&db, &project.project_id, &new_root).unwrap();
        assert_eq!(relinked.project_id, project.project_id);
        assert_eq!(relinked.display_name, "Kept name");
        assert_eq!(
            relinked.root_path,
            fs::canonicalize(&new_root).unwrap().display().to_string()
        );
        let project_row_count: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE scope = 'project' AND project_id = ?1",
                [&project.project_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(project_row_count, 1);
    }

    #[test]
    fn target_resolution_is_db_backed_and_fails_closed() {
        let db = Database::memory().unwrap();
        assert_eq!(
            error_code(
                ProjectService::resolve_scope_target(
                    &db,
                    &ScopeTarget::Project {
                        project_id: "missing".to_string(),
                    },
                )
                .unwrap_err(),
            ),
            "PROJECT_NOT_FOUND"
        );
        assert_eq!(
            error_code(
                ProjectService::resolve_scope_target(
                    &db,
                    &ScopeTarget::Project {
                        project_id: String::new(),
                    },
                )
                .unwrap_err(),
            ),
            "INVALID_SCOPE_TARGET"
        );

        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        fs::create_dir(&root).unwrap();
        let project = ProjectService::add_project(&db, &root, None).unwrap();
        fs::remove_dir(&root).unwrap();

        assert_eq!(
            error_code(
                ProjectService::resolve_scope_target(
                    &db,
                    &ScopeTarget::Project {
                        project_id: project.project_id,
                    },
                )
                .unwrap_err(),
            ),
            "PROJECT_ROOT_UNAVAILABLE"
        );
    }

    #[cfg(unix)]
    #[test]
    fn target_resolution_rejects_directory_without_read_or_search_permission() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        fs::create_dir(&root).unwrap();
        let db = Database::memory().unwrap();
        let project = ProjectService::add_project(&db, &root, None).unwrap();
        let original_permissions = fs::metadata(&root).unwrap().permissions();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o000)).unwrap();

        let result = ProjectService::resolve_scope_target(
            &db,
            &ScopeTarget::Project {
                project_id: project.project_id,
            },
        );

        fs::set_permissions(&root, original_permissions).unwrap();
        assert_eq!(
            error_code(result.expect_err("unreadable root must fail closed")),
            "PROJECT_ROOT_UNAVAILABLE"
        );
    }

    #[test]
    fn remove_ignores_legacy_global_prompts_but_keeps_skill_ownership_blocking() {
        let temp = tempfile::tempdir().unwrap();
        let managed_root = temp.path().join("managed");
        let legacy_prompt_root = temp.path().join("legacy-prompt");
        let empty_root = temp.path().join("empty");
        fs::create_dir(&managed_root).unwrap();
        fs::create_dir(&legacy_prompt_root).unwrap();
        fs::create_dir(&empty_root).unwrap();
        let db = Database::memory().unwrap();
        let managed = ProjectService::add_project(&db, &managed_root, None).unwrap();
        let legacy_prompt = ProjectService::add_project(&db, &legacy_prompt_root, None).unwrap();
        let empty = ProjectService::add_project(&db, &empty_root, None).unwrap();

        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO skills (id, name, directory, scope, project_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["managed-skill", "Managed", "managed-skill", "project", &managed.project_id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO prompts (id, app_type, name, content) VALUES (?1, ?2, ?3, ?4)",
                params!["legacy", "codex", "Legacy", "legacy content"],
            )
            .unwrap();
        }
        assert_eq!(
            error_code(ProjectService::remove_project(&db, &managed.project_id).unwrap_err()),
            "PROJECT_HAS_MANAGED_ASSETS"
        );

        ProjectService::remove_project(&db, &legacy_prompt.project_id)
            .expect("legacy global prompts must not own a project lifecycle");
        let conn = db.conn.lock().unwrap();
        let prompt_content: String = conn
            .query_row(
                "SELECT content FROM prompts WHERE id = ?1 AND app_type = ?2",
                params!["legacy", "codex"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(prompt_content, "legacy content");
        drop(conn);

        fs::remove_dir(&empty_root).unwrap();
        ProjectService::remove_project(&db, &empty.project_id).unwrap();
        assert!(ProjectService::list_projects(&db)
            .unwrap()
            .iter()
            .all(|project| project.project_id != empty.project_id));
    }
}
