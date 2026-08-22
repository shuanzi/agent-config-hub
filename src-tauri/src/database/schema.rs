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
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
