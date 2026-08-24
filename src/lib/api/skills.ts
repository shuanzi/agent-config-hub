import { invoke } from './invoke';
import type {
  AgentType,
  DiscoverableSkill,
  ImportSkillSelection,
  InstalledSkill,
  SkillBackupEntry,
  SkillRepo,
  SkillUninstallResult,
  SkillUpdateInfo,
  UnmanagedSkill,
} from '../../types';

export async function getInstalledSkills(): Promise<InstalledSkill[]> {
  return invoke('get_installed_skills');
}

export async function discoverAvailableSkills(): Promise<DiscoverableSkill[]> {
  return invoke('discover_available_skills');
}

export async function installSkill(
  skill: DiscoverableSkill,
  currentApp: AgentType,
): Promise<InstalledSkill> {
  return invoke('install_skill', { skill, currentApp });
}

export async function uninstallSkill(id: string): Promise<SkillUninstallResult> {
  return invoke('uninstall_skill', { id });
}

export async function toggleSkillApp(id: string, app: AgentType, enabled: boolean): Promise<void> {
  return invoke('toggle_skill_app', { id, app, enabled });
}

export async function checkSkillUpdates(): Promise<SkillUpdateInfo[]> {
  return invoke('check_skill_updates');
}

export async function updateSkill(id: string): Promise<InstalledSkill> {
  return invoke('update_skill', { id });
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

export async function scanUnmanagedSkills(): Promise<UnmanagedSkill[]> {
  return invoke('scan_unmanaged_skills');
}

export async function importSkillsFromApps(
  selections: ImportSkillSelection[],
): Promise<InstalledSkill[]> {
  return invoke('import_skills_from_apps', { selections });
}

export async function installSkillsFromZip(
  filePath: string,
  currentApp: AgentType,
): Promise<InstalledSkill[]> {
  return invoke('install_skills_from_zip', { filePath, currentApp });
}

export async function getSkillBackups(): Promise<SkillBackupEntry[]> {
  return invoke('get_skill_backups');
}

export async function restoreSkillBackup(
  backupId: string,
  currentApp: AgentType,
): Promise<InstalledSkill> {
  return invoke('restore_skill_backup', { backupId, currentApp });
}

export async function deleteSkillBackup(backupId: string): Promise<void> {
  return invoke('delete_skill_backup', { backupId });
}
