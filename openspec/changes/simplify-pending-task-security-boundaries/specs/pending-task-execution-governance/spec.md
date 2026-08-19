## Purpose

定义未完成任务在受信任验证 runner 下的最小安全和证据治理边界，使功能交付不被重复或超出威胁模型的 hardening 阻塞，同时保持真实产品安全与 provenance 的独立性。

## ADDED Requirements

### Requirement: 受信任验证 runner 的边界

验证基础设施 SHALL 将本地或 CI runner 视为受信任执行环境。它 MUST 防止可检测的误用，但 MUST NOT 声称防御同一用户权限下恶意并发进程主动交换目录，或已被攻陷的开发机、CI worker、工具链或仓库。该边界下的控制 MUST NOT 被表述为同权限对抗者的原子安全保证。

#### Scenario: 验证计划记录攻击者排除项

- **WHEN** 一个未完成任务依赖验证基础设施安全控制
- **THEN** 其计划记录受信任 runner 前提、明确排除的同权限对抗与已攻陷环境，并且不把这些排除项计为未满足的产品安全缺陷

### Requirement: 验证基础设施的最小防误用控制

受信任 runner 的验证基础设施 SHALL 保留与其输入和证据目录相关的最小防误用控制：exact relative-path allowlist、controlled evidence root、可检测 symlink 拒绝、leaf `O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验和异常 fail-closed。它 MUST NOT 因该治理 requirement 而要求 native `openat` helper、跨平台安全文件系统或复杂 binary provenance。

#### Scenario: 提议同权限对抗 hardening

- **WHEN** 后续工作仅以同权限恶意目录交换或类似 runner 内对抗为理由提出新的 native 文件系统 helper
- **THEN** 该工作被分类为理论 hardening 或单独立项，而不是功能完成、formal comparison 或 closure 的前置条件

### Requirement: 真实产品安全边界保持不变

本治理 capability MUST NOT 弱化真实产品对不受信任边界的安全 requirement。外部项目根目录的 path traversal 或 symlink escape、敏感明文、authorization grant、revision/stale、apply/write、transaction、recovery point、权限和跨资产隔离、不受信任 config/Adapter/extension/executable，以及真实业务数据或磁盘写入的 fail-closed 均 SHALL 继续作为产品安全风险处理。

#### Scenario: 产品写入路径的安全负例

- **WHEN** 一个功能会读取外部项目输入、处理授权或执行真实业务数据写入
- **THEN** 其 acceptance 保留相关的真实产品安全负例，且不得用 trusted-runner 假设替代该负例

### Requirement: 功能优先与报告语义分离

未完成任务的计划 SHALL 依序完成功能契约与最小实现、L0/L1、必要 L2 和真实产品安全负例，才能在人工报告中记录 `functional complete`。performance、stress、platform hardening 和低概率对抗验证 MUST 在功能完成后作为统一优化阶段独立排期。`functional complete` 与 `hardening pending` 是人工报告语义，不是当前 verifier 的新状态；它们 MUST NOT 要求新增 verifier 状态机、命令或自动 enforcement。在未经授权修改 formal source 前，这些报告语义 MUST NOT 自动映射为 checkbox、frontier、`formal closure` 或 `release ready`，且后置测试未执行时不得冒充通过。上游 ticket 经独立功能复验并人工记录 `functional complete` 后，在其他仍有效的 architecture/产品安全前提满足时，治理计划 SHALL 允许其下游 ticket 的产品功能开发由人工排期；该资格 MUST NOT 改变任何 formal ticket status、DAG、frontier、done、closure 或 release gate。下游的 formal verification/closure MUST 继续等待当前 formal direct blockers=done 且具 evidence。

#### Scenario: 功能测试完成但性能尚未执行

- **WHEN** 一个 ticket 已完成其最小功能 acceptance、L0/L1、必要 L2 和真实产品安全负例，但其性能工作尚未开始
- **THEN** 人工报告可记录 functional complete 与 hardening pending，但不得自动更新 checkbox、frontier、formal closure 或 release ready

#### Scenario: 上游功能完成后的下游产品功能排期

- **WHEN** 上游 ticket 已经独立功能复验并人工记录 functional complete，且下游的其他 architecture/产品安全前提仍满足
- **THEN** 人工编排可开始下游的产品功能开发，但不得将其报告为 ready、done 或 closure，也不得改变 formal DAG/frontier；其 formal verification/closure 仍等待当前 formal direct blockers=done 且具 evidence

#### Scenario: 本次受限 apply 不产生 FE-03 实施资格

- **WHEN** 本次 change 仅迁移治理/任务编排文档
- **THEN** 它 MUST NOT 记录 FE-03 functional complete、授予 FE-03→FE-04 implementation eligibility，或推进 FE-04/FE-10

### Requirement: Acceptance 与 verifier capability 的单向依赖

治理计划 SHALL 先由 formal product/ticket source 确认并冻结 ticket 的最小 acceptance，再只建立满足该 acceptance 所需的最小 verifier capability，最后执行该 ticket 的 formal closure。verifier capability MUST NOT 反向定义或扩大 acceptance，formal closure MUST NOT 成为建立 verifier capability 的前置。计划文本中相互前置的风险 MUST 被审计记录；该记录 MUST NOT 将其表述为已证实的 runtime cycle。

#### Scenario: 验证能力尚未建立

- **WHEN** 一个 ticket 的最小 acceptance 已由 formal source 冻结，但其所需 verifier capability 尚不存在
- **THEN** 计划只建立满足该 acceptance 的最小 capability，并在该能力和 ticket 自身 evidence 就绪后才考虑 formal closure，而不以 closure 反向阻塞 verifier 的建立

### Requirement: 证据与 provenance 不可互借

每个 ticket 的 L0、L1、L2、L3 和 PF 证据 SHALL 保留自身 ticket identity、层级、运行输入、历史 provenance 和未覆盖边界。一个 ticket 的 evidence MUST NOT 作为另一个 ticket 的 closure credit；后置验证也 MUST NOT 改写或删除历史 evidence。验证计划 MUST 区分证明产品行为的测试与仅证明 harness 的测试。

#### Scenario: 上游基础设施已验证

- **WHEN** 下游 ticket 复用已验证的公共 runner 或 harness
- **THEN** 下游 ticket 仍保留其自身产品 acceptance 和所需证据，并且只把上游结果记录为依赖输入而非 closure credit

### Requirement: 审计记录与 formal 冲突的保留

针对 active changes 的每个 unchecked task，治理记录 SHALL 包含当前 formal 状态、direct blocker、最小 acceptance、证据负担、威胁模型、风险分类、disposition、分层验证、verifier/registry/schema 影响、DAG/frontier/release/provenance 影响和 residual risk。formal sources 之间的状态冲突 MUST 被如实记录，且不得由本治理记录单方面裁决。

#### Scenario: ticket 状态与验证状态不一致

- **WHEN** tracker 将 ticket 标为 ready，而对应验证或 release 资料仍为 planned、unverified 或不存在
- **THEN** 审计记录同时保留两个来源及其层级差异，并把任何状态变更列为后续显式决策或实现工作
