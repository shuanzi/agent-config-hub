// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  ConfigContext,
  InstalledSkill,
  ProjectSummary,
  ScopeTarget,
  SkillImportPreview,
  SkillPlacementAsset,
  SkillPlacementTarget,
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
  getSkillPlacements: vi.fn(),
  getSkillPlacementTargets: vi.fn(),
  scanUnmanagedSkills: vi.fn(),
  checkSkillUpdates: vi.fn(),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  setSkillPlacement: vi.fn(),
  updateSkill: vi.fn(),
  importSkillsFromApps: vi.fn(),
  previewSkillImport: vi.fn(),
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

function setupPlacementMocks() {
  mockApi.getSkillPlacements.mockResolvedValue([]);
  mockApi.getSkillPlacementTargets.mockImplementation((target: ScopeTarget) =>
    Promise.resolve(placementTargets(target)),
  );
  mockApi.setSkillPlacement.mockResolvedValue(undefined);
  mockApi.previewSkillImport.mockImplementation(
    (selections: Array<{ directory: string; sourcePath: string }>) =>
      Promise.resolve({
        revision: 'preview-1',
        items: selections.map((selection) => ({
          directory: selection.directory,
          sourcePath: selection.sourcePath,
          storagePath: `/managed/${selection.directory}`,
          actions: [{ path: selection.sourcePath, action: '保留来源并创建受管投放' }],
        })),
      } satisfies SkillImportPreview),
  );
}

