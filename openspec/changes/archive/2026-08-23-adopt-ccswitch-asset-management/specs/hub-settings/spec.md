## Purpose

全局设置项的管理与生效语义：投影同步方式、SSOT 存储位置、各 Agent 配置目录 override，这些设置决定 skill / subagent / 长期指令三类能力的实际文件落点。

## ADDED Requirements

### Requirement: 同步方式设置

系统 SHALL 提供同步方式设置，取值为 `auto`（优先 symlink，失败回退 copy）、`symlink`、`copy`，默认 `auto`。该设置对 skill 与 subagent 的投影生效，修改后对后续同步操作生效；已存在的投影 SHALL 在下次同步（启停、更新、迁移）时按新方式重建。

#### Scenario: 修改同步方式

- **WHEN** 用户将同步方式从 auto 改为 copy
- **THEN** 后续启用/更新操作一律以实体复制方式投影

### Requirement: 存储位置设置

系统 SHALL 提供 skill 与 subagent SSOT 存储位置设置：`hub`（默认，`~/.agent-config-manager/` 下）与 `unified`（`~/.agents/` 下）。切换 SHALL 触发迁移（见 skill-management / subagent-management 的迁移要求），迁移失败 SHALL 保持原设置与文件布局不变。

#### Scenario: 迁移失败回滚

- **WHEN** 迁移过程中目标位置校验失败
- **THEN** 设置保持原值，已安装内容仍在原位置可用

### Requirement: Agent 目录 override

系统 SHALL 支持为四个一等 Agent 分别设置配置目录 override；设置后，该 Agent 的技能目录、subagent 目录、指令文件、配置文件的路径解析 SHALL 全部以 override 目录为基准。override 为空时恢复默认路径。

#### Scenario: 设置 override 后路径生效

- **WHEN** 用户为 codex 设置目录 override 为 `/tmp/custom-codex`
- **THEN** codex 的技能投影目标变为 `/tmp/custom-codex/skills`，指令文件变为 `/tmp/custom-codex/AGENTS.md`
