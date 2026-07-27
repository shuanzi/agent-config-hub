# 前端契约规格索引

**Status:** accepted — 2026-07-27

本地 tracker 的规范正文是：

- `docs/frontend/Agent_Config_Manager_前端契约_v0.1.md`

该正文已经包含 Problem Statement、Solution、User Stories、Implementation Decisions、Testing Decisions、Out of Scope，以及产品基线追溯矩阵。本文件只承担 tracker 索引职责，不复制规范内容。产品基线与前端契约均已确认；技术阶段发现的 `CR-FE-001` 已由用户确认并纳入同一份契约，契约重新冻结。整机技术方案已于 2026-07-27 验收，`ARCH-GATE` 已关闭，FE-01 成为首个实现 frontier。

## 验收前检查清单

- [x] 产品基线是唯一产品事实来源；
- [x] UI 端口与状态不依赖框架、IPC 或后端实现；
- [x] 产品条款已映射到契约、fixture 和 FE 票据；
- [x] FE 票据保持为 10 个 tracer-bullet 行为切片；
- [x] `RELEASE-GATE` 被定义为非实现型发布门禁；
- [x] 用户验收前端契约（2026-07-27）；
- [x] 用户验收后启动 `ARCH-GATE`；
- [x] `CR-FE-001` 补齐 `PrepareFailed(GATEWAY_UNAVAILABLE)` 并更新 fixture、覆盖矩阵和 FE-04；
- [x] FE-01 至 FE-10 与 `RELEASE-GATE` 已记录统一验证命令契约，状态均为 `planned / unverified`；
- [x] 用户验收整机技术方案并关闭 `ARCH-GATE`（2026-07-27）；
- [ ] 首个实现切片建立最小 bootstrap，并把相应验证命令标记为已验证可运行。
