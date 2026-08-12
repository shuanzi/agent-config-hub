# FE-01 — 只读工作台主路径

**Acceptance state:** `Frozen (2026-08-10)`

**Ticket Status:** `done`（clean closure manifest 为 `accepted-with-waiver`；稳定证据索引：`.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json`）

**Direct blocker evidence:** FE-07R 已满足；其已验证 bootstrap、shared harness 与 actual-read snapshot 仅为 FE-01 上游输入，不计入 FE-01 closure credit。

**Primary contract fixture:** `FX-01 single-skill-ready`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§3–5、7、9；closure 只以稳定索引 `.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json` 为证据指针（本次 clean run `20260812T115759948Z-p90022-000`，commit `89b6ec2d8de62dd865e5ffb6af18d8eb08124c9e`）。

- [x] 可见一级导航仅为 Skills、长期指令、Subagents；首次进入固定为 Skills + `all`。Hook 不构成工作台或 locator 的可达目的地。
- [x] `workbench` 只消费 closed `AssetListQuery` 和同次权威 `WorkbenchActualReadSnapshot`。`WorkbenchFilters` 仅含四固定 Agent、opaque source ID、封闭 status 与仅 `all` 可用的 opaque project ID；集合内 OR、字段间 AND，去重并 canonical echo，空约束省略。`editable` 只命中 `editAsset`-specific `ActionAvailability=allowed` 且 `CompatibilityStatus=verifiedWritable`；export/delete/convert 等其他 operation 即使 allowed、但 edit disabled 也不得命中。未知字段、空 ID、非法 enum 或非法 `projectIds` 必须稳定 `ReadFailed`，不能静默降级。
- [x] 按“筛选 → 固定段序 → 段内稳定名称排序 → 扁平化 → 单一全局分页”呈现：`all` 为 global-applicable 后每个 project-native 段，`global` 仅 global 段及可检查 finding，`project(projectId)` 为该项目 native 段后仅 `resolved` global-applicability 段。unknown/blocked/stale 不得投影进 project；global 原生资产不得复制为项目资产。
- [x] 全局 locator 与 `⌘K` 共用同一 `globalLocator`；三类固定分组、count 和 authoritative order，不分页且不显示 Hook。trim、NFC、default case-fold 与只对 redacted summary 的 code-point 匹配不得读取敏感明文。
- [x] locator 打开/输入只有读取效果；提交时原子写入结果的 type、显式 `destinationViewContext`、`AssetRef` 与详情目的地，并把焦点交给详情主标题（失败则错误标题）。取消恢复 return focus，失效时唯一 fallback 是全局搜索按钮；搜索、选择或 failure 都不得创建草稿、`prepare`、`apply` 或写入。
- [x] Skills 详情显示四个固定 Agent 的权威 `SkillTargetState` 只读单元格；unknown/blocked/stale 维持 fail-closed 的状态与原因，不把它们伪装为即时开关。
- [x] loading、empty、stale 与 `ReadFailed` 保持可解释且可访问；敏感值在列表、摘要、路径提示、错误与无障碍文本中遮蔽。event 只使快照失效，随后必须 authoritative reread。
- [x] 只复用 FE-07R 已验证的 bootstrap、shared harness 与 actual-read snapshot；不得重建 resolver/foundation，也不得把 FE-07R provenance 借作 FE-01 closure credit。

## 验证命令契约

**状态：** 已闭合。`npm run verify:ticket -- FE-01` 的 clean run `20260812T115759948Z-p90022-000` 以 `accepted-with-waiver`、root exit `0` 结束；稳定指针为 `.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json`，而不是本次 run 目录。

**前置条件：** FE-07R 已 `done` 且留存其 actual-read evidence；其 shared harness、隔离 `FX-01` fixture 和测试构建可用，不得读取真实用户配置。

**证据分层与 waiver 边界：** FE-01 在自身 ticket 取得 L0、L1 list/selector、首个 L2 browser UI/read-session、L3 “start → read → event → authoritative reread” 与 PF-01 `catalog-browse` evidence；FE-07R 的 snapshot/provenance、fixture、文档或 Mock 不能替代其中任何 FE-01 closure credit。PF-01 仍是 L2 Vite dev/mock 与 L3 debug test-harness 的 development acceptance，不是 reference-Mac、release-like 或 production artifact evidence。其 automatic result 保持 `fail`/exit `1`、`samplingRun=false`；仅唯一 numeric latency violation 以 exact manual `accepted-with-waiver` disposition 闭合。

**通过与发布边界：** evidence 覆盖导航、canonical filters、段序、locator 原子目的地、只读 Skill cells、无 `prepare`/`apply` 与既有 failure paths；L2 mock 只证明 renderer journey，L3 只限隔离测试构建。此 exact waiver 不是 automatic PASS，不更新 clean automatic-pass index，且 `RELEASE-GATE` 仍为 `blocked`；发布仍需独立 reference/release environment 的复测和 production artifact evidence。

## FE-01 local performance debt（non-status record）

本地性能债务：`deferred / post-optimization`。仅绑定 FE-01 subject historical PF-01 run `20260812T035717854Z-p74069-000`（commit `9c91e042c39023d7a30fcc04fbd1d0e36985fdbf`）的唯一 numeric latency violation：`pf01.startup.first_list_visible` p50 `16.2ms` 超 frozen limit `15.75ms`，delta `0.45ms`。automatic result 保持 `fail`/exit `1`；显式 manual disposition 为 `accepted-with-waiver`，未知根因，不设 owner 或日期。此记录不构成 automatic PASS 或 release/reference evidence，不更新 `RELEASE-GATE`。
