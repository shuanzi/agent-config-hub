// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigContext, ProjectSummary, ScopeTarget } from '../../../src/types';
import type {
  NativeSubagentBackup,
  NativeSubagentContent,
  NativeSubagentDefinition,
  NativeSubagentDiagnostic,
  NativeSubagentScanResult,
  NativeSubagentUpdatePreview,
} from '../../../src/lib/api/nativeSubagents';

const mockApi = vi.hoisted(() => ({
  scanNativeSubagents: vi.fn(),
  readNativeSubagent: vi.fn(),
  adoptNativeSubagent: vi.fn(),
  saveNativeSubagent: vi.fn(),
  setNativeSubagentEnabled: vi.fn(),
  uninstallNativeSubagent: vi.fn(),
  getNativeSubagentBackups: vi.fn(),
  backupNativeSubagent: vi.fn(),
  restoreNativeSubagentBackup: vi.fn(),
  deleteNativeSubagentBackup: vi.fn(),
  previewNativeSubagentUpdate: vi.fn(),
  applyNativeSubagentUpdate: vi.fn(),
}));

vi.mock('../../../src/lib/api/nativeSubagents', () => mockApi);

const globalContext: ConfigContext = { kind: 'global' };
const globalTarget: ScopeTarget = { scope: 'global' };
const projectContext: ConfigContext = { kind: 'project', projectId: 'project-alpha' };
const projectTarget: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
const projects: readonly ProjectSummary[] = [
  { projectId: 'project-alpha', displayName: '项目 Alpha', rootPath: '/workspaces/alpha' },
];

function definition(
  identity: string,
  name: string,
  overrides: Partial<NativeSubagentDefinition> = {},
): NativeSubagentDefinition {
  return {
    identity,
    name,
    description: `${name} description`,
    agent: 'codex',
    target: globalTarget,
    format: 'toml',
    sourceKind: 'file',
    sourcePath: `/Users/test/.codex/agents/${name}.toml`,
    managementStatus: 'managed',
    enabled: true,
    contentHash: `${identity}-hash`,
    isSymlink: false,
    diagnostics: [],
    ...overrides,
  };
}

function content(
  item: NativeSubagentDefinition,
  source = `name = "${item.name}"`,
  contentHash = item.contentHash ?? `${item.identity}-hash`,
): NativeSubagentContent {
  return { definition: item, content: source, contentHash };
}

