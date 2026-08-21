## MODIFIED Requirements

### Requirement: 功能优先与报告语义分离

未完成 ticket 的 `MVP done` 与功能 direct blocker SHALL 仅由最小 contract/implementation、L0/L1、必要 L2、ticket 自身真实产品安全负例、仅在真实写入、外部路径、恢复、不受信任 bundle 或敏感授权边界所必需的 isolated L3，以及独立功能复审决定。满足该 gate 后，ticket MUST 直接成为 `MVP done` 并解除下游功能 blocker；治理 MUST NOT 新增 `functional-done` 或其他并行正式状态。

PF、performance/stress/platform hardening、复杂 trusted-runner provenance/hash/digest 图和逐票 `verify:ticket`/formal closure MUST 后置到统一 release/optimization，且不得作为逐票 MVP done 或功能 DAG blocker。未执行的后置项 MUST NOT 被表述为已通过；release ready 仍 MUST 完成当时适用的统一 hardening/release gate。FE-03 仅需 L0/L1 与必要 L2；grant 消费和首条真实 write transaction 由 FE-04 的 isolated L3 统一覆盖；FE-10 仅需 L0/L1 与必要 browser L2，不含 L3/PF；FE-04 保留 WebView→IPC→Core→isolated disk 的 prepare/apply/conflict/recovery/sensitive L3；FE-05～FE-09 仅保留各自真实 create/import/conversion/path-project/bundle/delete-recover 边界所需的 isolated L3。

#### Scenario: MVP 功能验收完成而后置 hardening 尚未执行

- **WHEN** 一个 ticket 已完成其最小功能 gate 与独立功能复审，但 PF 或其他统一 release hardening 尚未执行
- **THEN** 该 ticket 成为 `MVP done` 并解除下游功能 blocker，后置项被保留到 release/optimization，且不得被报告为 release ready 或已通过

#### Scenario: FE-04 进入首条真实写入

- **WHEN** FE-04 消费 grant 并执行首条真实 write transaction
- **THEN** 它 MUST 由 FE-04 的 isolated L3 覆盖 prepare/apply/conflict/recovery/sensitive 边界，且该 L3 不得被 FE-03 或 FE-10 借用

### Requirement: 真实产品安全边界保持不变

本治理变更 MUST NOT 弱化真实产品的安全 requirement。snapshot AEAD、Adapter signature/domain/archive/file digest、用户输入及外部项目根的 traversal/symlink escape 防护、敏感明文不得落盘、不得进入 shared draft、日志或 evidence、Rust 权威 grant 的 segment/revision/scope/surface/TTL 绑定与失效、prepare 无副作用、apply-time revalidation、single-use、unknown result 不自动重试、authoritative reread、recovery/collision、权限与跨资产隔离，以及不受信任 config/Adapter/extension/executable 和真实磁盘的 fail-closed 均 MUST 保持。

#### Scenario: 真实产品写入或不受信任输入

- **WHEN** 一个 ticket 处理敏感授权、外部路径、不受信任输入或真实业务磁盘写入
- **THEN** 其最小功能 gate MUST 保留对应的产品安全负例和必要 isolated L3，且不得以 MVP 简化、trusted-runner 前提或后置 release 工作替代该负例

### Requirement: Acceptance 与 verifier capability 的单向依赖

future apply 在决定每个 ticket 的 MVP done 或 direct blocker 前 MUST 独立重读该 ticket 的最小 gate，并只保留满足它所需的验证能力。逐票 `verify:ticket`、formal closure、edit-PF、budget、bytes digest/module graph/physical attestation 或复杂 trusted-runner provenance MUST NOT 反向扩大 MVP acceptance、成为 MVP done 前置或要求新增 verifier command/状态机；MVP done 也 MUST NOT 以 per-ticket registry 为前置，或要求为每票建立 runner/evaluator/manifest/freeze/history/stable-index。

本 change MUST NOT 自动迁移 FE-03 或 FE-10 为新 done，也 MUST NOT 自动改变 FE-04 blocker；这些决定仅能在 future apply 的逐票复读后作出。

#### Scenario: 尚未执行 future apply

- **WHEN** 本 change 仅完成 planning artifacts
- **THEN** 当前 ticket 状态、blocker、checkbox、frontier、release gate 和历史 evidence MUST 保持不变

### Requirement: 证据与 provenance 不可互借

每个 MVP done ticket MUST 至少记录可审计 commit、实际测试命令与结果、未覆盖边界和独立 review；一个 ticket 的测试或 evidence MUST NOT 作为另一个 ticket 的 MVP done 或 release credit。tracked source identity MUST NOT 叠加多层 digest；仅当 Git commit/tree 不能证明 source identity 且该证明会改变下一步时，MUST 保留一个 canonical binding。后置 release evidence MUST 保持其独立范围，且不得改写或删除历史 evidence。

#### Scenario: Git 身份不足以决定下一步

- **WHEN** Git commit/tree 不能证明所需 source identity，且该身份会改变下一步
- **THEN** 记录一个 canonical binding；否则不得为 tracked source 叠加 digest 图

### Requirement: 审计记录与 formal 冲突的保留

已完成 task、历史 done/failure/waiver/evidence MUST NOT 被改写、删除或重新解释；FE-07R、FE-01 和 FE-02 MUST 保持其历史 done。future apply MUST 一次性且一致地重编 `adopt-selected-b2-ui-baseline` 的未勾 tasks，使每票功能 gate 后 done/解阻并将 PF/verify/formal 移入 release；解决 `establish-fe03-edit-performance-protocol` 中 bytes digest/module graph/physical attestation 与 trusted-runner 简化的冲突并将 edit-PF/budget/formal 移入 release optimization；为 `simplify-pending-task-security-boundaries` 与 `define-fe04-ephemeral-prepared-secrets` 的剩余 meta tasks 给出 absorb/supersede/archive disposition；同步 README tracker rules、适用 ticket、SPEC、TEST-EXECUTION-ORDER、RELEASE-GATE 及相关 active specs/tasks，消除“人工排期但 blocked 禁止编码”；并给 active changes 排出归并/归档顺序。

#### Scenario: future apply 处理治理冲突

- **WHEN** future apply 开始治理迁移
- **THEN** 它 MUST 完成上述一致的文档归并并保留历史记录，不得只改一个来源后仍留下功能已可排期但 tracker 禁止编码的冲突
