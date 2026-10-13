use super::*;
use crate::config;
use crate::database::Database;
use crate::services::project::{ProjectService, ScopeTarget};
use crate::services::skill_placement::{self as placement, SkillLocation};
use crate::settings::{self, StorageLocation, SyncMethod};
use serial_test::serial;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tempfile::tempdir;

struct TestHomeGuard;

impl TestHomeGuard {
    fn set(path: &Path) -> Self {
        std::env::set_var(config::ACM_HOME_ENV, path.as_os_str());
        settings::reset_settings_store_for_test();
        Self
    }
}

impl Drop for TestHomeGuard {
    fn drop(&mut self) {
        std::env::remove_var(config::ACM_HOME_ENV);
        settings::reset_settings_store_for_test();
    }
}

fn write_skill(path: &Path, name: &str) {
    fs::create_dir_all(path).expect("create isolated skill directory");
    fs::write(
        path.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: isolated import fixture\n---\n"),
    )
    .expect("write isolated SKILL.md");
}

fn selection(
    directory: &str,
    source_path: &Path,
    locations: Vec<SkillLocation>,
) -> ImportSkillSelection {
    ImportSkillSelection {
        directory: directory.to_string(),
        source_path: source_path.to_string_lossy().into_owned(),
        locations,
    }
}

fn preview_and_import(
    db: &Arc<Database>,
    target: &ScopeTarget,
    selections: Vec<ImportSkillSelection>,
) -> Vec<InstalledSkill> {
    let preview = SkillService::preview_import_for_target(db, target, &selections)
        .expect("preview isolated import");
    assert_eq!(preview.items.len(), selections.len());
    SkillService::import_from_apps_for_target(db, target, selections, &preview.revision)
        .expect("commit isolated import")
}

fn placement_for(
    db: &Arc<Database>,
    skill: &InstalledSkill,
    location: SkillLocation,
) -> placement::SkillPlacement {
    placement::placements(db, skill)
        .expect("read placement state")
        .into_iter()
        .find(|state| state.target.aliases.contains(&location))
        .expect("requested placement target")
}

#[test]
#[serial]
fn import_without_locations_copies_to_managed_storage_and_preserves_source() {
    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    settings::set_sync_method(SyncMethod::Copy).expect("set copy mode");
    let db = Arc::new(Database::memory().expect("memory db"));
    let source = config::get_claude_skills_dir().join("source-only");
    write_skill(&source, "Source Only");
    fs::write(source.join("original.txt"), "keep me").expect("write source marker");

    let imported = preview_and_import(
        &db,
        &ScopeTarget::Global,
        vec![selection("source-only", &source, vec![])],
    );

    let managed = config::get_hub_skills_dir().join("source-only");
    assert_eq!(
        fs::read_to_string(source.join("original.txt")).expect("source marker remains"),
        "keep me"
    );
    assert!(managed.join("SKILL.md").is_file());
    assert!(!SkillService::is_symlink(&source));
    let source_state = placement_for(&db, &imported[0], SkillLocation::ClaudeCode);
    assert_eq!(source_state.state, "unmanaged");
    assert!(!source_state.withdrawable);
}

#[test]
#[serial]
fn shared_adoption_and_codex_placement_can_be_withdrawn_independently() {
    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    settings::set_sync_method(SyncMethod::Copy).expect("set copy mode");
    let db = Arc::new(Database::memory().expect("memory db"));
    let shared = home.path().join(".agents/skills/shared-owned");
    write_skill(&shared, "Shared Owned");

    let imported = preview_and_import(
        &db,
        &ScopeTarget::Global,
        vec![selection(
            "shared-owned",
            &shared,
            vec![SkillLocation::Shared],
        )],
    );
    let skill = &imported[0];
    let shared_state = placement_for(&db, skill, SkillLocation::Shared);
    assert_eq!(shared_state.state, "placed");
    assert!(shared_state.withdrawable);

    placement::sync(&db, skill, SkillLocation::Codex).expect("place into codex directory");
    assert!(config::get_codex_skills_dir()
        .join("shared-owned/SKILL.md")
        .is_file());
    assert_eq!(
        placement_for(&db, skill, SkillLocation::Shared).state,
        "placed"
    );

    placement::withdraw(&db, skill, SkillLocation::Codex).expect("withdraw only codex placement");
    assert!(!config::get_codex_skills_dir().join("shared-owned").exists());
    assert!(shared.join("SKILL.md").is_file());
    assert_eq!(
        placement_for(&db, skill, SkillLocation::Shared).state,
        "placed"
    );
}

