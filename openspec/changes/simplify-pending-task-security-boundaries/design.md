## Context

参见 [proposal.md](proposal.md) 的动机。planning phase 仅以本 change 的 planning artifact 定义今后如何重排未完成工作；本次已授权 apply 仅迁移本 change 的治理/验收文档，以及两个 active change 中未勾选未来任务的执行编排文字，不改变两个 active change 的 checkbox、frozen acceptance、formal ticket status/DAG/frontier、release gate、产品、验证实现或其他 formal source。当前两个 active changes 仍分别有 51 项和 26 项 unchecked task。clean baseline 只有 FE-01、FE-02、FE-07R 的 registry entry，且没有 `.artifacts/`；因此文档中的 stable pointer 只能被记录为历史指针，不能在本轮重新证明其物理 provenance。

formal sources 还存在必须保留而不可在本 change 裁决的差异：

- `TEST-EXECUTION-ORDER.md:474` 的历史 registry 声明仅含 FE-01/FE-07R，而当前 `ticket-registry.mjs` 含 FE-02、FE-01、FE-07R；二者按历史与当前实现层级并列记录，不反写或据此推断其他 ticket command 已建立；
- `TEST-EXECUTION-ORDER` 的历史 FE-02 snapshot 与当前 tracker 的状态不同；
- `ARCH-GATE` 的 FE-07R candidate snapshot 与当前 `done` 记录不同；
- ticket 的 `ready-for-agent` 与其验证资料的 `planned`/`unverified` 属于不同层级；
- `RELEASE-GATE` 的统一 command 仍为 `not-established`；
- 历史 FE-02 PF failure、waiver 与 accepted-with-waiver 仍是历史结论，不能删除、重写或拿来给其他 ticket 记 credit。

## Goals / Non-Goals

**Goals:**

- 用一个受信任 local/CI runner 的明确威胁模型，将产品安全、验证基础设施防误用和理论 hardening 分层。
- 让每项 pending task 都有可追溯的最小 acceptance、分层验证、disposition、provenance 与 residual risk；本次只迁移两个 active change 的未勾选未来任务编排，不改其 checkbox、frozen acceptance、formal status 或 gate。
- 将未来执行固定为功能契约和最小实现、L0/L1、必要 L2、真实产品安全负例、`functional complete`、统一后置 hardening、release 前综合 gate 的有向序列。
- 让共享 runner、manifest、registry、preflight 和 verifier work 在未来只承担一次公共职责，避免每个 ticket 重复证明同一验证基础设施事实。

**Non-Goals:**

- 本次受限 apply 不实现或删除任何产品、测试、verifier、registry、budget、collector、descriptor、fixture、evidence 或 gate。
- 不修改 frozen product acceptance、现有 release gate、ticket/tracker/DAG 或真实产品安全边界；这些都需要用户显式决定及后续独立 apply。
- 不把 trusted-runner 假设延伸至外部项目输入、真实业务数据、授权或写入边界。
- 本次只记录 FE-03 dirty WIP 的最小化后续范围，不写入、恢复、整理、stash、clean 或 cherry-pick `/Users/xiquandai/.codex/worktrees/6e5c/agent_config_hub`。

## 2026-08-21 当前治理 supersession

本节只替代 D5–D7 与 Migration Plan 中冲突的未来执行编排，不改写其中的历史审计、历史 evidence 或
真实产品安全边界。`simplify-mvp-functional-done-gates` 已吸收原有 `functional complete`/
`hardening pending` 的双轨人工报告：当最小 contract/implementation、L0/L1、必要 L2、真实产品安全
负例、适用的必要 isolated L3 与独立功能复审完成时，ticket 直接为 MVP `done` 并按其 DAG 解锁下游。

因此，原本要求逐票 PF、`verify:ticket`、formal comparison/closure 在 `done` 或 frontier 更新前完成的
表述已被 supersede；这些事项保留为 unified release/optimization 的 deferred 输入，既不删除，也不得
冒充通过、release-ready 或跨票据 credit。FE-03 已按其自身 MVP record `done`（无 L3/actual write
credit），FE-04 是唯一 `ready-for-agent` frontier，且仍须以自身真实 write/recovery/sensitive L3 完成
MVP gate。任何其他 frozen product acceptance、release gate 或真实产品安全 requirement 的改变仍须单列
并取得用户显式批准。

## Decisions

### D1：以 formal source 分层记录，而非合并冲突

审计矩阵以 active OpenSpec checkbox、ticket/tracker、DAG/frontier、gate 和 verifier/registry 各自的原始声明记录事实。出现冲突时，矩阵保留来源、层级和影响，且只提出 future disposition；它不改变任何 source，也不把 planning completion 当作 ticket completion 或 closure。

