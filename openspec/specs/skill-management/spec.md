# skill-management Specification

## Purpose

Skill 的全生命周期管理：从 GitHub 仓库发现 skill，集中安装到单一事实源（SSOT）目录，并按用户开关以 symlink 或 copy 方式投影到各 Agent 的技能目录，支持更新检测、备份恢复、导入与存储迁移。

## Requirements

### Requirement: Skill 仓库管理

系统 SHALL 维护一个 skill 来源仓库列表（owner/name/branch/enabled，持久化于本地数据库），支持通过粘贴 GitHub URL 添加（解析为 owner/name，默认分支 main）、列表查看（含每个仓库发现的 skill 数量）与移除。首次启动且列表为空时 SHALL 播种默认仓库集合（至少包含 `anthropics/skills`）。非法仓库坐标 SHALL 被拒绝并返回结构化错误。

#### Scenario: 添加仓库

- **WHEN** 用户粘贴 `https://github.com/owner/repo` 形式的 URL 并确认添加
- **THEN** 仓库以 `main` 为默认分支入库，并出现在仓库列表中

#### Scenario: 非法坐标

- **WHEN** 用户提交包含路径穿越字符或非法字符的 owner/name/branch
- **THEN** 操作被拒绝，返回带 `code`/`context`/`suggestion` 的结构化错误

### Requirement: Skill 发现

系统 SHALL 按需下载已启用仓库的 GitHub 归档（`.../archive/refs/heads/{branch}.zip`，配置分支失败时依次回退 main、master），递归扫描解压结果，遇包含 `SKILL.md` 的目录即认定为一个 skill 并停止下钻；skill 名称与描述取自 `SKILL.md` 的 YAML frontmatter，缺失时回退为目录名。发现结果中每个 skill 以 `{owner}/{repo}:{directory}` 唯一标识，并标记"已安装/未安装"状态。下载与解压 SHALL 强制安全预算（压缩包大小上限、条目数上限、解压字节上限、拒绝绝对路径与 `..` 路径、符号链接物化为实体副本）。

#### Scenario: 发现仓库中的 skills

- **WHEN** 用户打开 skill 发现视图或点击刷新
- **THEN** 系统列出所有已启用仓库中的 skill，含名称、描述、来源仓库徽章与安装状态

#### Scenario: 恶意归档防护

- **WHEN** 下载的归档包含路径穿越条目或超过大小预算
- **THEN** 该仓库发现失败并返回结构化错误，不写入任何文件

### Requirement: Skill 安装与冲突处理

系统 SHALL 将选中的 skill 安装到 SSOT 目录（默认 `~/.agent-config-manager/skills/{install-name}`），install-name 经消毒为单段目录名；安装后计算内容 SHA-256 hash 并持久化记录（含 repo 坐标与各 Agent 启用状态）。同一 install-name 已存在时：若来源仓库相同，SHALL 视为重复安装并直接为当前 Agent 启用；若来源不同，SHALL 拒绝并返回 `SKILL_DIRECTORY_CONFLICT` 错误。首个投影写入失败时 SHALL 回滚数据库记录。

#### Scenario: 正常安装

- **WHEN** 用户对未安装的 skill 点击安装
- **THEN** skill 被复制进 SSOT 目录、记录入库、并对当前 Agent 投影生效

#### Scenario: 同名不同源冲突

- **WHEN** 用户安装的 skill 的 install-name 已被来自其他仓库的 skill 占用
- **THEN** 安装被拒绝并返回目录冲突错误，SSOT 与投影均不变

### Requirement: per-Agent 启停与投影同步

系统 SHALL 为每个已安装 skill 维护四个一等 Agent（claude-code / codex / gemini-cli / opencode）各自的启用状态。启用 SHALL 将 SSOT 目录投影到对应 Agent 的技能目录（`~/.claude/skills`、`~/.codex/skills`、`~/.gemini/skills`、`~/.config/opencode/skills`，均可被目录 override 设置覆盖）；停用 SHALL 移除该投影。投影方式由同步方式设置决定：`symlink` 强制符号链接、`copy` 强制实体复制（临时目录 + 原子替换）、`auto` 优先符号链接失败时回退复制；投影目标已是实体目录时 SHALL 以复制方式替换。

#### Scenario: 启用某 Agent

- **WHEN** 用户在某 skill 的 Agent 开关组中打开 claude-code 开关
- **THEN** 该 skill 按当前同步方式出现在 `~/.claude/skills/` 下，数据库状态同步更新

#### Scenario: 停用某 Agent

- **WHEN** 用户关闭该开关
- **THEN** 对应 Agent 技能目录中的投影被移除，SSOT 目录不受影响

### Requirement: 更新检测与更新

系统 SHALL 支持手动触发"检查更新"：按 `(owner, name, branch)` 分组下载来源仓库、重算远端内容 hash 并与本地记录比对，产出可更新列表；SSOT 目录缺失时 SHALL 视为可更新。执行更新时 SHALL 先创建备份，再替换 SSOT 内容、更新元数据与 hash，并重投影到所有已启用 Agent。系统 SHALL NOT 在后台自动轮询更新。

#### Scenario: 检测到更新并更新

- **WHEN** 远端仓库内容 hash 与本地记录不同，用户点击更新
- **THEN** 系统备份旧版本、替换 SSOT、重投影已启用 Agent，并刷新记录

### Requirement: 卸载、备份与恢复

卸载 SHALL 依次：移除所有 Agent 投影 → 创建备份到 `~/.agent-config-manager/skill-backups/`（保留最近 20 份）→ 删除 SSOT 目录 → 删除数据库记录。系统 SHALL 支持列出备份、从备份恢复（恢复后按记录重新投影）、删除备份。

#### Scenario: 卸载后可恢复

- **WHEN** 用户卸载某 skill 后从备份列表执行恢复
- **THEN** skill 内容回到 SSOT 与数据库，并重新投影到卸载前启用的 Agent

### Requirement: 未接管扫描与导入

系统 SHALL 支持扫描各 Agent 技能目录与统一目录中存在但未被数据库管理的 skill 目录（含 `SKILL.md`），并支持将选中项复制进 SSOT 纳入管理（标记为 `local:{directory}` 身份或尽可能恢复 repo 信息）。系统 SHALL 支持从本地 ZIP 文件安装 skill。

#### Scenario: 导入已有 skill

- **WHEN** 用户触发扫描并选择导入一个存在于 `~/.claude/skills/` 但未被管理的 skill
- **THEN** 该 skill 被复制进 SSOT 并入库，后续按统一流程管理

### Requirement: 存储位置迁移

系统 SHALL 支持将 SSOT 位置在 hub 目录（`~/.agent-config-manager/skills/`）与统一目录（`~/.agents/skills/`）之间切换：切换时移动全部已安装 skill、持久化新设置、并重建所有 Agent 投影。新位置与各 Agent 技能目录别名冲突时 SHALL 拒绝迁移。

#### Scenario: 切换到统一目录

- **WHEN** 用户在设置中将存储位置切换为统一目录
- **THEN** 全部 skill 文件迁移完成，各 Agent 投影指向新位置，旧位置不再残留受管内容

### Requirement: 结构化错误

skill 相关操作的失败 SHALL 以 `{code, context, suggestion}` 结构返回，前端 SHALL 将错误码映射为用户可读的说明与操作建议。

#### Scenario: 下载超时

- **WHEN** 仓库下载超时
- **THEN** 前端呈现"下载超时"的说明与重试建议，而非原始异常文本