#[test]
#[serial]
fn managed_same_name_with_different_content_is_not_reused() {
    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().expect("memory db"));
    let first = config::get_claude_skills_dir().join("collision");
    write_skill(&first, "Managed Alpha");
    let imported = preview_and_import(
        &db,
        &ScopeTarget::Global,
        vec![selection("collision", &first, vec![])],
    );
    let managed_before =
        fs::read_to_string(config::get_hub_skills_dir().join("collision/SKILL.md"))
            .expect("managed alpha");

    let second = config::get_codex_skills_dir().join("collision");
    write_skill(&second, "Unrelated Beta");
    let error = SkillService::preview_import_for_target(
        &db,
        &ScopeTarget::Global,
        &[selection("collision", &second, vec![])],
    )
    .expect_err("different content must not reuse managed asset");

    assert!(error.to_string().contains("同名不同内容"));
    assert_eq!(
        fs::read_to_string(config::get_hub_skills_dir().join("collision/SKILL.md"))
            .expect("managed content preserved"),
        managed_before
    );
    assert_eq!(
        db.get_all_installed_skills_for_target(&ScopeTarget::Global)
            .expect("installed skills")
            .len(),
        imported.len()
    );
}

#[test]
#[serial]
fn unmanaged_target_with_same_name_and_different_content_blocks_import() {
    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().expect("memory db"));
    let source = config::get_claude_skills_dir().join("target-collision");
    let target = config::get_codex_skills_dir().join("target-collision");
    write_skill(&source, "Source Alpha");
    write_skill(&target, "Existing Beta");

    let error = SkillService::preview_import_for_target(
        &db,
        &ScopeTarget::Global,
        &[selection(
            "target-collision",
            &source,
            vec![SkillLocation::Codex],
        )],
    )
    .expect_err("unmanaged different target must block import");

    assert!(error.to_string().contains("同名不同内容"));
    assert!(fs::read_to_string(source.join("SKILL.md"))
        .expect("source preserved")
        .contains("Source Alpha"));
    assert!(fs::read_to_string(target.join("SKILL.md"))
        .expect("target preserved")
        .contains("Existing Beta"));
    assert!(db
        .get_all_installed_skills_for_target(&ScopeTarget::Global)
        .expect("installed skills")
        .is_empty());
}

#[test]
#[serial]
fn import_rejects_source_modified_after_preview() {
    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().expect("memory db"));
    let source = config::get_claude_skills_dir().join("changed-after-preview");
    write_skill(&source, "Before");
    let selections = vec![selection("changed-after-preview", &source, vec![])];
    let preview = SkillService::preview_import_for_target(&db, &ScopeTarget::Global, &selections)
        .expect("preview");
    fs::write(source.join(".external-edit"), "changed").expect("mutate source after preview");

    let error = SkillService::import_from_apps_for_target(
        &db,
        &ScopeTarget::Global,
        selections,
        &preview.revision,
    )
    .expect_err("source mutation must invalidate preview");

    assert!(error.to_string().contains("预览后"));
    assert!(!config::get_hub_skills_dir()
        .join("changed-after-preview")
        .exists());
    assert!(source.join(".external-edit").is_file());
}

#[cfg(unix)]
#[test]
#[serial]
fn import_rejects_top_level_source_symlink_retargeted_after_preview() {
    use std::os::unix::fs::symlink;

    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().expect("memory db"));
    let actual_one = home.path().join("external/one");
    let actual_two = home.path().join("external/two");
    write_skill(&actual_one, "Link One");
    write_skill(&actual_two, "Link Two");
    let source = config::get_claude_skills_dir().join("linked-source");
    fs::create_dir_all(source.parent().expect("source parent")).expect("create source root");
    symlink(&actual_one, &source).expect("create source link");
    let selections = vec![selection("linked-source", &source, vec![])];
    let preview = SkillService::preview_import_for_target(&db, &ScopeTarget::Global, &selections)
        .expect("preview linked source");
    fs::remove_file(&source).expect("remove old source link");
    symlink(&actual_two, &source).expect("retarget source link");

    let error = SkillService::import_from_apps_for_target(
        &db,
        &ScopeTarget::Global,
        selections,
        &preview.revision,
    )
    .expect_err("retargeted source link must invalidate preview");

    assert!(error.to_string().contains("预览后"));
    assert_eq!(
        fs::read_link(&source).expect("current link target"),
        actual_two
    );
    assert!(!config::get_hub_skills_dir().join("linked-source").exists());
}

