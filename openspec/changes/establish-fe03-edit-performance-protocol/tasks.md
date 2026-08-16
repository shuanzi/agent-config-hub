## 1. Prerequisite planning gate

- [x] 1.1 对本 change 的 proposal、delta spec、design 和 tasks 执行独立只读审查，逐项修复有效 finding，并记录审查不构成 FE-03 功能、PF 或 closure 证据。
- [x] 1.2 回主任务取得本 change planning artifacts 的用户显式验收/冻结；仅在该 freeze 后将本 change 合并，且不修改冻结的 FE-03 acceptance、`adopt-selected-b2-ui-baseline` checkbox、ticket 或 tracker。
- [ ] 1.3 若 1.1 或 1.2 未完成则记录 blocker 并停止，不恢复 FE-03；只有二者均完成后，才按原 change 的 3.19 重新核验 ARCH-GATE、正式 Ticket Status 和 FE-02 direct-blocker evidence。

## 2. FE-03 功能优先 gate

- [ ] 2.1 按原 change 的 3.19 重新核验 ARCH-GATE、正式 Ticket Status 和 FE-02 direct-blocker evidence；任一正式 gate 不满足时仅记录 blocker 并停止，不恢复 FE-03。仅在全部正式 gate 通过后，复核 Rust-first opaque authoritative DTO 可由既有 `SensitiveRevealQuery`／`FrontendGateway.read` read/session seam 消费，且不引入新 command、trust boundary 或第二 serialization source；只有该 grant seam 无法闭合并需要任一此类扩展时，才标记 `ARCH-GATE: reopen-required`，停止 FE-03 恢复并回主任务请求用户架构决定。
- [ ] 2.2 为原 change 的 3.20 所需三类 `editAsset` 草稿、长期指令首次实际变更建草稿、单活动草稿、dirty guard、unknown preservation，以及普通编辑无损保留未触碰秘密／敏感修改仍需有效 `modify` grant，先新增可失败的 L0/L1 contract/domain/Rust-first wire 测试，再以最小实现使其转绿；覆盖同一 asset 内 file 切换及 source/structured view 切换不提示且保留 shared draft／展开状态；在 pending locator result/context-switch 的 dirty guard 中，locator failure、取消和 continue-editing 不丢草稿或改变 destination，continue-editing 不提交、不切换；只有存在 pending locator result/context switch 且用户 explicit discard，才原子提交该结果的 type、destination、`AssetRef` 和 detail；普通 discard 只清 frontend draft，不调用 apply 或写盘，也不触发 locator 提交；draft/discard 均不得产生 prepared operation、review、confirm、replayable payload、IPC、磁盘写入或 apply；不纳入 L3。
- [ ] 2.3 为原 change 的 3.21 生成或复验 TypeScript wire、vectors 与 drift，并以 RED→GREEN 实现 shared draft 状态与类型特定编辑表面；验证生成物和 vector 不含敏感明文、grant 或真实路径，且 `ephemeral sensitive buffer` 不是 shared/persisted `editAsset` draft。
- [ ] 2.4 在 2.1 通过后，以 Rust 权威 DTO 的 mock/session consumer 完成 L0/L1/L2 grant invalidation／re-masking RED→GREEN：grant 与所需明文只可存在于受控、不可序列化、frontend-local 的 `ephemeral sensitive buffer`；TTL 到期或 asset/file/segment/scope/surface/revision 切换立即清零、失效并重新遮蔽。grant/明文不得进入 shared/persisted draft、session snapshot、事件、搜索、诊断／analytics、错误文本、日志、缓存、fixture、vector/golden 或 PF artifact；mock 只模拟权威 grant 已存在／失效，不得签发或取得 actual authorization、IPC、磁盘写入、L3 或真实 write credit。
- [ ] 2.5 为原 change 的 3.22 运行仅限 FE-03 的 L0/L1 草稿、保真、dirty guard、FX-04 全量行为和 grant invalidation/re-masking focused checks，以及 mock `FrontendGateway` 的 L2 编辑 journey；仅在 2.1–2.4 与完整 3.19–3.22 functional coverage 全部通过后，记录 `functional checks complete` 为 task-only、`non-closure` 结果，并明确无 L3、actual Tauri IPC、磁盘写入、真实授权或真实 write credit。
- [ ] 2.6 在 2.1–2.5 全部完成并已记录 `functional checks complete` 前，不实施、采集或运行 `fe03-edit-pf/v1` 的 descriptor、collector、measurement、comparison 或 formal closure；不得以任何功能检查点勾选 FE-03、更新 frontier 或替代后续 gate。

