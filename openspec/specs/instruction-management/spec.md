# instruction-management Specification

## Purpose

长期指令（CLAUDE.md / AGENTS.md / GEMINI.md 等全局指令文件内容）的预设库管理：用户维护多条指令预设，每个 Agent 互斥激活一条，激活内容原子写入该 Agent 的 live 指令文件。

## Requirements

### Requirement: 指令预设 CRUD

系统 SHALL 为每个 Agent 独立维护指令预设集合（id、名称、内容、描述、启用状态、创建/更新时间，持久化于本地数据库），支持新建、编辑、删除。四个一等 Agent（claude-code / codex / gemini-cli / opencode）各自的预设互不影响。

#### Scenario: 新建预设

- **WHEN** 用户为 codex 新建一条指令预设并保存
- **THEN** 该预设出现在 codex 的预设列表中，其他 Agent 列表不变

### Requirement: 互斥激活与 live 写入

每个 Agent 至多一条预设处于启用状态。启用某预设时系统 SHALL：先将该 Agent live 指令文件的当前内容备份入库（若与已启用预设内容不同）→ 将其余预设置为未启用 → 原子写入启用预设的内容到 live 文件。live 文件映射：claude-code → `~/.claude/CLAUDE.md`；codex → `~/.codex/AGENTS.md`；gemini-cli → `~/.gemini/GEMINI.md`；opencode → `~/.config/opencode/AGENTS.md`（均可被目录 override 设置覆盖）。

#### Scenario: 切换激活预设

- **WHEN** 用户在已有启用预设的情况下启用另一条预设
- **THEN** 原预设被停用，live 文件内容被原子替换为新预设内容，被替换内容可在数据库中找回

### Requirement: 从 live 文件导入与查看

系统 SHALL 支持读取某 Agent live 指令文件的当前内容并导入为一条新预设；SHALL 支持查看 live 文件当前内容以便与预设比对。

#### Scenario: 导入现有指令

- **WHEN** 用户的 `~/.claude/CLAUDE.md` 已有内容但无对应预设，用户执行导入
- **THEN** 系统创建一条内容为 live 文件内容的新预设

#### Scenario: live 文件缺失

- **WHEN** 用户查看某 Agent 的 live 内容而该文件不存在
- **THEN** 系统明确显示"无 live 内容"而非报错
