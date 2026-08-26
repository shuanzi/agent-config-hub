## ADDED Requirements

### Requirement: selected B2 配置上下文外壳

系统 SHALL 在宽屏以“资产类型 rail → 配置上下文 rail → 主工作区”组织三类资产。`>=1361px` 时三栏宽度 SHALL 为 `180px / 220px / minmax(0, 1fr)`，`1200px–1360px` 时 SHALL 为 `160px / 190px / minmax(0, 1fr)`，Header SHALL 为 `66px`。资产类型 rail SHALL 按 Skills、长期指令、Subagents 排列，并将 Settings 固定在底部；配置上下文 rail SHALL 显示“全部”“全局配置”和真实项目 registry 结果，提供添加项目及各项目的重新关联／移除动作，且 SHALL NOT 显示 Agent rail 或单独项目管理页。

#### Scenario: 宽屏进入默认视图

- **WHEN** 用户在 `1586×992` 启动应用
- **THEN** 系统显示 Skills 的“全部”上下文、资产类型 rail、配置上下文 rail 和主工作区

### Requirement: 当前 Agent 的紧凑业务上下文

系统 SHALL 保留四个一等 Agent 的当前 Agent 选择及其既有 Skills／Subagents 安装默认 Agent 语义。当前 Agent SHALL 位于 Header 或主表面的紧凑控件，不得占用配置上下文 rail，也 SHALL NOT 决定长期指令、scope/project；Skills 的四 Agent 启用状态 SHALL 始终在资产行中可见，Subagents 则继续按既有主表面设计显示在资产行或详情中。长期指令固定显示 `CLAUDE.md`（Claude Code）与 `AGENTS.md`（Codex、OpenCode），不随当前 Agent 改变且不显示 Gemini CLI。

#### Scenario: 切换当前 Agent 后安装

- **WHEN** 用户在 Header 或主表面将当前 Agent 切换为 codex 并安装一个 global Skill
- **THEN** 安装仍以 codex 为默认 Agent target，第二栏仍显示配置上下文而非 Agent 列表

### Requirement: selected B2 主工作区密度与窄屏 Skills 行

在 `1280×800`，Skills 主表面 SHALL 使用三列紧凑行：名称／状态、来源或路径、四 Agent 状态；长期指令与 Subagents SHALL 在主工作区内使用 master-detail，且 SHALL NOT 出现第四栏。在 `390×844`，Skills 列表 SHALL 保持单列内容和无横向溢出，并继续在每个行内显示四个带可访问名称的 Agent logo controls；系统 SHALL NOT 因窄屏将这些控件隐藏到详情。

#### Scenario: 1280 主工作区布局

- **WHEN** 用户在 `1280×800` 查看 Skills、长期指令或 Subagents
- **THEN** Skills 显示三列紧凑行，长期指令和 Subagents 在主工作区内显示 master-detail，页面没有额外第四栏

#### Scenario: 390 Skills 行保留 Agent 控件

- **WHEN** 用户在 `390×844` 的 Skills 列表查看一项 Skill
- **THEN** 该行保留四个带可访问名称的 Agent logo controls，页面为单列且没有横向溢出

### Requirement: All 上下文的新 mutation 目标选择

系统 SHALL 将 `all` 视为只读聚合上下文。用户从 `all` 发起没有既有资产行 target 的安装、新建或导入时，主表面 SHALL 提供一个最小的 global／项目 target 选择控件；确认前必须得到明确选择，当前 Agent 不得隐式决定 scope。global 或具体项目上下文中的新 mutation 可直接使用当前具体 target；既有资产行的 mutation SHALL 保持该行 ownership target。

#### Scenario: All 中保存长期指令

- **WHEN** 用户在 `all` 上下文编辑一条长期指令文档
- **THEN** 系统从该固定文档行携带的 global 或 project target 保存，不因当前 Agent 自动选择 target，也不显示新建预设或 target picker

### Requirement: 窄屏配置上下文旅程

系统 SHALL 在 `<1200px` 时使用 `58px` Header 和单表面栈：`资产类型 → 配置上下文 → 列表 → 详情`。Settings SHALL 从资产类型表面直接可达。返回或断点切换后，系统 SHALL 保留仍有效的上级选择并恢复触发器焦点；在 `390px` 宽度下，文档与 body SHALL NOT 产生横向溢出。

#### Scenario: 窄屏查看项目资产详情

- **WHEN** 用户在 `390×844` 依次选择 Skills、一个项目和一项资产
- **THEN** 系统一次只显示对应表面，并能从详情依次返回列表、配置上下文和资产类型

### Requirement: rail 选中语义与列表详情焦点

资产类型 rail 和配置上下文 rail 的当前选中项 SHALL 使用 `aria-current` 或等价的稳定选中语义；所有纯图标控件 SHALL 具有可访问名称。资产列表项 SHALL 可通过键盘进入详情，详情表面 SHALL 获得确定的初始焦点，返回时 SHALL 恢复到触发的列表项。context 切换使已选资产不再可见时，系统 SHALL 清空选择、返回列表，并将焦点置于确定的列表标题或首项；如现有实现具有分页，则 SHALL 回到有效页，但本 change SHALL NOT 为此新增分页功能。错误继续使用 `role="alert"`，成功提示继续使用 `role="status"`。

#### Scenario: rail 选中项和纯图标控件可访问

- **WHEN** 用户切换资产类型或配置上下文，并使用纯图标项目操作控件
- **THEN** 两条 rail 的当前项具有稳定选中语义，且每个纯图标控件具有可访问名称

#### Scenario: 键盘详情往返与 context 切换

- **WHEN** 用户用键盘从列表项进入详情、返回后再切换到不包含该资产的 context
- **THEN** 详情初始焦点确定、返回焦点恢复至原列表项；切换后选择被清空并回到列表，焦点位于列表标题或首项
