# 前端契约规格索引

**Status:** pending acceptance

本地 tracker 的规范正文是：

- `docs/frontend/Agent_Config_Manager_前端契约_v0.1.md`

该正文已经包含 Problem Statement、Solution、User Stories、Implementation Decisions、Testing Decisions、Out of Scope，以及产品基线追溯矩阵。本文件只承担 tracker 索引职责，不复制规范内容。产品基线已确认；当前前端契约仍待用户验收，因此不得称为已冻结、已可实施或已关闭门禁。

## 验收前检查清单

- [x] 产品基线是唯一产品事实来源；
- [x] UI 端口与状态不依赖框架、IPC 或后端实现；
- [x] 产品条款已映射到契约、fixture 和 FE 票据；
- [x] FE 票据保持为 10 个 tracer-bullet 行为切片；
- [x] `RELEASE-GATE` 被定义为非实现型发布门禁；
- [ ] 用户验收前端契约；
- [ ] 用户验收后启动 `ARCH-GATE`；
- [ ] 首个实现切片建立最小 bootstrap，并把相应验证命令标记为已验证可运行。
