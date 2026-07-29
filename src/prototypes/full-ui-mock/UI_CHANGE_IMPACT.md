# 候选 UI 影响台账：方案 C / Skills 信息架构迭代

> **状态：全部 `pending`，直至 UI 最终验收批准。**
>
> 本文只记录 throwaway Mock 中正在评审的候选 UI 调整及其潜在回写面，不是产品决策、前端契约、技术方案、wire schema 或票据的事实来源。正式产物在 UI 定稿前保持不变；不得根据本文实现、测试、调整接口或解除票据 blocker。

## 使用方式与边界

- 已选的整体结构仍是方案 C（Asset Type Rail）；本轮只讨论其列表、搜索和 Skills 工作台的信息架构。
- CC Switch 截图只提供长列表密度与 Agent 状态编排的视觉参考。不得复制其备份恢复、ZIP 安装、发现市场、检查更新、Agent 本体管理或其他产品能力。
- 每一项在最终验收后仍需逐条确认“接受、修改或拒绝”。只有接受项才进入同一份产品决策基线，再反向更新契约、票据和技术方案；拒绝项只保留为 Mock 设计证据。
- 搜索、索引、事件和前端缓存仍不能授权写入；原生资产、单资产单目标事务、`prepare` 无副作用、`apply` 前重校验、敏感信息保护等既有不变量不因浏览态重排而改变。

## 候选调整登记

| ID      | 候选 UI 调整               | 预期 UI 表达                                                                                                                                               | 必须保留的边界                                                                                                            | 状态      |
| ------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------- |
| UI-C-01 | 当前类型资产库             | 删除“当前类型／全部”范围 Tab；在每个一级资产类目下只列出该类型资产，筛选继续约束当前类目。                                                                 | 四类一级资产导航不变；项目、Agent、作用域和状态仍是筛选或管理维度。                                                       | `pending` |
| UI-C-02 | 右上角全局搜索             | 搜索从各类目资产库收口到右上入口与 `⌘K` 浮层；结果按资产类型分组，选择后回到对应工作台上下文。                                                             | 不成为独立搜索页或语义搜索；敏感明文不得进入索引或结果；脏草稿先经过既有保护。                                            | `pending` |
| UI-C-03 | Skills 富列表              | Skills 使用紧凑长列表：名称、来源、脱敏描述摘要、关键异常及四个 Agent 的目标状态／动作。                                                                   | 不把列表变成资产卡片墙；正常状态不重复占位；列表中的动作不能直接写入。                                                    | `pending` |
| UI-C-04 | 原生资产 + Agent 目标动作  | 每行的 Agent 信息表达为当前原生 Skill 对指定 Agent 的 `recognized`、`installable`、`convertible` 或 `blocked` 状态；可行动作进入既有单目标安装或转换闭环。 | 不创建跨 Agent 聚合身份、中央 Skill 目录、批量启停、一对多安装或 Agent 本体安装／升级／卸载。                             | `pending` |
| UI-C-05 | Skills 结构化浏览          | Skills 浏览态仅展示结构化信息：名称、描述、版本、依赖、作用域、生效上下文、来源和 Agent 目标状态。                                                         | 未知字段、内容保真和只读边界仍由原生内容与适配器能力决定；不把结构化摘要表述为新的资产事实。                              | `pending` |
| UI-C-06 | 聚焦源码编辑               | 仅在显式“编辑”后显示源码；多文件 Skill 的文件树也仅在编辑、审查和冲突表面出现。                                                                            | 同一工作区、单活动草稿、dirty guard、审查、确认和结果闭环保持；不打开独立详情页或独立编辑窗口。                           | `pending` |
| UI-C-07 | 浏览态隐藏检查器与风险分组 | Skills 浏览态不单列检查器，也不显示“兼容与漂移”“变更与恢复”分组。必要的上下文改在结构化摘要或列表中呈现。                                                  | 会影响写入安全的兼容、漂移、Git、冲突、恢复点和稳定原因码，必须在对应编辑、安装、转换、审查、确认或结果阶段重新完整呈现。 | `pending` |
| UI-C-08 | 响应式与焦点恢复           | 宽屏下为 Skills 列表与结构化详情并列；不足以维持可读性时，按“列表 → 详情”的单表面切换，并保留返回、选择、滚动与键盘焦点上下文。                            | 不降低源码、关键操作或安全状态的可读性；减少动态效果、`Esc`、浮层关闭和焦点恢复继续适用。                                 | `pending` |

