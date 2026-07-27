# Agent Config Manager：前端契约 v0.1

> 状态：待验收；`ARCH-GATE` 未关闭，前端实现不得开始
> 更新时间：2026-07-27
> 上位事实来源：`docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md`
> 基线指纹：`sha256:0c28dade5e6f58acfc10296ea6d83437c045a68afdd9b37ba307bfc818f9a1df`
> 文档性质：框架与传输方式无关的 UI 行为契约，不是技术方案或代码设计

## 1. Problem Statement

Agent Config Manager 的产品范围、UI/交互和视觉规范已经封板，但仓库尚无前端代码或技术方案。若此时直接选择框架、IPC 或组件结构，前端容易把尚未明确的实现细节误当成产品事实，或让后端接口反向塑造已经确认的用户流程。

本契约先固定前端真正需要观察、表达和发起的行为，使后续整机技术方案只回答“如何实现”，不再重新回答“用户看到什么、可以做什么、失败时发生什么”。

## 2. Solution

建立一个语言、框架和传输方式无关的 `FrontendGateway` seam，并以以下内容约束所有后续实现：

- UI 可读取的快照；
- UI 可准备和应用的操作；
- UI 需要表达的稳定状态、结果和原因码；
- 本地工作区状态与受保护事务状态之间的边界；
- 可由 fixture 驱动的用户旅程；
- 产品基线条款到契约、fixture 和前端票据的完整映射。

前端实现、真实 IPC adapter 和 mock adapter 都必须满足本契约。任何下位文档或票据不得静默改变本契约；发现新的产品级权衡时，必须先返回产品决策基线。

## 3. 事实层级与边界

### 3.1 事实层级

1. 产品决策基线：唯一产品事实来源；
2. 本前端契约：唯一 UI 行为与 UI 端口事实来源；
3. 后续技术方案：实现本契约，不得改写产品或 UI 行为；
4. 前端票据：交付既定行为，不承担产品或架构决策。

发生冲突时按上述顺序以上位文档为准。下位文档只能提出 Change Request，不能自行修正上位事实。

### 3.2 本契约覆盖

- 四类资产和四个一等 Agent 的浏览、理解与状态表达；
- 原生内容、文件树、检查器、结构化视图和只读降级；
- 本地草稿、校验、差异审查、确认、写入、冲突、结果与恢复；
- 创建、导入、安装、转换、导出、删除和恢复；
- 项目纳入、索引健康、Agent 检测与适配器包管理；
- 窄窗口、键盘、焦点、减少动态效果和敏感信息遮蔽。

### 3.3 明确后置到 `ARCH-GATE`

- macOS 桌面容器与前端框架；
- UI 状态管理库、编辑器、diff、树组件和设计系统实现；
- `FrontendGateway` 的 IPC、进程、线程或序列化形式；
- 核心引擎、适配器、索引、数据库、文件监听和事务实现；
- 栏宽记忆、搜索校准和快照配额的存储与具体参数；
- 打包、签名、更新、性能阈值和测试工具选型。

## 4. Canonical Vocabulary

| 术语 | 契约含义 |
|---|---|
| 原生资产 | Agent 原生文件、目录、配置块或插件模块形成的一个原生可管理单元 |
| `AssetRef` | UI 使用的不透明资产引用；路径不能单独充当身份 |
| revision | 某次读取时磁盘原生资产的不可解释版本标识，用于乐观并发校验 |
| snapshot | `read` 返回的只读 UI 事实；不是新的事实来源 |
| intent | 用户希望执行的一个操作；原生资产写入遵循单资产、单目标，管理变更与导出遵循各自的单一 identity |
| prepared operation | `prepare` 生成的无副作用操作计划，含校验、差异、风险和确认信息 |
| apply | 唯一允许触发原生资产或应用私有管理状态变更的 UI 端口调用 |
| 本地草稿 | 仅存在于当前前端工作会话、尚未写入磁盘的单资产修改 |
| recovery point | 写入前基于最新磁盘状态创建、可供恢复的快照引用 |
| workspace event | 提醒 UI 重新读取事实或更新进度的事件；事件负载本身不是事实来源 |

## 5. User Stories

