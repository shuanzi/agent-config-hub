import type { AssetType, MockAsset, RecoveryPoint } from './types';

/**
 * 合成数据构造辅助：让多文件资产内容足够真实，同时保持“明显是假数据”。
 * 所有内容均为占位文本，不对应任何真实仓库或密钥。
 */
function skillDoc(name: string, purpose: string, steps: string[]): string {
  const body = steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  return [
    '---',
    `name: ${name}`,
    `description: ${purpose}`,
    'version: 0.3.0-mock',
    '---',
    '',
    `# ${name}`,
    '',
    `> 合成示例数据，仅用于界面原型。用途：${purpose}`,
    '',
    '## 使用步骤',
    '',
    body,
    '',
    '## 边界',
    '',
    '- 不访问网络与外部服务。',
    '- 不修改未列出的文件。',
    '- 所有结论必须附带可验证的证据。',
    '',
    '## 示例',
    '',
    '```text',
    '输入：一段本地变更说明',
    '输出：可审查的结构化结论（示例）',
    '```',
  ].join('\n');
}

function instructionDoc(title: string, rules: string[]): string {
  const body = rules.map((rule) => `- ${rule}`).join('\n');
  return [
    `# ${title}`,
    '',
    '<!-- 合成示例数据，仅用于界面原型 -->',
    '',
    '## 沟通约定',
    '',
    body,
    '',
    '## 输出格式',
    '',
    '1. 先给结论，再给依据。',
    '2. 涉及风险时单列“剩余风险”小节。',
    '3. 引用代码位置使用 `path:行号` 形式。',
    '',
    '## 示例片段',
    '',
    '```text',
    '结论：该路径已覆盖。',
    '依据：tests/l1/example.test.ts:12',
    '```',
  ].join('\n');
}

function agentDoc(role: string, duties: string[]): string {
  const body = duties.map((duty) => `- ${duty}`).join('\n');
  return [
    '---',
    `role: ${role}`,
    'model: mock-model',
    '---',
    '',
    `# ${role}`,
    '',
    '> 合成示例数据，仅用于界面原型。',
    '',
    '## 职责',
    '',
    body,
    '',
    '## 约束',
    '',
    '- 只读取任务范围内的文件。',
    '- 不执行任何写入操作，除非任务明确要求。',
    '- 完成后汇报：做了什么、没验证什么。',
  ].join('\n');
}

function hookConfig(event: string, checks: string[]): string {
  return JSON.stringify(
    {
      event,
      mode: 'static-validation',
      enabled: true,
      mock: true,
      checks,
      note: '合成示例数据，仅用于界面原型；本工具不执行 hook。',
    },
    null,
    2,
  );
}

