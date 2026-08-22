# Agent Config Manager MVP 技术方案 v0.1

> 状态：Superseded（2026-08-22，由技术方案 v0.3 与 ADR-0020 取代；原文保留不改写）
>
> 历史状态：已验收（2026-07-27）；`ARC-01` 至 `ARC-06c` 已确认，`ARCH-GATE` 已关闭
>
> 更新时间：2026-07-27
>
> 文档性质：实现产品基线与前端契约的整机技术方案，不新增或修改产品行为

## 1. 事实来源与防偏航约束

事实层级固定为：

1. `docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.1.md`；
2. `docs/frontend/Agent_Config_Manager_前端契约_v0.1.md`；
3. 本技术方案；
4. `.scratch/agent-config-manager-frontend/issues/` 下的前端票据。

本方案只回答实现方式。若技术讨论发现新的产品权衡，停止技术决策并提交最小 Change Request，不在本文件中静默改变产品范围、UI 状态或 `FrontendGateway` 契约。

`ARCH-GATE` 已于 2026-07-27 经用户集中验收后关闭。关闭只产生以下效果：

- 解除 FE-01 的门禁 blocker，使其成为唯一 `ready-for-agent` frontier；FE-02 至 FE-10 继续服从各自直接票据依赖；
- 不把任何 FE 票据标为 `done`，也不提前解除后续依赖；
- 不把设计结论、静态检查或 mock-only 结果表述为真实运行验证；真实命令与 artifact evidence 仍由对应票据及 `RELEASE-GATE` 取得。

## 2. 架构决策登记

| 编号 | 决策 | 状态 | 结论 |
|---|---|---|---|
| `ARC-01` | 桌面容器、前端运行时与核心语言 | 已确认（2026-07-27） | Tauri 2 + React/TypeScript + Rust core |
| `ARC-02a` | Rust core 部署拓扑 | 已确认（2026-07-27） | 业务 core 作为 Tauri Core 进程内模块，不增加 sidecar |
| `ARC-02b` | `FrontendGateway` IPC interface 与 wire | 已确认（2026-07-27） | 三个 verb command + 单一 WebView 定向 invalidation event |
| `ARC-02c` | transport/protocol fault 的契约归一化 | 已确认（2026-07-27） | 通过 `CR-FE-001` 增加 `PrepareFailed(GATEWAY_UNAVAILABLE)`，不伪造 domain 结果 |
| `ARC-03` | Rust 核心模块及平台、适配器、索引和事务 seam | 已确认（2026-07-27） | 深 `GatewayCore` + 内部能力模块；只在真实变化点设置 adapter |
| `ARC-04` | 私有存储、索引、监听、快照与加密 | 已确认（2026-07-27） | 单一 SQLite 状态库 + 应用私有加密快照目录；operation journal 协调跨资源恢复 |
| `ARC-04a` | `StateStore` 的 SQLite 访问与迁移实现 | 已确认（2026-07-27） | `rusqlite` + bundled SQLite/FTS5；单连接串行访问；内嵌 forward-only SQL migration；无 ORM、连接池或外部 migration CLI |
| `ARC-04b` | 加密快照容器与 macOS Keychain adapter | 已确认（2026-07-27） | `XChaCha20-Poly1305` + 单一 256-bit Keychain 密钥；随机 24-byte nonce；版本化 authenticated container；无轮换、同步或 envelope key |
| `ARC-04c` | 单文件与多文件恢复快照的 payload framing | 已确认（2026-07-27） | 版本化 `SnapshotPayloadV1` + `postcard`；一个恢复点对应一个加密 blob；无 TAR、压缩或逐文件密文 |
| `ARC-05a` | 应用更新与适配器包的签名信任拓扑 | 已确认（2026-07-27） | 共用一套产品更新签名密钥；Apple Developer ID 独立；两类 artifact 强制 domain separation |
| `ARC-05b` | 官方适配器包的版本与发布粒度 | 已确认（2026-07-27） | 四个 Agent 组成一个统一 compatibility bundle；包级原子切换，包内保留 Agent 级版本溯源 |
| `ARC-05c` | macOS 分发、更新 feed 与发布验证 | 已确认（2026-07-27） | Developer ID 直接分发 + 单 stable 静态 HTTPS feed；无动态发布服务 |
| `ARC-05d` | 官方适配器 bundle 的 canonical manifest、archive 与 detached signature | 已确认（2026-07-27） | RFC 8785 JCS manifest + 确定性无压缩 USTAR；Tauri signer-compatible detached signature 覆盖固定 domain、manifest bytes 与 TAR SHA-256 |
| `ARC-05e` | macOS 最低版本、CPU 架构与发布 artifact matrix | 已确认（2026-07-27） | macOS 15.0+、Apple Silicon arm64-only；单一 `aarch64-apple-darwin` 构建与 `darwin-aarch64` updater 发布轨 |
| `ARC-06a` | 前端 workspace、草稿、workflow 与 gateway 状态 module | 已确认（2026-07-27） | framework-neutral 深 `WorkspaceSession` + React 内置订阅；不引入通用状态库 |
| `ARC-06b` | 编辑器、diff、文件树、面板和基础 UI 依赖 | 已确认（2026-07-27） | CodeMirror 6 + 契约驱动的 diff/conflict renderer + WAI-ARIA 单选文件树 + `react-resizable-panels`；不引入完整 IDE 或 UI kit |
| `ARC-06c` | canonical schema、测试层级、性能与验证命令契约 | 已确认（2026-07-27） | Rust-first wire；分层测试；真实 tracer 校准预算；npm + Vite 根级验证命令 |

未确认项不得由票据或实现代理自行选择。

## 3. 已确认决策

### 3.1 `ARC-01`：Tauri 2 + React/TypeScript + Rust core

#### 决策

- macOS 桌面容器采用 Tauri 2；
- UI 运行时采用 React + TypeScript；
- 解析、转换、校验、索引协调、受保护文件事务和适配器能力的核心实现采用 Rust；
- `FrontendGateway` 继续作为 UI 唯一外部 seam，React UI 不直接依赖 Tauri、文件系统、数据库、Keychain、索引或 Agent 适配器；
- 真实 adapter 负责把 `FrontendGateway` 的语言无关行为映射到 Tauri IPC；mock adapter 与真实 adapter 必须复用同一份 gateway 契约测试。

业务 Rust core 的部署拓扑由 `ARC-02a` 单独确定。

#### 依据

- 已确认界面是包含源码编辑、文件树、统一差异和检查器的高密度工作台，React 能直接承接此前的 Web 原型与前端契约；
- 产品基线要求核心解析、转换和校验保持平台无关，且业务层不得硬编码 macOS 路径或平台行为；
- Rust 适合集中实现文件事务、并发 revision 校验、索引协调、声明式适配器执行与敏感数据处理；
- Tauri 的 WebView/Core 模型与异步消息传递能够承载 `FrontendGateway`，同时把操作系统权限留在 Rust 侧。

#### 约束

- 前端不得把 Tauri command 名称、事件名称或序列化细节扩散为业务状态模型；
- Tauri event 只能触发重读，不能成为资产事实或写入授权来源；
- 敏感明文不得进入普通 IPC 事件、日志、搜索、诊断或测试 fixture；
- exact dependency versions、bundler、编辑器及状态管理依赖留到 `ARC-06`，不得因本决策自动引入；
- 不因 Tauri 支持 sidecar 就预设独立进程、后台 daemon 或插件执行环境。

#### 被否决的替代方案

- Electron + React/TypeScript + Node/TypeScript core：开发语言统一，但运行时、安全治理和依赖面更大；
- SwiftUI/AppKit + Swift core：macOS 原生集成更强，但高密度编辑审查界面及平台无关核心的实现成本更高。

详细取舍记录见 `docs/architecture/adr/0001-tauri-react-rust-stack.md`。

### 3.2 `ARC-02a`：业务 core 位于 Tauri Core 进程内

#### 决策

- 业务 Rust core 作为 Tauri Core 进程内的深模块运行；
- 不增加长驻 sidecar、后台 daemon 或仅供事务使用的短生命周期 helper；
- Tauri IPC ingress 只负责 wire 解码、版本与边界输入校验、调用 core interface，以及结果编码，不承载业务规则；
- 业务 core 不接收 Tauri 类型，也不直接依赖 WebView、command 名称或 event 名称；
- 解析、转换、索引协调等耗时工作可以在同一进程内使用受控后台任务，但 revision、prepared operation 和事务状态仍由一个 core 实例统一持有；
- React UI 不获得 shell 或 sidecar 执行能力。

#### 依据

- MVP 是单用户、单应用实例、单活动草稿或事务，不需要多客户端共享后台引擎；
- 适配器包仅包含官方签名的声明式数据，禁止加载任意可执行代码，当前没有必须隔离的不可信插件；
- revision 重校验、最新磁盘快照、原子写入和回滚需要一个明确的事务权威，进程内 core 能避免第二层协议和状态同步；
- Tauri Core 已与 WebView 进程分离，并集中持有操作系统权限和全局状态。

#### 约束与后续退出条件

- UI 响应性通过受控后台任务保证，不以引入 sidecar 作为默认解法；
- 若真实测量证明某个解析器或转换任务存在无法在线程内约束的崩溃、内存或 CPU 风险，才提交 Change Request 评估局部 helper；
- 若未来出现多客户端、独立 CLI 长驻复用或可执行第三方插件，再重新评估长驻 sidecar；
- 增加 helper 时必须新增经过认证、版本化的 adapter，并保持 `FrontendGateway` interface 不变。

#### 被否决的替代方案

- 长驻 Rust sidecar：隔离更强，但为当前 MVP 增加进程认证、生命周期、协议版本、状态同步和发布产物；
- 仅对 `prepare`、`apply` 或转换使用短生命周期 helper：局部隔离，但会让 revision、快照、回滚和崩溃恢复横跨进程。

详细取舍记录见 `docs/architecture/adr/0002-in-process-rust-core.md`。

### 3.3 `ARC-02b`：三个 verb command + 单一 invalidation event

#### 决策

生产 `TauriFrontendGateway` adapter 使用三个明确的 Tauri command：

| `FrontendGateway` 行为 | Tauri command | Rust core 调用 |
|---|---|---|
| `read(query)` | `frontend_gateway_read` | `GatewayCore::read` |
| `prepare(intent, expectedFacts)` | `frontend_gateway_prepare` | `GatewayCore::prepare` |
| `apply(preparedOperationId, concurrencyToken)` | `frontend_gateway_apply` | `GatewayCore::apply` |

`observe(subscription)` 不新增 command 或 Rust subscription registry。生产 adapter 只监听一个发往 main WebView 的版本化 invalidation event，在 TypeScript 内按封闭 `Subscription` 集合过滤，并在销毁时解除监听。

三个 command 都使用同一 envelope 规则：

```text
request  = { wireVersion, requestId, payload }
response = { wireVersion, requestId, payload }
```

- `wireVersion` 是显式整数版本；不支持的版本在进入 core 前封闭失败；
- `requestId` 只用于脱敏关联和诊断，不参与身份、授权、并发或幂等判断；
- 每个 command 的 `payload` 是独立的封闭 tagged union，不使用字符串 route 或 `unknown` body；
- domain 结果作为成功 command response 的 payload 返回；wire fault 使用独立、结构化且不含异常字符串的类型；
- exact schema/codegen 工具属于 `ARC-06`，但 TypeScript 与 Rust 必须共享一个 canonical schema 事实源和双向契约向量。

#### Ingress 与 adapter 约束

- 只有 `TauriFrontendGateway` adapter 可以依赖 Tauri frontend package；React 页面和状态 module 不得直接调用 `invoke`、监听 Tauri event 或访问插件；
- main WebView 只获得三个 gateway command 的显式 permissions，不获得文件系统、shell、数据库、Keychain 或 sidecar 权限；
- Rust wire ingress 先验证调用来源、wire version、payload 大小与 shape，再转换为 Rust domain type；
- wire ingress 只负责解码、校验、调用与编码；业务判断集中在 `GatewayCore` 深模块；
- command 和 event 的日志只记录允许的元数据、稳定原因码与耗时，禁止记录 request/response body；
- `SensitiveRevealQuery` 仍通过 `read`，其结果不缓存、不进入事件或日志，授权到期、资产切换或 revision 变化后失效；
- event 只携带版本、失效类别和最小不透明 identity，不携带路径明文、进度详情、敏感明文或可重放写入数据；
- event 丢失、重复或乱序最多造成额外 `read`，不能影响正确性；adapter 应先建立 listener，再执行初始 `read`。

#### 写入不变量

- `prepare` 无副作用；
- `apply` payload 只包含 `preparedOperationId` 与原始 revision-bound `OperationConcurrencyToken`，不能由前端重新提交路径、差异或待写内容；
- core 在写入前原子 claim prepared operation、重读受影响事实并重新校验；不匹配时不写入；
- prepared operation 最多成功消费一次；
- `apply` command 的响应中断后不得自动重试写入，只能使用既有 `OperationIdentity` 发起 `OperationProgressQuery` 取得权威状态。

#### 被否决的替代方案

- 单一 dispatcher command：wire surface 更小，但 read、prepare 与 apply 共用同一 command，权限、类型和故障定位较弱；
- route registry + Channel：支持独立消息版本和高吞吐有序流，但当前同包发布、单窗口、低频 invalidation 不需要该复杂度。

详细取舍记录见 `docs/architecture/adr/0003-explicit-gateway-ipc.md`。

### 3.4 `ARC-02c`：transport/protocol fault 封闭归一化

#### 决策

技术阶段发现原封闭 `PrepareResult` 无法表达“尚未取得可信结果”的 transport/protocol failure。用户已确认最小 `CR-FE-001`，并回写同一份前端契约：

- `PrepareResult` 增加 `PrepareFailed(reasonCode, recoveryAction?)`；
- UI 稳定原因码增加 `GATEWAY_UNAVAILABLE`；
- `PrepareFailed` 不含 prepared ID、并发 token、差异或可应用内容；
- UI 保留草稿、目标和工作区上下文，只能显式重试；
- mock 与真实 adapter 通过 `FX-18 gateway-prepare-unavailable` 复用同一契约断言。

这不是新的产品能力，也不改变正常 prepare、review、confirm 或 apply 流程。

#### Wire fault 分类与归一化

wire 内部允许使用不暴露给 UI 的封闭 fault：

- unsupported wire version；
- unauthorized caller；
- invalid or oversized payload；
- response kind/request ID mismatch；
- transport unavailable；
- sanitized internal failure。

所有 fault 在 ingress 或 `TauriFrontendGateway` adapter 内处理，不把异常字符串、路径、payload 或 Rust error 传给 UI：

