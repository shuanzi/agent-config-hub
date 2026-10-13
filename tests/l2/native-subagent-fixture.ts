import type { AgentType, ConfigContext } from '../../src/types';
import type {
  NativeSubagentBackup,
  NativeSubagentDefinition,
  NativeSubagentDiscovery,
} from '../../src/lib/api/nativeSubagents';

/** L2 专用内存模型，不接触真实目录。真实格式/事务由 Rust fixtures 验证。 */
export function createNativeSubagentFixture(polished = false) {
  const entries = new Map<string, { definition: NativeSubagentDefinition; content: string }>();
  const backups: (NativeSubagentBackup & {
    content: string;
    definition: NativeSubagentDefinition;
  })[] = [];
  let revision = 0;
  for (const agent of ['codex', 'opencode'] as const) {
    for (const name of ['explorer', 'reviewer', 'worker', 'test_runner']) {
      const identity = `${agent}:${name}`;
      const definition: NativeSubagentDefinition = {
        identity,
        name,
        description: '只读诊断与精确任务执行，保留原生权限配置。',
        agent,
        target: { scope: 'global' },
        format: agent === 'codex' ? 'toml' : 'markdown',
        sourceKind: 'file',
        sourcePath: `/fixture/${agent === 'codex' ? '.codex' : '.config/opencode'}/agents/${name}.${agent === 'codex' ? 'toml' : 'md'}`,
        managementStatus: 'unmanaged',
        enabled: true,
        contentHash: `hash-${revision++}`,
        isSymlink: false,
        diagnostics: [],
      };
      entries.set(identity, {
        definition,
        content:
          agent === 'codex'
            ? `name = "${name}"\ndescription = "Fixture agent"\ndeveloper_instructions = "Read and report."\nsandbox_mode = "read-only"\n`
            : '---\ndescription: Fixture agent\nmode: subagent\n---\nRead and report.\n',
      });
    }
  }
  if (polished) {
    entries.clear();
    for (const [index, agent] of (['codex', 'claude-code', 'opencode'] as const).entries()) {
      const name = ['repo-reviewer', 'security-reviewer', 'docs-writer'][index];
      const project = index === 0;
      const format = agent === 'codex' ? 'toml' : 'markdown';
      const sourcePath = project
        ? `/workspaces/visual-alpha/.codex/agents/${name}.toml`
        : `/Users/mock/${agent === 'claude-code' ? '.claude' : '.config/opencode'}/agents/${name}.md`;
      const definition: NativeSubagentDefinition = {
        identity: `${agent}:${name}`,
        name,
        description: '检查正确性、回归与遗漏测试。',
        agent,
        target: project
          ? { scope: 'project', projectId: 'visual-project-alpha' }
          : { scope: 'global' },
        format,
        sourceKind: 'file',
        sourcePath,
        managementStatus: index === 0 ? 'managed' : index === 1 ? 'unmanaged' : 'disabled',
        enabled: index !== 2,
        contentHash: `hash-${revision++}`,
        isSymlink: false,
        diagnostics: [],
        ...(project
          ? {
              repoOwner: 'team',
              repoName: 'agents',
              repoPath: 'repo-reviewer.toml',
              repoBranch: 'main',
            }
          : {}),
      };
      entries.set(definition.identity, {
        definition,
        content:
          format === 'toml'
            ? `name = "${name}"\ndescription = "审查仓库变更"\ndeveloper_instructions = """\n检查正确性、回归与遗漏测试。\n"""\n`
            : `---\nname: ${name}\ndescription: 审查仓库变更\n---\n检查正确性、回归与遗漏测试。\n`,
      });
    }
  }
  const inContext = (definition: NativeSubagentDefinition, context: ConfigContext) =>
    context.kind === 'all' ||
    (context.kind === 'global' && definition.target.scope === 'global') ||
    (context.kind === 'project' &&
      definition.target.scope === 'project' &&
      definition.target.projectId === context.projectId);
  const error = (message: string): never => {
    throw JSON.stringify({ code: 'NATIVE_SUBAGENT_CONFLICT', context: { message } });
  };
  return (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'scan_native_subagents')
      return {
        definitions: [...entries.values()]
          .map((entry) => structuredClone(entry.definition))
          .filter((item) => inContext(item, args.context as ConfigContext)),
        scanErrors: [],
      };
    if (command === 'get_native_subagent_backups')
      return backups.filter((backup) =>
        inContext(backup.definition, args.context as ConfigContext),
      );
    if (command === 'delete_native_subagent_backup') {
      const index = backups.findIndex((item) => item.backupId === args.backupId);
      if (index < 0 || backups[index].contentHash !== args.expectedContentHash)
        return error('备份已变化');
      backups.splice(index, 1);
      return;
    }
    if (command === 'restore_native_subagent_backup') {
      const backup = backups.find((item) => item.backupId === args.backupId);
      if (!backup) return error('备份不存在');
      const present = entries.get(backup.identity);
      if (present && present.definition.contentHash !== args.expectedDestinationHash)
        return error('目标已被外部修改');
      const definition = {
        ...backup.definition,
        managementStatus: 'managed' as const,
        contentHash: `hash-${revision++}`,
      };
      entries.set(backup.identity, { definition, content: backup.content });
      return definition;
    }
    if (command === 'discover_native_subagents')
      return [
        {
          key: 'example/agents:reviewer.toml',
          name: 'repo-reviewer',
          description: 'Codex 原生审阅代理',
          directory: 'reviewer',
          path: 'reviewer.toml',
          repoOwner: 'example',
          repoName: 'agents',
          repoBranch: 'main',
          installed: false,
          format: 'toml',
          compatibleAgents: ['codex'],
        },
        ...(polished
          ? [
              {
                key: 'team/agents:security-reviewer.md',
                name: 'security-reviewer',
                description: '审阅常见安全风险与依赖边界。',
                directory: 'security-reviewer',
                path: 'security-reviewer.md',
                repoOwner: 'team',
                repoName: 'agents',
                repoBranch: 'main',
                installed: false,
                format: 'markdown',
                compatibleAgents: ['claude-code'],
              },
            ]
          : []),
      ];
    if (command === 'install_native_subagent') {
      const candidate = args.subagent as NativeSubagentDiscovery;
      const agent = args.agent as AgentType;
      const target = args.target as NativeSubagentDefinition['target'];
      const identity = `installed:${agent}:${candidate.key}:${JSON.stringify(target)}`;
      const root =
        target.scope === 'global'
          ? '/Users/mock'
          : target.projectId === 'visual-project-alpha'
            ? '/workspaces/visual-alpha'
            : '/workspaces/visual-beta';
      const folder =
        agent === 'codex'
          ? '.codex'
          : agent === 'claude-code'
            ? '.claude'
            : agent === 'opencode'
              ? '.opencode'
              : '.gemini';
      const definition: NativeSubagentDefinition = {
        identity,
        name: candidate.name,
        description: candidate.description,
        agent,
        target,
        format: candidate.format === 'toml' ? 'toml' : 'markdown',
        sourceKind: 'file',
        sourcePath: `${root}/${folder}/agents/${candidate.name}.${candidate.format === 'toml' ? 'toml' : 'md'}`,
        managementStatus: 'managed',
        enabled: true,
        contentHash: `hash-${revision++}`,
        isSymlink: false,
        diagnostics: [],
        repoOwner: candidate.repoOwner,
        repoName: candidate.repoName,
        repoPath: candidate.path,
        repoBranch: candidate.repoBranch,
      };
      entries.set(identity, {
        definition,
        content:
          candidate.format === 'toml'
            ? `name = "${candidate.name}"\ndescription = "Repo fixture"\ndeveloper_instructions = "Review."\n`
            : `---\nname: ${candidate.name}\ndescription: Repo fixture\n---\nReview.\n`,
      });
      return definition;
    }
    const entry = entries.get(args.identity as string);
    if (!entry) return error('定义不存在');
    if (command === 'read_native_subagent')
      return { ...structuredClone(entry), contentHash: entry.definition.contentHash };
    if (command === 'preview_native_subagent_update')
      return {
        identity: entry.definition.identity,
        currentContent: entry.content,
        nextContent: `${entry.content}# Updated\n`,
        currentHash: entry.definition.contentHash,
        remoteHash: 'remote-next',
        locallyModified: polished,
      };
    if (args.expectedHash !== entry.definition.contentHash)
      return error('文件已被外部修改，请重新加载');
    const snapshot = (): NativeSubagentBackup => {
      const backup = {
        backupId: `backup-${revision++}`,
        identity: entry.definition.identity,
        name: entry.definition.name,
        agent: entry.definition.agent,
        target: entry.definition.target,
        sourcePath: entry.definition.sourcePath,
        contentHash: entry.definition.contentHash,
        createdAt: Date.now() / 1000,
        reason: command,
        definition: structuredClone(entry.definition),
        content: entry.content,
      };
      backups.push(backup);
      return backup;
    };
    if (command === 'backup_native_subagent') return snapshot();
    snapshot();
    switch (command) {
      case 'adopt_native_subagent':
        entry.definition.managementStatus = 'managed';
        break;
      case 'save_native_subagent':
        entry.content = args.content as string;
        break;
      case 'set_native_subagent_enabled':
        entry.definition.enabled = args.enabled as boolean;
        entry.definition.managementStatus = args.enabled ? 'managed' : 'disabled';
        break;
      case 'uninstall_native_subagent':
        entries.delete(entry.definition.identity);
        return { backupId: backups.at(-1)?.backupId };
      case 'apply_native_subagent_update':
        entry.content += '# Updated\n';
        break;
      default:
        return error(`Fixture 未实现 ${command}`);
    }
    entry.definition.contentHash = `hash-${revision++}`;
    return command === 'save_native_subagent'
      ? { ...structuredClone(entry), contentHash: entry.definition.contentHash }
      : structuredClone(entry.definition);
  };
}