1. 作为用户，我希望按 Skills、长期指令、Subagents、Hooks 浏览资产，以便先按资产类型理解本机配置。
2. 作为用户，我希望在当前类型与全部资产之间显式切换搜索范围，以便在保持工作台上下文的同时跨类型定位资产。
3. 作为用户，我希望按 Agent、项目、作用域、来源和状态筛选资产，以便快速缩小结果。
4. 作为用户，我希望列表优先显示名称、异常、Agent、作用域和项目或路径提示，以便高密度扫描。
5. 作为用户，我希望同一个原生资产只出现一次，以便不会把多个生效上下文误认为多个副本。
6. 作为用户，我希望查看资产实际路径、Agent、作用域和生效上下文，以便理解它在哪里生效。
7. 作为用户，我希望查看来源、覆盖、兼容、漂移、最近变更和恢复信息，以便判断操作风险。
8. 作为用户，我希望默认先看到完整源码，以便注释、未知字段和原生格式首先可见。
9. 作为用户，我希望只有在无损往返有保证时切换结构化视图，以便不会因表单编辑损坏原生内容。
10. 作为用户，我希望浏览多文件资产的真实目录树，以便理解完整原生可管理单元。
11. 作为用户，我希望选择非文本文件时看到明确只读元数据，以便不会进入不可用的编辑器。
12. 作为用户，我希望默认处于磁盘内容查看态，以便打开资产不会隐式创建或写入草稿。
13. 作为用户，我希望显式进入编辑并持续看到“本地草稿”，以便清楚区分磁盘和未应用修改。
14. 作为用户，我希望草稿在同一资产的文件和源码/结构化视图之间保留，以便连续编辑。
15. 作为用户，我希望无实际更改时直接退出编辑，以便避免无意义确认。
16. 作为用户，我希望放弃脏草稿时以“保留草稿”为安全默认，以便避免误删修改。
17. 作为用户，我希望切换资产前处理当前脏草稿，以便 MVP 不产生难以追踪的多资产草稿池。
18. 作为用户，我希望在同一工作区审查统一差异，以便保留资产、文件和安全上下文。
19. 作为用户，我希望长段未变内容可折叠并按需展开，以便聚焦真正变化。
20. 作为用户，我希望应用前再次核对目标、路径、Git 状态和恢复点，以便做出明确写入决定。
21. 作为用户，我希望外部变化发生时重新生成差异或进入三方冲突，以便不会静默覆盖磁盘。
22. 作为用户，我希望应用成功、失败或回滚后在原位看到结果，以便继续处理当前资产。
23. 作为用户，我希望原生资产写入成功结果包含可用恢复点，以便必要时回退本次变更。
24. 作为用户，我希望在当前资产类型内新建原生资产，以便直接形成目标 Agent 的原生结果。
25. 作为用户，我希望从本地文件、目录或配置片段导入，以便一次性复制并安装到目标原生位置。
26. 作为用户，我希望把已选原生资产安装到另一个同格式的单一目标作用域，以便复用资产而不误触发跨 Agent 转换。
27. 作为用户，我希望跨 Agent 转换前看到能力映射，以便理解保留、改写、缺失、人工处理和阻断项。
28. 作为用户，我希望完整、降级和阻断转换得到不同且明确的结果，以便不会把未知能力猜测成可用配置。
29. 作为用户，我希望导出保持原始文件或目录结构，以便不被产品私有格式锁定。
30. 作为用户，我希望删除可以恢复，以便误操作不会直接造成永久丢失。
31. 作为用户，我希望恢复目标被占用时先看到差异并被阻断，以便不会覆盖当前磁盘内容。
32. 作为用户，我希望显式纳入候选项目，并能停止管理项目而不删除原生资产。
33. 作为用户，我希望看到索引过期与重建状态，以便理解搜索结果是否可能陈旧。
34. 作为用户，我希望看到 Agent 安装路径和版本，但产品不替我安装、升级或卸载 Agent。
35. 作为用户，我希望未知 Agent 版本或结构明确只读，以便不会在未验证环境写入。
36. 作为用户，我希望官方适配器包更新前看到兼容与规则变化，以便确认后再切换。
37. 作为用户，我希望适配器更新失败时继续使用当前版本，并能回滚上一可用版本。
38. 作为用户，我希望 Git 状态只作为风险上下文展示，以便产品不会替我执行 Git 操作。
39. 作为用户，我希望敏感值默认遮蔽且只有显式操作才能临时查看或修改，以便秘密不会进入索引、日志或诊断。
40. 作为键盘用户，我希望所有关键操作、分隔线、浮层和焦点恢复都可操作，以便不依赖指针设备。
41. 作为减少动态效果的用户，我希望界面直接切换最终状态，以便动画不是理解流程的必要条件。

## 6. `FrontendGateway` Interface

### 6.1 唯一 UI seam

`FrontendGateway` 是前端与整机能力之间唯一规范 seam。实际实现可以在内部拆分，但不得让 UI 直接依赖文件系统、索引、数据库、Agent 适配器或事务实现。

| 操作 | 输入 | 输出 | 契约 |
|---|---|---|---|
| `read` | 一个 `Query` | `ReadResult<该 query 对应 Snapshot>` | 只读；成功返回本次事实及其 revision，失败返回稳定原因与恢复动作 |
| `prepare` | 一个 `OperationIntent` 和其操作类别要求的并发事实 | 一个封闭 `PrepareResult` | 无副作用；完成校验、映射、差异、冲突识别和确认摘要 |
| `apply` | `preparedOperationId` 和其 revision-bound `OperationConcurrencyToken` | 一个 `OperationResult` | 唯一变更入口；重读受影响事实后才执行，不匹配时不写入 |
| `observe` | 一个 `Subscription` | `WorkspaceEvent` 流 | 只通知失效或进度已更新；消费方随后通过 `read` 取得可读事实 |

### 6.2 Query

`Query` 是以下封闭集合：

| Query | 目的 |
|---|---|
| `AssetListQuery` | 按当前类型或全部资产搜索、筛选、分组并返回索引状态 |
| `AssetDetailQuery` | 读取一个资产的身份、能力、revision、文件树和检查器信息 |
| `NativeFileQuery` | 读取一个资产内的文本内容或非文本只读元数据 |
| `ManagementQuery` | 读取项目候选与管理状态、Agent 检测、适配器包和恢复点状态 |
| `OperationProgressQuery` | 按不透明 operation identity 读取一次应用或回滚的当前可读进度事实 |
| `SensitiveRevealQuery` | 由显式用户操作发起一次敏感片段访问，请求范围只能是 `view` 或 `modify`；结果不得缓存、索引、记录或进入 fixture |

`ReadResult<T>` 是 `ReadSucceeded(snapshot: T)` 或 `ReadFailed(reasonCode, recoveryAction?)`。异常字符串或 transport 失败不能直接决定 UI；所有 `Query` 的失败都必须归一化为 `ReadFailed`。成功分支中的 `Query` 与 `Snapshot` 是一一封闭对应关系，不能返回未声明的混合 shape：