| Gateway 行为 | 无法取得可信结果时的处理 |
|---|---|
| `read` | 返回 `ReadFailed(GATEWAY_UNAVAILABLE, recoveryAction?)` |
| `prepare` | 返回 `PrepareFailed(GATEWAY_UNAVAILABLE, recoveryAction?)` |
| `apply` | 若 core 已可信确认请求未被接受，返回 `FailedResult(GATEWAY_UNAVAILABLE, rollback: notNeeded)`；一旦接受状态或结果不确定，保持 applying，通过 `OperationProgressQuery` 对账，绝不重试或伪造失败 |
| `observe` | 事件通道本身不产生 domain result；adapter 重建 listener，并以随后 `read` 的结果恢复事实 |

协议版本不匹配、非法 payload 或未授权 caller 通常表示构建错误或安全事件；即使内部诊断能够区分，UI 仍只消费 `GATEWAY_UNAVAILABLE`，避免把 transport 细节变成第二套产品状态。

#### 被否决的替代方案

- 在 `FrontendGateway` 之外抛出 `GatewayWireFault`：会形成第二个 UI seam，并使 mock 与真实 adapter 的 error mode 漂移；
- 伪造 `canApply=false` 的 `PreparedOperation`：在未形成可信计划时错误表达 prepared state，并可能污染 review/apply 不变量。

本项属于已接受的最小契约修正，直接记录于契约和本技术方案；不另建 ADR。

### 3.5 `ARC-03`：深 GatewayCore 与内部能力模块

#### 外部 core interface

Rust wire ingress 只调用一个深 `GatewayCore` module：

```text
GatewayCore::read(query) -> ReadResult
GatewayCore::prepare(intent, expectedFacts) -> PrepareResult
GatewayCore::apply(preparedOperationId, concurrencyToken) -> OperationResult
```

`GatewayCore` interface 使用 Rust domain type，不接收 Tauri、SQLite、文件路径字符串拼装、Keychain 或具体 Agent parser 类型。它负责保持跨模块不变量和调用顺序，不亲自实现所有能力。

core 通过注入的 `CoreEventSink` 发送最小 invalidation；生产 adapter 转成 Tauri WebView event，测试 adapter 只记录事件。事件发送失败不改变已经确定的 domain 结果。

#### 内部深模块

| Module | 单一职责 | 明确隐藏 |
|---|---|---|
| `CatalogIndex` | 发现已授权原生资产、维护派生查询索引和 index status | 扫描、事件合并、有界校准、原子重建；索引永远不授权写入 |
| `AssetEngine` | 解释一个原生资产并生成保真编辑、校验、转换、差异和冲突事实 | 身份解析、生效上下文、临时强类型转换模型、规则、模板、敏感识别和四 Agent 差异 |
| `AdapterRegistry` | 提供当前已验证的四 Agent adapter 与准确版本事实 | 内置/候选/上一可用版本选择、兼容判定；包验证和更新细节由 `ARC-05` 补齐 |
| `OperationEngine` | 维护单一活动 prepared operation，协调 prepare 与 apply 生命周期 | prepared registry、一次性 claim、revision 重验、operation progress 和结果对账 |
| `FileTransaction` | 唯一原生资产写入 module | 最新状态快照、原子替换、回滚、恢复点和故障注入；底层采用 `ARC-04` 的 SQLite manifest 与加密快照目录 |

`GatewayCore` 只编排这些 module，不复制其规则。删除任一内部 module 后，其复杂度会扩散到多个调用路径，因此这些 module 具有实际 depth。

#### 真实 seam 与 adapter

只在当前确有多个 adapter 的位置建立内部 seam：

- `AgentAdapter`：Claude Code、Codex、Gemini CLI、OpenCode 四个正式 adapter，以及共享 conformance test adapter；
- 角色化平台 seam：原生文件访问、文件监听、安全密钥存储、废纸篓、只读 Git 状态分别由 macOS adapter 与测试 adapter 满足；不创建包含所有系统能力的宽泛 `PlatformAdapter`；
- `CoreEventSink`：Tauri event adapter 与测试记录 adapter；
- `FrontendGateway`：mock adapter 与 Tauri adapter，继续作为唯一 UI seam。

数据库、索引和快照实现已经由 `ARC-04`、`ARC-04a`、`ARC-04b` 与 `ARC-04c` 固定。它们当前各只有一个 production implementation，测试直接使用隔离的真实本地实例，因此 seam 保持在 module 内部，不增加通用 repository 或 pass-through interface。

#### 不变量归属

- `CatalogIndex` 是可丢失、可重建的查询加速层；资产详情和所有写入都重新读取原生事实；
- `AgentAdapter` 只解释与生成内容，不自行读写文件、访问 Keychain、执行脚本或改变索引；
- 临时强类型转换模型只存在于 `AssetEngine` 内存流程，不持久化、不暴露为统一资产 DSL；
- `OperationEngine` 是 prepared operation 和单活动事务的权威持有者；
- `FileTransaction` 是原生资产唯一写入点；其他 module 不获得原生写权限；
- `FileTransaction` 成功或失败形成确定结果后，再由 `GatewayCore` 通知 `CatalogIndex` 失效并通过 `CoreEventSink` 提醒 UI 重读；
- 管理变更和导出仍通过 `OperationEngine`，但不得伪造原生资产恢复点或写入 Git。

#### 测试 surface

- UI 旅程通过 `FrontendGateway` interface；
- core 用户旅程通过 `GatewayCore` interface 和本地替代 adapter；
- 四个 `AgentAdapter` 运行同一 conformance suite；
- `FileTransaction` 通过其内部 interface 运行快照失败、磁盘满、部分写入、回滚失败和恢复冲突的故障注入测试；
- `CatalogIndex` 验证事件丢失、溢出、批量变化和原子重建，但不以索引结果证明写入正确。

#### 被否决的替代方案

- 按 Agent 或资产类型建立独立 core：会复制并发、事务、敏感信息和恢复规则；
- 通用 command bus 与可插拔 pipeline：引入动态路由和 stage registry，并暗示当前 MVP 不允许的可执行扩展面。

详细取舍记录见 `docs/architecture/adr/0004-deep-gateway-core.md`。

### 3.6 `ARC-04`：单一 SQLite 状态库 + 加密快照目录

#### 逻辑布局

应用私有存储采用一个 SQLite 数据库和一个独立快照目录：

```text
Application Support/<application-id>/
  state.sqlite
  snapshots/
    <opaque-recovery-point-id>.snapshot
```

以上是逻辑布局。SQLite 访问与迁移实现由 `ARC-04a` 固定，快照加密与 Keychain 实现由 `ARC-04b` 固定，快照 payload framing 由 `ARC-04c` 固定；bundle identifier、绝对路径和容量数值仍未冻结。

#### `StateStore` 的 SQLite 实现（`ARC-04a`）

- FE-01 bootstrap 初始固定 `rusqlite 0.40.1`，关闭 default features 且只启用 `bundled` SQLite；最终精确依赖图以提交的 `Cargo.lock` 为准；
- 应用不链接 macOS 系统 SQLite，也不引入 SQLCipher。bundled build 提供一致的 SQLite 与 FTS5 编译能力；构建和 `StateStore` 启动测试必须实际创建 FTS5 virtual table，缺失时封闭失败；
- 不启用或调用 SQLite loadable extension、用户自定义 native extension 或运行时 extension 路径；负向测试确认配置和生产依赖图不存在该入口；
- MVP 由一个 `StateStore` implementation 持有一个 SQLite connection，并在 Rust blocking execution context 中串行访问；不建立 async connection pool，也不把 `rusqlite::Connection`、transaction、row 或 SQL 类型暴露给调用方；
- `StateStore` 继续是 core 内部深 module。调用方只使用领域行为与结果，测试通过同一 interface 驱动临时文件数据库；不新增通用 repository seam、按表 repository 或第二个 in-memory adapter；
- SQL 只来自受版本控制的静态语句和参数绑定。搜索输入、路径、资产内容及 adapter 数据不能成为动态 SQL identifier 或未绑定 SQL 片段；
- 只有真实 tracer 证明单连接调度无法满足已确认旅程时，才可在 `StateStore` implementation 内评估额外只读连接；不得因此改变 `GatewayCore`、`FrontendGateway` 或 domain owner 的 interface。

Schema migration 采用 `StateStore` 自有的最小内嵌 runner：

1. migration 是随二进制编译的、单调编号、forward-only SQL；不依赖开发机 CLI 或运行时外部文件；
2. 每个 migration 在一个 SQLite transaction 中运行，成功完成 schema invariant 检查后，在同一 transaction 更新 `PRAGMA user_version`；
3. 已发布 migration 不得原位修改；新增 migration 只能追加。`verify:static` 检查编号、顺序与已登记 digest 漂移；
4. 数据库版本高于应用支持范围、migration 失败或 schema invariant 不成立时，保留原数据库与快照目录并阻断写入和管理变更；不得自动删除、重建持久事实或尝试 downgrade；
5. L1 至少覆盖 fresh → latest、每个仍受支持的历史 schema → latest、注入失败后的原事务回滚、FTS5 可用、loadable extension 不可用，以及持久事实与派生 generation 不混写。

不创建通用 migration framework：runner 只负责顺序、transaction、版本记录和失败归一化，migration 语义仍由拥有相应表的 domain module 提供并由 `StateStore` 统一执行。

`StateStore` 的具体取舍记录见 `docs/architecture/adr/0015-rusqlite-state-store.md`。

`state.sqlite` 同时容纳两类明确隔离的数据：

| 数据组 | 内容 | 可否重建 |
|---|---|---|
| 持久私有事实 | 已纳入项目与授权范围、来源和漂移关系、operation journal 与结果、恢复点 manifest、固定状态，以及后续 `ARC-05` 确认的适配器选择元数据 | 不保证可重建；丢失后不能从原生资产推断历史 |
| 派生查询数据 | 资产目录投影、允许搜索的脱敏字段、索引 generation、最近扫描事实与 `IndexStatus` | 可丢弃并从已授权原生目录重建 |

数据库不是原生资产的事实来源。路径只作为私有事实的一个属性，不能替代不透明资产身份；索引、journal 和数据库缓存都不能授权原生写入。

原生内容、前端草稿、prepared operation 的待写内容与差异、敏感明文、快照密钥和适配器包正文不进入 SQLite。`prepare` 仍完全无副作用，prepared operation 只在当前 core 实例的单活动 registry 中存在；应用重启后必须重新 prepare。

#### Module 归属

- SQLite 生命周期、schema migration、事务和连接策略由 core 内部 `StateStore` implementation 集中隐藏；
- `StateStore` 不进入 `GatewayCore` 外部 interface，也不建立通用 repository seam；生产与测试都直接使用 SQLite，测试使用临时数据库；
- 每组表只有一个 domain owner：`CatalogIndex` 拥有派生目录与搜索数据，`OperationEngine` 拥有 operation journal 和结果，`FileTransaction` 拥有恢复点 manifest 与快照状态，管理事实由其对应 module 拥有；
- `FileTransaction` 是快照目录和原生资产的唯一写入 module；其他 module 只能持有不透明 blob handle；
- watcher 只由已确认目录对应的 macOS 文件监听 adapter 提供变化提示。`CatalogIndex` 合并事件；溢出、批量变化或一致性不确定时先标记 `stale`，再执行有界扫描；
- 索引重建先写入新的 generation，验证完成后在一个 SQLite transaction 中切换 active generation。读取方只看到旧 generation 或新 generation，不看到混合结果；
- 重建或清理派生表不得删除或覆盖持久私有事实。

#### 快照与密钥边界

- 完整恢复快照以不透明 recovery point identity 命名并存放于应用私有快照目录，不泄漏原生路径；
- 所有完整快照统一使用版本化、具完整性校验的加密容器，避免依赖敏感信息识别是否完整；
- 加密密钥只通过 macOS 安全密钥存储 adapter 获取，不写入 SQLite、快照文件、日志、事件、诊断或 fixture；
- 无法取得密钥、无法创建并持久化必要快照、磁盘空间不足或 manifest 无法提交时，`FileTransaction` 在触碰原生资产前封闭失败；
- 独立文件或目录删除的恢复点可以引用系统废纸篓返回的不透明恢复 handle；配置块删除和其他原生改写使用加密完整快照；
- SQLite manifest 记录 recovery point identity、资产身份、opaque native write unit identity、写入前 `Absent` / `Present(revision)`、创建时间、固定与有效状态、大小、恢复策略和不透明 blob/废纸篓 handle，不记录敏感明文。

#### `SnapshotVault` 与 Keychain 实现（`ARC-04b`）

`FileTransaction` 内部使用一个深 `SnapshotVault` module：

```text
FileTransaction
  └── SnapshotVault
        seal(recoveryPointId, capturePlan) -> sealed container
        open(expectedRecoveryBinding, sealed container) -> restorable snapshot
              │
              └── SnapshotKeyStore interface
                    ├── MacOsSnapshotKeyStore adapter
                    └── SyntheticSnapshotKeyStore adapter
```

- FE-04 实现切片初始固定 `chacha20poly1305 0.11.0` 的 `XChaCha20Poly1305` 与 `zeroize` 支持，以及 `security-framework 3.7.0`；精确依赖闭包由提交的 `Cargo.lock` 固定；
- `FileTransaction` 不接触 payload wire、算法、nonce、Keychain query 或原始密钥；它只通过 `SnapshotVault` 的 `seal` / `open` interface 提交已授权 capture plan，并取得已认证、已校验的恢复模型；
- `SnapshotKeyStore` 是真实平台 seam：生产 adapter 访问 macOS Data Protection Keychain，合成 adapter 只用于固定向量、失败注入和非生产测试；
- nonce 只能由 `SnapshotVault` 在每次 `seal` 时通过 OS CSPRNG 新生成，调用方不能提供、覆盖或复用 nonce；MVP 不持久化 nonce counter 或 nonce registry；
- 不建立通用凭证库、密钥管理 interface、Secure Enclave、Touch ID、应用密码、云同步、密钥导入导出、轮换或 per-snapshot envelope key；
- 快照明文只存在于受控进程内存，不写入临时明文文件；密钥和解密 buffer 在使用后 zeroize。若当前 payload 无法在受策略约束的内存中完成 one-shot AEAD，必须在触碰原生资产前以 `SNAPSHOT_FAILED` 阻断，不能降级为明文落盘；
- 容器解密和 authentication 完成前，不得创建恢复目标临时文件或覆盖任何原生内容。

`snapshot-container/v1` 使用固定 canonical binary envelope：

| 字段 | 编码 |
|---|---|
| magic | 固定 8 bytes：`ACMSNAP\0` |
| container version | big-endian `u16 = 1` |
| algorithm | big-endian `u16 = 1`，唯一表示 `XChaCha20-Poly1305` |
| nonce | 每个快照通过 OS CSPRNG 新生成的 24 bytes |
| ciphertext length | big-endian `u64`，包含 16-byte authentication tag |
| ciphertext + tag | `XChaCha20Poly1305` 标准 postfix tag 输出 |

