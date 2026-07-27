# ADR-0018：适配器包采用 JCS manifest、确定性无压缩 USTAR 与 detached signature

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

`ARC-05a` 已固定应用更新与官方适配器包共用产品更新密钥，并要求 adapter signature 覆盖固定 domain、canonical manifest 与 archive digest；`ARC-05b` 已固定四个 Agent 使用单一 compatibility bundle；`ARC-05c` 已固定静态 HTTPS feed 和 manifest-last 发布。

剩余问题是把 canonical bytes、archive profile、detached signature framing 与安全 staging 固定到可生成、可验证且不会引入第二套运维的最小协议。

## 决策

### 三件套 artifact

每个 package version 发布：

```text
bundle.manifest.json
bundle.tar
bundle.sig
```

feed 只定位三件套；signed manifest 才声明 package 与 compatibility 事实。manifest 和 signature 不放入 TAR，避免 archive digest 循环。

### RFC 8785 JCS manifest

`bundle.manifest.json` 是 RFC 8785 JCS 的 exact UTF-8 bytes，并使用封闭 `AdapterManifestV1`。它声明：

- artifact type 与 format version；
- `package.packageId`、`package.packageVersion`；
- `compatibility.applicationVersionRange`、`engineVersionRange`、`requiredEngineCapabilities`；
- `agents[]` 中的 `agentId`、兼容范围和 adapter、native structure、Schema、能力矩阵、规则、模板版本；
- `archive.profile`、`archive.sizeBytes`、`archive.sha256`；
- `files[]` 中全部 regular files 的 `path`、closed `role`、`sizeBytes` 与 `sha256`。

`artifactType` 固定为 `agent-config-manager/official-adapter-bundle`，`formatVersion` 固定为字符串 `"1"`，archive profile 固定为 `acm-adapter-ustar-v1`。V1 禁止所有 JSON number token；数值使用除 `"0"` 外无前导零的受限 canonical 十进制字符串。identity、version/range、capability、path、role 与 hash 使用受限 ASCII，hash 固定 lowercase 64-hex。file role 只允许 `schema`、`capability-matrix`、`path-definition`、`template`、`conversion-rule` 或 `fixture`。四个 Agent 以 `claude-code`、`codex`、`gemini-cli`、`opencode` 的固定顺序各出现一次；capabilities 和 files 各自去重并使用固定 byte order。

strict parse 必须拒绝重复、未知和缺失字段；重新 JCS canonicalize 后必须与输入逐 byte 相等。manifest 不包含 timestamp、URL、release notes 或其他非候选事实。

### `acm-adapter-ustar-v1`

`bundle.tar` 是确定性、无压缩 USTAR：

- 只有 manifest 声明的 regular file entries，不含显式 directory entries；
- root 只允许 `agents/<fixed-agent-id>/`、`shared/` 与 `fixtures/`；
- path 是受限 lowercase ASCII POSIX relative path；每个 component 匹配 `[a-z0-9][a-z0-9._-]*`，完整 path 不超过 100 ASCII bytes，USTAR prefix field 为空；
- entries 与 manifest path 顺序一致；
- mode 为 `0644`，`uid=gid=mtime=0`，`uname/gname` 为空；
- raw 512-byte header 必须等于下述 V1 canonical header bytes，body alignment padding 全为零；
- 不允许 link、device、FIFO、sparse、PAX/GNU extension、xattr、ACL 或 executable metadata；
- 以正好两个 512-byte zero blocks 结束，无额外 entry 或 trailing bytes。

V1 header 先初始化为 512 个 `0x00`，再按下表写入；`\0` 表示单个 `0x00`：

