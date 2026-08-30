// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConfigContext,
  DiscoverableSubagent,
  InstalledSubagent,
  ProjectSummary,
  ScopeTarget,
} from '../../../src/types';

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

const globalContext: ConfigContext = { kind: 'global' };
const allContext: ConfigContext = { kind: 'all' };
const projectContext: ConfigContext = { kind: 'project', projectId: 'project-alpha' };
const globalTarget: ScopeTarget = { scope: 'global' };
const projectTarget: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
const projects: readonly ProjectSummary[] = [
  { projectId: 'project-alpha', displayName: '项目 Alpha', rootPath: '/workspaces/alpha' },
];

const discoverable = (overrides: Partial<DiscoverableSubagent> = {}): DiscoverableSubagent => ({
  key: 'a/b:reviewer.md',
  name: 'Reviewer',
  description: 'desc',
  directory: 'reviewer',
  path: 'agents/reviewer.md',
  repoOwner: 'a',
  repoName: 'b',
  repoBranch: 'main',
  installed: false,
  ...overrides,
});

const installed = (target: ScopeTarget = globalTarget): InstalledSubagent => ({
  id: 'a/b:reviewer.md',
  name: 'Reviewer',
  directory: 'reviewer',
  repoOwner: 'a',
  repoName: 'b',
  apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
  installedAt: 1,
  updatedAt: 0,
  target,
});

