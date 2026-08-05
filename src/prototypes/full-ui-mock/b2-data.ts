import type { AssetType, ConfigContext, CreateMode, MockAsset, SkillAgentTarget } from './types';

export interface B2MockAsset extends MockAsset {
  version: string;
  updatedLabel: string;
  sourcePath: string;
  decisionStatus: '正常' | '存在问题' | '不兼容';
  blockReason?: string;
  issueCount?: number;
}

export const b2ProjectNames = [
  'ReinventedWheelAgent',
  'agent-config-manager',
  'mobile-tooling',
] as const;

export const b2DefaultContext: ConfigContext = 'all';
export const b2DefaultSkillId = 'b2-commit-conventions';

export const b2AgentNames = ['Claude Code', 'Codex', 'Gemini CLI', 'OpenCode'] as const;
export type B2AgentName = (typeof b2AgentNames)[number];

const agents = b2AgentNames;

const b2AgentRootNames: Record<B2AgentName, string> = {
  'Claude Code': 'claude',
  Codex: 'codex',
  'Gemini CLI': 'gemini',
  OpenCode: 'opencode',
};

const b2InstructionFileNames: Record<B2AgentName, string> = {
  'Claude Code': 'CLAUDE.md',
  Codex: 'AGENTS.md',
  'Gemini CLI': 'GEMINI.md',
  OpenCode: 'AGENTS.md',
};

const b2AssetTypeKeys: Record<AssetType, string> = {
  Skills: 'skills',
  长期指令: 'instructions',
  Subagents: 'subagents',
  Hooks: 'hooks',
};

export interface B2NativeTargetInput {
  type: AssetType;
  name: string;
  agent: string;
  scope: '全局' | '项目';
  project: string;
}

export interface B2NativeAssetInput {
  type: AssetType;
  name: string;
  agent: string;
  scope: '全局' | '项目';
  project: string;
  mode: CreateMode;
}

function b2IdentityPart(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'asset';
}

function b2AgentName(agent: string): B2AgentName {
  return b2AgentNames.find((candidate) => candidate === agent) ?? 'Codex';
}

export function b2NativeTargetPath(input: B2NativeTargetInput): string {
  const agent = b2AgentName(input.agent);
  const project = input.scope === '全局' ? '用户全局配置' : input.project;
  const root =
    input.scope === '全局'
      ? `~/.${b2AgentRootNames[agent]}`
      : `~/projects/${project}/.${b2AgentRootNames[agent]}`;

  if (input.type === 'Skills') {
    return `${root}/skills/${b2IdentityPart(input.name)}/SKILL.md`;
  }
  if (input.type === '长期指令') {
    return `${root}/${b2InstructionFileNames[agent]}`;
  }
  if (input.type === 'Subagents') {
    return `${root}/agents/${b2IdentityPart(input.name)}.md`;
  }
  return `${root}/hooks/${b2IdentityPart(input.name)}.json`;
}

export function b2AssetDecisionStatus(
  asset: Pick<MockAsset, 'status'> & Partial<Pick<B2MockAsset, 'decisionStatus'>>,
): '正常' | '存在问题' | '只读' | '漂移' | '冲突' | '不兼容' {
  return asset.decisionStatus ?? asset.status ?? '正常';
}

export function b2AssetBlockReason(
  asset: Pick<MockAsset, 'status'> & Partial<Pick<B2MockAsset, 'decisionStatus' | 'blockReason'>>,
): string | null {
  if (b2AssetDecisionStatus(asset) !== '不兼容') return null;
  return asset.blockReason ?? '当前适配器未覆盖此资产结构。';
}

export function b2CreatedAssetId(input: B2NativeAssetInput): string {
  const agent = b2AgentName(input.agent);
  const scopeTarget =
    input.scope === '全局' ? 'global' : `project-${b2IdentityPart(input.project)}`;
  const targetIdentity = input.type === '长期指令' ? b2InstructionFileNames[agent] : input.name;
  return [
    'b2-created',
    b2AssetTypeKeys[input.type],
    b2IdentityPart(agent),
    scopeTarget,
    b2IdentityPart(targetIdentity),
  ].join(':');
}

