# 已确认 UI Demo 影响台账：selected B2

> 状态：`selected B2 UI demo accepted by user on 2026-08-08; mock-only evidence`
>
> 本文记录已确认的 throwaway Mock UI 与其潜在回写面，不是产品决策、前端契约、技术方案、wire schema 或 FE 票据的事实来源。selected B2 的 UI／交互验收本身不自动确认 Hooks 的正式去留、全局适用解析、生产 enable intent、转换能力范围或任何真实写入能力；这些产品语义随后已通过 PD-UI-B2-01～10 逐项确认，但仍须由正式 OpenSpec change 落入版本化产物，且不因此关闭 FE 票据。

## B2 v22 既有候选结构（本轮调整前）

> 本节与下方 `CR-UI-B2-001`、`候选决策登记` 记录本轮开始时的 v22 影响基线；其中 Hooks、Skill 编辑／事务入口和“项目仅看自有资产”的描述，已被本文末尾“2026-08-03：候选收敛增补”中的新候选覆盖。它们保留用于说明反向影响，不代表当前 selected Mock。

1. **配置上下文列**
   - 只展示“全局配置”和“项目配置”。
   - “全局配置”下不展开资产类型。
   - “项目配置”下直接展示受管项目列表；选择一个项目后只展示该项目的原生资产。
2. **资产类型列**
   - 选择全局或具体项目后，展示 Skills、长期指令、Subagents、Hooks。
   - 不在项目树中重复四类资产。
3. **主表面**
   - 列表与详情／编辑互相替换，不保留第四个常驻详情栏。
   - 宽／中窗口为三层结构；窄窗口为“上下文 → 类型 → 列表 → 详情／编辑／旅程”单表面页面栈。
   - 一级上下文栏只包含“全局配置”“项目配置”与项目列表；浏览详情不展示任何文件名，文件仅在编辑态出现。
   - selected 图标统一来自固定依赖 `lucide-react@1.28.0`，不保留手写图标模块。
4. **搜索与列表**
   - 搜索统一收口到右上全局入口与 `⌘K`。
   - 删除“当前类型／全部”范围 Tab、类目内搜索框和无效作用域 Tab。
   - 搜索结果可跨项目、上下文和资产类型定位，但不授权写入。
5. **Skills**
   - 列表使用高密度两行资产信息和四个 Agent 的只读事实／事务入口。
   - 浏览详情只展示结构化信息；点击“编辑源码”后才展示文件和源码编辑。
   - 浏览层不单列文件树或检查器；会影响写入安全的状态在编辑、安装、转换、审查、确认或结果阶段表达。
6. **Agent 边界**
   - 只展示识别、可安装、可转换、阻断等检测／兼容事实。
   - 不新增 Agent 安装、升级、启停或生命周期管理；可行动作进入既有单目标事务闭环，不做即时 toggle。

## CR-UI-B2-001：selected 列表控制契约

这是已确认的 Mock-only 列表契约，只描述本次 throwaway Mock 的列表交互，不修改正式查询契约、Gateway 或服务端能力。

- 名称排序仅提供升序／降序，默认升序；同名记录保持输入顺序，保证稳定排序。
- 每页数量仅提供 20／50／100，默认 20。
- 处理顺序固定为：筛选 → 固定段序 → 段内稳定名称排序 → 扁平化 → 单一全局分页。总数以扁平化后的聚合集合为基数；页面边界可以截断一个来源分段。
- 筛选条件、排序方向或每页数量变化后统一回到第 1 页。
- 翻页后列表滚回顶部，并将键盘焦点交给新页首行。
- `⌘K` 全局搜索跨上下文与资产类型，结果不分页；选择结果后一次性提交上下文、类型、资产和详情目的地。
- 本轮不增加其他排序字段、服务端分页、持久化列表偏好、批量操作或任何直接写入能力。

## 候选决策登记