AAD 是无歧义长度编码的 tuple：固定 domain `agent-config-manager/snapshot/v1`、完整 envelope header、预期 recovery point identity。它把 blob 绑定到 manifest identity；替换、截断、追加、未知版本、未知算法、长度不一致、nonce/密文/tag/AAD 任一篡改都必须在返回明文前失败。header 不含资产路径、正文、密钥或其他敏感值。

`MacOsSnapshotKeyStore` 使用一个 32-byte 应用快照密钥：

- Keychain generic-password service 按最终 bundle identifier 派生为 `<bundle-id>.snapshot-key`，account 固定为 `v1`；test harness 使用独立 test bundle identifier；
- 所有 add/get query 都启用 Data Protection Keychain，显式限定 `synchronizable = false`，使用默认 `WhenUnlocked` 可访问性，不要求额外用户交互；
- 仅当数据库中不存在 recovery manifest 且快照目录为空时，第一次需要完整快照可以通过 OS CSPRNG 自动生成密钥。该动作是内部 bootstrap，不构成用户可见密钥创建能力；
- 创建必须是 add-only；若出现 duplicate item，重新读取既有值，绝不 update 或覆盖。读取值不是恰好 32 bytes 时封闭失败；
- Keychain 暂时不可用、item 读取失败或已有 recovery manifest/blob 时 item 缺失，统一为 `SECURE_STORAGE_UNAVAILABLE`，不得静默生成新密钥、删除旧恢复点或绕过快照；
- 密钥不缓存到应用长期状态，不写入 SQLite、容器、日志、事件、诊断、crash report 或 fixture。

快照写入顺序固定为：

1. 验证 recovery store 为空或取得既有 Keychain 密钥；
2. 将 capture plan 编码为 `ARC-04c` 的 canonical payload，生成随机 24-byte nonce，以 canonical header 与 recovery point identity 作为 AAD 完成 one-shot encryption；
3. 只把密文容器写入同目录临时文件，持久化并原子改名；
4. 重新打开容器并通过 `SnapshotVault.open` 完成 authentication、payload 校验及与 capture plan 的一致性检查；
5. 只有验证成功后，才在 SQLite transaction 中提交 recovery manifest 与 `snapshotReady`；
6. 任一步失败都删除可识别的临时密文，保留已存在恢复点，并在原生写入前以 `SNAPSHOT_FAILED` 或 `SECURE_STORAGE_UNAVAILABLE` 结束。

恢复时先读取 manifest 绑定的 blob、完成全容器 authentication，再进入既有恢复差异与确认流程。authentication 失败、key 缺失或 container 不受支持都不能尝试部分恢复。

L1 覆盖已知向量、round-trip、空 payload、所有 header/AAD/ciphertext/tag 篡改、截断/追加、每次 `seal` 请求新 nonce、nonce source 失败、Keychain missing/unavailable/duplicate/invalid-length，以及明文和密钥清理。L3 Keychain adapter tracer 只在隔离 runner 用户与独立 test bundle identifier 下创建合成 item，运行后删除；不得查询、更新或删除生产 service/account。

详细取舍记录见 `docs/architecture/adr/0016-xchacha-keychain-snapshot-vault.md`。

#### `SnapshotPayloadV1` framing（`ARC-04c`）

单文件与多文件资产共用一个版本化 payload；一个 recovery point 始终对应一个加密 blob，不建立逐文件密文、子 manifest 或通用 archive extractor。`SnapshotVault` implementation 内部使用 `postcard 1.1.3`，关闭 default features 且只启用 `alloc`；精确依赖闭包由提交的 `Cargo.lock` 固定。

`SnapshotVault` 的 interface 保持两个高杠杆操作：

```text
seal(recoveryPointId, SnapshotCapturePlan) -> sealed container
open(ExpectedRecoveryBinding, sealed container) -> RestorableSnapshot
```

- `SnapshotCapturePlan` 只能由 `FileTransaction` 在 apply 重读最新磁盘事实并经 native file adapter 验证后形成；UI、索引、prepared operation 和 payload parser 均不能构造写入授权；
- `ExpectedRecoveryBinding` 至少绑定 recovery point identity、opaque recovery asset identity、opaque native write unit identity 和写入前状态；`open` 必须把已认证 payload 与 SQLite manifest 的预期绑定逐项核对；
- payload codec 是 `SnapshotVault` 的纯内部 implementation，不新增 `SnapshotPayloadCodec` seam，也不执行文件 I/O、路径解析、符号链接跟随或恢复写入；
- native file adapter 在 capture 和 restore 两端负责规范化路径、文件身份、授权 root、权限与符号链接策略；payload 中的相对路径只是加密的恢复描述，不能替代资产身份或授权。

解密后的 plaintext framing 固定为：

| 字段 | 编码 |
|---|---|
| payload magic | 固定 8 bytes：`ACMPAYL\0` |
| payload version | big-endian `u16 = 1` |
| payload body | `postcard` 编码的不可变 `SnapshotPayloadV1` |

`SnapshotPayloadV1` 固定包含 opaque recovery asset identity、opaque native write unit identity，以及封闭的写入前状态：

- `Absent`：原生目标在 apply 重读时不存在，不携带 entries；用于恢复“创建新原生单元”的事务；
- `Present`：携带被快照的 native revision 和按 canonical 顺序排列的 `SnapshotEntryV1`。

每个 `SnapshotEntryV1` 包含：

- 从原生资产 root 起算的原始 filename component 数组；不使用绝对路径或 `/` 拼接字符串；
- 封闭 kind：`RegularFile`、`Directory` 或 `SymbolicLink`；
- adapter 规范化后的必要 POSIX permission bits；
- `RegularFile` 的原始 bytes，或 `SymbolicLink` 的原始 link target bytes；`Directory` 不携带正文。

`Absent` 必须没有 entry；`Present` 的根 entry component 数组为空且必须恰好出现一次。其他 component 不得为空、为 `.` / `..`，也不得包含 NUL 或路径分隔符。entries 按原始 component bytes 字典序排列，父路径先于后代；`SnapshotVault` 拒绝状态与 entries 不一致、完全重复路径、缺失或非目录父 entry、未知 kind、未支持文件类型和超出 snapshot policy 的 entry/count/bytes。native file adapter 另行拒绝 macOS 规范化、大小写或文件身份造成的别名。

canonical decode 固定为：

1. `SnapshotVault.open` 先按 `ARC-04b` 完整认证外层容器，并在 payload policy 上限内取得 plaintext；
2. 验证 magic/version 后，以有界反序列化读取 `SnapshotPayloadV1`；使用能够返回 remainder 的 decode 路径并要求 remainder 为空；
3. 校验 binding、`Absent` / `Present`、root、entry kind、component、顺序、重复、父子关系、权限和所有长度上限；
4. 用冻结的 V1 类型重新编码并与原 plaintext body 逐 byte 比较，拒绝非 canonical varint 或其他替代编码；
5. 仅在全部通过后返回 `RestorableSnapshot`；`FileTransaction` 仍须让 native file adapter 对实际恢复目标重新执行占用、路径、权限、符号链接和授权检查。

一旦发布，V1 的字段顺序、整数宽度、enum variant 顺序和语义不可原位修改；提交的 golden bytes 作为 schema drift guard。新 schema 使用新 payload version。应用必须保留所有仍可能被当前保留策略列为可恢复的 payload reader；未知版本或校验失败只把恢复点标为不可恢复并返回既有 `SNAPSHOT_FAILED`，不得删除 blob、猜测 schema 或部分恢复。

V1 不编码 owner、timestamp、ACL 或 extended attributes，也不启用 postcard COBS/CRC flavor，不压缩 payload。native file adapter 只有在能够证明写入与恢复不会静默破坏所需元数据时才可形成 capture plan；否则必须在原生写入前阻断，并以真实 Agent fixture 提交最小技术 Change Request，不能把 V1 的最小元数据集合解释为降低产品基线的文件权限要求。外层 AEAD 已提供完整性，额外 CRC 不提供新的信任。

L1 golden vectors 覆盖 `Absent`、单文件、完整宿主文件、多文件目录、空目录、二进制内容、可执行 mode，以及允许和阻断的 symlink fixture；负向覆盖状态与 entries 不一致、prefix/version、trailing bytes、非 canonical encoding、乱序/重复/缺父目录/非法 component、未知 kind、binding 不匹配和所有 size/count 上限。L3 只在隔离临时授权 root 中验证 capture → seal → open → restore、absent-target recovery、symlink escape 阻断和恢复目标占用；mock/L1 结果不取得真实 macOS 路径、权限或文件事务证据。

详细取舍记录见 `docs/architecture/adr/0017-versioned-postcard-snapshot-payload.md`。

#### Operation journal 与崩溃恢复

SQLite 与原生文件系统之间不存在单一跨资源事务，因此 `OperationEngine` 和 `FileTransaction` 使用持久 journal 明确协调：

1. `apply` 原子 claim 当前 prepared operation 后，先写入不含待写正文的 `accepted` journal，再触碰原生资产；
2. core 重新读取磁盘并校验全部 revision、占用和管理事实；失败则以确定终态结束，不写入；
3. `FileTransaction` 通过同目录临时文件、持久化和原子改名形成完整快照，再在 SQLite transaction 中提交 recovery manifest 与 `snapshotReady` 阶段；
4. 原生写入开始前记录 `applying`；确定成功后写入终态结果，失败则进入 `rollingBack` 并从既有恢复点回滚；
5. 启动时只对非终态 journal 执行恢复对账：以最新磁盘事实、快照状态和阶段记录完成回滚或形成确定失败结果，绝不重放用户写入意图；
6. `OperationProgressQuery` 始终读取 journal 中的权威阶段或终态；IPC 响应中断不会触发第二次 `apply`。

journal 只保存恢复与对账所需的 identity、阶段、稳定原因码、revision 摘要和不透明 handle，不保存草稿、差异、敏感明文或可重放的完整写入 payload。

#### 保留与故障处理

- 自动清理只选择已终止事务关联的最旧未固定快照，并保留每项资产最近一个有效恢复点；
- 未完成事务、正在恢复、已固定、blob 缺失或完整性未验证的条目不能被当作可清理且有效的最低恢复点；
- 清理使用 manifest 状态迁移协调文件删除，崩溃后可继续完成；不能因数据库记录先后顺序而留下“已声明可恢复但 blob 已不存在”的结果；
- SQLite 无法打开或迁移时，写入和管理变更封闭失败；派生索引可以在保留损坏数据库和既有快照目录的前提下新建并重新扫描，不得顺带删除原生资产或快照；
- 默认容量、保留周期、告警阈值、监听延迟和校准周期只在真实 fixtures 测量后确定。

#### 被否决的替代方案

- 所有内容均存入单一 SQLite，包括加密快照 BLOB：文件数更少，但大型快照会放大数据库、清理和维护成本，而且仍无法与原生文件写入形成端到端原子事务；
- 仅使用文件目录和 JSON manifest：表面依赖更少，但检索、迁移、并发 journal、原子索引 generation 和故障恢复会分散成自建数据库能力；
- 预先拆成“持久事实库 + 派生索引库”两个 SQLite：隔离更强，但当前单用户 MVP 没有足够的并发或故障证据支持第二套连接、迁移和恢复协调。

详细取舍记录见 `docs/architecture/adr/0005-hybrid-private-persistence.md`。

### 3.7 `ARC-05a`：应用更新与适配器包共用产品更新签名密钥

#### 信任链

应用更新包与官方声明式适配器包共用一套产品更新签名密钥，以减少 MVP 的密钥保管、签名作业和轮换运维：

- 产品更新私钥只存在于受保护的发布环境，不进入源码、应用包、日志或普通开发机器；
- 对应公钥编译进应用，由 Tauri Updater 验证应用更新包，并由 Rust `AdapterRegistry` 验证官方适配器包；
- Apple Developer ID 证书、Hardened Runtime 和 notarization 是 macOS 对应用可执行代码的独立信任链，不与产品更新私钥合并；
- 应用内置的适配器包仍随已签名、已 notarize 的应用交付，离线时可以作为已验证基线；
- 共用的是密钥与最小签名运维，不共用 artifact schema、安装路径、验证器或启用流程。

本选择接受一个明确代价：产品更新私钥泄漏会同时影响应用更新包和适配器包。CI 权限隔离只能减少误用机会，不能把同一私钥重新变成两个独立信任域。

#### Artifact domain separation

共用密钥不得允许跨类型替换。两条验证路径使用不同且不可省略的签名 domain：

```text
application update:
  Tauri Updater 固定签名协议及 application update artifact

adapter package:
  "agent-config-manager/adapter-package/v1"
  + canonical manifest
  + archive digest
```

- 适配器签名覆盖固定 domain、canonical manifest 和完整 archive digest，验证成功后才允许解包或解析声明式正文；
- manifest 必须封闭声明 artifact 类型、格式版本、package identity 与版本、应用/引擎兼容范围、Agent 兼容范围、原生结构与规则版本、所需引擎能力，以及每个文件的路径、大小和 digest；
- 应用更新验证器只接受 Tauri application update artifact；适配器验证器只接受 `adapter-package/v1`；
- 同一签名、公钥或下载地址不能替代 artifact 类型判断；
- 必须有双向负向向量：有效应用更新包不能作为适配器包通过，反之亦然；
- artifact 类型未知、domain 不匹配、manifest 非 canonical、digest 不符、缺少字段或存在额外未声明文件时封闭失败。

签名输入、canonical encoding、archive profile 与签名工具已经由 `ARC-05d` 固定；它们封装在 `AdapterBundleVerifier`，不得改变上述 domain separation 或让 `AdapterRegistry` 直接依赖 JCS/TAR 细节。

#### 下载、候选与启用边界

- 更新检查只访问配置的官方 HTTPS 来源；WebView 不取得任意下载、文件写入或签名验证权限；
- Rust 侧先把候选 artifact 写入隔离临时位置并执行大小上限、签名、完整性和兼容性检查；
- 解包拒绝绝对路径、父目录穿越、符号链接、硬链接、设备文件、未声明文件和可执行内容；
- 只有封闭声明式 Schema、能力矩阵、路径定义、模板、受限转换规则与验证 fixtures 可以进入候选槽位；
- 候选包继续执行产品基线要求的固定样例、黄金结果、幂等性和失败隔离回归；只有通过且用户确认后，`AdapterRegistry` 才能原子切换 active package；
- 下载、校验、回归或启用失败均保留当前 active package；上一可用版本继续保留；
- active/candidate/previous 的物理粒度已由 `ARC-05b` 确定为完整统一 compatibility bundle。

#### 版本、回滚与密钥轮换

- 正常更新只接受与当前应用引擎兼容且版本不低于当前 active package 的候选；
- 降级只能通过已确认的 `rollbackAdapterPackage` 回到本机记录的 previous package，不能通过重放旧下载清单触发；
- 每次操作结果记录应用引擎、package、Schema、能力矩阵、规则和模板的准确版本；
- 应用升级后，`AdapterRegistry` 只启用与新引擎兼容的 active/previous package；均不兼容时退回应用内置的已验证版本，不加载不兼容候选；
- 计划内密钥轮换必须先发布一个由旧私钥签名、同时内置下一公钥的应用版本，经过迁移窗口后再切换签名；
- MVP 不增加在线 root、阈值签名或远程撤销服务。私钥丢失或紧急泄漏可能需要发布人工重新安装的可信应用，这是选择最小运维方案后接受的恢复限制。