export function createB2NativeAsset(input: B2NativeAssetInput): B2MockAsset {
  const name = input.name.trim() || 'new-asset';
  const agent = b2AgentName(input.agent);
  const project = input.scope === '全局' ? '用户全局配置' : input.project;
  const imported = input.mode === '从本地导入' || input.mode === '导入项目 Skill';
  const description = imported
    ? `从本地来源模拟导入的 ${input.type} 原生资产。`
    : `为 ${agent} 创建的合成 ${input.type} 原生资产。`;

  let relativePath: string;
  let fileName: string;
  let language: string;
  let content: string;

  if (input.type === 'Skills') {
    relativePath = `skills/${b2IdentityPart(name)}/SKILL.md`;
    fileName = 'SKILL.md';
    language = 'markdown';
    content = `---\nname: ${name}\ndescription: ${description}\nversion: v0.1.0\n---\n\n# ${name}\n\n${description}\n`;
  } else if (input.type === '长期指令') {
    relativePath = b2InstructionFileNames[agent];
    fileName = relativePath;
    language = 'markdown';
    content = `# ${name}\n\n${description}\n\n适用 Agent：${agent}\n`;
  } else if (input.type === 'Subagents') {
    relativePath = `agents/${b2IdentityPart(name)}.md`;
    fileName = relativePath;
    language = 'markdown';
    content = `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${description}\n`;
  } else {
    relativePath = `hooks/${b2IdentityPart(name)}.json`;
    fileName = relativePath;
    language = 'json';
    content = `${JSON.stringify(
      {
        name,
        event: 'beforeApply',
        enabled: true,
        command: `echo synthetic-${b2IdentityPart(name)}`,
      },
      null,
      2,
    )}\n`;
  }

  return {
    id: b2CreatedAssetId({ ...input, name, agent, project }),
    type: input.type,
    name,
    agent,
    scope: input.scope,
    project,
    description,
    version: 'v0.1.0',
    updatedLabel: '尚未应用',
    sourcePath: b2NativeTargetPath({ ...input, name, agent, project }),
    decisionStatus: '正常',
    agentTargets: input.type === 'Skills' ? targets(agent) : undefined,
    files: [
      {
        name: fileName,
        language,
        changed: true,
        content,
      },
    ],
  };
}

function targets(
  recognized: (typeof agents)[number],
  blocked?: (typeof agents)[number],
): SkillAgentTarget[] {
  return agents.map((agent) => {
    if (agent === blocked) {
      return {
        agent,
        status: 'blocked',
        enabled: false,
        reason: '当前适配器版本未覆盖该 Skill 结构。',
      };
    }
    if (agent === recognized) return { agent, status: 'recognized', enabled: true };
    if (agent === 'Gemini CLI') return { agent, status: 'convertible', enabled: false };
    return { agent, status: 'installable', enabled: false };
  });
}

function skill(
  id: string,
  name: string,
  project: string,
  version: string,
  updatedLabel: string,
  description: string,
  options: {
    agent?: (typeof agents)[number];
    decisionStatus?: B2MockAsset['decisionStatus'];
    blockReason?: string;
    issueCount?: number;
    blocked?: (typeof agents)[number];
    scope?: B2MockAsset['scope'];
  } = {},
): B2MockAsset {
  const scope = options.scope ?? '项目';
  const agent = options.agent ?? 'Codex';
  const root = scope === '全局' ? '~/.codex' : `~/projects/${project}/.codex`;
  return {
    id,
    type: 'Skills',
    name,
    agent,
    scope,
    project,
    description,
    version,
    updatedLabel,
    sourcePath: `${root}/skills/${name}/SKILL.md`,
    decisionStatus: options.decisionStatus ?? '正常',
    blockReason: options.blockReason,
    issueCount: options.issueCount,
    agentTargets: targets(agent, options.blocked),
    files: [
      {
        name: 'SKILL.md',
        language: 'markdown',
        content: `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\n---\n\n# ${name}\n\n${description}\n`,
      },
      {
        name: 'references/usage.md',
        language: 'markdown',
        content: `# Usage\n\nSynthetic reference for ${name}.\n`,
      },
    ],
  };
}

