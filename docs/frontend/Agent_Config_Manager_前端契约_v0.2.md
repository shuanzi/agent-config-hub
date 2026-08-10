# Agent Config Manager：前端契约 v0.2

> 状态：**已验收；Frozen**
>
> 用户验收与冻结日期：`2026-08-10`（Asia/Shanghai）
>
> OpenSpec change：`adopt-selected-b2-ui-baseline`（task 1.7 已完成：独立只读复审、用户验收与冻结）
>
> 本文冻结正文 fingerprint：`sha256:dc5185eaf97eb2f9b93eeedb8ea047c268b087a97dd6d1d4e20b3a0076baccad`
>
> 本文 fingerprint 范围：本文首个 `## 1.` 标题至 EOF 的 UTF-8、LF 正文；不含标题与 metadata。
>
> 上位冻结产品正文 fingerprint：`sha256:ec28a44db79f019a92199a7d5853a71f15b593d1fe925bd0c6fd0eb65dbeee21`
>
> fingerprint 范围：`docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.2.md` 首个
> `## 1.` 至 EOF 的 UTF-8、LF 正文；不含标题与 metadata。
>
> 上位产品文件 SHA-256：`3bf19b9249caa66037553565c0d762f866f9a39f06ea1012101cf73b7a7c2abc`
>
> 历史 frontend contract v0.1 文件 SHA-256：`4d9ddac33aed18bc16396543ecf62f78797ac0c387ccc50cb8f3a475d48a0b10`
>
> Git anchor：`3296cd6`（origin/main 的 PR #7 merge commit）
>
> 冻结记录：task 1.7 的独立只读复审已完成；用户于 `2026-08-10` 明确验收并冻结本文。该冻结
> 只确认本 contract，不改变技术方案、ARCH/RELEASE gate、tracker、FE acceptance、wire、
> Gateway/Adapter、生产 UI 或运行时代码，也不关闭任何 ticket。

## 1. 目的、事实层级与复验

本文在冻结的产品基线 v0.2 之下，定义 selected B2 所需的 UI 行为、读取投影和计划的
fixture/evidence 责任。它继续是框架、IPC 和序列化方式无关的 frontend contract；不实现
或预设任何 Rust-first wire delta。

事实优先级为：冻结产品基线 v0.2 → 本冻结 v0.2 contract → 后续技术方案影响复核
或 addendum → FE acceptance/实现。发生冲突时必须回到上位层；不得从本文推断 ticket
ready/done 或 gate 状态。

metadata 可按下列只读命令复验：

```sh
shasum -a 256 docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.2.md
shasum -a 256 docs/frontend/Agent_Config_Manager_前端契约_v0.1.md
awk 'found { print } /^## 1\. / { found = 1; print }' \
  docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.2.md | shasum -a 256
awk 'found { print } /^## 1\. / { found = 1; print }' \
  docs/frontend/Agent_Config_Manager_前端契约_v0.2.md | shasum -a 256
git merge-base --is-ancestor 3296cd6 HEAD
git merge-base --is-ancestor 3296cd6 origin/main
```

前四项分别必须等于本文 metadata 的产品文件 SHA、v0.1 文件 SHA、上位冻结产品正文
fingerprint 与本文冻结正文 fingerprint；最后两项必须成功，分别验证 `3296cd6` 是当前 `HEAD`
和 `origin/main` 的祖先。任何上位输入漂移或本文冻结正文变化，均使本次冻结失效，必须重建、
重新完成 task 1.7 的独立只读复审和用户验收，不得只改 metadata 继续使用。

## 2. 相对 v0.1 的覆盖与显式继承

v0.1 是已验收的历史合同，原文不得改写。本文件只对 selected B2 点名冲突给出 v0.2
替代；未列项目继续继承 v0.1。

| v0.1 范围 | v0.2 处置 | v0.2 的有效规则 |
| --- | --- | --- |
| `FrontendGateway`、`read`/`prepare`/`apply`/`observe` seam | 继承 | `read`、`prepare`、`observe` 无写；`apply` 是唯一变更入口，revision-bound 重验和事件后重读继续有效。 |
| 原生资产、opaque identity、单资产单目标、安全事务、恢复、Git 只读 | 继承 | 原生资产仍是唯一事实来源；投影不产生副本，所有写入仍经 `prepare → review → confirm → apply` 与恢复。 |
| 未知字段/注释/格式保真、敏感遮蔽、可执行内容不执行 | 继承并为 FX-03 细化 | 不能以 UI 模型丢失未知内容；敏感明文不进入搜索、事件、日志或 fixture；可执行内容只读和静态校验。 |
| 四类一级导航、Hook 正向搜索/详情/创建/转换 journey | 替代 | MVP 可见集合改为 `MvpAssetType`；Hook 只保留 wire/安全/负向可达性覆盖。 |
| 旧 `AssetListQuery` 的当前/全部范围、无固定段序的默认列表 | 替代 | 使用本文件的 workbench/global-locator 双模式、三种 view context、固定段序和单一全局分页。 |
| 默认源码、统一详情/编辑、固定常驻辅助检查器容器 | 替代/细化 | 采用三类 type-specific surface；辅助信息必须可达，但不恢复固定第四容器或其尺寸/浮层参数。 |
| 四类资产的 48 条转换与通用转换入口 | 替代 | 仅 Skills/Subagents 的 24 条有方向路径；长期指令和 Hook 均无转换。 |
| v0.1 fixture catalog、traceability matrix、旧 FE-01 bootstrap 归属 | 历史保留；本文件建立 B2 计划层 | FX-01–18 仍保留责任，另计划 FX-19；FE-07R 的 FX-19 contract 主归属已由本文冻结确认。foundation transfer，以及 tracker、evidence registry、FE acceptance 和运行时 ownership 落地仍属 task 1.8+，未执行；本冻结不改写架构/registry/tracker。 |

