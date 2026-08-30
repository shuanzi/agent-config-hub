## MODIFIED Requirements

### Requirement: Skill 安装与冲突处理

系统 SHALL 将选中的 Skill 安装到当前配置的 global Skill SSOT root（默认 `~/.agent-config-manager/skills/`）。global target 继续使用该 root；project target 使用同一 storage location 的独立 sibling `projects/{projectId}/skills`（hub 为 `~/.agent-config-manager/projects/{projectId}/skills/`，unified 为 `~/.agents/projects/{projectId}/skills/`），`install-name` 仍须消毒为单段目录名。安装后 SHALL 计算内容 SHA-256 hash 并持久化记录（含 repo 坐标、完整 ownership target 和各 Agent 启用状态）。发现安装和 ZIP 安装 SHALL 接收完整 target 与必填 `initialApp`（Tauri/Rust 为 `initial_app`）。安装、重复安装与冲突判断 SHALL 接收完整 target：同一 target 内，同一 install-name 且来源相同 SHALL 视为重复安装并直接为本次 `initialApp` 启用；同一 target 内来源不同 SHALL 返回 `SKILL_DIRECTORY_CONFLICT`；不同 global／project target 之间 SHALL 独立且允许同名。首个投影写入失败时，系统 SHALL 将该 target 的记录和 SSOT 内容恢复到操作前状态。

#### Scenario: 正常安装

- **WHEN** 用户以一个完整 project target 安装未受管的 Skill，并显式选择 `claude-code` 作为 `initialApp`
- **THEN** Skill 被复制进该项目 storage sibling、记录入库并保存 SHA-256 hash，且只向 resolver 确定的项目 claude-code 技能目录投影，其他 Agent 初始保持关闭

#### Scenario: 同源重复安装选择初始 Agent

- **WHEN** 用户在同一完整 target 重新安装同一来源、同一 install-name 的 Skill，并显式选择 `opencode` 作为 `initialApp`
- **THEN** 系统复用既有 SSOT 与记录，仅将该 target 的 opencode 状态启用，不创建重复目录或跨 target 投影

#### Scenario: 缺少初始 Agent

- **WHEN** Skill 安装或 ZIP 安装请求没有有效的 `initialApp`
- **THEN** 操作被拒绝，且该 target 的 SSOT、数据库记录和 Agent 投影均保持不变

#### Scenario: 同名不同源冲突

- **WHEN** 用户在同一完整 target 安装的 Skill 的 install-name 已被来自其他仓库的 Skill 占用
- **THEN** 安装被拒绝并返回目录冲突错误，该 target 的 SSOT 与投影均不变

#### Scenario: 同名 global 与项目 Skill

- **WHEN** 一个名为 `review` 的 global Skill 已受管，用户在另一个完整 project target 安装同名 Skill，并显式选择一个 `initialApp`
- **THEN** 两项 Skill 保持独立身份，项目操作只影响该项目 resolver 确定的目标位置

## ADDED Requirements

### Requirement: Skill ownership 分组与完整目标表达

已安装 Skills 视图 SHALL 使用真实 ownership target 展示记录。`all` 上下文 SHALL 分为 global 与每个具体项目；项目上下文 SHALL 区分 project-owned 与 global-applicable。行、详情、状态反馈与 Agent 控件的可访问名称 SHALL 可辨识完整目标。两个登记项目的 `displayName` 相同时，界面 SHALL 使用 registry 中既有 `rootPath` 消歧；mutation SHALL 继续使用原记录的 `projectId` target，SHALL NOT 去重、复制或 retarget。

#### Scenario: 同名项目中的同名 Skill

- **WHEN** 两个 `displayName` 相同的项目各自拥有同名 Skill
- **THEN** 两组、两行和可访问名称使用各自真实 `rootPath` 可辨识，针对其中一行的更新、卸载或 Agent toggle 只携带该行原 `projectId` target

#### Scenario: 项目上下文的 global applicability

- **WHEN** 项目上下文同时返回 project-owned 与 global-applicable Skill
- **THEN** 两类记录分段显示，global 记录仍保持 global target，项目记录仍保持该项目 target

### Requirement: 原生 ZIP 文件选择

桌面 ZIP 安装 SHALL 使用原生单文件选择器并将可选扩展限制为 `.zip`。取消选择 SHALL NOT 发起安装。选中路径后，确认操作 SHALL 同时具备完整 target 与有效 `initialApp`，并继续调用既有 ZIP 安装命令；系统 SHALL NOT 引入拖拽、多 ZIP、远程 URL 或新的存储模型。

#### Scenario: 取消 ZIP 选择

- **WHEN** 用户打开原生 ZIP picker 后取消
- **THEN** 安装对话框保持可用，且不调用 ZIP 安装命令

#### Scenario: 选择 ZIP 并安装

- **WHEN** 用户选择单个 ZIP、完整 target 和 `initialApp` 后确认
- **THEN** 真实文件路径、target 和 `initialApp` 被提交给既有 ZIP 安装命令，成功后即时刷新已安装状态
