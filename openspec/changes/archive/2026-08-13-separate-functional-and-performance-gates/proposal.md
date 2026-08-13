## Why

当前功能开发阶段频繁支付全量 frontend、evidence 治理和 PF 验证成本，反馈过慢。此 change 通过调整任务拆分、测试内容与执行顺序，让每张票据的功能代码和聚焦功能测试先完成，再在该票据末段处理 PF、长耗时回归与正式关闭，并把性能问题统一纳入后续优化清单；它永久禁止修改任何验证实现。

## What Changes

- **永久范围限制**：本 change 只允许修改规划／验收任务文档、测试文件内容，以及这些任务中使用既有命令的执行顺序；不得修改产品代码或任何验证代码。
- 将 FE-02～FE-10 的未来工作按每张正式 ready ticket 拆成两个顺序阶段：先完成该票据的功能实现和聚焦 L0～L3 功能测试，再把适用 PF、完整长耗时回归与正式 closure 放在该票据末段；不同票据的性能问题统一进入一个优化队列，但不得跨越既有 ticket DAG。
- 功能阶段结束只形成 task-only 检查点，不是 Ticket Status、ticket closure、runtime evidence 或 DAG blocker evidence，不得据此启动尚未解除正式 blocker 的下游票据或把当前票据提前标记为 `done`；现有 `verify:ticket`、正式 closure predicate、ticket DAG 和 `RELEASE-GATE` 语义保持不变。
- 建立文档化测试矩阵，按产品聚焦功能、evidence／provenance 治理、legacy UI、PF 和完整 closure 标注现有 TypeScript 与 Rust 测试文件／target；开发期通过 Vitest／WDIO／Cargo 已有 CLI 的精确文件、target 或现有入口运行聚焦集合，不新增 selector、脚本或 package command。
- 仅调整测试文件本身来拆分混合职责、消除重复 fixture 工作或补足功能断言；任何覆盖缩减都必须有等价性证据，且不得修改测试配置、harness、orchestrator、manifest／index／waiver 实现或产品源码。
- 任务执行采用“便宜且确定的检查优先、昂贵检查后置”：功能、PF 或正式 closure 任一失败／inconclusive 时，执行者停止该 ticket 尚未开始的后续实现、PF 与 closure 工作，并仍须转入独立只读复审记录 finding；复审不是 closure，不能标记 `done` 或更新 frontier。这只是任务纪律，不改变 verifier 的“继续串行全部 registry steps”行为，也不生成新的 `skipped/blockedBy` manifest 语义。
- 在每张票据末段按原 ticket closure DAG 使用届时已由该票据既有授权建立的 `npm run verify:ticket -- FE-XX` 和 PF 入口进行实际性能验证、问题归档与独立复审；性能失败仍按现有规则阻止正式 closure。所谓“统一优化”只指跨票据采用同一问题清单和后续独立 change，不代表把 PF 移到 `done` 之后，也不代表当前尚未登记的 FE-02～FE-10 命令已经可运行。
- evidence 治理长耗时测试在普通产品开发反馈中不主动全量运行，但修改其输入、测试内容或历史兼容边界时必须精确运行相关测试；正式 `verify:ticket`、完整 frontend 与 release 回归仍保持原有覆盖，不承诺自动按影响选择。
- FE-07R／FE-01 已完成任务及 FE-01 historical automatic result、waiver、stable index、run-local attestation 和 performance debt 全部保持不可变；不得重写、重采样或重新解释。
- 删除此前关于新 Performance Status schema、自动 fail-fast、suite selector、动态 manifest、stable index、waiver、`verify:evidence`、`verify:performance-stage` 或新 release evaluator 的规划；这些能力都需要修改验证代码，永久不属于本 change。

## Capabilities

### New Capabilities

（无。本 change 仅调整工程任务、测试内容和人工执行顺序；`.openspec.yaml` 设置 `skip_specs: true`。）

### Modified Capabilities

（无。产品行为、正式验证行为和 capability requirements 均不改变。）

## Impact

- **允许修改**：`adopt-selected-b2-ui-baseline/tasks.md` 中尚未完成任务的测试内容与执行顺序、新建测试策略／矩阵文档，以及经矩阵逐文件登记的 `tests/**/*.test.ts`、`tests/**/*.test.tsx`、`tests/**/*.journey.test.ts`、`performance/**/*.test.ts` 与 `src-tauri/tests/**/*.rs` 测试断言内容；这些 `tests/` glob 绝不授权 fixture、harness、bootstrap、config、entry 或其他测试支撑文件。
- **永久禁止修改**：产品源码；`scripts/orchestrator/**`；`TICKET_REGISTRY`；manifest／stable index／waiver 的 schema、reader、writer、validator；`package.json` scripts；CI／automation；Vitest／WDIO／Tauri／Rust test configuration；harness／bootstrap／binary capture；performance descriptor／budget；任何新的验证命令或运行时 selector。
- **正式状态不变**：`verify:ticket` 仍是既有 ticket closure 入口，原 closure DAG、PF 判定、automatic fail、waiver 和 release blocker 继续有效；本 change 只改变开始这些工作的先后顺序。
- **范围审计**：实施提交必须通过基于 merge-base 的 changed-path allowlist 审计；出现任一永久禁止路径即视为本 change 越界并停止，而不是通过扩大 proposal 范围解决。
- 不新增依赖，不执行 PF 采样，不优化产品性能，不开始 FE-02 或后续产品实现。