v0.1 中未被上述替代的 `PrepareFailed`/`GATEWAY_UNAVAILABLE`、`ReadFailed`、稳定原因码、
`ActionAvailability`、单活动草稿、dirty guard、冲突重 prepare、可恢复删除、导出边界及
无隐式 Git 操作均继续有效。本文件不得把 Mock 交互或静态文档检查升级为这些不变量的
运行时证明。

## 3. 规范词汇与只读读取模型

### 3.1 可见类型与 wire 兼容

```text
MvpAssetType  = 'skill' | 'longTermInstruction' | 'subagent'
WireAssetType = MvpAssetType | 'hook'
```

`WireAssetType` 是 decode 边界：Adapter/wire 必须能保留 `hook` 以及未知字段的兼容事实。
`MvpAssetType` 是工作台、全局定位和创建入口的封闭集合。任何 wire `hook`、历史选择、
缓存或直接引用都不得转换成 MVP 工作台目的地、详情、编辑或转换入口；应返回“无可用
MVP 目的地”的稳定负向结果。

四个固定 Agent target 为 `claude-code`、`codex`、`gemini-cli`、`opencode`，其列序固定且
不得由 UI、排序或 fixture 临时重排。

### 3.2 `AssetRef` 与原生归属

`AssetRef` 至少由 opaque `assetId`、`assetType: WireAssetType`、opaque `nativeUnitRef`、
`adapterIdentity` 和如下语言无关的 `NativeOwnership` 组成：

```text
NativeOwnership = global | project(opaque non-empty projectId)
```

`global` 不得携带 `projectId`；`project(projectId)` 必须携带非空 opaque `projectId`。底层的
`nativeScope`/`nativeProjectId` 字段名和 wire 编码后置到 Rust-first review，且必须能无歧义映射到
此 union。缺字段、空 project ID 或 global/project 矛盾组合一律为稳定 `ReadFailed` 的 fail-closed
读取结果，不得产生 `AssetRef`、投影或 locator destination。路径、项目展示名和项目路径仅为
显示/消歧事实，均不能充当身份。

列表的 `viewContext` 与资产的 `NativeOwnership` 分离。尤其是项目视图中显示的全局适用资产，
仍携带其 **global `AssetRef` 和 global `NativeOwnership`**；选择、`editAsset`、审查和 apply
均写回那个原生全局资产。确认前必须展示所有 resolved 的受影响 context，绝不隐式创建
项目副本。

### 3.3 `EffectiveContext` 与封闭失败

`EffectiveContext` 是某 global `AssetRef` 对一个具体 opaque `projectId` 的版本化适用性
事实，不是由项目名、路径、Mock seed 或 UI 猜出的关系。它至少含：

| 字段组 | 必需事实 |
| --- | --- |
| `adapter` | Adapter identity、version 与明确的 `builtIn` 或 `activePackage` provenance；后者还含 package identity 与 version。 |
| `rule` | 规则 identity、rule version 与规则来源（built-in rule 或某 active package 的 identity/version）；不得由 UI 猜测。 |
| `revision` | 产生该事实的 authoritative read revision。 |
| `context` | opaque `projectId`；展示名/路径只可作为非身份提示。 |
| `source` | global 原生来源、source tier 与对应 `AssetRef`。 |
| `load` | 确定的加载顺序。 |
| `priority` | 适用规则所用优先级事实。 |
| `override` | 覆盖/被覆盖关系及其可解释锚点。 |
| `resolution` | `resolved`、`unknown`、`blocked` 或 `stale`；非 `resolved` 必有稳定 reason code。 |

只有 `resolution=resolved`、且 Adapter/rule/revision 仍匹配当前权威读取的事实，才可将 global
资产投影到该 project 的“全局适用”段。`unknown`、`blocked`、`stale` 都必须 fail-closed：
**必须**在 `all`/`global` 中作为可检查 finding 显示，但不得进入任何 project 的全局适用段。
版本、revision 或受影响 context 集合变化时，旧投影和旧审查失效；`prepare` 前与 `apply`
前均须重读并重新计算/审查/确认。

### 3.4 `AssetListQuery` 与 snapshot 的封闭映射

`AssetListQuery` 与 snapshot 是一一对应的 discriminated union：

```text
workbench AssetListQuery    → WorkbenchActualReadSnapshot
globalLocator AssetListQuery → GlobalLocatorSnapshot
```

二者合称 `AssetListSnapshot`，但不得返回混合 shape。它们都是语言无关的只读事实快照；
具体 wire 字段名、编码和生成语法仍后置到 Rust-first review，不由本 contract 预设。

`WorkbenchActualReadSnapshot` 绑定查询、**authoritative read revision**、各
`EffectiveContext` 的 Adapter/rule provenance、读取时间和用于投影的 native `AssetRef`：

