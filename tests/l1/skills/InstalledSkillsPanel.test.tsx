// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConfigContext,
  InstalledSkill,
  ProjectSummary,
  ScopeTarget,
  SkillUpdateInfo,
  UnmanagedSkill,
} from '../../../src/types';

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

const globalContext: ConfigContext = { kind: 'global' };
const allContext: ConfigContext = { kind: 'all' };
const globalTarget: ScopeTarget = { scope: 'global' };
const projectTarget: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
const projects: readonly ProjectSummary[] = [
  { projectId: 'project-alpha', displayName: '项目 Alpha', rootPath: '/workspaces/alpha' },
];

const installedSkill = (
  id: string,
  name: string,
  target: ScopeTarget = globalTarget,
): InstalledSkill => ({
  id,
  name,
  directory: id,
  apps: { claudeCode: true, codex: false, geminiCli: false, opencode: false },
  installedAt: 1,
  updatedAt: 0,
  target,
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

function renderPanel(
  Panel: Awaited<ReturnType<typeof loadPanel>>,
  queryClient: QueryClient,
  context: ConfigContext = globalContext,
) {
  return render(<Panel activeApp="claude-code" context={context} projects={projects} />, {
    wrapper: createWrapper(queryClient),
  });
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

  it('同 directory 的两条默认只勾选第一条，并提示互斥', async () => {
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

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

    // 同 directory 组内默认只勾选第一条
    expect(firstCheckbox).toHaveProperty('checked', true);
    expect(secondCheckbox).toHaveProperty('checked', false);
    expect(within(dialog).getByRole('button', { name: /导入选中项 \(1\)/ })).toBeTruthy();
    expect(within(dialog).getAllByText('同名 Skill 一次只能导入一个来源')).toHaveLength(2);
  });

  it('勾选第二条时自动取消第一条，提交只含一条 selection', async () => {
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: /导入本地/ }));
    const dialog = await screen.findByRole('dialog');

    const firstItem = screen
      .getByText('/agents/claude/skills/shared')
      .closest('.skill-import-item');
    const secondItem = screen
      .getByText('/agents/codex/skills/shared')
      .closest('.skill-import-item');
    const firstCheckbox = within(firstItem as HTMLElement).getAllByRole('checkbox')[0];
    const secondCheckbox = within(secondItem as HTMLElement).getAllByRole('checkbox')[0];

    fireEvent.click(secondCheckbox);
    expect(firstCheckbox).toHaveProperty('checked', false);
    expect(secondCheckbox).toHaveProperty('checked', true);

    fireEvent.click(within(dialog).getByRole('button', { name: /导入选中项 \(1\)/ }));

    await waitFor(() => expect(mockApi.importSkillsFromApps).toHaveBeenCalledTimes(1));
    expect(mockApi.importSkillsFromApps.mock.calls[0][0]).toEqual([
      {
        directory: 'shared',
        sourcePath: '/agents/codex/skills/shared',
        apps: { claudeCode: false, codex: true, geminiCli: false, opencode: false },
      },
    ]);
    expect(mockApi.importSkillsFromApps.mock.calls[0][1]).toEqual(globalTarget);
  });

  it('directory 大小写不同（Foo / foo）也视为同一组：默认只勾第一条并互斥', async () => {
    mockApi.scanUnmanagedSkills.mockResolvedValue([
      {
        directory: 'Foo',
        name: 'FooSkill',
        foundIn: ['claude-code'],
        path: '/agents/claude/skills/Foo',
      },
      {
        directory: 'foo',
        name: 'FooSkill',
        foundIn: ['codex'],
        path: '/agents/codex/skills/foo',
      },
    ] satisfies UnmanagedSkill[]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: /导入本地/ }));
    const dialog = await screen.findByRole('dialog');

    const firstItem = screen.getByText('/agents/claude/skills/Foo').closest('.skill-import-item');
    const secondItem = screen.getByText('/agents/codex/skills/foo').closest('.skill-import-item');
    expect(firstItem).not.toBeNull();
    expect(secondItem).not.toBeNull();
    const firstCheckbox = within(firstItem as HTMLElement).getAllByRole('checkbox')[0];
    const secondCheckbox = within(secondItem as HTMLElement).getAllByRole('checkbox')[0];

    // 默认只勾第一条，且两条都有互斥提示
    expect(firstCheckbox).toHaveProperty('checked', true);
    expect(secondCheckbox).toHaveProperty('checked', false);
    expect(within(dialog).getByRole('button', { name: /导入选中项 \(1\)/ })).toBeTruthy();
    expect(within(dialog).getAllByText('同名 Skill 一次只能导入一个来源')).toHaveLength(2);

    // 勾选第二条自动取消第一条，提交 payload 只有一条
    fireEvent.click(secondCheckbox);
    expect(firstCheckbox).toHaveProperty('checked', false);
    expect(secondCheckbox).toHaveProperty('checked', true);

    fireEvent.click(within(dialog).getByRole('button', { name: /导入选中项 \(1\)/ }));

    await waitFor(() => expect(mockApi.importSkillsFromApps).toHaveBeenCalledTimes(1));
    expect(mockApi.importSkillsFromApps.mock.calls[0][0]).toEqual([
      {
        directory: 'foo',
        sourcePath: '/agents/codex/skills/foo',
        apps: { claudeCode: false, codex: true, geminiCli: false, opencode: false },
      },
    ]);
    expect(mockApi.importSkillsFromApps.mock.calls[0][1]).toEqual(globalTarget);
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
    renderPanel(Panel, queryClient);

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

