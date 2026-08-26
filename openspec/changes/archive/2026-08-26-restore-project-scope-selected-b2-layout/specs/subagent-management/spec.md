## MODIFIED Requirements

### Requirement: Subagent 仓库管理与发现

系统 SHALL 维护 Subagent 来源仓库列表（与 Skill 仓库列表相互独立，结构相同：owner/name/branch/enabled），支持添加、查看、移除。发现逻辑 SHALL 复用 Skill 的 GitHub 归档下载与安全预算，扫描规则为：递归查找包含 YAML frontmatter（至少含 `name` 字段）的 `.md` 文件，每个文件认定为一个 Subagent，描述取自 frontmatter `description`，缺失时回退文件名。发现结果继续以 `{owner}/{repo}:{path}` 唯一标识；远端发现内容 SHALL NOT 因 global 或 project target 改变，但“已安装／未安装”状态 SHALL 只相对于一个完整 `ScopeTarget` 计算。global 和具体 project 上下文 SHALL 提供该 target，`all` 上下文 SHALL 在用户显式选择 global 或 `projectId` 后才显示该 target 的安装状态或允许安装。

#### Scenario: 发现仓库中的 subagents

- **WHEN** 用户在一个具体 project target 打开 Subagent 发现视图
- **THEN** 系统列出所有已启用仓库中符合规则的 Subagent，含名称、描述、来源与相对该 project target 的安装状态

#### Scenario: All 中先选择发现 target

- **WHEN** 用户在 `all` 上下文打开 Subagent 发现视图
- **THEN** 系统在显示安装状态或允许安装前要求选择 global 或一个已登记 `projectId`，不得将 global 已安装状态标为项目已安装

### Requirement: Subagent 安装、启停与卸载

系统 SHALL 将选中的 Subagent 安装到当前配置的 global Subagent SSOT root（默认 `~/.agent-config-manager/subagents/`），计算内容 hash 并持久化完整 ownership target。global target 继续使用该 root，并保持既有四个一等 Agent 的启用状态与按当前同步方式（auto/symlink/copy）到既有 global Agent Subagent 目录的投影（如 `~/.claude/agents/`，均可被目录 override 覆盖）。project target 使用同一 storage location 的独立 sibling `projects/{projectId}/subagents`（hub 为 `~/.agent-config-manager/projects/{projectId}/subagents/`，unified 为 `~/.agents/projects/{projectId}/subagents/`），且只允许为[路径矩阵](../../project-path-loading-matrix.md)中 Subagents 单元为 `Supported` 的 Agent 维护启用状态并投影到固定 resolver 返回的项目目录；`Unsupported` Agent 不提供可写入口，调用 SHALL 封闭失败。停用只移除同一 target 的投影。相同 target 内同名不同源 SHALL 拒绝，同名同源 SHALL 直接为当前 Agent 启用；不同 global／project target 之间的同名 Subagent SHALL 独立。项目 root 不可用或 resolver 未确认路径时，项目安装、启停和卸载 SHALL 失败且 SHALL NOT 修改 global SSOT 或 global Agent 投影。卸载 SHALL 只在完整 target 内清投影、备份、删除 SSOT 与记录。

Subagent 备份继续存于固定 `~/.agent-config-manager/subagent-backups/`，保留最近 20 份，并在 metadata 保存创建时的完整 ownership target。恢复 SHALL 只恢复到备份记录的原 target，不接受跨 global／project 或跨项目 retarget；项目 root 不可用或 resolver 未确认时恢复失败并保留备份。删除 project Subagent 备份 SHALL NOT 访问项目 root，使用户能在 root 不可用时先清理备份再移除项目。

#### Scenario: 安装并启用项目 Subagent

- **WHEN** 用户在一个完整 project target 安装某 Subagent 并打开 claude-code 开关
- **THEN** Subagent 进入该项目 storage sibling，并按当前同步方式只出现在 resolver 确定的项目 claude-code Subagent 目录

#### Scenario: Codex 项目 Subagent 不支持

- **WHEN** 用户尝试在一个 project target 为已安装 Subagent 打开 codex 开关
- **THEN** 调用返回 `Unsupported`，该 project target 既有 SSOT、投影和启用状态以及所有 global SSOT、投影和状态均不变

#### Scenario: 安装并启用

- **WHEN** 用户安装一个 global Subagent 并打开 codex 开关
- **THEN** 该 Subagent 按当前同步方式出现在 global codex 的 Subagent 目录下

#### Scenario: 同名不同源冲突

- **WHEN** 安装的 Subagent 名称被同一完整 target 中其他来源的已安装 Subagent 占用
- **THEN** 安装被拒绝，该 target 的 SSOT 与投影均不变

#### Scenario: 项目 root 不可用时删除备份

- **WHEN** project Subagent 的 root 已不可用，用户删除该项目的 Subagent 备份
- **THEN** 系统删除配置存储中的该备份而不访问项目 root，也不写入 global 目标

### Requirement: Subagent 更新检测

系统 SHALL 支持手动触发更新检查：按来源分组下载、hash 比对，并为每个完整 ownership target 产出可更新项。执行更新时 SHALL 先创建保存原 target 的备份，再替换同一 target 的 SSOT 内容、更新 hash，并只重投影该 target 的已启用 Agent。系统 SHALL NOT 在后台自动轮询更新。

#### Scenario: 项目更新可用

- **WHEN** project Subagent 的远端内容 hash 变化且用户执行更新
- **THEN** 该 project target 的 SSOT 与已启用投影更新，旧版本仅可恢复到同一 project target，global Subagent 不受影响

#### Scenario: 更新可用

- **WHEN** global Subagent 的远端内容 hash 变化且用户执行更新
- **THEN** global SSOT 内容更新，已启用 global Agent 的投影同步更新，旧版本可恢复到该 global target

## ADDED Requirements

### Requirement: Subagent 存储位置迁移

系统 SHALL 在 hub（`~/.agent-config-manager/subagents/`）与 unified（`~/.agents/subagents/`）之间迁移当前配置的 Subagent global SSOT root。迁移 SHALL 移动该 global SSOT root 与每个独立 sibling `projects/{projectId}/subagents` project SSOT、持久化新设置，并重建所有 global 与 project Agent 投影。固定 `~/.agent-config-manager/subagent-backups/` SHALL NOT 随 SSOT 迁移。任一项目 root 或 resolver 无法为受影响投影提供目标时，迁移 SHALL 失败并保持原设置与文件布局不变。

#### Scenario: 项目 SSOT sibling 随迁移移动

- **WHEN** 用户切换 Subagent 存储位置且全部项目 target 可解析
- **THEN** global Subagent SSOT root 与全部 project Subagent SSOT sibling 都迁移到新位置，固定备份目录保持不变，旧 SSOT 位置不再残留受管内容

### Requirement: Subagent 项目视图中的全局适用段

系统 SHALL 在项目 Subagent 列表中保留 project-owned 段，并且只在固定 resolver 对至少一个 Agent target 明确确认适用时显示 global Subagent 的全局适用段。显示在全局适用段的 Subagent SHALL 保持 global ownership，且系统 SHALL NOT 因查看项目上下文复制或重定向它。

#### Scenario: Global Subagent 未确认适用

- **WHEN** 一个 global Subagent 没有任何 Agent target 被 resolver 明确确认对当前项目适用
- **THEN** 该 Subagent 不显示在当前项目的全局适用段
