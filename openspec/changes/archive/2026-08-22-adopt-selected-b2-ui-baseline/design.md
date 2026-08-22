## 背景

已验收的 B2 UI demo 只证明 Mock 的交互方向，不能替代产品规格、前端契约、Adapter／wire 合约或运行时证据。当前 v0.1 产品基线和前端契约仍描述四类一级入口、统一详情／编辑模型和 48 条转换路径；本 change 以五项新增 capability 将已确认的 B2 行为收敛为可验证的 MVP 合约。

现有 Gateway 已将读取与 `prepare`／`apply` 分离，并已有 `installAsset`、`convertAsset`、`editAsset` 与 `deleteAsset` 的安全事务闭环。本 change 不新增直接 enable／disable command，不改变 revision、冲突、快照或恢复不变量；任何 breaking wire shape 继续遵循 Rust-first 导出、单一 `wireVersion` 与 drift gate。

## 目标与非目标

**目标：**

- 将 PD-UI-B2-01 至 PD-UI-B2-10 的已确认语义落实为可测试的产品行为。
- 在不删除底层 Hook 兼容类型的前提下，使 MVP UI 只呈现 Skills、长期指令与 Subagents。
- 用 Adapter provenance、权威 revision 和封闭失败语义约束项目适用性与写入前重验。
- 将产品基线、前端契约、架构影响复核、FE 验收、代码和证据组织为单一依赖顺序。

**非目标：**

- 不将 Mock、截图、静态检查或合成 fixture 结果表述为 actual runtime 证据。
- 不静默覆盖已验收的 v0.1 产品基线、前端契约或技术方案。
- 不新增批量写入、一对多转换、Agent 生命周期管理、中央资产副本、产品自有 suppression registry 或绕过安全事务的写入路径。
- 不把 FX-03 作为正向 Hook UI journey；它只保留 Adapter／wire、内容安全和负向 UI 可达性覆盖。

## 决策

### D1：MVP 可见类型与 Hook 兼容边界分离

产品一级导航、全局搜索、创建入口和转换矩阵使用封闭的 MVP 可见集合：Skills、长期指令和 Subagents。底层身份仍可解码 `hook`，以保留 legacy fixture、Adapter／wire 兼容和迁移证据，但 Hook 不得生成、解析或渲染任何 MVP 工作台目的地。

FX-03 继续覆盖 Hook 的 Adapter／wire decode、未知字段保留、可执行内容风险、敏感值遮蔽与不执行契约。它同时是 Hook UI 不可达的负例，不构成可浏览、可编辑或可转换的 Hook 正向 journey。

### D2：明确项目视图与 Adapter 解析的全局适用性

读取上下文区分 `all`、`global` 与具体 `project(projectId)`，并与资产类型正交。项目身份为不透明 ID；展示名称和路径仅用于展示。项目视图包含项目自有资产，以及仅当版本化 Adapter 已明确解析为生效的全局资产。

每个已解析有效上下文包含 Adapter 身份和版本、规则版本、权威读取 revision、具体上下文身份、来源层级、加载顺序、优先级和覆盖关系。未知、受阻或过期事实有稳定 reason code，可在 All／Global 中检查，但不得进入项目的全局适用分段。`prepare` 和 `apply` 前必须重读；版本、revision 或受影响上下文集合变化会使旧审查失效并要求重新计算、审查和确认。

从项目视图编辑投影的全局资产时，系统必须保留该资产的全局 `AssetRef` 与 scope，写回原生全局资产，并在确认前展示全部已解析受影响 contexts；不得隐式创建项目副本。该写回语义必须同时具有 L2 journey 与 L3 actual Gateway／IPC 证据。

### D3：产品级列表语义只固定分层与全局分页

产品规格只定义以下列表层级：筛选 → 固定来源段序 → 段内稳定排序 → 结果扁平化 → 单一全局分页。`all` 必须先显示非空全局适用段，再显示非空项目段；项目段按项目展示名稳定升序，同名时以不透明 `projectId` 作确定性 tie-break。`global` 只显示非空全局资产段。`project` 必须先显示非空项目自有段，再显示已解析的非空全局适用段。空段不得渲染。列表必须保留来源分段可见性、聚合总数与跨段边界语义，且不得为每个来源段建立独立分页。