## 3. Edit-PF protocol 实现 gate

- [ ] 3.1 仅在 2.5 已记录 `functional checks complete` 后，创建 `fe03-edit-pf/v1` 的 `PF-02-edit-v1` 与 `PF-03-edit-v1` descriptor 及各自物理 path，定义 edit 输入、草稿投影、文件切换、profile/seed 和 fail-closed identity 校验；不得复用、改名或修改任何 read descriptor。
- [ ] 3.2 实现 edit 专用安全 fixture generator 与 canonical fixture digest，令 PF-02 包含 edit 输入和同 revision 草稿投影，PF-03 包含多文件草稿、active-file 切换和投影；验证 fixture、digest 和 edit script 不含敏感明文、grant 或真实路径，且不复用 `pf-read-fixtures.ts` 的 identity。
- [ ] 3.3 实现 edit 专用 WDIO collector/config、runner、evaluator 和 measurement attestation，使其只接受并绑定 `PF_EDIT_*` protocol/descriptor/profile/path/run identity，并记录 collector/config/runner/evaluator/attestation module 的实际 bytes digest 与 actual L2 SUT module graph digest/attestation，输出独立 raw/evidence directory；每个输入/attestation file 必须是非 symlink physical regular file，raw/evidence root 及其已存在 ancestry 必须是非 symlink physical directory，任一 bytes/graph 漂移、缺失、错配或 `PF_READ_*` 回退均 fail closed。

## 4. Additive verification route gate

- [ ] 4.1 仅在 3.1–3.3 通过后，为 FE-03 增加 edit-only registry entry 和 `verify:ticket` route，将 descriptor bytes/digest、fixture digest、collector/config/runner/evaluator/attestation module identity 与实际 bytes digest、actual L2 SUT module graph digest/attestation、measurement-input graph、raw samples、manifest 与 ticket `FE-03` 逐项绑定，并按 record phase fail close：no-budget baseline 验证 `budgetState=not-frozen` 与 budget-lineage absence attestation 且拒绝 budget/freeze/history reference；只有用户批准后的 formal comparison/closure record 验证 exact approved budget lineage/path/freeze；不得改变 legacy FE-02 read route。
- [ ] 4.2 新增负向 focused tests：任一 FE-02 read descriptor、fixture digest、collector、budget、waiver、raw/evidence directory 或 manifest 交给 FE-03 edit route 时必须被拒绝；任一 edit identity/evidence 交给 legacy FE-02 route 时也必须被拒绝。
- [ ] 4.3 为 protocol/descriptor/profile/digest/run ID/physical path、collector/config/runner/evaluator/attestation module bytes digest 或 actual L2 SUT module graph membership/digest/attestation 错配新增拒绝测试，并证明 legacy FE-02 read 的字节内容、语义和 fail-closed 结果不变；若任一回归失败，拒绝 additive route，不得以 edit evidence 覆盖或替代 read lineage。

## 5. No-budget baseline gate

