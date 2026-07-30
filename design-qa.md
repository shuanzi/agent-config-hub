# Agent Config Manager `selected` UI Mock：第二轮设计 QA

## 验收对象

- 视觉参考：`/Users/xiquandai/.codex/visualizations/2026/07/29/019fabb3-6d67-76c3-a8c7-22427a9ff413/cc-switch-reference-current.png`
- 本轮调整前：`/Users/xiquandai/.codex/visualizations/2026/07/29/019fabb3-6d67-76c3-a8c7-22427a9ff413/annotations-round2-browse-before.png`
- 本轮一级列表：`/Users/xiquandai/.codex/visualizations/2026/07/29/019fabb3-6d67-76c3-a8c7-22427a9ff413/annotations-round2-browse-after.png`
- 本轮二级详情：`/Users/xiquandai/.codex/visualizations/2026/07/29/019fabb3-6d67-76c3-a8c7-22427a9ff413/annotations-round2-detail-after.png`
- 本轮窄窗列表：`/Users/xiquandai/.codex/visualizations/2026/07/29/019fabb3-6d67-76c3-a8c7-22427a9ff413/annotations-round2-narrow-after.png`
- 本轮项目导入：`/Users/xiquandai/.codex/visualizations/2026/07/29/019fabb3-6d67-76c3-a8c7-22427a9ff413/annotations-round2-create-after.png`
- 本轮管理页：`/Users/xiquandai/.codex/visualizations/2026/07/29/019fabb3-6d67-76c3-a8c7-22427a9ff413/annotations-round2-manage-after.png`
- 参考／调整前／调整后同屏：`/Users/xiquandai/.codex/visualizations/2026/07/29/019fabb3-6d67-76c3-a8c7-22427a9ff413/annotations-round2-comparison.png`
- 原型状态：`variant=selected / journey=browse / scenario=ready`

CC Switch 只作为 Skills 长列表密度、两行信息和 Agent 位置交互的视觉参考；资产类型 Rail、全局搜索、项目管理和原型控制条仍沿用 Agent Config Manager 已选方向。

## 视口与比较口径

| 对象           | 视口／像素                        | 用途                               |
| -------------- | --------------------------------- | ---------------------------------- |
| CC Switch 参考 | 768 × 840 px                      | 列表密度与 Agent 状态位置          |
| 调整前         | 1063 × 964 px                     | 原一级页双栏与筛选按钮             |
| 调整后         | 1063 × 964 px                     | 一级页纯列表、范围 Tabs 与行内启停 |
| 窄窗预设       | Mock 内部窄窗；截图 1063 × 964 px | 无横向溢出的单表面列表             |
| 同屏对比       | 3008 × 964 px                     | 参考、调整前、调整后三方视觉判断   |

调整前后使用相同浏览器视口和同一 `browse / ready` 状态。窄窗通过原型控制器切换内部预设，并额外检查列表容器 `scrollWidth === clientWidth`。

## 对比结论

### 已达成

- Skills 一级页只保留全宽列表；右侧结构化详情不再与列表并列。
- 点击任一 Skill 行进入独立二级详情；详情仅展示结构化信息，并保留明确的“返回列表”和“编辑源码”入口。
- Skills 的筛选按钮已移除，改为始终可见的“全部／全局／项目”范围 Tabs；默认“全部”。
- “全部”中全局 Skill 稳定排在项目 Skill 前；项目 Skill 直接显示 `acme/desktop`、`acme/server` 等项目名。
- 四个 Agent 位置直接表达“已启用／未启用／不可用”；可用项可点击切换，不可用项置灰且为原生 disabled 控件。
- Agent 汇总数字随行内启停同步变化；所有状态只存在于 Mock 内存。
- 顶部只提供“导入项目 Skill”；导入面只允许从已管理项目和该项目已有 Skill 中选择，不提供新建模板或任意本地文件导入。
- `selected` 的管理区域不再出现恢复点 Tab，旅程控制器不再出现恢复旅程，恢复直链会归一化到浏览列表。
- 项目导入、管理、审查和结果等次级流程使用完整二级页面，不再被一级列表挤压。
- 源码编辑仍能从二级详情进入，文件与编辑控件只在编辑层级出现。
- 窄窗列表没有横向溢出；Tabs、项目名和四个 Agent 状态仍可读。

### 有意保留的边界

- A／B／C 仍保留原有创建、恢复和回滚界面，作为第一阶段设计证据；本轮只调整 `selected`。
- Agent 行内启停是纯内存交互，不调用 gateway、Tauri、网络、磁盘或真实 Agent 配置。
- “移除恢复／历史／回滚”只改变 `selected` 的可见 UI，不在本轮删除正式契约或内部事务安全语义。
- CC Switch 的品牌图标和额外安装入口没有复制；Mock 继续使用文字状态，避免引入无来源资产和未确认能力。

## 交互与运行复核

- 作用域 Tabs：全局与项目结果互斥，返回全部后全局优先。
- Agent 启停：按钮的 `aria-pressed` 与汇总数字同步；不可用按钮带 `disabled`。
- 页面层级：列表 → 二级详情 → 源码编辑成立；二级详情不显示文件树。
- 项目导入：默认 `acme/desktop / commit-message-guide`；切换 `acme/server` 后联动到 `test-scout`，并能进入本地草稿。
- 状态隔离：A/B/C 与 `selected` 互相切换时，各自恢复对应的“新建”或“项目导入”状态；取消后重新导入也会重置为一致的项目和 Skill。
- 管理区域：只保留“项目与索引”“Agent 与适配器”。
- 兼容证据：方案 A 的恢复与新建旅程仍可打开，证明早期方案未被改写。
- 新开的干净验收页没有 console error。
- 构建、前端测试、静态校验和格式检查通过。

## 迭代记录

1. 根据 6 条浏览器批注，将 Skills 一级双栏调整为一级列表与二级详情。
2. 将筛选弹层改为范围 Tabs，并补充全局优先排序和项目名。
3. 将 Agent 的“安装／转换入口”改为纯内存启停，并让不可用状态不可点击。
4. 将 `selected` 创建旅程收敛为项目内 Skill 导入。
5. 移除 `selected` 的恢复、历史和回滚可见入口，同时保留 A／B／C 证据。
6. 修复项目导入默认值与显示值不一致、隐藏 Agent 筛选残留和窄窗横向溢出。
7. 根据独立审查修复方案切换状态串扰、导入重入不一致、阻断文案和 Tabs 方向键行为。
8. 将项目导入与管理等次级流程收拢为完整二级页面，消除窄主区文字换行和控件重叠。
9. 使用同视口三方对比复核列表密度、信息层级和主任务聚焦。

## 最终结果

final result: passed
