## Purpose

定义 FE-03 edit 草稿性能证据的独立、可验证 provenance 与预算生命周期，并在不改变冻结验收或既有 read 证据的前提下约束敏感 `modify` grant 的授权边界。

## ADDED Requirements

### Requirement: versioned 且身份分离的 edit 性能协议

系统 MUST 为 FE-03 edit-PF 维护独立且 versioned 的协议 identity。`PF-02-edit-v1` 与 `PF-03-edit-v1` MUST 是 edit 专用 descriptor ID，且各自使用独立 path。每个 edit 测量记录 MUST 同时绑定其 descriptor ID/path/bytes digest、fixture digest、collector/config/runner/evaluator identity 与各自的实际 bytes digest、actual L2 SUT module graph digest/attestation、measurement-input graph、raw sample/evidence directory 和 manifest provenance。record phase 的 budget binding MUST fail closed 且互斥：no-budget baseline MUST 绑定 `budgetState=not-frozen` 与可验证的 budget-lineage absence attestation，明确不存在 budget/freeze/history reference；只有用户批准后的 formal comparison/closure record MUST 绑定 exact approved budget lineage/path/freeze。任何一个 edit 专用 protocol/route/schema/artifact identity 与既有 read PF 共用，任何实际输入 bytes digest/graph attestation 缺失、未在 edit graph 内独立重算绑定或无法相互验证，或 record phase 的 budget binding 缺失／错配时，系统 MUST 将该 edit 记录判为无效，而不得将其用于 baseline、比较或 closure。read/edit graph 真实共享同一产品 SUT module 或无状态 helper 时，其独立重算得到的相同 bytes digest 本身 MUST NOT 被视为 identity 共用或交叉借证。

#### Scenario: 采集完整的 edit 测量记录

- **WHEN** 功能 gate 已满足后采集一个 FE-03 edit-PF no-budget baseline 样本
- **THEN** 系统 MUST 记录全部 edit 专用 identity 与其 versioned 绑定，并绑定 `budgetState=not-frozen` 与 budget-lineage absence attestation，不得出现 budget/freeze/history reference；该记录只能归属 FE-03 edit 输入、草稿投影或文件切换

#### Scenario: 记录获批后的 formal comparison 或 closure

- **WHEN** 用户已经批准 exact budget table 且系统记录 FE-03 formal comparison 或 closure
- **THEN** 系统 MUST 继续绑定全部 edit 专用 identity，并且只能绑定与该批准完全一致的 exact approved budget lineage/path/freeze

#### Scenario: read 与 edit graph 共享产品 SUT module

- **WHEN** 同一产品 SUT module 合法进入 read 与 edit measurement graph，且两个 graph 分别从当前实际 bytes 独立重算并绑定其 digest
- **THEN** 系统 MUST 允许两个 attestation 出现相同 bytes digest，同时继续拒绝 protocol、route、schema 或 artifact identity 的任何共用

### Requirement: read 与 edit 证据不得交叉借用

系统 MUST 将 FE-03 edit-PF 与 FE-02 read PF 作为不可混淆的独立 provenance 域。系统 MUST NOT 复用、改名、修改或重新解释 FE-02 的 read descriptor、fixture、collector、budget、waiver、raw artifacts、evidence 或 manifest 作为 FE-03 edit 证据；FE-02 的 stable evidence 只可解除 direct blocker，MUST NOT 提供 FE-03 closure credit。协议验证 MUST 拒绝任何 read/edit identity 或 lineage 交叉借用。

#### Scenario: 尝试引用 FE-02 read 预算

- **WHEN** 一个 FE-03 edit 记录引用 FE-02 的 read budget、waiver、descriptor 或 evidence identity
- **THEN** 系统 MUST 拒绝该记录，不得生成 edit baseline、formal comparison 或 FE-03 closure credit

### Requirement: 功能阶段先于 edit 性能阶段

