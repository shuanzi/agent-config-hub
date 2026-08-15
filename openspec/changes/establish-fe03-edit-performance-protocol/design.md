## Context

本设计落实 [proposal.md](proposal.md) 中的 planning-only 变更。冻结的 FE-03
acceptance 要求 PF-02/PF-03 分别证明 edit 输入、草稿投影与文件切换，但当前
`PF-02`/`PF-03` 是 FE-02 的 read-only、零草稿协议。它们的 descriptor、fixture
digest、collector、runner、budget、waiver、raw artifact 和 verifier lineage 不能作为
FE-03 的任何输入或证据。

冻结的前端契约已经把 `SensitiveRevealQuery` 规定为通过既有
`FrontendGateway.read` 取得的封闭 query，并将 `SensitiveAccessGrant` 定义为只对一个
敏感片段、revision 和 `view`/`modify` 范围有效的短生命周期授权。ADR-0011 已冻结
Rust wire DTO 为 IPC schema 的事实源，且现有 `FrontendGateway` read/session seam 足以
承载未来的 Rust-first 不透明 grant 消费；本设计不增加 command、trust boundary 或第二个
serialization source。

本文件只描述未来获得批准后的实现路径。它不是 FE-03 实现、PF 运行、budget freeze 或
formal closure 证据，也不改变冻结 acceptance。

## Goals / Non-Goals

**Goals:**

- 定义 `fe03-edit-pf/v1` 的两条独立、可验证和 fail-closed 的 edit 测量 lineage，使
  PF-02/PF-03 不能与 FE-02 read lineage 混淆。
- 将 FE-03 功能验证、edit-PF、预算冻结、formal closure 和独立审查拆成不可跳过的 gate。
- 选择 Rust-first 不透明 `modify` grant，并将 grant 有效期内的敏感明文限制在受控、不可序列化、frontend-local 的 `ephemeral sensitive buffer`；该 buffer 不得成为 shared/persisted `editAsset` draft、session snapshot 或任何 provenance 输入。
- 为未来 additive verifier route 定义交叉借证的拒绝条件，同时保持 legacy FE-02 read
  行为不变。

**Non-Goals:**

- 不实施 descriptor、fixture、collector、runner、evaluator、budget、registry 或 verifier，
  不运行 PF 或 `verify:ticket`。
- 不修改 FE-02 read protocol、既有 budget/waiver/raw evidence 或其 byte/semantic
  fail-closed 行为；不将其泛化为 edit 协议。
- 不授予 L3、actual Tauri IPC、磁盘写入、真实授权或 apply credit；FE-03 的未来验证仍只
  是 L0/L1/L2 与 PF。
- 不在本 change 修改 product baseline、frontend contract 主文、ADR、既有
  `adopt-selected-b2-ui-baseline` artifacts、ticket/tracker，或进入 FE-04/FE-10。

## Decisions

### 1. 以 `fe03-edit-pf/v1` 建立完全独立的 edit measurement graph

未来实现为每个 profile 创建以下不可重名的身份与物理路径；这些均为规划中的新路径，
当前不创建其中任何 runtime artifact。

