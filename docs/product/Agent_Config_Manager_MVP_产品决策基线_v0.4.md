# Agent Config Manager：MVP 产品决策基线 v0.4

> 状态：**Implemented（本 worktree 自动化验证通过；原生 ZIP picker 实机验收与集成待完成）**
>
> 日期：2026-08-26
>
> 正式 source of truth：OpenSpec 主规格 [`project-context`](../../openspec/specs/project-context/spec.md)、[`app-shell`](../../openspec/specs/app-shell/spec.md)、[`instruction-management`](../../openspec/specs/instruction-management/spec.md)、[`skill-management`](../../openspec/specs/skill-management/spec.md)、[`subagent-management`](../../openspec/specs/subagent-management/spec.md)
>
> 当前契约调整：[`explicit-initial-agent-install`](../../openspec/changes/explicit-initial-agent-install/)。该 change 在本 worktree 中实现，尚未归档或集成到主分支。
>
> 历史基线：v0.3 原文保留；本文只取代其中被明确点名的范围与交互决策。

## 1. 产品范围

Agent Config Manager 继续面向本地单用户，管理 Skills、长期指令、Subagents 三类一等资产；Hooks、跨 Agent 转换、动态 Adapter、全局搜索与 `prepare → review → confirm → apply` 不进入本版本。

当前版本在 v0.3 的全局管理能力上增加真实项目 registry 与项目目标。配置上下文固定为：

- **全部**：按完整 ownership target 聚合全局与已登记项目资产；
- **全局配置**：只管理 global target；
- **项目配置**：以 opaque `projectId` 选择已登记项目，管理项目自有资产及明确适用于该项目的全局资产。

项目写入必须经 registry 解析项目根；根不可用或路径未确认时封闭失败，不得回退到全局路径。解除项目登记不删除项目目录或项目文件；仍有受管 Skill、Subagent 或对应备份时拒绝解除登记。

## 2. 三类资产语义

### 2.1 Skills

Skills 保留仓库发现、安装、导入、更新、卸载、备份恢复及四 Agent 即时投影语义。每条记录携带完整 ownership target；仓库发现安装与 ZIP 安装必须在操作内显式选择一个 `initialApp`（前端请求名；Tauri/Rust 请求名为 `initial_app`），新记录默认只启用该 Agent；local import 继续使用导入面板内的显式 Agent 选择。在“全部”中发起没有现有记录可派生 target 的操作，必须先明确选择 global 或具体 project，且新安装同时必须明确 `initialApp`。

### 2.2 长期指令

长期指令不再是 per-Agent 预设库，只管理每个 target 的两种固定 live 文档：

- `CLAUDE.md`：只对 Claude Code 生效；
- `AGENTS.md`：对 Codex 与 OpenCode 生效。

本功能不支持 Gemini CLI，不读取、写入或显示 `GEMINI.md`；不提供预设 CRUD、导入、物理删除或 per-Agent enable。

global `AGENTS.md` 是同一逻辑文档，保存时将同一内容投影到 Codex 与 OpenCode 的有效全局文件；两份既有内容分歧时返回结构化错误且零写入。project `AGENTS.md` 只写项目根的单一文件。

### 2.3 Subagents

Subagents 保留仓库发现、安装、更新、卸载、备份恢复及 per-Agent 即时投影语义。仓库发现安装必须在操作内显式选择一个 `initialApp`；完整 ownership target 与“全部”中的显式 target 规则和 Skills 相同。项目级 Codex Subagent 路径未获支持，因此对应安装和 toggle 入口禁用并说明原因。

## 3. UI 与响应式基线

宽屏采用 selected B2 的 `资产类型 rail → 配置上下文 rail → 主工作区`。第一栏固定为 Skills、长期指令、Subagents，设置位于底部；第二栏固定为“全部／全局配置／真实项目列表”。不提供全局 Agent 选择控件；四个 Agent 的启用状态继续显示在资产行中，安装面板显式收集 `initialApp`，不占用第二栏，也不影响长期指令的两种固定文档。

`1200px` 以下使用“类型 → 配置上下文 → 列表 → 详情”的单表面栈，设置跳过配置上下文。390px 不产生横向溢出，列表与详情往返恢复原触发项焦点。

## 4. 被本文取代的 v0.3 条款

- “项目作用域资产管理（仅全局作用域）”不再属于本期不做；
- “长期指令是每个 Agent 互斥激活一条的预设库”被两种固定 live 文档取代；
- 四个一等 Agent 仍适用于 Skills 与 Subagents，但长期指令明确不支持 Gemini CLI。
