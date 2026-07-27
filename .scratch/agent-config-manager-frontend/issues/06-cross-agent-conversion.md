# FE-06 — 跨 Agent 转换

**What to build:** 用户能够对一个源资产选择一个目标 Agent 和作用域，理解能力映射，并只在转换可安全应用时进入差异与事务闭环。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** blocked

**Primary contract fixtures:** `FX-09 conversion-complete`、`FX-10 conversion-degraded`、`FX-11 conversion-blocked`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] 转换保留源资产、资产列表和检查器上下文；
- [ ] 目标严格限制为一个 Agent 的一个项目或全局作用域；
- [ ] 目标重名时复用 `TargetNameCollision`：只能取消、改名，或审查现有目标与替换结果后再次确认；不得静默覆盖，也不改变 FX-17 的 FE-05 主归属；
- [ ] 映射报告区分 preserved、rewritten、missing、manualAction 和 blocking；
- [ ] 完整转换可进入差异审查；
- [ ] 降级转换明确风险并在用户确认后才进入审查；
- [ ] 阻断转换停留在映射报告，不产生可应用 prepared operation；
- [ ] 转换结果使用目标 Agent 原生格式，不暴露或持久化统一 DSL；
- [ ] 敏感引用只转换引用关系，不复制明文密钥；
- [ ] 相同输入与规则版本在 UI 中得到稳定可解释结果；
- [ ] 应用后目标是独立资产，不建立持续同步；
- [ ] 不使用 LLM，也不承诺跨 Agent 行为等价。

## 验证命令契约

**状态：** `planned / unverified`

- **统一入口：** `npm run verify:ticket -- FE-06`；这是实现后的计划命令，尚未运行。
- **前置条件：** FE-04 已有 `done` 证据；bootstrap、生成 wire 类型和 `FX-09`、`FX-10`、`FX-11` 的安全 fixture 可用；L3 使用专用 Tauri 测试构建、每次新建的隔离临时根与单一合成目标，不读取或修改真实 Agent 配置。
- **预计层级：** L0 检查变更源码、类型、格式、lint 与 wire/schema drift；L1 检查能力映射的稳定性、敏感引用不复制明文、重名处理，以及阻断结果不产生 prepared operation；L2 以 scripted mock `FrontendGateway` 跑 `FX-09/10/11`，分别证明完整转换进入审查、降级转换须确认、阻断转换停在报告；L3 只跑一次隔离临时目录中的完整单目标转换，经过 WebView/Core 的真实 command/event 边界；PF-06 记录合成 conversion-transaction descriptor 的 prepare、apply、恢复点/回滚测量及 fixture digest。
- **通过判据：** 各层只覆盖上述行为，完整、降级、阻断和重名分支均符合本票据；L3 仅在隔离目标上留下实际转换的 tracer 证据；PF-06 留存原始样本、运行环境与 baseline/预算冻结记录，出现 `inconclusive` 不得计通过。
- **失败证据：** 脱敏日志、WebDriver trace、截图或 DOM dump、层级与 fixture 标识写入 `.artifacts/verification/FE-06/<run-id>/`。
- **Provenance 边界：** L2 mock PASS 不取得真实 IPC 或写入 credit；L3 只证明该临时单目标路径，不证明生产 artifact、全部真实 adapter 或跨 Agent 行为等价；PF-06 数据不替代行为或发布证据。
