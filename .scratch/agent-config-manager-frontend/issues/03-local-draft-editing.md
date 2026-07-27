# FE-03 — 本地草稿编辑

**What to build:** 用户能够从磁盘查看态显式进入一个单资产草稿，安全编辑、退出或放弃，并在离开资产前处理未应用更改。

**Blocked by:** FE-02 — 原生详情与多文件资产

**Status:** blocked

**Primary contract fixtures:** `FX-04 dirty-multifile-draft`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] 打开资产默认是磁盘内容查看态，编辑入口明确且带文字；
- [ ] 进入编辑后在文件或路径附近持续显示“本地草稿”；
- [ ] 草稿在同一资产的文件切换和源码/结构化视图之间保持一致；
- [ ] 无实际更改时“审查更改”可解释禁用，退出不弹确认；
- [ ] 存在更改时提供“放弃草稿”，并以“保留草稿”为安全默认；
- [ ] 切换资产、类型或离开工作区时复用 dirty guard，默认留在当前草稿；
- [ ] MVP 不保存多资产草稿池，同时只存在一个活动草稿；
- [ ] 编辑普通内容时，revision-bound 遮蔽段不进入可编辑源码且未触碰的敏感原文由 gateway 无损保留；修改敏感片段必须经显式、短生命周期 `modify` grant，grant 失效后重新遮蔽；
- [ ] 放弃只清除前端草稿，不调用 `apply` 或改变磁盘；
- [ ] 只读或不兼容资产的编辑入口禁用并显示稳定原因码；
- [ ] 旅程断言用户可见状态和 gateway 调用，不依赖编辑器内部实现。

## 验证命令契约

**状态：** `planned / unverified`。统一入口为 `npm run verify:ticket -- FE-03`；失败证据写入 `.artifacts/verification/FE-03/<run-id>/`。

**前置条件：** FE-02 已完成并留存其多文件 read 证据；`FX-04 dirty-multifile-draft` 与合成敏感段可在隔离测试数据根复现，且测试只覆盖本地草稿，不调用 `apply`。

**预计层级：**

- L0：本切片相关的静态、类型与生成产物一致性门禁；
- L1：活动草稿、dirty guard、grant 失效和放弃不写盘的 `FX-04` 契约断言；
- L2：以 scripted mock `FrontendGateway` 驱动 FX-04 的浏览器编辑旅程；
- L3：无；本票据不新增真实 Tauri tracer；
- PF-02/PF-03：以既有 `source-large` 与 `multifile-workbench` descriptor 校准编辑输入、草稿投影、文件切换和只读切换的首条 baseline。

**通过判据：** 命令在上述前置条件下退出成功；FX-04 的单活动草稿、保留优先 dirty guard、脱敏段/grant 边界、禁用原因和放弃不调用 `apply` 均成立；PF-02/PF-03 留存 fixture digest、运行环境和原始样本，数值预算只在实际校准后生效。

**Provenance 边界：** L1/L2 只证明 module 与 mock renderer 行为；没有 L3，因此本票据不取得实际 Tauri IPC、磁盘写入或生产 artifact credit。mock 的草稿/放弃结果不得表述为真实 write 已发生；未实际运行前，本命令与性能项均保持 `planned / unverified`。
