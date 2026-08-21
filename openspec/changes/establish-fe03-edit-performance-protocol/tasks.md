## 1. Prerequisite planning gate

- [x] 1.1 对本 change 的 proposal、delta spec、design 和 tasks 执行独立只读审查，逐项修复有效 finding，并记录审查不构成 FE-03 功能、PF 或 closure 证据。
- [x] 1.2 回主任务取得本 change planning artifacts 的用户显式验收/冻结；仅在该 freeze 后将本 change 合并，且不修改冻结的 FE-03 acceptance、`adopt-selected-b2-ui-baseline` checkbox、ticket 或 tracker。
- [x] 1.3 若 1.1 或 1.2 未完成则记录 blocker 并停止，不恢复 FE-03；只有二者均完成后，才按原 change 的 3.19 重新核验 ARCH-GATE、正式 Ticket Status 和 FE-02 direct-blocker evidence。

## 2. FE-03 功能优先 gate

- [x] 2.1 按原 change 的 3.19 重新核验 ARCH-GATE、正式 Ticket Status 和 FE-02 direct-blocker evidence；任一正式 gate 不满足时仅记录 blocker 并停止，不恢复 FE-03。仅在全部正式 gate 通过后，复核 Rust-first opaque authoritative DTO 可由既有 `SensitiveRevealQuery`／`FrontendGateway.read` read/session seam 消费，且不引入新 command、trust boundary 或第二 serialization source；只有该 grant seam 无法闭合并需要任一此类扩展时，才标记 `ARCH-GATE: reopen-required`，停止 FE-03 恢复并回主任务请求用户架构决定。
- [x] 2.2 为原 change 的 3.20 所需三类 `editAsset` 草稿、长期指令首次实际变更建草稿、单活动草稿、dirty guard、unknown preservation，以及普通编辑无损保留未触碰秘密／敏感修改仍需有效 `modify` grant，先新增可失败的 L0/L1 contract/domain/Rust-first wire 测试，再以最小实现使其转绿；覆盖同一 asset 内 file 切换及 source/structured view 切换不提示且保留 shared draft／展开状态；在 pending locator result/context-switch 的 dirty guard 中，locator failure、取消和 continue-editing 不丢草稿或改变 destination，continue-editing 不提交、不切换；只有存在 pending locator result/context switch 且用户 explicit discard，才原子提交该结果的 type、destination、`AssetRef` 和 detail；普通 discard 只清 frontend draft，不调用 apply 或写盘，也不触发 locator 提交；draft/discard 均不得产生 prepared operation、review、confirm、replayable payload、IPC、磁盘写入或 apply；不纳入 L3。
- [x] 2.3 为原 change 的 3.21 生成或复验 TypeScript wire、vectors 与 drift，并以 RED→GREEN 实现 shared draft 状态与类型特定编辑表面；验证生成物和 vector 不含敏感明文、grant 或真实路径，且 `ephemeral sensitive buffer` 不是 shared/persisted `editAsset` draft。
- [x] 2.4 在 2.1 通过后，以 Rust 权威 DTO 的 mock/session consumer 完成 L0/L1/L2 grant invalidation／re-masking RED→GREEN：grant 与所需明文只可存在于受控、不可序列化、frontend-local 的 `ephemeral sensitive buffer`；TTL 到期或 asset/file/segment/scope/surface/revision 切换立即清零、失效并重新遮蔽。grant/明文不得进入 shared/persisted draft、session snapshot、事件、搜索、诊断／analytics、错误文本、日志、缓存、fixture、vector/golden 或 PF artifact；mock 只模拟权威 grant 已存在／失效，不得签发或取得 actual authorization、IPC、磁盘写入、L3 或真实 write credit。
- [x] 2.5 为原 change 的 3.22 运行仅限 FE-03 的 L0/L1 草稿、保真、dirty guard、FX-04 全量行为和 grant invalidation/re-masking focused checks，以及 mock `FrontendGateway` 的 L2 编辑 journey；仅在 2.1–2.4 与完整 3.19–3.22 functional coverage 全部通过且独立复验后，人工记录 `functional complete` 为 task-only、`non-closure` 结果，并明确无 L3、actual Tauri IPC、磁盘写入、真实授权或真实 write credit。该记录未来只可人工赋予 FE-04 产品功能开发排期资格，不改变 FE-03/FE-04 formal status、DAG/frontier、closure 或 release gate。
- [x] 2.6 在 2.1–2.5 全部完成并已人工记录 `functional complete` 前，不实施、采集或运行 `fe03-edit-pf/v1` 的 descriptor、collector、measurement、comparison 或 formal closure；不得以任何功能检查点勾选 FE-03、更新 frontier 或替代后续 gate。

## 3. 2026-08-21 治理补充 disposition

本节是新增的治理记录，不替换或重新解释上方历史已完成项。它不表示 descriptor、fixture、collector、runner、evaluator、registry、verifier、budget、PF、formal comparison 或 `verify:ticket` 已实现、执行或通过。

- [x] 3.1 已记录 FE-03 的自身 MVP completion record、实际功能检查、未覆盖边界和独立功能复审；它直接支持 MVP `done`，但不提供 L3、actual IPC、真实 grant、磁盘写入或 release credit。
- [x] 3.2 已将原 edit-PF descriptor/fixture/collector/runner/evaluator、registry/manifest、baseline/budget/formal comparison 与逐票 closure 统一标记为 deferred release/optimization 输入；历史 read/edit failure、baseline、budget、waiver、raw artifact 与 provenance 保持原样，不采集、重跑、挑选、删除或互借。
- [x] 3.3 已记录 trusted-runner residual risk：不实现 native `openat` helper、跨平台 secure filesystem、复杂 binary provenance、per-module digest 或 module-graph/physical-ancestry attestation；真实产品安全边界继续由相应产品 ticket 覆盖。
- [x] 3.4 本 change 可在当前治理 PR 合并后按“已归并为 release/optimization planning”归档；未来实际 hardening 必须新建经授权的 change，不自动恢复 FE-03 或创建 FE-04 实现任务。