| 字段组 | 必需事实 |
| --- | --- |
| `query` | 完整回显本次 workbench query 的 mode、asset type、view context 与 closed filters。 |
| `authoritativeReadRevision` | 本次读取的权威 revision；任何后续 event 或重读变化均使其不能继续充当最新事实。 |
| `segments` | 按第 4.2 节固定顺序排列的非空段。每段包含 opaque segment identity、source、display label、适用时 opaque `projectId`，以及其 `AssetRef` summaries；每条 summary 必须携带 authoritative `sortBaseName`，它是第 4.1 节唯一排序键。 |
| `authoritativeInputOrder` | 每段由权威读取给出的输入顺序。它只用于同名稳定 tie-break，不要求向用户显示序号。 |
| `filterStatusFacts` | 每条 summary 的权威 `agentTargets` 集合、精确 `sourceTierId`、v0.1 `AssetCapabilities.edit`/`editAsset`-specific `ActionAvailability`、`CompatibilityStatus`、override relation、conflict/drift anomaly facts 与继承 normal fact；它是 §4.1 筛选的唯一事实输入，不要求或预设新的 wire 字段。 |
| `effectiveContexts` / `findings` | 投影使用的 `EffectiveContext`，以及在 all/global 中必须可检查的 unknown/blocked/stale finding。 |
| `aggregateTotal` / `indexStatus` / `readAt` | 扁平化前后可核对的聚合总数、索引状态和本次权威读取时间。 |

`GlobalLocatorSnapshot` 只对应 `globalLocator` query，必须含三类固定 `groups`、每组及总
`count`、按 `AssetRef` 的 native identity 去重的结果、redacted summary、authoritative order，
以及每行显式 `destinationViewContext`。目的地是 `NativeOwnership` 的全函数：`global → global`，
`project(projectId) → project(projectId)`。前端必须消费该显式字段，不得从当前浏览 scope、global
asset 恰好适用于某项目，或任何未进入该 union 的底层信息反推目的地。

`AssetListSnapshot` 只描述之后 FE-07R/FE-01 所需的 read seam，不声明该 seam 已实现：

- 它不得含写入 intent、prepared operation、可重放 payload 或由搜索生成的草稿；
- event 只可使快照失效，随后必须再次 `read`；
- `resolution` 非 resolved 的 global asset 必须保留在 all/global 的 findings，不可伪装为
  project projection；
- “actual-read”只有在相应 ticket 的真实读取路径和 provenance 证据实际运行后才可作为
  evidence 名称。本文冻结契约、OpenSpec、fixture 和 Mock 均不取得该 credit。

## 4. `AssetListQuery`、列表投影与搜索

### 4.1 两种封闭模式

`AssetListQuery` 只有以下模式；它是对 v0.1 列表 query 的 B2 细化，不新增 Gateway command。

| 模式 | 必需输入 | 输出与边界 |
| --- | --- | --- |
| `workbench` | 一个 `assetType: MvpAssetType`、一个 `viewContext` 和 canonical closed `WorkbenchFilters` | 返回完整 `WorkbenchActualReadSnapshot`；不携带 sort、page 或 page size。 |
| `globalLocator` | `searchText` 与三类 `MvpAssetType` 的固定集合 | 只定位，不接受 `page`；返回不分页的 `GlobalLocatorSnapshot` 三类型分组与显式 native 目的地。 |

`ViewContext` 为封闭 union：`all`、`global` 或 `project(projectId)`。`projectId` 始终 opaque。
`workbench` 的 closed filters 是以下精确的语言无关 `WorkbenchFilters`，只收窄读取结果，不能
授权写入或改变原生事实：

| 字段 | 值域与集合语义 |
| --- | --- |
| `agents` | 四个固定 target `claude-code`、`codex`、`gemini-cli`、`opencode` 的集合。 |
| `sourceIds` | 非空 opaque source ID 的集合。 |
| `statuses` | `editable`、`readOnly`、`incompatible`、`normal`、`overridden`、`conflict` 或 `drift` 的集合，沿用 v0.1 状态语义。 |
| `projectIds` | 非空 opaque project ID 的集合；只允许 `viewContext=all`，且只收窄 project-native 段。 |

字段缺省或 input 空集合都表示“不约束”；canonical form 中无约束字段**只能省略**，query echo
也只能以省略表示，不得回显空数组。每个非空集合内部是 OR，所有非空字段之间是 AND。每个集合
按集合语义 canonicalize/dedupe：`agents` 按固定 target 列序、`statuses` 按上表列序、opaque
`sourceIds`/`projectIds` 按 UTF-8 unsigned-byte lexicographic 顺序回显。

唯一的 row predicate 消费同一次 `WorkbenchActualReadSnapshot.filterStatusFacts`，前端不得由标签、
显示名或缺失信息猜测：`matches = P_agents ∧ P_source ∧ P_status ∧ P_project`，其中缺省字段的
`P` 恒为 true，非空集合的 `P` 只要内部任一成员命中即为 true。`P_agents` 必须与该 row/summary
的 authoritative `agentTargets` 相交；`P_source` 必须精确命中 authoritative `sourceTierId`；
`P_status` 必须与该 row 的 status membership 相交；`P_project` 只在 `all` view 的 project-native
segment 上与其 opaque `projectId` 比较并收窄该段，对 global-applicable segment 恒为 true。status
membership 的无歧义映射为：

| 筛选 status | 仅可使用的权威事实 |
| --- | --- |
| `editable` | v0.1 `AssetCapabilities.edit` 的 `editAsset`-specific `ActionAvailability=allowed`，且 `CompatibilityStatus=verifiedWritable`。export/delete/convert 等其他 operation 即使为 allowed 也不得命中。 |
| `readOnly` | v0.1 `CompatibilityStatus=recognizedReadOnly`。 |
| `incompatible` | v0.1 `CompatibilityStatus=incompatibleBlocked`。 |
| `overridden` | 权威 override relation 存在。 |
| `conflict` / `drift` | 对应权威 conflict/drift anomaly fact 存在。 |
| `normal` | 权威继承 normal fact 明确为“无异常且无阻断”；前端不得以其他 status 的缺失自行推导。 |

