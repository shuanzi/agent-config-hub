//! Project policy adapters. They never remove global Skill projections.
use super::{
    jsonc_document::{self as jsonc, Node},
    project::{ProjectService, ScopeTarget},
    skill::InstalledSkill,
    skill_placement::SkillLocation,
};
use crate::{config, database::Database, error::AppError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

pub(crate) struct PolicyState {
    pub excluded: bool,
    pub revision: Value,
    pub reason: Option<String>,
    pub notice: Option<String>,
}
fn conflict(message: impl Into<String>) -> AppError {
    AppError::Conflict(message.into())
}
pub(crate) fn read(path: &Path) -> Result<Option<String>, AppError> {
    super::skill_matrix::safe_path(path)?;
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::io(path, error)),
    }
}
pub(crate) fn write(path: &Path, original: Option<&str>, text: &str) -> Result<(), AppError> {
    super::skill_matrix::safe_path(path)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|error| AppError::io(path, error))?;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap())
        .map_err(|error| AppError::io(path, error))?;
    temp.write_all(text.as_bytes())
        .map_err(|error| AppError::io(path, error))?;
    if let Ok(metadata) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(metadata.permissions())
            .map_err(|error| AppError::io(path, error))?;
    }
    if read(path)?.as_deref() != original {
        return Err(conflict("原生配置在写入前被外部修改，本次没有覆盖。"));
    }
    temp.persist(path)
        .map_err(|error| AppError::io(path, error.error))?;
    Ok(())
}
pub(crate) fn codex_project_path(
    db: &Arc<Database>,
    target: &ScopeTarget,
) -> Result<PathBuf, AppError> {
    let root = ProjectService::resolve_scope_target(db, target)?
        .project_root
        .ok_or_else(|| conflict("Codex 项目启动规则只支持项目目标。"))?;
    Ok(root.join(".codex/acm-skills.json"))
}
pub(crate) fn codex_ids(path: &Path) -> Result<Vec<String>, AppError> {
    let Some(text) = read(path)? else {
        return Ok(vec![]);
    };
    let value = serde_json::from_str::<Value>(&text)
        .map_err(|_| conflict("Codex 项目排除文件不是有效 JSON。"))?;
    if value.get("version") != Some(&json!(1)) {
        return Err(conflict("Codex 项目排除文件版本无法识别。"));
    }
    let ids = value
        .get("excludedSkillIds")
        .and_then(Value::as_array)
        .ok_or_else(|| conflict("excludedSkillIds 必须是字符串数组。"))?;
    ids.iter()
        .map(|id| {
            id.as_str()
                .filter(|id| !id.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| conflict("excludedSkillIds 含有无效身份。"))
        })
        .collect()
}
pub(crate) fn codex_user_rules(
    name: &str,
    paths: &[PathBuf],
) -> Result<(Vec<bool>, Value), AppError> {
    let path = config::get_codex_config_dir().join("config.toml");
    let Some(text) = read(&path)? else {
        return Ok((vec![true; paths.len()], json!([])));
    };
    let value: toml::Value = toml::from_str(&text)
        .map_err(|_| conflict("Codex 用户配置不是有效 TOML，请先在原生配置中修复。"))?;
    let Some(skills) = value.get("skills") else {
        return Ok((vec![true; paths.len()], json!([])));
    };
    if !skills.is_table() {
        return Err(conflict("Codex skills 配置结构无法识别。"));
    }
    let Some(entries) = skills.get("config") else {
        return Ok((vec![true; paths.len()], json!([])));
    };
    let entries = entries
        .as_array()
        .ok_or_else(|| conflict("Codex skills.config 必须是数组。"))?;
    let mut enabled = vec![true; paths.len()];
    let mut relevant = vec![];
    for entry in entries {
        let enabled_rule = entry
            .get("enabled")
            .and_then(toml::Value::as_bool)
            .ok_or_else(|| conflict("Codex Skill 开关无法识别。"))?;
        let selector_path = entry.get("path").and_then(toml::Value::as_str);
        let selector_name = entry.get("name").and_then(toml::Value::as_str);
        if selector_path.is_some() == selector_name.is_some() {
            return Err(conflict("Codex Skill 规则必须只含 path 或 name 选择器。"));
        }
        let selector = selector_path
            .map(PathBuf::from)
            .map(|p| {
                if p.is_absolute() {
                    p
                } else {
                    config::get_codex_config_dir().join(p)
                }
            })
            .map(|p| p.canonicalize().unwrap_or(p));
        let matches = paths
            .iter()
            .map(|p| {
                selector.as_ref().is_some_and(|selected| selected == p)
                    || selector_name.is_some_and(|selected| selected.trim() == name)
            })
            .collect::<Vec<_>>();
        if matches.iter().any(|matched| *matched) {
            relevant.push(json!({"path":selector,"name":selector_name,"enabled":enabled_rule}));
            for (current, matched) in enabled.iter_mut().zip(matches) {
                if matched {
                    *current = enabled_rule;
                }
            }
        }
    }
    Ok((enabled, json!(relevant)))
}
pub(crate) fn state(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    target: &ScopeTarget,
    agent: SkillLocation,
    paths: &[PathBuf],
) -> Result<PolicyState, AppError> {
    match agent {
        SkillLocation::Codex => {
            let (enabled, rules) = codex_user_rules(&skill.name, paths)?;
            let project = matches!(target, ScopeTarget::Project { .. });
            let local = project && codex_ids(&codex_project_path(db, target)?)?.contains(&skill.id);
            let user_off = !paths.is_empty() && !enabled.iter().any(|enabled| *enabled);
            Ok(PolicyState {
                excluded: local || user_off,
                revision: json!({"local":local,"user":rules}),
                reason: user_off
                    .then(|| "Codex 用户配置已停用此 Skill，请先在全局配置中解除。".into()),
                notice: project.then(|| "仅通过本项目的「启动 Codex」入口生效。".into()),
            })
        }
        SkillLocation::OpenCode => opencode_state(db, skill, target),
        _ => unreachable!(),
    }
}
pub(crate) fn apply(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    target: &ScopeTarget,
    agent: SkillLocation,
    enabled: bool,
) -> Result<(), AppError> {
    if !matches!(target, ScopeTarget::Project { .. }) {
        return Err(conflict("此排除机制只支持项目目标。"));
    }
    if agent == SkillLocation::Codex {
        let path = codex_project_path(db, target)?;
        let original = read(&path)?;
        let mut ids = codex_ids(&path)?;
        ids.retain(|id| id != &skill.id);
        if !enabled {
            ids.push(skill.id.clone());
        }
        ids.sort();
        ids.dedup();
        let mut value = original
            .as_deref()
            .map(serde_json::from_str::<Value>)
            .transpose()
            .map_err(|_| conflict("Codex 项目排除文件无效。"))?
            .unwrap_or_else(|| json!({"version":1}));
        value["excludedSkillIds"] = json!(ids);
        write(
            &path,
            original.as_deref(),
            &serde_json::to_string_pretty(&value).unwrap(),
        )
    } else {
        write_opencode(db, skill, target, enabled)
    }
}

