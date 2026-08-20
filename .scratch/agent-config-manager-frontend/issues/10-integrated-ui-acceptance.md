# FE-10 — FX-12 工作台可访问性集成旅程

**Acceptance state:** `Frozen (2026-08-10; planning acceptance only)`

**Ticket Status:** `ready-for-agent`（不是 `done`；已完成 task-only、non-closure functional slice，但尚未产生自身 formal closure evidence）

**Direct blocker evidence:** FE-02 已 `done`；其 final run `20260815T130239344Z-p33436-000` 的 accepted-with-waiver 记录见 `.artifacts/verification/FE-02/latest-clean-subject-accepted-with-waiver.json`。

**Primary contract fixture:** `FX-12 sensitive-narrow-keyboard`

**Source of truth:** `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md` §§4、6、7、9；本票据仅冻结只读 responsive/a11y 验收，不接管写入或真实 Adapter 回归。

- [ ] 宽/中屏保留三类 type-specific read surface；窄屏遵循 `type → scope → list → detail/edit` 单表面栈和原返回路径，但本票据只验证 read behaviour，不触发编辑、草稿、`prepare` 或 `apply`。
- [ ] 列表 presentation 严格为 `pageSize` 20/50/100（默认 20）、`nameSort` asc/desc 与单一全局分页。filter、type、scope、sort 或 page size 改变时原子 reset 至第 1 页；翻页滚至顶部并把焦点交给新页第一行；empty 时聚焦 empty-state heading。
- [ ] locator 对查询 trim，空查询给稳定提示；非空查询按 NFC、Unicode default case-fold 与 redacted 字段的 code-point substring 匹配。关闭未提交时恢复 return focus，失效时回到全局搜索按钮；destination 成功聚焦详情主标题，失败聚焦错误标题。locator 不读取敏感明文且不改变 query、草稿、transaction 或权限。
- [ ] 路径、contexts、来源/覆盖、兼容/漂移、最近变更、恢复点和关键安全状态可访问且可用键盘操作；辅助信息按 type-specific disclosure/就近状态条承载，不要求固定第四 inspector 或其栏宽、浮层、收拢和动效合同。
- [ ] Skills 四个固定 Agent 状态单元格有可读语义、键盘可达性和 stable reason；normal、read-only、incompatible、unknown/blocked/stale 与敏感遮蔽不能只依赖颜色。Hook 始终没有 MVP UI destination。
- [ ] sensitive `view` grant 必须 revision-bound 且短生命周期；grant 超时、资产切换或 revision 变化后立即失效并重新遮蔽，明文不得进入缓存、索引、事件、日志或 fixture。
- [ ] reduced-motion 一律直接切换到最终状态；正文、焦点与非文本对比度满足冻结的可访问性要求，非文字控件均有可访问名称。上述要求不恢复任何旧 inspector 布局参数。
- [ ] `ReadFailed`、empty、stale、遮蔽与 locator destination failure 都有稳定、可访问的 failure path；不以截图、mock 调用数或静态文件替代行为断言。
- [ ] 本票据不验收 FE-03–FE-09 的编辑、prepare/review/confirm/apply、转换、删除、恢复或任何真实 Adapter 行为。

## 验证命令契约

**Formal verification/closure 状态：** `planned / unverified`；不得在本 planning slice 运行 closure。计划统一入口为 `npm run verify:ticket -- FE-10`，未来失败证据路径为 `.artifacts/verification/FE-10/<run-id>/`。

**计划前置条件：** FE-02 已 `done` 且有其自身证据；bootstrap、`FX-12` fixture 和 browser-mode scripted mock `FrontendGateway` 可用，不启动 Tauri 测试构建。

**计划证据分层：** 只运行 L0（静态/类型/生成一致性）、L1（列表状态、焦点、locator、四 Agent 语义、`view` grant 失效/重新遮蔽、reduced-motion、对比度与控件名称）与 L2（宽/中/窄只读 `FX-12` browser journey，覆盖同一 grant/a11y 状态）。**无 L3、无 PF。**

**计划通过与 provenance 边界：** 未来 L2 必须证明真实 browser event 下的只读 focus/return、列表 reset、搜索遮蔽和 type-specific surface；mock PASS 不取得 IPC、磁盘、Keychain、Tauri lifecycle、写入、真实 Adapter、production artifact 或 L4 credit。Formal verification/closure 尚未运行，相关 formal 层级仍为 `planned / unverified`；这不否认下方单独记录的 task-only、non-closure L0/L1/L2 functional completion。

## 2026-08-20 task-only functional completion record

本记录只确认已完成 OpenSpec `3.13`–`3.16` 的 FE-10 功能切片：独立 L0/L1/L2 复验覆盖只读宽／中／窄、列表与 locator 焦点旅程、四 Agent cells、reduced-motion、frontend-local disclosure、以及独立的短生命周期 sensitive `view` grant 与重新遮蔽。该 grant 不复用 FE-03 `modify` scope、waiver、evidence 或 closure credit。

这是 **task-only、non-closure** 的 `functional complete` 记录：不改变本票据的 `Ticket Status: ready-for-agent`、Frozen acceptance、DAG、frontier、`done`、release gate 或 formal verification/closure。`3.17`、`3.18`、L3、PF 和 `npm run verify:ticket -- FE-10` 均未运行；未创建 `.artifacts`，也不取得 IPC、磁盘、真实 Adapter 或 production artifact credit。

本次 wire vectors 中仍有一条既有的 FX-01 `assetDetail` historical golden mismatch（revision/readSurface）；它未改写、未被当作 FE-10 通过或 closure evidence。其余适用 FE-10 wire/drift、L1 与 browser-mode scripted mock L2 检查已独立复验。
