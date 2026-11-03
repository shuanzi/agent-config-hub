//! Explicit project CLI launch. Desktop/IDE sessions are not affected.
use super::{
    project::{ConfigContext, ProjectService, ScopeTarget},
    skill_matrix, skill_policy,
};
use crate::{config, database::Database, error::AppError};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedSkill {
    pub id: String,
    pub name: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProjectLaunch {
    pub project_id: String,
    pub project_root: PathBuf,
    pub codex_home: PathBuf,
    pub executable_path: Option<PathBuf>,
    pub args: Vec<String>,
    pub excluded_skills: Vec<ExcludedSkill>,
    pub revision: String,
    pub reason: Option<String>,
    pub notice: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub handed_off: bool,
}
fn conflict(message: impl Into<String>) -> AppError {
    AppError::Conflict(message.into())
}
fn executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}
fn find_cli() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join("codex"))
            .find(|path| executable(path))
    }) {
        return path.canonicalize().ok();
    }
    let output = tempfile::tempfile().ok()?;
    let mut child = Command::new("/bin/zsh")
        .args(["-lic", "command -v codex"])
        .stdout(std::process::Stdio::from(output.try_clone().ok()?))
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match child.try_wait().ok()? {
            Some(status) if status.success() => break,
            Some(_) => return None,
            None if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
    use std::io::{Read, Seek};
    let mut output = output;
    output.rewind().ok()?;
    let mut text = String::new();
    output.read_to_string(&mut text).ok()?;
    text.lines()
        .rev()
        .map(|line| PathBuf::from(line.trim()))
        .find(|path| path.is_absolute() && executable(path))
        .and_then(|path| path.canonicalize().ok())
}
pub fn get(db: &Arc<Database>, project_id: &str) -> Result<CodexProjectLaunch, AppError> {
    let target = ScopeTarget::Project {
        project_id: project_id.into(),
    };
    let project_root = ProjectService::resolve_scope_target(db, &target)?
        .project_root
        .unwrap();
    let policy_path = skill_policy::codex_project_path(db, &target)?;
    let ids = skill_policy::codex_ids(&policy_path)?;
    skill_policy::codex_user_rules("", &[])?;
    let rows = skill_matrix::rows_for_ids(
        db,
        &ConfigContext::Project {
            project_id: project_id.into(),
        },
        &ids,
    )?;
    let mut documents = vec![];
    let mut excluded_skills = vec![];
    let mut observations = vec![];
    for row in rows.into_iter().filter(|row| ids.contains(&row.skill.id)) {
        let cell = row
            .cells
            .iter()
            .find(|cell| cell.agent == super::skill_placement::SkillLocation::Codex)
            .unwrap();
        if let Some(reason) = &cell.reason {
            if !reason.starts_with("Codex 用户配置已停用") {
                return Err(conflict(reason.clone()));
            }
        }
        let paths = skill_matrix::policy_skill_paths(
            db,
            &row.skill,
            &target,
            super::skill_placement::SkillLocation::Codex,
        )?;
        observations.push(json!({"id":row.skill.id,"revision":cell.revision,"paths":paths}));
        documents.extend(paths);
        if !excluded_skills
            .iter()
            .any(|entry: &ExcludedSkill| entry.id == row.skill.id)
        {
            excluded_skills.push(ExcludedSkill {
                id: row.skill.id,
                name: row.skill.name,
            });
        }
    }
    documents.sort();
    documents.dedup();
    let rules = documents
        .iter()
        .map(|path| {
            let mut rule = toml::map::Map::new();
            rule.insert(
                "path".into(),
                toml::Value::String(path.display().to_string()),
            );
            rule.insert("enabled".into(), toml::Value::Boolean(false));
            toml::Value::Table(rule)
        })
        .collect();
    let mut args = vec!["-C".into(), project_root.display().to_string()];
    if !documents.is_empty() {
        args.extend([
            "-c".into(),
            format!("skills.config={}", toml::Value::Array(rules)),
        ]);
    }
    let executable_path = find_cli();
    let signature = executable_path
        .as_ref()
        .and_then(|path| fs::metadata(path).ok())
        .map(|meta| (meta.len(), meta.modified().ok()));
    let codex_home = config::get_codex_config_dir();
    let revision = format!("{:x}",Sha256::digest(json!({"project":project_root,"home":codex_home,"cli":executable_path,"signature":signature,"policy":skill_policy::read(&policy_path)?,"observations":observations,"args":args}).to_string().as_bytes()));
    let notice = (excluded_skills.len()
        < ids.iter().collect::<std::collections::HashSet<_>>().len())
    .then(|| "部分排除来源已不存在；规则保留，重新安装同身份来源后继续适用。".into());
    let reason = executable_path
        .is_none()
        .then(|| "未找到 Codex CLI，请安装后重新读取启动计划。".into());
    Ok(CodexProjectLaunch {
        project_id: project_id.into(),
        project_root,
        codex_home,
        executable_path,
        args,
        excluded_skills,
        revision,
        reason,
        notice,
    })
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
pub(crate) fn script(plan: &CodexProjectLaunch) -> Result<String, AppError> {
    let executable = plan
        .executable_path
        .as_ref()
        .ok_or_else(|| conflict("未找到 Codex CLI。"))?;
    Ok(format!("#!/bin/zsh\n# Generated by Agent Config Manager.\ncd -- {} || exit 1\nexec /usr/bin/env {} {} {}\n",quote(&plan.project_root.display().to_string()),quote(&format!("CODEX_HOME={}",plan.codex_home.display())),quote(&executable.display().to_string()),plan.args.iter().map(|arg|quote(arg)).collect::<Vec<_>>().join(" ")))
}
fn terminal_command(path: &Path) -> Command {
    let mut command = Command::new("/usr/bin/open");
    command.args(["-a", "Terminal"]).arg(path);
    command
}
pub fn launch(
    db: &Arc<Database>,
    project_id: &str,
    expected_revision: &str,
) -> Result<LaunchResult, AppError> {
    let plan = get(db, project_id)?;
    if plan.revision != expected_revision {
        return Err(conflict("启动计划已变化，请重新读取后启动。"));
    }
    if let Some(reason) = &plan.reason {
        return Err(conflict(reason.clone()));
    }
    let directory = config::get_hub_dir().join("launchers");
    skill_matrix::safe_path(&directory)?;
    fs::create_dir_all(&directory).map_err(|error| AppError::io(&directory, error))?;
    let mut temp = tempfile::Builder::new()
        .prefix("codex-project-")
        .suffix(".command")
        .tempfile_in(&directory)
        .map_err(|error| AppError::io(&directory, error))?;
    use std::io::Write;
    temp.write_all(script(&plan)?.as_bytes())
        .map_err(|error| AppError::io(temp.path(), error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o700))
            .map_err(|error| AppError::io(temp.path(), error))?;
    }
    let (_, path) = temp
        .keep()
        .map_err(|error| AppError::io(&directory, error.error))?;
    let result = terminal_command(&path)
        .status()
        .map_err(|error| AppError::io(&path, error));
    match result {
        Ok(status) if status.success() => Ok(LaunchResult { handed_off: true }),
        result => {
            let _ = fs::remove_file(&path);
            match result {
                Err(error) => Err(error),
                _ => Err(conflict("无法将 Codex 启动交给 macOS Terminal。")),
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn script_and_terminal_arguments_preserve_literal_paths() {
        let root = "/tmp/a '$HOME $(touch nope)`echo bad`\n中文";
        let plan = CodexProjectLaunch {
            project_id: "p".into(),
            project_root: root.into(),
            codex_home: "/tmp/test-home/.codex".into(),
            executable_path: Some("/usr/bin/printf".into()),
            args: vec!["%s".into(), root.into()],
            excluded_skills: vec![],
            revision: "r".into(),
            reason: None,
            notice: None,
        };
        let directory = tempfile::tempdir().unwrap();
        let mut plan = plan;
        plan.project_root = directory.path().into();
        let output = Command::new("/bin/zsh")
            .arg("-c")
            .arg(script(&plan).unwrap())
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap(), root);
        let command = terminal_command(Path::new(root));
        assert_eq!(command.get_program(), "/usr/bin/open");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            ["-a", "Terminal", root]
        );
    }
}
