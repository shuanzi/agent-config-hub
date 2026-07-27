# ADR-0016：采用 XChaCha20-Poly1305 与单一 Keychain 密钥

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

产品基线要求所有完整恢复快照加密，密钥由操作系统安全存储管理；必要快照无法创建或验证时必须阻断写入。`ARC-04` 已将快照放在应用私有目录，`ARC-04a` 已确定 SQLite manifest。现在需要冻结 authenticated-encryption、容器和 Keychain seam，同时不引入 MVP 外的密钥管理、轮换或同步能力。

## 决策

- 初始依赖固定为 `chacha20poly1305 0.11.0` 的 `XChaCha20Poly1305` 与 zeroize 支持，以及 `security-framework 3.7.0`；精确依赖闭包由提交的 `Cargo.lock` 固定；
- 使用一个 256-bit 应用快照密钥和每个快照独立生成的 192-bit nonce；
- 密钥存入 macOS Data Protection Keychain 的 generic-password item，`synchronizable = false`，使用默认 `WhenUnlocked` 可访问性；
- 外层 `snapshot-container/v1` 使用固定 canonical binary header、XChaCha20-Poly1305 ciphertext 和 16-byte postfix tag；
- AAD 绑定固定 domain、完整 header 与 recovery point identity；
- 不使用 AES-GCM、CryptoKit/Swift bridge、SQLCipher、Secure Enclave、用户认证提示、per-snapshot envelope key 或密钥轮换；
- 加密和解密 one-shot 在受策略约束的内存中完成，磁盘上只出现密文临时文件和最终密文容器。

## Module 与 seam

`FileTransaction` 只调用深 `SnapshotVault` module：

```text
seal(recoveryPointId, capturePlan) -> sealed container
open(expectedRecoveryBinding, sealed container) -> restorable snapshot
```

`SnapshotVault` 隐藏 payload wire、算法、nonce、container parser、AAD、密钥生命周期和错误归一化。payload framing 后续由 `ARC-04c` / ADR-0017 固定为内部 implementation，不新增对外 codec seam。`SnapshotKeyStore` 是其内部平台 seam：

- `MacOsSnapshotKeyStore` adapter 使用 Security.framework；
- `SyntheticSnapshotKeyStore` adapter 提供固定非秘密向量和失败注入；
- `FileTransaction`、`OperationEngine`、`GatewayCore` 与前端均不接触 Keychain query、密钥或 crypto crate 类型。

`SnapshotKeyStore` 有生产与合成两个真实 adapter，因此 seam 有实际变化点；nonce source 只作为 `SnapshotVault` implementation 的内部测试 seam，不进入外部 interface。

每次 `seal` 都必须向 OS CSPRNG 请求新的 nonce；调用方不能提供或覆盖 nonce。MVP 不增加 nonce counter、nonce registry 或可配置 nonce 策略，测试只验证每次调用都会请求新值以及随机源失败时封闭失败。

## Canonical container v1

按顺序编码：

1. 8-byte magic：`ACMSNAP\0`；
2. big-endian `u16` container version：`1`；
3. big-endian `u16` algorithm：`1`，唯一表示 XChaCha20-Poly1305；
4. 24-byte random nonce；
5. big-endian `u64` ciphertext length，包含 16-byte tag；
6. ciphertext 与 postfix authentication tag。

AAD 使用无歧义长度编码的：

```text
(
  "agent-config-manager/snapshot/v1",
  completeEnvelopeHeader,
  expectedRecoveryPointIdentity
)
```

解析器在分配或返回明文前验证 version、algorithm、长度上限、精确文件长度和 tag；拒绝未知值、截断、追加和任何 header/AAD/ciphertext/tag 篡改。header 不保存路径、正文、密钥或其他敏感值。

## Keychain 生命周期

