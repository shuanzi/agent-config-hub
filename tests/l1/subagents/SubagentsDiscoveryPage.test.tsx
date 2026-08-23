// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DiscoverableSubagent, InstalledSubagent } from '../../../src/types';

const mockApi = {
  getInstalledSubagents: vi.fn(),
  discoverAvailableSubagents: vi.fn(),
  getSubagentRepos: vi.fn(),
  installSubagent: vi.fn(),
  uninstallSubagent: vi.fn(),
  addSubagentRepo: vi.fn(),
  removeSubagentRepo: vi.fn(),
};

vi.mock('../../../src/lib/api/subagents', () => mockApi);

const discoverable: DiscoverableSubagent = {
  key: 'a/b:reviewer.md',
  name: 'Reviewer',
  description: 'desc',
  directory: 'reviewer',
  path: 'agents/reviewer.md',
  repoOwner: 'a',
  repoName: 'b',
  repoBranch: 'main',
};

const installed: InstalledSubagent = {
  id: 'a/b:reviewer.md',
  name: 'Reviewer',
  directory: 'reviewer',
  repoOwner: 'a',
  repoName: 'b',
  apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
  installedAt: 1,
  updatedAt: 0,
};

async function loadPage() {
  const mod = await import('../../../src/components/subagents/SubagentsDiscoveryPage');
  return mod.SubagentsDiscoveryPage;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('SubagentsDiscoveryPage 卸载已安装 Subagent', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.discoverAvailableSubagents.mockResolvedValue([discoverable]);
    mockApi.getSubagentRepos.mockResolvedValue([]);
    mockApi.uninstallSubagent.mockResolvedValue({ backupPath: '/tmp/bak' });
  });

  afterEach(() => {
    cleanup();
  });

  it('点击卸载会调用卸载接口并更新安装态', async () => {
    mockApi.getInstalledSubagents.mockResolvedValueOnce([installed]).mockResolvedValue([]);
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    const uninstallButton = await screen.findByRole('button', { name: '卸载' });
    fireEvent.click(uninstallButton);

    await waitFor(() => expect(mockApi.uninstallSubagent).toHaveBeenCalledTimes(1));
    expect(mockApi.uninstallSubagent.mock.calls[0][0]).toBe('a/b:reviewer.md');

    // 安装态更新：卡片回到未安装状态并给出成功反馈
    await screen.findByRole('button', { name: '安装' });
    expect(screen.queryByRole('button', { name: '卸载' })).toBeNull();
    expect(screen.getByText('已卸载 Reviewer。')).toBeTruthy();
  });

  it('卸载失败时展示错误反馈，安装态保持不变', async () => {
    mockApi.getInstalledSubagents.mockResolvedValue([installed]);
    mockApi.uninstallSubagent.mockRejectedValue(new Error('boom'));
    const Page = await loadPage();
    render(<Page activeApp="claude-code" />, { wrapper: createWrapper(queryClient) });

    const uninstallButton = await screen.findByRole('button', { name: '卸载' });
    fireEvent.click(uninstallButton);

    await waitFor(() => expect(mockApi.uninstallSubagent).toHaveBeenCalledTimes(1));
    expect(mockApi.uninstallSubagent.mock.calls[0][0]).toBe('a/b:reviewer.md');
    await screen.findByText('操作失败，请稍后重试。');
    expect(screen.getByRole('button', { name: '卸载' })).toBeTruthy();
  });
});
