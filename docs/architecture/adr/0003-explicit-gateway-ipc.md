# ADR-0003：FrontendGateway 使用三个显式 command 与单一 invalidation event

> 状态：Superseded（2026-08-22，由 ADR-0020 取代）
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

`FrontendGateway` 是 UI 唯一外部 seam，固定提供 `read`、`prepare`、`apply` 和 `observe`。需要决定该 interface 如何映射到 Tauri IPC，同时保持类型清晰、最小权限、稳定版本和敏感信息保护。

MVP 的 WebView 与 Rust core 随同一个应用版本发布，只有一个主工作区窗口；`WorkspaceEvent` 只表达低频失效提示，不传递权威事实或进度详情。

## 决策

- `read`、`prepare`、`apply` 分别映射为 `frontend_gateway_read`、`frontend_gateway_prepare`、`frontend_gateway_apply`；
- 三个 command 使用相同的版本化 envelope 规则，但各自保留独立的封闭 payload 类型；
- `observe` 使用一个只发往 main WebView 的版本化 invalidation event，由 TypeScript adapter 本地过滤 `Subscription`；
- 不采用万能 dispatcher、字符串 route registry、Tauri Channel 或 Rust subscription registry；
- domain 结果与 wire fault 分离，异常字符串不跨越 IPC seam；
- `TauriFrontendGateway` 是前端唯一允许依赖 Tauri frontend package 的 adapter。

transport/protocol fault 的映射由已确认的 `ARC-02c` 与 `CR-FE-001` 决定；本 ADR 本身不扩展 `PrepareResult`。

## 结果

正向影响：

- wire 与冻结 interface 直接对应，调用与故障定位清晰；
- Tauri permissions 可以分别描述 read、prepare 和 apply；
- 独立 tagged union 保留 TypeScript 与 Rust 的类型约束；
- 低频事件不需要 Channel 的顺序与吞吐机制；
- transport、版本、redaction 和错误转换仍集中在一个生产 adapter 与 ingress module。

代价：

- 三个 command 需要共享 wire 校验与日志策略，避免实现漂移；
- main WebView 最终仍需要三个 command 的权限，command 分离不能替代 core 的 prepared ID、revision 和磁盘重校验；
- Tauri event 缺少 command 级别的细粒度 capability，因此事件 payload 必须保持最小、非敏感和非权威；
- 大型源码或统一差异的 JSON 序列化性能仍需真实样例验证。

## 不变量

- `prepare` 无副作用；
- `apply` 只接受 prepared ID 与原并发 token，并在写入前重新读取磁盘；
- `apply` 响应中断后不得自动重试；
- request ID 不参与授权或幂等；
- event 丢失、重复或乱序不影响事实正确性；
- adapter 与 ingress 不记录 request/response body；
- UI module 不直接依赖 Tauri。

## 替代方案

### 单一 dispatcher command

command surface 最小，集中校验的 locality 较强，但 read 与 apply 共用同一 permission，类型可发现性和故障定位更弱。

### route registry + Channel

支持每条 route 独立版本和高吞吐有序事件，但会引入字符串路由、schema 矩阵、订阅生命周期和推测性扩展能力，不适合当前同包、单窗口 MVP。

## 参考资料

- [Tauri Inter-Process Communication](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)
- [Tauri Calling the Frontend from Rust](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri Permissions](https://v2.tauri.app/security/permissions/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
