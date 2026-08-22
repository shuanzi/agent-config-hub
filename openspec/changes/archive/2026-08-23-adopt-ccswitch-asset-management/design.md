# Design: adopt-ccswitch-asset-management

## Context

现状（详见 proposal.md - Why）：后端仅 `catalog.rs` 只读扫描 fixture，前端经单一 `frontend_gateway_read` 命令 + 通用契约获取数据；无数据库、无写路径。参考实现 cc-switch 已克隆在 `.scratch/cc-switch/`（移植蓝本：`src-tauri/src/services/skill.rs` ~4200 行、`database/`、`commands/`、`src/lib/api/`、`src/hooks/`、`src/components/skills/`）。

约束：沿用 Tauri 2 + React 18 + Rust；四个一等 Agent 固定为 claude-code / codex / gemini-cli / opencode；保留 L0–L3 分层测试与 orchestrator 脚本；保留敏感遮蔽语义；不引 Tailwind 与 i18n 库。

## Goals / Non-Goals

**Goals:**

- 后端转为 cc-switch 分层：`database/`（rusqlite）→ `services/` → `commands/`，`AppState { db: Arc<Database> }`
- Skill 管理完整移植 cc-switch 实现（下载/发现/安装/同步/更新/备份/导入/迁移），适配 4 个 Agent
- 其余两类资产复用同一范式：prompts 范式（长期指令）、skills 范式变体（subagent）
- 前端转为 React Query + feature 面板 + `src/lib/api/` 直接命令调用
- 全部文件写入支持临时目录隔离，保证 L1/L3 测试可在隔离 HOME 下运行

**Non-Goals:**

- Hook 资产管理（从产品规划整体移除，后续如需再单独立项）
- skills.sh 注册表搜索、deeplink 导入、后台自动更新轮询
- 跨 Agent 格式转换、Provider/代理/MCP/用量管理
- 项目作用域（`project` scope）资产管理 —— 本期只做全局作用域
- 后端事件推送（与 cc-switch 一致，前端靠查询失效刷新）

## Decisions

### D1. 废除 gateway/wire 契约体系，改直接命令 + 手工镜像类型

后端每类资产暴露一组语义化 Tauri command（如 `install_skill`、`toggle_skill_app`），Rust 类型用 serde `camelCase` 序列化，前端 `src/types.ts` 手工镜像。**不保留** ts-rs/export-wire 与 wireVersion 门禁。

- 理由：与"全面参考 cc-switch"的目标一致；直接命令对读写混合业务远简单于封闭 query union；类型漂移风险由 L3 真实命令测试兜底。
- 备选：保留 ts-rs 做类型漂移门禁 —— 否决，cc-switch 无此机制且其维护成本在快速移植期不划算。
- 影响：ADR-0003/0004/0011 标记 superseded，新增 ADR-0020 记录本次 pivot。

### D2. 数据库：rusqlite + forward-only migration

`~/.agent-config-manager/acm.db`，`SCHEMA_VERSION` 常量 + user_version pragma，建表语句集中在 `database/schema.rs`，DAO 按资产分文件。表结构照 cc-switch：`skills`、`skill_repos`、`prompts`、`subagents`、`subagent_repos`、`settings`；skills/subagents 各带四个 `enabled_<agent>` 布尔列。

- 理由：ADR-0015 已选定 rusqlite，cc-switch 同栈验证过；per-Agent 布尔列比 JSON 数组更利于 SQL 约束与迁移。
- 备选：每资产一张 enabled 关联表 —— 否决，Agent 集合固定为 4，布尔列更简单。

### D3. 统一资产范式 = "SSOT + 投影"，差异收敛到 per-Agent 适配模块

三类资产共享同一骨架：DB 记录是事实源 → service 负责复合操作（DB + 文件系统）→ `agents/{claude,codex,gemini,opencode}.rs` 封装各 Agent 的路径解析与原生格式写入。投影机制按资产类型分两种：

1. **目录投影**（skill、subagent）：SSOT 目录 → symlink/copy 到 Agent 目录。同步方式 `auto/symlink/copy` 全局设置生效；copy 用临时目录 + 原子 rename。
2. **整文件激活**（长期指令）：预设内容 → 原子写 live 指令文件，互斥启用，覆盖前备份旧内容入库。

