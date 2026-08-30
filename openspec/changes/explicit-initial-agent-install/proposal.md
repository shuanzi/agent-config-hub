# 显式初始 Agent 安装选择

## 变更摘要

移除应用级的全局 Agent 选择上下文。Skills 与 Subagents 的新安装操作改为在本次操作中显式提供必填的 `initialApp`；Skills 已安装视图同时补齐完整 ownership 分组、重名项目消歧与原生 ZIP 文件选择。四个一等 Agent 的行级启用状态、`ConfigContext`／`ScopeTarget`、按 target 计算的发现状态和备份恢复语义保持不变。

## 动机

全局 Agent 选择同时承担“当前查看对象”和“新安装默认投影”两个含义，容易让用户误以为它决定 scope/project，也使从 `all` 发起安装时的目标来源不够显式。项目已经有完整 ownership target 和四 Agent 行级控制，应把安装初始投影限定在安装动作本身。

## 范围

- 从应用外壳和前端契约中移除全局 Agent 选择及其默认安装语义。
- 仓库发现安装与 ZIP 安装要求显式选择一个 `initialApp`；新记录默认只启用该 Agent。
- Skills 已安装视图在 `all` 中按 global／具体项目分组，在项目上下文中区分 project-owned／global-applicable；项目显示名重名时使用 registry 中的真实 `rootPath` 消歧，但所有 mutation 仍使用记录原 target。
- ZIP 安装使用 Tauri 原生单文件选择器，只接受 `.zip`；picker 只返回路径，安装继续复用既有 command 和 target/Agent 输入。
- 已有本地资产导入继续使用导入面板内的显式 Agent 选择，不读取全局 Agent 默认值。
- 具体上下文继续提供安装的 `ScopeTarget`；`all` 仍须先选择 global 或具体 `projectId`。
- 更新、卸载、toggle 和备份恢复继续从既有记录或备份派生 target；恢复使用备份保存的启用状态，不要求新的 `initialApp`。

## 非目标

- 不改变四个 Agent、SSOT 路径、project registry、`ConfigContext`／`ScopeTarget` 或 target-scoped discovery/backup。
- 不增加数据库字段、迁移框架、通用资产业务抽象或兼容层；`initialApp`/`initial_app` 是安装请求参数，结果仍记录在既有 per-Agent 启用状态中。
- 不引入后台更新、跨 target 恢复／转移、全局搜索、prepare/apply 状态机或新的 Agent 类型。

## 影响

这是前端安装交互、Skills ownership 表达和安装请求参数的窄范围契约调整。现有记录无需迁移；实现同步 Skills/Subagents 的发现安装、ZIP 安装、API/命令参数、Skills 已安装表面和针对性测试，不改变既有数据库或文件存储模型。
