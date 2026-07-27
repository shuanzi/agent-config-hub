# ADR-0017：采用版本化 postcard 快照 payload

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

产品基线把带附属脚本的 Skill 等多文件原生单元视为一个资产和一个原子事务，并要求每次原生写入前基于最新磁盘状态创建完整、加密、可验证的恢复快照。`ARC-04b` / ADR-0016 已固定外层 authenticated container、Keychain 密钥和 one-shot 内存模型，但尚未定义单文件与多文件内容在加密前如何 framing。

该 framing 只服务应用私有恢复，不是导出格式或通用 archive。它必须保留原始 bytes 和必要文件权限，同时不能让路径、符号链接或 archive extractor 成为第二条写入授权路径。

## 决策

- 单文件和多文件共用版本化 `SnapshotPayloadV1`；
- 一个 recovery point 对应一个加密 blob，不创建逐文件密文或子 manifest；
- payload body 使用 `postcard 1.1.3`，关闭 default features 且只启用 `alloc`；
- plaintext 以固定 magic 和独立 payload version 开头，再接不可变 V1 schema；
- 写入前状态为 `Absent` 或 `Present`；后者的 entries 使用 filename component 数组、封闭文件 kind、必要 POSIX permission bits 与原始 bytes；
- 不使用 TAR、ZIP、逐文件容器、压缩、COBS 或额外 CRC；
- 路径授权、规范化、文件身份、权限和符号链接策略仍由 native file adapter 在 capture 与 restore 两端验证。

## Module 与 interface

payload codec 归入深 `SnapshotVault` module 的 implementation，不建立新的 `SnapshotPayloadCodec` seam：

```text
seal(recoveryPointId, SnapshotCapturePlan) -> sealed container
open(ExpectedRecoveryBinding, sealed container) -> RestorableSnapshot
```

- `FileTransaction` 从最新磁盘事实和 native file adapter 取得 `SnapshotCapturePlan`；
- `SnapshotVault` 负责 payload framing、canonical validation、outer AEAD 与 Keychain 错误归一化；
- `FileTransaction` 只取得已认证、已校验的 `RestorableSnapshot`；
- UI、索引、prepared operation、manifest path 和 payload parser 都不能创建写入授权。

删除 `SnapshotVault` 后，payload versioning、canonical parsing、binding、crypto 与 key lifecycle 会重新分散到 `FileTransaction`；因此该 module 保持足够深度。codec 只有一个 implementation，也没有独立变化点，不为测试制造假 seam；测试通过 `SnapshotVault` interface 驱动固定 capture plan。

## Plaintext framing

按顺序编码：

1. 8-byte payload magic：`ACMPAYL\0`；
2. big-endian `u16` payload version：`1`；
3. `postcard` 编码的 `SnapshotPayloadV1` body，直到 plaintext 结尾。

payload version 与 `snapshot-container/v1` 独立：加密算法或 envelope 演进不要求改变内容 schema，内容 schema 演进也不要求改变 Keychain item。

`SnapshotPayloadV1` 固定包含：

1. opaque recovery asset identity；
2. opaque native write unit identity；
3. 写入前状态：
   - `Absent` 不携带 entries，表示 apply 重读时原生目标不存在；
   - `Present` 携带 native revision 与 canonical `SnapshotEntryV1` sequence。

每个 `SnapshotEntryV1` 固定包含：

1. 从原生资产 root 起算的原始 filename component 数组；
2. 封闭 kind：`RegularFile`、`Directory`、`SymbolicLink`；
3. adapter 规范化后的必要 POSIX permission bits；
4. regular-file bytes 或 symbolic-link target bytes；directory 不携带正文。

`Absent` 必须没有 entry。`Present` 的根 entry 使用空 component 数组且恰好出现一次；其他 component 必须非空，不得为 `.` / `..`，不得含 NUL 或路径分隔符。entry 按 component raw bytes 字典序排列，父路径先于后代；`SnapshotVault` 拒绝状态与 entries 不一致、完全重复路径、缺失或非目录父 entry、未知 kind、未支持文件类型和超出策略的 count/length。native file adapter 另行拒绝 macOS 规范化、大小写或文件身份造成的别名。

payload 内的相对路径是加密恢复描述，不是 `AssetRef`、`NativeFileRef` 或写入授权。native file adapter 必须在 capture 和 restore 时重新验证 canonical file identity、授权 root、实际目标占用、权限和符号链接策略；`SnapshotVault` 不解析或跟随 symlink。

## Canonical 与版本不变量

Postcard 的 wire format 自 1.0 起稳定，但不是 self-describing schema，也不强制 canonical varint。因此 V1 额外固定：

- schema 类型、字段顺序、整数宽度、enum variant 顺序和语义一经发布不得原位修改；
- 不使用 map、set、platform-sized identity 或其他无稳定顺序的字段；
- outer container authentication 和 plaintext policy 上限通过后，才执行有界 decode；
- decoder 使用能返回 remainder 的路径，并要求 remainder 为空；
- 完成全部结构与长度校验后，使用冻结 V1 类型重新编码，并要求与输入 body 逐 byte 相同；
- 提交的 golden bytes 由静态验证与 L1 共同守护字段、整数和 variant 漂移；
- 未知 payload version、非 canonical body、binding 不匹配或任一 invariant 失败均返回既有 `SNAPSHOT_FAILED`，不得猜测或部分恢复；
- 新 schema 使用新 payload version；只要某版本的恢复点仍可能按保留策略存在，应用就必须保留对应 reader。

