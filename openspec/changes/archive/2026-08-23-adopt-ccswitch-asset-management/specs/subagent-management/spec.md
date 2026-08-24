## Purpose

Subagent 定义文件的全生命周期管理：从 GitHub 仓库发现 subagent（带 frontmatter 的 Markdown 文件），集中安装到 SSOT 目录，并按用户开关以 symlink 或 copy 方式投影到各 Agent 的 subagent 目录。

## ADDED Requirements

### Requirement: Subagent 仓库管理与发现

系统 SHALL 维护 subagent 来源仓库列表（与 skill 仓库列表相互独立，结构相同：owner/name/branch/enabled），支持添加、查看、移除。发现逻辑 SHALL 复用 skill 的 GitHub 归档下载与安全预算，扫描规则为：递归查找包含 YAML frontmatter（至少含 `name` 字段）的 `.md` 文件，每个文件认定为一个 subagent，描述取自 frontmatter `description`，缺失时回退文件名。发现结果以 `{owner}/{repo}:{path}` 唯一标识并标记安装状态。

#### Scenario: 发现仓库中的 subagents

- **WHEN** 用户打开 subagent 发现视图
- **THEN** 系统列出所有已启用仓库中符合规则的 subagent，含名称、描述、来源与安装状态

### Requirement: Subagent 安装、启停与卸载

系统 SHALL 将选中的 subagent 安装到 SSOT 目录（默认 `~/.agent-config-manager/subagents/`），计算内容 hash 并持久化记录；同名不同源 SHALL 拒绝（目录冲突错误），同名同源 SHALL 直接为当前 Agent 启用。每个已安装 subagent SHALL 维护四个一等 Agent 各自的启用状态，启用即按当前同步方式（auto/symlink/copy）投影到对应 Agent 的 subagent 目录（如 `~/.claude/agents/`，均可被目录 override 覆盖），停用即移除投影。卸载 SHALL 先清投影、再备份、再删 SSOT 与记录。

#### Scenario: 安装并启用

- **WHEN** 用户安装某 subagent 并打开 codex 开关
- **THEN** 该 subagent 按当前同步方式出现在 codex 的 subagent 目录下

#### Scenario: 同名不同源冲突

- **WHEN** 安装的 subagent 名称被其他来源的已安装 subagent 占用
- **THEN** 安装被拒绝，SSOT 与投影不变

### Requirement: Subagent 更新检测

系统 SHALL 支持手动触发更新检查（按来源分组下载、hash 比对），并对可更新项执行更新：先备份、再替换 SSOT、重投影已启用 Agent。

#### Scenario: 更新可用

- **WHEN** 远端内容 hash 变化且用户执行更新
- **THEN** SSOT 内容更新，已启用 Agent 的投影同步更新，旧版本可恢复
