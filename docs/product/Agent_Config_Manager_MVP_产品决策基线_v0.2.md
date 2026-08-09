# Agent Config Manager：MVP 产品决策基线 v0.2

> 状态：**Frozen（已验收）**
>
> 用户验收：**2026-08-09，用户在本 Codex task 中明确回复“验收 v0.2”**
>
> 冻结 fingerprint：`sha256:5993102ba5a4503b6a3ba734d4d90503ad2cf648183ff5297d850c4351654d5b`
>
> fingerprint 计算范围：从首个 `## 1.` 标题起至文件末尾的 UTF-8 文本（LF）；排除标题与本 metadata 区块
>
> 适用阶段：已冻结产品决策基线（OpenSpec task 1.1–1.2 已完成）
>
> 正式 source of truth：OpenSpec change [`adopt-selected-b2-ui-baseline`](../../openspec/changes/adopt-selected-b2-ui-baseline/)
>
> 历史基线：v0.1 原文保留、未被改写；其 SHA-256 为
> `0c28dade5e6f58acfc10296ea6d83437c045a68afdd9b37ba307bfc818f9a1df`

## 1. 文档目的、状态与适用规则

本文把 OpenSpec change `adopt-selected-b2-ui-baseline` 的产品级决策汇总为已冻结的 v0.2
基线。它不是 frontend contract、wire schema、技术方案、FE acceptance、tracker 或生产
实现说明。

v0.1 是不可覆盖的已验收历史基线：其原文和当时状态继续保留。对 v0.1 与本 change
明确点名的冲突，本基线以 OpenSpec 决策为优先；对 OpenSpec 未点名的 v0.1 条款，按
第 11 节继续保留。第 12 节原先待决的“固定常驻辅助检查器”冲突，已由用户于
2026-08-09 明确选择 A 予以消解；用户随后于同日明确验收整份 v0.2。

本基线已完成独立只读复核、用户明确验收与冻结。metadata 中的 fingerprint 唯一标识
本次冻结的产品决策正文，可供后续独立 slice 建立 frontend contract v0.2 时引用；本次
冻结不代表任何 frontend contract、FE ticket 或运行时能力已经完成。

## 2. v0.2 MVP 范围

### 2.1 一句话定义

Agent Config Manager 仍是面向单用户、本地运行、跨 Coding Agent 的原生配置资产
控制台。v0.2 的 MVP 工作台以三类可见资产为中心：**Skills、长期指令、Subagents**。
它帮助用户在受支持的 Agent 与作用域中定位、理解并安全地管理原生资产，而不创建
中央资产副本库，不运行 Agent 或资产代码，也不承诺跨 Agent 行为等价。

### 2.2 MVP 可见类型与 Hook 兼容边界

一级导航、全局搜索、创建入口和 MVP 转换矩阵是封闭集合，只能呈现：

- Skills；
- 长期指令；
- Subagents。

底层身份仍可解码 `hook`，以保留 legacy fixture、Adapter／wire 兼容及迁移证据。Hook
不得生成、解析或渲染任何 MVP 工作台目的地；历史选择、缓存状态或直接引用若指向
Hook，必须返回“无可用 MVP 目的地”，而不是渲染 Hook 详情。

**FX-03 的保留边界**：Hook 仍须覆盖 Adapter／wire decode、未知字段保留、
`EXECUTABLE_CONTENT_RISK`、敏感值遮蔽和 no-execution contract/security 语义；它也是
Hook UI 不可达的负例。FX-03 不构成 Hook 的浏览、编辑或转换正向 journey。

### 2.3 四个一等支持 Agent

本基线继续以 Claude Code、Codex、Gemini CLI、OpenCode 为四个一等支持 Agent。
版本化 Adapter 仍须表达支持、只读、未知或阻断等原生事实；本产品不执行 Agent
本体的安装、升级、卸载或运行时托管。