- [ ] 5.1 仅在 4.1–4.3 通过后，以完整且单次的 edit-only measurement-input graph 采集 `PF-02-edit-v1` 和 `PF-03-edit-v1` no-budget raw samples、attestation 与 evidence，保留独立 run identity、descriptor/fixture digest、collector/config/runner/evaluator/attestation module bytes digest、actual L2 SUT module graph digest/attestation 和 raw lineage；不得重跑或挑选通过样本。
- [ ] 5.2 将两条 baseline 均明确标记为 `baseline-collected`、`budgetState=not-frozen` 和 `non-closure`，并绑定可验证的 budget-lineage absence attestation，明确不存在 budget/freeze/history reference；验证此状态不继承 FE-02 budget、不写入任何 budget/freeze/history 文件、不触发 formal comparison/closure、不勾选 FE-03 且不推进 frontier。
- [ ] 5.3 从 5.1 的完整 edit-only lineage 计算 independent exact proposed budget table，逐项列出 descriptor/profile/metric identity、公式、baseline 输入、拟冻结数值、run/digest lineage，并标记为 `proposed-not-frozen` 与 `non-closure`；仅供后续审批呈现，不写入 budget/freeze/history 文件。

## 6. 用户 budget freeze 停点

- [ ] 6.1 携带 5.1–5.3 的完整 edit-only baseline/provenance 与 exact `proposed-not-frozen` budget table 回主任务，请求用户对该表中的具体 identity、公式、输入、数值和 lineage 作出明确 budget freeze approval，并在收到无歧义批准前停止。
- [ ] 6.2 在 6.1 未获批准时，不写任何 edit budget/freeze/history 文件，不运行 formal comparison、`verify:ticket -- FE-03` 或 3.23，不勾选 FE-03 且不更新 frontier。

## 7. 获批后的预算与 formal closure gate

- [ ] 7.1 仅在用户明确批准 freeze 后，从 5.1 的完整 raw lineage 写入与获批 5.3 table 完全一致的独立 versioned `fe03-edit-pf/v1` PF-02/PF-03 budget、freeze 和 history 文件，并验证没有 FE-02 budget、waiver 或样本进入其 lineage；任一 identity、公式、输入、数值或 lineage 变化均停止写入并重新请求批准。
- [ ] 7.2 仅在 7.1 成功后运行 edit-only formal comparison，并令 formal comparison/closure record 绑定 exact approved budget lineage；任何 budget、descriptor、fixture、attestation、manifest 或 comparison 的 fail/inconclusive 均阻断后续 closure。
- [ ] 7.3 仅在 7.2 通过且 FE-03 自身 registry entry 已存在后，按原 change 3.23 先保留 PF-02/PF-03 edit 的层级、run identity 和未覆盖边界，再运行 `npm run verify:ticket -- FE-03`；formal closure 失败/inconclusive 不得标记 FE-03 done。

## 8. 最终验证、独立审查与状态 gate

- [ ] 8.1 在每个实现 gate 后运行相应的 focused RED→GREEN、静态/类型、wire drift、grant invalidation、collector/evaluator 和 verifier negative tests；测试结果必须按 L0/L1/L2/PF 分层记录，mock PASS 不得抬升为 runtime 或 closure credit。
- [ ] 8.2 在交付前使用 OpenSpec 1.8 的 positional change-scoped 语法运行 `openspec validate establish-fe03-edit-performance-protocol --type change --strict --no-interactive`，再运行 `openspec validate --all --strict --no-interactive`，并修复本 change artifacts 的有效 validation finding。
- [ ] 8.3 对本 change 的 Markdown 运行目标 Prettier，对 tracked/untracked changed paths 运行 whitespace 检查；本纠偏 PR 的精确 changed-path scope 仅为 `proposal.md`、`design.md`、`specs/fe03-edit-performance-protocol/spec.md` 和 `tasks.md`。只有本 change 经重新验收／冻结后，future implementation 才可使用本任务已声明的 FE-03 functional、edit-PF 与 additive verification route paths；不得通过本 validation 修改既有 read PF、budget、waiver、collector/verifier、历史 evidence 或其他 change。
- [ ] 8.4 按原 change 3.24 执行独立只读审查，即使功能、PF 或 closure 失败/inconclusive 也记录 finding 且不把审查本身当 closure；修复有效 finding 后重新运行受影响的 focused checks。
- [ ] 8.5 只有 1.1–8.4 的全部适用 gate 均通过、3.23 formal closure 成功且 3.24 独立审查无未解决有效 finding 后，才按正式流程标记 FE-03 done 并更新 frontier；否则保持现有状态并停止后续 FE-04。
