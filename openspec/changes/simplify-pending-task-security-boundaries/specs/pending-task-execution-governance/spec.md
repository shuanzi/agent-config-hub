## Purpose

定义未完成任务在受信任验证 runner 下的最小安全和证据治理边界，并记录本 change 已被
`simplify-mvp-functional-done-gates` 吸收的执行语义。功能交付不能被重复或超出威胁
模型的 hardening 阻塞；真实产品安全与历史 provenance 不因此降低。

## ADDED Requirements

### Requirement: 受信任验证 runner 的边界

验证基础设施 SHALL 将本地或 CI runner 视为受信任执行环境。它 MAY 保留 exact
relative-path allowlist、controlled evidence root、可检测 symlink 拒绝、leaf
`O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验和异常 fail-closed，以防止可检测的误用。
它 MUST NOT 声称防御同一用户权限下恶意并发进程主动交换目录，或已被攻陷的开发机、
CI worker、工具链或仓库。

该边界 MUST NOT 自动要求 native `openat` helper、跨平台 secure filesystem、复杂 binary
provenance、多层 digest 或新的 verifier/state machine；若未来确有需要，MUST 先获得独立
threat-model 和用户授权。

#### Scenario: 仅以同权限对抗要求 hardening

- **WHEN** 后续工作只以同权限恶意目录交换或已攻陷 runner/toolchain 为理由提出复杂控制
- **THEN** 该工作 MUST 被记录为 residual risk 或独立 hardening，而不是 MVP done、功能
  blocker 或 release 的默认前置

### Requirement: 真实产品安全边界保持不变

本治理 capability MUST NOT 弱化外部项目根的 path traversal 或 symlink escape、敏感明文、
authorization grant、revision/stale、apply/write、transaction、recovery point、权限和跨资产
隔离、不受信任 config/Adapter/extension/executable，以及真实业务数据或磁盘写入的
fail-closed。

#### Scenario: 产品写入路径的安全负例

- **WHEN** 一个功能会读取外部项目输入、处理授权或执行真实业务数据写入
- **THEN** 其 MVP acceptance MUST 保留对应产品安全负例和必要 isolated L3，不能以
  trusted-runner 假设或后置 release 工作替代

### Requirement: MVP done 直接解除功能 blocker

未完成 ticket 的 `done` 与功能 direct blocker SHALL 由最小 contract/implementation、
L0/L1、必要 L2、ticket 自身真实产品安全负例、只在真实边界所需的 isolated L3，及独立
功能复审共同决定。满足后 ticket MUST 直接成为 `done` 并解除下游功能 blocker；治理
MUST NOT 新增 `functional-done` 或以 `functional complete` 维持并行状态。

PF、performance/stress/platform hardening、复杂 trusted-runner provenance/hash/digest、逐票
`verify:ticket` 和 formal closure MUST 后置到统一 release/optimization。未执行项 MUST 记作
`deferred`，不得冒充通过或 release-ready，也不得阻塞 MVP done 或功能 DAG。release ready
仍 MUST 实际满足适用的统一 release gate。

#### Scenario: MVP 功能验收完成而 release hardening 尚未执行

- **WHEN** ticket 已具自身 commit、实际 L0/L1/必要 L2/L3 命令与结果、未覆盖边界和独立功能复审
- **THEN** ticket MUST 成为 `done` 并解除下游功能 blocker；后置 hardening MUST 保留为
  deferred release/optimization 输入，不能表述为 pass、formal closure 或 release-ready

### Requirement: 证据与 provenance 不可互借

每个 ticket 的 MVP record MUST 至少保留可审计 commit、实际测试命令/结果、未覆盖边界和
独立功能复审。一个 ticket 的 evidence MUST NOT 作为另一个 ticket 的 MVP 或 release
credit；后置验证也 MUST NOT 删除、覆盖或重新解释历史 evidence。tracked source identity
在 Git commit/tree 足够时 MUST NOT 叠加 digest 图；仅当缺少 binding 会改变下一步时才保留
一个 canonical binding。

#### Scenario: 下游复用公共基础设施

- **WHEN** 下游 ticket 复用上游 bootstrap、runner 或 harness
- **THEN** 下游仍 MUST 记录自身 acceptance 和 MVP evidence，只能把上游结果当作依赖输入，
  不得借用其 credit

### Requirement: 已吸收 change 的归档语义

本 change 的剩余公共 preflight/registry/manifest/verifier、FE-03 edit-PF/budget/formal、
逐票 formal closure 与 release reconciliation 计划 MUST 被标为已吸收或 superseded：实际
工作只可在未来统一 release/optimization change 中、按当时最小需求与独立授权进行。本
change 的归档 MUST NOT 产生产品实现、PF、budget、verifier、ticket status、release 或
historical-evidence credit。

#### Scenario: 归档已吸收的治理 change

- **WHEN** 本 change 的任务已记录各项 absorb/supersede/deferred disposition
- **THEN** 它 MAY 归档为规划已完成；该归档 MUST NOT 被解释为任一 deferred hardening 已执行
