## Why

冻结的 FE-03 acceptance 要求 PF-02/PF-03 证明 edit 输入、草稿投影和文件切换，但现有 PF 仅覆盖 read-only／零草稿路径；复用 FE-02 的 read descriptor、budget、waiver 或证据会破坏 provenance。与此同时，敏感段 `modify` grant 已有安全语义，却尚未确定其权威签发与验证边界，不能让前端自签能力冒充授权。

## What Changes

- 新建 additive、versioned 且 identity-separated 的 FE-03 edit-PF protocol：edit 专用 descriptor ID/path、fixture digest、collector/config、measurement-input graph、raw sample/evidence directory、budget lineage 与 manifest provenance 必须彼此绑定，并与既有 read PF 的 identity 完全分离。协议将要求防止 read/edit 交叉借证的负向验证；不得复用、改名、修改或重解释 FE-02 的 read evidence、budget、waiver、raw artifacts、collector 或 verifier 行为。
- 将 FE-03 的实施顺序固定为功能优先：先完成 tasks 3.19–3.22 的 RED→GREEN 和 task-only functional checks；之后才可实施或执行 edit-PF。功能完成后先采集独立的 no-budget baseline，其状态只能为 `baseline-collected`／`budget-not-frozen`／`non-closure`；不得继承 FE-02 budget、重跑挑选通过结果，或在用户显式 freeze approval 前写预算、比较、closure、勾选 FE-03 或推进 frontier。
- 仅为未来获准的 implementation 规划 edit-specific descriptor/fixture generator、WDIO collector/config、runner/evaluator/measurement attestation 及 additive `verify:ticket` route。该 route 必须保持 legacy FE-02 read 路径 fail-closed、字节和语义不变，并把 L0/L1/L2/PF evidence 分层；无 L3、无 actual Tauri IPC、磁盘写入或真实 write credit，mock grant/edit 也不得冒充真实授权或写入。
- 澄清敏感 `modify` grant 的架构选择：设计必须精确比较 frontend-local ephemeral capability 与 Rust-first opaque authoritative DTO。后者是优先候选，且只可在既有 `FrontendGateway` read/session seam 中消费；必须定义 authority、revision/TTL/asset/scope binding、失效与重新遮蔽、签发/验证责任，以及日志、缓存和 fixture 禁止。frontend-local 自签 token 不得作为安全授权。若任何可行方案需要新 command、trust boundary 或 serialization source of truth，必须将 ARCH-GATE 标为 reopen-required，停止并回主任务请求用户架构决策。
- 本 change 的 artifacts 经独立审查、用户验收/冻结并合并后，才允许恢复原 FE-03；protocol freeze、功能阶段、no-budget baseline、用户 budget freeze、formal closure 与独立 review 必须保持为独立 gate。

## Capabilities

### New Capabilities

- `fe03-edit-performance-protocol`: 定义 FE-03 edit 草稿性能证据的独立身份、provenance 与预算生命周期，以及敏感 `modify` grant 的受 ARCH-GATE 约束的架构决策边界。

### Modified Capabilities

（无。主 `openspec/specs/` 当前没有既有 capability；本 change 不修改冻结的 FE-03 acceptance 或任何已有 read-PF requirement。）

## Impact

- 本轮仅创建本 change 的 planning artifacts；不实施 FE-03，不运行 PF 或 `verify:ticket`，也不修改产品代码、测试、descriptor、collector、budget、registry、verifier、ticket、tracker、既有 change 或历史 evidence。
- 后续获准实施的受影响面仅限新的 edit-PF protocol artifacts 和 additive FE-03 closure route；既有 FE-02 read-PF 输入、输出、fail-closed 行为与历史 lineage 必须保持不变。
- FE-02 stable evidence 只能解除 FE-03 blocker，不提供 FE-03 closure credit；任何新证据仍须保留其自身层级、运行 identity、未覆盖边界和 provenance。
- 不新增依赖；若 grant 不能在既有 read/session seam 内闭合，必须先重开 ARCH-GATE 并取得用户决定，而非扩大本 change 或自行引入 command/trust boundary。
