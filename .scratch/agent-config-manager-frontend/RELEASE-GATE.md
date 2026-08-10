# RELEASE-GATE — 非实现型发布验收门禁

**Status:** blocked

**Direct blockers:** FE-07R（foundation/read）与 FE-01 至 FE-10（10 张行为 tickets）全部为 `done` 并附完成证据。冻结的 v0.2 契约、acceptance 或 planning 不是 `done` evidence；`ARCH-GATE` 维持 closed。

## 目的与边界

本门禁只汇总已完成的实现证据，不新增前端行为票据，也不接管 FX-01 至 FX-19 的主归属。实现票据仍为 1 张 foundation/read ticket（FE-07R，FX-19）和 10 张行为 tickets（FE-01 至 FE-10）；FX-12 的单一集成 UI 旅程仍只属于 FE-10。它承接跨票据全回归、真实 adapter 契约回归、构建、打包及负向范围检查。

## 验证命令契约

**状态：** `planned / unverified`。当前已有 `package.json` 根级命令面，但 FE-07R 的 registry/orchestration 仍须到 OpenSpec task 2.3 才可创建或调整；当前也没有可运行 production app、签名产物或本门禁的实际命令证据。

**统一入口：** `npm run verify:release`

**前置条件：**

- FE-07R 与 FE-01 至 FE-10 均为 `done` 且各自 `verify:ticket` manifest 可读取；FE-07R 的 FX-19 L0/L1/L3 actual-read evidence 与 FE-01 自身 L0/L1/L2/L3/PF-01 evidence 不得互相借用；`ARCH-GATE` 已于 2026-07-27 关闭；
- 在待发布 commit 的干净 checkout 上使用技术方案固定的 Node/npm/Rust 与 `npm ci`；
- Apple Silicon macOS `15.0.x` 与发布时 current stable macOS reference/release environment 可用；签名、notarization 与产品更新签名凭证可用，且不会写入仓库、artifact 或日志；
- stable feed 的 artifact 只在本地 staging 验证；本命令不上传、覆盖 `latest.json` 或执行外部发布。

**预计组成：**

1. L0：toolchain、lockfile、生成漂移、format/lint/typecheck、Rust fmt/clippy、禁止依赖和生产测试能力负向检查；
2. L1：全部 Rust、Vitest、wire、AdapterRegistry 只读 provenance、事务与安全负向回归；
3. L2：FX-01 至 FX-18 的 mock renderer 全回归；FX-19 不设 L2 UI journey；只取得 renderer/mock provenance；
4. L3：专用 Tauri test harness 对同一个 `FrontendGatewayContract` 做真实 adapter 全回归，并覆盖 FX-19 的只读 all/global/project projection，以及隔离 command/event、prepare/apply、索引、更新与恢复 tracer；
5. PF：在固定 reference environment 复测所有已冻结预算；缺预算、超预算或环境不确定均不能通过；
6. L4：只为 `aarch64-apple-darwin` 构建不含 WebDriver/test surface 的生产 app、DMG、`darwin-aarch64` updater `.app.tar.gz`/`.sig` 和统一 adapter bundle；在 macOS `15.0.x` 与 current stable Apple Silicon 环境验证安装/启动。最终 DMG 验证 Apple notarization/staple、Gatekeeper 及所含 app 的 Developer ID/Hardened Runtime、deployment target 和单 arm64 slice；updater archive/`.sig` 验证 Tauri 产品更新签名及解包后 app，`latest.json` 验证唯一 platform、不可变 URL 和 inline signature exact match；不得对 `.tar.gz` 或 `.sig` 执行 Apple stapling/notarization；
7. 负向范围：检查不存在 MVP 外入口、测试 command/capability/plugin、fixture、秘密、私有路径或未声明可执行内容。

**通过判据：**

- 所有步骤为 `pass`，没有 `fail` 或 `inconclusive`；
- FX 全回归与真实 gateway contract 使用相同的行为断言，但 L2/L3 provenance 分开；
- test harness 与 production artifact identity 分开，生产候选经过独立 L4 验证；
- PF 原始样本、预算比较、签名/notarization log、artifact digest 和负向扫描均可复核且已脱敏；
- 独立只读审查没有未处理的有效 release finding。

**失败证据：** `.artifacts/verification/RELEASE-GATE/<run-id>/`。manifest 必须记录 commit、dirty state、工具链、fixture/PF digest、test/production artifact identity、步骤状态与证据路径；不得包含秘密、真实用户路径、配置正文、diff 或可重放写入 payload。

**证据边界：**

- L2 mock PASS 不是实际 IPC、磁盘或发布证据；
- L3 test harness PASS 不是 production app/DMG、签名或 notarization 证据；
- L4 安装/启动 PASS 不自动证明全部 FX 行为；
- 本命令生成和验证本地 release candidate，但未经另行授权不得提交、推送、上传或发布外部 feed。

## 关闭条件

- [ ] FE-07R 已以自身 L0/L1/L3 actual-read evidence 完成 FX-19；无 L2、无 PF，且其 evidence 未被计入 FE-01 closure；
- [ ] 所有 FX-01 至 FX-19 都由各自主票据完成并保留其范围对应的聚焦 evidence；FX-19 仍无 L2 UI journey；
- [ ] mock 与真实 `FrontendGateway` adapter 在已建立的同一契约测试上完成全回归；
- [ ] 技术方案中已经实际运行并标记为“已验证可运行”的构建与打包命令通过；
- [ ] macOS 15+ arm64-only 的签名/notarization、单一应用更新 artifact 和架构无关适配器更新范围按技术方案验证；
- [ ] 负向范围检查确认没有 Agent 执行、Agent 本体安装/升级/卸载、云同步、第三方适配器、批量写入、跨资产依赖图、凭证管理、Windows/Linux 可用性或其他 MVP 外入口；
- [ ] 发布候选不将 mock、静态检查、占位命令或未验收设计宣称为真实运行、构建、打包或发布证据；
- [ ] 独立只读审查已处理有效 release finding。

`RELEASE-GATE` 的完成不会追溯改变 FE-07R 与 FE-01 至 FE-10 的状态或验收范围；若某项回归失败，报告到对应主票据或技术方案，不新建横向实现票据。
