## Purpose

让内容型配置资产（长期指令、Subagents）的读取与编辑免除"列表 → 详情"的往返跳转：选中即见内容、选中即可编辑。

## ADDED Requirements

### Requirement: 内容型资产 master-detail 主表面

长期指令与 Subagents 的主表面 SHALL 采用 master-detail 编排：左侧为资产列表（名称 + 状态），右侧为选中资产的内容区；选中列表项后内容区 MUST 直接呈现该资产的内容，长期指令 MUST 直接可编辑 Markdown。Skills MUST NOT 使用 master-detail，保持高密度表格与行点击进入详情。

#### Scenario: 选中即显示内容

- **WHEN** 用户在长期指令或 Subagents 列表中选中一项
- **THEN** 右侧内容区立即显示该资产内容，无需额外的"进入详情"动作

#### Scenario: 长期指令选中即可编辑

- **WHEN** 用户选中一项长期指令
- **THEN** 右侧内容区直接呈现可编辑的 Markdown 编辑区，草稿仍进入既有 review/confirm/apply 闭环

### Requirement: 与窄屏单表面栈的退化关系

master-detail SHALL 只在宽／中窗口生效；窄窗口 MUST 退化为现有"列表 → 详情"单表面栈，保留返回路径、dirty guard、Esc 与焦点恢复，MUST NOT 为 master-detail 引入第二路响应式逻辑。

#### Scenario: 窄屏退化

- **WHEN** 窗口宽度进入窄屏区间
- **THEN** 内容型资产恢复为列表与详情顺序呈现的单表面栈，返回路径与键盘行为与现有窄屏一致

### Requirement: 单草稿与 dirty guard 不变

master-detail 下切换选中项 MUST 遵守既有单资产单草稿与 dirty guard 语义：存在未审查草稿时切换选中项必须先经过放弃确认，继续编辑 MUST 保持原选中项与编辑器焦点。

#### Scenario: 脏草稿切换拦截

- **WHEN** 长期指令存在未审查草稿且用户点击另一列表项
- **THEN** 系统显示放弃确认；选择继续编辑时保持原选中项、原草稿与编辑器焦点不变
