## 1. 冻结永久范围与当前事实

- [x] 1.1 记录本 change 实施前的 `origin/main` merge-base、实际 changed paths、OpenSpec `adopt-selected-b2-ui-baseline` 完成计数、ARCH-GATE、RELEASE-GATE、ticket frontier 与 FE-07R／FE-01 状态；仅作只读基线，不修改任何 gate、tracker、已完成 task 或历史 evidence。
- [x] 1.2 新建 `.scratch/agent-config-manager-frontend/TEST-EXECUTION-ORDER.md`，逐项写入 design D1 的永久 allowlist／denylist、task-only 功能检查点的非 closure 语义、既有 `verify:ticket`／DAG／PF verdict 保持不变，以及“需改禁区即 out-of-scope”的停止规则。
- [x] 1.3 在矩阵中登记一次性 changed-path 审计方法，使其同时覆盖 `merge-base..HEAD`、已暂存、未暂存和未跟踪文件；以 synthetic 路径列表验证允许路径被接受、`scripts/**`、package／lockfile、CI、配置、harness、产品源码和 performance 非测试文件均被拒绝，但不得把审计实现成仓库脚本、CI 或验证代码。
- [x] 1.4 对范围基线和矩阵边界执行独立只读审查；只有 reviewer 确认没有验证代码、产品实现、状态语义或历史 evidence 变更，才继续调整任务和测试内容。

## 2. 建立人工测试分类与精确执行矩阵

- [x] 2.1 盘点当前全部 `tests/**/*.test.ts`、`tests/**/*.test.tsx`、`tests/**/*.journey.test.ts`、`performance/**/*.test.ts`、`src-tauri/tests/**/*.rs` 和 `src-tauri/src/**` 中的 embedded Rust test targets，为每个文件／target 登记唯一 primary classification：`ticket-functional/<FE-ID>`、`evidence/<scope>`、`legacy-ui` 或 `performance/<PF-ID>`；embedded targets 仅只读登记，不允许修改其产品源文件，零未知归属仅由文档审查保证，不创建 selector 或 runtime registry。
- [x] 2.2 为每个分类记录实际测试文件／Rust target、覆盖场景、必要 fixture／artifact 前置、provenance 边界、开发期精确 Vitest／WDIO／Cargo 命令与正式完整入口；明确这些聚焦结果不是 ticket closure，FE-02～FE-10 未登记前其 `verify:ticket` 只能写作 planned command。
- [x] 2.3 为普通产品改动、测试内容改动、evidence／provenance 输入变化和无法证明影响范围四种情况写出人工选择规则：功能测试始终按 ticket 精确运行，evidence 测试仅在相关边界受影响时点名运行，无法证明时保守运行相关 exhaustive 集合；不得宣称自动影响分析。
- [x] 2.4 在矩阵中增加统一 performance optimization backlog 模板，字段至少包含 ticket、PF ID、automatic result、metric、descriptor／budget provenance、运行环境、当前 closure blocker 和建议的独立优化 change；模板不得生成或修改 manifest、waiver、index、budget、descriptor 或 ticket status。

## 3. 只重排未来 ticket 的测试任务与执行顺序

- [x] 3.1 在 `adopt-selected-b2-ui-baseline/tasks.md` 中保持所有已完成 task 文本／checkbox、既有 task ID、总任务数与功能 DAG 不变；仅编辑 FE-02～FE-10 尚未完成 task 的测试内容和执行顺序，并在每张票据入口重申只有正式 ready ticket 才能开始。统一功能／PF／closure 失败后停止尚未开始的后续实现、PF、closure 并仍进入独立只读复审记录 finding；复审不是 closure，不得标记 `done` 或更新 frontier。
- [x] 3.2 将 FE-02 的 3.10 改为只执行 L0／L1 contract-security、L2 只读详情、L3 actual multi-file read 等功能检查并形成非 closure 的 task-only 检查点；将 PF-02／PF-03 read evidence 移到 3.11 的现有 `verify:ticket -- FE-02` 之前。失败后 3.12 仍须独立复审并记录 finding，但不得标记 `done` 或更新 frontier。
- [x] 3.3 保持 FE-10 无 L3／无 PF：3.16 先执行 L0／L1／L2 功能检查并形成非 closure 检查点，3.17 仍只在 registry entry 已由 FE-10 自身授权建立后运行正式入口；不得因功能检查通过提前 `done`。功能或正式 closure 失败后仍须执行 3.18 独立只读复审记录 finding，但不得标记 `done` 或更新 frontier。
- [x] 3.4 将 FE-03 的 3.22 改为只执行 L0／L1 草稿／保真／dirty guard 与 L2 编辑功能检查；将 PF-02／PF-03 edit evidence 移到 3.23 的正式 closure 之前，并保留无 L3。失败后 3.24 仍须独立复审并记录 finding，但不得标记 `done` 或更新 frontier。
- [x] 3.5 将 FE-04 的 3.28 改为先执行 L0／L1、L2 和 L3 isolated 功能／安全／恢复检查；将 PF-04 移到 3.29 的正式 closure 之前，并保留 PF verdict 与 provenance。失败后 3.30 仍须独立复审并记录 finding，但不得标记 `done` 或更新 frontier。
- [x] 3.6 保持 FE-05 无新增 PF：4.4 先完成 L0～L3 功能检查，4.5 仍为正式 closure，4.6 仍为独立复审与状态更新；功能检查点不得解锁任何 frontier。功能或正式 closure 失败后仍须执行 4.6 独立只读复审记录 finding，但不得标记 `done` 或更新 frontier。
- [x] 3.7 将 FE-06 的 PF-06 从 4.10 功能检查移到 4.11 的既有 `verify:ticket -- FE-06` 之前；失败后仍执行 4.12 独立复审并记录 finding，但不得标记 `done` 或更新 frontier，且保留 L0～L3、安全负例、实际 provenance 和 DAG 不变。
- [x] 3.8 将 FE-07 的 PF-05 从 4.16 功能检查移到 4.17 的既有 `verify:ticket -- FE-07` 之前；失败后仍执行 4.18 独立复审并记录 finding，但不得标记 `done` 或更新 frontier，且保留 L0～L3、index／event 边界、实际 provenance 和 DAG 不变。
- [x] 3.9 将 FE-08 的 PF-07 从 4.22 功能检查移到 4.23 的既有 `verify:ticket -- FE-08` 之前；失败后仍执行 4.24 独立复审并记录 finding，但不得标记 `done` 或更新 frontier，且保留 L0～L3、synthetic candidate、安全负例、实际 provenance 和 DAG 不变。
- [x] 3.10 将 FE-09 的 PF-06 recovery 从 4.28 功能检查移到 4.29 的既有 `verify:ticket -- FE-09` 之前；失败后仍执行 4.30 独立复审并记录 finding，但不得标记 `done` 或更新 frontier，且保留 L0～L3、collision／recovery 安全边界、实际 provenance 和 DAG 不变。
- [x] 3.11 逐项比较重排前后的 FE-02～FE-10 acceptance coverage：每个原有 L0／L1／L2／L3／PF、fixture、负例与 provenance 边界必须恰好保留，且 35/92、已完成 FE-07R／FE-01、ARCH-GATE、RELEASE-GATE 和当前 frontier 不因本 change 改变。

