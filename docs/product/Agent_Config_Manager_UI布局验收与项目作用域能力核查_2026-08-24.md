# Agent Config Manager：UI 布局验收与项目作用域能力核查

> 状态：验收标准已确认；仅授权起草项目作用域 OpenSpec change；生产实现未授权
>
> 日期：2026-08-24
>
> 视觉基准：`/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=0&inherit=A`
>
> 本文只更新本轮 UI 验收口径并记录能力核查结论，不直接修改产品基线、OpenSpec、架构、DTO、后端或生产 UI。

## 1. 决策摘要

本轮将“UI 一致”重新定义为：生产 App 在相同视口与相同任务状态下，保持 selected B2 Demo 的布局骨架、栏位职责、主表面结构、密度和响应式路径；明确允许的产品差异必须逐项列出，不能再以“视觉方向相近”代替布局一致。

第二栏恢复为 Demo 的配置上下文栏：**全部／全局配置／项目配置**。当前 Agent 不再占用第二栏；它仍是安装、激活和长期指令查询所需的真实业务上下文，后续只能放入 Header 或主表面的紧凑上下文控件，四个 Agent 的启用状态继续放在资产行或详情中。

当前生产实现**不能直接进入完整 UI 重构**。原因不是 CSS，而是当前产品基线、数据库、DTO、命令和路径模型都没有项目作用域。直接渲染项目列表只能产生静态、禁用或伪造界面，不能满足本验收标准。

## 2. 新的可执行 UI 验收标准

### 2.1 共同边界

- 生产继续使用真实 React Query hooks、Tauri commands 和 DTO；不得从 Demo 或 `?fixture=visual` 注入生产字段。
- 选择态只保存上下文 ID、项目 ID 或资产 ID；可见详情始终从当前查询结果派生。
- 保留三类一等资产：Skills、长期指令、Subagents；Hooks 不进入本轮。
- 不恢复全局搜索、跨 Agent 转换、可配置继承布局或 `prepare → review → confirm → apply`。
- 使用原生 Tauri 标题栏；网页内容不绘制假的交通灯。
- Demo 独有的 version、decision status 等字段在生产 DTO 没有真实来源时不得展示。

### 2.2 宽屏布局

#### 1586×992

- 网页内容 Header 高度为 `66px`。
- 主框架同时显示三个同级表面：资产类型 rail、配置上下文 rail、主工作区。
- 主框架列宽为 `180px / 220px / minmax(0, 1fr)`，外边距、边界、圆角和分隔线与 Demo 对齐。
- 第一栏按顺序显示 Skills、长期指令、Subagents；设置固定在底部，允许以“设置”替代 Demo 的“管理”，但位置和层级不变。
- 第二栏显示“全部”“全局配置”和真实项目列表；不得出现 Agent rail。
- Skills 的四 Agent 状态／开关位于主表面资产行或详情，不得移入第二栏。

#### 1280×800

- Header 高度仍为 `66px`。
- 按 Demo 的实际 `1200–1360px` 规则，主框架列宽为 `160px / 190px / minmax(0, 1fr)`，不得继续使用 `180px / 220px`。
- Skills 使用名称与状态／来源或路径／Agent 状态三列关系。
- 长期指令和 Subagents 在主表面内使用 master-detail；不得把详情推到独立第四栏。

### 2.3 窄屏布局

#### 1199×900 与 390×844

- Header 高度为 `58px`。
- 一次只显示一个表面，正常路径为：`资产类型 → 配置上下文 → 列表 → 详情`。
- 设置从资产类型表面直接进入，不要求经过配置上下文。
- 返回时回到上一级表面并恢复触发器焦点；断点切换后不得把用户留在不存在的表面。
- 390px 下 `document.documentElement.scrollWidth <= innerWidth` 且 `document.body.scrollWidth <= innerWidth`。
- Skills 行仍展示四个有可访问名称的 Agent logo 控件；不能因窄屏直接隐藏该状态。
- 详情内容与操作单列排列，不显示第二栏或 Agent rail 的压缩版本。