export const mockAssets: MockAsset[] = [
  // ---------- Skills ----------
  {
    id: 'commit-guide',
    type: 'Skills',
    name: 'commit-message-guide',
    agent: 'Claude Code',
    scope: '项目',
    project: 'acme/desktop',
    description: '提交说明与变更范围检查。',
    files: [
      {
        name: 'SKILL.md',
        language: 'markdown',
        changed: true,
        content: skillDoc('commit-message-guide', '为本地变更生成可审查的提交说明', [
          '先阅读变更的用户意图。',
          '标题只描述可验证的行为。',
          '不把未验证的风险写成完成。',
          '正文列出影响面与回滚方式。',
        ]),
      },
      {
        name: 'examples/conventional.md',
        language: 'markdown',
        content: [
          '# Conventional 示例（合成数据）',
          '',
          '```text',
          'feat: add local import review',
          '',
          '- 保留原生文件结构',
          '- 明确需要用户确认的覆盖',
          '```',
          '',
          '## 反例',
          '',
          '- “优化代码” —— 不可验证。',
          '- “修复若干问题” —— 没有范围。',
        ].join('\n'),
      },
      {
        name: 'checklist.md',
        language: 'markdown',
        content: [
          '# 提交前检查（合成数据）',
          '',
          '- [ ] 变更可通过一条命令复现',
          '- [ ] 无未说明的格式化 churn',
          '- [ ] 提交说明与 diff 一致',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'release-checklist',
    type: 'Skills',
    name: 'release-checklist',
    agent: 'Codex',
    scope: '全局',
    project: '用户全局配置',
    status: '漂移',
    description: '发布前证据与回滚检查。',
    files: [
      {
        name: 'SKILL.md',
        language: 'markdown',
        content: skillDoc('release-checklist', '发布前的证据核验与回滚预案', [
          '先检查证据 provenance。',
          '只在所有门禁通过后发布。',
          '外部变更需要重新审查。',
        ]),
      },
      {
        name: 'templates/release-note.md',
        language: 'markdown',
        content: [
          '# Release note 模板（合成数据）',
          '',
          '## 变更',
          '',
          '- <可验证的行为变化>',
          '',
          '## 回滚',
          '',
          '- <回滚步骤与影响面>',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'review-triage',
    type: 'Skills',
    name: 'review-triage',
    agent: 'Gemini CLI',
    scope: '项目',
    project: 'acme/desktop',
    description: '按风险对评审意见分级。',
    files: [
      {
        name: 'SKILL.md',
        language: 'markdown',
        content: skillDoc('review-triage', '把评审意见按风险分级并给出处置顺序', [
          '区分阻塞、建议、疑问三档。',
          '每条意见关联到具体文件与行。',
          '阻塞项必须给出修复路径。',
        ]),
      },
    ],
  },
  {
    id: 'test-scout',
    type: 'Skills',
    name: 'test-scout',
    agent: 'OpenCode',
    scope: '项目',
    project: 'acme/server',
    status: '冲突',
    description: '为改动定位最小验证集。',
    files: [
      {
        name: 'SKILL.md',
        language: 'markdown',
        content: skillDoc('test-scout', '为一次改动找出最小的验证命令集合', [
          '列出改动直接影响的模块。',
          '映射到已有的测试命令。',
          '标注无法自动验证的部分。',
        ]),
      },
      {
        name: 'mapping.example.json',
        language: 'json',
        content: hookConfig('mock-mapping', [
          'src/ui → npm run test:frontend',
          'src-tauri → npm run test:rust',
        ]),
      },
    ],
  },
  {
    id: 'doc-refresh',
    type: 'Skills',
    name: 'doc-refresh',
    agent: 'Claude Code',
    scope: '全局',
    project: '用户全局配置',
    status: '只读',
    description: '检查文档与实现是否一致。',
    files: [
      {
        name: 'SKILL.md',
        language: 'markdown',
        content: skillDoc('doc-refresh', '比对接口文档与实现，列出过时段落', [
          '提取文档中的命令与路径。',
          '逐条验证是否仍然存在。',
          '只报告差异，不自动改写。',
        ]),
      },
    ],
  },
  {
    id: 'i18n-scan',
    type: 'Skills',
    name: 'i18n-scan',
    agent: 'Codex',
    scope: '项目',
    project: 'acme/desktop',
    description: '扫描硬编码文案与遗漏翻译。',
    files: [
      {
        name: 'SKILL.md',
        language: 'markdown',
        content: skillDoc('i18n-scan', '找出界面中的硬编码文案', [
          '扫描 JSX 中的中文字符串。',
          '排除原型与测试目录。',
          '输出待翻译清单（示例）。',
        ]),
      },
    ],
  },
  {
    id: 'perf-baseline',
    type: 'Skills',
    name: 'perf-baseline',
    agent: 'Gemini CLI',
    scope: '全局',
    project: '用户全局配置',
    description: '记录关键路径的性能基线。',
    files: [
      {
        name: 'SKILL.md',
        language: 'markdown',
        content: skillDoc('perf-baseline', '记录并对比关键路径的性能基线', [
          '固定输入与环境。',
          '记录三次运行的中位数。',
          '超过阈值时要求人工复核。',
        ]),
      },
      {
        name: 'baseline.mock.bin',
        language: 'binary',
        content: '（二进制基线快照，原型占位：非文本内容，仅可只读查看）',
      },
    ],
  },
  // ---------- 长期指令 ----------
  {
    id: 'writing-style',
    type: '长期指令',
    name: 'writing-style',
    agent: 'Codex',
    scope: '全局',
    project: '用户全局配置',
    description: '中文技术协作写作风格。',
    files: [
      {
        name: 'instructions.md',
        language: 'markdown',
        content: instructionDoc('写作风格', [
          '使用简洁的中文陈述结论。',
          '必要时列出边界与下一步。',
          '避免空泛的鼓励性措辞。',
        ]),
      },
    ],
  },
  {
    id: 'code-conventions',
    type: '长期指令',
    name: 'code-conventions',
    agent: 'Claude Code',
    scope: '项目',
    project: 'acme/desktop',
    description: '仓库级代码约定摘要。',
    files: [
      {
        name: 'instructions.md',
        language: 'markdown',
        content: instructionDoc('代码约定', [
          '最小改动优先，不顺手重构。',
          '新代码跟随所在文件的风格。',
          '注释使用中文，解释“为什么”。',
        ]),
      },
      {
        name: 'snippets/error-handling.md',
        language: 'markdown',
        content: [
          '# 错误处理片段（合成数据）',
          '',
          '```ts',
          'if (result.ok === false) {',
          '  // 失败时保留现场，交给上层决定回滚',
          '  return { status: "failed", reason: result.reason };',
          '}',
          '```',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'security-baseline',
    type: '长期指令',
    name: 'security-baseline',
    agent: 'Gemini CLI',
    scope: '全局',
    project: '用户全局配置',
    status: '只读',
    description: '密钥与外发行为的底线规则。',
    files: [
      {
        name: 'instructions.md',
        language: 'markdown',
        content: [
          '# 安全基线（合成数据）',
          '',
          '- 示例占位：`MOCK_TOKEN = "demo-token-not-real"`',
          '- 示例占位：`API_SECRET 永不写入仓库`',
          '- 不读取、不复制真实凭据文件。',
          '- 外发请求前必须说明目的地与内容。',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'review-tone',
    type: '长期指令',
    name: 'review-tone',
    agent: 'OpenCode',
    scope: '项目',
    project: 'acme/server',
    status: '漂移',
    description: '评审措辞：直接、可执行。',
    files: [
      {
        name: 'instructions.md',
        language: 'markdown',
        content: instructionDoc('评审语气', [
          '指出问题即给出修复路径。',
          '区分“必须修改”与“可以考虑”。',
          '不使用模糊措辞如“似乎”“可能吧”。',
        ]),
      },
    ],
  },
  {
    id: 'branch-hygiene',
    type: '长期指令',
    name: 'branch-hygiene',
    agent: 'Codex',
    scope: '项目',
    project: 'acme/desktop',
    description: '分支与工作区的卫生规则。',
    files: [
      {
        name: 'instructions.md',
        language: 'markdown',
        content: instructionDoc('分支卫生', [
          '功能分支只包含一个主题。',
          '不在原型分支上提交生成物。',
          '合并前确认验证命令全部通过。',
        ]),
      },
    ],
  },
  {
    id: 'meeting-notes',
    type: '长期指令',
    name: 'meeting-notes',
    agent: 'Claude Code',
    scope: '全局',
    project: '用户全局配置',
    description: '会议纪要的结构化约定。',
    files: [
      {
        name: 'instructions.md',
        language: 'markdown',
        content: instructionDoc('会议纪要', [
          '决议、行动项、风险分节记录。',
          '行动项必须有负责人与时间。',
          '原始讨论细节折叠在附录。',
        ]),
      },
    ],
  },
  // ---------- Subagents ----------
  {
    id: 'qa-specialist',
    type: 'Subagents',
    name: 'qa-specialist',
    agent: 'Gemini CLI',
    scope: '项目',
    project: 'acme/desktop',
    status: '只读',
    description: '聚焦运行路径与用户可见回归。',
    files: [
      {
        name: 'agent.md',
        language: 'markdown',
        content: agentDoc('qa-specialist', [
          '运行聚焦验证并报告剩余风险。',
          '复现用户报告的路径。',
          '状态：当前 Agent 版本仅可只读浏览。',
        ]),
      },
    ],
  },
  {
    id: 'code-archaeologist',
    type: 'Subagents',
    name: 'code-archaeologist',
    agent: 'Claude Code',
    scope: '全局',
    project: '用户全局配置',
    description: '追溯历史变更的来龙去脉。',
    files: [
      {
        name: 'agent.md',
        language: 'markdown',
        content: agentDoc('code-archaeologist', [
          '阅读提交历史定位引入点。',
          '输出时间线与关键提交。',
          '不修改任何文件。',
        ]),
      },
      {
        name: 'prompts/timeline.md',
        language: 'markdown',
        content: [
          '# 时间线输出模板（合成数据）',
          '',
          '| 时间 | 提交 | 影响 |',
          '| --- | --- | --- |',
          '| 示例 | abc1234 | 引入回归 |',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'refactor-pilot',
    type: 'Subagents',
    name: 'refactor-pilot',
    agent: 'Codex',
    scope: '项目',
    project: 'acme/desktop',
    status: '不兼容',
    description: '大范围重命名的分步执行者。',
    files: [
      {
        name: 'agent.md',
        language: 'markdown',
        content: agentDoc('refactor-pilot', [
          '把大改动拆成可审查的小步。',
          '每步保持构建与测试通过。',
          '当前适配器版本不支持该角色所需能力。',
        ]),
      },
    ],
  },
  {
    id: 'docs-translator',
    type: 'Subagents',
    name: 'docs-translator',
    agent: 'OpenCode',
    scope: '项目',
    project: 'acme/server',
    description: '文档中英互译与术语统一。',
    files: [
      {
        name: 'agent.md',
        language: 'markdown',
        content: agentDoc('docs-translator', [
          '维护术语表并保持一致。',
          '只翻译文档，不触碰代码。',
          '保留原文的代码块不译。',
        ]),
      },
      {
        name: 'glossary.json',
        language: 'json',
        content: hookConfig('mock-glossary', [
          'workbench → 工作台',
          'gateway → 网关',
          'session → 会话',
        ]),
      },
    ],
  },
  {
    id: 'incident-scribe',
    type: 'Subagents',
    name: 'incident-scribe',
    agent: 'Gemini CLI',
    scope: '全局',
    project: '用户全局配置',
    status: '冲突',
    description: '事故复盘记录与行动项跟踪。',
    files: [
      {
        name: 'agent.md',
        language: 'markdown',
        content: agentDoc('incident-scribe', [
          '按时间线整理事故经过。',
          '区分事实与推测。',
          '输出可跟踪的行动项列表。',
        ]),
      },
    ],
  },
  {
    id: 'release-driver',
    type: 'Subagents',
    name: 'release-driver',
    agent: 'Claude Code',
    scope: '项目',
    project: 'acme/desktop',
    description: '推动发布流程的 checklist 执行。',
    files: [
      {
        name: 'agent.md',
        language: 'markdown',
        content: agentDoc('release-driver', [
          '逐项核对发布门禁。',
          '门禁失败时停止并汇报。',
          '不自行跳过任何检查。',
        ]),
      },
    ],
  },
  // ---------- Hooks ----------
  {
    id: 'preflight-hook',
    type: 'Hooks',
    name: 'preflight-hook',
    agent: 'OpenCode',
    scope: '项目',
    project: 'acme/desktop',
    status: '不兼容',
    description: '静态预检配置；不会由此工具执行。',
    files: [
      {
        name: 'hook.json',
        language: 'json',
        content: hookConfig('preflight', ['typecheck', 'lint', 'secret-scan']),
      },
    ],
  },
  {
    id: 'post-merge-hook',
    type: 'Hooks',
    name: 'post-merge-hook',
    agent: 'Claude Code',
    scope: '全局',
    project: '用户全局配置',
    description: '合并后提醒重建索引。',
    files: [
      {
        name: 'hook.json',
        language: 'json',
        content: hookConfig('post-merge', ['reindex', 'notify']),
      },
      {
        name: 'README.md',
        language: 'markdown',
        content: [
          '# post-merge-hook（合成数据）',
          '',
          '合并完成后触发静态提醒：',
          '',
          '1. 提示重建本地索引。',
          '2. 提示刷新打开的工作区。',
          '',
          '> 本工具只管理配置，不执行 hook。',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'session-start-hook',
    type: 'Hooks',
    name: 'session-start-hook',
    agent: 'Codex',
    scope: '项目',
    project: 'acme/server',
    status: '漂移',
    description: '会话开始时加载上下文提示。',
    files: [
      {
        name: 'hook.json',
        language: 'json',
        content: hookConfig('session-start', ['load-context', 'show-pending-tasks']),
      },
    ],
  },
  {
    id: 'pre-push-hook',
    type: 'Hooks',
    name: 'pre-push-hook',
    agent: 'Gemini CLI',
    scope: '项目',
    project: 'acme/desktop',
    description: '推送前的验证门禁配置。',
    files: [
      {
        name: 'hook.json',
        language: 'json',
        content: hookConfig('pre-push', ['test:frontend', 'test:rust', 'verify:static']),
      },
      {
        name: 'docs/gates.md',
        language: 'markdown',
        content: [
          '# 推送门禁说明（合成数据）',
          '',
          '- 任一检查失败即阻止推送。',
          '- 检查列表由团队维护。',
          '- 紧急跳过需要双人确认（示例）。',
        ].join('\n'),
      },
      {
        name: 'docs/exceptions.md',
        language: 'markdown',
        content:
          '# 例外流程（合成数据）\n\n- 文档-only 变更可申请跳过测试门禁。\n- 跳过记录写入审计日志（示例）。',
      },
    ],
  },
  {
    id: 'file-guard-hook',
    type: 'Hooks',
    name: 'file-guard-hook',
    agent: 'OpenCode',
    scope: '全局',
    project: '用户全局配置',
    status: '只读',
    description: '保护路径的只读守卫配置。',
    files: [
      {
        name: 'hook.json',
        language: 'json',
        content: hookConfig('file-guard', ['protect:src-tauri/keys', 'protect:fixtures/prod']),
      },
    ],
  },
  {
    id: 'notify-hook',
    type: 'Hooks',
    name: 'notify-hook',
    agent: 'Claude Code',
    scope: '项目',
    project: 'acme/server',
    description: '长任务完成后的提醒配置。',
    files: [
      {
        name: 'hook.json',
        language: 'json',
        content: hookConfig('notify', ['long-task-done', 'sound:off']),
      },
    ],
  },
];

export const mockRecoveryPoints: RecoveryPoint[] = [
  {
    id: 'rp-1',
    time: '2026-07-24 10:12',
    assetId: 'commit-guide',
    assetName: 'commit-message-guide',
    pinned: true,
  },
  {
    id: 'rp-2',
    time: '2026-07-25 16:40',
    assetId: 'writing-style',
    assetName: 'writing-style',
    pinned: false,
  },
  {
    id: 'rp-3',
    time: '2026-07-27 09:05',
    assetId: 'preflight-hook',
    assetName: 'preflight-hook',
    pinned: false,
  },
  {
    id: 'rp-4',
    time: '2026-07-28 21:33',
    assetId: 'qa-specialist',
    assetName: 'qa-specialist',
    pinned: false,
  },
];

export const assetTypeHint: Record<AssetType, string> = {
  Skills: '可复用的本地工作方法',
  长期指令: '跨会话持续生效的规则',
  Subagents: '可委派的专用角色',
  Hooks: '静态管理的自动化入口',
};

/** 全部可选的 Agent 适配器（合成） */
export const mockAgents = ['Claude Code', 'Codex', 'Gemini CLI', 'OpenCode'] as const;

/** 全部可选的状态筛选值 */
export const statusFilters = ['只读', '漂移', '冲突', '不兼容'] as const;

export function getAsset(id: string): MockAsset {
  return mockAssets.find((asset) => asset.id === id) ?? mockAssets[0];
}

export function assetsFor(type: AssetType, search: string): MockAsset[] {
  const normalized = search.trim().toLowerCase();
  return mockAssets.filter(
    (asset) =>
      asset.type === type &&
      (normalized.length === 0 ||
        `${asset.name} ${asset.agent} ${asset.project}`.toLowerCase().includes(normalized)),
  );
}

/** 在搜索基础上叠加范围 / 状态 / Agent 筛选 */
export function filterAssets(
  assets: MockAsset[],
  scopeFilter: '全部' | '全局' | '项目',
  filters: { status: string[]; agent: string[] },
): MockAsset[] {
  return assets.filter(
    (asset) =>
      (scopeFilter === '全部' || asset.scope === scopeFilter) &&
      (filters.status.length === 0 ||
        (asset.status !== undefined && filters.status.includes(asset.status))) &&
      (filters.agent.length === 0 || filters.agent.includes(asset.agent)),
  );
}