#### 测试 surface

- Tauri application updater 使用官方签名验证，并保留篡改、错误签名和不兼容版本测试；
- `AdapterRegistry` 的 package verification interface 覆盖正确包、正文篡改、manifest 篡改、路径穿越、额外文件、可执行内容、兼容范围失败和回归失败；
- 共享公钥 fixture 必须覆盖 application/adapter 双向跨 domain 拒绝；
- active、candidate、previous 和 built-in 选择通过 `AdapterRegistry` interface 断言，不以目录或 SQLite 内部状态作为主要测试 surface；
- 发布验证必须证明私钥未进入 artifact、仓库、日志和测试 fixture。

#### 被否决的替代方案

- 应用更新与适配器包使用独立密钥：泄漏隔离更强，但增加第二套生成、保管、轮换和应急流程；
- 使用多角色离线 root 与 delegated targets：轮换和回滚保护最强，但为当前单产品、单官方渠道引入阈值密钥、过期元数据和额外发布服务。

详细取舍记录见 `docs/architecture/adr/0006-shared-product-update-key.md`。

### 3.8 `ARC-05b`：四个 Agent 使用一个统一 compatibility bundle

#### Bundle 粒度与内容

Claude Code、Codex、Gemini CLI 和 OpenCode 的声明式定义作为一个不可变官方 compatibility bundle 发布：

- bundle 只有一个 package identity、一个单调可比较的 package version，以及一组应用/引擎兼容范围；
- manifest 内分别记录四个 Agent 的 adapter version、Agent 兼容范围、原生结构版本、Schema、能力矩阵、规则和模板版本；
- 某次发布可以只改变一个 Agent 的声明式内容，但必须提升整个 bundle version，并重新验证完整 bundle；
- package 只包含产品基线允许的声明式内容和验证 fixtures，不包含脚本、动态库、Wasm、解释器输入或其他可执行扩展；
- 可以在同一 bundle 内组织不可独立发布的共享声明，但不建立共享包与 Agent 子包之间的依赖图；
- 应用内置版本、下载的 active、candidate 和 previous 都使用相同 bundle schema 与验证路径。

签名继续覆盖 `ARC-05a` 定义的固定 domain、整个 canonical manifest 和 archive digest；不能只签发生变化的 Agent 子目录。

#### 物理槽位与权威状态

逻辑布局为：

```text
Application bundle/
  built-in compatibility bundle

Application Support/<application-id>/
  adapter-packages/
    staging/<opaque-operation-id>/
    versions/<opaque-package-version>/

state.sqlite
  active package pointer
  candidate package state
  previous package pointer
  validation and operation result
```

- 下载的 manifest、TAR 与 detached signature 三件套先进入 staging；签名、完整性、兼容性、安全展开和回归验证全部通过后，才形成不可变 version directory；
- version directory 名称与内部路径不能替代 package identity；SQLite 中经过验证的 pointer 才是 `AdapterRegistry` 的选择事实；
- bundle 正文不写入 SQLite；数据库只保存不透明位置 handle、版本、验证摘要和 active/candidate/previous 状态；
- built-in bundle 随应用只读提供，始终是最终兼容 fallback，不参与自动清理；
- active 和 previous 必须引用完整、已验证且未被修改的不可变 bundle；启动时重新检查 identity、manifest digest 和文件完整性；
- 除 built-in、active、candidate、previous 及仍被非终态 operation 引用的版本外，旧 bundle 才允许安全清理。

archive 格式、manifest encoding、目录名称与 detached signature 已由 `ARC-05d` 固定；不得改变单 bundle 的切换粒度。

#### 候选验证与原子启用

候选 bundle 必须作为整体通过：

1. `ARC-05a` 的来源、domain、签名与 archive 完整性验证；
2. manifest 完整性、应用/引擎兼容范围及四个 Agent 兼容范围验证；
3. 应用内置的不可变 conformance/golden fixtures；
4. bundle 声明的附加 fixtures、全矩阵、幂等性与失败隔离回归；
5. 安装前向用户展示 package version、四个 Agent 的兼容和规则变化，并取得明确确认。

任一 Agent 或任一必须回归项失败，整个 candidate 不可启用。`updateAdapterPackage` apply 在一个 SQLite transaction 中：

- 再次核对 management revision、candidate digest 和验证结果；
- 将当前 active 赋给 previous；
- 将 candidate 设为新的 active；
- 清除 candidate pointer 并记录确切版本结果。

切换不修改任何 Agent 原生资产，也不混用新旧 bundle。`AdapterRegistry` 对一次 read、prepare、apply 或索引解析只发放一个不可变 bundle handle；package pointer 变化会使相关 snapshot、索引投影和未应用 prepared operation 失效，后者必须重新 prepare。

#### 回滚与溯源

- `rollbackAdapterPackage` 只允许把本机已验证 previous bundle 原子切回 active，并把被替换版本保留为新的 previous，形成可逆的一步切换；
- 回滚不重新下载、不跳过签名或兼容检查，也不修改原生资产；
- 若 previous 与当前应用引擎不兼容，则回滚被阻断；`AdapterRegistry` 仍可选择兼容的 built-in bundle；
- 每次解析、转换、校验和写入结果记录 package identity/version，以及实际参与的源、目标 Agent adapter version 和 Schema/能力/规则/模板版本；
- 因为四个 Agent 共用切换粒度，回滚一个 Agent 的问题会同时回退其他三个 Agent 的声明式定义，这是本选择接受的运维取舍。

#### 测试 surface

- `AdapterRegistry` interface 覆盖 built-in、active、candidate、previous 的确定选择；
- 同一个 conformance suite 对 bundle 内四个 `AgentAdapter` 运行，不为 package 目录结构编写主要行为断言；
- 候选验证覆盖“一个 Agent 失败则整个 bundle 不启用”、切换中断、SQLite commit 失败、version directory 被篡改和 previous 不兼容；
- 跨 Agent 转换断言同一个 package version 及源、目标各自 adapter version，不能只记录笼统的“最新规则”；
- 更新或回滚后重新读取的 `ManagementSnapshot` 与 operation result 必须回显准确 bundle 事实。

#### 被否决的替代方案

- 每个 Agent 独立 package：局部更新和回滚影响更小，但需要四套 active/candidate/previous 状态，并让跨 Agent 转换同时协调两个 package generation；
- 共享基础包加四个 Agent 子包：复用更显式，但引入依赖解析、兼容矩阵和多包原子启用，与当前四个固定 Agent 的 MVP 不匹配。

详细取舍记录见 `docs/architecture/adr/0007-unified-adapter-bundle.md`。

### 3.9 `ARC-05d`：JCS manifest + 确定性无压缩 USTAR + Tauri signer-compatible detached signature

#### Artifact set 与 canonical manifest

每个不可变 package version 发布且只发布三个同版本 artifact：

```text
adapters/<package-version>/
  bundle.manifest.json
  bundle.tar
  bundle.sig
```

`adapters/latest.json` 只定位这三个 URL；文件名、URL、HTTP metadata 与 feed 中的版本提示都不能替代 signed manifest 的 package identity，也不能授权候选启用。

`bundle.manifest.json` 是 UTF-8 编码的 RFC 8785 JCS bytes，使用封闭的 `AdapterManifestV1`：

| 分组 | V1 字段 |
|---|---|
| artifact | `artifactType`、`formatVersion` |
| package | `package.packageId`、`package.packageVersion` |
| compatibility | `compatibility.applicationVersionRange`、`compatibility.engineVersionRange`、`compatibility.requiredEngineCapabilities` |
| agents | `agents[].agentId`、`adapterVersion`、`agentVersionRange`、`nativeStructureVersion`、`schemaVersion`、`capabilityMatrixVersion`、`ruleVersion`、`templateVersion` |
| archive | `archive.profile`、`archive.sizeBytes`、`archive.sha256` |
| files | `files[].path`、`role`、`sizeBytes`、`sha256` |

V1 canonical rules 固定为：

- `artifactType` 固定为 `agent-config-manager/official-adapter-bundle`，`formatVersion` 固定为字符串 `"1"`，`archive.profile` 固定为 `acm-adapter-ustar-v1`；
- 输入必须严格按 RFC 8785 canonicalize；strict parse 后重新 canonicalize 的 bytes 必须与原文件逐 byte 相同；
- 禁止 BOM、trailing newline、无意义空白、重复 member、未知或缺失字段，以及无法由 V1 typed schema 表达的值；
- V1 不使用任何 JSON number token；格式版本、byte count 和其他数值都使用受 schema 约束、除 `"0"` 外无前导零的 canonical 十进制字符串，避免 IEEE-754/JCS 安全整数歧义；
- version/range、identity、capability token、path、role 与 hash 使用受限 ASCII；hash 固定为 64 位 lowercase hexadecimal SHA-256；
- file role 是封闭 enum：`schema`、`capability-matrix`、`path-definition`、`template`、`conversion-rule` 或 `fixture`；
- 四个 Agent 以 `claude-code`、`codex`、`gemini-cli`、`opencode` 的固定顺序各出现一次；capability tokens 去重后按 byte order 排列；`files` 按 path byte order 严格升序且不得重复；
- manifest 不包含发布时间、release notes、URL 或其他会破坏重现性且不参与候选事实的字段。

普通 `serde_json` 输出、pretty JSON、字段插入顺序或文件系统遍历顺序都不是 canonical contract。实现必须通过 RFC 8785 vectors 和项目自己的 golden bytes；具体 Rust crate 只属于深模块 implementation，并由后续 `Cargo.lock` 固定，不成为跨模块 interface。

#### 确定性无压缩 USTAR profile

`bundle.tar` 使用项目限定的 `acm-adapter-ustar-v1` profile：

- archive 不压缩；manifest 与 signature 均位于 TAR 外部，避免 digest 循环；
- TAR 只包含 manifest 声明的 regular file entries，不包含显式 directory entries；
- 内容根只允许 `agents/claude-code/`、`agents/codex/`、`agents/gemini-cli/`、`agents/opencode/`、`shared/` 与 `fixtures/`；
- entry path 使用 `/` 分隔的 lowercase ASCII relative components；每个 component 必须匹配 `[a-z0-9][a-z0-9._-]*`，完整 path 不超过 100 ASCII bytes 且 USTAR prefix field 必须为空，并拒绝绝对路径、空 component、`.`、`..`、反斜杠或 NUL；
- entry 顺序与 manifest `files` 顺序完全一致；每个 entry 的 size 与 SHA-256 必须与 manifest 完全一致；
- typeflag 只允许 regular file；mode 固定 `0644`；`uid`、`gid`、`mtime` 固定为 `0`；`uname`、`gname` 为空；
- 每个 raw 512-byte header 必须与下述 V1 canonical header bytes 相同，entry body 的 512-byte alignment padding 必须全为零；
- 禁止 symlink、hardlink、device、FIFO、sparse、PAX、GNU extension、xattr、ACL、setuid/setgid 与 executable mode；
- archive 以正好两个 512-byte zero blocks 结束，不接受额外 entry 或 trailing bytes。

V1 header 先初始化为 512 个 `0x00`，再按下表写入；表中的 `\0` 表示单个 `0x00`，`NUL × n` 表示 n 个 `0x00`。除 size 和 checksum 外，不允许 writer 选择其他合法 USTAR 表示：

| byte offset | length | field | canonical bytes |
|---:|---:|---|---|
| 0 | 100 | name | exact ASCII path bytes，随后 `NUL × (100 - pathByteLength)`；100-byte path 无 terminator |
| 100 | 8 | mode | ASCII `0000644\0` |
| 108 | 8 | uid | ASCII `0000000\0` |
| 116 | 8 | gid | ASCII `0000000\0` |
| 124 | 12 | size | actual file byte length 的 11 位、左侧补零 lowercase ASCII octal，随后 `\0`；只允许 `0..=0o77777777777` |
| 136 | 12 | mtime | ASCII `00000000000\0` |
| 148 | 8 | checksum | 按下述算法生成的 6 位、左侧补零 lowercase ASCII octal，随后 `0x00 0x20` |
| 156 | 1 | typeflag | ASCII `0`（`0x30`） |
| 157 | 100 | linkname | `NUL × 100` |
| 257 | 6 | magic | ASCII `ustar`，随后 `0x00` |
| 263 | 2 | version | ASCII `00` |
| 265 | 32 | uname | `NUL × 32` |
| 297 | 32 | gname | `NUL × 32` |
| 329 | 8 | devmajor | ASCII `0000000\0` |
| 337 | 8 | devminor | ASCII `0000000\0` |
| 345 | 155 | prefix | `NUL × 155` |
| 500 | 12 | pad | `NUL × 12` |

checksum 计算固定为：先把 bytes `148..156` 全部视为 ASCII space `0x20`，再把完整 512-byte header 的每个 byte 当作 unsigned 8-bit integer 求和；结果必须可由 6 位 octal 表示，写入 bytes `148..154`，byte `154` 写 `0x00`，byte `155` 写 `0x20`。所有其他 numeric encoding（包括 base-256）、regular-file NUL typeflag、不同 checksum terminator 或非零 unused bytes 都不是 V1。验证器必须由 manifest path 与 size 独立重建这 512 bytes 并逐 byte 比较，不能把任意 TAR library 的“可解析”结果当作 profile 合格。

发布作业必须从声明文件集合显式构造 header，不能直接继承本地文件 owner、time、mode 或遍历顺序；相同输入连续构建两次必须得到相同 manifest bytes、TAR bytes 和 TAR SHA-256。Tauri-compatible `.sig` 可以包含 signer metadata，不要求 byte-identical，只要求对同一签名输入有效。

首个真实四 Agent bundle 若无法满足 USTAR path/profile，只能提交最小架构 Change Request；实现不得静默启用 PAX/GNU long-name、ZIP 或压缩。

#### Detached signature framing

release job 先生成 TAR 并计算完整 TAR bytes 的 SHA-256，再生成 JCS manifest。随后构造唯一签名输入：

```text
u32be(domain byte length)
|| UTF8("agent-config-manager/adapter-package/v1")
|| u64be(manifest byte length)
|| exact bundle.manifest.json bytes
|| u32be(32)
|| raw 32-byte SHA-256(bundle.tar)
```

`bundle.manifest.json` 的 `archive.sha256` 与 `archive.sizeBytes` 必须等于实际 TAR；digest 同时出现在 signed manifest 和 framing 尾部是有意的 fail-closed 一致性检查。

