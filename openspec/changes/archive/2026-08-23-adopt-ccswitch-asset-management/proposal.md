# Proposal: adopt-ccswitch-asset-management

## Why

当前架构（单一只读 `frontend_gateway_read` 命令 + 通用 `AssetType` 契约 + wire 生成管线）只能只读浏览四类资产，没有任何安装/启停/写回能力；在途 change `adopt-selected-b2-ui-baseline` 规划的事务式 prepare/apply 模型实施成本高且尚未动工。经调研，cc-switch（Tauri 2 + React + Rust + SQLite）的 skill 管理设计——GitHub repo 发现、SSOT 目录集中存储、symlink/copy 投影到各 Agent 目录、per-Agent 开关、更新检测与备份——已经在生产环境验证了这套交互与底层逻辑。直接采用该设计可以一步到位获得成熟的资产管理能力，并把同一范式推广到长期指令 / Subagent 两类资产。

本 change **取代（supersede）** `adopt-selected-b2-ui-baseline`：后者实施未开始（tasks.md 仅规划文档部分勾选），其事务式 prepare/apply、24 条转换路径、SkillTargetState 等模型被废弃；"一等 Agent 集合（claude-code / codex / gemini-cli / opencode）、类型优先导航、列表可扫读性"等产品决策保留。Hook 资产从当前版本规划中整体移除（本期不纳入任何规划，后续如需再单独立项）。

## What Changes

- **架构 pivot（BREAKING）**：废除通用 FrontendGateway 契约体系（`src/contract/`、`src/gateway/`、`src/session/WorkspaceSession.ts`、`src-tauri/src/{wire,domain,core,catalog,ipc}.rs`、export-wire 管线与 wire 漂移门禁），改为 cc-switch 分层：`database/`（rusqlite + schema + DAO）→ `services/`（每类资产一个 service）→ `commands/`（直接 Tauri commands）→ 前端 `src/lib/api/` + React Query hooks + 按 feature 组织的面板组件。
- **Skill 管理（新）**：完整移植 cc-switch skill 管理——GitHub archive ZIP 下载发现（SKILL.md frontmatter）、SSOT 目录（默认 `~/.agent-config-manager/skills/`）、symlink/copy/auto 三种同步方式投影到四个 Agent 技能目录、per-Agent 开关、基于 content_hash 的手动更新检测、卸载备份与恢复、未接管 skill 扫描导入、ZIP 本地安装、存储位置迁移、默认 repo 播种。
- **长期指令管理（新）**：采用 cc-switch prompts 范式——预设库存入 DB，每个 Agent 互斥激活一条，激活时备份并原子写 live 文件（CLAUDE.md / AGENTS.md / GEMINI.md）。
- **Subagent 管理（新）**：skills 范式变体——repo 发现（frontmatter `.md` 扫描）+ SSOT 目录 + symlink/copy 投影到各 Agent subagent 目录 + per-Agent 开关。
- **设置（新）**：同步方式（auto/symlink/copy）、存储位置（hub 目录 vs `~/.agents/skills` 统一模式）、各 Agent 目录 override。
- **明确不做**：Hook 资产的管理（从产品规划移除）；skills.sh 注册表搜索、deeplink 导入、后台自动更新轮询、跨 Agent 格式转换（24 条路径）、Provider/代理/MCP/用量等 cc-switch 其他功能。

## Capabilities

### New Capabilities

- `skill-management`: Skill 的发现（repo 管理、GitHub ZIP 下载、SKILL.md 扫描）、安装/卸载（SSOT + 备份）、per-Agent 启停（symlink/copy 投影）、更新检测与更新、导入（未接管扫描 / ZIP）、存储迁移。
- `instruction-management`: 长期指令预设的 CRUD、per-Agent 互斥激活、live 文件原子写入与覆盖前备份、从 live 文件导入。
- `subagent-management`: Subagent 的 repo 发现（frontmatter `.md`）、安装/卸载、per-Agent 启停（symlink/copy 投影）、更新检测。
- `hub-settings`: 同步方式、存储位置迁移、各 Agent 目录 override 的设置项及其生效语义。
- `app-shell`: 前端 view 路由（skills / instructions / subagents / settings）、activeApp 上下文、React Query 数据获取与失效约定、结构化错误呈现。

### Modified Capabilities

（无 —— 仓库当前无存档 specs，全部为新增能力。）

## Impact

- **删除**：`src/contract/`、`src/gateway/`（含 wire 生成产物）、`src/session/`、`src-tauri/src/{wire,domain,core,catalog,ipc}.rs`、`src-tauri/src/bin/export-wire.rs`、`tests/contract/`、gateway/wire 相关 L1/L3 测试与 `verify-static` 中的 wire 漂移门禁。
- **重写**：`src-tauri/src/lib.rs`（command 注册中心 + AppState）、`src/App.tsx` / `src/main.tsx`（view 路由 + QueryClientProvider）、`src/ui/`（由通用列表/详情改为 feature 面板）、L1/L2/L3 测试内容（保留分层骨架与 orchestrator 脚本）、FX-01 fixture 用法（改为临时 HOME 隔离）。
- **新增依赖**：Rust `rusqlite`(bundled)、`reqwest`(rustls)、`zip`、`tempfile`、`futures`、`indexmap`；前端 `@tanstack/react-query`。移除 `ts-rs`。
- **文档/治理**：新增 ADR-0020（架构 pivot）；ADR-0003/0004/0011 标记 superseded；技术方案与产品/前端契约文档出 v0.3；归档 `adopt-selected-b2-ui-baseline`。
- **数据**：新增 `~/.agent-config-manager/` 目录（SQLite DB、SSOT skills/subagents、skill-backups）；向 `~/.claude`、`~/.codex`、`~/.gemini`、`~/.config/opencode` 下的技能/subagent 目录与配置文件写入投影。
- **保留**：Tauri 2 + React + Rust 技术栈、rusqlite 选型、敏感遮蔽语义、L0–L3 分层测试与 harness 基础设施、`?prototype=full-ui` 原型（仅作视觉参考）。
