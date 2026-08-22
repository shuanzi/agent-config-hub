# Tasks: adopt-ccswitch-asset-management

参考蓝本：`.scratch/cc-switch/`（services/skill.rs、database/、commands/、src/lib/api/、src/hooks/、src/components/skills/）。移植时裁剪本项目不支持的 Agent 分支，Agent 集合固定为 claude-code / codex / gemini-cli / opencode。

## 1. 治理与文档

- [x] 1.1 新增 ADR-0020（架构 pivot 决策记录）；将 ADR-0003 / ADR-0004 / ADR-0011 标记 superseded
- [x] 1.2 归档 `adopt-selected-b2-ui-baseline`（openspec archive 流程），在归档说明中注明被本 change 取代（注：归档时其 spec delta 被并入 openspec/specs/，因该 change 已被取代且未实施，已移除这些 specs 目录；本 change 归档时将建立自己的 specs）
- [x] 1.3 产品基线 v0.3 与前端契约 v0.3 初稿：保留三类资产（skill/长期指令/subagent；hook 移出规划）/四 Agent/类型优先导航决策，废弃事务式 prepare/apply、24 条转换、SkillTargetState

## 2. 后端骨架

- [x] 2.1 新增 Rust 依赖：rusqlite(bundled)、reqwest(rustls)、zip、tempfile、futures、indexmap；移除 ts-rs 与 export-wire bin；更新 Cargo.lock
- [x] 2.2 新建 `src-tauri/src/error.rs`（AppError 枚举 + `{code, context, suggestion}` 结构化错误输出）
- [x] 2.3 新建 `src-tauri/src/config.rs`（hub 目录、四个 Agent 配置目录/技能目录/subagent 目录/指令文件/配置文件路径解析、目录 override、read_json/write_json/atomic_write 工具）
- [x] 2.4 新建 `src-tauri/src/database/`：mod.rs（Database::init、SCHEMA_VERSION、forward-only migration）、schema.rs（skills / skill_repos / prompts / subagents / subagent_repos / settings 全部建表）、dao/settings.rs
- [x] 2.5 新建 `src-tauri/src/settings.rs`（同步方式、存储位置、目录 override 的读写）
- [x] 2.6 改造 `src-tauri/src/lib.rs`：AppState { db: Arc<Database> }、命令注册中心；删除 wire.rs / domain.rs / core.rs / catalog.rs / ipc.rs
- [x] 2.7 `verify-static` 移除 wire 漂移门禁；删除 `src/contract/`、`src/gateway/`、`src/session/`、`tests/contract/` 及 wire/gateway 相关测试

## 3. Skill 管理（specs/skill-management）

- [x] 3.1 `database/dao/skills.rs`：skills + skill_repos CRUD、per-Agent enabled 更新、默认 repo 播种（anthropics/skills 等）
- [x] 3.2 `services/skill.rs` 切片一：repo 下载（GitHub archive ZIP、main→master 回退、128 MiB 预算）+ 安全解压（路径穿越拒绝、条目/字节预算、符号链接物化）+ SKILL.md 发现与 frontmatter 解析
- [x] 3.3 `services/skill.rs` 切片二：安装（目录消毒、写锁、冲突检查、SSOT 复制、content_hash、失败回滚）+ 同步投影（auto/symlink/copy、原子 rename）
- [x] 3.4 `services/skill.rs` 切片三：卸载（清投影→备份→删 SSOT→删记录，备份留 20 份）、备份列表/恢复/删除
- [x] 3.5 `services/skill.rs` 切片四：手动更新检测（分组下载 + hash 比对）与更新执行（备份→替换→重投影）
- [x] 3.6 `services/skill.rs` 切片五：未接管扫描导入、ZIP 本地安装、存储位置迁移
- [x] 3.7 `commands/skill.rs` 全量命令注册（get_installed_skills / discover_available_skills / install_skill / uninstall_skill / toggle_skill_app / check_skill_updates / update_skill / get_skill_repos / add_skill_repo / remove_skill_repo / scan_unmanaged_skills / import_skills_from_apps / install_skills_from_zip / get_skill_backups / restore_skill_backup / delete_skill_backup / migrate_skill_storage）
- [x] 3.8 L1 Rust 单测：临时目录隔离下覆盖下载解压安全、发现、安装冲突、symlink/copy 同步、备份恢复、hash 更新检测、迁移、DAO

## 4. 前端外壳与 Skill UI（specs/app-shell、skill-management）

- [x] 4.1 新增依赖 @tanstack/react-query；`main.tsx` 挂 QueryClientProvider；`src/types.ts` 手工镜像 Rust 类型（标注 Rust 对应位置）
- [x] 4.2 `App.tsx` 改为 view 路由（skills 发现/已装、instructions、subagents、settings）+ activeApp 上下文；重写 `TopNav`
- [x] 4.3 `src/lib/api/skills.ts` + `src/lib/errors.ts`（结构化错误解析与用户可读映射）
- [x] 4.4 `src/hooks/useSkills.ts`（React Query：列表缓存、mutation 失效刷新）
- [x] 4.5 `src/components/skills/`：发现视图（搜索/repo 过滤/状态过滤/SkillCard）、已安装视图（per-Agent 开关组、计数条、检查更新/全部更新、ZIP 安装、导入、备份恢复）、RepoManagerPanel
- [x] 4.6 设置视图：同步方式 + 存储位置 + Agent 目录 override
- [x] 4.7 L1 TS 单测（api 封装、错误解析、hooks）+ L2 旅程（发现→安装→toggle→更新→卸载，mock invoke 层）+ L3 冒烟（真实命令路径、临时 HOME 隔离）

## 5. 长期指令（specs/instruction-management）

- [x] 5.1 `database/dao/prompts.rs` + `agents/` 的指令文件映射（CLAUDE.md / AGENTS.md / GEMINI.md）
- [x] 5.2 `services/prompt.rs`：预设 CRUD、互斥激活（覆盖前备份 live 内容入库、原子写入）、从 live 导入、查看 live 内容
- [x] 5.3 `commands/prompt.rs` + 前端 `src/lib/api/prompts.ts` + `usePrompts` + 指令面板（列表/编辑/启用/导入/查看 live）
- [x] 5.4 L1 单测 + L2 旅程

## 6. Subagent 管理（specs/subagent-management）

- [x] 6.1 `database/dao/subagents.rs`（subagents + subagent_repos 表）
- [x] 6.2 `services/subagent.rs`：复用 skill 的下载/解压/安装/同步 helper，发现逻辑改为 frontmatter `.md` 扫描；安装/启停/卸载/更新
- [x] 6.3 `commands/subagent.rs` + 前端 api/hooks/面板（发现 + 已安装 + per-Agent 开关）
- [x] 6.4 L1 单测 + L2 旅程

## 7. 收尾

- [x] 7.1 `performance/` PF-01 descriptor 按新列表实现重校准或显式降级；`verify:ticket` 对齐
- [x] 7.2 docs 全面更新：技术方案 v0.3、README、AGENTS.md（如存在）反映新架构与命令面
- [x] 7.3 全量验证：verify:toolchain / verify:static / test:rust / test:frontend / test:ui / test:tauri 全绿
- [x] 7.4 openspec verify-change 通过后归档本 change