### 2.4 配置上下文语义

第二栏不是装饰导航，必须由真实数据支撑：

- **全部**：显示当前资产类型下的全局资产与项目资产；全局资产段在前，项目段按项目名稳定排序，不产生空段。
- **全局配置**：只显示全局资产。
- **项目配置**：项目列表来自后端认可的项目事实源；选中项目时显示该项目自有资产，以及产品规则认定对该项目适用的全局资产。
- 上下文切换后，若当前资产不再可见，则清空资产选择并返回列表；列表分页和焦点回到确定位置。
- 安装、更新、卸载、启停、编辑与 live 文件写入都必须携带并校验完整目标身份，不能把项目资产写入全局路径。

其中“哪些全局资产适用于项目”以及“项目事实源如何建立”是实施前必须冻结的产品语义；本文不以 Demo 的 `inherit=A` 开发开关代替该决定。

### 2.5 当前 Agent 的保留方式

- 当前 Agent 继续作为安装默认目标，以及长期指令／live 文件查询所需上下文。
- 当前 Agent 可放在 Header 或主表面顶部的紧凑控件中，但不得重新形成独立 Agent rail。
- per-Agent 状态始终展示全部四个 Agent；切换当前 Agent 不得改变资产的 scope/project 身份。

### 2.6 状态、焦点与提示

- 两条 rail 的选中项使用 `aria-current` 或等价稳定语义。
- 列表项可键盘进入详情；进入详情、返回列表和窄屏逐级返回都有确定焦点目标。
- 错误提示使用 `role="alert"`，成功提示使用 `role="status"`。
- 加载、空态和错误态不能改变当前栏位职责，也不能制造横向溢出。

### 2.7 验收证据

完成实现后必须使用同一业务状态并排比较 Demo 与生产截图：

- `1586×992`：Skills 列表与详情；
- `1280×800`：Instructions 和 Subagents 的列表／master-detail；
- `1199×900`、`390×844`：完整 `类型 → 配置上下文 → 列表 → 详情` 路径。

自动化必须断言栏位存在性、列宽、Header 高度、窄屏单表面、焦点恢复、无横向溢出和真实上下文过滤。视觉复核只判断 Header、rail、主表面、行密度、master-detail 比例和响应式层级；不得因交通灯、全局搜索、Demo version 文案或明确排除的旧产品语义未复刻而阻塞。

## 3. 项目作用域能力核查

### 3.1 现行约束

