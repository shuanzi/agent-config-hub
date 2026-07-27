# FE-06 — 跨 Agent 转换

**What to build:** 用户能够对一个源资产选择一个目标 Agent 和作用域，理解能力映射，并只在转换可安全应用时进入差异与事务闭环。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** blocked

**Primary contract fixtures:** `FX-09 conversion-complete`、`FX-10 conversion-degraded`、`FX-11 conversion-blocked`

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