受保护发布环境把上述 signing input 写入短生命周期临时文件，并使用与 Tauri application updater 完全相同的产品私钥和 Tauri CLI `signer sign` 命令生成 detached output，发布时重命名为 `bundle.sig`。签名输入临时文件不发布、不持久化。runtime 使用编译入应用、也供 Tauri updater 使用的同一公钥和 Tauri signer-compatible signature semantics 验证 exact bytes：

- 复用 key material、key format 与 signer toolchain，不复用 Tauri application updater artifact/container 或安装验证器；
- adapter verifier 必须固定自己的 domain、manifest schema 和 archive profile；
- 不引入第二密钥、自定义签名算法、在线 root 或新的签名服务；
- 具体 signature crate/API 跟随项目锁定的 Tauri 2 toolchain，并由真实 CLI integration vector 证明兼容，不把 upstream 当前实现细节扩散为业务契约。

#### 深模块与验证顺序

JCS、signature framing、TAR parsing 与安全 staging 收口在一个深 `AdapterBundleVerifier`：

```text
AdapterBundleVerifier
  verifyAndStage(
    DownloadedAdapterArtifacts,
    FreshStagingRoot
  ) -> VerifiedBundleCandidate
```

`AdapterRegistry` 只接收 package facts、verification summary 和不透明的 immutable content handle；它不解析 JCS、不迭代 TAR header，也不持有 signature library 类型。JCS codec、TAR reader 和 signature primitive 当前都只有一个真实实现，不为单元测试额外制造 public seam；测试给同一 verifier 注入测试公钥和临时 staging root。

验证按以下顺序封闭失败：

1. Rust downloader 对三个 artifact 执行 allowlisted HTTPS、响应与累计 byte 上限，并写入原子创建、权限为 `0700`、名称不透明且无预存 component 的 fresh isolated staging；WebView 不接触下载内容；
2. streaming 计算 exact TAR bytes 的 SHA-256，并用 raw manifest bytes、固定 domain 和该 digest 重建 signing input；
3. 使用内置产品更新公钥验证 `bundle.sig`；在此之前不解包 TAR，也不解析任何声明式正文；
4. strict parse manifest、执行 JCS byte equality、closed schema、artifact、archive digest/size、版本、兼容范围与 capability 检查；
5. 逐 entry 读取 TAR raw header；先验证 profile、path、顺序、type、size 和 manifest membership，再把 regular file bytes 写入 fresh `content/`，同时校验 file digest；
6. verifier 只通过 native file safety path 使用 `create_new`/no-follow 语义创建受限父目录和文件；不得调用通用 `Archive::unpack`、`Entry::unpack` 或覆盖既有路径；
7. 精确确认无 missing/extra entry、无 trailing bytes，再运行四 Agent Schema、全矩阵、golden、幂等性与失败隔离回归；
8. 全部通过后形成 `VerifiedBundleCandidate`；`AdapterRegistry` 才可按 `ARC-05b` 记录 candidate，并在用户确认后原子切换。

promotion 后的 immutable version directory 固定保存 `bundle.manifest.json`、`bundle.sig` 与 `content/`；raw TAR 可以在 verification journal 进入终态且目录完成 fsync/rename 后删除。启动和使用前以 manifest 中已签名的 `archive.sha256` 重建 framing 并重新验证 signature，再核对 manifest identity 及 `content/` 的完整 file table；本地目录名、SQLite pointer 或旧验证结果不能替代这些检查。

built-in bundle 也由同一三件套和 verifier pipeline 生成；应用只嵌入通过验证后的 manifest、signature 与 immutable `content/`，runtime 与 active/previous 使用同一 signature 和 file-table 复验路径，不建立“内置即跳过验证”的旁路。

内部 verifier finding 保持 typed 且可精确测试，但不得扩展前端契约原因码：domain/manifest/canonical/signature/archive profile/file integrity 失败统一归一化为 `ADAPTER_SIGNATURE_INVALID`，应用/引擎/Agent/capability 不兼容归一化为 `ADAPTER_COMPATIBILITY_MISMATCH`，声明式 Schema 或 conformance/golden 回归失败归一化为 `ADAPTER_REGRESSION_FAILED`。下载 transport fault 继续走既有 gateway fault 归一化；不得把内部异常字符串、原生路径或 package 内容暴露给 UI。

#### 测试与证据边界

- L0/L1：RFC 8785 vectors、manifest golden bytes、framing golden bytes、相同输入双构建同 digest，以及 domain/length collision 负向向量；
- L0/L1 负向：duplicate/unknown fields、number token、非 canonical bytes、错误 key/signature、manifest/TAR 篡改、application/adapter 跨 domain、unsafe path、乱序/重复/missing/extra file、PAX/GNU/link/device/sparse、错误 metadata、digest/size 和 trailing bytes；
- L3：使用 synthetic candidate 运行 download artifact → verifier → regression → candidate → active/previous/rollback，不取得 production artifact 或官方签名来源证据；
- L4：锁定版本的真实 Tauri CLI 生成/签名 integration fixture，以及实际 production bundle 从静态 origin 下载、验证和启用，才可以取得 `RELEASE-GATE` credit。

本轮只是固定 protocol 与责任边界，所有命令仍为 `planned / unverified`；没有真实 artifact、锁定 toolchain 或 runtime evidence。

#### 被否决的替代方案

- ZIP + 压缩 + manifest：生态常见，但引入压缩 feature、平台 metadata、duplicate/path alias 和更大的 extraction surface；
- 单一 postcard bundle：适合应用私有快照，却不适合人工检查、独立发布与跨工具生成的官方声明式 package；
- 签名只覆盖 TAR 或只覆盖 manifest：无法同时把 package facts、完整 file table 与 exact archive bytes 绑定到一个 domain-separated artifact。

详细取舍记录见 `docs/architecture/adr/0018-jcs-ustar-adapter-bundle.md`。

### 3.10 `ARC-05c`：直接分发 + 单 stable 静态 HTTPS feed

#### 分发与 feed 拓扑

MVP 只维护一条 macOS 直接分发链路和一个 stable channel：

```text
official HTTPS static origin
  app/
    latest.json
    <version>/darwin-aarch64/installer.dmg
    <version>/darwin-aarch64/signed updater archive (.app.tar.gz)
    <version>/darwin-aarch64/updater detached signature (.app.tar.gz.sig)
  adapters/
    latest.json
    <package-version>/bundle.manifest.json
    <package-version>/bundle.tar
    <package-version>/bundle.sig
```

- 初次安装产物为 Developer ID 签名、启用 Hardened Runtime、完成 Apple notarization 并 staple ticket 的 macOS DMG；
- 发布流水线同时生成 Tauri application updater artifact、签名和静态 `latest.json`；
- `latest.json.platforms.darwin-aarch64` 的 `url` 指向不可变 updater archive，`signature` 必须内联对应 `.sig` 文件的 exact text content；独立 versioned `.sig` 只用于发布审计和重建 manifest，不能以路径或 URL 代替 inline signature；
- adapter feed 发布 `ARC-05d` 的 JCS manifest、无压缩 TAR 与 domain-separated detached signature，以及独立静态 `latest.json`；
- app 与 adapter 可以位于同一官方 HTTPS origin，但必须使用不同路径、manifest schema、artifact domain 和验证器；
- artifact 使用不可变、带版本的 URL；先上传并验证全部 versioned artifact，最后更新对应 `latest.json`；
- feed hosting provider、域名、对象存储或 CDN 产品不在架构层冻结，且不需要运行数据库、应用服务器或用户账户系统。

Mac App Store、双渠道发行、preview/beta channel、灰度发布、按设备选择版本、遥测、远程 kill switch 和服务端回退均不进入 MVP。若未来引入 Mac App Store，必须重新评估 App Sandbox、目录授权、应用更新信任链和双包发布运维。

#### Feed 与签名的事实边界

- 静态 feed 只提供“可能存在新版本”的 locator 和展示元数据，不能授权安装或改变 active package；
- Tauri updater artifact 必须通过内置产品更新公钥验证；adapter archive 必须通过 `adapter-package/v1` domain、canonical manifest 和 archive digest 验证；
- adapter feed 中的 release notes 始终只是非权威展示 metadata；兼容、能力和规则变化必须在下载验证后，由 current 与 candidate 的 signed manifest/content 计算，不能直接信任 feed 文案；
- HTTPS、host allowlist、响应大小上限、超时和重定向策略在 Rust 下载路径统一执行，WebView 不直接请求 feed；
- 正常更新只接受更高且兼容的版本；静态 feed 回放旧版本最多造成“没有更新”，不能触发降级；
- adapter 降级仍只能由用户对本机 previous bundle 发起显式回滚；应用不提供远程降级；
- feed 不可用、JSON 不合法、artifact 缺失或任一验证失败时继续使用当前应用和 active/built-in bundle，不改变原生资产。

本方案接受静态 feed 无法阻止 availability freeze 的限制：来源或缓存持续返回旧但有效的 manifest 时，客户端可能暂时看不到新版本，但不会安装未签名或更旧版本。

#### 产品范围边界

产品基线和前端契约已经定义 adapter 自动检查、变化展示、用户确认、候选验证、启用与回滚，因此 adapter feed 在 MVP 运行时启用，但：

- 自动检查不等于自动安装；
- 下载后的 candidate 未经回归和用户确认不能成为 active；
- FE-08 继续是唯一 adapter 更新 UI 票据，不新增第二套发布界面。

现有产品基线与前端契约没有定义应用自身的更新检查、提示、下载、安装或重启交互。本技术决策只要求发布流水线生成并验证 Tauri updater artifact 与静态 app manifest，不授权 MVP 前端或后台启用应用自更新。若要启用，必须先提交最小产品与前端契约 Change Request，并明确 UI、失败恢复和重启行为。

#### 最小发布顺序

应用 release candidate 按以下顺序完成：

1. 在受控 macOS runner 只为 `aarch64-apple-darwin` 构建 app artifact，并固定最低部署版本为 macOS `15.0`；
2. 对 app bundle 及其 nested native code 执行 Developer ID code signing 和 Hardened Runtime 校验；
3. 生成最终 DMG，按 Apple 支持的对象提交 notarization、检查 notary log，并对最终 DMG staple ticket；
4. 生成 updater `.app.tar.gz` 及其 Tauri updater `.sig`，验证 archive bytes 的产品更新签名，并把 `.sig` exact text content 内联到 `latest.json.platforms.darwin-aarch64.signature`；
5. 按 `ARC-05e` 的逐 artifact matrix 验证最终 DMG、archive 内 app、updater signature 与 static manifest；
6. 上传不可变 versioned artifact；
7. 最后发布或替换 stable `app/latest.json`。

adapter bundle 使用独立作业，但复用 `ARC-05a` 的产品更新私钥：

1. 构建统一声明式文件集合和确定性无压缩 TAR，重复构建并核对 byte-identical digest；
2. 生成 RFC 8785 JCS manifest 和固定 domain-separated signing input；
3. 使用 Tauri CLI `signer sign` 生成 detached signature，并通过 runtime `AdapterBundleVerifier` 独立验证；
4. 运行 schema、全矩阵、黄金结果、幂等性、失败隔离、archive safety 和可执行内容负向检查；
5. 上传三个不可变 versioned artifact；
6. 最后发布或替换 stable `adapters/latest.json`。

任一步失败均不得推进 latest manifest。发布密钥、Developer ID 凭证和 notarization 凭证按作业最小暴露，不能进入产物或日志。

#### 发布验证 surface

- app artifact 验证 Developer ID 签名、Hardened Runtime、notarization ticket、干净机器首次启动和 Tauri updater 签名；
- adapter artifact 验证共享公钥、domain separation、manifest/archive 完整性、全矩阵和 active/previous 原子切换；
- 静态 origin 验证 HTTPS、allowlisted host、不可变 artifact、manifest-last 顺序、缺失/损坏/旧 manifest 的封闭失败；
- 离线启动验证内置 bundle 可用，feed 故障不影响当前 active bundle；
- 以上在实现前仅是验证命令契约，必须等真实 artifact 实际运行后才能获得 `RELEASE-GATE` credit。

具体 CI provider 和托管 provider 不在架构层冻结；supported macOS/CPU 与 app artifact matrix 已由 `ARC-05e` 固定，adapter artifact 文件名与 framing 已由 `ARC-05d` 固定。可执行验证命令已经由 `ARC-06c` 固定，但在真实 artifact 与 bootstrap 出现前仍为 `planned / unverified`。

#### 被否决的替代方案

- 静态 artifact 加轻量动态版本选择 endpoint：可以暂停或定向版本，但增加长期在线服务、部署、监控和故障面；
- 完整多 channel 发布平台：支持灰度、遥测和远程回退，但引入当前 MVP 没有依据的账户、隐私和服务端状态；
- Mac App Store 或双渠道：由 Apple 管理分发，但要求独立 sandbox、签名、审核和更新路径，并破坏当前单一直接分发运维。

详细取舍记录见 `docs/architecture/adr/0008-static-release-feed.md`。

### 3.11 `ARC-05e`：macOS 15.0+、Apple Silicon arm64-only

#### 支持与 artifact matrix

MVP 的发布支持边界固定为：

| 维度 | 唯一支持值 |
|---|---|
| 最低系统版本 | macOS `15.0` |
| CPU 架构 | Apple Silicon `arm64` |
| Rust/Tauri target | `aarch64-apple-darwin` |
| 初次安装 | 一个 arm64 DMG |
| updater platform key | `darwin-aarch64` |
| updater artifact | 每个应用版本一个 arm64 updater artifact 及其 signature |

- Tauri 配置固定 `bundle.macOS.minimumSystemVersion = "15.0"`；所有随应用分发的 native code 与 framework 都不得声明更低或更高且不一致的 deployment target；
- release build 与 package 命令只生成 `aarch64-apple-darwin`。不安装或构建 `x86_64-apple-darwin`，不生成 universal binary，也不发布 `darwin-x86_64` 或自定义 universal updater target；
- `app/latest.json` 的 `platforms` 只包含 `darwin-aarch64`；该 entry 的 `signature` 是 `.app.tar.gz.sig` 的 exact text content，不是 URL。单 stable feed 不做 CPU 探测、设备分流或 fallback；
- DMG、updater artifact、signature、notarization、stapling 与回滚都只有一个应用架构轨。`ARC-05d` 的 adapter bundle 是声明式数据，继续架构无关，不复制为 CPU-specific package；
- macOS 14、Intel Mac、Windows 与 Linux 不属于 MVP 支持范围。应用不提供这些环境的安装入口、兼容承诺或 release test matrix。

#### 构建与发布验证

- `verify:toolchain` 必须确认 host 是 macOS、Rust 已安装 `aarch64-apple-darwin` target、Tauri 最低系统配置为 `15.0`，并拒绝 release 配置中出现 x86_64/universal target；
- `build:app`、`package:macos` 与 `verify:release` 的 production path 不接受调用方切换 CPU target；局部诊断命令不能取得 release evidence；
- L4 必须按下表区分 Apple distribution verification、Tauri updater verification 和 feed verification，不能对不支持的对象执行 notarization 或 stapling：

