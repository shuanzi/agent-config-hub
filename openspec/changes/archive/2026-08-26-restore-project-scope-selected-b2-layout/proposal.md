## Why

已确认的 selected B2 UI 验收要求第二栏展示“全部／全局配置／项目配置”，但当前 v0.3 只支持全局资产：数据库、DTO、Tauri commands 和路径解析都没有项目身份或项目写入目标。若先重构布局，只会得到静态或伪造的项目栏，不能执行真实的列表、编辑、安装、启停或 live 文件写入。

本 change 为项目作用域资产管理建立最小、可实施的产品与接口契约，使配置上下文栏由真实项目登记和真实目标路径支撑，同时保留 v0.3 的直接语义 Tauri commands、数据库 SSOT／投影和 React Query 数据流。

## What Changes

- 新增显式项目登记：用户手动添加、列出、重新关联、移除项目根目录；数据库为每个登记项目持久化稳定的不透明 `projectId`，展示名与路径不作为身份。
- 新增 `all`、`global`、`project(projectId)` 配置上下文及其真实查询规则；`all` 只用于读取，任何新 mutation 都显式选择 global 或项目 target；项目视图只显示项目自有资产和固定解析器明确确认适用的全局资产。
- 为 Skills 与 Subagents 增加完整的全局／项目 ownership 与目标身份；长期指令改为每个 target 固定管理 `CLAUDE.md` 与 `AGENTS.md` 两种 live 文档（Claude Code / Codex+OpenCode），不支持 Gemini CLI、不保留预设或 per-Agent enable。项目写操作只能经已登记项目和对应固定解析器确定项目路径，绝不回退到全局路径。
- 修改应用外壳为 selected B2 的“资产类型 → 配置上下文 → 主工作区”布局；当前 Agent 保留业务语义，但不再占用第二栏。
- 规定 forward-only 数据库迁移、Rust／TypeScript DTO 镜像、直接 Tauri command 参数、React Query keys、L1／L2／L3 与视觉验收的实施任务。

本 change 是可执行规范草案，**不授权实现**。

## Capabilities

### New Capabilities

- `project-context`: 显式项目登记、上下文集合、稳定排序、固定解析器适用性与项目目标的封闭失败语义。

### Modified Capabilities

- `app-shell`: 采用 selected B2 的配置上下文第二栏、保留当前 Agent 的紧凑业务控件，并定义宽／窄屏路径。
- `skill-management`: 为 Skill 的读取、发现／导入、安装、更新、卸载和 Agent 启停加入作用域目标身份与项目路径解析。
- `instruction-management`: 将长期指令从 per-Agent 预设库替换为 `CLAUDE.md`／`AGENTS.md` 固定文档的作用域读取、直接保存、双投影一致性与项目路径解析。
- `subagent-management`: 为 Subagent 的读取、发现、安装、更新、卸载、备份恢复、存储迁移和 Agent 启停加入作用域目标身份与项目路径解析。

## Impact

- 后端：新增项目 registry DAO／service／command（含 root 重新关联），数据库升版；三类资产表和服务增加 ownership、项目目标和项目路径解析。
- 前端：`src/types.ts`、每类 API／React Query hook、`App.tsx` 及三类面板改为接受真实配置上下文；不从 Demo 或 visual fixture 注入项目字段。
- 测试：增加数据库迁移、项目根不可用、同名项目、目标隔离、适用性封闭失败、窄屏路径和截图比较覆盖。
- 文档：实施完成并验收后再更新产品基线与主 specs；本草案不修改它们。
