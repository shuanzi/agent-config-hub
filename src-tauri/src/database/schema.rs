use rusqlite::Connection;

use crate::database::{lock_conn, Database, SCHEMA_VERSION};
use crate::error::AppError;

impl Database {
    pub(crate) fn create_tables(&self) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        Self::create_tables_on_conn(&conn)
    }

    pub(crate) fn create_tables_on_conn(conn: &Connection) -> Result<(), AppError> {
        // Skills: SSOT records for reusable agent capabilities.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                directory TEXT NOT NULL,
                repo_owner TEXT,
                repo_name TEXT,
                repo_branch TEXT NOT NULL DEFAULT 'main',
                readme_url TEXT,
                enabled_claude_code BOOLEAN NOT NULL DEFAULT 0,
                enabled_codex BOOLEAN NOT NULL DEFAULT 0,
                enabled_gemini_cli BOOLEAN NOT NULL DEFAULT 0,
                enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
                installed_at INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                updated_at INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // Skill repos: GitHub repositories that can be scanned for discoverable skills.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS skill_repos (
                owner TEXT NOT NULL,
                name TEXT NOT NULL,
                branch TEXT NOT NULL DEFAULT 'main',
                enabled BOOLEAN NOT NULL DEFAULT 1,
                PRIMARY KEY (owner, name)
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // Prompts (long-running instructions): keyed by (id, app_type).
        conn.execute(
            "CREATE TABLE IF NOT EXISTS prompts (
                id TEXT NOT NULL,
                app_type TEXT NOT NULL,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                description TEXT,
                enabled BOOLEAN NOT NULL DEFAULT 1,
                created_at INTEGER,
                updated_at INTEGER,
                PRIMARY KEY (id, app_type)
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // Subagents: SSOT records for agent subagents.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS subagents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                directory TEXT NOT NULL,
                repo_owner TEXT,
                repo_name TEXT,
                repo_branch TEXT NOT NULL DEFAULT 'main',
                readme_url TEXT,
                enabled_claude_code BOOLEAN NOT NULL DEFAULT 0,
                enabled_codex BOOLEAN NOT NULL DEFAULT 0,
                enabled_gemini_cli BOOLEAN NOT NULL DEFAULT 0,
                enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
                installed_at INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                updated_at INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // Subagent repos: GitHub repositories scanned for discoverable subagents.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS subagent_repos (
                owner TEXT NOT NULL,
                name TEXT NOT NULL,
                branch TEXT NOT NULL DEFAULT 'main',
                enabled BOOLEAN NOT NULL DEFAULT 1,
                PRIMARY KEY (owner, name)
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // Settings: generic key-value store.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    pub(crate) fn apply_schema_migrations(&self) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        Self::apply_schema_migrations_on_conn(&conn)
    }

    pub(crate) fn apply_schema_migrations_on_conn(conn: &Connection) -> Result<(), AppError> {
        conn.execute("SAVEPOINT schema_migration;", [])
            .map_err(|e| AppError::Database(format!("开启迁移 savepoint 失败: {e}")))?;

        let mut version = Self::get_user_version(conn)?;

        if version > SCHEMA_VERSION {
            conn.execute("ROLLBACK TO schema_migration;", []).ok();
            conn.execute("RELEASE schema_migration;", []).ok();
            return Err(AppError::Database(format!(
                "数据库版本过新（{version}），当前应用仅支持 {SCHEMA_VERSION}，请升级应用后再尝试。"
            )));
        }

        let result = (|| {
            while version < SCHEMA_VERSION {
                match version {
                    0 => {
                        // Initial schema is created by create_tables_on_conn.
                        Self::set_user_version(conn, 1)?;
                    }
                    1 => {
                        Self::migrate_v1_to_v2(conn)?;
                        Self::set_user_version(conn, 2)?;
                    }
                    _ => {
                        return Err(AppError::Database(format!(
                            "未知的数据库版本 {version}，无法迁移到 {SCHEMA_VERSION}"
                        )));
                    }
                }
                version = Self::get_user_version(conn)?;
            }
            Ok(())
        })();

        match result {
            Ok(_) => {
                conn.execute("RELEASE schema_migration;", [])
                    .map_err(|e| AppError::Database(format!("提交迁移 savepoint 失败: {e}")))?;
                Ok(())
            }
            Err(e) => {
                conn.execute("ROLLBACK TO schema_migration;", []).ok();
                conn.execute("RELEASE schema_migration;", []).ok();
                Err(e)
            }
        }
    }

    /// v2 增加显式项目 registry，并将 Skills、Subagents 从旧的全局主键扩展为完整 target 身份。
    ///
    /// 调用方已在 schema_migration savepoint 中；任何 DDL 或复制失败都会由外层回滚。
    fn migrate_v1_to_v2(conn: &Connection) -> Result<(), AppError> {
        conn.execute(
            "CREATE TABLE projects (
                project_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                root_path TEXT NOT NULL UNIQUE
            )",
            [],
        )
        .map_err(|e| AppError::Database(format!("创建 projects 表失败: {e}")))?;

        conn.execute_batch(
            "
            ALTER TABLE skills RENAME TO skills_v1;
            CREATE TABLE skills (
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                directory TEXT NOT NULL,
                repo_owner TEXT,
                repo_name TEXT,
                repo_branch TEXT NOT NULL DEFAULT 'main',
                readme_url TEXT,
                enabled_claude_code BOOLEAN NOT NULL DEFAULT 0,
                enabled_codex BOOLEAN NOT NULL DEFAULT 0,
                enabled_gemini_cli BOOLEAN NOT NULL DEFAULT 0,
                enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
                installed_at INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                updated_at INTEGER NOT NULL DEFAULT 0,
                scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project')),
                project_id TEXT,
                CHECK (
                    (scope = 'global' AND project_id IS NULL)
                    OR (scope = 'project' AND project_id IS NOT NULL AND length(project_id) > 0)
                ),
                FOREIGN KEY (project_id) REFERENCES projects(project_id)
            );
            INSERT INTO skills (
                id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url,
                enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
                installed_at, content_hash, updated_at, scope, project_id
            )
            SELECT
                id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url,
                enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
                installed_at, content_hash, updated_at, 'global', NULL
            FROM skills_v1;
            DROP TABLE skills_v1;
            CREATE UNIQUE INDEX skills_target_identity
                ON skills (id, scope, COALESCE(project_id, ''));

            ALTER TABLE subagents RENAME TO subagents_v1;
            CREATE TABLE subagents (
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                directory TEXT NOT NULL,
                repo_owner TEXT,
                repo_name TEXT,
                repo_branch TEXT NOT NULL DEFAULT 'main',
                readme_url TEXT,
                enabled_claude_code BOOLEAN NOT NULL DEFAULT 0,
                enabled_codex BOOLEAN NOT NULL DEFAULT 0,
                enabled_gemini_cli BOOLEAN NOT NULL DEFAULT 0,
                enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
                installed_at INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                updated_at INTEGER NOT NULL DEFAULT 0,
                scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project')),
                project_id TEXT,
                CHECK (
                    (scope = 'global' AND project_id IS NULL)
                    OR (scope = 'project' AND project_id IS NOT NULL AND length(project_id) > 0)
                ),
                FOREIGN KEY (project_id) REFERENCES projects(project_id)
            );
            INSERT INTO subagents (
                id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url,
                enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
                installed_at, content_hash, updated_at, scope, project_id
            )
            SELECT
                id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url,
                enabled_claude_code, enabled_codex, enabled_gemini_cli, enabled_opencode,
                installed_at, content_hash, updated_at, 'global', NULL
            FROM subagents_v1;
            DROP TABLE subagents_v1;
            CREATE UNIQUE INDEX subagents_target_identity
                ON subagents (id, scope, COALESCE(project_id, ''));

            ",
        )
        .map_err(|e| AppError::Database(format!("重建 v2 资产表失败: {e}")))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    #[test]
    fn tables_are_created_in_memory() {
        let db = Database::memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'skills'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn v1_migration_rebuilds_targeted_assets_and_preserves_legacy_prompts() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        Database::create_tables_on_conn(&conn).unwrap();
        Database::set_user_version(&conn, 1).unwrap();

        conn.execute(
            "INSERT INTO skills (id, name, directory) VALUES (?1, ?2, ?3)",
            params!["legacy-skill", "Legacy skill", "legacy-skill"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO subagents (id, name, directory) VALUES (?1, ?2, ?3)",
            params!["legacy-subagent", "Legacy subagent", "legacy-subagent"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO prompts (id, app_type, name, content) VALUES (?1, ?2, ?3, ?4)",
            params!["legacy-prompt", "codex", "Legacy prompt", "legacy content"],
        )
        .unwrap();

        Database::apply_schema_migrations_on_conn(&conn).unwrap();

        assert_eq!(Database::get_user_version(&conn).unwrap(), 2);
        let (scope, project_id): (String, Option<String>) = conn
            .query_row(
                "SELECT scope, project_id FROM skills WHERE id = ?1",
                ["legacy-skill"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(scope, "global");
        assert_eq!(project_id, None);

        let (subagent_scope, subagent_project_id): (String, Option<String>) = conn
            .query_row(
                "SELECT scope, project_id FROM subagents WHERE id = ?1",
                ["legacy-subagent"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(subagent_scope, "global");
        assert_eq!(subagent_project_id, None);

        let prompt_content: String = conn
            .query_row(
                "SELECT content FROM prompts WHERE id = ?1 AND app_type = ?2",
                params!["legacy-prompt", "codex"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(prompt_content, "legacy content");

        conn.execute(
            "INSERT INTO projects (project_id, display_name, root_path) VALUES (?1, ?2, ?3)",
            params!["project-a", "Same name", "/tmp/project-a"],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO subagents (id, name, directory, scope, project_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["shared-id", "Global", "shared-global", "global", Option::<String>::None],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO subagents (id, name, directory, scope, project_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["shared-id", "Project A", "shared-a", "project", "project-a"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projects (project_id, display_name, root_path) VALUES (?1, ?2, ?3)",
            params!["project-b", "Same name", "/tmp/project-b"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, directory, scope, project_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["shared-id", "Global", "shared-global", "global", Option::<String>::None],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, directory, scope, project_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["shared-id", "Project A", "shared-a", "project", "project-a"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, directory, scope, project_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["shared-id", "Project B", "shared-b", "project", "project-b"],
        )
        .unwrap();

        let shared_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE id = ?1",
                ["shared-id"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(shared_count, 3);
        let shared_subagent_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subagents WHERE id = ?1",
                ["shared-id"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(shared_subagent_count, 2);
    }

    #[test]
    fn failed_v1_migration_after_skills_rebuild_restores_v1_schema_and_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        Database::create_tables_on_conn(&conn).unwrap();
        Database::set_user_version(&conn, 1).unwrap();
        conn.execute(
            "INSERT INTO skills (id, name, directory) VALUES (?1, ?2, ?3)",
            params!["legacy-skill", "Legacy skill", "legacy-skill"],
        )
        .unwrap();

        // Keep a legal v1 index on a different surviving table. The v2 migration
        // reaches `CREATE UNIQUE INDEX skills_target_identity` only after it has
        // renamed, copied, and dropped the old skills table.
        conn.execute(
            "CREATE INDEX skills_target_identity ON skill_repos (owner)",
            [],
        )
        .unwrap();

        let error = Database::apply_schema_migrations_on_conn(&conn).unwrap_err();
        assert!(error.to_string().contains("skills_target_identity"));
        assert_eq!(Database::get_user_version(&conn).unwrap(), 1);

        let projects_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(projects_count, 0);
        let skills_v1_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'skills_v1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(skills_v1_count, 0);

        let mut table_info = conn.prepare("PRAGMA table_info(skills)").unwrap();
        let columns: Vec<(String, i64)> = table_info
            .query_map([], |row| Ok((row.get(1)?, row.get(5)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            columns
                .iter()
                .find(|(name, _)| name == "id")
                .map(|(_, primary_key)| *primary_key),
            Some(1)
        );
        assert!(columns.iter().all(|(name, _)| name != "scope"));
        assert!(columns.iter().all(|(name, _)| name != "project_id"));

        let legacy_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE id = ?1",
                ["legacy-skill"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy_count, 1);
    }
}
