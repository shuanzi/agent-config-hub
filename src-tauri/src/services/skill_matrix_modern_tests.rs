// Modern OpenCode policy regressions share the isolated matrix fixtures.
fn modern_fixture(
    text: &str,
    persistent: bool,
) -> (Home, Arc<Database>, InstalledSkill, ScopeTarget, PathBuf) {
    let (home, db, skill, target, _) = setup_with_database(persistent);
    placement::sync(&db, &skill, SkillLocation::Shared).unwrap();
    let root = ProjectService::resolve_scope_target(&db, &target)
        .unwrap()
        .project_root
        .unwrap();
    let path = root.join("opencode.jsonc");
    fs::write(&path, text).unwrap();
    (home, db, skill, target, path)
}
fn modern_value(path: &Path) -> Value {
    super::super::jsonc_document::parse(&fs::read_to_string(path).unwrap())
        .unwrap()
        .value
}
fn modern_saved(db: &Arc<Database>) -> (String, String) {
    let key: String = db
        .conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT key FROM settings WHERE key LIKE 'opencode_skill_exclusion_v1:%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let value = db.get_setting(&key).unwrap().unwrap();
    (key, value)
}
fn modern_toggle(db: &Arc<Database>, skill: &InstalledSkill, target: &ScopeTarget, enabled: bool) {
    let result = apply(
        db,
        vec![request(db, skill, target, SkillLocation::OpenCode, enabled)],
    );
    assert!(result[0].applied, "{:?}", result[0].error);
}
#[test]
#[serial]
fn opencode_modern_native_denies_without_ownership_are_preserved() {
    for fallback in [None, Some("allow"), Some("ask")] {
        let mut entries = vec![];
        if let Some(effect) = fallback {
            entries.push(json!({"action":"skill","resource":"*","effect":effect}));
        }
        entries.push(json!({"action":"skill","resource":"code-review","effect":"deny"}));
        entries.push(
            json!({"action":"skill","resource":"code-review","effect":"deny","note":"native"}),
        );
        let original = json!({"permissions":entries}).to_string();
        let (_home, db, skill, target, path) = modern_fixture(&original, false);
        let state = cell(&db, &skill, &target, SkillLocation::OpenCode).unwrap();
        assert!(!state.checked && state.reason.unwrap().contains("归属记录"));
        let enable = request(&db, &skill, &target, SkillLocation::OpenCode, true);
        assert!(preview(&db, vec![enable.clone()])[0].reason.is_some());
        assert!(!apply(&db, vec![enable])[0].applied);
        assert!(super::super::skill_policy::apply(
            &db,
            &skill,
            &target,
            SkillLocation::OpenCode,
            true
        )
        .is_err());
        super::super::skill_policy::apply(&db, &skill, &target, SkillLocation::OpenCode, false)
            .unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), original);
    }
}
#[test]
#[serial]
fn opencode_modern_repeated_toggles_preserve_ordered_native_duplicates() {
    let original = r#"{ // header
      "permissions":[
        {"action":"skill","resource":"code-review","effect":"deny","note":"native-one"},
        {"action":"skill","resource":"code-review","effect":"deny"},
        {"action":"skill","resource":"*","effect":"ask"},
        {"action":"skill","resource":"other","effect":"deny"}
      ], "unknown":42 // tail
    }"#;
    let (_home, db, skill, target, path) = modern_fixture(original, false);
    let before = modern_value(&path);
    for _ in 0..2 {
        modern_toggle(&db, &skill, &target, false);
        let (_, saved) = modern_saved(&db);
        for _ in 0..2 {
            super::super::skill_policy::apply(&db, &skill, &target, SkillLocation::OpenCode, false)
                .unwrap();
            assert_eq!(modern_saved(&db).1, saved);
        }
        let disabled = modern_value(&path);
        assert_eq!(disabled["permissions"].as_array().unwrap().len(), 5);
        assert_eq!(
            &disabled["permissions"].as_array().unwrap()[..4],
            before["permissions"].as_array().unwrap()
        );
        modern_toggle(&db, &skill, &target, true);
        super::super::skill_policy::apply(&db, &skill, &target, SkillLocation::OpenCode, true)
            .unwrap();
        assert_eq!(modern_value(&path), before);
        assert!(cell(&db, &skill, &target, SkillLocation::OpenCode)
            .unwrap()
            .notice
            .is_some());
        assert_eq!(modern_saved(&db).1, "null");
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("// header") && text.contains("// tail"));
    }
}
#[test]
#[serial]
fn opencode_modern_ownership_survives_database_reopen() {
    let original = r#"{"permissions":[{"action":"skill","resource":"code-review","effect":"deny"},{"action":"skill","resource":"*","effect":"allow"}]}"#;
    let (_home, db, skill, target, path) = modern_fixture(original, true);
    let before = modern_value(&path);
    modern_toggle(&db, &skill, &target, false);
    drop(db);
    let db = Arc::new(Database::init().unwrap());
    modern_toggle(&db, &skill, &target, true);
    assert_eq!(modern_value(&path), before);
}
#[test]
#[serial]
fn opencode_modern_external_related_edits_are_not_adopted_after_refresh() {
    let (_home, db, skill, target, path) = modern_fixture(
        r#"{"permissions":[{"action":"skill","resource":"*","effect":"allow"}],"unknown":1}"#,
        false,
    );
    modern_toggle(&db, &skill, &target, false);
    let disabled = fs::read_to_string(&path).unwrap();
    let original = modern_value(&path);
    let enable = request(&db, &skill, &target, SkillLocation::OpenCode, true);
    for mutation in 0..5 {
        let mut changed = original.clone();
        let rules = changed["permissions"].as_array_mut().unwrap();
        match mutation {
            0 => rules.last_mut().unwrap()["effect"] = json!("ask"),
            1 => rules.last_mut().unwrap()["note"] = json!("external native"),
            2 => rules.push(rules.last().unwrap().clone()),
            3 => {
                rules.swap(0, 1);
            }
            _ => {
                rules.pop();
            }
        }
        let text = changed.to_string();
        fs::write(&path, &text).unwrap();
        assert!(cell(&db, &skill, &target, SkillLocation::OpenCode).is_err());
        assert!(!apply(&db, vec![enable.clone()])[0].applied);
        assert!(super::super::skill_policy::apply(
            &db,
            &skill,
            &target,
            SkillLocation::OpenCode,
            true
        )
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
    }
    fs::write(&path, disabled).unwrap();
    // An unrelated rule inserted before our entry shifts its absolute index.
    let mut changed = original;
    changed["unknown"] = json!(2);
    changed["permissions"].as_array_mut().unwrap().insert(
        0,
        json!({"action":"skill","resource":"other","effect":"deny"}),
    );
    fs::write(&path, changed.to_string()).unwrap();
    assert!(apply(&db, vec![enable])[0].applied);
    changed["permissions"].as_array_mut().unwrap().pop();
    assert_eq!(modern_value(&path), changed);
}
#[test]
#[serial]
fn opencode_modern_cross_file_changes_and_corrupt_ownership_block_restore() {
    let (_home, db, skill, target, path) = modern_fixture(
        r#"{"permissions":[{"action":"skill","resource":"*","effect":"allow"}]}"#,
        false,
    );
    let global = config::get_opencode_config_dir().join("opencode.json");
    fs::create_dir_all(global.parent().unwrap()).unwrap();
    let parent =
        r#"{"permissions":[{"action":"skill","resource":"*","effect":"ask"}],"unknown":1}"#;
    fs::write(&global, parent).unwrap();
    modern_toggle(&db, &skill, &target, false);
    let disabled = fs::read_to_string(&path).unwrap();
    let enable = request(&db, &skill, &target, SkillLocation::OpenCode, true);
    fs::write(&global, parent.replace("ask", "deny")).unwrap();
    assert!(cell(&db, &skill, &target, SkillLocation::OpenCode).is_err());
    assert!(!apply(&db, vec![enable.clone()])[0].applied);
    assert_eq!(fs::read_to_string(&path).unwrap(), disabled);
    fs::write(&global, parent.replace(r#""unknown":1"#, r#""unknown":2"#)).unwrap();
    let (key, saved) = modern_saved(&db);
    let mut incomplete: Value = serde_json::from_str(&saved).unwrap();
    incomplete.as_object_mut().unwrap().remove("modern");
    db.set_setting(&key, &incomplete.to_string()).unwrap();
    assert!(!apply(&db, vec![enable.clone()])[0].applied);
    assert_eq!(fs::read_to_string(&path).unwrap(), disabled);
    db.set_setting(&key, &saved).unwrap();
    assert!(apply(&db, vec![enable])[0].applied);
}
#[test]
#[serial]
fn opencode_modern_bulk_resolves_owned_instances_after_index_shifts() {
    let original = r#"{"permissions":[{"action":"skill","resource":"code-review","effect":"deny"},{"action":"skill","resource":"other","effect":"deny"},{"action":"skill","resource":"*","effect":"allow"}]}"#;
    let (_home, db, skill, target, path) = modern_fixture(original, false);
    let before = modern_value(&path);
    let mut other = skill.clone();
    other.id = "other".into();
    other.name = "other".into();
    other.directory = "other".into();
    let source = source(&db, &other).unwrap();
    fs::create_dir_all(&source).unwrap();
    fs::write(
        source.join("SKILL.md"),
        "---\nname: other\ndescription: other\n---\nother",
    )
    .unwrap();
    db.save_skill(&other).unwrap();
    placement::register_source(&db, &other).unwrap();
    placement::sync(&db, &other, SkillLocation::Shared).unwrap();
    for enabled in [false, true] {
        let changes = [&skill, &other]
            .map(|s| request(&db, s, &target, SkillLocation::OpenCode, enabled))
            .to_vec();
        let results = apply(&db, changes);
        assert!(
            results.iter().all(|r| r.applied),
            "{}",
            serde_json::to_string(&results).unwrap()
        );
    }
    assert_eq!(modern_value(&path), before);
}
#[cfg(unix)]
#[test]
#[serial]
fn opencode_modern_save_and_restore_failures_keep_retryable_ownership() {
    use std::os::unix::fs::PermissionsExt;
    let original = r#"{"permissions":[{"action":"skill","resource":"*","effect":"ask"}]}"#;
    let (_home, db, skill, target, path) = modern_fixture(original, false);
    db.conn
        .lock()
        .unwrap()
        .execute_batch("PRAGMA query_only=ON")
        .unwrap();
    let disable = request(&db, &skill, &target, SkillLocation::OpenCode, false);
    assert!(!apply(&db, vec![disable])[0].applied);
    db.conn
        .lock()
        .unwrap()
        .execute_batch("PRAGMA query_only=OFF")
        .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    let root = path.parent().unwrap();
    let permissions = fs::metadata(root).unwrap().permissions();
    let disable = request(&db, &skill, &target, SkillLocation::OpenCode, false);
    fs::set_permissions(root, fs::Permissions::from_mode(0o500)).unwrap();
    let result = apply(&db, vec![disable]);
    fs::set_permissions(root, permissions.clone()).unwrap();
    assert!(!result[0].applied);
    assert_eq!(modern_saved(&db).1, "null");
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    modern_toggle(&db, &skill, &target, false);
    let disabled = fs::read_to_string(&path).unwrap();
    let saved = modern_saved(&db).1;
    let enable = request(&db, &skill, &target, SkillLocation::OpenCode, true);
    fs::set_permissions(root, fs::Permissions::from_mode(0o500)).unwrap();
    let result = apply(&db, vec![enable]);
    fs::set_permissions(root, permissions).unwrap();
    assert!(!result[0].applied);
    assert_eq!(modern_saved(&db).1, saved);
    assert_eq!(fs::read_to_string(&path).unwrap(), disabled);
    let enable = request(&db, &skill, &target, SkillLocation::OpenCode, true);
    db.conn
        .lock()
        .unwrap()
        .execute_batch("PRAGMA query_only=ON")
        .unwrap();
    let result = apply(&db, vec![enable]);
    db.conn
        .lock()
        .unwrap()
        .execute_batch("PRAGMA query_only=OFF")
        .unwrap();
    assert!(!result[0].applied);
    assert_eq!(modern_saved(&db).1, saved);
    assert_eq!(fs::read_to_string(&path).unwrap(), disabled);
    modern_toggle(&db, &skill, &target, true);
    assert_eq!(
        modern_value(&path),
        serde_json::from_str::<Value>(original).unwrap()
    );
}
#[cfg(unix)]
#[test]
#[serial]
fn opencode_modern_failed_backup_rollback_is_reported_without_overwriting_native_rules() {
    use std::os::unix::fs::PermissionsExt;
    let original = r#"{"permissions":[{"action":"skill","resource":"*","effect":"ask"}]}"#;
    let (_home, db, skill, target, path) = modern_fixture(original, false);
    db.conn.lock().unwrap().execute_batch("CREATE TRIGGER reject_exclusion_cleanup BEFORE INSERT ON settings WHEN NEW.key LIKE 'opencode_skill_exclusion_v1:%' AND NEW.value = 'null' BEGIN SELECT RAISE(FAIL, 'blocked cleanup'); END;").unwrap();
    let disable = request(&db, &skill, &target, SkillLocation::OpenCode, false);
    let root = path.parent().unwrap();
    let permissions = fs::metadata(root).unwrap().permissions();
    fs::set_permissions(root, fs::Permissions::from_mode(0o500)).unwrap();
    let result = apply(&db, vec![disable]);
    fs::set_permissions(root, permissions).unwrap();
    assert!(result[0]
        .error
        .as_ref()
        .unwrap()
        .contains("原权限记录回滚失败"));
    assert_ne!(modern_saved(&db).1, "null");
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    assert!(cell(&db, &skill, &target, SkillLocation::OpenCode).is_err());
}
#[test]
#[serial]
fn opencode_modern_change_keeps_older_legacy_records_readable() {
    let original = r#"{"permission":{"skill":{"code-review":"ask"}}}"#;
    let (_home, db, skill, target, path) = modern_fixture(original, false);
    modern_toggle(&db, &skill, &target, false);
    let (key, saved) = modern_saved(&db);
    let mut old: Value = serde_json::from_str(&saved).unwrap();
    old.as_object_mut().unwrap().remove("modern");
    db.set_setting(&key, &old.to_string()).unwrap();
    modern_toggle(&db, &skill, &target, true);
    assert_eq!(fs::read_to_string(path).unwrap(), original);
}
