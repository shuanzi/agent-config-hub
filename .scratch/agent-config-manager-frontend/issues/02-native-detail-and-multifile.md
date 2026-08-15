# FE-02 — 原生详情与多文件资产

**Acceptance state:** `Frozen (2026-08-10; planning acceptance only)`

**Ticket Status:** `ready-for-agent`

**Direct blocker evidence:** FE-01 已 `done`；provenance-appropriate stable evidence：`.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json`。

**Primary contract fixtures:** `FX-02 multifile-skill-mixed`、`FX-03 executable-hook-unknown`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§3、6–9；本文件只冻结计划验收，不包含编辑或写入实现。

- [x] Skills 以只读结构化详情呈现身份、来源、兼容与四 Agent 状态；原生内容只经明确次级源码查看进入。多文件资产显示 native file tree、主文件优先的稳定选择与只读文本/非文本 surface，不把物理文件提升为资产。
- [x] 长期指令提供 type-specific master-detail Markdown read surface；选择或聚焦不会创建草稿、`prepare`、`apply` 或其他写入意图。
- [x] Subagents 以只读 master-detail 呈现身份、模型、工具、权限、来源与正文；未知、扩展或不兼容内容如实保真或只读，并给稳定原因。
- [x] 路径、生效上下文、来源/覆盖、兼容/漂移、最近变更、恢复点与关键安全状态均可达；仅使用各类型的详情 disclosure/就近状态条，不恢复固定第四 inspector 或其布局合同。
- [x] `FX-03` 仍必须能在 Adapter/wire decode `hook`、保留 unknown fields、报告 `EXECUTABLE_CONTENT_RISK`，并在默认 surface、搜索、事件、日志和 fixture 中 mask 敏感值。Hook、Skill script 与 plugin code 只能静态展示/校验，绝不执行。
- [x] Hook 是 L2 负向可达性：不出现在 MVP 一级导航、global locator、创建入口、详情或转换目的地；没有 Hook 的浏览、编辑、转换正向 journey，也没有 Hook L3 write/PF credit。
- [x] 结构化或 native read 无法无损呈现、未知/非文本内容、遮蔽内容和 `ReadFailed` 必须保留只读/原因 failure path；不得解析实现内部结构或用 mock 结果冒充实际读取。

## 验证命令契约

**状态：** `formal closure failed (non-closure; 2026-08-15)`。Ticket Status 仍为 `ready-for-agent`。用户批准的四份 PF-02／PF-03 versioned budget 已由首次 clean baseline 冻结；正式 run `20260815T001547631Z-p58215-000`（commit `bf62cefd4cf5e82782e21bdb0e4aafb6d9041a62`，起止 clean）以 root exit `1`／manifest `status=fail` 结束：L0／L1／L2／L3 与 PF-02 representative 通过，PF-02 stress 的 `pf02.source.scroll.render_stable` p50 `11.35ms` 超 frozen regression ceiling `8.5ms`，PF-03 两个 profile 因 fail-stop 信号中断而 incomplete。3.11 未完成；3.12 已完成本次独立只读复审但结论为 `NO-GO`，不构成 closure；FE-02 `done` 与 frontier 更新均未完成。

**已复核前置条件：** ARCH-GATE=`closed`；FE-01 已 `done`，并由 `.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json` 提供用户确认可接受的 stable direct-blocker evidence；`FX-02`、`FX-03` 与敏感占位变体只在隔离测试数据根复现，未读取或执行用户内容。

**task-only 功能检查：** L0 `verify-toolchain`、`verify-static` 均 10/10；L1 Rust `fe02_read_surfaces` 10/10，Vitest wire/session 17/17；L2 FX-02 read-only journey 5/5；L3 FX-02 tracer 1/1。L3 同轮 identity 与实际启动的 `src-tauri/target/debug/agent-config-manager` SHA-256 均为 `20e2d01db859d80d673caeba7e8aad46a3259c356aa899f75de3633673cf209f`。

**provenance 与未覆盖边界：** L2 仅为 scripted Mock renderer，不取得 IPC／磁盘 credit；L3 仅证明隔离 synthetic FX-02 经 WebView → IPC → Rust/core → 临时磁盘的 actual multi-file read，明确无 Hook、write、draft、`prepare`、`apply`、production artifact 或 L4 credit。路径／上下文／来源／覆盖／兼容为同一 read snapshot 的权威事实；当前 snapshot 不提供漂移、最近变更或恢复点的权威正向事实，UI 明示 unavailable，未伪造 history/recovery。PF-02 stress 的 frozen-budget comparison failure 是正式 blocker；PF-03 incomplete 不形成 pass 或 fail 的性能结论；任何已通过层级均不得替代正式 closure。

**独立只读复审（2026-08-15）：** 结论为 `NO-GO`，无 P0；有效 finding 包括三个 P1（正式 closure failure；普通标点／Unicode 多文件路径可折叠成相同 `fileId` 并读错文件；文件类型检查与 `fs::read` 分离造成 symlink swap TOCTOU）和三个 P2（SIGINT／SIGTERM 只转发当前子进程，使后续 PF 与 manifest 的 aborted／completed 语义失真；PF-02 stress 的 n=10 双峰样本无法从现有证据区分 collector 帧相位、宿主调度或产品回归；本票 evidence ledger 曾滞后于正式失败事实，已由本段纠正）。复审不构成 closure；代码级 P1、信号语义 P2、PF blocker 与 PF-03 incomplete 均未解决，禁止标记 `done` 或更新 FE-03／FE-10 frontier。
