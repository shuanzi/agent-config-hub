# Agent Config Manager 全产品 UI 精细稿

本轮以 `ab7294147388b126aebe339dd368b4a0b019f1d5` 的设计资产和产品语义为基线，保留 selected B2 三栏布局与浅色蓝色系，精修对齐、间距、字阶、图标与断点适配。交付为可编辑设计和视觉预览；产品源码、公共 API 与数据类型不在本轮变更范围内。

- [可编辑 Pen 源文件](../agent-config-manager-ui-polished.pen)
- [全产品总览](./previews/product-overview.png)
- [画板与预览对应表](./preview-manifest.tsv)
- [原始现状与目标稿](../agent-config-manager-ui-reconstruction.pen)
- [基线页面及产品语义](../ui-inventory.md)

## 展示方式与交付边界

可编辑稿在 Pen 中打开；下列 PNG 可在浏览器、图片预览或 Codex 文件面板中查看。PNG 是画板的静态渲染，不是可操作的 WebUI；本轮不生成或修改前端实现，也不把既有交互 mock 当作新版设计的运行结果。

原稿及新稿内的 `Current / As-is` 区域保留为历史对照。精修页面使用独立的 `Polished` 组件及样式变量，不覆盖历史组件。

## 桌面页面

每个链接对应一个独立画板的 2× PNG。1586×992 画板导出为 3172×1984；1280×800 画板导出为 2560×1600。

对应表记录画板的逻辑尺寸。弹窗、组件和总览同样按 2× 导出，但保留画板外阴影，PNG 边界可大于逻辑尺寸的两倍；主页面没有此类外扩。

| 页面 | 1586×992 | 1280×800 |
| --- | --- | --- |
| Skills 已安装 | [查看](./previews/desktop-1586-skills-installed.png) | [查看](./previews/desktop-1280-skills-installed.png) |
| Skill 详情 | [查看](./previews/desktop-1586-skill-detail.png) | [查看](./previews/desktop-1280-skill-detail.png) |
| Skills 发现 | [查看](./previews/desktop-1586-skills-discovery.png) | [查看](./previews/desktop-1280-skills-discovery.png) |
| 长期指令 | [查看](./previews/desktop-1586-instructions.png) | [查看](./previews/desktop-1280-instructions.png) |
| Subagents 已安装 | [查看](./previews/desktop-1586-subagents-installed.png) | [查看](./previews/desktop-1280-subagents-installed.png) |
| Subagents 发现 | [查看](./previews/desktop-1586-subagents-discovery.png) | [查看](./previews/desktop-1280-subagents-discovery.png) |
| 设置 | [查看](./previews/desktop-1586-settings.png) | [查看](./previews/desktop-1280-settings.png) |

## 窄屏页面

390×844 表达应用的窄窗口单表面布局；导出为 780×1688。类型、上下文、列表与详情分别呈现，延续现有返回路径。

| 页面 | 390×844 |
| --- | --- |
| 资产类型 | [查看](./previews/mobile-390-asset-types.png) |
| 配置上下文 | [查看](./previews/mobile-390-contexts.png) |
| Skills 已安装 | [查看](./previews/mobile-390-skills-installed.png) |
| Skill 详情 | [查看](./previews/mobile-390-skill-detail.png) |
| Skill 安装弹窗 | [查看](./previews/mobile-390-install-dialog.png) |
| 设置 | [查看](./previews/mobile-390-settings.png) |

## 弹窗与状态覆盖

[弹窗与状态总览](./previews/dialogs-states-overview.png) · [可复用组件库](./previews/components-overview.png)

| 场景 | 关键状态与语义 | 预览 |
| --- | --- | --- |
| Skill 安装 | 目标未选／已选；初始 Agent 未选／已选；禁用原因与提交操作 | [查看](./previews/dialog-skill-install.png) |
| 项目 Subagent 安装 | 四 Agent 等宽 2×2；仅 Codex 禁用，并显示“项目配置不支持 Codex Subagent。” | [查看](./previews/dialog-project-subagent-install.png) |
| ZIP 安装 | 应用内“选择 ZIP 文件”入口、未选／已选单文件、目标与初始 Agent；不绘制系统文件选择器 | [查看](./previews/dialog-zip-install.png) |
| 导入已有 | 为候选项多选导入到的 Agent；同名 Skill 只允许一个来源；无候选时在主页面提示 | [查看](./previews/dialog-import-existing.png) |
| 备份恢复 | 当前目标内逐项 Skill 备份的名称、路径、日期、恢复与删除，以及“暂无备份。”空态；不是跨资产整批恢复 | [查看](./previews/dialog-backup-restore.png) |
| 通用空态与错误 | 未选目标、空列表、目录不可用、提交失败后保留可重试输入 | [查看](./previews/component-states.png) |