页大小（包括 20／50／100）、默认排序和页大小、同名输入序、条件变化后回到第一页、翻页后的滚动／焦点，以及搜索是否分页，均属于 frontend contract v0.2 与 UI acceptance 的细化内容，不是产品 capability 的 MUST。全局搜索在产品级只承诺定位资产且无写入副作用。

### D4：Skill Agent 单元格是事务式期望状态控制

每个 Skill 的四个 Agent 单元格分别表达 target 的 presence、activation、操作可用性、稳定原因和
当前事务标识，不做乐观实际状态更新。presence 仅为 absent／present／unknown／blocked／stale；
activation 仅为 notApplicable／enabled／disabled／unknown／blocked／stale，且 absent 时才为
notApplicable、present 时才可为 enabled/disabled。presence、activation 或适用事实不可判定时
必须 fail-closed。开启单元格进入目标设置：所选列确定目标 Agent，预填的目标 scope 和原生位置
必须在 `prepare` 前的目标设置中可见且可修改。无论首次 `prepare` 前或 `prepare` 后，如用户请求
改变任一参数，系统必须先对新 target 权威重读 presence、activation 与适用事实并重新解析
operation；旧 operation mapping 立即失效且不得沿用，如已存在，prepared、review 与 confirm 也
全部失效，随后才回到重新 prepare／review。确认摘要必须显示最终的目标 Agent、scope、原生位置、
操作类别、能力映射和差异。

`presence=absent` 的开启才由 Adapter 解析为 `installAsset`、`convertAsset` 或 blocked；
`presence=present`、`activation=disabled` 的重新启用只在已验证原生 activation 语义时解析为
`editAsset`，否则禁用或 blocked；`presence=present`、`activation=enabled` 的开启不产生写入。
关闭只在 present/enabled 且存在已验证原生 activation 语义时解析为 `editAsset` 停用，否则禁用并
解释原因，且不得回落为删除。删除保持独立显式操作，不新增通用 `setSkillEnabled` intent。Skill
安装／转换只由 Agent 单元格启动，所有允许路径继续经过 prepare、review、confirm、apply、revision
重验和恢复；只有 apply 成功并权威重读后才更新 presence 与 activation。

### D5：共享安全事务与类型特定资产表面

工作台共享选择、单一活动草稿、dirty guard、审查、确认、apply、revision 重验和恢复。Skills 默认展示只读结构化详情，明确的次级源码编辑映射为 `editAsset`，不承担安装或转换。长期指令在宽／中屏使用直接 Markdown 编辑器；选择或聚焦不建草稿，首次实际内容变化才创建 dirty draft，变更映射为 `editAsset`，且不提供转换入口。

Subagents 在宽／中屏默认只读 master-detail；明确的次级编辑只允许 Adapter 已验证可无损往返的字段及原生 Prompt／配置源码，并映射为 `editAsset`。未知、不兼容或扩展内容必须保真或只读。窄屏统一退化为类型 → 作用域 → 列表 → 详情／编辑单表面栈。

### D6：转换矩阵、保真失败与独立结果

确定性跨 Agent 转换只适用于 Skills 和 Subagents，在四个 Agent 间提供 24 条有方向路径。Skill 通过 Agent 期望状态单元格启动，Subagent 通过详情次级入口启动；每次转换只允许一个源资产、一个目标 Agent 和一个目标 scope，不支持批量或矩阵式写入。长期指令与 Hooks 没有转换可用性；长期指令的创建／导入是独立原生资产创建，不复用转换映射或暗示语义等价。

只映射已验证的目标版本结构。对 Prompt 和未知扩展内容只有两类结果：可保真 round-trip 时继续转换；无法保真时必须 blocked，不得标记为 degraded、prepare 或 apply。模型、工具、权限或其他行为无法证明安全映射时，可在写入前明确报告 manual work、degraded 或 blocked。原始跨 Agent copy 不是转换，也不得生成转换结果。成功结果是独立原生资产，不与源资产持续同步，并只在 apply 成功且权威重读后显示为实际可用。

### D7：先更新真相链，再实现和改变状态

实施顺序固定为：

