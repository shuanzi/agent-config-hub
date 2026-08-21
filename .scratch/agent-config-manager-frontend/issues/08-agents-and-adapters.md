# FE-08 — Agent 与 Adapter registry/bundle 管理

**Acceptance state: Frozen (2026-08-10; planning acceptance only)**

**What to build:** 用户可只读查看受支持 Agent 的 registry 与兼容 facts，并安全检查 Adapter bundle 的 active version、rule、capability、candidate、update、switch 和 rollback。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** `blocked`

**Primary contract fixtures:** `FX-06 unknown-agent-version`、`FX-14 adapter-update-rollback`

## 范围与安全边界

- [ ] Agent registry 的安装状态、解析路径、版本和兼容性只经 `read` 展示；缺失、unknown 或不兼容版本给出稳定的只读/阻断原因码。
- [ ] Adapter bundle candidate 必须显式展示 version、app/Agent scope、capability 和 rule changes。Adapter switch 与 rollback 均为管理变更，必须完整经过 `prepare` → review → confirm → `apply`，不得跳过 review；update 的结果同样只可经该闭环生效。
- [ ] signature、integrity、compatibility 或 candidate regression 失败时保持当前 active version/rule；成功 switch 以单一结果表达，不得出现新旧 rule 混用。
- [ ] rollback 只能回到上一可用版本，且不修改原生资产；不得自动改变转换行为。
- [ ] 不提供 Agent 安装、升级、卸载、包管理器调用、第三方/自定义/社区 Adapter 或绕过验证入口。
- [ ] 负向边界：本票据不实现 Skill cell UI 或 toggle surface，也不接管其 `installAsset`、`convertAsset`、`editAsset` 或 toggle 行为。

## 计划验证契约

> **2026-08-21 MVP 治理优先于本段旧的 per-ticket formal 文字。** FE-08 在最小实现、L0/L1、必要 L2、signature/integrity/compatibility/rollback 的真实产品安全负例、synthetic signed candidate L3 和独立功能复审均完成后直接标记 `done`。PF-07、逐票 `verify:ticket`、formal comparison 与 release hardening 只进入统一 release/optimization；未执行时为 `deferred`，不能表述为通过或 release-ready。下文的 untrusted bundle 处理与 synthetic-L3 provenance 边界仍是 MVP 必需项。

**状态：** `planned / unverified`。MVP 只按本票最小 L0/L1、必要 L2、真实 bundle 安全负例、synthetic signed-candidate L3 与独立复审推进；不为 MVP 新建 registry 或运行 `npm run verify:ticket -- FE-08`。逐票 formal 入口仅作为统一 release/optimization 的 deferred 输入，尚未运行，不是 runtime evidence、通过或 ticket closure。

**前置条件：** FE-04 的审查与安全应用闭环已有其自身可复验的前置证据；bootstrap、生成 wire 类型及 `FX-06/14` 安全 fixture 可用。L3 使用专用 Tauri 测试构建、固定公钥和每次新建的 synthetic signed official candidate root，不接触真实 Adapter bundle 或 Agent 安装。

**预计层级：**

- L0：检查变更源码、类型、格式、lint 与 wire/schema drift。
- L1：检查 unknown/incompatible version 的稳定原因码、candidate version/rule/capability changes、验证失败保持 active version/rule、Adapter switch/rollback 的 `prepare` → review → confirm → `apply` 与不得跳过 review 的负向断言、原子 update/switch/rollback，以及无 Skill cell/toggle surface 的负向 contract。
- L2：以 scripted mock `FrontendGateway` 跑 `FX-06/14`，分别验证只读阻断、确认后的 candidate version/rule/capability changes、Adapter switch/rollback 的 `prepare` → review → confirm → `apply` 与不得跳过 review 的负向断言、原子 update/switch/rollback surface，以及无 Skill cell/toggle surface。
- L3：只运行 synthetic signed candidate 的 verify → `prepare` → review → confirm → `apply`（atomic switch）→ `prepare` → review → confirm → `apply`（rollback）tracer，并断言不得跳过 review。
- PF-07：不属于 MVP；synthetic adapter-bundle 的性能/压力测量仅在统一 release/optimization 获授权后按实际需要决定，当前没有预算、样本、formal comparison 或通过结论。

**通过判据：** candidate version/rule/capability changes、Adapter switch/rollback 的 `prepare` → review → confirm → `apply`（不得跳过 review）、确认后的原子 update/switch/rollback、`FX-06/14` 的禁用和失败保持均符合本票据；不出现 Agent package-manager 调用、第三方入口、新旧 rule 混用或 Skill cell/toggle surface。L3 只保留合成 candidate 的 command/event tracer。

**失败证据：** 计划以脱敏日志、WebDriver trace、截图或 DOM dump，并附层级和 fixture 标识，写入 `.artifacts/verification/FE-08/<run-id>/`。

**Provenance 边界：** L2 mock PASS 不取得真实 IPC、签名验证或包切换 credit。L3 synthetic candidate 即便穿过真实 WebView/Core/IPC，也不是实际 Adapter bundle provenance，绝不证明真实安装状态、真实 bundle、production artifact 或全量真实 adapter 回归；PF-07 不替代行为或发布证据。
