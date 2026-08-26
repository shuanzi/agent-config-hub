// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { AppSettings } from '../../../src/types';

const mockSetSyncMethod = vi.fn();
const mockSetSettings = vi.fn();
const mockMigrateStorage = vi.fn();
const mockSetAgentOverrideDir = vi.fn();

const baseSettings: AppSettings = {
  syncMethod: 'auto',
  storageLocation: 'hub',
};

vi.mock('../../../src/hooks/useSettings', () => ({
  useSettings: () => ({ data: baseSettings, isLoading: false }),
  useSetSettings: () => ({ mutateAsync: mockSetSettings, isPending: false }),
  useSetSyncMethod: () => ({ mutateAsync: mockSetSyncMethod, isPending: false }),
  useMigrateStorage: () => ({ mutateAsync: mockMigrateStorage, isPending: false }),
  useSetAgentOverrideDir: () => ({ mutateAsync: mockSetAgentOverrideDir, isPending: false }),
}));

vi.mock('../../../src/hooks/useSkills', () => ({
  useInstalledSkills: () => ({ data: [] }),
}));

async function loadView() {
  const mod = await import('../../../src/components/settings/SettingsView');
  return mod.SettingsView;
}

describe('SettingsView sync method change', () => {
  beforeEach(() => {
    mockSetSyncMethod.mockReset().mockResolvedValue(undefined);
    mockSetSettings.mockReset().mockResolvedValue(undefined);
    mockMigrateStorage.mockReset();
    mockSetAgentOverrideDir.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('saves via the single-field command without persisting unsaved override edits', async () => {
    const SettingsView = await loadView();
    render(<SettingsView />);

    // 先制造一个未保存的覆盖路径编辑
    fireEvent.change(screen.getByLabelText('Claude Code'), {
      target: { value: '/tmp/unsaved-override' },
    });

    fireEvent.click(screen.getByRole('button', { name: '符号链接' }));

    await waitFor(() => expect(mockSetSyncMethod).toHaveBeenCalledWith('symlink'));
    // 不得走整包保存（会顺带持久化未保存的覆盖编辑），也不得触发覆盖命令
    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(mockSetAgentOverrideDir).not.toHaveBeenCalled();
    expect(mockMigrateStorage).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('同步方式已保存。');
  });

  it('按既有 Agent 顺序保存已修改的覆盖目录，并为每个映射行提供稳定 key', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const SettingsView = await loadView();
    render(<SettingsView />);

    fireEvent.change(screen.getByLabelText('Claude Code'), {
      target: { value: '/tmp/claude' },
    });
    fireEvent.change(screen.getByLabelText('Codex'), {
      target: { value: '/tmp/codex' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存覆盖路径' }));

    await waitFor(() => expect(mockSetAgentOverrideDir).toHaveBeenCalledTimes(2));
    expect(mockSetAgentOverrideDir.mock.calls).toEqual([
      [{ app: 'claude-code', dir: '/tmp/claude' }],
      [{ app: 'codex', dir: '/tmp/codex' }],
    ]);
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes('unique "key" prop')),
    ).toBe(false);
    consoleError.mockRestore();
  });
});
