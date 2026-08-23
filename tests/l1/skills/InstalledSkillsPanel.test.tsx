// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { InstalledSkill, SkillUpdateInfo, UnmanagedSkill } from '../../../src/types';

const mockApi = {
  getInstalledSkills: vi.fn(),
  discoverAvailableSkills: vi.fn(),
  getSkillRepos: vi.fn(),
  getSkillBackups: vi.fn(),
  scanUnmanagedSkills: vi.fn(),
  checkSkillUpdates: vi.fn(),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  toggleSkillApp: vi.fn(),
  updateSkill: vi.fn(),
  importSkillsFromApps: vi.fn(),
  installSkillsFromZip: vi.fn(),
  restoreSkillBackup: vi.fn(),
  deleteSkillBackup: vi.fn(),
};

vi.mock('../../../src/lib/api/skills', () => mockApi);

const installedSkill = (id: string, name: string): InstalledSkill => ({
  id,
  name,
  directory: id,
  apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
  installedAt: 1,
  updatedAt: 0,
});

async function loadPanel() {
  const mod = await import('../../../src/components/skills/InstalledSkillsPanel');
  return mod.InstalledSkillsPanel;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('InstalledSkillsPanel 导入同目录不同来源的本地 Skill', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.getInstalledSkills.mockResolvedValue([]);
    mockApi.getSkillBackups.mockResolvedValue([]);
    mockApi.importSkillsFromApps.mockResolvedValue([]);
    mockApi.scanUnmanagedSkills.mockResolvedValue([
      {
        directory: 'shared',
        name: 'SharedSkill',
        foundIn: ['claude-code'],
        path: '/agents/claude/skills/shared',
      },
      {
        directory: 'shared',
        name: 'SharedSkill',
        foundIn: ['codex'],
        path: '/agents/codex/skills/shared',
      },
    ] satisfies UnmanagedSkill[]);
  });

  afterEach(() => {
    cleanup();
  });

  it('同 directory 不同 sourcePath 的两条可同时勾选互不干扰', async () => {
    const Panel = await loadPanel();
    render(<Panel activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    fireEvent.click(await screen.findByRole('button', { name: /导入本地/ }));
    const dialog = await screen.findByRole('dialog');

    const firstItem = screen
      .getByText('/agents/claude/skills/shared')
      .closest('.skill-import-item');
    const secondItem = screen
      .getByText('/agents/codex/skills/shared')
      .closest('.skill-import-item');
    expect(firstItem).not.toBeNull();
    expect(secondItem).not.toBeNull();
    const firstCheckbox = within(firstItem as HTMLElement).getAllByRole('checkbox')[0];
    const secondCheckbox = within(secondItem as HTMLElement).getAllByRole('checkbox')[0];

    // 默认两条均选中
    expect(firstCheckbox).toHaveProperty('checked', true);
    expect(secondCheckbox).toHaveProperty('checked', true);

    // 取消第一条不影响第二条
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox).toHaveProperty('checked', false);
    expect(secondCheckbox).toHaveProperty('checked', true);

    // 重新勾选第一条，两条可同时选中
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox).toHaveProperty('checked', true);
    expect(secondCheckbox).toHaveProperty('checked', true);
    expect(within(dialog).getByRole('button', { name: /导入选中项 \(2\)/ })).toBeTruthy();
  });

  it('只选中第二条提交时 selection 携带第二条的 sourcePath', async () => {
    const Panel = await loadPanel();
    render(<Panel activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    fireEvent.click(await screen.findByRole('button', { name: /导入本地/ }));
    const dialog = await screen.findByRole('dialog');

    const firstItem = screen
      .getByText('/agents/claude/skills/shared')
      .closest('.skill-import-item');
    const firstCheckbox = within(firstItem as HTMLElement).getAllByRole('checkbox')[0];
    fireEvent.click(firstCheckbox);

    fireEvent.click(within(dialog).getByRole('button', { name: /导入选中项 \(1\)/ }));

    await waitFor(() => expect(mockApi.importSkillsFromApps).toHaveBeenCalledTimes(1));
    expect(mockApi.importSkillsFromApps.mock.calls[0][0]).toEqual([
      {
        directory: 'shared',
        sourcePath: '/agents/codex/skills/shared',
        apps: { claudeCode: false, codex: true, geminiCli: false, opencode: false },
      },
    ]);
  });
});

describe('InstalledSkillsPanel 全部更新部分失败', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.getInstalledSkills.mockResolvedValue([
      installedSkill('skill-a', 'SkillA'),
      installedSkill('skill-b', 'SkillB'),
    ]);
    mockApi.getSkillBackups.mockResolvedValue([]);
    const updates: SkillUpdateInfo[] = [
      { id: 'skill-a', name: 'SkillA', remoteHash: 'h1' },
      { id: 'skill-b', name: 'SkillB', remoteHash: 'h2' },
    ];
    mockApi.checkSkillUpdates.mockResolvedValue(updates);
    mockApi.updateSkill.mockImplementation((id: string) => {
      if (id === 'skill-a') {
        return Promise.resolve(installedSkill('skill-a', 'SkillA'));
      }
      return Promise.reject(
        new Error(
          JSON.stringify({ code: 'DOWNLOAD_FAILED', context: {}, suggestion: 'checkNetwork' }),
        ),
      );
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('一成功一失败时摘要同时包含成功数与失败明细', async () => {
    const Panel = await loadPanel();
    render(<Panel activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    fireEvent.click(await screen.findByRole('button', { name: /检查更新/ }));
    const updateAllButton = await screen.findByRole('button', { name: /全部更新 \(2\)/ });
    fireEvent.click(updateAllButton);

    await waitFor(() => {
      const error = document.querySelector('.skill-error');
      expect(error?.textContent).toContain('成功更新 1 个 Skill');
      expect(error?.textContent).toContain('SkillB');
      expect(error?.textContent).toContain('下载仓库失败');
    });
  });
});
