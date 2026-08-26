// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ConfigContext } from '../../../src/types';

type InstructionKind = 'claude' | 'agents';

interface InstructionDocumentFixture {
  kind: InstructionKind;
  fileName: 'CLAUDE.md' | 'AGENTS.md';
  appliesTo: readonly ('claude-code' | 'codex' | 'opencode')[];
  target: { scope: 'global' } | { scope: 'project'; projectId: string };
  content: string;
  exists: boolean;
}

const globalDocuments: InstructionDocumentFixture[] = [
  {
    kind: 'claude',
    fileName: 'CLAUDE.md',
    appliesTo: ['claude-code'],
    target: { scope: 'global' },
    content: '# Global Claude instructions',
    exists: true,
  },
  {
    kind: 'agents',
    fileName: 'AGENTS.md',
    appliesTo: ['codex', 'opencode'],
    target: { scope: 'global' },
    content: '',
    exists: false,
  },
];

const projectDocuments: InstructionDocumentFixture[] = [
  {
    kind: 'claude',
    fileName: 'CLAUDE.md',
    appliesTo: ['claude-code'],
    target: { scope: 'project', projectId: 'project-alpha' },
    content: '# Project Claude instructions',
    exists: true,
  },
  {
    kind: 'agents',
    fileName: 'AGENTS.md',
    appliesTo: ['codex', 'opencode'],
    target: { scope: 'project', projectId: 'project-alpha' },
    content: '# Project shared instructions',
    exists: true,
  },
];

function contextKey(context: ConfigContext): string {
  return context.kind === 'project' ? `project:${context.projectId}` : context.kind;
}

function documentButton(target: string, kind: InstructionKind): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `button[data-instruction-target="${target}"][data-instruction-kind="${kind}"]`,
  );
  if (button === null) throw new Error(`找不到 ${target} 下的 ${kind} 文档行`);
  return button;
}

async function findDocumentButton(
  target: string,
  kind: InstructionKind,
): Promise<HTMLButtonElement> {
  await waitFor(() => expect(documentButton(target, kind)).toBeTruthy());
  return documentButton(target, kind);
}

function installInstructionInvoke() {
  const documents = new Map<string, InstructionDocumentFixture[]>([
    ['global', structuredClone(globalDocuments)],
    ['project:project-alpha', structuredClone(projectDocuments)],
  ]);
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];

  (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__ = (
    command: string,
    args?: Record<string, unknown>,
  ) => {
    calls.push({ command, args });
    if (command === 'get_instruction_documents') {
      const context = args?.context as ConfigContext;
      const global = documents.get('global') ?? [];
      if (context.kind === 'global') return structuredClone(global);
      if (context.kind === 'project') {
        return structuredClone([...(documents.get(contextKey(context)) ?? []), ...global]);
      }
      return structuredClone([...global, ...(documents.get('project:project-alpha') ?? [])]);
    }
    if (command === 'upsert_instruction_document') {
      const target = args?.target as { scope: 'global' } | { scope: 'project'; projectId: string };
      const kind = args?.kind as InstructionKind;
      const content = args?.content as string;
      const key = target.scope === 'project' ? `project:${target.projectId}` : 'global';
      const targetDocuments = documents.get(key);
      const document = targetDocuments?.find((item) => item.kind === kind);
      if (document === undefined) throw new Error('长期指令文档不存在');
      document.content = content;
      document.exists = true;
      return undefined;
    }
    throw new Error(`Unhandled mock command: ${command}`);
  };

  return calls;
}

async function loadPanel() {
  const mod = await import('../../../src/components/instructions/InstructionsPanel');
  return mod.InstructionsPanel;
}

