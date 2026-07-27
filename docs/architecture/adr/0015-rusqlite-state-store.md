# ADR-0015：采用 rusqlite 与内嵌 forward-only migration

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

`ARC-04` 已确定一个应用私有 SQLite 状态库承载管理事实、operation journal、恢复点 manifest 和可重建索引。MVP 是单用户、单进程、一个活动事务；需要决定 `StateStore` 如何访问 SQLite、执行 migration 和保持测试 seam，同时避免把数据库实现扩散到 `GatewayCore`。

## 决策

- 初始依赖固定为 `rusqlite 0.40.1`，关闭 default features 且只启用 `bundled` SQLite；精确依赖闭包由提交的 `Cargo.lock` 固定；
- bundled build 提供应用自带的 SQLite 与 FTS5，不依赖 macOS 系统 SQLite；构建和启动测试实际验证 FTS5 可用；
- 不启用或调用 SQLite loadable extension、用户自定义 native extension 或运行时 extension 路径；
- 一个 `StateStore` implementation 持有一个 connection，在 Rust blocking execution context 中串行执行数据库工作；
- 不引入 SQLx、Diesel、ORM、async connection pool、外部 migration CLI、通用 repository seam 或按表 repository；
- migration 以单调编号、forward-only SQL 编译进应用，由 `StateStore` 按顺序在 transaction 中执行；
- migration 成功并通过 schema invariant 检查后，在同一 transaction 更新 `PRAGMA user_version`；
- 已发布 migration 不可修改，只能追加；静态验证登记并检查编号、顺序和 digest；
- newer schema、migration 失败或 schema invariant 失败时保留现有数据库和快照目录，阻断写入与管理变更；不自动 reset 或 downgrade。

## Interface 与 seam

`StateStore` 是 core 内部深 module。它隐藏 connection 生命周期、SQL、migration、transaction、错误归一化和 FTS5 细节；调用方只学习所属领域行为及稳定结果。

- `rusqlite::Connection`、transaction、row、SQL string 和 SQLite error 不越过 module interface；
- SQL 只使用受版本控制的静态语句和参数绑定；
- 生产与测试使用同一个 implementation，测试替换的是数据库文件位置：每次新建临时文件数据库，而不是建立第二个内存 adapter；
- schema 与表仍按既定 domain owner 管理，`StateStore` 不演化为通用 query bus；
- 只有真实性能证据证明单连接调度不足时，才在 implementation 内评估只读连接；外部 interface 不随连接策略变化。

## Migration 验证

L1 至少验证：

1. 空数据库迁移到 latest；
2. 每个仍受支持的历史 schema 迁移到 latest；
3. 任一步注入失败时整个 migration 回滚，`user_version` 不前进；
4. newer schema 封闭失败且原文件保持不变；
5. 持久私有事实不因派生索引 migration 或重建被删除；
6. bundled SQLite 能实际创建和查询 FTS5 virtual table；
7. 生产依赖和连接配置不存在 loadable extension 入口。

这些测试通过 `StateStore` interface 观察领域结果；只有 migration integrity 测试可以检查 schema version 和数据库文件保持性，不把内部表形状变成上层验收 interface。

## 结果

正向影响：

- 直接匹配 SQLite transaction、FTS5 与本地文件数据库，不引入服务器式连接池或 async 数据层；
- bundled SQLite 消除目标机器系统 SQLite 版本和编译选项差异；
- migration 随应用分发，不需要用户或发布环境安装额外 CLI；
- 数据库复杂度集中在一个深 module，调用方和测试不依赖 ORM 或 SQL。

代价：

- row mapping、查询语句和 migration runner 由项目维护；
- 单连接会串行化数据库工作，需要通过真实 tracer 检查长索引任务；
- forward-only migration 不支持应用自动 downgrade；newer schema 必须封闭失败；
- bundled SQLite 会增加少量构建时间与应用体积。

## 替代方案

### SQLx + SQLite

提供 async pool、query tooling 和 embedded migration，但会把 async/pool 语义带入当前单进程、单活动事务的实现，并增加 build configuration 与依赖面。

### Diesel + SQLite

提供强类型 schema、ORM 和 migration tooling，适合更大的关系模型；当前表归属与查询规模不足以抵消宏、schema、CLI 和生成维护成本。

## 重新评估触发条件

只有固定 fixture 的真实 tracer 证明单连接使 journal 或已确认浏览旅程持续超出冻结预算，才评估额外只读连接。只有关系模型与查询复杂度显著增长且手写 mapping 已形成可量化维护风险时，才重新评估 ORM；不得仅因个人偏好替换 `StateStore` implementation。

## 参考

- [rusqlite 0.40.1](https://docs.rs/crate/rusqlite/0.40.1)
- [SQLite Transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