这些 memberships 可以重叠；只有 snapshot 给出的事实决定归属。query echo 必须回显上述 canonical
closed filters，而非原始输入。未知字段、空 ID、非法 enum，或非 `all` 视图携带 `projectIds` 等
非法组合，必须拒绝为稳定 `ReadFailed`；不得静默忽略、降级或扩展为 v0.1 的 `groupBy`、展示名、
路径或任意字段过滤。

排序和分页属于 frontend-local `ListPresentationState`，不属于 Gateway query：

| 字段 | 封闭规则 |
| --- | --- |
| `nameSort` | `asc` 或 `desc`；唯一排序字段为 authoritative `sortBaseName` 的 NFC Unicode 规范化值。比较器固定为 `Intl.Collator('zh-CN', { usage: 'sort', numeric: true, sensitivity: 'variant', caseFirst: 'false', ignorePunctuation: false })`；相等比较结果以 `authoritativeInputOrder` 升序 tie-break。降序只能反转非相等键，不能数组 reverse。 |
| `pageSize` | 仅 20、50、100；默认 20。 |
| `page` | 从 1 起；首次进入默认第 1 页。 |

首次进入 `workbench` 的默认值为 `assetType=skill`、`viewContext=all`、`nameSort=asc`、
`pageSize=20`、`page=1`。任一 closed filter、资产类型、作用域、排序方向或页大小变化，均将
`page` 原子重置为 1。前端只在完整 actual-read projection 上按第 4.2 节派生排序/页视图；
这既不要求服务端分页，也不新增 wire command。

### 4.2 精确段序与单一全局分页

每个 `workbench` 读取按下列顺序处理：**筛选 → 固定段序 → 段内稳定名称排序 → 扁平化 →
单一全局分页**。总数是扁平化后集合的聚合总数；页边界允许截断一个来源段。空段不渲染，
不得给各段建立独立分页。

| `viewContext` | 过滤后的固定段序 |
| --- | --- |
| `all` | 非空 global-applicable（全局资产）段在前；随后每个非空 project-native 段。project display name 先作 NFC Unicode 规范化，再用 `Intl.Collator('zh-CN', { usage: 'sort', numeric: true, sensitivity: 'variant', caseFirst: 'false', ignorePunctuation: false })` 升序；比较相等时以 opaque `projectId` 的 UTF-8 unsigned-byte lexicographic 升序 tie-break，绝不用权威输入顺序 fallback。global 资产不因适用于项目而复制为项目资产。 |
| `global` | 仅非空 global 资产段；其 unknown/blocked/stale applicability **必须**作为 finding 可检查，但不是 project projection。 |
| `project(projectId)` | 先该项目的非空 project-native 段；再仅含 `EffectiveContext.resolved` 的非空 global-applicability 段。unknown/blocked/stale 一律排除。 |

段内只对 `sortBaseName` 使用第 4.1 节的 stable collation；段顺序、项目段顺序及 global/project
原生归属不受名称排序方向改变。权威重读后，若当前页超过最后有效页，必须 clamp 至最后有效
页；若 `aggregateTotal=0`，页码固定为 1，列表滚动至顶部并聚焦真实 empty state 的标题。其他
翻页后列表滚动到顶部，并把键盘焦点交给新页第一行。

### 4.3 全局定位搜索与焦点

右上入口与 `⌘K` 必须打开同一个 `globalLocator`，并在打开时捕获当前 active focus 为 return
target；该 target 失效时唯一 fallback 是全局搜索按钮。`searchText` 先 `trim`；空字符串不返回
结果并显示稳定“输入搜索词”提示。非空查询对 name、type、Agent、可显示 native ownership hint、project display
hint 和 **redacted summary** 的每个字段分别作 NFC Unicode 规范化、Unicode default case-fold，
再进行 code-point substring 匹配。不得 token、semantic 或 fuzzy 匹配，且不得读取未遮蔽的
summary/敏感内容；显示名称和原有大小写不被改写。结果显示聚合 count，并严格按 Skills、长期指令、
Subagents 三个固定类型分组；组内保留 authoritative order，不分页，不呈现 Hook。每个结果行
至少显示 name、redacted summary、project-or-global hint 与 Agent；无匹配时显示稳定 empty state。

打开或输入 locator 只有只读效果，不改变 workbench 现有 query、实际状态、草稿、prepared
operation 或权限。提交结果是 context switch：若有 dirty draft，必须先走既有 dirty guard，继续
编辑时恢复原编辑器焦点，明确放弃后才可继续。若处于 `prepared`、reviewing、confirming 或
`reprepareRequired`，必须先显式退出该事务，使旧 mapping、prepared operation、review 与 confirm
全部失效，才可切换；不得静默丢弃。若正在 applying 或结果未知，切换必须被禁止并给出稳定原因。
旧 operation identity、diff 或 summary 绝不能进入新的 `AssetRef`/context。

允许提交时，选择一个结果必须原子提交该结果的 type、snapshot 显式
`destinationViewContext`、`AssetRef` 和详情目的地；导航完成后固定聚焦可编程的详情主标题，若详情
无法建立则聚焦详情错误标题。关闭搜索而未提交时恢复捕获的 return target（失效时回到全局搜索按钮）。
搜索和选择结果绝不创建草稿、`prepare`、`apply` 或写入。

## 5. Skill 四 Agent 目标状态

每个 Skill 有四个固定、语言无关的 `SkillTargetState` 单元格。它是事务式期望状态控制，
不是即时开关：

