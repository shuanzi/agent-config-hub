# FE-03 — 本地草稿编辑

**Acceptance state:** `Frozen (2026-08-10; planning acceptance only)`

**Ticket Status:** `ready-for-agent`（不是 `done`；本票据尚未开始实现或产生自身 closure evidence）

**Direct blocker evidence:** FE-02 已 `done`；其 final run `20260815T130239344Z-p33436-000` 的 accepted-with-waiver 记录见 `.artifacts/verification/FE-02/latest-clean-subject-accepted-with-waiver.json`。

**Primary contract fixture:** `FX-04 dirty-multifile-draft`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§4.3、6–7、9；本票据只冻结 local draft 计划，不包含 `apply`。

- [ ] Skills 只有经明确次级源码编辑才创建 `editAsset` 草稿；多文件、未知字段、注释、附属资源和只读边界如实保留。
- [ ] 长期指令的选择或编辑器聚焦不建草稿；首次实际内容差异才建立 dirty draft，并映射 `editAsset`。无变更退出不确认，脏草稿默认继续编辑。
- [ ] Subagents 只有经明确次级安全编辑才允许 Adapter 已验证可无损往返的字段和原生 Prompt/config 源码进入 `editAsset`；未知/extension/不兼容内容必须 lossless preservation 或 read-only，不能伪装成完整编辑。
- [ ] 三类表面共享一个活动草稿；类型/资产切换、workbench 离开和 locator 提交都走 dirty guard。继续编辑时保持当前草稿/编辑器焦点；仅明确 discard 后才原子切换 type、destination、`AssetRef` 与详情。discard 只清除前端草稿，不调用 `apply` 或写盘。
- [ ] 同一资产内的文件切换或源码/结构化视图切换不提示 dirty guard，并保留 shared draft 与展开状态。
- [ ] read-only、incompatible、unknown、blocked 或 stale 内容禁用编辑并显示稳定原因；敏感与未触及未知原文保持遮蔽/无损。修改敏感段必须持有 revision-bound、短生命周期 `modify` grant；grant 超时、资产切换或 revision 变化后立即失效并重新遮蔽，明文不得进入缓存、事件、日志或 fixture。
- [ ] 草稿不产生 prepared operation、review、confirm、可重放 payload 或写入；locator 的失败、取消和 continue-editing 均不得丢弃草稿或改变 destination。

## 验证命令契约

**状态：** `planned / unverified`；不得在本 planning slice 运行 closure。计划统一入口为 `npm run verify:ticket -- FE-03`，未来失败证据路径为 `.artifacts/verification/FE-03/<run-id>/`。

**计划前置条件：** FE-02 已 `done` 且有其多文件 read evidence；隔离 `FX-04 dirty-multifile-draft` 与敏感占位内容可复现，测试不调用 `apply`。

**计划证据分层：** L0/L1 覆盖三类 `editAsset` draft、首次实际变更、单活动草稿、dirty guard、同资产切换保留、保真/read-only failure path 及 revision-bound `modify` grant 的失效/重新遮蔽；L2 以 scripted mock `FrontendGateway` 跑同一编辑与 grant failure journey；PF-02/PF-03 记录 edit 输入、草稿投影与文件切换的原始样本。**无 L3。**

**计划通过与 provenance 边界：** 未来证据应证明 discard 无写、continue/discard locator 语义与未知/extension preservation or read-only。L0/L1/L2 与 PF 不取得 actual Tauri IPC、磁盘写入、真实 Adapter 或 production artifact credit；mock 草稿/放弃绝不能表述为真实 write。所有计划项在实际运行前仍为 `planned / unverified`。
