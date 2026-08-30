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

const { mockOpenFileDialog } = vi.hoisted(() => ({
  mockOpenFileDialog: vi.fn(),
}));

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
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mockOpenFileDialog }));

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
  onOpenDiscovery: () => void = () => undefined,
  projectList: readonly ProjectSummary[] = projects,
) {
  return render(
    <Panel context={context} projects={projectList} onOpenDiscovery={onOpenDiscovery} />,
    {
      wrapper: createWrapper(queryClient),
    },
  );
}

describe('InstalledSkillsPanel 导入同目录不同来源的本地 Skill', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockOpenFileDialog.mockReset();
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

    fireEvent.click(await screen.findByRole('button', { name: /导入已有/ }));
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

    fireEvent.click(await screen.findByRole('button', { name: /导入已有/ }));
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

  it('导入失败在对话框内提示并保留选择以便重试', async () => {
    mockApi.importSkillsFromApps.mockRejectedValueOnce(new Error('boom'));
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: /导入已有/ }));
    const dialog = await screen.findByRole('dialog', { name: '导入已有 Skill' });
    const selectedItem = within(dialog).getByRole('checkbox', {
      name: '选择 SharedSkill，来源 /agents/claude/skills/shared',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /导入选中项/ }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      '操作失败，请稍后重试。',
    );
    expect(selectedItem).toHaveProperty('checked', true);
    expect(within(dialog).getByRole('button', { name: /导入选中项/ })).toHaveProperty(
      'disabled',
      false,
    );
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

    fireEvent.click(await screen.findByRole('button', { name: /导入已有/ }));
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
    mockOpenFileDialog.mockReset();
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

  it('一成功一失败时只保留失败项供重试', async () => {
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

    const retryButton = await screen.findByRole('button', { name: /全部更新 \(1\)/ });
    fireEvent.click(retryButton);
    await waitFor(() => expect(mockApi.updateSkill).toHaveBeenCalledTimes(3));
    expect(mockApi.updateSkill.mock.calls.map((call) => call[0])).toEqual([
      'skill-a',
      'skill-b',
      'skill-b',
    ]);
  });
});

