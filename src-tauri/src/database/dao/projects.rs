//! 项目 registry 数据访问对象。

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::services::project::ProjectSummary;
use rusqlite::params;

pub(crate) enum ProjectRemoval {
    Missing,
    HasManagedAssets,
    Removed,
}

impl Database {
    pub fn get_project(&self, project_id: &str) -> Result<Option<ProjectSummary>, AppError> {
        let conn = lock_conn!(self.conn);
        Self::get_project_on_conn(&conn, project_id)
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut statement = conn
            .prepare(
                "SELECT project_id, display_name, root_path
                 FROM projects
                 ORDER BY display_name ASC, project_id ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = statement
            .query_map([], Self::project_summary_from_row)
            .map_err(|e| AppError::Database(e.to_string()))?;

        rows.map(|row| row.map_err(|e| AppError::Database(e.to_string())))
            .collect()
    }

    pub(crate) fn get_project_by_root_path(
        &self,
        root_path: &str,
    ) -> Result<Option<ProjectSummary>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            "SELECT project_id, display_name, root_path FROM projects WHERE root_path = ?1",
            [root_path],
            Self::project_summary_from_row,
        );
        match result {
            Ok(project) => Ok(Some(project)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(AppError::Database(error.to_string())),
        }
    }

    pub(crate) fn create_project(
        &self,
        display_name: &str,
        root_path: &str,
    ) -> Result<ProjectSummary, AppError> {
        let conn = lock_conn!(self.conn);
        let project_id: String = conn
            .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        conn.execute(
            "INSERT INTO projects (project_id, display_name, root_path) VALUES (?1, ?2, ?3)",
            params![project_id, display_name, root_path],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(ProjectSummary {
            project_id,
            display_name: display_name.to_string(),
            root_path: root_path.to_string(),
        })
    }

    pub(crate) fn update_project_root(
        &self,
        project_id: &str,
        root_path: &str,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let changed = conn
            .execute(
                "UPDATE projects SET root_path = ?1 WHERE project_id = ?2",
                params![root_path, project_id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(changed > 0)
    }

    /// 仅检查受管的 Skill／Subagent project ownership，不访问备份文件或项目 root。
    /// 旧的全局 Prompt 预设不属于项目生命周期。
    pub(crate) fn remove_project_if_empty(
        &self,
        project_id: &str,
    ) -> Result<ProjectRemoval, AppError> {
        let conn = lock_conn!(self.conn);
        if Self::get_project_on_conn(&conn, project_id)?.is_none() {
            return Ok(ProjectRemoval::Missing);
        }

        let has_managed_rows: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM skills WHERE scope = 'project' AND project_id = ?1
                    UNION ALL
                    SELECT 1 FROM subagents WHERE scope = 'project' AND project_id = ?1
                )",
                [project_id],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        if has_managed_rows {
            return Ok(ProjectRemoval::HasManagedAssets);
        }

        conn.execute("DELETE FROM projects WHERE project_id = ?1", [project_id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(ProjectRemoval::Removed)
    }

    fn get_project_on_conn(
        conn: &rusqlite::Connection,
        project_id: &str,
    ) -> Result<Option<ProjectSummary>, AppError> {
        let result = conn.query_row(
            "SELECT project_id, display_name, root_path FROM projects WHERE project_id = ?1",
            [project_id],
            Self::project_summary_from_row,
        );
        match result {
            Ok(project) => Ok(Some(project)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(AppError::Database(error.to_string())),
        }
    }

    fn project_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectSummary> {
        Ok(ProjectSummary {
            project_id: row.get(0)?,
            display_name: row.get(1)?,
            root_path: row.get(2)?,
        })
    }
}
