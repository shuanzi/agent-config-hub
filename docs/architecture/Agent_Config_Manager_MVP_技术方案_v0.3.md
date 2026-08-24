# Agent Config Manager 技术方案 v0.3

> 状态：Draft（2026-08-22）
>
> 取代：技术方案 v0.1 及其 2026-08-10 影响复核 addendum（均标记 Superseded）
>
> 依据：ADR-0020；OpenSpec change `adopt-ccswitch-asset-management`（proposal/design/specs/tasks）
>
> 上位文档：产品决策基线 v0.3、前端契约 v0.3

## 1. 架构总览

Tauri 2 + React 18 + Rust（ADR-0001/0002 不变）。架构主轴从"通用只读契约 + 单一 gateway 命令"转为 cc-switch 验证过的分层：

```
React 视图（按 feature 组织，React Query 数据层）
  └── src/lib/api/<feature>.ts        # invoke 薄封装，serde camelCase DTO
        └── Tauri commands            # src-tauri/src/commands/，薄壳：参数校验 + 转发
              └── services/           # DB + 文件系统复合操作，进程内写锁串行化
                    ├── database/     # rusqlite：schema + DAO，forward-only migration
                    ├── config.rs     # 路径事实源：hub 目录、各 Agent 目录、override
                    └── settings.rs   # 同步方式 / 存储位置 / 目录 override
```

## 2. 数据模型

`~/.agent-config-manager/acm.db`（rusqlite bundled，`SCHEMA_VERSION` + user_version 前向迁移）。表：`skills` / `skill_repos` / `prompts`（(id, app_type) 复合主键）/ `subagents` / `subagent_repos` / `settings`（键值）。skill/subagent 各带四个 `enabled_<agent>` 布尔列与 `content_hash`（SHA-256）。

统一范式：**DB 记录是事实源 + SSOT 目录 + 投影**。

- 目录投影（skill / subagent）：SSOT（默认 `~/.agent-config-manager/{skills,subagents}/`，可迁移到 `~/.agents/`）→ 按同步方式设置（`auto`/`symlink`/`copy`，copy 走临时目录 + 原子 rename）投影到各 Agent 目录；
- 整文件激活（长期指令）：预设互斥激活，覆盖前备份 live 内容入库，原子写 `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`。

## 3. 命令面

语义化命令，每类资产一组（见 `src-tauri/src/commands/`）：skill 17 个（发现/安装/卸载/启停/更新/备份/导入/迁移/repo 管理）、prompt 6 个、subagent 14 个、settings 4 个。无统一 envelope 与 wireVersion；类型以 Rust serde `camelCase` + `src/types.ts` 手工镜像保持一致，漂移由 L3 真实命令测试发现。

## 4. 安全与可靠性

- 下载与解压预算：128 MiB 下载上限、解压条目/字节上限、路径穿越拒绝、符号链接物化、GitHub archive URL 断言；
- 复合写（DB + FS）由进程内 `RwLock` 串行化，首个投影失败回滚 DB；
- 卸载先备份（`skill-backups/` / `subagent-backups/`，各留最近 20 份）；
- 错误以 `{code, context, suggestion}` 结构化返回，原始异常不出 IPC；
- 所有路径解析支持 override（`ACM_HOME` / 目录 override），测试不触碰真实用户目录。

## 5. 测试分层（沿用 L0–L3 骨架）

- L0：`verify:toolchain` + `verify:static`（tsc / eslint / prettier / cargo fmt / clippy×2 / 禁止依赖守卫 / 敏感占位值守卫；wire 漂移门禁已随 pivot 移除）；
- L1：`cargo test`（service/DAO 单测，tempfile + `ACM_HOME` + serial_test 隔离）与 `vitest run`（api/hooks/错误解析，mock invoke）；
- L2：wdio 浏览器旅程（页内 mock invoke 层驱动真实 App）；
- L3：真实 Tauri harness（`test-harness` feature + wdio 插件，临时 HOME 隔离，真实命令路径冒烟）；
- PF-01 性能采样：已显式降级（见 `performance/README.md`），待按新列表实现重校准。

## 6. 与 v0.1 的关系

v0.1 的 ARC-01/02（技术栈、进程内 core）、ARC-06c 分层测试证据、ADR-0015（rusqlite）、ADR-0019（macOS 15+ arm64）继续有效；ARC-03（三命令 IPC）、ARC-04（深 GatewayCore）、wire schema 机制（ADR-0011）由 ADR-0020 取代。旧实现与 v0.1/v0.2 文档保留于 git 历史与已归档 OpenSpec changes，可整体追溯。
