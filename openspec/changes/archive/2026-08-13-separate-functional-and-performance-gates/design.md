## Context

参见 `proposal.md`。当前根命令 `test:frontend` 是无范围过滤的 `vitest run`，`verify:ticket` 会按 `TICKET_REGISTRY` 顺序执行全部登记步骤；FE-01 的登记步骤包含 PF，且 verifier 会把 PF 结果纳入整体状态。当前 registry 只登记 FE-07R 与 FE-01，FE-02～FE-10 的正式入口要由各自既有 ticket 实施授权建立，不能由本 change 预先创建。

用户已将本 change 永久限定为只调整任务、测试内容和执行顺序，不改验证代码。因此，本设计不能改变 ticket closure predicate、DAG、manifest、index、waiver、PF budget 或 release 行为，也不能用文档声称这些行为已经改变。

## Goals / Non-Goals

**Goals:**

- 让每张正式 ready ticket 先获得聚焦、较快的功能反馈，再进入昂贵的完整验证与 PF。
- 以文档化矩阵区分产品功能测试、evidence／provenance 治理测试、legacy UI、PF 和完整 closure，避免开发期无差别运行所有集合。
- 只在测试文件内重组测试内容，在不减弱 acceptance、负例、physical evidence 或 provenance 的前提下改善聚焦反馈。
- 为全部未来 ticket 使用一致的性能问题记录与独立优化立项方式，同时保持现有正式状态语义。

**Non-Goals:**

- 不把 Ticket Status `done` 改为 functional-only，不新增 Performance Status 或中间状态。
- 不允许 task-only 功能检查点解除正式 blocker，不改变 FE-01 → FE-02 等既有 DAG。
- 不修改 verifier、registry、manifest／index／waiver、package scripts、CI、测试配置、harness、descriptor 或 budget。
- 不新增 `verify:quick`、`verify:evidence`、`verify:performance-stage`、selector、自动 fail-fast 或 `skipped.blockedBy`。
- 不保证缩短正式 `verify:ticket`：既有入口仍会执行其完整登记步骤；本 change 主要缩短开发期聚焦反馈。
- 不实施产品功能、性能优化、PF 采样、release 验证或任何票据关闭。

## Decisions

### D1：采用永久 allowlist，禁止通过后续任务扩大范围

本 change 的实施只允许触及：

1. 本 change 自身 OpenSpec artifacts。
2. `openspec/changes/adopt-selected-b2-ui-baseline/tasks.md` 中尚未完成任务的测试内容与执行顺序。
3. 新建的 `.scratch/agent-config-manager-frontend/TEST-EXECUTION-ORDER.md`。
4. 经上述矩阵逐文件登记的测试断言文件：`tests/**/*.test.ts`、`tests/**/*.test.tsx`、`tests/**/*.journey.test.ts`、`performance/**/*.test.ts` 和 `src-tauri/tests/**/*.rs`。不允许新增或修改静态 fixture、test entry、bootstrap 或配置；`src-tauri/src/**` 中的 embedded Rust tests 只盘点和运行，不得随本 change 修改。

永久禁止产品源码、`scripts/**`、`package.json`／lockfile、`.github/**`、`vitest.config.*`、任何 `*wdio*.conf.*`、非断言类 test harness／entry/bootstrap、`fixtures/**`、performance descriptor／budget／waiver／automatic-pass、现有 architecture／product／frontend contracts、tracker、`ARCH-GATE` 和 `RELEASE-GATE`。发现必须修改禁区才能完成某项优化时，该项记录为 out-of-scope，不能扩大本 proposal。

选择 allowlist 而不是只列 denylist，是为了让新建未跟踪 verifier 文件也无法绕过范围审计。替代方案“允许小型 verifier 胶水改动”会逐步恢复此前被删除的 gate 改造，违反永久限制，因此否决。

### D2：保持正式 closure，使用三段式人工执行顺序

每张已经满足现有 gate／frontier／direct blocker 的 ticket 按以下顺序推进：

1. **功能开发反馈**：先实现该 ticket 自身功能，再运行现有 toolchain／static 与精确的 Rust、Vitest、L2、L3 功能测试。成功只允许勾选 task 文本中的 `functional checks complete`，不能更新 Ticket Status、frontier、closure index 或 release 状态。
2. **按影响 evidence 检查**：只有本次改动触及 evidence 测试文件或其既有输入边界时，才在开发反馈中点名运行相应 evidence／provenance tests；无法证明“不受影响”时按保守原则运行。该人工判断写入任务记录，不实现自动 selector。
3. **PF 与正式 closure**：在该 ticket 的功能 acceptance 与必需 L0～L3 均准备完成后，运行既有 acceptance 要求的 PF 和届时已合法建立的 `npm run verify:ticket -- FE-XX`，再独立复审。PF fail／inconclusive 或完整 closure 失败继续阻止 `done`。

**统一失败分流：** 功能、PF 或正式 closure 任一失败／inconclusive 时，停止该 ticket 尚未开始的后续实现、PF 与 closure 工作；无论失败发生在哪一阶段，仍必须跳转到该 ticket 的独立只读复审并记录 finding。复审只审查和记录，绝不是 closure，不能标记 `done`、更新 frontier 或产生 blocker／release credit。此人工分流不改变既有 verifier 在一次正式 invocation 内继续串行全部 registry steps 的语义。

因为正式 DAG 不变，task-only 检查点不能让下游 blocked ticket 提前开始。因此“性能后置”精确定义为后置到每张 ticket 的功能工作之后、正式 `done` 之前；无法在不改验证代码的前提下把所有 PF 移到全部功能 ticket 之后。统一性能优化仅是跨 ticket 使用同一债务清单和单独 change 的排期方式，不是新 runtime stage。

