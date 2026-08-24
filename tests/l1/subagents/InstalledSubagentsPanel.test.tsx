// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { InstalledSubagent, SubagentUpdateInfo } from '../../../src/types';

const mockApi = {
  getInstalledSubagents: vi.fn(),
  discoverAvailableSubagents: vi.fn(),
  installSubagent: vi.fn(),
  uninstallSubagent: vi.fn(),
  toggleSubagentApp: vi.fn(),
  checkSubagentUpdates: vi.fn(),
  updateSubagent: vi.fn(),
  getSubagentRepos: vi.fn(),
  addSubagentRepo: vi.fn(),
  removeSubagentRepo: vi.fn(),
  getSubagentBackups: vi.fn(),
  restoreSubagentBackup: vi.fn(),
  deleteSubagentBackup: vi.fn(),
};

vi.mock('../../../src/lib/api/subagents', () => mockApi);

const installedSubagent = (id: string, name: string): InstalledSubagent => ({
  id,
  name,
  directory: id,
  apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
  installedAt: 1,
  updatedAt: 0,
});

async function loadPanel() {
  const mod = await import('../../../src/components/subagents/InstalledSubagentsPanel');
  return mod.InstalledSubagentsPanel;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('InstalledSubagentsPanel 全部更新部分失败', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.getInstalledSubagents.mockResolvedValue([
      installedSubagent('sub-a', 'SubA'),
      installedSubagent('sub-b', 'SubB'),
    ]);
    mockApi.getSubagentBackups.mockResolvedValue([]);
    const updates: SubagentUpdateInfo[] = [
      { id: 'sub-a', name: 'SubA', remoteHash: 'h1' },
      { id: 'sub-b', name: 'SubB', remoteHash: 'h2' },
    ];
    mockApi.checkSubagentUpdates.mockResolvedValue(updates);
    mockApi.updateSubagent.mockImplementation((id: string) => {
      if (id === 'sub-a') {
        return Promise.resolve(installedSubagent('sub-a', 'SubA'));
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
      const error = document.querySelector('.subagent-error');
      expect(error?.textContent).toContain('成功更新 1 个 Subagent');
      expect(error?.textContent).toContain('SubB');
      expect(error?.textContent).toContain('下载仓库失败');
    });
  });
});
