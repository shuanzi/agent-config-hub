## Context

本 change 最初为 FE-03 设计逐票 edit-PF、预算和 formal closure 路径。该路径与受信任
local/CI runner 的真实威胁模型不成比例，也把性能与复杂 provenance 反向变成了功能
交付前置。

2026-08-21 的 `simplify-mvp-functional-done-gates` 治理生效后，FE-03 的 MVP gate 已由
最小实现、L0/L1、必要 mock L2、真实 grant/敏感明文负例和独立功能复审决定。FE-03
没有 L3；grant 消费和首条真实 write transaction 仍由 FE-04 的 isolated
WebView→IPC→Core→disk L3 负责。本文件不改写 FE-03 的历史 evidence，也不把未执行
edit-PF、formal comparison 或 `verify:ticket` 称为通过。

## Active decisions

### 1. edit-PF 迁入统一 release/optimization

本 change 不再是 FE-03 MVP 的实现或 closure 路径。任何未来 edit-PF、预算、formal
comparison、逐票 `verify:ticket` 和 release 级性能/压力/平台 hardening 都只在统一
release/optimization 阶段按当时真实 release 需要再立项；它们不阻塞 FE-03 `done` 或
FE-04 的功能 DAG。

已存在的失败、inconclusive、baseline、预算、waiver、raw artifact 与 read lineage 均
保持原样，不能与 FE-03 互借，也不能被本 disposition 删除或重命名。没有执行的新
release hardening 只能写作 `deferred`，不能写作 pass、formal closure 或 release-ready。

### 2. trusted-runner 的最小边界

验证基础设施运行于受信任的 local/CI runner。若将来实际需要写入受控 evidence root，
可保留 exact relative-path allowlist、可控根目录、可检测 symlink 拒绝、leaf
`O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验和异常 fail-closed。它们只防误用，
不提供抵抗同权限恶意并发目录交换的原子保证。

因此本 change 不实现 native evidence-only `openat` helper、跨平台 secure filesystem、
复杂 binary provenance、per-module bytes digest、actual L2 module graph 或 physical
ancestry attestation。此类工作若日后被提出，须有独立威胁模型和用户授权，不能作为
功能完成、MVP done 或 release blocker 的默认前置。

### 3. 真实产品安全保持

此简化不弱化产品安全。FE-03 的 Rust-first opaque `modify` grant 仍必须绑定
asset/file/`SensitiveSegmentRef`、authoritative revision、scope、surface 和 TTL；grant
及明文只可在不可序列化、frontend-local ephemeral buffer 中短暂存在，失效即清零并
重新遮蔽，且不得进入 shared/persisted draft、snapshot、event、search、diagnostic、log、
cache、fixture、vector/golden、PF 或 evidence。mock 只模拟已存在/失效的权威 grant，
不签发授权，也不获得 IPC/write/L3 credit。

真正消费 grant、prepare/apply、revision/stale revalidation、single-use、unknown result
不自动重试、authoritative reread、recovery/collision、外部路径与磁盘 fail-closed 仍是
FE-04 及其后续真实写入 ticket 的 MVP product-security/L3 工作，不能由 trusted-runner
假设替代。

## Evidence and migration

FE-03 MVP record 只保留自身可审计 commit、实际功能测试命令/结果、未覆盖边界和独立
功能复审。FE-02 的 read evidence 仅是上游 direct-blocker 记录，绝不构成 FE-03 credit。
Git commit/tree 足以标识 tracked source 时不叠加 digest 图；只有该证明会改变下一步时才
记录一个 canonical binding。

本 change 的归档前提是：其剩余任务均被明确标注为“治理迁移完成、实际 release work
deferred”。归档不执行 descriptor、fixture、collector、runner、registry、verifier、budget、
PF、formal comparison 或历史 evidence 修改；未来 release/optimization 工作必须作为新的、
经授权的 change 进行。
