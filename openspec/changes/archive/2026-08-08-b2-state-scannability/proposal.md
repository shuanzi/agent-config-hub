# b2-state-scannability

## Why

B2 资产管理台的实测反馈：在几十项资产的预期规模下，管理动作的本质是扫读，而当前"看不出状态"——**主痛点是启用状态**：每行 4 个 Agent toggle 的点亮/置灰差异要逐行逐个辨认，无法回答"这个 skill 在哪些 Agent 上活着""哪个 Agent 整列是灰的"；**次痛点是来源状态**：项目自有与全局适用的区分存在但扫描权重不足。健康状态（异常/漂移等）在现有 meta 表达下已够用，不在本轮范围。

## What Changes

- Skills 表的 Agent 启停区从"每行一组 4 个 toggle"改为 **4 个固定窄列，每个 Agent 一列**：列位置跨行固定，每个 Agent 的状态形成一条垂直扫描线；列头显示品牌 Logo（保留可访问名称）。
- 三态语言保留并强化：启用=点亮填充、停用=置灰、阻断=dashed 且不可切换；切换仍只写会话内 Mock 内存快照并明示"不写入配置"，刷新复位。
- 来源区分强化：项目上下文的"项目自有／全局适用"分段标题提升视觉层级，来源 badge 固定两种颜色语义；全局上下文不分段的现状不变。
- 长期指令与 Subagents 的主表面从"列表 ↔ 详情替换"改为 master-detail：左侧列表（名称 + 状态），右侧选中即显示／编辑内容。Skills 保持高密度表格 + 行点击进入详情。这是对 v22"列表与详情互相替换、不常驻第四栏"决策的**有记录的例外**。
- 明确移出范围：独立"健康状态列"、六态词表组件、`n/4` 计数摘要（被 Agent 分列扫描线取代）、Agent × 资产独立矩阵视图。

## Capabilities

### New Capabilities

- `agent-enable-scannability`: Skills 表的 Agent 固定分列、列头品牌标识、三态扫描线与 Mock 启停语义。
- `source-distinction`: 项目自有与全局适用资产的分段层级与 badge 颜色语义。
- `content-asset-master-detail`: 内容型资产（长期指令、Subagents）的 master-detail 主表面及其与窄屏单表面栈的关系。

### Modified Capabilities

（无既有 specs，全部为新增。）

## Impact

- 主要影响面：`selected` B2 工作台的 Skills 表格结构与内容型资产主表面编排（当前由 throwaway Mock `src/prototypes/full-ui-mock/` 承载）。
- 产品基线：Skills 列表信息结构、来源区分、类型差异化主表面三处的验收表达需要在定稿后复核。
- 前端契约：Agent 启停可用性与会话内预览的只读投影不变；master-detail 选中态属于 frontend-local 状态；不新增 query/intent/IPC/DTO。
- 不改变：资产身份、作用域与授权模型；review/confirm/apply 闭环；dirty guard；全局搜索；无新增依赖。
- 窄屏行为：Agent 分列在窄屏退化回行内 toggle 组；master-detail 退化为现有"列表 → 详情"单表面栈，不引入第二路响应式逻辑。
