# 项目路径与加载语义矩阵（task 1.1）

> 冻结日期：2026-08-25
> 适用范围：`restore-project-scope-selected-b2-layout` 的实施前路径事实。它只定义固定 per-Agent resolver 的输入、项目目标和全局适用性边界；不实现 resolver、数据库、命令或 UI。

## 判定口径

- `Supported`：官方文档给出项目／全局位置与加载语义，且当前仓库的该类资产格式可原生保留、无需跨 Agent 转换。
- `Unsupported`：本 change 不会写入该单元；调用必须封闭失败，前端不提供可写入口。
- `Unavailable`：已登记的项目 root 不存在、不可访问或不是目录时的运行时结果，不是新的路径猜测。
- 本文的“全局适用”只表示该 Agent 官方会在项目会话加载用户级来源；同名冲突、遮蔽或合并仍按该单元的固定规则展示，不能复制出项目副本。

## Skills／Subagents 4×2 与长期指令 2×2 摘要

| Agent         | Skills（项目 canonical）                         | 长期指令产品边界 | Subagents（项目 canonical）                         |
| ------------- | ------------------------------------------------ | ---------------- | --------------------------------------------------- |
| `claude-code` | `.claude/skills/<name>/SKILL.md` · `Supported`   | `CLAUDE.md`      | `.claude/agents/<name>.md` · `Supported`            |
| `codex`       | `.agents/skills/<name>/SKILL.md` · `Supported`   | 共享 `AGENTS.md` | `Unsupported`（官方为 `.codex/agents/<name>.toml`） |
| `gemini-cli`  | `.gemini/skills/<name>/SKILL.md` · `Supported`   | `Unsupported`    | `.gemini/agents/<name>.md` · `Supported`            |
| `opencode`    | `.opencode/skills/<name>/SKILL.md` · `Supported` | 共享 `AGENTS.md` | `.opencode/agents/<name>.md` · `Supported`          |

Skills／Subagents 保持原 11 个 `Supported`、1 个 `Unsupported` 的路径事实；长期指令不再按四 Agent 的 4×1 建模，下列 2×2 是唯一可依赖的产品矩阵。

## 长期指令 2×2 固定文档矩阵

| 文档        | global canonical（可被既有 override 重定向）                          | project canonical          | 适用 Agent          | 状态        |
| ----------- | --------------------------------------------------------------------- | -------------------------- | ------------------- | ----------- |
| `CLAUDE.md` | `~/.claude/CLAUDE.md`                                                 | `<project-root>/CLAUDE.md` | `claude-code`       | `Supported` |
| `AGENTS.md` | 同一内容投影至 `~/.codex/AGENTS.md` 与 `~/.config/opencode/AGENTS.md` | `<project-root>/AGENTS.md` | `codex`、`opencode` | `Supported` |

- 每个 global 或 project target 固定返回两项；文件不存在返回未创建状态，不创建 preset、enable、toggle、import 或删除文件主流程。
- global `AGENTS.md` 两投影都存在且内容不同，读取、保存和相关 override 搬迁均返回 `INSTRUCTION_PROJECTIONS_DIVERGED` 并零写入；仅一侧存在可读取，保存时再次检查并双投影。
- Gemini CLI 长期指令明确 `Unsupported`：本 change 不读取、写入或显示 `GEMINI.md`，也不修改 Gemini 的加载配置。

## `claude-code`

来源：[Skills][claude-skills]、[Memory][claude-memory]、[Subagents][claude-subagents]；当前全局目录映射见[仓库配置][repo-config]。

| 资产 | 项目 canonical / 全局位置 | 格式 | 加载、优先级与全局适用 | 状态与实施边界 |
| --- | --- | --- | --- |
| Skills | `.claude/skills/<name>/SKILL.md` / `~/.claude/skills/<name>/SKILL.md` | `SKILL.md`，YAML frontmatter + Markdown | 用户级可用于所有项目；同名时 personal > project。 | `Supported`；显示 personal 遮蔽状态，不复制。 |
| 长期指令 | `CLAUDE.md` / `~/.claude/CLAUDE.md` | 单一 Markdown 文件 | 用户级与目录层级 `CLAUDE.md` 串联加载；官方也支持 `.claude/CLAUDE.md` 和 local 文件。 | `Supported`；本产品的固定 `CLAUDE.md` 文档只适用于 Claude Code。 |
| Subagents | `.claude/agents/<name>.md` / `~/.claude/agents/<name>.md` | Markdown + YAML frontmatter | 用户级可用于所有项目；同名时 project > user。 | `Supported`；先做 Claude 原生 frontmatter 校验，保留未知字段。 |

