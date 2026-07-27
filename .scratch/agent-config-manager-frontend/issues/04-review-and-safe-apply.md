# FE-04 — 审查与安全应用闭环

**What to build:** 用户能够把一个脏草稿准备为可审查差异，明确确认后安全应用，并处理阻断、冲突、失败、回滚和恢复点。

**Blocked by:** FE-03 — 本地草稿编辑

**Status:** blocked

**Primary contract fixtures:** `FX-05 review-git-drift-conflict`、`FX-16 asset-write-result-branches`

- [ ] “审查更改”调用 `prepare`，且准备过程不创建快照或写入磁盘；
- [ ] 审查在同一内容主区展示统一差异、资产级摘要和文件级增删量；
- [ ] 统一差异的敏感变化只显示遮蔽标记，所有默认可见差异、摘要、finding、结果和测试证据均不含敏感明文；
- [ ] 多文件审查复用真实文件树，长未变区段可原位展开；
- [ ] 用户可返回此前草稿且不丢失文件、展开和检查器上下文；
- [ ] “应用更改”进入聚焦确认，核对目标、路径、Git 状态和恢复点；
- [ ] `apply` 携带 prepared operation 与其 revision-bound `OperationConcurrencyToken`；
- [ ] 外部变化可安全合并时重新准备，不能证明安全时进入三方冲突；
- [ ] 旧 `preparedOperationId` 或 revision 因外部变化失效时，用户可保留草稿并以最新磁盘事实重新执行 `prepare`；重新审查前不得 `apply` 过期 prepared operation；
- [ ] 应用成功原位展示结果和恢复点，阻断、失败和回滚结果同样原位可解释；
- [ ] Git 状态只提供风险上下文，流程不执行任何 Git 操作；
- [ ] 结果未知时前端不自行重试或宣称取消成功；
- [ ] prepare 的 Conflict 子场景验证当前事实的三方差异及保留/解决/放弃，解决后重新 prepare；apply 的 Applied 子场景验证实际目标、变更摘要与可用恢复点，Blocked 子场景验证原因码和恢复动作，Failed 子场景验证 `notNeeded`、`succeeded` 或 `failed` 的 rollback 结果和适用的恢复点。
- [ ] 测试覆盖上述 `PrepareResult` 与三类 `OperationResult` 及 reprepare，不把 mock 返回当作已发生磁盘写入的证据。
