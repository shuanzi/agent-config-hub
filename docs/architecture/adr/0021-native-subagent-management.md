# ADR-0021：Subagent 按 Agent 原生格式管理

状态：Accepted（用户于 2026-09-08 确认并要求实施）

## 决策

Subagent 不再复用 Skill 的跨 Agent Markdown 投影模型。每条定义属于一个 Agent、一个配置目标和一个明确来源位置。名称用于展示，不作为跨来源合并依据。

扫描原生配置只读；本地未接管定义直接展示。用户显式接管后，应用提供原生源码编辑、启停、备份、恢复、卸载和有仓库来源时的更新。保留未知字段，不做跨 Agent 格式、模型、工具或权限转换。

此决策取代 ADR-0020 中 Subagent 共用 Markdown/四 Agent 投影的部分，以及此前“项目 Codex Subagent 不支持”的限制；Skills 和长期指令契约不变。

## 原生机制

| Agent | 全局与项目目录 | 定义格式与身份 |
| --- | --- | --- |
| Claude Code | `~/.claude/agents/`、项目 `.claude/agents/`，递归读取 | Markdown + YAML frontmatter，以 `name` 标识 |
| Codex | `~/.codex/agents/`、项目 `.codex/agents/` | 独立 TOML，`name`、`description`、`developer_instructions` |
| Gemini CLI | `~/.gemini/agents/`、项目 `.gemini/agents/` | Markdown + Gemini frontmatter；功能开关独立诊断 |
| OpenCode | `~/.config/opencode/agents/`、项目 `.opencode/agents/`及原生配置 | Markdown 文件名或配置 `agent` 键；`subagent`/`all` 可作为子代理，未指定 `mode` 时按原生默认 `all` 处理 |

目录覆盖沿用应用设置；项目仅限已登记项目，不递归扫描整个磁盘。内置、会话临时和插件拥有的定义不自动纳入管理。应用报告的是文件配置状态，不宣称运行中的 Agent 已加载成功。

官方参考（核验日期 2026-09-08）：[Claude Code](https://code.claude.com/docs/en/sub-agents)、[Codex](https://developers.openai.com/codex/subagents)、[Gemini CLI](https://geminicli.com/docs/core/subagents/)、[OpenCode](https://opencode.ai/docs/agents/)。各家版本升级可能改变加载规则，应更新适配与测试，不通过跨格式复制做兼容。

## 数据与写入边界

- 新原生管理数据增量存储；旧记录和旧备份保留为待核对材料，不自动转换、删除或重新投放。
- 每次写入以明确身份和读取时摘要定位；外部修改、同名占位或来源失效均中止覆盖。
- 修改、停用、卸载前备份；恢复检查目标冲突。符号链接接管先展示实际目标并确认，不隐式写外部目标。
- 配置内定义只修改对应条目，不重写其他配置；文件型定义停用后位于 Agent 扫描目录外。
- 仓库安装按所选 Agent 校验原生格式；更新先展示源码差异并显式应用，不覆盖本地编辑。
- 所有写入通过 Rust service；测试使用隔离配置目录，真实配置仅作只读识别验证。

## 保守保护与用户出口

- 项目存在受管原生定义或原生备份时，阻止直接改绑/移除，避免绝对来源路径失效或备份失去项目归属。若确需解除，先按条目卸载，再在备份列表逐条二次确认删除原生备份；旧版备份不在此删除入口范围内。不会自动删除备份或搬迁外部配置。
- 文件本身是符号链接时，接管需要额外确认，以同内容独立副本替代链接；外部实际目标不变。配置目录内部的祖先目录为符号链接时，只读展示并拒绝接管/写入，避免修改外部目录。系统级 `/tmp`、`/var` 别名不应被当作此类风险。
- OpenCode 配置内定义的备份恢复只恢复该 `agent` 键，保留当前其他条目和配置文字；覆盖前备份当前版本。目标键被占用时必须匹配当前摘要。
- SQLite 目录与数据库在 Unix 下分别使用 `0700` / `0600`，避免备份包含的原生配置被扩大读取权限。源码写入与恢复保留原文件权限。
- 旧版 Subagent 写入命令不再执行四 Agent 投影；保留旧数据、只读兼容入口与备份索引。Skills 和长期指令仍沿用原有模型。