| Query | 唯一 Snapshot | 事实边界 |
|---|---|---|
| `AssetListQuery` | `AssetListSnapshot` | `AssetSummary` 列表、`IndexStatus`、本次查询范围与索引更新时间 |
| `AssetDetailQuery` | `AssetDetailSnapshot` | `AssetDetail`、`InspectorData` 与该资产 revision |
| `NativeFileQuery` | `NativeFileSnapshot` | 一个 `NativeFileRef`、内容或元数据、该文件和资产 revision |
| `ManagementQuery` | `ManagementSnapshot` | 项目、Agent、适配器包、恢复点管理事实及 management revision |
| `OperationProgressQuery` | `OperationProgressSnapshot` | operation identity、阶段、用户可读且不含敏感值的进度说明、最近结果或仍在进行状态 |
| `SensitiveRevealQuery` | `SensitiveRevealSnapshot` | 一个 `SensitiveSegmentRef` 的短生命周期明文和同范围 `SensitiveAccessGrant`；不可复用为其他片段、revision、范围或操作 |

`Subscription` 也是封闭集合：`WorkspaceSubscription` 可按工作区或资产筛选失效事件，`OperationProgressSubscription` 只订阅一个 operation identity。事件只给出重新读取所需的身份与类别；进度的阶段和说明始终从 `OperationProgressSnapshot` 读取。

`AssetListQuery` 只允许使用产品基线已确认的维度：资产类型范围、搜索文本、Agent、项目、作用域、来源、状态和显式分组。不得由契约自行增加排序产品能力、全局命令面板或语义搜索。

### 6.3 Identity and content types

| 类型 | UI 必需字段 |
|---|---|
| `AssetRef` | 不透明 `assetId`、资产类型、不透明原生单元引用、适配器识别身份 |
| `AssetSummary` | `AssetRef`、显示名称、关键异常、识别 Agent、作用域、项目或路径提示、操作可用性 |
| `AssetDetail` | `AssetRef`、显示名称、原生单元类型、revision、生效上下文、兼容状态、能力、文件树根 |
| `NativeFileRef` | 不透明 `fileId`、名称、相对路径、文本/非文本/未知类型、主文件标记、预览和编辑可用性、草稿更改标记 |
| `NativeFileSnapshot` | `NativeFileRef`、revision、含 revision-bound 遮蔽段的源码或只读元数据、结构化视图可用性 |
| `InspectorData` | Agent、作用域、生效上下文、来源锚点、路径、覆盖关系、漂移、兼容、最近变更和恢复点 |
| `OperationIdentity` | 不透明 `operationId`、操作类别和最小受影响身份；不含路径明文、敏感值或可重放的写入数据 |
| `OperationProgressSnapshot` | `OperationIdentity`、`applying`/`rollingBack`/终态、稳定阶段码、用户可读进度说明、最近 `OperationResult` 摘要 |
| `SensitiveSegmentRef` | 不透明片段身份、所属 `AssetRef` 和 `NativeFileRef`、绑定的 revision、遮蔽状态；默认不含明文 |
| `SensitiveAccessGrant` | 显式用户动作取得的短生命周期、revision-bound 授权；范围只能是 `view` 或 `modify`，到期、切换资产或 revision 变化即失效 |
| `ReadFailed` | 稳定 `reasonCode`、用户可读说明和可选恢复动作；不携带异常字符串供 UI 分支判断 |

路径用于显示、复制和风险确认，不用于 UI 选择身份。完整绝对路径按需提供；常驻路径继续遵循来源锚点与中部省略规则。

### 6.4 Capability and environment types

| 类型 | 允许状态 |
|---|---|
| `CompatibilityStatus` | `verifiedWritable`、`recognizedReadOnly`、`incompatibleBlocked` |
| `IndexStatus` | `fresh`、`stale`、`rebuilding`、`failed` |
| `GitStatus` | `notRepository`、`clean`、`modified`、`untracked`、`ignored`、`unknown` |
| `SensitiveDisplayState` | `masked`、`temporarilyRevealed`、`changedMasked` |
| `ActionAvailability` | `allowed` 或 `disabled(reasonCode, recoveryAction?)` |

正常状态不要求常驻标签。只读、漂移、冲突、阻断和失败必须同时提供文字或图标线索，不能只依赖颜色。

敏感片段的遮蔽、显示和修改都以 `SensitiveSegmentRef` 的资产、文件和 revision 为边界。未触碰敏感片段的编辑必须无损保留原有敏感原文；`view` 授权不能修改，修改敏感片段必须另经显式 `modify` 授权。授权及其明文只在有效期内用于当前表面，不能进入草稿持久化、搜索、事件、日志、诊断或 fixture；revision 变化后必须重新遮蔽并重新授权。

### 6.5 OperationIntent

`OperationIntent` 是以下封闭集合：

- `editAsset`
- `createAsset`
- `importAsset`
- `installAsset`
- `convertAsset`
- `exportAsset`
- `deleteAsset`
- `recoverAsset`
- `includeProject`
- `removeProject`
- `updateAdapterPackage`
- `rollbackAdapterPackage`
- `setRecoveryPointPinned`

`installAsset` 以已选源原生资产安装到一个明确目标 Agent 的一个项目或全局作用域；它不建立中央资产入口、持续同步或一对多安装。每个原生资产写入 intent 只描述一个原生资产和一个目标，目标由 Agent、项目或全局作用域及原生位置共同表达。管理变更和导出分别使用下表定义的单一 identity；任何类别都不支持批量写入、一对多安装或跨目标部分成功。

每个 intent 在 `prepare` 后归入一个互斥操作类别；类别决定身份、并发校验、结果事实与恢复策略：

| 操作类别 | intents | identity 与并发 token | 成功结果与恢复策略 |
|---|---|---|---|
| 原生资产写入 | `editAsset`、`createAsset`、`importAsset`、`installAsset`、`convertAsset`、`deleteAsset`、`recoverAsset` | `AssetWriteIdentity` 指向单一源（如有）和单一原生目标；`AssetWriteConcurrencyToken` 绑定所有已读取源/目标 revision，目标不存在时绑定其已验证的不存在状态 | `AppliedResult` 返回实际单一目标和新的 `RecoveryPoint`；新恢复点为强制项，无法创建则阻断 |
| 管理变更 | `includeProject`、`removeProject`、`updateAdapterPackage`、`rollbackAdapterPackage`、`setRecoveryPointPinned` | `ManagementChangeIdentity` 指向一个项目、适配器包或恢复点；`ManagementConcurrencyToken` 绑定该管理事实的 revision | `AppliedResult` 返回更新后的管理事实；不创建原生资产恢复点 |
| 导出 | `exportAsset` | `ExportIdentity` 指向一个 `AssetRef` 和一个不透明导出目标；`ExportConcurrencyToken` 绑定源 revision 与导出目标的已验证占用状态 | `AppliedResult` 返回导出位置、结构摘要和提示；不创建恢复点 |

