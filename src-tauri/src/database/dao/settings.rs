use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;

impl Database {
    /// Returns the value for a settings key, or None if missing.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT value FROM settings WHERE key = ?1")
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut rows = stmt
            .query(params![key])
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            Ok(Some(
                row.get(0).map_err(|e| AppError::Database(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    /// Sets a settings key to the given string value.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// Reads a boolean flag stored in settings.
    ///
    /// Returns true only when the stored value is `"true"` or `"1"`.
    pub fn get_bool_flag(&self, key: &str) -> Result<bool, AppError> {
        Ok(matches!(
            self.get_setting(key)?.as_deref(),
            Some("true") | Some("1")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_setting() {
        let db = Database::memory().unwrap();
        db.set_setting("foo", "bar").unwrap();
        assert_eq!(db.get_setting("foo").unwrap(), Some("bar".to_string()));
    }

    #[test]
    fn bool_flag_recognizes_true_and_one() {
        let db = Database::memory().unwrap();
        db.set_setting("flag", "true").unwrap();
        assert!(db.get_bool_flag("flag").unwrap());
        db.set_setting("flag", "1").unwrap();
        assert!(db.get_bool_flag("flag").unwrap());
        db.set_setting("flag", "false").unwrap();
        assert!(!db.get_bool_flag("flag").unwrap());
    }
}
