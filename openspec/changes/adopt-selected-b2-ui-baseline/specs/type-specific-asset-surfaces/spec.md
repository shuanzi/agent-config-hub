## Purpose

定义 Skills、长期指令和 Subagents 在共享工作台中的差异化查看、编辑和草稿语义，使每种资产仅暴露可安全支持的表面，同时维持统一的写入保护与响应式旅程。

## ADDED Requirements

### Requirement: 共享的资产选择和写入保护

系统 MUST 在三类资产之间维持单一活动草稿、dirty guard、审查、确认、apply、修订重验和恢复语义。任何表面上的实际写入 MUST 经过该安全闭环，而不得因类型表面不同绕过它。

#### Scenario: 用户在存在 dirty 草稿时切换资产

- **WHEN** 用户持有一个 dirty 草稿并尝试切换资产或作用域
- **THEN** 系统 MUST 先提供既有 dirty guard，并且在用户明确放弃或完成草稿前不得完成切换

### Requirement: Skill 的默认只读查看和次级源码编辑

系统 MUST 默认以只读结构化详情展示 Skill 的身份、来源、兼容性和 Agent 状态；打开详情 MUST NOT 自动创建草稿或要求读取原生文件内容。系统 MUST 通过明确的次级源码编辑入口提供原生编辑，并按已知多文件、未知字段、注释、附属资源和只读边界呈现事实；该编辑 MUST 映射为 `editAsset`，且该入口 MUST NOT 成为安装或转换入口。

#### Scenario: 用户仅查看 Skill

- **WHEN** 用户打开 Skill 详情但未选择源码编辑
- **THEN** 系统 MUST 显示只读结构化信息且不得创建草稿

#### Scenario: 用户选择编辑 Skill 源码

- **WHEN** 用户从次级入口开始编辑 Skill 源码
- **THEN** 系统 MUST 将更改映射为 `editAsset` 并以既有草稿和写入安全闭环处理，且保留未能完整结构化表达的原生事实或只读边界

### Requirement: 长期指令的直接编辑和首次变更建草稿

系统 MUST 在宽屏和中屏的 master-detail 表面直接呈现长期指令的 Markdown 编辑器。选择或聚焦编辑器 MUST NOT 创建草稿；仅当内容首次发生实际变化时，系统 MUST 创建当前资产的本地草稿并显示 dirty 状态。实际内容更改 MUST 映射为 `editAsset`。只读、未知或不兼容结构 MUST 禁用编辑并提供稳定原因。

#### Scenario: 用户只聚焦长期指令编辑器

- **WHEN** 用户选择长期指令或将焦点置于其编辑器而未改变内容
- **THEN** 系统 MUST NOT 创建草稿或改变实际内容

#### Scenario: 用户首次修改长期指令内容

- **WHEN** 用户首次对可编辑长期指令产生实际内容差异
- **THEN** 系统 MUST 创建该资产的本地草稿、显示 dirty 状态，并在后续写入时使用既有审查、确认和 apply 闭环

### Requirement: Subagent 的默认只读与安全次级编辑

系统 MUST 在宽屏和中屏以 master-detail 默认只读展示 Subagent 的结构化身份、模型、工具、权限、来源和正文。系统 MUST 仅在用户选择明确的次级编辑入口后，允许编辑已验证可无损往返的结构化字段以及原生 Prompt 或配置源码；该编辑 MUST 映射为 `editAsset`。未知字段、扩展内容和不兼容结构 MUST 保真或降级为只读。

#### Scenario: 用户打开 Subagent 详情

- **WHEN** 用户在宽屏或中屏选择一个 Subagent
- **THEN** 系统 MUST 展示只读 master-detail 内容，且不得仅因浏览创建草稿

#### Scenario: Subagent 含不兼容扩展内容

- **WHEN** 用户尝试编辑含有无法验证无损往返扩展内容的 Subagent
- **THEN** 系统 MUST 保留该内容或将其标示为只读，而不得把不完整结构化表单表示为完整编辑能力

### Requirement: 响应式类型表面旅程

系统 MUST 在窄屏将三类资产退化为类型、作用域、列表、详情或编辑的单表面栈；长期指令和 Subagent 在宽屏和中屏 MUST 保持 master-detail 表面。

#### Scenario: 窄屏用户从列表进入编辑

- **WHEN** 用户在窄屏从已选类型和作用域的列表进入一个可编辑资产
- **THEN** 系统 MUST 在单表面详情或编辑旅程中展示该资产，并保留返回原列表上下文的路径