| ID       | 历史候选 UI 调整                             | 当前 selected B2 处置                                                         | 状态         |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------- | ------------ |
| UI-B2-01 | 一级导航从“资产类型优先”改为“配置上下文优先” | 拒绝；当前为资产类型 → 作用域 → 主表面                                        | `rejected`   |
| UI-B2-02 | 第二列集中四类资产类型                       | 已被类型列 + 作用域列取代；Hooks 不在 selected 导航中                         | `superseded` |
| UI-B2-03 | 主表面列表／详情替换                         | 已被类型差异化主表面取代：Skills 跳转详情，内容型资产 master-detail           | `superseded` |
| UI-B2-04 | 右上全局搜索                                 | 保留；搜索、索引、事件和缓存均不能授权写入                                    | `accepted`   |
| UI-B2-05 | Skill 高密度列表与 Agent 关系                | 已被会话内启用预览取代；仅 Mock 内存，阻断目标进一步淡化、disabled 并说明原因 | `superseded` |
| UI-B2-06 | Skill 结构化详情 → 编辑源码                  | 已被只读结构化“查看 Skill”取代；不把源码编辑作为 selected Skill 主能力        | `superseded` |
| UI-B2-07 | 浏览层隐藏文件与独立检查器                   | 保留；安全信息仍须在正式流程中可达                                            | `accepted`   |
| UI-B2-08 | 窄窗单表面页面栈                             | 保留，并调整为类型 → 作用域 → 列表 → 详情／旅程                               | `accepted`   |

## 对既有产物的潜在影响

### 产品决策基线

单独完成产品级语义确认并取得正式产物同步批准后，复核并只在需要时更新：

- 主工作区布局：上下文列、资产类型列、主表面之间的职责。
- 列表与检索：全局搜索、当前上下文资产列表和筛选的关系。
- 资产详情：结构化浏览与显式源码编辑的层级。
- 响应式与可访问性：窄窗页面栈、返回与焦点恢复。

若最终决定改变产品能力，而不只是界面编排，必须先提交最小 Change Request；Mock 不得静默成为产品事实。

### 前端契约与 fixtures

单独完成产品级语义确认并取得正式产物同步批准后，逐条核对：

- `AssetListQuery`／`AssetListSnapshot` 对精确全局或具体项目上下文的表达。
- `AssetSummary`、结构化 `AssetDetail`、`NativeFileQuery` 和 Agent action availability 的投影边界。
- dirty guard、全局搜索目的地、窄窗页面栈和焦点恢复的 frontend-local 状态。
- dirty guard 只暂存目标转换；继续编辑保持旧上下文、旧资产与编辑器，确认放弃后才原子提交目标上下文。
- dirty + 全局搜索只允许一个模态表面；继续编辑恢复原 textarea 焦点。
- 成功 Apply 把确认草稿写入当前会话的 Mock 内存快照；刷新才重置。
- 多文件 Review 聚焦并标记真实 changed file；Convert 恢复保持无草稿、`dirty=false`。
- Review、Focused Confirm 与 Outcome 使用同一实际 changed-file count；Outcome 在正常内容流中紧凑展示。
- 单文件、多文件、只读、索引过期、漂移、冲突、敏感值、完整／降级／阻断转换 fixtures。

在单独完成产品级语义确认并取得正式产物同步批准前，不新增字段、query、intent、fixture 或状态机。

### 前端票据

单独完成产品级语义确认并取得正式产物同步批准后，可能需要调整验收表达的票据：

- FE-01：三层只读工作台、全局搜索、高密度列表。
- FE-02：结构化浏览和显式进入文件／源码层。
- FE-03：页面切换、单资产草稿和 dirty guard。
- FE-04：Agent 动作、审查、确认、冲突、结果和恢复表达。
- FE-05／FE-06：安装、导入与转换入口的上下文预填。
- FE-07／FE-08：项目与 Agent 管理入口的位置。
- FE-10：宽／中／窄、键盘、焦点、减少动态效果和敏感信息回归。

FE 依赖图与已冻结产品范围不由本文修改。

### 技术方案与 wire

单独完成产品级语义确认并取得正式产物同步批准后，才评估现有 `read`／`prepare`／`apply`／`observe` 是否需要最小映射调整。当前不新增 IPC command、event、DTO、adapter seam、依赖或 `wireVersion`。

## 本轮证据状态

- 旧截图和旧 Fix 报告只作为历史材料，不证明本次 selected B2 重构。
- 当前 selected B2 已于 2026-08-08 通过浏览器宽／中／窄画面、控制台和核心交互验收；具体证据见 `design-qa.md` 的新增验收段。
- 静态断言、SSR、模型测试或构建成功仍不能替代浏览器证据，也不能替代 FE／IPC／L3／L4 的正式门禁。

