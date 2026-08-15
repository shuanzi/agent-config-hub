# 前端契约规格索引

**Status:** v0.2 真相链已 Frozen；FE-07R、FE-01、FE-02 已 `done`；FE-03 与 FE-10 为 `ready-for-agent` frontier，其余实现仍为 `planned / unverified`

本地 tracker 的规范真相链依次是：

- `docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.2.md`（Frozen）；
- `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md`（Frozen）；
- `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27 已验收）及 `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1_影响复核_addendum_2026-08-10.md`。

本文件只承担 tracker 索引职责，不复制规范内容。v0.2 冻结记录不是 runtime、actual-read、ticket closure 或 gate evidence。`ARCH-GATE` 仍为 closed；FE-07R 已以 run `20260810T071547Z` 的 actual-read evidence 独立关闭，FE-01 已以自身稳定索引 `.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json` 闭合，FE-02 已以自身稳定索引 `.artifacts/verification/FE-02/latest-clean-subject-accepted-with-waiver.json` 闭合；根据直接 blocker evidence，FE-03 与 FE-10 是 implementation frontier，FE-04 至 FE-09 保持 blocked。FE-01 与 FE-02 的 automatic PF `fail`/exit `1` 与 exact manual `accepted-with-waiver` 不构成 automatic PASS 或 `RELEASE-GATE` credit。

## 验收前检查清单

- [x] 冻结产品基线 v0.2 是唯一产品事实来源；
- [x] 冻结前端契约 v0.2 与 2026-08-10 技术方案 addendum 是下游 planning 的受控事实来源；
- [x] UI 端口与状态不依赖框架、IPC 或后端实现；
- [x] 产品条款已映射到契约、fixture 和 FE 票据；
- [x] tracker 记录 11 张 implementation tickets：FE-07R foundation/read 加 FE-01 至 FE-10 的 10 个 tracer-bullet 行为切片；
- [x] `RELEASE-GATE` 被定义为非实现型发布门禁；
- [x] 前端契约 v0.2 已 Frozen（2026-08-10）；
- [x] `ARCH-GATE` 保持 closed，未因 v0.2 planning 重开；
- [x] `CR-FE-001` 补齐 `PrepareFailed(GATEWAY_UNAVAILABLE)` 并更新 fixture、覆盖矩阵和 FE-04；
- [x] FE-07R 与 FE-01 至 FE-10、`RELEASE-GATE` 已记录验证命令契约；FE-07R、FE-01、FE-02 已验证，FE-03 至 FE-10 仍为 `planned / unverified`；
- [x] FE-07R 的 acceptance 已 Frozen，且其 ticket 已由真实 actual-read evidence 与独立复审更新为 `done`；
- [x] FE-07R 已建立最小 bootstrap/harness，并以 run `20260810T071547Z` 实际完成 L0/L1/L3 actual-read 验证；FE-01 blocker 已解除。
- [x] FE-01 已由自身 stable subject accepted-with-waiver evidence 闭合；其 PF-01 仍是 development-only，`RELEASE-GATE` 保持 blocked。
