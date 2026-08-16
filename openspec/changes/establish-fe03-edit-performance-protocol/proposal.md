## Why

冻结的 FE-03 acceptance 要求 PF-02/PF-03 证明 edit 输入、草稿投影和文件切换，但现有 PF 仅覆盖 read-only／零草稿路径；复用 FE-02 的 read descriptor、budget、waiver 或证据会破坏 provenance。与此同时，敏感段 `modify` grant 已有安全语义，却尚未确定其权威签发与验证边界，不能让前端自签能力冒充授权。

## What Changes

- 新建 additive、versioned 且 identity-separated 的 FE-03 edit-PF protocol：edit 专用 descriptor ID/path、fixture digest、collector/config、measurement-input graph、raw sample/evidence directory 与 manifest provenance 必须彼此绑定，并与既有 read PF 的 identity 完全分离。record phase 的 budget binding 互斥：no-budget baseline 必须绑定 `budgetState=not-frozen` 与可验证的 budget-lineage absence attestation，明确不存在 budget/freeze/history reference；只有用户批准后的 formal comparison/closure record 才必须绑定 exact approved budget lineage/path/freeze。协议将要求防止 read/edit 交叉借证的负向验证；不得复用、改名、修改或重解释 FE-02 的 read evidence、budget、waiver、raw artifacts、collector 或 verifier 行为。
- 将 FE-03 的实施顺序固定为功能优先：先完成 tasks 3.19–3.22 的完整 RED→GREEN，包括 Rust-first grant 架构／既有 read-session seam 检查、mock/session consumer 及其 L0/L1/L2 失效／重新遮蔽测试，并覆盖冻结的 FX-04；仅在这些均完成后才可记录 task-only `functional checks complete`，随后才可实施 descriptor、collector 或执行 edit-PF。功能完成后先采集独立的 no-budget baseline，其状态只能为 `baseline-collected`、`budgetState=not-frozen` 与 `non-closure`，并附可验证的 budget-lineage absence attestation，明确不存在 budget/freeze/history reference；不得继承 FE-02 budget、重跑挑选通过结果、写入预算文件，或在用户显式 freeze approval 前比较、closure、勾选 FE-03 或推进 frontier。
- 仅为未来获准的 implementation 规划 edit-specific descriptor/fixture generator、WDIO collector/config、runner/evaluator/measurement attestation 及 additive `verify:ticket` route。该 route 必须保持 legacy FE-02 read 路径 fail-closed、字节和语义不变，并把 L0/L1/L2/PF evidence 分层；无 L3、无 actual Tauri IPC、磁盘写入或真实 write credit，mock grant/edit 也不得冒充真实授权或写入。
- 澄清敏感 `modify` grant 的架构选择：Rust-first opaque authoritative DTO 是唯一授权来源，且只可在既有 `FrontendGateway` read/session seam 中消费。grant 有效期内，grant 与敏感明文只可存在于受控、不可序列化、frontend-local 的 `ephemeral sensitive buffer`，它不是 shared/persisted `editAsset` draft；grant 或明文不得进入 shared/persisted draft、session snapshot、事件、搜索、诊断／analytics、错误文本、日志、缓存、fixture、vector/golden 或 PF artifact。TTL 到期或 asset/file/segment/scope/surface/revision 变化必须立即清零、失效并重新遮蔽；mock 只模拟权威 grant 已存在／失效，不能签发或取得 actual authorization credit。若任何可行方案需要新 command、trust boundary 或 serialization source of truth，必须将 ARCH-GATE 标为 reopen-required，停止并回主任务请求用户架构决策。
- 将冻结 FX-04 的完整 functional coverage 固定为未来 implementation 的前置工作：三类 draft、长期指令首次实际变更建 draft、单活动草稿、dirty guard、unknown preservation，以及普通编辑无损保留未触碰秘密／敏感修改仍需有效 `modify` grant；同一资产内 file 切换和 source/structured view 切换不提示且保留 shared draft／展开状态；在 pending locator result/context-switch 的 dirty guard 中，locator failure、取消和 continue-editing 不丢 draft 或改变 destination，continue-editing 不提交、不切换；只有存在 pending locator result/context switch 且用户 explicit discard，才原子提交该结果的 type、destination、`AssetRef` 和 detail；普通 discard 只清 frontend draft，不调用 apply 或写盘，也不触发 locator 提交；draft/discard 均不产生 prepared operation、review、confirm、replayable payload、IPC、磁盘写入或 apply。
- 本 change 的 artifacts 经独立审查、用户验收/冻结并合并后，才允许恢复原 FE-03；protocol freeze、功能阶段、no-budget baseline、用户 budget freeze、formal closure 与独立 review 必须保持为独立 gate。

## Capabilities

### New Capabilities

- `fe03-edit-performance-protocol`: 定义 FE-03 edit 草稿性能证据的独立身份、provenance 与预算生命周期，以及敏感 `modify` grant 的受 ARCH-GATE 约束的架构决策边界。

### Modified Capabilities

（无。主 `openspec/specs/` 当前没有既有 capability；本 change 不修改冻结的 FE-03 acceptance 或任何已有 read-PF requirement。）

## Impact

- 本纠偏 PR 仅修改本 change 的四个 planning artifacts：`proposal.md`、`design.md`、`specs/fe03-edit-performance-protocol/spec.md` 和 `tasks.md`；不实施 FE-03，不运行 PF 或 `verify:ticket`，也不修改产品代码、测试、descriptor、collector、budget、registry、verifier、ticket、tracker、既有 change 或历史 evidence。
- 后续经重新验收／冻结而获准的 implementation 受影响面包括 FE-03 contract/domain/Rust-first wire、既有 read/session seam 内的 mock/session consumer 与 UI、L0/L1/L2 functional tests、独立 edit-PF descriptor/fixture/collector/attestation artifacts，以及 additive FE-03 verification route；既有 FE-02 read-PF 输入、输出、fail-closed 行为与历史 lineage 必须保持不变。
- FE-02 stable evidence 只能解除 FE-03 blocker，不提供 FE-03 closure credit；任何新证据仍须保留其自身层级、运行 identity、未覆盖边界和 provenance。
- 不新增依赖；若 grant 不能在既有 read/session seam 内闭合，必须先重开 ARCH-GATE 并取得用户决定，而非扩大本 change 或自行引入 command/trust boundary。
