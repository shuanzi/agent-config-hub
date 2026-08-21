## Context

动机见 [proposal.md](proposal.md)。已接受的架构已有唯一的 `FrontendGateway` seam：
`frontend_gateway_prepare` 执行无副作用的 preparation，`frontend_gateway_apply` 仅接收
prepared-operation identity 与 revision-bound concurrency token。其 journal 有意只记录无正文的
recovery/progress state；未知的 apply result 已通过 `OperationProgressQuery`、observe、event 与
invalidation 对账。

当前 FE-03 grant requirement 将敏感值限定在 frontend-local buffer。FE-04 review-and-apply flow
需要一个狭窄例外：权威 prepare 验证所有敏感修改后，GatewayCore 需要持有相同的已验证值，直到
重新验证并消费 prepared operation。delta specs 定义公开行为：
`fe03-edit-performance-protocol` 负责位置与 non-persistence，`skill-agent-state-control` 唯一负责
`editAsset` lifecycle 与既有 `PrepareResult` classification。

## Goals / Non-Goals

**Goals:**

- 定义单次 prepare-time transfer：将零到多个独立绑定的 sensitive replacement/grant 配对传入
  operation-local core entry。
- 在 review 和 confirm 期间保持 frontend private sensitive buffer，包括有意保留未绑定
  replacement input 以供 explicit reprepare 的 same-target revision-drift path。
- 使 invalidation、single-use apply、authoritative reread cleanup、crash behavior 与
  no-persistence boundary 足够精确，供后续 FE-04 implementation review 使用。
- 仅以 documentation 与 static review 重新关闭既有 ARCH stop condition：不引入新的 command、
  trust boundary、serialization fact source、progress domain 或 recovery payload。

**Non-Goals:**

- 本 change 不实现 GatewayCore entry、frontend buffer、wire change、test、fixture、PF run、
  L3 run、ticket verification 或 recovery behavior。
- 它不持久化 secret、不修改无正文 recovery journal，也不创建替代 authorization source、runner、
  evaluator、manifest、provenance、hash 或 history system。
- 它不修改 FE-03/FE-04 formal status、done state、DAG/frontier、RELEASE-GATE、historical
  evidence 或 acceptance records。

## Decisions

### 1. 将既有 prepare/apply transaction 作为唯一 transfer 与 consumption path

prepare request 携带零到多个
`{SensitiveSegmentRef, replacement, opaque grant, asset/file/segment/scope/surface/revision/TTL identity}`
配对。GatewayCore 在创建 prepared operation 前，针对 current facts 验证每个配对。任一配对失败
时不得创建 core entry 或可 apply prepared state，并且 MUST 沿用既有封闭 `PrepareResult`：
current-fact conflict 返回 `ConflictResult`；可由既有 validation 表达的授权或事实阻断返回
带 blocking `ValidationFinding` 的 `PreparedOperation(canApply=false)`；只有 transport/protocol
无法形成可信结果才返回 `PrepareFailed`。上述任一未通过结果均不含 core secret，且不得 confirm
或 apply；`PrepareFailed` 继续保留 frontend buffer、用户输入、目标与 workflow context。

core entry 只关联所产生的 prepared operation，且不得被 serialized、persisted、recovered、
shared，或作为通用 secret collection 被 enumerated。`apply` 继续只接收 `preparedOperationId`
和 `OperationConcurrencyToken`；它只 claim 该 entry 一次，重新验证所有 current facts/revisions/
grants，然后使用已准备的值或使 operation 失效。

这避免了两个已拒绝的替代方案：

- 新的 secret-submit command 或 apply plaintext payload 会增加 IPC/write surface，并割裂既有
  transaction boundary。
- 将值只保留在 frontend 会使 GatewayCore 无法执行既有的 authoritative apply-time revalidation，
  除非创建第二事实源。

### 2. 将 frontend 与 core memory 视为独立且受限的 buffers

frontend buffer 在 review/confirm 期间保持 private 和 non-serializable；它不是 shared
`editAsset` draft。core prepared-secret entry 只在 prepare 权威验证成功后建立。两侧只在 operation
受控生命周期内持有精确敏感值，并被 protocol delta 排除在每个 persistent、observable 与 evidence
surface 之外。

state boundary 对 same-target revision drift 有意采用非对称行为：