| Artifact | 必须验证 | 明确不适用 |
|---|---|---|
| 最终 DMG 与其内 `.app` | DMG notarization/staple 与 Gatekeeper；`.app`、nested native code 的 Developer ID、Hardened Runtime、arm64-only 和 macOS 15.0 deployment target | Tauri updater signature |
| updater `.app.tar.gz` | archive bytes 的 Tauri updater signature；解包后 `.app` 的 Developer ID、Hardened Runtime、arm64-only、deployment target 与 notarization validity | 对 `.tar.gz` 自身执行 Apple stapling |
| `.app.tar.gz.sig` | 使用内置产品更新公钥验证对应 archive；exact text 与 `latest.json` inline signature 相同 | Developer ID、Hardened Runtime、Apple notarization/stapling |
| `latest.json` | strict static schema；唯一 `darwin-aarch64` entry；不可变 archive URL；inline signature exact match；manifest-last | 把 signature 写成路径或 URL；把 manifest 当成安装授权 |

- 安装和启动至少在一台干净的 Apple Silicon macOS `15.0.x` 环境以及发布时当前 stable macOS 的 Apple Silicon 环境实际运行，并记录 exact OS patch、hardware/VM identity 与 artifact digest。任一环境缺失或结果不确定均使 `RELEASE-GATE` 为 `inconclusive`；
- 本节只冻结未来验证矩阵。当前没有 production artifact 或实际 release run，不产生 L4 evidence。

选择 arm64-only 是有意接受的覆盖代价，用来避免双 CPU build、签名、公证、更新、回滚和 QA 矩阵。若未来产品要支持 Intel、macOS 14 或 universal binary，必须先更新产品范围和本 ADR；实现代理不得仅添加 target 或 feed entry。

详细取舍记录见 `docs/architecture/adr/0019-macos-15-arm64-only.md`。

### 3.12 `ARC-06a`：framework-neutral 深 `WorkspaceSession`

#### Interface 与依赖方向

前端使用一个与 React、Tauri 和具体控件无关的 `WorkspaceSession` module：

```text
WorkspaceSession
  getSnapshot() -> WorkspaceViewState
  dispatch(WorkspaceAction) -> void
  subscribe(listener) -> unsubscribe
  dispose() -> void
```

- 构造时注入唯一 `FrontendGateway` adapter；module 内不导入 Tauri、React、编辑器或浏览器存储；
- `WorkspaceAction` 是封闭的用户动作 union，不接受通用字符串 command、callback action 或任意 payload；
- `WorkspaceViewState` 是只读、可判别的 UI state，不暴露内部 promise、abort controller、gateway cache 或 effect queue；
- React 根部只创建一个 session，通过 Context 提供实例，并使用 React 内置 external-store 订阅能力读取 snapshot；
- 页面、列表、检查器和 workflow surface 不直接维护第二套资产事实或活动草稿；
- `WorkspaceSession` 是前端内部 module，不替代 `FrontendGateway` 外部 seam，也不新增产品契约。

MVP 不引入 Zustand、Redux、TanStack Query、XState 或其他通用状态/查询库。实现只能在对应 tracer-bullet 票据中按用户行为纵向增长，不创建独立“状态层”横向票据。

#### 状态分层

session 内部保持四类明确分离的状态：

| 状态组 | 内容 | 权威与生命周期 |
|---|---|---|
| Gateway facts | 当前 list/detail/file/management/progress snapshot、revision、加载与失败状态 | 只来自成功 `read`；事件和本地推断不能修改 |
| Local draft | 当前单一资产的跨文件草稿、dirty、目标选择与已解决覆盖选择 | 只存在当前前端会话；放弃或完成后清除 |
| Workflow | viewing、editing、discardConfirm、reviewing、confirming、applying、conflict、reprepareRequired、result 等封闭 union | 严格实现前端契约迁移，避免互相矛盾的布尔组合 |
| View state | 一级类型、搜索、筛选、显式分组、当前文件/视图、检查器和文件树展开、差异折叠、焦点与收拢 | 不授权写入；除已确认栏宽外不跨会话持久化 |

Gateway facts 和 local draft 不合并为一个可写对象。源码/结构化视图与多文件编辑都投影同一个 `AssetDraft`；编辑器自己的光标、selection、IME 和 undo buffer 可以保留在 editor adapter 内，但可审查的草稿内容和 dirty 状态必须回到 session。

prepared operation、concurrency token 和 diff 只存在于对应 workflow variant；离开 review/confirm、收到 `REPREPARE_REQUIRED`、package generation 变化或明确放弃后不能被其他状态继续引用。

#### 异步与失效规则

- session 先建立 `observe` listener，再执行初始 `read`；
- 每个 read/prepare/apply effect 都绑定 session generation、query identity 和发起上下文；响应只在这些事实仍匹配时提交；
- 切换资产、文件、搜索范围或 workflow 后到达的旧响应必须丢弃，不能覆盖较新 snapshot 或草稿；
- workspace event 只把受影响 query 标记为 invalidated 并安排重读；重复、乱序或丢失事件最多造成额外 read；
- 外部 revision 变化可以刷新 gateway facts，但不能覆盖 dirty draft；
- `PrepareFailed` 保留发起前草稿、目标和 workflow 上下文，不伪造 review；
- `apply` 只在 confirming 后派发一次；调用结果不确定时保持 applying，通过 `OperationProgressQuery` 对账，绝不自动重发；
- 同时只允许一个活动 draft、prepared operation 或 apply effect；
- `dispose` 解除 observe、取消尚未提交的读取，并阻止后续异步结果写入已销毁 session。

session 可以在内存中保留当前工作区所需的最近 gateway snapshot，但不把它当作跨会话缓存；应用重启后重新从 gateway 读取。

#### 敏感明文与偏好存储

`SensitiveRevealSnapshot` 不能进入 `WorkspaceViewState`、session 历史、调试输出或通用 effect cache。显式查看或修改由一个短生命周期 `SensitiveRevealLease` helper 直接通过已注入 gateway 请求，并只把结果交给当前可见 surface：

- asset/file/revision、surface 或 scope 变化立即释放；
- TTL 到期后释放并恢复遮蔽；
- helper 不提供持久化、重放、全局选择器或开发工具记录；
- 前端无法保证 JavaScript 字符串可靠清零，因此只最小化范围和生命周期，并把该限制保留为残余风险。

只有产品基线明确要求跨会话记忆的“按资产类型栏宽”写入版本化 `WorkspacePreferences`。该小 module 有浏览器本地存储 adapter 和测试内存 adapter，只接受有界数值与四个资产类型 key；不得保存草稿、内容、路径、资产身份、搜索、敏感信息或操作结果。无效或旧版本偏好直接丢弃为默认值。

#### React 与测试 surface

- React view 只把可见用户动作 dispatch 给 session，并从 snapshot 渲染；不在 effect hook 中复制 gateway workflow；
- selector 可以减少无关渲染，但 selector 不是新的状态权威；
- `WorkspaceSession` 行为测试注入 scripted mock `FrontendGateway`，覆盖 dirty guard、旧响应、事件失效、prepare failure、apply 不确定与 progress 对账；
- rendered UI 用户旅程使用同一个 session 和 mock gateway，断言可见行为、焦点和键盘路径；
- 真实 Tauri gateway 复用 `FrontendGateway` 契约测试；不能用 session 测试替代 wire、core 或真实 adapter 验证；
- 主要断言针对 interface 的可见状态和 gateway 调用，不依赖内部 reducer action 顺序或 React snapshot test。

#### 被否决的替代方案

- TanStack Query + Zustand：成熟但会把 gateway facts、草稿和 workflow 分散到 query cache 与 store，并增加同步规则；
- XState + TanStack Query：状态表达严格，但当前单工作区、单草稿、单事务不需要两套运行时和额外建模层。

详细取舍记录见 `docs/architecture/adr/0009-framework-neutral-workspace-session.md`。

### 3.13 `ARC-06b`：CodeMirror 6 + 契约驱动工作台控件

#### 最小依赖边界

前端工作台采用以下受控依赖：

- 源码编辑使用 CodeMirror 6，只引入状态、视图、命令、语言基础及被真实 fixture 证明需要的语言包；
- 工作区可调面板使用 `react-resizable-panels`；
- 16 px 线性角色图标使用 `lucide-react`，图标名称只表达产品基线已经定义的角色和动作；
- 其余 UI 使用语义化 HTML、项目内小型 primitive、CSS custom properties 和局部样式，不引入完整组件库、设计系统或 CSS runtime。

不引入 Monaco、完整 IDE shell、通用 tree library、通用 diff engine、MUI、Ant Design、shadcn/Radix 套件或其他横向 UI 平台。某个原生 Web control 若在固定 WebView 目标上不能满足焦点或无障碍契约，必须先用真实交互测试证明缺口，再以最小 Change Request 评估单一 primitive；不能预先引入整套依赖。

精确版本在实现时由 lockfile 固定，并纳入 `ARC-06c` 的可执行验证契约。依赖升级不得静默改变编辑、diff、键盘或敏感信息行为。

#### `SourceEditor` module

建立项目内深 `SourceEditor` adapter，把 CodeMirror 的 `EditorState`、`EditorView`、extension 和 transaction 隐藏在 module 内：

- `WorkspaceSession` 和业务 view 不接收 CodeMirror 类型；
- 编辑内容以不透明 `AssetRef`、`NativeFileRef.fileId` 和 revision 绑定，原生路径不能充当 editor model identity；
- editor change 转换为当前单一 `AssetDraft` 的显式动作；可审查内容和 dirty 事实回到 `WorkspaceSession`；
- 光标、selection、IME composition 和 undo history 可以在当前会话内按当前资产/文件保留，但切换资产、放弃、完成应用或销毁 session 时按 workflow 释放；
- 外部 draft 投影、只读状态和 asset/file/revision 变化必须通过明确的 reconfigure/replace 路径处理，不能被误记为用户编辑；
- 未知语言回退为纯文本；MVP 不增加 LSP、代码执行、终端、文件系统访问、自动补全 provider 或 IDE command palette；
- 非文本、未知且不可预览、只读兼容版本和不能安全结构化的状态直接渲染既有只读/降级表面，不伪造可编辑 document。

#### 契约驱动的 diff 与冲突

统一差异使用项目内 `ContractDiffView`，严格渲染 `FrontendGateway` 返回的 `UnifiedDiff`：

- 展示文件摘要、统一差异行、旧/新行号、新增/删除/上下文类别、未变区段折叠和敏感变化标记；
- 不重新解析源码，不在前端重算、修补或猜测差异语义；
- CodeMirror merge extension、Monaco diff 或通用 diff package 都不能成为差异事实来源；
- 展开/收起未变区段只改变 view state，不改变 `PreparedOperation`；
- 三方冲突只组合 `ConflictResult` 与契约中可读取的基线、当前磁盘和草稿引用；文本表面可以复用只读 `SourceEditor`，但冲突块身份、允许动作和解决结果仍由 gateway 契约决定；
- 前端不自动合并，也不从三个文本 pane 生成可应用结果；用户解决后必须按契约重新 `prepare`。

这样可以让 mock gateway、真实 IPC adapter 和 Rust core 共用同一组 authoritative diff fixtures，避免前后端产生第二套差异算法。

#### 敏感片段边界

- 默认 CodeMirror document、selection、undo history、装饰器属性和调试输出不得接收临时查看的敏感明文；
- `view` 授权通过 `ARC-06a` 的 `SensitiveRevealLease` 在独立覆盖表面短暂显示，不用明文替换 editor document；
- `modify` 授权只在专用的短生命周期输入表面持有当前片段值；asset、file、revision、scope、TTL 或 surface 变化立即销毁；
- 该表面只把当前授权允许的修改交给既有 operation intent/prepare 路径，不建立新的公开契约类型，不进入可订阅 `WorkspaceViewState`、偏好、日志、事件、诊断或 fixture；
- JavaScript 字符串无法保证可靠清零仍是已接受残余风险，因此必须最小化明文的组件范围、引用数量和生命周期。

#### 文件树与面板

文件树使用项目内 WAI-ARIA 单选 tree，不增加 tree library：

- 节点由 `NativeFileRef` 投影，以不透明 `fileId` 识别；相对路径只用于展示和层级；
- 同时只有一个 selected node，采用 roving focus 或 `aria-activedescendant` 的一种一致策略；
- 支持方向键、`Home`、`End`、`Enter` 和同级 type-ahead，并按产品基线恢复焦点；
- MVP 不提供拖放、重命名、多选、跨资产移动或预先虚拟化；单文件资产不渲染空 tree。

可调面板通过 `react-resizable-panels` 的 group、panel 和 separator primitive 包装为项目内 `WorkspacePanels`：

- separator 有可访问名称、可见焦点和 WAI-ARIA window splitter 语义，并实现产品基线确定的 8 px、32 px、`Home`/`End` 键盘规则；
- 尺寸变化只把经过上下限约束的当前资产类型栏宽写入 `WorkspacePreferences`；
- 窄窗口收拢、覆盖式临时展开、聚焦编辑和恢复默认栏宽复用同一布局状态，不建立 docking、任意 tab 或多窗口布局系统；
- 临时收拢与聚焦不覆盖持久栏宽，销毁后不遗留全局 pointer 或 keyboard listener。

#### 验证 surface

- `SourceEditor` 浏览器交互测试覆盖 IME composition、undo/redo、只读、外部 draft 投影、文件切换、销毁和遮蔽片段；
- diff fixture 断言可见文件、行号、行类别、折叠和敏感标记与 `UnifiedDiff` 一致，不把 snapshot test 作为主要断言；
- 冲突旅程断言前端不产生自动合并结果，解决后重新 `prepare`；
- 文件树和 separator 测试覆盖 WAI-ARIA role/name/state、完整键盘路径、边界值、焦点恢复和减少动态效果；
- 大文件和多文件性能先用产品 fixture 实测，再由 `ARC-06c` 冻结预算和命令；当前不为假设规模增加 tree virtualization 或 editor worker；
- 控件随 FE tracer-bullet 票据纵向交付，不新增“组件库”“编辑器平台”或“设计系统”横向票据。

#### 被否决的替代方案

- Monaco + 内置 diff：IDE 能力完整，但引入 model URI、worker、disposable、bundle 和第二套 diff 语义，超过 MVP；
- 原生 `textarea`、`contenteditable` 和完全自研编辑器：依赖更少，但 IME、undo、selection、大文本和可访问性成本过高；
- 完整 UI kit + tree/diff 组件：初始组合更快，但会扩大样式、状态和无障碍抽象面，并削弱当前原生内容优先的工作台边界。

详细取舍记录见 `docs/architecture/adr/0010-codemirror-contract-driven-workbench.md`。

### 3.14 `ARC-06c`（wire schema）：Rust-first DTO + `ts-rs`

#### 事实源与依赖方向

产品基线和前端契约继续定义产品与 UI 行为；本决策只确定 IPC wire shape 的实现事实源：

