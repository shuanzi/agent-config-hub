## 1. 在生产实现前建立、冻结并编排正式真相链

- [x] 1.1 新建产品决策基线 v0.2 draft，不覆盖已验收 v0.1；更新 MVP 可见类型、项目适用性、Skill 状态、类型表面、24 条转换路径及 PD-UI-B2-01～10 的索引和替代关系。
- [x] 1.2 独立复核产品决策基线 v0.2 draft、记录用户验收并冻结；不得以本 change、Mock 或文档自验收替代冻结记录。
- [x] 1.3 仅以冻结的产品基线 fingerprint 新建前端契约 v0.2，并写入 metadata；承接 D3 之外的列表控件、默认、焦点和搜索呈现细化。
- [x] 1.4 在前端契约 v0.2 定义 `AssetListQuery`、`EffectiveContext`、`AssetRef`、精确 view context 段序、只读 actual read snapshot、Skill target state、`editAsset` 映射和转换边界。
- [x] 1.5 在前端契约 v0.2 保留 FX-03 的 Adapter／wire decode、未知字段、`EXECUTABLE_CONTENT_RISK`、敏感遮蔽和 no-execution contract/security 覆盖，并标为 Hook UI 不可达负例。
- [x] 1.6 在前端契约 v0.2 的 fixture catalog 与 coverage matrix 中计划 FX-19 `project-applicability-projection`，并在该契约冻结时确认其由 FE-07R 主归属；逐票据登记适用的 L0／L1／L2／L3／PF 与 contract/security 证据责任，不为所有票据固定分配 L2；其中 FE-07R=`L0／L1／L3 actual-read；无 L2／PF`。
- [x] 1.7 独立复核前端契约 v0.2、记录用户验收并冻结；未冻结前不得进入技术方案影响复核。
- [x] 1.8 在 v0.2 产品和前端契约均冻结后，创建带日期的技术方案影响复核或 addendum，限定于新 query／projection、wire、ticket 编排和证据 seam；明确登记方案 B 内采用基础设施归属 A 的 ownership transfer、FE-07R 计划 evidence registry row，以及调整为“复用 FE-07R foundation 但保留自身 L0／L1／L2／L3／PF-01 证据”的 FE-01 计划 evidence registry row，不静默改写 v0.1 的已验收架构结论。
- [x] 1.9 根据 1.8 的复核结果决定 ARCH-GATE 是否维持、重开或进入新的待决状态；不得预设其必然保持 closed。
- [x] 1.10 创建并独立冻结 FE-07R acceptance：只读 opaque `projectId`、active Adapter／rule provenance、resolved／unknown／blocked／stale fail-closed、All／Global／Project actual read projection，以及自身 closure 所需的最小 Tauri test-harness／bootstrap、L0–L3 骨架、计划的 `verify:ticket` validation command contract 和只读 AdapterRegistry seam；只跑 L0／L1／L3 actual-read，无 L2 UI 或 PF，明确不含业务写入、项目纳入、停止管理、index lifecycle、prepare／apply 或 UI。
- [x] 1.11 在实施前实际在 tracker 新增 FE-07R，并更新 FE-07R tracker row、ticket DAG、README、RELEASE-GATE 等规划 artifacts：新增 FE-07R row，并将 FE-01 row 调整为复用 FE-07R foundation 但保留自身 L0／L1／L2／L3／PF-01 证据；冻结 `verify:ticket` 的计划 validation command contract；仅新增 FE-07R → FE-01，保留 FE-01 → FE-02 → FE-03 → FE-04、FE-02 → FE-10、FE-04 → FE-05／FE-06／FE-07／FE-08／FE-09、全部 done → RELEASE-GATE；不增加 FE-07M、FE-08 → FE-06 或 FE-06 → FE-10。本阶段不得预先实现可执行 `TICKET_REGISTRY` 或修改 `manifest.json`：前者由 2.3 创建／调整，后者只在 2.5 命令运行时动态生成。此更新不得从文档推断 ready／done，状态只能由 gate／blocker evidence 决定。
- [x] 1.12 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-01 acceptance：三类可见导航、all／global／project 精确段序、复用 FE-07R 已验证 bootstrap／shared harness／actual-read snapshot、首个工作台 L2/browser UI/read-session、搜索无写副作用和只读 Skill 四 Agent cells；FE-01 仍须在自身 ticket 内以共享 harness 运行 L0／L1／L2／L3 start／read／event／reread 与 PF-01，FE-07R provenance 不可借用为 closure credit；不重建 resolver／foundation。
- [x] 1.13 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-02 acceptance：类型特定只读详情、Skill／Subagent／长期指令 read surfaces、Hook UI 不可达及 FX-03 contract/security no-execution，并保留 L3 actual multi-file read 与 PF-02／PF-03 read；明确无 L3 write，不包含编辑。
- [x] 1.14 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-03 acceptance：三类 `editAsset` 草稿、长期指令首次实际变更建草稿、dirty guard、未知内容保真／只读，以及 L0／L1／L2 与 PF-02／PF-03 edit evidence；明确无 L3，且不得取得 actual Tauri IPC／磁盘写入 credit；不包含 apply。
- [x] 1.15 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-04 acceptance：prepare／review／confirm／apply、target 参数变更失效并重新 prepare／review、项目视图全局 `AssetRef` 原生写回、受影响 contexts、无项目副本、native disable `editAsset` 或 disabled 且绝不 delete fallback，以及 L0／L1／L2、L3 isolated temp prepare／apply／conflict／recovery 与 PF-04 evidence。
- [x] 1.16 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-05 acceptance：长期指令独立 create／import、Skill toggle 同格式 install、完整 target scope／location／summary、独立结果与 reread，以及 L0／L1／L2、L3 isolated temp create／import／install collision evidence；不包含 convert；无新增 PF。
- [x] 1.17 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-06 acceptance：Skill toggle convert、Subagent 次级 convert、24 条路径、Prompt／未知内容 round-trip 或 blocked、raw-copy 拒绝、no-sync 与 reread，以及 L0／L1／L2、L3 isolated temp single-target conversion 与 PF-06 evidence。
- [x] 1.18 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-07 acceptance：项目纳入、停止管理、index freshness／event／rebuild，复用 FE-07R projection types 而不夺取 FX-19 主归属，以及 L0／L1／L2、L3 isolated temp project／event／rebuild 与 PF-05 evidence。
- [x] 1.19 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-08 acceptance：Adapter registry／bundle、active version／rule／capability update／rollback、L0／L1／L2、L3 synthetic candidate／switch／rollback 与 PF-07 evidence；不得称为真实 Adapter bundle actual provenance，且不实现 Skill cell UI。
- [x] 1.20 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-09 acceptance：独立 export／delete／recover，toggle 永不回落 delete 与受影响 contexts 验证，以及 L0／L1／L2、L3 isolated temp export／delete／recover collision 与 PF-06 recovery evidence；不把 delete 归入 FE-04。
- [x] 1.21 在任何 contract/wire/code/UI 的生产实现前，逐项更新并冻结 FE-10 acceptance：只读宽／中／窄、精确列表控件／焦点／搜索呈现和四 Agent 状态可访问性；只运行 L0／L1／L2，明确无 L3、无 PF，且不得验收 FE-03～FE-09 的写入行为。
- [x] 1.22 在 1.10～1.21 完成后，按 1.9 的实际 gate 结果重算 tracker frontier、direct blockers 和 blocker evidence；不得从 Mock 或文档完成推断 ticket ready／done。
- [x] 1.23 实施停点：只有 ARCH-GATE 实际为 `closed`，且当前 slice 的目标 ticket 按更新后的 acceptance 位于重算的 `ready-for-agent` frontier，且全部 direct blockers=done 并具 evidence，才可按实际 DAG 分批执行 sections 2～4；否则记录 blocker 并停止该 slice。

