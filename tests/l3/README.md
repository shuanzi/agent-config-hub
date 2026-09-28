# L3 真实 Tauri 验证

统一入口：`npm run test:tauri`。环境、构建、隔离目录及证据边界见[开发指南](../../docs/development.md#测试与证据)。

- [smoke.test.ts](smoke.test.ts) 经真实 Tauri command 验证 Skills、AGENTS.md、原生 Subagents、项目和设置；同一临时数据根在新进程中回读。
- [wdio.conf.ts](wdio.conf.ts) 使用 macOS embedded provider 与仅在 test-harness feature 编译的插件。`ACM_L3_HOME`、`ACM_L3_READBACK` 由编排脚本设置，不需要手工改写用户 HOME。
- 普通测试不依赖在线仓库；使用 `ACM_ONLINE_ACCEPTANCE=1 npm run test:tauri` 显式开启在线样例。
- harness 成功不代表正式应用签名、公证或分发。系统选择器的手工验收见[操作步骤](../../docs/acceptance/polished-ui.md#隔离桌面验收)。

当前入口为本目录的 smoke/app 页面；旧 Gateway、event tracer、contract.html 和性能冷启动说明不再适用。
