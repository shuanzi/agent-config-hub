// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConfigContext,
  InstalledSubagent,
  ProjectSummary,
  ScopeTarget,
  SubagentBackupEntry,
  SubagentUpdateInfo,
} from '../../../src/types';

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

const globalContext: ConfigContext = { kind: 'global' };
const allContext: ConfigContext = { kind: 'all' };
const globalTarget: ScopeTarget = { scope: 'global' };
const projectTarget: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
const projects: readonly ProjectSummary[] = [
  { projectId: 'project-alpha', displayName: '项目 Alpha', rootPath: '/workspaces/alpha' },
];

const installedSubagent = (
  id: string,
  name: string,
  target: ScopeTarget = globalTarget,
): InstalledSubagent => ({
  id,
  name,
  directory: id,
  apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
  installedAt: 1,
  updatedAt: 0,
  target,
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

function renderPanel(
  Panel: Awaited<ReturnType<typeof loadPanel>>,
  queryClient: QueryClient,
  context: ConfigContext = globalContext,
) {
  return render(<Panel context={context} projects={projects} />, {
    wrapper: createWrapper(queryClient),
  });
}

describe('InstalledSubagentsPanel scope contracts', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.getInstalledSubagents.mockResolvedValue([
      installedSubagent('sub-a', 'SubA'),
      installedSubagent('sub-b', 'SubB'),
    ]);
    mockApi.getSubagentBackups.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('全部上下文未选操作目标时不检查更新；选择项目后更新传记录 target', async () => {
    const projectSubagent = installedSubagent('project-sub', 'Project Sub', projectTarget);
    mockApi.getInstalledSubagents.mockResolvedValue([projectSubagent]);
    mockApi.checkSubagentUpdates.mockResolvedValue([
      { id: 'project-sub', name: 'Project Sub', remoteHash: 'next' },
    ] satisfies SubagentUpdateInfo[]);
    mockApi.updateSubagent.mockResolvedValue(projectSubagent);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.click(await screen.findByRole('button', { name: '检查更新' }));
    expect(mockApi.checkSubagentUpdates).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      '请先选择全局配置或一个项目配置作为操作目标。',
    );

    fireEvent.change(screen.getByLabelText('选择 Subagent 操作目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    fireEvent.click(await screen.findByRole('button', { name: /Project Sub/ }));
    fireEvent.click(
      within(await screen.findByLabelText('Project Sub 详情')).getByRole('button', {
        name: '更新',
      }),
    );

    await waitFor(() =>
      expect(mockApi.updateSubagent).toHaveBeenCalledWith('project-sub', projectTarget),
    );
  });

  it('toggle 和卸载从已安装行 target 派生', async () => {
    const projectSubagent = installedSubagent('project-sub', 'Project Sub', projectTarget);
    mockApi.getInstalledSubagents.mockResolvedValue([projectSubagent]);
    mockApi.uninstallSubagent.mockResolvedValue({ backupPath: '/tmp/project-sub' });
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.click(await screen.findByRole('button', { name: /Project Sub/ }));
    const detail = await screen.findByLabelText('Project Sub 详情');
    const claudeToggle = within(detail).getByRole('checkbox', { name: 'Claude Code：已启用' });
    fireEvent.click(claudeToggle);
    await waitFor(() =>
      expect(mockApi.toggleSubagentApp).toHaveBeenCalledWith(
        'project-sub',
        projectTarget,
        'claude-code',
        false,
      ),
    );

    fireEvent.click(within(detail).getByRole('button', { name: '卸载' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '确认卸载' })).getByRole('button', {
        name: '卸载',
      }),
    );
    await waitFor(() =>
      expect(mockApi.uninstallSubagent).toHaveBeenCalledWith('project-sub', projectTarget),
    );
  });

  it('项目级 Codex toggle 禁用且不调用 mutation', async () => {
    const projectSubagent = installedSubagent('project-sub', 'Project Sub', projectTarget);
    mockApi.getInstalledSubagents.mockResolvedValue([projectSubagent]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.click(await screen.findByRole('button', { name: /Project Sub/ }));
    const codexToggle = await screen.findByRole('checkbox', { name: 'Codex：项目配置不支持' });
    expect(codexToggle).toHaveProperty('disabled', true);
    fireEvent.click(codexToggle);
    expect(mockApi.toggleSubagentApp).not.toHaveBeenCalled();
  });

  it('备份读取与恢复、删除均使用备份记录 target', async () => {
    const backup: SubagentBackupEntry = {
      backupId: 'backup-project-sub',
      backupPath: '/tmp/backup-project-sub',
      createdAt: 1,
      subagent: installedSubagent('project-sub', 'Project Sub', projectTarget),
    };
    mockApi.getSubagentBackups.mockResolvedValue([backup]);
    mockApi.restoreSubagentBackup.mockResolvedValue(backup.subagent);
    mockApi.deleteSubagentBackup.mockResolvedValue(undefined);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    expect((await screen.findByRole('button', { name: '备份' })).hasAttribute('disabled')).toBe(
      true,
    );
    expect(mockApi.getSubagentBackups).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('选择 Subagent 操作目标'), {
      target: { value: 'project:project-alpha' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '备份' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '备份' }));
    const dialog = await screen.findByRole('dialog', { name: 'Subagent 备份' });
    expect(mockApi.getSubagentBackups).toHaveBeenCalledWith(projectTarget);
    fireEvent.click(await within(dialog).findByRole('button', { name: '恢复' }));
    await waitFor(() =>
      expect(mockApi.restoreSubagentBackup).toHaveBeenCalledWith(
        'backup-project-sub',
        projectTarget,
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '备份' }));
    const reopened = await screen.findByRole('dialog', { name: 'Subagent 备份' });
    fireEvent.click(
      await within(reopened).findByRole('button', { name: '删除 Project Sub 的备份' }),
    );
    await waitFor(() =>
      expect(mockApi.deleteSubagentBackup).toHaveBeenCalledWith(
        'backup-project-sub',
        projectTarget,
      ),
    );
  });

  it('上下文切换清空详情选择并回到列表表面', async () => {
    const Panel = await loadPanel();
    const { rerender } = renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: /SubA/ }));
    await screen.findByLabelText('SubA 详情');
    rerender(<Panel context={allContext} projects={projects} />);

    await waitFor(() => expect(screen.queryByLabelText('SubA 详情')).toBeNull());
    expect(screen.getByLabelText('已安装 Subagents')).toBeTruthy();
  });
});

describe('InstalledSubagentsPanel 查询错误', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
  });

  afterEach(() => cleanup());

  it('将已安装查询的项目目录错误呈现为可读 alert', async () => {
    mockApi.getInstalledSubagents.mockRejectedValue(
      new Error(
        JSON.stringify({
          code: 'PROJECT_ROOT_UNAVAILABLE',
          context: { projectId: 'project-alpha' },
          suggestion: 'relinkProject',
        }),
      ),
    );
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, { kind: 'project', projectId: 'project-alpha' });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('项目目录不可用');
    expect(alert.textContent).not.toContain('PROJECT_ROOT_UNAVAILABLE');
  });
});
