// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Prompt } from '../../../src/types';

const promptsFixture: Record<string, Prompt> = {
  a: { id: 'a', name: 'Alpha', content: 'content a', enabled: true, createdAt: 1 },
  b: { id: 'b', name: 'Beta', content: 'content b', enabled: false, createdAt: 2 },
};

vi.mock('../../../src/hooks/usePrompts', () => ({
  usePrompts: () => ({ data: promptsFixture, isLoading: false }),
  useCurrentPromptFileContent: () => ({ data: null, isLoading: false }),
  useSavePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