## 3. 工作台、作用域与列表不变量

### 3.1 类型优先的工作台

主路径是“**资产类型 → 作用域 → 类型差异化主表面**”。首次进入默认选择为
**Skills + 全部**。资产类型与作用域正交：用户先选类型，再选择以下一种读取上下文：

- `all`：全部；
- `global`：全局配置；
- `project(projectId)`：一个具体项目。

`projectId` 是不透明身份；项目展示名称和路径仅用于展示或消歧，绝不能用作身份。
窄屏统一退化为“类型 → 作用域 → 列表 → 详情／编辑”的单表面栈，并必须保留回到
原类型、作用域和列表上下文的路径。

### 3.2 来源分段、稳定排序与单一全局分页

产品级列表固定以下顺序，不得将任何来源段独立分页：

`筛选 → 固定来源段序 → 段内稳定排序 → 结果扁平化 → 单一全局分页`

聚合总数、来源分段可见性及分页跨越来源边界的语义均须保留。空段不得渲染。具体
视图段序如下：

| 作用域               | 必须呈现的固定段序                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `all`                | 先呈现非空全局适用段；随后呈现非空项目段。项目段按项目展示名稳定升序；同名时以不透明 `projectId` 作确定性 tie-break。 |
| `global`             | 只呈现非空全局资产段。                                                                                                |
| `project(projectId)` | 先呈现非空项目自有段；再呈现已解析且非空的全局适用段。                                                                |

全局搜索只用于定位 MVP 可见资产。搜索或选择搜索结果不得创建草稿、准备写入、
授权写入或改变实际资产状态；选择结果只导航到可查看上下文。

以下是将来 frontend contract v0.2 和 UI acceptance 的细化，**不是本产品基线的
MUST**：页大小（包括 `20／50／100`）、默认排序、同名输入项顺序、筛选／作用域等
条件改变后是否回到第一页、翻页后的滚动与焦点、搜索结果是否分页及其具体呈现。

## 4. 已解析的全局适用性与项目视图

项目视图是 Adapter 已解析事实的投影，不是“所有全局资产默认适用”的演示假设。
一个项目视图始终包含本项目自有资产；全局资产只有在版本化 Adapter 明确解析为对
该 `projectId` 生效时，才进入“全局适用”分段。

每个已解析有效上下文至少须具有可审计的：

- Adapter 身份与版本；
- 规则版本；
- 权威读取 revision；
- 具体上下文身份；
- 来源层级、加载顺序、优先级与覆盖关系。

未知、blocked 或 stale 的适用性必须有稳定 reason code，可在 `all`／`global` 中作为
可检查的发现事实呈现，但必须 **fail-closed**：不得进入任一项目的全局适用分段。
适用性绑定其 Adapter／规则版本和权威 revision；任一版本、revision 或受影响 contexts
集合过期或变化，旧投影和旧审查均失效。

在 `prepare` 前和 `apply` 前必须权威重读并重验适用性。若事实改变，系统必须重新计算、
审查和确认，不得利用旧投影写入。

从项目视图编辑一个被投影的全局资产时，必须保持其全局 `AssetRef` 与 scope，写回
原生全局资产；在审查或确认前显示全部已解析受影响 contexts。不得隐式创建项目副本。

## 5. Skill 的四 Agent 事务式期望状态

每个 Skill 的 Claude Code、Codex、Gemini CLI、OpenCode 单元格表达的是**期望状态
控制**，不是即时开关。每个单元格必须显示实际状态、可用操作、稳定原因，以及存在时
的当前事务标识；事务进行中仍显示权威重读前的实际状态。

开启一个未启用单元格时，所选列确定目标 Agent，并进入目标设置：预填的目标 scope
和原生位置在 `prepare` 前可见且可修改。Adapter 只能将请求解析为：

- `installAsset`（已验证同格式目标）；
- `convertAsset`（已验证的异构目标映射）；或
- `blocked`（无法证明安全映射）。