## 2. FE-07R 的只读项目投影垂直 slice

### FE-07R：项目适用性与 actual read projection

- [x] 2.1 重新读取并验证 ARCH-GATE=`closed`、FE-07R=`ready-for-agent` 和全部 direct blockers=done 且有 evidence；任一不满足，记录 blocker 并停止 FE-07R slice。
- [x] 2.2 在 FE-07R 内完成最小 read-only contract／domain／Rust-first wire delta：opaque `projectId`、active Adapter／rule provenance、resolved／unknown／blocked／stale fail-closed、All／Global／Project projection，以及读取 built-in／active Adapter／rule provenance 的只读 AdapterRegistry seam；确认 FX-19 主归属，不加入业务写入、项目纳入、停止管理、index lifecycle、prepare／apply 或 UI。
- [x] 2.3 在 FE-07R 内建立完成自身 closure 所需的最小 Tauri test-harness／bootstrap、L0–L3 分层验证骨架，并创建／调整可执行 `TICKET_REGISTRY`／`verify:ticket` orchestration entry；将 evidence manifest metadata 改为 ticket／registry-driven：steps、fixture digests、PF descriptors／budgets 与 artifact identity 均按 ticket 配置，禁止硬编码 FE-01／FX-01／PF-01；从 Rust 生成 TypeScript wire、正负 vectors 与 drift 断言，并只实现 read-only resolver、actual read snapshot 和相应 Adapter／Gateway 投影。该 foundation 可供 FE-01 后续消费和扩展。
- [x] 2.4 在 FE-07R 内仅执行 L0／L1／L3 actual-read evidence；不增加 L2 UI journey、PF、业务写入、项目／index lifecycle 或 prepare／apply。
- [x] 2.5 在 FE-07R 内实际运行 `npm run verify:ticket -- FE-07R`，动态生成 evidence `manifest.json`，并断言该 FE-07R manifest 的 scope／steps 仅匹配 L0／L1／L3 actual-read、使用 FX-19 digest，且不含 PF step、PF descriptor 或 PF budget metadata；保留命令、层级、运行标识和未覆盖边界。
- [x] 2.6 对 FE-07R 进行独立只读复审；只有 2.1～2.5 的证据满足更新后 acceptance，才标记 FE-07R done 并更新 frontier 以解锁 FE-01。