| 字段 | 封闭状态与含义 |
| --- | --- |
| `presence` | `absent`、`present`、`unknown`、`blocked` 或 `stale` 的权威 target 存在事实。 |
| `activation` | `notApplicable`、`enabled`、`disabled`、`unknown`、`blocked` 或 `stale`；仅 absent 时为 `notApplicable`，仅 present 时可为 enabled/disabled。 |
| `applicability` | 当前 target scope 的 `resolved`、`unknown`、`blocked` 或 `stale` 适用事实。 |
| `enableAvailability` / `disableAvailability` | 各自的 `allowed`、`disabled(reasonCode)` 或 `blocked(reasonCode)`；不是删除权限的替代。 |
| `pending` / `stableReason` | 可选 opaque operation identity 与阶段，以及不可用、阻断、未知或 reread 未完成时的稳定 reason code 和可读解释。 |

开启单元格必须先进入目标设置；所选列固定目标 Agent，target scope 与 native location 在首次
`prepare` 前可见且可修改。Adapter 的操作映射封闭如下：

| 权威 facts | 开启 | 关闭 |
| --- | --- | --- |
| `presence=absent`，其余事实可判定 | 仅 `installAsset`、`convertAsset` 或 `blocked`。 | 不适用。 |
| `presence=present`、`activation=disabled` | 仅已验证 native activation 语义时为 `editAsset` 重新启用；否则 `disabled` 或 `blocked`。 | 不适用。 |
| `presence=present`、`activation=enabled` | no-op，不产生安装、转换或写入。 | 仅已验证 native activation 语义时为 `editAsset` 停用；否则 `disabled` 或 `blocked`。 |
| presence、activation 或 applicability 任一为 `unknown`、`blocked` 或 `stale` | fail-closed：`disabled` 或 `blocked`，不得 `prepare`/`apply`。 | 同左。 |

无论首次 `prepare` 前或后，target scope/native location 任一变化都必须先针对新 target
authoritative reread presence、activation 与 applicability，并重新解析 operation。旧 mapping
立即失效且不得沿用；已有 prepared/review/confirm 也全部失效。只有新 mapping 通过
prepare/review 后才可继续；确认摘要必须给出操作类别、目标 Agent、scope、native location、
capability mapping 和 diff。Skill 安装/转换只由对应 Agent 单元格主入口发起，列表或详情不得
另设重复主入口；delete 仍是独立显式操作，产品不新增 `setSkillEnabled`。

presence/activation 只能在 `apply` 成功且受影响事实 authoritative reread 后更新。取消、冲突、
失败、回滚或 apply 成功但 reread 失败时，保留先前事实，用 `pending` 或稳定结果原因解释，
而不乐观显示目标状态。

## 6. 类型表面、编辑映射与转换边界

三类表面共享一个活动草稿、dirty guard、review、confirm、apply、revision 重验和恢复；
不同表面不能绕过该闭环。

| 类型 | 宽/中屏主表面 | 编辑与 native 写回 | 转换 |
| --- | --- | --- | --- |
| Skills | 默认只读结构化详情，展示身份、来源、兼容和四 Agent 状态。 | 明确次级源码编辑才读取/编辑原生内容，映射 `editAsset`；多文件、未知字段、注释、附属资源和只读边界须如实呈现。 | 仅由四 Agent 单元格发起。 |
| 长期指令 | master-detail 的直接 Markdown 编辑器。 | 选择或聚焦不建草稿；首次实际内容差异才建 dirty draft，并映射 `editAsset`。只读、未知或不兼容时禁用并给稳定原因。 | 明确排除；创建/导入是独立 native asset creation。 |
| Subagents | 默认只读 master-detail，展示身份、模型、工具、权限、来源和正文。 | 明确次级安全编辑才允许 Adapter 已验证可无损往返的字段及原生 Prompt/config 源码，映射 `editAsset`；未知/扩展/不兼容内容保真或只读。 | 仅由详情次级转换入口发起。 |

窄屏统一退化为 type → scope → list → detail/edit 单表面栈，并保留返回相同 type/scope/list
的路径。project 视图中的 global asset 仍按第 3.2 节的 native global `AssetRef` 写回。

### 6.1 类型特定辅助信息、控件与焦点

路径、生效上下文、来源/覆盖、兼容/漂移、最近变更、恢复点和关键安全状态均须可达，但不恢复
固定第四 inspector。关键安全状态（blocked/unknown/stale、兼容只读、敏感遮蔽、可执行内容风险、
冲突和待重读）始终在当前详情/编辑/审查表面的就近状态条中可见，不能只藏在可收起区域。

| 类型 | 承载位置与信息 | 控件与默认展开 |
| --- | --- | --- |
| Skills | 只读结构化详情内的“来源与上下文”与“历史与恢复” disclosure 承载路径、生效上下文、来源/覆盖、兼容/漂移、最近变更和恢复点；关键安全状态置于详情标题下的就近状态条。 | 两个 disclosure 默认收起；“查看辅助信息”按钮、各段 heading 与 path copy 均可键盘操作。 |
| 长期指令 | master-detail 的当前详情/编辑栏内，“来源与上下文”与“历史与恢复” disclosure 承载同一组事实；关键安全状态置于 Markdown 编辑器上方，且不随编辑器聚焦/草稿变化隐藏。 | 两个 disclosure 默认收起；编辑器之外的“查看辅助信息”按钮打开对应组，path copy 与恢复点动作保持单独可达。 |
| Subagents | master-detail 的只读详情内，“来源与上下文”与“历史与恢复” disclosure 承载同一组事实；关键安全状态置于正文/次级编辑入口之前。 | 两个 disclosure 默认收起；“查看辅助信息”、path copy、恢复点与次级编辑的语义顺序固定。 |

