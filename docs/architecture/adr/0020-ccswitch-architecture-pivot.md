# ADR-0020：架构 pivot —— 采用 cc-switch 式直接命令 + SQLite SSOT/投影 资产管理架构

> 状态：Accepted
>
> 决策日期：2026-08-22
>
> 取代：ADR-0003、ADR-0004、ADR-0011（均标记 Superseded）
>
> 依据：OpenSpec change `adopt-ccswitch-asset-management`（proposal/design/tasks 已冻结）

## 背景

v0.1/v0.2 架构以"通用资产只读契约 + 单一 `frontend_gateway_read` 命令 + wire 生成管线"为核心，只覆盖只读浏览；规划中的事务式 prepare/apply 模型（`adopt-selected-b2-ui-baseline`）实施未开始且成本高。经对 cc-switch（生产级 Tauri 2 + React + Rust + SQLite 同类应用）的完整调研，其资产管理设计——GitHub 仓库发现、SSOT 目录集中存储、symlink/copy 投影到各 Agent 目录、per-Agent 开关、基于内容 hash 的更新检测、卸载备份——已在生产中验证，且天然覆盖本项目需要的读写混合场景。

## 决策

- 后端采用 cc-switch 分层：`database/`（rusqlite + schema + DAO）→ `services/`（每类资产一个 service，持有 DB + 文件系统复合操作）→ `commands/`（薄壳 Tauri command，语义化命名，每类资产一组）；全局状态为 `AppState { db: Arc<Database> }`。
- 废除通用 FrontendGateway 契约体系：删除单一 read 命令、封闭 query union、wire DTO 层、ts-rs/export-wire 生成管线与 wireVersion 门禁。类型同步改为 Rust serde `camelCase` 类型 + 前端 `src/types.ts` 手工镜像，类型漂移由 L3 真实命令路径测试兜底。
- 数据模型统一为"DB 记录是事实源 + SSOT 目录 + 投影"：skill/subagent 采用目录投影（symlink/copy/auto，原子替换），长期指令采用整文件互斥激活（覆盖前备份、原子写入）。
- 前端采用 React Query + 按 feature 组织的面板组件 + `src/lib/api/` invoke 薄封装；不依赖后端事件推送，变更后以前端查询失效刷新。
- 每类资产独立实现（不建抽象 trait 统一投影机制），共享路径解析/原子写/消毒/hash 等工具函数。
- 保留：ADR-0001（Tauri+React+Rust）、ADR-0002（进程内 Rust core）、ADR-0015（rusqlite）、ADR-0019（macOS 15+ arm64）、敏感遮蔽语义、L0–L3 分层测试骨架。

## Interface 不变量

- 所有对 Agent 目录与配置文件的写入必须经过 service 层，command 层只做参数校验与转发；
- 路径解析集中于 `config.rs`，支持目录 override，测试可在临时 HOME 下全量运行，不得触碰真实用户目录；
- skill/subagent 的下载与解压强制安全预算（大小、条目数、路径穿越拒绝、符号链接物化）；
- 复合写操作（DB + 文件系统）在进程内以写锁串行化，失败时回滚数据库记录；
- 错误以 `{code, context, suggestion}` 结构化返回，原始异常不出 IPC；
- 卸载先备份（保留最近 20 份），投影移除先于 SSOT 删除。

## 结果

正向影响：

- 一步获得经过生产验证的 skill 管理交互与底层实现，并复用到长期指令与 subagent；
- 命令面语义化，前端无需经过通用契约转译，读写路径直接；
- SQLite SSOT 与 ADR-0015 的既有选型一致，DAO/service/command 边界清晰。

代价：

- 废弃 wire 生成管线与既有通用契约，前端 WorkspaceSession 与 gateway 层整体重写；
- Rust/TS 类型双写依赖纪律与 L3 测试防漂移；
- 已冻结的 v0.2 产品/前端契约中事务式 prepare/apply、24 条转换路径随之废弃，需出 v0.3 文档承接。

## 替代方案

### 保留 gateway 契约，仅在契约内扩展写动词

维持封闭 query union + prepare/apply 事务流。否决：cc-switch 的直接命令模型已被验证更简单；本项目的写场景（安装/启停/更新/备份）与事务式 prepare/review/confirm 模型的收益不成比例。

### 引入 tauri-specta 等命令客户端生成框架

否决：同 ADR-0011 的评估结论，不引入额外 routing/tool coupling；手工镜像 + L3 测试足够。

## 重新评估触发条件

仅当命令面增长到手工镜像无法维护、或需要对外公开 IPC 协议时，才重新评估 schema 生成工具；不得为假设需求预先引入。
