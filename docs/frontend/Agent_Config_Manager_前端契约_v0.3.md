# Agent Config Manager：前端契约 v0.3

> 状态：**Draft（初稿）**
>
> 日期：2026-08-22
>
> 上位产品基线：`docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.3.md`（Draft）
>
> 正式 source of truth：OpenSpec change [`adopt-ccswitch-asset-management`](../../openspec/changes/adopt-ccswitch-asset-management/)
>
> 历史契约：v0.1、v0.2 原文保留、未被改写；v0.2 已被本文取代

## 1. 目的与事实层级

本文在产品基线 v0.3 之下，定义 cc-switch 式架构前端的 UI 行为与数据获取约定。本文不定义 Rust 内部模块划分（属技术方案 v0.3），不重新引入 wire schema。

## 2. 视图结构

一级视图：**Skills**（子视图：发现 / 已安装）、**长期指令**、**Subagents**、**设置**。默认视图为 Skills 已安装子视图。

全局上下文：**当前 Agent**（claude-code / codex / gemini-cli / opencode），安装与激活类操作的默认目标。

## 3. 数据获取约定

- 前端通过 `src/lib/api/<feature>.ts` 直接调用语义化 Tauri command，无统一 gateway 层、无 wireVersion envelope；
- 数据缓存由 React Query 管理：列表查询 `staleTime: Infinity`，变更操作（mutation）成功后失效受影响查询并自动刷新；
- 后端不向前端推送事件；外部变更靠用户手动刷新发现；
- Rust↔TS 类型以 serde `camelCase` + `src/types.ts` 手工镜像维持一致，关键类型标注 Rust 对应位置，漂移由 L3 真实命令测试发现。

## 4. 关键交互语义

- **per-Agent 开关**：开 = 立即投影（symlink/copy 按同步方式设置），关 = 立即移除投影；开关组始终展示全部四个 Agent 状态；
- **安装**：发现视图点安装 → SSOT 入库 → 默认启用当前 Agent；同名不同源冲突以结构化错误阻止；
- **更新**：手动"检查更新"→ 可更新项出现更新按钮 → 更新前自动备份；
- **卸载**：二次确认后执行；备份可从列表恢复或删除；
- **错误呈现**：后端 `{code, context, suggestion}` 映射为用户可读说明与操作建议；未知错误呈现通用提示，不暴露原始异常。

## 5. 废弃的 v0.2 条款

workbench/globalLocator 通用列表契约、段序与全局分页规则、SkillTargetState、prepare/apply 事务交互、24 条转换路径的 UI 呈现，均随架构 pivot 废弃。列表可扫读性原则保留，由 feature 面板各自实现。
