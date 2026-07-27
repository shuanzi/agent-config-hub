# FE-01 — 只读工作台主路径

**What to build:** 用户能够在四类资产工作台中搜索、筛选、选择一个现有资产，并在原位查看其源码和关键状态。

**Blocked by:** 无（`ARCH-GATE` 已于 2026-07-27 关闭）

**Status:** ready-for-agent

**Primary contract fixtures:** `FX-01 single-skill-ready`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

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

## 验证命令契约

**状态：** `planned / unverified`。统一入口为 `npm run verify:ticket -- FE-01`；失败证据写入 `.artifacts/verification/FE-01/<run-id>/`。

**前置条件：** `ARCH-GATE` 已关闭；本票据的最小 bootstrap、`FX-01 single-skill-ready` 合成 fixture、隔离测试数据根和测试构建均已就绪。不得读取用户真实 Agent 配置。

**预计层级：**

- L0：本切片相关的静态、类型与生成产物一致性门禁；
- L1：`WorkspaceSession` 与 read 状态的 `FX-01` 契约断言；
- L2：以 scripted mock `FrontendGateway` 驱动 `FX-01` 的浏览器旅程；
- L3：专用 Tauri 测试构建在隔离 fixture 中执行“启动 → 一次真实 read → event 失效后重读”；
- PF-01：以 `catalog-browse` 合成 descriptor 记录启动、筛选、搜索和选择资产的首条 baseline，并在真实样本后冻结预算。

**通过判据：** 命令在上述前置条件下退出成功；FX-01 的可见状态、遮蔽、read-only 调用边界及无 `prepare`/`apply` 均成立；L3 记录真实 command/event 路径与 authoritative reread；PF-01 留存 fixture digest、运行环境和原始样本，数值预算只在实际校准后生效。

**Provenance 边界：** L2 的 mock 结果只证明 renderer 旅程，不取得实际 IPC、事件或磁盘 read credit；L3 只证明隔离测试构建，不等同生产签名、DMG 或 L4。未实际运行前，本命令和 PF-01 均保持 `planned / unverified`。
