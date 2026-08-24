// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DiscoverableSubagent, InstalledSubagent } from '../../../src/types';

const mockApi = {
  getInstalledSubagents: vi.fn(),
  discoverAvailableSubagents: vi.fn(),
  installSubagent: vi.fn(),
  uninstallSubagent: vi.fn(),
  getSubagentBackups: vi.fn(),
  toggleSubagentApp: vi.fn(),
  updateSubagent: vi.fn(),
};

vi.mock('../../../src/lib/api/subagents', () => mockApi);

async function loadHooks() {
  const mod = await import('../../../src/hooks/useSubagents');
  return mod;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSubagents query invalidation', () => {
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

  it('useInstalledSubagents caches installed list with staleTime Infinity', async () => {
    mockApi.getInstalledSubagents.mockResolvedValue([]);
    const hooks = await loadHooks();
    const { result } = renderHook(() => hooks.useInstalledSubagents(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.getInstalledSubagents).toHaveBeenCalledTimes(1);

    const { result: result2 } = renderHook(() => hooks.useInstalledSubagents(), {
      wrapper: createWrapper(queryClient),
    });
    expect(result2.current.data).toEqual([]);
    expect(mockApi.getInstalledSubagents).toHaveBeenCalledTimes(1);
  });

  it('installSubagent mutation merges into installed cache and invalidates on settle', async () => {
    const existing: InstalledSubagent[] = [
      {
        id: 'old',
        name: 'Old',
        directory: 'old',
        apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
        installedAt: 1,
        updatedAt: 0,
      },
    ];
    const subagent: DiscoverableSubagent = {
      key: 'new',
      name: 'New',
      description: '',
      directory: 'new',
      path: '/repos/a/b/new',
      repoOwner: 'a',
      repoName: 'b',
      repoBranch: 'main',
    };
    const installed: InstalledSubagent = {
      ...subagent,
      id: subagent.key,
      apps: { claudeCode: false, codex: true, geminiCli: false, opencode: false },
      installedAt: 2,
      updatedAt: 0,
    };

    mockApi.getInstalledSubagents
      .mockResolvedValueOnce(existing)
      .mockResolvedValue([existing[0], installed]);
    mockApi.installSubagent.mockResolvedValue(installed);

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(() => hooks.useInstalledSubagents(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useInstallSubagent(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({ subagent, currentApp: 'codex' });
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<InstalledSubagent[]>(['subagents', 'installed']),
      ).toContainEqual(installed),
    );
    expect(mockApi.installSubagent).toHaveBeenCalledWith(subagent, 'codex');
    expect(mockApi.getInstalledSubagents).toHaveBeenCalledTimes(2);
  });

  it('uninstallSubagent mutation removes subagent from installed cache', async () => {
    const existing: InstalledSubagent[] = [
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
    mockApi.getInstalledSubagents.mockResolvedValueOnce(existing).mockResolvedValue([existing[1]]);
    mockApi.uninstallSubagent.mockResolvedValue({ backupPath: '/tmp/bak' });

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(() => hooks.useInstalledSubagents(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useUninstallSubagent(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync('to-remove');
    });

    await waitFor(() => {
      const remaining = queryClient.getQueryData<InstalledSubagent[]>(['subagents', 'installed']);
      expect(remaining?.map((s) => s.id)).toEqual(['keep']);
    });
    expect(mockApi.getInstalledSubagents).toHaveBeenCalledTimes(2);
  });
});
