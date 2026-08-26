import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type {
  ConfigContext,
  DiscoverableSubagent,
  InstalledSubagent,
  ScopeTarget,
  SubagentRepo,
} from '../../../src/types';

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
    const context: ConfigContext = { kind: 'project', projectId: 'project-alpha' };
    const expected: InstalledSubagent[] = [];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadSubagentsApi();
    const result = await api.getInstalledSubagents(context);
    expect(mockInvoke).toHaveBeenCalledWith('get_installed_subagents', { context });
    expect(result).toBe(expected);
  });

  it('discoverAvailableSubagents invokes the correct command', async () => {
    const target: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
    const expected: DiscoverableSubagent[] = [];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadSubagentsApi();
    const result = await api.discoverAvailableSubagents(target);
    expect(mockInvoke).toHaveBeenCalledWith('discover_available_subagents', { target });
    expect(result).toBe(expected);
  });

  it('installSubagent forwards subagent, complete target and currentApp', async () => {
    const target: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
    const subagent: DiscoverableSubagent = {
      key: 'a/b:foo',
      name: 'Foo',
      description: 'desc',
      directory: 'foo',
      path: '/repos/a/b/foo',
      repoOwner: 'a',
      repoName: 'b',
      repoBranch: 'main',
      installed: false,
    };
    mockInvoke.mockResolvedValue({
      ...subagent,
      id: subagent.key,
      apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
      installedAt: 1,
      updatedAt: 0,
    });
    const api = await loadSubagentsApi();
    await api.installSubagent(subagent, target, 'codex');
    expect(mockInvoke).toHaveBeenCalledWith('install_subagent', {
      subagent,
      target,
      currentApp: 'codex',
    });
  });

  it('existing Subagent mutations forward the record ownership target', async () => {
    const target: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
    mockInvoke.mockResolvedValue(undefined);
    const api = await loadSubagentsApi();
    await api.toggleSubagentApp('id-1', target, 'gemini-cli', true);
    expect(mockInvoke).toHaveBeenCalledWith('toggle_subagent_app', {
      id: 'id-1',
      target,
      app: 'gemini-cli',
      enabled: true,
    });

    await api.updateSubagent('id-1', target);
    expect(mockInvoke).toHaveBeenCalledWith('update_subagent', { id: 'id-1', target });
    await api.uninstallSubagent('id-1', target);
    expect(mockInvoke).toHaveBeenCalledWith('uninstall_subagent', { id: 'id-1', target });
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
