# instruction-management Specification

## Purpose

管理 global 与已登记项目的固定 live 长期指令文档：`CLAUDE.md` 适用于 Claude Code，`AGENTS.md` 适用于 Codex 与 OpenCode；不支持 Gemini CLI 指令、预设库或 per-Agent enable。

## Requirements

### Requirement: 固定长期指令文档管理

系统 SHALL 不再维护任意数量的 Agent 指令预设、启用状态、状态筛选、导入或按 Agent 的 toggle。每个完整 `ScopeTarget` 固定返回并管理两项 live 文档资产：

- `kind = claude`、`fileName = CLAUDE.md`，`appliesTo = [claude-code]`；
- `kind = agents`、`fileName = AGENTS.md`，`appliesTo = [codex, opencode]`。

Gemini CLI 不属于长期指令支持范围；系统 SHALL NOT 读取、写入或显示 `GEMINI.md`。读取 DTO SHALL 携带 `target`、`kind`、`fileName`、`appliesTo`、`content`、`exists` 和可选 `updatedAt`。文件不存在时仍返回对应固定行，`exists = false` 且 `content = ""`；文档内容从 live 文件读取，不以旧 preset 数据库存储冒充当前内容。遗留 `prompts` 表行仅为未暴露的历史数据，SHALL NOT 出现在新 DTO／command 中，也 SHALL NOT 参与项目生命周期或 ownership 判断。

#### Scenario: 固定文档行

- **WHEN** 用户打开任一具体 global 或 project 配置上下文，且两个文件都不存在
- **THEN** 系统仍返回该 target 的 `CLAUDE.md` 与 `AGENTS.md` 两行，二者均为未创建状态

#### Scenario: Gemini CLI 不支持长期指令

- **WHEN** 用户查看长期指令
- **THEN** UI 不显示 Gemini CLI 适用状态，后端不触碰 `GEMINI.md`

### Requirement: 作用域路径、集合与直接保存

global `CLAUDE.md` SHALL 写入 Claude Code 的有效全局文件（默认 `~/.claude/CLAUDE.md`）；project `CLAUDE.md` SHALL 只写已登记项目根的 `CLAUDE.md`。global `AGENTS.md` SHALL 将同一内容投影到 Codex 与 OpenCode 的有效全局文件（默认分别为 `~/.codex/AGENTS.md` 与 `~/.config/opencode/AGENTS.md`）；project `AGENTS.md` SHALL 只写已登记项目根的单一 `AGENTS.md`。有效全局文件继续尊重既有目录 override。

`get_instruction_documents({ context })` SHALL 接收 `ConfigContext`：global 返回 global target 的两项；all 返回 global 两项后，按项目 registry 的 `displayName`／`projectId` 稳定顺序返回每个可访问项目的两项；project(projectId) 先返回项目自有两项，再返回明确适用的 global 两项，且 global 行保留 global target。项目 root 不可用时 project 读取／保存 SHALL 返回 `PROJECT_ROOT_UNAVAILABLE`，不得读取或写入 global 文件；all SHALL 跳过该项目段。

`upsert_instruction_document({ target, kind, content })` SHALL 直接原子写入 live 文档；`all` 不是 mutation target，但 all 返回的每个文档行自带 target。系统 SHALL NOT 提供删除物理文档的主流程，也 SHALL NOT 把旧的 `delete_prompt` 改造成文件删除。

#### Scenario: 保存全局 AGENTS 文档

- **WHEN** 用户保存 global `AGENTS.md`
- **THEN** Codex 与 OpenCode 两个有效全局投影得到相同内容；任一投影写入失败时，已经写入的投影恢复到本次操作前的内容

#### Scenario: 保存项目文档不回退

- **WHEN** 用户保存一个 project target 的 `AGENTS.md`
- **THEN** 系统只写该项目根的 `AGENTS.md`，两个 global AGENTS 投影保持不变

### Requirement: 全局 AGENTS 投影冲突与 override 搬迁

global `AGENTS.md` 的两份有效投影是同一逻辑文档。读取、保存及相关 override 搬迁 SHALL 先检查二者：两者都存在而内容不同，则 SHALL 返回结构化 `INSTRUCTION_PROJECTIONS_DIVERGED`（`context = {}`、`suggestion = resolveInstructionProjectionConflict`），不选择任一内容、不写入任一文件，也不提供冲突解决工作流。仅一侧存在时，读取 SHALL 返回该侧内容；保存时再次检查并写入两侧。

当 Claude、Codex 或 OpenCode 的 global config directory override 变更时，系统 SHALL 只搬迁该 Agent 负责的投影。搬迁 SHALL 拒绝覆盖内容不同的新目标（`INSTRUCTION_OVERRIDE_TARGET_CONFLICT`）；Codex／OpenCode 的另一投影必须保留且内容不变。成功写入新路径后才可移除旧的、已迁移的同一 Agent 投影；失败时恢复本次新建的投影。Gemini override 不迁移任何长期指令。

#### Scenario: 两个全局 AGENTS 投影内容不一致

- **WHEN** Codex 与 OpenCode 的有效 `AGENTS.md` 都存在但内容不同
- **THEN** 读取和保存均返回 `INSTRUCTION_PROJECTIONS_DIVERGED`，两个文件均不改变

#### Scenario: override 新目标已有不同内容

- **WHEN** 用户改变 Codex 或 OpenCode override，且该 Agent 的新 `AGENTS.md` 已有与当前逻辑文档不同的内容
- **THEN** override 操作失败，旧投影、另一 Agent 投影和新目标文件均保持不变
