# 架构决策索引

ADR 记录为何作出决定，不是自动证明实现完成。以下按 2026-09-27 现状标注适用范围；历史正文保留原批准状态，阅读时以顶部现行适用性说明为准。产品行为见[产品说明](../../product/README.md)，实现结构见[架构说明](../README.md)。

| 决策 | 现行状态 | 适用范围 |
| --- | --- | --- |
| [0001 · 采用 Tauri 2、React/TypeScript 与 Rust core](0001-tauri-react-rust-stack.md) | 有效 | 技术栈仍适用。 |
| [0002 · 业务 Rust core 采用 Tauri Core 进程内模块](0002-in-process-rust-core.md) | 部分有效 | 进程内 Rust 服务仍适用；旧 Gateway、prepared operation 与 Adapter 前提由 ADR-0020 替代。 |
| [0003 · FrontendGateway 使用三个显式 command 与单一 invalidation event](0003-explicit-gateway-ipc.md) | 已替代 | 由 ADR-0020 的直接 Tauri 命令模型替代。 |
| [0004 · 采用深 GatewayCore 与内部能力模块](0004-deep-gateway-core.md) | 已替代 | 由 ADR-0020 的按资产服务分层替代。 |
| [0005 · 采用 SQLite 状态库与加密快照目录的混合持久化](0005-hybrid-private-persistence.md) | 部分有效 | SQLite 仍采用；加密快照、operation journal 与派生索引不是当前实现，存储以现行架构说明为准。 |
| [0006 · 应用更新与适配器包共用产品更新签名密钥](0006-shared-product-update-key.md) | 未实施 | 更新签名是历史批准的发布设计，当前无可验收的签名与更新链；不作为已实现能力。 |
| [0007 · 四个 Agent 使用统一 compatibility bundle](0007-unified-adapter-bundle.md) | 已退出当前范围 | ADR-0020 取消动态 Adapter 路线；不提供 compatibility bundle。 |
| [0008 · 采用直接分发与单 stable 静态 HTTPS feed](0008-static-release-feed.md) | 未实施 | 直接分发与静态 feed 是历史发布设计；正式构建、打包与发布验证尚未建立。 |
| [0009 · 采用 framework-neutral 深 WorkspaceSession](0009-framework-neutral-workspace-session.md) | 已替代 | ADR-0020 改用 React Query 与 feature 面板，不再使用 WorkspaceSession。 |
| [0010 · 采用 CodeMirror 6 与契约驱动的工作台控件](0010-codemirror-contract-driven-workbench.md) | 已替代 | 现行面板使用原生文本编辑控件与直接命令；不要求实现旧 CodeMirror 或事务工作台。 |
| [0011 · 以 Rust wire DTO 作为 IPC schema 事实源](0011-rust-first-wire-schema.md) | 已替代 | ADR-0020 移除 wire 生成协议，改为手工镜像 serde DTO。 |
| [0012 · 采用分层证据与少量真实 Tauri 主路径](0012-layered-test-evidence.md) | 部分有效 | 分层证据原则仍适用；旧 Gateway/event tracer 不再运行，当前测试入口见开发指南。 |
| [0013 · 通过真实 tracer 校准并冻结性能预算](0013-evidence-calibrated-performance-budgets.md) | 待重新校准 | 旧采样实现已退役，npm run perf 继续显式未建立；不证明现行性能预算通过。 |
| [0014 · 采用 npm + Vite 根级验证命令面](0014-npm-vite-command-surface.md) | 部分有效 | npm + Vite 和薄编排仍适用；命令可用状态以开发指南为准，不能由命令名推断已实现。 |
| [0015 · 采用 rusqlite 与内嵌 forward-only migration](0015-rusqlite-state-store.md) | 部分有效 | rusqlite 与前向迁移仍适用；表结构以当前 schema 为准，旧 StateStore/Gateway 语义已替代。 |
| [0016 · 采用 XChaCha20-Poly1305 与单一 Keychain 密钥](0016-xchacha-keychain-snapshot-vault.md) | 未实施／旧模型 | 当前备份未实现本文的 XChaCha20/Keychain 容器；旧事务快照模型已退出当前范围。 |
| [0017 · 采用版本化 postcard 快照 payload](0017-versioned-postcard-snapshot-payload.md) | 未实施／旧模型 | 当前备份不采用本文的 postcard payload；旧事务快照模型已退出当前范围。 |
| [0018 · 适配器包采用 JCS manifest、确定性无压缩 USTAR 与 detached signature](0018-jcs-ustar-adapter-bundle.md) | 已退出当前范围 | 动态 Adapter bundle 已随 ADR-0020 退出；本文签名和归档格式没有当前产物。 |
| [0019 · MVP 仅支持 macOS 15+ Apple Silicon，并维护单一 arm64 发布轨](0019-macos-15-arm64-only.md) | 部分有效 | macOS 15+ arm64 支持基线仍适用；DMG、签名更新产物和发布验证尚未建立。 |
| [0020 · 架构 pivot —— 采用 cc-switch 式直接命令 + SQLite SSOT/投影 资产管理架构](0020-ccswitch-architecture-pivot.md) | 部分有效 | 直接命令、按资产服务及 React Query 仍适用；指令预设和统一 Subagent 投影已被单一 AGENTS.md 与 ADR-0021 原生模型替代。 |
| [0021 · Subagent 按 Agent 原生格式管理](0021-native-subagent-management.md) | 有效 | 单 Agent 原生定义、显式接管、摘要保护、备份与原生启停仍适用。 |
| [0022 · Skills 目标 × Agent 使用矩阵](0022-skill-scope-matrix.md) | 有效 | 在目标绑定资产上增加矩阵、批量分配及已核对的原生项目排除；范围和证据见现行产品说明。 |
| [0023 · 项目 Skill 排除与 Codex 启动](0023-project-skill-exclusion-launch.md) | 有效 | OpenCode 有序原生权限；Codex 使用明确的项目 CLI 启动入口，扩展 ADR-0022 的接入范围。 |

后续重要决定新增 ADR，注明替代对象与范围，不追改历史理由。已退出范围的方案没有自动实施授权，未实施的发布设计不能当作当前能力。
