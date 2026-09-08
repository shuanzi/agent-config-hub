//! Database module - SQLite persistence layer.

mod dao;
mod schema;

pub(crate) use dao::ProjectRemoval;

use std::sync::Mutex;

use rusqlite::Connection;

use crate::config::get_db_path;
use crate::error::AppError;

pub const SCHEMA_VERSION: i32 = 4;

macro_rules! lock_conn {
    ($mutex:expr) => {
        $mutex
            .lock()
            .map_err(|e| AppError::Database(format!("Mutex lock failed: {e}")))?
    };
}

pub(crate) use lock_conn;

/// Database handle wrapping a mutex-protected SQLite connection.
pub struct Database {
    pub(crate) conn: Mutex<Connection>,
}

impl Database {
    /// Opens the database at `~/.agent-config-manager/acm.db` and applies migrations.
    pub fn init() -> Result<Self, AppError> {
        let db_path = get_db_path();
        let db_exists = db_path.exists();

        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
            set_private_permissions(parent, 0o700)?;
        }

        let conn = Connection::open(&db_path).map_err(|e| AppError::Database(e.to_string()))?;
        set_private_permissions(&db_path, 0o600)?;

        conn.execute("PRAGMA foreign_keys = ON;", [])
            .map_err(|e| AppError::Database(e.to_string()))?;

        if !db_exists {
            conn.execute("PRAGMA auto_vacuum = INCREMENTAL;", [])
                .map_err(|e| AppError::Database(e.to_string()))?;
        }

        let db = Self {
            conn: Mutex::new(conn),
        };

        db.create_tables()?;
        db.apply_schema_migrations()?;

        Ok(db)
    }

    /// Creates an in-memory database for tests.
    pub fn memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory().map_err(|e| AppError::Database(e.to_string()))?;

        conn.execute("PRAGMA foreign_keys = ON;", [])
            .map_err(|e| AppError::Database(e.to_string()))?;
        conn.execute("PRAGMA auto_vacuum = INCREMENTAL;", [])
            .map_err(|e| AppError::Database(e.to_string()))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.create_tables()?;
        db.apply_schema_migrations()?;
        Ok(db)
    }

    pub(crate) fn get_user_version(conn: &Connection) -> Result<i32, AppError> {
        conn.query_row("PRAGMA user_version;", [], |row| row.get(0))
            .map_err(|e| AppError::Database(format!("读取 user_version 失败: {e}")))
    }

    pub(crate) fn set_user_version(conn: &Connection, version: i32) -> Result<(), AppError> {
        conn.execute(&format!("PRAGMA user_version = {version};"), [])
            .map_err(|e| AppError::Database(format!("设置 user_version 失败: {e}")))?;
        Ok(())
    }

    /// 在单个 SQLite 事务中执行 `f`；任一写失败即整体回滚。
    pub(crate) fn transact<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let result = f(&tx)?;
        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(result)
    }
}

#[cfg(unix)]
fn set_private_permissions(path: &std::path::Path, mode: u32) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|error| AppError::io(path, error))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &std::path::Path, _mode: u32) -> Result<(), AppError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_database_starts_at_schema_version() {
        let db = Database::memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let version = Database::get_user_version(&conn).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }
}