| 屏幕与旅程 | 键盘进入、退出与焦点恢复 |
| --- | --- |
| 宽/中屏 | 从当前类型的详情/编辑表面以“查看辅助信息”按钮进入；`Enter`/`Space` 展开或激活控件，`Escape` 关闭当前 disclosure/临时辅助表面并恢复至发起按钮。若为长期指令 dirty guard 阻止切换，则恢复编辑器焦点。 |
| 窄屏 | 在 detail/edit 单表面页从“辅助信息”按钮进入；返回或 `Escape` 回到该页的同一按钮，随后才能沿既有返回路径回到列表。关键安全状态在按钮前的状态条中保持可读。 |

辅助信息的展开状态是 frontend-local 状态，不覆盖单活动草稿、列表选择或安全事务，也不形成
新的常驻栏宽、边缘轨道或浮层合同。

确定性转换完整集合为两种类型各 4 × 3 条，共 24 条有方向边界：

| 资产类型 | 源 Agent | 可分析的不同目标 Agent（每格各一条） |
| --- | --- | --- |
| Skill | Claude Code | Codex、Gemini CLI、OpenCode |
| Skill | Codex | Claude Code、Gemini CLI、OpenCode |
| Skill | Gemini CLI | Claude Code、Codex、OpenCode |
| Skill | OpenCode | Claude Code、Codex、Gemini CLI |
| Subagent | Claude Code | Codex、Gemini CLI、OpenCode |
| Subagent | Codex | Claude Code、Gemini CLI、OpenCode |
| Subagent | Gemini CLI | Claude Code、Codex、OpenCode |
| Subagent | OpenCode | Claude Code、Codex、Gemini CLI |

每次只允许一个 source asset、一个 target Agent 和一个 target scope，仍经 target selection →
mapping → review → confirm → apply。仅映射当前 target version 已验证的结构；Prompt 与未知
扩展内容只能 **lossless round-trip** 或 **blocked**，绝不能显示为 degraded/prepared/applied。
模型、工具、权限等其他不能证明安全映射的差异，必须在写入前明确为 manual work、degraded
或 blocked。raw-copy 不是转换，不得生成转换结果或绕过闭环；成功结果是独立 native asset，
不与源持续同步，且只在 apply 成功和 authoritative reread 后才显示实际可用。

## 7. Fixture catalog（计划，不是执行证据）

所有 fixture 仅使用 synthetic 路径、占位敏感值和不可执行 Hook 文本。下表保留 v0.1 的
FX-01–18 责任，并按 v0.2 范围收敛其 journey；“计划 owner”不是 ticket closure 或 runtime
evidence 声明。

| Fixture | v0.2 计划责任 | 计划 owner |
| --- | --- | --- |
| FX-01 `single-skill-ready` | 三类可见导航、默认 Skills+all、canonical `WorkbenchFilters` 的复合 OR/AND predicate、canonical echo、非法组合 `ReadFailed` 与重叠 status，以及 export/delete/convert 允许但 `AssetCapabilities.edit` disabled 时不得命中 `editable` 的反例、列表 actual-read 输入、只读 Skill cell；还覆盖固定三分组/count/authoritative order 的 locator，以及 global/project `NativeOwnership`→destination 的成功选择 journey，并覆盖 `sortBaseName` 的 NFC、数字、大小写、标点与同名 authoritative input order。 | FE-01 |
| FX-02 `multifile-skill-mixed` | 多文件/非文本只读、结构化/原生事实边界。 | FE-02 |
| FX-03 `executable-hook-unknown` | 本文第 8 节的 Hook decode/security 与 UI 不可达负例。 | FE-02 |
| FX-04 `dirty-multifile-draft` | 单活动草稿、dirty guard、未知/敏感内容保真；locator 提交时 continue-editing 不提交、不切换，只有 discard 后才原子提交 type + destination + `AssetRef` + detail。 | FE-03 |
| FX-05 `review-git-drift-conflict` | review、drift、`REPREPARE_REQUIRED`、敏感 diff 遮蔽，以及 locator 提交前显式退出事务/旧 mapping 失效；Skill 的 `present+disabled` 且 verified native activation 重新启用映射 `editAsset`，任一未验证 activation 只为 disabled/blocked、不得 prepare/apply/delete；首次 prepare 前与 prepare 后 target scope/location 变化均 reread/remap 并使旧 mapping/prepared/review/confirm 失效。 | FE-04 |
| FX-06 `unknown-agent-version` | 只读/disabled 原因与 Adapter 能力事实。 | FE-08 |
| FX-07 `stale-index-projects` | 项目管理、event 后权威重读与 index 健康。 | FE-07 |
| FX-08 `create-import-validation` | 独立创建/导入、单一目标与无副作用 prepare。 | FE-05 |
| FX-09 `conversion-complete` | 已验证的单目标转换与确认前 mapping。 | FE-06 |
| FX-10 `conversion-degraded` | 非 Prompt/未知内容的明确 manual/degraded 风险。 | FE-06 |
| FX-11 `conversion-blocked` | 无安全映射时不产生可应用结果。 | FE-06 |
| FX-12 `sensitive-narrow-keyboard` | 窄屏、键盘/焦点恢复、减少动态效果与敏感授权边界，以及 20/50/100（默认 20）、稳定 asc/desc、条件变化回第 1 页、翻页滚顶/首行焦点；还覆盖 locator 的 trim 空查询提示、NFC+case-fold code-point 匹配、仅 redacted summary、return focus/全局搜索按钮 fallback 与详情/错误标题焦点。 | FE-10 |
| FX-13 `delete-export-recover` | 独立导出、删除、恢复和占用阻断。 | FE-09 |
| FX-14 `adapter-update-rollback` | registry candidate/rollback 的管理事实。 | FE-08 |
| FX-15 `install-single-target` | 同格式 install、单源单目标、review/confirm/recovery。 | FE-05 |
| FX-16 `asset-write-result-branches` | prepare/apply 分支、回滚与结果 identity，以及 applying/结果未知时 locator 不得切换 context；Skill 的 `present+enabled` 且 verified native activation 停用映射 `editAsset`，apply 成功但 reread 失败时保留旧 presence/activation。 | FE-04 |
| FX-17 `target-name-collision` | cancel/rename/reviewAndOverwrite 后重 prepare。 | FE-05 |
| FX-18 `gateway-prepare-unavailable` | `PrepareFailed(GATEWAY_UNAVAILABLE)` 的上下文保留和无写。 | FE-04 |
| FX-19 `project-applicability-projection` | 同名不同 `projectId`、active/built-in/package Adapter/rule/revision provenance、resolved/unknown/blocked/stale、all/global/project actual-read 段序、all/global finding 可检查、fail-closed 排除、global `AssetRef` native ownership 与无写。 | **FE-07R（由本文 Frozen contract 确认的 contract 主归属；tracker、evidence registry、FE acceptance 与运行时 ownership 落地仍属 task 1.8+、未执行）** |