替代方案是选定一个文件作为本轮唯一真相并回写其他文件。该方案会重写历史结论、预先裁决 release/ticket 状态，故拒绝。

### D2：验证基础设施采用受信任 runner 模型

验证基础设施的信任边界是受信任的本地或 CI runner。它不要求防御同一用户权限恶意并发进程主动交换目录，也不防御已被攻陷的开发机、CI worker、工具链或仓库。未来最小防误用仍保留：exact relative-path allowlist、controlled evidence root、可检测 symlink 拒绝、leaf `O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验和异常 fail-closed。

这些控制防止普通配置、路径或文件误用；它们不提供同权限恶意进程下的原子安全保证。因此不为该模型新增 native evidence-only `openat` helper、跨平台安全文件系统或复杂 binary provenance。若未来需要对抗这些排除项，应单独立项并先取得用户对成本、平台和威胁模型的确认。

### D3：真实产品安全与 runner hardening 不可互相替代

以下风险留在产品安全层，未来仍须有与实际产品边界相称的负例和 fail-closed 验证：外部项目根目录的 traversal/symlink escape；敏感明文、authorization grant、revision/stale；apply/write、transaction、recovery point、权限和跨资产隔离；不受信任 config、Adapter、extension 或 executable；真实业务数据和磁盘写入。

因此，FE-03 的 grant invalidation/re-masking、FE-04 的 transaction/revision/recovery、FE-07/FE-09 的外部路径和文件边界、FE-08 的不受信任 Adapter/bundle 都保留为产品安全工作。与之相反，只保护 trusted runner 自身证据目录的复杂物理 provenance 或同权限目录竞争证明，归为验证基础设施或理论 hardening，不能阻塞功能完成。

### D4：以任务分类和公共能力替代逐票重复证明

审计使用四个可叠加类别：产品功能、产品安全、验证基础设施、理论 hardening；独立 review 与 release governance 单列而不产生 closure credit。未来 apply 仅在有已确认需求时建立公共 preflight、registry/manifest/verifier route 或 test helper；每个 ticket 保留自己的产品 acceptance 和 evidence identity，但不得各自复制 runner、evaluator、manifest、freeze/history 或相同的负例矩阵。

审计观察到的是**计划文本可能形成的相互前置风险**：ticket acceptance、formal contract 与 verifier capability 若彼此要求对方先完成，就会产生循环；当前实现未观察到 runtime cycle，registry 也只含已完成的 FE-02、FE-01、FE-07R。未来拆解必须单向进行：先由 formal product/ticket source 确认并冻结最小 acceptance，再只建立满足该 acceptance 所需的最小 verifier capability，最后才执行该 ticket 的 formal closure。verifier capability 不得反向定义或扩大 acceptance，formal closure 也不得成为建立 verifier capability 的前置。

对同一 provenance 事实，未来只需要一个 canonical ticket/run identity、controlled root 和明确 manifest binding；多个 digest、pointer、stable index、immutable blob 或 history 只有在证明不同事实时才保留。该简化绝不删除历史 evidence，也不允许跨 ticket 借用 closure credit。

### D5：功能完成、hardening、closure 与 release 的顺序

每个功能 slice 的目标序列为：

```text
功能契约 + 最小实现
  -> L0/L1 功能测试
  -> 必要 L2 产品 journey
  -> 真实产品安全负例
  -> functional complete
  -> performance / stress / platform / 对抗 hardening（统一优化阶段）
  -> ticket formal closure
  -> release 前综合 gate
  -> release ready
