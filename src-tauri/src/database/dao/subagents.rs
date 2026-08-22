//! Subagents 数据访问对象
//!
//! 提供 Subagents 和 Subagent Repos 的 CRUD 操作。
//! 与 skills DAO 对称，但默认不播种任何仓库。

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::services::subagent::{InstalledSubagent, SubagentApps, SubagentRepo};
use indexmap::IndexMap;
use rusqlite::params;

impl Database {
    /// 获取所有已安装的 Subagents
    pub fn get_all_installed_subagents(
        &self,
    ) -> Result<IndexMap<String, InstalledSubagent>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, directory, repo_owner, repo_name, repo_branch,
                        readme_url, enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
                        installed_at, content_hash, updated_at
                 FROM subagents ORDER BY name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let subagent_iter = stmt
            .query_map([], |row| {
                Ok(InstalledSubagent {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    directory: row.get(3)?,
                    repo_owner: row.get(4)?,
                    repo_name: row.get(5)?,
                    repo_branch: row.get(6)?,
                    readme_url: row.get(7)?,
                    apps: SubagentApps {
                        claude_code: row.get(8)?,
                        codex: row.get(9)?,
                        gemini_cli: row.get(10)?,
                        opencode: row.get(11)?,
                    },
                    installed_at: row.get(12)?,
                    content_hash: row.get(13)?,
                    updated_at: row.get::<_, i64>(14).unwrap_or(0),
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut subagents = IndexMap::new();
        for subagent_res in subagent_iter {
            let subagent = subagent_res.map_err(|e| AppError::Database(e.to_string()))?;
            subagents.insert(subagent.id.clone(), subagent);
        }
        Ok(subagents)
    }

    /// 获取单个已安装的 Subagent
    pub fn get_installed_subagent(&self, id: &str) -> Result<Option<InstalledSubagent>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, directory, repo_owner, repo_name, repo_branch,
                        readme_url, enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
                        installed_at, content_hash, updated_at
                 FROM subagents WHERE id = ?1",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let result = stmt.query_row([id], |row| {
            Ok(InstalledSubagent {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                directory: row.get(3)?,
                repo_owner: row.get(4)?,
                repo_name: row.get(5)?,
                repo_branch: row.get(6)?,
                readme_url: row.get(7)?,
                apps: SubagentApps {
                    claude_code: row.get(8)?,
                    codex: row.get(9)?,
                    gemini_cli: row.get(10)?,
                    opencode: row.get(11)?,
                },
                installed_at: row.get(12)?,
                content_hash: row.get(13)?,
                updated_at: row.get::<_, i64>(14).unwrap_or(0),
            })
        });

        match result {
            Ok(subagent) => Ok(Some(subagent)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    /// 保存 Subagent（添加或更新）
    pub fn save_subagent(&self, subagent: &InstalledSubagent) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO subagents
             (id, name, description, directory, repo_owner, repo_name, repo_branch,
              readme_url, enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
              installed_at, content_hash, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                subagent.id,
                subagent.name,
                subagent.description,
                subagent.directory,
                subagent.repo_owner,
                subagent.repo_name,
                subagent.repo_branch,
                subagent.readme_url,
                subagent.apps.claude_code,
                subagent.apps.codex,
                subagent.apps.gemini_cli,
                subagent.apps.opencode,
                subagent.installed_at,
                subagent.content_hash,
                subagent.updated_at,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 仅更新已安装 Subagent 的元数据，不修改各 Agent 的启用状态。
    pub fn update_subagent_metadata(&self, subagent: &InstalledSubagent) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE subagents
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
                 WHERE id = ?11 AND installed_at = ?12",
                params![
                    subagent.name,
                    subagent.description,
                    subagent.directory,
                    subagent.repo_owner,
                    subagent.repo_name,
                    subagent.repo_branch,
                    subagent.readme_url,
                    subagent.installed_at,
                    subagent.content_hash,
                    subagent.updated_at,
                    subagent.id,
                    subagent.installed_at,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 删除 Subagent
    pub fn delete_subagent(&self, id: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute("DELETE FROM subagents WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 清空所有 Subagents（用于迁移）
    pub fn clear_subagents(&self) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute("DELETE FROM subagents", [])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 更新 Subagent 的 Agent 启用状态
    pub fn update_subagent_apps(&self, id: &str, apps: &SubagentApps) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE subagents SET enabled_claude_code = ?1, enabled_codex = ?2, enabled_gemini_cli = ?3, enabled_opencode = ?4 WHERE id = ?5",
                params![apps.claude_code, apps.codex, apps.gemini_cli, apps.opencode, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 更新 Subagent 的内容哈希和更新时间
    pub fn update_subagent_hash(
        &self,
        id: &str,
        content_hash: &str,
        updated_at: i64,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE subagents SET content_hash = ?1, updated_at = ?2 WHERE id = ?3",
                params![content_hash, updated_at, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 获取所有 Subagent 仓库
    pub fn get_subagent_repos(&self) -> Result<Vec<SubagentRepo>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT owner, name, branch, enabled FROM subagent_repos ORDER BY owner ASC, name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let repo_iter = stmt
            .query_map([], |row| {
                Ok(SubagentRepo {
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

    /// 保存 Subagent 仓库
    pub fn save_subagent_repo(&self, repo: &SubagentRepo) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO subagent_repos (owner, name, branch, enabled) VALUES (?1, ?2, ?3, ?4)",
            params![repo.owner, repo.name, repo.branch, repo.enabled],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 删除 Subagent 仓库
    pub fn delete_subagent_repo(&self, owner: &str, name: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM subagent_repos WHERE owner = ?1 AND name = ?2",
            params![owner, name],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::skill::AgentType;

    fn subagent(id: &str, name: &str, apps: SubagentApps) -> InstalledSubagent {
        InstalledSubagent {
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
        }
    }

    #[test]
    fn update_subagent_metadata_preserves_enabled_apps() {
        let db = Database::memory().expect("memory db");
        let installed_apps = SubagentApps::only(&AgentType::Codex);
        let original = subagent("owner/repo:subagent", "original", installed_apps.clone());
        db.save_subagent(&original).expect("seed subagent");

        let mut candidate = subagent(
            &original.id,
            "updated",
            SubagentApps::only(&AgentType::ClaudeCode),
        );
        candidate.repo_branch = Some("next".to_string());
        candidate.updated_at = 42;

        assert!(db
            .update_subagent_metadata(&candidate)
            .expect("update metadata"));

        let stored = db
            .get_installed_subagent(&original.id)
            .expect("query subagent")
            .expect("subagent remains installed");
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
    fn subagent_repo_crud() {
        let db = Database::memory().expect("memory db");
        let repo = SubagentRepo {
            owner: "owner".to_string(),
            name: "repo".to_string(),
            branch: "main".to_string(),
            enabled: true,
        };
        db.save_subagent_repo(&repo).expect("save repo");

        let repos = db.get_subagent_repos().expect("list repos");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].owner, "owner");

        db.delete_subagent_repo("owner", "repo")
            .expect("delete repo");
        assert!(db.get_subagent_repos().expect("list").is_empty());
    }

    #[test]
    fn update_subagent_apps_and_hash() {
        let db = Database::memory().expect("memory db");
        let sub = subagent("owner/repo:sa", "sa", SubagentApps::default());
        db.save_subagent(&sub).expect("seed");

        let apps = SubagentApps::only(&AgentType::OpenCode);
        assert!(db
            .update_subagent_apps(&sub.id, &apps)
            .expect("update apps"));

        assert!(db
            .update_subagent_hash(&sub.id, "new-hash", 42)
            .expect("update hash"));

        let stored = db.get_installed_subagent(&sub.id).expect("query").unwrap();
        assert!(stored.apps.opencode);
        assert!(!stored.apps.claude_code);
        assert_eq!(stored.content_hash, Some("new-hash".to_string()));
        assert_eq!(stored.updated_at, 42);
    }
}
