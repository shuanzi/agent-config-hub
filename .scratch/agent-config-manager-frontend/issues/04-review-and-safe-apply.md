# FE-04 — 审查与安全应用闭环

**Acceptance state:** `Frozen (2026-08-10; planning acceptance only)`

**Ticket Status:** `blocked`（不是 `done`；等待 FE-03 的 `done` 与 provenance-appropriate evidence）

**Blocked by:** FE-03 — 本地草稿编辑。

**Primary contract fixtures:** `FX-05 review-git-drift-conflict`、`FX-16 asset-write-result-branches`、`FX-18 gateway-prepare-unavailable`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§3.2–3.3、4.3、5–7、9；本文件冻结未来 transaction 计划，不宣称已经写入。

- [ ] 所有写入走 `prepare → review → confirm → apply` 单资产、单目标安全事务；`prepare` 无副作用，review/confirm 必须展示目标、native location、mapping/capability、diff、Git 风险上下文、恢复点与所有 resolved affected contexts。
- [ ] `PrepareFailed(GATEWAY_UNAVAILABLE)` 必须保留草稿、目标、文件、展开与辅助信息上下文，不产生 prepared ID、token、diff 或 `apply`；只有显式 retry 可重试。Conflict、Blocked、Failed、rollback/recovery 及 apply 成功后 reread 失败均保留稳定、可解释 failure/result path，前端不得乐观改写事实或自行重试。
- [ ] target scope 或 native location 无论在首次 `prepare` 前或已 prepared 后变化，均先对新 target authoritative reread presence、activation 与 applicability，重新 remap；旧 mapping、prepared operation、review 与 confirm 全部失效，必须重新 prepare/review 后才可 apply。
- [ ] 外部磁盘 revision 或 target occupancy 变化同样使旧 operation、`OperationConcurrencyToken`、review 与 confirm 失效并返回 `REPREPARE_REQUIRED`；保留草稿，必须重新 `prepare → review → confirm`。prepared operation 是 single-use，且流程只读取 Git 风险上下文，不执行 Git 操作。
- [ ] 必要恢复点的创建或持久化失败必须在触碰原生资产前阻断；不得生成可 apply 的 operation 或以缺失恢复点继续写入。
- [ ] 项目视图中适用的 global asset 始终以 global `AssetRef`/`NativeOwnership` 原生写回；展示所有 resolved affected contexts，绝不创建项目副本。unknown/blocked/stale 一律 fail-closed。
- [ ] Skill `present + disabled` 的重新启用、`present + enabled` 的停用，只有已验证 native activation semantics 才映射 `editAsset`；其他情况 disabled/blocked，永不 `prepare`/`apply`，也绝不回落为 delete。absence 的 install/convert 与 delete 保持各自独立票据边界。
- [ ] locator context switch 若在 prepared/reviewing/confirming/reprepareRequired，必须先显式退出事务并使旧事务失效；applying 或结果未知时必须阻断切换并显示稳定原因。允许切换时也不得把旧 operation/diff/summary 带入新 `AssetRef`/context。
- [ ] 敏感 diff、summary、finding、result 与测试证据持续遮蔽；关键安全状态在就近表面可见，不恢复固定第四 inspector。

## 验证命令契约

**状态：** `planned / unverified`；不得在本 planning slice 运行 closure。计划统一入口为 `npm run verify:ticket -- FE-04`，未来失败证据路径为 `.artifacts/verification/FE-04/<run-id>/`。

**计划前置条件：** FE-03 已 `done` 且有其自身证据；三个 fixture 和敏感占位值可在每次运行新建的隔离临时 native unit 中复现，不得触碰真实用户项目、Git worktree 或 Agent 配置。

**计划证据分层：** L0/L1 覆盖事务、重验、四类 `PrepareResult`、三类 `OperationResult`、native activation mapping、diff/summary/finding/result/evidence 的敏感遮蔽断言，以及外部 revision/target occupancy 变化的 `REPREPARE_REQUIRED`、single-use prepared operation 和恢复点 pre-write 阻断；L2 以 scripted mock 跑 review/confirm/conflict/result 与上述失效/阻断 journey，并断言所有可见 diff/summary/finding/result/evidence 均遮蔽；L3 在 isolated temp 输入上跑 prepare/apply/conflict/recovery、外部 revision/occupancy 变化和恢复点持久化失败，并断言实际结果与收集的 evidence 同样遮蔽；PF-04 `review-conflict` 记录 prepare、diff 与 conflict surface 的原始样本并在实际校准后冻结预算。

**计划通过与 provenance 边界：** 未来验证必须保留 FX-05/16/18 的 failure/recovery、scope/location reread-remap、global native writeback 与 no-delete fallback，并在适用 L1/L2/L3 断言和通过判据中证明 diff、summary、finding、result 与 evidence 均不含敏感明文。L2 mock 仅证明 journey；actual runtime/write credit 只可来自 L3 穿过真实 WebView/Core/IPC 的隔离输入，仍不证明真实用户项目、配置、production artifact、签名、DMG 或 L4。所有层级和 PF 目前均为 `planned / unverified`。
