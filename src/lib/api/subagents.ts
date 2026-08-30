import { invoke } from './invoke';
import type {
  AgentType,
  ConfigContext,
  DiscoverableSubagent,
  InstalledSubagent,
  ScopeTarget,
  SubagentBackupEntry,
  SubagentRepo,
  SubagentUninstallResult,
  SubagentUpdateInfo,
} from '../../types';

export async function getInstalledSubagents(context: ConfigContext): Promise<InstalledSubagent[]> {
  return invoke('get_installed_subagents', { context });
}

export async function discoverAvailableSubagents(
  target: ScopeTarget,
): Promise<DiscoverableSubagent[]> {
  return invoke('discover_available_subagents', { target });
}

export async function installSubagent(
  subagent: DiscoverableSubagent,
  target: ScopeTarget,
  initialApp: AgentType,
): Promise<InstalledSubagent> {
  return invoke('install_subagent', { subagent, target, initialApp });
}

export async function uninstallSubagent(
  id: string,
  target: ScopeTarget,
): Promise<SubagentUninstallResult> {
  return invoke('uninstall_subagent', { id, target });
}

export async function toggleSubagentApp(
  id: string,
  target: ScopeTarget,
  app: AgentType,
  enabled: boolean,
): Promise<void> {
  return invoke('toggle_subagent_app', { id, target, app, enabled });
}

export async function checkSubagentUpdates(target: ScopeTarget): Promise<SubagentUpdateInfo[]> {
  return invoke('check_subagent_updates', { target });
}

export async function updateSubagent(id: string, target: ScopeTarget): Promise<InstalledSubagent> {
  return invoke('update_subagent', { id, target });
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

export async function getSubagentBackups(target: ScopeTarget): Promise<SubagentBackupEntry[]> {
  return invoke('get_subagent_backups', { target });
}

export async function restoreSubagentBackup(
  backupId: string,
  target: ScopeTarget,
): Promise<InstalledSubagent> {
  return invoke('restore_subagent_backup', { backupId, target });
}

export async function deleteSubagentBackup(backupId: string, target: ScopeTarget): Promise<void> {
  return invoke('delete_subagent_backup', { backupId, target });
}
