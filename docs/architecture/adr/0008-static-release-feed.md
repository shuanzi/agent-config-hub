# ADR-0008：采用直接分发与单 stable 静态 HTTPS feed

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

应用 release artifact 和统一 compatibility bundle 都需要可信发布位置。可以使用纯静态签名文件，也可以增加动态版本选择或完整灰度发布平台。

当前 MVP 是本地单用户 macOS 应用，没有账户、遥测、多渠道、分批发布或远程控制要求，并已选择共享产品更新密钥和统一 adapter bundle。

## 决策

- macOS 应用采用 Developer ID 直接分发，不进入 Mac App Store 或双渠道；
- 初始安装发布签名、notarized 且 stapled 的 DMG；
- 只维护一个 stable channel；
- 应用 Tauri updater artifact 与 adapter compatibility bundle 使用同一官方 HTTPS 静态 origin 下的独立 manifest 和不可变版本 URL；`app/latest.json.platforms.darwin-aarch64.signature` 内联对应 updater `.sig` 的 exact text content，不使用 signature 路径或 URL；每个 adapter version 固定定位 `bundle.manifest.json`、`bundle.tar` 与 `bundle.sig`；
- 先发布并验证 versioned artifact，最后更新 `latest.json`；
- 不运行动态更新 endpoint、发布数据库、账户、遥测、灰度、远程 kill switch 或服务端回退；
- 静态 feed 是 locator，不是安装或写入授权来源；
- runtime 中只启用产品基线已经授权的 adapter 自动检查；应用自身更新 UI 与后台行为不在 MVP 中启用。

## 信任与失败边界

- 初始 DMG 及其应用由 Apple Developer ID/notarization 保护；Tauri updater artifact 另外使用产品更新签名；
- adapter artifact 使用共享产品更新公钥和独立 `adapter-package/v1` domain；
- 下载、解析和验证均位于 Rust，WebView 不直接访问 feed；
- adapter 候选只有在签名、完整性、兼容性、回归和用户确认通过后才能 active；
- 旧 manifest 不能触发降级，feed 不可用或无效时保持当前应用和 active/built-in bundle；
- adapter 回滚只使用本机已验证 previous bundle；
- 静态 feed 的 availability freeze 风险被接受，不增加在线 root 或 timestamp service。

## 发布顺序

应用与 adapter 使用独立作业：

1. 构建并完成适用的签名、notarization、回归和负向检查；
2. adapter job 生成确定性无压缩 TAR、RFC 8785 JCS manifest 与固定 domain signing input；app job 生成 Tauri updater artifact；
3. 使用共享产品私钥生成并独立验证对应 detached signature；
4. 上传不可变 versioned artifact；
5. 验证下载、digest、签名和可安装/可 staging 性；
6. 最后更新 stable manifest。

任一步失败不得推进 latest manifest。发布私钥和 Apple 凭证只在对应受保护作业中最小暴露。

adapter artifact 与 verifier 的具体 framing 见 `docs/architecture/adr/0018-jcs-ustar-adapter-bundle.md`。
应用的最低 macOS、CPU 与单一 artifact matrix 见 `docs/architecture/adr/0019-macos-15-arm64-only.md`。

## 结果

正向影响：

- 无长期运行后端，发布和故障面最小；
- app 与 adapter 共用静态托管和签名基础设施，但保持独立 schema 与验证路径；
- manifest-last 顺序避免客户端看到尚未完整上传的 release；
- 离线或 feed 故障不会影响内置或当前 active adapter。

代价：

- 不能灰度、按设备选择版本或远程暂停已缓存 manifest；
- 无在线 timestamp/freeze protection，旧但有效 feed 可能延迟更新发现；
- 错误 app release 需要发布更高版本修复，不能远程降级；
- 若未来增加应用内更新体验，必须先补产品与前端契约，不能仅因已存在 updater artifact 就直接启用。

## 替代方案

### 轻量动态版本选择 endpoint

可以按当前版本、架构或发布状态返回 artifact，但需要在线服务、监控和应急运维。

### 完整发布平台

可以提供多 channel、灰度、遥测和远程回退，但引入账户、隐私和服务端状态。

### Mac App Store 或双渠道

由 Apple 管理应用分发，但需要 App Sandbox、独立审核和更新路径，并形成第二套包与运维。

## 重新评估触发条件

只有实际用户规模、合规或 incident response 要求证明必须灰度、远程暂停或多渠道发布时，才评估动态服务。只有产品基线明确加入 Mac App Store 或应用内更新体验时，才新增相应签名、sandbox、UI 与恢复设计。
