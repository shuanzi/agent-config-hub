# Full UI Mock（throwaway）

这是用于整体 UI 评审的 throwaway React 原型，不是正式产品实现。

- 状态与合成数据只存在于内存，不读取或写入浏览器存储、文件、网络、Tauri、真实 Agent 配置、`FrontendGateway` 或 `WorkspaceSession`。
- 运行：`npm run mock:ui`；服务固定在 `http://127.0.0.1:1421/`。
- 默认入口：`/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=0&inherit=A`。
- 开发控制器仅在 `controls=1` 时显示；`controls=0` 或省略参数时保持干净画面。

URL 参数：

- `variant=A|B|C|selected`
- `journey=browse|edit|create|convert|manage|recover`
- `scenario=ready|stale|readonly|dirty|conflict|degraded|blocked|failed`
- `controls=0|1`
- `inherit=A|B|C`：仅 `selected` 的项目浏览列表使用；本轮布局决策已选择 A（分段同表）并作为默认。B（统一混排）与 C（主表加继承侧栏）只保留为开发对照；切换器仅在 `controls=1`、selected、项目 browse list 显示。切换只更新 URL 参数，并保留当前资产、筛选、排序与启用预览。

刷新会依据 URL 重建旅程起点；草稿、面板状态、分页与所有模拟结果都不会持久化。`selected` 不提供独立恢复页面，因此 `journey=recover` 会规范化为浏览态；A、B、C 仍保留原恢复证据。

## `selected`：B2 配置资产工作台

`selected` 独立实现 B2；A、B、C 的历史 DOM、视觉和行为继续保留。

- 宽／中窗口固定为“资产类型 → 作用域 → 类型差异化主表面”三列；第一列只展示 Skills、长期指令、Subagents，第二列展示全部、全局配置和项目作用域。selected 默认落在“Skills + 全部”；shared `AssetType` 与 legacy A/B/C 仍保留 Hooks 作为历史证据。
- Skills 主表面是高密度列表并跳转结构化详情；长期指令和 Subagents 在宽／中窗口使用 master-detail 主表面。它们都不恢复第四个常驻检查器。
- 右上角 `⌘K` 打开不分页的全局搜索；类型列表只提供筛选、稳定名称升降序和 20／50／100 分页。
- 筛选、排序或每页数量变化会回到第 1 页；翻页后列表滚回顶部并把焦点交给首行。
- 项目上下文在本 Mock 中同时显示项目自有资产与“全局适用”资产；全局上下文仍只显示全局资产。所有现有 global seed 暂按适用于每个项目处理，这不是正式生效解析事实。
- 已选择的 `inherit=A` 使用共享列宽的“项目自有 → 全局适用”分段同表；`B` 与 `C` 不再是待定产品候选，仅用于回看本轮方案取舍。
- Skills 使用高密度表格，表头为“名称与状态 / 来源或路径 / Agent 启用预览”；列表整行进入结构化“查看 Skill”。四个 Agent 以本地品牌 Logo 表达会话内启用状态：启用时点亮、停用时置灰，阻断目标进一步淡化且不可切换；可访问 checkbox 语义与键盘路径保留。
- Skill 详情只展示结构化信息与启用预览，不把编辑源码、准备安装、准备转换或跨 Agent 转换作为 selected Skill 主能力。每次切换只改当前 `b2AssetSnapshots` 内存快照，并明确显示“Mock 会话预览，不写入配置”；刷新页面重置。
- 长期指令不提供跨 Agent 转换；详情只读展示当前 Agent 使用状态，并把原生 Markdown 直接作为可编辑主区域。草稿继续进入既有 review／confirm／apply Mock 闭环，不新增直接保存或真实配置写入。
- 创建、导入、转换、管理、成功、冲突、阻断、失败和回滚结果均由合成内存状态表达，不访问真实文件或执行 Git。
- 成功 Apply 会把确认过的草稿写入当前会话的 Mock 内存资产快照；再次编辑读取新内容，刷新页面才按 URL 旅程起点重置。
- 多文件 Review 自动定位首个真实变更文件，并用文件导航标记其它 changed file；Convert 的冲突／失败只返回能力映射或审查，不创建源码草稿。
- 窄窗口使用“类型 → 作用域 → 列表 → 详情／旅程”单表面栈；内容型资产从 master-detail 回落到该栈，并保留返回路径、dirty guard、Esc、焦点恢复和减少动态效果。
- selected 的通用界面图标固定使用 `lucide-react@1.28.0`；Agent 品牌标识使用随 Mock 打包的本地 SVG，不请求网络，也不引入新依赖。

## 证据边界

本原型只用于 selected B2 的产品／视觉／交互评审。所有 Mock 状态只存在于内存：不读取或写入 Gateway、IPC、Tauri、磁盘配置、浏览器存储或用户数据，也不宣称批量生产写入能力。它不改变正式产品决策基线、前端契约、Gateway、Tauri、适配器或 FE 依赖关系。新的浏览器截图与交互证据必须在当前实现上重新采集；历史截图不能作为本次实现的最终通过证据。影响登记见 [UI_CHANGE_IMPACT.md](./UI_CHANGE_IMPACT.md)，本次证据状态见仓库根目录 [design-qa.md](../../../design-qa.md)。