async function renderPanel(context: ConfigContext) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const InstructionsPanel = await loadPanel();
  return render(<InstructionsPanel context={context} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

describe('InstructionsPanel document management', () => {
  beforeEach(() => {
    installInstructionInvoke();
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__;
  });

  it('在 global target 固定展示 CLAUDE.md 和 AGENTS.md，且未创建文件仍可选择', async () => {
    await renderPanel({ kind: 'global' });

    const list = await screen.findByRole('region', { name: '长期指令文件列表' });
    await findDocumentButton('global', 'claude');
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(within(list).getByRole('button', { name: /CLAUDE\.md/ })).toBeTruthy();
    expect(within(list).getByRole('button', { name: /AGENTS\.md/ })).toBeTruthy();
    expect(screen.getByText('未创建')).toBeTruthy();

    const agentsRow = await findDocumentButton('global', 'agents');
    fireEvent.click(agentsRow);
    expect(agentsRow.getAttribute('aria-current')).toBe('page');
    expect((screen.getByLabelText('内容') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByRole('button', { name: '保存 AGENTS.md' })).toBeTruthy();
  });

  it('将两类文档的原生适用 Agent 显示在详情中，并完全排除 Gemini', async () => {
    await renderPanel({ kind: 'global' });

    fireEvent.click(await findDocumentButton('global', 'claude'));
    const claudeDetail = screen.getByRole('region', { name: '长期指令文件详情' });
    expect(claudeDetail.textContent).toContain('Claude Code');
    expect(claudeDetail.textContent).not.toContain('Codex');
    expect(claudeDetail.textContent).not.toContain('Gemini');

    fireEvent.click(await findDocumentButton('global', 'agents'));
    const agentsDetail = screen.getByRole('region', { name: '长期指令文件详情' });
    expect(agentsDetail.textContent).toContain('Codex');
    expect(agentsDetail.textContent).toContain('OpenCode');
    expect(agentsDetail.textContent).not.toContain('Gemini');
  });

  it('直接保存 global AGENTS.md 到共享文档 target，不包含 Agent 或 enable 参数', async () => {
    const calls = installInstructionInvoke();
    await renderPanel({ kind: 'global' });

    fireEvent.click(await findDocumentButton('global', 'agents'));
    fireEvent.change(screen.getByLabelText('内容'), {
      target: { value: '# Shared Codex and OpenCode instructions' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 AGENTS.md' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'upsert_instruction_document',
        args: {
          target: { scope: 'global' },
          kind: 'agents',
          content: '# Shared Codex and OpenCode instructions',
        },
      }),
    );
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('项目 target 以 projectId 保存同一根目录的 AGENTS.md', async () => {
    const calls = installInstructionInvoke();
    await renderPanel({ kind: 'project', projectId: 'project-alpha' });

    fireEvent.click(await findDocumentButton('project:project-alpha', 'agents'));
    fireEvent.change(screen.getByLabelText('内容'), {
      target: { value: '# Shared project instructions' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 AGENTS.md' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'upsert_instruction_document',
        args: {
          target: { scope: 'project', projectId: 'project-alpha' },
          kind: 'agents',
          content: '# Shared project instructions',
        },
      }),
    );
  });

  it('不暴露旧的预设或 Agent 使能操作', async () => {
    await renderPanel({ kind: 'global' });
    await findDocumentButton('global', 'claude');

    for (const name of [
      '新建预设',
      '从 live 文件导入',
      '查看 live 内容',
      '隐藏 live 内容',
      '启用',
      '删除',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByLabelText('名称')).toBeNull();
    expect(screen.queryByLabelText('描述')).toBeNull();
    expect(screen.queryByLabelText('状态过滤')).toBeNull();
    expect(document.body.textContent).not.toContain('Gemini CLI');
  });

  it('AGENTS.md 的双投影内容不一致时仅显示错误，不提供冲突解决控件', async () => {
    (window as unknown as Record<string, unknown>).__ACM_MOCK_INVOKE__ = (command: string) => {
      if (command === 'get_instruction_documents') {
        throw new Error(
          JSON.stringify({
            code: 'INSTRUCTION_PROJECTIONS_DIVERGED',
            context: {},
            suggestion: 'resolveInstructionProjectionConflict',
          }),
        );
      }
      throw new Error(`Unhandled mock command: ${command}`);
    };
    await renderPanel({ kind: 'global' });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Codex 与 OpenCode 的 AGENTS.md 内容不一致');
    expect(screen.queryByLabelText('内容')).toBeNull();
    expect(screen.queryByRole('button', { name: /解决|覆盖|同步/ })).toBeNull();
  });

  it('all 中同名文件按 ownership target 分组，不混淆全局与项目 AGENTS.md', async () => {
    await renderPanel({ kind: 'all' });
    const list = await screen.findByRole('region', { name: '长期指令文件列表' });
    const globalAgents = await findDocumentButton('global', 'agents');
    const projectAgents = await findDocumentButton('project:project-alpha', 'agents');

    expect(within(list).getAllByRole('button')).toHaveLength(4);
    expect(globalAgents).not.toBe(projectAgents);
    expect(globalAgents.textContent).toContain('未创建');
    expect(projectAgents.textContent).toContain('已创建');
  });

  it('项目视图中的适用 global AGENTS.md 保持 global ownership 保存', async () => {
    const calls = installInstructionInvoke();
    await renderPanel({ kind: 'project', projectId: 'project-alpha' });

    fireEvent.click(await findDocumentButton('global', 'agents'));
    fireEvent.change(screen.getByLabelText('内容'), {
      target: { value: '# Updated global shared' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 AGENTS.md' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'upsert_instruction_document',
        args: {
          target: { scope: 'global' },
          kind: 'agents',
          content: '# Updated global shared',
        },
      }),
    );
  });
});