#[derive(Clone)]
struct Rule {
    path: PathBuf,
    action: String,
    resource: String,
    effect: String,
}
fn wildcard(value: &str, pattern: &str) -> bool {
    let value = value.chars().collect::<Vec<_>>();
    let pattern = pattern.chars().collect::<Vec<_>>();
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;
    for part in pattern {
        let mut next = vec![false; value.len() + 1];
        next[0] = part == '*' && previous[0];
        for i in 1..=value.len() {
            next[i] = if part == '*' {
                previous[i] || next[i - 1]
            } else {
                previous[i - 1] && (part == '?' || part == value[i - 1])
            };
        }
        previous = next;
    }
    previous[value.len()]
}
fn matches(rule: &Rule, name: &str) -> bool {
    wildcard("skill", &rule.action) && wildcard(name, &rule.resource)
}
fn effect(value: &Value) -> Result<String, AppError> {
    value
        .as_str()
        .filter(|v| matches!(*v, "allow" | "deny" | "ask"))
        .map(str::to_owned)
        .ok_or_else(|| conflict("OpenCode 权限值必须是 allow、deny 或 ask。"))
}
pub(crate) const OPENCODE_EXCLUSION_PREFIX: &str = "opencode_skill_exclusion_v1:";

#[derive(Serialize, Deserialize)]
struct OpenCodeExclusion {
    previous: Value,
    rules: Vec<Value>,
    other_rules: Vec<Value>,
    // Existing v1 records describe the legacy precise-value replacement.
    #[serde(default)]
    modern: bool,
}
fn exclusion_key(path: &Path, name: &str) -> String {
    format!(
        "{OPENCODE_EXCLUSION_PREFIX}{:x}",
        Sha256::digest(json!([path, name]).to_string().as_bytes())
    )
}
fn relevant_rules(node: &Node, path: &Path, name: &str) -> Result<Vec<Value>, AppError> {
    Ok(rules(node, path)?
        .into_iter()
        .filter(|rule| matches(rule, name))
        .map(|rule| json!([rule.action, rule.resource, rule.effect]))
        .collect())
}
fn other_relevant_rules(
    paths: &[PathBuf],
    selected: &Path,
    name: &str,
) -> Result<Vec<Value>, AppError> {
    let mut result = vec![];
    for path in paths.iter().filter(|path| path.as_path() != selected) {
        let Some(text) = read(path)? else {
            continue;
        };
        let rules = relevant_rules(&jsonc::parse(&text)?, path, name)?;
        if !rules.is_empty() {
            result.push(json!({"path":path,"rules":rules}));
        }
    }
    Ok(result)
}
fn modern_rule(name: &str) -> Value {
    json!({"action":"skill","resource":name,"effect":"deny"})
}
fn modern_relevant_rules(node: &Node, name: &str) -> Vec<Value> {
    node.get("permissions")
        .into_iter()
        .flat_map(|array| &array.elements)
        .filter(|entry| {
            entry
                .value
                .get("action")
                .and_then(Value::as_str)
                .is_some_and(|action| wildcard("skill", action))
                && entry
                    .value
                    .get("resource")
                    .and_then(Value::as_str)
                    .is_some_and(|resource| wildcard(name, resource))
        })
        .map(|entry| entry.value.clone())
        .collect()
}
fn opencode_exclusion(
    db: &Arc<Database>,
    paths: &[PathBuf],
    path: &Path,
    name: &str,
    node: &Node,
) -> Result<Option<OpenCodeExclusion>, AppError> {
    let saved = db
        .get_setting(&exclusion_key(path, name))?
        .map(|text| serde_json::from_str::<Option<OpenCodeExclusion>>(&text))
        .transpose()
        .map_err(|_| conflict("OpenCode 项目排除的原权限记录无效，请先核对原生配置。"))?
        .flatten();
    if let Some(saved) = &saved {
        if !saved.previous.is_null() {
            effect(&saved.previous)?;
        }
        let local_matches = if saved.modern {
            saved.previous.is_null()
                && saved.rules == modern_relevant_rules(node, name)
                && saved.rules.last() == Some(&modern_rule(name))
        } else {
            saved.rules == relevant_rules(node, path, name)?
                && node
                    .get("permission")
                    .and_then(|n| n.get("skill"))
                    .and_then(|n| n.get(name))
                    .is_some_and(|n| n.value == "deny")
        };
        if saved.modern != modern(node)?
            || !local_matches
            || saved.other_rules != other_relevant_rules(paths, path, name)?
        {
            return Err(conflict(
                "OpenCode 项目排除的相关权限已被外部修改，请先核对原生配置；本次没有覆盖或恢复旧值。",
            ));
        }
    }
    Ok(saved)
}
fn save_exclusion(
    db: &Arc<Database>,
    key: &str,
    saved: &OpenCodeExclusion,
    path: &Path,
    original: Option<&str>,
    text: &str,
) -> Result<(), AppError> {
    db.set_setting(key, &serde_json::to_string(saved).unwrap())?;
    if let Err(error) = write(path, original, text) {
        if let Err(rollback) = db.set_setting(key, "null") {
            return Err(conflict(format!(
                "{error}；原权限记录回滚失败：{rollback}，请核对原生配置。"
            )));
        }
        return Err(error);
    }
    Ok(())
}
fn restore_exclusion(
    db: &Arc<Database>,
    key: &str,
    path: &Path,
    original: &str,
    text: &str,
) -> Result<(), AppError> {
    write(path, Some(original), text)?;
    if let Err(error) = db.set_setting(key, "null") {
        if let Err(rollback) = write(path, Some(text), original) {
            return Err(conflict(format!(
                "{error}；原生权限回滚失败：{rollback}，原权限记录仍保留，请核对原生配置。"
            )));
        }
        return Err(error);
    }
    Ok(())
}
const LEGACY_KEYS: &[&str] = &[
    "logLevel",
    "server",
    "command",
    "reference",
    "snapshot",
    "plugin",
    "autoshare",
    "disabled_providers",
    "enabled_providers",
    "small_model",
    "mode",
    "agent",
    "provider",
    "permission",
    "tools",
    "attachment",
    "layout",
];
fn modern(node: &Node) -> Result<bool, AppError> {
    let legacy = LEGACY_KEYS.iter().any(|key| node.get(key).is_some());
    let new = [
        "permissions",
        "agents",
        "providers",
        "plugins",
        "snapshots",
        "commands",
        "references",
    ]
    .iter()
    .any(|key| node.get(key).is_some())
        || node.get("skills").is_some_and(|n| n.value.is_array());
    if legacy && new {
        return Err(conflict(
            "OpenCode 混合了新旧配置格式，请先在原生配置中统一格式。",
        ));
    }
    Ok(new)
}
fn rules(node: &Node, path: &Path) -> Result<Vec<Rule>, AppError> {
    let mut result = vec![];
    if let Some(tools) = node.get("tools") {
        if !tools.value.is_object() {
            return Err(conflict("OpenCode tools 必须是对象。"));
        }
        for member in &tools.members {
            let enabled = member
                .node
                .value
                .as_bool()
                .ok_or_else(|| conflict("OpenCode tools 开关无效。"))?;
            result.push(Rule {
                path: path.into(),
                action: member.key.clone(),
                resource: "*".into(),
                effect: if enabled { "allow" } else { "deny" }.into(),
            });
        }
    }
    if let Some(permission) = node.get("permission") {
        if permission.value.is_string() {
            result.push(Rule {
                path: path.into(),
                action: "*".into(),
                resource: "*".into(),
                effect: effect(&permission.value)?,
            });
        } else if permission.value.is_object() {
            for member in &permission.members {
                if member.node.value.is_string() {
                    result.push(Rule {
                        path: path.into(),
                        action: member.key.clone(),
                        resource: "*".into(),
                        effect: effect(&member.node.value)?,
                    });
                } else if member.node.value.is_object() {
                    for item in &member.node.members {
                        result.push(Rule {
                            path: path.into(),
                            action: member.key.clone(),
                            resource: item.key.clone(),
                            effect: effect(&item.node.value)?,
                        });
                    }
                } else {
                    return Err(conflict("OpenCode permission 结构无法识别。"));
                }
            }
        } else {
            return Err(conflict("OpenCode permission 结构无法识别。"));
        }
    }
    if let Some(permissions) = node.get("permissions") {
        if !permissions.value.is_array() {
            return Err(conflict("OpenCode permissions 必须是数组。"));
        }
        for entry in &permissions.elements {
            result.push(Rule {
                path: path.into(),
                action: entry
                    .value
                    .get("action")
                    .and_then(Value::as_str)
                    .ok_or_else(|| conflict("OpenCode action 无效。"))?
                    .into(),
                resource: entry
                    .value
                    .get("resource")
                    .and_then(Value::as_str)
                    .ok_or_else(|| conflict("OpenCode resource 无效。"))?
                    .into(),
                effect: effect(entry.value.get("effect").unwrap_or(&Value::Null))?,
            });
        }
    }
    Ok(result)
}
fn opencode_paths(
    db: &Arc<Database>,
    target: &ScopeTarget,
) -> Result<(Vec<PathBuf>, PathBuf), AppError> {
    let global = config::get_opencode_config_dir();
    let mut paths = vec![global.join("opencode.json"), global.join("opencode.jsonc")];
    let mut selected = global.join("opencode.json");
    if let Some(root) = ProjectService::resolve_scope_target(db, target)?.project_root {
        selected = root.join("opencode.json");
        for dir in [&root, &root.join(".opencode")] {
            for name in ["opencode.json", "opencode.jsonc"] {
                let path = dir.join(name);
                if read(&path)?.is_some() {
                    selected = path.clone();
                }
                paths.push(path);
            }
        }
    }
    Ok((paths, selected))
}
fn role_rules(root: &Path, name: &str, observed: &mut Vec<Value>) -> Result<bool, AppError> {
    if !root.exists() {
        return Ok(false);
    }
    super::skill_matrix::safe_path(root)?;
    let mut found = false;
    for entry in fs::read_dir(root).map_err(|error| AppError::io(root, error))? {
        let path = entry.map_err(|error| AppError::io(root, error))?.path();
        super::skill_matrix::safe_path(&path)?;
        if path.is_dir() {
            found |= role_rules(&path, name, observed)?;
        } else if path.extension().is_some_and(|ext| ext == "md") {
            let text = read(&path)?.unwrap();
            let normalized = text.replace("\r\n", "\n");
            let Some(front) = normalized
                .strip_prefix("---\n")
                .and_then(|v| v.split_once("\n---").map(|(front, _)| front))
            else {
                return Err(conflict("OpenCode 角色 frontmatter 无法识别。"));
            };
            let value: Value =
                serde_yaml::from_str(front).map_err(|_| conflict("OpenCode 角色 YAML 无效。"))?;
            if value.get("disable") == Some(&json!(true))
                || value.get("disabled") == Some(&json!(true))
            {
                continue;
            }
            let node = jsonc::parse(&value.to_string())?;
            for rule in rules(&node, &path)?
                .into_iter()
                .filter(|r| matches(r, name))
            {
                observed.push(json!({"path":path,"action":rule.action,"resource":rule.resource,"effect":rule.effect}));
                found = true;
            }
        }
    }
    Ok(found)
}
fn opencode_state(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    target: &ScopeTarget,
) -> Result<PolicyState, AppError> {
    let (paths, selected) = opencode_paths(db, target)?;
    let mut all = vec![];
    let mut role = false;
    let mut write_order_blocked = false;
    let mut observed = vec![];
    let mut saved_exclusion = None;
    let mut native_legacy_deny = false;
    let mut native_modern_deny = false;
    let mut selected_modern = false;
    for path in paths.clone() {
        let Some(text) = read(&path)? else {
            continue;
        };
        let node = jsonc::parse(&text)?;
        let is_modern = modern(&node)?;
        let document_rules = rules(&node, &path)?;
        if path == selected {
            selected_modern = is_modern;
            saved_exclusion = opencode_exclusion(db, &paths, &path, &skill.name, &node)?;
            native_modern_deny = is_modern
                && saved_exclusion.is_none()
                && document_rules
                    .iter()
                    .rfind(|rule| matches(rule, &skill.name))
                    .is_some_and(|rule| {
                        rule.action == "skill"
                            && rule.resource == skill.name
                            && rule.effect == "deny"
                    });
            let exact = node
                .get("permission")
                .and_then(|n| n.get("skill"))
                .and_then(|n| n.get(&skill.name));
            native_legacy_deny =
                !is_modern && saved_exclusion.is_none() && exact.is_some_and(|n| n.value == "deny");
            if exact.is_some()
                && document_rules
                    .iter()
                    .rfind(|rule| matches(rule, &skill.name))
                    .is_some_and(|rule| rule.resource != skill.name)
            {
                write_order_blocked = true;
            }
        }
        if path == selected
            && node
                .get("permission")
                .and_then(|permission| permission.get("skill"))
                .is_some()
            && document_rules
                .iter()
                .rfind(|rule| matches(rule, &skill.name))
                .is_some_and(|rule| rule.action != "skill")
        {
            write_order_blocked = true;
        }
        all.extend(
            document_rules
                .into_iter()
                .filter(|r| matches(r, &skill.name)),
        );
        for key in ["agent", "agents", "mode"] {
            if let Some(agents) = node.get(key) {
                if !agents.value.is_object() {
                    return Err(conflict("OpenCode 角色配置必须是对象。"));
                }
                for member in &agents.members {
                    if member.node.value.get("disable") == Some(&json!(true))
                        || member.node.value.get("disabled") == Some(&json!(true))
                    {
                        continue;
                    }
                    for rule in rules(&member.node, &path)?
                        .into_iter()
                        .filter(|r| matches(r, &skill.name))
                    {
                        observed.push(json!({"path":path,"role":member.key,"action":rule.action,"resource":rule.resource,"effect":rule.effect}));
                        role = true;
                    }
                }
            }
        }
        if node.get("policies").is_some()
            || node
                .get("experimental")
                .is_some_and(|n| n.get("policies").is_some())
        {
            return Err(conflict(
                "OpenCode 使用额外原生策略，请在原生配置中核对 Skill 权限。",
            ));
        }
    }
    let mut roots = vec![config::get_opencode_config_dir()];
    if let Some(root) = ProjectService::resolve_scope_target(db, target)?.project_root {
        roots.push(root.join(".opencode"));
    }
    for root in roots {
        for dir in ["agent", "agents"] {
            role |= role_rules(&root.join(dir), &skill.name, &mut observed)?;
        }
    }
    let last = all.last();
    let off = last.is_some_and(|rule| rule.effect == "deny");
    let owned_modern = saved_exclusion
        .as_ref()
        .filter(|saved| saved.modern)
        .and_then(|_| {
            all.iter().rposition(|rule| {
                rule.path == selected
                    && rule.action == "skill"
                    && rule.resource == skill.name
                    && rule.effect == "deny"
            })
        });
    let restored = all
        .iter()
        .enumerate()
        .filter_map(|(index, rule)| {
            if Some(index) == owned_modern {
                None
            } else if !selected_modern
                && rule.path == selected
                && rule.action == "skill"
                && rule.resource == skill.name
                && rule.effect == "deny"
            {
                saved_exclusion.as_ref().and_then(|s| s.previous.as_str())
            } else {
                Some(rule.effect.as_str())
            }
        })
        .collect::<Vec<_>>();
    let inherited_off = restored.last() == Some(&"deny");
    let reason = if skill.name.contains(['*', '?']) {
        Some("Skill 名称含权限通配字符，无法安全按此行独立停用。".into())
    } else if write_order_blocked {
        Some(
            "OpenCode 在精确 Skill 规则后设置了匹配的通配权限，请先在原生配置中核对规则顺序。"
                .into(),
        )
    } else if role {
        Some("OpenCode 角色设置了覆盖此 Skill 的精细权限，请在原生角色配置中管理。".into())
    } else if native_modern_deny {
        Some("OpenCode 精确 deny 没有管理器归属记录，请先在原生配置中核对；不会自动移除。".into())
    } else if off
        && (inherited_off
            || last.is_some_and(|rule| {
                rule.path != selected || rule.action != "skill" || rule.resource != skill.name
            }))
    {
        Some("OpenCode 上级或通配规则仍停用此 Skill，请先在对应原生配置中解除。".into())
    } else if native_legacy_deny {
        Some(
            "OpenCode 精确 deny 没有管理器保存的原权限记录，请先在原生配置中核对；不会自动移除。"
                .into(),
        )
    } else {
        None
    };
    let relevant = all
        .iter()
        .map(|r| json!({"path":r.path,"action":r.action,"resource":r.resource,"effect":r.effect}))
        .collect::<Vec<_>>();
    Ok(PolicyState {
        excluded: off,
        revision: json!({"rules":relevant,"roles":observed,"writePath":selected,"exclusion":saved_exclusion}),
        reason,
        notice: last
            .filter(|r| r.effect == "ask")
            .map(|_| "此 Skill 可用，加载时仍需 OpenCode 原生确认。".into()),
    })
}
fn write_opencode(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    target: &ScopeTarget,
    enabled: bool,
) -> Result<(), AppError> {
    let (paths, path) = opencode_paths(db, target)?;
    let original = read(&path)?;
    let mut text = original.clone().unwrap_or_else(|| "{}\n".into());
    let node = jsonc::parse(&text)?;
    let saved = opencode_exclusion(db, &paths, &path, &skill.name, &node)?;
    let key = exclusion_key(&path, &skill.name);
    if modern(&node)? {
        let current = rules(&node, &path)?;
        let off = current
            .iter()
            .rfind(|rule| matches(rule, &skill.name))
            .is_some_and(|rule| rule.effect == "deny");
        if enabled {
            if saved.is_none() {
                return if off {
                    Err(conflict(
                        "OpenCode 原生 deny 没有管理器归属记录，不会自动移除。",
                    ))
                } else {
                    Ok(())
                };
            }
            // Validation proves the last relevant entry is our appended rule.
            // Resolve its current index, since other Skills may have shifted it.
            let index = node
                .get("permissions")
                .unwrap()
                .elements
                .iter()
                .rposition(|entry| entry.value == modern_rule(&skill.name))
                .unwrap();
            text = jsonc::remove_element(&text, &["permissions"], index)?;
            return restore_exclusion(db, &key, &path, original.as_deref().unwrap(), &text);
        }
        if saved.is_some() || off {
            return Ok(());
        }
        text = jsonc::append(&text, &["permissions"], modern_rule(&skill.name))?;
        let saved = OpenCodeExclusion {
            previous: Value::Null,
            rules: modern_relevant_rules(&jsonc::parse(&text)?, &skill.name),
            other_rules: other_relevant_rules(&paths, &path, &skill.name)?,
            modern: true,
        };
        save_exclusion(db, &key, &saved, &path, original.as_deref(), &text)
    } else {
        if let Some(permission) = node.get("permission").filter(|n| n.value.is_string()) {
            text = jsonc::set(&text, &["permission"], json!({"*":permission.value}))?;
        }
        let node = jsonc::parse(&text)?;
        if let Some(all) = node
            .get("permission")
            .and_then(|n| n.get("skill"))
            .filter(|n| n.value.is_string())
        {
            text = jsonc::set(&text, &["permission", "skill"], json!({"*":all.value}))?;
        }
        let exact = jsonc::parse(&text)?
            .get("permission")
            .and_then(|n| n.get("skill"))
            .and_then(|n| n.get(&skill.name))
            .map(|n| n.value.clone());
        if enabled {
            let Some(saved) = saved else {
                if exact == Some(json!("deny")) {
                    return Err(conflict(
                        "OpenCode 原生 deny 不属于管理器排除，不会自动移除。",
                    ));
                }
                return Ok(());
            };
            text = if !saved.previous.is_null() {
                jsonc::set(&text, &["permission", "skill", &skill.name], saved.previous)?
            } else {
                jsonc::remove(&text, &["permission", "skill", &skill.name])?
            };
            restore_exclusion(db, &key, &path, original.as_deref().unwrap(), &text)
        } else {
            if saved.is_some() || exact == Some(json!("deny")) {
                return Ok(());
            }
            if let Some(exact) = &exact {
                effect(exact)?;
            }
            text = jsonc::set(&text, &["permission", "skill", &skill.name], json!("deny"))?;
            let node = jsonc::parse(&text)?;
            let rules = relevant_rules(&node, &path, &skill.name)?;
            if rules.last() != Some(&json!(["skill", skill.name, "deny"])) {
                return Err(conflict(
                    "OpenCode 规则顺序会使项目排除失效，本次没有写入。",
                ));
            }
            let saved = OpenCodeExclusion {
                previous: exact.unwrap_or(Value::Null),
                rules,
                other_rules: other_relevant_rules(&paths, &path, &skill.name)?,
                modern: false,
            };
            // Persist before replacing the native value so a restart cannot
            // mistake a managed deny for a native permission to remove.
            save_exclusion(db, &key, &saved, &path, original.as_deref(), &text)
        }
    }
}

