// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
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
  key: 'a/b:skill',
  name: 'TestSkill',
  description: 'desc',
  directory: 'skill',
  repoOwner: 'a',
  repoName: 'b',
  repoBranch: 'main',
};

const installed: InstalledSkill = {
  id: 'a/b:skill',
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

  it('点击卸载先弹出确认对话框，不调用卸载接口，安装态不变', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([installed]);
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    const uninstallButton = await screen.findByRole('button', { name: '卸载' });
    fireEvent.click(uninstallButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/确定要卸载 TestSkill/)).toBeTruthy();
    expect(mockApi.uninstallSkill).not.toHaveBeenCalled();
    // 安装态不变：卡片仍显示卸载按钮
    expect(screen.getAllByRole('button', { name: '卸载' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull();
  });

  it('同仓库同名 Skill 按完整身份分别显示安装状态', async () => {
    mockApi.discoverAvailableSkills.mockResolvedValue([
      { ...discoverable, key: 'a/b:a/reviewer', name: 'Reviewer A', directory: 'a/reviewer' },
      { ...discoverable, key: 'a/b:b/reviewer', name: 'Reviewer B', directory: 'b/reviewer' },
    ]);
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installed, id: 'a/b:a/reviewer', name: 'Reviewer A', directory: 'reviewer' },
    ]);
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    const installedCard = (await screen.findByRole('heading', { name: 'Reviewer A' })).closest(
      'article',
    );
    const uninstalledCard = (await screen.findByRole('heading', { name: 'Reviewer B' })).closest(
      'article',
    );

    expect(installedCard).not.toBeNull();
    expect(uninstalledCard).not.toBeNull();
    expect(within(installedCard!).getByRole('button', { name: '卸载' })).toBeTruthy();
    expect(within(uninstalledCard!).getByRole('button', { name: '安装' })).toBeTruthy();
  });

  it('取消确认后不调用卸载接口且安装态不变', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([installed]);
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    const uninstallButton = await screen.findByRole('button', { name: '卸载' });
    fireEvent.click(uninstallButton);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockApi.uninstallSkill).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '卸载' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull();
  });

  it('确认卸载后调用卸载接口并更新安装态', async () => {
    mockApi.getInstalledSkills.mockResolvedValueOnce([installed]).mockResolvedValue([]);
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    const uninstallButton = await screen.findByRole('button', { name: '卸载' });
    fireEvent.click(uninstallButton);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '卸载' }));

    await waitFor(() => expect(mockApi.uninstallSkill).toHaveBeenCalledTimes(1));
    expect(mockApi.uninstallSkill.mock.calls[0][0]).toBe('a/b:skill');

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

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '卸载' }));

    await waitFor(() => expect(mockApi.uninstallSkill).toHaveBeenCalledTimes(1));
    expect(mockApi.uninstallSkill.mock.calls[0][0]).toBe('a/b:skill');
    await screen.findByText('操作失败，请稍后重试。');
    expect(screen.getByRole('button', { name: '卸载' })).toBeTruthy();
  });

  it('卸载执行期间卸载入口禁用并给出 pending 反馈，不可重复提交', async () => {
    let resolveUninstall: (value: { backupPath: string }) => void = () => {};
    mockApi.uninstallSkill.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUninstall = resolve;
        }),
    );
    mockApi.getInstalledSkills.mockResolvedValue([installed]);
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    fireEvent.click(await screen.findByRole('button', { name: '卸载' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '卸载' }));
    await waitFor(() => expect(mockApi.uninstallSkill).toHaveBeenCalledTimes(1));

    // mutation pending：卡片卸载按钮禁用并显示 pending 反馈，点击不再触发
    const pendingButton = await screen.findByRole('button', { name: '卸载中…' });
    expect(pendingButton).toHaveProperty('disabled', true);
    fireEvent.click(pendingButton);
    expect(mockApi.uninstallSkill).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    resolveUninstall({ backupPath: '/tmp/bak' });
    await screen.findByText('已卸载 TestSkill。');
  });
});
