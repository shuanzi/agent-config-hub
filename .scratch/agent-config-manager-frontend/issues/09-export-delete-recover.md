# FE-09 — 独立导出、删除与恢复

**Acceptance state: Frozen (2026-08-10; planning acceptance only)**

**What to build:** 用户可安全导出原生资产，执行可恢复删除，并在恢复 target 被占用时审查差异而非覆盖当前内容。三者都是独立显式操作。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** `blocked`

**Primary contract fixture:** `FX-13 delete-export-recover`

## 范围与安全边界

- [ ] `exportAsset` 必须完整经过 `prepare` → review → confirm → `apply`：先核对目标、原生边界、路径及敏感/可执行风险，再按原始文件或目录结构写入用户选择位置；不生成产品私有格式、诊断包、完整环境备份或迁移包。
- [ ] `deleteAsset` 是独立的 `prepare` → review → confirm → `apply` 操作，不得跳过 review；绝不属于 Skill toggle，也绝不允许 toggle fallback 为 delete；delete 也不归属 FE-04。
- [ ] 删除前明确显示 native asset boundary、目标路径及所有 affected contexts。对 global projected asset，显示其受影响的 projected contexts，同时只按 native global ownership 执行删除，不建立项目副本或跨资产影响分析。
- [ ] 独立文件或目录优先进入系统废纸篓；配置块通过完整宿主文件快照移除。外部删除只显示 missing，绝不自动重新创建。
- [ ] target 未占用的 `recoverAsset` 必须完整经过 `prepare` → review → confirm → `apply`，并核对当前 target、native boundary、差异、兼容与并发状态。target 被占用的 recovery collision 必须以稳定 `blocked` reason 表达，无写入、绝不进入 `apply`，并明确呈现差异以阻断静默覆盖。
- [ ] `setRecoveryPointPinned` 通过同一 gateway 的 `prepare` → review → confirm → `apply` 固定或取消固定恢复点，不得跳过 review；最近有效恢复点保持保护。
- [ ] 导出、删除和恢复不得执行 Git 操作；任何 apply 成功后都须对受影响事实 authoritative reread，再显示独立 native result。

## 计划验证契约

**状态：** `planned / unverified`。计划统一入口为 `npm run verify:ticket -- FE-09`；该命令未运行，不能作为 ticket closure 或 runtime evidence。

**前置条件：** FE-04 的审查与安全应用闭环已有其自身可复验的前置证据；bootstrap、生成 wire 类型和 `FX-13` 安全 fixture 可用。L3 使用专用 Tauri 测试构建及每次新建的 synthetic temporary source、export、delete 和 recovery roots，不读取或修改用户资产或 Git 工作树。

**预计层级：**

- L0：检查变更源码、类型、格式、lint 与 wire/schema drift。
- L1：检查 export 的 `prepare` → review → confirm → `apply`、导出风险/原生边界、prepare 无副作用、global projected asset 的 affected contexts、`deleteAsset` 和 `setRecoveryPointPinned` 的 `prepare` → review → confirm → `apply` 与不得跳过 review 的负向断言、删除后的 missing 表面；负向 contract 断言 toggle 绝不生成 `deleteAsset`，FE-04 不取得 delete ownership；正常 recover 经 `prepare` → review → confirm → `apply`，occupied recovery collision 为稳定 `blocked`、无写入且绝不进入 `apply`。
- L2：以 scripted mock `FrontendGateway` 跑 `FX-13`，验证 export、`deleteAsset`、`setRecoveryPointPinned` 和正常 recover 的 `prepare` → review → confirm → `apply` 及 delete/pinning 不得跳过 review 的负向断言，以及 occupied recovery collision 的稳定 `blocked`、无写入、无 `apply`。
- L3：只在 isolated temporary roots 执行 export → `deleteAsset` 的 `prepare` → review → confirm → `apply` → 正常 recover，以及 `setRecoveryPointPinned` 的 `prepare` → review → confirm → `apply` tracer，并断言 delete/pinning 不得跳过 review；另断言 occupied recovery collision 为稳定 `blocked`、无写入且绝不进入 `apply`，并记录 command/event 与文件事实。
- PF-06：记录 synthetic conversion-transaction descriptor 的 recovery branch、事务与恢复测量及 fixture digest；`inconclusive` 不计通过。

**通过判据：** export、正常 recover、`deleteAsset` 和 `setRecoveryPointPinned` 均完整经过 `prepare` → review → confirm → `apply`，delete/pinning 不得跳过 review，且导出保持原始结构；删除独立于 toggle/FE-04 ownership。occupied recovery collision 仅为稳定 `blocked`、无写入、无 `apply`，只呈现差异不覆盖。L3 只保留临时目录的事实 tracer。

**失败证据：** 计划以脱敏日志、WebDriver trace、截图或 DOM dump，并附层级和 fixture 标识，写入 `.artifacts/verification/FE-09/<run-id>/`。

**Provenance 边界：** L2 mock PASS 不取得真实 IPC 或文件写入 credit。L3 即便穿过真实 WebView/Core/IPC，也只证明 isolated synthetic input，不证明真实用户废纸篓、真实资产、Git 工作树或 production artifact；PF-06 不替代行为或发布证据。
