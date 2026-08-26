// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConfigContext,
  DiscoverableSubagent,
  InstalledSubagent,
  ScopeTarget,
} from '../../../src/types';

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

const globalContext: ConfigContext = { kind: 'global' };
const globalTarget: ScopeTarget = { scope: 'global' };
const projectContext: ConfigContext = { kind: 'project', projectId: 'project-alpha' };

describe('useSubagents context and target contracts', () => {
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

  it('uses ConfigContext as the installed list identity', async () => {
    mockApi.getInstalledSubagents.mockImplementation((context: ConfigContext) =>
      Promise.resolve(context.kind === 'project' ? [{ id: 'project-only' }] : []),
    );
    const hooks = await loadHooks();
    const { result: globalResult } = renderHook(
      () => hooks.useInstalledSubagents(globalContext, 'claude-code'),
      { wrapper: createWrapper(queryClient) },
    );
    const { result: projectResult } = renderHook(
      () => hooks.useInstalledSubagents(projectContext, 'claude-code'),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(globalResult.current.isSuccess).toBe(true));
    await waitFor(() => expect(projectResult.current.isSuccess).toBe(true));
    expect(mockApi.getInstalledSubagents).toHaveBeenCalledWith(globalContext);
    expect(mockApi.getInstalledSubagents).toHaveBeenCalledWith(projectContext);
    expect(projectResult.current.data).toEqual([{ id: 'project-only' }]);
  });

  it('install mutation forwards complete target and refreshes observed Subagent queries', async () => {
    const existing: InstalledSubagent[] = [
      {
        id: 'old',
        name: 'Old',
        directory: 'old',
        apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
        installedAt: 1,
        updatedAt: 0,
        target: globalTarget,
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
      installed: false,
    };
    const installed: InstalledSubagent = {
      ...subagent,
      id: subagent.key,
      apps: { claudeCode: false, codex: true, geminiCli: false, opencode: false },
      installedAt: 2,
      updatedAt: 0,
      target: globalTarget,
    };

    mockApi.getInstalledSubagents
      .mockResolvedValueOnce(existing)
      .mockResolvedValue([existing[0], installed]);
    mockApi.installSubagent.mockResolvedValue(installed);

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(
      () => hooks.useInstalledSubagents(globalContext, 'claude-code'),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useInstallSubagent(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({
        subagent,
        target: globalTarget,
        currentApp: 'codex',
      });
    });

    await waitFor(() => expect(queryResult.current.data).toContainEqual(installed));
    expect(mockApi.installSubagent).toHaveBeenCalledWith(subagent, globalTarget, 'codex');
    expect(mockApi.getInstalledSubagents).toHaveBeenCalledTimes(2);
  });

  it('uninstall mutation forwards the recorded target and invalidates the list', async () => {
    const existing: InstalledSubagent[] = [
      {
        id: 'to-remove',
        name: 'Remove',
        directory: 'remove',
        apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
        installedAt: 1,
        updatedAt: 0,
        target: globalTarget,
      },
      {
        id: 'keep',
        name: 'Keep',
        directory: 'keep',
        apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
        installedAt: 2,
        updatedAt: 0,
        target: globalTarget,
      },
    ];
    mockApi.getInstalledSubagents.mockResolvedValueOnce(existing).mockResolvedValue([existing[1]]);
    mockApi.uninstallSubagent.mockResolvedValue({ backupPath: '/tmp/bak' });

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(
      () => hooks.useInstalledSubagents(globalContext, 'claude-code'),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useUninstallSubagent(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({ id: 'to-remove', target: globalTarget });
    });

    await waitFor(() =>
      expect(queryResult.current.data?.map((subagent) => subagent.id)).toEqual(['keep']),
    );
    expect(mockApi.uninstallSubagent).toHaveBeenCalledWith('to-remove', globalTarget);
    expect(mockApi.getInstalledSubagents).toHaveBeenCalledTimes(2);
  });
});
