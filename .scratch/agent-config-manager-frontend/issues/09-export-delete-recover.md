# FE-09 — 导出、删除与恢复

**What to build:** 用户能够安全导出原生资产、执行可恢复删除，并在恢复目标冲突时先审查差异而非覆盖当前内容。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** blocked

**Primary contract fixtures:** `FX-13 delete-export-recover`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] 导出按原始文件或目录结构写入用户选择位置，不生成产品私有格式；`exportAsset` 先 `prepare` 核对目标、敏感/可执行风险和路径，再经 `apply` 产生导出结果；
- [ ] 导出前提示可能包含敏感值或可执行脚本；
- [ ] 导出不生成诊断包、完整环境备份或迁移包；
- [ ] 删除前展示原生资产边界、目标路径和受影响上下文；
- [ ] 独立文件或目录优先进入系统废纸篓，配置块基于完整宿主文件快照移除；
- [ ] `deleteAsset` 复用准备、确认、应用和原位结果流程；
- [ ] `recoverAsset` 先 `prepare` 当前目标、差异、兼容与并发状态，再 `apply`；恢复目标未占用时可安全应用；
- [ ] 恢复目标被占用时展示差异并阻断静默覆盖；
- [ ] 外部删除只显示缺失，不自动重新创建；
- [ ] `setRecoveryPointPinned` 以同一 gateway 的 `prepare`/`apply` 固定或取消固定恢复点；最近有效恢复点仍得到保护；
- [ ] 导出、删除和恢复均不执行 Git 操作或跨资产影响分析。

## 验证命令契约

**状态：** `planned / unverified`

- **统一入口：** `npm run verify:ticket -- FE-09`；这是实现后的计划命令，尚未运行。
- **前置条件：** FE-04 已有 `done` 证据；bootstrap、生成 wire 类型和 `FX-13` 安全 fixture 可用；L3 使用专用 Tauri 测试构建与每次新建的合成临时源、导出和恢复目录，不读取或修改用户资产或 Git 工作树。
- **预计层级：** L0 检查变更源码、类型、格式、lint 与 wire/schema drift；L1 检查导出风险/边界、prepare 无副作用、恢复点固定、删除后的缺失表面，以及恢复目标冲突必须先有差异且不得静默覆盖；L2 以 scripted mock `FrontendGateway` 跑 `FX-13`；L3 只跑一次隔离临时目录的导出 → 删除 → 恢复目标冲突 tracer；PF-06 记录合成 conversion-transaction descriptor 的 recovery branch、事务与恢复测量及 fixture digest。
- **通过判据：** 导出保持原始结构，删除与恢复均经 prepare/confirm/apply，冲突只呈现差异而不覆盖；L3 只在临时目录上留下实际导出、删除和恢复冲突的 command/event 与文件事实 tracer；PF-06 留存原始样本、运行环境与 baseline/预算冻结或复测记录，出现 `inconclusive` 不得计通过。
- **失败证据：** 脱敏日志、WebDriver trace、截图或 DOM dump、层级与 fixture 标识写入 `.artifacts/verification/FE-09/<run-id>/`。
- **Provenance 边界：** L2 mock PASS 不取得真实 IPC 或文件写入 credit；L3 只证明该合成临时 recovery branch，不证明用户废纸篓、真实资产、Git 或真实 adapter 全回归；PF-06 数据不替代行为或发布证据。