function companion(
  id: string,
  type: Exclude<B2MockAsset['type'], 'Skills'>,
  name: string,
  project: string,
  agent: (typeof agents)[number],
  fileName: string,
): B2MockAsset {
  const sourcePath = `~/projects/${project}/.${agent === 'Claude Code' ? 'claude' : agent === 'Gemini CLI' ? 'gemini' : agent === 'OpenCode' ? 'opencode' : 'codex'}/${fileName}`;
  return {
    id,
    type,
    name,
    agent,
    scope: '项目',
    project,
    description: `${project} 的合成 ${type} 原生资产。`,
    version: 'v1.0.0',
    updatedLabel: '更新 9 天前',
    sourcePath,
    decisionStatus: '正常',
    files: [
      {
        name: fileName,
        language: fileName.endsWith('.json') ? 'json' : 'markdown',
        content: `# ${name}\n\nSynthetic ${type} content for ${project}.\n`,
      },
    ],
  };
}

const reinventedSkills = [
  skill(
    'b2-commit-conventions',
    'commit-conventions',
    'ReinventedWheelAgent',
    'v1.3.0',
    '更新 14 天前',
    '统一提交信息结构、变更范围与审查约束。',
  ),
  skill(
    'b2-release-checklist',
    'release-checklist',
    'ReinventedWheelAgent',
    'v1.2.0',
    '更新 21 天前',
    '发布前检查构建、测试、版本与回滚证据。',
    { agent: 'Claude Code' },
  ),
  skill(
    'b2-harmonyos-migration-review',
    'harmonyos-migration-review',
    'ReinventedWheelAgent',
    'v1.1.0',
    '更新 1 个月前',
    '审查 Android 到 HarmonyOS 迁移的行为与 UI 保真度。',
    { agent: 'Gemini CLI' },
  ),
  skill(
    'b2-testing-strategy',
    'testing-strategy',
    'ReinventedWheelAgent',
    'v1.0.1',
    '更新 1 个月前',
    '为变更建立分层测试、门禁和证据记录。',
  ),
  skill(
    'b2-code-review-checklist',
    'code-review-checklist',
    'ReinventedWheelAgent',
    'v1.0.0',
    '更新 2 个月前',
    '聚焦正确性、边界、回归和可维护性的代码审查清单。',
    { decisionStatus: '存在问题', issueCount: 1, blocked: 'OpenCode' },
  ),
  skill(
    'b2-frontend-design',
    'frontend-design',
    'ReinventedWheelAgent',
    'v0.9.0',
    '更新 2 个月前',
    '将视觉参考转换为可复用的前端布局与组件约束。',
    { agent: 'Claude Code' },
  ),
  skill(
    'b2-api-contract-audit',
    'api-contract-audit',
    'ReinventedWheelAgent',
    'v1.4.0',
    '更新 3 个月前',
    '核对 DTO、错误码、兼容边界与调用方假设。',
  ),
  skill(
    'b2-migration-evidence',
    'migration-evidence',
    'ReinventedWheelAgent',
    'v0.8.0',
    '更新 3 个月前',
    '整理迁移过程中的验证证据与未闭合风险。',
    { agent: 'Gemini CLI' },
  ),
];

