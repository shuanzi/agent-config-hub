## Purpose

定义 Skill 在四个 Agent 目标中的事务式期望状态控制，使安装、转换和原生停用都能在明确目标、审查和确认的安全闭环内进行，而不伪装为即时开关。

## ADDED Requirements

### Requirement: 四 Agent 期望状态单元格

系统 MUST 为每个 Skill 显示四个 Agent 单元格；每个单元格 MUST 表达实际状态、可用操作、稳定原因以及存在时的当前事务标识，而不得将期望状态控制表现为即时本地状态变更。

#### Scenario: 单元格存在进行中的事务

- **WHEN** 一个 Skill 的 Agent 单元格已有未完成事务
- **THEN** 系统 MUST 显示该事务标识和 pending 状态，并继续显示重读前的实际状态

### Requirement: 开启时的目标解析和安全闭环

系统 MUST 在用户开启未启用的 Agent 单元格后进入目标设置，并由所选 Agent 列确定目标 Agent。系统 MUST 让预填的目标作用域和原生位置在 `prepare` 前的目标设置中保持可见且可修改，并将该请求解析为安装、确定性转换或阻断；安装或转换 MUST 经由既有 prepare、review、confirm、apply、修订重验和恢复闭环。`prepare` 成功后，目标作用域和原生位置 MUST 固定；对任一参数的变更 MUST 使旧 prepared、review 和 confirm 结果失效，并要求重新 prepare 与 review。确认摘要 MUST 包含最终的操作类别、目标 Agent、目标作用域、原生位置、能力映射和差异。

#### Scenario: 同格式目标可安装

- **WHEN** 用户开启一个具有已验证同格式目标的 Agent 单元格
- **THEN** 系统 MUST 将请求解析为安装，并在确认前显示操作类别、目标 Agent、作用域、原生位置和差异

#### Scenario: prepare 后修改目标参数

- **WHEN** 已产生 prepared 结果后，用户请求修改目标作用域或原生位置
- **THEN** 系统 MUST 使旧 prepared、review 和 confirm 结果失效，并回到目标设置以重新 prepare 与 review；后续确认摘要 MUST 显示重新准备后的最终参数

#### Scenario: 异构目标无法安全映射

- **WHEN** 用户开启一个无法证明可安全转换的异构 Agent 单元格
- **THEN** 系统 MUST 保持该请求为阻断状态并解释原因，而不得准备或应用写入

### Requirement: 原生停用与独立删除

系统 MUST 仅在目标 Agent 具有已验证原生停用语义时，将关闭单元格解析为编辑。没有该语义时，关闭控制 MUST 禁用并提供稳定原因，且 MUST NOT 回落为删除；删除目标资产 MUST 始终是独立的显式操作。

#### Scenario: 目标不支持原生停用

- **WHEN** 用户查看一个没有已验证原生停用能力的已启用 Agent 单元格
- **THEN** 系统 MUST 禁用关闭控制并解释原因，同时保留独立可达的删除操作

#### Scenario: 目标支持原生停用

- **WHEN** 用户关闭一个具有已验证原生停用能力的已启用 Agent 单元格
- **THEN** 系统 MUST 将请求解析为 `editAsset` 并经过既有安全闭环，且仅在 apply 成功并完成权威重读后更新实际状态

### Requirement: 实际状态的确认后更新

系统 MUST 仅在 apply 成功且受影响事实被重新读取后更新单元格的实际状态。取消、冲突、失败或回滚期间，系统 MUST 保留原实际状态并以 pending 或结果状态解释事务。

#### Scenario: 事务在确认后发生冲突

- **WHEN** 一个单元格事务在 apply 前或 apply 中发生冲突
- **THEN** 系统 MUST 保留冲突前的实际状态，显示事务结果，并要求后续读取事实后才反映任何状态变化

#### Scenario: apply 成功但权威重读失败

- **WHEN** 一个单元格事务 apply 成功但无法完成受影响事实的权威重读
- **THEN** 系统 MUST 保留重读前的实际状态并显示结果未知或待重读原因，而不得乐观显示期望状态

### Requirement: 唯一的 Skill 安装和转换主入口

系统 MUST 仅将 Agent 期望状态单元格作为 Skill 安装和转换的主入口。Skill 列表和详情中的其他位置 MUST NOT 提供重复的安装或转换主入口，但 MUST 保持阻断原因、事务状态、事务结果和显式删除可达。

#### Scenario: 用户查看 Skill 详情

- **WHEN** 用户打开一个 Skill 的详情
- **THEN** 系统 MUST 将安装或转换引导至对应 Agent 单元格，而不得显示第二个安装或转换启动入口