## 已保存证据

- [设计 QA](../../../design-qa.md)
- [本轮调整前 1280×720](../../../.scratch/current-ui-audit/01-before-adjustments.jpg)
- [本轮候选 A 1280×720](../../../.scratch/current-ui-audit/06-inherit-a-clean.jpg)
- [本轮候选 B 1280×720](../../../.scratch/current-ui-audit/07-inherit-b-clean.jpg)
- [本轮候选 C 1280×720](../../../.scratch/current-ui-audit/08-inherit-c-clean.jpg)

以上本地截图只用于历史 Mock 方案讨论；`design-qa.md` 中 v22 的 `blocked` 结论仍保留为历史证据。2026-08-08 的 selected B2 浏览器验收不构成 FE 票据闭环。

## UI 定稿后的正式真相链

> 下列顺序取代本文历史候选段落中“回写同一份 v0.1”或“技术方案最后复核”的预判；历史段落只保留候选演进记录。

1. 已记录用户对 selected B2 UI demo 的接受，以及 PD-UI-B2-01～10 的逐项产品语义确认。
2. 新建产品决策基线 v0.2 draft，保留已验收 v0.1 原文和历史状态；该 draft 必须独立复核、记录用户验收并冻结。
3. 只在产品 v0.2 冻结后新建 frontend contract v0.2，并以冻结的产品 fingerprint 同步 metadata、fixture catalog 与 coverage matrix；PD-UI-B2-10 的具体控件参数和焦点行为由本层承接。
4. frontend contract v0.2 必须独立复核、记录用户验收并冻结后，才进入带日期的技术方案影响复核或 addendum；该复核必须登记方案 B 内采用基础设施归属 A 的 ownership transfer、FE-07R 计划 evidence registry row，以及调整为“复用 FE-07R foundation 但保留自身 L0／L1／L2／L3／PF-01 证据”的 FE-01 计划 evidence registry row，不得静默覆盖既有架构结论。
5. 基于影响复核决定 ARCH-GATE 状态；不得预设 gate 维持 closed，也不得从 Mock 或文档完成推断 ticket ready／done。
6. 在任何 contract/wire/code/UI 的生产实现前，实施必须创建并冻结 FE-07R acceptance、确认 FX-19 主归属，实际在 tracker 新增 FE-07R 并更新 DAG／README／RELEASE-GATE 等规划 artifacts，冻结 `verify:ticket` 的计划 validation command contract：新增 FE-07R tracker row，并将 FE-01 row 调整为复用 FE-07R foundation 但保留自身 L0／L1／L2／L3／PF-01 证据；本阶段不得预先实现可执行 `TICKET_REGISTRY` 或修改 `manifest.json`，后者仅由 FE-07R slice 的命令运行动态生成。本轮规划修订尚未执行这些 task，当前 tracker、gate 与 ticket 状态不变。
7. 在第 6 步完成后重算 tracker frontier、direct blockers 和 blocker evidence；只有 ARCH-GATE 实际为 `closed`，且对应 FE ticket 按更新后的验收位于重算的 `ready-for-agent` frontier，才可按 ORCH-UI-B2-01 的实际 DAG 分批执行 OpenSpec tasks 的 sections 2～4；否则保留 blocker 并停止。
8. 最后实施允许的 contract、wire、Gateway／Adapter、UI 与分层验证，并仅由满足既有 provenance 门槛的 actual evidence 更新 ticket 或 gate 状态。

### ORCH-UI-B2-01：方案 B（采用基础设施归属 A）的票据编排（非产品 PD）

