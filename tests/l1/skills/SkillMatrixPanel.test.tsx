// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SkillMatrixPanel } from '../../../src/components/skills/SkillMatrixPanel';
import type { ConfigContext, SkillAssignment, SkillMatrixRow } from '../../../src/types';
const api = vi.hoisted(() => ({
  getSkillMatrix: vi.fn(),
  previewSkillAssignments: vi.fn(),
  applySkillAssignments: vi.fn(),
  getCodexProjectLaunch: vi.fn(),
  launchCodexProject: vi.fn(),
}));
vi.mock('../../../src/lib/api/skills', () => api);
const projects = [
  { projectId: 'one', displayName: '项目一', rootPath: '/one' },
  { projectId: 'two', displayName: '项目二', rootPath: '/two' },
];
function row(projectId = 'one'): SkillMatrixRow {
  return {
    skill: {
      id: 'review',
      name: 'code-review',
      directory: 'review',
      target: { scope: 'global' },
      apps: { claudeCode: true, codex: true, geminiCli: false, opencode: false },
      installedAt: 1,
      updatedAt: 1,
    },
    target: { scope: 'project', projectId },
    cells: ['claude-code', 'codex', 'gemini-cli', 'opencode'].map((agent) => ({
      activationMode: agent === 'codex' ? 'projectLauncher' : 'native',
      agent: agent as SkillMatrixRow['cells'][0]['agent'],
      checked: agent !== 'gemini-cli',
      origin: agent !== 'gemini-cli' ? 'inherited' : 'absent',
      revision: `revision-${agent}`,
      reason: agent === 'opencode' ? '角色设置了精细权限' : undefined,
      notice: agent === 'codex' ? '仅通过项目启动入口生效' : undefined,
    })),
  };
}
function setup(context: ConfigContext = { kind: 'project', projectId: 'one' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const renderPanel = (context: ConfigContext) => (
    <QueryClientProvider client={client}>
      <SkillMatrixPanel
        context={context}
        projects={projects}
        searchQuery=""
        onDetail={() => undefined}
      />
    </QueryClientProvider>
  );
  return { ...render(renderPanel(context)), renderPanel };
}
function openBulk(agents = ['Claude Code']) {
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 code-review，全局' }));
  fireEvent.click(screen.getByRole('button', { name: '批量分配（1）' }));
  const dialog = within(screen.getByRole('dialog'));
  for (const agent of ['Claude Code', 'Codex', 'Gemini CLI', 'OpenCode']) {
    if (!agents.includes(agent)) fireEvent.click(dialog.getByLabelText(agent));
  }
  return dialog;
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getCodexProjectLaunch.mockResolvedValue({
    projectId: 'one',
    projectRoot: '/one',
    codexHome: '/home/.codex',
    executablePath: '/usr/bin/codex',
    args: ['-C', '/one'],
    excludedSkills: [{ id: 'review', name: 'code-review' }],
    revision: 'launch-r',
  });
  api.launchCodexProject.mockResolvedValue({ handedOff: true });
  api.getSkillMatrix.mockImplementation((context: ConfigContext) =>
    Promise.resolve([row(context.kind === 'project' ? context.projectId : 'one')]),
  );
  api.previewSkillAssignments.mockImplementation((requests: SkillAssignment[]) =>
    Promise.resolve(requests.map((request) => ({ request, checked: true }))),
  );
  api.applySkillAssignments.mockImplementation((requests: SkillAssignment[]) =>
    Promise.resolve(requests.map((request) => ({ request, applied: true }))),
  );
});
afterEach(cleanup);
describe('Skills 使用矩阵', () => {
  it('Codex 项目可直接停用，启动明确使用保存规则并传回 revision', async () => {
    setup();
    const checkbox = await screen.findByRole('checkbox', { name: 'code-review，项目一，Codex' });
    expect((checkbox as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '启动 Codex' }));
    expect(await screen.findByText('项目路径：/one')).toBeTruthy();
    expect(screen.getByText(/仅通过此入口启动/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '在终端启动' }));
    await waitFor(() => expect(api.launchCodexProject).toHaveBeenCalledWith('one', 'launch-r'));
    expect(await screen.findByText('已将本项目 Codex 启动交给终端。')).toBeTruthy();
  });
  it('本项目草稿阻止启动，另一个项目草稿不阻止', async () => {
    const view = setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'code-review，项目一，Codex' }));
    fireEvent.click(screen.getByRole('button', { name: '启动 Codex' }));
    await screen.findByText('项目路径：/one');
    expect((screen.getByRole('button', { name: '在终端启动' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    view.rerender(view.renderPanel({ kind: 'project', projectId: 'two' }));
    await screen.findByRole('checkbox', { name: 'code-review，项目二，Codex' });
    fireEvent.click(screen.getByRole('button', { name: '启动 Codex' }));
    await screen.findByText('项目路径：/one');
    expect((screen.getByRole('button', { name: '在终端启动' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(api.launchCodexProject).not.toHaveBeenCalled();
  });
  it('缺失 CLI 或启动计划变化保留错误与重新读取入口', async () => {
    api.getCodexProjectLaunch.mockResolvedValueOnce({
      projectRoot: '/one',
      excludedSkills: [],
      revision: 'r',
      reason: '未找到 Codex CLI',
    });
    setup();
    await screen.findByRole('checkbox', { name: 'code-review，项目一，Codex' });
    fireEvent.click(screen.getByRole('button', { name: '启动 Codex' }));
    expect(await screen.findByText('未找到 Codex CLI')).toBeTruthy();
    expect((screen.getByRole('button', { name: '在终端启动' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByText('已保存的排除项（1）');
    api.launchCodexProject.mockRejectedValueOnce(
      new Error(
        JSON.stringify({
          code: 'SKILL_PLACEMENT_CONFLICT',
          context: { message: '启动计划已变化' },
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '在终端启动' }));
    expect(await screen.findByText(/启动计划已变化/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('来自全局直接取消勾选，应用前只保存草稿，完整目标保持项目', async () => {
    setup();
    const checkbox = await screen.findByRole('checkbox', {
      name: 'code-review，项目一，Claude Code',
    });
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(api.applySkillAssignments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    fireEvent.click(await screen.findByRole('button', { name: '应用可执行项（1）' }));
    await waitFor(() => expect(api.applySkillAssignments).toHaveBeenCalledTimes(1));
    expect(api.applySkillAssignments.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        target: { scope: 'project', projectId: 'one' },
        sourceTarget: { scope: 'global' },
        agent: 'claude-code',
        enabled: false,
        expectedRevision: 'revision-claude-code',
      }),
    ]);
  });
  it('切换项目保留原项目草稿，另一个项目的勾选状态不变', async () => {
    const view = setup();
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'code-review，项目一，Claude Code' }),
    );
    view.rerender(view.renderPanel({ kind: 'project', projectId: 'two' }));
    expect(
      (
        (await screen.findByRole('checkbox', {
          name: 'code-review，项目二，Claude Code',
        })) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(screen.getByText(/1 项待应用/)).toBeTruthy();
    view.rerender(view.renderPanel({ kind: 'project', projectId: 'one' }));
    expect(
      (
        (await screen.findByRole('checkbox', {
          name: 'code-review，项目一，Claude Code',
        })) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });
  it('角色精细权限保持勾选且不可改，原因可由键盘按钮获取', async () => {
    setup();
    const checkbox = await screen.findByRole('checkbox', { name: 'code-review，项目一，OpenCode' });
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'code-review，OpenCode，查看限制原因' }));
    expect(screen.getByText('角色设置了精细权限')).toBeTruthy();
    expect(api.applySkillAssignments).not.toHaveBeenCalled();
  });
  it('重新预览不能静默采用变更后的 revision', async () => {
    setup();
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'code-review，项目一，Claude Code' }),
    );
    api.previewSkillAssignments.mockImplementation((requests: SkillAssignment[]) =>
      Promise.resolve(
        requests.map((request) => ({
          request: { ...request, expectedRevision: 'external-change' },
          checked: true,
        })),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(
      ((await screen.findByRole('button', { name: '应用可执行项（0）' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(api.applySkillAssignments).not.toHaveBeenCalled();
  });
  it('批量指定其他项目通过真实预览获得完整目标，失败项留在草稿', async () => {
    setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 code-review，全局' }));
    fireEvent.click(screen.getByRole('button', { name: '批量分配（1）' }));
    fireEvent.click(screen.getByLabelText('项目二 · /two'));
    fireEvent.click(screen.getByRole('button', { name: '暂存停用' }));
    await waitFor(() => expect(api.previewSkillAssignments).toHaveBeenCalledTimes(1));
    expect(api.previewSkillAssignments.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({
        target: { scope: 'project', projectId: 'two' },
        sourceTarget: { scope: 'global' },
      }),
    );
    api.applySkillAssignments.mockImplementation((requests: SkillAssignment[]) =>
      Promise.resolve(
        requests.map((request, index) => ({
          request,
          applied: index !== 0,
          error: index === 0 ? '外部修改' : undefined,
        })),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    fireEvent.click(await screen.findByRole('button', { name: '应用可执行项（8）' }));
    await waitFor(() => expect(screen.getByText(/1 项待应用/)).toBeTruthy());
    expect(screen.getByText(/外部修改/)).toBeTruthy();
  });
  it('全部上下文的批量新分配要求明确选择目标', async () => {
    setup({ kind: 'all' });
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 code-review，全局' }));
    fireEvent.click(screen.getByRole('button', { name: '批量分配（1）' }));
    expect((screen.getByRole('button', { name: '暂存使用' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: '暂存停用' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(api.previewSkillAssignments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('项目一 · /one'));
    expect((screen.getByRole('button', { name: '暂存使用' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
  it.each([true, false])('批量选择磁盘状态 %s 清除先前的反向单项草稿', async (enabled) => {
    const matrixRow = row();
    matrixRow.cells[0].checked = enabled;
    api.getSkillMatrix.mockResolvedValue([matrixRow]);
    api.previewSkillAssignments.mockImplementation((requests: SkillAssignment[]) =>
      Promise.resolve(
        requests.map((request) => ({
          request: { ...request, expectedRevision: 'revision-claude-code' },
          checked: enabled,
        })),
      ),
    );
    setup();
    const checkbox = (await screen.findByRole('checkbox', {
      name: 'code-review，项目一，Claude Code',
    })) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(!enabled);
    expect(screen.getByText(/1 项待应用/)).toBeTruthy();
    const dialog = openBulk();
    fireEvent.click(dialog.getByRole('button', { name: enabled ? '暂存使用' : '暂存停用' }));
    await screen.findByText('已暂存 0 项，跳过 1 项无需变更。');
    expect(checkbox.checked).toBe(enabled);
    expect(screen.queryByText(/项待应用/)).toBeNull();
    expect(screen.queryByRole('button', { name: '预览变更' })).toBeNull();
    expect(api.applySkillAssignments).not.toHaveBeenCalled();
  });
  it('批量混合无需变更和真实变更时保留其他 Agent 与项目的草稿', async () => {
    api.previewSkillAssignments.mockImplementation((requests: SkillAssignment[]) =>
      Promise.resolve(
        requests.map((request) => ({
          request: {
            ...request,
            expectedRevision: request.expectedRevision || `bulk-${request.agent}`,
          },
          checked: request.agent !== 'gemini-cli',
        })),
      ),
    );
    const view = setup({ kind: 'project', projectId: 'two' });
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'code-review，项目二，Claude Code' }),
    );
    view.rerender(view.renderPanel({ kind: 'project', projectId: 'one' }));
    for (const agent of ['Claude Code', 'Gemini CLI', 'Codex']) {
      fireEvent.click(
        await screen.findByRole('checkbox', { name: `code-review，项目一，${agent}` }),
      );
    }
    expect(screen.getByText(/4 项待应用/)).toBeTruthy();
    const dialog = openBulk(['Claude Code', 'Gemini CLI']);
    fireEvent.click(dialog.getByRole('button', { name: '暂存使用' }));
    await screen.findByText('已暂存 1 项，跳过 1 项无需变更。');
    expect(screen.getByText(/3 项待应用/)).toBeTruthy();
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'code-review，项目一，Claude Code',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    fireEvent.click(await screen.findByRole('button', { name: '应用可执行项（3）' }));
    await waitFor(() => expect(api.applySkillAssignments).toHaveBeenCalledTimes(1));
    expect(api.applySkillAssignments.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        {
          id: 'review',
          sourceTarget: { scope: 'global' },
          target: { scope: 'project', projectId: 'one' },
          agent: 'gemini-cli',
          enabled: true,
          expectedRevision: 'bulk-gemini-cli',
        },
        {
          id: 'review',
          sourceTarget: { scope: 'global' },
          target: { scope: 'project', projectId: 'one' },
          agent: 'codex',
          enabled: false,
          expectedRevision: 'revision-codex',
        },
        {
          id: 'review',
          sourceTarget: { scope: 'global' },
          target: { scope: 'project', projectId: 'two' },
          agent: 'claude-code',
          enabled: false,
          expectedRevision: 'revision-claude-code',
        },
      ]),
    );
    expect(api.applySkillAssignments.mock.calls[0][0]).toHaveLength(3);
  });
  it('批量预览拒绝时保留旧草稿，仍按原选择与 revision 预览应用', async () => {
    setup();
    const checkbox = (await screen.findByRole('checkbox', {
      name: 'code-review，项目一，Claude Code',
    })) as HTMLInputElement;
    fireEvent.click(checkbox);
    api.previewSkillAssignments.mockRejectedValueOnce(new Error('preview unavailable'));
    const dialog = openBulk();
    fireEvent.click(dialog.getByRole('button', { name: '暂存使用' }));
    await screen.findByText('操作失败，请稍后重试。');
    expect(checkbox.checked).toBe(false);
    expect(screen.getByText(/1 项待应用/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    fireEvent.click(await screen.findByRole('button', { name: '应用可执行项（1）' }));
    await waitFor(() => expect(api.applySkillAssignments).toHaveBeenCalledTimes(1));
    expect(api.applySkillAssignments.mock.calls[0][0]).toEqual([
      {
        id: 'review',
        sourceTarget: { scope: 'global' },
        target: { scope: 'project', projectId: 'one' },
        agent: 'claude-code',
        enabled: false,
        expectedRevision: 'revision-claude-code',
      },
    ]);
  });
  it('批量暂存保留预览 revision，后续冲突与限制仍阻止应用', async () => {
    setup();
    await screen.findByRole('checkbox', { name: '选择 code-review，全局' });
    api.previewSkillAssignments.mockImplementation((requests: SkillAssignment[]) =>
      Promise.resolve(
        requests.map((request) => ({
          request: { ...request, expectedRevision: 'bulk-revision' },
          checked: false,
        })),
      ),
    );
    const dialog = openBulk(['Gemini CLI']);
    fireEvent.click(dialog.getByRole('button', { name: '暂存使用' }));
    await screen.findByText('已暂存 1 项，跳过 0 项无需变更。');
    api.previewSkillAssignments.mockImplementation((requests: SkillAssignment[]) =>
      Promise.resolve(
        requests.map((request) => ({
          request: { ...request, expectedRevision: 'changed-revision' },
          checked: false,
        })),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(
      ((await screen.findByRole('button', { name: '应用可执行项（0）' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(api.previewSkillAssignments.mock.calls[1][0][0].expectedRevision).toBe('bulk-revision');
    expect(screen.getByText(/目录、版本或策略已变化/)).toBeTruthy();
    expect(api.applySkillAssignments).not.toHaveBeenCalled();
  });
});
