# ADR-0002：业务 Rust core 采用 Tauri Core 进程内模块

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

Tauri 已将系统 WebView 与 Core 分成不同进程。仍需决定业务 Rust core 是作为 Tauri Core 进程内模块运行，还是增加独立 sidecar。

MVP 同时只允许一个资产、一个目标和一个活动草稿或事务；适配器包是官方签名的声明式数据，不包含任意可执行代码。写入流程要求基于最新 revision 创建快照、原子应用并在失败时回滚。

## 决策

- 业务 Rust core 作为 Tauri Core 进程内的深模块运行；
- Tauri wire ingress adapter 与业务 core 分离，core interface 不暴露 Tauri 类型；
- 不增加长驻 sidecar、后台 daemon 或事务专用短生命周期 helper；
- 耗时计算使用同进程受控后台任务，不阻塞 WebView 交互；
- revision、prepared operation、索引状态和文件事务由单一 core 实例统一协调；
- UI 不获得 shell 或 sidecar 执行权限。

本 ADR 不决定 `FrontendGateway` 的具体 command/envelope 形状，也不决定内部线程池、async runtime 或 core 模块拆分。

## 结果

正向影响：

- 写入与并发状态只有一个权威持有者；
- 避免第二层进程协议、认证、重连和版本兼容；
- 打包、签名、notarization 与更新产物更少；
- core 仍可通过独立 interface 和替代 adapter 测试，不与 Tauri 实现耦合。

代价：

- core 的不可恢复故障会影响整个 Tauri Core 进程；
- 必须通过任务调度和有界资源使用保护 UI 响应性；
- 若未来引入不可信可执行扩展或多客户端，可能需要重新评估部署拓扑。

## 替代方案

### 长驻 Rust sidecar

提供更强的故障隔离和独立重启，但会增加进程认证、生命周期、状态同步、第二层 IPC 及发布治理。当前需求不足以抵消这些成本。

### 高风险操作使用短生命周期 helper

能够局部限制故障影响，但会让 revision、快照、事务结果与崩溃恢复横跨进程，削弱当前单事务模型的 locality。

## 重新评估触发条件

只有出现以下证据之一，才重新打开本决策：

- 真实样例证明特定解析或转换任务无法在进程内安全约束；
- 需要独立于 GUI 长驻运行的多客户端或 CLI 引擎；
- 产品范围正式允许不可信可执行插件；
- 发布或安全评审要求额外进程隔离。

## 参考资料

- [Tauri Process Model](https://v2.tauri.app/concept/process-model/)
- [Tauri Inter-Process Communication](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
