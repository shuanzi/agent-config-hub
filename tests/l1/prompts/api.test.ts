import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigContext, ScopeTarget } from '../../../src/types';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

async function loadInstructionsApi() {
  const mod = await import('../../../src/lib/api/prompts');
  return mod;
}

describe('长期指令 API wrappers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__;
    }
  });

  it('按配置上下文读取固定的两类文档', async () => {
    const context: ConfigContext = { kind: 'project', projectId: 'project-alpha' };
    const expected = [
      {
        kind: 'claude',
        fileName: 'CLAUDE.md',
        appliesTo: ['claude-code'],
        target: { scope: 'project', projectId: 'project-alpha' },
        content: '',
        exists: false,
      },
      {
        kind: 'agents',
        fileName: 'AGENTS.md',
        appliesTo: ['codex', 'opencode'],
        target: { scope: 'project', projectId: 'project-alpha' },
        content: '# Shared',
        exists: true,
      },
    ];
    mockInvoke.mockResolvedValue(expected);
    const api = await loadInstructionsApi();
    const result = await api.getInstructionDocuments(context);

    expect(mockInvoke).toHaveBeenCalledWith('get_instruction_documents', { context });
    expect(result).toBe(expected);
  });

  it('以 ownership target、文档种类和内容保存，不携带 Agent 或 enabled', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const target: ScopeTarget = { scope: 'global' };
    const api = await loadInstructionsApi();
    await api.upsertInstructionDocument(target, 'agents', '# Shared instructions');

    expect(mockInvoke).toHaveBeenCalledWith('upsert_instruction_document', {
      target,
      kind: 'agents',
      content: '# Shared instructions',
    });
  });
});
