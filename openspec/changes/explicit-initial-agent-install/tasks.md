# 任务

## 契约与实现

- [x] 1.1 更新 Skills/Subagents 安装命令与 API 请求，将发现安装和 ZIP 安装改为必填 `initialApp`/`initial_app`。
- [x] 1.2 移除应用外壳、路由和 query key 中的全局 Agent 状态；保留四 Agent 行级启用状态。
- [x] 1.3 在安装对话框／动作面板加入显式初始 Agent 选择，并在 `all` 下同时要求完整 target。
- [x] 1.4 保持 local import 的面板内 Agent 选择，不引入全局默认值；保持更新、卸载、toggle、备份恢复的 target 派生语义。
- [x] 1.5 将已安装 Skills 重排为五列语义表格，补齐 ownership 分组、同名项目 `rootPath` 消歧与完整 target 可访问名称。
- [x] 1.6 接入 Tauri dialog 单 ZIP 文件选择器，保留既有 ZIP command、target 与存储模型。

## 验证

- [x] 2.1 补充 L1：无初始 Agent、四 Agent 选择、重复安装、`all` target 门控、ownership 与 Dialog 内结构化错误。
- [x] 2.2 补充 L2：无全局 Agent 控件、发现安装、global/project 切换、1280 操作边界、1199/390 响应式和焦点恢复。
- [x] 2.3 补充并运行 Rust：四 Agent 初始投影、global/project 隔离、更新／恢复原 target 和 root unavailable fail-closed。
- [ ] 2.4 在真实桌面完成原生 ZIP picker 的打开、取消与 fixture ZIP 安装；现有 L3 command smoke 不替代该证据。
- [x] 2.5 运行 `openspec validate --all --strict`、前端构建、L1/L2 与受影响 Rust 测试，记录真实通过结果。

## 明确不做

- [x] 3.1 不新增数据库迁移、`initialApp` 持久化字段、通用 Agent adapter 或旧参数兼容层。
- [x] 3.2 不改变四 Agent、ConfigContext/ScopeTarget、project resolver、SSOT、备份目录或发现安全预算。
- [x] 3.3 不加入后台轮询、跨 target 恢复／转移、批量启停、全局搜索、Hooks 或其他 Agent。
