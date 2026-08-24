# app-shell Specification

## Purpose

应用外壳：以 feature 视图组织三类资产管理与设置，提供当前 Agent 上下文、统一的数据获取/失效约定与结构化错误呈现。

## Requirements

### Requirement: 视图导航

系统 SHALL 提供一级视图：Skills（含"发现"与"已安装"子视图）、长期指令、Subagents、设置。默认视图为 Skills 的已安装子视图。每个资产视图 SHALL 提供按名称的实时搜索与状态过滤。

#### Scenario: 默认落地

- **WHEN** 用户启动应用
- **THEN** 呈现 Skills 已安装视图

### Requirement: 当前 Agent 上下文

系统 SHALL 提供全局"当前 Agent"选择（四个一等 Agent），安装、启用、激活等操作的默认目标 Agent SHALL 取该上下文；per-Agent 开关组 SHALL 始终展示全部四个 Agent 的状态。

#### Scenario: 切换当前 Agent

- **WHEN** 用户将当前 Agent 从 claude-code 切换为 codex 后执行安装
- **THEN** 安装完成后默认启用的是 codex 的投影

### Requirement: 数据获取与失效

前端 SHALL 通过直接命令调用获取数据，列表数据在视图切换间复用缓存；任何变更操作成功后 SHALL 使受影响的查询缓存失效并自动刷新。后端 SHALL NOT 依赖事件推送驱动前端刷新。

#### Scenario: 变更后自动刷新

- **WHEN** 用户卸载某 skill 成功
- **THEN** 已安装列表与发现列表的对应状态自动更新，无需手动刷新

### Requirement: 结构化错误呈现

前端 SHALL 将后端返回的 `{code, context, suggestion}` 结构化错误映射为用户可读说明与操作建议；无法识别的错误 SHALL 呈现通用失败提示且不得暴露原始异常堆栈。

#### Scenario: 已知错误码

- **WHEN** 安装因 `SKILL_DIRECTORY_CONFLICT` 失败
- **THEN** 用户看到目录冲突的说明与处理建议