| 项目                     | PF-02 edit                                                                                                                                                                                                                                          | PF-03 edit                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| protocol identity        | `fe03-edit-pf/v1`                                                                                                                                                                                                                                   | `fe03-edit-pf/v1`                                                                              |
| descriptor identity/path | `PF-02-edit-v1`；`performance/descriptors/fe03-edit-pf/v1/pf-02.edit-source-large.json`                                                                                                                                                             | `PF-03-edit-v1`；`performance/descriptors/fe03-edit-pf/v1/pf-03.edit-multifile-workbench.json` |
| fixture producer/digest  | 新增 `src/gateway/pf-edit-fixtures.ts` 的 `fe03EditPfFixtureDigest`；canonical 输入包括 protocol、descriptor ID、profile、seed、完整安全 bundle 和 edit script                                                                                      | 同左；bundle 与 edit script 包含多文件树、active path、dirty drafts 与切换序列                 |
| collector/config         | 新增 `performance/pf-edit.collector.test.ts`、`performance/wdio.edit.conf.ts`；只接受 `PF_EDIT_PROTOCOL_ID`、`PF_EDIT_DESCRIPTOR_ID`、`PF_EDIT_DESCRIPTOR_PATH`、`PF_EDIT_PROFILE`、`PF_EDIT_OUTPUT_DIR` 和 run ID，并分别记录实际文件 bytes digest | 同左                                                                                           |
| runner/evaluator         | 新增 `scripts/orchestrator/perf-edit.mjs` 和 edit 专用 evaluator/measurement attestation；runner、evaluator 与 attestation module 分别记录实际文件 bytes digest                                                                                     | 同左                                                                                           |
| actual L2 SUT graph      | 对本次 Vite module graph 的 canonical physical module paths 和各模块实际 bytes digest 生成 graph digest/attestation                                                                                                                                 | 同左                                                                                           |
| raw samples              | `.artifacts/performance/FE-03/fe03-edit-pf/v1/PF-02-edit-v1/<run-id>/`                                                                                                                                                                              | `.artifacts/performance/FE-03/fe03-edit-pf/v1/PF-03-edit-v1/<run-id>/`                         |
| evidence/manifest entry  | `.artifacts/verification/FE-03/<run-id>/performance/fe03-edit-pf/v1/PF-02-edit-v1/`                                                                                                                                                                 | `.artifacts/verification/FE-03/<run-id>/performance/fe03-edit-pf/v1/PF-03-edit-v1/`            |
| future budget lineage    | `performance/budgets/fe03-edit-pf/v1/pf-02-edit.budgets.json`、对应 freeze/history 文件                                                                                                                                                             | `performance/budgets/fe03-edit-pf/v1/pf-03-edit.budgets.json`、对应 freeze/history 文件        |

测量输入只能沿以下图传播。每个输入或 attestation file 必须是经物理检查的 regular file，
不得是 symlink；raw/evidence root 及其每个已存在 ancestry component 必须是经物理检查的
directory，且不得是 symlink。任何边缺失、identity/digest 不一致、上述 file/directory
物理规则失败，或出现 read protocol/route/schema/artifact identity 都必须 fail closed：

```text
edit descriptor bytes + descriptor digest
  -> edit fixture generator bytes/digest + fixture digest
  -> collector/config/runner/evaluator/attestation module bytes digests
  -> actual L2 SUT module paths + module bytes digests + graph digest/attestation
  -> scripted mock FrontendGateway + FE-03 draft/session
  -> WDIO edit actions -> raw samples
  -> edit evaluator + measurement attestation
  -> FE-03 manifest entry -> baseline absence attestation OR exact approved budget lineage/formal comparison
```

PF-02 edit 的 action set 必须实际包含安全合成文本的 edit 输入与同 revision 草稿投影；
PF-03 edit 必须实际包含独立的多文件草稿、active-file 切换和草稿投影。二者使用不含敏感
明文、grant 或真实路径的安全 fixture。所有 descriptor、fixture、WDIO environment、
collector/config/runner/evaluator/attestation module 的实际 bytes digest、actual L2 SUT module
graph digest/attestation、raw 目录和 manifest `measurementProtocol` 必须携带同一 protocol ID、
descriptor ID、profile、descriptor digest、fixture digest 与 run identity。record phase 的 budget
binding 必须 fail closed 且互斥：no-budget baseline 记录必须携带 `budgetState=not-frozen` 与可
验证的 budget-lineage absence attestation，明确不存在 budget/freeze/history reference；只有用户
批准后的 formal comparison/closure record 才必须携带 exact approved budget lineage/path/freeze。
仅有相同 path 或逻辑 identity 不足以证明输入相同；任一实际文件 bytes 或 graph membership
漂移都必须使本次 measurement fail closed。

产品 SUT module 或低层无状态 helper 可以同时属于 read 与 edit graph；两条 graph 必须各自
从当前物理文件独立重算并绑定完整 bytes digest/graph attestation。独立结果相同不构成交叉
借证，但不得因此共享 read 的 protocol、route、schema、artifact identity 或已生成
attestation。

