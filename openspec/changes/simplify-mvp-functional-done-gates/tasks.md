## 1. 逐票确定 MVP gate

- [ ] 1.1 在 future apply 中逐票重读 FE-03～FE-10 的最小 gate、真实产品安全负例和必要 isolated L3；仅据此决定 FE-03/FE-10 是否迁移为 done 及 FE-04 blocker 是否变化。
- [ ] 1.2 为每个决定保留可审计 commit、实际测试命令/结果、未覆盖边界和独立 review，不新增并行正式状态或多层 tracked-source digest。

## 2. 一致迁移 active change 任务

- [ ] 2.1 重编 `adopt-selected-b2-ui-baseline` 的未勾 tasks，使每票功能 gate 后 done/解阻，并将 PF/verify/formal 移入 release。
- [ ] 2.2 解决 `establish-fe03-edit-performance-protocol` 的 bytes digest/module graph/physical attestation 与 trusted-runner 简化冲突，将 edit-PF/budget/formal 移入 release optimization。
- [ ] 2.3 为 `simplify-pending-task-security-boundaries` 与 `define-fe04-ephemeral-prepared-secrets` 的剩余 meta tasks 写明 absorb、supersede 或 archive disposition。

## 3. 同步治理与 release 来源

- [ ] 3.1 在同一次 future apply 中同步 README tracker rules、适用 ticket、SPEC、TEST-EXECUTION-ORDER、RELEASE-GATE 和相关 active specs/tasks。
- [ ] 3.2 检查同步后的来源均以 MVP gate 解除功能 blocker、将未执行 hardening 如实保留给统一 release，并消除“人工排期但 blocked 禁止编码”的冲突。

## 4. 保留历史并安排归并

- [ ] 4.1 不改写、删除或重新解释已完成 task 与历史 done/failure/waiver/evidence，尤其保持 FE-07R、FE-01、FE-02 的历史 done。
- [ ] 4.2 给 active changes 列出归并/归档顺序，并确认本次 planning change 之前没有自动 ticket 状态迁移。