系统 MUST 将 FE-03 tasks 3.19–3.22 的完整 RED→GREEN 和 task-only `functional checks complete` 作为实施或执行 edit-PF 的前置条件。该完整 functional gate MUST 在原 3.19 正式前提通过后，先验证 Rust-first opaque authoritative `modify` grant 能由既有 `SensitiveRevealQuery`／`FrontendGateway.read` read/session seam 消费且不引入 command、trust boundary 或 serialization source，再完成 mock/session consumer 及 L0/L1/L2 grant invalidation/re-masking tests 和冻结 FX-04 的全部 functional coverage。只有这些条件全部完成，才可记录该 task-only 结果；在此之前，系统 MUST NOT 实施、采集或执行 edit descriptor、collector、measurement、comparison 或 closure。功能检查点本身 MUST 保持 non-closure，且 MUST NOT 勾选 FE-03、更新 frontier 或替代任何正式 gate。

#### Scenario: 功能检查尚未完成

- **WHEN** FE-03 的 tasks 3.19–3.22 尚未全部完成 RED→GREEN 与 task-only functional checks
- **THEN** 系统 MUST 拒绝进入 edit-PF 阶段，并保留 FE-03 的正式状态、frontier 与 closure gate 不变

#### Scenario: grant functional work 未完成

- **WHEN** Rust-first seam 检查、mock/session consumer 或 L0/L1/L2 grant invalidation/re-masking tests 中任一项未完成
- **THEN** 系统 MUST 不记录 `functional checks complete`，并拒绝实施 descriptor、collector 或进入 edit-PF

### Requirement: no-budget baseline 与显式预算冻结

系统 MUST 在功能阶段完成后先采集 FE-03 edit-PF 的独立、单次 no-budget baseline，并且只能将其标记为 `baseline-collected`、`budgetState=not-frozen` 与 `non-closure`。该 baseline MUST 绑定可验证的 budget-lineage absence attestation，明确不存在 budget/freeze/history reference，且 MUST NOT 写入任何 budget/freeze/history 文件。系统 MUST 从该完整 edit-only baseline lineage 计算并向用户呈现独立的 exact proposed budget table，逐项包含 descriptor/profile/metric identity、公式、baseline 输入、拟冻结数值和 lineage，并将该表标记为 `proposed-not-frozen` 与 `non-closure`；该提案 MUST NOT 写入 budget/freeze/history 文件。只有用户明确批准后的 formal comparison/closure record MUST 绑定 exact approved budget lineage。在用户对该 exact table 作出明确 budget freeze approval 前，系统 MUST NOT 写入 edit budget、执行 formal comparison 或 closure、勾选 FE-03 或推进 frontier。系统 MUST NOT 继承 FE-02 budget，且 MUST NOT 通过重跑或选择样本取得通过结果。

#### Scenario: baseline 已采集但尚未获冻结批准

- **WHEN** FE-03 edit no-budget baseline 已经存在而用户尚未明确批准 freeze
- **THEN** 系统 MUST 保持 `baseline-collected`、`budgetState=not-frozen` 与 `non-closure` 三状态及 absence attestation 不变；只有在呈现 exact `proposed-not-frozen` budget table 后才可请求批准，并继续拒绝写入预算、比较、closure、FE-03 勾选与 frontier 更新

#### Scenario: 获批后拟冻结值发生变化

- **WHEN** 准备写入的任一 budget identity、公式、baseline 输入、拟冻结数值或 lineage 与用户明确批准的 exact table 不同
- **THEN** 系统 MUST 拒绝写入，并将变化后的 table 作为新的 `proposed-not-frozen` 提案重新请求用户批准

### Requirement: additive route 保持既有 read 行为

系统 MUST 仅通过 additive FE-03 route 承接 edit-PF 与未来的 ticket 验证。该 route MUST 保持 legacy FE-02 read 路径的字节内容、语义和 fail-closed 行为不变，并 MUST 具有验证 read/edit 交叉借证被拒绝的负向行为；任何无法同时满足这两项的变更 MUST NOT 进入该 route。