1. 新建产品决策基线 v0.2 draft，保留已验收 v0.1 原文和历史状态；独立复核、记录用户验收并冻结。
2. 仅以冻结的产品 fingerprint 新建前端契约 v0.2，并同步 metadata、fixture catalog 与 coverage matrix；本层承接 D3 的交互细化。
3. 独立复核前端契约 v0.2、记录用户验收并冻结。
4. 完成带日期的技术方案影响复核或 addendum，明确登记方案 B 内采用基础设施归属 A 的 ownership transfer、FE-07R 计划 evidence registry row，以及调整为“复用 FE-07R foundation 但保留自身 L0／L1／L2／L3／PF-01 证据”的 FE-01 计划 evidence registry row，不静默覆盖既有架构结论。
5. 基于该复核决定 ARCH-GATE 的状态；不得预设它必然保持 closed。
6. 在任何 contract/wire/code/UI 的生产实现前，实施必须先创建并冻结 FE-07R acceptance、确认 FX-19 的主归属，再实际在 tracker 新增 FE-07R 并更新 DAG／README／RELEASE-GATE 等规划 artifacts，冻结 `verify:ticket` 的计划 validation command contract：新增 FE-07R tracker row，并将 FE-01 row 调整为复用 FE-07R foundation 但保留自身 L0／L1／L2／L3／PF-01 证据；本阶段不得预先实现可执行 `TICKET_REGISTRY` 或修改 `manifest.json`，后者仅由 FE-07R slice 的命令运行动态生成；随后逐项更新并冻结受影响 FE acceptance；tracker 状态不得从文档推断，只能由 gate／blocker evidence 决定。本轮规划修订尚未执行这些 task，当前 tracker、gate 和 ticket 状态不变。
7. 在第 6 步完成后按实际 gate 结果重算 tracker frontier、direct blockers 和 blocker evidence。只有 ARCH-GATE 实际为 `closed` 且对应 FE ticket 按更新验收位于重算后的 `ready-for-agent` frontier 时，才按 ORCH-UI-B2-01 的实际 DAG 分批执行 sections 2～4；否则保留 blocker 并停止。
8. 最后收集 ticket evidence，并仅由满足既有 provenance 门槛的 actual 结果更新 ticket 或 gate 状态。

### D8：分层证据、基础设施归属与 FX-03 保留策略

FE-07R 拥有最小 Tauri test-harness／bootstrap、L0–L3 分层验证骨架、在其 vertical slice 中创建的可执行 `TICKET_REGISTRY`／orchestration entry、由 ticket／registry 驱动的 evidence manifest metadata 和读取 built-in／active Adapter／rule provenance 的只读 AdapterRegistry seam；它自身只运行 L0／L1／L3 actual-read，无 L2 UI 或 PF，也不运行业务写入、项目／index lifecycle 或 prepare／apply。FE-01 复用该 bootstrap、shared harness 与 actual-read snapshot，负责首个工作台 L2/browser UI/read-session slice，不重建 resolver 或 foundation；但它仍须在自身 ticket 内以共享 harness 运行 FE-01-specific L0／L1／L2／L3 start／read／event／reread 和 PF-01，FE-07R 的 provenance 不可借用为其 closure credit。FE-02 保留 L0／L1／L2／L3 actual multi-file read 与 PF-02／PF-03 read，明确无 L3 write；FE-03 保留 L0／L1 草稿／保真／dirty guard、L2 编辑 journey 与 PF-02／PF-03 edit evidence，明确无 L3，且不得取得 actual Tauri IPC／磁盘写入 credit；FE-04 使用 L0／L1／L2、L3 isolated temp prepare／apply／conflict／recovery 与 PF-04，FE-05 使用 L0／L1／L2、L3 isolated temp create／import／install collision 且无新增 PF，FE-06 使用 L0／L1／L2、L3 isolated temp single-target conversion 与 PF-06，FE-07 使用 L0／L1／L2、L3 isolated temp project／event／rebuild 与 PF-05，FE-08 使用 L0／L1／L2、L3 synthetic candidate／switch／rollback 与 PF-07，且不得称为真实 Adapter bundle actual provenance，FE-09 使用 L0／L1／L2、L3 isolated temp export／delete／recover collision 与 PF-06 recovery。FE-04～FE-09 的 actual runtime credit 仅在这些隔离／synthetic 输入穿过真实 WebView／Core／IPC 边界时成立，不证明真实用户项目、配置或生产 artifact。FE-10 只运行 L0／L1／L2，明确无 L3 和无 PF。FX-03 必须在 Adapter／wire decode、未知字段、`EXECUTABLE_CONTENT_RISK`、敏感遮蔽与 no-execution 的 contract/security 测试中保留，同时在 L2 仅验证 Hook UI 不可达。

