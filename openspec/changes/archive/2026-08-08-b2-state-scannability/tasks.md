# Tasks: b2-state-scannability

> 实施范围：throwaway Mock（`src/prototypes/full-ui-mock/`）。所有状态保持内存合成；不触碰 Gateway/Tauri/IPC/真实文件系统；正式产物回写在用户定稿后按既有顺序另行处理。

## 1. Agent 固定分列（agent-enable-scannability）

- [x] 1.1 Skills 表头与行网格改为 4 个 Agent 固定窄列（每列 40–56px），列顺序全表一致；名称/路径列宽重新分配，验收线：路径折行不超过两行
- [x] 1.2 列头品牌 Logo + 可访问名称（aria-label/title）；列头与单元格 Logo 互为图例
- [x] 1.3 三态单元格迁入分列：启用点亮/停用置灰/阻断 dashed 不可切换；单元格全高可点、命中区 ≥40×28；原生 checkbox 的 checked/disabled/aria-label 语义保留
- [x] 1.4 1280 档 2×2 分组与窄屏行内 toggle 组两条退化路径接通，无新增断点
- [x] 1.5 会话内启停仍只写内存快照并明示"Mock 会话预览，不写入配置"，刷新复位

## 2. 来源区分（source-distinction）

- [x] 2.1 分段标题层级定型：低于表头、高于行 meta；快速滚动可辨分段边界
- [x] 2.2 来源 badge 两种专色固定，排查全表不与状态/启停用色冲突
- [x] 2.3 分段内筛选/排序/分页独立生效、两段列宽一致的回归用例

## 3. 内容型 master-detail（content-asset-master-detail）

- [x] 3.1 长期指令主表面切分为列表区（名称 + 状态）+ 内容区，选中即显示、选中即可编辑 Markdown
- [x] 3.2 Subagents 主表面同构切分（内容区展示 frontmatter + 正文）
- [x] 3.3 选中态接入既有 `data-b2-focus` 焦点机制：翻页、返回、窄屏切换后焦点归还路径与现行一致
- [x] 3.4 脏草稿切换选中项走既有 dirty guard，继续编辑保持原选中项与编辑器焦点
- [x] 3.5 窄屏退化为现有"列表 → 详情"单表面栈，不新增响应式分支

## 4. 验证

- [x] 4.1 focused L1：分列几何、三态语义、来源分段、master-detail 选中态的单测
- [x] 4.2 focused B2 L2 journey：分列扫描线位置、三态切换与阻断、分段排序、master-detail 选择与编辑、dirty guard、窄屏退化
- [x] 4.3 `verify:static`、`build:frontend`、focused ESLint/Prettier、`git diff --check`
- [x] 4.4 in-app browser smoke（宽/1280/窄三档）+ console warn/error 检查
- [x] 4.5 真实密度 Mock 数据的同尺寸前后截图对比；`design-qa.md` 在 matched-size 对比完成前维持 blocked
- [x] 4.6 独立 reviewer 复审；UI_CHANGE_IMPACT.md 登记 v22 决策的本次例外（D4）