#### Scenario: edit route 影响 legacy read 输入或结果

- **WHEN** 对 edit-PF route 的评估发现 FE-02 read 路径的字节内容、语义或 fail-closed 结果发生变化
- **THEN** 系统 MUST 拒绝该 route，且不得以 edit 证据替代或覆盖既有 read 结果

### Requirement: FE-03 证据层级与 write credit 隔离

系统 MUST 将 FE-03 的 L0、L1、L2 与 PF 证据分别记录其输入、运行 identity 和未覆盖边界。FE-03 MUST NOT 产生 L3、actual Tauri IPC、磁盘写入、真实 `modify` grant 或真实 write credit；mock grant、mock edit、草稿与 discard 结果 MUST NOT 被表述为任一此类 credit。

#### Scenario: L2 mock 编辑旅程通过

- **WHEN** 以 mock gateway 运行的 L2 编辑或 grant failure journey 通过
- **THEN** 系统 MUST 仅将其记录为 L2 mock provenance，并明确其不证明实际 IPC、磁盘写入、真实授权或真实写入

### Requirement: FX-04 draft 行为必须在 functional gate 完整覆盖

在记录 task-only `functional checks complete` 前，系统 MUST 以 L0/L1/L2 完整覆盖冻结的 `FX-04 dirty-multifile-draft`：三类 `editAsset` draft、长期指令首次实际变更建 draft、单活动草稿、dirty guard、unknown preservation，以及普通编辑无损保留未触碰秘密／敏感修改仍需有效 `modify` grant。同一 asset 内 file 切换及 source/structured view 切换 MUST 不提示，且 MUST 保留 shared draft 和展开状态；在 pending locator result/context-switch 的 dirty guard 中，locator failure、取消和 continue-editing MUST NOT 丢失 draft 或改变 destination，continue-editing MUST NOT 提交或切换。只有存在 pending locator result/context switch 且用户 explicit discard 时，系统才 MUST 原子提交该结果的 type、destination、`AssetRef` 和 detail；普通 discard MUST 只清 frontend draft，MUST NOT 调用 apply 或写盘，也 MUST NOT 触发 locator 提交。draft/discard MUST NOT 产生 `PreparedOperation`、review、confirm、replayable payload、IPC、磁盘写入或 apply。该 coverage 与 grant mock/session consumer 的 invalidation/re-masking tests 共同构成 functional gate，但 MUST NOT 取得 L3、actual IPC、write 或 closure credit。

#### Scenario: 同一 asset 的 file 或 view 切换

- **WHEN** 用户在同一 asset 的文件间切换，或在 source 与 structured view 间切换
- **THEN** 系统 MUST 不提示，并保留 shared draft 与展开状态，且不得产生 prepared operation、review、confirm、replayable payload、IPC、磁盘写入或 apply

#### Scenario: locator 失败或用户保留编辑

- **WHEN** pending locator result/context-switch 的 dirty guard 中发生 locator failure，或用户取消／选择 continue-editing
- **THEN** 系统 MUST 保留 draft 及其 destination；continue-editing MUST 不提交、不切换，且不得静默丢弃、改写 destination 或产生 prepared operation、review、confirm、replayable payload、IPC、磁盘写入或 apply

#### Scenario: 用户明确 discard 草稿

- **WHEN** 存在 pending locator result/context switch，且用户明确选择 discard
- **THEN** 系统 MUST 仅在此时原子提交该结果的 type、destination、`AssetRef` 和 detail；discard MUST 只清 frontend draft，不调用 apply 或写盘，且不得产生 prepared operation、review、confirm、replayable payload、IPC、磁盘写入或 apply

#### Scenario: 不带 pending locator result/context switch 的普通 discard

- **WHEN** 用户在不存在 pending locator result/context switch 时明确选择 discard
- **THEN** 系统 MUST 只清 frontend draft，不调用 apply 或写盘，也不得触发 locator 提交或产生 prepared operation、review、confirm、replayable payload、IPC、磁盘写入或 apply

