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

**状态：** `planned / unverified`。计划统一入口为 `npm run verify:ticket -- FE-08`；该命令未运行，不能作为 ticket closure 或 runtime evidence。

**前置条件：** FE-04 的审查与安全应用闭环已有其自身可复验的前置证据；bootstrap、生成 wire 类型及 `FX-06/14` 安全 fixture 可用。L3 使用专用 Tauri 测试构建、固定公钥和每次新建的 synthetic signed official candidate root，不接触真实 Adapter bundle 或 Agent 安装。

**预计层级：**

- L0：检查变更源码、类型、格式、lint 与 wire/schema drift。
- L1：检查 unknown/incompatible version 的稳定原因码、candidate version/rule/capability changes、验证失败保持 active version/rule、Adapter switch/rollback 的 `prepare` → review → confirm → `apply` 与不得跳过 review 的负向断言、原子 update/switch/rollback，以及无 Skill cell/toggle surface 的负向 contract。
- L2：以 scripted mock `FrontendGateway` 跑 `FX-06/14`，分别验证只读阻断、确认后的 candidate version/rule/capability changes、Adapter switch/rollback 的 `prepare` → review → confirm → `apply` 与不得跳过 review 的负向断言、原子 update/switch/rollback surface，以及无 Skill cell/toggle surface。
- L3：只运行 synthetic signed candidate 的 verify → `prepare` → review → confirm → `apply`（atomic switch）→ `prepare` → review → confirm → `apply`（rollback）tracer，并断言不得跳过 review。
- PF-07：记录 synthetic adapter-bundle descriptor 的验证、switch 和 rollback 测量及 fixture digest；`inconclusive` 不计通过。

**通过判据：** candidate version/rule/capability changes、Adapter switch/rollback 的 `prepare` → review → confirm → `apply`（不得跳过 review）、确认后的原子 update/switch/rollback、`FX-06/14` 的禁用和失败保持均符合本票据；不出现 Agent package-manager 调用、第三方入口、新旧 rule 混用或 Skill cell/toggle surface。L3 只保留合成 candidate 的 command/event tracer。

**失败证据：** 计划以脱敏日志、WebDriver trace、截图或 DOM dump，并附层级和 fixture 标识，写入 `.artifacts/verification/FE-08/<run-id>/`。

**Provenance 边界：** L2 mock PASS 不取得真实 IPC、签名验证或包切换 credit。L3 synthetic candidate 即便穿过真实 WebView/Core/IPC，也不是实际 Adapter bundle provenance，绝不证明真实安装状态、真实 bundle、production artifact 或全量真实 adapter 回归；PF-07 不替代行为或发布证据。