## 3. FE-01、FE-02、FE-10、FE-03 与 FE-04 的垂直 slices

**方案 A 对当前未勾选 ticket 的人工编排。** 每个 ticket 先完成最小功能实现、L0/L1、必要 L2 与真实产品安全负例；经独立功能复验后，才可人工报告 `functional complete`。该报告不是新 verifier 状态、命令或 enforcement，不改变任何 formal ticket status、DAG、frontier、done、release gate 或 closure。

在其他仍有效的 architecture/产品安全前提满足时，上游 ticket 的人工 `functional complete` 可使直接下游的**产品功能开发**获得人工排期资格，即使上游仍 hardening pending、未 done 或未 formal closure；下游的 formal ticket verification/closure 仍以当前 formal direct blocker=done 且具 evidence 为前置，开发开工不得报告为 ready/done/closure。随后再完成每票既有且适用的 PF/performance/stress/platform/低概率 hardening；它们不删除、不冒充通过，任何 fail/inconclusive 仍阻止该票 formal closure。本次不报告 FE-03 `functional complete`，不授予 FE-03→FE-04 的资格，也不启动或推进 FE-04/FE-10。

对 sections 3–4 的当前未勾选任务，这一 manual implementation eligibility 仅构成“产品功能开发能否开工”对 1.23 的窄例外；1.23 对 formal ticket、verification 与 closure 的 stop 条件仍完整有效。它不修改 1.23、本轮也不授予 FE-03→FE-04 eligibility。

### FE-01：只读工作台与 FE-07R snapshot 消费