### D3：只用现有 CLI 和精确测试路径，不创建命令面

测试矩阵记录可复制的实际命令、覆盖场景、阻断对象与 provenance。允许的命令形态仅为仓库已有入口或底层工具的精确参数，例如：

- `npm run verify:toolchain`
- `npm run verify:static`
- `npm run test:frontend -- <exact-test-files...>`
- `npm run test:ui -- --spec <exact-existing-spec>`
- ticket acceptance 已明确的现有 Cargo target／Tauri／PF 命令
- 正式阶段的 `npm run verify:ticket -- FE-XX`，但仅当该 ticket 已由自身授权登记且命令实际存在

矩阵不得把精确 Vitest／WDIO／Cargo 成功称为 ticket closure；只有既有正式入口及其 provenance 可取得相应 credit。FE-02～FE-10 目前尚未登记，因此文档只能保存计划命令和 blocker，不能把它们写成可运行或已验证。

### D4：测试矩阵采用人工 primary classification，不实现 selector

`.scratch/agent-config-manager-frontend/TEST-EXECUTION-ORDER.md` 为每个现有和新增 TypeScript／Rust integration test 文件，以及 `src-tauri/src/**` 中每个 embedded Rust test target 登记一个 primary classification：

- `ticket-functional/<FE-ID>`：该 ticket 的功能 contract、domain、session、wire、UI journey 与必要安全负例。
- `evidence/<scope>`：manifest、stable index、waiver、TOCTOU、lineage、physical evidence 与 orchestrator provenance 的对抗测试。
- `legacy-ui`：保留但不承担当前 ticket closure 的历史 Mock 回归。
- `performance/<PF-ID>`：实际 measurement、budget、descriptor 与 performance lifecycle 测试。

同一测试可在完整 closure 中被再次执行，但只能有一个 primary classification。矩阵是人工计划和审查依据，不被 runtime 读取，不承诺自动影响分析或 CI enforcement。新增／拆分测试文件必须与同一提交更新矩阵；未知归属在 review 时阻止本 change 完成。

### D5：测试内容优化必须保留完整覆盖与物理语义

允许把混合测试文件拆成 fast contract cases 与 exhaustive physical cases，或消除可证明重复的测试内 setup；完整 `vitest run` 必须仍发现并执行两者。开发期可只点名 fast／ticket-owned 文件，正式完整入口仍运行 exhaustive 文件。

以下做法禁止：把真实 Git／文件系统／锁／TOCTOU 检查替换成 mock；共享本应独立的 mutable fixture；减少冻结负例；跳过 clean commit、digest、identity 或 reread；通过 `.skip`／`.only`、宽泛 timeout、降低断言或删除样本制造变快。若只改测试内容无法安全提速，则保留原测试并把进一步优化列为需要新授权的后续事项。

### D6：性能问题统一记录，但不改变 verdict

测试矩阵附带 performance optimization backlog，记录 PF ID、ticket、自动结果、metric、budget／descriptor provenance、运行环境、是否阻断当前 closure，以及建议的独立优化 change。该记录是 planning 状态，不修改 manifest、automatic result、waiver 或 stable index。

现有 exact waiver 只能按原范围读取；本 change 不创建、泛化或复用 waiver。性能代码优化、预算调整、重新采样和 release disposition 均需单独立项并遵守届时规则。

### D7：用一次性 changed-path 审计保护范围，不添加脚本

实施前记录 merge-base，提交前把 `merge-base..HEAD`、未暂存、已暂存和未跟踪文件合并为实际 changed-path 集合，并与 D1 allowlist 逐项比对。审计命令只在任务日志中运行，不写入仓库脚本或 CI。任何禁区路径出现即失败；即使文件改动来自“顺手格式化”也不能豁免。

## Risks / Trade-offs

- [正式 closure 仍可能很慢] → 明确本 change 只改善开发反馈；完整入口的性能需要未来另行授权修改验证实现。
- [PF 仍阻塞单票据 `done`，无法真正全项目后置] → 在每票据内最后执行，并把优化问题统一排期；不伪造跨 DAG 的功能完成。
- [人工矩阵可能漂移] → 每个新增／拆分测试都要求同步矩阵并由 reviewer 做零未知归属检查；不声称自动 enforcement。
- [拆分 evidence 测试可能弱化 physical provenance] → 保留 exhaustive cases，禁止 mock 化关键边界，并在完整 frontend 回归中复验。
- [未来 ticket 尚无可执行 registry entry] → 保持 planned／blocked，不由本 change 创建；等待其自身既有授权实施。

## Migration Plan

1. 冻结永久 allowlist／denylist和基线 changed paths，确认 FE-07R／FE-01 历史及现有 gate／frontier 不变。
2. 建立测试执行矩阵，完整登记当前测试的 primary classification、聚焦命令、完整命令和 provenance 边界。
3. 仅重排 `adopt-selected-b2-ui-baseline` 的未完成 ticket tasks：功能实现／功能测试在前，PF／完整 closure／独立复审在末；不改变 acceptance、DAG、状态或已完成 checkbox。
4. 对矩阵中明确批准的慢测试做 test-only RED→GREEN→REFACTOR；逐项证明 focused feedback 改善、完整覆盖与 physical semantics 保持。
5. 执行聚焦检查、完整相关回归、OpenSpec strict、独立只读审查与 changed-path allowlist 审计。本 change 结束时不运行 PF、不关闭 ticket、不调整 gate。

回滚只撤销任务文档、矩阵和测试内容改动。由于不修改验证实现、产品代码或历史 evidence，不需要 schema／artifact migration；若发现禁区文件被修改，直接从本 change 移除该改动并恢复原文件，而不是扩展范围。
