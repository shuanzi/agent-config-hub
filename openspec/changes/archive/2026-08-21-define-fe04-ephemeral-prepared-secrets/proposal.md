## Why

FE-03 当前要求每个敏感 `modify` grant 和明文 replacement 均只存在于 frontend-local。该位置
约束使已经批准的 FE-04 事务模型无法使用既有 prepare/apply seam：GatewayCore 必须只在一个
prepared operation 的进程内生命周期中保留已经验证的权威 secret。本 planning prerequisite 在
暂停的 FE-04 implementation 可以考虑恢复前，先定义这一狭窄边界。

## What Changes

- 为 `editAsset` 定义 ephemeral prepared-secret 边界：一次既有 `frontend_gateway_prepare`
  请求可携带零到多个敏感 replacement 和 opaque `modify` grant，每项均绑定精确的敏感段及
  target identity。
- 允许 GatewayCore 在 prepare-time 权威验证后，只在关联 prepared operation 的
  non-persistent、non-serializable、non-enumerable in-process entry 中保留这些值。该 entry
  会由既有 apply payload 重新验证并单次消费；不新增 IPC verb 或 apply plaintext payload。
- 在 review 和 confirm 期间保持 frontend ephemeral sensitive buffer 私有，以便用户在
  conflict 或 revision drift 后显式 reprepare。明确区分 same-target revision drift（只保留
  未绑定 replacement input）与 target-identity 或 TTL invalidation（立即清零两侧）。
- 明确 recovery、draft、snapshot、cache、observability、search、fixture、performance artifact
  与 evidence 的 zero-persistence 边界。既有 journal 保持无正文，process crash 会丢弃 core
  entry。
- 记录 FE-04 的 planning-only prerequisite 顺序；它不改变任何 formal ticket status、evidence、
  frontier、release gate 或 implementation credit。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `fe03-edit-performance-protocol`：修订敏感明文和 `modify` grant 的位置规则，以允许受边界
  约束的 GatewayCore prepared-secret entry，同时保持 frontend-private buffer 与
  zero-persistence guarantee。
- `skill-agent-state-control`：定义 `editAsset` prepared-secret transaction lifecycle，涵盖
  validation、review/confirm、explicit reprepare、invalidation、single use 与 authoritative
  reread cleanup。

## Impact

本 change 仅创建 planning artifacts。后续另行授权的 FE-04 apply 将最小化更新 architecture/
Frozen planning truth chain 与既有 GatewayCore/frontend transaction seams；它不得改变既有
command set、trust boundary、recovery-journal body rule、progress domain 或任何 historical
evidence。本 proposal 不修改 product code、wire schema、tests、fixtures、registries、budgets、
collectors 或 ticket artifacts。