当前产品基线明确把“项目作用域资产管理（仅全局作用域）”列为本期不做，[产品决策基线 v0.3](Agent_Config_Manager_MVP_产品决策基线_v0.3.md#3-明确不做本期) 与本轮新决定直接冲突。

[前端契约 v0.3](../frontend/Agent_Config_Manager_前端契约_v0.3.md#2-视图结构) 和 [app-shell OpenSpec](../../openspec/specs/app-shell/spec.md#requirement-当前-agent-上下文) 要求保留“当前 Agent”及其默认目标语义，但没有规定它必须占用第二栏。因此，恢复配置上下文栏时不得删除现有 Agent 语义；新增项目上下文仍需要正式更新产品和接口契约。

### 3.2 生产能力现状

| 资产 | 当前全局能力 | 当前项目能力 | Agent 能力 | 核查结果 |
|---|---|---|---|---|
| Skills | DB 全量列表、全局 SSOT、全局 Agent 投影 | 无项目身份、项目查询、项目写入目标 | 四 Agent 状态和 toggle 已具备 | 不能支持项目配置 |
| 长期指令 | 按 Agent 维护全局预设和 live 文件 | 无项目身份、项目文件路径或跨项目查询 | 按 Agent 分区，单 Agent 内互斥启用 | 不能支持项目配置 |
| Subagents | DB 全量列表、全局 SSOT、全局 Agent 投影 | 无项目身份、项目查询、项目写入目标 | 四 Agent 状态和 toggle 已具备 | 不能支持项目配置 |

具体证据：

- TypeScript 的 `InstalledSkill`、`Prompt`、`InstalledSubagent` 没有 `scope`、`project` 或项目目标字段，[`src/types.ts`](../../src/types.ts#L44)。
- SQLite 的 `skills`、`prompts`、`subagents` 表没有 scope/project 列，[`schema.rs`](../../src-tauri/src/database/schema.rs#L12)。
- Skills 与 Subagents 的列表命令是无上下文参数的全量查询；安装接收 `current_app`，toggle 接收显式目标 `app`，但两者都没有 scope/project 身份，[`commands/skill.rs`](../../src-tauri/src/commands/skill.rs#L34)、[`commands/subagent.rs`](../../src-tauri/src/commands/subagent.rs#L34)。
- Prompt 查询、写入和 live 文件路径只按 Agent 区分，[`commands/prompt.rs`](../../src-tauri/src/commands/prompt.rs#L31)、[`services/prompt.rs`](../../src-tauri/src/services/prompt.rs#L47)。
- 路径事实源支持 home 下的全局 Agent 配置目录和 per-Agent override，但没有项目根参数；OpenCode 注释虽然提到 `.opencode/agents/` 的项目位置，当前实现仍明确投影到全局位置，[`config.rs`](../../src-tauri/src/config.rs#L62)。
- Demo 独立定义了 `ConfigContext`、`MockAsset.scope` 和 `MockAsset.project`，这些字段只属于原型，[`full-ui-mock/types.ts`](../../src/prototypes/full-ui-mock/types.ts#L55)。
- `?fixture=visual` 明确只构造现有 command DTO，不提供项目能力，[`tests/l2/mock-invoke.ts`](../../tests/l2/mock-invoke.ts#L138)。

### 3.3 缺失的最小前置决策

在生产 UI 显示可操作的项目列表之前，至少需要冻结：

1. 项目列表的事实源与稳定身份，以及项目根目录的取得方式；
2. 三类资产的全局／项目身份和同名资产区分规则；
3. “全部”“全局配置”“项目配置”的读取集合，尤其是全局资产对项目的适用规则；
4. 三类资产在项目上下文中的真实文件路径、安装／更新／卸载／启停／编辑语义；
5. 数据库前向迁移、Rust DTO、TypeScript 镜像、Tauri 命令和 React Query key 的最小变更；
6. 当前 Agent 从第二栏移走后的明确位置和默认目标语义。

这些事项会改变当前产品范围、持久化结构、命令参数和文件系统写入目标。应先建立一个窄范围 OpenSpec change，并做架构影响复核；是否需要正式重开现有架构门禁，应由该复核结论决定，本文不预设。

## 4. 是否直接重构 UI

### 决定：暂不直接重构生产 UI

在用户确认本文前，不执行后续生产变更。确认后的候选下一步是定义并验收项目作用域的最小产品／数据／命令契约；不得先在生产 App 中放入 Demo 项目名、从路径猜测项目、把全部资产标成全局，或用禁用按钮冒充项目能力。

单独调整栏宽、断点或 CSS 在技术上可行，但它不能通过本文的完整验收，而且会留下一个不可操作的第二栏。为避免重复返工，本轮不把“先做空壳、以后接数据”作为生产实施路径。

当第 3.3 节的前置决策冻结并具备真实查询／写入契约后，生产 UI 才可按第 2 节直接重构。“第二栏恢复为配置上下文栏”和本文其余验收条款已经由用户确认；本轮新增授权仅覆盖项目作用域 OpenSpec change 的起草，不构成架构落地或代码实施授权。

## 5. 当前停点

- 已完成：新的布局验收口径及用户确认；当前项目作用域能力核查；暂不直接重构 UI 的决定。
- 当前任务：起草“项目作用域资产管理”最小 OpenSpec change，范围只覆盖第 3.3 节，不恢复其他旧 Demo 语义。
- 未授权：数据库／DTO／命令／UI 实现；测试与截图重抓；产品或架构 change 的实施。
