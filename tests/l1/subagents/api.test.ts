import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { DiscoverableSubagent, InstalledSubagent, SubagentRepo } from '../../../src/types';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

async function loadSubagentsApi() {
  const mod = await import('../../../src/lib/api/subagents');
  return mod;
}

describe('subagents API wrappers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__;
    }
  });

  it('getInstalledSubagents invokes the correct command', async () => {
    const expected: InstalledSubagent[] = [];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadSubagentsApi();
    const result = await api.getInstalledSubagents();
    expect(mockInvoke).toHaveBeenCalledWith('get_installed_subagents', undefined);
    expect(result).toBe(expected);
  });

  it('discoverAvailableSubagents invokes the correct command', async () => {
    const expected: DiscoverableSubagent[] = [];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadSubagentsApi();
    const result = await api.discoverAvailableSubagents();
    expect(mockInvoke).toHaveBeenCalledWith('discover_available_subagents', undefined);
    expect(result).toBe(expected);
  });

  it('installSubagent forwards subagent and currentApp', async () => {
    const subagent: DiscoverableSubagent = {
      key: 'a/b:foo',
      name: 'Foo',
      description: 'desc',
      directory: 'foo',
      path: '/repos/a/b/foo',
      repoOwner: 'a',
      repoName: 'b',
      repoBranch: 'main',
    };
    mockInvoke.mockResolvedValue({
      ...subagent,
      id: subagent.key,
      apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
      installedAt: 1,
      updatedAt: 0,
    });
    const api = await loadSubagentsApi();
    await api.installSubagent(subagent, 'codex');
    expect(mockInvoke).toHaveBeenCalledWith('install_subagent', { subagent, currentApp: 'codex' });
  });

  it('toggleSubagentApp forwards id, app and enabled', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const api = await loadSubagentsApi();
    await api.toggleSubagentApp('id-1', 'gemini-cli', true);
    expect(mockInvoke).toHaveBeenCalledWith('toggle_subagent_app', {
      id: 'id-1',
      app: 'gemini-cli',
      enabled: true,
    });
  });

  it('addSubagentRepo forwards repo payload', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const repo: SubagentRepo = {
      owner: 'anthropics',
      name: 'subagents',
      branch: 'main',
      enabled: true,
    };
    const api = await loadSubagentsApi();
    await api.addSubagentRepo(repo);
    expect(mockInvoke).toHaveBeenCalledWith('add_subagent_repo', { repo });
  });
});
