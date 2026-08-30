## MODIFIED Requirements

### Requirement: 读取上下文与 mutation target 正交

`all` SHALL 只作为读取上下文，且 SHALL NOT 被传入或转换为 mutation target。update、uninstall、toggle 和 edit SHALL 从被操作资产行的完整 ownership target 派生；从 global 或 `project(projectId)` 上下文发起没有既有资产 target 的安装、新建或导入时，系统 SHALL 使用该具体 target，但 Skills／Subagents 的新安装 SHALL 额外要求操作内显式提供有效的 `initialApp`（Tauri/Rust 为 `initial_app`）。从 `all` 发起没有既有资产 target 的安装、新建或导入时，用户 SHALL 先显式选择 global 或一个 `projectId`，并在新安装时显式选择 `initialApp`，系统才可确认 mutation；系统 SHALL NOT 静默默认 global 或 Agent。

#### Scenario: All 中安装前选择 target

- **WHEN** 用户在 `all` 上下文安装一个新发现的 Skill
- **THEN** 系统要求用户选择 global 或一个已登记 `projectId`，并显式选择四个一等 Agent 之一作为 `initialApp`，选择前不创建安装或写入 global 位置

#### Scenario: All 中操作既有项目资产

- **WHEN** 用户在 `all` 中关闭一项 project Subagent 的 Agent 开关
- **THEN** 系统从该行的 project ownership target 派生操作，不要求重新选择 scope 或初始 Agent，也不修改 global 投影