export const b2Assets: B2MockAsset[] = [
  ...reinventedSkills,
  companion(
    'b2-reinvented-instructions',
    '长期指令',
    'AGENTS.md',
    'ReinventedWheelAgent',
    'Codex',
    'AGENTS.md',
  ),
  companion(
    'b2-reinvented-subagent',
    'Subagents',
    'migration-reviewer',
    'ReinventedWheelAgent',
    'Claude Code',
    'agents/migration-reviewer.md',
  ),
  skill(
    'b2-config-frontend-contract',
    'frontend-contract',
    'agent-config-manager',
    'v1.5.0',
    '更新 7 天前',
    '维护前端与本地网关之间的冻结契约。',
  ),
  skill(
    'b2-config-adapter-audit',
    'adapter-audit',
    'agent-config-manager',
    'v1.0.0',
    '更新 18 天前',
    '审查多 Agent 适配器的版本与无损写入边界。',
    {
      agent: 'Claude Code',
      decisionStatus: '不兼容',
      blockReason: '适配器未覆盖此 Skill 结构。',
      blocked: 'OpenCode',
    },
  ),
  companion(
    'b2-config-instructions',
    '长期指令',
    'CLAUDE.md',
    'agent-config-manager',
    'Claude Code',
    'CLAUDE.md',
  ),
  companion(
    'b2-config-subagent',
    'Subagents',
    'contract-reviewer',
    'agent-config-manager',
    'Codex',
    'agents/contract-reviewer.md',
  ),
  skill(
    'b2-mobile-release',
    'mobile-release',
    'mobile-tooling',
    'v1.1.0',
    '更新 12 天前',
    '移动端构建、签名和发布前的本地检查流程。',
    { agent: 'Gemini CLI' },
  ),
  skill(
    'b2-mobile-device-matrix',
    'device-matrix',
    'mobile-tooling',
    'v0.7.0',
    '更新 29 天前',
    '维护移动端设备与系统版本覆盖矩阵。',
  ),
  companion(
    'b2-mobile-instructions',
    '长期指令',
    'GEMINI.md',
    'mobile-tooling',
    'Gemini CLI',
    'GEMINI.md',
  ),
  companion(
    'b2-mobile-subagent',
    'Subagents',
    'device-lab',
    'mobile-tooling',
    'Gemini CLI',
    'agents/device-lab.md',
  ),
  skill(
    'b2-global-security-review',
    'security-review',
    '用户全局配置',
    'v2.0.0',
    '更新 6 天前',
    '通用敏感信息、权限与外部命令审查。',
    { scope: '全局', agent: 'Claude Code' },
  ),
  skill(
    'b2-global-writing',
    'technical-writing',
    '用户全局配置',
    'v1.6.0',
    '更新 15 天前',
    '统一技术说明、实施报告和验收记录的表达方式。',
    { scope: '全局' },
  ),
  {
    ...companion(
      'b2-global-instructions',
      '长期指令',
      'Global AGENTS.md',
      '用户全局配置',
      'Codex',
      'AGENTS.md',
    ),
    scope: '全局',
    sourcePath: '~/.codex/AGENTS.md',
  },
  {
    ...companion(
      'b2-global-subagent',
      'Subagents',
      'research-scout',
      '用户全局配置',
      'Claude Code',
      'agents/research-scout.md',
    ),
    scope: '全局',
    sourcePath: '~/.claude/agents/research-scout.md',
  },
];

export function getB2Asset(id: string): B2MockAsset {
  return b2Assets.find((asset) => asset.id === id) ?? b2Assets[0];
}

export function b2AssetsForContext(
  context: ConfigContext,
  type: B2MockAsset['type'],
): B2MockAsset[] {
  if (context === 'all') {
    return b2Assets.filter((asset) => asset.type === type);
  }
  if (context === 'global') {
    return b2Assets.filter((asset) => asset.scope === '全局' && asset.type === type);
  }
  const project = context.replace('project:', '');
  return b2Assets.filter(
    (asset) =>
      asset.type === type &&
      ((asset.scope === '项目' && asset.project === project) || asset.scope === '全局'),
  );
}
