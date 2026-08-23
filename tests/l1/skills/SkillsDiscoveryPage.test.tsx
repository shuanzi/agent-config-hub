// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DiscoverableSkill, InstalledSkill } from '../../../src/types';

const mockApi = {
  getInstalledSkills: vi.fn(),
  discoverAvailableSkills: vi.fn(),
  getSkillRepos: vi.fn(),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  addSkillRepo: vi.fn(),
  removeSkillRepo: vi.fn(),
};

vi.mock('../../../src/lib/api/skills', () => mockApi);

const discoverable: DiscoverableSkill = {
  key: 'skill',
  name: 'TestSkill',
  description: 'desc',
  directory: 'skill',
  repoOwner: 'a',
  repoName: 'b',
  repoBranch: 'main',
};

const installed: InstalledSkill = {
  id: 'installed-skill-1',
  name: 'TestSkill',
  directory: 'skill',
  repoOwner: 'a',
  repoName: 'b',
  apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
  installedAt: 1,
  updatedAt: 0,
};

async function loadPage() {
  const mod = await import('../../../src/components/skills/SkillsDiscoveryPage');
  return mod.SkillsDiscoveryPage;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('SkillsDiscoveryPage 卸载已安装 Skill', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.discoverAvailableSkills.mockResolvedValue([discoverable]);
    mockApi.getSkillRepos.mockResolvedValue([]);
    mockApi.uninstallSkill.mockResolvedValue({ backupPath: '/tmp/bak' });
  });

  afterEach(() => {
    cleanup();
  });

  it('点击卸载会调用卸载接口并更新安装态', async () => {
    mockApi.getInstalledSkills.mockResolvedValueOnce([installed]).mockResolvedValue([]);
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    const uninstallButton = await screen.findByRole('button', { name: '卸载' });
    fireEvent.click(uninstallButton);

    await waitFor(() => expect(mockApi.uninstallSkill).toHaveBeenCalledTimes(1));
    expect(mockApi.uninstallSkill.mock.calls[0][0]).toBe('installed-skill-1');

    // 安装态更新：卡片回到未安装状态并给出成功反馈
    await screen.findByRole('button', { name: '安装' });
    expect(screen.queryByRole('button', { name: '卸载' })).toBeNull();
    expect(screen.getByText('已卸载 TestSkill。')).toBeTruthy();
  });

  it('卸载失败时展示错误反馈，安装态保持不变', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([installed]);
    mockApi.uninstallSkill.mockRejectedValue(new Error('boom'));
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    const uninstallButton = await screen.findByRole('button', { name: '卸载' });
    fireEvent.click(uninstallButton);

    await waitFor(() => expect(mockApi.uninstallSkill).toHaveBeenCalledTimes(1));
    expect(mockApi.uninstallSkill.mock.calls[0][0]).toBe('installed-skill-1');
    await screen.findByText('操作失败，请稍后重试。');
    expect(screen.getByRole('button', { name: '卸载' })).toBeTruthy();
  });
});
