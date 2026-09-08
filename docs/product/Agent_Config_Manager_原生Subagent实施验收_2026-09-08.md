# Logo、目录选择与原生 Subagent 实施验收

日期：2026-09-08。工作分支：`codex/native-subagent-management`；基线：`ececa867a2de6d98dfe86b84e0b0fb5d35bb53d3`（核验后的 `main`）。

## 交付范围

- 品牌素材固化到本地，修复浅色界面 Codex 不可见；共用组件覆盖 Skills、长期指令、Subagents 和安装选项。来源提交及 MIT 说明见 [CC_SWITCH_NOTICE](../../src/assets/agent-logos/CC_SWITCH_NOTICE.md)。
- 添加与重新关联项目支持原生单目录选择，保留路径手输；空名称自动取目录名，已有名称不覆盖，取消保留原表单，异常在弹窗显示。
- 原生 Subagent 按所属 Agent、目标及来源位置独立识别、接管和管理；不跨 Agent 转换。机制与兼容策略见 [ADR-0021](../architecture/adr/0021-native-subagent-management.md)。
- 未修改 Pen、Skills/长期指令数据模型、依赖或公共网络 API；实现阶段未提交 MR。后续按用户要求提交 PR，不执行合并、发布或部署。

## 已完成验证

| 层级 | 命令或方式 | 结果 |
| --- | --- | --- |
| 工具链 | `npm run verify:toolchain` | 10/10 通过 |
| 前端单测 | `npm run test:frontend` | 23 文件 / 210 条通过 |
| 前端构建 | `npm run build:frontend` | TypeScript 与 Vite 构建通过 |
| Rust 全量 | `cargo test --locked` | 215 通过 / 0 失败；1 条真实主机只读测试默认隔离，已单独执行通过 |
| Rust 静态 | `cargo clippy --locked --all-targets -- -D warnings`；`cargo fmt --all -- --check` | 全部通过 |
| 浏览器全量 | `UI_TEST_PORT=1438 npm run test:ui` | 6 文件 / 49 条通过 |
| 视觉 | 实际 viewport 1586×992、1280×800、390×844 | 共用品牌、原生列表/详情/安装、Skills、长期指令、添加项目；无非预期横向溢出 |
| 原生预检 | 独立 `com.agentconfigmanager.nativeqa` App，`ACM_HOME=/tmp/acm-native-qa.5g584Y` | 系统文件夹选择、取消、中文空格目录、名称回填/保留、重新关联入口、样例扫描/接管/编辑保存及磁盘读回通过 |
| 真实机器只读 | in-memory DB 调用原生扫描，不接管、不写文件、不输出提示词正文 | Codex 4 个 TOML 与 OpenCode 4 个 Markdown 均被识别 |

以上 npm 命令使用项目固定 Node 24.18.0 / npm 11.16.0。浏览器测试使用隔离 mock invoke，只验证前端流程；不替代 Rust 文件系统测试或原生 App 验收。原生写入预检只使用临时样例；真实用户配置没有用于写入测试。

## Rust 与最终候选

独立只读复核已确认条目级恢复、停用编辑、项目归属、更新原子性及符号链接祖先保护修复，无未解决发现。Rust 全量 215 条通过；5 条旧投影测试已改写为新契约主动断言并通过，没有通过跳过它们取得绿灯。唯一默认忽略项是访问真实机器的只读扫描，已单独运行通过。

最终 QA 候选已通过 `tauri build --debug --bundles app --ci --no-sign -- --locked`（命令行仅覆盖独立 QA 产品名、bundle identifier、1280×800 窗口与 bundling 开关，不改仓库打包配置）。使用相同隔离 `ACM_HOME` 重启后验证：schema 升至 4，1 条受管记录、2 份原备份和已编辑 TOML 完整保留；从 App 停用再启用后，文件从扫描目录移出并回到原路径，数据库状态依次为 0 / 1，备份数由 2 增至 4。验收后已关闭专用 QA 进程。

该候选为本机未签名 debug 验收包，不是 Developer ID 签名、notarized 或发布包。真实 Agent 配置始终没有用于写入验证。

随后按用户要求将旧下载测试包、dist 和 Rust target 移入废纸篓保留恢复入口，执行干净的 arm64 Release 构建（命令行覆盖产品名 `Agent Config Manager Test 0908`、identifier `com.agentconfigmanager.test0908`，不改仓库配置）。新交付 App 的原生启动、隔离 Codex TOML/OpenCode Markdown 各 1 条扫描、Logo 可见性、系统目录选择器打开/取消及 SQLite schema 4 完整性检查通过；ZIP 完整性和 SHA-256 校验通过。

构建前后 95 个构建输入文件指纹一致：`ced9acad81cdaf01d61d5504f79e124ba0396b0a29b548b7898954f2c6f93d90`。新包仍未签名、公证；App 和 ZIP 仅交付本地测试，不纳入 Git 或作为正式发布。正常启动使用现有业务配置，不因独立 bundle identifier 自动隔离；不应同时运行旧版或用旧版打开升级后的数据库。

验证边界：未对真实远端仓库执行端到端的下载后安装写入测试；网络失败、前端发现/安装流程和本地格式/文件生命周期由隔离测试覆盖，不能将其宣称为已验证所有在线仓库内容。

## 兼容与保守边界

- 旧记录、旧文件和旧备份保留待核对，不自动转换或重新投放旧 Codex Markdown。旧版跨 Agent 写入入口封闭，避免与原生管理争夺文件所有权。
- 项目存在原生记录或备份时，不能直接改绑/移除。用户可按条目卸载、逐条二次确认清理原生备份后解除保护；不会自动清理旧版备份。
- 配置范围内部祖先目录为符号链接时只读展示，写入拒绝；文件本身为链接时需明确确认独立副本接管，外部目标不被写入。
- OpenCode 配置条目恢复仅作用于原键。所有可覆盖操作依赖内容摘要；更新同时绑定本地与预览远端摘要。
- UI 统计表示文件配置，不证明运行中的 coding agent 已加载；Gemini 功能开关仅诊断，不自动开启。

## 视觉产物

预览位于 [`output/playwright/`](../../output/playwright/)：`native-subagents-*`、`native-subagent-detail-*`、`native-subagent-install-*`、`brands-skills-*`、`brands-instructions-*`、`project-picker-*`。宽度后缀与实际 viewport 一致。
