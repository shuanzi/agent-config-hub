## 1. 最小架构与 Frozen planning truth 补充

- [x] 1.1 在后续获授权的 apply 中，仅更新或补充最小 architecture addendum 与适用的 Frozen planning truth chain，固化 approved prepared-secret 边界；不得改写历史 evidence、已完成 checkbox、ticket/tracker 或正式状态。
- [x] 1.2 将零到多个 segment-bound prepare 配对、双侧 ephemeral buffer、same-target revision-drift 的 unbound replacement、target/TTL 清零、single-use apply、authoritative reread cleanup 与 crash loss 明确交叉引用到两项 delta capability，不新增 command、apply plaintext、trust boundary、第二事实源或 progress domain。

## 2. 文档与静态架构复核

- [x] 2.1 以 docs/static review 核对 prepared-secret 不进入 SQLite、journal、snapshot/recovery、draft、session snapshot、cache、可观察面、fixture/vector/golden、PF 或 evidence，且 journal 继续只保存无正文状态。
- [x] 2.2 以 docs/static review 重新关闭 ARCH stop condition；若发现需要新 command、trust boundary 或 serialization source，则标记 `ARCH-GATE: reopen-required` 并停止，等待新的用户架构决定。

## 3. 用户冻结与 FE-04 恢复前置条件

- [x] 3.1 对本 prerequisite artifacts 完成独立只读审查并修复有效 finding，取得用户对精确 prepared-secret 规则的显式验收/冻结；该审查与冻结不授予 implementation、L3、PF、`verify:ticket`、closure 或 frontier credit。
- [x] 3.2 仅在用户冻结后将本 change 的 Draft PR 合并；只有合并后的新 main 才允许暂停中的 FE-04 原 ticket 恢复，且本 change 不自行恢复 FE-04。

## 4. 已吸收的 FE-04 执行 gate

下列勾选只表示本 prerequisite 的剩余任务已归并到 FE-04 与统一 release/optimization；
不表示 FE-04 实现、L0/L1/L2/L3、PF、`verify:ticket`、formal closure 或 frontier 已完成。

- [x] 4.1 **已 absorb。** FE-04 在其既有 ticket 中独立执行 3.26–3.28 的 public-seam RED→GREEN；本 prerequisite 的冻结/静态复审不能替代任何实现检查。
- [x] 4.2 **已 absorb。** FE-04 MVP gate 仍须独立取得 L0/L1/必要 L2 与 WebView→IPC→Core→isolated-temp disk 的 prepare/apply/conflict/recovery/sensitive L3 evidence，并保留其真实边界与无 production artifact credit 的 provenance。
- [x] 4.3 **已 supersede。** PF-04、逐票 `verify:ticket`、formal closure 和 release hardening 移入统一 release/optimization；它们未执行时必须为 deferred，不能阻塞 FE-04 MVP done 或被表述为通过。
- [x] 4.4 **已 absorb。** FE-04 的 MVP contract 与 3.26–3.28 必须直接吸收 `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1_prepared-secret_addendum_2026-08-21.md`：multi-segment pairing 全部经权威验证后才建立 core entry；same-target revision-drift/conflict/explicit reprepare 清除旧 core entry、旧 grant 与旧 bound identity，frontend 仅保留同一 target replacement 作为 unbound input，explicit reprepare 必须取得 newly authorized grant；只有 asset/file/segment/scope/surface target identity 改变、TTL 到期或 cancel/discard 才清零 frontend/core 两侧；single-use、authoritative reread cleanup 与 crash loss 保持不变。该交叉引用不改变 prepared-secret 精确规则，也不授予 implementation、L3、PF、formal 或 frontier credit。
