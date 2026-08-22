# ADR-0004：采用深 GatewayCore 与内部能力模块

> 状态：Superseded（2026-08-22，由 ADR-0020 取代）
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

产品基线要求四个 Agent、四类原生资产、派生索引、保真编辑、转换、校验、差异、快照、事务、回滚和平台能力共同满足同一套安全不变量。需要决定这些能力由一个深 core 统一编排，还是按 Agent/资产拆开，或交给通用 pipeline。

`FrontendGateway` 已冻结为 UI 唯一 seam；Rust core 位于 Tauri Core 进程内，IPC 使用三个显式 command。

## 决策

- wire ingress 只调用 `GatewayCore::read`、`GatewayCore::prepare` 和 `GatewayCore::apply`；
- `GatewayCore` 保持为编排与不变量 module，不堆积具体 parser、索引、事务或平台实现；
- core 内部使用 `CatalogIndex`、`AssetEngine`、`AdapterRegistry`、`OperationEngine` 和 `FileTransaction` 五个深 module；
- 原生资产唯一写入路径为 `OperationEngine -> FileTransaction`；
- 只有真实变化点建立 adapter：`AgentAdapter`、角色化 macOS 平台 adapter、`CoreEventSink` 和既有 `FrontendGateway`；
- 不创建宽泛 `PlatformAdapter`、通用 repository 层、command bus、动态 pipeline 或按 Agent 复制的 core；
- 临时强类型转换模型只存在于 `AssetEngine` 内存流程，不持久化或暴露为统一资产 DSL。

## Module 职责

| Module | 职责 |
|---|---|
| `CatalogIndex` | 授权范围扫描、派生检索、index status、事件合并和原子重建 |
| `AssetEngine` | 身份与上下文解析、原生保真、校验、转换、差异、冲突及敏感识别 |
| `AdapterRegistry` | 四个版本化 Agent adapter 与当前验证版本选择 |
| `OperationEngine` | prepare registry、单活动操作、revision 重验、apply 协调和结果对账 |
| `FileTransaction` | 最新快照、原子写入、回滚、恢复点和恢复冲突 |

## 结果

正向影响：

- 并发、事务、敏感信息和恢复不变量集中；
- UI、Tauri、Agent 格式和 macOS 能力互不泄漏实现细节；
- 四个 Agent 共享同一事务与契约测试，而格式差异保留在 `AgentAdapter`；
- 索引不能进入写入授权路径；
- 模块内部实现可替换而不改变 `FrontendGateway`。

代价：

- `GatewayCore` 编排需要明确依赖方向，避免演化为上帝模块；
- 内部 module 仍需各自的 interface 与聚焦测试；
- 跨模块 operation identity、revision 和错误类型需要一个 canonical domain 定义；
- 数据库、快照和 adapter 包选择必须遵守这些职责，不能反向重组已确认 seam。

## 替代方案

### 按 Agent 或资产类型拆分 core

局部格式逻辑更集中，但会复制事务、并发、敏感信息、索引失效和恢复规则，增加安全漂移。

### 通用 command bus 与可插拔 pipeline

能够动态组合 stage，但引入字符串路由、动态 registry 和推测性扩展面，与 MVP 的封闭适配器供应链不符。

## 重新评估触发条件

只有产品基线正式引入多进程、多客户端、可执行第三方扩展或跨资产联合事务时，才重新评估顶层 core 拓扑。