describe('InstalledSkillsPanel 全部上下文的操作目标', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.getInstalledSkills.mockResolvedValue([]);
    mockApi.getSkillBackups.mockResolvedValue([]);
    mockApi.scanUnmanagedSkills.mockResolvedValue([
      {
        directory: 'local-skill',
        name: 'Local Skill',
        foundIn: ['claude-code'],
        path: '/agents/claude/skills/local-skill',
      },
    ] satisfies UnmanagedSkill[]);
    mockApi.importSkillsFromApps.mockResolvedValue([]);
    mockApi.installSkillsFromZip.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('未选目标不调用导入或 ZIP 安装；选择后使用明确 target', async () => {
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.click(await screen.findByRole('button', { name: '导入本地' }));
    expect(mockApi.scanUnmanagedSkills).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      '请先选择全局配置或一个项目配置作为操作目标。',
    );

    fireEvent.change(screen.getByLabelText('选择 Skill 操作目标'), {
      target: { value: 'global' },
    });
    fireEvent.click(screen.getByRole('button', { name: '导入本地' }));
    const dialog = await screen.findByRole('dialog', { name: '导入本地 Skill' });
    fireEvent.click(within(dialog).getByRole('button', { name: /导入选中项/ }));

    await waitFor(() =>
      expect(mockApi.importSkillsFromApps).toHaveBeenCalledWith(expect.any(Array), globalTarget),
    );

    fireEvent.change(screen.getByLabelText('选择 Skill 操作目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.change(screen.getByPlaceholderText('ZIP 文件路径'), {
      target: { value: '/tmp/local-skill.zip' },
    });
    fireEvent.click(screen.getByRole('button', { name: '从 ZIP 安装' }));

    await waitFor(() =>
      expect(mockApi.installSkillsFromZip).toHaveBeenCalledWith(
        '/tmp/local-skill.zip',
        'claude-code',
        projectTarget,
      ),
    );
  });

  it('更新从已安装行的 target 派生，不依赖当前 all 上下文', async () => {
    const projectSkill = installedSkill('project-skill', 'Project Skill', projectTarget);
    mockApi.getInstalledSkills.mockResolvedValue([projectSkill]);
    mockApi.getSkillBackups.mockResolvedValue([]);
    mockApi.checkSkillUpdates.mockResolvedValue([
      { id: 'project-skill', name: 'Project Skill', remoteHash: 'next' },
    ] satisfies SkillUpdateInfo[]);
    mockApi.updateSkill.mockResolvedValue(projectSkill);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.change(await screen.findByLabelText('选择 Skill 操作目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    fireEvent.click(await screen.findByRole('button', { name: '更新 Project Skill' }));

    await waitFor(() =>
      expect(mockApi.updateSkill).toHaveBeenCalledWith('project-skill', projectTarget),
    );
  });
});

