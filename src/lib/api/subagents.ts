import { invoke } from './invoke';
import type {
  AgentType,
  DiscoverableSubagent,
  InstalledSubagent,
  MigrationResult,
  SubagentBackupEntry,
  SubagentRepo,
  SubagentUninstallResult,
  SubagentUpdateInfo,
  StorageLocation,
} from '../../types';

export async function getInstalledSubagents(): Promise<InstalledSubagent[]> {
  return invoke('get_installed_subagents');
}

export async function discoverAvailableSubagents(): Promise<DiscoverableSubagent[]> {
  return invoke('discover_available_subagents');
}

export async function installSubagent(
  subagent: DiscoverableSubagent,
  currentApp: AgentType,
): Promise<InstalledSubagent> {
  return invoke('install_subagent', { subagent, currentApp });
}

export async function uninstallSubagent(id: string): Promise<SubagentUninstallResult> {
  return invoke('uninstall_subagent', { id });
}

export async function toggleSubagentApp(
  id: string,
  app: AgentType,
  enabled: boolean,
): Promise<void> {
  return invoke('toggle_subagent_app', { id, app, enabled });
}

export async function checkSubagentUpdates(): Promise<SubagentUpdateInfo[]> {
  return invoke('check_subagent_updates');
}

export async function updateSubagent(id: string): Promise<InstalledSubagent> {
  return invoke('update_subagent', { id });
}

export async function getSubagentRepos(): Promise<SubagentRepo[]> {
  return invoke('get_subagent_repos');
}

export async function addSubagentRepo(repo: SubagentRepo): Promise<void> {
  return invoke('add_subagent_repo', { repo });
}

export async function removeSubagentRepo(owner: string, name: string): Promise<void> {
  return invoke('remove_subagent_repo', { owner, name });
}

export async function getSubagentBackups(): Promise<SubagentBackupEntry[]> {
  return invoke('get_subagent_backups');
}

export async function restoreSubagentBackup(
  backupId: string,
  currentApp: AgentType,
): Promise<InstalledSubagent> {
  return invoke('restore_subagent_backup', { backupId, currentApp });
}

export async function deleteSubagentBackup(backupId: string): Promise<void> {
  return invoke('delete_subagent_backup', { backupId });
}

export async function migrateSubagentStorage(target: StorageLocation): Promise<MigrationResult> {
  return invoke('migrate_subagent_storage', { target });
}
