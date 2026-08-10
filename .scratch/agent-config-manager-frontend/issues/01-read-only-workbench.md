# FE-01 — 只读工作台主路径

**Acceptance state:** `Frozen (2026-08-10; planning acceptance only)`

**Ticket Status:** `blocked`（不是 `done`；FE-07R 尚未 `done`，且无其 actual-read evidence）

**Blocked by:** FE-07R — 项目适用性与 actual-read projection 的已验证 bootstrap、shared harness 与 actual-read snapshot。

**Primary contract fixture:** `FX-01 single-skill-ready`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§3–5、7、9；本文件冻结计划验收，不声明 contract、wire、resolver、runtime 或 ticket 已实现。

- [ ] 可见一级导航仅为 Skills、长期指令、Subagents；首次进入固定为 Skills + `all`。Hook 不构成工作台或 locator 的可达目的地。
- [ ] `workbench` 只消费 closed `AssetListQuery` 和同次权威 `WorkbenchActualReadSnapshot`。`WorkbenchFilters` 仅含四固定 Agent、opaque source ID、封闭 status 与仅 `all` 可用的 opaque project ID；集合内 OR、字段间 AND，去重并 canonical echo，空约束省略。`editable` 只命中 `editAsset`-specific `ActionAvailability=allowed` 且 `CompatibilityStatus=verifiedWritable`；export/delete/convert 等其他 operation 即使 allowed、但 edit disabled 也不得命中。未知字段、空 ID、非法 enum 或非法 `projectIds` 必须稳定 `ReadFailed`，不能静默降级。
- [ ] 按“筛选 → 固定段序 → 段内稳定名称排序 → 扁平化 → 单一全局分页”呈现：`all` 为 global-applicable 后每个 project-native 段，`global` 仅 global 段及可检查 finding，`project(projectId)` 为该项目 native 段后仅 `resolved` global-applicability 段。unknown/blocked/stale 不得投影进 project；global 原生资产不得复制为项目资产。
- [ ] 全局 locator 与 `⌘K` 共用同一 `globalLocator`；三类固定分组、count 和 authoritative order，不分页且不显示 Hook。trim、NFC、default case-fold 与只对 redacted summary 的 code-point 匹配不得读取敏感明文。
- [ ] locator 打开/输入只有读取效果；提交时原子写入结果的 type、显式 `destinationViewContext`、`AssetRef` 与详情目的地，并把焦点交给详情主标题（失败则错误标题）。取消恢复 return focus，失效时唯一 fallback 是全局搜索按钮；搜索、选择或 failure 都不得创建草稿、`prepare`、`apply` 或写入。
- [ ] Skills 详情显示四个固定 Agent 的权威 `SkillTargetState` 只读单元格；unknown/blocked/stale 维持 fail-closed 的状态与原因，不把它们伪装为即时开关。
- [ ] loading、empty、stale 与 `ReadFailed` 保持可解释且可访问；敏感值在列表、摘要、路径提示、错误与无障碍文本中遮蔽。event 只使快照失效，随后必须 authoritative reread。
- [ ] 只复用 FE-07R 已验证的 bootstrap、shared harness 与 actual-read snapshot；不得重建 resolver/foundation，也不得把 FE-07R provenance 借作 FE-01 closure credit。

## 验证命令契约

**状态：** `planned / unverified`；不得在本 planning slice 运行 closure。计划统一入口为 `npm run verify:ticket -- FE-01`，失败时才由该未来运行写入 `.artifacts/verification/FE-01/<run-id>/`。

**计划前置条件：** FE-07R 已 `done` 且留存其 actual-read evidence；其 shared harness、隔离 `FX-01` fixture 和测试构建可用，不得读取真实用户配置。

**计划证据分层：** FE-01 必须在自身 ticket 以共享 harness 运行 L0、L1 list/selector（含 `editable` 的 edit-specific availability/compatibility 反例，以及列表、路径、错误和无障碍文本的遮蔽断言）、首个 L2 browser UI/read-session（断言同一四类可见文本均遮蔽）、L3 “start → read → event → authoritative reread”（断言隔离实际 read/event/reread 路径不泄露同一四类文本）与 PF-01 `catalog-browse`。PF-01 只在实际样本后冻结数值预算。

**计划通过与失败边界：** 未来证据应覆盖导航、canonical filters、段序、locator 原子目的地、只读 Skill cells 与无 `prepare`/`apply`；并在适用 L1/L2/L3 断言和通过判据中证明列表、路径、错误和无障碍文本均不含敏感明文。`ReadFailed`、empty/stale 和 event reread 是必须保留的 failure path。L2 mock 只证明 renderer journey；L3 只限隔离测试构建；FE-07R 的 snapshot/provenance、fixture、文档或 Mock 都不能替代 FE-01 自身 L0–L3/PF-01 closure。