`OperationConcurrencyToken` 是 gateway 返回、仅用于检验准备时事实仍有效的不透明并发事实，不是用户确认的替代物。用户仍必须在每次有效 prepared operation 上完成审查和显式确认。

目标已有同名原生资产时，`prepare` 返回 `TargetNameCollision`：现有目标 identity/revision、待写目标、`TARGET_NAME_CONFLICT` 和三个仅有动作 `cancel`、`rename`、`reviewAndOverwrite`。`cancel` 不产生写入；`rename` 返回目标设置并重新 prepare；`reviewAndOverwrite` 只能在重新 prepare 后生成同时展示现有目标和替换结果的新版差异审查，之后仍须显式确认。`TargetNameCollision` 本身不含可应用的 `preparedOperationId`。

### 6.6 PrepareResult and PreparedOperation

`PrepareResult` 是以下封闭集合：

| 结果 | 必需信息与后续行为 |
|---|---|
| `PreparedOperation` | 当前事实可形成可审查计划；通过 `canApply`、finding、差异和确认摘要决定能否继续 |
| `TargetNameCollision` | 当前目标重名及 `cancel`、`rename`、`reviewAndOverwrite`；解决后必须重新 prepare |
| `ConflictResult` | 基于当前事实形成的三方冲突审查，含基线、最新磁盘、当前草稿及保留/解决/放弃动作；解决后必须重新 prepare |

`ConflictResult` 只由 `prepare` 基于当前事实产生，不是 `apply` 结果，也不含可应用的 `preparedOperationId`。旧 operation 因并发事实变化失效时，`apply` 只返回 `BlockedResult(REPREPARE_REQUIRED)`；后续重新 `prepare` 才能产生新版 `PreparedOperation`、`TargetNameCollision` 或 `ConflictResult`。

`PreparedOperation` 必须包含：

- 不透明 `preparedOperationId`；
- `OperationIdentity`、互斥操作类别、源（如有）和单一目标；
- 该类别对应的 revision-bound `OperationConcurrencyToken`，以及 token 绑定的事实摘要；
- 稳定的 `ValidationFinding` 列表；
- 允许时提供 `UnifiedDiff`；
- 转换时提供 `CapabilityMapping`；
- 目标、原生路径、Git 状态、恢复点策略、已解决的覆盖选择（如有）和风险的确认摘要；
- `canApply` 及不可应用时的稳定原因码。

`prepare` 不得创建快照、写文件、改变索引、安装适配器包或修改应用私有管理状态。

任一绑定 revision 或占用状态变化时，此 prepared operation 立即失效。旧 operation 不得吸收新差异、重新生成差异或继续 apply；UI 必须重新执行 `prepare`。只有新的 `PreparedOperation` 才能继续 `review → confirm`；`TargetNameCollision` 或 `ConflictResult` 必须先解决并再次 prepare。

### 6.7 ValidationFinding

`ValidationFinding` 包含：

- `severity`：`information`、`warning` 或 `blocking`；
- 稳定 `reasonCode`；
- 用户可读说明；
- 可选的受影响资产、文件、字段或能力引用；
- 可选的用户恢复动作。

错误字符串只用于展示，不能被 UI 用来决定流程、禁用状态或恢复动作。

### 6.8 UnifiedDiff

`UnifiedDiff` 以完整原生可管理单元为边界，至少表达：

- 更改文件数及资产级增删摘要；
- 文件路径及文件级增删摘要；
- 统一差异行、旧/新行号和新增/删除/上下文类别；
- 可折叠未变区段及范围；
- 敏感值变化标记，不包含默认可见明文；
- 三方冲突时的基线、当前磁盘和草稿引用。

前端不从文本重新解析差异语义；差异结构由 gateway 返回。

### 6.9 CapabilityMapping

`CapabilityMapping` 包含：

- 总体结论：`complete`、`degraded` 或 `blocked`；
- 条目类别：`preserved`、`rewritten`、`missing`、`manualAction`、`blocking`；
- 每项的源能力、目标能力、说明和可选风险；
- 是否允许进入差异审查。

`blocked` 不产生可应用结果。`degraded` 必须保留明确风险确认，不能伪装为完整转换。

### 6.10 OperationResult

`OperationResult` 是以下封闭结果：

| 结果 | 必需信息 |
|---|---|
| `AppliedResult` | 回显 `OperationIdentity` 与操作类别；资产写入必须含实际单一目标和新的恢复点，管理变更含更新后管理事实，导出含导出结构摘要；三者均可含非阻断警告 |
| `BlockedResult` | 回显 identity、稳定原因码、阻断位置和允许恢复动作；任一外部 revision/占用变化必须为 `REPREPARE_REQUIRED`，不写入 |
| `FailedResult` | 回显 identity、失败原因、`notNeeded`/`succeeded`/`failed` 回滚结果；仅资产写入可含仍可用恢复点 |

`apply` 开始后，前端不承诺中途取消。界面保持应用中状态，等待确定结果；实现是否支持安全取消留到技术方案，但不得让 UI 把未知执行状态误报为取消成功。

### 6.11 RecoveryPoint

`RecoveryPoint` 至少表达：

- 不透明恢复点引用；
- 对应资产和创建时间；
- 来源操作；
- 固定状态；
- 是否为该资产最近有效恢复点；
- 当前可恢复性和不可恢复原因。