## 排版规范

| 项目 | 精细稿规格 |
| --- | --- |
| 页面标题 | 22px / 30px 行高 |
| 弹窗标题 | 18px / 26px 行高 |
| 产品名 | 16px / 24px 行高 |
| 正文与控件 | 14px / 20px 行高 |
| 辅助信息 | 12px / 18px 行高 |
| 字重 | 常规与中等加粗；同一层级统一 |
| 常用间距 | 4px 基础，8 / 12 / 16 / 24px 为主 |
| Header 高度 | 桌面 66px；390 下 58px |
| 左侧两栏宽度 | 1586 下 180 / 220px；1280 下 160 / 190px；设置页省略上下文栏 |
| 控件高度 | 桌面 36px；窄屏可点击区域至少 44px |
| 表格行高 | 常规 64px；需要换行的内容允许增高 |
| 五列表格 | 名称列使用剩余宽度；来源 220 / 180px、目标 180 / 150px、Agent 160px、操作 110px；表头与数据行共轨 |
| 弹窗 | 桌面默认宽 620px、内边距 24px；初始 Agent 采用等宽 2×2 布局；窄屏适配可用宽度 |
| 图标 | 通用图标为 Lucide；Agent 品牌图形使用仓库已有 SVG |

在 Pen 中，行高使用相对字号的比例；以上表格列出便于设计交接的实际像素值。文字换行、中文与英文基线以渲染结果复核。

## 组件、状态与验收

### 功能表达

- `全部`页的操作目标只约束顶部集中操作；行内更新、卸载与 Agent 状态使用该行自己的目标，不把操作目标表达成列表过滤器。
- 发现页安装状态相对于当前发现目标；未选目标时先提示选择。项目记录显示具体项目和路径，Skills 项目上下文区分项目自有与全局适用。
- 每次从发现页或 ZIP 新安装，都必须显式选择一个初始 Agent；项目 Subagent 仅禁用 Codex，并保留原因说明。ZIP 安装使用单个 ZIP 文件选择，并固定提供四个一等 Agent 作为初始 Agent 选项。
- `导入已有`的候选记录使用 Agent 多选；无候选时在主页面提示，不伪造空弹窗。备份恢复仅列出当前目标的 Skill 备份，逐项恢复或删除；空态显示“暂无备份。”。
- 每个配置目标管理 `CLAUDE.md` 与 `AGENTS.md`；后者由 Codex 与 OpenCode 共用。`全部`上下文按目标分组展示文档，详情直接编辑所选文档，并明确保存对应的文件名。
- 设置中的同步方式即时保存，四个 Agent 的目录覆盖由一个“保存覆盖路径”按钮统一提交，SSOT 位置切换按现有条件确认迁移；不把三类行为合并成一个“保存设置”按钮。
- 安装、ZIP、导入和备份恢复提交失败时，弹窗保留当前 target、Agent、文件或候选项，便于重试。

### 实际验收记录

- 交付共 29 份 PNG：20 张主页面、5 类弹窗、组件状态板、组件库、全产品总览和弹窗状态总览；对应表中的画板 ID 无重复。
- 20 张主页面均按逻辑尺寸精确导出 2×；全部 PNG 可完整解码，本地预览链接与对应表一一匹配。
- 已保存的 `.pen` 经新 Pen 进程重开验证：29 个交付根节点无布局告警，无 `placeholder:true` 残留。
- 字阶仅使用 12 / 14 / 16 / 18 / 22px；390 页面抽查的 17 个交互父容器均至少 44px。
- Agent Logo 专项修复：四个目标组件的 18×18px 图形从绝对定位改为随父容器自动居中。116 个实例覆盖 20 / 22 / 24 / 28 / 30 / 32px 容器，图形框与容器的水平、垂直中心偏差均为 0；居中检查独立于裁切和布局告警检查。
- 主页面逐张视觉检查，重点区域局部复看；1280 的项目行、详情末项和禁用说明溢出已修正。390 列表按当前可见两条记录显示完整目标与四 Agent 状态，并明确其余记录可滚动查看。
- 独立只读复核覆盖 1586 页面、五类弹窗和状态板；安装单选、项目 Codex 限制、导入多选、备份范围、长期指令分组和设置保存／迁移语义已核对。
- `Current / As-is` 前后导出均为 4901×3201，直接字节比较完全一致；原始 reconstruction `.pen` 无 Git 差异。
- 两张总览使用正式页面 PNG 的真实缩略图；中间导出和 QA 临时文件已移出交付目录。

以上为静态设计与交付文件验收，不是前端功能测试。此次没有修改产品源码、公共 API、数据类型或依赖。