- 新增前置票据 FE-07R，除只读项目适用性与投影（opaque `projectId`、active Adapter／rule provenance、resolved／unknown／blocked／stale fail-closed、All／Global／Project actual read projection）外，接管自身 closure 所需的最小 foundation：Tauri test-harness／bootstrap、L0–L3 分层验证骨架、在其 vertical slice 中创建的可执行 `TICKET_REGISTRY`／orchestration entry、由 ticket／registry 驱动的 evidence manifest metadata，以及读取 built-in／active Adapter／rule provenance 的只读 AdapterRegistry seam。它不包含项目纳入、停止管理、index lifecycle、prepare／apply、业务写入或 UI。
- FE-07R 自身只跑 L0／L1／L3 actual-read，无 L2 UI journey 或 PF；其 foundation 可供后续 FE-01 消费和扩展。FE-07R done 后才解锁 FE-01；FE-01 复用已验证 bootstrap、shared harness 与 actual-read snapshot，负责首个工作台 L2/browser UI/read-session slice，不重建 resolver 或 foundation，并须在自身 ticket 内以共享 harness 运行 FE-01-specific L0／L1／L2／L3 start／read／event／reread 和 PF-01。FE-07R snapshot 仅作上游输入，不得借用其 provenance 取得 FE-01 closure credit，也不得以 Mock 或 injected projection 替代 ticket closure。原 FE-07 保留原 ID 和 FE-04 blocker，继续负责项目纳入、停止管理和 index 健康。
- FE-04～FE-09 的 L3 actual runtime credit 仅来自各自登记的 isolated temp／synthetic 输入穿过真实 WebView／Core／IPC 边界；它不证明真实用户项目、配置或生产 artifact，且 FE-08 不得声称真实 Adapter bundle actual provenance。
- 仅新增边 FE-07R → FE-01。其余 DAG 保持 FE-01 → FE-02 → FE-03 → FE-04，FE-02 → FE-10，FE-04 → FE-05／FE-06／FE-07／FE-08／FE-09，全部 done 后才进入 RELEASE-GATE；不引入 FE-07M、FE-08 → FE-06 或 FE-06 → FE-10。
- FX-19 `project-applicability-projection` 是 FE-07R 的专属 applicability fixture 候选，须在 frontend contract v0.2 冻结时确认主归属。该编排不改变 PD-UI-B2-01～10 的产品语义。

## 2026-08-03：候选收敛增补（历史候选）

本节只覆盖 selected B2 throwaway Mock，不回写产品基线、前端契约、技术方案、src/contract、Gateway/IPC/Rust 或 FE 票据。UI 最终定稿前，所有正式产物保持不变。

### Hooks 从 selected 候选移除

- selected 的 AssetTypeRail 与全局搜索不再呈现 Hooks；B2 seed 删除 3 个项目 Hook 和 1 个全局 Hook。
- 这不是删除正式产品资产类型：shared assetTypes、legacy A/B/C 方案、现有产品基线与生产契约仍保留 Hooks。
- selected 的导航、seed、搜索、旅程和聚焦测试改用 Skills、长期指令或 Subagents；legacy Hooks 仍作为历史/正式边界证据保留。

### Skill 最小功能边界

- selected Skill 只提供结构化“查看 Skill”，以及对四个 Agent 的会话内启用/停用预览；阻断目标不可切换。
- Skills 列表把文字 checkbox 收敛为真实 Agent 品牌 Logo：点亮表示启用，置灰表示停用，阻断目标不可操作；原生 checkbox 仍承担可访问名称、键盘和 checked/disabled 语义。四个 SVG 随 Mock 本地打包，不新增依赖或网络访问。
- 预览只改 FullUiMock 的 b2AssetSnapshots 内存快照，刷新即复位；UI 明示“Mock 会话预览，不写入配置”。
- selected Skill 列表与详情不再把准备安装、准备转换、跨 Agent 转换或编辑源码作为主能力，也不会触发既有 prepare/apply。
- 这不新增生产写权限、批量操作、Gateway/IPC/DTO 或真实配置写入。旧底层函数与非 Skill／legacy 旅程仅为既有证据保留。

### 长期指令最小功能边界

- selected 长期指令不做跨 Agent 转换；详情与控制器强制进入 `convert` 的路径均 fail-closed，不展示准备安装、准备转换或兼容操作。
- “Agent 使用状态”仅展示当前原生资产对应的 Agent，不提供切换、安装或转换按钮，也不把其它 Agent 推导成 `installable`。
- 原生 Markdown 在详情主区域直接可编辑；草稿只进入当前 Mock 会话的 `drafts`，更改后仍经过既有 review／confirm／apply 合成流程。readonly 场景只读，不新增生产保存语义。
- 该收敛可能影响正式基线中的转换适用范围、详情信息层级，以及 FE-02／FE-03／FE-06 的验收表达；用户最终定稿前不反向更新这些正式产物。

### 项目自有与全局适用（Mock 假设）

