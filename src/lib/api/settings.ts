import { invoke } from './invoke';
import type {
  AppSettings,
  MigrationSummary,
  SetSettingRequest,
  StorageLocation,
} from '../../types';

export async function getSettings(): Promise<AppSettings> {
  return invoke('get_settings_command');
}

export async function setSettings(settings: AppSettings): Promise<void> {
  return invoke('set_settings_command', { settings });
}

export async function migrateStorage(target: StorageLocation): Promise<MigrationSummary> {
  return invoke('migrate_storage', { target });
}

export async function getSetting(key: string): Promise<string | undefined> {
  return invoke('get_setting_command', { key });
}

export async function setSetting(request: SetSettingRequest): Promise<void> {
  return invoke('set_setting_command', { request });
}
