#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

use crate::config::get_hub_dir;
use crate::error::AppError;

/// How skills/subagents are projected into agent config directories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SyncMethod {
    /// Prefer symlink; fall back to copy when symlink would fail.
    #[default]
    Auto,
    /// Always use symbolic links.
    Symlink,
    /// Always copy files.
    Copy,
}

/// Where the SSOT (single source of truth) directories live.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum StorageLocation {
    /// Managed inside `~/.agent-config-manager/`.
    #[default]
    Hub,
    /// Agent unified standard directory (`~/.agents/`).
    Unified,
}

/// Device-level settings persisted to `~/.agent-config-manager/settings.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Skill/subagent projection method.
    #[serde(default)]
    pub sync_method: SyncMethod,
    /// SSOT storage location.
    #[serde(default)]
    pub storage_location: StorageLocation,
    /// Per-agent config directory overrides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_code_config_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_config_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gemini_cli_config_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opencode_config_dir: Option<String>,
}

impl AppSettings {
    fn settings_path() -> PathBuf {
        get_hub_dir().join("settings.json")
    }

    fn normalize_paths(&mut self) {
        for field in [
            &mut self.claude_code_config_dir,
            &mut self.codex_config_dir,
            &mut self.gemini_cli_config_dir,
            &mut self.opencode_config_dir,
        ] {
            *field = field
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
    }

    fn load_from_file() -> Self {
        let path = Self::settings_path();
        if let Ok(content) = fs::read_to_string(&path) {
            match serde_json::from_str::<AppSettings>(&content) {
                Ok(mut settings) => {
                    settings.normalize_paths();
                    settings
                }
                Err(err) => {
                    log::warn!(
                        "解析设置文件失败，将使用默认设置。路径: {}, 错误: {}",
                        path.display(),
                        err
                    );
                    Self::default()
                }
            }
        } else {
            Self::default()
        }
    }
}

fn save_settings_file(settings: &AppSettings) -> Result<(), AppError> {
    let mut normalized = settings.clone();
    normalized.normalize_paths();
    let path = AppSettings::settings_path();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| AppError::JsonSerialize { source: e })?;

    // 原子写（临时文件 + rename，Unix 上 0600）：写入中断或失败时
    // 磁盘上的 settings.json 不会被截断成空/残缺文件。
    crate::config::atomic_write_private(&path, json.as_bytes())
}

static SETTINGS_STORE: OnceLock<RwLock<AppSettings>> = OnceLock::new();

fn settings_store() -> &'static RwLock<AppSettings> {
    SETTINGS_STORE.get_or_init(|| RwLock::new(AppSettings::load_from_file()))
}

/// Expands a leading `~` to the current home directory.
pub fn resolve_override_path(raw: impl AsRef<str>) -> PathBuf {
    let raw = raw.as_ref();
    let join_home = |home: PathBuf, suffix: &str| {
        suffix
            .split(['/', '\\'])
            .filter(|component| !component.is_empty())
            .fold(home, |path, component| path.join(component))
    };

    if raw == "~" {
        return crate::config::get_home_dir();
    }

    if let Some(stripped) = raw.strip_prefix("~/") {
        return join_home(crate::config::get_home_dir(), stripped);
    }

    if let Some(stripped) = raw.strip_prefix("~\\") {
        return join_home(crate::config::get_home_dir(), stripped);
    }

    PathBuf::from(raw)
}

pub fn get_settings() -> AppSettings {
    settings_store()
        .read()
        .unwrap_or_else(|e| {
            log::warn!("设置锁已毒化，使用恢复值: {e}");
            e.into_inner()
        })
        .clone()
}

pub fn update_settings(mut new_settings: AppSettings) -> Result<(), AppError> {
    new_settings.normalize_paths();
    save_settings_file(&new_settings)?;

    let mut guard = settings_store().write().unwrap_or_else(|e| {
        log::warn!("设置锁已毒化，使用恢复值: {e}");
        e.into_inner()
    });
    *guard = new_settings;
    Ok(())
}

fn mutate_settings<F>(mutator: F) -> Result<(), AppError>
where
    F: FnOnce(&mut AppSettings),
{
    let mut guard = settings_store().write().unwrap_or_else(|e| {
        log::warn!("设置锁已毒化，使用恢复值: {e}");
        e.into_inner()
    });
    let mut next = guard.clone();
    mutator(&mut next);
    next.normalize_paths();
    save_settings_file(&next)?;
    *guard = next;
    Ok(())
}

pub fn set_sync_method(method: SyncMethod) -> Result<(), AppError> {
    mutate_settings(|settings| settings.sync_method = method)
}

pub fn set_storage_location(location: StorageLocation) -> Result<(), AppError> {
    mutate_settings(|settings| settings.storage_location = location)
}

/// 更新单个 Agent 的配置目录覆盖（`app` 为 `AgentType::as_str()` 标识）。
pub fn set_agent_config_dir_override(app: &str, dir: Option<String>) -> Result<(), AppError> {
    match app {
        "claude-code" | "codex" | "gemini-cli" | "opencode" => {}
        other => {
            return Err(AppError::InvalidInput(format!(
                "不支持的 Agent 标识: '{other}'。可选值: claude-code, codex, gemini-cli, opencode。"
            )))
        }
    }
    mutate_settings(|settings| {
        let slot = match app {
            "claude-code" => &mut settings.claude_code_config_dir,
            "codex" => &mut settings.codex_config_dir,
            "gemini-cli" => &mut settings.gemini_cli_config_dir,
            _ => &mut settings.opencode_config_dir,
        };
        *slot = dir;
    })
}