- 项目上下文同时展示项目自有资产和适用的全局资产；全局上下文仍只显示全局资产。
- **本轮仅用于 Mock 的假设**：所有已有 global seed 都视为适用于当前项目。它不是正式的作用域、生效解析、加载顺序或授权事实，正式解析需要在 UI 定稿后的最小 CR 中单独确认。
- 选择项目上下文内的全局 Skill 时保留当前 configContext，避免跳回 global。

### inherit 布局决策：已选择 A

| 方案        | 结构                                                 | 价值                                           | 代价                               |
| ----------- | ---------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| A（已选择） | 分段同表：先项目自有、后全局适用，共享列宽/排序/筛选 | 来源边界最明确，同时保留可直接比较的高密度表格 | 分段会降低跨来源的纯名称扫描速度   |
| B           | 统一混排：一个排序列表，行内来源标识                 | 扫描与全局名称排序最快                         | 来源层级需要持续阅读每行标识       |
| C           | 项目主表 + 继承侧栏：侧栏列全局适用资产与 Agent 状态 | 项目自有保持主焦点，继承关系独立可读           | 窄空间下必须纵向堆叠，比较路径更长 |

- 入口为 selected + inherit=A|B|C，默认 A；小型开发切换器只在 controls=1、selected 项目 browse list 出现。
- 切换只更新 inherit 参数，保留当前资产、筛选、排序和会话启用状态；不复用 legacy PrototypeController 作为方案控制器。B／C 仅作为历史开发对照，其分页行为不定义当前 selected B2 的分页语义。
- 用户已于 2026-08-03 明确选择 A。selected 默认保持 `inherit=A`；B/C 仅保留为 throwaway Mock 的开发对照，不再作为待定产品候选。
- 本次确认只冻结“项目自有与全局适用如何同屏”的布局选择，不等同于批准全局适用解析、Skill 正式 enable intent、Hooks 正式下线或任何生产写入能力，也不触发正式产物批量回写。

### 正式产物影响与未决 CR

若且仅若用户定稿后确认产品级变化，再按既定顺序评估：

1. 产品基线：一级导航是否继续含 Hooks、Skill 管理能力边界、项目对全局资产的可见/适用语义。
2. 前端契约/fixtures：项目查询是否需要表达“项目自有 + 已解析适用全局”的来源与排序语义，以及 Skill enable availability 的只读投影。
3. FE 票据：按冻结 DAG 复核受影响的验收表达，不从 Mock 直接关闭任何票据。
4. 技术方案/wire：只有正式契约无法在现有 read/prepare/apply/observe seam 表达时，才提出最小 CR。

未决 CR：全局资产对项目“适用”的真实解析、加载优先级、覆盖关系、可写边界及是否需要任何正式 enable intent；本 Mock 对这些问题不作决定。

## 2026-08-04：状态可扫读性增补（change: b2-state-scannability，历史候选）

对应 OpenSpec change `b2-state-scannability`（proposal/design/specs/tasks）。本节只覆盖 selected B2 throwaway Mock，不回写产品基线、前端契约、技术方案或 FE 票据。

### Skills 表 Agent 固定分列

- 每行一组的 4 个 Agent toggle 改为 4 个固定窄列（每列 48px，右锚固定 204px 列轨），列位跨行固定，每个 Agent 形成一条垂直扫描线；列头为品牌 Logo（role="img" + aria-label + title，另保留视觉隐藏的"Agent 启用预览"文本）。
- 表头移入列表滚动容器并 sticky 定位：表头与行共享同一滚动宽度，classic-scrollbar 平台（Windows/Linux/headless）不再出现列头与单元格 15px 错位。
- 三态语言为点亮／置灰／blocked；阻断目标进一步淡化、disabled 且显示原因，不以 dashed 作为当前视觉事实。单元格全高可点；切换仍只写会话内 Mock 快照并明示“不写入配置”。
- 1200–1559 的 2×2 回落已删除（4 固定列在该区间实测不溢出）；窄屏退化回行内 toggle 组。

### 来源区分强化

- "项目自有／全局适用"分段标题提升层级（40px、加深底），全局段文字用蓝色；来源 badge 固定专色（项目自有中性灰、全局适用钢蓝 #1d6482，与选中蓝 #1672ef 拉开色相），不与状态/启停用色冲突。
- 两段共享列宽；筛选后按固定段序与段内稳定排序扁平化，再执行单一全局分页。