| byte offset | length | field | canonical bytes |
|---:|---:|---|---|
| 0 | 100 | name | exact ASCII path，随后以 NUL 填满；100-byte path 不带 terminator |
| 100 | 8 | mode | ASCII `0000644\0` |
| 108 | 8 | uid | ASCII `0000000\0` |
| 116 | 8 | gid | ASCII `0000000\0` |
| 124 | 12 | size | actual file byte length的 11 位、左侧补零 lowercase ASCII octal + `\0`；范围 `0..=0o77777777777` |
| 136 | 12 | mtime | ASCII `00000000000\0` |
| 148 | 8 | checksum | 6 位、左侧补零 lowercase ASCII octal + `0x00 0x20` |
| 156 | 1 | typeflag | ASCII `0`（`0x30`） |
| 157 | 100 | linkname | 全 NUL |
| 257 | 6 | magic | ASCII `ustar` + `0x00` |
| 263 | 2 | version | ASCII `00` |
| 265 | 32 | uname | 全 NUL |
| 297 | 32 | gname | 全 NUL |
| 329 | 8 | devmajor | ASCII `0000000\0` |
| 337 | 8 | devminor | ASCII `0000000\0` |
| 345 | 155 | prefix | 全 NUL |
| 500 | 12 | pad | 全 NUL |

checksum 计算时先把 bytes `148..156` 全部视为 `0x20`，再对完整 512-byte header 的 unsigned byte values 求和；结果写成 6 位 octal 到 bytes `148..154`，随后写 `0x00 0x20`。V1 禁止 base-256 numeric encoding、NUL regular-file typeflag、其他 checksum terminator 和非零 unused bytes。验证器必须从 manifest path 与 size 独立重建 header 并逐 byte 比较；TAR library 能解析不等于 profile 合格。

发布构建器显式填 header，不继承宿主文件 metadata 或遍历顺序。相同输入双构建必须产生相同 manifest bytes、TAR bytes 与 TAR digest。

### Signature framing 与 Tauri toolchain

签名输入固定为：

```text
u32be(domain byte length)
|| UTF8("agent-config-manager/adapter-package/v1")
|| u64be(manifest byte length)
|| exact manifest bytes
|| u32be(32)
|| raw 32-byte SHA-256(bundle.tar)
```

manifest 内声明的 archive size/digest 必须与 actual TAR 相等。release job 使用与 Tauri updater 相同的产品私钥和 Tauri CLI `signer sign` 对短生命周期 signing-input file 签名，并把 detached output 发布为 `bundle.sig`。

runtime 使用同一内置公钥和 Tauri signer-compatible signature semantics，但 adapter signature 由独立 `AdapterBundleVerifier` 验证。它不复用 Tauri application artifact/container 或 updater installer verifier，也不引入第二密钥或自定义签名服务。

具体 Rust signature/JCS/TAR crate 不是跨模块 contract；锁定版本和 `Cargo.lock` 出现后，由真实 Tauri CLI integration vector 与 protocol golden vectors 约束。当前 upstream implementation 细节不能被表述为已验证的项目运行事实。

## 深模块与验证顺序

`AdapterBundleVerifier` 独占 signature framing、strict JCS、USTAR profile 和安全 staging：

```text
verifyAndStage(
  DownloadedAdapterArtifacts,
  FreshStagingRoot
) -> VerifiedBundleCandidate
```

`AdapterRegistry` 只看到 verified package facts、verification summary 与 opaque immutable content handle。内部 codec/parser 只有一个 implementation，不建立仅为 mock 存在的 public seam。

验证顺序：

1. 限制三个下载 artifact 的来源、响应和累计 bytes，并写入原子创建、`0700`、名称不透明且无预存 component 的 fresh staging；
2. streaming 计算 TAR digest，以 raw manifest bytes 重建 signing input；
3. 用内置产品公钥验证 detached signature；
4. strict parse/JCS byte equality，并验证 closed schema、artifact、digest/size、版本、兼容和 capability；
5. 逐 raw header 校验 type、metadata、path、顺序、size 和 membership；
6. 只把已验证 regular file bytes 通过 create-new/no-follow 路径写入 fresh `content/`，同步验证 file digest；
7. 拒绝 missing/extra/trailing content，再执行四 Agent conformance/regression；
8. 全部通过后返回 candidate；用户确认与 active/previous 原子切换仍由 `AdapterRegistry` 负责。