#[cfg(unix)]
#[test]
#[serial]
fn import_rejects_external_content_change_behind_unchanged_source_symlink() {
    use std::os::unix::fs::symlink;

    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().expect("memory db"));
    let external = home.path().join("external/stable-target");
    write_skill(&external, "Before External Edit");
    let source = config::get_claude_skills_dir().join("linked-content");
    fs::create_dir_all(source.parent().expect("source parent")).expect("create source root");
    symlink(&external, &source).expect("create source link");
    let selections = vec![selection("linked-content", &source, vec![])];
    let preview = SkillService::preview_import_for_target(&db, &ScopeTarget::Global, &selections)
        .expect("preview linked content");
    fs::write(external.join("payload.txt"), "external edit after preview")
        .expect("mutate external target content");

    let error = SkillService::import_from_apps_for_target(
        &db,
        &ScopeTarget::Global,
        selections,
        &preview.revision,
    )
    .expect_err("external target mutation must invalidate preview");

    assert!(error.to_string().contains("预览后"));
    assert_eq!(
        fs::read_link(&source).expect("unchanged source link target"),
        external
    );
    assert!(!config::get_hub_skills_dir().join("linked-content").exists());
}

#[cfg(unix)]
#[test]
#[serial]
fn preview_treats_leaf_symlink_to_managed_source_as_an_independent_placement() {
    use std::os::unix::fs::symlink;

    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().expect("memory db"));
    let managed = config::get_hub_skills_dir().join("linked-placement");
    write_skill(&managed, "Linked Placement");
    let shared = home.path().join(".agents/skills/linked-placement");
    fs::create_dir_all(shared.parent().expect("shared parent")).expect("create shared root");
    symlink(&managed, &shared).expect("link shared entry to managed source");

    let retained = SkillService::preview_import_for_target(
        &db,
        &ScopeTarget::Global,
        &[selection("linked-placement", &shared, vec![])],
    )
    .expect("preview retained leaf link");
    let retained_actions = &retained.items[0].actions;
    assert!(retained_actions.iter().any(|action| {
        action.path == managed.to_string_lossy() && action.action == "明确接管已有同内容主副本"
    }));
    assert!(retained_actions.iter().any(|action| {
        action.path == shared.to_string_lossy()
            && action.action == "保留此来源原件；不接管、不替换此路径"
    }));
    assert!(retained_actions
        .iter()
        .all(|action| !action.action.contains("原路径即主存储")));

    let adopted = SkillService::preview_import_for_target(
        &db,
        &ScopeTarget::Global,
        &[selection(
            "linked-placement",
            &shared,
            vec![SkillLocation::Shared],
        )],
    )
    .expect("preview explicit shared adoption");
    let adopted_actions = &adopted.items[0].actions;
    assert!(adopted_actions.iter().any(|action| {
        action.path == shared.to_string_lossy()
            && action.action == "明确接管并替换此链接；保留链接指向的外部原件"
    }));
    assert!(adopted_actions.iter().any(|action| {
        action.path == shared.to_string_lossy()
            && action.action == "原路径按上述投放动作接管；不会继续作为独立原件保留"
    }));
    assert!(adopted_actions
        .iter()
        .all(|action| !action.action.contains("原路径即主存储")));
    assert!(SkillService::is_symlink(&shared));
    assert_eq!(fs::read_link(&shared).unwrap(), managed);
}

#[test]
#[serial]
fn unified_shared_source_is_in_place_and_cannot_be_withdrawn() {
    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    settings::set_storage_location(StorageLocation::Unified).expect("use unified storage");
    let db = Arc::new(Database::memory().expect("memory db"));
    let source = home.path().join(".agents/skills/in-place");
    write_skill(&source, "In Place");

    let imported = preview_and_import(
        &db,
        &ScopeTarget::Global,
        vec![selection("in-place", &source, vec![SkillLocation::Shared])],
    );
    let state = placement_for(&db, &imported[0], SkillLocation::Shared);

    assert_eq!(state.state, "placed");
    assert!(state.source_is_target);
    assert!(!state.withdrawable);
    assert!(source.join("SKILL.md").is_file());
    let error = placement::withdraw(&db, &imported[0], SkillLocation::Shared)
        .expect_err("the unique managed source cannot be withdrawn");
    assert!(error.to_string().contains("主副本"));
    assert!(source.join("SKILL.md").is_file());
}

