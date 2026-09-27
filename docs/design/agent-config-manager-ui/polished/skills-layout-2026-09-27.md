# 2026-09-27 Skills 列表布局修订

上次同步共享目录时，把每个 Skill 的五个投放位置展开成五条目录行，破坏了此前参考 cc-switch 的紧凑列表。此次按用户反馈恢复列表布局，保留新增功能语义。

## 参考与取舍

- cc-switch 参考版本：`1ee2fdc3a791f1e73476c631c7ab7ce8fac0638f`。
- [UnifiedSkillsPanel.tsx](https://github.com/farion1231/cc-switch/blob/1ee2fdc3a791f1e73476c631c7ab7ce8fac0638f/src/components/skills/UnifiedSkillsPanel.tsx)：已安装 Skill 使用紧凑列表，名称、描述、来源与图标控件同行。
- [ListItemRow.tsx](https://github.com/farion1231/cc-switch/blob/1ee2fdc3a791f1e73476c631c7ab7ce8fac0638f/src/components/common/ListItemRow.tsx)：横向行、细分隔线和悬停反馈。
- [AppToggleGroup.tsx](https://github.com/farion1231/cc-switch/blob/1ee2fdc3a791f1e73476c631c7ab7ce8fac0638f/src/components/common/AppToggleGroup.tsx)：横向品牌图标与 Tooltip，按钮用 `aria-label` / `aria-pressed` 表达身份及状态。
- 本项目仍使用既有 selected B2 壳层、目标分组与五列结构。共享目录是文件夹入口，不新增第五个 Agent。保留常显详情入口；窄屏点击区域 44px，路径信息不依赖悬停。

## 改动范围

| 画板 | 修订 |
| --- | --- |
| `jDYK3` / `v5WGtu` | 1586 / 1280 桌面已安装列表：固定 64px 行，4 条全局记录加 1 条项目记录，横向投放图标，名称下保留异常摘要。 |
| `CMdbh` | 390 窄屏：紧凑记录，横向 44px 图标，首屏完整显示 3 条，其余记录滚动查看。 |
| `K09eD` | 可复用紧凑行、四类图标状态及悬停／聚焦提示样例。 |
| `J0BERI` | 更新列表缩略图与修订日期。 |

详情、安装、ZIP、接管预览、目录别名合并、主副本保护与冲突状态继续沿用 9 月 24 日的功能模型。顶部操作目标只约束集中操作；行内操作仍绑定该记录的完整目标。项目范围只有实际 Agent 目录，不添加共享入口。

## 验证

- 保存后使用独立 Pen 进程重新打开，37 个交付根节点的有效可见节点无裁切／布局告警，无 `placeholder:true` 残留。
- 桌面两个尺寸各 5 条记录，解析后的行高均为 64px；390 窄屏的 3 条记录均为 140px，图标点击区域为 44px。
- 5 份更新的正式 PNG 与重开文件后再次导出的 PNG 逐字节一致；桌面 Pen 编辑器也已关闭临时副本并重新打开最终保存文件，读取到修订后的列表。
- 与本轮开始时逐根节点比较，仅上表 5 个根节点改变。其余 36 个根节点（含 4 个历史根节点）完整结构相同；其他 32 份预览图片未变。
- 产品源码哈希前后相同；Markdown 本地链接和 `git diff --check` 通过。

静态稿只能验证布局和交接表达，不能证明图标切换、键盘交互、接管或文件写入已经在产品中实现。

本轮未修改产品源码、公共契约、依赖或功能分支。
