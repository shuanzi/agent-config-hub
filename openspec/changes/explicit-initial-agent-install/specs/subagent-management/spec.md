## MODIFIED Requirements

### Requirement: Subagent 安装、启停与卸载

系统 SHALL 将选中的 Subagent 安装到当前配置的 global Subagent SSOT root（默认 `~/.agent-config-manager/subagents/`），计算内容 hash 并持久化完整 ownership target。仓库发现安装 SHALL 接收完整 target 与必填 `initialApp`（Tauri/Rust 为 `initial_app`）；成功后仅该 Agent 初始启用。global target 继续使用该 root，并保持既有四个一等 Agent 的启用状态与按当前同步方式（auto/symlink/copy）到既有 global Agent Subagent 目录的投影（如 `~/.claude/agents/`，均可被目录 override 覆盖）。project target 使用同一 storage location 的独立 sibling `projects/{projectId}/subagents`（hub 为 `~/.agent-config-manager/projects/{projectId}/subagents/`，unified 为 `~/.agents/projects/{projectId}/subagents/`），且只允许为[路径矩阵](../../project-path-loading-matrix.md)中 Subagents 单元为 `Supported` 的 Agent 维护启用状态并投影到固定 resolver 返回的项目目录；`Unsupported` Agent 不提供可写入口，调用 SHALL 封闭失败。停用只移除同一 target 的投影。相同 target 内同名不同源 SHALL 拒绝，同名同源 SHALL 直接为本次 `initialApp` 启用；不同 global／project target 之间的同名 Subagent SHALL 独立。项目 root 不可用或 resolver 未确认路径时，项目安装、启停和卸载 SHALL 失败且 SHALL NOT 修改 global SSOT 或 global Agent 投影。卸载 SHALL 只在完整 target 内清投影、备份、删除 SSOT 与记录。

#### Scenario: 安装并启用项目 Subagent

- **WHEN** 用户在一个完整 project target 安装某 Subagent，并显式选择 `claude-code` 作为 `initialApp`
- **THEN** Subagent 进入该项目 storage sibling，并按当前同步方式只出现在 resolver 确定的项目 claude-code Subagent 目录

#### Scenario: 缺少初始 Agent

- **WHEN** Subagent 仓库安装请求没有有效的 `initialApp`
- **THEN** 操作被拒绝，且该 target 的 SSOT、数据库记录和 Agent 投影均保持不变

#### Scenario: 同源重复安装选择初始 Agent

- **WHEN** 用户在同一完整 target 重新安装同一来源、同名的 Subagent，并显式选择 `codex` 作为 `initialApp`
- **THEN** 系统复用既有 SSOT 与记录，仅将本次选择的 Agent 启用，不创建重复目录或跨 target 投影

#### Scenario: Codex 项目 Subagent 不支持

- **WHEN** 用户尝试在一个 project target 为已安装 Subagent 打开 codex 开关
- **THEN** 调用返回 `Unsupported`，该 project target 既有 SSOT、投影和启用状态以及所有 global SSOT、投影和状态均不变

#### Scenario: 安装并启用

- **WHEN** 用户安装一个 global Subagent，并显式选择 `codex` 作为 `initialApp`
- **THEN** 该 Subagent 按当前同步方式出现在 global codex 的 Subagent 目录下

#### Scenario: 同名不同源冲突

- **WHEN** 安装的 Subagent 名称被同一完整 target 中其他来源的已安装 Subagent 占用
- **THEN** 安装被拒绝，该 target 的 SSOT 与投影均不变

#### Scenario: 项目 root 不可用时删除备份

- **WHEN** project Subagent 的 root 已不可用，用户删除该项目的 Subagent 备份
- **THEN** 系统删除配置存储中的该备份而不访问项目 root，也不写入 global 目标
