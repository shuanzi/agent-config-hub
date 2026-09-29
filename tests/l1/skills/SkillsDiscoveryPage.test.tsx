// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConfigContext,
  DiscoverableSkill,
  InstalledSkill,
  ProjectSummary,
  ScopeTarget,
  SkillPlacementTarget,
} from '../../../src/types';

const mockApi = {
  getInstalledSkills: vi.fn(),
  discoverAvailableSkills: vi.fn(),
  getSkillRepos: vi.fn(),
  getSkillPlacementTargets: vi.fn(),
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

function placementTargets(target: ScopeTarget): SkillPlacementTarget[] {
  const prefix = target.scope === 'global' ? '/home/user' : `/workspaces/${target.projectId}`;
  const codexPath =
    target.scope === 'global' ? `${prefix}/.codex/skills` : `${prefix}/.agents/skills`;
  const opencodePath =
    target.scope === 'global' ? `${prefix}/.config/opencode/skills` : `${prefix}/.opencode/skills`;
  const agents: SkillPlacementTarget[] = [
    {
      location: 'claude-code',
      aliases: [],
      path: `${prefix}/.claude/skills`,
      physicalPath: `${prefix}/.claude/skills`,
    },
    { location: 'codex', aliases: [], path: codexPath, physicalPath: codexPath },
    {
      location: 'gemini-cli',
      aliases: [],
      path: `${prefix}/.gemini/skills`,
      physicalPath: `${prefix}/.gemini/skills`,
    },
    { location: 'opencode', aliases: [], path: opencodePath, physicalPath: opencodePath },
  ];
  return target.scope === 'global'
    ? [
        {
          location: 'shared',
          aliases: [],
          path: `${prefix}/.agents/skills`,
          physicalPath: `${prefix}/.agents/skills`,
        },
        ...agents,
      ]
    : agents;
}

function setupPlacementTargets() {
  mockApi.getSkillPlacementTargets.mockImplementation((target: ScopeTarget) =>
    Promise.resolve(placementTargets(target)),
  );
}

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
  projectList: readonly ProjectSummary[] = projects,
) {
  return render(<Page context={context} projects={projectList} />, {
    wrapper: createWrapper(queryClient),
  });
}

