# FE-03 — 本地草稿编辑

**Acceptance state:** `Frozen (2026-08-10; planning acceptance only)`

**Ticket Status:** `done`（MVP gate 已完成；不等同 release-ready）。依照已冻结的 MVP 治理，本票据直接以最小实现、L0/L1、必要 L2、真实 grant/敏感明文负例和独立功能复审为 `done`；不新增 `functional-done` 或其他并行状态。

**MVP completion record（2026-08-21）：** 可审计实现 commit 为 `27cf50a024947eac08533ef88e537a3613d0dec4`，随后由 `b0e3e1464411965661f94c185f2e737b81a48904` 修复最终 review gaps。实际功能验证记录为：FE-03 focused L1 7 files/20 PASS、mock browser L2 连续两轮各 2/2 PASS、focused Rust 19/19 PASS、定向 V4 wire vectors 12/12 PASS；最终修复再复验 FE-03 L1 4 files/16 PASS 与 browser L2 4 PASS。PR #22 与 PR #27 的独立 Standards/Spec review 均收敛为 P0=P1=P2=P3=0。

**Deferred release hardening：** 未运行 L3、actual Tauri IPC、磁盘写入、真实授权、真实 write、PF-02/PF-03 edit、budget/formal comparison 或 `npm run verify:ticket -- FE-03`；这些不被表述为通过、formal closure 或 release-ready。FE-03 不取得上述 credit，grant consumption 与首条真实 write transaction 仍由 FE-04 的 isolated L3 负责。

**Direct blocker evidence:** FE-02 已 `done`；其 final run `20260815T130239344Z-p33436-000` 的 accepted-with-waiver 记录见 `.artifacts/verification/FE-02/latest-clean-subject-accepted-with-waiver.json`。

**Primary contract fixture:** `FX-04 dirty-multifile-draft`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§4.3、6–7、9；本票据只冻结 local draft 计划，不包含 `apply`。

- [x] Skills 只有经明确次级源码编辑才创建 `editAsset` 草稿；多文件、未知字段、注释、附属资源和只读边界如实保留。
- [x] 长期指令的选择或编辑器聚焦不建草稿；首次实际内容差异才建立 dirty draft，并映射 `editAsset`。无变更退出不确认，脏草稿默认继续编辑。
- [x] Subagents 只有经明确次级安全编辑才允许 Adapter 已验证可无损往返的字段和原生 Prompt/config 源码进入 `editAsset`；未知/extension/不兼容内容必须 lossless preservation 或 read-only，不能伪装成完整编辑。
- [x] 三类表面共享一个活动草稿；类型/资产切换、workbench 离开和 locator 提交都走 dirty guard。继续编辑时保持当前草稿/编辑器焦点；仅明确 discard 后才原子切换 type、destination、`AssetRef` 与详情。discard 只清除前端草稿，不调用 `apply` 或写盘。
- [x] 同一资产内的文件切换或源码/结构化视图切换不提示 dirty guard，并保留 shared draft 与展开状态。
- [x] read-only、incompatible、unknown、blocked 或 stale 内容禁用编辑并显示稳定原因；敏感与未触及未知原文保持遮蔽/无损。修改敏感段必须持有 revision-bound、短生命周期 `modify` grant；grant 超时、资产切换或 revision 变化后立即失效并重新遮蔽，明文不得进入缓存、事件、日志或 fixture。
- [x] 草稿不产生 prepared operation、review、confirm、可重放 payload 或写入；locator 的失败、取消和 continue-editing 均不得丢弃草稿或改变 destination。

## 验证命令契约

**MVP 已执行检查：** L0/L1 覆盖三类 `editAsset` draft、首次实际变更、单活动草稿、dirty guard、同资产切换保留、保真/read-only failure path 及 revision-bound `modify` grant 的失效/重新遮蔽；L2 以 scripted mock `FrontendGateway` 跑编辑与 grant failure journey。实际命令与完整结果保留在 [TEST-EXECUTION-ORDER](../TEST-EXECUTION-ORDER.md) 的 FE-03 MVP record；本治理迁移不重跑测试。

**MVP 通过与 provenance 边界：** discard 无写、continue/discard locator 语义与 unknown/extension preservation or read-only 已由本票自身功能检查覆盖。L0/L1/L2 只证明 contract/mock browser 行为，绝不取得 actual Tauri IPC、磁盘写入、真实 Adapter、真实 grant、真实 write 或 production artifact credit。

**统一 release/optimization：** PF-02/PF-03 edit、任何预算、formal comparison 与 `npm run verify:ticket -- FE-03` 均为 `deferred`；若未来获授权，失败证据可位于 `.artifacts/verification/FE-03/<run-id>/`，但当前不存在本票 formal/release 结论。
