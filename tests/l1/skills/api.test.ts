import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type {
  ConfigContext,
  DiscoverableSkill,
  InstalledSkill,
  ScopeTarget,
  SkillRepo,
} from '../../../src/types';

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
    const context: ConfigContext = { kind: 'project', projectId: 'project-alpha' };
    const expected: InstalledSkill[] = [];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadSkillsApi();
    const result = await api.getInstalledSkills(context);
    expect(mockInvoke).toHaveBeenCalledWith('get_installed_skills', { context });
    expect(result).toBe(expected);
  });

  it('discoverAvailableSkills invokes the correct command', async () => {
    const target: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
    const expected: DiscoverableSkill[] = [];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadSkillsApi();
    const result = await api.discoverAvailableSkills(target);
    expect(mockInvoke).toHaveBeenCalledWith('discover_available_skills', { target });
    expect(result).toBe(expected);
  });

  it('installSkill forwards skill, complete target and initialApp', async () => {
    const target: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
    const skill: DiscoverableSkill = {
      key: 'a/b:foo',
      name: 'Foo',
      description: 'desc',
      directory: 'foo',
      repoOwner: 'a',
      repoName: 'b',
      repoBranch: 'main',
      installed: false,
    };
    mockInvoke.mockResolvedValue({
      ...skill,
      id: skill.key,
      apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
      installedAt: 1,
      updatedAt: 0,
    });
    const api = await loadSkillsApi();
    await api.installSkill(skill, target, 'codex');
    expect(mockInvoke).toHaveBeenCalledWith('install_skill', {
      skill,
      target,
      initialApp: 'codex',
    });
  });

  it('existing Skill mutations forward the row ownership target', async () => {
    const target: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
    mockInvoke.mockResolvedValue(undefined);
    const api = await loadSkillsApi();
    await api.toggleSkillApp('id-1', target, 'gemini-cli', true);
    expect(mockInvoke).toHaveBeenCalledWith('toggle_skill_app', {
      id: 'id-1',
      target,
      app: 'gemini-cli',
      enabled: true,
    });

    await api.updateSkill('id-1', target);
    expect(mockInvoke).toHaveBeenCalledWith('update_skill', { id: 'id-1', target });

    await api.uninstallSkill('id-1', target);
    expect(mockInvoke).toHaveBeenCalledWith('uninstall_skill', { id: 'id-1', target });
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
