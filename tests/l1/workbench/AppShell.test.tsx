// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ConfigContext } from '../../../src/types';
import { App } from '../../../src/App';

vi.mock('../../../src/components/skills/InstalledSkillsPanel', () => ({
  InstalledSkillsPanel: ({ context }: { context: ConfigContext }) => (
    <div data-testid="installed-skills-panel">
      installed-skills:
      {context.kind === 'project' ? `project:${context.projectId}` : context.kind}
    </div>
  ),
}));

vi.mock('../../../src/components/skills/SkillsDiscoveryPage', () => ({
  SkillsDiscoveryPage: ({ context }: { context: ConfigContext }) => (
    <div data-testid="skills-discovery-panel">
      skills-discovery:
      {context.kind === 'project' ? `project:${context.projectId}` : context.kind}
    </div>
  ),
}));

vi.mock('../../../src/components/subagents/InstalledSubagentsPanel', () => ({
  InstalledSubagentsPanel: ({ context }: { context: ConfigContext }) => (
    <div data-testid="installed-subagents-panel">
      installed-subagents:
      {context.kind === 'project' ? `project:${context.projectId}` : context.kind}
    </div>
  ),
}));

vi.mock('../../../src/components/subagents/SubagentsDiscoveryPage', () => ({
  SubagentsDiscoveryPage: ({ context }: { context: ConfigContext }) => (
    <div data-testid="subagents-discovery-panel">
      subagents-discovery:
      {context.kind === 'project' ? `project:${context.projectId}` : context.kind}
    </div>
  ),
}));

vi.mock('../../../src/components/instructions/InstructionsPanel', () => ({
  InstructionsPanel: ({ context }: { context: ConfigContext }) => (
    <div data-testid="instructions-panel">
      instructions:{context.kind === 'project' ? `project:${context.projectId}` : context.kind}
    </div>
  ),
}));

vi.mock('../../../src/components/settings/SettingsView', () => ({
  SettingsView: () => <div data-testid="settings-panel">settings</div>,
}));

