# Agent Config Manager 全产品 UI 精细稿

2026-09-27 已按用户反馈恢复 Skills 的紧凑列表与横向投放图标，参考 cc-switch 的 `ListItemRow` / `AppToggleGroup`，保留 selected B2 三栏壳层。2026-09-24 同步的共享目录、接管流程及原生 Subagent 模型继续保留。本目录保存可编辑设计与静态预览；正式 App 的实现与运行证据另见验收文档。

- [可编辑 Pen 源文件](design.pen)
- [全产品总览](previews/product-overview.png) · [弹窗与状态总览](previews/dialogs-states-overview.png)
- [画板与预览清单](preview-manifest.tsv) · [正式 App 操作验收](../../acceptance/polished-ui.md) · [2026-09-27 运行结果](../../acceptance/polished-ui-results.md)

## 本轮同步内容

| 模块 | 当前精细稿表达 |
| --- | --- |
| Skills 列表与详情 | 五列为 Skill／来源／目标／投放位置／操作。桌面记录高 64px，位置以横向图标表示；全局包含共享目录 `~/.agents/skills`。完整路径、状态及处理入口在详情展示。统计受管资产与目录投放数。 |
| 目录状态 | 已投放、未投放、已存在·未接管、投放冲突；未接管条目进入接管流程。同物理路径合并一行；主副本所在位置不可独立撤回；冲突显示原因。 |
| 安装与 ZIP | 根据目标的实际位置列表，显式选择一个初始投放位置。图中蓝色单选为用户已选择后的状态，不是默认选择。 |
| 导入已有 | 选择唯一来源与投放位置 → 预览来源原件、受管位置及逐路径动作 → 确认接管。未选路径不自动取得所有权。 |
| 长期指令 | 每个完整目标只有一个逻辑 `AGENTS.md`。全局默认保存至 Codex、OpenCode 两处；项目保存至根目录。展示实际路径，不承诺 Agent 加载。 |
| 原生 Subagents | 每个定义归属一个 Agent，包含原生格式、路径、管理状态和源码。项目 Codex 可用；安装禁用只反映格式不兼容等实际原因。更新先审阅差异，备份与恢复按定义执行。 |

目录开关只控制该位置的投放。关闭 Codex 专用目录后，Codex 仍可能从共享目录发现 Skill。项目范围不新增共享入口；项目 Codex Skills 使用 `.agents/skills`，原生 Subagents 使用 `.codex/agents`。

## 桌面页面

| 页面 | 1586×992 | 1280×800 |
| --- | --- | --- |
| Skills 已安装 | [查看](previews/desktop-1586-skills-installed.png) | [查看](previews/desktop-1280-skills-installed.png) |
| Skill 详情 | [查看](previews/desktop-1586-skill-detail.png) | [查看](previews/desktop-1280-skill-detail.png) |
| Skills 发现 | [查看](previews/desktop-1586-skills-discovery.png) | [查看](previews/desktop-1280-skills-discovery.png) |
| 长期指令 | [查看](previews/desktop-1586-instructions.png) | [查看](previews/desktop-1280-instructions.png) |
| Subagents 已安装 | [查看](previews/desktop-1586-subagents-installed.png) | [查看](previews/desktop-1280-subagents-installed.png) |
| Subagents 发现 | [查看](previews/desktop-1586-subagents-discovery.png) | [查看](previews/desktop-1280-subagents-discovery.png) |
| 设置 | [查看](previews/desktop-1586-settings.png) | [查看](previews/desktop-1280-settings.png) |

## 窄屏页面

390×844 表达窄窗口的单表面布局。新增长期指令与原生定义的列表、详情，以及 Skills 操作菜单。路径允许换行；目录操作保留 44px 点击区域。

| 页面 | 预览 |
| --- | --- |
| 资产类型 | [查看](previews/mobile-390-asset-types.png) |
| 配置上下文 | [查看](previews/mobile-390-contexts.png) |
| Skills 已安装 | [查看](previews/mobile-390-skills-installed.png) |
| Skill 详情 | [查看](previews/mobile-390-skill-detail.png) |
| Skills 更多操作 | [查看](previews/mobile-390-skills-actions.png) |
| Skill 安装 | [查看](previews/mobile-390-install-dialog.png) |
| 长期指令列表 | [查看](previews/mobile-390-instructions.png) |
| AGENTS.md 详情 | [查看](previews/mobile-390-instruction-detail.png) |
| Subagents 列表 | [查看](previews/mobile-390-subagents-installed.png) |
| 原生定义详情 | [查看](previews/mobile-390-subagent-detail.png) |
| 设置 | [查看](previews/mobile-390-settings.png) |

