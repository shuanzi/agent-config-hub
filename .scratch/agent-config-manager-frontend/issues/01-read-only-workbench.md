# FE-01 — 只读工作台主路径

**What to build:** 用户能够在四类资产工作台中搜索、筛选、选择一个现有资产，并在原位查看其源码和关键状态。

**Blocked by:** `ARCH-GATE`

**Status:** blocked

**Primary contract fixtures:** `FX-01 single-skill-ready`

- [ ] 一级导航只包含 Skills、长期指令、Subagents、Hooks，Agent 与项目只作为维度；
- [ ] 搜索可显式选择当前资产类型或全部资产，并与已确认筛选共同约束结果；
- [ ] 资产列表使用两行信息结构，展示名称、关键异常、Agent、作用域及项目或路径提示；
- [ ] 同一原生资产不会因多个上下文可见而重复；
- [ ] 选择资产后，详情在同一工作区原位更新并默认显示磁盘源码；
- [ ] FX-01 的合成敏感源码变体在列表、源码片段、路径提示、错误说明与无障碍文本中默认遮蔽明文；只读浏览不得调用 `SensitiveRevealQuery` 或泄露到测试输出；
- [ ] loading、empty、stale 和 failed 均有不同、可解释的用户状态；failed 只根据 `ReadFailed` 的稳定原因码和恢复动作呈现，不解析异常字符串；
- [ ] stale 状态显示最近更新时间，且不会把索引结果提升为写入依据；
- [ ] 旅程测试只调用 `read`，没有 `prepare` 或 `apply`；
- [ ] 没有新增首页、Agent 工作台或项目工作台。
