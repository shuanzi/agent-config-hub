# Agent Config Manager

本地单用户的 Agent 配置管理工作台，管理 Skills、AGENTS.md 和原生 Subagents。支持全局与已登记项目，提供目录投放、接管、编辑、备份及冲突保护。界面显示文件配置状态，不保证运行中的 Agent 已加载配置。

Skills 默认使用目标 × Agent 矩阵，目录维护及其他页面沿用 polished 精细稿。项目排除支持 Claude Code、Gemini CLI、OpenCode 原生配置，以及 Codex 显式项目 CLI 启动入口。支持基线为 macOS 15+、Apple Silicon；正式签名、打包和发布验证尚未建立。

## 启动与验收

准备 Node **24.18.0**、npm **11.16.0**；桌面构建另需 Rust **1.97.1** 和 Xcode Command Line Tools。工具链以 [package.json](package.json) 和 [rust-toolchain.toml](rust-toolchain.toml) 为准。

```sh
npm ci
npm run accept:ui
```

浏览器打开 <http://127.0.0.1:1421/tests/acceptance/>。入口复用正式 App，明确使用模拟数据；刷新恢复样例，不写入 Agent 文件。

```sh
npm run accept:app
```

桌面入口使用真实 Tauri 命令，默认数据隔离在 `.artifacts/acceptance/home`。重复启动保留数据，`npm run accept:app -- --fresh` 另建目录。具体操作、文件结果与重启验收见[验收指南](docs/acceptance/polished-ui.md)。

## 文档导航

| 文档                                                          | 用途                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| [产品说明](docs/product/README.md)                            | 当前产品行为、范围、术语与限制的权威说明             |
| [架构说明](docs/architecture/README.md)                       | 模块、存储、路径、写入保护与失败处理                 |
| [前端说明](docs/frontend/README.md)                           | 数据契约、操作目标、导航和可访问性                   |
| [开发指南](docs/development.md)                               | 环境、命令、测试分层和文档更新规则                   |
| [设计入口](docs/design/README.md)                             | polished Pen、已批准矩阵原型与静态预览               |
| [验收入口](docs/acceptance/README.md)                         | 操作指南、有日期的报告及证据目录                     |
| [2026-09-27 验收结果](docs/acceptance/polished-ui-results.md) | 有日期的运行证据及其边界，不代表每个后续提交均已复测 |
| [架构决策索引](docs/architecture/adr/README.md)               | 决策理由、适用状态与替代关系                         |

问题与任务在 GitHub Issues 跟踪，现行规格直接维护在上述文档中。项目不再使用 OpenSpec。旧版本文档、设计迭代和过程材料通过 Git 历史追溯，不作为当前实现约束。
