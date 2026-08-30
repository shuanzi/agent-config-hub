# 设计

## 决策

### 1. 安装初始 Agent 是操作输入，不是全局上下文

- `initialApp`（Tauri/Rust wire 名为 `initial_app`）必须是四个既有 Agent 之一：`claude-code`、`codex`、`gemini-cli`、`opencode`。
- 发现安装和 ZIP 安装在确认前必须取得该值；不再从 Header、路由或缓存的全局 Agent 状态推导。
- 新安装成功后只将 `initialApp` 置为启用，其余 Agent 保持关闭；同一 target、同一来源的重复安装也只按本次 `initialApp` 启用。
- local import 已有导入面板内的显式多选 Agent 集合，保持该语义，但不得使用隐藏的全局默认值。

### 2. Scope 与 Agent 正交

- `ConfigContext` 继续只负责读取上下文：`all`、`global` 或 `project(projectId)`。
- mutation 继续使用完整 `ScopeTarget`。具体 global/project 上下文可提供 target；`all` 必须先选择 global 或具体项目。
- `initialApp` 只决定本次新安装的第一个投影，不决定 global/project，也不改变项目 resolver、ownership 或 global applicability。
- 既有行的更新、卸载、toggle 从行记录的 target 派生；备份恢复从备份 metadata 的原 target 和启用状态恢复。

### 3. 外壳与表面

- selected B2 仍是“资产类型 rail → 配置上下文 rail → 主工作区”，不增加 Agent rail 或项目独立页面。
- 删除全局 Agent 控件；Skills/Subagents 行继续展示四个 Agent 的可访问启用状态。
- 安装对话框或安装动作面板提供必填的“初始 Agent”选择；未选择时禁止确认并显示结构化校验提示。
- 发现页仍按 target 显示安装状态；从发现页进入安装时将 `initialApp` 与 target 一起提交。

### 4. 命令与数据边界

- 后续实现应把发现安装、ZIP 安装的请求参数从“当前 Agent”语义改为前端 `initialApp`、Tauri/Rust `initial_app`；不保留旧全局状态兼容层。
- 不新增持久化的 `initialApp` 字段。数据库仍保存既有完整 target 和四 Agent 启用状态。
- 缺少或不支持的 Agent 复用现有结构化无效 Agent 错误路径；操作不得写入 SSOT、数据库或投影。

### 5. Skills ownership 与 ZIP picker

- 已安装 Skills 使用五列语义表格展示名称、真实来源、完整目标、四 Agent 状态和行操作；详情继续替换主工作区，不新增第四栏。
- `all` 先显示 global，再按具体项目分组；项目上下文区分 project-owned 与 global-applicable。项目 `displayName` 重名时仅为展示附加 registry 的真实 `rootPath`，不得复制、去重或 retarget 记录。
- 行内更新、卸载与 Agent toggle 始终使用该行完整 target；顶部 target selector 只服务没有现有记录可派生 target 的操作。
- ZIP picker 使用 Tauri v2 dialog 的单文件 open 权限并限定 `.zip`。取消不发 mutation；选中路径后仍由既有 `install_skills_from_zip` 执行安装，不引入新的文件存储或导入模型。

## 验证策略

1. L1：验证无全局 Agent 依赖、安装确认必须提供 `initialApp`、`all` 必须先选 target，以及四 Agent 行状态保持可见。
2. L2：验证 selected B2 外壳、发现→安装旅程、global/project target 与窄屏焦点往返；不得以 mock 的隐藏默认值替代显式输入。
3. Rust/L3：验证 Skill/Subagent 的真实安装请求只写指定 target，初始启用状态仅包含 `initialApp`；更新、卸载和备份恢复仍保持原 target。
4. 运行 strict OpenSpec validation、相关前端/Rust/L2/L3 测试；原生 picker 的真实桌面打开／取消若未自动化覆盖，必须作为剩余人工验收项明确报告。
