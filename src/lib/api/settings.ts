import { invoke } from './invoke';
import type {
  AgentType,
  AppSettings,
  MigrationSummary,
  SetSettingRequest,
  StorageLocation,
  SyncMethod,
} from '../../types';

export async function getSettings(): Promise<AppSettings> {
  return invoke('get_settings_command');
}

export async function setSettings(settings: AppSettings): Promise<void> {
  return invoke('set_settings_command', { settings });
}

export async function setSyncMethod(method: SyncMethod): Promise<void> {
  return invoke('set_sync_method_command', { method });
}

export async function migrateStorage(target: StorageLocation): Promise<MigrationSummary> {
  return invoke('migrate_storage', { target });
}

export async function setAgentOverrideDir(app: AgentType, dir: string | null): Promise<void> {
  return invoke('set_agent_override_dir', { app, dir });
}

export async function getSetting(key: string): Promise<string | undefined> {
  return invoke('get_setting_command', { key });
}

export async function setSetting(request: SetSettingRequest): Promise<void> {
  return invoke('set_setting_command', { request });
}