`performance/wdio.edit.conf.ts` 缺少或接受错误的 `PF_EDIT_*` identity 时必须停止；它不得
回退到 `PF_READ_*`，也不得把 read config/output 当作默认值。现有 read descriptor/path、
`pf-read-fixtures.ts`、`pf-read.collector.test.ts`、`wdio.read.conf.ts`、read runner 及其
artifact 根完全不变。

替代方案是沿用 `PF-02`/`PF-03` descriptor ID 并以 action 字段区分 read/edit。该方案会让
同一 fixture digest、budget 或 raw evidence 可以被错误投影到不同功能，无法实现
provenance-valid closure，故拒绝。

### 2. 将功能、性能和 closure 固定为有向 gate，而非单一测试批次

未来的任务顺序如下；后一个 gate 不能以计划、mock、PF sample 或上游 FE-02 evidence
替代前一个 gate。

1. prerequisite change 通过独立审查，并经用户验收/冻结和合并后，才可恢复原 FE-03。
2. 完成 FE-03 tasks 3.19–3.22 的完整 RED→GREEN：在 3.19 通过后先复核 Rust-first
   grant 可由既有 `SensitiveRevealQuery`／`FrontendGateway.read` read/session seam 消费且无需新
   command、trust boundary 或 serialization source；随后完成 3.20／3.21 的三类 draft、wire、
   shared draft/UI，并完成 mock/session consumer 及 L0/L1/L2 grant 失效／重新遮蔽测试和完整
   FX-04 functional coverage。只有全部完成后才记录仅针对本票据的 task-only
   `functional checks complete`。此阶段不实施 descriptor、collector 或 edit-PF，且无
   L3/真实 write credit。
3. 仅在第 2 步完整记录 `functional checks complete` 后，实现上述 edit-PF protocol 与
   additive verification route。
4. 使用完整、一次性的 edit-only input graph 采集 no-budget baseline。结果只能标注
   `baseline-collected`、`budgetState=not-frozen` 和 `non-closure`，并绑定可验证的
   budget-lineage absence attestation，明确不存在 budget/freeze/history reference；不得从
   FE-02 继承预算、写入任何预算文件，或重跑挑选通过结果。
5. 从第 4 步的完整 lineage 计算独立的 exact proposed budget table，逐项列出
   descriptor/profile/metric identity、公式、baseline 输入、拟冻结数值、run/digest lineage，
   并标记为 `proposed-not-frozen` 与 `non-closure`；只在回主任务的审批请求中呈现，不写入
   budget/freeze/history 文件。
6. 携第 5 步的 exact table 回主任务取得用户明确的 budget freeze approval。批准前不得写
   edit budget、比较、运行 formal closure、勾选 FE-03 或推进 frontier。
7. 取得批准后才把与获批 table 完全一致的值写入独立 versioned budgets，运行 formal comparison 和
   `verify:ticket -- FE-03`。任何 PF fail/inconclusive 或 manifest/provenance 失败都阻断
   closure；任一 identity、公式、输入、数值或 lineage 变化都必须拒绝写入并重新请求批准。
8. formal closure 之后仍须独立 review；只有所有适用 gate 都通过，才可按主任务的正式
   流程处理 FE-03 状态与 frontier。

该顺序拒绝“先实现/运行性能以解锁功能”的替代方案：它会再次把功能开发耦合到未冻结预算，
并违反 FE-03 3.22 与 3.23 已分离的责任。

### 3. 以 additive FE-03 route 验证 identity，不触碰 legacy FE-02 route

未来的 verifier 只在新的 FE-03 registration/route 被显式选择时读取
`fe03-edit-pf/v1`。它必须将 descriptor bytes/digest、fixture digest、collector/config/
runner/evaluator/attestation module 的 identity 与实际 bytes digest、actual L2 SUT module
graph digest/attestation、raw samples、manifest entry 与 ticket `FE-03` 逐项绑定；record phase 的
budget binding 也必须 fail closed：no-budget baseline 必须验证 `budgetState=not-frozen` 与
budget-lineage absence attestation 且拒绝 budget/freeze/history reference，只有用户批准后的
formal comparison/closure record 才验证 exact approved budget lineage/path/freeze。任一缺失或
不匹配均为 fail closed。

