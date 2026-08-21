# Agent Config Manager：技术方案 v0.1 prepared-secret addendum（2026-08-21）

> 状态：已完成 OpenSpec `define-fe04-ephemeral-prepared-secrets` 的 prerequisite
> documentation/static review；本文件只补充可审计的架构证据和 stop condition，不改写既有
> `ARCH-GATE` 状态、历史结论、ticket、tracker 或 runtime evidence。
>
> 冻结来源：用户已明确将 PR #24 中的精确 prepared-secret 规则视为正式验收与冻结；该 PR 的
> head `4159a4cb6f1abf58c4b5f19db2daab9477d4bcf0` 已合并为
> `37cf232ac4c82eee1ca3dde75668dd7c335df150`。

## 1. 范围与 Frozen planning truth chain

本 addendum 只固化暂停中的 FE-04 在恢复后必须遵守的 prepared-secret prerequisite。事实链依次为：

1. 冻结的[产品决策基线 v0.2](../product/Agent_Config_Manager_MVP_产品决策基线_v0.2.md)；
2. 冻结的[前端契约 v0.2](../frontend/Agent_Config_Manager_前端契约_v0.2.md)；
3. 已验收的[技术方案 v0.1](Agent_Config_Manager_MVP_技术方案_v0.1.md)及其
   [2026-08-10 影响复核](Agent_Config_Manager_MVP_技术方案_v0.1_影响复核_addendum_2026-08-10.md)；
4. 本 change 的
   [`fe03-edit-performance-protocol` delta capability](../../openspec/changes/define-fe04-ephemeral-prepared-secrets/specs/fe03-edit-performance-protocol/spec.md)
   与
   [`skill-agent-state-control` delta capability](../../openspec/changes/define-fe04-ephemeral-prepared-secrets/specs/skill-agent-state-control/spec.md)；
5. 恢复后的 FE-04 原 ticket、runtime evidence 与各自独立 gate。

本文件只在第 3 与第 4 项之间增加交叉引用和 static-review 结论，不修改前四项的历史正文，也不把
planning、merge 或静态检查提升为第 5 项的实现证据。

## 2. 既有 seam 内的 prepared-secret lifecycle

[ADR-0003](adr/0003-explicit-gateway-ipc.md) 已固定三个 command 和单一 invalidation event；
[ADR-0005](adr/0005-hybrid-private-persistence.md) 已固定 prepared operation 不持久化且 journal
不保存写入正文。prepared-secret 必须完全留在这些既有边界内：

- 一次既有 `frontend_gateway_prepare` 可提交零到多个 replacement/opaque `modify` grant 配对；
  每项都绑定精确 `SensitiveSegmentRef` 及 asset/file/segment/scope/surface/revision/TTL identity，
  不限制为单 segment 或单文件。GatewayCore 在建立 prepared operation 前验证全部配对。
- 未全部通过时沿用既有封闭 `PrepareResult`：current-fact conflict 为 `ConflictResult`；可由既有
  validation 表达的授权或事实阻断为带 blocking `ValidationFinding` 的
  `PreparedOperation(canApply=false)`；只有 transport/protocol 无可信结果才是
  `PrepareFailed`。这些结果均不得建立 core prepared-secret entry、confirm 或 apply；
  `PrepareFailed` 保留 frontend 私有输入、目标与 workflow context。
- prepare 成功后，frontend-private、non-serializable buffer 在 review/confirm 期间保留受控输入；
  GatewayCore 只在关联 prepared operation 的 non-persistent、non-serializable、
  non-enumerable in-process entry 中保留已验证配对。两者都不是 shared draft 或事实来源。
- `frontend_gateway_apply` 继续只接收既有 `preparedOperationId` 与
  `OperationConcurrencyToken`。GatewayCore apply 前重验 current revision、current facts 与
  grants；prepared operation 及其 secrets 只能 single-use，不得自动重发 apply。
- same-target revision drift、conflict 或 explicit reprepare 清零旧 core entry、grant 与绑定
  identity；frontend 只可保留 replacement 作为 unbound input，并要求用户显式 reprepare。
- asset/file/segment/scope/surface target identity 变化、TTL 到期或 cancel/discard 时立即清零
  frontend/core 两侧并重新遮蔽；不得保留 replacement、grant 或旧 prepared/review/confirm。
- apply 成功后，仅在受影响事实完成 authoritative reread 时清零两侧 buffer、重新遮蔽并更新
  可见事实。transport result unknown 只复用既有 `OperationProgressQuery`、observe、event 与
  invalidation 对账，不产生第二次 apply 或新的 progress domain。
- core process crash 必然丢失 prepared-secret entry；只可从仍受控的 frontend input 显式
  reprepare，否则重新输入并重新授权，不得从 disk、journal、snapshot 或 recovery payload 恢复。

## 3. Zero-persistence、observability 与 evidence static review

docs/static review 确认 prepared secret、grant、replacement、core entry 及其可重放表示均不得进入：

- SQLite 持久表或派生表、journal、snapshot、recovery payload/manifest；
- shared/persisted draft、session snapshot、cache 或任何 serialization surface；
- 日志、错误文本、诊断、analytics、搜索、事件或其他可观察面；
- fixture、vector/golden、PF artifact 或任何 evidence。

journal 继续只保存无正文的 operation identity、阶段、稳定原因、revision 摘要与 opaque handle；
它不得保存 draft、diff、敏感明文、grant、prepared-secret entry 或完整可重放写入 payload。
planning、L0/L1/L2 或 PF 中的 mock 只能模拟 grant 已存在或已失效，不签发授权、不保存敏感值，
也不取得 actual authorization credit。

## 4. ARCH stop condition 的 additive 复核

本次 static review 的逐项结论如下：

| 复核项 | 结论 |
| --- | --- |
| 新 command | 不需要；继续使用 `frontend_gateway_prepare` 与 `frontend_gateway_apply`。 |
| apply plaintext | 不需要；apply payload 仍只有 prepared operation ID 与 concurrency token。 |
| 新 trust boundary | 不需要；仍是 UI → `FrontendGateway` → ingress → `GatewayCore`。 |
| 新 serialization source | 不需要；Rust-first wire 仍是唯一 wire shape 事实源，prepared secret 不序列化。 |
| 第二事实源 | 不需要；GatewayCore 继续权威重读并验证 current facts，frontend buffer 不授权写入。 |
| 新 progress domain | 不需要；继续复用 `OperationProgressQuery`/observe/event/invalidation。 |

因此本轮只为既有 closed `ARCH-GATE` 增加可审计的复核证据，不伪造状态转换，也不修改
`.scratch/agent-config-manager-frontend/ARCH-GATE.md`。若后续分析需要上述任一新增边界，结论必须是
`ARCH-GATE: reopen-required`，并立即停止 FE-04 恢复，等待新的用户架构决定。

## 5. Credit 与后续停点

本 prerequisite 的文档、static review、用户冻结、PR #24 merge、task checkbox 或后续 PR 均不授予
FE-04 implementation、L0/L1/L2/L3、PF-04、`verify:ticket`、3.25+、formal closure 或 frontier
credit。恢复后的 FE-04 必须在原 ticket 中独立执行 3.25–3.28 public-seam RED→GREEN、分层证据及
所有后置 gate；本 change 不启动或替代这些工作。
