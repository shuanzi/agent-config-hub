//! Skills 数据访问对象
//!
//! 提供 Skills 和 Skill Repos 的 CRUD 操作。

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::services::project::ScopeTarget;
use crate::services::skill::{InstalledSkill, SkillApps, SkillRepo};
use indexmap::IndexMap;
use rusqlite::params;

impl Database {
    /// 获取所有已安装的 Skills
    pub fn get_global_installed_skills(
        &self,
    ) -> Result<IndexMap<String, InstalledSkill>, AppError> {
        self.get_all_installed_skills_for_target(&ScopeTarget::Global)
    }

    /// 按完整 scope target 获取已安装 Skills。
    pub fn get_all_installed_skills_for_target(
        &self,
        target: &ScopeTarget,
    ) -> Result<IndexMap<String, InstalledSkill>, AppError> {
        target.validate()?;
        let (scope, project_id) = skill_target_parts(target);
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, directory, repo_owner, repo_name, repo_branch,
                        readme_url, enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
                        installed_at, content_hash, updated_at
                 FROM skills
                 WHERE scope = ?1 AND project_id IS ?2
                 ORDER BY name ASC, id ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let target = target.clone();
        let skill_iter = stmt
            .query_map(params![scope, project_id], move |row| {
                Ok(InstalledSkill {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    directory: row.get(3)?,
                    repo_owner: row.get(4)?,
                    repo_name: row.get(5)?,
                    repo_branch: row.get(6)?,
                    readme_url: row.get(7)?,
                    apps: SkillApps {
                        claude_code: row.get(8)?,
                        codex: row.get(9)?,
                        gemini_cli: row.get(10)?,
                        opencode: row.get(11)?,
                    },
                    installed_at: row.get(12)?,
                    content_hash: row.get(13)?,
                    updated_at: row.get::<_, i64>(14).unwrap_or(0),
                    target: target.clone(),
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut skills = IndexMap::new();
        for skill_res in skill_iter {
            let skill = skill_res.map_err(|e| AppError::Database(e.to_string()))?;
            skills.insert(skill.id.clone(), skill);
        }
        Ok(skills)
    }

    /// 获取单个已安装的 Skill
    pub fn get_global_installed_skill(&self, id: &str) -> Result<Option<InstalledSkill>, AppError> {
        self.get_installed_skill_for_target(id, &ScopeTarget::Global)
    }

    /// 按完整 scope target 获取单个已安装的 Skill。
    pub fn get_installed_skill_for_target(
        &self,
        id: &str,
        target: &ScopeTarget,
    ) -> Result<Option<InstalledSkill>, AppError> {
        target.validate()?;
        let (scope, project_id) = skill_target_parts(target);
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, directory, repo_owner, repo_name, repo_branch,
                        readme_url, enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
                        installed_at, content_hash, updated_at
                 FROM skills WHERE id = ?1 AND scope = ?2 AND project_id IS ?3",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let target = target.clone();
        let result = stmt.query_row(params![id, scope, project_id], |row| {
            Ok(InstalledSkill {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                directory: row.get(3)?,
                repo_owner: row.get(4)?,
                repo_name: row.get(5)?,
                repo_branch: row.get(6)?,
                readme_url: row.get(7)?,
                apps: SkillApps {
                    claude_code: row.get(8)?,
                    codex: row.get(9)?,
                    gemini_cli: row.get(10)?,
                    opencode: row.get(11)?,
                },
                installed_at: row.get(12)?,
                content_hash: row.get(13)?,
                updated_at: row.get::<_, i64>(14).unwrap_or(0),
                target: target.clone(),
            })
        });

        match result {
            Ok(skill) => Ok(Some(skill)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    /// 保存 Skill（添加或更新）
    pub fn save_skill(&self, skill: &InstalledSkill) -> Result<(), AppError> {
        skill.target.validate()?;
        let (scope, project_id) = skill_target_parts(&skill.target);
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO skills
             (id, name, description, directory, repo_owner, repo_name, repo_branch,
              readme_url, enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
              installed_at, content_hash, updated_at, scope, project_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                skill.id,
                skill.name,
                skill.description,
                skill.directory,
                skill.repo_owner,
                skill.repo_name,
                skill.repo_branch,
                skill.readme_url,
                skill.apps.claude_code,
                skill.apps.codex,
                skill.apps.gemini_cli,
                skill.apps.opencode,
                skill.installed_at,
                skill.content_hash,
                skill.updated_at,
                scope,
                project_id,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 仅更新已安装 Skill 的元数据，不修改各 Agent 的启用状态。
    pub fn update_skill_metadata(&self, skill: &InstalledSkill) -> Result<bool, AppError> {
        skill.target.validate()?;
        let (scope, project_id) = skill_target_parts(&skill.target);
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills
                 SET name = ?1,
                     description = ?2,
                     directory = ?3,
                     repo_owner = ?4,
                     repo_name = ?5,
                     repo_branch = ?6,
                     readme_url = ?7,
                     installed_at = ?8,
                     content_hash = ?9,
                     updated_at = ?10
                 WHERE id = ?11 AND installed_at = ?12 AND scope = ?13 AND project_id IS ?14",
                params![
                    skill.name,
                    skill.description,
                    skill.directory,
                    skill.repo_owner,
                    skill.repo_name,
                    skill.repo_branch,
                    skill.readme_url,
                    skill.installed_at,
                    skill.content_hash,
                    skill.updated_at,
                    skill.id,
                    skill.installed_at,
                    scope,
                    project_id,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 删除 Skill
    pub fn delete_global_skill(&self, id: &str) -> Result<bool, AppError> {
        self.delete_skill_for_target(id, &ScopeTarget::Global)
    }

    /// 按完整 scope target 删除 Skill。
    pub fn delete_skill_for_target(
        &self,
        id: &str,
        target: &ScopeTarget,
    ) -> Result<bool, AppError> {
        target.validate()?;
        let (scope, project_id) = skill_target_parts(target);
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM skills WHERE id = ?1 AND scope = ?2 AND project_id IS ?3",
                params![id, scope, project_id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 清空所有 Skills（用于迁移）
    pub fn clear_global_skills(&self) -> Result<(), AppError> {
        self.clear_skills_for_target(&ScopeTarget::Global)
    }

    /// 仅清空明确 target 内的 Skills。
    pub fn clear_skills_for_target(&self, target: &ScopeTarget) -> Result<(), AppError> {
        target.validate()?;
        let (scope, project_id) = skill_target_parts(target);
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM skills WHERE scope = ?1 AND project_id IS ?2",
            params![scope, project_id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 更新 Skill 的 Agent 启用状态
    pub fn update_global_skill_apps(&self, id: &str, apps: &SkillApps) -> Result<bool, AppError> {
        self.update_skill_apps_for_target(id, &ScopeTarget::Global, apps)
    }

    /// 按完整 scope target 更新 Skill 的 Agent 启用状态。
    pub fn update_skill_apps_for_target(
        &self,
        id: &str,
        target: &ScopeTarget,
        apps: &SkillApps,
    ) -> Result<bool, AppError> {
        target.validate()?;
        let (scope, project_id) = skill_target_parts(target);
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills
                 SET enabled_claude_code = ?1, enabled_codex = ?2, enabled_gemini_cli = ?3, enabled_opencode = ?4
                 WHERE id = ?5 AND scope = ?6 AND project_id IS ?7",
                params![apps.claude_code, apps.codex, apps.gemini_cli, apps.opencode, id, scope, project_id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 更新 Skill 的内容哈希和更新时间
    pub fn update_global_skill_hash(
        &self,
        id: &str,
        content_hash: &str,
        updated_at: i64,
    ) -> Result<bool, AppError> {
        self.update_skill_hash_for_target(id, &ScopeTarget::Global, content_hash, updated_at)
    }

    /// 按完整 scope target 更新 Skill 的内容哈希和更新时间。
    pub fn update_skill_hash_for_target(
        &self,
        id: &str,
        target: &ScopeTarget,
        content_hash: &str,
        updated_at: i64,
    ) -> Result<bool, AppError> {
        target.validate()?;
        let (scope, project_id) = skill_target_parts(target);
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET content_hash = ?1, updated_at = ?2
                 WHERE id = ?3 AND scope = ?4 AND project_id IS ?5",
                params![content_hash, updated_at, id, scope, project_id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 获取所有 Skill 仓库
    pub fn get_skill_repos(&self) -> Result<Vec<SkillRepo>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT owner, name, branch, enabled FROM skill_repos ORDER BY owner ASC, name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let repo_iter = stmt
            .query_map([], |row| {
                Ok(SkillRepo {
                    owner: row.get(0)?,
                    name: row.get(1)?,
                    branch: row.get(2)?,
                    enabled: row.get(3)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut repos = Vec::new();
        for repo_res in repo_iter {
            repos.push(repo_res.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(repos)
    }

    /// 保存 Skill 仓库
    pub fn save_skill_repo(&self, repo: &SkillRepo) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO skill_repos (owner, name, branch, enabled) VALUES (?1, ?2, ?3, ?4)",
            params![repo.owner, repo.name, repo.branch, repo.enabled],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 删除 Skill 仓库
    pub fn delete_skill_repo(&self, owner: &str, name: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM skill_repos WHERE owner = ?1 AND name = ?2",
            params![owner, name],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 初始化默认的 Skill 仓库（首次且 skill_repos 为空时执行）
    pub fn init_default_skill_repos(&self) -> Result<usize, AppError> {
        const INITIALIZED_KEY: &str = "default_skill_repos_initialized";

        if self.get_bool_flag(INITIALIZED_KEY)? {
            return Ok(0);
        }

        if !self.get_skill_repos()?.is_empty() {
            self.set_setting(INITIALIZED_KEY, "true")?;
            return Ok(0);
        }

        let defaults = crate::services::skill::default_skill_repos();
        let mut count = 0;

        for repo in &defaults {
            self.save_skill_repo(repo)?;
            count += 1;
            log::info!("初始化默认 Skill 仓库: {}/{}", repo.owner, repo.name);
        }

        self.set_setting(INITIALIZED_KEY, "true")?;
        Ok(count)
    }
}

fn skill_target_parts(target: &ScopeTarget) -> (&str, Option<&str>) {
    match target {
        ScopeTarget::Global => ("global", None),
        ScopeTarget::Project { project_id } => ("project", Some(project_id)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::ScopeTarget;
    use crate::services::skill::AgentType;

    fn skill(id: &str, name: &str, apps: SkillApps) -> InstalledSkill {
        InstalledSkill {
            id: id.to_string(),
            name: name.to_string(),
            description: Some(format!("{name} description")),
            directory: format!("{name}-directory"),
            repo_owner: Some("owner".to_string()),
            repo_name: Some("repo".to_string()),
            repo_branch: Some("main".to_string()),
            readme_url: Some(format!("https://example.com/{name}")),
            apps,
            installed_at: 1,
            content_hash: Some(format!("{name}-hash")),
            updated_at: 2,
            target: ScopeTarget::Global,
        }
    }

    #[test]
    fn update_skill_metadata_preserves_enabled_apps() {
        let db = Database::memory().expect("memory db");
        let installed_apps = SkillApps::only(&AgentType::Codex);
        let original = skill("owner/repo:skill", "original", installed_apps.clone());
        db.save_skill(&original).expect("seed skill");

        let mut candidate = skill(
            &original.id,
            "updated",
            SkillApps::only(&AgentType::ClaudeCode),
        );
        candidate.repo_branch = Some("next".to_string());
        candidate.updated_at = 42;

        assert!(db
            .update_skill_metadata(&candidate)
            .expect("update metadata"));

        let stored = db
            .get_global_installed_skill(&original.id)
            .expect("query skill")
            .expect("skill remains installed");
        assert_eq!(stored.name, candidate.name);
        assert_eq!(stored.description, candidate.description);
        assert_eq!(stored.directory, candidate.directory);
        assert_eq!(stored.repo_branch, candidate.repo_branch);
        assert_eq!(stored.readme_url, candidate.readme_url);
        assert_eq!(stored.content_hash, candidate.content_hash);
        assert_eq!(stored.updated_at, candidate.updated_at);
        assert_eq!(stored.apps, installed_apps);
    }

    #[test]
    fn update_skill_metadata_does_not_insert_missing_skill() {
        let db = Database::memory().expect("memory db");
        let candidate = skill(
            "owner/repo:missing",
            "missing",
            SkillApps::only(&AgentType::ClaudeCode),
        );

        assert!(!db
            .update_skill_metadata(&candidate)
            .expect("missing update is not an error"));
        assert!(db
            .get_global_installed_skill(&candidate.id)
            .expect("query skill")
            .is_none());
    }

    #[test]
    fn update_skill_metadata_does_not_touch_reinstalled_generation() {
        let db = Database::memory().expect("memory db");
        let stale_update = skill(
            "owner/repo:skill",
            "stale-update",
            SkillApps::only(&AgentType::ClaudeCode),
        );

        let mut reinstalled = skill(
            &stale_update.id,
            "reinstalled",
            SkillApps::only(&AgentType::GeminiCli),
        );
        reinstalled.installed_at = stale_update.installed_at + 1;
        db.save_skill(&reinstalled).expect("seed reinstalled skill");

        assert!(!db
            .update_skill_metadata(&stale_update)
            .expect("stale generation update is not an error"));

        let stored = db
            .get_global_installed_skill(&reinstalled.id)
            .expect("query skill")
            .expect("reinstalled generation remains");
        assert_eq!(stored.name, reinstalled.name);
        assert_eq!(stored.installed_at, reinstalled.installed_at);
        assert_eq!(stored.apps, reinstalled.apps);
    }

    #[test]
    fn default_skill_repos_seeded_once() {
        let db = Database::memory().expect("memory db");
        let count = db.init_default_skill_repos().expect("seed");
        assert_eq!(count, 4);
        let repos = db.get_skill_repos().expect("list");
        assert_eq!(repos.len(), 4);

        let count2 = db.init_default_skill_repos().expect("seed again");
        assert_eq!(count2, 0);
    }

    #[test]
    fn same_skill_id_is_independent_per_target() {
        let db = Database::memory().expect("memory db");
        {
            let conn = db.conn.lock().expect("database lock");
            conn.execute(
                "INSERT INTO projects (project_id, display_name, root_path) VALUES (?1, ?2, ?3)",
                params!["project-a", "Project A", "/project-a"],
            )
            .expect("seed project");
        }
        let global = skill(
            "owner/repo:shared",
            "global",
            SkillApps::only(&AgentType::ClaudeCode),
        );
        let project_target = ScopeTarget::Project {
            project_id: "project-a".to_string(),
        };
        let mut project = skill(
            "owner/repo:shared",
            "project",
            SkillApps::only(&AgentType::Codex),
        );
        project.target = project_target.clone();

        db.save_skill(&global).expect("save global skill");
        db.save_skill(&project).expect("save project skill");

        assert_eq!(
            db.get_installed_skill_for_target("owner/repo:shared", &ScopeTarget::Global)
                .expect("read global")
                .expect("global skill")
                .name,
            "global"
        );
        assert_eq!(
            db.get_installed_skill_for_target("owner/repo:shared", &project_target)
                .expect("read project")
                .expect("project skill")
                .name,
            "project"
        );
    }
}
