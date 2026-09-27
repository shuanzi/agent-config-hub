# Agent Config Manager UI 现状与目标清单

> 仓库位置：`docs/design/agent-config-manager-ui/`。本目录内的 Pen 源文件、最终预览、关键页面预览、采集证据和生成迭代均作为项目设计资产管理。

## 当前精细稿同步（2026-09-27）

当前交付以 [精细稿说明](./polished/README.md)、[功能同步记录](./polished/sync-2026-09-24.md) 和 [Skills 布局修订](./polished/skills-layout-2026-09-27.md) 为准。下文保留 2026-08-30 的采集与 reconstruction 验收，不能替代当前功能模型。

- Skills 第四列为“投放位置”，恢复 cc-switch 式横向图标与 64px 紧凑行。实际目录与处理入口进入详情；行内区分已投放／未投放／已存在·未接管／投放冲突。全局增加 `~/.agents/skills`，按物理路径合并别名。开关不代表 Agent 使用权限。
- Skill 与 ZIP 安装显式选择一个初始投放位置；导入已有先核对来源、受管位置与逐路径动作，再确认接管。
- 长期指令每个完整目标只管理一个逻辑 `AGENTS.md`；展示实际保存位置。全局默认写入 Codex、OpenCode 两处，项目写入根目录。移除当前精细稿中的 `CLAUDE.md` 入口及“对哪些 Agent 生效”承诺。
- Subagent 每个原生定义归属一个 Agent；项目 Codex 可安装。兼容性、纳入管理、源码、停用／启用、更新差异与备份恢复按原生模型表达。
- 本轮修改 `Polished` 区域、37 份 PNG 和交付文档；4 个历史根节点保持不变。没有集成 `b25a` 功能代码或实现新版前端。

## 历史采集基线（2026-08-30）

- 日期：2026-08-30
- Worktree：`/Users/xiquandai/Documents/code/.worktree/agent-config-hub-skill-output-management`
- Branch：`codex/skill-output-management`
- HEAD：`2382644ff2091054397132f373a8f84293044bf0`
- 当前实现：保留未提交产品 diff；本次没有修改产品源码、OpenSpec、API 或数据库。
- 浏览器证据：`http://127.0.0.1:1420/tests/l2/workbench.html?fixture=visual`，使用现有 DTO 字段和视觉 fixture。
- 桌面证据：当前 worktree 现场编译并运行 `src-tauri/target/debug/agent-config-manager`；截图时进程 cwd 为该 worktree 的 `src-tauri`，不是同名 DMG。

## 现状页面索引

### 桌面 1586×992

- `01`：Skills／全部／已安装，完整 ownership 分组与五列表格。
- `02`：Skill 详情，包含来源、目标、README 与四 Agent 状态。
- `03`：Skills／发现／未选择目标。
- `04`：Skills／发现／全局目标。
- `05`：Skill 安装对话框，初始 Agent 为空且确认禁用。
- `06`：Skills／已安装／已选择全局操作目标。
- `07`：导入已有无候选时的状态反馈；fixture 不伪造导入记录。
- `08`：备份恢复对话框，明确全局 target scope 和空备份状态。
- `09–10`：长期指令列表与 CLAUDE.md／AGENTS.md 详情。
- `11–12`：Subagents 已安装 master-detail 与项目记录详情。
- `13–14`：Subagents 发现页的未选目标与项目目标。
- `15`：项目 Subagent 安装对话框，Codex radio 禁用并说明原因。
- `16`：设置页面；不显示配置上下文栏。

### 1280×800

- `17`：Skills／全部／已安装。页面无横向溢出，但操作条形成不均衡的多列堆叠，搜索框、按钮、target selector 和长提示争抢同一行高。
- `18`：长期指令 master-detail。
- `19`：Subagents master-detail。

### 390×844

- `20–21`：资产类型 → 配置上下文单表面栈。
- `22`：Skills 已安装；五列表格重排为卡片，但来源、完整 target、四 Agent 和操作仍在行内。
- `23`：Skill 详情。
- `24`：Skill 安装对话框。
- `25`：设置页面。
- 实测 `innerWidth = documentElement.scrollWidth = body.scrollWidth = 390`。

### 真实 Tauri App