安装或转换必须依次经过 `prepare → review → confirm → apply → revision 重验 → 恢复`
的安全闭环。`prepare` 成功后，目标 scope 与原生位置冻结；更改任一参数必须使既有
prepared、review 与 confirm 失效，并回到重新 prepare／review。确认摘要必须呈现最终
操作类别、目标 Agent、目标 scope、原生位置、能力映射和差异。

关闭已启用单元格时，只有 Adapter 已验证目标具有原生停用语义，才能解析为
`editAsset`；否则控制必须禁用并给出稳定原因。关闭绝不回落为 `deleteAsset`，删除始终
是独立且显式的受保护操作。

实际状态只在 `apply` 成功且受影响事实权威重读后更新。取消、冲突、失败、回滚或
apply 成功但重读失败时，保留原实际状态，并以 pending／结果／待重读原因解释。

Agent 期望状态单元格是 **Skill 安装与转换的唯一主入口**。Skill 列表和详情不得提供
第二个安装或转换启动入口；阻断原因、事务状态、事务结果与显式删除仍必须可达。

## 6. 三类类型差异化表面与共享安全边界

三类资产共享一个活动草稿、dirty guard、审查、确认、apply、revision 重验和恢复语义。
实际写入不得因表面不同而绕过安全闭环；存在 dirty 草稿时，切换资产或作用域必须先经
dirty guard。

| 资产类型  | 宽／中屏主表面                                                                                          | 编辑与转换边界                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skills    | 默认只读结构化详情，展示身份、来源、兼容性和 Agent 状态。打开详情不创建草稿，也不要求读取原生文件内容。 | 明确的次级“源码编辑”映射为 `editAsset`；必须按多文件、未知字段、注释、附属资源与只读边界呈现事实。该入口不是安装或转换入口。                                                          |
| 长期指令  | 采用 master-detail，并在右侧直接呈现 Markdown 编辑器。                                                  | 选择或聚焦不创建草稿；只有首次实际内容差异才创建本地 dirty draft。实际变更映射为 `editAsset`。只读、未知或不兼容结构禁用编辑并给出稳定原因；不提供跨 Agent 转换。                     |
| Subagents | 默认只读 master-detail，展示结构化身份、模型、工具、权限、来源和正文。浏览不创建草稿。                  | 明确的次级编辑只能修改已验证可无损往返的字段以及原生 Prompt／配置源码，并映射为 `editAsset`。未知字段、扩展内容或不兼容结构必须保真或只读；次级“转换”入口仅用于本节允许的确定性转换。 |

窄屏不复制另一套产品语义：以上三类表面均进入第 3.1 节的单表面详情／编辑旅程。

## 7. 确定性跨 Agent 转换

### 7.1 范围与入口

确定性转换只覆盖 Skills 与 Subagents。每次转换只允许一个源资产、一个目标 Agent 与
一个目标 scope，依次经过目标选择、能力映射、审查、确认与 apply；不支持批量转换、
矩阵式写入或一对多安装。

Skill 必须从 Agent 期望状态单元格启动转换；Subagent 必须从详情的次级转换入口启动。
长期指令和 Hooks 没有转换可用性、转换入口或已验证转换结果。长期指令在其他 Agent
中的创建／本地导入属于独立原生资产创建，必须显式目标化，且不得复用转换映射或暗示
语义等价。

### 7.2 24 条有方向路径

下表是本 MVP 唯一可分析的转换路径全集。它们的“存在”不等于任意输入一定可写入：
每条均须通过目标版本验证和实际能力映射。