| 触发条件或状态                                             | Frontend private buffer                                      | Core prepared-secret entry             | Transaction 结果                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------- |
| prepare 前 / transport-protocol `PrepareFailed`            | 保留受控 user input                                          | 无                                     | 无 prepared/review/confirm state                            |
| prepare 成功至 review/confirm                              | 保留受控 input                                               | 保留此 prepared operation 的已验证配对 | 可用带敏感输出遮蔽的 review/confirm                         |
| same-target revision drift、conflict 或 explicit reprepare | 只保留 replacement 作为 unbound input；丢弃旧 grant/identity | 清零                                   | 旧 prepared/review/confirm 失效；必须 explicit reprepare    |
| cancel/discard、target identity change 或 TTL expiry       | 立即清零                                                     | 立即清零                               | 重新遮蔽并使所有旧 state 失效                               |
| apply success 加 authoritative reread                      | 清零并重新遮蔽                                               | 清零                                   | 只在 reread 后更新可见 facts                                |
| core process crash                                         | 仅在 frontend state 仍受控时保留                             | 丢失                                   | explicit reprepare；若 frontend state 也丢失则重新输入/授权 |

这里的真实 target identity change 是 asset、file、segment、scope、surface 或 TTL。未改变 target 的
revision drift 仍使先前 authorization 和 core entry 失效，但不会销毁用户的 unbound replacement
input。此区分绝不允许保留旧 grant、identity binding 或 core secret。

### 3. 在既有路径处理 recovery 与 unknown result

recovery journal 继续只持久化 operation identity、phase、stable reason、revision summary 与 opaque
handles。它绝不接收 secret plaintext、grant、diff、draft、prepared-secret entry 或 replayable
payload。因此 crash 不得从 disk 恢复 prepared secret。

若 transport result unknown，frontend 既不 retry apply，也不构造新的 progress result。它保持在
既有 `OperationProgressQuery`/observe/event/invalidation reconciliation path。这保持 single-use 与
no-duplicate-write behavior。

### 4. 保持既有 architecture 与 ticket gates

architecture check 仅限于在后续 planning-doc/static-review work 中证明上述机制符合既有 command、
trust 与 serialization boundaries。若 implementation analysis 需要新的 command、trust boundary
或 serialization source of truth，`ARCH-GATE` 会变为 `reopen-required`，FE-04 recovery 停止并
等待新的用户决定。任何 planning artifact、Draft PR、merge 或 static validation 都不授予 FE-04
implementation、L3、PF、`verify:ticket`、closure 或 frontier credit。

## Risks / Trade-offs

- [Core 在 prepared operation 中持有敏感数据] → 将其限于 non-persistent、non-serializable、
  non-enumerable entry；在每个 terminal 或 invalidating path 清零。
- [Multi-segment prepare 存在 partial validation risk] → 在创建任何 entry 前验证全部配对；任一
  配对未通过时沿用既有 `PrepareResult`、不形成 core entry 或可 apply prepared operation，且只有
  transport/protocol 无可信结果才使用 `PrepareFailed`。
- [Revision drift 要求用户再次操作] → 对未改变 target 只保留受控、unbound frontend replacement
  input，并要求 explicit reprepare。
- [Target switch 或 TTL expiry 可能保留过期 plaintext] → 任一者均为立即双侧清零与重新遮蔽的
  boundary，不是 reprepare shortcut。
- [Interrupted apply 有 ambiguous transport state] → 复用既有 progress 与 invalidation
  reconciliation semantics；绝不 auto-retry。
- [Process crash 丢失 core entry] → 明确丢失：从仍受控的 frontend state reprepare，或重新输入/
  授权；不增加 recovery persistence。

## Migration Plan

1. 在未来另行授权的 apply 中，仅更新最小 architecture addendum 与适用 Frozen planning truth
   chain；不得改写 historical evidence 或 completed checkboxes。
2. 以 documentation 与 static review 验证 prepared-secret lifecycle 并重新关闭 ARCH stop
   condition。若发现需要新的 command、trust boundary 或 serialization source，停止并请求新的
   architecture decision。
3. 只有在用户 explicit acceptance/freeze 且 Draft PR merge 后，暂停的 FE-04 work 才可在新的
   main branch 恢复。
4. 恢复后的 ticket 独立执行 3.25–3.28 RED→GREEN、L0/L1/L2 与 isolated-temp L3；本
   prerequisite 不替代其中任何 gate。
5. PF-04、`verify:ticket`、3.29–3.30、formal closure 与 frontier work 均保持后置、独立阶段，
   本 change 不执行它们。