pub fn get_claude_override_dir() -> Option<PathBuf> {
    settings_store()
        .read()
        .ok()?
        .claude_code_config_dir
        .as_ref()
        .map(resolve_override_path)
}

pub fn get_codex_override_dir() -> Option<PathBuf> {
    settings_store()
        .read()
        .ok()?
        .codex_config_dir
        .as_ref()
        .map(resolve_override_path)
}

pub fn get_gemini_override_dir() -> Option<PathBuf> {
    settings_store()
        .read()
        .ok()?
        .gemini_cli_config_dir
        .as_ref()
        .map(resolve_override_path)
}

pub fn get_opencode_override_dir() -> Option<PathBuf> {
    settings_store()
        .read()
        .ok()?
        .opencode_config_dir
        .as_ref()
        .map(resolve_override_path)
}

/// Returns true if a directory override is configured for any agent.
pub fn has_any_override_dir() -> bool {
    get_settings()
        .claude_code_config_dir
        .as_ref()
        .or(get_settings().codex_config_dir.as_ref())
        .or(get_settings().gemini_cli_config_dir.as_ref())
        .or(get_settings().opencode_config_dir.as_ref())
        .is_some()
}

/// 测试用：强制从当前 `ACM_HOME` 重新加载设置缓存。
///
/// 由于 `SETTINGS_STORE` 是 `OnceLock`，测试间若共享同一份缓存会导致
/// `get_home_dir()` 与 `get_*_config_dir()` 使用不同 HOME 的问题。
#[cfg(test)]
pub fn reset_settings_store_for_test() {
    let fresh = AppSettings::load_from_file();
    if let Some(store) = SETTINGS_STORE.get() {
        if let Ok(mut guard) = store.write() {
            *guard = fresh;
            return;
        }
    }
    let _ = SETTINGS_STORE.set(RwLock::new(fresh));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[test]
    #[serial]
    fn resolve_override_path_expands_tilde() {
        let home = crate::config::get_home_dir();
        assert_eq!(resolve_override_path("~/foo"), home.join("foo"));
    }

    #[test]
    fn resolve_override_path_preserves_absolute() {
        assert_eq!(
            resolve_override_path("/tmp/custom"),
            PathBuf::from("/tmp/custom")
        );
    }

    #[test]
    #[serial]
    fn settings_roundtrip_uses_hub_dir() {
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var(crate::config::ACM_HOME_ENV, tmp.path().as_os_str());
        // Reset the cached store so the next load uses the temp home.
        let _ = SETTINGS_STORE.set(RwLock::new(AppSettings::load_from_file()));

        let settings = AppSettings {
            sync_method: SyncMethod::Copy,
            claude_code_config_dir: Some("/tmp/claude".to_string()),
            ..Default::default()
        };
        update_settings(settings.clone()).unwrap();

        let loaded = get_settings();
        assert_eq!(loaded.sync_method, SyncMethod::Copy);
        assert_eq!(
            loaded.claude_code_config_dir,
            Some("/tmp/claude".to_string())
        );

        std::env::remove_var(crate::config::ACM_HOME_ENV);
        // Reset the cached store so later tests load from the real home directory.
        let _ = SETTINGS_STORE.set(RwLock::new(AppSettings::load_from_file()));
    }

    #[test]
    #[serial]
    fn save_settings_is_atomic_and_keeps_file_intact_on_write_failure() {
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var(crate::config::ACM_HOME_ENV, tmp.path().as_os_str());
        reset_settings_store_for_test();

        // 初始保存成功，settings.json 内容完整
        update_settings(AppSettings {
            sync_method: SyncMethod::Copy,
            ..Default::default()
        })
        .unwrap();
        let path = AppSettings::settings_path();
        let original = fs::read_to_string(&path).unwrap();

        // 故障注入：hub 目录只读，原子写的临时文件创建必然失败
        let hub = crate::config::get_hub_dir();
        let mut permissions = fs::metadata(&hub).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&hub, permissions).unwrap();

        let result = update_settings(AppSettings {
            sync_method: SyncMethod::Symlink,
            ..Default::default()
        });
        assert!(result.is_err(), "unwritable hub dir must fail the save");

        // 磁盘上的 settings.json 未被截断，内容保持完整
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        // 内存中的设置也未变更
        assert_eq!(get_settings().sync_method, SyncMethod::Copy);

        // 失败路径不留下临时文件
        let leftovers: Vec<_> = fs::read_dir(&hub)
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
            .map(|entry| entry.path())
            .collect();
        assert!(
            leftovers.is_empty(),
            "temporary files remain: {leftovers:?}"
        );

        // 恢复写权限以便临时目录清理
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&hub).unwrap().permissions();
            permissions.set_mode(permissions.mode() | 0o200);
            let _ = fs::set_permissions(&hub, permissions);
        }
        #[cfg(not(unix))]
        {
            let mut permissions = fs::metadata(&hub).unwrap().permissions();
            permissions.set_readonly(false);
            let _ = fs::set_permissions(&hub, permissions);
        }
        std::env::remove_var(crate::config::ACM_HOME_ENV);
        reset_settings_store_for_test();
    }
}
