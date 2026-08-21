# FE-07 — 项目纳入、停止管理与索引健康

**Acceptance state: Frozen (2026-08-10; planning acceptance only)**

**What to build:** 用户逐个纳入候选项目或停止管理已纳入项目，并可理解项目可用性及索引的 fresh、stale、rebuilding、failed 状态。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** `blocked`

**Primary contract fixture:** `FX-07 stale-index-projects`

## 范围与安全边界

- [ ] 只展示标准全局目录和用户选择父目录下的候选项目；候选项目必须由用户逐个确认纳入，规范化路径去重且符号链接不得扩大授权范围。
- [ ] 纳入与停止管理均是管理变更，必须完整经过 `prepare` → review → confirm → `apply`，不得跳过 review；候选、项目可用性和索引状态只经 `read`。
- [ ] 停止管理只停止扫描、监听和管理，绝不删除、移动或重新创建原生资产；路径消失或移动时标记不可用，不猜测位置或自动恢复。
- [ ] 列表与搜索显示 fresh、stale、rebuilding 或 failed。stale 保留最近结果和更新时间，但任何写入前必须重新读取磁盘；重建不显示新旧混合结果。
- [ ] workspace event 只触发失效，随后 authoritative reread；event 本身不得直接替换事实。
- [ ] 复用 FE-07R 的 frozen projection types；本票据只拥有 `FX-07` 项目 lifecycle/index 责任，不夺取 FX-19 或 read-resolver 主归属，也不把其证据用于本票据。
- [ ] 不增加全盘扫描、后台自动纳入或越权恢复入口。

## 计划验证契约

> **2026-08-21 MVP 治理优先于本段旧的 per-ticket formal 文字。** FE-07 在最小实现、L0/L1、必要 L2、路径/symlink/review 等真实产品安全负例、isolated-temp project/event/rebuild L3 和独立功能复审均完成后直接标记 `done`。PF-05、逐票 `verify:ticket`、formal comparison 与 release hardening 只进入统一 release/optimization；未执行时为 `deferred`，不能表述为通过或 release-ready。下文的项目授权、写前 reread 和 L3 边界仍是 MVP 必需项。

**状态：** `planned / unverified`。MVP 只按本票最小 L0/L1、必要 L2、真实路径/项目安全负例、isolated-temp L3 与独立复审推进；不为 MVP 新建 registry 或运行 `npm run verify:ticket -- FE-07`。逐票 formal 入口仅作为统一 release/optimization 的 deferred 输入，尚未运行，不是 runtime evidence、通过或 ticket closure。

**前置条件：** FE-04 的审查与安全应用闭环已有其自身可复验的前置证据；bootstrap、生成 wire 类型和 `FX-07` 安全 fixture 可用。L3 使用专用 Tauri 测试构建及每次新建的 synthetic temporary project/index root，不扫描或管理真实项目。

**预计层级：**

- L0：检查变更源码、类型、格式、lint 与 wire/schema drift。
- L1：检查规范化路径/符号链接授权边界、纳入/停止管理的 `prepare` → review → confirm → `apply` → authoritative reread，以及不得跳过 review 的负向断言、stale 保留与写前重读、event 失效后的 authoritative reread 和重建不混合结果。
- L2：以 scripted mock `FrontendGateway` 跑 `FX-07`，验证纳入/停止管理的 `prepare` → review → confirm → `apply` 与不得跳过 review 的负向断言。
- L3：只在 isolated temporary project 上先执行 include 与 stop-management 的 `prepare` → review → confirm → `apply` → authoritative reread，断言不得跳过 review，再执行 index event → invalidation → authoritative reread → rebuild tracer。
- PF-05：不属于 MVP；synthetic index-events 的性能/压力测量仅在统一 release/optimization 获授权后按实际需要决定，当前没有预算、样本、formal comparison 或通过结论。

**通过判据：** 用户逐个纳入；纳入与停止管理均完整经过 `prepare` → review → confirm → `apply`，不得跳过 review；停止管理不删除原生资产，路径失效不猜测恢复，且 `FX-07` 的状态与可用动作符合本票据。L3 只在临时项目上保留 command/event 与索引事实链。

**失败证据：** 计划以脱敏日志、WebDriver trace、截图或 DOM dump，并附层级和 fixture 标识，写入 `.artifacts/verification/FE-07/<run-id>/`。

**Provenance 边界：** L2 mock PASS 不取得真实 IPC、文件或索引写入 credit。L3 即便穿过真实 WebView/Core/IPC，也只证明 isolated synthetic input，不证明真实用户项目、全盘扫描或 production artifact；PF-05 不替代行为或发布证据。
