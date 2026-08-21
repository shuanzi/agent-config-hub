# FE-05 — 长期指令创建/导入与 Skill 单目标安装

**Acceptance state: Frozen (2026-08-10; planning acceptance only)**

**What to build:** 长期指令有彼此独立的创建和本地导入流程；Skill 的四 Agent 状态单元格只可发起同格式、单目标的 `installAsset`。两类流程均复用既有草稿、审查、确认和安全应用闭环。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** `blocked`

**Primary contract fixtures:** `FX-08 create-import-validation`、`FX-15 install-single-target`、`FX-17 target-name-collision`

## 范围与安全边界

- [ ] 长期指令的“新建”与“从本地导入”是独立入口，不是转换入口，也不与 Skill 安装混为一条流程；创建/导入形成独立 native asset creation。
- [ ] 创建、导入和 Skill 安装在首次 `prepare` 前均显示完整 target summary：一个目标 Agent、一个 scope、一个 native location 和 redacted summary。target Agent、scope 或 native location 任一变化必须 authoritative reread 并 remap，旧 operation、prepared/review/confirm 立即失效后才可重新解析。
- [ ] Skill 安装只能由目标 Agent 单元格发起，只在 `presence=absent` 且相关事实可判定时映射为同格式 `installAsset` 或稳定 `blocked`；不新增 `setSkillEnabled`，不从列表或详情增加重复主入口。
- [ ] 导入只使用不透明的本地来源引用。前端不得读取、执行或猜测来源内容；不生成产品私有资产格式、中央模板库或自动同步关系。
- [ ] `FX-17` 同名或目标冲突只允许取消、rename，或 `reviewAndOverwrite`；rename 和 `reviewAndOverwrite` 均使旧 operation 失效并重新 `prepare`，overwrite 只能进入新版 review/confirm 后才可 `apply`。取消、collision 和 `prepare` validation failure 均不创建目标、来源关系或新的恢复点，也不得静默覆盖。`apply` 已开始后的失败保留 shared transaction recovery point 和 rollback facts。
- [ ] `apply` 成功后，结果必须先以独立 native result 表达，再对受影响 target authoritative reread；reread 前不得乐观显示可用或 presence/activation 更新。结果不与来源持续同步。
- [ ] 不含跨 Agent 转换；`convertAsset`、能力映射和目标格式生成属于 FE-06。

## 计划验证契约

> **2026-08-21 MVP 治理优先于本段旧的 per-ticket formal 文字。** FE-05 在最小实现、L0/L1、必要 L2、FX-08/15/17 的真实产品安全负例、isolated-temp L3 和独立功能复审均完成后直接标记 `done`。PF、逐票 `verify:ticket`、formal comparison 与 release hardening 只进入统一 release/optimization；未执行时为 `deferred`，不能表述为通过或 release-ready。下文的 L3 安全与 provenance 边界仍是 MVP 必需项。

**状态：** `planned / unverified`。MVP 只按本票最小 L0/L1、必要 L2、真实安全负例、isolated-temp L3 与独立复审推进；不为 MVP 新建 registry 或运行 `npm run verify:ticket -- FE-05`。逐票 formal 入口仅作为统一 release/optimization 的 deferred 输入，尚未运行，不是 runtime evidence、通过或 ticket closure。

**前置条件：** FE-04 的审查与安全应用闭环已有其自身可复验的前置证据；`FX-08`、`FX-15`、`FX-17` 及不透明合成来源引用可在隔离测试数据根复现。L3 使用专用 Tauri 测试构建与每次新建的临时来源/目标根，不访问用户来源或配置。

**预计层级：**

- L0：本切片相关的静态、类型与生成产物一致性门禁。
- L1：创建、导入来源引用、单目标 `installAsset`、完整 target summary；target change 的 authoritative reread/remap 与旧 operation/prepared/review/confirm 失效；取消/collision/`prepare` validation failure 无副作用、`apply` 已开始失败时保留 shared transaction recovery point/rollback facts；以及 `FX-08/15/17` 中 rename/`reviewAndOverwrite` 使旧 operation 失效、重新 `prepare`，且 overwrite 进入新版 review/confirm 的 module/contract 断言。
- L2：以 scripted mock `FrontendGateway` 驱动 `FX-08/15/17` 的浏览器 journey，断言完整 target summary、target change 的 authoritative reread/remap，以及 rename/`reviewAndOverwrite` 使旧 operation 失效后的 reprepare/new review/confirm。
- L3：专用 Tauri 测试构建在 isolated temporary roots 执行创建、导入、同格式单目标安装与 collision tracer，覆盖完整 target summary、target change authoritative reread/remap，以及 rename/`reviewAndOverwrite` 使旧 operation 失效后的 reprepare/new review/confirm。
- PF：无 MVP performance fixture 或 baseline；任何适用性能/平台 hardening 在统一 release/optimization 再决定，复用 FE-04 的 `prepare`/`apply` 不取得 performance credit。

**通过判据：** 仅覆盖本票据的独立创建/导入、单目标同格式安装与完整 target summary；target change 必须 authoritative reread/remap 并使旧 operation/prepared/review/confirm 失效。`FX-17` 的 rename/`reviewAndOverwrite` 均重新 `prepare`，overwrite 进入新版 review/confirm；取消与 `prepare` validation failure 无副作用，`apply` 已开始失败保留 shared transaction recovery point/rollback facts。转换不得进入该票据。L3 留存隔离临时根中的 command/event 与文件事实。

**失败证据：** 计划以脱敏日志、WebDriver trace、截图或 DOM dump，并附层级和 fixture 标识，写入 `.artifacts/verification/FE-05/<run-id>/`。

**Provenance 边界：** L1/L2 分别只证明 module/contract 与 mock renderer 行为。L3 即便穿过真实 WebView/Core/IPC，也只证明 isolated temporary input，绝不证明真实用户配置、真实用户来源或 production artifact。
