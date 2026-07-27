# ADR-0006：应用更新与适配器包共用产品更新签名密钥

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

应用更新包和官方声明式适配器包都需要来源与完整性验证。二者可以使用独立密钥隔离泄漏影响，也可以共用产品更新密钥减少生成、保管、轮换和应急运维。

Apple Developer ID 与 notarization 只验证 macOS 可执行应用的系统分发身份，不能替代应用内对下载更新和声明式适配器包的验证。

## 决策

- Tauri application update artifact 与官方适配器包共用一套产品更新签名密钥；
- 产品更新公钥编译进应用，私钥只存在于受保护的发布环境；
- Apple Developer ID 证书、Hardened Runtime 和 notarization 保持为独立 macOS 信任链；
- 应用更新和适配器包使用不同的 artifact schema、验证路径与安装流程；
- 适配器签名输入采用 ADR-0018 的 length-prefixed framing，必须包含固定 `agent-config-manager/adapter-package/v1` domain、exact RFC 8785 JCS manifest bytes 与完整无压缩 TAR SHA-256；
- 受保护发布环境使用与 Tauri updater 相同的私钥和 Tauri CLI `signer sign`；runtime 使用同一内置公钥和 signer-compatible semantics，但保持独立 adapter verifier；
- 两个验证器必须拒绝另一 artifact 类型，即使其签名由同一私钥生成；
- 不引入在线 root、阈值签名、远程撤销或多角色更新元数据。

## 安全不变量

- 先对 raw manifest bytes、固定 domain 与完整 archive digest 验证 detached signature，再解析声明式正文或逐 entry staging；
- manifest 封闭声明 artifact 类型、格式、identity、版本、兼容范围、所需引擎能力及全部文件 digest；
- 未声明文件、路径穿越、链接、设备文件、可执行内容和不兼容能力封闭失败；
- WebView 不直接下载、验证、解包或写入更新 artifact；
- application/adapter 双向跨 domain 替换必须有负向测试；
- 私钥不能进入仓库、应用 artifact、日志、诊断或 fixture；
- 适配器更新失败不改变 active package，回滚只指向本机已验证的 previous package。

## 结果

正向影响：

- 只有一套产品更新密钥需要生成、保管、注入发布作业和计划轮换；
- 应用更新与适配器发布可以复用最小签名基础设施；
- 内置公钥与离线内置适配器形成简单、可测试的 bootstrap；
- domain separation 保持两个 artifact 解析与启用流程的局部性。

代价：

- 私钥泄漏会同时影响应用更新和适配器包，CI 作业隔离不能消除这一共同失陷域；
- Tauri updater key 丢失会影响已安装应用继续接收可信更新；
- 计划轮换依赖旧密钥签名的过渡应用版本；紧急泄漏可能需要人工重新安装；
- 适配器验证需要独立 domain 和跨类型负向测试，不能直接把 Tauri updater verifier 当作通用文件验证器。

具体 canonical manifest、USTAR profile、signature framing 与安全 staging 见 `docs/architecture/adr/0018-jcs-ustar-adapter-bundle.md`。

## 替代方案

### 独立密钥

应用更新与适配器包分别持有密钥，泄漏和轮换互不影响；代价是两套秘密保管、签名作业、审计和恢复流程。

### 多角色信任元数据

使用离线 root、delegated targets、阈值签名与过期元数据，可以增强撤销、轮换、回滚和 freeze protection；当前 MVP 没有多供应方、多渠道或服务端发布体系支撑这类运维成本。

## 重新评估触发条件

出现第三方发布方、多产品共用适配器仓库、多发布渠道、合规要求的职责分离，或一次密钥事件证明共同失陷域不可接受时，改用独立密钥或多角色信任元数据。迁移必须保留旧应用可验证的签名过渡路径，不得通过关闭验证完成。
