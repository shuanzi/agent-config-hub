# FE-06 — Skill 与 Subagent 的跨 Agent 转换

**Acceptance state: Frozen (2026-08-10; planning acceptance only)**

**What to build:** Skill 的四 Agent 状态单元格可发起转换；Subagent 只由详情页次级转换入口发起。两者都遵循单源、单目标、单 scope 的确定性转换与审查应用闭环。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** `blocked`

**Primary contract fixtures:** `FX-09 conversion-complete`、`FX-10 conversion-degraded`、`FX-11 conversion-blocked`

## 范围与安全边界

- [ ] 仅支持 Skill 和 Subagent 在 Claude Code、Codex、Gemini CLI、OpenCode 四 Agent 之间的 24 条有方向路径（每种类型 4 × 3）；长期指令和 Hook 明确无转换。
- [ ] 每次只有一个 source asset、一个不同的 target Agent 和一个 target scope；target Agent、scope 或 native location 任一变化必须 authoritative reread/remap，并使旧 mapping、prepared/review/confirm 状态立即失效后重新解析。
- [ ] Prompt 与 unknown/extension content 只能 lossless round-trip 或 `blocked`；绝不能标记为 `degraded`、`prepared` 或 `applied`。
- [ ] 模型、工具、权限及其他无法证明安全映射的差异，必须在写入前明确标记为 `manual work`、`degraded` 或 `blocked`；阻断结果不产生可应用的 prepared operation。
- [ ] raw-copy 不是转换，必须拒绝，不能生成转换结果或绕过 target selection → mapping → review → confirm → apply。
- [ ] 成功结果使用目标 Agent 原生格式，是与来源无持续同步的独立 native asset；只有 `apply` 成功且受影响事实 authoritative reread 后才显示实际可用。
- [ ] 敏感引用只转换引用关系，不复制明文密钥；相同输入与规则版本产生稳定、可解释的 mapping。

## 计划验证契约

> **2026-08-21 MVP 治理优先于本段旧的 per-ticket formal 文字。** FE-06 在最小实现、L0/L1、必要 L2、FX-09/10/11 的真实转换安全负例、isolated-temp L3 和独立功能复审均完成后直接标记 `done`。PF-06、逐票 `verify:ticket`、formal comparison 与 release hardening 只进入统一 release/optimization；未执行时为 `deferred`，不能表述为通过或 release-ready。下文的 lossless-or-blocked、raw-copy 拒绝与 L3 边界仍是 MVP 必需项。

**状态：** `planned / unverified`。MVP 只按本票最小 L0/L1、必要 L2、真实转换安全负例、isolated-temp L3 与独立复审推进；不为 MVP 新建 registry 或运行 `npm run verify:ticket -- FE-06`。逐票 formal 入口仅作为统一 release/optimization 的 deferred 输入，尚未运行，不是 runtime evidence、通过或 ticket closure。

**前置条件：** FE-04 的审查与安全应用闭环已有其自身可复验的前置证据；bootstrap、生成 wire 类型和 `FX-09/10/11` 安全 fixture 可用。L3 使用专用 Tauri 测试构建、每次新建的隔离临时根与单一合成 target，不读取或修改真实 Agent 配置。

**预计层级：**

- L0：检查变更源码、类型、格式、lint 与 wire/schema drift。
- L1：检查 24 路决定性 mapping、target change 的 authoritative reread/remap 与旧 mapping/prepared/review/confirm 失效、lossless-or-blocked、敏感引用、重名处理、raw-copy 拒绝、独立结果和 no-sync。
- L2：以 scripted mock `FrontendGateway` 跑 `FX-09/10/11`，分别验证完整转换进入审查、target change 的 authoritative reread/remap 与旧 mapping/prepared/review/confirm 失效、其他差异的明确 manual/degraded 风险，以及阻断停留在报告。
- L3：只在 isolated temporary root 上执行单一 synthetic target 的转换，覆盖 target change 的 authoritative reread/remap 与旧 mapping/prepared/review/confirm 失效，并记录 WebView/Core/IPC command/event tracer。
- PF-06：不属于 MVP；synthetic conversion-transaction 的性能/压力测量仅在统一 release/optimization 获授权后按实际需要决定，当前没有预算、样本、formal comparison 或通过结论。

**通过判据：** 各层只覆盖上述完整、降级、阻断、重名和 lossless-or-blocked 分支；target change 必须 authoritative reread/remap 并使旧 mapping/prepared/review/confirm 失效。L3 只保留隔离单目标路径的 tracer。PF-06 的任何样本、运行环境、baseline 或预算冻结均为未来统一 release/optimization 的 deferred 事项，不构成本票 MVP pass gate。

**失败证据：** 计划以脱敏日志、WebDriver trace、截图或 DOM dump，并附层级和 fixture 标识，写入 `.artifacts/verification/FE-06/<run-id>/`。

**Provenance 边界：** L2 mock PASS 不取得真实 IPC 或写入 credit。L3 即便穿过真实 WebView/Core/IPC，也只证明 isolated synthetic input，不证明真实用户配置、production artifact、全部真实 adapter 或跨 Agent 行为等价；PF-06 不替代行为或发布证据。
