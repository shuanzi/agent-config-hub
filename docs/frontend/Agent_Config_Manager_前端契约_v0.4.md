# Agent Config Manager：前端契约 v0.4

> 状态：**Implemented（已实施）**
>
> 日期：2026-08-26
>
> 上位产品基线：[`Agent_Config_Manager_MVP_产品决策基线_v0.4`](../product/Agent_Config_Manager_MVP_产品决策基线_v0.4.md)
>
> 正式 source of truth：OpenSpec 主规格 [`project-context`](../../openspec/specs/project-context/spec.md)、[`app-shell`](../../openspec/specs/app-shell/spec.md)、[`instruction-management`](../../openspec/specs/instruction-management/spec.md)、[`skill-management`](../../openspec/specs/skill-management/spec.md)、[`subagent-management`](../../openspec/specs/subagent-management/spec.md)

## 1. 视图与导航

一级视图为 Skills（已安装／发现）、长期指令、Subagents（已安装／发现）和设置。默认入口是 Skills → 已安装，当前 Agent 默认 Claude Code。

宽屏的第二栏是配置上下文，不是 Agent rail：

- `all`：全部；
- `global`：全局配置；
- `project(projectId)`：一个真实登记项目。

项目显示名和路径只用于展示；选择、重新关联、移除及所有资产 target 均使用稳定 `projectId`。当前 Agent 位于 Header 紧凑控件，只影响 Skills／Subagents 的既有 Agent 语义。

## 2. 数据与 mutation target

- `ProjectSummary`、`ConfigContext` 与 `ScopeTarget` 由 `src/types.ts` 镜像 Rust serde DTO；
- Skills／Subagents 的列表和发现 query key 包含完整 `ConfigContext`，业务需要时继续包含当前 Agent；
- 长期指令 query key 只包含资产类型与 `ConfigContext`，不包含当前 Agent；
- 已存在资产的更新、卸载、toggle 与备份操作从当前 query 记录派生完整 target；
- “全部”中的新安装、ZIP 导入、未接管导入等操作必须先选择 global 或具体 project，不默认 global；
- mutation 成功后失效该资产类型受影响的全部 context；项目 registry 变更同时失效项目列表。

项目根不可用、target 不完整或 resolver 不支持时，前端显示后端结构化错误，不转换为空成功或全局 fallback。

## 3. 类型专用主表面

### 3.1 Skills

列表使用名称／状态、来源或路径、四 Agent 状态三列紧凑行。详情和列表数据都从当前 query 结果派生；筛选、刷新或 context 变化导致记录消失时清空选择。项目目标操作始终传入行记录的 target。

### 3.2 长期指令

列表固定显示每个可见 target 的 `CLAUDE.md` 与 `AGENTS.md`。详情直接编辑并保存当前 live 文档：`CLAUDE.md` 显示 Claude Code，`AGENTS.md` 显示 Codex 与 OpenCode。界面不显示 Gemini CLI、预设、导入、删除或 Agent enable 控件。

### 3.3 Subagents

宽屏在主工作区内使用 master-detail，窄屏使用列表到详情。记录以完整 key 与 target 保持身份。项目 Codex Subagent 不受支持时，安装与 toggle 控件禁用并具备可访问说明。

## 4. 响应式与可访问性

- `>= 1200px`：资产类型 rail、配置上下文 rail 与主工作区同时显示；设置跳过配置上下文；
- `< 1200px`：类型 → 配置上下文 → 列表 → 详情的单表面栈；
- `390×844`：无横向溢出，Skills 行保留四个具备可访问名称的 Agent logo controls；
- rail 使用稳定选中语义；列表项可用键盘进入详情；返回列表恢复原触发项焦点；
- 错误使用 `role="alert"`，成功提示使用 `role="status"`；FocusedDialog 具备初始聚焦、Tab 限制、Escape 关闭和触发器焦点恢复。

## 5. 明确不引入

前端不引入通用资产业务抽象、全局状态库、假项目数据、旧 Demo stage 状态机、Adapter/provenance、全局搜索、跨 Agent 转换或事务式 prepare/apply 语义。