- [x] 3.1 重新读取并验证 ARCH-GATE=`closed`、FE-01=`ready-for-agent` 和 direct blocker FE-07R=done 且有 actual evidence；任一不满足，记录 blocker 并停止 FE-01 slice。
- [x] 3.2 在 FE-01 内完成最小 contract／domain／Rust-first wire delta，复用 FE-07R 已验证 bootstrap、shared harness 与 actual read snapshot，定义三类导航、all／global／project 精确段序、稳定排序、扁平化、全局分页、搜索无写副作用和只读 Skill 四 Agent cells；不得重做 resolver 或 foundation，或接受 Mock／injected projection 替代 closure。
- [x] 3.3 在 FE-01 内使用共享 harness 生成或复验 TypeScript wire、vectors 与 drift 断言，并实现首个工作台 L2/browser UI/read-session、只读导航、列表投影、搜索定位和 Skill cell read surface。
- [x] 3.4 在 FE-01 内以共享 harness 运行自身 L0／L1 list／selector、首个 L2 browser UI/read-session journey、FE-01-specific L3 actual start／read／event／reread 与 PF-01；FE-07R snapshot 仅作上游输入，provenance 不可借用为 FE-01 closure credit。不得重做 resolver／foundation、编辑、prepare 或 apply。
- [x] 3.5 在 FE-01 内运行 `npm run verify:ticket -- FE-01`，保留命令、层级、运行标识和未覆盖边界。
- [x] 3.6 对 FE-01 进行独立只读复审；只有 3.1～3.5 的证据满足 acceptance，才标记 FE-01 done 并更新 frontier。

### FE-02：类型特定只读详情与 Hook 负向边界

- [x] 3.7 重新读取并验证：仅当 ARCH-GATE=`closed`、FE-02 正式 Ticket Status=`ready-for-agent` 和 direct blocker FE-01=done 且有 evidence，才可开始 FE-02 slice；task-only 功能检查点不得替代上述正式状态、gate 或 direct blocker evidence。任一不满足，记录 blocker 并停止 FE-02 slice。
- [x] 3.8 在 FE-02 内完成最小 contract／domain／Rust-first wire delta，定义 Skill／Subagent／长期指令的只读 read surfaces、Hook UI 不可达及 FX-03 decode／未知字段／风险／遮蔽／no-execution 边界；不增加编辑。
- [x] 3.9 在 FE-02 内生成或复验 TypeScript wire、vectors 与 drift，并实现类型特定只读详情和相应安全 finding 表面。
- [x] 3.10 在 FE-02 内只执行 L0／L1 read／contract-security、L2 只读详情与 Hook 不可达、L3 actual multi-file read；明确无 L3 write，且不得以 Mock 代替所需 closure 证据。上述功能检查完成仅可记录为 non-closure 的 task-only `functional checks complete`，不得标记 done、更新 frontier 或替代正式 gate／direct blocker evidence。
- [x] 3.11 仅在 FE-02 自身授权建立的 registry entry 已存在且 3.10 已记录 `functional checks complete` 后，先运行 PF-02／PF-03 read evidence，再运行 `npm run verify:ticket -- FE-02`；保留命令、层级、运行标识和未覆盖边界。PF fail／inconclusive 或正式 closure 失败均阻止 FE-02 done。
- [x] 3.12 对 FE-02 进行独立只读复审；任何功能、PF 或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、PF、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 FE-03 与 FE-10 frontier；只有全部证据满足 acceptance，才可标记 FE-02 done 并更新该 frontier。

### FE-10：只读响应式和可访问性表面

- [ ] 3.13 重新读取并验证 ARCH-GATE、FE-10 正式 Ticket Status 与 direct blocker FE-02=done/evidence；它们仍是 FE-10 formal ticket verification/closure 的前置。若 FE-02 已经独立功能复验并人工记录 `functional complete`，只能按本节人工排期 FE-10 产品功能开发，不得把它记为 FE-10 ready/done/closure；本次不据此启动或推进 FE-10。任一所需 formal 条件不满足时，记录相应 blocker 并停止 formal 活动。
- [ ] 3.14 在 FE-10 内完成只读宽／中／窄、精确列表控件／焦点／搜索呈现和四 Agent 状态可访问性的最小 contract／domain／Rust-first wire delta；不得引入 FE-03～FE-09 的写入行为。
- [ ] 3.15 在 FE-10 内生成或复验 TypeScript wire、vectors 与 drift，并实现响应式只读 UI、焦点旅程和语义状态。
- [ ] 3.16 在 FE-10 内只执行 L0／L1 可访问性／状态测试和 L2 响应式 journey；明确无 L3、无 PF。上述功能检查经独立复验后，才可人工记录为 non-closure 的 task-only `functional complete`，可按本节成为下游产品功能开发的人工排期输入，但不得标记 FE-10 done、更新 frontier 或替代正式 gate/direct-blocker evidence。
- [ ] 3.17 仅在 FE-10 自身授权建立的 registry entry 已存在、3.16 已人工记录 `functional complete` 且当前 formal direct blockers 仍满足后，按冻结 acceptance（无 PF）运行 `npm run verify:ticket -- FE-10`；保留命令、层级、运行标识和未覆盖边界。正式 closure 失败阻止 FE-10 done。
- [ ] 3.18 对 FE-10 进行独立只读复审；任何功能或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 frontier；只有全部证据满足 acceptance，才可标记 FE-10 done 并更新 frontier。