前端不接触快照加密密钥，也不把恢复点冒充 Git 历史。

### 6.12 WorkspaceEvent

`WorkspaceEvent` 只允许表达：

- `assetsInvalidated`
- `assetDriftDetected`
- `indexStatusChanged`
- `compatibilityChanged`
- `operationProgressChanged`
- `recoveryAvailabilityChanged`

`operationProgressChanged` 只携带 operation identity 与“已更新”类别，UI 通过 `OperationProgressQuery` 读取阶段和说明。收到任一事件后，UI 保留当前选择、文件、草稿和展开上下文，并通过对应 `read` 获取新事实。事件不得携带敏感明文、进度详情或成为写入依据。

### 6.13 Stable reason codes

稳定原因码按行为分类，不绑定具体错误文本：

| 分类 | 原因码 |
|---|---|
| 兼容 | `UNKNOWN_AGENT_VERSION`、`INCOMPATIBLE_STRUCTURE`、`UNSUPPORTED_CAPABILITY`、`READ_ONLY_POLICY` |
| 授权与范围 | `PERMISSION_DENIED`、`OUTSIDE_MANAGED_SCOPE`、`PROJECT_UNAVAILABLE` |
| 内容与校验 | `UNKNOWN_FIELD_PRESERVED`、`NON_TEXT_UNPREVIEWABLE`、`VALIDATION_FAILED`、`EXECUTABLE_CONTENT_RISK` |
| 索引与并发 | `INDEX_STALE`、`EXTERNAL_CHANGE`、`REPREPARE_REQUIRED`、`MERGE_CONFLICT`、`TARGET_NAME_CONFLICT` |
| 转换 | `CONVERSION_DEGRADED`、`CONVERSION_BLOCKED` |
| 事务与恢复 | `READ_FAILED`、`SNAPSHOT_REQUIRED`、`SNAPSHOT_FAILED`、`SECURE_STORAGE_UNAVAILABLE`、`DISK_FULL`、`WRITE_FAILED`、`ROLLBACK_FAILED`、`RECOVERY_TARGET_OCCUPIED` |
| 适配器包 | `ADAPTER_SIGNATURE_INVALID`、`ADAPTER_COMPATIBILITY_MISMATCH`、`ADAPTER_REGRESSION_FAILED` |
| 导入与导出 | `IMPORT_SOURCE_UNAVAILABLE`、`EXPORT_DESTINATION_INVALID` |

`GitStatus.modified` 是风险上下文而非默认阻断原因；产品不得因此执行 Git 操作。

## 7. UI State Machines

### 7.1 Workbench load state

| 状态 | 可见行为 |
|---|---|
| `loading` | 保留工作区结构，不展示旧数据为最新事实 |
| `ready` | 展示当前 snapshot |
| `empty` | 解释当前搜索或管理范围无结果 |
| `stale` | 展示最近 snapshot、最近更新时间和索引过期状态；写入前仍重新读取磁盘 |
| `failed` | 只消费 `ReadFailed` 的稳定原因与恢复动作，不从异常字符串推断，也不伪造空结果 |

### 7.2 Asset workflow

允许的主迁移：

1. `viewing → editing.clean`
2. `editing.clean → viewing`
3. `editing.clean → editing.dirty`
4. `editing.dirty → discardConfirm → editing.dirty | viewing`
5. `editing.dirty → reviewing | conflict`
6. `reviewing → editing.dirty | confirming`
7. `confirming → reviewing | applying`
8. `applying → applied | blocked | failed`
9. `reviewing | confirming | applying → reprepareRequired`
10. `reprepareRequired → editing.dirty | targetSelection`
11. `conflict → editing.dirty | targetSelection | viewing`
12. `applied | blocked | failed → viewing`

规则：

- 同时只有一个活动资产草稿；
- 切换资产、资产类型或离开工作区时，脏草稿进入同一放弃保护；安全默认是留在当前草稿；
- 干净草稿直接退出，不弹确认；
- 返回草稿保留当前文件、文件树展开、差异上下文和检查器状态；
- 外部事件不得覆盖草稿；任一已准备操作的绑定 revision 或目标占用状态变化时，`apply` 返回 `BlockedResult(REPREPARE_REQUIRED)`，保留草稿并进入 `reprepareRequired`；
- `reprepareRequired` 必须重新执行 `prepare`；只有返回新的 `PreparedOperation` 才能继续 review、confirm，不得自动采用新差异、复用旧 prepared operation 或跳过确认；
- `conflict` 只来自当前事实的 `prepare`，保留草稿；解决后重新 prepare，只有明确放弃才清除。

### 7.3 Create and import workflow

`targetSelection → sourceSelection(import only) → draft → targetNameCollision? → reviewing → confirming → applying → result`

- 保留当前资产类型和工作区上下文；
- 目标 Agent、项目或全局作用域及原生位置必须在进入审查前确定；
- 文件或目录选择以不透明本地选择引用进入 intent，前端不自行读取或执行其内容；
- 取消流程不产生原生资产或私有来源关系。

### 7.4 Conversion workflow

`targetSelection → mapping → blocked | targetNameCollision? → reviewing → confirming → applying → result`

- 源资产和检查器持续可见；
- `complete` 与允许继续的 `degraded` 才能进入审查；
- `blocked` 停留在映射报告，不产生可应用 prepared operation；
- 目标始终是一个 Agent 的一个作用域；
- 结果资产独立，不建立持续同步。

### 7.5 Install workflow

`sourceAsset → targetSelection → targetNameCollision? → reviewing → confirming → applying → result`

- `installAsset` 始终以一个已选源资产和一个目标 Agent 的一个作用域为边界；
- 目标重名时只允许取消、改名，或进入展示替换差异的 `reviewAndOverwrite`；
- 安装沿用当前工作区、差异审查、聚焦确认和结果表面，不创建第二个活动草稿或持续来源关系。

