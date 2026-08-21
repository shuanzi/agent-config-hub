# FE-04 — 审查与安全应用闭环

**Acceptance state:** `Frozen (2026-08-10; planning acceptance only)`

**Ticket Status:** `ready-for-agent`（不是 `done`；FE-03 已按其自身 MVP record `done` 并解除直接 blocker）。

**Direct blocker evidence:** `ARCH-GATE=closed`；FE-03 的 MVP completion record（`27cf50a…`、`b0e3e14…`、自身 L0/L1/必要 L2 和独立功能复审）已满足。该记录不借给 FE-04 功能或 L3 credit。

**Primary contract fixtures:** `FX-05 review-git-drift-conflict`、`FX-16 asset-write-result-branches`、`FX-18 gateway-prepare-unavailable`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§3.2–3.3、4.3、5–7、9，以及冻结的 `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1_prepared-secret_addendum_2026-08-21.md`；本文件冻结未来 transaction 计划，不宣称已经写入。

**Frozen prepared-secret input:** PR #24/#25 已冻结的 addendum 是本票 MVP contract 的直接输入：prepare 对零到多个 segment-bound pairing 全部完成权威验证后才建立 core entry；same-target revision drift、conflict 或 explicit reprepare 清除旧 core entry、旧 grant 与旧 bound identity，frontend 仅保留同一 target 的 replacement 作为 unbound input，explicit reprepare 必须取得 newly authorized grant；只有 asset/file/segment/scope/surface target identity 改变、TTL 到期或 cancel/discard 才立即清零 frontend/core 两侧。apply single-use，成功后 authoritative reread cleanup，crash 只允许 loss/reprepare。该规则不新增 command、持久化或第二事实源，且必须由本票自身 L1/L2/L3 证明，不可借用 PR、freeze 或其他 ticket credit。

- [ ] 所有写入走 `prepare → review → confirm → apply` 单资产、单目标安全事务；`prepare` 无副作用，review/confirm 必须展示目标、native location、mapping/capability、diff、Git 风险上下文、恢复点与所有 resolved affected contexts。
- [ ] `PrepareFailed(GATEWAY_UNAVAILABLE)` 必须保留草稿、目标、文件、展开与辅助信息上下文，不产生 prepared ID、token、diff 或 `apply`；只有显式 retry 可重试。Conflict、Blocked、Failed、rollback/recovery 及 apply 成功后 reread 失败均保留稳定、可解释 failure/result path，前端不得乐观改写事实或自行重试。
- [ ] target scope 或 native location 无论在首次 `prepare` 前或已 prepared 后变化，均先对新 target authoritative reread presence、activation 与 applicability，重新 remap；旧 mapping、prepared operation、review 与 confirm 全部失效，必须重新 prepare/review 后才可 apply。
- [ ] 外部磁盘 revision 或 target occupancy 变化同样使旧 operation、`OperationConcurrencyToken`、review 与 confirm 失效并返回 `REPREPARE_REQUIRED`；保留草稿，必须重新 `prepare → review → confirm`。prepared operation 是 single-use，且流程只读取 Git 风险上下文，不执行 Git 操作。
- [ ] 必要恢复点的创建或持久化失败必须在触碰原生资产前阻断；不得生成可 apply 的 operation 或以缺失恢复点继续写入。
- [ ] 项目视图中适用的 global asset 始终以 global `AssetRef`/`NativeOwnership` 原生写回；展示所有 resolved affected contexts，绝不创建项目副本。unknown/blocked/stale 一律 fail-closed。
- [ ] Skill `present + disabled` 的重新启用、`present + enabled` 的停用，只有已验证 native activation semantics 才映射 `editAsset`；其他情况 disabled/blocked，永不 `prepare`/`apply`，也绝不回落为 delete。absence 的 install/convert 与 delete 保持各自独立票据边界。
- [ ] locator context switch 若在 prepared/reviewing/confirming/reprepareRequired，必须先显式退出事务并使旧事务失效；applying 或结果未知时必须阻断切换并显示稳定原因。允许切换时也不得把旧 operation/diff/summary 带入新 `AssetRef`/context。
- [ ] 敏感 diff、summary、finding、result 与测试证据持续遮蔽；关键安全状态在就近表面可见，不恢复固定第四 inspector。
- [ ] 零到多个 segment-bound prepared-secret pairing 必须在全配对权威验证通过后才建立 core entry；same-target revision drift/conflict/explicit reprepare 必须清除旧 core entry、旧 grant 与旧 bound identity，frontend 仅保留同一 target replacement 作为 unbound input，explicit reprepare 必须取得 newly authorized grant；只有 asset/file/segment/scope/surface target identity 改变、TTL 到期或 cancel/discard 才清零 frontend/core 两侧；apply single-use、authoritative reread cleanup 与 crash loss 均不得回退为持久化或恢复 secret。

## 验证命令契约

**MVP 状态：** `ready-for-agent / unverified`。本票必须先完成最小实现、L0/L1、必要 L2、真实产品安全负例、以及以下 isolated L3，后经独立功能复审直接成为 `done`。PF-04、逐票 `verify:ticket`、formal comparison 与 release hardening 为统一 release/optimization 的 deferred 工作，不是 MVP blocker。

**MVP 前置条件：** FE-03 已 `done` 且有其自身记录；三个 fixture 和敏感占位值可在每次运行新建的隔离临时 native unit 中复现，不得触碰真实用户项目、Git worktree 或 Agent 配置。

**MVP 证据分层：** L0/L1 覆盖事务、重验、四类 `PrepareResult`、三类 `OperationResult`、native activation mapping、diff/summary/finding/result/evidence 的敏感遮蔽断言，以及外部 revision/target occupancy 变化的 `REPREPARE_REQUIRED`、single-use prepared operation 和恢复点 pre-write 阻断；L2 以 scripted mock 跑 review/confirm/conflict/result 与上述失效/阻断 journey；L3 在 isolated temp 输入上跑 prepare/apply/conflict/recovery、外部 revision/occupancy 变化和恢复点持久化失败，并断言实际结果与收集的 evidence 同样遮蔽。PF-04 `review-conflict` 仅为 deferred release/optimization 输入。

**MVP 通过与 provenance 边界：** 必须保留 FX-05/16/18 的 failure/recovery、scope/location reread-remap、global native writeback 与 no-delete fallback，并在适用 L1/L2/L3 证明 diff、summary、finding、result 与 evidence 均不含敏感明文。L2 mock 仅证明 journey；actual runtime/write credit 只可来自 L3 穿过真实 WebView/Core/IPC 的隔离输入，仍不证明真实用户项目、配置、production artifact、签名、DMG 或 L4。当前所有层级均为 `planned / unverified`，不以 deferred hardening 冒充通过。