不得调用通用 TAR unpack API，也不得覆盖已有 staging path。promotion 后保存 manifest、signature 与 immutable `content/`；raw TAR 在 verification journal 终态和 fsync/rename 完成后可以删除。启动和使用前以 manifest 中已签名的 archive digest 重建 framing 并重新验签，再核对 manifest identity 与完整 file table。

built-in bundle 也由同一三件套与 verifier pipeline 生成；应用只嵌入验证后的 manifest、signature 和 immutable `content/`，runtime 与 active/previous 走同一复验路径。

内部 typed finding 只映射到既有前端契约：domain/manifest/canonical/signature/archive/integrity → `ADAPTER_SIGNATURE_INVALID`，compatibility/capability → `ADAPTER_COMPATIBILITY_MISMATCH`，Schema/conformance/golden → `ADAPTER_REGRESSION_FAILED`。下载 transport fault 继续使用既有 gateway 归一化；不向 UI 暴露异常字符串、原生路径或 package 内容。

## 测试与证据

- RFC 8785、manifest/framing golden vectors、完整 canonical 512-byte USTAR header/TAR golden vectors，以及双构建 byte-identical；
- duplicate/unknown fields、number token、非 canonical manifest、错误 key/signature、manifest/TAR tamper；
- application/adapter 双向跨 domain 拒绝；
- absolute/parent/backslash/alias path、乱序/重复/missing/extra entry、link/device/sparse/PAX/GNU、错误 metadata、digest/size 和 trailing bytes；
- 同一 verifier 使用测试公钥和临时 staging root，不用 fake verifier 替代 production path；
- synthetic candidate 只取得 L3 evidence；锁定 Tauri CLI 生成/签名 fixture 和真实 production artifact 才取得 L4 `RELEASE-GATE` credit。

本 ADR 只确认协议与责任边界，没有生成真实 artifact；`ARCH-GATE` 后续因整机技术方案集中验收而关闭，`RELEASE-GATE` 仍须等待真实实现与发布证据。

## 结果

正向影响：

- human-readable signed manifest 与 deterministic archive 可独立审计；
- 无压缩和 regular-file-only profile 减少依赖、资源与 extraction surface；
- 同一 key/toolchain 保持 `ARC-05a` 的最小运维，同时 framing 保持 artifact domain separation；
- deep verifier 隐藏 JCS/TAR/signature 细节，`AdapterRegistry` 保持聚焦于候选与切换。

代价：

- package 体积高于压缩 archive；
- USTAR path 限制需要首个真实四 Agent bundle 证明可满足；
- release job 需要 canonical/deterministic golden vectors；
- 同一产品更新私钥仍是应用更新和 adapter 的共同失陷域。

## 替代方案

### ZIP + 压缩 + manifest

工具生态更常见、体积更小，但增加压缩依赖、metadata 差异、duplicate/path alias 和 extraction surface。

### 单一 postcard bundle

binary framing 更紧凑，且已用于私有恢复快照；但不适合官方声明式 package 的人工检查、跨工具生成和独立 manifest。

### 只签 TAR 或只签 manifest

只签 TAR 不能直接绑定 closed package facts；只签 manifest 而不绑定 actual TAR digest，不能证明下载 archive 与 file table 属于同一 artifact。

## 重新评估触发条件

只有真实 bundle 证明 USTAR path 或未压缩体积无法满足发布约束，才评估新 archive profile；任何 PAX/GNU/ZIP/压缩变更都必须有新 format version 和兼容迁移。只有 Tauri updater signer format 或密钥轮换机制发生不兼容变更，才评估新的 signature version；不得通过关闭验证、接受非 canonical manifest 或引入第三方 package 绕过迁移。