async function loadPage() {
  const mod = await import('../../../src/components/subagents/SubagentsDiscoveryPage');
  return mod.SubagentsDiscoveryPage;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderPage(
  Page: Awaited<ReturnType<typeof loadPage>>,
  queryClient: QueryClient,
  context: ConfigContext = globalContext,
) {
  return render(<Page context={context} projects={projects} />, {
    wrapper: createWrapper(queryClient),
  });
}

describe('SubagentsDiscoveryPage scope contracts', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.discoverAvailableSubagents.mockResolvedValue([discoverable()]);
    mockApi.getInstalledSubagents.mockResolvedValue([]);
    mockApi.getSubagentRepos.mockResolvedValue([]);
    mockApi.installSubagent.mockResolvedValue(installed());
  });

  afterEach(() => cleanup());

  it('全部上下文未选目标不查询或安装；选择全局和项目后带完整 target', async () => {
    const Page = await loadPage();
    renderPage(Page, queryClient, allContext);

    expect(await screen.findByText('先选择发现目标')).toBeTruthy();
    expect(mockApi.discoverAvailableSubagents).not.toHaveBeenCalled();
    expect(mockApi.installSubagent).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('选择 Subagent 发现目标'), {
      target: { value: 'global' },
    });
    fireEvent.click((await screen.findAllByRole('button', { name: /Reviewer/ }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    const globalInstallDialog = await screen.findByRole('dialog', { name: '安装 Reviewer' });
    fireEvent.click(within(globalInstallDialog).getByRole('radio', { name: 'Gemini CLI' }));
    fireEvent.click(within(globalInstallDialog).getByRole('button', { name: '确认安装' }));
    await waitFor(() =>
      expect(mockApi.installSubagent).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'a/b:reviewer.md' }),
        globalTarget,
        'gemini-cli',
      ),
    );

    fireEvent.change(screen.getByLabelText('选择 Subagent 发现目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Reviewer/ }));
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    const projectInstallDialog = await screen.findByRole('dialog', { name: '安装 Reviewer' });
    fireEvent.click(within(projectInstallDialog).getByRole('radio', { name: 'OpenCode' }));
    fireEvent.click(within(projectInstallDialog).getByRole('button', { name: '确认安装' }));
    await waitFor(() =>
      expect(mockApi.installSubagent).toHaveBeenLastCalledWith(
        expect.objectContaining({ key: 'a/b:reviewer.md' }),
        projectTarget,
        'opencode',
      ),
    );
  });

  it('项目安装对话框禁用 Codex，选择支持的 Agent 后可确认', async () => {
    const Page = await loadPage();
    renderPage(Page, queryClient, projectContext);

    fireEvent.click(await screen.findByRole('button', { name: /Reviewer/ }));
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 Reviewer' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(4);
    expect(within(dialog).getByRole('radio', { name: /Codex/ })).toHaveProperty('disabled', true);
    expect(within(dialog).getByText('项目配置不支持 Codex Subagent。')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: '确认安装' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Claude Code' }));
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mockApi.installSubagent).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'a/b:reviewer.md' }),
        projectTarget,
        'claude-code',
      ),
    );
  });

  it('安装失败在对话框内提示并保留 Agent 选择以便重试', async () => {
    mockApi.installSubagent.mockRejectedValueOnce(new Error('boom'));
    const Page = await loadPage();
    renderPage(Page, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: /Reviewer/ }));
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 Reviewer' });
    const geminiRadio = within(dialog).getByRole('radio', { name: 'Gemini CLI' });
    fireEvent.click(geminiRadio);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认安装' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      '操作失败，请稍后重试。',
    );
    expect(geminiRadio).toHaveProperty('checked', true);
    const retryButton = within(dialog).getByRole('button', { name: '确认安装' });
    expect(retryButton).toHaveProperty('disabled', false);

    fireEvent.click(retryButton);
    await waitFor(() => expect(mockApi.installSubagent).toHaveBeenCalledTimes(2));
    expect(mockApi.installSubagent).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: 'a/b:reviewer.md' }),
      globalTarget,
      'gemini-cli',
    );
  });

  it('卸载发现项从已安装记录派生 target', async () => {
    mockApi.discoverAvailableSubagents.mockResolvedValue([discoverable({ installed: true })]);
    mockApi.getInstalledSubagents.mockResolvedValue([installed(projectTarget)]);
    mockApi.uninstallSubagent.mockResolvedValue({ backupPath: '/tmp/bak' });
    const Page = await loadPage();
    renderPage(Page, queryClient, allContext);

    fireEvent.change(await screen.findByLabelText('选择 Subagent 发现目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Reviewer/ }));
    fireEvent.click(await screen.findByRole('button', { name: '卸载' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '确认卸载' })).getByRole('button', {
        name: '卸载',
      }),
    );
    await waitFor(() =>
      expect(mockApi.uninstallSubagent).toHaveBeenCalledWith('a/b:reviewer.md', projectTarget),
    );
  });

  it('完整 key 选择、错误 alert 与上下文切换保持独立', async () => {
    const other = discoverable({
      key: 'other/repo:reviewer.md',
      repoOwner: 'other',
      repoName: 'repo',
    });
    mockApi.discoverAvailableSubagents.mockResolvedValue([
      discoverable({ installed: true }),
      other,
    ]);
    mockApi.getInstalledSubagents.mockResolvedValue([installed()]);
    mockApi.uninstallSubagent.mockRejectedValue(new Error('boom'));
    const Page = await loadPage();
    const { rerender } = renderPage(Page, queryClient);

    fireEvent.click((await screen.findAllByRole('button', { name: /Reviewer/ }))[0]);
    const firstDetail = await screen.findByLabelText('Reviewer 详情');
    fireEvent.click(within(firstDetail).getByRole('button', { name: '卸载' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '确认卸载' })).getByRole('button', {
        name: '卸载',
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('操作失败，请稍后重试。');

    const otherRow = document.querySelector<HTMLButtonElement>(
      '[data-subagent-key="other/repo:reviewer.md"] .subagent-list-row-select',
    );
    expect(otherRow).not.toBeNull();
    fireEvent.click(otherRow!);
    expect((await screen.findByLabelText('Reviewer 详情')).dataset.subagentDetailKey).toBe(
      'other/repo:reviewer.md',
    );
    rerender(<Page context={allContext} projects={projects} />);

    await waitFor(() => expect(screen.queryByLabelText('Reviewer 详情')).toBeNull());
    expect(screen.getByText('先选择发现目标')).toBeTruthy();
  });
});