### FE-03：三类编辑草稿与 dirty guard

- [ ] 3.19 重新读取并验证 ARCH-GATE、FE-03 正式 Ticket Status 与 direct blocker FE-02=done/evidence；它们仍是 FE-03 formal ticket verification/closure 的前置。若 FE-02 已经独立功能复验并人工记录 `functional complete`，只能按本节人工排期 FE-03 产品功能开发，不得把它记为 FE-03 ready/done/closure；本次不据此启动或推进 FE-03。任一所需 formal 条件不满足时，记录相应 blocker 并停止 formal 活动。
- [ ] 3.20 在 FE-03 内完成三类 `editAsset` 草稿、长期指令首次实际变更建草稿、dirty guard、未知内容保真／只读的最小 contract／domain／Rust-first wire delta；不纳入 apply 或 L3。
- [ ] 3.21 在 FE-03 内生成或复验 TypeScript wire、vectors 与 drift，并实现共享草稿状态与类型特定编辑表面。
- [ ] 3.22 在 FE-03 内只执行 L0／L1 草稿／保真／dirty guard 与 L2 编辑 journey；明确无 L3，且不得取得 actual Tauri IPC／磁盘写入 credit。上述功能检查经独立复验后，才可人工记录为 non-closure 的 task-only `functional complete`，可按本节成为 FE-04 产品功能开发的人工排期输入，但不得标记 FE-03 done、更新 frontier 或替代正式 gate/direct-blocker evidence。
- [ ] 3.23 仅在 FE-03 自身授权建立的 registry entry 已存在、3.22 已人工记录 `functional complete` 且当前 formal direct blockers 仍满足后，先在后置阶段运行 PF-02／PF-03 edit evidence 和其他适用 hardening，再运行 `npm run verify:ticket -- FE-03`；保留命令、层级、运行标识和未覆盖边界。PF/hardening fail／inconclusive 或正式 closure 失败均阻止 FE-03 done。
- [ ] 3.24 对 FE-03 进行独立只读复审；任何功能、PF 或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、PF、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 frontier；只有全部证据满足 acceptance，才可标记 FE-03 done 并更新 frontier。

### FE-04：共享安全写入与项目投影原生写回

- [ ] 3.25 重新读取并验证 ARCH-GATE、FE-04 正式 Ticket Status 与 direct blocker FE-03=done/evidence；它们仍是 FE-04 formal ticket verification/closure 的前置。只有未来 FE-03 独立功能复验并人工记录 `functional complete` 后，FE-04 产品功能开发才可按本节人工排期，即使 FE-03 hardening pending、未 done 或未 formal closure；这不使 FE-04 ready/done/closed，本次不授予该资格或启动/推进 FE-04。任一所需 formal 条件不满足时，记录相应 blocker 并停止 formal 活动。
- [ ] 3.26 在 FE-04 内完成 prepare／review／confirm／apply、target 参数变更失效并重新 prepare／review、项目视图全局 `AssetRef` 原生写回、受影响 contexts、无项目副本和 native disable `editAsset`／disabled 的最小 contract／domain／Rust-first wire delta；不得把 delete 归入 FE-04 或回落为 delete。
- [ ] 3.27 在 FE-04 内生成 TypeScript wire、vectors 与 drift，并实现共享事务、revalidation、全局原生写回和 native disable 解析。
- [ ] 3.28 在 FE-04 内只执行 L0／L1 事务／重验、L2 review-confirm journey、L3 isolated temp prepare／apply／conflict／recovery；actual runtime credit 仅来自该隔离输入穿过真实 WebView／Core／IPC 边界，不证明真实用户项目、配置或生产 artifact。上述功能检查经独立复验后，才可人工记录为 non-closure 的 task-only `functional complete`，可按本节成为下游产品功能开发的人工排期输入，但不得标记 FE-04 done、更新 frontier 或替代正式 gate/direct-blocker evidence。
- [ ] 3.29 仅在 FE-04 自身授权建立的 registry entry 已存在、3.28 已人工记录 `functional complete` 且当前 formal direct blockers 仍满足后，先在后置阶段运行 PF-04 evidence 和其他适用 hardening，再运行 `npm run verify:ticket -- FE-04`；保留命令、层级、运行标识和未覆盖边界。PF/hardening fail／inconclusive 或正式 closure 失败均阻止 FE-04 done。
- [ ] 3.30 对 FE-04 进行独立只读复审；任何功能、PF 或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、PF、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 FE-05～FE-09 frontier；只有全部证据满足 acceptance，才可标记 FE-04 done 并更新该 frontier。