```

`functional complete` 和 `hardening pending` 是人工报告语义，不是当前 verifier 的新状态机、命令或自动 enforcement。前者只表明该 ticket 的最小产品 acceptance、所需 L0/L1/L2 与真实产品安全负例已完成；它不代表 performance/stress/platform hardening 已通过。经独立功能复验并由人工记录 `functional complete` 后，在其他仍有效的 architecture/产品安全前提满足时，可使其直接下游 ticket 的**产品功能开发**获得人工排期资格，即使上游仍为 `hardening pending`、未 done 或未 formal closure；这不自动改变任何 formal ticket status、DAG、frontier、done、release gate，也不得把下游开发开工报告为 ready、done 或 closure。下游的 formal ticket 验证和 closure 仍以当前 formal direct blockers=done 且具 evidence 为前置。`hardening pending` 不可伪装为通过、给 release credit 或借用别票 evidence；上游自身的 applicable PF/hardening 必须完成并通过后才能进入其 formal closure。`formal closure` 和 `release ready` 继续受其各自当前 formal gate 约束，直到用户明确决定要如何调整 frozen acceptance 或 release requirement。

### D6：FE-03 的安全最小化和 WIP disposition

用户已选择“最小化”。本次 apply 只根据已完成的只读比较记录后续受限范围：保留仍需独立功能复验的 draft、dirty guard、unknown preservation、真实 grant invalidation/re-masking、L0/L1 与必要 L2；停止 native helper、复杂 module/graph/physical provenance 与同权限目录交换对抗的过度部分。PF、formal comparison、`verify:ticket`、budget/freeze/history 与 closure 仍是后置工作，本次不执行。

这项最小化不取得 L3、actual Tauri IPC、真实 authorization 或磁盘写入 credit，也不把 FE-03 标为 `functional complete`、done 或 closed，且不在本轮启动或推进 FE-04/FE-10。只有未来 FE-03 经独立功能复验并人工记录 `functional complete` 后，FE-04 的产品功能开发才可获得人工排期资格；FE-03 仍等待自身 applicable PF/hardening 通过及 formal closure，FE-04 的 formal ticket 验证和 closure 仍受其当前 formal direct blocker 约束。

### D7：用户确认的方案 A 与仍需独立授权的边界

用户已确认本次仅作受限文档 apply，并逐项确认：

- frozen product acceptance、formal ticket status、checkbox、DAG、frontier、done 语义与 release gate 一律不改；
- `functional complete`/`hardening pending` 仅为人工报告与编排语义。经独立功能复验的上游 `functional complete` 可使下游**产品功能开发**获得人工排期资格，但不使下游变为 ready/done/closed，不启动 formal 验证或 closure，也不改变 formal DAG/frontier；
- PF/performance/stress/platform/低概率对抗 hardening 后置但不删除、不冒充通过、不借其他 ticket evidence。上游自身 applicable PF/hardening 的 fail/inconclusive 继续阻止其 formal closure，release gate 不降低；
- FE-03 WIP 采用 D6 的最小化 disposition：后续保留功能和真实 grant 安全部分，停止过度 provenance/native-helper；仍需独立最小化与功能复验。本次不标记 FE-03 `functional complete`/done/closed，也不推进或启动 FE-04/FE-10；
- 同权限目录交换、compromised runner/toolchain、跨平台 secure filesystem、复杂 binary provenance 仅记录为 residual risk，暂不立项；
- 历史 evidence、completed tasks、FE-02 failure/waiver 与每个 ticket 的 provenance 不改写、删除或互借。

未来任何触及 frozen acceptance、formal status/DAG/frontier、release gate、真实产品安全边界或新的 hardening 项目的工作，仍须取得独立授权；本次 document completion 不构成该授权。

## Risks / Trade-offs

- [性能问题在功能完成后才暴露] → 保留独立性能阶段和自身 PF lineage；未知性能明确标为 hardening pending，不影响功能事实。
- [受信任 runner 被攻陷或被同权限对抗者操纵] → 明确作为不在本模型内的 residual risk；如业务风险改变，再以单独 threat-model change 处理。
- [共享基础设施可能重新耦合各 ticket] → 仅共享无状态公共能力；ticket identity、产品 acceptance、run identity、层级与 closure credit 始终独立。
- [formal source 冲突导致错误推进] → 矩阵并列记录冲突并把状态改动留给用户确认后的 future apply，不从文档或 mock 推断 ready/done。
- [FE-03 旧 WIP 被误当成可复用 closure 输入] → 已选择最小化，但后续仍须独立功能复验；保留部分只能是待核验的实现输入，不能改写或替代历史 lineage。

## Migration Plan

本受限 apply 没有部署、数据迁移或运行时 rollback。其唯一可提交内容是本 change 的治理文档与两个 active change 的未来任务编排文字；撤回即不合并该 planning change，现有 product code、evidence、tracker、gate 和 WIP 均保持不变。

在 D7 的确认范围内，future apply 的最小迁移顺序是：先把审计矩阵中的公共 preflight/verification 责任与产品 acceptance 逐项映射到正式 change；再先交付每个产品 slice 的功能和真实产品安全负例，并在独立复验后人工报告 `functional complete`；该报告可用于下游产品功能开发的人工排期，但不改变 formal gate。随后集中排期 performance/stress/platform hardening；最后仅按仍有效的 formal ticket/release gate 执行 closure/release 验证。任何会触及 D7 之外的项目先停止并回主任务请求独立授权。
