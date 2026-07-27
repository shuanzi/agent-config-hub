# FE-05 — 创建、本地导入与单目标安装

**What to build:** 用户能够在当前资产类型工作区内新建、从本地导入，或把已选原生资产安装到一个同格式目标，并复用草稿、审查和安全应用闭环。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** blocked

**Primary contract fixtures:** `FX-08 create-import-validation`、`FX-15 install-single-target`、`FX-17 target-name-collision`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] “新建”与“从本地导入”同位并列可见，不合并成二次选择入口；
- [ ] 流程保留当前资产类型、资产列表和工作区上下文；
- [ ] 新建明确目标 Agent、项目或全局作用域及原生位置；
- [ ] 导入通过不透明本地来源引用选择文件、目录或受支持配置片段；
- [ ] 前端不读取、执行或猜测导入来源内容；
- [ ] 目标或来源无效时提供稳定阻断原因和恢复动作；
- [ ] 目标已存在或同名冲突时只允许取消、改名，或先审查目标差异后明确确认覆盖；不得静默覆盖；
- [ ] 目标设置完成后形成单资产草稿并复用 `prepare`/`apply`；
- [ ] 同格式安装（`installAsset` 行为）始终是一个资产到一个已选 Agent、作用域和原生位置的目标；它复用当前格式的安装/导入草稿与 `prepare`/`apply`，不转换内容。跨 Agent 转换仍只由 FE-06 的 `convertAsset`、能力映射和目标格式生成处理；两者不得混为一条一对多流程；
- [ ] 取消流程不创建目标资产、来源关系或恢复点；
- [ ] 应用后目标成为独立原生资产，不保持自动同步；
- [ ] 不引入全屏向导、中央模板库或产品私有资产格式。

## 验证命令契约

**状态：** `planned / unverified`。统一入口为 `npm run verify:ticket -- FE-05`；失败证据写入 `.artifacts/verification/FE-05/<run-id>/`。

**前置条件：** FE-04 已完成并留存审查/安全应用证据；`FX-08 create-import-validation`、`FX-15 install-single-target`、`FX-17 target-name-collision` 与不透明合成来源引用可在隔离测试数据根复现；L3 使用专用 Tauri 测试构建和每次新建的临时来源/目标根。不得读取、执行或猜测用户来源内容，也不得访问用户配置。

**预计层级：**

- L0：本切片相关的静态、类型与生成产物一致性门禁；
- L1：新建、导入来源引用、单目标 `installAsset`、取消和重名冲突的 FX-08/FX-15/FX-17 契约断言；
- L2：以 scripted mock `FrontendGateway` 驱动三项 fixture 的浏览器旅程；
- L3：专用 Tauri 测试构建在隔离临时根执行新建、导入、单目标安装与目标重名不覆盖 tracer；
- PF：无新增 performance fixture 或 baseline；本票据不因复用 FE-04 的 `prepare`/`apply` 而取得新的性能 credit。

**通过判据：** 命令在上述前置条件下退出成功；三项 fixture 的并列入口、上下文保留、不透明来源、稳定阻断、单目标同格式安装、取消无副作用和重名时无静默覆盖均符合票据；L3 留存隔离临时根中的 command/event 与文件事实；跨 Agent 转换仍不进入该票据。

**Provenance 边界：** L1/L2 只证明 module 与 mock renderer 的创建、导入和安装行为；实际 IPC/read/write credit 仅来自 L3，且只限隔离临时来源与目标。L3 不等同生产 artifact、真实用户配置或 L4；未实际运行前，本命令保持 `planned / unverified`。
