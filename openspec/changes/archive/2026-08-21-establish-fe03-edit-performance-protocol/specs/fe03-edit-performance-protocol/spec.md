## Purpose

记录 FE-03 edit-PF protocol 的治理 disposition：它不再是 FE-03 MVP `done` 的前置，
而是一个独立的、统一 release/optimization 阶段的待定工作。该 disposition 不删除历史
evidence，不弱化敏感 grant 或真实写入边界，也不把 deferred hardening 表述为通过。

## ADDED Requirements

### Requirement: FE-03 MVP 与 edit-PF 的执行顺序

系统 MUST 以 FE-03 的最小 contract/implementation、L0/L1、必要 L2、冻结的 FX-04
行为与真实 grant/敏感明文负例、以及独立功能复审决定 FE-03 MVP `done`。FE-03 MUST
NOT 取得 L3、actual Tauri IPC、真实授权、磁盘写入或真实 write credit；grant 消费和
首条真实 write transaction MUST 由 FE-04 的 isolated L3 覆盖。

edit-PF、预算、formal comparison、逐票 `verify:ticket`、performance/stress/platform
hardening 与 release-level formal reconciliation MUST 在 MVP `done` 之后、只作为统一
release/optimization 工作处理。它们 MUST NOT 阻塞 FE-03 `done`、FE-04 的功能 DAG 或
成为新增 registry/verifier/state-machine 的默认理由。未执行的工作 MUST 标为
`deferred`，不得表述为 pass、formal closure 或 release-ready。

#### Scenario: FE-03 的功能 gate 通过而 edit-PF 未运行

- **WHEN** FE-03 已具自身可审计 commit、实际 L0/L1/L2 命令与结果、未覆盖边界和
  独立功能复审，但 edit-PF/formal work 尚未运行
- **THEN** FE-03 MUST 成为 `done` 并解除 FE-04 的功能 blocker；edit-PF MUST 保持
  `deferred`，且不得提供 release credit

### Requirement: trusted-runner 的最小防误用边界

未来统一 release/optimization 若实际需要收集受控 evidence，MUST 将 local/CI runner
视为受信任环境，并可保留 exact relative-path allowlist、controlled evidence root、可检测
symlink 拒绝、leaf `O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验和异常 fail-closed。
这些控制 MUST NOT 被表述为抵抗同权限恶意并发目录交换的原子保证。

该边界 MUST NOT 默认要求 native evidence-only `openat` helper、跨平台 secure
filesystem、复杂 binary provenance、per-module bytes digest、actual L2 module graph 或
physical-ancestry attestation。任何提出这些措施的工作 MUST 先有独立威胁模型和用户授权，
不得作为 MVP done、功能 blocker 或 release 的默认门槛。

#### Scenario: 因同权限对抗要求复杂证明

- **WHEN** 某项计划只以同权限恶意进程、已攻陷 runner/toolchain 或理论目录交换为理由
  要求 native helper 或多层 digest 图
- **THEN** 系统 MUST 将其记录为 residual risk 或单独 hardening 提案，不得扩大 FE-03
  MVP acceptance 或伪称获得原子安全保证

### Requirement: 产品安全与证据隔离保持

FE-03 的 Rust-first opaque `modify` grant MUST 绑定 asset、file、具体
`SensitiveSegmentRef`、authoritative revision、scope、surface 和 TTL。grant 与敏感明文
只允许存在于不可序列化、frontend-local ephemeral buffer；过期或 asset/file/segment/
scope/surface/revision 切换时 MUST 清零并重新遮蔽，且不得进入 shared/persisted draft、
snapshot、event、search、diagnostic、log、cache、fixture、vector/golden、PF 或 evidence。
mock MUST NOT 签发 grant 或取得 actual authorization/write credit。

FE-02 read evidence 只能作为 FE-03 的历史上游 blocker 记录，MUST NOT 成为 FE-03 MVP
或 release credit。现存 read/edit evidence、failure、baseline、budget、waiver 与 raw
artifact MUST 保持原样且不得互借、删除、改名或重新解释。tracked source identity 在 Git
commit/tree 足够时 MUST NOT 叠加 digest 图；只有缺少该 binding 会改变下一步时才保留一个
canonical binding。

#### Scenario: release optimization 收集 edit 样本

- **WHEN** 后续获授权的统一 release/optimization 工作收集 FE-03 edit 样本
- **THEN** 它 MUST 使用独立 ticket identity、受控非敏感输入和清晰未覆盖边界，不得复用
  FE-02 read evidence 或将样本表述为真实授权、实际 IPC、写入或 production artifact credit