### Requirement: 敏感 modify grant 的权威边界与失效

在未触发 ARCH-GATE 重开条件时，未来的 FE-03 implementation 对敏感段修改 MUST 使用 Rust-first 签发并验证的 opaque authoritative `modify` grant，前端只能在既有 read/session seam 消费其授权结果。该 grant MUST 绑定 asset、file、具体 `SensitiveSegmentRef`/segment identity、authoritative revision、scope、TTL 与当前修改 surface，并且 MUST NOT 复用于其他敏感片段；签发者与验证者 MUST 是权威边界，frontend-local self-signed token MUST NOT 具有授权效力。grant 有效期内，grant 与敏感明文只允许存在于受控、不可序列化、frontend-local 的 `ephemeral sensitive buffer`；该 buffer MUST NOT 是 shared/persisted `editAsset` draft。grant 超时，或资产/文件/segment/scope/surface 切换、revision 改变时，系统 MUST 立即清零 buffer、使 grant 失效并重新遮蔽。grant 与敏感明文 MUST NOT 进入 shared/persisted draft、session snapshot、事件、搜索、诊断／analytics、错误文本、日志、缓存、fixture、vector/golden 或 PF artifact。planning、L0/L1/L2 或 PF 中的 mock grant 仅能模拟权威 grant 已存在／已失效，MUST NOT 签发 grant 或取得 actual authorization credit。

#### Scenario: 授权后的 revision 发生变化

- **WHEN** 一个敏感 `modify` grant 仍存在但其绑定的 authoritative revision 已变化
- **THEN** 系统 MUST 立即清零 `ephemeral sensitive buffer`、拒绝继续修改、使 grant 失效并重新遮蔽敏感段，且不得将 grant 或明文保留在 shared/persisted draft、session snapshot、事件、搜索、诊断／analytics、错误文本、日志、缓存、fixture、vector/golden 或 PF artifact

#### Scenario: 前端自行生成授权标识

- **WHEN** 前端产生未由 Rust 权威边界签发和验证的 ephemeral token
- **THEN** 系统 MUST 将其视为无授权效力，并且不得以该 token 展示、修改或解除敏感段遮蔽

#### Scenario: grant 被用于另一个敏感片段

- **WHEN** 调用方尝试将一个 `modify` grant 用于其绑定 `SensitiveSegmentRef` 之外的敏感片段
- **THEN** 系统 MUST 拒绝该 grant、保持目标片段遮蔽，并且不得把同 asset/file/revision 视为可跨片段复用的授权

### Requirement: 架构重开与恢复 FE-03 的独立 gate

系统 MUST 将 prerequisite protocol freeze、恢复后的功能阶段、no-budget baseline、用户 budget freeze、formal closure 与独立 review 视为互不替代且有序的 gate。若满足敏感 grant 要求的任何方案需要新 command、trust boundary 或 serialization source of truth，系统 MUST 将 ARCH-GATE 标记为 `reopen-required`，停止该架构选择和 FE-03 恢复，并请求用户架构决策。恢复 FE-03 前只要求本 prerequisite change 的 artifacts 已完成独立审查、用户验收/冻结并合并；恢复后 MUST 再按功能、no-budget baseline、用户 budget freeze、formal closure、独立 review 的顺序推进，任何后置 gate MUST NOT 反向成为恢复 FE-03 的前置条件。

#### Scenario: grant 方案需要新增 command

- **WHEN** grant 架构评估表明必须引入新的 command、trust boundary 或 serialization source of truth
- **THEN** 系统 MUST 标记 ARCH-GATE 为 `reopen-required`、停止 FE-03 恢复，并等待用户的架构决定

#### Scenario: prerequisite artifacts 尚未冻结并合并

- **WHEN** 本 change 尚未完成独立审查、用户验收/冻结或合并
- **THEN** 系统 MUST NOT 恢复原 FE-03 工作，且不得将任何前置 gate 结果当作其他 gate 的替代
