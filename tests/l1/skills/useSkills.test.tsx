// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DiscoverableSkill, InstalledSkill } from '../../../src/types';

const mockApi = {
  getInstalledSkills: vi.fn(),
  discoverAvailableSkills: vi.fn(),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  getSkillBackups: vi.fn(),
  scanUnmanagedSkills: vi.fn(),
  importSkillsFromApps: vi.fn(),
  installSkillsFromZip: vi.fn(),
  toggleSkillApp: vi.fn(),
  updateSkill: vi.fn(),
};

vi.mock('../../../src/lib/api/skills', () => mockApi);

async function loadHooks() {
  const mod = await import('../../../src/hooks/useSkills');
  return mod;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSkills query invalidation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('useInstalledSkills caches installed list with staleTime Infinity', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([]);
    const hooks = await loadHooks();
    const { result } = renderHook(() => hooks.useInstalledSkills(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.getInstalledSkills).toHaveBeenCalledTimes(1);

    // 重新挂载仍应使用缓存
    const { result: result2 } = renderHook(() => hooks.useInstalledSkills(), {
      wrapper: createWrapper(queryClient),
    });
    expect(result2.current.data).toEqual([]);
    expect(mockApi.getInstalledSkills).toHaveBeenCalledTimes(1);
  });

  it('installSkill mutation merges into installed cache and invalidates on settle', async () => {
    const existing: InstalledSkill[] = [
      {
        id: 'old',
        name: 'Old',
        directory: 'old',
        apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
        installedAt: 1,
        updatedAt: 0,
      },
    ];
    const skill: DiscoverableSkill = {
      key: 'new',
      name: 'New',
      description: '',
      directory: 'new',
      repoOwner: 'a',
      repoName: 'b',
      repoBranch: 'main',
    };
    const installed: InstalledSkill = {
      ...skill,
      id: skill.key,
      apps: { claudeCode: false, codex: true, geminiCli: false, opencode: false },
      installedAt: 2,
      updatedAt: 0,
    };

    mockApi.getInstalledSkills
      .mockResolvedValueOnce(existing)
      .mockResolvedValue([existing[0], installed]);
    mockApi.installSkill.mockResolvedValue(installed);
    mockApi.scanUnmanagedSkills.mockResolvedValue([]);

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(() => hooks.useInstalledSkills(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useInstallSkill(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({ skill, currentApp: 'codex' });
    });

    // 失效后重新拉取应包含新安装的 skill
    await waitFor(() =>
      expect(queryClient.getQueryData<InstalledSkill[]>(['skills', 'installed'])).toContainEqual(
        installed,
      ),
    );
    expect(mockApi.installSkill).toHaveBeenCalledWith(skill, 'codex');
    expect(mockApi.getInstalledSkills).toHaveBeenCalledTimes(2);
  });

  it('uninstallSkill mutation removes skill from installed cache', async () => {
    const existing: InstalledSkill[] = [
      {
        id: 'to-remove',
        name: 'Remove',
        directory: 'remove',
        apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
        installedAt: 1,
        updatedAt: 0,
      },
      {
        id: 'keep',
        name: 'Keep',
        directory: 'keep',
        apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
        installedAt: 2,
        updatedAt: 0,
      },
    ];
    mockApi.getInstalledSkills.mockResolvedValueOnce(existing).mockResolvedValue([existing[1]]);
    mockApi.uninstallSkill.mockResolvedValue({ backupPath: '/tmp/bak' });

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(() => hooks.useInstalledSkills(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useUninstallSkill(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync('to-remove');
    });

    await waitFor(() => {
      const remaining = queryClient.getQueryData<InstalledSkill[]>(['skills', 'installed']);
      expect(remaining?.map((s) => s.id)).toEqual(['keep']);
    });
    expect(mockApi.getInstalledSkills).toHaveBeenCalledTimes(2);
  });
});