## 4. FE-05、FE-06、FE-07、FE-08 与 FE-09 的垂直 slices

### FE-05：独立创建／导入与同格式安装

- [ ] 4.1 重新读取并验证 ARCH-GATE、FE-05 正式 Ticket Status 与 direct blocker FE-04=done/evidence；它们仍是 FE-05 formal ticket verification/closure 的前置。若 FE-04 已经独立功能复验并人工记录 `functional complete`，只能按本节人工排期 FE-05 产品功能开发，不得把它记为 FE-05 ready/done/closure。任一所需 formal 条件不满足时，记录相应 blocker 并停止 formal 活动。
- [ ] 4.2 在 FE-05 内完成长期指令独立 create／import、Skill toggle 同格式 install、完整 target scope／native location／summary、独立结果与 reread 的最小 contract／domain／Rust-first wire delta；不包含 convert。
- [ ] 4.3 在 FE-05 内生成 TypeScript wire、vectors 与 drift，并实现 create／import、同格式 install 和结果 reread。
- [ ] 4.4 在 FE-05 内只执行 L0／L1 operation mapping、L2 target-summary journey 与 L3 isolated temp create／import／install collision；无新增 PF。actual runtime credit 仅来自该隔离输入穿过真实 WebView／Core／IPC 边界，不证明真实用户项目、配置或生产 artifact。上述功能检查经独立复验后，才可人工记录为 non-closure 的 task-only `functional complete`，可按本节成为下游产品功能开发的人工排期输入，但不得标记 FE-05 done、更新 frontier 或替代正式 gate/direct-blocker evidence。
- [ ] 4.5 仅在 FE-05 自身授权建立的 registry entry 已存在、4.4 已人工记录 `functional complete` 且当前 formal direct blockers 仍满足后，按冻结 acceptance（无新增 PF）运行 `npm run verify:ticket -- FE-05`；保留命令、层级、运行标识和未覆盖边界。正式 closure 失败阻止 FE-05 done。
- [ ] 4.6 对 FE-05 进行独立只读复审；任何功能或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 frontier；只有全部证据满足 acceptance，才可标记 FE-05 done 并更新 frontier。

### FE-06：确定性转换

- [ ] 4.7 重新读取并验证 ARCH-GATE、FE-06 正式 Ticket Status 与 direct blocker FE-04=done/evidence；它们仍是 FE-06 formal ticket verification/closure 的前置。若 FE-04 已经独立功能复验并人工记录 `functional complete`，只能按本节人工排期 FE-06 产品功能开发，不得把它记为 FE-06 ready/done/closure。任一所需 formal 条件不满足时，记录相应 blocker 并停止 formal 活动。
- [ ] 4.8 在 FE-06 内完成 Skill toggle convert、Subagent 次级 convert、24 条路径、Prompt／未知内容 round-trip 或 blocked、raw-copy 拒绝、no-sync 与 reread 的最小 contract／domain／Rust-first wire delta。
- [ ] 4.9 在 FE-06 内生成 TypeScript wire、vectors 与 drift，并实现单资产转换、保真检查、blocked 结果和独立目标资产。
- [ ] 4.10 在 FE-06 内只执行 L0／L1 conversion matrix／raw-copy、L2 转换 journey、L3 isolated temp single-target conversion；actual runtime credit 仅来自该隔离输入穿过真实 WebView／Core／IPC 边界，不证明真实用户项目、配置或生产 artifact。上述功能检查经独立复验后，才可人工记录为 non-closure 的 task-only `functional complete`，可按本节成为下游产品功能开发的人工排期输入，但不得标记 FE-06 done、更新 frontier 或替代正式 gate/direct-blocker evidence。
- [ ] 4.11 仅在 FE-06 自身授权建立的 registry entry 已存在、4.10 已人工记录 `functional complete` 且当前 formal direct blockers 仍满足后，先在后置阶段运行 PF-06 evidence 和其他适用 hardening，再运行 `npm run verify:ticket -- FE-06`；保留命令、层级、运行标识和未覆盖边界。PF/hardening fail／inconclusive 或正式 closure 失败均阻止 FE-06 done。
- [ ] 4.12 对 FE-06 进行独立只读复审；任何功能、PF 或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、PF、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 frontier；只有全部证据满足 acceptance，才可标记 FE-06 done 并更新 frontier。

