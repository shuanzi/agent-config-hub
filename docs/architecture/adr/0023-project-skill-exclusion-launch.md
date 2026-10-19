# ADR-0023：项目 Skill 排除与 Codex 启动入口

状态：Accepted；2026-10-14 用户选择 Codex 项目启动入口，并明确批准实施方案。扩展 [ADR-0022](0022-skill-scope-matrix.md) 的 Codex／OpenCode 项目排除范围。

## 背景

用户希望全局 Skill 可在指定项目单独停用。撤回全局或共享投放会影响其他项目或 Agent。Codex 0.162.1 的隔离 CLI 验证表明，项目 TOML 的 Skill 开关被忽略，会话参数开关有效；[对应源码](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/skills_config.rs#L158-L167)只接收用户与会话配置层。

[OpenCode 文档](https://opencode.ai/docs/skills/#configure-permissions)提供原生项目 Skill 权限。[1.19.0 配置加载](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/core/src/config.ts)及[权限计算](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/core/src/permission.ts)要求保留文件加载顺序、规则顺序和角色覆盖。旧格式通过迁移解析，新格式使用有序 `permissions`。

## 决定

OpenCode 根据现有文件格式局部编辑精确名称规则，保留 JSONC 注释与其他字段；移除项目排除后重新计算继承，不写入宽泛 allow。角色覆盖、混合格式、无法识别的策略或会抵消新增规则的顺序返回限制。

Codex 将项目排除身份保存到独立的 `.codex/acm-skills.json`。项目入口读取当前受管投放，生成真实文档路径的会话禁用参数，使用现有全局配置目录在 Terminal 启动新 CLI。入口不会改用户 TOML，不创建额外数据库实体，也不把项目开关冒充原生自动加载。

保留直接 Tauri 命令及 Skill 状态锁。新增只读启动计划和带 revision 的启动命令；配置应用与启动都复验相关状态。每个单元的 revision 只覆盖影响它的规则，整文件写入另作字节比较，不新增跨项事务框架。

## 取舍与证据

Codex 项目规则只对该入口启动的新 CLI 会话生效，这是用户明确选择的兼容方式。普通 CLI、桌面、IDE、已运行会话及企业或额外环境策略保持原生边界。文件、模拟界面、实际 CLI 与终端交接参数分别验证，结果见[验收记录](../../acceptance/skill-matrix-results.md)。
