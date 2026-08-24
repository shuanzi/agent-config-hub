#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use crate::error::AppError;

/// Environment variable used to override the home directory in tests.
pub const ACM_HOME_ENV: &str = "ACM_HOME";

/// Returns the home directory, honoring the `ACM_HOME` override for test isolation.
///
/// On Windows prefer `dirs::home_dir()` because it uses the official profile path,
/// but the override takes precedence in both dev and CI.
pub fn get_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var(ACM_HOME_ENV) {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    dirs::home_dir().unwrap_or_else(|| {
        log::warn!("无法获取用户主目录，回退到当前目录");
        PathBuf::from(".")
    })
}

/// Returns the application hub directory (`~/.agent-config-manager/`).
pub fn get_hub_dir() -> PathBuf {
    get_home_dir().join(".agent-config-manager")
}

/// Returns the path to the SQLite database file.
pub fn get_db_path() -> PathBuf {
    get_hub_dir().join("acm.db")
}

/// Returns the SSOT skills directory inside the hub.
pub fn get_hub_skills_dir() -> PathBuf {
    get_hub_dir().join("skills")
}

/// Returns the SSOT subagents directory inside the hub.
pub fn get_hub_subagents_dir() -> PathBuf {
    get_hub_dir().join("subagents")
}

/// Returns the skill backups directory inside the hub.
pub fn get_hub_skill_backups_dir() -> PathBuf {
    get_hub_dir().join("skill-backups")
}

/// Returns the subagent backups directory inside the hub.
pub fn get_hub_subagent_backups_dir() -> PathBuf {
    get_hub_dir().join("subagent-backups")
}

// --- Claude Code ---

pub fn get_claude_config_dir() -> PathBuf {
    crate::settings::get_claude_override_dir().unwrap_or_else(|| get_home_dir().join(".claude"))
}

pub fn get_claude_skills_dir() -> PathBuf {
    get_claude_config_dir().join("skills")
}

/// Claude Code subagents live under `~/.claude/agents/`.
/// See: https://github.com/CodeWithBehnam/cc-docs/blob/main/claude-code-docs/sub-agents.md
pub fn get_claude_agents_dir() -> PathBuf {
    get_claude_config_dir().join("agents")
}

pub fn get_claude_prompt_file() -> PathBuf {
    get_claude_config_dir().join("CLAUDE.md")
}

// --- Codex ---

pub fn get_codex_config_dir() -> PathBuf {
    crate::settings::get_codex_override_dir().unwrap_or_else(|| get_home_dir().join(".codex"))
}

pub fn get_codex_skills_dir() -> PathBuf {
    get_codex_config_dir().join("skills")
}

/// Codex CLI custom subagents live under `~/.codex/agents/`.
/// See: https://codex-best-practices-d67bea.pages.oit.duke.edu/latex/duke-codex-best-practices-april-2026.pdf
pub fn get_codex_agents_dir() -> PathBuf {
    get_codex_config_dir().join("agents")
}

pub fn get_codex_prompt_file() -> PathBuf {
    get_codex_config_dir().join("AGENTS.md")
}

// --- Gemini CLI ---

pub fn get_gemini_config_dir() -> PathBuf {
    crate::settings::get_gemini_override_dir().unwrap_or_else(|| get_home_dir().join(".gemini"))
}

pub fn get_gemini_skills_dir() -> PathBuf {
    get_gemini_config_dir().join("skills")
}

/// Gemini CLI custom subagents live under `~/.gemini/agents/`.
/// See: https://geminicli.com/docs/core/subagents/
pub fn get_gemini_agents_dir() -> PathBuf {
    get_gemini_config_dir().join("agents")
}

pub fn get_gemini_prompt_file() -> PathBuf {
    get_gemini_config_dir().join("GEMINI.md")
}

// --- OpenCode ---
/// OpenCode config directory. Custom subagents live under `<config>/agents/`.
pub fn get_opencode_config_dir() -> PathBuf {
    crate::settings::get_opencode_override_dir()
        .unwrap_or_else(|| get_home_dir().join(".config").join("opencode"))
}

pub fn get_opencode_skills_dir() -> PathBuf {
    get_opencode_config_dir().join("skills")
}

/// OpenCode custom subagents live under `~/.config/opencode/agents/` (global) or
/// `.opencode/agents/` (project-level). We project to the global location.
/// See: https://opencode.ai/docs/agents/
pub fn get_opencode_agents_dir() -> PathBuf {
    get_opencode_config_dir().join("agents")
}

pub fn get_opencode_prompt_file() -> PathBuf {
    get_opencode_config_dir().join("AGENTS.md")
}

// --- Path helpers ---

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn comparable_path_key(path: &Path) -> String {
    let mut key = normalize_path_lexically(path).to_string_lossy().to_string();

    #[cfg(windows)]
    {
        key = key.replace('\\', "/");
    }

    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }

    #[cfg(windows)]
    {
        key.make_ascii_lowercase();
    }

    key
}

/// Returns true when `path` is lexically contained within `base`.
///
/// Both paths are normalized lexically (without hitting the filesystem), so
/// this works for non-existent paths. It is **not** a symlink defense: a
/// symlink inside `base` can still lead a resolved path outside it.
/// On Windows the comparison is case-insensitive.
pub fn path_is_within(base: &Path, path: &Path) -> bool {
    let base_key = comparable_path_key(base);
    let path_key = comparable_path_key(path);

    if path_key == base_key {
        return true;
    }

    let prefix = format!("{base_key}/");
    path_key.starts_with(&prefix)
}