### FE-07：项目纳入、停止管理与 index 健康

- [ ] 4.13 重新读取并验证 ARCH-GATE、FE-07 正式 Ticket Status 与 direct blocker FE-04=done/evidence；它们仍是 FE-07 formal ticket verification/closure 的前置。若 FE-04 已经独立功能复验并人工记录 `functional complete`，只能按本节人工排期 FE-07 产品功能开发，不得把它记为 FE-07 ready/done/closure。任一所需 formal 条件不满足时，记录相应 blocker 并停止 formal 活动。
- [ ] 4.14 在 FE-07 内完成项目纳入、停止管理、index freshness／event／rebuild 的最小 contract／domain／Rust-first wire delta；复用 FE-07R projection types，不夺取 FX-19 主归属或 read resolver ownership。
- [ ] 4.15 在 FE-07 内生成 TypeScript wire、vectors 与 drift，并实现管理 lifecycle 和 index 健康投影。
- [ ] 4.16 在 FE-07 内只执行 L0／L1 lifecycle／index、L2 管理 journey、L3 isolated temp project／event／rebuild；actual runtime credit 仅来自该隔离输入穿过真实 WebView／Core／IPC 边界，不证明真实用户项目、配置或生产 artifact。上述功能检查经独立复验后，才可人工记录为 non-closure 的 task-only `functional complete`，可按本节成为下游产品功能开发的人工排期输入，但不得标记 FE-07 done、更新 frontier 或替代正式 gate/direct-blocker evidence。
- [ ] 4.17 仅在 FE-07 自身授权建立的 registry entry 已存在、4.16 已人工记录 `functional complete` 且当前 formal direct blockers 仍满足后，先在后置阶段运行 PF-05 evidence 和其他适用 hardening，再运行 `npm run verify:ticket -- FE-07`；保留命令、层级、运行标识和未覆盖边界。PF/hardening fail／inconclusive 或正式 closure 失败均阻止 FE-07 done。
- [ ] 4.18 对 FE-07 进行独立只读复审；任何功能、PF 或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、PF、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 frontier；只有全部证据满足 acceptance，才可标记 FE-07 done 并更新 frontier。

### FE-08：Adapter registry 与 bundle 生命周期