- `26`：1440×900 当前 App 窗口，真实数据为 73 个 target 记录；Header 已移除“当前 Agent”。
- 本轮没有对真实 Skill、Subagent、项目或设置执行 mutation。
- 系统在准备点击原生 ZIP picker 时进入锁屏，故本轮没有新增 picker 打开截图；当前 Rust dialog 插件已在现场编译，目标稿只表达已实现的“单 ZIP 文件选择”入口，不把历史截图当本轮证据。

## selected B2 参考

- `selected-b2/01`：Skills 高密度列表的主视觉、三栏壳层和分段结构。
- `selected-b2/02`：Skill 结构化详情。
- `selected-b2/03`：长期指令 master-detail。
- `selected-b2/04`：Subagents master-detail。
- 这些截图只提供视觉语言和层级，不恢复旧 Demo 的全局搜索、假项目、跨 Agent 转换或 prepare/apply 流程。

## 历史目标稿语义（2026-08-30，部分已被下述同步修订替代）

- Header 不出现“当前 Agent”或替代全局 Agent 控件。
- 仅出现 Claude Code、Codex、Gemini CLI、OpenCode。
- selected B2 的“资产类型 → 配置上下文 → 主工作区”三栏壳层保持不变。
- Skills 桌面使用 Skill／来源／目标／Agent／操作五列；`all` 先全局、再按具体项目分组。
- 项目上下文区分 project-owned 与 global-applicable；同名项目显示真实路径消歧。
- 行内 update、uninstall、Agent toggle 使用行本身的完整 target。
- `all` 的顶部 target-scoped 操作必须先选择 global 或具体项目；未选择时入口级禁用并显示内联说明。
- Skill、Subagent、ZIP 安装在操作内显式选择初始 Agent；不默认 Claude Code。
- 项目 Subagent 不支持 Codex 时，Codex 选项禁用并显示真实原因。
- 发现页安装状态明确为“按当前目标”。备份恢复明确 target-scoped。
- 长期指令只管理 CLAUDE.md 与 AGENTS.md；设置页面跳过配置上下文栏。
- 不虚构版本、URL、branch、跨目标恢复、批量选择或跨 target retarget。

## 目标视觉修正

- 1280 下把搜索、集中动作、操作目标和状态说明分成稳定层级，避免当前操作条的多列挤压与长提示横向占位。
- 桌面列表提高信息密度但保持表头、完整 target 和四 Agent 一眼可见；操作列固定且不挤压来源。
- 分组标题用项目 displayName、可选 rootPath 和数量形成清晰层级。
- 对话框中的 target 与初始 Agent 是确认前的主要信息，不被说明文字淹没。
- 390 下延续现有无横向溢出表现，并保持来源、target、四 Agent 与行操作可直接触达。

## 设计稿结构

1. `Current / As-is`：当前真实页面和明确可见的问题。
2. `Target / Desktop`：融合 selected B2 与当前真实功能契约的目标页面。
3. `Target / Responsive`：1280 和 390 关键断点。
4. `Components & States`：表格行、scope group、Agent 控件、操作条、安装／ZIP／导入／备份对话框、空态和错误态。

## 历史 reconstruction 设计产物验收

- 最终稿：`agent-config-manager-ui-reconstruction.pen`，pen.dev v2.17 结构化设计文件，约 423 KB。
- 总览：`agent-config-manager-ui-reconstruction@2x.png`，8192×4320。
- 四个顶层区域及内容：
  - `Components & States`：复用壳层、四 Agent 图标、Skill Row、Modal、项目 Subagent 安装、ZIP 安装、导入已有。
  - `Current / As-is`：01–07 与 11，共 8 个当前页面／状态。
  - `Target / Desktop`：08 Target Skills Installed，不含占位说明。
  - `Target / Responsive`：09（1280）与 10（390）。
- `.pen` 文本核对确认存在：`项目配置不支持 Codex Subagent。`、`ZIP Install Dialog`、`Import Existing Dialog`、`08 Target Skills Installed`。
- `previews/` 提供目标桌面、1280、390 和组件状态的独立查看图；`iterations/` 保留首版和中间版作为回退证据。
- 最终目标桌面与 390 预览已人工查看：Header 无全局 Agent、四 Agent 可见、ownership target 可辨识、1280 操作区分层、390 无设计层面的横向溢出。
- 唯一未新增的实机截图是 macOS 原生 ZIP picker 打开态：系统在该步骤前锁屏；本轮没有用旧 DMG 或历史截图替代。设计稿中的 ZIP 状态依据当前已编译的 `tauri-plugin-dialog` 与现有单 ZIP 交互契约。