新增的负向测试至少覆盖：将任何 FE-02 read descriptor、fixture digest、raw directory、
budget、waiver 或 manifest 交给 FE-03 route；将任一 edit identity/evidence 交给 legacy
FE-02 route；以及 protocol/descriptor/profile/digest/run ID/physical path、任一实现文件 bytes
digest、actual L2 SUT module graph membership/digest/attestation 任一错配。这些情况都必须被
拒绝而非降级、改名或回退。回归测试还必须证明 legacy FE-02 read 输入、输出、byte-level
artifacts 所表达的语义和 fail-closed 分支不变；新代码只能是 additive，不得让 FE-02
解析、选择或接受 edit evidence。

将既有 verifier 泛化为依据可选 `mode` 接受 read 或 edit 的方案被拒绝，因为它会改变已
冻结 read route 的解释面和错误边界。可共享低层无状态 helper，但 route、schema identity、
文件根和拒绝测试必须保持分离。

### 4. 选择 Rust-first opaque authoritative DTO 作为 `modify` grant

两种候选的比较如下。

| 候选                                      | authority 与生命周期                                                                                                                                                                                                                                                                            | 结论                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| frontend-local ephemeral sensitive buffer | 前端只能在已收到权威 grant 的有效期内，使用受控、不可序列化、frontend-local buffer 暂存所需敏感明文；它不含可签发 claim，且不是 shared/persisted `editAsset` draft 或 session snapshot。若由前端构造或签发 token，前端会成为可伪造的授权事实源，且不能权威验证 revision、scope 或跨适配器身份。 | buffer 不是安全授权；仅可在收到权威 grant 后承担本地显示、TTL 提示及立即清零。                         |
| Rust-first opaque authoritative DTO       | `GatewayCore` 是唯一签发者和验证者；既有 `SensitiveRevealQuery(scope=modify)` 经 `FrontendGateway.read` 返回短生命周期、不透明 DTO。Rust wire DTO/生成 declaration 遵循 ADR-0011，TypeScript 只消费/传递，不构造 claims 或成为第二 serialization source。                                       | 选择唯一授权来源；它保留冻结 read/session seam 与 Rust-first wire source，并使授权可在唯一权威方复验。 |

未来 Rust core 签发的 opaque grant 必须由权威状态绑定 `assetId`、`fileId`、
`SensitiveSegmentRef`、asset/file revision、`scope=modify`、允许的 workbench surface、不可
预测 identity 与 TTL。grant 有效期内，grant 及所需敏感明文仅可在受控、不可序列化、
frontend-local 的 `ephemeral sensitive buffer` 存在；该 buffer 不是 shared/persisted
`editAsset` draft。Rust core 在任何 future consumer 使用时复验全部 binding 和 expiry；TTL
到期或 asset/file/segment/scope/surface 切换、revision 改变时，前端必须立即清零 buffer、使
grant 失效并重新遮蔽，而 Rust 仍在下一次使用时拒绝旧 grant。grant 或敏感明文不得进入
shared/persisted draft、session snapshot、事件、搜索、诊断／analytics、错误文本、日志、缓存、
fixture、vector/golden 或 PF artifact；普通 edit-PF fixture 不得含 grant 或敏感片段。

FE-03 的 L0/L1/L2 mock/session consumer 只能模拟“权威 grant 已存在/已失效”这一预期状态，
验证 asset/file/segment/scope/surface/revision 切换及 TTL 到期时的 buffer 清零和重新遮蔽。
mock 不是发行者或验证者，不能签发或取得 actual authorization credit，不产生真实授权、Tauri
IPC、磁盘写入或 L3 credit，也不得以 frontend 自签 token 代替 Rust grant。

当前选择的前提是 grant 可作为既有 read result/snapshot 的 Rust-first DTO 在既有
`FrontendGateway` read/session seam 内消费，不新增 command、信任边界或第二个
serialization source。若实施发现需要任一项，实施必须标记 `ARCH-GATE: reopen-required`，
停止该路径并回主任务请求用户架构决定；不得在 FE-03 或本 change 中自行扩展。

### 5. 在 task-only functional gate 一次完成 FX-04 与 grant consumer 边界

