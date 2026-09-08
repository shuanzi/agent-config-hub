// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigContext, ProjectSummary, ScopeTarget } from '../../../src/types';
import type {
  NativeSubagentDefinition,
  NativeSubagentDiscovery,
  NativeSubagentScanResult,
} from '../../../src/lib/api/nativeSubagents';

const mockNativeApi = vi.hoisted(() => ({
  discoverNativeSubagents: vi.fn(),
  installNativeSubagent: vi.fn(),
  scanNativeSubagents: vi.fn(),
}));

const mockRepoApi = vi.hoisted(() => ({
  getSubagentRepos: vi.fn(),
  addSubagentRepo: vi.fn(),
  removeSubagentRepo: vi.fn(),
}));

vi.mock('../../../src/lib/api/nativeSubagents', () => mockNativeApi);
vi.mock('../../../src/lib/api/subagents', () => mockRepoApi);

const allContext: ConfigContext = { kind: 'all' };
const globalContext: ConfigContext = { kind: 'global' };
const projectContext: ConfigContext = { kind: 'project', projectId: 'project-alpha' };
const globalTarget: ScopeTarget = { scope: 'global' };
const projectTarget: ScopeTarget = { scope: 'project', projectId: 'project-alpha' };
const projects: readonly ProjectSummary[] = [
  { projectId: 'project-alpha', displayName: '项目 Alpha', rootPath: '/workspaces/alpha' },
];

function candidate(
  key: string,
  name: string,
  overrides: Partial<NativeSubagentDiscovery> = {},
): NativeSubagentDiscovery {
  return {
    key,
    name,
    description: `${name} description`,
    path: `agents/${name.toLowerCase().replaceAll(' ', '-')}.toml`,
    repoOwner: 'example',
    repoName: 'native-agents',
    repoBranch: 'main',
    format: 'toml',
    compatibleAgents: ['codex'],
    ...overrides,
  };
}

function installedDefinition(
  discovered: NativeSubagentDiscovery,
  target: ScopeTarget,
  agent: NativeSubagentDefinition['agent'],
): NativeSubagentDefinition {
  return {
    identity: `${agent}:${discovered.key}`,
    name: discovered.name,
    description: discovered.description,
    agent,
    target,
    format: discovered.format === 'toml' ? 'toml' : 'markdown',
    sourceKind: 'file',
    sourcePath: `/installed/${agent}/${discovered.path}`,
    managementStatus: 'managed',
    enabled: true,
    contentHash: 'installed-hash',
    isSymlink: false,
    diagnostics: [],
    repoOwner: discovered.repoOwner,
    repoName: discovered.repoName,
    repoBranch: discovered.repoBranch,
    repoPath: discovered.path,
  };
}

function emptyScan(): NativeSubagentScanResult {
  return { definitions: [], scanErrors: [] };
}

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

async function openCandidate(name: string) {
  const list = await screen.findByLabelText('可安装 Subagent 列表');
  fireEvent.click(within(list).getByRole('button', { name: new RegExp(name) }));
  return screen.findByLabelText(`${name} 详情`);
}