describe('SkillsDiscoveryPage 配置目标合同', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    setupPlacementTargets();
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
    const globalInstallDialog = await screen.findByRole('dialog', { name: '安装 TestSkill' });
    fireEvent.click(
      within(globalInstallDialog).getByRole('radio', { name: /Codex.*\.codex\/skills/ }),
    );
    fireEvent.click(within(globalInstallDialog).getByRole('button', { name: '确认安装' }));
    await waitFor(() =>
      expect(mockApi.installSkill).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'a/b:skill' }),
        globalTarget,
        'codex',
      ),
    );

    fireEvent.change(screen.getByLabelText('选择 Skill 发现目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    const projectInstallDialog = await screen.findByRole('dialog', { name: '安装 TestSkill' });
    fireEvent.click(
      within(projectInstallDialog).getByRole('radio', { name: /OpenCode.*opencode\/skills/ }),
    );
    fireEvent.click(within(projectInstallDialog).getByRole('button', { name: '确认安装' }));
    await waitFor(() =>
      expect(mockApi.installSkill).toHaveBeenLastCalledWith(
        expect.objectContaining({ key: 'a/b:skill' }),
        projectTarget,
        'opencode',
      ),
    );
  });

  it('切换到项目后重新打开安装框，不展示查询期间保留的全局位置', async () => {
    let resolveProject!: (targets: SkillPlacementTarget[]) => void;
    mockApi.getSkillPlacementTargets.mockImplementation((target: ScopeTarget) =>
      target.scope === 'global'
        ? Promise.resolve(placementTargets(target))
        : new Promise<SkillPlacementTarget[]>((resolve) => {
            resolveProject = resolve;
          }),
    );
    const Page = await loadPage();
    renderPage(Page, queryClient, allContext);
    fireEvent.change(screen.getByLabelText('选择 Skill 发现目标'), { target: { value: 'global' } });
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    let dialog = await screen.findByRole('dialog', { name: '安装 TestSkill' });
    await within(dialog).findByRole('radio', { name: /共享目录/ });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    fireEvent.change(screen.getByLabelText('选择 Skill 发现目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    dialog = await screen.findByRole('dialog', { name: '安装 TestSkill' });
    const confirm = within(dialog).getByRole('button', { name: '确认安装' });
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(confirm);
    expect(mockApi.installSkill).not.toHaveBeenCalled();
    await act(async () => resolveProject(placementTargets(projectTarget)));
    expect(await within(dialog).findAllByRole('radio')).toHaveLength(4);
    expect(within(dialog).queryByRole('radio', { name: /共享目录/ })).toBeNull();
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Codex/ }));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mockApi.installSkill).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'a/b:skill' }),
        projectTarget,
        'codex',
      ),
    );
    expect(mockApi.installSkill).toHaveBeenCalledTimes(1);
  });

  it.each(['removed', 'failed'] as const)(
    '位置刷新中及所选位置失效时禁止安装：%s',
    async (outcome) => {
      const Page = await loadPage();
      renderPage(Page, queryClient);
      fireEvent.click(await screen.findByRole('button', { name: '安装' }));
      const dialog = await screen.findByRole('dialog', { name: '安装 TestSkill' });
      fireEvent.click(await within(dialog).findByRole('radio', { name: /共享目录/ }));
      const confirm = within(dialog).getByRole('button', { name: '确认安装' });
      expect(confirm).toHaveProperty('disabled', false);
      let resolveTargets!: (targets: SkillPlacementTarget[]) => void;
      let rejectTargets!: (error: Error) => void;
      mockApi.getSkillPlacementTargets.mockImplementationOnce(
        () =>
          new Promise<SkillPlacementTarget[]>((resolve, reject) => {
            resolveTargets = resolve;
            rejectTargets = reject;
          }),
      );
      let refresh!: Promise<void>;
      act(() => {
        refresh = queryClient.invalidateQueries({ queryKey: ['skills', 'placement-targets'] });
      });
      await waitFor(() => expect(confirm).toHaveProperty('disabled', true));
      expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
      fireEvent.click(confirm);
      expect(mockApi.installSkill).not.toHaveBeenCalled();
      await act(async () => {
        if (outcome === 'failed') rejectTargets(new Error('placement query failed'));
        else
          resolveTargets(
            placementTargets(globalTarget).filter((target) => target.location !== 'shared'),
          );
        await refresh;
      });
      if (outcome === 'removed') {
        expect(await within(dialog).findAllByRole('radio')).toHaveLength(4);
      }
      expect(confirm).toHaveProperty('disabled', true);
      expect(within(dialog).queryByRole('radio', { name: /共享目录/ })).toBeNull();
      fireEvent.click(confirm);
      expect(mockApi.installSkill).not.toHaveBeenCalled();
      if (outcome === 'removed') {
        fireEvent.click(within(dialog).getByRole('radio', { name: /Codex/ }));
        fireEvent.click(confirm);
        await waitFor(() =>
          expect(mockApi.installSkill).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'a/b:skill' }),
            globalTarget,
            'codex',
          ),
        );
      } else {
        // Reopening after a failed refetch must not expose the cached options.
        fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
        fireEvent.click(screen.getByRole('button', { name: '安装' }));
        const reopened = await screen.findByRole('dialog', { name: '安装 TestSkill' });
        expect(within(reopened).queryAllByRole('radio')).toHaveLength(0);
        expect(within(reopened).getByRole('button', { name: '确认安装' })).toHaveProperty(
          'disabled',
          true,
        );
      }
    },
  );

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

  it('安装失败在对话框内提示并保留 Agent 选择以便重试', async () => {
    mockApi.installSkill.mockRejectedValueOnce(new Error('boom'));
    const Page = await loadPage();
    renderPage(Page, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 TestSkill' });
    const codexRadio = within(dialog).getByRole('radio', { name: /Codex.*\.codex\/skills/ });
    fireEvent.click(codexRadio);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认安装' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      '操作失败，请稍后重试。',
    );
    expect(codexRadio).toHaveProperty('checked', true);
    const retryButton = within(dialog).getByRole('button', { name: '确认安装' });
    expect(retryButton).toHaveProperty('disabled', false);

    fireEvent.click(retryButton);
    await waitFor(() => expect(mockApi.installSkill).toHaveBeenCalledTimes(2));
    expect(mockApi.installSkill).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: 'a/b:skill' }),
      globalTarget,
      'codex',
    );
  });

  it('项目 displayName 重名时发现目标和安装对话框用 rootPath 消歧', async () => {
    const duplicateProjects: readonly ProjectSummary[] = [
      { projectId: 'project-alpha', displayName: '同名项目', rootPath: '/workspaces/alpha' },
      { projectId: 'project-beta', displayName: '同名项目', rootPath: '/workspaces/beta' },
    ];
    const betaTarget: ScopeTarget = { scope: 'project', projectId: 'project-beta' };
    const Page = await loadPage();
    renderPage(Page, queryClient, allContext, duplicateProjects);

    const selector = await screen.findByLabelText('选择 Skill 发现目标');
    expect(
      screen.getByRole('option', { name: '项目配置：同名项目（/workspaces/alpha）' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: '项目配置：同名项目（/workspaces/beta）' }),
    ).toBeTruthy();
    fireEvent.change(selector, { target: { value: 'project:project-beta' } });
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 TestSkill' });
    expect(
      within(dialog).getByText('安装目标：项目配置：同名项目（/workspaces/beta）'),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: /OpenCode.*opencode\/skills/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认安装' }));

    await waitFor(() =>
      expect(mockApi.installSkill).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'a/b:skill' }),
        betaTarget,
        'opencode',
      ),
    );
  });
});

describe('SkillsDiscoveryPage 列表与上下文切换', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    setupPlacementTargets();
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
    rerender(<Page context={allContext} projects={projects} />);

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

  it('全局安装对话框展示共享目录和四个品牌目录，选择前不能确认', async () => {
    const Page = await loadPage();
    renderPage(Page, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 TestSkill' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
    expect(within(dialog).getByRole('radio', { name: /共享目录.*\.agents\/skills/ })).toBeTruthy();
    expect(
      within(dialog).getByRole('radio', { name: /Claude Code.*\.claude\/skills/ }),
    ).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: /Codex.*\.codex\/skills/ })).toBeTruthy();
    expect(
      within(dialog).getByRole('radio', { name: /Gemini CLI.*\.gemini\/skills/ }),
    ).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: /OpenCode.*opencode\/skills/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '确认安装' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