## 对既有产物的候选影响映射

### 产品决策基线（最终验收后才回写）

| 候选项                    | 可能影响的基线章节                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 后续需要核对的内容                                                                                                           | 状态      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- |
| UI-C-01、UI-C-02          | [7.2 主工作区布局](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#72-主工作区布局)、[7.4 列表与检索](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#74-列表与检索)、[7.6 搜索索引一致性](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#76-搜索索引一致性)、[20.1 问题 65](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#201-核心收尾批已确认)                                                                                                                                                                                                                                                          | 将当前类目列表与右上全局搜索的责任、查询范围、筛选关系、脏草稿保护、索引状态和响应式入口写为一个不矛盾的模型。               | `pending` |
| UI-C-03、UI-C-04          | [5 资产模型](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#5-资产模型)、[6 Agent 支持范围](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#6-agent-支持范围)、[7.4 列表与检索](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#74-列表与检索)、[9 确定性跨 Agent 转换](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#9-确定性跨-agent-转换)                                                                                                                                                                                                                                                              | 确认 Agent 状态是原生资产的展示投影；安装和转换均是既有单目标操作入口，而非行内开关或新资产模型。                            | `pending` |
| UI-C-05、UI-C-06、UI-C-07 | [7.2 主工作区布局](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#72-主工作区布局)、[7.5 资产详情](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#75-资产详情)、[8.3 原生结构化编辑 + 源码兜底](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#83-原生结构化编辑--源码兜底)、[10 兼容性策略](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#10-兼容性策略)、[11 变更事务与并发控制](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#11-变更事务与并发控制)、[12 来源、漂移与辅助元数据](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#12-来源漂移与辅助元数据) | 明确 Skills 浏览态的结构化摘要、源码和文件树进入编辑态的边界，以及风险／恢复信息从浏览态隐藏但在安全操作阶段完整恢复的规则。 | `pending` |
| UI-C-08                   | [7.2 主工作区布局](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#72-主工作区布局)、[20.5 统一视觉规范](../../../docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md#205-统一视觉规范已确认)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 把 Skills 的单表面窄窗口模型与既有收拢、浮层、分隔线、键盘和减少动态效果要求统一，不留两个响应式模型并存。                   | `pending` |

### 前端契约、旅程与 fixtures（最终验收后才回写）

| 候选项                    | 可能影响的契约表面                                                                                                                                                        | 旅程／fixture 影响                                                                                     | 状态      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| UI-C-01、UI-C-02          | `AssetListQuery`、`AssetListSnapshot`、`AssetSummary`、workbench load state；需决定“类目列表”与“全局搜索”是否复用同一 query 的明确范围。                                  | FX-01、FX-07、FX-12：当前类型列表、全局搜索分组、索引 stale／failed、键盘与焦点恢复。                  | `pending` |
| UI-C-03、UI-C-04          | `AssetSummary` 或对应只读 projection、`ActionAvailability`、`installAsset`、`convertAsset`、install／conversion workflow。                                                | FX-01、FX-09–FX-11、FX-15：四个 Agent 的可解释状态；只有 `prepare → review → confirm → apply` 可写入。 | `pending` |
| UI-C-05、UI-C-06、UI-C-07 | `AssetDetailQuery`、`AssetDetailSnapshot`、`InspectorData`、`NativeFileQuery`、asset workflow、`ValidationFinding`、`CompatibilityStatus`、`GitStatus`、`RecoveryPoint`。 | FX-01–FX-05、FX-12、FX-16、FX-18：浏览态不取代编辑／审查时的原生、风险、冲突和恢复事实。               | `pending` |
| UI-C-08                   | frontend-local workspace state、focus／overlay／splitter 交互约束。                                                                                                       | FX-12：窄窗口、键盘、焦点恢复、减少动态效果和敏感临时查看。                                            | `pending` |

正式契约仍以 [前端契约 v0.1](../../../docs/frontend/Agent_Config_Manager_前端契约_v0.1.md) 为准；本文不新增字段、query、intent、fixture 或状态机。

### 前端票据（最终验收后才调整验收表达）

| 票据                                                                                                                   | 潜在调整面                                                                  | 状态      |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------- |
| [FE-01 只读工作台](../../../.scratch/agent-config-manager-frontend/issues/01-read-only-workbench.md)                   | 当前类型资产库、右上全局搜索、Skills 富列表、结构化详情与状态表达。         | `pending` |
| [FE-02 原生详情与多文件资产](../../../.scratch/agent-config-manager-frontend/issues/02-native-detail-and-multifile.md) | Skills 源码／文件树只在编辑、审查、冲突表面出现；非文本和未知字段边界保持。 | `pending` |
| [FE-03 本地草稿编辑](../../../.scratch/agent-config-manager-frontend/issues/03-local-draft-editing.md)                 | 从结构化浏览态进入聚焦源码编辑、dirty guard、返回和草稿上下文恢复。         | `pending` |
| [FE-05 创建与本地导入](../../../.scratch/agent-config-manager-frontend/issues/05-create-and-import.md)                 | Skills Agent 目标为 `installAsset` 时的预填目标入口与既有审查闭环。         | `pending` |
| [FE-06 跨 Agent 转换](../../../.scratch/agent-config-manager-frontend/issues/06-cross-agent-conversion.md)             | Skills Agent 目标为 `convertAsset` 时的预填目标、完整／降级／阻断映射入口。 | `pending` |
| [FE-10 集成验收](../../../.scratch/agent-config-manager-frontend/issues/10-integrated-ui-acceptance.md)                | 全局搜索、窄窗口单表面、键盘、焦点恢复、减少动态效果及脱敏回归。            | `pending` |

票据依赖图、`ARCH-GATE` 状态和 FE-02～FE-10 的暂停状态不由本文修改。

### 技术方案与 wire（最终验收并完成契约回写后才评估）

| 候选项                    | 可能需要复核的技术面                                                                                                                                                                                                                                                                                                                                                          | 当前结论                                                                                                | 状态      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| UI-C-01、UI-C-02          | `FrontendGateway.read` 对 `AssetListQuery`／结果范围的映射；[ARC-02b 三个 verb command](../../../docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md#32-arc-02b三个-verb-command--单一-invalidation-event) 与 [ARC-06c wire schema](../../../docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md#314-arc-06cwire-schema-rust-first-dto--ts-rs) 的 query DTO。 | 可能是既有 read query 的范围表达调整；未获契约批准前不增加 command、event、DTO 字段或 `wireVersion`。   | `pending` |
| UI-C-03、UI-C-04          | `AssetSummary` 展示 projection、Agent capability／action availability；[ARC-06a WorkspaceSession](../../../docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md#312-arc-06aframework-neutral-深-workspacesession)。                                                                                                                                                    | 优先复用既有 read／prepare／apply 和 `installAsset`／`convertAsset`；不得因为行内展示引入直接写入 RPC。 | `pending` |
| UI-C-05、UI-C-06、UI-C-07 | 结构化摘要读取、编辑后 `NativeFileQuery`、SourceEditor、检查器状态装配；[ARC-06b 工作台控件](../../../docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md#313-arc-06bcodemirror-6--契约驱动工作台控件)。                                                                                                                                                              | 仅在正式契约证明需要新读模型时才改 wire；源码、风险、diff 和恢复仍由既有 gateway 事实驱动。             | `pending` |
| UI-C-08                   | WorkspaceSession 的本地布局／焦点 state 与 renderer journey 测试层。                                                                                                                                                                                                                                                                                                          | 不改变 gateway 事实来源、IPC 或 core；实现细节待正式票据执行时决定。                                    | `pending` |

正式技术方案与 wire 仍以 [技术方案 v0.1](../../../docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md) 为准。

## UI 定稿后的回写顺序

1. 记录最终验收结论：对 UI-C-01 至 UI-C-08 分别标记 accepted、modified 或 rejected，并保留拒绝理由。
2. 仅把 accepted／modified 项回写到同一份产品决策基线；若触及产品能力而非界面编排，先走最小 Change Request。
3. 从基线反向更新前端契约的类型、状态机、fixture catalog 与覆盖矩阵，再更新 FE-01、FE-02、FE-03、FE-05、FE-06、FE-10 的验收表达。
4. 最后复核技术方案和 wire 是否仍可由现有 `read`／`prepare`／`apply`／`observe` 实现；只有契约变更确实不可映射时，才做最小架构或 wire 变更。
5. 重新运行对应 Mock、契约和票据验证；在正式 FE-01 重做并独立审查通过前，不恢复后续 FE DAG 实现。
