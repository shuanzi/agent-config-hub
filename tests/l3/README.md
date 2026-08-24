# L3 — Tauri 真实主路径 tracer + 行为契约（FE-01）

证明内容：专用 test-harness 构建上的真实 command/event/隔离磁盘路径。
两个互补 spec：

- `fx-01.tracer.test.ts`：用户可见旅程「启动 → 一次真实 read → event 失效后
  重读」；
- `contract.test.ts`：共享 FrontendGatewayContract（与 L1 同一断言模块
  `tests/contract/frontend-gateway-contract.ts`）经 `contract.html` 入口在
  真实 webview 内对 `TauriFrontendGateway` 运行。

不证明生产签名、notarization 或 DMG（L4）。

## 前置

- macOS arm64，Xcode CLT；Rust toolchain 见仓库根 `rust-toolchain.toml`。
- 无需 tauri-driver/safaridriver：macOS 使用 `@wdio/tauri-service` 的
  `embedded` provider，WebDriver server 由 `tauri-plugin-wdio-webdriver`
  内嵌在 harness 进程中；`browser.tauri.execute()` 与命令 mock 需要同时注册
  `tauri-plugin-wdio`（只在 `test-harness` feature 下编译）。两者都只监听
  loopback，进程退出即关闭。
  `cargo install tauri-driver --locked` 仅在其他平台/调试时需要。
- 依赖注意：`@wdio/tauri-service@1.2.0` 的 dist import 了只在
  `@wdio/native-utils@2.5.0` 才存在的符号（上游发布错位），package.json
  以 `overrides` 强制解析到 2.5.0；升级 tauri-service 后应复核该 override。
- harness 构建依赖 `dist/`：先构建前端。

## 构建 harness（准确命令）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$HOME/.cargo/bin:$PATH"
corepack npm exec -- tsc -b
corepack npm exec -- vite build --config vite.l3.config.ts
corepack npx tauri build --debug --no-bundle \
  -c src-tauri/tauri.conf.test-harness.json \
  -- --features test-harness
```

注意前端构建用 `vite.l3.config.ts`（在生产 `vite.config.ts` 基础上增加
`tests/l3/contract.html` 入口）；生产 `build:frontend` 保持单入口，物理
不含测试入口。产物：`src-tauri/target/debug/agent-config-manager`（debug
profile，含 `tauri-plugin-wdio`、`tauri-plugin-wdio-webdriver` 与
`test_fx01_external_change` / `test_fx01_cold_start_millis` command；独立
identifier `com.agentconfigmanager.testharness`；`withGlobalTauri` 仅供测试
驱动调用 invoke；生产配置不含这些能力）。

## 运行 L3

```bash
corepack npx wdio run tests/l3/wdio.conf.ts
```

`onPrepare` 会创建临时目录并以 `ACM_HOME` 指向它（harness 子进程继承
env）；仓库内 fixture 绝不被原地修改；`onComplete` 清理临时目录。

PF-01 L3 冷启动采样复用同一启动方式（`performance/wdio.l3.conf.ts`），由
`corepack npm run perf -- PF-01` 串行驱动；embedded provider 下
`reloadSession` 只换 WebDriver session 不重启应用进程，进程级冷启动样本
因此按「每次 wdio run 一个新 harness 进程」取得。

## 信任边界

- harness 只在 `test-harness` Cargo feature 下编译测试能力；生产构建
  （默认 feature 集）物理移除 WDIO plugin、WebDriver plugin 与测试 command。
- 数据根只有 `ACM_HOME` 指向的临时副本；harness 不访问真实用户 Agent
  配置、Keychain 或 Application Support。
- 事件 payload 只含 wireVersion + 失效类别；core 不输出日志；遮蔽后的
  maskedText 之外不存在占位明文。
