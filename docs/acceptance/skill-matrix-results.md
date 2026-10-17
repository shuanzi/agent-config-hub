# Skills 使用矩阵验收记录

初始矩阵接入验收，日期：2026-10-14。工作分支 `codex/skill-availability-matrix`，基于 `f85eae0`。覆盖当前工作区矩阵实现；后续提交仍需针对其变更重新核对。设计方向和可编辑原型见[设计入口](../design/skill-matrix/README.md)，行为以[产品说明](../product/README.md#使用矩阵与批量分配)为准。

## 界面与隔离文件

默认进入使用矩阵；已安装来源与项目归属、Agent 勾选、筛选、多选、跨项目批量分配、预览和限制原因已接入正式 App。目录维护保留接管、更新、卸载、备份和完整路径操作。项目草稿保存在 App 层，窄屏返回配置上下文后不会丢失；切换 Agent／搜索清空行选择，保留草稿。

[桌面矩阵](evidence/2026-10-14-skill-matrix/initial-desktop-matrix.jpg)、[变更预览](evidence/2026-10-14-skill-matrix/initial-desktop-preview.jpg)、[390px 单 Agent 矩阵](evidence/2026-10-14-skill-matrix/initial-mobile-matrix.jpg)、[限制说明](evidence/2026-10-14-skill-matrix/initial-mobile-limitation.jpg)来自正式组件与模拟命令，仅证明界面。390px 下实测文档宽 390px、单 Agent 表格宽 356px；四 Agent 可在表格内部滚动。完整路径和触发项返回焦点继续由目录维护和详情承担。

真实 Tauri test-harness 在隔离 `ACM_HOME` 下导入 `matrix-acceptance`，登记两个项目；项目一直接取消 Claude Code 勾选、预览后应用。磁盘读回确认：项目一 `.claude/settings.local.json` 写入 `skillOverrides["matrix-acceptance"] = "off"`；全局 `SKILL.md` 字节不变；项目二没有新增停用文件。真实命令返回两个项目的配置状态 `[false, true]`。额外通过真实命令验证全局停用、项目一启用时三个配置状态为 `[false, true, false]`，随后恢复最初的两个项目状态。关闭后以同一隔离目录启动新进程，重新读取项目 registry 和矩阵仍得到 `[false, true]`。验收框架核对八个真实用户配置文件的前后摘要，没有检测到变更。

已有 Skills 真实接管旅程也通过：预览后外部修改被拒绝；重新读取位置并明确重选来源和位置后才再次接管。已有 AGENTS.md、原生 Subagents 保存及重启读回保持通过。桌面脚本先前依赖的默认维护入口、异步预览就绪和跨用例上下文已改成显式步骤，保留原文件冲突断言。

## 自动校验

| 校验 | 结果与覆盖 |
| --- | --- |
| `verify:toolchain` | 10 项通过；Node 24.18.0、npm 11.16.0、Rust 1.97.1 和锁文件一致 |
| `test:frontend` | 24 文件、227 项通过；含 6 项矩阵交互和原有 26 项 Skills 面板测试 |
| `test:rust` | 默认及 test-harness 各 250 项通过、1 项既有忽略；含 8 项矩阵隔离、版本、策略保留、共享关系与冲突测试 |
| 聚焦 L2 旅程 | 2 个矩阵旅程及 3 个 Skills 维护旅程通过；包含项目隔离、限制原因、窄屏草稿与宽度检查 |
| `test:tauri` | 5 项写入旅程、2 项新进程回读通过；在线仓库验收未运行 |
| `verify:static` | 8 项通过：TS、ESLint、Prettier、Rust fmt、两套 Clippy 与既有守卫 |
| `verify:docs` / `git diff --check` | 文档结构、链接及空白检查通过 |

聚焦 L2 通过不代表整个旧视觉回归集已经更新；旧「紧凑列表」用例需要明确进入目录维护。本轮没有在线安装／更新、真实 Agent 会话加载、性能预算、正式签名／发布证据。

## 初始轮能力限制（后续接入见下文）

当前原生项目排除接入 Claude Code 和 Gemini CLI。协议依据：[Claude Code skillOverrides](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings)、[Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)、[Gemini 配置中的 skills.disabled](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md)。Gemini 的上级停用不能由项目解除，精细可见性和原生插件保持限制；JSON 字段保留不代表任意原生策略合并已被模拟。

Codex／OpenCode 的局部排除未接入，继承或其他扫描路径造成的使用状态保持勾选并显示原因。全局 Codex 专用目录沿用现有投放契约；文件配置状态不能推断特定 CLI 版本会加载该路径。矩阵不管理企业策略、CLI 额外来源、OpenCode 每 Agent 权限、子目录会话或 Agent 运行结果。没有检测到本轮校验覆盖范围中的未解决回归；上述能力与证据限制仍保留。

## Codex／OpenCode 项目排除增量

2026-10-14 后续增量，用户明确批准 ADR-0023 方案。当前实现接入 OpenCode 项目有序权限，以及 Codex 项目身份排除文件和显式 CLI 启动入口；上文初始轮的「未接入」描述保留为当时证据，不是当前能力限制。

真实 Tauri 旅程在同一隔离数据根导入全局 `matrix-acceptance`，保留 Claude 与 Codex 投放。项目一应用 Codex／OpenCode 排除，磁盘读回 `.codex/acm-skills.json` 的身份列表及 `opencode.json` 的精确名称 deny。项目二没有新增这两份文件，全局两处 `SKILL.md` 字节保持不变。恢复后再排除，关闭并启动新的 harness 进程；Claude Code／Codex／OpenCode 三列在项目一均为 false，项目二均为 true。八个真实用户配置文件的前后摘要保护保持通过。

测试取真实命令生成的启动计划，用本机 Codex CLI 0.162.1 在隔离 `CODEX_HOME` 下运行 `app-server`，仅请求 `skills/list`，没有推理请求或登录操作。项目一携带生成参数时测试 Skill 的 `enabled` 为 false；项目二为 true；移除项目排除后项目一为 true。旧启动 revision 在恢复后被真实启动命令拒绝，不生成终端交接。Rust 另外执行脚本引用测试并断言 `/usr/bin/open -a Terminal` 的实际参数；这些证据不表示已完成真实 Terminal 交互会话验收。

OpenCode 本机未安装 CLI。本轮证明原生 JSON／JSONC 读写、配置优先级、规则顺序、角色覆盖限制及新进程持久化；有序权限与通配匹配按照官方 1.19.0 源码核对，不报告真实 OpenCode 会话加载。Codex 普通 CLI、桌面、IDE 与已有会话保持原生配置。

正式 App 的桌面和 390px 预览见[设计入口](../design/skill-matrix/README.md#项目排除与启动增量)。浏览器已核对两个 Agent 排除与恢复、启动计划的排除项数量、草稿阻止启动和角色限制。390px 单 Agent 实测文档宽 390px、表格宽 356px。可编辑原型包已解压、重新安装依赖并通过测试与构建；没有发布或部署。

| 增量校验 | 覆盖与结果 |
| --- | --- |
| Rust 默认／test-harness | 各 260 项通过、1 项既有忽略；包含原生策略、批量文件、复制路径、格式／角色／链接／外部修改及脚本参数 |
| 前端 | 24 文件、230 项通过；覆盖启动 revision、缺失 CLI、启动错误及本项目／其他项目草稿 |
| 聚焦 L2 | 2 项矩阵与 3 项既有 Skills 旅程通过 |
| 真实 Tauri | 5 项写入、2 项新进程回读通过；含真实 Codex 元数据验证 |
| 文档检查器 | 16 项正反例通过，含矩阵编码、尺寸及清单遗漏 |
| 原型包复现 | 9 项模型测试与构建通过，脚本与资源完整 |

最终 `verify:static` 8 项通过；`verify:docs` 44 份 Markdown、0 项错误；`git diff --check` 通过。新增与旧日志分开保存在 `.artifacts/skill-exclusion-*`；后续修改仍需重新验证。在线仓库安装／更新、真实 OpenCode 会话、性能预算和签名／发布不在本轮证据中。