function installMatchMedia(matches: boolean) {
  let currentMatches = matches;
  const listeners = new Set<() => void>();
  const mediaQuery = {
    get matches() {
      return currentMatches;
    },
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) =>
      listeners.delete(listener),
    ),
    addListener: vi.fn((listener: () => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: () => void) => listeners.delete(listener)),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => mediaQuery),
  });

  return {
    setMatches(nextMatches: boolean) {
      currentMatches = nextMatches;
      listeners.forEach((listener) => listener());
    },
  };
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(<App />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

interface ProjectSummaryFixture {
  projectId: string;
  displayName: string;
  rootPath: string;
}

describe('App selected B2 shell', () => {
  beforeEach(() => {
    installMatchMedia(false);
    (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__ = (command: string) =>
      command === 'list_projects' ? [] : undefined;
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__;
  });

  it('uses real configuration contexts instead of an Agent rail on desktop', async () => {
    const projects: readonly ProjectSummaryFixture[] = [
      {
        projectId: 'project-alpha',
        displayName: '同名项目',
        rootPath: '/workspaces/alpha',
      },
      {
        projectId: 'project-beta',
        displayName: '同名项目',
        rootPath: '/workspaces/beta',
      },
    ];
    const mockInvoke = vi.fn((command: string) =>
      command === 'list_projects' ? projects : undefined,
    );
    (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__ = mockInvoke;

    renderApp();

    const contextRail = await screen.findByRole('navigation', { name: '配置上下文' });
    expect(mockInvoke).toHaveBeenCalledWith('list_projects', undefined);
    expect(screen.queryByRole('navigation', { name: '选择 Agent' })).toBeNull();
    expect(screen.queryByLabelText('当前 Agent')).toBeNull();

    const allContext = within(contextRail).getByRole('button', { name: '全部' });
    const globalContext = within(contextRail).getByRole('button', { name: '全局配置' });
    expect(allContext.getAttribute('aria-current')).toBe('page');
    expect(globalContext).toBeTruthy();
    expect(within(contextRail).getByText('项目配置')).toBeTruthy();

    await within(contextRail).findAllByText('同名项目');

    const alphaProject = contextRail.querySelector<HTMLButtonElement>(
      '[data-project-id="project-alpha"]',
    );
    const betaProject = contextRail.querySelector<HTMLButtonElement>(
      '[data-project-id="project-beta"]',
    );
    expect(alphaProject?.textContent).toContain('同名项目');
    expect(betaProject?.textContent).toContain('同名项目');

    if (alphaProject === null || betaProject === null) {
      throw new Error('项目上下文必须以稳定 projectId 标识渲染。');
    }

    fireEvent.click(betaProject);
    expect(betaProject.getAttribute('aria-current')).toBe('page');
    expect(alphaProject.getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('installed-skills-panel').textContent).toBe(
      'installed-skills:project:project-beta',
    );
  });

  it('keeps the current view behind the desktop rails without a global Agent context', () => {
    renderApp();

    expect(screen.getByTestId('installed-skills-panel').textContent).toBe('installed-skills:all');
    expect(screen.getByRole('navigation', { name: '资产类型导航' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '配置上下文' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skills' }).getAttribute('aria-current')).toBe(
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Subagents' }));
    expect(screen.getByTestId('installed-subagents-panel').textContent).toBe(
      'installed-subagents:all',
    );

    fireEvent.click(screen.getByRole('tab', { name: '发现' }));
    expect(screen.getByTestId('subagents-discovery-panel').textContent).toBe(
      'subagents-discovery:all',
    );

    fireEvent.click(screen.getByRole('button', { name: '长期指令' }));
    expect(screen.getByTestId('instructions-panel').textContent).toBe('instructions:all');
    expect(screen.queryByLabelText('当前 Agent')).toBeNull();
  });

  it('skips the configuration context rail for desktop settings and restores it for assets', async () => {
    renderApp();

    const assetTypeRail = screen.getByRole('navigation', { name: '资产类型导航' }).closest('aside');
    await screen.findByRole('navigation', { name: '配置上下文' });

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    const settingsSurface = screen.getByTestId('settings-panel').closest('main');
    expect(settingsSurface).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: '配置上下文' })).toBeNull();
    expect(settingsSurface?.previousElementSibling).toBe(assetTypeRail);

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(screen.getByRole('navigation', { name: '配置上下文' })).toBeTruthy();
  });

  it('uses named project actions with dialog feedback instead of a separate project page', async () => {
    const projects: ProjectSummaryFixture[] = [
      {
        projectId: 'project-alpha',
        displayName: '同名项目',
        rootPath: '/workspaces/alpha',
      },
    ];
    const mockInvoke = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'list_projects') return projects;
      if (command === 'add_project') {
        const project = {
          projectId: 'project-new',
          displayName: (args?.displayName as string | undefined) ?? 'new',
          rootPath: args?.rootPath as string,
        };
        projects.push(project);
        return project;
      }
      if (command === 'relink_project_root') {
        projects[0].rootPath = args?.rootPath as string;
        return undefined;
      }
      if (command === 'remove_project') {
        projects.splice(0, 1);
        return undefined;
      }
      return undefined;
    });
    (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__ = mockInvoke;

    renderApp();

    const contextRail = await screen.findByRole('navigation', { name: '配置上下文' });
    await within(contextRail).findByText('同名项目');
    expect(
      within(contextRail).getByRole('button', { name: '重新关联 同名项目（/workspaces/alpha）' }),
    ).toBeTruthy();
    expect(
      within(contextRail).getByRole('button', { name: '移除 同名项目（/workspaces/alpha）' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }));
    const addDialog = screen.getByRole('dialog', { name: '添加项目' });
    fireEvent.change(within(addDialog).getByLabelText('项目目录'), {
      target: { value: '/workspaces/new' },
    });
    fireEvent.change(within(addDialog).getByLabelText('显示名称（可选）'), {
      target: { value: '新项目' },
    });
    fireEvent.click(within(addDialog).getByRole('button', { name: '添加项目' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('add_project', {
        rootPath: '/workspaces/new',
        displayName: '新项目',
      }),
    );
    expect(screen.getByRole('status').textContent).toContain('已添加项目「新项目」');
  });

  it('uses the type-to-context-to-content stack below the B2 breakpoint and skips context for settings', () => {
    installMatchMedia(true);
    renderApp();

    expect(screen.getByRole('navigation', { name: '资产类型导航' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '配置上下文' })).toBeNull();
    expect(screen.queryByTestId('installed-skills-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '长期指令' }));
    expect(screen.getByRole('navigation', { name: '配置上下文' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '资产类型导航' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '全局配置' }));
    expect(screen.getByTestId('instructions-panel').textContent).toBe('instructions:global');
    expect(screen.getByRole('button', { name: '返回上一步' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    expect(screen.getByRole('navigation', { name: '配置上下文' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByTestId('settings-panel')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '配置上下文' })).toBeNull();
  });

  it('restores the originating narrow navigation trigger after returning', async () => {
    installMatchMedia(true);
    (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__ = (command: string) =>
      command === 'list_projects'
        ? [
            {
              projectId: 'project-alpha',
              displayName: '项目 Alpha',
              rootPath: '/workspaces/alpha',
            },
          ]
        : undefined;
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '全部' })),
    );
    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skills' })),
    );

    fireEvent.click(screen.getByRole('button', { name: '长期指令' }));
    fireEvent.click(screen.getByRole('button', { name: '全局配置' }));
    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '全局配置' })),
    );
    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '长期指令' })),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Subagents' }));
    await screen.findByText('项目 Alpha');
    const projectButton = document.querySelector<HTMLButtonElement>(
      '[data-project-id="project-alpha"]',
    );
    if (projectButton === null) {
      throw new Error('项目上下文按钮必须以稳定 projectId 标识。');
    }
    fireEvent.click(projectButton);
    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector('[data-project-id="project-alpha"]'),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Subagents' })),
    );

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '返回上一步' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '设置' })),
    );
  });

  it('uses the compact title as a reasonable focus target after a desktop-to-narrow transition', async () => {
    const media = installMatchMedia(false);
    renderApp();

    act(() => media.setMatches(true));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('资产类型')));
  });
});