#[cfg(unix)]
#[test]
#[serial]
fn batch_failure_restores_database_sources_and_original_link() {
    use std::os::unix::fs::symlink;

    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    settings::set_sync_method(SyncMethod::Copy).expect("set copy mode");
    let db = Arc::new(Database::memory().expect("memory db"));
    let external = home.path().join("external/batch-one");
    write_skill(&external, "Batch One");
    let first_source = config::get_claude_skills_dir().join("batch-one");
    fs::create_dir_all(first_source.parent().expect("source parent"))
        .expect("create source parent");
    symlink(&external, &first_source).expect("create original source link");
    let second_source = config::get_codex_skills_dir().join("batch-two");
    write_skill(&second_source, "Batch Two");
    let selections = vec![
        selection("batch-one", &first_source, vec![SkillLocation::ClaudeCode]),
        selection("batch-two", &second_source, vec![SkillLocation::Codex]),
    ];
    let preview = SkillService::preview_import_for_target(&db, &ScopeTarget::Global, &selections)
        .expect("preview batch");
    {
        let connection = db.conn.lock().expect("lock test database");
        connection
            .execute_batch(
                "CREATE TABLE import_test_counter (directory TEXT NOT NULL);
                 CREATE TRIGGER record_import_attempt
                 AFTER INSERT ON skills
                 BEGIN
                   INSERT INTO import_test_counter (directory) VALUES (NEW.directory);
                 END;
                 CREATE TRIGGER fail_second_skill
                 BEFORE INSERT ON skills
                 WHEN NEW.directory = 'batch-two'
                 BEGIN
                   SELECT RAISE(ABORT, 'forced second skill failure');
                 END;",
            )
            .expect("install isolated failure trigger");
    }

    let error = SkillService::import_from_apps_for_target(
        &db,
        &ScopeTarget::Global,
        selections,
        &preview.revision,
    )
    .expect_err("second insert failure must roll back the whole batch");

    assert!(error.to_string().contains("forced second skill failure"));
    {
        let connection = db.conn.lock().expect("lock test database");
        let first_attempts: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM import_test_counter WHERE directory = 'batch-one'",
                [],
                |row| row.get(0),
            )
            .expect("read import attempt counter");
        assert_eq!(first_attempts, 1, "the first batch item must complete its DB insert before the injected second-item failure");
    }
    assert!(db
        .get_all_installed_skills_for_target(&ScopeTarget::Global)
        .expect("installed skills after rollback")
        .is_empty());
    assert!(db
        .get_setting("skill_placement_registry_v1")
        .expect("registry after rollback")
        .is_none());
    assert!(!config::get_hub_skills_dir().join("batch-one").exists());
    assert!(!config::get_hub_skills_dir().join("batch-two").exists());
    assert!(SkillService::is_symlink(&first_source));
    assert_eq!(
        fs::read_link(&first_source).expect("restored original link"),
        external
    );
    assert!(second_source.join("SKILL.md").is_file());
}

#[test]
#[serial]
fn project_import_has_no_shared_target_and_rejects_global_sources() {
    let home = tempdir().expect("isolated home");
    let _home_guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().expect("memory db"));
    let project_root = home.path().join("workspace");
    fs::create_dir_all(&project_root).expect("create project root");
    let project = ProjectService::add_project(&db, &project_root, Some("Workspace".into()))
        .expect("register project");
    let target = ScopeTarget::Project {
        project_id: project.project_id,
    };
    let roots = placement::targets(&db, &target).expect("project placement roots");
    assert_eq!(roots.len(), 4);
    assert!(roots
        .iter()
        .all(|root| !root.aliases.contains(&SkillLocation::Shared)));

    let project_source = project_root.join(".claude/skills/project-source");
    write_skill(&project_source, "Project Source");
    let shared_error = SkillService::preview_import_for_target(
        &db,
        &target,
        &[selection(
            "project-source",
            &project_source,
            vec![SkillLocation::Shared],
        )],
    )
    .expect_err("project scope must not expose a shared target");
    assert!(shared_error.to_string().contains("不支持所选投放位置"));

    let global_source = config::get_claude_skills_dir().join("global-source");
    write_skill(&global_source, "Global Source");
    let global_error = SkillService::preview_import_for_target(
        &db,
        &target,
        &[selection(
            "global-source",
            &global_source,
            vec![SkillLocation::ClaudeCode],
        )],
    )
    .expect_err("project import must not consume a global source");
    assert!(global_error.to_string().contains("不属于当前范围"));
    assert!(global_source.join("SKILL.md").is_file());
    assert!(db
        .get_all_installed_skills_for_target(&target)
        .expect("project skills")
        .is_empty());
}

