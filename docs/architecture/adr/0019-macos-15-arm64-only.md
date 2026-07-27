# ADR-0019：MVP 仅支持 macOS 15+ Apple Silicon，并维护单一 arm64 发布轨

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

`ARC-05c` 已固定 Developer ID 直接分发、一个 stable 静态 HTTPS feed 与 manifest-last 发布；`ARC-06c` 已固定验证命令和证据层级。尚需确定最低 macOS、CPU 架构及由此产生的应用 artifact matrix。

MVP 可以发布 universal binary、分别发布 arm64/x86_64，或只支持 Apple Silicon。用户明确优先选择最简单的发布运维，并接受缩小设备覆盖。

## 决策

- 最低支持系统为 macOS `15.0`，Tauri 固定 `bundle.macOS.minimumSystemVersion = "15.0"`；
- 唯一 CPU 架构为 Apple Silicon `arm64`，唯一 Rust/Tauri target 为 `aarch64-apple-darwin`；
- 每个应用版本只发布一个 arm64 DMG、一个 `darwin-aarch64` updater `.app.tar.gz` 及其 `.app.tar.gz.sig`；
- `app/latest.json.platforms` 只包含 `darwin-aarch64`，其 `signature` 内联对应 `.sig` 的 exact text content，不接受路径或 URL；不做架构探测、设备分流或 fallback；
- 不构建 x86_64 slice、universal binary、Intel DMG 或第二 updater artifact；
- adapter bundle 是架构无关的声明式数据，继续只发布 `ARC-05d` 固定的一套三件套；
- macOS 14、Intel Mac、Windows 与 Linux 不在 MVP 支持或 release test matrix 中。

具体 CI provider、runner 产品和托管 provider 不冻结。任何 provider 都必须满足同一 target、签名、公证、静态 feed 与证据契约。

## 验证

- `verify:toolchain` 拒绝 release 配置中的 x86_64/universal target，并核对最低系统版本和 `aarch64-apple-darwin` toolchain；
- L4 检查 app executable 与全部 bundled native binaries 只有 arm64 slice，deployment target 为 macOS 15.0；
- 最终 DMG 验证 notarization/staple、Gatekeeper 及所含 app 的 Developer ID/Hardened Runtime；updater `.app.tar.gz` 只验证 Tauri updater signature，并在解包后验证所含 app 的 Apple 签名与 notarization validity，不对 `.tar.gz` 执行 stapling；
- `.app.tar.gz.sig` 只执行产品更新公钥验证，并逐 byte 对应 `latest.json` 的 inline signature；它不执行 Developer ID、Hardened Runtime、Apple notarization 或 stapling；
- 同一 release candidate 至少在干净的 Apple Silicon macOS `15.0.x` 环境和发布时 current stable Apple Silicon macOS 环境实际安装、启动；记录 exact OS patch、环境 identity 与 artifact digest；
- 缺少任一真实环境或验证结果不确定时，`RELEASE-GATE` 为 `inconclusive`，不能用静态配置或 mock PASS 替代；
- 当前没有 production artifact 或实际 release run，本 ADR 不产生 L4 evidence。

## 结果

正向影响：

- 只有一个 CPU build、DMG、updater、签名、公证、feed 与回滚轨；
- 不需要 universal 合并、双架构 artifact mapping 或 Intel 专用 QA；
- 与单 stable 静态 feed 的最小运维目标一致。

代价：

- 排除所有 Intel Mac；
- 排除仍运行 macOS 14 的 Apple Silicon 设备；
- 如果未来扩大覆盖，必须新增构建和真实验证矩阵，不能只修改一个 target flag。

## 替代方案

### macOS 14+ universal binary

一个发布轨可同时覆盖 Apple Silicon、Intel 和 Sonoma，但 artifact 更大，构建与验证仍需两个 CPU slice。

### macOS 14+ 分离 arm64/x86_64 artifact

单个下载更小，但 DMG、updater、签名、公证、feed mapping、回滚和 QA 形成两套矩阵。

## 重新评估触发条件

只有产品基线明确要求 Intel、macOS 14 或更广覆盖，或者真实用户与支持成本证据证明收益大于双架构运维成本时才重新评估。依赖升级若要求高于 macOS 15，也必须先提交产品范围 Change Request；实现代理不得静默抬高最低系统版本。
