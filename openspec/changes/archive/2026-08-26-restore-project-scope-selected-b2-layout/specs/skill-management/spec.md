## MODIFIED Requirements

### Requirement: Skill 发现

系统 SHALL 按需下载已启用仓库的 GitHub 归档（`.../archive/refs/heads/{branch}.zip`，配置分支失败时依次回退 main、master），递归扫描解压结果，遇包含 `SKILL.md` 的目录即认定为一个 Skill 并停止下钻；Skill 名称与描述取自 `SKILL.md` 的 YAML frontmatter，缺失时回退为目录名。发现结果中每个 Skill 继续以 `{owner}/{repo}:{directory}` 唯一标识，远端发现内容 SHALL NOT 因 global 或 project target 改变；“已安装／未安装”状态 SHALL 只相对于一个完整 `ScopeTarget` 计算。global 和具体 project 上下文 SHALL 提供该 target，`all` 上下文 SHALL 在用户显式选择 global 或 `projectId` 后才显示该 target 的安装状态或允许安装。下载与解压 SHALL 继续强制现有安全预算（压缩包大小上限、条目数上限、解压字节上限、拒绝绝对路径与 `..` 路径、符号链接物化为实体副本）。

#### Scenario: 发现仓库中的 skills

- **WHEN** 用户在一个具体 global target 打开 Skill 发现视图或点击刷新
- **THEN** 系统列出所有已启用仓库中的 Skill，含名称、描述、来源仓库徽章与相对该 global target 的安装状态

#### Scenario: All 中先选择发现 target

- **WHEN** 用户在 `all` 上下文打开 Skill 发现视图
- **THEN** 系统在显示安装状态或允许安装前要求选择 global 或一个已登记 `projectId`，不得将 global 已安装状态标为项目已安装

#### Scenario: 恶意归档防护

- **WHEN** 下载的归档包含路径穿越条目或超过大小预算
- **THEN** 该仓库发现失败并返回结构化错误，不写入任何文件

### Requirement: Skill 安装与冲突处理

系统 SHALL 将选中的 Skill 安装到当前配置的 global Skill SSOT root（默认 `~/.agent-config-manager/skills/`）。global target 继续使用该 root；project target 使用同一 storage location 的独立 sibling `projects/{projectId}/skills`（hub 为 `~/.agent-config-manager/projects/{projectId}/skills/`，unified 为 `~/.agents/projects/{projectId}/skills/`），`install-name` 仍须消毒为单段目录名。安装后 SHALL 计算内容 SHA-256 hash 并持久化记录（含 repo 坐标、完整 ownership target 和各 Agent 启用状态）。安装、重复安装与冲突判断 SHALL 接收完整 target：同一 target 内，同一 install-name 且来源相同 SHALL 视为重复安装并直接为当前 Agent 启用；同一 target 内来源不同 SHALL 返回 `SKILL_DIRECTORY_CONFLICT`；不同 global／project target 之间 SHALL 独立且允许同名。首个投影写入失败时，系统 SHALL 将该 target 的记录和 SSOT 内容恢复到操作前状态。

#### Scenario: 正常安装

- **WHEN** 用户以一个完整 project target 安装未受管的 Skill
- **THEN** Skill 被复制进该项目 storage sibling、记录入库并保存 SHA-256 hash，且只向 resolver 确定的项目 Agent 目录投影

#### Scenario: 同名不同源冲突

- **WHEN** 用户在同一完整 target 安装的 Skill 的 install-name 已被来自其他仓库的 Skill 占用
- **THEN** 安装被拒绝并返回目录冲突错误，该 target 的 SSOT 与投影均不变

#### Scenario: 同名 global 与项目 Skill

- **WHEN** 一个名为 `review` 的 global Skill 已受管，用户在另一个完整 project target 安装同名 Skill
- **THEN** 两项 Skill 保持独立身份，项目操作只影响该项目 resolver 确定的目标位置

### Requirement: per-Agent 启停与投影同步

系统 SHALL 为每个已安装 Skill 在其完整 ownership target 内维护四个一等 Agent（claude-code / codex / gemini-cli / opencode）的启用状态。启用 global target SHALL 将 global SSOT 投影到既有的 global Agent 技能目录（`~/.claude/skills`、`~/.codex/skills`、`~/.gemini/skills`、`~/.config/opencode/skills`，均可被目录 override 覆盖）；启用 project target SHALL 仅将该 target 的 SSOT 投影到固定 resolver 返回的项目目录。停用 SHALL 只移除同一 target 的投影。投影方式继续由同步方式设置决定：`symlink` 强制符号链接、`copy` 强制实体复制（临时目录 + 原子替换）、`auto` 优先符号链接失败时回退复制；投影目标已是实体目录时 SHALL 以复制方式替换。项目 root 不可用或 resolver 未确认路径时，项目操作 SHALL 失败且 SHALL NOT 修改 global 投影。

#### Scenario: 启用某 Agent

- **WHEN** 用户在 project Skill 的 Agent 开关组中打开 claude-code 开关
- **THEN** 该 Skill 按当前同步方式出现在 resolver 确定的项目 claude-code 技能目录，数据库只更新该 project target 状态

#### Scenario: 停用某 Agent

- **WHEN** 用户关闭一个 project Skill 的 codex 开关
- **THEN** 对应项目 codex 目录中的投影被移除，该项目 SSOT 保留，global codex 投影不受影响

### Requirement: 更新检测与更新

