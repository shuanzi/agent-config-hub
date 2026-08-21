## Why

当前治理一面允许最小功能 acceptance 完成后的人工排期，另一面仍以逐票 formal done 作为 tracker blocker，形成不能一致解除的双轨。需要把 MVP 的完成和功能依赖收敛到真实产品功能验收，同时如实保留后置 hardening 与 release 风险。

本 change 只规划未来的一次性文档治理迁移，不迁移任何 ticket 状态，也不实施产品、测试或 verifier 改动。

## What Changes

- 将 MVP ticket done 与功能 direct blocker 定义为最小 contract/implementation、L0/L1、必要 L2、ticket 自身真实产品安全负例、必要时的 isolated L3，以及独立功能复审；满足后直接成为 MVP done 并解除下游功能 blocker。
- 不新增 `functional-done` 等并行正式状态。PF、performance/stress/platform hardening、复杂 trusted-runner provenance/hash/digest 图以及逐票 `verify:ticket`/formal closure 后置到统一 release/optimization，未执行时不得冒充通过。
- 约束最低审计记录，并保持 snapshot AEAD、Adapter signature/domain/archive/file digest、敏感授权、真实写入/恢复、不受信任输入和真实磁盘 fail-closed 等产品安全边界不被弱化。
- 明确 FE-03～FE-10 的最小 L3 归属、历史记录保留和未来 apply 的一致性迁移范围；FE-03、FE-10 迁移为新 done 与 FE-04 blocker 的具体决定均留待 future apply 逐票复读最小 gate 后作出。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `pending-task-execution-governance`: 将未完成 ticket 的 MVP done、功能 blocker、后置 release hardening、最低记录和历史迁移约束改为单一一致的治理规则。

## Impact

- future apply 将调整 pending-task 治理文档、相关 active change 的 tasks/specs 和 release 说明；本 proposal 不改产品代码、测试、verifier、registry、tracker、历史 evidence 或 ticket 状态。