function placementAsset(
  id: string,
  target: ScopeTarget,
  location: 'claude-code' | 'codex' = 'codex',
  state: 'placed' | 'absent' | 'unmanaged' | 'conflict' = 'absent',
): SkillPlacementAsset {
  const placementTarget = placementTargets(target).find((item) => item.location === location)!;
  return {
    id,
    target,
    placements: [
      {
        ...placementTarget,
        state,
        withdrawable: state === 'placed',
        sourceIsTarget: false,
        revision: `${id}-${location}-r1`,
      },
    ],
  };
}

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
    setupPlacementMocks();
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

  it('同 directory 的来源默认都不接管，并提示一次只能选择一个来源', async () => {
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

    expect(firstCheckbox).toHaveProperty('checked', false);
    expect(secondCheckbox).toHaveProperty('checked', false);
    expect(within(dialog).getByRole('button', { name: /预览接管 \(0\)/ })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(dialog).getAllByText('同名 Skill 一次只能导入一个来源')).toHaveLength(2);
  });

  it('明确选择来源和目录后先预览，再携带 revision 接管', async () => {
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

    fireEvent.click(
      within(secondItem as HTMLElement).getByRole('checkbox', { name: /Codex.*\.codex\/skills/ }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: /预览接管 \(1\)/ }));
    expect(await within(dialog).findByText('/managed/shared')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认接管' }));

    await waitFor(() => expect(mockApi.importSkillsFromApps).toHaveBeenCalledTimes(1));
    expect(mockApi.importSkillsFromApps.mock.calls[0][0]).toEqual([
      {
        directory: 'shared',
        sourcePath: '/agents/codex/skills/shared',
        locations: ['codex'],
      },
    ]);
    expect(mockApi.importSkillsFromApps.mock.calls[0][1]).toEqual(globalTarget);
    expect(mockApi.importSkillsFromApps.mock.calls[0][2]).toEqual('preview-1');
  });

  it('接管失败在预览对话框内提示并保留确认动作以便重试', async () => {
    mockApi.importSkillsFromApps.mockRejectedValueOnce(new Error('boom'));
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: /导入已有/ }));
    const dialog = await screen.findByRole('dialog', { name: '导入已有 Skill' });
    const sourceItem = within(dialog).getByRole('checkbox', {
      name: '选择 SharedSkill，来源 /agents/claude/skills/shared',
    });
    fireEvent.click(sourceItem);
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: /Claude Code.*\.claude\/skills/ }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: /预览接管/ }));
    const confirmButton = await within(dialog).findByRole('button', { name: '确认接管' });
    fireEvent.click(confirmButton);

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      '操作失败，请稍后重试。',
    );
    expect(within(dialog).getByRole('button', { name: '确认接管' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('directory 大小写不同（Foo / foo）也视为同一组并互斥', async () => {
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

    expect(firstCheckbox).toHaveProperty('checked', false);
    expect(secondCheckbox).toHaveProperty('checked', false);
    expect(within(dialog).getAllByText('同名 Skill 一次只能导入一个来源')).toHaveLength(2);

    fireEvent.click(firstCheckbox);
    fireEvent.click(secondCheckbox);
    expect(firstCheckbox).toHaveProperty('checked', false);
    expect(secondCheckbox).toHaveProperty('checked', true);

    fireEvent.click(
      within(secondItem as HTMLElement).getByRole('checkbox', { name: /Codex.*\.codex\/skills/ }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: /预览接管 \(1\)/ }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认接管' }));

    await waitFor(() => expect(mockApi.importSkillsFromApps).toHaveBeenCalledTimes(1));
    expect(mockApi.importSkillsFromApps.mock.calls[0][0]).toEqual([
      {
        directory: 'foo',
        sourcePath: '/agents/codex/skills/foo',
        locations: ['codex'],
      },
    ]);
    expect(mockApi.importSkillsFromApps.mock.calls[0][1]).toEqual(globalTarget);
    expect(mockApi.importSkillsFromApps.mock.calls[0][2]).toEqual('preview-1');
  });
});

describe('InstalledSkillsPanel 全部更新部分失败', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    setupPlacementMocks();
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
    setupPlacementMocks();
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
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /选择 Local Skill/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /共享目录.*\.agents\/skills/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /预览接管/ }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认接管' }));

    await waitFor(() =>
      expect(mockApi.importSkillsFromApps).toHaveBeenCalledWith(
        expect.any(Array),
        globalTarget,
        'preview-1',
      ),
    );
  });

  it('全部上下文的行内接管始终使用该项目行的 target，并在提交期间阻止重复确认', async () => {
    const projectSkill = installedSkill('project-skill', 'Project Skill', projectTarget);
    mockApi.getInstalledSkills.mockResolvedValue([projectSkill]);
    mockApi.getSkillPlacements.mockResolvedValue([
      placementAsset('project-skill', projectTarget, 'codex', 'unmanaged'),
    ]);
    let resolveImport!: (skills: InstalledSkill[]) => void;
    mockApi.importSkillsFromApps.mockImplementation(
      () =>
        new Promise<InstalledSkill[]>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.change(await screen.findByLabelText('选择 Skill 操作目标'), {
      target: { value: 'global' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Project Skill.*查看详情并接管/ }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: /接管 Project Skill 在 .*project-alpha\/\.agents\/skills/,
      }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: '接管 Project Skill 的已有投放',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /预览接管 \(1\)/ }));

    await waitFor(() =>
      expect(mockApi.previewSkillImport).toHaveBeenCalledWith(
        [
          {
            directory: 'project-skill',
            sourcePath: '/workspaces/project-alpha/.agents/skills/project-skill',
            locations: ['codex'],
          },
        ],
        projectTarget,
      ),
    );
    const confirmButton = await within(dialog).findByRole('button', { name: '确认接管' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockApi.importSkillsFromApps).toHaveBeenCalledWith(
        expect.any(Array),
        projectTarget,
        'preview-1',
      );
      expect(confirmButton).toHaveProperty('disabled', true);
      expect(within(dialog).getByRole('button', { name: '返回修改' })).toHaveProperty(
        'disabled',
        true,
      );
    });
    fireEvent.click(confirmButton);
    expect(mockApi.importSkillsFromApps).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveImport([]);
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '接管 Project Skill 的已有投放' })).toBeNull(),
    );
  });

  it('ZIP picker 只接受单个 ZIP，项目目标只展示四个投放位置并提交 initialLocation', async () => {
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.change(screen.getByLabelText('选择 Skill 操作目标'), {
      target: { value: 'project:project-alpha' },
    });
    const zipButton = screen.getByRole('button', { name: '从 ZIP 安装' });
    await waitFor(() => expect(zipButton).toHaveProperty('disabled', false));
    fireEvent.click(zipButton);
    const dialog = await screen.findByRole('dialog', { name: '从 ZIP 安装 Skill' });
    const installButton = within(dialog).getByRole('button', { name: '安装' });
    expect(await within(dialog).findAllByRole('radio')).toHaveLength(4);
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
    fireEvent.click(within(dialog).getByRole('radio', { name: /Codex.*\.agents\/skills/ }));
    expect(installButton).toHaveProperty('disabled', false);
    mockApi.installSkillsFromZip.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(installButton);

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('操作失败，请稍后重试。');
    expect(within(dialog).getByText('/tmp/local-skill.zip')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: /Codex.*\.agents\/skills/ })).toHaveProperty(
      'checked',
      true,
    );
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
      await screen.findByRole('button', { name: '更多操作 Project Skill，项目配置：项目 Alpha' }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: '更新 Project Skill',
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
    setupPlacementMocks();
    mockOpenFileDialog.mockReset();
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), description: '用于检查提交规范' },
    ]);
    mockApi.getSkillPlacements.mockResolvedValue([placementAsset('skill-a', globalTarget)]);
    mockApi.getSkillBackups.mockResolvedValue([]);
    mockApi.setSkillPlacement.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('全部上下文按完整 target 分组，同名记录可独立操作', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([
      installedSkill('shared-skill', 'Shared Skill', globalTarget),
      installedSkill('shared-skill', 'Shared Skill', projectTarget),
    ]);
    mockApi.getSkillPlacements.mockResolvedValue([
      placementAsset('shared-skill', globalTarget),
      placementAsset('shared-skill', projectTarget),
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
      screen.getByRole('button', {
        name: /Shared Skill，Codex，\/workspaces\/project-alpha\/\.agents\/skills，投放/,
      }),
    );
    await waitFor(() =>
      expect(mockApi.setSkillPlacement).toHaveBeenCalledWith(
        'shared-skill',
        projectTarget,
        'codex',
        true,
        'shared-skill-codex-r1',
      ),
    );
    expect(mockApi.setSkillPlacement).not.toHaveBeenCalledWith(
      'shared-skill',
      globalTarget,
      'codex',
      true,
      expect.any(String),
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
    mockApi.getSkillPlacements.mockResolvedValue([
      placementAsset('shared-skill', projectTarget),
      placementAsset('shared-skill', betaTarget),
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
      screen.getByRole('button', {
        name: /Shared Skill，Codex，\/workspaces\/project-beta\/\.agents\/skills，投放/,
      }),
    );
    await waitFor(() =>
      expect(mockApi.setSkillPlacement).toHaveBeenCalledWith(
        'shared-skill',
        betaTarget,
        'codex',
        true,
        'shared-skill-codex-r1',
      ),
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
    expect(screen.getByRole('heading', { name: /已投放的全局资产.*1/ })).toBeTruthy();
  });

  it('发现技能入口交给现有发现子视图处理', async () => {
    const onOpenDiscovery = vi.fn();
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, globalContext, onOpenDiscovery);

    fireEvent.click(await screen.findByRole('button', { name: '发现技能' }));
    expect(onOpenDiscovery).toHaveBeenCalledTimes(1);
  });

  it('点击高密度行进入详情，目录开关携带 revision 调用投放 mutation', async () => {
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), target: projectTarget },
    ]);
    mockApi.getSkillPlacements.mockResolvedValue([
      placementAsset('skill-a', projectTarget, 'claude-code', 'placed'),
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    const rowButton = await screen.findByRole('button', { name: /^SkillA/ });
    fireEvent.click(rowButton);

    const detail = await screen.findByLabelText('SkillA 详情');
    expect(detail.getAttribute('data-skill-detail')).toBe('skill-a');
    const claudeCheckbox = within(detail).getByRole('checkbox', {
      name: /SkillA，Claude Code，.*\.claude\/skills，撤回投放/,
    });
    fireEvent.click(claudeCheckbox);

    await waitFor(() =>
      expect(mockApi.setSkillPlacement).toHaveBeenCalledWith(
        'skill-a',
        projectTarget,
        'claude-code',
        false,
        'skill-a-claude-code-r1',
      ),
    );
    expect(screen.getByText('SkillA 已从 Claude Code 撤回投放。')).toBeTruthy();
  });

  it('未接管、外部冲突和主副本重合均显示真实目录并限制撤回', async () => {
    const targets = placementTargets(globalTarget);
    const target = (location: SkillPlacementTarget['location']) =>
      targets.find((item) => item.location === location)!;
    mockApi.getSkillPlacements.mockResolvedValue([
      {
        id: 'skill-a',
        target: globalTarget,
        placements: [
          {
            ...target('shared'),
            state: 'unmanaged',
            withdrawable: false,
            sourceIsTarget: false,
            revision: 'shared-r1',
          },
          {
            ...target('codex'),
            state: 'conflict',
            reason: '目录内容已被外部修改。',
            withdrawable: false,
            sourceIsTarget: false,
            revision: 'codex-r1',
          },
          {
            ...target('claude-code'),
            state: 'placed',
            withdrawable: false,
            sourceIsTarget: true,
            revision: 'claude-r1',
          },
        ],
      } satisfies SkillPlacementAsset,
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: /^SkillA.*查看详情$/ }));
    expect(await screen.findByText('已存在·未接管')).toBeTruthy();
    expect(screen.getByText('投放冲突')).toBeTruthy();
    expect(screen.getByText('目录内容已被外部修改。')).toBeTruthy();
    expect(screen.getByText('该位置同时保存主副本，无法独立撤回。')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Claude Code.*撤回投放/ })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: /接管 SkillA 在 .*\.agents\/skills/ }));
    const dialog = await screen.findByRole('dialog', { name: '接管 SkillA 的已有投放' });
    expect(within(dialog).getByText('/home/user/.agents/skills/skill-a')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /预览接管 \(1\)/ }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '确认接管' }));
    await waitFor(() =>
      expect(mockApi.importSkillsFromApps).toHaveBeenCalledWith(
        [
          {
            directory: 'skill-a',
            sourcePath: '/home/user/.agents/skills/skill-a',
            locations: ['shared'],
          },
        ],
        globalTarget,
        'preview-1',
      ),
    );
  });

  it('卸载先确认，取消不调用 mutation，确认后按 Skill ID 卸载', async () => {
    mockApi.uninstallSkill.mockResolvedValue({ backupPath: '/tmp/skill-a' });
    mockApi.getInstalledSkills.mockResolvedValue([
      { ...installedSkill('skill-a', 'SkillA'), target: projectTarget },
    ]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient, allContext);

    fireEvent.click(
      await screen.findByRole('button', { name: '更多操作 SkillA，项目配置：项目 Alpha' }),
    );
    const uninstallButton = await screen.findByRole('button', {
      name: '卸载 SkillA，项目配置：项目 Alpha',
    });
    fireEvent.click(uninstallButton);

    const dialog = await screen.findByRole('dialog', { name: '确认卸载' });
    expect(within(dialog).getByText(/确定要卸载 SkillA/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockApi.uninstallSkill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '更多操作 SkillA，项目配置：项目 Alpha' }));
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

    fireEvent.change(screen.getByPlaceholderText('搜索名称、描述或来源'), {
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
    setupPlacementMocks();
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
