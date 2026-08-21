## ADDED Requirements

### Requirement: editAsset prepared-secret prepare 与 review 事务

当 `editAsset` 需要敏感修改时，系统 MUST 仅通过既有 `frontend_gateway_prepare` 在一次请求中
提交零到多个 sensitive replacement 与 opaque `modify` grant 配对。每个配对 MUST 绑定明确的
`SensitiveSegmentRef` 以及 asset/file/segment/scope/surface/revision/TTL identity；不得将该
事务限制为单一 segment 或单一文件。GatewayCore MUST 在 prepare 时权威验证每个配对的 grant、
current revision 与 current facts；只有全部配对通过才可建立 core prepared-secret entry 和可
apply 的 prepared operation，并进入既有 review/confirm。

prepare 成功后，系统 MUST NOT 清零 frontend-private sensitive buffer；该 buffer MUST 在
review/confirm 期间继续保留受控 replacement input，以支持 conflict 或 explicit reprepare，
直到本 capability 所定义的成功 reread 或 invalidation 清零路径。它 MUST NOT 进入 shared draft
或任何 serialization surface。

并非全部配对通过时，系统 MUST 沿用既有封闭 `PrepareResult`，不得把 validation 或 conflict
重新分类为 `PrepareFailed`：current-fact conflict MUST 返回 `ConflictResult`；可由既有
validation 表达的授权或事实阻断 MUST 返回带 blocking `ValidationFinding` 的
`PreparedOperation(canApply=false)`；只有 transport/protocol 无可信结果时才返回
`PrepareFailed`。上述任一未通过结果均 MUST 不建立 core prepared-secret entry、不得包含 core
secret，且不得 confirm 或 apply。

`PrepareFailed` MUST 保留 frontend private buffer、用户的受控输入、目标与 workflow context；
它不得产生 prepared operation ID、concurrency token、review、confirm、可应用 diff 或 apply。
成功的 review/confirm MUST 继续遮蔽敏感 diff、summary、finding 与 result，而不得将
replacement 或 grant 公开到 shared draft 或任何 serialization surface。prepared-secret 的位置和
禁止泄露表面由 `fe03-edit-performance-protocol` capability 约束。

#### Scenario: 多敏感段 prepare 全部通过

- **WHEN** 一个 `editAsset` prepare 包含多个具有不同 `SensitiveSegmentRef` 的有效
  replacement/grant 配对
- **THEN** GatewayCore MUST 分别权威验证每个配对的 grant、revision 与 current facts，并且
  只有在全部通过后才建立一个可 review/confirm 的 prepared operation；每个配对仍不得跨
  segment 或跨 file 复用

#### Scenario: prepare 成功后在 review/confirm 保留 frontend buffer

- **WHEN** 全部敏感配对通过 prepare 并进入 review 或 confirm
- **THEN** 系统 MUST 保留 frontend-private sensitive buffer 中受控的 replacement input，不得
  因 prepare 成功清零，以支持 conflict 或 explicit reprepare；该 buffer 仍不得进入 shared
  draft 或任何 serialization surface

#### Scenario: prepare 发现 current-fact conflict

- **WHEN** 一次 prepare 的 current-fact validation 发现 conflict
- **THEN** 系统 MUST 返回既有 `ConflictResult`，不得建立 core prepared-secret entry，也不得
  confirm 或 apply；不得将该 conflict 重分类为 `PrepareFailed`

#### Scenario: prepare 发现可表达的授权或事实阻断

- **WHEN** 一次 prepare 的 grant 或 current fact 形成可由既有 validation 表达的阻断
- **THEN** 系统 MUST 返回带 blocking `ValidationFinding` 的
  `PreparedOperation(canApply=false)`，不得建立 core prepared-secret entry、confirm 或 apply，
  且不得将该阻断重分类为 `PrepareFailed`

#### Scenario: transport 或 protocol 无可信 prepare 结果

- **WHEN** transport 或 protocol 使 prepare 无法形成可信结果
- **THEN** 系统 MUST 返回 `PrepareFailed`，不建立 core prepared-secret entry，也不得产生
  prepared operation ID、concurrency token、review、confirm、可应用 diff 或 apply；frontend
  private buffer、用户输入、目标与 workflow context MUST 保留

### Requirement: editAsset prepared-secret 的 revalidation、single-use 与清理

确认 apply MUST 继续只提交既有 `preparedOperationId` 与 `OperationConcurrencyToken`；系统
MUST NOT 新增 IPC verb、apply plaintext payload、trust boundary 或第二事实源。GatewayCore 在
apply 前 MUST 再次权威验证 current revision、current facts 和每个 grant 的有效性，并且
prepared operation 与其 secrets MUST single-use。apply conflict、显式 reprepare 或同一目标的
revision drift 时，系统 MUST 清零旧 core entry、旧 grant 与旧绑定 identity，使旧
prepared/review/confirm 失效；frontend 只能保留同一目标的 replacement 作为未绑定输入供
用户显式 reprepare，且 MUST NOT 自动 retry 或沿用旧 grant/identity。

在 apply 成功并完成受影响事实的 authoritative reread 后，系统 MUST 清零 frontend 与 core
两侧的敏感 buffer，并重新遮蔽敏感段。用户明确 cancel/discard，或 asset/file/segment/scope/
surface/TTL 的 target identity 真正失效时，系统 MUST 立即清零两侧 buffer，且使旧
prepared/review/confirm 失效。transport result unknown MUST 继续复用既有
`OperationProgressQuery`、observe、event 与 invalidation 语义，不得新增 progress command 或
domain，且不得自动重发 apply。若进程崩溃，core prepared secret MUST 丢失；用户只能从仍受控
的 frontend 状态显式 reprepare，或在 frontend 状态也已丢失时重新输入并重新授权。

#### Scenario: apply 前发生 conflict 或 revision drift

- **WHEN** apply 前的 revalidation 发现 conflict 或同一目标的 revision drift
- **THEN** 系统 MUST 不写入并清零旧 core entry、grant 与绑定 identity，使旧
  prepared/review/confirm 失效；frontend 只可保留未绑定 replacement 供显式 reprepare，且
  不得自动 retry、复用旧 grant 或发出第二次 apply

#### Scenario: 用户取消或目标身份失效

- **WHEN** 用户明确 cancel/discard，或 asset、file、segment、scope、surface 之一切换，或
  TTL 到期
- **THEN** 系统 MUST 立即清零 frontend 与 core 两侧的敏感 buffer，使旧
  prepared/review/confirm 失效并重新遮蔽，且不得保留可重新授权的 replacement 或 grant

#### Scenario: apply 成功并完成权威重读

- **WHEN** apply 已成功且受影响 facts 已完成 authoritative reread
- **THEN** 系统 MUST 清零 frontend 与 core 两侧的敏感 buffer、重新遮蔽敏感段，并且只在该
  reread 后更新可见实际状态

#### Scenario: apply 结果未知或 core 进程丢失

- **WHEN** apply 的 transport result unknown，或 core 进程崩溃导致 prepared-secret entry 丢失
- **THEN** 系统 MUST 不自动重试或重建 secret；结果未知时只通过既有 `OperationProgressQuery`、
  observe/event/invalidation 对账，core 丢失时只允许从仍受控的 frontend 状态显式 reprepare，
  否则要求用户重新输入并重新授权