describe('InstalledSkillsPanel 全部上下文的操作目标', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockOpenFileDialog.mockReset();
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

  it('未选目标时入口禁用；选择后导入使用明确 target', async () => {
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    const importButton = await screen.findByRole('button', { name: '导入已有' });
    expect(importButton).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '检查更新' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '从备份恢复' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '从 ZIP 安装' })).toHaveProperty('disabled', true);
    expect(
      screen.getByText('请先选择操作目标，检查更新、导入已有、备份恢复或 ZIP 安装才会启用。'),
    ).toBeTruthy();
    expect(mockApi.scanUnmanagedSkills).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('选择 Skill 操作目标'), {
      target: { value: 'global' },
    });
    fireEvent.click(screen.getByRole('button', { name: '从备份恢复' }));
    const backupDialog = await screen.findByRole('dialog', { name: '从备份恢复' });
    expect(within(backupDialog).getByText('备份范围：全局配置')).toBeTruthy();
    fireEvent.click(within(backupDialog).getByRole('button', { name: '关闭' }));

    fireEvent.click(screen.getByRole('button', { name: '导入已有' }));
    const dialog = await screen.findByRole('dialog', { name: '导入已有 Skill' });
    fireEvent.click(within(dialog).getByRole('button', { name: /导入选中项/ }));

    await waitFor(() =>
      expect(mockApi.importSkillsFromApps).toHaveBeenCalledWith(expect.any(Array), globalTarget),
    );
  });

  it('ZIP picker 只接受单个 ZIP，取消不安装，选择后提交真实路径、目标与 initialApp', async () => {
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.change(screen.getByLabelText('选择 Skill 操作目标'), {
      target: { value: 'project:project-alpha' },
    });
    fireEvent.click(screen.getByRole('button', { name: '从 ZIP 安装' }));
    const dialog = await screen.findByRole('dialog', { name: '从 ZIP 安装 Skill' });
    const installButton = within(dialog).getByRole('button', { name: '安装' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(4);
    expect(installButton).toHaveProperty('disabled', true);

    mockOpenFileDialog.mockResolvedValueOnce(null);
    fireEvent.click(within(dialog).getByRole('button', { name: '选择 ZIP 文件' }));
    await waitFor(() => expect(mockOpenFileDialog).toHaveBeenCalledTimes(1));
    expect(mockOpenFileDialog).toHaveBeenLastCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
    });
    expect(mockApi.installSkillsFromZip).not.toHaveBeenCalled();
    expect(within(dialog).getByText('尚未选择文件')).toBeTruthy();

    mockOpenFileDialog.mockResolvedValueOnce('/tmp/local-skill.zip');
    fireEvent.click(within(dialog).getByRole('button', { name: '选择 ZIP 文件' }));
    expect(await within(dialog).findByText('/tmp/local-skill.zip')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Codex' }));
    expect(installButton).toHaveProperty('disabled', false);
    mockApi.installSkillsFromZip.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(installButton);

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('操作失败，请稍后重试。');
    expect(within(dialog).getByText('/tmp/local-skill.zip')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Codex' })).toHaveProperty('checked', true);
    expect(installButton).toHaveProperty('disabled', false);

    fireEvent.click(installButton);
    await waitFor(() =>
      expect(mockApi.installSkillsFromZip).toHaveBeenLastCalledWith(
        '/tmp/local-skill.zip',
        'codex',
        projectTarget,
      ),
    );
    expect(mockApi.installSkillsFromZip).toHaveBeenCalledTimes(2);
  });

  it('备份恢复失败在 target-scoped 对话框内提示并保留备份项', async () => {
    const backup = {
      backupId: 'backup-1',
      backupPath: '/tmp/backups/skill-a',
      createdAt: 2,
      skill: installedSkill('skill-a', 'SkillA', globalTarget),
    };
    mockApi.getSkillBackups.mockResolvedValue([backup]);
    mockApi.restoreSkillBackup.mockRejectedValueOnce(new Error('boom'));
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.change(screen.getByLabelText('选择 Skill 操作目标'), {
      target: { value: 'global' },
    });
    fireEvent.click(screen.getByRole('button', { name: '从备份恢复' }));
    const dialog = await screen.findByRole('dialog', { name: '从备份恢复' });
    fireEvent.click(await within(dialog).findByRole('button', { name: '恢复' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      '操作失败，请稍后重试。',
    );
    expect(within(dialog).getByText('/tmp/backups/skill-a')).toBeTruthy();
    expect(mockApi.restoreSkillBackup).toHaveBeenCalledWith('backup-1', globalTarget);
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
    fireEvent.click(
      await screen.findByRole('button', {
        name: '更新 Project Skill，项目配置：项目 Alpha',
      }),
    );

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
    mockOpenFileDialog.mockReset();
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), description: '用于检查提交规范' },
    ]);
    mockApi.getSkillBackups.mockResolvedValue([]);
    mockApi.toggleSkillApp.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('全部上下文按完整 target 分组，同名记录可独立操作', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([
      installedSkill('shared-skill', 'Shared Skill', globalTarget),
      installedSkill('shared-skill', 'Shared Skill', projectTarget),
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    expect(await screen.findByRole('heading', { name: /全局配置.*1/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /项目配置：项目 Alpha.*1/ })).toBeTruthy();
    const globalDetailButton = screen.getByRole('button', {
      name: 'Shared Skill，全局配置，查看详情',
    });
    const projectDetailButton = screen.getByRole('button', {
      name: 'Shared Skill，项目配置：项目 Alpha，查看详情',
    });
    expect(globalDetailButton).toBeTruthy();
    expect(projectDetailButton).toBeTruthy();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Shared Skill，项目配置：项目 Alpha，Codex',
      }),
    );
    await waitFor(() =>
      expect(mockApi.toggleSkillApp).toHaveBeenCalledWith(
        'shared-skill',
        projectTarget,
        'codex',
        true,
      ),
    );
    expect(mockApi.toggleSkillApp).not.toHaveBeenCalledWith(
      'shared-skill',
      globalTarget,
      'codex',
      true,
    );

    fireEvent.click(projectDetailButton);
    expect(
      within(await screen.findByLabelText('Shared Skill 详情')).getByText('项目配置：项目 Alpha'),
    ).toBeTruthy();
  });

  it('项目 displayName 重名时用真实 rootPath 消歧，并保持行 target 不变', async () => {
    const duplicateProjects: readonly ProjectSummary[] = [
      { projectId: 'project-alpha', displayName: '同名项目', rootPath: '/workspaces/alpha' },
      { projectId: 'project-beta', displayName: '同名项目', rootPath: '/workspaces/beta' },
    ];
    const betaTarget: ScopeTarget = { scope: 'project', projectId: 'project-beta' };
    mockApi.getInstalledSkills.mockResolvedValue([
      installedSkill('shared-skill', 'Shared Skill', projectTarget),
      installedSkill('shared-skill', 'Shared Skill', betaTarget),
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext, () => undefined, duplicateProjects);

    expect(
      await screen.findByRole('heading', {
        name: /项目配置：同名项目（\/workspaces\/alpha）.*1/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: /项目配置：同名项目（\/workspaces\/beta）.*1/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: '项目配置：同名项目（/workspaces/alpha）' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: '项目配置：同名项目（/workspaces/beta）' }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Shared Skill，项目配置：同名项目（/workspaces/beta），Codex',
      }),
    );
    await waitFor(() =>
      expect(mockApi.toggleSkillApp).toHaveBeenCalledWith(
        'shared-skill',
        betaTarget,
        'codex',
        true,
      ),
    );
    expect(mockApi.toggleSkillApp).not.toHaveBeenCalledWith(
      'shared-skill',
      projectTarget,
      'codex',
      true,
    );
  });

  it('项目上下文区分此项目拥有与全局可用记录', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([
      installedSkill('project-skill', 'Project Skill', projectTarget),
      installedSkill('global-skill', 'Global Skill', globalTarget),
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, { kind: 'project', projectId: 'project-alpha' });

    expect(await screen.findByRole('heading', { name: /此项目拥有：项目 Alpha.*1/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /全局配置，可用于此项目.*1/ })).toBeTruthy();
  });

  it('发现技能入口交给现有发现子视图处理', async () => {
    const onOpenDiscovery = vi.fn();
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, globalContext, onOpenDiscovery);

    fireEvent.click(await screen.findByRole('button', { name: '发现技能' }));
    expect(onOpenDiscovery).toHaveBeenCalledTimes(1);
  });

  it('点击高密度行进入详情，Agent checkbox 仍调用即时 toggle mutation', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), target: projectTarget },
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    const rowButton = await screen.findByRole('button', { name: /^SkillA/ });
    fireEvent.click(rowButton);

    const detail = await screen.findByLabelText('SkillA 详情');
    expect(detail.getAttribute('data-skill-detail')).toBe('skill-a');
    const claudeCheckbox = within(detail).getByRole('checkbox', {
      name: 'SkillA，项目配置：项目 Alpha，Claude Code',
    });
    fireEvent.click(claudeCheckbox);

    await waitFor(() =>
      expect(mockApi.toggleSkillApp).toHaveBeenCalledWith(
        'skill-a',
        projectTarget,
        'claude-code',
        false,
      ),
    );
    expect(screen.getByText('SkillA（项目配置：项目 Alpha）已停用 Claude Code。')).toBeTruthy();
  });

  it('卸载先确认，取消不调用 mutation，确认后按 Skill ID 卸载', async () => {
    mockApi.uninstallSkill.mockResolvedValue({ backupPath: '/tmp/skill-a' });
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), target: projectTarget },
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    const uninstallButton = await screen.findByRole('button', {
      name: '卸载 SkillA，项目配置：项目 Alpha',
    });
    fireEvent.click(uninstallButton);

    const dialog = await screen.findByRole('dialog', { name: '确认卸载' });
    expect(within(dialog).getByText(/确定要卸载 SkillA/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockApi.uninstallSkill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '卸载 SkillA，项目配置：项目 Alpha' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '卸载' }),
    );

    await waitFor(() => expect(mockApi.uninstallSkill).toHaveBeenCalledTimes(1));
    expect(mockApi.uninstallSkill).toHaveBeenCalledWith('skill-a', projectTarget);
    expect(screen.getByText('已卸载 SkillA（项目配置：项目 Alpha）。')).toBeTruthy();
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

    fireEvent.click(await screen.findByRole('button', { name: /^SkillA/ }));
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

    fireEvent.click(await screen.findByRole('button', { name: /^SkillA/ }));
    await screen.findByLabelText('SkillA 详情');

    rerender(<Panel context={allContext} projects={projects} onOpenDiscovery={() => undefined} />);

    await waitFor(() => expect(screen.queryByLabelText('SkillA 详情')).toBeNull());
    expect(screen.getByRole('heading', { name: '已安装' })).toBeTruthy();
  });
});

describe('InstalledSkillsPanel 查询错误', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockOpenFileDialog.mockReset();
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
