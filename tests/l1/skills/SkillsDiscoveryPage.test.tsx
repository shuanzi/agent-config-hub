// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConfigContext,
  DiscoverableSkill,
  InstalledSkill,
  ProjectSummary,
  ScopeTarget,
} from '../../../src/types';

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

const globalContext: ConfigContext = { kind: 'global' };
const allContext: ConfigContext = { kind: 'all' };
const globalTarget: ScopeTarget = { scope: 'global' };
const projectTarget: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
const projects: readonly ProjectSummary[] = [
  { projectId: 'project-alpha', displayName: '项目 Alpha', rootPath: '/workspaces/alpha' },
];

const discoverable = (overrides: Partial<DiscoverableSkill> = {}): DiscoverableSkill => ({
  key: 'a/b:skill',
  name: 'TestSkill',
  description: 'desc',
  directory: 'skill',
  repoOwner: 'a',
  repoName: 'b',
  repoBranch: 'main',
  installed: false,
  ...overrides,
});

const installed = (target: ScopeTarget = globalTarget): InstalledSkill => ({
  id: 'a/b:skill',
  name: 'TestSkill',
  directory: 'skill',
  repoOwner: 'a',
  repoName: 'b',
  apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
  installedAt: 1,
  updatedAt: 0,
  target,
});

async function loadPage() {
  const mod = await import('../../../src/components/skills/SkillsDiscoveryPage');
  return mod.SkillsDiscoveryPage;
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
  return render(<Page activeApp="claude-code" context={context} projects={projects} />, {
    wrapper: createWrapper(queryClient),
  });
}

describe('SkillsDiscoveryPage 配置目标合同', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.discoverAvailableSkills.mockResolvedValue([discoverable()]);
    mockApi.getInstalledSkills.mockResolvedValue([]);
    mockApi.getSkillRepos.mockResolvedValue([]);
    mockApi.installSkill.mockResolvedValue(installed());
  });

  afterEach(() => cleanup());

  it('全部上下文未选目标时不发现或安装；选择全局与项目后传入完整 target', async () => {
    const Page = await loadPage();
    renderPage(Page, queryClient, allContext);

    expect(await screen.findByText('先选择发现目标')).toBeTruthy();
    expect(mockApi.discoverAvailableSkills).not.toHaveBeenCalled();
    expect(mockApi.installSkill).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('选择 Skill 发现目标'), {
      target: { value: 'global' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    await waitFor(() =>
      expect(mockApi.installSkill).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'a/b:skill' }),
        globalTarget,
        'claude-code',
      ),
    );

    fireEvent.change(screen.getByLabelText('选择 Skill 发现目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    await waitFor(() =>
      expect(mockApi.installSkill).toHaveBeenLastCalledWith(
        expect.objectContaining({ key: 'a/b:skill' }),
        projectTarget,
        'claude-code',
      ),
    );
  });

  it('卸载发现项时从已安装记录派生 target', async () => {
    mockApi.discoverAvailableSkills.mockResolvedValue([discoverable({ installed: true })]);
    mockApi.getInstalledSkills.mockResolvedValue([installed(projectTarget)]);
    mockApi.uninstallSkill.mockResolvedValue({ backupPath: '/tmp/bak' });
    const Page = await loadPage();
    renderPage(Page, queryClient, allContext);

    fireEvent.change(await screen.findByLabelText('选择 Skill 发现目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '卸载' }));
    const dialog = await screen.findByRole('dialog', { name: '确认卸载' });
    fireEvent.click(within(dialog).getByRole('button', { name: '卸载' }));

    await waitFor(() =>
      expect(mockApi.uninstallSkill).toHaveBeenCalledWith('a/b:skill', projectTarget),
    );
  });

  it('同仓库同名但完整 key 不同的发现项不混淆安装状态', async () => {
    mockApi.discoverAvailableSkills.mockResolvedValue([
      discoverable({
        key: 'a/b:a/reviewer',
        name: 'Reviewer A',
        directory: 'a/reviewer',
        installed: true,
      }),
      discoverable({ key: 'a/b:b/reviewer', name: 'Reviewer B', directory: 'b/reviewer' }),
    ]);
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installed(), id: 'a/b:a/reviewer', name: 'Reviewer A', directory: 'reviewer' },
    ]);
    const Page = await loadPage();
    renderPage(Page, queryClient);

    const installedCard = (await screen.findByRole('heading', { name: 'Reviewer A' })).closest(
      'article',
    );
    const uninstalledCard = (await screen.findByRole('heading', { name: 'Reviewer B' })).closest(
      'article',
    );
    expect(within(installedCard!).getByRole('button', { name: '卸载' })).toBeTruthy();
    expect(within(uninstalledCard!).getByRole('button', { name: '安装' })).toBeTruthy();
  });

  it('卸载失败通过 alert 呈现错误，保留当前安装态', async () => {
    mockApi.discoverAvailableSkills.mockResolvedValue([discoverable({ installed: true })]);
    mockApi.getInstalledSkills.mockResolvedValue([installed()]);
    mockApi.uninstallSkill.mockRejectedValue(new Error('boom'));
    const Page = await loadPage();
    renderPage(Page, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: '卸载' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: '确认卸载' })).getByRole('button', {
        name: '卸载',
      }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain('操作失败，请稍后重试。');
    expect(screen.getByRole('button', { name: '卸载' })).toBeTruthy();
  });
});

describe('SkillsDiscoveryPage 列表与上下文切换', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.discoverAvailableSkills.mockResolvedValue([discoverable()]);
    mockApi.getInstalledSkills.mockResolvedValue([]);
    mockApi.getSkillRepos.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('详情按完整 key 选择，筛选或上下文切换后退出详情', async () => {
    const Page = await loadPage();
    const { rerender } = renderPage(Page, queryClient);

    fireEvent.click(await screen.findByRole('heading', { name: 'TestSkill' }));
    expect((await screen.findByLabelText('TestSkill 详情')).getAttribute('data-skill-detail')).toBe(
      'a/b:skill',
    );

    fireEvent.change(screen.getByLabelText('按安装状态筛选'), { target: { value: 'installed' } });
    await waitFor(() => expect(screen.queryByLabelText('TestSkill 详情')).toBeNull());

    fireEvent.change(screen.getByLabelText('按安装状态筛选'), { target: { value: 'all' } });
    fireEvent.click(await screen.findByRole('heading', { name: 'TestSkill' }));
    await screen.findByLabelText('TestSkill 详情');
    rerender(<Page activeApp="claude-code" context={allContext} projects={projects} />);

    await waitFor(() => expect(screen.queryByLabelText('TestSkill 详情')).toBeNull());
    expect(screen.getByText('先选择发现目标')).toBeTruthy();
  });

  it('进入发现详情后聚焦返回按钮，返回列表时恢复到原行', async () => {
    const Page = await loadPage();
    renderPage(Page, queryClient);

    const row = await screen.findByRole('button', { name: /TestSkill/ });
    row.focus();
    fireEvent.click(row);

    const backButton = await screen.findByRole('button', { name: '返回列表' });
    await waitFor(() => expect(document.activeElement).toBe(backButton));
    fireEvent.click(backButton);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /TestSkill/ })),
    );
  });
});
