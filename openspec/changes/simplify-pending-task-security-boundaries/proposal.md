## Why

当前未完成工作把产品功能、验证基础设施的防误用、同权限对抗式文件系统 hardening、性能压力与 formal closure 混在单票的前置门槛中。这既重复证明同一事实，也让尚未建立的 runner 安全假设和历史证据链过早阻塞可交付功能；同时不能降低真实产品写入、授权和不受信任输入的安全要求。

本 change 只重新校准未完成任务的需求、威胁模型、验收和执行顺序，使功能完成、后置 hardening、formal closure 与 release ready 有可审计且不可互借的语义。

## What Changes

- 新增一项 pending-task execution governance capability，规定受信任 local/CI runner 下验证基础设施的安全边界、最小防误用控制、provenance 语义和后置优化规则。
- 对当前 active changes 的全部 unchecked tasks 建立只读审计矩阵，逐项给出最小功能 acceptance、证据负担、风险分类、简化 disposition 与 DAG/frontier 影响；formal source 冲突仅记录，不在本轮裁决。
- 将后续执行顺序调整为：功能契约与最小实现 → L0/L1 → 必要 L2 → 真实产品安全负例 → functional complete → 统一后置的 performance/stress/platform hardening → release 前综合 gate。
- 对 FE-03 推荐先收窄 formal runner 威胁模型，且不实现 evidence-only native `openat` helper；在用户确认本 proposal 前继续暂停 native helper、formal comparison、PF、`verify:ticket` 与 closure。现有 dirty WIP 只获得可执行的保留／最小化／放弃建议，不在本 change 裁决。
- 明确防误用可保留 exact relative-path allowlist、controlled evidence root、可检测 symlink 拒绝、leaf `O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验与异常 fail-closed；这些不宣称抵抗同权限恶意并发进程的原子安全保证。
- 明确不降低真实产品边界：外部项目根目录的 traversal/symlink escape、敏感明文与 authorization grant/revision/stale、apply/write/transaction/recovery/权限与跨资产隔离、不受信任 config/Adapter/extension/executable，以及真实业务数据与磁盘写入的 fail-closed。

## Capabilities

### New Capabilities

- `pending-task-execution-governance`: 未完成任务在受信任 runner 下的验证基础设施边界、功能优先次序、后置 hardening、不可互借 provenance 与状态语义。

### Modified Capabilities

（无。本 change 不改变任何已冻结的产品 acceptance、既有 release gate 或真实产品安全 requirement；这类变更必须取得用户显式决定后另行立项。）

## Impact

- 本轮仅写入此 OpenSpec change 的 planning artifacts 与 pending-task 审计矩阵；不修改产品、测试、verifier、registry、budget、collector、descriptor、fixture、历史 evidence、现有 change、ticket、tracker、README、SPEC 或 release gate。
- 后续经用户确认的 apply 可能影响 ticket acceptance、验证基础设施和执行编排；任何 verifier/registry/schema 变更均作为未来最小迁移任务，不在本 proposal 中实现，也不发明当前 verifier 不支持的新命令、状态机或自动 enforcement。
- 历史 evidence、完成项、frozen acceptance 与 formal source 保持原样。新的或后置的证据必须使用自身 ticket、层级、运行 identity 与 provenance，不能把另一个票据的证明当作 closure credit。