describe('SubagentsDiscoveryPage 原生安装契约', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    Object.values(mockNativeApi).forEach((fn) => fn.mockReset());
    Object.values(mockRepoApi).forEach((fn) => fn.mockReset());
    mockNativeApi.discoverNativeSubagents.mockResolvedValue([]);
    mockNativeApi.scanNativeSubagents.mockResolvedValue(emptyScan());
    mockRepoApi.getSubagentRepos.mockResolvedValue([]);
    mockRepoApi.addSubagentRepo.mockResolvedValue(undefined);
    mockRepoApi.removeSubagentRepo.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it('全部上下文未选目标时不请求发现，也无法触发安装', async () => {
    const Page = await loadPage();
    renderPage(Page, queryClient, allContext);

    expect(await screen.findByText('先选择发现目标')).toBeTruthy();
    expect(mockNativeApi.discoverNativeSubagents).not.toHaveBeenCalled();
    expect(mockNativeApi.installNativeSubagent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '刷新发现' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull();
  });

  it('项目级 Codex TOML 可以安装，但必须显式选择 Codex', async () => {
    const reviewer = candidate('example/native-agents:reviewer.toml', 'Codex Reviewer');
    mockNativeApi.discoverNativeSubagents.mockResolvedValue([reviewer]);
    mockNativeApi.installNativeSubagent.mockResolvedValue(
      installedDefinition(reviewer, projectTarget, 'codex'),
    );
    const Page = await loadPage();
    renderPage(Page, queryClient, projectContext);

    expect(await screen.findByText('Codex Reviewer')).toBeTruthy();
    expect(mockNativeApi.discoverNativeSubagents).toHaveBeenCalledWith(projectTarget);
    const detail = await openCandidate('Codex Reviewer');
    fireEvent.click(within(detail).getByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 Codex Reviewer' });
    const confirm = within(dialog).getByRole('button', { name: '确认安装' });
    expect(confirm).toHaveProperty('disabled', true);
    expect(within(dialog).getAllByRole('radio')).toHaveLength(4);
    const codex = within(dialog).getByRole('radio', { name: 'Codex' });
    expect(codex).toHaveProperty('disabled', false);
    expect(codex).toHaveProperty('checked', false);
    fireEvent.click(codex);
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mockNativeApi.installNativeSubagent).toHaveBeenCalledWith(
        reviewer,
        projectTarget,
        'codex',
      ),
    );
    expect(await screen.findByText(/已为 Codex 安装 Codex Reviewer/)).toBeTruthy();
  });

  it('Markdown 定义不兼容 Codex，只允许选择其声明的原生 Agent', async () => {
    const markdown = candidate('example/native-agents:reviewer.md', 'Markdown Reviewer', {
      path: 'agents/reviewer.md',
      format: 'markdown',
      compatibleAgents: ['claude-code', 'gemini-cli', 'opencode'],
    });
    mockNativeApi.discoverNativeSubagents.mockResolvedValue([markdown]);
    const Page = await loadPage();
    renderPage(Page, queryClient, projectContext);

    const detail = await openCandidate('Markdown Reviewer');
    expect(within(detail).getByText(/Markdown 不会直接复制成 Codex 配置/)).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 Markdown Reviewer' });
    expect(within(dialog).getByRole('radio', { name: /Codex/ })).toHaveProperty('disabled', true);
    expect(within(dialog).getByRole('radio', { name: 'Claude Code' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(within(dialog).getByRole('radio', { name: 'Gemini CLI' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(within(dialog).getByRole('radio', { name: 'OpenCode' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('安装载荷始终包含当前目标、完整候选项和用户选择的 Agent', async () => {
    const markdown = candidate('example/native-agents:writer.md', 'Project Writer', {
      path: 'agents/writer.md',
      format: 'markdown',
      compatibleAgents: ['opencode'],
    });
    mockNativeApi.discoverNativeSubagents.mockResolvedValue([markdown]);
    mockNativeApi.installNativeSubagent.mockResolvedValue(
      installedDefinition(markdown, projectTarget, 'opencode'),
    );
    const Page = await loadPage();
    renderPage(Page, queryClient, allContext);

    fireEvent.change(screen.getByLabelText('选择 Subagent 发现目标'), {
      target: { value: 'project:project-alpha' },
    });
    const detail = await openCandidate('Project Writer');
    fireEvent.click(within(detail).getByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 Project Writer' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'OpenCode' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认安装' }));

    await waitFor(() =>
      expect(mockNativeApi.installNativeSubagent).toHaveBeenCalledWith(
        markdown,
        projectTarget,
        'opencode',
      ),
    );
  });

  it('仓库发现失败时展示可读错误且不会安装', async () => {
    mockNativeApi.discoverNativeSubagents.mockRejectedValue(new Error('repository unavailable'));
    const Page = await loadPage();
    renderPage(Page, queryClient, globalContext);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('操作失败，请稍后重试。');
    expect(alert.textContent).not.toContain('repository unavailable');
    expect(screen.queryByText('没有可安装的原生定义')).toBeNull();
    expect(mockNativeApi.installNativeSubagent).not.toHaveBeenCalled();
  });

  it('仓库来源的 invalid 记录不会锁死兼容 Agent 的重新安装', async () => {
    const reviewer = candidate('example/native-agents:invalid.toml', 'Repairable Reviewer');
    const invalid = {
      ...installedDefinition(reviewer, globalTarget, 'codex'),
      managementStatus: 'invalid' as const,
      enabled: false,
      contentHash: undefined,
    };
    mockNativeApi.discoverNativeSubagents.mockResolvedValue([reviewer]);
    mockNativeApi.scanNativeSubagents.mockResolvedValue({
      definitions: [invalid],
      scanErrors: [],
    });
    mockNativeApi.installNativeSubagent.mockResolvedValue(
      installedDefinition(reviewer, globalTarget, 'codex'),
    );
    const Page = await loadPage();
    renderPage(Page, queryClient, globalContext);

    const detail = await openCandidate('Repairable Reviewer');
    expect(within(detail).queryByText(/此目标已管理/)).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: '安装' }));
    const dialog = await screen.findByRole('dialog', { name: '安装 Repairable Reviewer' });
    const codex = within(dialog).getByRole('radio', { name: 'Codex' });
    expect(codex).toHaveProperty('disabled', false);
    fireEvent.click(codex);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认安装' }));

    await waitFor(() =>
      expect(mockNativeApi.installNativeSubagent).toHaveBeenCalledWith(
        reviewer,
        globalTarget,
        'codex',
      ),
    );
  });

  it('上下文切换会清空选中项和安装弹窗，并使用新目标重新发现', async () => {
    const globalReviewer = candidate('example/native-agents:global.toml', 'Global Reviewer');
    const projectReviewer = candidate('example/native-agents:project.toml', 'Project Reviewer');
    mockNativeApi.discoverNativeSubagents.mockImplementation((target: ScopeTarget) =>
      Promise.resolve(target.scope === 'global' ? [globalReviewer] : [projectReviewer]),
    );
    const Page = await loadPage();
    const rendered = renderPage(Page, queryClient, globalContext);

    const detail = await openCandidate('Global Reviewer');
    fireEvent.click(within(detail).getByRole('button', { name: '安装' }));
    await screen.findByRole('dialog', { name: '安装 Global Reviewer' });
    rendered.rerender(<Page context={projectContext} projects={projects} />);

    expect(await screen.findByText('Project Reviewer')).toBeTruthy();
    expect(screen.queryByLabelText('Global Reviewer 详情')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '安装 Global Reviewer' })).toBeNull();
    expect(mockNativeApi.discoverNativeSubagents).toHaveBeenCalledWith(globalTarget);
    expect(mockNativeApi.discoverNativeSubagents).toHaveBeenCalledWith(projectTarget);
  });
});
