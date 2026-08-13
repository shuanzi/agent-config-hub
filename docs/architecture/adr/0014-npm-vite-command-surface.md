# ADR-0014：采用 npm + Vite 根级验证命令面

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

应用已经需要 Node/Vite 构建 React，同时需要协调 Cargo、Vitest、WebdriverIO、Tauri、性能测量和 macOS 发布验证。若每张票据直接记录各工具原生命令，handoff、CI 与发布容易漂移；增加独立 task runner 又会扩大安装和版本面。

## 决策

- React SPA 使用 Vite；
- Node/npm/Rust 分别固定为 24.18.0、11.16.0 和 1.97.1 stable；
- 提交 `package-lock.json`、`Cargo.lock`、`.node-version` 和 `rust-toolchain.toml`；
- `package.json` scripts 是唯一人类与 CI 共用的根级命令面；
- 使用 `verify:toolchain`、`verify:static`、`test:rust`、`test:frontend`、`test:ui`、`test:tauri`、`perf`、`build:frontend`、`build:app`、`package:macos`、`verify:ticket` 与 `verify:release`；
- 多进程编排只由薄 Node ESM wrapper 使用参数数组和 `spawn` 完成；
- `verify:ticket -- <FE-ID>` 读取封闭 registry，不能由票据静默减少层级；
- 每次根验证写入结构化、脱敏且分层标注 provenance 的 evidence manifest；
- 不增加 Make、just、Nx、Turborepo 或全局 task runner。

## Interface 不变量

- 未知 ticket/PF ID、缺少前置条件、子命令失败、超时或 evidence 写入失败都非零退出；唯一封闭例外为本次 FE-01 exact subject waiver：唯一 numeric latency 的 PF step 仍记录 automatic `fail`/exit `1`，只有其余六项 hard gate、final physical evidence、clean lineage 与 exact manual disposition 同时成立时，根 `verify:ticket` 才以 `accepted-with-waiver` exit `0` 返回；
- 普通 verify/test 命令不改写 source、lockfile、budget 或 baseline；
- 生成漂移在临时目录比较，不能靠自动修复制造通过；
- 底层原生命令可用于诊断，但不能单独关闭票据；
- `pass`、`fail` 与 `inconclusive` 明确区分，后两者都不能取得 gate credit；本次 FE-01 subject waiver 的 `accepted-with-waiver` 不等于 automatic PASS，不进入 clean-pass index，也不能取得 `RELEASE-GATE` credit；
- evidence 不保存真实路径、正文、diff、秘密、签名凭证或可重放写入 payload；
- test harness 与 production artifact identity 分开记录；
- 所有命令在 FE-01 实际实现和运行前均保持 `planned / unverified`。

## 结果

正向影响：

- 本地、CI、handoff 和发布使用同一命令名；
- 不增加 Node/Rust 之外的全局前置工具；
- 每张票据都有一个稳定关闭入口和可核对 manifest；
- 底层层级与 provenance 对代理和 reviewer 可见；
- Vite 与 Tauri 的 frontend hooks 可以直接复用 npm scripts。

代价：

- Rust 开发者需要通过 npm root script 执行正式门禁；
- `package.json` 与薄 orchestrator 需要维护 ticket registry；
- Node 工具链问题可能阻断统一入口，即使某个 Cargo test 可单独运行；
- command registry 变更必须与票据和技术方案同步。

## 替代方案

### just

跨语言 recipes 清晰，但需要额外安装和固定全局 binary，与“最小运维”目标不符。

### 各工具原生命令

没有 wrapper，但 ticket、CI 与 release 会复制不同参数，难以保证同一验收面和证据格式。

## 重新评估触发条件

只有项目演化为多个独立 package/crate workspace，且根 npm scripts 与薄 Node wrapper 已被实际证明无法保持清晰和可靠时，才评估新的 task runner。不得因个人命令偏好增加第二个正式入口。