## 弹窗、组件与状态

| 场景 | 预览 |
| --- | --- |
| Skill 安装 · 全局共享目录已选 | [查看](previews/dialog-skill-install.png) |
| 项目 Codex Subagent 安装 · TOML 格式 | [查看](previews/dialog-project-subagent-install.png) |
| ZIP 安装 · 单文件与初始投放位置 | [查看](previews/dialog-zip-install.png) |
| 导入已有 · 来源与位置选择 | [查看](previews/dialog-import-existing.png) |
| 接管预览 · 逐路径文件动作 | [查看](previews/dialog-import-preview.png) |
| Skill 备份恢复 · 当前目标 | [查看](previews/dialog-backup-restore.png) |
| 原生定义更新 · 审阅本地修改 | [查看](previews/dialog-subagent-update.png) |
| 原生定义备份 · 恢复冲突 | [查看](previews/dialog-subagent-backup.png) |
| 目录、指令、原生定义与空态／错误 | [查看](previews/component-states.png) |
| 可复用组件库 | [查看](previews/components-overview.png) |

## 排版与交接

紧凑列表的参考基线为 cc-switch 提交 `1ee2fdc3a791f1e73476c631c7ab7ce8fac0638f` 的 [ListItemRow](https://github.com/farion1231/cc-switch/blob/1ee2fdc3a791f1e73476c631c7ab7ce8fac0638f/src/components/common/ListItemRow.tsx) 和 [AppToggleGroup](https://github.com/farion1231/cc-switch/blob/1ee2fdc3a791f1e73476c631c7ab7ce8fac0638f/src/components/common/AppToggleGroup.tsx)。本项目保留自己的配置上下文、五列结构和完整目录详情。

- 保留桌面 66px Header、两级侧栏及窄屏 58px Header；正文 14px、辅助信息 12px、页面标题 22px。使用既有 Inter、Lucide 和品牌 SVG。
- 桌面操作区分两行，搜索与刷新置于上行，目标与导入操作置于下行。Skills 记录保持 64px，表头与内容共用列轨；行内横排四个 Agent 目录及全局共享目录图标，路径明细不撑高列表。
- 窄屏把集中操作收进“更多操作”，每条记录保留名称、来源、目标及 44px 横向图标。样例展示前 3 条记录，列表继续滚动；完整路径与异常处理进入详情。
- 已投放用勾号，未投放用减号，未接管用加号，冲突用叉号，同时区分背景色。悬停或键盘聚焦显示位置名称、完整路径、状态及动作；名称和详情入口可在无悬停设备上访问同样的信息。未接管不直接覆盖，冲突及主副本位置遵循既有禁用规则。
- 目录、名称、日期和计数是设计样例，路径应由运行时返回；允许路径覆盖、别名合并和实际位置数量变化。接管预览示例采用“复制”同步方式，实际动作由预览返回。
- `全部`中的顶部目标只约束集中操作；行内操作仍使用记录自身的完整目标。全局适用与项目自有记录继续按原有归属规则展示。
- 设置页继续区分同步方式即时保存、目录覆盖统一保存和存储迁移确认，不合并为一个保存按钮。

## 验收边界

37 份 2× PNG 与可编辑稿对应：25 个主页面、8 类弹窗、组件库、状态板及两张总览。主页面尺寸分别为 3172×1984、2560×1600、780×1688；弹窗与总览保留描边或阴影，实际 PNG 可比画板的两倍略大。

设计同步过程与旧修订记录通过 Git 历史追溯。这里的 PNG 是 Pen 静态导出图；样例路径、计数和状态不代表用户机器现状。保留的历史参考节点不在当前预览清单内。

正式 App 已接入共享目录、导入预览、单一 AGENTS.md、原生 Subagents 和设置。可使用 `npm run accept:ui` 与 `npm run accept:app` 验收，分别对应模拟命令和真实隔离目录。运行结果见[2026-09-27 验收报告](../../acceptance/polished-ui-results.md)，不将设计校验当作文件写入验证。