FX-19 不得使用 selected B2 Mock “所有 global seed 均适用于项目”的演示假设。它的 L0/L1/L3
计划只读验证必须分别保持同名项目的 opaque identity，证明只有 resolved 进入 project global
applicability segment，并记录 active/built-in/package Adapter/rule/revision provenance；对每个
unknown、blocked、stale 断言其在 all/global 可检查、在 project 段排除，且断言 global native
`AssetRef` 保持 global ownership。列表 fixture 必须另断言 project display name 的数字、大小写、
标点、Unicode 等价（NFC 后相等）与同名不同 ID 排序；同名 ID 仅以 UTF-8 unsigned-byte
lexicographic 规则决定，随后按固定段序扁平化并以单一全局分页，确保跨段页边界可复验。该 fixture
不含项目纳入/停止管理/index lifecycle、prepare/apply、业务写入、L2 UI journey 或 PF。

## 8. FX-03 Hook 兼容与安全负例

FX-03 仍要求 Adapter/wire 能 decode `WireAssetType='hook'`，保留 unknown fields，并在可执行
内容上报告 `EXECUTABLE_CONTENT_RISK`。所有内容表面默认遮蔽敏感值；Hook、Skill script 和
plugin code 只可静态展示/校验，任何 Query、fixture、搜索、事件或 intent 都不得执行它们。

FX-03 的 L0/L1 contract-security 覆盖包括 decode、unknown-field preservation、风险原因码、
masking 和 no-execution。L2 只有一个负向可达性断言：Hook 不在 MVP 一级导航、global locator、
创建入口、详情或转换目的地中。它没有 Hook 浏览、编辑、转换或其他正向 UI journey，也没有
以 Hook 执行取得 L3/PF credit 的路径。

## 9. Coverage 与 evidence 责任矩阵（计划）

层级含义严格继承技术方案 v0.1：L0 只证明静态/生成一致性，L1 证明 module/contract，L2
是 mock `FrontendGateway` 的 browser journey，L3 只有隔离输入穿过真实 WebView/Core/IPC
边界后才可称 actual runtime；PF 是独立 synthetic performance descriptor。层级之间不得借用
provenance。

| Ticket | 计划 L0/L1/L2/L3/PF | contract/security 责任与不可宣称事项 |
| --- | --- | --- |
| FE-07R | L0/L1/L3 的 **actual-read slice**；**无 L2、无 PF**；FX-19。 | 只读 opaque `projectId`、active/built-in/package Adapter/rule provenance、resolved/unknown/blocked/stale fail-closed 与 all/global/project projection。无业务写入、项目 lifecycle、prepare/apply 或 UI。FX-19 的 FE-07R contract 主归属由本文冻结确认；tracker、evidence registry、FE acceptance 与运行时 ownership 落地仍属 task 1.8+、未执行；其 evidence 不可借给 FE-01 closure。 |
| FE-01 | L0/L1、L2 list/read-session、L3 start/read/event/reread、PF-01；FX-01。 | 三类导航、段序、`WorkbenchFilters` predicate/canonical echo、固定 locator 分组/count/order、`NativeOwnership` destination 成功选择、搜索无写与只读 Skill cells；复用 FE-07R snapshot/foundation 但必须在自身 ticket 取得自身 L0–L3/PF-01 evidence。 |
| FE-02 | L0/L1、L2 FX-02/03、L3 actual multi-file read、PF-02/03 read。 | 类型只读 surface 与 FX-03 contract/security；L2 仅 Hook UI 不可达，无 L3 write。 |
| FE-03 | L0/L1、L2 FX-04、PF-02/03 edit；**无 L3**。 | 三类 `editAsset` 草稿、dirty guard、未知内容保真/只读，以及 locator 提交的 continue-editing 无提交/无切换、discard 后原子 destination；不得取得 actual Tauri IPC 或磁盘写入 credit。 |
| FE-04 | L0/L1、L2 FX-05/16/18、L3 isolated-temp prepare/apply/conflict/recovery、PF-04。 | 共享事务、重验、global `AssetRef` 原生写回、受影响 contexts、locator context switch 的旧事务失效/applying 禁止、Skill verified activation 的 `editAsset` re-enable/disable、未验证 activation 的 no prepare/apply/delete、target scope/location 前后 reread/remap 与 apply 成功但 reread 失败保留事实，及 no-delete fallback。其 L3 只证明隔离输入的真实边界，不证明真实用户项目/配置/production artifact。 |
| FE-05 | L0/L1、L2 FX-08/15/17、L3 isolated-temp create/import/install collision；**无新增 PF**。 | 独立创建/导入和同格式 install 的单目标安全边界，不包含 convert；L3 provenance 仅限隔离输入。 |
| FE-06 | L0/L1、L2 FX-09/10/11、L3 isolated-temp single-target conversion、PF-06。 | 24 路、lossless-or-blocked、raw-copy 拒绝与 no-sync；L3 provenance 仅限隔离输入。 |
| FE-07 | L0/L1、L2 FX-07、L3 isolated-temp project/event/rebuild、PF-05。 | 项目纳入/停止管理/index；复用 FE-07R projection types，不夺取 FX-19/read-resolver 主归属；L3 provenance 仅限隔离输入。 |
| FE-08 | L0/L1、L2 FX-06/14、L3 synthetic candidate/switch/rollback、PF-07。 | Adapter registry/bundle、capability 与 rollback；不得实现 Skill cell UI，且绝不称 L3 synthetic candidate 为真实 Adapter bundle actual provenance。 |
| FE-09 | L0/L1、L2 FX-13、L3 isolated-temp export/delete/recover collision、PF-06 recovery。 | export/delete/recover 独立于 toggle/FE-04；L3 provenance 仅限隔离输入。 |
| FE-10 | L0/L1、L2 FX-12；**无 L3、无 PF**。 | 宽/中/窄、精确列表控件/焦点/搜索、locator 的空查询/匹配/return-focus/error-heading 负例与四 Agent 状态可访问性；不得验收 FE-03–09 写入，亦不接管真实 adapter 回归。 |

