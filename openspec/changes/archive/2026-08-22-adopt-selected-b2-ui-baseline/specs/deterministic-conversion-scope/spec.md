## Purpose

定义 MVP 中可验证的跨 Agent 转换边界，将确定性转换收敛为 Skills 和 Subagents 的有方向能力矩阵，并让排除类型、映射限制和写入前结果对用户可审计。

## ADDED Requirements

### Requirement: Skills 与 Subagents 的确定性转换矩阵

系统 MUST 仅为 Skills 和 Subagents 提供跨四个 Agent 的确定性有方向转换，并形成总计 24 条源到目标路径；每次转换 MUST 使用一个源资产、一个目标 Agent 和一个目标作用域。

#### Scenario: 用户选择受支持的不同目标 Agent

- **WHEN** 用户为一个 Skill 或 Subagent 选择一个已验证的不同目标 Agent 和目标作用域
- **THEN** 系统 MUST 按该资产类型和源到目标方向检查转换矩阵，并仅在对应路径可用时允许继续

### Requirement: 类型特定的转换入口与单资产流程

系统 MUST 从 Skill 的 Agent 期望状态单元格启动 Skill 转换，并从 Subagent 详情的次级转换入口启动 Subagent 转换。转换 MUST 经过目标选择、能力映射、审查、确认和 apply，且 MUST NOT 支持批量转换或矩阵式写入。

#### Scenario: 用户从 Skill 详情请求转换

- **WHEN** 用户尝试从 Skill 详情中发起转换
- **THEN** 系统 MUST 将用户引导至目标 Agent 的期望状态单元格，并在该单元格解析目标后进入单资产事务流程

### Requirement: 长期指令与 Hooks 的显式排除

系统 MUST NOT 为长期指令或 Hooks 提供转换可用性、转换入口或已验证转换结果。长期指令在其他 Agent 中的创建或本地导入 MUST 被表示为独立原生资产创建，而不得复用转换能力映射或暗示语义等价。

#### Scenario: 用户查看长期指令的操作

- **WHEN** 用户查看长期指令的可用操作
- **THEN** 系统 MUST NOT 显示跨 Agent 转换，并且任何新建或导入操作 MUST 明确目标 Agent 且与转换结果区分

#### Scenario: 遗留 Hook 存在于兼容数据中

- **WHEN** 系统读取到用于兼容性或遗留证据的 Hook
- **THEN** 系统 MUST NOT 为该 Hook 生成任何 MVP 转换路径或转换入口

### Requirement: 目标版本验证和保真映射

系统 MUST 仅映射目标 Agent 当前已验证的版本结构。Prompt 和未知扩展内容只有两类结果：可保真 round-trip 时系统 MUST 继续转换；如无法保真迁移，系统 MUST 阻断转换且 MUST NOT 将该失败表示为降级、prepare 或 apply。无法证明安全映射的模型、工具、权限或其他行为 MUST 在任何写入前明确报告为人工处理、降级或阻断。原始跨 Agent 复制 MUST NOT 被表示为转换或生成转换结果。

#### Scenario: 目标结构缺少可验证映射

- **WHEN** 转换分析发现源资产的某项行为无法安全映射到目标 Agent
- **THEN** 系统 MUST 在 prepare 或审查阶段将该差异标记为人工处理、降级或阻断，并在用户确认前展示该结果

#### Scenario: Prompt 或未知扩展内容无法保真迁移

- **WHEN** 转换分析无法保真迁移 Prompt 或未知扩展内容
- **THEN** 系统 MUST 阻断转换并解释原因，且 MUST NOT 将该结果表示为降级、准备写入或应用写入

#### Scenario: Prompt 与未知扩展内容可保真 round-trip

- **WHEN** 转换分析证明 Prompt 和未知扩展内容可保真 round-trip 到目标 Agent
- **THEN** 系统 MUST 允许该内容继续通过既有目标选择、映射、审查、确认和 apply 流程

#### Scenario: 用户尝试原始跨 Agent 复制

- **WHEN** 用户或调用方请求在没有已验证转换映射的情况下原始复制资产内容到另一个 Agent
- **THEN** 系统 MUST NOT 将该请求表示为转换、生成转换结果或绕过目标选择、映射、审查、确认和 apply

### Requirement: 转换结果的独立原生资产

系统 MUST 将成功转换的结果创建为目标 Agent 的独立原生资产，且 MUST NOT 与源资产维持持续同步。系统 MUST 在 apply 成功并重新读取事实后才将结果表示为实际可用资产。

#### Scenario: 转换应用成功

- **WHEN** 用户确认转换且 apply 成功
- **THEN** 系统 MUST 在重新读取后显示目标 Agent 的独立原生资产，并不得将后续源资产修改自动同步到该结果