- service 为 `<bundle-id>.snapshot-key`，account 为 `v1`；test build 使用独立 bundle identifier；
- 每次 add/get 都显式使用 Data Protection Keychain 和 non-synchronizing store；
- 仅当 recovery manifest 与快照目录均为空时，首次快照可自动生成 32-byte key；
- 创建使用 add-only；duplicate item 必须重新读取，不得 update key bytes；
- 已存在 manifest/blob 时 key 缺失、Keychain 不可用或 key 长度错误都映射为 `SECURE_STORAGE_UNAVAILABLE`；
- 不自动替换、导入、导出、轮换或同步密钥，也不删除无法解密的旧恢复点；
- 密钥不长期缓存，使用后清理，不进入数据库、文件、日志、事件、诊断或 fixture。

## 写入与恢复不变量

- 快照明文只存在于受控内存，不写入临时明文文件；
- 无法在当前内存和 snapshot policy 下完成 one-shot encryption 时，在原生写入前返回 `SNAPSHOT_FAILED`；
- 密文临时文件持久化并原子改名后必须重新打开，通过 authentication 和明文一致性检查，才可提交 recovery manifest 与 `snapshotReady`；
- recovery 必须先完整 authentication，再进入差异、确认和原生文件事务；
- 任何 crypto/container failure 都不能返回部分明文、部分恢复或降级为未加密快照。

## 验证

L1 至少覆盖：

1. 已知非秘密向量、round-trip 与空 payload；
2. header、recovery identity、nonce、ciphertext、tag 的逐项篡改；
3. 截断、追加、未知 version/algorithm、超出策略长度；
4. 每次 `seal` 请求新 nonce，以及 nonce source 失败时封闭失败；
5. Keychain missing、unavailable、duplicate、invalid-length；
6. existing snapshot + missing key 不生成替代密钥；
7. 密钥与明文 buffer 清理；
8. 密文持久化后验证失败时不提交 manifest、不进入原生写入。

L3 Security.framework tracer 只能在隔离 runner 用户和独立 test bundle identifier 下操作合成 item，运行后删除；生产 service/account 是负向禁止目标。L2 mock 旅程不能取得 Keychain、crypto 或磁盘证据。

## 结果

正向影响：

- 192-bit random nonce 使单密钥下随机 nonce 的碰撞风险远低于较短 nonce 方案；
- 一个 Keychain item 和一个容器版本保持最小运维与恢复状态；
- 纯 Rust AEAD 避免增加 Swift bridge，容器格式不依赖 CPU-specific metadata；MVP runtime 支持仍以 `ARC-05e` 的 arm64-only 边界为准；
- AAD 把密文 blob 与 recovery manifest identity 绑定，阻断 blob 互换。

代价：

- one-shot AEAD 会占用与 payload 规模相关的内存，必须由 snapshot policy 封闭限制；
- 单一密钥丢失会使全部加密恢复点不可用，应用必须封闭失败；
- 没有 per-snapshot key 或轮换能力；未来如需轮换必须新增容器/key version 迁移设计；
- XChaCha20-Poly1305 不满足必须使用 NIST AES 算法的外部合规要求。

## 替代方案

### AES-256-GCM + 单一 Keychain 密钥

标准化和硬件加速更强，但需要更严格地保证同一密钥下 96-bit nonce 永不重复；当前本地快照没有合规或性能证据要求 AES。

### 每个快照独立 data key

便于轮换和单快照密钥销毁，但会增加 key wrapping、container metadata、journal、恢复和迁移状态，当前产品没有依据。

## 重新评估触发条件

只有固定 fixture 证明 one-shot 内存或 XChaCha throughput 无法满足已冻结预算，才评估 streaming container 或其他 AEAD。只有出现明确合规要求才评估 AES-GCM；只有产品确认密钥轮换、选择性销毁或跨设备恢复能力时，才评估 envelope key。

## 参考

- [RustCrypto XChaCha20-Poly1305 0.11.0](https://docs.rs/crate/chacha20poly1305/0.11.0)
- [RustCrypto AEAD nonce guidance](https://docs.rs/aead/latest/src/aead/lib.rs.html)
- [security-framework 3.7.0 PasswordOptions](https://docs.rs/security-framework/3.7.0/security_framework/passwords/struct.PasswordOptions.html)
- [Apple Data Protection Keychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)
- [Apple Keychain accessibility](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)
- [ADR-0017：版本化 postcard 快照 payload](0017-versioned-postcard-snapshot-payload.md)