### 内容型资产 master-detail（对 v22 决策的有记录例外）

- 长期指令与 Subagents 在宽/中屏改为 master-detail：主表面切分为左列表 + 右内容区，选中即显示；长期指令选中即可编辑 Markdown，Subagents 右区为结构化信息 + 只读正文。
- 这是对 v22"列表与详情互相替换、不保留第四个常驻详情栏"的**例外**：master-detail 是主表面本身的二列切分，不是恢复常驻检查器；仅适用于内容型资产类型，Skills 保持行点击进入详情的跳板模型。
- 窄屏退化为现有"列表 → 详情"单表面栈，无新增响应式分支；dirty guard、单草稿、焦点归还语义不变。
- 该例外可能影响正式基线中"主工作区布局"与 FE-02/FE-03 的验收表达；用户最终定稿前不反向更新正式产物。

### 正式产物影响追加

若定稿，按既有顺序追加评估：

1. 产品基线：Skills 列表的 Agent 分列信息结构、来源区分层级、内容型资产的类型差异化主表面。
2. 前端契约/fixtures：列表行对 Agent 启用投影的既有字段可复用，预计无需新增字段；master-detail 选中态为 frontend-local。
3. FE 票据：FE-01（高密度列表结构）、FE-02（内容型浏览/编辑层级）、FE-10（响应式与焦点回归）的验收表达。
4. 技术方案/wire：无预期变化。

## 2026-08-04：类型优先导航（change: b2-type-first-nav，历史候选）

对应 OpenSpec change `b2-type-first-nav`（proposal/design/specs/tasks）。本节只覆盖 selected B2 throwaway Mock。

### 导航回归基线 4.3：UI-B2-01 处置为"拒绝"

- 正式产品基线 4.3 本为"资产类型优先、上下文感知"；v22 的"上下文优先"两栏（UI-B2-01）经本轮评估后**拒绝**，Mock 回归基线方向。正式基线无需为导航顺序回写。
- 第一栏改为三类资产类型（Skills／长期指令／Subagents，收窄至 180px）；第二栏改为作用域选择器（全部／全局配置／各受管项目，220px），为纯选择器，管理入口仍留顶栏。
- 默认落地 Skills + 全部；作用域切换保持类型/筛选/排序/每页数量并回第 1 页。

### "全部"视图跨来源聚合

- 聚合该类型在全局与全部项目的资产，按“全局适用 → 项目名”固定分段；空来源不出段；段内稳定排序后扁平化并执行单一全局分页，分页以聚合结果为基数；同名资产跨来源独立成行，不做合并。
- 项目视图保持"项目自有 → 全局适用"A 布局两段；全局视图只含全局资产；inherit=B/C 仍仅项目视图可达。
- 资产身份携带原始上下文：聚合只是列表读模型，详情/编辑/事务按资产自身上下文运行；编辑区头部与 review 侧栏的作用域标识按资产自身来源派生（'全部'下不显示"全部"）。

### 辅助路径

- 窄屏栈调整为 类型 → 作用域 → 列表 → 详情，返回/焦点语义不变。
- 全局搜索目的地提交资产自身作用域（全局资产→global，项目资产→对应 project）。

### 正式产物影响追加

> 本段是当时候选判断，已被下方 PD-UI-B2-02 及正式 change 取代。项目适用性需要扩展 `AssetListQuery`／`EffectiveContext` 并按 Rust-first 流程升级 breaking wire shape，不能继续沿用“wire 无预期变化”。

## 2026-08-08：selected B2 UI demo 已确认

- 用户已确认当前 selected B2 UI demo。`accepted`、`rejected` 与 `superseded` 仅记录本 Mock 的 UI 决策处置，不将 Mock 假设提升为生产事实。
- 已确认的主路径为：默认 Skills + 全部；宽／中窗口为资产类型 → 作用域 → 类型差异化主表面；Skills 使用高密度表格并进入结构化详情；长期指令和 Subagents 使用 master-detail；窄窗口为类型 → 作用域 → 列表 → 详情／旅程。
- 已确认的列表产品语义为：筛选 → 固定段序 → 段内稳定排序 → 扁平化 → 单一全局分页。总数来自聚合集合，页面边界可截断来源分段；精确控件参数与焦点行为按 PD-UI-B2-10 下沉到前端契约和 UI 验收。
- 当前 Mock 仍把所有 global seed 视为适用于项目，这只是尚未接入 Adapter 解析的演示假设，正式 change 必须按 PD-UI-B2-02 替换。当前已识别的产品级语义决策均已确认。
- 本次确认不新增 Gateway、IPC、DTO、adapter seam、依赖或真实配置写入；也不关闭 FE-01～FE-10、FE／IPC 或 L3／L4 证据门禁。

