import { invoke } from './invoke';
import type {
  AgentType,
  ConfigContext,
  DiscoverableSkill,
  ImportSkillSelection,
  InstalledSkill,
  ScopeTarget,
  SkillBackupEntry,
  SkillRepo,
  SkillUninstallResult,
  SkillUpdateInfo,
  UnmanagedSkill,
} from '../../types';

export async function getInstalledSkills(context: ConfigContext): Promise<InstalledSkill[]> {
  return invoke('get_installed_skills', { context });
}

export async function discoverAvailableSkills(target: ScopeTarget): Promise<DiscoverableSkill[]> {
  return invoke('discover_available_skills', { target });
}

export async function installSkill(
  skill: DiscoverableSkill,
  target: ScopeTarget,
  currentApp: AgentType,
): Promise<InstalledSkill> {
  return invoke('install_skill', { skill, target, currentApp });
}

export async function uninstallSkill(
  id: string,
  target: ScopeTarget,
): Promise<SkillUninstallResult> {
  return invoke('uninstall_skill', { id, target });
}

export async function toggleSkillApp(
  id: string,
  target: ScopeTarget,
  app: AgentType,
  enabled: boolean,
): Promise<void> {
  return invoke('toggle_skill_app', { id, target, app, enabled });
}

export async function checkSkillUpdates(target: ScopeTarget): Promise<SkillUpdateInfo[]> {
  return invoke('check_skill_updates', { target });
}

export async function updateSkill(id: string, target: ScopeTarget): Promise<InstalledSkill> {
  return invoke('update_skill', { id, target });
}

export async function getSkillRepos(): Promise<SkillRepo[]> {
  return invoke('get_skill_repos');
}

export async function addSkillRepo(repo: SkillRepo): Promise<void> {
  return invoke('add_skill_repo', { repo });
}

export async function removeSkillRepo(owner: string, name: string): Promise<void> {
  return invoke('remove_skill_repo', { owner, name });
}

export async function scanUnmanagedSkills(target: ScopeTarget): Promise<UnmanagedSkill[]> {
  return invoke('scan_unmanaged_skills', { target });
}

export async function importSkillsFromApps(
  selections: ImportSkillSelection[],
  target: ScopeTarget,
): Promise<InstalledSkill[]> {
  return invoke('import_skills_from_apps', { selections, target });
}

export async function installSkillsFromZip(
  filePath: string,
  currentApp: AgentType,
  target: ScopeTarget,
): Promise<InstalledSkill[]> {
  return invoke('install_skills_from_zip', { filePath, currentApp, target });
}

export async function getSkillBackups(target: ScopeTarget): Promise<SkillBackupEntry[]> {
  return invoke('get_skill_backups', { target });
}

export async function restoreSkillBackup(
  backupId: string,
  target: ScopeTarget,
): Promise<InstalledSkill> {
  return invoke('restore_skill_backup', { backupId, target });
}

export async function deleteSkillBackup(backupId: string, target: ScopeTarget): Promise<void> {
  return invoke('delete_skill_backup', { backupId, target });
}