不引入抽象 trait 统一两类机制 —— 照 cc-switch 惯例，每类独立实现 + 共享工具函数（路径解析、JSON/TOML 读写、atomic_write、目录消毒、hash）。

### D4. Skill 移植边界

移植 cc-switch `services/skill.rs` 的完整能力，裁剪点：

- 去掉 skills.sh 搜索、deeplink、Pi/Hermes/GrokBuild/OpenClaw/ClaudeDesktop 等本项目不支持的 Agent 分支
- 全局 `RwLock` 保护 DB+FS 复合写（照 cc-switch `skill_state_lock`）
- 安全加固全量保留：repo ref 校验、archive URL 断言、128 MiB 下载预算、解压条目/字节预算、路径穿越拒绝、符号链接物化
- 更新检测为手动触发；卸载备份保留最近 20 份

### D5. 前端结构

`src/lib/api/<feature>.ts`（invoke 薄封装）→ `src/hooks/use<Feature>.ts`（React Query，列表 staleTime: Infinity，mutation onSettled 失效相关 key）→ `src/components/<feature>/` 面板。`App.tsx` 持有 `activeApp` 与 `currentView` 两个顶层状态。视觉沿用 `workbench.css` 的 CSS 变量风格，可参考 `src/prototypes/full-ui-mock/` 的密度与单元格布局，但交互语义用 cc-switch 模型（toggle 即投影启停，无事务式 prepare/apply）。

### D6. 测试隔离

所有路径解析 SHALL 支持经设置/环境变量 override 到临时目录（L1 Rust 单测用 `tempfile`；L3 harness 用临时 HOME + override），确保测试不触碰真实 `~/.claude` 等目录。L2 浏览器旅程通过 mock invoke 层（`vi.mock('@tauri-apps/api/core')`）驱动 UI。删除 `tests/contract/` 与 wire/gateway 相关测试，新增 service 层单测 + API/hooks 单测 + 主流程 L2 旅程 + L3 真实命令冒烟。

## Risks / Trade-offs

- [移植体量大：`services/skill.rs` 约 4200 行] → 按"发现→安装→同步→更新→导入/迁移"切片落地，每片独立可测；裁剪不支持 Agent 的分支后实际规模显著缩小
- [废除了已冻结 v0.2 契约中的事务式 prepare/apply 与 24 条转换] → 在本 change 中显式声明 supersede 并归档 `adopt-selected-b2-ui-baseline`；产品/契约文档同步出 v0.3，治理链不断裂
- [手工镜像 TS 类型可能漂移] → L3 测试走真实命令序列化路径兜底；关键类型在 `src/types.ts` 标注 Rust 对应位置
- [symlink 在部分 Agent 运行时可能不被跟随] → `auto` 模式遇实体目录自动用 copy；设置页允许强制 copy
- [直接命令无统一 ingress 校验，攻击面变宽] → 每个 command 做参数校验 + 路径消毒；下载/解压安全预算全量保留

## Migration Plan

本 change 实施期间新旧架构不并存（仓库尚未发布，无用户数据迁移负担）：

1. Phase 0 先落治理（本 change 的 spec/design/tasks 冻结、ADR-0020、归档旧 change），再删旧代码
2. 删除 `src/contract/`、`src/gateway/`、`src/session/`、`src-tauri/src/{wire,domain,core,catalog,ipc}.rs`、export-wire、`tests/contract/` 及 wire/gateway 测试；`verify-static` 移除 wire 漂移门禁
3. 按 Phase 1→3 逐资产落地（skill → 长期指令 → subagent），每阶段 L1 测试先行、L2/L3 补齐
4. Phase 4 收尾：PF-01 性能 descriptor 重校准或显式降级、docs v0.3、verify → archive
5. 回退策略：旧实现均在 git 历史与归档 change 中，可整体 revert

## Open Questions

- opencode 的 subagent 原生目录与配置格式需在实施 Phase 3 时以官方文档核实（不影响本方案的架构与任务拆分）
