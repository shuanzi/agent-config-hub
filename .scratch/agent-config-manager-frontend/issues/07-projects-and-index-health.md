# FE-07 — 项目纳入与索引健康

**What to build:** 用户能够显式纳入候选项目、停止管理项目，并理解授权范围、项目可用性和搜索索引健康状态。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** blocked

**Primary contract fixtures:** `FX-07 stale-index-projects`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] 自动发现仅展示标准全局目录和用户选择父目录下的候选项目；
- [ ] 候选项目必须由用户逐个确认纳入；
- [ ] 纳入项目与停止管理项目均为管理变更：先通过 `prepare` 呈现范围、风险和确认依据，再通过 `apply` 生效；候选展示、索引状态和项目可用性继续只经 `read`；
- [ ] 规范化路径用于候选去重，符号链接不会扩大授权范围；
- [ ] 移除项目只停止扫描、监听和管理，不删除或移动原生资产；
- [ ] 项目路径消失或移动时标记不可用，不自动重建或猜测位置；
- [ ] 列表和搜索显示 fresh、stale、rebuilding 或 failed 索引状态；
- [ ] stale 状态保留最近结果和更新时间，但所有写入仍重新读取磁盘；
- [ ] workspace event 只触发失效和 `read`，不直接替换事实；
- [ ] 索引重建不向用户暴露新旧混合结果；
- [ ] 不增加全盘扫描、后台自动纳入或越权恢复入口。

## 验证命令契约

**状态：** `planned / unverified`

- **统一入口：** `npm run verify:ticket -- FE-07`；这是实现后的计划命令，尚未运行。
- **前置条件：** FE-04 已有 `done` 证据；bootstrap、生成 wire 类型和 `FX-07` 安全 fixture 可用；L3 使用专用 Tauri 测试构建与每次新建的合成临时项目/索引根，不扫描或管理真实项目。
- **预计层级：** L0 检查变更源码、类型、格式、lint 与 wire/schema drift；L1 检查规范化路径/符号链接授权边界、纳入与停止管理的 prepare/apply、stale 保留与写前重读、event 失效后 authoritative reread、重建不混合结果；L2 以 scripted mock `FrontendGateway` 跑 `FX-07`；L3 只跑一次隔离临时项目的索引事件 → 失效 → 重读 → 重建 tracer；PF-05 记录合成 index-events descriptor 的索引、事件合并、重读和重建测量及 fixture digest。
- **通过判据：** 用户逐个纳入、停止管理不删除原生资产、路径失效不猜测恢复，且 `FX-07` 的状态和可用动作符合本票据；L3 只在临时项目上证明 command/event 与索引事实链；PF-05 留存原始样本、运行环境与 baseline/预算冻结记录，出现 `inconclusive` 不得计通过。
- **失败证据：** 脱敏日志、WebDriver trace、截图或 DOM dump、层级与 fixture 标识写入 `.artifacts/verification/FE-07/<run-id>/`。
- **Provenance 边界：** L2 mock PASS 不取得真实 IPC、文件或索引写入 credit；L3 只证明该临时项目的 event-rebuild 路径，不证明真实用户项目、全盘扫描或真实 adapter 全回归；PF-05 数据不替代行为或发布证据。