系统 SHALL 支持手动触发“检查更新”：按 `(owner, name, branch)` 分组下载来源仓库、重算远端内容 hash 并与每个完整 target 的本地记录比对，产出可更新列表；该 target 的 SSOT 目录缺失时 SHALL 视为可更新。执行更新时 SHALL 先创建保存原 ownership target 的备份，再替换同一 target 的 SSOT 内容、更新元数据与 hash，并只重投影同一 target 内已启用 Agent。系统 SHALL NOT 在后台自动轮询更新。

#### Scenario: 检测到项目更新并更新

- **WHEN** project Skill 的远端内容 hash 与其本地记录不同，用户执行更新
- **THEN** 系统备份该 project target 的旧版本、替换其 SSOT、重投影其已启用 Agent，并不修改同名 global Skill

#### Scenario: 检测到更新并更新

- **WHEN** global Skill 的远端内容 hash 与其本地记录不同，用户点击更新
- **THEN** 系统备份旧版本、替换 global SSOT、重投影已启用 global Agent，并刷新该 global target 记录

### Requirement: 卸载、备份与恢复

卸载 SHALL 在完整 ownership target 内依次移除所有 Agent 投影、创建备份、删除该 target 的 SSOT 内容并删除对应数据库记录。Skill 备份继续存于固定 `~/.agent-config-manager/skill-backups/`，保留最近 20 份，并在 metadata 保存创建时的完整 ownership target；系统 SHALL 支持列出、恢复和删除备份。恢复 SHALL 只恢复到备份记录中的原 target，不接受跨 global／project 或跨项目的 retarget；恢复该 project target 时 root 不可用或 resolver 未确认 SHALL 失败并保留备份。删除 project Skill 备份 SHALL NOT 访问项目 root，使项目 root 不可用时仍可先清理备份再移除项目。

#### Scenario: 项目卸载后恢复

- **WHEN** 用户卸载一个 project Skill 后从备份列表执行恢复
- **THEN** Skill 内容、数据库记录和启用状态只恢复到备份记录的原 `projectId` target，并重新投影到该项目的原启用 Agent

#### Scenario: 项目 root 不可用时删除备份

- **WHEN** project Skill 的 root 已不可用，用户删除该项目的 Skill 备份
- **THEN** 系统删除配置存储中的该备份而不访问项目 root，也不写入 global 目标

#### Scenario: 卸载后可恢复

- **WHEN** 用户卸载某 global Skill 后从备份列表执行恢复
- **THEN** Skill 内容回到 global SSOT 与数据库，并重新投影到卸载前启用的 global Agent

### Requirement: 存储位置迁移

系统 SHALL 支持将当前配置的 Skill global SSOT root 在 hub（`~/.agent-config-manager/skills/`）与 unified（`~/.agents/skills/`）之间切换。迁移 SHALL 移动 global SSOT root 与每个 `projects/{projectId}/skills` project SSOT sibling、持久化新设置，并重建所有 global 与 project Agent 投影。固定 `~/.agent-config-manager/skill-backups/` SHALL NOT 随 SSOT 迁移。任一项目 root 或 resolver 无法为受影响投影提供目标时，迁移 SHALL 失败并保持原设置与文件布局不变。新位置与各 Agent 技能目录别名冲突时 SHALL 拒绝迁移。

#### Scenario: 切换到统一目录

- **WHEN** 用户将存储位置切换为 unified，且所有受影响项目 target 可解析
- **THEN** global Skill SSOT 与项目 Skill sibling 均迁移完成，各 Agent 投影指向新位置，固定 backup root 保持不变，旧 SSOT 位置不再残留受管内容

### Requirement: 未接管扫描与导入

系统 SHALL 只在一个完整 target 内扫描并导入未接管 Skill。global target 扫描各 Agent global 技能目录与现有统一目录中未被该 global target 管理、且包含 `SKILL.md` 的目录；project target 只扫描固定 resolver 返回的项目 Agent 技能目录，且 root 不可用或 resolver `Unsupported`／未确认时 SHALL 封闭失败并不得扫描或导入 global 目录。选中项复制进该 target 的 SSOT 后纳入管理，标记为 `local:{directory}` 身份或尽可能恢复 repo 信息。ZIP 安装和未接管导入 SHALL 接收完整 target；`all` 中必须先显式选择 target，且系统 SHALL NOT 用 global 的已安装状态替代 project 状态。

#### Scenario: 导入已有 skill

- **WHEN** 用户在一个具体 global target 触发扫描并选择导入一个存在于 `~/.claude/skills/` 但未被该 target 管理的 Skill
- **THEN** 该 Skill 被复制进 global SSOT 并入库，后续按该 global target 的统一流程管理

#### Scenario: 项目扫描路径未确认

- **WHEN** 用户在 project target 扫描未接管 Skill，但该 target 的 resolver 为 `Unsupported`
- **THEN** 扫描以结构化错误失败，不扫描或导入任何 global Skill 目录

## ADDED Requirements

### Requirement: Skill 项目视图中的全局适用段

系统 SHALL 在项目 Skill 列表中保留 project-owned 段，并且只在固定 resolver 对至少一个 Agent target 明确确认适用时显示 global Skill 的全局适用段。显示在全局适用段的 Skill SHALL 保持 global ownership；系统 SHALL NOT 因查看项目上下文复制或重定向它。

#### Scenario: Global Skill 未确认适用

- **WHEN** 一个 global Skill 没有任何 Agent target 被 resolver 明确确认对当前项目适用
- **THEN** 该 Skill 不显示在当前项目的全局适用段