fn legacy_skill(target: ScopeTarget) -> InstalledSkill {
    InstalledSkill {
        id: "owner/repo:legacy".into(),
        name: "Legacy".into(),
        directory: "legacy".into(),
        description: None,
        repo_owner: Some("owner".into()),
        repo_name: Some("repo".into()),
        repo_branch: Some("main".into()),
        readme_url: None,
        apps: SkillApps {
            codex: true,
            claude_code: true,
            ..Default::default()
        },
        installed_at: 7,
        updated_at: 9,
        content_hash: None,
        target,
    }
}

#[test]
#[serial]
fn legacy_install_requires_preview_then_preserves_identity_and_unselected_entries() {
    let home = tempdir().unwrap();
    let _guard = TestHomeGuard::set(home.path());
    settings::set_sync_method(SyncMethod::Copy).unwrap();
    let db = Arc::new(Database::memory().unwrap());
    let project_root = home.path().join("workspace");
    fs::create_dir_all(&project_root).unwrap();
    let project = ProjectService::add_project(&db, &project_root, None).unwrap();
    // Same legacy identity in two scopes must be registered independently.
    let mut registered = Vec::new();
    for target in [
        ScopeTarget::Global,
        ScopeTarget::Project {
            project_id: project.project_id,
        },
    ] {
        let skill = legacy_skill(target.clone());
        db.save_skill(&skill).unwrap();
        let source = placement::source_root(&db, &target).unwrap().join("legacy");
        write_skill(&source, "Legacy");
        let codex = SkillService::get_app_skills_dir_for_target(&db, &target, &AgentType::Codex)
            .unwrap()
            .join("legacy");
        let claude =
            SkillService::get_app_skills_dir_for_target(&db, &target, &AgentType::ClaudeCode)
                .unwrap()
                .join("legacy");
        write_skill(&codex, "Legacy");
        write_skill(&claude, "Unselected external content");
        let untouched = placement::fingerprint(&claude).unwrap();
        let selection = vec![selection("legacy", &source, vec![SkillLocation::Codex])];
        assert!(SkillService::uninstall_for_target(&db, &target, &skill.id).is_err());
        assert!(SkillService::scan_unmanaged_for_target(&db, &target)
            .unwrap()
            .iter()
            .any(|s| s.path == source.to_string_lossy()));
        let before = db.get_setting("skill_placement_registry_v1").unwrap();
        let preview = SkillService::preview_import_for_target(&db, &target, &selection).unwrap();
        assert!(preview.items[0].actions[0].action.contains("旧安装"));
        assert_eq!(
            db.get_setting("skill_placement_registry_v1").unwrap(),
            before
        );
        let imported =
            SkillService::import_from_apps_for_target(&db, &target, selection, &preview.revision)
                .unwrap();
        assert_eq!(
            serde_json::to_value(&imported[0]).unwrap(),
            serde_json::to_value(&skill).unwrap()
        );
        placement::ensure_owned_unchanged(&db, &skill).unwrap();
        assert_eq!(
            placement_for(&db, &skill, SkillLocation::Codex).state,
            "placed"
        );
        assert_eq!(
            placement_for(&db, &skill, SkillLocation::ClaudeCode).state,
            "unmanaged"
        );
        registered.push((skill, codex, claude, untouched));
    }
    for (skill, codex, claude, untouched) in &registered {
        SkillService::uninstall_for_target(&db, &skill.target, &skill.id).unwrap();
        assert!(!codex.exists());
        assert_eq!(placement::fingerprint(claude).unwrap(), *untouched);
        if skill.target == ScopeTarget::Global {
            placement::ensure_owned_unchanged(&db, &registered[1].0).unwrap();
            assert!(registered[1].1.join("SKILL.md").is_file());
        }
    }
}

#[test]
#[serial]
fn legacy_registration_rejects_stale_preview_and_managed_external_changes() {
    let home = tempdir().unwrap();
    let _guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().unwrap());
    let target = ScopeTarget::Global;
    let skill = legacy_skill(target.clone());
    db.save_skill(&skill).unwrap();
    let source = placement::source_root(&db, &target).unwrap().join("legacy");
    write_skill(&source, "Legacy");
    let selections = vec![selection("legacy", &source, vec![])];
    let preview = SkillService::preview_import_for_target(&db, &target, &selections).unwrap();
    fs::write(source.join(".external"), "changed after preview").unwrap();
    assert!(SkillService::import_from_apps_for_target(
        &db,
        &target,
        selections.clone(),
        &preview.revision
    )
    .is_err());
    assert!(db
        .get_setting("skill_placement_registry_v1")
        .unwrap()
        .is_none());
    // A new preview can explicitly accept an unregistered source, but never
    // reset the recorded fingerprint of an already managed source.
    preview_and_import(&db, &target, selections.clone());
    fs::write(source.join(".external"), "another change").unwrap();
    assert!(SkillService::preview_import_for_target(&db, &target, &selections).is_err());
    assert_eq!(
        fs::read_to_string(source.join(".external")).unwrap(),
        "another change"
    );
}