```text
产品基线 / 前端契约
          │
          ▼
Rust wire DTO（唯一 wire shape 事实源）
     ├── serde encode/decode
     ├── ts-rs 生成 TypeScript declarations
     └── Rust 生成 wire version constant
                    │
                    ▼
       TauriFrontendGateway adapter
```

- 在 Rust 中建立独立 wire DTO layer；它与 `GatewayCore` domain types 显式转换，domain types 不直接导出为 TypeScript；
- `serde` 定义 command request、response、event 和内部 wire fault 的实际序列化 shape；
- 仅 wire DTO derive `ts-rs::TS`；生成的 TypeScript declaration 是受管派生产物，不能手工编辑或反向成为事实源；
- 一个最小 Rust export entrypoint 同时输出 declaration 和 `GATEWAY_WIRE_VERSION` 常量，避免 TypeScript 手写第二份版本号；
- `TauriFrontendGateway` 继续手写映射已冻结的三个 command 和一个 invalidation event，不引入 `tauri-specta` 或其他会重新拥有 routing/interface 的框架；
- mock `FrontendGateway` 直接实现语言无关契约，不为测试方便依赖 Tauri wire；真实 adapter 才使用生成的 wire declaration。

具体 crate/package 版本由 lockfile 固定。只启用 `ts-rs` 导出当前 DTO 所需的最小 feature；不因为生成声明而引入 JSON Schema、OpenAPI、Zod、TypeSpec 或第二套 RPC runtime。

#### Wire DTO 子集

为保证 Rust、JSON 和 TypeScript 语义一致，wire layer 使用受控子集：

- 每个 union 都有显式且稳定的 tag；不使用存在解码歧义的 untagged union；
- request、response 和 event 若方向语义不同则使用不同 DTO，不用方向相关的 skip 行为伪装为一个共享类型；
- 资产、文件、operation、revision、token 和 request identity 都以不透明 string 传输，不编码路径语义；
- 跨 wire 的整数必须处于 JavaScript safe-integer 范围；超出范围的计数、时间或版本值使用经过约束的 decimal string，不依赖 `bigint` 隐式转换；
- map key 只允许 string；二进制内容不进入普通 gateway JSON；
- ingress 在转换为 domain type 前拒绝未知 tag、未知字段、缺失字段、非法范围、超限 payload 和不支持的 `wireVersion`；
- 任一 wire DTO 使用 `ts-rs` 不能等价表达的 `serde` shape 时，生成检查必须失败；不得用手写 TypeScript override 隐藏不一致。

`ts-rs` 只提供静态 TypeScript declaration，不被表述为运行时验证器。生产边界职责仍为：

- Rust ingress 对来自 WebView 的 request 执行完整反序列化与边界校验；
- Rust 只能从已构造成功的 response/event DTO 序列化输出；
- TypeScript adapter 核对 envelope、`wireVersion`、`requestId` 和顶层 payload tag；任何不匹配都按 `ARC-02c` 归一化，不能把异常字符串或半可信 payload 交给 UI；
- 应用与 Rust core 同包发布，只支持当前 wire version，不维护未获产品依据的多版本兼容层。

#### 生成与漂移防护

- 生成 declaration 和版本常量的入口由 Rust test/tool 驱动，输出顺序与文件内容必须确定；
- 生成文件提交到仓库，供前端类型检查和新上下文直接使用；
- CI/本地验证先在临时目录重新生成，再与已提交产物逐字比较；有差异即失败，验证命令本身不得静默改写工作区；
- 生成文件顶部明确标记事实源和“禁止手工编辑”；
- 发布后的 breaking wire change 必须提升 `wireVersion`、重生成 declaration、更新正反向 vectors，并通过 adapter 契约测试；只改生成文件不能完成版本变更；
- unsupported version 封闭失败，不添加旧版本 migration、协商或 fallback。

#### 双向契约向量

同一组不含敏感明文的 golden JSON vectors 同时验证：

1. Rust request DTO 能从合法 TypeScript request vector 解码，并拒绝未知 tag、未知字段、非法范围、超限和错误版本；
2. Rust response/event DTO 序列化结果与预期 vector 一致；
3. TypeScript 使用生成 declaration 构造 request，并得到与 Rust 接受的 JSON shape 一致的 vector；
4. `TauriFrontendGateway` 对 response/event vector 完成 envelope、版本、request ID 和顶层 tag 核对；
5. 任一负向 vector 均归一化为既有 `ReadFailed`、`PrepareFailed` 或 apply 不确定状态，不泄露异常正文，也不产生写入授权。

vectors 只验证 wire；`FrontendGateway` 用户旅程 fixture 继续验证行为。两者不能互相替代，也不能把 mock-only PASS 表述为真实 IPC 通过。

#### 被否决的替代方案

- TypeSpec/JSON Schema 作为中立事实源：运行时 schema 更完整，但为当前 Rust producer + TypeScript consumer 增加第三种描述语言、两侧生成器和映射层；
- Rust 与 TypeScript 手工双写：依赖最少，但大型 tagged union、稳定原因码和版本字段容易漂移；
- `tauri-specta` 直接生成 command client：能进一步自动化 Tauri 调用，但会让外部工具重新拥有已经冻结的三个 verb command interface，当前没有必要。

详细取舍记录见 `docs/architecture/adr/0011-rust-first-wire-schema.md`。

### 3.15 `ARC-06c`（测试层级）：分层证据 + 少量真实 Tauri 主路径

#### 证据层级

测试按“在最便宜且足够真实的层验证一个行为，并在真实变化边界补证据”组织：

| 层级 | 运行对象 | 主要工具 | 证明内容 | 不能宣称 |
|---|---|---|---|---|
| L0 静态门禁 | Rust/TypeScript source、生成产物、依赖与配置 | formatter、linter、typecheck、schema drift check | 语法、类型、生成一致性和禁止依赖 | 运行时行为、真实 IPC、文件写入 |
| L1 module/contract | `GatewayCore`、内部 adapter、事务、`WorkspaceSession`、wire vectors | `cargo test`、Vitest node mode | 纯行为、失败分支、事务不变量、异步状态与契约 | WebView 交互、Tauri 权限、生产打包 |
| L2 renderer journey | React 工作台 + 真实 browser event + mock `FrontendGateway` | WebdriverIO browser mode | FX 用户旅程、CodeMirror、键盘、焦点、窄窗口和可见状态 | 真实 IPC、磁盘、SQLite、Keychain 或 Tauri lifecycle |
| L3 Tauri integration | 专用测试构建 + `TauriFrontendGateway` + Rust core + 隔离 fixture workspace | WebdriverIO Tauri service | WebView 到 command/event、权限、wire、core 与隔离文件事实的真实路径 | 生产签名/notarization、生产二进制等价 |
| L4 release artifact | 不含测试能力的生产 app/DMG/updater/adapter bundle | 发布与 macOS 验证命令 | 生产构建、安装、启动、签名、notarization、更新 artifact 与负向范围 | 未实际运行的完整 UI 旅程 |

同一断言不得跨层抬升 provenance。L2 的 mock PASS 不是 IPC 证据，L3 的测试构建 PASS 不是签名 DMG 证据，L4 的启动 PASS 也不自动证明全部 fixture 旅程。

#### 前端与 core 测试分工

- Rust 使用 `cargo test` 覆盖 core domain、四个 `AgentAdapter` conformance、SQLite/索引/文件事务、加密快照、更新包验证和 wire 正反向 vectors；
- 文件、SQLite 和 bundle 测试只使用每次运行新建的隔离临时根目录，不读取或修改真实 Agent 配置；
- Vitest 仅在 node mode 运行 framework-neutral TypeScript：`WorkspaceSession`、`WorkspacePreferences`、gateway 契约 runner、生成类型消费和 deterministic timers；
- 不为 React 渲染引入 jsdom；可见 UI、原生 browser event、IME、selection、focus 和 ARIA 交给 L2；
- WebdriverIO browser mode 从 Vite test entry 注入 scripted mock `FrontendGateway`，复用 FX-01 至 FX-18 的安全 fixture catalog；
- UI 旅程断言用户可见状态、可用动作、焦点和 gateway 调用，不把 DOM 结构、内部 reducer 顺序或截图 snapshot 作为主要断言；
- screenshot、DOM dump、前后端脱敏日志和 WebDriver trace 只作为失败证据，并经过敏感占位值扫描。

#### Mock 与真实 adapter 的同一契约测试

建立一个 framework-neutral `FrontendGatewayContract` test module：

- 输入只是一项 `FrontendGateway` adapter factory 和 fixture capability；
- 同一组 read/prepare/apply/observe、原因码、revision、事件失效、apply 不确定与敏感结果不变量先由 Vitest 对 scripted mock 运行；
- L3 test WebView 导入同一 assertion module，并对真实 `TauriFrontendGateway` 与隔离 core fixture 运行；
- adapter 特有 setup/teardown 可以不同，行为断言、向量和稳定原因码不能复制成第二套；
- L3 只有在真实 command/event 已经过 WebView/Core 边界后才记为实际 IPC 证据；
- 全量真实 adapter 契约回归属于 `RELEASE-GATE`；各 FE 票据只运行其直接需要的最小真实 tracer，不夺取 fixture 主归属。

#### macOS Tauri 测试构建隔离

macOS 的 L3 使用 WebdriverIO Tauri service 的 embedded provider，但测试能力必须从生产 artifact 中物理移除：

- `tauri-plugin-wdio-webdriver` 只通过专用 Cargo feature/profile 编译进 test harness app，不允许仅靠运行时 flag 隐藏；
- test harness 使用独立 bundle identifier、应用数据根、临时授权目录和 synthetic fixture，不访问用户真实 Application Support、Keychain item、项目或 Agent 配置；
- 不引入非必要的 `@wdio/tauri-plugin` 后端 execute/mocking 能力；只有真实测试出现无法从用户表面观察的阻塞证据时才提交最小依赖变更；
- test harness 只监听 loopback，并在进程结束时关闭；端口、payload、路径和敏感占位值不得进入持久日志；
- L4 对生产 app、DMG 和 updater artifact 执行负向检查，确认未链接/注册 WebDriver plugin、未暴露 test command/capability、未包含 fixture 或 test entry；
- L3 与 L4 分别保留 artifact identity、构建 profile 和命令输出，不能用测试构建冒充 release candidate。

#### 票据与门禁责任

- FE-01 的最小 bootstrap 首次建立 L0/L1、L2 浏览旅程和 L3 的“启动 → 一次真实 read → event 失效后重读”tracer；
- FE-02 至 FE-10 在各自票据运行受影响的 L0/L1/L2 聚焦检查；只有新增真实边界或安全写入路径的票据才增加最小 L3 tracer；
- FE-04 的 L3 写入 tracer 只能作用于隔离临时原生单元，覆盖 prepare 无副作用、apply revision 重校验、结果与恢复点，不触碰真实项目或 Git；
- FE-10 仍只拥有 FX-12 的 mock renderer 集成旅程，不接管其他 fixture 或真实 adapter 全回归；
- `RELEASE-GATE` 汇总 FX 全回归、真实 gateway contract、生产构建/打包、签名/notarization、更新和测试能力负向检查；
- coverage 百分比、snapshot 数量和“测试文件存在”都不是票据完成标准；通过判据来自契约旅程与真实边界证据。

#### 被否决的替代方案

- 真实 Tauri E2E 覆盖全部用户旅程：环境还原度高，但运行慢、fixture 隔离和失败定位成本大，并扩大测试插件暴露面；
- 实现阶段只运行 mock/browser，真实 Tauri 推迟到发布：初期简单，但 IPC、权限和 lifecycle 风险暴露过晚，无法为关键 tracer 提供真实边界证据。

详细取舍记录见 `docs/architecture/adr/0012-layered-test-evidence.md`。

### 3.16 `ARC-06c`（性能）：先冻结测量协议，再由真实 tracer 锁定数字

#### 当前事实边界

产品基线没有定义启动、搜索、编辑、索引或应用事务的数值 SLA；当前也没有可运行实现、release-like artifact 或固定 runner 的测量结果。因此：

- 技术方案现在冻结测量对象、fixture descriptor、参考环境字段、统计方式、责任票据和预算变更规则；
- 不在当前文档中编造毫秒、内存或吞吐数值，也不把原型、设计或静态分析当作 baseline；
- 每个 surface 的首个可运行 tracer 必须在对应票据完成前生成实际 baseline，并把数值预算锁入版本化配置；
- 数值预算是工程验收门禁，不新增产品行为或公开性能承诺；
- `ARCH-GATE` 可以在测量协议完整后关闭，但关闭只代表“责任与方法已确定”，不代表任何性能指标已经通过。

在实际命令运行前，所有数值性能项的证据状态固定为 `unverified`。

#### Synthetic performance fixture descriptors

性能 fixture 与 FX 用户旅程分开编号，但复用同一安全内容规则：

| Fixture | 形状维度 | 主要测量 surface | 首次责任 |
|---|---|---|---|
| `PF-01 catalog-browse` | 四类资产、四个 Agent、项目/作用域/状态组合、名称与摘要长度、列表总量 | 启动后首屏、筛选、搜索、选择资产 | FE-01 |
| `PF-02 source-large` | 文本字节数、行数、最长行、未知字段、注释、遮蔽敏感段数量 | 源码打开、编辑输入、滚动、切换只读 | FE-02、FE-03 |
| `PF-03 multifile-workbench` | 文件数、目录深度、文本/非文本比例、总字节、活动路径和 dirty 文件数 | 文件树、文件切换、草稿投影、布局 | FE-02、FE-03 |
| `PF-04 review-conflict` | 更改文件数、diff 行数、未变区段、finding、敏感标记和三方冲突块 | prepare、统一差异、折叠展开、冲突表面 | FE-04 |
| `PF-05 index-events` | 项目数、资产数、增删改事件 burst、过期索引与重建输入 | 索引构建、事件合并、重读和搜索可用 | FE-07 |
| `PF-06 conversion-transaction` | 源/目标文件数、能力映射项、待写字节、快照与回滚分支 | 转换 prepare、apply、恢复点和回滚 | FE-06、FE-09 |
| `PF-07 adapter-bundle` | 四 Agent schema、能力矩阵、规则、模板与 conformance case 数量 | candidate 验证、原子启用与回滚 | FE-08 |

每个 descriptor 必须包含确定 seed、上述维度、内容生成规则和 fixture digest。只生成合成路径、占位敏感值和不可执行 Hook 文本，不读取用户真实 Agent 配置、项目、Token 或 Git 工作树。

每个 fixture 最终有 `representative` 与 `stress` 两个 profile。精确数量在首个 tracer 校准时写入；`stress` 只用于发现退化，不自动声明为产品支持上限，也不能反向扩大 MVP 范围。

#### 测量点与责任

