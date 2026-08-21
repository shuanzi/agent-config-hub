## MODIFIED Requirements

### Requirement: 敏感 modify grant 的权威边界与失效

在未触发 ARCH-GATE 重开条件时，未来的 FE-03/FE-04 implementation 对敏感段修改 MUST
使用 Rust-first 签发并验证的 opaque authoritative `modify` grant；前端只能在既有
read/session seam 消费授权结果，且 `frontend-local` self-signed token MUST NOT 具有授权
效力。每个 grant MUST 绑定 asset、file、具体 `SensitiveSegmentRef`/segment identity、
authoritative revision、scope、TTL 与当前修改 surface，并且 MUST NOT 复用于任何其他敏感
片段。

frontend 所持的 sensitive replacement 和仍可用 grant 副本 MUST 只存在于受控、
non-serializable、frontend-private 的 `ephemeral sensitive buffer`，且 MUST NOT 成为
shared/persisted `editAsset` draft。仅当 `skill-agent-state-control` capability 所定义的
`editAsset` prepare 已完成权威验证时，其对应的 replacement/grant 才可额外存在于关联 prepared
operation 的 non-persistent、non-serializable、non-enumerable、in-process prepared-secret
entry。该 entry MUST NOT 成为 shared 状态、持久化状态或任何 recovery 来源；进程崩溃、重启或
core 丢失时，它 MUST 被丢弃而不得从任何持久化载荷恢复。

零到多个 prepare 配对、既有 `PrepareResult` 分类、validation、review/confirm、reprepare、
apply-time revalidation、single-use 消费、revision/target/TTL invalidation 与 re-masking 的
transaction lifecycle MUST 仅由 `skill-agent-state-control` capability 的 `editAsset`
prepared-secret requirements 约束；本 requirement 不定义或扩展这些触发条件和结果。

grant、sensitive replacement、prepared-secret entry 或其可重放表示 MUST NOT 进入 SQLite、
journal、snapshot、recovery payload、shared/persisted draft、session snapshot、cache、日志、
错误文本、诊断/analytics、搜索、事件、fixture、vector/golden、PF 或任何 evidence。现有
journal MUST 继续只保存无正文的 identity、阶段、稳定原因、revision 摘要和 opaque handle，
不得保存草稿、差异、敏感明文、grant 或完整可重放写入 payload。planning、L0/L1/L2 或 PF
中的 mock grant 只能模拟权威 grant 已存在／已失效，MUST NOT 签发 grant、保存敏感值或取得
actual authorization credit。

#### Scenario: 试图把敏感值写入持久化或可观察表面

- **WHEN** 一个流程试图将 grant、replacement、prepared-secret entry 或其可重放表示写入
  SQLite、journal、snapshot/recovery、draft、session snapshot、cache、日志、错误、诊断、
  analytics、搜索、事件、fixture、vector/golden、PF 或 evidence
- **THEN** 系统 MUST 阻止该值进入该表面；journal 仍只能记录无正文状态，且进程崩溃后不得
  从持久化数据恢复 prepared secret

#### Scenario: 前端自行生成授权标识

- **WHEN** 前端产生未由 Rust 权威边界签发和验证的 ephemeral token
- **THEN** 系统 MUST 将其视为无授权效力，且不得以该 token 展示、修改或解除敏感段遮蔽

#### Scenario: grant 被用于另一个敏感片段

- **WHEN** 调用方尝试把一个 grant 用于其绑定 `SensitiveSegmentRef` 之外的敏感片段
- **THEN** 系统 MUST 拒绝该 grant、保持目标片段遮蔽，并且不得把同 asset/file/revision 视为
  可跨片段复用的授权