## 编排决策（非产品 PD）

### ORCH-UI-B2-01：方案 B（采用基础设施归属 A）的 FE-07R 前置投影 slice

FE-07R 是新增、只读的项目适用性与投影 ticket。它拥有 opaque `projectId`、active Adapter／rule provenance、resolved／unknown／blocked／stale fail-closed、All／Global／Project actual read projection，以及自身 closure 所需的最小 Tauri test-harness／bootstrap、L0–L3 骨架、在其 vertical slice 中创建的可执行 `TICKET_REGISTRY`／orchestration entry、由 ticket／registry 驱动的 evidence manifest metadata 和读取 built-in／active Adapter／rule provenance 的只读 AdapterRegistry seam；不拥有项目纳入、停止管理、index lifecycle、prepare／apply、业务写入或 UI。它自身只跑 L0／L1／L3 actual-read，无 L2 UI journey 或 PF。FX-19 `project-applicability-projection` 是其专属 applicability fixture 候选，且在 frontend contract v0.2 冻结时确认主归属。

FE-07R done 后才解锁 FE-01。FE-01 复用 FE-07R 已验证 bootstrap、shared harness 与 actual read snapshot，负责首个工作台 L2/browser UI/read-session slice，不重建 resolver 或 foundation；同时它须在自身 ticket 内以共享 harness 运行 FE-01-specific L0／L1／L2／L3 start／read／event／reread 和 PF-01。FE-07R 的 snapshot 仅作上游输入，不得借用其 provenance 取得 FE-01 closure credit，也不得用 Mock 或 injected projection 替代 ticket closure。原 FE-07 保留原 ID 和 FE-04 blocker，继续承担项目纳入、停止管理和 index 健康。唯一新增边为 FE-07R → FE-01；其余 DAG 保持 FE-01 → FE-02 → FE-03 → FE-04、FE-02 → FE-10、FE-04 → FE-05／FE-06／FE-07／FE-08／FE-09、全部 done → RELEASE-GATE。不新增 FE-07M、FE-08 → FE-06 或 FE-06 → FE-10。

所有 ticket-owned vertical slice 的首项都重新读取并验证 ARCH-GATE=`closed`、目标 ticket=`ready-for-agent` 与全部 direct blockers=done 且有 evidence；任一条件不满足，记录 blocker 并停止该 slice。每个允许执行的 slice 在自身内部完成最小 contract／domain／Rust-first wire、生成 TypeScript／vectors／drift、实现、逐票据配置的 L0／L1／L2／L3／PF、`npm run verify:ticket -- FE-XX`、独立只读复审，并仅在证据充分后标 done 与更新 frontier；不得固定要求 L2，FE-07R 保持无 L2／PF。该编排不进入下列 PD-UI-B2 产品决策表。

## PD-UI-B2 决策可追溯性

| 已确认决策                                                  | 本 change 的承接位置                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| PD-UI-B2-01 Hooks 退出 MVP UI                               | D1；`asset-workbench-navigation`；FX-03 负向覆盖                         |
| PD-UI-B2-02 全局资产按 Adapter 解析投影                     | D2；`resolved-global-applicability`                                      |
| PD-UI-B2-03 Skill presence/activation 事务式期望状态 toggle | D4；`skill-agent-state-control`                                          |
| PD-UI-B2-04 toggle 是 Skill 安装／转换唯一主入口            | D4；`skill-agent-state-control`；`deterministic-conversion-scope`        |
| PD-UI-B2-05 长期指令不跨 Agent 转换                         | D5、D6；`type-specific-asset-surfaces`；`deterministic-conversion-scope` |
| PD-UI-B2-06 Skill 默认只读与次级源码编辑                    | D5；`type-specific-asset-surfaces`                                       |
| PD-UI-B2-07 Subagent 默认只读与安全编辑                     | D5；`type-specific-asset-surfaces`                                       |
| PD-UI-B2-08 Subagent 保留确定性转换                         | D6；`deterministic-conversion-scope`                                     |
| PD-UI-B2-09 长期指令首次实际修改建草稿                      | D5；`type-specific-asset-surfaces`                                       |
| PD-UI-B2-10 获批的列表语义层级                              | D3；`asset-workbench-navigation`；frontend contract v0.2／UI acceptance  |

