import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Prompt } from '../../../src/types';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

async function loadPromptsApi() {
  const mod = await import('../../../src/lib/api/prompts');
  return mod;
}

describe('prompts API wrappers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__;
    }
  });

  it('getPrompts invokes the correct command', async () => {
    const expected: Record<string, Prompt> = {
      'prompt-1': {
        id: 'prompt-1',
        name: 'Default',
        content: 'hello',
        enabled: true,
      },
    };
    mockInvoke.mockResolvedValue(expected);
    const api = await loadPromptsApi();
    const result = await api.getPrompts('codex');
    expect(mockInvoke).toHaveBeenCalledWith('get_prompts', { app: 'codex' });
    expect(result).toBe(expected);
  });

  it('upsertPrompt forwards app, id and prompt', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const api = await loadPromptsApi();
    const prompt: Prompt = {
      id: 'prompt-2',
      name: 'New',
      content: 'content',
      description: 'desc',
      enabled: false,
    };
    await api.upsertPrompt('claude-code', 'prompt-2', prompt);
    expect(mockInvoke).toHaveBeenCalledWith('upsert_prompt', {
      app: 'claude-code',
      id: 'prompt-2',
      prompt,
    });
  });

  it('deletePrompt forwards app and id', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const api = await loadPromptsApi();
    await api.deletePrompt('gemini-cli', 'prompt-3');
    expect(mockInvoke).toHaveBeenCalledWith('delete_prompt', {
      app: 'gemini-cli',
      id: 'prompt-3',
    });
  });

  it('enablePrompt forwards app and id', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const api = await loadPromptsApi();
    await api.enablePrompt('opencode', 'prompt-4');
    expect(mockInvoke).toHaveBeenCalledWith('enable_prompt', {
      app: 'opencode',
      id: 'prompt-4',
    });
  });

  it('importPromptFromFile invokes the correct command', async () => {
    mockInvoke.mockResolvedValue('imported-1');
    const api = await loadPromptsApi();
    const result = await api.importPromptFromFile('codex');
    expect(mockInvoke).toHaveBeenCalledWith('import_prompt_from_file', { app: 'codex' });
    expect(result).toBe('imported-1');
  });

  it('getCurrentPromptFileContent invokes the correct command', async () => {
    mockInvoke.mockResolvedValue('live content');
    const api = await loadPromptsApi();
    const result = await api.getCurrentPromptFileContent('claude-code');
    expect(mockInvoke).toHaveBeenCalledWith('get_current_prompt_file_content', {
      app: 'claude-code',
    });
    expect(result).toBe('live content');
  });
});
