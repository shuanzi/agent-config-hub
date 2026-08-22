## Purpose

定义 Skill 在四个 Agent 目标中的 presence/activation 分离的事务式期望状态控制，使安装、转换、原生重新启用和停用都能在明确目标、审查和确认的安全闭环内进行，而不伪装为即时开关。

## ADDED Requirements

### Requirement: 四 Agent presence/activation 期望状态单元格

系统 MUST 为每个 Skill 显示四个 Agent 单元格；每个单元格 MUST 分别表达 target 的
`presence`、`activation`、可用操作、稳定原因以及存在时的当前事务标识，而不得将期望状态
控制表现为即时本地状态变更。`presence` MUST 为 `absent`、`present`、`unknown`、`blocked`
或 `stale`；`activation` MUST 为 `notApplicable`、`enabled`、`disabled`、`unknown`、
`blocked` 或 `stale`。仅 `presence=absent` 时 activation 为 `notApplicable`，仅
`presence=present` 时 activation 可为 `enabled` 或 `disabled`。

#### Scenario: 单元格存在进行中的事务

- **WHEN** 一个 Skill 的 Agent 单元格已有未完成事务
- **THEN** 系统 MUST 显示该事务标识和 pending 状态，并继续显示重读前的 presence 与 activation

### Requirement: presence/activation 的开启解析和安全闭环

系统 MUST 在用户开启 Agent 单元格后先依据 presence、activation 和适用事实解析，并由所选
Agent 列确定目标 Agent。`presence=absent` 时，系统 MUST 将请求解析为安装、确定性转换或
阻断；`presence=present` 且 `activation=disabled` 时，只有 Adapter 已验证原生 activation
语义，系统才可将重新启用解析为 `editAsset`；`presence=present` 且 `activation=enabled` 时
不得生成新的安装、转换或写入。系统 MUST 让预填的目标作用域和原生位置在 `prepare` 前的
目标设置中保持可见且可修改。允许继续的安装、转换或 `editAsset` MUST 经由既有
prepare、review、confirm、apply、修订重验和恢复闭环。`prepare` 成功后，目标作用域和原生
位置 MUST 固定；无论首次 `prepare` 前或 `prepare` 后，目标作用域或原生位置任一变化后，
系统 MUST 先对新 target 权威重读 presence、activation 和适用事实并重新解析 operation。旧
operation mapping MUST 立即失效且 MUST NOT 沿用；如已存在，prepared、review 和 confirm
MUST 也全部失效。系统必须基于新 target 事实重新映射并重新 prepare 与 review。确认摘要
MUST 包含最终的操作类别、目标 Agent、目标作用域、原生位置、能力映射和差异。

#### Scenario: 同格式目标可安装

- **WHEN** 用户开启一个 `presence=absent` 且具有已验证同格式目标的 Agent 单元格
- **THEN** 系统 MUST 将请求解析为安装，并在确认前显示操作类别、目标 Agent、作用域、原生位置和差异

#### Scenario: 已存在但原生停用的目标重新启用

- **WHEN** 用户开启一个 `presence=present`、`activation=disabled`，且 Adapter 已验证原生 activation 语义的 Agent 单元格
- **THEN** 系统 MUST 将请求解析为 `editAsset`，并经由既有安全闭环，而不得将已存在目标伪装为安装或转换

#### Scenario: 已存在但原生停用的目标没有已验证 activation 语义

- **WHEN** 用户开启一个 `presence=present`、`activation=disabled`，但 Adapter 未验证原生 activation 语义的 Agent 单元格
- **THEN** 系统 MUST 将操作显示为 disabled 或 blocked 并提供稳定原因，且不得进入 `prepare` 或 `apply`

#### Scenario: prepare 后修改目标参数

- **WHEN** 已产生 prepared 结果后，用户请求修改目标作用域或原生位置
- **THEN** 系统 MUST 先对新 target 权威重读 presence、activation 与适用事实并重新解析 operation，使旧 operation mapping、prepared、review 和 confirm 全部失效且不得沿用；只有重新 prepare 与 review 后，后续确认摘要才可显示重新准备后的最终参数

#### Scenario: 首次 prepare 前修改目标参数

- **WHEN** 用户在首次 `prepare` 前修改目标作用域或原生位置
- **THEN** 系统 MUST 立即使旧 operation mapping 失效且不得沿用，先对新 target 权威重读 presence、activation 与适用事实并重新解析 operation；只有完成新映射后才可允许 `prepare`

#### Scenario: 异构目标无法安全映射

- **WHEN** 用户开启一个无法证明可安全转换的异构 Agent 单元格
- **THEN** 系统 MUST 保持该请求为阻断状态并解释原因，而不得准备或应用写入

#### Scenario: presence、activation 或适用事实不可判定

- **WHEN** 一个 target 的 presence、activation 或适用事实为 `unknown`、`blocked` 或 `stale`
- **THEN** 系统 MUST fail-closed，禁用相应开启或关闭操作并提供稳定原因，且不得进入 `prepare` 或 `apply`

### Requirement: 原生停用与独立删除

系统 MUST 仅在 target 为 `presence=present`、`activation=enabled` 且目标 Agent 具有已验证原生 activation 语义时，将关闭单元格解析为 `editAsset` 停用。没有该语义时，关闭控制 MUST 禁用并提供稳定原因，且 MUST NOT 回落为删除；删除目标资产 MUST 始终是独立的显式操作。系统 MUST NOT 新增通用 `setSkillEnabled` intent。

#### Scenario: 目标不支持原生停用

- **WHEN** 用户查看一个 `presence=present`、`activation=enabled` 但没有已验证原生 activation 能力的 Agent 单元格
- **THEN** 系统 MUST 禁用关闭控制并解释原因，同时保留独立可达的删除操作

#### Scenario: 目标支持原生停用

- **WHEN** 用户关闭一个 `presence=present`、`activation=enabled` 且具有已验证原生 activation 能力的 Agent 单元格
- **THEN** 系统 MUST 将请求解析为 `editAsset` 并经过既有安全闭环，且仅在 apply 成功并完成权威重读后更新实际状态

### Requirement: 实际状态的确认后更新

系统 MUST 仅在 apply 成功且受影响事实被重新读取后更新单元格的 presence 与 activation。取消、冲突、失败或回滚期间，系统 MUST 保留原实际状态并以 pending 或结果状态解释事务。

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
