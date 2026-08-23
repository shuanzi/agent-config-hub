import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { DiscoverableSkill, InstalledSkill, SkillRepo } from '../../../src/types';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

// 动态导入被测模块，确保 mock 先生效
async function loadSkillsApi() {
  const mod = await import('../../../src/lib/api/skills');
  return mod;
}

async function loadSettingsApi() {
  const mod = await import('../../../src/lib/api/settings');
  return mod;
}

describe('skills API wrappers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__;
    }
  });

  it('getInstalledSkills invokes the correct command', async () => {
    const expected: InstalledSkill[] = [];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadSkillsApi();
    const result = await api.getInstalledSkills();
    expect(mockInvoke).toHaveBeenCalledWith('get_installed_skills', undefined);
    expect(result).toBe(expected);
  });

  it('discoverAvailableSkills invokes the correct command', async () => {
    const expected: DiscoverableSkill[] = [];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadSkillsApi();
    const result = await api.discoverAvailableSkills();
    expect(mockInvoke).toHaveBeenCalledWith('discover_available_skills', undefined);
    expect(result).toBe(expected);
  });

  it('installSkill forwards skill and currentApp', async () => {
    const skill: DiscoverableSkill = {
      key: 'a/b:foo',
      name: 'Foo',
      description: 'desc',
      directory: 'foo',
      repoOwner: 'a',
      repoName: 'b',
      repoBranch: 'main',
    };
    mockInvoke.mockResolvedValue({
      ...skill,
      id: skill.key,
      apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
      installedAt: 1,
      updatedAt: 0,
    });
    const api = await loadSkillsApi();
    await api.installSkill(skill, 'codex');
    expect(mockInvoke).toHaveBeenCalledWith('install_skill', { skill, currentApp: 'codex' });
  });

  it('toggleSkillApp forwards id, app and enabled', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const api = await loadSkillsApi();
    await api.toggleSkillApp('id-1', 'gemini-cli', true);
    expect(mockInvoke).toHaveBeenCalledWith('toggle_skill_app', {
      id: 'id-1',
      app: 'gemini-cli',
      enabled: true,
    });
  });

  it('addSkillRepo forwards repo payload', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const repo: SkillRepo = { owner: 'anthropics', name: 'skills', branch: 'main', enabled: true };
    const api = await loadSkillsApi();
    await api.addSkillRepo(repo);
    expect(mockInvoke).toHaveBeenCalledWith('add_skill_repo', { repo });
  });

  it('settings API forwards get and set commands', async () => {
    mockInvoke.mockResolvedValue({ syncMethod: 'auto', storageLocation: 'hub' });
    const api = await loadSettingsApi();
    const settings = await api.getSettings();
    expect(mockInvoke).toHaveBeenCalledWith('get_settings_command', undefined);
    expect(settings.syncMethod).toBe('auto');

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    await api.setSettings(settings);
    expect(mockInvoke).toHaveBeenCalledWith('set_settings_command', { settings });
  });

  it('migrateStorage invokes the combined migrate command', async () => {
    const api = await loadSettingsApi();
    mockInvoke.mockResolvedValue({
      skill: { migratedCount: 1, skippedCount: 0, errors: [] },
      subagent: { migratedCount: 0, skippedCount: 0, errors: [] },
    });
    const result = await api.migrateStorage('unified');
    expect(mockInvoke).toHaveBeenCalledWith('migrate_storage', { target: 'unified' });
    expect(result.skill.migratedCount).toBe(1);
  });
});
