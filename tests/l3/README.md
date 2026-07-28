# L3 — Tauri 真实主路径 tracer（FE-01）

证明内容：专用 test-harness 构建上「启动 → 一次真实 read → event 失效后重读」
的真实 command/event/隔离磁盘路径。不证明生产签名、notarization 或 DMG（L4）。

## 前置

- macOS arm64，Xcode CLT；Rust toolchain 见仓库根 `rust-toolchain.toml`。
- 无需 tauri-driver/safaridriver：macOS 使用 `@wdio/tauri-service` 的
  `embedded` provider，WebDriver server 由 `tauri-plugin-wdio-webdriver`
  内嵌在 harness 进程中（只监听 loopback，进程退出即关闭）。
  `cargo install tauri-driver --locked` 仅在其他平台/调试时需要。
- 依赖注意：`@wdio/tauri-service@1.2.0` 的 dist import 了只在
  `@wdio/native-utils@2.5.0` 才存在的符号（上游发布错位），package.json
  以 `overrides` 强制解析到 2.5.0；升级 tauri-service 后应复核该 override。
- harness 构建依赖 `dist/`：先构建前端。

## 构建 harness（准确命令）

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$HOME/.cargo/bin:$PATH"
corepack npm run build:frontend
corepack npx tauri build --debug --no-bundle \
  -c src-tauri/tauri.conf.test-harness.json \
  -- --features test-harness
```

产物：`src-tauri/target/debug/agent-config-manager`（debug profile，含
`tauri-plugin-wdio-webdriver` 与 `test_fx01_external_change` command；
独立 identifier `com.agentconfigmanager.testharness`；`withGlobalTauri`
仅供测试驱动调用 invoke；生产配置不含这些能力）。

## 运行 L3

```bash
corepack npx wdio run tests/l3/wdio.conf.ts
```

`onPrepare` 会把 `fixtures/fx-01/native-root` 复制到临时目录并以
`ACM_NATIVE_ROOT` 指向副本（harness 子进程继承 env）；仓库内 fixture 永不
被原地修改；`onComplete` 清理临时目录。

## 信任边界

- harness 只在 `test-harness` Cargo feature 下编译测试能力；生产构建
  （默认 feature 集）物理移除 WebDriver plugin 与测试 command。
- 数据根只有 `ACM_NATIVE_ROOT` 指向的临时副本；harness 不访问真实用户
  Agent 配置、Keychain 或 Application Support。
- 事件 payload 只含 wireVersion + 失效类别；core 不输出日志；遮蔽后的
  maskedText 之外不存在占位明文。
