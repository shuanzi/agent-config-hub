// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConfigContext,
  DiscoverableSkill,
  InstalledSkill,
  ScopeTarget,
} from '../../../src/types';

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

const globalContext: ConfigContext = { kind: 'global' };
const globalTarget: ScopeTarget = { scope: 'global' };
const projectContext: ConfigContext = { kind: 'project', projectId: 'project-alpha' };

describe('useSkills context and target contracts', () => {
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
    mockApi.getInstalledSkills.mockImplementation((context: ConfigContext) =>
      Promise.resolve(context.kind === 'project' ? [{ id: 'project-only' }] : []),
    );
    const hooks = await loadHooks();
    const { result: globalResult } = renderHook(
      () => hooks.useInstalledSkills(globalContext, 'claude-code'),
      {
        wrapper: createWrapper(queryClient),
      },
    );
    const { result: projectResult } = renderHook(
      () => hooks.useInstalledSkills(projectContext, 'claude-code'),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    await waitFor(() => expect(globalResult.current.isSuccess).toBe(true));
    await waitFor(() => expect(projectResult.current.isSuccess).toBe(true));
    expect(mockApi.getInstalledSkills).toHaveBeenCalledWith(globalContext);
    expect(mockApi.getInstalledSkills).toHaveBeenCalledWith(projectContext);
    expect(projectResult.current.data).toEqual([{ id: 'project-only' }]);
  });

  it('install mutation forwards complete target and refreshes observed Skill queries', async () => {
    const existing: InstalledSkill[] = [
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
    const skill: DiscoverableSkill = {
      key: 'new',
      name: 'New',
      description: '',
      directory: 'new',
      repoOwner: 'a',
      repoName: 'b',
      repoBranch: 'main',
      installed: false,
    };
    const installed: InstalledSkill = {
      ...skill,
      id: skill.key,
      apps: { claudeCode: false, codex: true, geminiCli: false, opencode: false },
      installedAt: 2,
      updatedAt: 0,
      target: globalTarget,
    };

    mockApi.getInstalledSkills
      .mockResolvedValueOnce(existing)
      .mockResolvedValue([existing[0], installed]);
    mockApi.installSkill.mockResolvedValue(installed);
    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(
      () => hooks.useInstalledSkills(globalContext, 'claude-code'),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useInstallSkill(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({
        skill,
        target: globalTarget,
        currentApp: 'codex',
      });
    });

    await waitFor(() => expect(queryResult.current.data).toContainEqual(installed));
    expect(mockApi.installSkill).toHaveBeenCalledWith(skill, globalTarget, 'codex');
    expect(mockApi.getInstalledSkills).toHaveBeenCalledTimes(2);
  });

  it('uninstall mutation forwards the recorded target and invalidates the list', async () => {
    const existing: InstalledSkill[] = [
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
    mockApi.getInstalledSkills.mockResolvedValueOnce(existing).mockResolvedValue([existing[1]]);
    mockApi.uninstallSkill.mockResolvedValue({ backupPath: '/tmp/bak' });

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(
      () => hooks.useInstalledSkills(globalContext, 'claude-code'),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useUninstallSkill(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({ id: 'to-remove', target: globalTarget });
    });

    await waitFor(() =>
      expect(queryResult.current.data?.map((skill) => skill.id)).toEqual(['keep']),
    );
    expect(mockApi.uninstallSkill).toHaveBeenCalledWith('to-remove', globalTarget);
    expect(mockApi.getInstalledSkills).toHaveBeenCalledTimes(2);
  });
});
