# 架构说明

本文描述当前实现；产品行为以[产品说明](../product/README.md)为准，历史设计决定见 [ADR 索引](adr/README.md)。核对日期：2026-09-27。

## 模块边界

```text
React App / feature panels
  → React Query hooks
  → src/lib/api（invoke 薄封装、camelCase 参数）
  → src-tauri/src/commands（Tauri 参数边界）
  → services（按资产类型处理 DB 与文件操作）
  → database / config.rs / settings.rs
```

采用 Tauri 2、React 18、Rust、rusqlite。前端源代码入口为 [App.tsx](../../src/App.tsx)，后端命令注册在 [lib.rs](../../src-tauri/src/lib.rs)。服务端数据由 React Query 管理，成功 mutation 使相关查询失效；没有通用 Gateway、wireVersion 或后端事件刷新协议。

Rust serde 类型与 TypeScript 手工镜像，原生定义的前端类型集中在 [nativeSubagents.ts](../../src/lib/api/nativeSubagents.ts)，其他类型见 [types.ts](../../src/types.ts)。修改命令或 DTO 时需同步两端并运行相关前端和真实 IPC 测试。

## 持久化

家目录经 [config.rs](../../src-tauri/src/config.rs) 解析，设置 `ACM_HOME` 后应用目录和默认 Agent 目录均位于该根下。目录覆盖是显式路径，验收时也须选择隔离根内路径；仅设置环境变量不意味着任意外部 override 都已隔离。

| 数据 | 位置或存储方式 |
| --- | --- |
| SQLite | `~/.agent-config-manager/acm.db` |
| 设备设置 | `~/.agent-config-manager/settings.json`，包含同步方式、存储位置、目录覆盖 |
| Skill 主资产 | hub：`~/.agent-config-manager/skills/`；unified：`~/.agents/skills/` |
| 项目 Skill 主资产 | 对应存储根的 `projects/{projectId}/skills/` |
| Skill 备份 | 固定 `~/.agent-config-manager/skill-backups/` |
| 原生 Subagent 内容 | Agent 原生文件或配置条目；管理元数据及备份内容在 SQLite |
| 旧 Subagent 数据 | 旧表及固定 `subagent-backups/` 仍可存在，不代表现行写入模型 |

[数据库 schema](../../src-tauri/src/database/schema.rs) 当前版本为 4。项目 registry、按 target 区分的 Skills、来源仓库、原生定义及备份均持久化；旧 prompts/subagents 表保留兼容数据。schema 使用前向迁移和 savepoint，拒绝高于程序支持版本的数据库。数据库目录／文件在 Unix 下限制为 0700／0600。

Skill 投放所有权与主资产指纹记录在 SQLite settings 的 `skill_placement_registry_v1`，通用设置命令禁止改写该键。它与目录实时状态共同决定能否操作，不能只凭旧 `apps` 布尔值判断目录是否安全。

## 目录与身份

以下为默认路径；全局 Agent 目录可被设置覆盖，项目路径来自已登记根，不受全局 override 影响。

| 内容 | 全局 | 项目根下 |
| --- | --- | --- |
| Claude Code Skills | `~/.claude/skills` | `.claude/skills` |
| Codex Skills | `~/.codex/skills` | `.agents/skills` |
| Gemini CLI Skills | `~/.gemini/skills` | `.gemini/skills` |
| OpenCode Skills | `~/.config/opencode/skills` | `.opencode/skills` |
| 共享 Skills | `~/.agents/skills` | 不单列共享位置 |
| AGENTS.md | `~/.codex/AGENTS.md` 与 `~/.config/opencode/AGENTS.md` | `AGENTS.md` |
| Claude Code Subagents | `~/.claude/agents` | `.claude/agents` |
| Codex Subagents | `~/.codex/agents` | `.codex/agents` |
| Gemini CLI Subagents | `~/.gemini/agents` | `.gemini/agents` |
| OpenCode Subagents | `~/.config/opencode/agents` 及原生配置 | `.opencode/agents` 及原生配置 |

项目根只通过 `projectId` 向 registry 查询，调用者不能以展示路径替代身份。路径规范化后防止重复登记；位置解析合并物理路径别名。`ScopeTarget` 与资产 ID 一起定位 Skill，原生 Subagent 使用服务生成的完整 `identity`。

## 写入保护与失败处理

Skill 相关操作经服务锁串行化；涉及多类资产时按 Skill、Subagent 的固定顺序取得锁。投放读取返回 `revision`，提交 `expectedRevision` 时重新读取，防止旧界面覆盖磁盘外部变化。导入预览绑定来源、主资产和逐路径动作，确认时重新校验。

[skill_placement.rs](../../src-tauri/src/services/skill_placement.rs) 负责来源与投放所有权、路径冲突、别名及检查点；[skill_import.rs](../../src-tauri/src/services/skill_import.rs) 负责来源选择、预览及接管。复制采用暂存和替换，受影响文件与登记状态使用检查点恢复。回滚不是跨进程崩溃事务保证；恢复失败会报告具体错误，不声称所有磁盘写入都天然原子。

AGENTS.md 服务在读取和写入时检查全局双路径是否分歧；发现分歧零写入，写入部分失败时恢复已写路径。目录覆盖拒绝不同内容占位，并保留另一 Agent 路径。其保存参数没有通用 revision，不应将 Skill 的并发保护协议套到指令保存上。

[native_subagent.rs](../../src-tauri/src/services/native_subagent.rs) 按文件或配置条目识别原生定义。写操作绑定身份和摘要，更新还校验远端摘要；覆盖前备份。配置条目编辑／恢复保留其他键及配置文本，文件恢复保留权限。链接处理和项目改绑保护见[原生 Subagents](../product/README.md#原生-subagents)。

错误以 `{code, context, suggestion}` 返回。前端显示可理解的说明和建议；失败不能转换为空成功，也不能把项目路径错误降级为全局写入。后端部分旧兼容入口仍存在，不构成当前 UI 承诺的功能。

## 设置与迁移

`set_sync_method_command` 只保存同步方式；目录覆盖必须使用 `set_agent_override_dir`，存储位置必须使用 `migrate_storage`，整体设置命令拒绝绕开这两个专用流程。

存储迁移预检登记项目和受管内容，撤回非主资产投放，迁移主资产及项目副本，再重建投放；失败恢复设置与检查点。旧 Subagent 主资产可随兼容存储流程处理，原生定义保持原位，不自动转换。固定备份根不迁移。

每个 Agent override 命令独立执行，按需搬迁该 Agent 的 Skill 投放与 AGENTS.md，不搬迁原生 Subagent 文件。前端连续提交多个覆盖值不等于一个跨 Agent 的原子事务；项目改绑的原生状态保护也不应泛化为这个命令的保证。

## 下载与验证边界

仓库发现使用 GitHub archive，校验坐标、URL 和解压路径，限制下载及解压资源；拒绝路径穿越，将允许的归档链接物化为内容。具体预算与实现见 [skill.rs](../../src-tauri/src/services/skill.rs)，不另维护易漂移的数值副本。

原生文件配置模型不等于运行时加载模型，应用不验证 Agent 会话是否读取文件。测试层级、隔离和构建能力见[开发指南](../development.md#测试与证据)；当前没有加密快照库、动态 Adapter 更新链或正式发布产物的实现保证。