### 7.6 Target-name collision migration

`targetSelection | reviewing → targetNameCollision → cancel | rename → targetSelection | reviewAndOverwrite → reviewing → confirming → applying`

- `cancel` 返回发起前的安全状态且不写入；
- `rename` 必须重新选择目标并 prepare；
- `reviewAndOverwrite` 只把已有目标与替换内容纳入新版审查，不能直接 apply；
- 任何外部 revision 变化优先进入 `reprepareRequired`，而不是自动沿用冲突前的覆盖选择。

### 7.7 Frontend-local workspace state

以下状态属于 UI 本地状态，不扩展 `FrontendGateway`：

| 状态 | 规则 |
|---|---|
| 当前一级资产类型 | Skills、长期指令、Subagents、Hooks |
| 搜索、筛选、显式分组 | 仅作用于资产列表 query；不自动改变分组 |
| 当前资产和文件 | 切换时保持工作区；文件默认采用主文件优先、稳定文本兜底 |
| 源码/结构化视图 | 打开资产默认源码；结构化不可用时保留禁用项及原因 |
| 检查器展开组合 | 同一资产类型连续浏览时保留；不要求跨会话持久化 |
| 文件树展开组合 | 首次只展开当前路径；后续不自动撤销用户展开状态 |
| 栏宽 | 按资产类型跨会话记忆；存储方式留到技术方案 |
| 聚焦与收拢 | 临时状态不覆盖栏宽记忆；只允许一个覆盖式浮层 |
| 差异未变区段 | 原位展开或收起；不改变 prepared operation |

## 8. Contract Invariants

1. 原生资产始终是唯一事实来源。
2. UI 只能通过 `FrontendGateway` 观察或发起整机能力。
3. `read`、`prepare` 和 `observe` 不得改变原生资产。
4. `apply` 必须使用 prepared operation 和其 revision-bound `OperationConcurrencyToken`，并在写入前重读受影响事实。
5. 搜索索引、UI 缓存和 workspace event 不得授权写入。
6. 原生资产写入只允许单资产、单目标；管理变更和导出只允许一个操作 identity。所有类别均为单事务，不表达批量或部分成功。
7. 未知、不兼容或不能证明安全的能力只读、降级或阻断。
8. 未知字段、注释、顺序和格式不得被 UI 模型静默丢弃。
9. 敏感明文不得进入搜索、日志、事件、诊断、来源元数据或 fixture。
10. Hook、Skill 脚本和插件代码只作为内容展示与静态校验对象，产品不执行。
11. Git 只提供状态与风险上下文，任何 intent 都不得隐式包含 Git 操作。
12. `PreparedOperation` 只能应用一次；结果未知时不得由前端自行重试。
13. 外部变化不会静默覆盖草稿；旧 prepared operation 必须以 `REPREPARE_REQUIRED` 失效，并重新 prepare、review、confirm，不能自动应用新差异。
14. 只有原生资产写入成功必须提供新恢复点；该快照无法创建时阻断。管理变更与导出不得伪造恢复点。
15. workspace event 只触发失效或进度已更新；`OperationProgressSnapshot` 才是进度事实来源。
16. 敏感片段以 revision 遮蔽；未触碰时无损保留，查看与修改分别需要显式短生命周期授权。
17. 正常状态不常驻强调；异常、阻断和恢复动作必须可解释。

## 9. Implementation Decisions

本契约已固定：

- 一个语言无关的 `FrontendGateway` 外部 seam；
- 一个 mock adapter 和一个真实 adapter 必须满足同一契约；
- 状态以互斥的命名状态表达，不以互相冲突的布尔标记表达；
- 用户旅程是主要测试 seam；
- 产品基线追溯矩阵是新增类型、状态和 fixture 的准入依据。

本契约不固定：

- 编程语言、类型系统语法和序列化 wire shape；
- 模块、进程和线程的实际数量；
- 框架、依赖、编辑器、diff 或状态管理工具；
- 本地 UI 状态的具体持久化实现；
- 错误文本、微观文案和实现文件布局。

任何拟新增字段或状态必须同时满足：

1. 可追溯到产品基线条款；
2. 至少被一个 fixture 旅程使用；
3. 至少被一个前端票据交付。

否则视为过度设计并删除。

## 10. Testing Decisions

### 10.1 Primary seam

- 使用 mock `FrontendGateway` 驱动完整用户旅程；
- 断言用户可见状态、允许动作和 gateway 调用，不断言组件内部结构；
- 不以 snapshots 作为主要断言；
- 真实 adapter 在技术方案阶段复用 gateway 契约测试；
- 组件级测试只覆盖难以从旅程 seam 精确定位的键盘、编辑器和焦点交互。

### 10.2 Fixture catalog

fixture 只能使用合成占位值，不得复制真实 Token、路径中的个人信息或其他秘密。下表的“可验收断言”是 mock gateway 旅程必须观察的事实，不是实际文件系统、IPC 或票据已交付的声明。