describe('InstalledSkillsPanel 列表和详情', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), description: '用于检查提交规范' },
    ]);
    mockApi.getSkillBackups.mockResolvedValue([]);
    mockApi.toggleSkillApp.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('点击高密度行进入详情，Agent checkbox 仍调用即时 toggle mutation', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), target: projectTarget },
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    const rowHeading = await screen.findByRole('heading', { name: 'SkillA' });
    fireEvent.click(rowHeading);

    const detail = await screen.findByLabelText('SkillA 详情');
    expect(detail.getAttribute('data-skill-detail')).toBe('skill-a');
    const claudeCheckbox = within(detail).getByRole('checkbox', { name: 'Claude Code' });
    fireEvent.click(claudeCheckbox);

    await waitFor(() =>
      expect(mockApi.toggleSkillApp).toHaveBeenCalledWith(
        'skill-a',
        projectTarget,
        'claude-code',
        false,
      ),
    );
    expect(screen.getByRole('status').textContent).toContain('已停用 Claude Code。');
  });

  it('卸载先确认，取消不调用 mutation，确认后按 Skill ID 卸载', async () => {
    mockApi.uninstallSkill.mockResolvedValue({ backupPath: '/tmp/skill-a' });
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), target: projectTarget },
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    const uninstallButton = await screen.findByRole('button', { name: '卸载 SkillA' });
    fireEvent.click(uninstallButton);

    const dialog = await screen.findByRole('dialog', { name: '确认卸载' });
    expect(within(dialog).getByText(/确定要卸载 SkillA/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockApi.uninstallSkill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '卸载 SkillA' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '卸载' }),
    );

    await waitFor(() => expect(mockApi.uninstallSkill).toHaveBeenCalledTimes(1));
    expect(mockApi.uninstallSkill).toHaveBeenCalledWith('skill-a', projectTarget);
    expect(screen.getByRole('status').textContent).toContain('已卸载 SkillA。');
  });

  it('进入详情后将焦点移到返回按钮，返回列表时恢复到原行', async () => {
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    const row = await screen.findByRole('button', { name: /^SkillA/ });
    row.focus();
    fireEvent.click(row);

    const backButton = await screen.findByRole('button', { name: '返回列表' });
    await waitFor(() => expect(document.activeElement).toBe(backButton));

    fireEvent.click(backButton);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^SkillA/ })),
    );
  });

  it('筛选后选中的 Skill 不再可见时回到列表状态', async () => {
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('heading', { name: 'SkillA' }));
    await screen.findByLabelText('SkillA 详情');

    fireEvent.change(screen.getByPlaceholderText('搜索已安装 Skill'), {
      target: { value: 'does-not-match' },
    });

    await waitFor(() => expect(screen.queryByLabelText('SkillA 详情')).toBeNull());
    expect(screen.getByText('没有匹配的 Skill')).toBeTruthy();
  });

  it('切换配置上下文时清空详情选择', async () => {
    const Panel = await loadPanel();
    const { rerender } = renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('heading', { name: 'SkillA' }));
    await screen.findByLabelText('SkillA 详情');

    rerender(<Panel activeApp="claude-code" context={allContext} projects={projects} />);

    await waitFor(() => expect(screen.queryByLabelText('SkillA 详情')).toBeNull());
    expect(screen.getByRole('heading', { name: '已安装' })).toBeTruthy();
  });
});

describe('InstalledSkillsPanel 查询错误', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
  });

  afterEach(() => cleanup());

  it('将已安装查询的项目目录错误呈现为可读 alert', async () => {
    mockApi.getInstalledSkills.mockRejectedValue(
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
