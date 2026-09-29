//! Exact-source import: preview first, then commit the same observed directory entries.
use super::*;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportAction {
    pub path: String,
    pub action: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportPreviewItem {
    pub directory: String,
    pub source_path: String,
    pub storage_path: String,
    pub actions: Vec<SkillImportAction>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportPreview {
    pub revision: String,
    pub items: Vec<SkillImportPreviewItem>,
}

fn import_error(message: &str) -> AppError {
    AppError::Message(format_skill_error(
        "SKILL_IMPORT_CONFLICT",
        &[("message", message)],
        None,
    ))
}

// Hash the safe copy, so an explicit top-level source link has the identity of its
// content, while copy_source rejects cyclic or escaping internal links.
fn content_identity(source: &Path) -> Result<String, AppError> {
    let temp = tempfile::tempdir()?;
    let copy = temp.path().join("content");
    placement::copy_source(source, &copy)?;
    placement::fingerprint(&copy)
}

impl SkillService {
    pub fn preview_import_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        selections: &[ImportSkillSelection],
    ) -> Result<SkillImportPreview, AppError> {
        let _guard = skill_state_read_guard();
        Self::prepare_import(db, target, selections)
    }

    fn prepare_import(
        db: &Arc<Database>,
        target: &ScopeTarget,
        selections: &[ImportSkillSelection],
    ) -> Result<SkillImportPreview, AppError> {
        ProjectService::resolve_scope_target(db, target)?;
        let roots = placement::targets(db, target)?;
        let storage = placement::source_root(db, target)?;
        let storage_physical = placement::physical_path(&storage)?;
        let existing = db.get_all_installed_skills_for_target(target)?;
        let mut claimed = HashSet::new();
        let mut items = Vec::new();
        let mut evidence = Vec::new();
        for selection in selections {
            let name = Self::require_valid_directory(&selection.directory)?;
            if !claimed.insert(name.to_lowercase()) {
                return Err(import_error("同名 Skill 一次只能选择一个来源。"));
            }
            let source = PathBuf::from(&selection.source_path);
            if source.file_name().is_none_or(|leaf| leaf != name.as_str())
                || !source.join("SKILL.md").is_file()
            {
                return Err(import_error(
                    "所选来源已不存在或不再是有效 Skill，请重新扫描。",
                ));
            }
            let parent = source
                .parent()
                .ok_or_else(|| import_error("来源路径无效。"))?;
            let physical_parent = placement::physical_path(parent)?;
            let allowed = roots
                .iter()
                .any(|root| root.physical_path == physical_parent)
                || storage_physical == physical_parent;
            if !allowed {
                return Err(import_error(
                    "所选来源不属于当前范围和目录设置，请重新扫描。",
                ));
            }
            let dest = storage.join(&name);
            // 同一入口由根目录的物理身份决定。不同根中的叶子 symlink 即使
            // 指向主副本，仍是需要独立接管或保留的投放条目。
            let source_is_storage_entry = physical_parent == storage_physical;
            let source_hash = content_identity(&source)?;
            let existing_skill = existing
                .values()
                .find(|s| s.directory.eq_ignore_ascii_case(&name));
            if (dest.exists() || Self::is_symlink(&dest)) && content_identity(&dest)? != source_hash
            {
                return Err(import_error(
                    "主存储已有同名不同内容，不能覆盖或认领其他来源。",
                ));
            }
            let register_existing = existing_skill
                .map(|skill| placement::needs_source_registration(db, skill))
                .transpose()?
                .unwrap_or(false);
            let mut actions = vec![SkillImportAction {
                path: dest.to_string_lossy().into_owned(),
                action: if register_existing {
                    "确认登记旧安装的主副本归属；保留原安装记录，不自动接管其他位置"
                } else if source_is_storage_entry {
                    "原位接管主副本；不复制文件"
                } else if existing_skill.is_some() {
                    "复用已受管主副本"
                } else if dest.exists() {
                    "明确接管已有同内容主副本"
                } else {
                    "复制来源内容到受管主存储"
                }
                .into(),
            }];
            let mut selected_paths = HashSet::new();
            for location in &selection.locations {
                let root = roots
                    .iter()
                    .find(|root| root.aliases.contains(location))
                    .ok_or_else(|| import_error("当前范围不支持所选投放位置。"))?;
                if !selected_paths.insert(root.physical_path.clone()) {
                    continue;
                }
                let entry = root.path.join(&name);
                if storage_physical == root.physical_path {
                    actions.push(SkillImportAction {
                        path: entry.to_string_lossy().into_owned(),
                        action: "主副本位于此投放位置，不能独立撤回".into(),
                    });
                    continue;
                }
                if Self::paths_overlap(&storage, &root.path) {
                    return Err(import_error("投放目录与主存储存在父子重叠。"));
                }
                let present = entry.exists() || Self::is_symlink(&entry);
                if present && content_identity(&entry)? != source_hash {
                    return Err(import_error(
                        "所选投放位置已有同名不同内容，不会覆盖其他来源。",
                    ));
                }
                let action = if !present {
                    "创建受管投放：优先链接或按当前设置复制"
                } else if Self::is_symlink(&entry) {
                    "明确接管并替换此链接；保留链接指向的外部原件"
                } else if get_settings().sync_method == SyncMethod::Symlink {
                    "明确接管：原路径的实体目录将替换为指向主副本的链接"
                } else {
                    "明确接管：原路径保留为实体目录，内容由主副本复制替换"
                };
                actions.push(SkillImportAction {
                    path: entry.to_string_lossy().into_owned(),
                    action: action.into(),
                });
                evidence.push((
                    entry.to_string_lossy().into_owned(),
                    placement::physical_path(&root.path)?
                        .to_string_lossy()
                        .into_owned(),
                    if present {
                        placement::fingerprint(&entry)?
                    } else {
                        "absent".into()
                    },
                ));
            }
            let source_selected = selected_paths.contains(&physical_parent);
            actions.push(SkillImportAction {
                path: selection.source_path.clone(),
                action: if source_is_storage_entry {
                    "原路径即主存储，接管后作为主资产管理"
                } else if source_selected {
                    "原路径按上述投放动作接管；不会继续作为独立原件保留"
                } else {
                    "保留此来源原件；不接管、不替换此路径"
                }
                .into(),
            });
            evidence.push((
                source.to_string_lossy().into_owned(),
                source.canonicalize()?.to_string_lossy().into_owned(),
                format!("{}:{source_hash}", placement::fingerprint(&source)?),
            ));
            evidence.push((
                dest.to_string_lossy().into_owned(),
                storage_physical.to_string_lossy().into_owned(),
                if dest.exists() {
                    placement::fingerprint(&dest)?
                } else {
                    "absent".into()
                },
            ));
            items.push(SkillImportPreviewItem {
                directory: name,
                source_path: selection.source_path.clone(),
                storage_path: dest.to_string_lossy().into_owned(),
                actions,
            });
        }
        let json = serde_json::to_vec(&(
            target,
            selections,
            get_settings(),
            &items,
            existing.values().collect::<Vec<_>>(),
            evidence,
            db.get_setting("skill_placement_registry_v1")?,
        ))
        .map_err(|source| AppError::JsonSerialize { source })?;
        Ok(SkillImportPreview {
            revision: format!("{:x}", Sha256::digest(json)),
            items,
        })
    }

    pub fn import_from_apps_for_target(
        db: &Arc<Database>,
        target: &ScopeTarget,
        selections: Vec<ImportSkillSelection>,
        expected_revision: &str,
    ) -> Result<Vec<InstalledSkill>, AppError> {
        let _guard = skill_state_write_guard();
        let preview = Self::prepare_import(db, target, &selections)?;
        if preview.revision != expected_revision {
            return Err(import_error(
                "预览后来源、投放目录或设置已变化，请重新预览。",
            ));
        }
        let storage = placement::source_root(db, target)?;
        let roots = placement::targets(db, target)?;
        let before = db.get_all_installed_skills_for_target(target)?;
        let mut paths = Vec::new();
        for selection in &selections {
            paths.push(storage.join(&selection.directory));
            for root in &roots {
                if selection.locations.iter().any(|l| root.aliases.contains(l)) {
                    paths.push(root.path.join(&selection.directory));
                }
            }
        }
        let checkpoint = PlacementCheckpoint::capture(db, &paths)?;
        let mut created_ids = Vec::new();
        let result = (|| {
            let mut imported = Vec::new();
            let agents_lock = if matches!(target, ScopeTarget::Global) {
                parse_agents_lock()
            } else {
                HashMap::new()
            };
            for selection in selections {
                let source = PathBuf::from(&selection.source_path);
                let dest = storage.join(&selection.directory);
                if !dest.exists() {
                    fs::create_dir_all(&storage)?;
                    placement::copy_source(&source, &dest)?;
                }
                let skill = if let Some(existing) = before
                    .values()
                    .find(|s| s.directory.eq_ignore_ascii_case(&selection.directory))
                {
                    if placement::needs_source_registration(db, existing)? {
                        placement::register_source(db, existing)?;
                    }
                    existing.clone()
                } else {
                    let (name, description) =
                        Self::read_skill_name_desc(&dest.join("SKILL.md"), &selection.directory);
                    let (id, repo_owner, repo_name, repo_branch, readme_url) =
                        build_repo_info_from_lock(&agents_lock, &selection.directory);
                    let skill = InstalledSkill {
                        id,
                        name,
                        description,
                        directory: selection.directory,
                        repo_owner,
                        repo_name,
                        repo_branch,
                        readme_url,
                        apps: SkillApps::default(),
                        installed_at: chrono::Utc::now().timestamp(),
                        content_hash: Self::compute_dir_hash(&dest).ok(),
                        updated_at: 0,
                        target: target.clone(),
                    };
                    db.save_skill(&skill)?;
                    created_ids.push(skill.id.clone());
                    placement::register_source(db, &skill)?;
                    skill
                };
                let mut done = HashSet::new();
                for location in selection.locations {
                    let states = placement::placements(db, &skill)?;
                    let state = states
                        .iter()
                        .find(|p| p.target.aliases.contains(&location))
                        .ok_or_else(|| import_error("投放位置已变化。"))?;
                    if !done.insert(state.target.physical_path.clone()) {
                        continue;
                    }
                    if state.state == "unmanaged" {
                        placement::adopt(db, &skill, location, &state.revision)?;
                    }
                    placement::sync(db, &skill, location)?;
                }
                imported.push(skill);
            }
            Ok(imported)
        })();
        if let Err(error) = result {
            checkpoint.restore(db)?;
            for id in created_ids {
                db.delete_skill_for_target(&id, target)?;
            }
            return Err(error);
        }
        result
    }
}

#[cfg(test)]
#[path = "skill_import_tests.rs"]
mod tests;