## `codex`

来源：[Skills][codex-skills]、[Skills loader source][codex-skill-loader]、[AGENTS.md][codex-instructions]、[Subagents][codex-subagents]；当前仓库将 Skills／Subagents／长期指令分别按全局目录或文件投影，见[配置][repo-config]、[Skills service][repo-skill]、[Instruction service][repo-instruction]和[Subagent service][repo-subagent]。

| 资产 | 项目 canonical / 全局位置 | 格式 | 加载、优先级与全局适用 | 状态与实施边界 |
| --- | --- | --- | --- |
| Skills | `.agents/skills/<name>/SKILL.md` / `~/.agents/skills/<name>/SKILL.md`；兼容旧来源 `$CODEX_HOME/skills/<name>/SKILL.md`（默认 `~/.codex/skills`） | `SKILL.md`，YAML frontmatter + Markdown | 用户级来源可用于项目；同名来源不合并，可能同时出现。 | `Supported`；task 1.1 不迁移既有 global target：当前 v0.3 `$CODEX_HOME/skills` global projection 继续作为兼容路径；只有项目新写入使用 `.agents/skills`，禁止复制。 |
| 长期指令 | `AGENTS.md` / `~/.codex/AGENTS.md` | 单一 Markdown 文件 | 全局、项目 root 到 cwd 依次串联；同一目录的 `AGENTS.override.md` 优先。 | `Supported`；它与 OpenCode 共享本产品的同一 `AGENTS.md` 逻辑文档，global 保存双投影、项目保存单一根文件。 |
| Subagents | 官方为 `.codex/agents/<name>.toml` / `~/.codex/agents/<name>.toml` | TOML；必需 `name`、`description`、`developer_instructions` | 官方支持项目／用户级 custom agent，但其格式与当前模型不同。 | `Unsupported`；当前 SSOT、发现与投影是带 YAML frontmatter 的单个 `.md`，且本 change 禁止转换／跨 Agent 适配，必须封闭失败。 |

## `gemini-cli`

来源：[Skills][gemini-skills]、[GEMINI.md][gemini-instructions]、[Subagents][gemini-subagents]；当前全局目录映射见[仓库配置][repo-config]。

| 资产 | 项目 canonical / 全局位置 | 格式 | 加载、优先级与全局适用 | 状态与实施边界 |
| --- | --- | --- | --- |
| Skills | `.gemini/skills/<name>/SKILL.md` / `~/.gemini/skills/<name>/SKILL.md` | `SKILL.md`，YAML frontmatter + Markdown | workspace > user；同层兼容别名 `.agents/skills` > `.gemini/skills`。用户级适用于所有项目；项目／workspace Skills 受目录 trust 前提。 | `Supported`；`.agents/skills` 仅作为兼容发现路径，更新／删除留在原位置。 |
| 长期指令 | `GEMINI.md` / `~/.gemini/GEMINI.md` | 单一 Markdown 文件，可含 `@` import | 用户级、root、父目录和按需嵌套 `GEMINI.md` 串联加载。 | `Unsupported`；本产品仅管理 `CLAUDE.md` 与 `AGENTS.md`，不读取、写入或显示 Gemini CLI 长期指令。 |
| Subagents | `.gemini/agents/<name>.md` / `~/.gemini/agents/<name>.md` | Markdown + YAML frontmatter，body 为 system prompt | 用户级可用于项目；官方资料未足以冻结同名 project/user 的唯一优先级。 | `Supported`；同名显示冲突，不猜测覆盖顺序；保留未知 frontmatter。 |

## `opencode`

来源：[Skills][opencode-skills]、[Instructions][opencode-instructions]、[Agents][opencode-agents]。这些是 OpenCode **V2 beta** 文档，实施前 L3 必须对实际版本重新做加载 smoke。

