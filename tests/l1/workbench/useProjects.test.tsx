// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAddProject,
  useRelinkProjectRoot,
  useRemoveProject,
} from '../../../src/hooks/useProjects';

const mockApi = vi.hoisted(() => ({
  addProject: vi.fn(),
  listProjects: vi.fn(),
  relinkProjectRoot: vi.fn(),
  removeProject: vi.fn(),
}));

vi.mock('../../../src/lib/api/projects', () => mockApi);

const project = {
  projectId: 'project-alpha',
  displayName: '项目 Alpha',
  rootPath: '/workspaces/alpha',
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function expectAssetQueriesInvalidated(invalidateQueries: unknown) {
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects'] });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['skills'] });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['subagents'] });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['instruction-documents'] });
}

describe('useProjects registry mutation invalidation', () => {
  let queryClient: QueryClient;
  let invalidateQueries: unknown;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    Object.values(mockApi).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('添加项目后失效项目和三类资产查询', async () => {
    mockApi.addProject.mockResolvedValue(project);
    const { result } = renderHook(() => useAddProject(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        rootPath: project.rootPath,
        displayName: project.displayName,
      });
    });

    expectAssetQueriesInvalidated(invalidateQueries);
  });

  it('重新关联项目根目录后失效项目和三类资产查询', async () => {
    mockApi.relinkProjectRoot.mockResolvedValue(project);
    const { result } = renderHook(() => useRelinkProjectRoot(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: project.projectId,
        rootPath: '/workspaces/relinked',
      });
    });

    expectAssetQueriesInvalidated(invalidateQueries);
  });

  it('移除项目后失效项目和三类资产查询', async () => {
    mockApi.removeProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRemoveProject(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(project.projectId);
    });

    expectAssetQueriesInvalidated(invalidateQueries);
  });
});