|   # | 资产类型 | 源 Agent    | 目标 Agent  |
| --: | -------- | ----------- | ----------- |
|   1 | Skill    | Claude Code | Codex       |
|   2 | Skill    | Claude Code | Gemini CLI  |
|   3 | Skill    | Claude Code | OpenCode    |
|   4 | Skill    | Codex       | Claude Code |
|   5 | Skill    | Codex       | Gemini CLI  |
|   6 | Skill    | Codex       | OpenCode    |
|   7 | Skill    | Gemini CLI  | Claude Code |
|   8 | Skill    | Gemini CLI  | Codex       |
|   9 | Skill    | Gemini CLI  | OpenCode    |
|  10 | Skill    | OpenCode    | Claude Code |
|  11 | Skill    | OpenCode    | Codex       |
|  12 | Skill    | OpenCode    | Gemini CLI  |
|  13 | Subagent | Claude Code | Codex       |
|  14 | Subagent | Claude Code | Gemini CLI  |
|  15 | Subagent | Claude Code | OpenCode    |
|  16 | Subagent | Codex       | Claude Code |
|  17 | Subagent | Codex       | Gemini CLI  |
|  18 | Subagent | Codex       | OpenCode    |
|  19 | Subagent | Gemini CLI  | Claude Code |
|  20 | Subagent | Gemini CLI  | Codex       |
|  21 | Subagent | Gemini CLI  | OpenCode    |
|  22 | Subagent | OpenCode    | Claude Code |
|  23 | Subagent | OpenCode    | Codex       |
|  24 | Subagent | OpenCode    | Gemini CLI  |

### 7.3 保真、阻断、raw-copy 与结果独立性

只映射目标 Agent 当前已验证版本的结构。Prompt 与未知扩展内容只有两种结果：
可保真 round-trip 时才可继续；不能保真时必须 `blocked`，不得表述为 degraded、
prepared 或 applied。模型、工具、权限或其他行为若不能证明安全映射，必须在任何写入
前明确报告为 manual work、degraded 或 blocked。

原始跨 Agent copy 不是转换：它不得被表述为转换、不得产生转换结果、不得绕过目标
选择／能力映射／审查／确认／apply。成功转换的结果是目标 Agent 的独立原生资产，
不与源资产持续同步，且只能在 apply 成功并权威重读后显示为实际可用。

## 8. 五项 OpenSpec capability 的产品承接

| Capability                                                                                                                            | 本文承接                                                                                                     | 产品级边界                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [`asset-workbench-navigation`](../../openspec/changes/adopt-selected-b2-ui-baseline/specs/asset-workbench-navigation/spec.md)         | 第 2.2、3 节：三类可见资产、类型优先、三类作用域、来源段序、单一全局分页、定位搜索和窄屏栈。                 | 不把列表控件参数、默认值、焦点或搜索分页细节提升为产品 MUST。   |
| [`resolved-global-applicability`](../../openspec/changes/adopt-selected-b2-ui-baseline/specs/resolved-global-applicability/spec.md)   | 第 4 节：Adapter 已解析投影、可解释适用事实、unknown／blocked／stale fail-closed、freshness 与原生全局写回。 | 不以项目名或路径充当身份；不因项目操作创建副本。                |
| [`skill-agent-state-control`](../../openspec/changes/adopt-selected-b2-ui-baseline/specs/skill-agent-state-control/spec.md)           | 第 5 节：四 Agent 期望状态、目标设置、事务闭环、原生停用、确认后状态更新与唯一入口。                         | 不新增通用 `setSkillEnabled`；toggle 不得回落为删除。           |
| [`type-specific-asset-surfaces`](../../openspec/changes/adopt-selected-b2-ui-baseline/specs/type-specific-asset-surfaces/spec.md)     | 第 6 节：Skill、长期指令、Subagent 的查看、编辑与草稿差异，以及宽／中／窄表面。                              | 共享 dirty guard 和安全事务；未知或不兼容内容不伪装为完整编辑。 |
| [`deterministic-conversion-scope`](../../openspec/changes/adopt-selected-b2-ui-baseline/specs/deterministic-conversion-scope/spec.md) | 第 7 节：Skills 与 Subagents 的 24 条路径、类型特定入口、长期指令／Hooks 排除、保真与 no-sync。              | 不允许 batch／raw-copy 伪装为转换，也不承诺行为等价。           |

