# ADR-0005：采用 SQLite 状态库与加密快照目录的混合持久化

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

产品基线同时要求应用私有元数据、可重建搜索索引、持久 operation progress、写入前恢复点、快照配额和敏感快照加密。原生资产始终是事实来源，索引不得授权写入；应用崩溃或 IPC 响应中断后还必须能判断一次 `apply` 的权威状态。

需要决定这些私有状态是全部放入数据库、全部放入文件目录，还是按查询型状态与大体积恢复内容分开。

## 决策

- 使用一个应用私有 `state.sqlite` 保存持久管理事实、operation journal 与结果、恢复点 manifest，以及可丢失的目录和搜索索引；
- 使用独立应用私有目录保存以不透明 recovery point identity 命名的完整快照；
- 所有完整快照统一采用版本化、具完整性校验的加密容器，密钥由 macOS 安全密钥存储管理；
- 持久私有表与派生索引表按 domain owner 隔离；索引重建只能替换派生 generation；
- `prepare` 不写数据库或快照，prepared operation 不跨进程生命周期持久化；
- `apply` 被 core 接受后先创建 durable journal，operation journal 再协调快照、原生文件事务、回滚和最终结果；
- 生产与测试都使用 SQLite，不新增通用 repository seam；测试使用临时数据库和测试平台 adapter；
- 本决策不直接冻结具体依赖；后续 `ARC-04a` / ADR-0015 已选择 `rusqlite`、bundled SQLite/FTS5 与内嵌 forward-only migration，`ARC-04b` / ADR-0016 已选择 XChaCha20-Poly1305、单一 Keychain 密钥和版本化 authenticated container，`ARC-04c` / ADR-0017 已选择版本化 `SnapshotPayloadV1` 与 `postcard` framing。容量和时间阈值仍未冻结。

## 数据归属

| 存储 | 包含 | 明确排除 |
|---|---|---|
| SQLite 持久私有表 | 管理范围、来源/漂移关系、operation journal 与结果、恢复点 manifest、固定状态、适配器选择元数据 | 原生资产正文、前端草稿、prepared 写入正文、敏感明文、密钥 |
| SQLite 派生表 | 资产目录投影、脱敏搜索字段、索引 generation、扫描和健康状态 | 写入授权、敏感值、跨资产依赖图 |
| 加密快照目录 | 完整恢复快照和完整性元数据 | 原生路径文件名、密钥、可执行 adapter 代码 |
| macOS 安全密钥存储 | 快照加密密钥 | 资产正文、操作历史、搜索数据 |

独立文件或目录删除可以使用系统废纸篓返回的不透明恢复 handle；配置块删除和其他原生改写使用加密完整快照。两者都通过 SQLite recovery manifest 暴露为同一 `RecoveryPoint` 契约。

## 事务与恢复

SQLite 无法与任意原生文件路径形成同一个原子事务，因此采用明确的阶段 journal：

```text
accepted
  -> snapshotReady
  -> applying
  -> applied
       or rollingBack -> failed(rollback succeeded|failed)
```

- `accepted` 在任何原生变更前持久化，但不含草稿、差异、敏感明文或可重放写入 payload；
- 必要快照通过临时文件、持久化和原子改名完成，随后再提交 manifest 与 `snapshotReady`；
- 进入 `applying` 后的崩溃由启动恢复对账处理，默认利用既有快照完成或继续回滚，不重新执行写入意图；
- `OperationProgressQuery` 读取 journal 的权威阶段和结果；未知 IPC 结果绝不通过重试 `apply` 推断；
- Keychain、快照、manifest 或 journal 不可用时，在触碰原生资产前封闭失败。

## 索引与监听

- 文件监听事件只是失效提示，由 `CatalogIndex` 合并并限定在已授权目录；
- 监听溢出、批量变化或一致性不确定时先标记受影响范围为 `stale`；
- 重建写入新的 generation，验证后在 SQLite transaction 中切换 active generation；
- 原生写入、删除和恢复始终重新读取磁盘，不能读取索引代替 revision 校验；
- 索引可单独清空重建，不得影响管理事实、operation journal 或 recovery manifest。

## 结果

正向影响：

- SQLite 为管理事实、搜索、journal 和 generation 切换提供集中事务语义；
- 大体积快照不膨胀主数据库，配额、清理和完整性验证保持局部；
- journal 明确承认数据库与原生文件系统之间没有跨资源原子性，并提供崩溃恢复路径；
- 敏感快照与搜索、日志和普通元数据物理分离；
- 一个数据库避免 MVP 过早承担多库迁移与一致性协调。

代价：

- SQLite、快照目录和原生文件之间需要可测试的阶段恢复协议；
- 删除快照必须通过 manifest 状态迁移协调，不能依赖单次数据库事务；
- SQLite 损坏可能丢失不可推导的来源、历史和 manifest，虽然原生资产不受影响；
- 统一加密全部完整快照意味着安全密钥存储不可用时，任何需要快照的原生写入都会阻断。

## 替代方案

### 全部存入 SQLite

单文件管理更直接，但快照 BLOB 会放大数据库、备份、清理和维护成本；原生写入仍在数据库外，不能因此获得端到端原子性。

### 仅使用文件目录与 JSON manifest

避免数据库依赖，但查询、迁移、并发 journal、搜索和原子索引 generation 都需要额外自建协调。

### 两个 SQLite 数据库

可以隔离持久事实和派生索引故障，但当前单用户工作负载没有证据支持两套连接、迁移、备份和恢复流程。

## 重新评估触发条件

只有真实 fixtures 证明单库的搜索写入明显阻塞 operation journal，或数据库维护对恢复数据造成不可接受风险时，才评估拆分索引数据库。只有快照体量和清理测量证明文件目录方案不可控时，才重新评估数据库 BLOB；调整不得改变 `RecoveryPoint`、`OperationProgressQuery` 或原生资产事实边界。