// --- File I/O helpers ---

/// Reads and deserializes a JSON file.
pub fn read_json_file<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T, AppError> {
    if !path.exists() {
        return Err(AppError::Config(format!("文件不存在: {}", path.display())));
    }

    let content = fs::read_to_string(path).map_err(|e| AppError::io(path, e))?;
    serde_json::from_str(&content).map_err(|e| AppError::json(path, e))
}

/// Recursively sorts JSON object keys so serialization is deterministic.
fn sort_json_keys(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted_map = Map::new();
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted_map.insert(key.clone(), sort_json_keys(&map[key]));
            }
            Value::Object(sorted_map)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_json_keys).collect()),
        other => other.clone(),
    }
}

/// Writes a JSON file with sorted keys atomically.
pub fn write_json_file<T: Serialize>(path: &Path, data: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let value = serde_json::to_value(data).map_err(|e| AppError::JsonSerialize { source: e })?;
    let sorted_value = sort_json_keys(&value);
    let json = serde_json::to_string_pretty(&sorted_value)
        .map_err(|e| AppError::JsonSerialize { source: e })?;

    atomic_write(path, json.as_bytes())
}

/// Atomically writes a text file.
pub fn write_text_file(path: &Path, data: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }
    atomic_write(path, data.as_bytes())
}

/// Atomically writes bytes by creating a temporary file and renaming it into place.
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), AppError> {
    atomic_write_with_unix_mode(path, data, None)
}

/// Atomically writes bytes with a private Unix mode (0600).
pub fn atomic_write_private(path: &Path, data: &[u8]) -> Result<(), AppError> {
    atomic_write_with_unix_mode(path, data, Some(0o600))
}

fn atomic_write_with_unix_mode(
    path: &Path,
    data: &[u8],
    unix_mode: Option<u32>,
) -> Result<(), AppError> {
    #[cfg(not(unix))]
    let _ = unix_mode;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("无效的路径".to_string()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Config("无效的文件名".to_string()))?
        .to_string_lossy()
        .to_string();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let (tmp, mut file) = (|| -> Result<(PathBuf, fs::File), AppError> {
        let mut last_collision = None;
        for _ in 0..16 {
            let counter = TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let candidate = parent.join(format!(
                "{file_name}.tmp.{}.{ts}.{counter}",
                std::process::id()
            ));
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            if let Some(mode) = unix_mode {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(mode);
            }
            match options.open(&candidate) {
                Ok(file) => return Ok((candidate, file)),
                Err(source) if source.kind() == std::io::ErrorKind::AlreadyExists => {
                    last_collision = Some((candidate, source));
                }
                Err(source) => return Err(AppError::io(&candidate, source)),
            }
        }

        let (candidate, source) = last_collision.expect("temporary filename loop must run");
        Err(AppError::io(&candidate, source))
    })()?;

    if let Err(source) = file.write_all(data).and_then(|_| file.flush()) {
        drop(file);
        let _ = fs::remove_file(&tmp);
        return Err(AppError::io(&tmp, source));
    }
    drop(file);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(mode) = unix_mode {
            if let Err(source) = fs::set_permissions(&tmp, fs::Permissions::from_mode(mode)) {
                let _ = fs::remove_file(&tmp);
                return Err(AppError::io(&tmp, source));
            }
        } else if let Ok(meta) = fs::metadata(path) {
            let perm = meta.permissions().mode();
            let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(perm));
        }
    }

    if let Err(source) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(AppError::IoContext {
            context: format!("原子替换失败: {} -> {}", tmp.display(), path.display()),
            source,
        });
    }

    Ok(())
}

/// Copies a file from one path to another.
pub fn copy_file(from: &Path, to: &Path) -> Result<(), AppError> {
    fs::copy(from, to).map_err(|e| AppError::IoContext {
        context: format!("复制文件失败 ({} -> {})", from.display(), to.display()),
        source: e,
    })?;
    Ok(())
}

/// Deletes a file if it exists.
pub fn delete_file(path: &Path) -> Result<(), AppError> {
    if path.exists() {
        fs::remove_file(path).map_err(|e| AppError::io(path, e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("atomic-write.json");
        fs::write(&path, b"old contents").unwrap();

        atomic_write(&path, b"new contents").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new contents");
        let tmp_prefix = "atomic-write.json.tmp.";
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(tmp_prefix))
            .map(|entry| entry.path())
            .collect();
        assert!(
            leftovers.is_empty(),
            "temporary files remain: {leftovers:?}"
        );
    }

    #[test]
    fn sort_json_keys_sorts_top_level_object() {
        let input = serde_json::json!({"z": 1, "a": 2, "m": 3});
        let sorted = sort_json_keys(&input);
        assert_eq!(
            serde_json::to_string(&sorted).unwrap(),
            r#"{"a":2,"m":3,"z":1}"#
        );
    }

    #[test]
    fn path_is_within_works_for_lexical_containment() {
        let base = PathBuf::from("/home/user/.agent-config-manager");
        assert!(path_is_within(&base, &base.join("skills/foo")));
        assert!(path_is_within(&base, &base));
        assert!(!path_is_within(
            &base,
            &PathBuf::from("/home/user/.agent-config")
        ));
    }

    #[test]
    #[serial_test::serial]
    fn get_hub_dir_uses_acm_home_override() {
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var(ACM_HOME_ENV, tmp.path().as_os_str());
        assert_eq!(get_hub_dir(), tmp.path().join(".agent-config-manager"));
        std::env::remove_var(ACM_HOME_ENV);
    }
}
