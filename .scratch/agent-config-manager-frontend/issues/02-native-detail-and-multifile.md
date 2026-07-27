# FE-02 — 原生详情与多文件资产

**What to build:** 用户能够理解一个单文件或多文件原生资产的完整内容、文件结构、生效上下文和安全编辑边界。

**Blocked by:** FE-01 — 只读工作台主路径

**Status:** blocked

**Primary contract fixtures:** `FX-02 multifile-skill-mixed`、`FX-03 executable-hook-unknown`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] 多文件资产显示真实目录文件树，单文件资产不保留空文件树；
- [ ] 首次展开根目录和当前文件祖先目录，并按主文件优先、稳定文本兜底选择文件；
- [ ] 文件树只显示名称和关键状态，不把物理文件提升为资产；
- [ ] 文本文件默认显示源码，非文本或未知文件显示只读元数据与原因；
- [ ] FX-02/FX-03 的合成敏感源码变体在默认源码、文件树、检查器、结构化不可用说明和静态风险说明中不显示明文；显式临时查看只能经 `SensitiveRevealQuery`，其结果不缓存、不索引、不记录；
- [ ] 结构化视图仅在无损往返有保证时可用，不可用项保留原因说明；
- [ ] 检查器常驻摘要 Agent、作用域、生效上下文和路径；
- [ ] 来源与生效、兼容与漂移、变更与恢复按固定顺序展开；
- [ ] 关键安全状态不依赖检查器分组展开；
- [ ] 未知字段和可执行内容得到保留及静态风险说明，产品不执行内容；
- [ ] 旅程通过 `AssetDetailQuery` 和 `NativeFileQuery` 验证，不解析实现内部结构。

## 验证命令契约

**状态：** `planned / unverified`。统一入口为 `npm run verify:ticket -- FE-02`；失败证据写入 `.artifacts/verification/FE-02/<run-id>/`。

**前置条件：** FE-01 已完成并留存其 bootstrap 证据；`FX-02 multifile-skill-mixed`、`FX-03 executable-hook-unknown` 及其合成敏感变体可在隔离测试数据根复现。不得读取或执行用户内容。

**预计层级：**

- L0：本切片相关的静态、类型与生成产物一致性门禁；
- L1：`AssetDetailQuery`、`NativeFileQuery` 与多文件选择/遮蔽行为的 FX-02/FX-03 契约断言；
- L2：以 scripted mock `FrontendGateway` 驱动 FX-02/FX-03 的浏览器旅程；
- L3：专用 Tauri 测试构建在隔离 fixture 中完成多文件资产的真实 read；
- PF-02/PF-03：分别以 `source-large` 与 `multifile-workbench` descriptor 校准源码打开、文件树和文件切换 read surface 的首条 baseline。

**通过判据：** 命令在上述前置条件下退出成功；两项 fixture 的文件树、只读内容、未知/可执行内容说明、结构化视图边界和敏感遮蔽均符合票据；L3 留存多文件真实 read 证据；PF-02/PF-03 留存 fixture digest、运行环境和原始样本，数值预算只在实际校准后生效。

**Provenance 边界：** L2 mock 旅程不证明实际 IPC 或磁盘 read；L3 只证明隔离测试构建的真实多文件 read，不等同生产 artifact 或 L4。显式临时查看的 mock 结果也不证明真实敏感明文处理；未实际运行前，本命令与性能项均保持 `planned / unverified`。
