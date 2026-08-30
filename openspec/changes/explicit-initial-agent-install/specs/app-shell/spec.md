## REMOVED Requirements

### Requirement: 当前 Agent 上下文

**Reason**: 新安装不再从应用级 Agent 上下文取得默认值；必须由本次安装操作显式提供 `initialApp`（Tauri/Rust 为 `initial_app`）。

**Migration**: 保留四个一等 Agent 的行级状态控制，在 Skills/Subagents 安装面板中增加必填的初始 Agent 选择。

### Requirement: 当前 Agent 的紧凑业务上下文

**Reason**: 全局 Agent 选择不再是应用业务上下文，也不应继续影响安装默认值。

**Migration**: selected B2 外壳保留类型 rail、配置上下文 rail 和主工作区；删除全局 Agent 控件，安装操作自行收集 `initialApp`。

## MODIFIED Requirements

### Requirement: selected B2 主工作区密度与窄屏 Skills 行

在 `1280×800`，Skills 主表面 SHALL 使用五列高密度语义表格：Skill 名称／描述／更新状态、真实来源、完整 ownership 目标、四 Agent 状态、行操作；长期指令与 Subagents SHALL 在主工作区内使用 master-detail，且 SHALL NOT 出现第四栏。Skills 表格 SHALL 在 `all` 中按 global 与具体项目分组，在项目上下文中区分 project-owned 与 global-applicable。在 `390×844`，表格 DOM 语义 SHALL 保持，视觉布局可转为紧凑单列行，但 SHALL 无横向溢出并继续在每行显示四个带完整 Skill／target／Agent 可访问名称的真实控件。

#### Scenario: 1280 主工作区布局

- **WHEN** 用户在 `1280×800` 查看已安装 Skills
- **THEN** 主工作区显示名称、来源、目标、Agent、操作五列，ownership 分组与完整目标可直接辨识，行操作不被裁切且页面没有额外第四栏

#### Scenario: 390 Skills 行保留 Agent 控件

- **WHEN** 用户在 `390×844` 的 Skills 列表查看一项 Skill
- **THEN** DOM 保持表格语义，视觉行转为单列表达，四个具备完整可访问名称的 Agent 控件仍在行内且页面无横向溢出

### Requirement: All 上下文的新 mutation 目标选择

系统 SHALL 将 `all` 视为只读聚合上下文。用户从 `all` 发起没有既有资产行 target 的安装、新建或导入时，主表面 SHALL 提供 global／项目 target 选择，并在 Skills／Subagents 的新安装操作中提供必填的 `initialApp`（Tauri/Rust 为 `initial_app`）选择；确认前必须得到两者，系统 SHALL NOT 从任何全局 Agent 状态隐式决定 scope、project 或初始投影。global 或具体项目上下文中的新 mutation 可直接使用当前具体 target，但新安装仍 SHALL 显式提供 `initialApp`；既有资产行的 mutation SHALL 保持该行 ownership target。

#### Scenario: All 中安装前选择 target 与初始 Agent

- **WHEN** 用户在 `all` 上下文安装一个新发现的 Skill 或 Subagent
- **THEN** 系统要求用户选择 global 或一个已登记 `projectId`，并显式选择四个一等 Agent 之一作为 `initialApp`；选择完成前不创建安装或写入任何位置

#### Scenario: 具体上下文中的安装初始 Agent

- **WHEN** 用户在具体 global 或 project 上下文安装新 Skill
- **THEN** 系统使用该上下文的完整 target，并要求用户在安装操作中显式选择 `initialApp`，而不是读取全局 Agent 默认值

#### Scenario: All 中保存长期指令

- **WHEN** 用户在 `all` 上下文编辑一条长期指令文档
- **THEN** 系统从该固定文档行携带的 global 或 project target 保存，不因任何 Agent 默认值自动选择 target，也不显示新建预设或 target picker

## ADDED Requirements

### Requirement: 四 Agent 行级状态与安装初始 Agent

系统 SHALL 保持四个一等 Agent（`claude-code`、`codex`、`gemini-cli`、`opencode`）的 Skills／Subagents 行级状态可见。系统 SHALL NOT 提供应用级全局 Agent 选择。每个新 Skill 或 Subagent 的仓库安装、发现安装和 ZIP 安装 SHALL 要求一个有效的 `initialApp`；成功后仅该 Agent 初始启用，其他 Agent 的状态保持关闭。更新、卸载、toggle 和备份恢复 SHALL 不使用 `initialApp`，而继续从既有资产或备份的完整 target 派生。

#### Scenario: 新安装显式选择初始 Agent

- **WHEN** 用户在一个完整 target 中安装 Skill 并选择 `codex` 作为 `initialApp`
- **THEN** 安装完成后 codex 是唯一默认启用的 Agent，用户仍可在资产行中独立调整全部四个 Agent 的状态

#### Scenario: 缺少初始 Agent

- **WHEN** 新安装请求没有有效的 `initialApp`
- **THEN** 操作被拒绝，且不得写入 target 的 SSOT、数据库或 Agent 投影