## 2026-08-08：产品级语义决策进度

### PD-UI-B2-01：Hooks 退出 MVP UI（已确认 A）

- MVP 的一级资产导航、全局搜索和创建流程不展示 Hooks；正式 UI 只呈现 Skills、长期指令与 Subagents。
- 本决定不删除底层 Hooks 类型、legacy A/B/C 证据或兼容代码；后续如需重新进入产品 UI，必须通过新的显式 change。
- 产品基线、前端契约、fixtures 与 FE 票据将在其余产品语义确认后，由独立的正式 OpenSpec change 统一同步；本台账不直接充当正式规格。

### PD-UI-B2-02：全局资产按 Adapter 解析结果投影到项目（已确认 A）

- 版本化 Adapter MUST 解析资产对具体项目的真实生效上下文、来源层级、加载顺序与覆盖关系；项目视图只在该解析明确确认后，才把全局资产列入“全局适用”分段。
- 无法确认项目适用性时 MUST fail-closed，不得沿用“所有全局资产默认适用”的 Mock 假设；该资产仍可在“全部”或“全局配置”作用域中查看其未知／阻断事实。
- 从项目视图选择全局资产不改变资产身份或作用域；编辑仍指向该全局原生资产，并在审查／确认前展示所有已解析的受影响上下文，不隐式复制为项目资产。
- 正式 change 需为 `AssetListQuery` 的项目视图语义及 `EffectiveContext` 补充不透明项目身份和解析状态；不得以路径或展示名称充当身份。

### PD-UI-B2-03：Skill 使用事务式期望状态 toggle（已确认 B）

- 四个 Agent 单元格是期望状态控制，不是即时本地开关。用户操作后，Adapter 必须先把目标解析为既有 `installAsset`、`convertAsset`、`editAsset` 或明确阻断，再进入 prepare／review／confirm／apply；不新增绕过闭环的通用 `setSkillEnabled` intent。`deleteAsset` 不属于 toggle 解析结果。
- 开启时，同格式目标走安装，可确定转换的异构目标走转换，无法安全映射时保持阻断；界面必须在进入确认前显示实际操作类别、目标 Agent、作用域、原生位置和差异。
- 关闭时，只有 Adapter 能证明目标存在原生停用语义时才可走 `editAsset`；不存在原生停用能力时，关闭 toggle MUST 禁用并解释原因，不得回落为 `deleteAsset`。删除目标资产只通过独立、显式的删除操作进入既有安全闭环。
- 单元格的实际状态只在 apply 成功并重读事实后更新；取消、冲突、失败或回滚期间保持原事实，并以 pending／结果状态解释当前事务。

### PD-UI-B2-04：Skill 安装／转换只使用 Agent toggle 主入口（已确认 A）

- 用户开启未启用的 Agent 单元格后进入目标设置；目标 Agent 由所选列确定，项目／全局作用域和原生位置默认继承当前资产上下文，但必须在 prepare 前保持可见且可修改。
- Adapter 根据源与目标原生格式把该事务解析为 `installAsset` 或 `convertAsset`；转换时继续展示能力映射，不能因入口是 toggle 而跳过 mapping、review、confirm 或恢复点。
- Skill 详情及列表的其它位置不再提供重复的“安装／转换…”主入口；阻断原因、pending 状态、事务结果与显式删除仍在对应单元格或详情中可达。

### PD-UI-B2-05：长期指令不提供跨 Agent 转换（已确认 B）

- MVP 不为长期指令提供 `convertAsset` 入口或“已验证转换”结果；任意指令正文不得仅因能够复制为 Markdown 就被视为跨 Agent 语义兼容。
- 用户仍可编辑当前 Agent 的原生长期指令，也可通过“新建”或“从本地导入”显式形成另一个目标 Agent 的原生资产；这些流程必须明确目标并经过既有草稿、审查、确认与事务写入。
- 创建／导入不得复用转换能力映射或暗示行为等价；正式产品基线、转换矩阵、fixtures 与 FE-06 验收范围需相应缩减。

