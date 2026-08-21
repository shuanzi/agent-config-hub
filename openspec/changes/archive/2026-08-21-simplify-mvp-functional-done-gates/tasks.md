## 1. 逐票确定 MVP gate

- [x] 1.1 已逐票重读 FE-03～FE-10 的最小 gate、真实产品安全负例和必要 isolated L3：FE-03、FE-10 已有自身 MVP gate record，均无 L3；FE-04 保留真实 write/recovery/sensitive L3，因 FE-03 MVP `done` 成为唯一 `ready-for-agent` frontier；FE-05～FE-09 仍由 FE-04 阻塞。
- [x] 1.2 已在 FE-03、FE-10 ticket 与 `TEST-EXECUTION-ORDER.md` 保留可审计 commit、实际测试命令/结果、未覆盖边界和独立 review；未新增并行正式状态、tracked-source digest、schema 或 verifier。

## 2. 一致迁移 active change 任务

- [x] 2.1 已只重编 `adopt-selected-b2-ui-baseline` 的未勾 tasks：MVP gate 后直接 `done`/解阻，PF、performance/stress/platform hardening、逐票 `verify:ticket` 与 formal closure 移入统一 release/optimization；已完成 FE-07R、FE-01、FE-02 的 checkbox 与历史文字未改写。
- [x] 2.2 已将 `establish-fe03-edit-performance-protocol` 的 edit-PF、预算、formal comparison、bytes/module graph/physical attestation 明确移入 unified release/optimization，并将 native `openat`/复杂 binary provenance 作为 trusted-runner 范围外；历史 evidence 保留且没有新 PF/formal 通过结论。
- [x] 2.3 已为 `simplify-pending-task-security-boundaries` 写明被本 change absorb 后的归档处置，并为 `define-fe04-ephemeral-prepared-secrets` 写明 FE-04 MVP gate absorb、PF/formal deferred 的 meta-task 处置；冻结 prepared-secret 精确规则未改写。

## 3. 同步治理与 release 来源

- [x] 3.1 已同步 README tracker rules、适用 ticket、SPEC、TEST-EXECUTION-ORDER、RELEASE-GATE 和相关 active specs/tasks；本次只修改治理与 planning 文档，不修改产品、测试、脚本、预算、collector、descriptor、fixture、registry、verifier 或历史 evidence。
- [x] 3.2 已检查同步来源：MVP gate 直接解除功能 blocker，未执行 hardening 均明确为 deferred/unified release，FE-04 是唯一 `ready-for-agent`；没有以人工排期替代 blocker evidence，也没有将后置项冒充为通过。

## 4. 保留历史并安排归并

- [x] 4.1 未改写、删除或重新解释已完成 task 与历史 done/failure/waiver/evidence；FE-07R、FE-01、FE-02 的历史 done、waiver 与 release 边界保持原样。
- [x] 4.2 归并/归档顺序为：（1）先合并本 `simplify-mvp-functional-done-gates` apply；（2）其治理已被 absorb 的 `simplify-pending-task-security-boundaries` 随后归档；（3）`establish-fe03-edit-performance-protocol` 在其 edit-PF/formal obligations 已明确转交 unified release/optimization 后归档；（4）`define-fe04-ephemeral-prepared-secrets` 保留冻结规则并在其 meta-task mapping 获验收后归档；（5）`adopt-selected-b2-ui-baseline` 保持 active，承接 FE-04～FE-09 的 MVP 与后续 release reconciliation。planning 阶段没有自动迁移任何 ticket 状态；本次 apply 才根据已记录的 MVP evidence 显式更新 FE-03、FE-10、FE-04 frontier。