在完成原 3.19 的正式前提与 Rust-first seam 检查后，3.20–3.22 的 RED→GREEN 必须完整覆盖
冻结的 `FX-04 dirty-multifile-draft`，并与上述 mock/session grant consumer 一起成为同一个
functional gate。它至少要求三类 `editAsset` draft、长期指令首次实际变更建 draft、单活动
草稿、dirty guard、unknown preservation，以及普通编辑无损保留未触碰秘密／敏感修改仍需有效
`modify` grant；同一 asset 内的 file 切换及 source/structured view 切换不得提示，且必须保留
shared draft 与展开状态；locator failure、取消和 continue-editing 不得丢失 draft 或改变
destination，continue-editing 不提交、不切换；该行为只适用于 pending locator
result/context-switch 的 dirty guard。只有存在 pending locator result/context switch 且用户
explicit discard，才原子提交该结果的 type、destination、`AssetRef` 和 detail；普通 discard 只清
frontend draft，不调用 apply 或写盘，也不触发 locator 提交。draft/discard 均不得产生
`PreparedOperation`、review、confirm、replayable payload、IPC、磁盘写入或 apply。

仅当这些 FX-04、grant invalidation/re-masking 和 3.19–3.22 的其余功能 coverage 都完成时，才可
记录 task-only `functional checks complete`。该记录保持 `non-closure`，不提供 L3、actual IPC、
write、authorization 或 closure credit；在此之前以及之后记录前，均不得实施 descriptor、collector
或 edit-PF。

### 6. 将 provenance 按层和票据隔离

FE-02 stable evidence 只能解除 FE-03 的上游 blocker，不给 FE-03 closure credit。FE-03 的
future L0、L1、L2 和 PF 记录各自的 command、输入 identity、运行 ID、覆盖范围和不能宣称的
边界；L2 是 mock `FrontendGateway` browser journey，PF 是该 mock journey 上的性能证据。
二者均不能宣称 actual Tauri IPC、磁盘写入、真实 modify authorization 或 L3。planning
artifacts、mock 行为、runtime evidence 和 formal closure 也必须在 manifest/status 文本中
明确区分，禁止由任意前一类自动抬升后一类。

## Risks / Trade-offs

- [独立 protocol 增加 descriptor、fixture、collector 和 verifier 维护面] → 以共享无状态
  helper 降低重复，但绝不共享 protocol identity、artifact 根或接受路径。
- [功能完成后才实现/采集性能可能较晚暴露性能问题] → 保留明确的 task-only functional gate，
  随后用独立 no-budget baseline 及冻结门禁阻断 closure，而不是提前阻断功能。
- [opaque grant 限制前端可观察字段，调试更困难] → 仅使用脱敏稳定 reason code 和 non-secret
  diagnostic metadata；不得以日志、fixture 或可重放 token 换取可观测性。
- [未来 grant DTO 可能无法在既有 read/session seam 内闭合] → 这是 architecture stop condition；
  标记 `ARCH-GATE: reopen-required` 并请求用户决策，不新增 command 或前端事实源。
- [历史 FE-02 artifacts 容易被误认为可复用样本] → physical directory、descriptor ID、
  manifest identity 和负向交叉借证测试同时隔离，任一错配均 fail closed。

## Migration Plan

本纠偏 PR 当前没有部署或数据迁移：changed-path scope 仅为本 change 的 `proposal.md`、
`design.md`、`specs/fe03-edit-performance-protocol/spec.md` 和 `tasks.md`，因而无需 rollout、
rollback 或任何 runtime state 变更。

在获得 prerequisite change 的独立审查、用户验收/冻结和合并之后，按“功能 → protocol
implementation → no-budget baseline → exact proposed budgets → 用户 freeze →
budget/comparison → formal closure → 独立 review”顺序创建 additive 新文件和 route。实施中的 rollback 是停止 FE-03 后续 gate，
保留已收集的 edit-only raw evidence 及其 `non-closure` 状态；不得删除、重写、迁移或重新解释
FE-02 read artifact，也不得以 edit 结果回填 read lineage。若触发 ARCH-GATE stop condition，
不进入 grant 实施，等待用户的架构选择。