recovery asset identity、native write unit identity、写入前 `Absent` / `Present(revision)` 与 recovery point identity 共同形成恢复绑定：recovery point identity 由外层 AAD 认证，其余绑定位于 authenticated payload 内；`open` 必须与 manifest 的 expected binding 核对后才能返回恢复模型。

## 内容与元数据边界

- regular file、宿主配置文件、未知字段、注释、格式、文本和非文本内容都以原始 bytes 保存；
- directory entry 保留空目录和必要 permission bits；
- symbolic-link entry 只保存 link 本身的 target bytes，不读取目标内容；是否允许 capture 或 restore 由 native file adapter 判定；
- V1 不编码 owner、timestamp、ACL 或 extended attributes；native file adapter 只有在能够证明写入与恢复不会静默破坏所需元数据时才可形成 capture plan，否则必须在原生写入前阻断，并以真实 Agent fixture 提交最小技术 Change Request；
- 不压缩 payload，避免额外解压上限、压缩炸弹和第二套 streaming/temporary-file 状态；
- 外层 AEAD 已提供完整性，不附加 postcard CRC。

## 写入与恢复不变量

1. `apply` 重读并验证最新磁盘事实；
2. native file adapter 形成单一授权 `SnapshotCapturePlan`；
3. `SnapshotVault` canonical encode、seal、持久化后 reopen；
4. `open` 完成 outer authentication、payload decode、canonical re-encode 和 binding 校验；
5. 返回模型与 capture plan 一致后才提交 recovery manifest 与 `snapshotReady`；
6. 原生写入开始前仍须通过既有 revision 和 transaction checks；
7. restore 先完整 open，再由 native file adapter 对当前目标重做安全检查；不能把 codec 输出直接“解包”到磁盘。

任一步失败都在原生写入前以既有稳定原因结束；不得产生明文临时文件、部分快照、部分恢复或未加密降级。

## 验证

L1 golden vectors 至少覆盖：

1. `Absent`、单文件、完整宿主文件、多文件目录、空目录、二进制内容和 executable mode；
2. 允许与阻断的 symbolic-link capture plan；
3. prefix/version、trailing bytes、非 canonical varint，以及提交的 golden bytes 漂移；
4. 状态与 entries 不一致、root 缺失/重复、entry 乱序/重复/缺父目录、非法 component、未知 kind；
5. asset/revision/recovery binding 不匹配；
6. entry count、component count、单项及 aggregate bytes 超限，并验证失败先于大额分配或文件 I/O；
7. encode → seal → open round-trip 与 reopen 后 capture-plan equality。

L3 只在每次新建的临时授权 root 中验证多文件 capture → seal → open → restore、absent-target recovery、权限保留、symlink escape 阻断和恢复目标占用。L1/mock 不能取得真实 macOS 路径、权限、Keychain 或文件事务证据。

## 结果

正向影响：

- typed schema 避免通用 archive extraction、link/device entry 和跨平台元数据语义；
- 一个恢复点一个 blob 与现有 journal、manifest 和 one-shot AEAD 保持一致；
- 原始 bytes、空目录、必要 mode 和受控 symlink 描述覆盖已冻结 payload surface；未覆盖的必要元数据封闭失败；
- 独立 payload version 允许内容 schema 与加密 envelope 分别演进。

代价：

- 项目必须长期维护已发布 schema reader 和 golden vectors；
- payload 不能由标准 archive 工具直接检查；但 blob 本身已加密且没有人工解包产品需求；
- one-shot 内存仍随 aggregate bytes 增长，需要后续 fixture 校准 snapshot policy；
- 若未来必须保存 ACL/xattr 或超大资产 streaming，需要新版本与迁移设计。

## 替代方案

### 确定性、无压缩 TAR

文件 archive 生态成熟，但仍需自建严格 entry whitelist、路径/link/device 防护和安全 extraction。外层加密使标准工具不能直接检查内容，因此互操作收益不足以抵消通用 archive surface。

### 每个文件独立加密并配套 manifest

可以降低单次内存并支持局部读取，但会增加 nonce、blob、journal、原子提交、清理和恢复状态；当前 fixture 尚未证明这种复杂度必要。

## 重新评估触发条件

只有真实固定 fixture 证明 aggregate payload 无法在已冻结 snapshot policy 内完成 one-shot 处理，才评估 chunked/streaming 新版本。只有产品确认标准工具互操作，才评估 archive framing；只有 native Agent 恢复明确需要 owner、ACL、xattr 或其他元数据，才扩展新 payload version。

## 参考

- [postcard 1.1.3](https://docs.rs/postcard/1.1.3/postcard/)
- [postcard `take_from_bytes`](https://docs.rs/postcard/1.1.3/postcard/fn.take_from_bytes.html)
- [Postcard Wire Format](https://postcard.jamesmunns.com/wire-format.html)
- [ADR-0016：XChaCha20-Poly1305 与 Keychain](0016-xchacha-keychain-snapshot-vault.md)
