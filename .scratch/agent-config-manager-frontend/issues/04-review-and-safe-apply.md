# FE-04 — 审查与安全应用闭环

**What to build:** 用户能够把一个脏草稿准备为可审查差异，明确确认后安全应用，并处理阻断、冲突、失败、回滚和恢复点。

**Blocked by:** FE-03 — 本地草稿编辑

**Status:** blocked

**Primary contract fixtures:** `FX-05 review-git-drift-conflict`、`FX-16 asset-write-result-branches`、`FX-18 gateway-prepare-unavailable`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] “审查更改”调用 `prepare`，且准备过程不创建快照或写入磁盘；
- [ ] `prepare` 的 transport/protocol failure 返回 `PrepareFailed(GATEWAY_UNAVAILABLE)`；保留草稿、目标、当前文件、文件树、检查器和展开上下文，不产生 prepared ID、token、差异或 `apply`，且只有显式重试才能再次准备；
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
- [ ] 测试覆盖四类 `PrepareResult`、三类 `OperationResult` 及 reprepare；FX-18 由 mock 与真实 adapter 复用同一契约断言，不把 mock 返回当作已发生 transport failure 或磁盘写入的证据。

## 验证命令契约

**状态：** `planned / unverified`。统一入口为 `npm run verify:ticket -- FE-04`；失败证据写入 `.artifacts/verification/FE-04/<run-id>/`。

**前置条件：** FE-03 已完成并留存本地草稿证据；`FX-05 review-git-drift-conflict`、`FX-16 asset-write-result-branches`、`FX-18 gateway-prepare-unavailable` 及其敏感占位值可在每次运行新建的隔离临时原生单元中复现。不得触碰用户项目、真实 Git 工作树或 Agent 配置。

**预计层级：**

- L0：本切片相关的静态、类型与生成产物一致性门禁；
- L1：四类 `PrepareResult`、三类 `OperationResult`、reprepare 与 FX-05/FX-16/FX-18 的共享 `FrontendGatewayContract` 断言；
- L2：以 scripted mock `FrontendGateway` 驱动三项 fixture 的审查、确认、冲突与结果浏览器旅程；
- L3：专用 Tauri 测试构建在隔离临时原生单元中执行 prepare 无副作用、apply revision 重校验、冲突及恢复点 tracer；
- PF-04：以 `review-conflict` descriptor 校准 prepare、统一差异、未变区段展开和冲突 surface 的首条 baseline。

**通过判据：** 命令在上述前置条件下退出成功；三项 fixture 覆盖的原因码、遮蔽、无 prepared operation 的 `PrepareFailed`、reprepare、确认前不写入、Applied/Blocked/Failed 与 rollback/恢复点均符合票据；L3 记录真实 command/event、隔离文件事实和恢复结果；PF-04 留存 fixture digest、运行环境和原始样本，数值预算只在实际校准后生效。

**Provenance 边界：** FX-18 的 mock PASS 只证明共享契约，不证明 transport failure 或磁盘写入；实际 IPC/write credit 仅来自 L3 的真实 WebView/Core 路径，且只限隔离临时原生单元。L3 不等同生产签名、DMG 或 L4，未实际运行前，本命令与 PF-04 均保持 `planned / unverified`。