### PD-UI-B2-06：Skill 默认只读查看，保留次级源码编辑（已确认 A）

- “查看 Skill”继续作为默认主表面，优先展示结构化身份、来源、兼容与 Agent 状态；不得因进入详情自动创建草稿或读取不必要的原生文件内容。
- 用户通过明确的次级“编辑源码”入口进入原生文件编辑；多文件、未知字段、注释、附属资源与只读边界继续按 Adapter 事实呈现，不把不完整结构化表单伪装成完整编辑能力。
- 源码更改使用既有 `editAsset` 草稿、dirty guard、review、confirm、apply、revision 重验和恢复点；该入口不重复承担安装或转换，后两者仍只从 Agent toggle 发起。

### PD-UI-B2-07：Subagents 默认只读，保留次级安全编辑（已确认 A）

- Subagents 在宽／中屏继续使用 master-detail，选中后默认展示结构化身份、模型、工具、权限、来源与只读正文；浏览本身不创建草稿。
- 用户通过明确的次级“编辑”入口后，才可修改 Adapter 已验证且能无损往返的结构化字段，以及原生 Prompt／配置源码；未知字段、扩展内容和不兼容结构必须保真或降级为只读。
- 所有更改使用既有 `editAsset`、单资产草稿、dirty guard、review、confirm、apply、revision 重验和恢复点；窄屏仍退化为列表 → 详情／编辑单表面栈。

### PD-UI-B2-08：Subagents 保留确定性跨 Agent 转换（已确认 A）

- Subagents 详情提供次级“转换…”入口，继续使用单一源资产、单一目标 Agent 和单一作用域的 target selection → mapping → review → confirm → apply 流程；不新增批量转换或矩阵式写入。
- Adapter 只映射目标版本已验证的模型、工具、权限及结构化配置；Prompt 与未知扩展内容只有可保真 round-trip 或无法保真即阻断两类结果，后者不得标记为降级、prepare 或 apply；其他无法证明安全的差异明确标记为人工处理、降级或阻断。
- 转换结果是目标 Agent 的独立原生资产，不与源 Subagent 持续同步；正式转换矩阵收敛为 Skills 与 Subagents 的 24 条有方向路径，长期指令与 Hooks 不进入 MVP 转换矩阵。

### PD-UI-B2-09：长期指令采用直接编辑、首次修改建草稿（已确认 A）

- 长期指令的 master-detail 右侧直接呈现 Markdown 编辑器；选择或聚焦编辑器本身不创建草稿，只有内容首次发生实际变化时才建立当前资产的本地草稿并显示明确 dirty 状态。
- 存在 dirty 草稿时切换资产或作用域必须经过既有 dirty guard；继续编辑保持原资产、草稿和焦点，明确放弃后才切换。只读、未知或不兼容结构必须禁用编辑并提供稳定原因。
- 直接编辑不等于直接保存：所有更改仍通过 `editAsset`、review、confirm、revision 重验、apply 和恢复点写入；应用成功并重读事实前，磁盘内容与实际生效状态不得提前变化。

### PD-UI-B2-10：列表正式语义只固化稳定不变量（已确认 A）

- 产品级规格只固化“筛选 → 固定段序 → 段内稳定排序 → 扁平化 → 单一全局分页”、聚合总数和允许页面跨越来源分段边界；`all` 先显示非空全局适用段，再显示按项目展示名稳定升序的非空项目段，同名项目以不透明 `projectId` 作确定性 tie-break；`global` 只显示非空全局资产段；`project` 先显示非空项目自有段，再显示已解析的非空全局适用段；空段不渲染。不得把每个来源段拆成独立分页，也不得以跨来源统一排序抹去来源边界。
- `20／50／100`、默认名称升序与每页 20、同名输入顺序、条件变化回第一页、翻页滚顶／首行焦点和搜索结果不分页属于 selected B2 的前端契约与 UI 验收参数，不提升为产品 capability MUST，也不要求服务端分页或新增 Gateway command。
- 全局搜索的产品不变量仍是：只定位 MVP 可见资产，不因搜索或选择结果创建草稿、prepare 写入或改变实际状态；具体结果呈现和焦点细节由前端契约约束。
