# 开发指南

## 环境与启动

支持基线为 macOS 15+ Apple Silicon。Node 24.18.0、npm 11.16.0 固定于 [package.json](../package.json)，Rust 1.97.1、rustfmt、clippy 与 `aarch64-apple-darwin` 固定于 [rust-toolchain.toml](../rust-toolchain.toml)。桌面构建需要 Xcode Command Line Tools。

```sh
npm ci
npm run verify:toolchain
npm run accept:ui
```

项目工具链脚本使用 Corepack；环境中须有可用的 `corepack`。如 npm 版本由 Corepack 提供，可使用 `corepack npm` 执行同样命令。按锁文件恢复依赖，不为绕过版本检查改写锁文件。

`accept:ui` 默认端口 1421，可传 `-- --port 1422`。`accept:app` 构建并启动真实桌面验收应用；`--fresh` 新建样例根，`--home <绝对路径>` 选择数据根，`--no-build` 复用已有验收构建。完整流程见[验收指南](acceptance/polished-ui.md)。

## 命令状态

| 命令 | 当前作用 |
| --- | --- |
| `npm run verify:toolchain` | 固定工具链与平台配置检查 |
| `npm run verify:docs` | 本地文档、链接、锚点、命令、设计及截图清单检查 |
| `npm run verify:static` | TypeScript、ESLint、Prettier、Rust fmt、两组 clippy 和依赖／占位值守卫 |
| `npm run test:frontend` | Vitest：前端逻辑、API、组件测试 |
| `npm run test:rust` | 默认和 test-harness 特性的 Rust 测试 |
| `npm run test:ui` | WDIO 浏览器测试，包含正式 App 及旧原型回归 |
| `npm run test:tauri` | 构建隔离 harness，真实 IPC 写入，再启动新进程回读 |
| `npm run build:frontend` | TypeScript 构建检查与 Vite 正式前端输出 |
| `npm run accept:ui` / `npm run accept:app` | 可操作浏览器／隔离桌面验收 |
| `npm run mock:ui` | 旧 full-ui 原型，只用于维护历史回归 |
| `npm run verify:ticket -- FE-01` | 历史票据组合检查；不能代表所有现行能力通过 |
| `npm run perf` | 显式未建立；旧采样绑定已删除实现，执行失败 |
| `npm run build:app` / `npm run package:macos` / `npm run verify:release` | 显式未建立；不能作为正式构建、签名或发布命令 |

验收 `.app` 是独立标识的本地调试应用，不代表正式打包流程已经建立。

## 测试与证据

| 层级 | 入口 | 证明范围 |
| --- | --- | --- |
| L0 | 静态及工具链检查 | 编译约束、格式和静态守卫，不证明运行行为 |
| L1 | 前端／Rust 单元测试 | 隔离条件下的行为和错误分支 |
| L2 | [浏览器配置](../tests/l2/wdio.conf.ts) | 正式 App 配合 mock invoke 的交互；旧原型用例仅证明原型 |
| L3 | [真实命令测试](../tests/l3/smoke.test.ts) | test-harness 的真实命令、隔离文件操作和新进程回读 |
| 人工桌面 | [操作验收](acceptance/polished-ui.md) | 原生系统选择器、窗口、文件结果与直接重开 |

`test:tauri` 由 [编排脚本](../scripts/orchestrator/test-tauri.mjs) 执行两次进程旅程，第二次使用同一临时数据根回读，完成后清理该测试根。不要将测试 WebDriver session 重载当作进程重启。

L3 使用仅在 `test-harness` feature 中编译的 WDIO 插件，生产配置不包含这些能力。构建由 [build-harness.mjs](../scripts/orchestrator/build-harness.mjs) 管理，入口为当前 `tests/l3` 的 smoke/app 页面；不存在旧 Gateway contract/event tracer 验证。macOS 使用 embedded provider，无需另外启动 tauri-driver 或 safaridriver。

在线测试显式开启：`ACM_ONLINE_ACCEPTANCE=1 npm run test:tauri`。网络失败与离线测试分别报告。旧性能脚本不参与有效性能门禁；恢复性能采样须针对当前列表和真实命令重新定义测量终点及预算。

文档改动运行文档检查及差异检查；涉及检查脚本时补充可发现实际失败的正反例。功能改动选择相关 L1/L2/L3 验证，不以历史报告替代本次结果。

## 隔离与产物

| 目录 | 用途 |
| --- | --- |
| `.artifacts/acceptance/home` | 默认手工桌面样例，重复启动保留 |
| `.artifacts/acceptance/frontend`、`.artifacts/acceptance/target` | 独立验收构建，避免覆盖测试 harness |
| `.artifacts/test-harness` | 测试构建身份等编排产物 |
| `/tmp/acm-polished-evidence` | Polished L2 本次运行截图输出，可能被后续运行替换 |
| `docs/acceptance/polished-ui-evidence` | 已归档的 2026-09-27 截图及日志，报告注明当时范围 |

`ACM_HOME` 控制应用路径根，不能替代对自定义目录覆盖的检查。真实验收只选择隔离根中的文件与目录。macOS 验收 `.app` 写入 `LSEnvironment`，直接重开继续使用选定数据根。宿主八个关键配置文件的哈希比较只证明这些文件未变，不代表扫描所有用户目录。

## 文档维护

根 [README](../README.md) 是总入口。产品行为维护在产品说明，UI/API 约定在前端说明，存储和保护在架构说明，视觉约束在当前 Pen 与设计清单，操作和结果在验收文档。术语定义在产品说明，不另建重复规格库。

功能或接口变化与代码同批更新相应章节；重要架构决定追加 ADR，并标注被替代范围。GitHub Issues 跟踪待办和讨论，不能替代仓库现行行为说明。项目不再维护 OpenSpec，不再创建其 change、运行其校验或新增版本号文档。

`verify:docs` 不访问网络，不验证外部页面内容；校验工作目录中的维护文档（含未提交新增文档），排除本地 Skills、构建产物、日志和测试输入。使用普通 Markdown 行内／引用链接、自动链接和标题锚点；避免依赖机器绝对路径。

检查器自身的回归用例使用临时文档目录，运行 `node --test scripts/orchestrator/verify-docs.test.mjs`，无需浏览器或桌面构建。

历史 ADR 保留原文与适用性说明，不能因为标题为 Accepted 就推断已经实现。验收结果按日期保留，不覆盖旧日志冒充新验证。旧资料从 Git 历史追溯；2026-09-27 整理前基线为 `4448ffcfbb89704c7975067de0bff58da4a5c4c7`。

本次退出旧规格体系的逐项映射和清理清单见[2026-09-27 整理记录](maintenance/2026-09-27-documentation-consolidation.md)。该记录为固定交付证据，不是需要持续更新的规格或台账。
