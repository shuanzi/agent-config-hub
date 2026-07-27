# ADR-0012：采用分层证据与少量真实 Tauri 主路径

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

前端契约要求 mock 与真实 `FrontendGateway` adapter 复用同一契约测试，同时禁止把 mock、静态检查或设计结果抬升为真实 IPC、文件写入和发布证据。全部旅程运行真实 Tauri 成本过高，但把真实边界推迟到发布又会让权限、wire 和 lifecycle 问题暴露过晚。

## 决策

- 使用 L0 静态、L1 module/contract、L2 renderer journey、L3 Tauri integration、L4 release artifact 五层证据；
- Rust core、adapter、事务和 wire vectors 使用 `cargo test`；
- framework-neutral TypeScript module 使用 Vitest node mode，不引入 jsdom；
- UI 用户旅程使用 WebdriverIO browser mode 与 mock `FrontendGateway`；
- 少量关键路径使用 WebdriverIO Tauri service 驱动专用 macOS 测试构建；
- mock 与真实 adapter 导入同一个 `FrontendGatewayContract` assertion module；
- FE 票据运行聚焦层级，`RELEASE-GATE` 汇总真实 adapter 全回归和生产 artifact；
- 测试构建、mock、真实 IPC 和生产 artifact 的 provenance 分开记录，不能互相代替。

## 测试能力隔离

- embedded WebDriver plugin 只通过专用 Cargo feature/profile 编入 test harness；
- test harness 使用独立 bundle identifier、数据根、临时授权目录和 synthetic fixtures；
- 不默认引入可直接执行后端逻辑的额外 WebdriverIO Tauri plugin；
- 生产 app、DMG 和 updater artifact 必须负向证明没有 WebDriver plugin、test command、test capability、fixture 或 test entry；
- 测试插件不能仅靠运行时 flag 关闭；
- 真实写入 tracer 只操作隔离临时原生单元，不读取或修改真实用户 Agent 配置或 Git 工作树。

## Interface 不变量

- L2 mock PASS 不是真实 IPC 或磁盘证据；
- L3 test harness PASS 不是生产签名/notarization 或发布 artifact 证据；
- L4 启动 PASS 不自动证明全部 UI journey；
- gateway 契约行为断言只有一份，adapter setup/teardown 可以不同；
- event 必须实际跨 WebView/Core seam 后才能取得真实 IPC credit；
- screenshot、DOM dump 和日志只能作脱敏失败证据，不能作为主要行为断言；
- coverage 百分比、snapshot 数量或测试文件存在不能关闭票据；
- fixture 与测试输出不得包含真实秘密、个人路径或可重放写入数据。

## 结果

正向影响：

- 大多数行为在快速、确定的层获得反馈；
- IPC、权限、WebView 和 core 集成在首个 tracer 就被实际验证；
- 同一 WebdriverIO 体系覆盖 renderer-only 与 Tauri integration；
- 写入、敏感信息和发布 provenance 保持清晰；
- 生产二进制不携带自动化控制面。

代价：

- 需要维护 browser mode 与 Tauri test harness 两种配置；
- test harness 与 production artifact 必须分别构建和保留 identity；
- 部分旅程只在 mock renderer 层全覆盖，真实 Tauri 只选关键 tracer；
- macOS L3 runner 比 L0 至 L2 更慢，需要限制到真实变化边界。

## 替代方案

### 全量真实 Tauri E2E

还原度最高，但会让全部 fixture 承担桌面进程、临时授权和 WebDriver 生命周期成本，且更难定位 domain、wire 或 UI 层问题。

### 发布前仅 mock/browser

实现早期最简单，但无法及时发现 command permission、event、序列化和 WebView lifecycle 问题，也不满足真实 adapter 证据要求。

## 重新评估触发条件

只有真实回归证明关键失败持续发生在未覆盖的 Tauri 集成路径，才扩大 L3 tracer；若 WebdriverIO embedded provider 无法在固定 macOS runner 上稳定工作，先记录实际失败证据，再评估另一种单点驱动方案。不得预先把全部 FX 旅程提升为桌面 E2E。