| Fixture | 场景 | 可验收断言 | 计划票据 |
|---|---|---|---|
| `FX-01 single-skill-ready` | 单文件 Skill、已验证可写 | `AssetListSnapshot` 和源码详情身份、revision、可用动作一致；默认源码及辅助文本无敏感明文；参数化读取失败返回 `ReadFailed` | FE-01 |
| `FX-02 multifile-skill-mixed` | 多文件 Skill、主文件、附属文本和非文本文件 | 文件树、主文件选择、非文本只读元数据可读；所有默认内容表面保持遮蔽 | FE-02 |
| `FX-03 executable-hook-unknown` | Hook 可执行内容、未知字段保留、静态风险 | 风险 finding 可读；无执行 intent 或写入 | FE-02 |
| `FX-04 dirty-multifile-draft` | 跨文件与视图共享草稿、退出与切换保护 | 仅一个活动草稿；dirty guard 默认保留；普通编辑无损保留未触碰秘密，敏感修改要求有效 `modify` grant | FE-03 |
| `FX-05 review-git-drift-conflict` | 统一差异、Git 修改、外部 revision 变化 | 敏感差异无明文；旧 token 的 apply 返回 `REPREPARE_REQUIRED`，重新 prepare 后再审查确认 | FE-04 |
| `FX-06 unknown-agent-version` | Agent 已安装但版本未知 | 只读原因与禁用操作一致 | FE-08 |
| `FX-07 stale-index-projects` | 候选项目、项目失效、索引过期与原子重建 | 事件后通过 `read` 取得新 `ManagementSnapshot`，不把旧索引用作写入依据 | FE-07 |
| `FX-08 create-import-validation` | 新建和导入目标设置、来源失效与校验阻断 | 单一目标、阻断 finding 与无副作用 prepare | FE-05 |
| `FX-09 conversion-complete` | 能力完整映射并可进入差异审查 | 映射、差异和明确确认后才可写入一个目标 | FE-06 |
| `FX-10 conversion-degraded` | 明确缺失与人工处理 | 降级风险可读且仍须确认 | FE-06 |
| `FX-11 conversion-blocked` | 必要能力缺失 | `canApply=false` 且不生成可应用结果 | FE-06 |
| `FX-12 sensitive-narrow-keyboard` | 敏感临时查看、窄窗口、键盘、焦点恢复和减少动态效果 | `view` grant 到期、切换资产或 revision 变化后失效；无明文进入缓存、事件或 fixture | FE-10 |
| `FX-13 delete-export-recover` | 原生导出、可恢复删除和恢复目标占用 | 删除有新恢复点；导出无恢复点；占用恢复不静默覆盖 | FE-09 |
| `FX-14 adapter-update-rollback` | 签名失败、候选回归失败、原子启用和回滚 | 管理变更结果返回管理事实且不伪造原生恢复点 | FE-08 |
| `FX-15 install-single-target` | 已选源资产安装到一个目标 Agent/作用域 | `installAsset` 的单源单目标、差异审查、确认和资产恢复点 | FE-05 |
| `FX-16 asset-write-result-branches` | 原生资产写入的准备与应用结果分支 | prepare 可产生当前事实的 `ConflictResult`；apply 的 Applied、Blocked、Failed 及回滚子状态均回显 identity 与适用恢复信息 | FE-04 |
| `FX-17 target-name-collision` | 目标已有同名原生资产 | `TARGET_NAME_CONFLICT` 只允许取消、改名或审查后覆盖；覆盖仍须确认 | FE-05 |

### 10.3 Journey assertions

每条旅程至少验证：

- 初始 snapshot 与可见上下文；
- 可执行与禁用动作及其原因；
- 用户 intent；
- `prepare` 的无副作用及确认依据；
- 需要时的 `apply` 调用和对应 `OperationConcurrencyToken`；
- 确定的结果、焦点和恢复动作；
- 外部 revision 后的 `REPREPARE_REQUIRED`、重新 prepare、审查和确认；
- 外部事件后通过对应 `read` 重取事实，进度通过 `OperationProgressQuery` 读取；
- 无静默写入、无敏感泄露、无隐式 Git 操作。

## 11. Product Baseline Traceability Matrix

矩阵只追溯本契约已表达的前端相关条款组到类型和计划 fixture；它不是实现覆盖率、运行时证据或票据完成证明。同组未列出的细项需要在实现前补充明确 fixture 与票据。