FE-04–FE-09 的 L3 均须明确标注 isolated/synthetic input 的边界：即便通过真实
WebView/Core/IPC，也不证明真实用户项目、配置或 production artifact。FE-08 的限制另见
表中说明。coverage percentage、snapshot 数量、静态检查、OpenSpec status 或 Mock PASS 均
不是 ticket closure。

## 10. OpenSpec 五项 capability 追溯

| Capability | 本 contract 承接章节 | 负向边界 |
| --- | --- | --- |
| `asset-workbench-navigation` | §3.1、§4、§5、§6、FX-01/FX-12。 | Hook 无 MVP destination；locator 不写入，不要求服务端分页。 |
| `resolved-global-applicability` | §3.2–§3.4、§4.2、FX-19、FE-07R。 | projectId 不透明；unknown/blocked/stale fail-closed；投影不建项目副本。 |
| `skill-agent-state-control` | §5、FX-01、FE-01/FE-04。 | presence/activation/applicability 不可判定即 fail-closed；无 `setSkillEnabled`；关闭不 delete；未 apply+reread 不更新事实。 |
| `type-specific-asset-surfaces` | §6、FX-02/04/12、FE-02/03/10。 | 不恢复固定第四检查器；未知/不兼容内容不伪装为完整编辑。 |
| `deterministic-conversion-scope` | §6、FX-09–11、FE-06。 | 长期指令/Hook 无转换；raw-copy 不是转换；Prompt/unknown 只能 lossless 或 blocked。 |

本表只提供已冻结产品基线与本冻结契约之间的定位，不新增产品决策、wire 形状、ticket 状态或
运行时证据。

## 11. tasks 1.3–1.6 的内容支撑核对

| OpenSpec task | 本文的对应内容 | 状态边界 |
| --- | --- | --- |
| 1.3 | metadata、上位 fingerprint/SHA、v0.1 继承矩阵、D3 列表默认/焦点/搜索及 canonical closed filters 细化。 | 本表是内容核对，不勾选 task。 |
| 1.4 | `AssetListQuery`→snapshot union、`filterStatusFacts` 驱动的 canonical predicate、`EffectiveContext`、`NativeOwnership`/`AssetRef`、段序、actual-read、`SkillTargetState`、`editAsset` 与转换边界。 | 不预设 Rust-first wire 或 runtime 已实现。 |
| 1.5 | FX-03 decode、unknown field、`EXECUTABLE_CONTENT_RISK`、敏感遮蔽、no-execution 与 Hook UI 不可达。 | L2 仅负例，无 Hook 正向 journey。 |
| 1.6 | FX-01–19 catalog（含 filter/locator/Skill state 的既有 owner）、由本文冻结确认的 FX-19 FE-07R contract 主归属、逐 ticket L0/L1/L2/L3/PF 及 contract/security 责任。 | 计划 owner/evidence 不是 ticket closure。 |

## 12. 本冻结契约的停点

task 1.7 的独立只读复审和用户验收已完成，本文已于 `2026-08-10` Frozen；task 1.8+ 的
技术方案影响复核、addendum、wire、ticket 编排和证据 seam 仍未开始。本次冻结不伪造或产生
任何 runtime、ticket closure 或 gate 结论：

- FX-19 的 FE-07R contract 主归属已由本文冻结确认；tracker、DAG、evidence registry、
  FE acceptance、`TICKET_REGISTRY`、evidence manifest 与运行时 ownership 落地仍属 task 1.8+
  或其后续阶段，均未执行；
- 不得从本文、OpenSpec planning complete、Prettier/Markdown 检查或 selected B2 Mock 推断
  runtime、actual-read、ticket closure、ARCH-GATE 或 RELEASE-GATE 结论；
- 后续技术方案、wire、Gateway/Adapter、生产 UI/运行时代码仍保持未开始。