function scanResult(
  definitions: NativeSubagentDefinition[],
  scanErrors: NativeSubagentDiagnostic[] = [],
): NativeSubagentScanResult {
  return { definitions, scanErrors };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

async function loadPanel() {
  const mod = await import('../../../src/components/subagents/InstalledSubagentsPanel');
  return mod.InstalledSubagentsPanel;
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

async function selectDefinition(name: string) {
  const list = await screen.findByLabelText('本地 Subagent 列表');
  fireEvent.click(within(list).getByRole('button', { name: new RegExp(name) }));
  return screen.findByLabelText(`${name} 详情`);
}

describe('InstalledSubagentsPanel 原生定义管理', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    Object.values(mockApi).forEach((fn) => fn.mockReset());
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([]));
    mockApi.getNativeSubagentBackups.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('展示本机 4 个 Codex 与 4 个 OpenCode 定义，并按 Agent 统计', async () => {
    const definitions = [
      ...Array.from({ length: 4 }, (_, index) =>
        definition(`codex-${index}`, `Codex Agent ${index + 1}`),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        definition(`opencode-${index}`, `OpenCode Agent ${index + 1}`, {
          agent: 'opencode',
          format: 'markdown',
          sourcePath: `/Users/test/.config/opencode/agents/opencode-${index + 1}.md`,
        }),
      ),
    ];
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult(definitions));
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    expect(await screen.findByText('本地定义 8 个')).toBeTruthy();
    const counts = screen.getByLabelText('四 Agent 定义数量');
    expect(within(counts).getByTitle('Claude Code').textContent).toContain('0');
    expect(within(counts).getByTitle('Codex').textContent).toContain('4');
    expect(within(counts).getByTitle('Gemini CLI').textContent).toContain('0');
    expect(within(counts).getByTitle('OpenCode').textContent).toContain('4');
    const list = screen.getByLabelText('本地 Subagent 列表');
    expect(within(list).getAllByRole('button')).toHaveLength(8);
    expect(within(list).getByText('/Users/test/.codex/agents/Codex Agent 1.toml')).toBeTruthy();
    expect(
      within(list).getByText('/Users/test/.config/opencode/agents/opencode-4.md'),
    ).toBeTruthy();
  });

  it('未接管定义的源码只读，且仅在显式确认后按原 Agent 纳入管理', async () => {
    const unmanaged = definition('codex-reviewer', 'Reviewer', {
      managementStatus: 'unmanaged',
    });
    const managed = { ...unmanaged, managementStatus: 'managed' as const };
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([unmanaged]));
    mockApi.readNativeSubagent
      .mockResolvedValueOnce(content(unmanaged))
      .mockResolvedValueOnce(content(managed));
    mockApi.adoptNativeSubagent.mockResolvedValue(managed);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    const detail = await selectDefinition('Reviewer');
    fireEvent.click(within(detail).getByRole('button', { name: '查看原生源码' }));
    const editor = (await within(detail).findByLabelText(
      'Subagent 原生源码',
    )) as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(true);
    expect(editor.value).toContain('name = "Reviewer"');
    expect(within(detail).queryAllByRole('checkbox')).toHaveLength(0);

    fireEvent.click(within(detail).getByRole('button', { name: '纳入管理' }));
    const dialog = await screen.findByRole('dialog', { name: '纳入管理' });
    expect(mockApi.adoptNativeSubagent).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认纳入管理' }));

    await waitFor(() =>
      expect(mockApi.adoptNativeSubagent).toHaveBeenCalledWith(
        'codex-reviewer',
        'codex-reviewer-hash',
        false,
      ),
    );
    expect(mockApi.readNativeSubagent).toHaveBeenLastCalledWith('codex-reviewer');
    expect(await screen.findByText('已备份并纳入管理，保留原生配置。')).toBeTruthy();
  });

  it('启停只作用于定义所属 Agent，不再显示四 Agent 投影开关', async () => {
    const enabled = definition('opencode-reviewer', 'OpenCode Reviewer', {
      agent: 'opencode',
      format: 'markdown',
      sourcePath: '/Users/test/.config/opencode/agents/reviewer.md',
    });
    const disabled = {
      ...enabled,
      enabled: false,
      managementStatus: 'disabled' as const,
      contentHash: 'disabled-hash',
    };
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([enabled]));
    mockApi.setNativeSubagentEnabled.mockResolvedValue(disabled);
    mockApi.readNativeSubagent.mockResolvedValue(content(disabled));
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    const detail = await selectDefinition('OpenCode Reviewer');
    expect(within(detail).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(detail).queryByText('Claude Code')).toBeNull();
    expect(within(detail).queryByText('Gemini CLI')).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: '停用' }));

    await waitFor(() =>
      expect(mockApi.setNativeSubagentEnabled).toHaveBeenCalledWith(
        'opencode-reviewer',
        false,
        'opencode-reviewer-hash',
      ),
    );
    expect(await within(detail).findByText('已停用 · 未启用')).toBeTruthy();
  });

  it('保存携带读取时摘要，外部冲突时保留未保存草稿', async () => {
    const managed = definition('codex-writer', 'Writer', { contentHash: 'hash-before-edit' });
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([managed]));
    mockApi.readNativeSubagent.mockResolvedValue(
      content(managed, 'name = "Writer"', 'hash-before-edit'),
    );
    mockApi.saveNativeSubagent.mockRejectedValue(
      new Error(
        JSON.stringify({
          code: 'NATIVE_SUBAGENT_CHANGED',
          context: { message: '文件已在外部修改，请重新加载后再保存。' },
        }),
      ),
    );
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    const detail = await selectDefinition('Writer');
    fireEvent.click(within(detail).getByRole('button', { name: '查看原生源码' }));
    const editor = (await within(detail).findByLabelText(
      'Subagent 原生源码',
    )) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'name = "Writer v2"' } });
    fireEvent.click(within(detail).getByRole('button', { name: '保存原生源码' }));

    await waitFor(() =>
      expect(mockApi.saveNativeSubagent).toHaveBeenCalledWith(
        'codex-writer',
        'name = "Writer v2"',
        'hash-before-edit',
      ),
    );
    expect((await within(detail).findByRole('alert')).textContent).toContain('文件已在外部修改');
    expect(editor.value).toBe('name = "Writer v2"');
    expect(within(detail).getByText(/未保存修改已暂存本次会话/)).toBeTruthy();
  });

  it('扫描失败或部分失败时不误报机器上没有定义', async () => {
    mockApi.scanNativeSubagents.mockRejectedValueOnce(new Error('permission denied'));
    const Panel = await loadPanel();
    const first = renderPanel(Panel, queryClient);

    expect((await screen.findByRole('alert')).textContent).toContain('扫描失败');
    expect(screen.queryByText('没有找到本地 Subagent 定义')).toBeNull();
    first.unmount();
    queryClient.clear();

    mockApi.scanNativeSubagents.mockResolvedValueOnce(
      scanResult(
        [],
        [
          {
            severity: 'error',
            code: 'DIRECTORY_UNREADABLE',
            message: 'OpenCode 配置目录无法读取。',
          },
        ],
      ),
    );
    renderPanel(Panel, queryClient);
    expect(await screen.findByText('扫描未完整完成')).toBeTruthy();
    expect(screen.getByText('OpenCode 配置目录无法读取。')).toBeTruthy();
    expect(screen.queryByText('没有找到本地 Subagent 定义')).toBeNull();
  });

  it('切换配置上下文时清空详情和草稿，并只展示新上下文扫描结果', async () => {
    const globalDefinition = definition('global-agent', 'Global Agent');
    const projectDefinition = definition('project-agent', 'Project Agent', {
      target: projectTarget,
      sourcePath: '/workspaces/alpha/.codex/agents/project-agent.toml',
    });
    mockApi.scanNativeSubagents.mockImplementation((context: ConfigContext) =>
      Promise.resolve(
        scanResult(context.kind === 'project' ? [projectDefinition] : [globalDefinition]),
      ),
    );
    mockApi.readNativeSubagent.mockResolvedValue(content(globalDefinition));
    const Panel = await loadPanel();
    const rendered = renderPanel(Panel, queryClient);

    const detail = await selectDefinition('Global Agent');
    fireEvent.click(within(detail).getByRole('button', { name: '查看原生源码' }));
    const editor = await within(detail).findByLabelText('Subagent 原生源码');
    fireEvent.change(editor, { target: { value: 'global unsaved draft' } });
    rendered.rerender(<Panel context={projectContext} projects={projects} />);

    expect(await screen.findByText('Project Agent')).toBeTruthy();
    expect(screen.queryByLabelText('Global Agent 详情')).toBeNull();
    expect(screen.queryByDisplayValue('global unsaved draft')).toBeNull();
    expect(mockApi.scanNativeSubagents).toHaveBeenCalledWith(projectContext);
  });

  it('切换到其他定义再返回时恢复未保存草稿', async () => {
    const draftAgent = definition('draft-agent', 'Draft Agent', {
      contentHash: 'draft-original-hash',
    });
    const otherAgent = definition('other-agent', 'Other Agent');
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([draftAgent, otherAgent]));
    mockApi.readNativeSubagent.mockImplementation((identity: string) => {
      const item = identity === draftAgent.identity ? draftAgent : otherAgent;
      return Promise.resolve(content(item));
    });
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    let detail = await selectDefinition('Draft Agent');
    fireEvent.click(within(detail).getByRole('button', { name: '查看原生源码' }));
    const editor = await within(detail).findByLabelText('Subagent 原生源码');
    fireEvent.change(editor, { target: { value: 'name = "Draft Agent v2"' } });

    await selectDefinition('Other Agent');
    detail = await selectDefinition('Draft Agent');
    expect(within(detail).getByDisplayValue('name = "Draft Agent v2"')).toBeTruthy();
    expect(within(detail).getByText(/未保存修改已暂存本次会话/)).toBeTruthy();
    expect(mockApi.readNativeSubagent).toHaveBeenCalledTimes(1);
  });

  it('保存期间切换定义，成功返回后不恢复旧草稿或旧摘要', async () => {
    const savingAgent = definition('saving-agent', 'Saving Agent', {
      contentHash: 'hash-before-background-save',
    });
    const otherAgent = definition('saving-other', 'Saving Other');
    const original = content(savingAgent, 'name = "Saving Agent"', 'hash-before-background-save');
    const saved = content(
      { ...savingAgent, contentHash: 'hash-after-background-save' },
      'name = "Saving Agent v2"',
      'hash-after-background-save',
    );
    let resolveBackgroundSave: (result: NativeSubagentContent) => void = () => undefined;
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([savingAgent, otherAgent]));
    mockApi.readNativeSubagent.mockResolvedValueOnce(original).mockResolvedValueOnce(saved);
    mockApi.saveNativeSubagent
      .mockImplementationOnce(
        () =>
          new Promise<NativeSubagentContent>((resolve) => {
            resolveBackgroundSave = resolve;
          }),
      )
      .mockResolvedValueOnce(
        content(
          { ...savingAgent, contentHash: 'hash-after-second-save' },
          'name = "Saving Agent v3"',
          'hash-after-second-save',
        ),
      );
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    let detail = await selectDefinition('Saving Agent');
    fireEvent.click(within(detail).getByRole('button', { name: '查看原生源码' }));
    fireEvent.change(await within(detail).findByLabelText('Subagent 原生源码'), {
      target: { value: 'name = "Saving Agent v2"' },
    });
    fireEvent.click(within(detail).getByRole('button', { name: '保存原生源码' }));
    await waitFor(() => expect(mockApi.saveNativeSubagent).toHaveBeenCalledTimes(1));

    await selectDefinition('Saving Other');
    await act(async () => resolveBackgroundSave(saved));
    detail = await selectDefinition('Saving Agent');
    expect(within(detail).queryByDisplayValue('name = "Saving Agent v2"')).toBeNull();
    expect(within(detail).queryByText(/未保存修改已暂存本次会话/)).toBeNull();

    let editor = within(detail).queryByLabelText('Subagent 原生源码') as HTMLTextAreaElement | null;
    if (editor === null) {
      fireEvent.click(within(detail).getByRole('button', { name: '查看原生源码' }));
      editor = (await within(detail).findByLabelText('Subagent 原生源码')) as HTMLTextAreaElement;
    }
    expect(editor.value).toBe('name = "Saving Agent v2"');
    fireEvent.change(editor, { target: { value: 'name = "Saving Agent v3"' } });
    fireEvent.click(within(detail).getByRole('button', { name: '保存原生源码' }));

    await waitFor(() => expect(mockApi.saveNativeSubagent).toHaveBeenCalledTimes(2));
    expect(mockApi.saveNativeSubagent).toHaveBeenLastCalledWith(
      'saving-agent',
      'name = "Saving Agent v3"',
      'hash-after-background-save',
    );
  });

  it('跨上下文返回后恢复原草稿，并用最初读取的摘要保存', async () => {
    const globalDefinition = definition('global-draft-agent', 'Global Draft Agent', {
      contentHash: 'global-original-hash',
    });
    const projectDefinition = definition('project-draft-agent', 'Project Draft Agent', {
      target: projectTarget,
      sourcePath: '/workspaces/alpha/.codex/agents/project-draft-agent.toml',
    });
    mockApi.scanNativeSubagents.mockImplementation((context: ConfigContext) =>
      Promise.resolve(
        scanResult(context.kind === 'project' ? [projectDefinition] : [globalDefinition]),
      ),
    );
    mockApi.readNativeSubagent.mockResolvedValue(
      content(globalDefinition, 'name = "Global Draft Agent"', 'global-original-hash'),
    );
    mockApi.saveNativeSubagent.mockResolvedValue(
      content(globalDefinition, 'name = "Global Draft Agent v2"', 'global-saved-hash'),
    );
    const Panel = await loadPanel();
    const rendered = renderPanel(Panel, queryClient, globalContext);

    let detail = await selectDefinition('Global Draft Agent');
    fireEvent.click(within(detail).getByRole('button', { name: '查看原生源码' }));
    fireEvent.change(await within(detail).findByLabelText('Subagent 原生源码'), {
      target: { value: 'name = "Global Draft Agent v2"' },
    });
    rendered.rerender(<Panel context={projectContext} projects={projects} />);
    expect(await screen.findByText('Project Draft Agent')).toBeTruthy();

    rendered.rerender(<Panel context={globalContext} projects={projects} />);
    detail = await selectDefinition('Global Draft Agent');
    expect(within(detail).getByDisplayValue('name = "Global Draft Agent v2"')).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: '保存原生源码' }));

    await waitFor(() =>
      expect(mockApi.saveNativeSubagent).toHaveBeenCalledWith(
        'global-draft-agent',
        'name = "Global Draft Agent v2"',
        'global-original-hash',
      ),
    );
    expect(await screen.findByText('已备份并保存原生定义。')).toBeTruthy();
  });

  it('放弃编辑会清除会话草稿，再次选择时不恢复已放弃内容', async () => {
    const draftAgent = definition('discard-agent', 'Discard Agent');
    const otherAgent = definition('discard-other', 'Discard Other');
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([draftAgent, otherAgent]));
    mockApi.readNativeSubagent.mockResolvedValue(content(draftAgent));
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    let detail = await selectDefinition('Discard Agent');
    fireEvent.click(within(detail).getByRole('button', { name: '查看原生源码' }));
    const editor = await within(detail).findByLabelText('Subagent 原生源码');
    fireEvent.change(editor, { target: { value: 'discarded draft' } });
    fireEvent.click(within(detail).getByRole('button', { name: '放弃编辑' }));
    expect(within(detail).queryByDisplayValue('discarded draft')).toBeNull();

    await selectDefinition('Discard Other');
    detail = await selectDefinition('Discard Agent');
    expect(within(detail).queryByDisplayValue('discarded draft')).toBeNull();
    expect(within(detail).queryByLabelText('Subagent 原生源码')).toBeNull();
    expect(within(detail).getByRole('button', { name: '查看原生源码' })).toBeTruthy();
  });

  it('文件异常定义提供从备份修复入口', async () => {
    const invalid = definition('invalid-agent', 'Invalid Agent', {
      managementStatus: 'invalid',
      enabled: false,
      contentHash: undefined,
      diagnostics: [{ severity: 'error', code: 'SOURCE_MISSING', message: '原生定义文件已缺失。' }],
    });
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([invalid]));
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    const detail = await selectDefinition('Invalid Agent');
    expect(within(detail).getByText('原生定义文件已缺失。')).toBeTruthy();
    expect(within(detail).getByText(/文件异常或已缺失/)).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: '从备份修复' }));

    expect(await screen.findByRole('dialog', { name: 'Subagent 备份恢复' })).toBeTruthy();
    expect(mockApi.getNativeSubagentBackups).toHaveBeenCalledWith(globalContext);
  });

  it('符号链接定义必须核对目标并确认以独立副本接管', async () => {
    const linked = definition('linked-reviewer', 'Linked Reviewer', {
      managementStatus: 'unmanaged',
      isSymlink: true,
      symlinkTarget: '/shared/agents/reviewer.toml',
    });
    const managed = {
      ...linked,
      managementStatus: 'managed' as const,
      isSymlink: false,
      symlinkTarget: undefined,
    };
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([linked]));
    mockApi.adoptNativeSubagent.mockResolvedValue(managed);
    mockApi.readNativeSubagent.mockResolvedValue(content(managed));
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    const detail = await selectDefinition('Linked Reviewer');
    fireEvent.click(within(detail).getByRole('button', { name: '纳入管理' }));
    const dialog = await screen.findByRole('dialog', { name: '纳入管理' });
    const confirm = within(dialog).getByRole('button', { name: '确认纳入管理' });
    expect(confirm).toHaveProperty('disabled', true);
    expect(within(dialog).getByText(/\/shared\/agents\/reviewer.toml/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mockApi.adoptNativeSubagent).toHaveBeenCalledWith(
        'linked-reviewer',
        'linked-reviewer-hash',
        true,
      ),
    );
  });

  it('恢复备份时携带当前目标文件摘要', async () => {
    const managed = definition('codex-reviewer', 'Reviewer', {
      contentHash: 'current-destination-hash',
    });
    const backup: NativeSubagentBackup = {
      backupId: 'backup-reviewer',
      identity: managed.identity,
      name: managed.name,
      agent: managed.agent,
      target: managed.target,
      sourcePath: managed.sourcePath,
      createdAt: 1_788_848_000,
      reason: 'before-save',
    };
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([managed]));
    mockApi.getNativeSubagentBackups.mockResolvedValue([backup]);
    mockApi.restoreNativeSubagentBackup.mockResolvedValue(managed);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: '备份恢复' }));
    const dialog = await screen.findByRole('dialog', { name: 'Subagent 备份恢复' });
    fireEvent.click(await within(dialog).findByRole('radio', { name: /Reviewer · Codex/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认恢复所选备份' }));

    await waitFor(() =>
      expect(mockApi.restoreNativeSubagentBackup).toHaveBeenCalledWith(
        'backup-reviewer',
        'current-destination-hash',
      ),
    );
    expect(await screen.findByText('已恢复原生定义备份。')).toBeTruthy();
  });

  it('删除备份必须二次确认，成功后只刷新备份且保留原生定义', async () => {
    const managed = definition('delete-backup-reviewer', 'Delete Backup Reviewer');
    const backup: NativeSubagentBackup = {
      backupId: 'backup-to-delete',
      identity: managed.identity,
      name: managed.name,
      agent: managed.agent,
      target: managed.target,
      sourcePath: managed.sourcePath,
      createdAt: 1_788_848_000,
      reason: 'before-save',
      contentHash: 'backup-content-hash',
    };
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([managed]));
    mockApi.getNativeSubagentBackups.mockResolvedValueOnce([backup]).mockResolvedValueOnce([]);
    mockApi.deleteNativeSubagentBackup.mockResolvedValue(undefined);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: '备份恢复' }));
    const dialog = await screen.findByRole('dialog', { name: 'Subagent 备份恢复' });
    fireEvent.click(
      await within(dialog).findByRole('radio', { name: /Delete Backup Reviewer · Codex/ }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '删除所选备份' }));
    expect(mockApi.deleteNativeSubagentBackup).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert').textContent).toContain('此操作不可撤销');

    fireEvent.click(within(dialog).getByRole('button', { name: '保留备份' }));
    expect(within(dialog).queryByRole('button', { name: '确认永久删除此备份' })).toBeNull();
    expect(mockApi.deleteNativeSubagentBackup).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '删除所选备份' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认永久删除此备份' }));

    await waitFor(() =>
      expect(mockApi.deleteNativeSubagentBackup).toHaveBeenCalledWith(
        'backup-to-delete',
        'backup-content-hash',
      ),
    );
    await waitFor(() => expect(mockApi.getNativeSubagentBackups).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/原生定义文件未修改/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(
      within(screen.getByLabelText('本地 Subagent 列表')).getByText('Delete Backup Reviewer'),
    ).toBeTruthy();
    expect(mockApi.uninstallNativeSubagent).not.toHaveBeenCalled();
  });

  it('旧版或缺少内容摘要的备份不可永久删除', async () => {
    const managed = definition('locked-backup-reviewer', 'Locked Backup Reviewer');
    const legacy: NativeSubagentBackup = {
      backupId: 'legacy-backup',
      identity: managed.identity,
      name: 'Legacy Backup',
      agent: managed.agent,
      target: managed.target,
      sourcePath: managed.sourcePath,
      createdAt: 1_788_848_000,
      reason: 'legacy-import',
      contentHash: 'legacy-hash',
      legacy: true,
    };
    const missingHash: NativeSubagentBackup = {
      ...legacy,
      backupId: 'missing-hash-backup',
      name: 'Missing Hash Backup',
      contentHash: undefined,
      legacy: false,
    };
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([managed]));
    mockApi.getNativeSubagentBackups.mockResolvedValue([legacy, missingHash]);
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    fireEvent.click(await screen.findByRole('button', { name: '备份恢复' }));
    const dialog = await screen.findByRole('dialog', { name: 'Subagent 备份恢复' });
    expect(
      await within(dialog).findByRole('radio', { name: /Legacy Backup · Codex/ }),
    ).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Missing Hash Backup · Codex/ }));
    expect(within(dialog).getByRole('button', { name: '删除所选备份' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(mockApi.deleteNativeSubagentBackup).not.toHaveBeenCalled();
  });

  it('远端更新预览携带双摘要，本地有修改时必须再次确认', async () => {
    const managed = definition('repo-reviewer', 'Repo Reviewer', {
      contentHash: 'local-hash',
      repoOwner: 'example',
      repoName: 'agents',
      repoBranch: 'main',
      repoPath: 'reviewer.toml',
    });
    const preview: NativeSubagentUpdatePreview = {
      identity: managed.identity,
      currentContent: 'name = "Local Reviewer"',
      nextContent: 'name = "Remote Reviewer"',
      currentHash: 'local-hash',
      remoteHash: 'remote-hash',
      locallyModified: true,
    };
    mockApi.scanNativeSubagents.mockResolvedValue(scanResult([managed]));
    mockApi.previewNativeSubagentUpdate.mockResolvedValue(preview);
    mockApi.applyNativeSubagentUpdate.mockResolvedValue({
      ...managed,
      contentHash: 'remote-hash',
    });
    const Panel = await loadPanel();
    renderPanel(Panel, queryClient);

    const detail = await selectDefinition('Repo Reviewer');
    fireEvent.click(within(detail).getByRole('button', { name: '检查更新' }));
    const dialog = await screen.findByRole('dialog', { name: '审阅 Subagent 更新' });
    expect(within(dialog).getByText('name = "Local Reviewer"')).toBeTruthy();
    expect(within(dialog).getByText('name = "Remote Reviewer"')).toBeTruthy();
    const apply = within(dialog).getByRole('button', { name: '备份并应用更新' });
    expect(apply).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(apply).toHaveProperty('disabled', false);
    fireEvent.click(apply);

    await waitFor(() =>
      expect(mockApi.applyNativeSubagentUpdate).toHaveBeenCalledWith(
        'repo-reviewer',
        'local-hash',
        'remote-hash',
      ),
    );
    expect(await screen.findByText('已备份并应用审阅过的更新。')).toBeTruthy();
  });
});
