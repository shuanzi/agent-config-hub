# Agent Config Manager：MVP 产品决策基线 v0.3

> 状态：**Draft（初稿）**
>
> 日期：2026-08-22
>
> 正式 source of truth：OpenSpec change [`adopt-ccswitch-asset-management`](../../openspec/changes/adopt-ccswitch-asset-management/)
>
> 历史基线：v0.1、v0.2 原文保留、未被改写；v0.2 已被本基线取代（其绑定的 OpenSpec change 已归档且未实施）

## 1. 文档目的与适用规则

本文把 OpenSpec change `adopt-ccswitch-asset-management` 的产品级决策汇总为 v0.3 基线初稿。对 v0.2 明确废弃的条款（事务式 prepare/apply、24 条转换路径、SkillTargetState、Hook 纳入 MVP）以本文为准；未被本文点名的 v0.1/v0.2 产品决策（本地单用户、类型优先导航、列表可扫读性、敏感遮蔽等）继续保留。

## 2. v0.3 MVP 范围

### 2.1 一句话定义

Agent Config Manager 是面向单用户、本地运行的跨 Coding Agent 配置资产管理器：以 cc-switch 验证过的"仓库发现 → 集中存储（SSOT）→ 按 Agent 开关投影生效"模型管理三类一等资产。

### 2.2 一等资产（三类）

1. **Skill**：从 GitHub 仓库发现与安装；per-Agent 启停；更新检测；备份恢复；导入；存储迁移。
2. **长期指令**：预设库管理；每个 Agent 互斥激活一条；激活内容写入该 Agent 的 live 指令文件。
3. **Subagent**：从 GitHub 仓库发现与安装；per-Agent 启停；更新检测。

**Hook 资产从当前版本规划中整体移除**，后续如需再单独立项。

### 2.3 一等 Agent（四个，沿用）

`claude-code`、`codex`、`gemini-cli`、`opencode`。

### 2.4 核心交互模型

- **发现**：用户添加 GitHub 仓库（粘贴 URL），系统下载归档并扫描资产；列表支持搜索、来源过滤、安装状态过滤。
- **安装**：选中资产安装到 SSOT 目录，默认对"当前 Agent"启用。
- **per-Agent 开关**：每个已安装资产展示四个 Agent 的开关；开 = 投影生效，关 = 移除投影。toggle 即生效，无事务式 prepare/review/confirm 流程。
- **更新**：手动触发检查，按内容 hash 比对；更新前自动备份。
- **卸载**：先清投影、再备份（可恢复）、后删除。

### 2.5 全局设置

- 同步方式：`auto`（默认）/ `symlink` / `copy`；
- 存储位置：hub 目录（默认）/ 统一目录 `~/.agents/`，切换时自动迁移；
- 各 Agent 目录 override。

## 3. 明确不做（本期）

- Hook 资产管理；
- 跨 Agent 格式转换；
- 项目作用域资产管理（仅全局作用域）；
- skills.sh 注册表搜索、deeplink 导入、后台自动更新轮询；
- Provider / 代理 / MCP / 用量管理。

## 4. 废弃的 v0.2 条款

- 事务式 prepare / review / confirm / apply 变更流；
- Skill target presence 与 activation 分离及 SkillTargetState 操作映射（被 per-Agent 开关即投影模型取代）；
- 24 条确定性转换路径；
- Hook 作为 MVP 资产类型。