| 基线条款 | 契约表达 | Fixture / journey | 前端票据 |
|---|---|---|---|
| 3.2 MVP 不做 | 封闭 `Query`/`OperationIntent`；无对话、Agent 执行、云同步、市场、依赖图、凭证管理等入口 | 契约负向审查（非运行时覆盖声明） | FE-10 |
| 4.1–4.2 原生资产与原位管理 | `AssetRef`、`NativeFileRef`、原生内容 snapshot、独立目标结果 | FX-01、FX-08、FX-09 | FE-01、FE-05、FE-06 |
| 4.3 资产类型优先 | 四类一级状态，Agent/项目/作用域仅为 query 维度 | FX-01 | FE-01 |
| 4.4–4.5 封闭失败与无静默损失 | `ActionAvailability`、blocking finding、封闭 `PrepareResult`/`OperationResult`、revision | FX-03、FX-05、FX-11、FX-16 | FE-02、FE-04、FE-06 |
| 5.1 原生可管理单元 | `AssetDetail`、文件树、单资产草稿与事务 | FX-01、FX-02 | FE-01、FE-02 |
| 5.2 资产身份 | 不透明 `AssetRef`；路径不单独作为身份 | FX-01、FX-07 | FE-01、FE-07 |
| 5.3 生效上下文 | `InspectorData`、上下文与覆盖关系 | FX-01、FX-03 | FE-02 |
| 6.1–6.3 四 Agent 一等支持 | Agent 集合、能力和不支持状态，无主从 Agent | FX-01、FX-06、FX-09–11 | FE-01、FE-06、FE-08 |
| 6.4 有界发现与显式纳入 | `ManagementQuery`、include/remove project intents、授权原因码 | FX-07 | FE-07 |
| 6.5 Agent 生命周期边界 | Agent 本体的安装状态、路径、版本只读 snapshot；无 Agent 本体安装/升级/卸载 intent | FX-06 | FE-08 |
| 7.1 主界面锚点 | workbench load state、资产列表和原生详情为默认路径 | FX-01 | FE-01 |
| 7.2 常驻工作区与栏宽 | 前端本地栏宽、聚焦、分隔线和按资产类型记忆状态 | FX-12 | FE-10 |
| 7.2 窄窗口与覆盖式浮层 | 动态收拢顺序、边缘入口、单浮层、焦点恢复和减少动态效果 | FX-12 | FE-10 |
| 7.3 一级入口 | 四类一级状态；项目与 Agent 不成为主导航 | FX-01 | FE-01 |
| 7.4 列表、分组、搜索与筛选 | `AssetListQuery`、`AssetSummary`、显式当前/全部范围 | FX-01、FX-07 | FE-01 |
| 7.5 检查器与路径 | `InspectorData`、来源锚点、路径按需完整提供 | FX-01、FX-03 | FE-02 |
| 7.5 源码与结构化视图 | `NativeFileSnapshot`、结构化可用性与禁用原因 | FX-02、FX-03 | FE-02 |
| 7.5 编辑与草稿 | asset workflow、单活动草稿、dirty guard | FX-04 | FE-03 |
| 7.5 差异审查与多文件导航 | `UnifiedDiff`、真实文件树、折叠上下文、两层摘要 | FX-05 | FE-04 |
| 7.6 索引一致性 | `IndexStatus`、`indexStatusChanged`、事件后重读 | FX-07 | FE-01、FE-07 |
| 8.1 原生创建 | `createAsset`、目标设置、草稿和统一应用流程 | FX-08 | FE-05 |
| 8.2 本地导入 | `importAsset`、不透明本地来源、独立目标 | FX-08 | FE-05 |
| 8.3 无损结构化与源码兜底 | 兼容状态、结构化可用性、未知字段保留 finding | FX-02、FX-03 | FE-02、FE-03 |
| 8.4 原生资产导出 | `exportAsset`、原始结构、敏感和可执行内容提示 | FX-13 | FE-09 |
| 9.1–9.5 确定性转换 | `convertAsset`、`CapabilityMapping`、完整/降级/阻断流程 | FX-09–11 | FE-06 |
| 10.1–10.2 兼容范围 | `CompatibilityStatus`、只读或阻断 action availability | FX-06 | FE-02、FE-08 |
| 10.4 macOS 首发 | UI 不声明其他平台可用；实现方式由 `ARCH-GATE` 决定 | FX-12 | FE-10 |
| 10.5 适配器包更新 | update/rollback intents、签名/兼容/回归原因码 | FX-14 | FE-08 |
| 11.1 统一变更流程 | `prepare`/`apply`、确认摘要、类别化结果和恢复策略 | FX-05、FX-07–10、FX-13–17 | FE-04、FE-05、FE-06、FE-07、FE-08、FE-09 |
| 11.2 乐观并发 | revision-bound token、`REPREPARE_REQUIRED` 与新版审查 | FX-05、FX-17 | FE-04、FE-05 |
| 11.3 可恢复删除 | delete/recover intents、恢复目标占用结果 | FX-13 | FE-09 |
| 11.4 Git 状态感知 | `GitStatus`，无 Git intent | FX-05、FX-13 | FE-04、FE-09 |
| 11.5 快照保留 | `RecoveryPoint`、固定状态、快照失败阻断 | FX-05、FX-13、FX-15 | FE-04、FE-05、FE-09 |
| 11.6 单资产单目标 | intent、prepared operation 和 result 均为单一源与目标 | FX-04、FX-08–10、FX-13、FX-15、FX-17 | FE-03–FE-09 |
| 11.7 跨资产依赖边界 | 无依赖查询、影响图或级联 intent | 负向契约检查 | FE-09、FE-10 |
| 12.1 来源与漂移 | `InspectorData`、`assetDriftDetected`、无自动同步 intent | FX-05 | FE-02、FE-04 |
| 12.2 私有元数据 | UI 只读取来源、历史、恢复和索引状态；存储后置 | FX-07、FX-13 | FE-07、FE-09 |
| 13 可执行资产安全 | `EXECUTABLE_CONTENT_RISK`、只读内容、产品不执行 | FX-03、FX-13 | FE-02、FE-05、FE-09 |
| 14 敏感信息保护 | revision-bound `SensitiveSegmentRef`、显式查看/修改授权、无损保留与 diff 遮蔽 | FX-01、FX-02、FX-04、FX-05、FX-12 | FE-01、FE-02、FE-03、FE-04、FE-10 |
| 16 MVP 验收原则 | gateway 旅程、fixture catalog 与票据验收共同实现 | FX-01–FX-17（计划范围，非完成声明） | FE-01–FE-10 |
| 20.5 视觉与可访问性 | 语义状态、键盘焦点、对比、16 px 图标、160 ms 与减少动态效果 | FX-12 | FE-10 |

## 12. Out of Scope

本契约不提供或暗示以下能力：

- Agent 对话、任务执行或多 Agent 编排；
- Agent 安装、升级或卸载；
- 云同步、团队协作、在线市场或第三方适配器；
- 用户可见或持久化的统一资产 DSL；
- 批量写入、批量删除、一对多转换或跨目标部分成功；
- 跨资产依赖图、影响分析或级联修改；
- 凭证创建、轮换、同步或注入；
- Hook、Skill 脚本或插件代码执行；
- Windows 或 Linux 可用性；
- 诊断包、完整环境备份或迁移；
- 前端技术栈、IPC wire shape 或实现文件结构。

## 13. Further Notes

- 本契约覆盖完整 MVP，任务顺序仍以浏览、编辑、审查、应用和转换主闭环优先；
- `.scratch/agent-config-manager-frontend/issues/` 是当前本地票据集；
- 所有前端票据受 `ARCH-GATE` 阻塞；技术方案验收前不得开始实现；
- 产品基线当前未提交修改仍归用户所有，本契约不会修改、提交或推送该文件；
- 若产品基线发生后续显式变更，必须重新计算覆盖矩阵并更新基线指纹；
- 本契约不创建重复的产品 glossary；产品术语继续以上位基线为准；
- ADR 只在整机技术方案阶段、且满足难以逆转、缺少背景会令人意外、存在真实取舍三个条件时创建。