#[test]
#[serial]
fn legacy_registration_failure_preserves_old_record_and_can_retry_after_reopen() {
    let home = tempdir().unwrap();
    let _guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::init().unwrap());
    let skill = legacy_skill(ScopeTarget::Global);
    db.save_skill(&skill).unwrap();
    let source = placement::source_root(&db, &skill.target)
        .unwrap()
        .join("legacy");
    write_skill(&source, "Legacy");
    let before = placement::fingerprint(&source).unwrap();
    let selections = vec![selection("legacy", &source, vec![SkillLocation::Codex])];
    let preview = SkillService::preview_import_for_target(&db, &skill.target, &selections).unwrap();
    // Fail after registering the source, when the placement registry is updated.
    db.conn.lock().unwrap().execute_batch(
        "CREATE TRIGGER reject_legacy_placement BEFORE INSERT ON settings
         WHEN NEW.key = 'skill_placement_registry_v1' AND json_array_length(NEW.value, '$.placements') > 0
         BEGIN SELECT RAISE(ABORT, 'forced legacy placement failure'); END;"
    ).unwrap();
    let error = SkillService::import_from_apps_for_target(
        &db,
        &skill.target,
        selections.clone(),
        &preview.revision,
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("forced legacy placement failure"));
    assert_eq!(placement::fingerprint(&source).unwrap(), before);
    assert!(!config::get_codex_skills_dir().join("legacy").exists());
    assert!(db
        .get_setting("skill_placement_registry_v1")
        .unwrap()
        .is_none());
    assert_eq!(
        serde_json::to_value(db.get_global_installed_skill(&skill.id).unwrap().unwrap()).unwrap(),
        serde_json::to_value(&skill).unwrap()
    );
    db.conn
        .lock()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_legacy_placement")
        .unwrap();
    drop(db);
    let db = Arc::new(Database::init().unwrap());
    preview_and_import(&db, &skill.target, selections);
    drop(db);
    let db = Arc::new(Database::init().unwrap());
    placement::ensure_owned_unchanged(&db, &skill).unwrap();
    assert_eq!(
        placement_for(&db, &skill, SkillLocation::Codex).state,
        "placed"
    );
}

#[test]
#[serial]
fn legacy_registration_cannot_reclaim_partial_or_other_asset_ownership() {
    let home = tempdir().unwrap();
    let _guard = TestHomeGuard::set(home.path());
    let db = Arc::new(Database::memory().unwrap());
    let skill = legacy_skill(ScopeTarget::Global);
    db.save_skill(&skill).unwrap();
    let source = placement::source_root(&db, &skill.target)
        .unwrap()
        .join("legacy");
    write_skill(&source, "Legacy");
    placement::register_source(&db, &skill).unwrap();
    placement::sync(&db, &skill, SkillLocation::Codex).unwrap();
    let raw = db
        .get_setting("skill_placement_registry_v1")
        .unwrap()
        .unwrap();
    let mut partial: serde_json::Value = serde_json::from_str(&raw).unwrap();
    partial["sources"] = serde_json::json!([]);
    db.set_setting("skill_placement_registry_v1", &partial.to_string())
        .unwrap();
    let selections = vec![selection("legacy", &source, vec![])];
    assert!(
        SkillService::preview_import_for_target(&db, &skill.target, &selections)
            .unwrap_err()
            .to_string()
            .contains("仍有投放登记")
    );
    let mut other: serde_json::Value = serde_json::from_str(&raw).unwrap();
    other["placements"] = serde_json::json!([]);
    other["sources"][0]["id"] = serde_json::json!("different-owner");
    db.set_setting("skill_placement_registry_v1", &other.to_string())
        .unwrap();
    assert!(
        SkillService::preview_import_for_target(&db, &skill.target, &selections)
            .unwrap_err()
            .to_string()
            .contains("其他资产")
    );
}