## 9. PD-UI-B2-01～10 追溯索引

下表是已确认产品语义到本基线正文的定位索引。它只为追溯服务；具体 Requirement
措辞及约束仍以本 change 的五项 capability 为准。

| 决策        | 已承接的产品语义                                                        | 正文                                                            |
| ----------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| PD-UI-B2-01 | Hooks 退出 MVP UI，但保留底层兼容与 FX-03 负例。                        | [2.2](#22-mvp-可见类型与-hook-兼容边界)                         |
| PD-UI-B2-02 | 全局资产仅按 Adapter 解析投影到项目；未知封闭失败，且编辑原生全局资产。 | [4](#4-已解析的全局适用性与项目视图)                            |
| PD-UI-B2-03 | Skill 四 Agent 单元格是事务式期望状态，不是即时开关。                   | [5](#5-skill-的四-agent-事务式期望状态)                         |
| PD-UI-B2-04 | Skill 安装／转换仅由 Agent 单元格主入口启动。                           | [5](#5-skill-的四-agent-事务式期望状态)                         |
| PD-UI-B2-05 | 长期指令无跨 Agent 转换；创建／导入为独立原生资产创建。                 | [6](#6-三类类型差异化表面与共享安全边界)、[7.1](#71-范围与入口) |
| PD-UI-B2-06 | Skill 默认只读，保留次级源码编辑。                                      | [6](#6-三类类型差异化表面与共享安全边界)                        |
| PD-UI-B2-07 | Subagent 默认只读，保留次级安全编辑。                                   | [6](#6-三类类型差异化表面与共享安全边界)                        |
| PD-UI-B2-08 | Subagent 保留单资产、单目标的确定性转换。                               | [7](#7-确定性跨-agent-转换)                                     |
| PD-UI-B2-09 | 长期指令直接编辑，仅首次实际修改建立草稿。                              | [6](#6-三类类型差异化表面与共享安全边界)                        |
| PD-UI-B2-10 | 列表只固化分段、稳定排序、扁平化、单一全局分页和搜索无写副作用。        | [3.2](#32-来源分段稳定排序与单一全局分页)                       |

## 10. 安全事务、原生事实与证据边界

除本基线明确替代的范围外，v0.1 的原生资产优先、原位管理、默认封闭失败、无静默
数据损失、单资产单目标事务、快照／原子应用／回滚、乐观并发控制、可恢复删除、
敏感信息保护、静态而不执行可执行资产、Git 只读感知、来源与漂移记录但不自动同步等
产品约束继续有效。

尤其是所有实际写入都必须走既有安全事务，不得绕过 `prepare → review → confirm → apply`
及 revision 重验和恢复。项目投影、Skill toggle、直接编辑和转换都不改变这一约束。

Mock、截图、静态检查、synthetic fixture、文档草稿、OpenSpec validation 或本次独立
文档复核，均**不等于** actual runtime evidence，也不能关闭 FE ticket、ARCH-GATE 或
RELEASE-GATE。只有各 ticket 按其已冻结 acceptance 获得 provenance-appropriate 的
actual 证据，才可能改变对应状态；本任务不执行该工作。

## 11. 相对 v0.1 的替代与保留矩阵

### 11.1 已由 v0.2 替代或收敛的 v0.1 条款

| v0.1 主题                                                                               | v0.2 处置                                  | 替代后的规则                                                                                                                                       |
| --------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 四类 MVP 资产、四类一级导航与四类正向聚合验收（§2、§3.1、§4.3、§5.1、§7.3、§16.1、§18） | **Superseded（点名冲突优先）**             | MVP UI、搜索、创建和转换只呈现 Skills、长期指令、Subagents；Hook 仅保留底层兼容与 FX-03 负例，不再生成正向浏览或聚合验收 journey。                 |
| 通用“全部同类资产”列表与无分组默认（§7.4、§18）                                         | **Superseded**                             | 按第 3.2 节的 `all`／`global`／`project` 固定段序、稳定排序、扁平化和单一全局分页呈现。                                                            |
| 列表内搜索和跨类型范围切换（§7.4、§20.1 问题 65）                                       | **Superseded（产品语义层）**               | 全局搜索定位三类可见资产且无写副作用；具体搜索入口、结果呈现和交互参数下沉 frontend contract。                                                     |
| 统一的四类资产详情／编辑模型（§7.2、§7.5、§8.3）                                        | **Superseded**                             | 按第 6 节采用 Skills、长期指令、Subagents 的差异化主表面，同时保留共享安全事务。                                                                   |
| 从四类资产入口创建（§8.1）                                                              | **Superseded**                             | MVP 创建入口仅覆盖三类可见资产；Hook 不生成 MVP 创建目的地。                                                                                       |
| 四类资产 × 四 Agent 的 48 条逻辑转换路径及三档通用写入结论（§9.3、§9.4、§10.3、§16.3）  | **Superseded**                             | 仅 Skills 与 Subagents 的 24 条有方向路径；长期指令与 Hook 排除。Prompt／未知扩展内容只能保真或 blocked。                                          |
| 泛化生效上下文说明（§5.3，以及 §16.1 中的上下文／未知状态条款）                         | **Superseded／细化**                       | 项目视图的全局适用性必须来自版本化 Adapter 的显式解析，具可解释 facts、freshness 与 fail-closed；这不恢复 §16.1 的四类资产正向 UI 验收。           |
| 以规范化路径识别并去重项目（§6.4）                                                      | **Superseded（身份规则）**                 | 项目身份使用不透明 `projectId`；展示名称和路径只用于展示或消歧，不得充当身份。                                                                     |
| 通用编辑入口与草稿时机（§7.5、§8.3）                                                    | **Superseded／细化**                       | Skills 次级源码编辑；长期指令首次实际内容变更才建草稿；Subagent 次级安全编辑；均映射 `editAsset`。                                                 |
| 通用转换入口（§9.1、§20.1 问题 67）                                                     | **Superseded／细化**                       | Skill 仅从 Agent 单元格启动，Subagent 仅从详情次级入口启动；长期指令和 Hook 没有转换入口。                                                         |
| 固定常驻辅助检查器及其容器布局（§7.2、§7.5、§18）                                       | **Superseded（用户于 2026-08-09 选择 A）** | 不再要求固定第四个常驻检查器，也不再把其宽度、收拢、边缘轨道或浮层机制作为产品 MUST；原信息要求继续保留，具体承载方式下沉 frontend contract v0.2。 |

### 11.2 继续保留的 v0.1 条款

| 保留主题                                             | v0.1 参考                                                                                        | v0.2 中的继续有效方式                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 原生资产为唯一事实来源、原位管理、无中央副本         | §4.1–§4.2、§5.2                                                                                  | 继续有效；投影不产生副本，转换结果是独立原生资产。                                                 |
| 默认封闭失败与无静默数据损失                         | §4.4–§4.5                                                                                        | 继续有效；适用性、未知结构、版本和转换映射均不猜测。                                               |
| 项目有界发现、显式纳入与移除只停止管理               | §6.4（不含旧的规范化路径身份规则）                                                               | 继续有效；本 change 不扩大项目发现或生命周期范围，项目身份改由第 3.1 节的不透明 `projectId` 约束。 |
| 四 Agent 的版本化支持、兼容只读和官方适配器规则边界  | §6.1–§6.3、§10                                                                                   | 继续有效；v0.2 只细化 Adapter 已解析适用性与能力表达。                                             |
| 安全事务、并发控制、快照、原子应用、回滚与恢复       | §11                                                                                              | 继续有效；第 4–7 节的任何写入都进入同一闭环。                                                      |
| 可恢复删除、原生导出、Git 只读感知                   | §8.4、§11.3–§11.4                                                                                | 继续有效；删除保持独立，toggle 不得回落为删除。                                                    |
| 来源、漂移、应用私有元数据与不自动同步               | §12                                                                                              | 继续有效；转换结果不与源持续同步。                                                                 |
| 可执行资产不执行与敏感信息保护                       | §13–§14                                                                                          | 继续有效；FX-03 同时保留 no-execution 与敏感遮蔽边界。                                             |
| 单资产、单目标，无 batch／一对多写入或跨资产影响分析 | §11.6–§11.7                                                                                      | 继续有效；也是第 7 节转换边界。                                                                    |
| macOS 首发范围、平台抽象和非 MVP 能力边界            | §3.2、§6.5、§10.4、§17                                                                           | 继续有效；本 change 不改变 Agent 生命周期、DSL、云同步或执行边界。                                 |
| 未被本 change 点名的视觉、可访问性和布局条款         | §20.4–§20.5 等                                                                                   | 继续保留，但不用于反推本基线已明确替代的类型、列表、表面、转换或固定检查器容器语义。               |
| 辅助信息要求                                         | §5.3、§7.5、§16.1 中的路径、生效上下文、来源、覆盖、兼容、漂移、最近变更、恢复与关键安全状态条款 | 信息内容与可达性继续有效；第 12 节只替代固定容器及其布局机制，不删除这些信息。                     |

## 12. 固定常驻辅助检查器的替代结论

v0.1 将辅助检查器定义为固定常驻容器，并连带规定其宽度、收拢、边缘轨道和浮层等
布局细节。selected B2 的已确认 UI 方向不恢复第四个固定常驻检查器；但本 change 的
五项 capability 没有把“固定常驻检查器是否正式废止”写成可自动执行的产品决策。用户
已于 2026-08-09 明确选择 A，形成以下替代结论：

- 废止 v0.1 对固定第四个常驻辅助检查器容器的要求；
- 与该固定容器直接绑定的宽度、默认比例、可读下限／上限、分隔线、收拢、恢复回差、
  边缘轨道、覆盖式浮层及其动效，不再作为 v0.2 产品 MUST；
- 路径、生效上下文、来源与覆盖、兼容与漂移、最近变更、恢复点以及影响安全操作的
  关键状态等信息要求继续保留，不能因容器废止而被删除或变得不可达；其中影响安全
  操作的关键状态不得隐藏；
- 这些信息在三类差异化主表面中的具体承载位置、控件、默认值和焦点行为，下沉到
  frontend contract v0.2 与相应 UI acceptance；在产品 v0.2 冻结前不得启动该下游工作。

本节记录对既有冲突的单项选择；整份 v0.2 的验收事实以文首 metadata 为准。该验收不把
selected B2 Mock、截图或浏览器结果提升为生产实现或 actual runtime evidence。

## 13. task 1.2 完成与下游禁区

本基线已完成 OpenSpec task 1.1 的文档产物，以及 task 1.2 的独立只读复核、用户明确
验收、验收事实记录与冻结；`tasks.md` 仅将 1.1 和 1.2 标为完成。本 slice 在此停止。
task 1.3 或以后仍未开始，只能在后续独立 slice 中引用文首冻结 fingerprint 后推进。

本阶段的下游禁区包括但不限于：frontend contract、fixture catalog、coverage matrix、
技术方案或 addendum、ARCH-GATE、RELEASE-GATE、tracker、FE tickets、TICKET_REGISTRY、
`manifest.json`、wire、Gateway／Adapter、生产 UI 和运行时代码。Mock 或文档检查的结果
不得被用作这些下游工作已经完成或 ticket 已关闭的证据。