#[cfg(test)]
mod exclusion_write_tests {
    use super::*;

    #[test]
    fn opencode_exclusion_failed_native_rollback_keeps_external_edit_and_record() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("opencode.json");
        let disabled =
            r#"{"permissions":[{"action":"skill","resource":"review","effect":"deny"}]}"#;
        let restored = r#"{"permissions":[]}"#;
        let external = r#"{"permissions":[],"external":true}"#;
        fs::write(&path, disabled).unwrap();
        let db = Arc::new(Database::memory().unwrap());
        let key = exclusion_key(&path, "review");
        let saved = r#"{"saved":"retain"}"#;
        db.set_setting(&key, saved).unwrap();
        // Block cleanup after the native restoration, then emulate an external
        // writer before the failed cleanup attempts the guarded rollback.
        let connection = db.conn.lock().unwrap();
        connection.execute_batch("PRAGMA query_only=ON").unwrap();
        std::thread::scope(|scope| {
            let writer = scope.spawn(|| restore_exclusion(&db, &key, &path, disabled, restored));
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            let mut observed = false;
            while std::time::Instant::now() < deadline {
                if fs::read_to_string(&path).is_ok_and(|text| text == restored) {
                    observed = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            let changed = if observed {
                fs::write(&path, external)
            } else {
                Ok(())
            };
            drop(connection);
            let result = writer.join().unwrap();
            assert!(
                observed,
                "native restoration was not observed before cleanup"
            );
            changed.unwrap();
            let message = result.unwrap_err().to_string();
            assert!(message.contains("原生权限回滚失败") && message.contains("外部修改"));
        });
        assert_eq!(fs::read_to_string(path).unwrap(), external);
        assert_eq!(db.get_setting(&key).unwrap().as_deref(), Some(saved));
    }
}
