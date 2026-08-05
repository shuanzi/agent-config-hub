## Purpose

让 Skill 的 Agent 启用状态可以按 Agent 垂直扫读：每个 Agent 一列、列位固定，用户沿一列扫下即可回答"哪些资产在这个 Agent 上活着"。

## ADDED Requirements

### Requirement: Agent 固定分列

Skills 表 SHALL 为每个受管 Agent 提供一个固定窄列，列顺序在所有行与所有上下文间保持一致；列头 MUST 显示该 Agent 的品牌标识并提供可访问名称。行的 Agent 状态 MUST 出现在对应 Agent 列的固定水平位置，形成每个 Agent 一条垂直扫描线。

#### Scenario: 按 Agent 垂直扫描

- **WHEN** 用户浏览 Skills 列表
- **THEN** 同一 Agent 的启用状态在每一行出现在相同的水平位置，用户沿该列竖直扫读即可比较所有行

#### Scenario: 列头可识别

- **WHEN** 用户查看 Skills 表头
- **THEN** 每个 Agent 列的列头显示对应品牌标识，且辅助技术可读出 Agent 名称

### Requirement: 三态行内语言

每个 Agent 列的单元格 SHALL 使用三态语言：启用=品牌标识点亮填充、停用=置灰、阻断=dashed 描边且进一步淡化。阻断单元格 MUST NOT 可切换，其原生 checkbox MUST 为 disabled 并保留含原因的可访问名称；启用与停用单元格的键盘与焦点路径 MUST 保留。

#### Scenario: 三态可辨

- **WHEN** 同一列表中同时存在启用、停用、阻断三种单元格
- **THEN** 三种状态在不 hover 的情况下即可互相区分，阻断单元格无点击或键盘切换效果

### Requirement: 会话内 Mock 启停语义不变

切换启用状态 MUST 只更新当前会话的内存资产快照，界面 MUST 明示"Mock 会话预览，不写入配置"；刷新页面后恢复 seed 状态。该能力 MUST NOT 触发 prepare/review/apply，也不新增任何生产写入路径。

#### Scenario: 切换只影响会话

- **WHEN** 用户切换某行某 Agent 列的启用状态
- **THEN** 该单元格状态立即更新，且不产生草稿、不进入事务流程；刷新页面后恢复初始状态

### Requirement: 窄屏退化

窄窗口下 Agent 分列 SHALL 退化回行内 toggle 组（现有窄屏卡片式行布局），三态语言与可访问语义保持一致，MUST NOT 为分列引入独立的窄屏布局分支。

#### Scenario: 窄屏行内回组

- **WHEN** 窗口宽度进入窄屏区间
- **THEN** 四个 Agent 状态以行内 toggle 组形式呈现，切换与阻断行为与宽屏一致