## 风险与取舍

- [列表产品语义被实现参数污染] → 产品 spec 只保留 D3 的层级，所有具体分页、排序、焦点和搜索分页规则仅在 frontend contract v0.2 与验收中定义。
- [项目适用性过期导致错误写入] → 将投影绑定版本和 revision，prepare／apply 前重读，变化后失效旧审查并封闭失败。
- [toggle 混淆 presence、activation、安装、转换、启停与删除] → presence/activation 分离；只有 absent 可安装/转换，只有已存在且已验证原生 activation 语义才可 `editAsset` 启停；不可判定时封闭失败，不以删除替代。
- [转换以 degraded 掩盖内容损失] → Prompt 或未知内容只有可保真 round-trip 或 blocked 两类结果；raw copy 不是转换。
- [Hook 退出 UI 后丢失安全覆盖] → 将 FX-03 保留为 decode／安全／负向可达性 fixture，不生成正向 UI journey。
- [foundation owner 漂移或 FE-01 重建读链] → addendum 明确方案 B 内归属 A、FE-07R 与 FE-01 的计划 evidence registry rows；FE-01 复用 foundation，但在自身 ticket 内以共享 harness 保留 L0／L1／L2／L3／PF-01 provenance。
- [真相链与 ticket 状态脱节] → 每一步以其前一步的产物为输入，ARCH-GATE 和 tracker 均在影响复核后按事实重算。

## 迁移计划

1. 完成 D7 的 truth chain、ORCH-UI-B2-01 编排、实施时的 FE-07R／tracker artifact 更新（新增 FE-07R tracker row，并调整 FE-01 row 保留自身 L0／L1／L2／L3／PF-01 证据）、各 FE acceptance 与计划 `verify:ticket` validation command contract 冻结和 frontier 重算；本阶段不实现可执行 `TICKET_REGISTRY` 或修改 `manifest.json`；未满足实施停点时保留 blocker 并停止。
2. 执行 FE-07R vertical slice，在该 slice 内完成只读 projection 的最小 Tauri test-harness／bootstrap、L0–L3 骨架、可执行 `TICKET_REGISTRY`／orchestration entry、只读 AdapterRegistry seam、Rust-first wire、生成产物、L0／L1／L3 actual read、无 L2／UI／PF；在 2.5 实际运行 `verify:ticket` 生成 evidence `manifest.json`，再独立复审；完成后才解锁 FE-01。
3. 执行 FE-01 和 FE-02 vertical slices；FE-01 复用 FE-07R bootstrap／shared harness／actual-read snapshot，负责首个 L2/browser UI/read-session，并在自身 ticket 内运行 FE-01-specific L0／L1／L2／L3 start／read／event／reread 和 PF-01，不能借用 FE-07R provenance。FE-02 保留 L3 actual multi-file read 与 PF-02／PF-03 read、无 L3 write。FE-02 done 后，按实际 frontier 并行执行可达的 FE-10 slice（仅 L0／L1／L2，无 L3／PF），同时继续 FE-03 → FE-04。每个 slice 自带自身 wire、实现、适用证据、ticket verify 与独立复审。
4. FE-04 done 后，按实际 DAG 分别执行 FE-05、FE-06、FE-07、FE-08 与 FE-09 vertical slices；每个 slice 自带自身 wire、实现和 provenance-separated evidence，不跨票据借用 closure。
5. 仅在 FE-07R 与 FE-01～FE-10 全部满足自身 closure 后执行 RELEASE reconciliation；聚合 release checks 不替代任一 ticket closure，发布前仍可整体回退 v0.2 UI／wire 改动，v0.1 和底层 Hook 兼容解码保持可恢复。