- [ ] 4.19 重新读取并验证 ARCH-GATE、FE-08 正式 Ticket Status 与 direct blocker FE-04=done/evidence；它们仍是 FE-08 formal ticket verification/closure 的前置。若 FE-04 已经独立功能复验并人工记录 `functional complete`，只能按本节人工排期 FE-08 产品功能开发，不得把它记为 FE-08 ready/done/closure。任一所需 formal 条件不满足时，记录相应 blocker 并停止 formal 活动。
- [ ] 4.20 在 FE-08 内完成 Adapter registry／bundle、active version／rule／capability update／rollback 的最小 contract／domain／Rust-first wire delta；不实现 Skill cell UI。
- [ ] 4.21 在 FE-08 内生成 TypeScript wire、vectors 与 drift，并实现 Adapter bundle 生命周期和能力投影。
- [ ] 4.22 在 FE-08 内只执行 L0／L1 registry／capability、L2 管理 journey、L3 synthetic candidate／switch／rollback；actual runtime credit 仅来自该 synthetic 输入穿过真实 WebView／Core／IPC 边界，不证明真实用户项目、配置或生产 artifact，且不得称为真实 Adapter bundle actual provenance。上述功能检查经独立复验后，才可人工记录为 non-closure 的 task-only `functional complete`，可按本节成为下游产品功能开发的人工排期输入，但不得标记 FE-08 done、更新 frontier 或替代正式 gate/direct-blocker evidence。
- [ ] 4.23 仅在 FE-08 自身授权建立的 registry entry 已存在、4.22 已人工记录 `functional complete` 且当前 formal direct blockers 仍满足后，先在后置阶段运行 PF-07 evidence 和其他适用 hardening，再运行 `npm run verify:ticket -- FE-08`；保留命令、层级、运行标识和未覆盖边界。PF/hardening fail／inconclusive 或正式 closure 失败均阻止 FE-08 done。
- [ ] 4.24 对 FE-08 进行独立只读复审；任何功能、PF 或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、PF、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 frontier；只有全部证据满足 acceptance，才可标记 FE-08 done 并更新 frontier。

### FE-09：独立导出、删除与恢复

- [ ] 4.25 重新读取并验证 ARCH-GATE、FE-09 正式 Ticket Status 与 direct blocker FE-04=done/evidence；它们仍是 FE-09 formal ticket verification/closure 的前置。若 FE-04 已经独立功能复验并人工记录 `functional complete`，只能按本节人工排期 FE-09 产品功能开发，不得把它记为 FE-09 ready/done/closure。任一所需 formal 条件不满足时，记录相应 blocker 并停止 formal 活动。
- [ ] 4.26 在 FE-09 内完成独立 export／delete／recover、toggle 永不回落 delete 和受影响 contexts 验证的最小 contract／domain／Rust-first wire delta；delete 不归入 FE-04。
- [ ] 4.27 在 FE-09 内生成 TypeScript wire、vectors 与 drift，并实现 export、显式 delete、恢复和受影响 contexts 表达。
- [ ] 4.28 在 FE-09 内只执行 L0／L1 export／delete／recover、L2 显式删除 journey、L3 isolated temp export／delete／recover collision；actual runtime credit 仅来自该隔离输入穿过真实 WebView／Core／IPC 边界，不证明真实用户项目、配置或生产 artifact。上述功能检查经独立复验后，才可人工记录为 non-closure 的 task-only `functional complete`，可按本节成为下游产品功能开发的人工排期输入，但不得标记 FE-09 done、更新 frontier 或替代正式 gate/direct-blocker evidence。
- [ ] 4.29 仅在 FE-09 自身授权建立的 registry entry 已存在、4.28 已人工记录 `functional complete` 且当前 formal direct blockers 仍满足后，先在后置阶段运行 PF-06 recovery evidence 和其他适用 hardening，再运行 `npm run verify:ticket -- FE-09`；保留命令、层级、运行标识和未覆盖边界。PF/hardening fail／inconclusive 或正式 closure 失败均阻止 FE-09 done。
- [ ] 4.30 对 FE-09 进行独立只读复审；任何功能、PF 或正式 closure 失败／inconclusive 均停止本 slice 尚未开始的后续实现、PF、closure，仍须进入本复审并独立记录 finding；复审本身不是 closure，不得标记 done 或更新 frontier；只有全部证据满足 acceptance，才可标记 FE-09 done 并更新 frontier。

## 5. RELEASE reconciliation

- [ ] 5.1 重新读取并验证 ARCH-GATE=`closed`、FE-07R 与 FE-01～FE-10 全部 done 且各自具 provenance-appropriate evidence；任一不满足，记录 blocker 并停止 RELEASE reconciliation。
- [ ] 5.2 在所有 ticket slices done 后执行聚合 release checks、release evidence reconciliation 和独立只读复审；不得以聚合检查替代任一 ticket closure 或 provenance。
- [ ] 5.3 只有 5.1～5.2 满足 RELEASE-GATE 的既有门槛，才更新 release 状态；否则保留实际 blocker、frontier 和未验证边界。
