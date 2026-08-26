// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ConfigContext, ScopeTarget } from '../../../src/types';

const mockApi = {
  getInstructionDocuments: vi.fn(),
  upsertInstructionDocument: vi.fn(),
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

describe('长期指令 query invalidation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('按完整配置上下文缓存两类文档，而不是按 Agent 缓存预设', async () => {
    const context: ConfigContext = { kind: 'global' };
    const documents = [
      {
        kind: 'claude',
        fileName: 'CLAUDE.md',
        appliesTo: ['claude-code'],
        target: { scope: 'global' },
        content: '',
        exists: false,
      },
      {
        kind: 'agents',
        fileName: 'AGENTS.md',
        appliesTo: ['codex', 'opencode'],
        target: { scope: 'global' },
        content: '',
        exists: false,
      },
    ];
    mockApi.getInstructionDocuments.mockResolvedValue(documents);

    const hooks = await loadHooks();
    const { result } = renderHook(() => hooks.useInstructionDocuments(context), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toEqual(documents));
    expect(mockApi.getInstructionDocuments).toHaveBeenCalledWith(context);
    expect(queryClient.getQueryData(['instruction-documents', context])).toEqual(documents);
  });

  it('保存后调用固定文档写入 API 并使长期指令查询失效', async () => {
    const target: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
    const context: ConfigContext = { kind: 'project', projectId: 'project-alpha' };
    mockApi.getInstructionDocuments.mockResolvedValue([]);
    mockApi.upsertInstructionDocument.mockResolvedValue(undefined);

    const hooks = await loadHooks();
    const { result: queryResult } = renderHook(() => hooks.useInstructionDocuments(context), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(queryResult.current.isSuccess).toBe(true));

    const { result: mutationResult } = renderHook(() => hooks.useSaveInstructionDocument(), {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await mutationResult.current.mutateAsync({
        target,
        kind: 'agents',
        content: '# Shared project instructions',
      });
    });

    expect(mockApi.upsertInstructionDocument).toHaveBeenCalledWith(
      target,
      'agents',
      '# Shared project instructions',
    );
  });
});