| 资产 | 项目 canonical / 全局位置 | 格式 | 加载、优先级与全局适用 | 状态与实施边界 |
| --- | --- | --- | --- |
| Skills | `.opencode/skills/<name>/SKILL.md` / `$XDG_CONFIG_HOME/opencode/skills/<name>/SKILL.md`（通常 `~/.config/opencode/...`） | `SKILL.md`，YAML frontmatter + Markdown | 项目来源可覆盖 global；官方兼容 `.agents/skills`、`.claude/skills` 来源。 | `Supported`；兼容来源留在原位置，不能复制或改名。 |
| 长期指令 | `AGENTS.md` / `$XDG_CONFIG_HOME/opencode/AGENTS.md`（通常 `~/.config/opencode/AGENTS.md`） | 单一 Markdown 文件 | global 文件另行合并；Location 位于 home 内时从当前 Location 向上扫描并包含 home，Location 在 home 外时扫描停在 project root。 | `Supported`；它与 Codex 共享本产品的同一 `AGENTS.md` 逻辑文档，global 保存双投影、项目保存单一根文件。 |
| Subagents | `.opencode/agents/<name>.md` / `$XDG_CONFIG_HOME/opencode/agents/<name>.md`（通常 `~/.config/opencode/...`） | Markdown + YAML frontmatter，body 为 system instructions | 同 ID 时项目来源后加载，可覆盖 global。 | `Supported`；原生校验要求 `mode: subagent` 或 `mode: all`，并保留未知 frontmatter。 |

## Resolver 冻结规则

1. 已登记的 project root 是 resolver 的唯一路径输入；前端不得提供任意 root path。
2. 登记项目只提供 resolver 输入，不会使 Agent 自动加载文件；项目 canonical 只有 Agent 会话的 location/cwd 位于登记 root 内，或该 Agent 官方明确支持额外目录机制时才可生效。
3. 新建项目资产只写入上表 canonical 项目路径。发现到官方兼容别名时，更新／删除仅在原位置进行，绝不复制到 canonical 或另一 Agent 路径。
4. root 缺失、不可访问或不是目录时返回 `Unavailable`；不得读缓存、静默回退到 global 或创建猜测路径。
5. `Unsupported` 是封闭失败：不得落盘、投影、转换或显示可写入口。Codex Subagents 因此不参与本 change 的项目写入。
6. 同名冲突、遮蔽和合并只显示为状态；不得隐式复制、统一为一套优先级，或从 global 生成项目副本。
7. Skills／Subagents 的每个 `{AgentType, AssetKind}` 保持独立固定规则；长期指令仅允许 `CLAUDE.md`／`AGENTS.md` 的 2×2 固定路径，不得新增动态 Adapter、通用资产抽象、Gemini 映射或跨 Agent 转换层。
8. 项目 Subagent 在写入前必须通过该 Agent 的原生兼容校验，并逐字保留未知 frontmatter 与正文；这不授权重写已有兼容资产。

## 复核边界

- 本矩阵冻结的是 2026-08-25 已核对的公开资料与当前仓库事实，不声称已经完成真实项目加载。
- OpenCode V2 beta、上游路径／优先级／格式文档发生版本漂移，或 L3 真实加载与本文冲突时，必须先复核本矩阵再实施或扩大 `Supported`；不能由运行失败反推新路径。
- 任务 1.2 及之后的数据库、resolver、命令、测试和 UI 工作不在 task 1.1 范围内。

## 证据链接

[claude-skills]: https://code.claude.com/docs/en/slash-commands
[claude-memory]: https://code.claude.com/docs/en/memory
[claude-subagents]: https://code.claude.com/docs/en/sub-agents
[codex-skills]: https://developers.openai.com/codex/build-skills
[codex-skill-loader]: https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs
[codex-instructions]: https://developers.openai.com/codex/guides/agents-md
[codex-subagents]: https://developers.openai.com/codex/agent-configuration/subagents
[gemini-skills]: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md
[gemini-instructions]: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md
[gemini-subagents]: https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md
[opencode-skills]: https://opencode.ai/v2/docs/skills
[opencode-instructions]: https://opencode.ai/v2/docs/instructions
[opencode-agents]: https://opencode.ai/v2/docs/agents
[repo-config]: ../../../src-tauri/src/config.rs
[repo-skill]: ../../../src-tauri/src/services/skill.rs
[repo-instruction]: ../../../src-tauri/src/services/instruction.rs
[repo-subagent]: ../../../src-tauri/src/services/subagent.rs