| Surface | 必须记录的指标 | 证据层 |
|---|---|---|
| 冷启动与初始读取 | process start → workspace 可交互、首个可信 snapshot | L3；L4 另测 production artifact 启动 |
| 搜索、筛选、资产/文件选择 | intent → 对应结果或内容完成可见 | L2；真实 read tracer 另记 L3 |
| 源码编辑与布局 | input → draft/paint、文件切换、分隔线调整和聚焦切换 | L2 |
| prepare、diff 与冲突 | intent → 稳定结果、diff 首屏与未变区段展开 | L2 + L3 |
| apply、恢复与更新 | intent → 进度可见、终态和恢复点；安全校验耗时单独分段 | L3 |
| 索引与事件 | 初始索引、增量更新、重建、event → authoritative reread | L1 + L3 |
| 资源与产物 | steady/peak RSS、私有存储增长、app/DMG/updater/bundle 大小 | L3 + L4 |

- TypeScript 使用标准 User Timing mark/measure；Rust 使用 monotonic clock，并只通过脱敏 correlation identity 对齐阶段；
- 指标名称稳定且不包含资产名、路径、内容、搜索词、diff、Token 或 payload；
- 冷启动与 warm interaction 分开统计；短交互记录足够样本以报告 p50/p95，进程/磁盘重操作记录每次原始样本；
- runner 抖动、后台任务或 fixture 不一致导致的结果标为 `inconclusive`，不能删除异常值后宣称通过；
- 性能 instrumentation 本地输出结构化 JSON，不上传遥测、不建立在线 dashboard 或服务。

#### 校准与预算冻结

首个 tracer 按以下顺序执行：

1. 在固定 Apple Silicon reference Mac、固定 macOS 15+ exact version/toolchain、外接电源、隔离临时数据根和 release-like profile 上运行；
2. 记录 commit、artifact identity、runner、OS、toolchain、fixture digest、profile、样本数和原始测量；
3. 分别给出 p50、p95、资源峰值及失败/不确定样本，不只保留汇总 PASS；
4. 基于真实分布同时确定 absolute experience ceiling 与相对 regression allowance；
5. 将结果和预算写入受版本控制的 `performance/budgets` manifest，并由对应票据审查后冻结；
6. 对该 surface 有直接依赖的后续票据开始前，预算必须已存在且其验证命令实际可运行。

FE-01 负责 `PF-01` 与启动/read 的第一条 baseline；其他 PF 由首次引入相应 surface 的票据在完成前校准。`RELEASE-GATE` 在固定 reference environment 对所有已冻结预算复测，并另记生产 artifact 数据。

预算失败时先定位实际瓶颈，不自动引入 virtualization、worker、sidecar、cache 或新索引。安全校验、revision 重读、敏感保护、事务和回滚不能为达标而跳过。

放宽预算必须单独记录旧值、新值、原始证据和用户可见影响，并经过显式审查；造成回归的同一修改不能一边放宽预算一边宣称性能修复。若影响产品体验或支持规模，必须提交产品 Change Request。

#### 被否决的替代方案

- 当前直接冻结绝对数值：没有运行 artifact、fixture 值和固定硬件证据，容易形成虚假精度和过早优化；
- 只记录数据而不设阻断预算：初始慢基线和持续小回归都可能进入发布，无法形成可执行验收。

详细取舍记录见 `docs/architecture/adr/0013-evidence-calibrated-performance-budgets.md`。

### 3.17 `ARC-06c`（命令契约）：npm + Vite 根级 scripts

#### 工具链与锁定

- React SPA 使用 Vite，不使用 SSR、第二个 frontend bundler 或 monorepo build system；
- Node 固定为 `24.18.0` LTS，npm 固定为 `11.16.0`；bootstrap 分别写入 `.node-version`、`package.json.engines` 与 `packageManager`；
- Rust 固定为 `1.97.1` stable，并通过 `rust-toolchain.toml` 安装 `rustfmt` 与 `clippy`；
- `package-lock.json` 与 `Cargo.lock` 必须提交；干净环境使用 `npm ci`，lock 与 manifest 不一致时封闭失败；
- 所有 Node 命令只使用 lockfile 中的本地 binary，不使用可能临时下载未知版本的裸 `npx`；
- Vite、Tauri、CodeMirror、Vitest、WebdriverIO 等具体依赖由 lockfile 精确固定，升级必须重跑受影响命令与契约 fixture。

不增加 Make、just、Nx、Turborepo 或全局 task runner。`package.json` scripts 是唯一人类与 CI 共用的根级命令面；Cargo、Tauri、Vitest 和 WebdriverIO 原生命令仍可用于局部诊断，但不能替代票据关闭命令。

#### 稳定 root command registry

| 入口 | 责任 | 证据层 |
|---|---|---|
| `npm run verify:toolchain` | 核对 Node/npm/Rust、lockfile、macOS 15+、`aarch64-apple-darwin` 与所需系统工具，不安装或修改依赖 | L0 |
| `npm run verify:static` | 生成漂移、format、lint、TypeScript typecheck、Rust fmt/clippy 与禁止依赖/配置检查 | L0 |
| `npm run test:rust` | Rust core、adapter、事务、wire 与 bundle tests | L1 |
| `npm run test:frontend` | Vitest node-mode 的 `WorkspaceSession`、偏好和 mock gateway contract | L1 |
| `npm run test:ui` | WebdriverIO browser-mode 的 FX renderer journeys | L2 |
| `npm run test:tauri` | 专用 test harness 的真实 command/event 与隔离原生单元 tracers | L3 |
| `npm run perf -- <PF-ID>` | 运行一个已登记 PF descriptor，输出原始样本与预算比较 | L2/L3/L4，依 fixture 决定 |
| `npm run build:frontend` | TypeScript + Vite production frontend build | build evidence，不单独取得行为 credit |
| `npm run build:app` | 不含 WebDriver 能力的 arm64 release-like Tauri app build | L4 build evidence |
| `npm run package:macos` | 生产 arm64 macOS app/DMG/updater artifact 打包入口 | L4；签名与 notarization 前置条件另验 |
| `npm run verify:ticket -- <FE-ID>` | 按固定 registry 编排一张票据的最小 L0–L3/PF 集合 | 票据关闭入口 |
| `npm run verify:release` | 全回归、生产 artifact、发布与负向范围验收 | `RELEASE-GATE` 关闭入口 |

根 scripts 只能是薄 wrapper。涉及多个进程的顺序、超时、信号转发和 evidence manifest 由小型 Node ESM orchestrator 使用参数数组与 `spawn` 实现，不使用拼接 shell command、动态 `eval` 或通用任务 DSL。未知 ticket/PF ID、缺少前置条件、子命令非零、超时或 evidence 写入失败都使根命令非零退出。

#### 票据层级 registry

`verify:ticket` 使用一份受版本控制的封闭 registry；票据不能在自身实现中静默减少层级：

| Scope | 固定最小组成 |
|---|---|
| FE-01 | L0 + L1 read/session + L2 FX-01 + L3 start/read/event/reread + PF-01 |
| FE-02 | L0 + L1 detail/files + L2 FX-02/03 + L3 multifile read + PF-02/03 read |
| FE-03 | L0 + L1 draft/session + L2 FX-04 + PF-02/03 edit；无新增 L3 |
| FE-04 | L0 + L1 operation/transaction + L2 FX-05/16/18 + L3 temp prepare/apply/conflict/recovery + PF-04 |
| FE-05 | L0 + L1 create/import/install + L2 FX-08/15/17 + L3 temp create/import/install collision；无新增 PF |
| FE-06 | L0 + L1 conversion + L2 FX-09/10/11 + L3 temp single-target conversion + PF-06 |
| FE-07 | L0 + L1 catalog/index + L2 FX-07 + L3 temp project/event/rebuild + PF-05 |
| FE-08 | L0 + L1 adapter registry/bundle + L2 FX-06/14 + L3 synthetic candidate/switch/rollback + PF-07 |
| FE-09 | L0 + L1 export/delete/recover + L2 FX-13 + L3 temp export/delete/recover collision + PF-06 recovery |
| FE-10 | L0 + L1 view/preferences + L2 FX-12；不新增 L3/PF，不接管真实 adapter 全回归 |

各票据只允许在 registry 之上增加聚焦检查。若底层 interface 或风险未变化，不能仅因“更真实”而把全部 FX 旅程提升为 L3。

#### Evidence contract

每次根级验证写入：

```text
.artifacts/verification/<scope>/<run-id>/
  manifest.json
  steps/<step-id>/
  reports/
  failures/
  performance/
```

`manifest.json` 至少记录 schema version、scope、status、commit、worktree dirty state、toolchain、fixture/PF digest、步骤与退出码、开始/结束时间、test harness 或 production artifact identity，以及每项 evidence 的 provenance。状态只允许 `pass`、`fail`、`inconclusive`；后两者都不能关闭票据或门禁。

- `.artifacts/` 不提交仓库，也不作为长期产品存储；
- 证据不得包含真实路径、配置正文、diff、Token、敏感明文、签名凭证或可重放写入 payload；
- screenshot、trace、stdout/stderr 与 macOS 日志在保存前执行敏感占位值和个人路径扫描；
- 根命令默认不改写 source、lockfile、budget 或 baseline；生成检查在临时目录比较；
- 性能预算首次冻结和发布 artifact 生成是显式、单独授权的输出步骤，不能藏在普通 test 命令；
- 单独运行底层命令可用于定位，但票据完成必须执行对应 `verify:ticket` 并保留完整 manifest。

当前只有命令契约，没有 `package.json`、orchestrator 或可执行测试。所有入口状态均为 `planned / unverified`；FE-01 bootstrap 负责实现最小 registry，并且只有命令实际运行后才能改变对应状态。

详细取舍记录见 `docs/architecture/adr/0014-npm-vite-command-surface.md`。

## 4. 当前最小架构骨架

```text
WebView process
  React UI
     ├── SourceEditor（CodeMirror 6 adapter）
     ├── ContractDiffView / ConflictView
     ├── FileTree
     ├── WorkspacePanels
     │
     └── WorkspaceSession
            │
            └── FrontendGateway interface
                   ├── mock adapter（用户旅程与契约测试）
                   └── TauriFrontendGateway adapter
                          │   （generated TypeScript wire declarations）
                          ├── read ─────► frontend_gateway_read
                          ├── prepare ──► frontend_gateway_prepare
                          ├── apply ────► frontend_gateway_apply
                          └── observe ◄── versioned invalidation event
                                             │
==================== Tauri IPC seam ====================
                                             │
Tauri Core process                           ▼
                  wire ingress adapter
                    （serde wire DTOs）
                         │
                      GatewayCore
       ┌─────────────────┼──────────────────┐
       │                 │                  │
 CatalogIndex      AssetEngine       OperationEngine
       │                 │              │        │
       │          AdapterRegistry       │   FileTransaction
       │            │         │         │        │
       │  AdapterBundleVerifier         │        ├── SnapshotVault
       │            │         │         │        │
       │       AgentAdapter   │         │        │
       │                                │        │      ├── SnapshotPayloadV1 codec
       │                                │        │      └── SnapshotKeyStore adapter
       │                                │        └── native file adapter
       └──────────────┬─────────────────┘
                  StateStore
               (state.sqlite)
                       │
             CoreEventSink + other
              role-specific adapters
```

不设置额外 sidecar。SQLite 访问与迁移实现以 `ARC-04a` 为准，快照加密与 Keychain seam 以 `ARC-04b` 为准，快照 payload framing 以 `ARC-04c` 为准，adapter bundle verification 以 `ARC-05d` 为准，macOS support/artifact matrix 以 `ARC-05e` 为准；容量、保留与监听数值仍不得从图中推断，验证命令面以 `ARC-06c` 为准。

## 5. 后续实现与门禁边界

整机技术方案已完成覆盖审计与独立只读复审，用户已集中验收，`ARCH-GATE` 已关闭。当前没有基于产品基线或前端契约的新增架构 A/B/C 待决；实现从 FE-01 开始并严格服从票据依赖。容量、保留周期、监听和性能数值继续按 `ARC-06c` 等待真实 fixture/tracer，不因门禁关闭而获得虚构数值或运行证据。

## 6. 参考资料

- [Tauri Architecture](https://v2.tauri.app/concept/architecture/)
- [Tauri Process Model](https://v2.tauri.app/concept/process-model/)
- [Tauri Inter-Process Communication](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)
- [Tauri Calling the Frontend from Rust](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri Permissions](https://v2.tauri.app/security/permissions/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- [SQLite Transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)
- [rusqlite](https://docs.rs/crate/rusqlite/0.40.1)
- [RustCrypto XChaCha20-Poly1305](https://docs.rs/crate/chacha20poly1305/0.11.0)
- [security-framework PasswordOptions](https://docs.rs/security-framework/3.7.0/security_framework/passwords/struct.PasswordOptions.html)
- [Apple Keychain Services](https://developer.apple.com/documentation/security/keychain-services)
- [Apple Data Protection Keychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)
- [postcard 1.1.3](https://docs.rs/postcard/1.1.3/postcard/)
- [Postcard Wire Format](https://postcard.jamesmunns.com/wire-format.html)
- [Tauri Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri CLI `signer sign`](https://v2.tauri.app/reference/cli/#signer-sign)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [FIPS 180-4: Secure Hash Standard](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)
- [Rust `tar` deterministic header mode](https://docs.rs/tar/latest/tar/enum.HeaderMode.html)
- [Rust `tar` entry security notes](https://docs.rs/tar/latest/tar/struct.Entry.html)
- [Reproducible Builds: Archive metadata](https://reproducible-builds.org/docs/archives/)
- [Tauri DMG Distribution](https://v2.tauri.app/distribute/dmg/)
- [Tauri macOS minimum system version](https://v2.tauri.app/distribute/macos-application-bundle/#minimum-system-version)
- [Tauri CLI target selection](https://v2.tauri.app/reference/cli/#build)
- [Tauri App Store Distribution](https://v2.tauri.app/distribute/app-store/)
- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [CodeMirror Reference Manual](https://codemirror.net/docs/ref/)
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels)
- [WAI-ARIA APG Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)
- [WAI-ARIA APG Window Splitter Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
- [Serde Attributes](https://serde.rs/attributes.html)
- [ts-rs](https://github.com/Aleph-Alpha/ts-rs)
- [Tauri Tests](https://v2.tauri.app/develop/tests/)
- [Tauri WebDriver Testing](https://v2.tauri.app/develop/tests/webdriver/)
- [WebdriverIO Tauri Service](https://webdriver.io/docs/desktop-testing/tauri/)
- [Vitest](https://vitest.dev/guide/)
- [W3C Performance Timeline](https://www.w3.org/TR/performance-timeline/)
- [W3C User Timing](https://www.w3.org/TR/user-timing/)
- [Tauri + Vite](https://v2.tauri.app/start/frontend/vite/)
- [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/)
- [Node.js 24.18.0 LTS](https://nodejs.org/en/blog/release/v24.18.0)
- [Rust 1.97.1](https://blog.rust-lang.org/2026/07/16/Rust-1.97.1/)
