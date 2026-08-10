# FE-02 — 原生详情与多文件资产

**Acceptance state:** `Frozen (2026-08-10; planning acceptance only)`

**Ticket Status:** `blocked`（不是 `done`；等待 FE-01 的 `done` 与 provenance-appropriate evidence）

**Blocked by:** FE-01 — 只读工作台主路径。

**Primary contract fixtures:** `FX-02 multifile-skill-mixed`、`FX-03 executable-hook-unknown`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§3、6–9；本文件只冻结计划验收，不包含编辑或写入实现。

- [ ] Skills 以只读结构化详情呈现身份、来源、兼容与四 Agent 状态；原生内容只经明确次级源码查看进入。多文件资产显示 native file tree、主文件优先的稳定选择与只读文本/非文本 surface，不把物理文件提升为资产。
- [ ] 长期指令提供 type-specific master-detail Markdown read surface；选择或聚焦不会创建草稿、`prepare`、`apply` 或其他写入意图。
- [ ] Subagents 以只读 master-detail 呈现身份、模型、工具、权限、来源与正文；未知、扩展或不兼容内容如实保真或只读，并给稳定原因。
- [ ] 路径、生效上下文、来源/覆盖、兼容/漂移、最近变更、恢复点与关键安全状态均可达；仅使用各类型的详情 disclosure/就近状态条，不恢复固定第四 inspector 或其布局合同。
- [ ] `FX-03` 仍必须能在 Adapter/wire decode `hook`、保留 unknown fields、报告 `EXECUTABLE_CONTENT_RISK`，并在默认 surface、搜索、事件、日志和 fixture 中 mask 敏感值。Hook、Skill script 与 plugin code 只能静态展示/校验，绝不执行。
- [ ] Hook 是 L2 负向可达性：不出现在 MVP 一级导航、global locator、创建入口、详情或转换目的地；没有 Hook 的浏览、编辑、转换正向 journey，也没有 Hook L3 write/PF credit。
- [ ] 结构化或 native read 无法无损呈现、未知/非文本内容、遮蔽内容和 `ReadFailed` 必须保留只读/原因 failure path；不得解析实现内部结构或用 mock 结果冒充实际读取。

## 验证命令契约

**状态：** `planned / unverified`；不得在本 planning slice 运行 closure。计划统一入口为 `npm run verify:ticket -- FE-02`，未来失败证据路径为 `.artifacts/verification/FE-02/<run-id>/`。

**计划前置条件：** FE-01 已 `done` 且有其自身证据；`FX-02`、`FX-03` 与敏感占位变体在隔离测试数据根可复现，绝不读取或执行用户内容。

**计划证据分层：** L0/L1 覆盖 type-specific read、multi-file read 与 FX-03 contract/security；L2 覆盖三类只读详情与 Hook UI 不可达；L3 只做隔离 fixture 的 actual multi-file read；PF-02 `source-large` 与 PF-03 `multifile-workbench` 只记录 read surface 的原始样本并在实际校准后冻结预算。

**计划通过与失败边界：** 未来验证必须保留 decode/unknown/risk/masking/no-execution、read-only fallback 与 `ReadFailed`。L2 mock 不取得 IPC 或磁盘 read credit；L3 只证明隔离多文件 read，明确没有 L3 write、编辑或 production artifact/L4 credit；尚未运行前所有层级和 PF 均为 `planned / unverified`。
