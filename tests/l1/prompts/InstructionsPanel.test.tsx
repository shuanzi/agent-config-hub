// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { AgentType, Prompt } from '../../../src/types';

const promptsFixture: Record<string, Prompt> = {
  a: { id: 'a', name: 'Alpha', content: 'content a', enabled: true, createdAt: 1 },
  b: { id: 'b', name: 'Beta', content: 'content b', enabled: false, createdAt: 2 },
};

const savePromptMock = vi.fn().mockResolvedValue(undefined);

let promptsByApp: Record<AgentType, Record<string, Prompt>>;

function resetPromptsByApp() {
  promptsByApp = {
    'claude-code': promptsFixture,
    codex: promptsFixture,
    'gemini-cli': promptsFixture,
    opencode: promptsFixture,
  };
}
resetPromptsByApp();

vi.mock('../../../src/hooks/usePrompts', () => ({
  usePrompts: (app: AgentType) => ({ data: promptsByApp[app], isLoading: false }),
  useCurrentPromptFileContent: () => ({ data: null, isLoading: false }),
  useSavePrompt: () => ({ mutateAsync: savePromptMock, isPending: false }),
  useDeletePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnablePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportPromptFromFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

async function loadPanel() {
  const mod = await import('../../../src/components/instructions/InstructionsPanel');
  return mod.InstructionsPanel;
}

describe('InstructionsPanel search and status filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPromptsByApp();
  });

  afterEach(() => {
    cleanup();
  });

  it('filters the preset list by real-time name search', async () => {
    const InstructionsPanel = await loadPanel();
    render(<InstructionsPanel activeApp="codex" />);

    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('搜索预设名称'), {
      target: { value: 'alpha' },
    });

    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('filters the preset list by enabled/disabled status', async () => {
    const InstructionsPanel = await loadPanel();
    render(<InstructionsPanel activeApp="codex" />);

    fireEvent.change(screen.getByLabelText('状态过滤'), {
      target: { value: 'enabled' },
    });
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.queryByText('Beta')).toBeNull();

    fireEvent.change(screen.getByLabelText('状态过滤'), {
      target: { value: 'disabled' },
    });
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('状态过滤'), {
      target: { value: 'all' },
    });
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });
});

describe('InstructionsPanel 切换 activeApp 时重置编辑器状态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPromptsByApp();
    savePromptMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('切换 Agent 后清空选中项与草稿，不会把旧 Agent 内容保存进新 Agent', async () => {
    promptsByApp.codex = {
      a: { id: 'a', name: 'Codex Alpha', content: 'codex content', enabled: false, createdAt: 1 },
    };
    const InstructionsPanel = await loadPanel();
    const { rerender } = render(<InstructionsPanel activeApp="claude-code" />);

    // 在 Claude 下选中预设并编辑草稿
    fireEvent.click(screen.getByText('Alpha'));
    expect((screen.getByLabelText('内容') as HTMLTextAreaElement).value).toBe('content a');
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: 'claude draft' } });

    rerender(<InstructionsPanel activeApp="codex" />);

    // 选中态与草稿被清空，编辑器回到空态
    expect(screen.queryByLabelText('内容')).toBeNull();
    expect(screen.getByText('选择左侧预设进行编辑，或新建一条预设。')).toBeTruthy();

    // 同 id 的预设重新选中后加载的是新 Agent 的内容
    fireEvent.click(screen.getByText('Codex Alpha'));
    expect((screen.getByLabelText('内容') as HTMLTextAreaElement).value).toBe('codex content');

    // 保存携带新 Agent 的内容，而不是旧草稿
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(savePromptMock).toHaveBeenCalledTimes(1));
    expect(savePromptMock).toHaveBeenCalledWith({
      app: 'codex',
      id: 'a',
      prompt: expect.objectContaining({ content: 'codex content' }),
    });
  });

  it('新建草稿状态下切换 Agent，草稿被丢弃', async () => {
    const InstructionsPanel = await loadPanel();
    const { rerender } = render(<InstructionsPanel activeApp="claude-code" />);

    fireEvent.click(screen.getByText('新建预设'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'draft name' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: 'draft content' } });

    rerender(<InstructionsPanel activeApp="codex" />);

    expect(screen.queryByLabelText('内容')).toBeNull();
    expect(screen.getByText('选择左侧预设进行编辑，或新建一条预设。')).toBeTruthy();
    expect(savePromptMock).not.toHaveBeenCalled();
  });
});
