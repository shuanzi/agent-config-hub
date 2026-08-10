## Why

selected B2 UI demo 已完成用户验收，但正式产品基线、前端契约、fixtures 与 FE 票据仍描述旧的四类入口、统一详情／编辑模型和 48 条转换路径。需要用一组明确的产品级规格承接已确认 UI，并把此前仅存在于 Mock 的全局适用和 Skill toggle 假设替换为可验证、默认封闭失败的正式语义。

## What Changes

- **BREAKING**：MVP UI 的一级导航、全局搜索和创建流程只呈现 Skills、长期指令与 Subagents；Hooks 退出 MVP UI 与转换矩阵，但底层类型、legacy 证据和兼容代码继续保留。
- 主工作台正式采用“资产类型 → 作用域 → 类型差异化主表面”：默认 Skills + 全部；全部、全局配置和具体项目是第二级作用域；窄屏按 类型 → 作用域 → 列表 → 详情／旅程退化。
- 资产列表在产品级只固定“筛选 → 固定段序 → 段内稳定排序 → 扁平化 → 单一全局分页”、聚合总数与跨段边界语义：all=非空全局适用段在前，随后非空项目段按项目展示名稳定升序、同名以不透明 projectId 作确定性 tie-break；global=仅非空全局资产段；project=非空项目自有段在前、已解析非空全局适用段在后，空段不渲染。页大小、默认排序、同名输入序、条件变化重置、翻页焦点和搜索分页行为由前端契约与 UI 验收定义。Skills 使用四个固定 Agent 列，内容型资产在宽／中屏使用 master-detail。
- 项目视图只投影版本化 Adapter 已明确解析为对该项目生效的全局资产；未知适用性默认封闭失败，并保留可解释的来源、加载、覆盖和阻断事实。
- Skill 的 Agent 单元格成为 presence/activation 分离的事务式期望状态控制：target absent 时开启解析为安装或转换，target 已存在但原生停用时仅在已验证 activation 语义下以编辑重新启用；关闭已启用目标同样仅映射编辑。presence/activation/适用事实不可判定时封闭失败，删除保持独立操作。Agent toggle 是 Skill 安装／转换的唯一主入口。
- Skills 默认结构化只读并保留次级源码编辑；长期指令直接编辑但首次实际修改才创建草稿，且不提供跨 Agent 转换；Subagents 默认只读 master-detail，保留次级安全编辑和确定性转换。
- **BREAKING**：确定性跨 Agent 转换矩阵从四类资产 48 条路径收敛为 Skills 与 Subagents 24 条有方向路径；长期指令和 Hooks 不进入 MVP 转换矩阵。
- 按上述行为更新产品基线、前端契约、contract／wire 需求、fixture catalog、覆盖矩阵与 FE-07R、FE-01～FE-10 的受影响验收表达；不以 Mock、静态检查或文档结果关闭运行时门禁。

## Capabilities

### New Capabilities

- `asset-workbench-navigation`: 三类资产的类型优先导航、作用域选择、来源分段、单一全局分页、全局搜索与响应式页面栈。
- `resolved-global-applicability`: Adapter 驱动的项目生效上下文解析、全局资产投影、来源／优先级／覆盖事实及未知状态的封闭失败。
- `skill-agent-state-control`: Skill 的四 Agent 事务式期望状态、目标设置、安全操作映射、pending／结果状态及唯一安装／转换入口。
- `type-specific-asset-surfaces`: Skills、长期指令与 Subagents 各自的查看、编辑、草稿和宽／中／窄主表面语义。
- `deterministic-conversion-scope`: Skills 与 Subagents 的 24 条确定性转换路径，以及长期指令／Hooks 的显式排除边界。

### Modified Capabilities

（主 `openspec/specs/` 当前为空；本 change 的五项均作为正式新增 capability 建立。）

## Impact

- 正式真相链：产品决策基线 v0.2 draft 独立复核、用户验收并冻结后，前端契约 v0.2 才以冻结 fingerprint 建立；前端契约也独立复核、用户验收并冻结后，技术方案影响复核／addendum 必须登记方案 B 内采用基础设施归属 A 的 ownership transfer、FE-07R 计划 evidence registry row，以及调整为“复用 FE-07R foundation 但保留自身 L0／L1／L2／L3／PF-01 证据”的 FE-01 计划 evidence registry row。随后按实际结果决定 ARCH-GATE 状态；在任何 contract/wire/code/UI 的生产实现前，实施必须创建并冻结 FE-07R acceptance、实际更新 tracker／DAG／README／RELEASE-GATE 等规划 artifacts（新增 FE-07R tracker row，并调整 FE-01 row 保留其自身证据），冻结 `verify:ticket` 的计划 validation command contract 和逐项更新 FE-07R、FE-01～FE-10 验收；本阶段不得预先实现可执行 `TICKET_REGISTRY` 或修改 `manifest.json`，后者仅由 FE-07R 命令运行动态生成，再重算 tracker frontier。只有 ARCH-GATE 实际为 closed 且对应 ticket 位于更新后的 ready-for-agent frontier 时，才按实际 DAG 分批实施并最终提交代码证据和票据状态；本轮规划修订不执行这些任务，当前状态不变。
- 编排（非产品 capability／PD）：ORCH-UI-B2-01 方案 B（采用基础设施归属 A）新增仍为 read-only 的 applicability 前置票据 FE-07R，并仅新增 FE-07R → FE-01。FE-07R 取得最小 Tauri test-harness／bootstrap、L0–L3 骨架、在其 vertical slice 中创建的可执行 `TICKET_REGISTRY`／orchestration entry、由 ticket／registry 驱动的 evidence manifest metadata 和读取 built-in／active Adapter／rule provenance 的只读 AdapterRegistry seam；它自身只运行 L0／L1／L3 actual-read，无 L2／UI／PF。FE-01 复用其已验证 bootstrap、shared harness 与 actual-read snapshot，负责首个 L2/browser UI/read-session slice，并在自身 ticket 内运行 FE-01-specific L0／L1／L2／L3 start／read／event／reread 和 PF-01。FE-07R 的 snapshot 仅作上游输入，provenance 不可借用为 FE-01 closure credit。FE-04～FE-09 的 L3 actual runtime credit 仅来自各自登记的 isolated temp／synthetic 输入穿过真实 WebView／Core／IPC 边界；它不证明真实用户项目、配置或生产 artifact，且 FE-08 不得声称真实 Adapter bundle actual provenance。FE-01 → FE-02 → FE-03 → FE-04、FE-02 → FE-10、FE-04 → FE-05／FE-06／FE-07／FE-08／FE-09 和全部 done → RELEASE-GATE 保持不变。原 FE-07 继续承担项目纳入、停止管理和 index 健康；不引入 FE-07M、FE-08 → FE-06 或 FE-06 → FE-10。
- 前端与契约：工作台导航／主表面、Skill Agent 单元格、操作入口；`AssetListQuery` 的项目视图语义，以及 `EffectiveContext` 的不透明项目身份与解析状态表达。
- Gateway／Adapter：FE-07R 通过只读 AdapterRegistry seam 读取 built-in／active Adapter／rule provenance 和已解析项目适用事实；Skill 期望状态继续解析到既有 `installAsset`、`convertAsset`、`editAsset` 或禁用结果；不新增通用 `setSkillEnabled` intent。
- 转换与 fixtures：矩阵、能力映射、降级／阻断样例和 FE 覆盖范围收敛为 Skills 与 Subagents。
- 不新增第三方依赖、Agent 本体生命周期能力、批量写入、中央资产副本或绕过 prepare／review／confirm／apply 的直接写入路径。