## 4. 评估并实施唯一获准的 test-only 慢测优化

- [x] 4.1 在具备 FE-01 ignored physical artifact 前置的授权工作树中，只读记录 `tests/l1/latest-clean-subject-accepted-with-waiver.test.ts` 的聚焦 wall time、test count、fail／skip 与约 40 个独立 roots 的 setup 次数；若前置 artifact 不可读则将本组标记 blocked 并保持测试零改动，不复制、重建或伪造历史 evidence。
- [x] 4.2 建立“测试名 → 直接被测模块 → 必须保持的 physical／TOCTOU invariant”映射，证明只有“capture 后全局 binary／identity 漂移不影响 run-local evidence”和“run-local identity／binary 缺失、symlink、hash 漂移、污染拒绝”不依赖 waiver、lineage、index、lock 或 historical artifact；无法证明时以零测试改动结束本组。若 4.1 已触发 blocked fallback，则本项为不适用的静态结论，以零测试改动完成收口。
- [x] 4.3 仅在 4.2 成立时新增 fast-contract test 文件，以 fresh temp root、真实 regular identity／binary 和原 capture／validate seam 迁移上述两类断言；从 exhaustive 文件删除对应重复案例，但不得改验证模块、测试配置、harness、锁时序、拒绝原因或 provenance。若 4.1 已触发 blocked fallback 或 4.2 不成立，则本项不适用并保持测试零改动。
- [x] 4.4 保留 exhaustive 文件中所有 Git／waiver／lineage／index／physical evidence／digest／pollution／duplicate-key／legacy supersede／TOCTOU matrices、每案独立物理 root 和约 1 秒锁窗口；禁止 `.skip`／`.only`、mock 化物理边界、共享 mutable root、放宽 timeout、删样本或降低断言。
- [x] 4.5 使用固定 Node 24.18.0／npm 11.16.0 依次运行 fast-contract 文件、exhaustive 文件和一次完整 `test:frontend`，记录前后 wall time、test count、fail／skip；验收只要求语义等价和零遗漏，不预设加速阈值。任一差异无法解释时恢复原测试内容，以零优化结束。若 4.1 已触发 blocked fallback，则上述运行与指标采集不适用；不得运行测试，并以零测试改动完成收口。

## 5. 验证、复审与冻结

- [x] 5.1 对调整后的任务和矩阵执行 OpenSpec strict、Markdown Prettier、tracked／untracked whitespace 检查、链接／task ID／checkbox／计数一致性检查；验证 specs 继续为 `skipped`，没有新增 capability requirement。
- [x] 5.2 若第 4 组产生测试改动，运行矩阵列出的聚焦与完整相关回归；若未产生测试改动，仅运行文档／OpenSpec 校验。两种情况均不得运行 PF sampling、`verify:ticket`、release、产品 runtime 或生成新的 closure evidence。
- [x] 5.3 执行最终 changed-path allowlist 审计，确认差异仅包含本 change artifacts、`adopt-selected-b2-ui-baseline/tasks.md`、`TEST-EXECUTION-ORDER.md` 和矩阵逐文件批准的 TypeScript／Rust integration 测试断言；出现静态 fixture、embedded Rust 产品源或其他禁区路径即移除该改动并重新校验，不得扩大范围。
- [x] 5.4 由独立 reviewer 复核任务顺序、测试覆盖等价性、既有 closure／DAG／PF verdict、FE-01 历史不可变和零验证代码变更；解决全部有效 finding 后取得用户显式验收并冻结本执行计划。不得在本 change 内开始 FE-02、性能优化或正式票据关闭。
