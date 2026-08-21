# 前端契约规格索引

**Status:** v0.2 真相链已 Frozen；FE-07R、FE-01、FE-02 保留既有正式闭合记录；FE-03 与 FE-10 已按 MVP 最小功能 gate 直接标记为 `done`，其 PF、formal comparison、`verify:ticket` 与 release hardening 均未执行且已后置；FE-04 是唯一 `ready-for-agent` frontier，FE-05 至 FE-09 仍为 `blocked`，`RELEASE-GATE` 仍为 `blocked`。

本地 tracker 的规范真相链依次是：

- `docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.2.md`（Frozen）；
- `docs/frontend/Agent_Config_Manager_前端契约_v0.2.md`（Frozen）；
- `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27 已验收）、`docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1_影响复核_addendum_2026-08-10.md`，以及冻结的 `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1_prepared-secret_addendum_2026-08-21.md`。

本文件只承担 tracker 索引职责，不复制规范内容。v0.2 冻结记录不是 runtime、actual-read、ticket closure 或 gate evidence。`ARCH-GATE` 仍为 closed；FE-07R 已以 run `20260810T071547Z` 的 actual-read evidence 独立关闭，FE-01 已以自身稳定索引 `.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json` 闭合，FE-02 已以自身稳定索引 `.artifacts/verification/FE-02/latest-clean-subject-accepted-with-waiver.json` 闭合。FE-03（PR #22、#27）与 FE-10（PR #23、#27）的最小功能记录、必要 L0/L1/L2、真实产品安全负例和独立复审见对应 ticket 及 `TEST-EXECUTION-ORDER.md`；据此直接为 MVP `done`，而不是新增并行 `functional-done` 状态。它们没有 L3、PF、formal comparison 或 `verify:ticket` credit，不能作为 release-ready 证据。FE-04 因而成为唯一 implementation frontier，FE-05 至 FE-09 保持 blocked。FE-01 与 FE-02 的 automatic PF `fail`/exit `1` 与 exact manual `accepted-with-waiver` 不构成 automatic PASS 或 `RELEASE-GATE` credit。

## 验收前检查清单

- [x] 冻结产品基线 v0.2 是唯一产品事实来源；
- [x] 冻结前端契约 v0.2 与 2026-08-10 技术方案 addendum 是下游 planning 的受控事实来源；
- [x] 当前受控来源还包括冻结的 `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1_prepared-secret_addendum_2026-08-21.md`；它补充 FE-04 prepared-secret lifecycle，不改写上一条迁移前已完成 checklist 原文。
- [x] UI 端口与状态不依赖框架、IPC 或后端实现；
- [x] 产品条款已映射到契约、fixture 和 FE 票据；
- [x] tracker 记录 11 张 implementation tickets：FE-07R foundation/read 加 FE-01 至 FE-10 的 10 个 tracer-bullet 行为切片；
- [x] `RELEASE-GATE` 被定义为非实现型发布门禁；
- [x] 前端契约 v0.2 已 Frozen（2026-08-10）；
- [x] `ARCH-GATE` 保持 closed，未因 v0.2 planning 重开；
- [x] `CR-FE-001` 补齐 `PrepareFailed(GATEWAY_UNAVAILABLE)` 并更新 fixture、覆盖矩阵和 FE-04；
- [x] FE-07R 与 FE-01 至 FE-10、`RELEASE-GATE` 已记录验证命令契约；FE-07R、FE-01、FE-02 已验证，FE-03 至 FE-10 仍为 `planned / unverified`；
> 上一行是迁移前历史快照，原文按已完成 checklist 保留；当前 truth 以本页 Status、紧随其后的当前治理记录及 tracker 为准：FE-03/FE-10 已 MVP `done`，FE-04 是唯一 `ready-for-agent` frontier。
- [x] FE-07R 与 FE-01 至 FE-10、`RELEASE-GATE` 已记录验证命令契约；FE-07R、FE-01、FE-02 保留既有验证与闭合事实，FE-03、FE-10 已完成 MVP 最小功能验证，FE-04 至 FE-09 与 `RELEASE-GATE` 仍为 `planned / unverified`；
- [x] FE-07R 的 acceptance 已 Frozen，且其 ticket 已由真实 actual-read evidence 与独立复审更新为 `done`；
- [x] FE-07R 已建立最小 bootstrap/harness，并以 run `20260810T071547Z` 实际完成 L0/L1/L3 actual-read 验证；FE-01 blocker 已解除。
- [x] FE-01 已由自身 stable subject accepted-with-waiver evidence 闭合；其 PF-01 仍是 development-only，`RELEASE-GATE` 保持 blocked。
- [x] 当前治理将“最小 contract/implementation + L0/L1 + 必要 L2 + 真实产品安全负例 + 独立 review”作为直接 `done` 的 MVP gate；性能、压力、平台 hardening、formal comparison 与 release 证据均后置，既不得冒充已通过，也不得跨票据借用 credit。
- [x] FE-04 的 MVP gate 吸收 PR #24/#25 已冻结 prepared-secret addendum 的精确 lifecycle：零到多个 segment pairing 全部经权威验证后才建立 core entry；same-target revision drift/conflict/explicit reprepare 清除旧 core entry、旧 grant 与旧 bound identity，frontend 仅保留同一 target replacement 作为 unbound input，explicit reprepare 必须取得 newly authorized grant；只有 asset/file/segment/scope/surface target identity 改变、TTL 到期或 cancel/discard 才清零 frontend/core 两侧；apply single-use、成功后的 authoritative reread cleanup 与 crash loss 保持不变。它们仍由 FE-04 自身真实 write/recovery/sensitive L3 验证。
