// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AgentType, Prompt } from '../../../src/types';

const mockApi = {
  getPrompts: vi.fn(),
  getCurrentPromptFileContent: vi.fn(),
  upsertPrompt: vi.fn(),
  deletePrompt: vi.fn(),
  enablePrompt: vi.fn(),
  importPromptFromFile: vi.fn(),
};

vi.mock('../../../src/lib/api/prompts', () => mockApi);

async function loadHooks() {
  const mod = await import('../../../src/hooks/usePrompts');
  return mod;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('usePrompts query invalidation', () => {
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

  it('usePrompts caches prompts per app with staleTime Infinity', async () => {
    const prompts: Record<string, Prompt> = {
      'prompt-1': { id: 'prompt-1', name: 'A', content: 'a', enabled: true },
    };
    mockApi.getPrompts.mockResolvedValue(prompts);
    mockApi.getCurrentPromptFileContent.mockResolvedValue(null);

    const hooks = await loadHooks();
    const { result } = renderHook(() => hooks.usePrompts('codex'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(prompts);
    expect(mockApi.getPrompts).toHaveBeenCalledTimes(1);
  });

  it('切换到未缓存的 Agent 时不保留上一个 Agent 的预设数据', async () => {
    const codexPrompts: Record<string, Prompt> = {
      'prompt-1': { id: 'prompt-1', name: 'Codex A', content: 'a', enabled: true },
    };
    mockApi.getPrompts.mockImplementation((app: AgentType) =>
      app === 'codex'
        ? Promise.resolve(codexPrompts)
        : // gemini-cli 未缓存：请求挂起，模拟加载窗口
          new Promise<Record<string, Prompt>>(() => {}),
    );

    const hooks = await loadHooks();
    const { result, rerender } = renderHook(
      ({ app }: { app: AgentType }) => hooks.usePrompts(app),
      {
        wrapper: createWrapper(queryClient),
        initialProps: { app: 'codex' },
      },
    );
    await waitFor(() => expect(result.current.data).toEqual(codexPrompts));

    rerender({ app: 'gemini-cli' });

    // 加载窗口内不展示旧 Agent 的预设：无数据且处于加载态
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it('savePrompt invalidates prompts and current file queries', async () => {
    const existing: Record<string, Prompt> = {
      old: { id: 'old', name: 'Old', content: 'old', enabled: false },
    };
    mockApi.getPrompts.mockResolvedValue(existing);
    mockApi.getCurrentPromptFileContent.mockResolvedValue(null);
    mockApi.upsertPrompt.mockResolvedValue(undefined);

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(() => hooks.usePrompts('codex'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const updated: Prompt = { id: 'old', name: 'Updated', content: 'updated', enabled: false };
    mockApi.getPrompts.mockResolvedValue({ old: updated });

    const { result: mutationResult } = renderHook(() => hooks.useSavePrompt(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({ app: 'codex', id: 'old', prompt: updated });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData<Record<string, Prompt>>(['prompts', 'codex'])).toEqual({
        old: updated,
      }),
    );
    expect(mockApi.upsertPrompt).toHaveBeenCalledWith('codex', 'old', updated);
  });

  it('enablePrompt invalidates prompts query', async () => {
    const existing: Record<string, Prompt> = {
      a: { id: 'a', name: 'A', content: 'a', enabled: true },
      b: { id: 'b', name: 'B', content: 'b', enabled: false },
    };
    const afterEnable: Record<string, Prompt> = {
      a: { ...existing.a, enabled: false },
      b: { ...existing.b, enabled: true },
    };
    mockApi.getPrompts.mockResolvedValueOnce(existing).mockResolvedValue(afterEnable);
    mockApi.getCurrentPromptFileContent.mockResolvedValue(null);
    mockApi.enablePrompt.mockResolvedValue(undefined);

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(() => hooks.usePrompts('codex'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(queryResult.current.data).toEqual(existing));

    const { result: mutationResult } = renderHook(() => hooks.useEnablePrompt(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({ app: 'codex', id: 'b' });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData<Record<string, Prompt>>(['prompts', 'codex'])).toEqual(
        afterEnable,
      ),
    );
    expect(mockApi.enablePrompt).toHaveBeenCalledWith('codex', 'b');
  });
});
