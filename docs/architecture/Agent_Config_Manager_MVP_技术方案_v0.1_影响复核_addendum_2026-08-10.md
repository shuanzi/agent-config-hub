# Agent Config Manager：技术方案 v0.1 影响复核 addendum（2026-08-10）

> 状态：已完成 OpenSpec `adopt-selected-b2-ui-baseline` task 1.8 的最小影响复核；本文件不改写或覆盖已验收的技术方案 v0.1。
>
> 复核日期：`2026-08-10`（Asia/Shanghai）
>
> 上位冻结产品正文 fingerprint：`sha256:ec28a44db79f019a92199a7d5853a71f15b593d1fe925bd0c6fd0eb65dbeee21`
>
> 上位冻结 frontend v0.2 正文 fingerprint：`sha256:dc5185eaf97eb2f9b93eeedb8ea047c268b087a97dd6d1d4e20b3a0076baccad`
>
> 受保护历史技术方案：`docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`；文件 SHA-256：`d344aea012039903f52235544e6388c1b1889d3b08e65457bc61767f81190885`。

## 1. 范围与结论

本 addendum 只复核 selected B2 冻结产品/前端契约对既有技术方案的 query/projection、wire、
ticket 编排和 evidence seam 影响。技术方案 v0.1 的原文、已验收结论和 `ARC-01` 至
`ARC-06c` 均不覆盖、不改写。

结论是：这些影响由既有 `ARC-02b`、`ARC-03` 与 `ARC-06c` 治理，`ARCH-GATE` 维持
`closed`。本次不新增 `FrontendGateway` command/event、信任边界、写权限或
prepare/apply/write surface；也不实施 wire、生成物、Gateway/Adapter、UI 或 runtime。

## 2. query 与只读 projection

后续实现只在既有 `read`/`observe` 语义内承接下列只读事实：

- `workbench` 与 `globalLocator` query/projection；`all`、`global`、`project(projectId)`
  的固定段序；
- `EffectiveContext`、`segments`、`findings`、authoritative read revision 以及
  Adapter/rule/version/revision provenance；
- 全局定位、只读筛选和 search/focus 所需的结果投影。

这些是 `read` 返回的封闭投影；event 仍只触发失效，随后 authoritative reread。它们不新增
Gateway command/event，仍复用既有 `read`/`observe`，也不新增 prepare/apply/write surface。

## 3. wire、信任边界与最小披露

相对当前 shape，上述只读投影在实施时是 breaking 的 Rust-first DTO delta。届时须按
`ARC-06c`：提升单一 `wireVersion`、从 Rust 生成 TypeScript declarations 和 version、补齐
正向/负向 vectors，并以 drift gate 阻止 Rust/TypeScript 偏离。本 task 不修改 wire、生成产物
或 runtime，故不产生任何 wire/runtime evidence。

信任边界保持为：UI → `FrontendGateway` → ingress → `GatewayCore`。本 addendum 所讨论的
新增 list/locator projection，只增加/传递冻结 frontend v0.2 必需的封闭事实：`AssetRef`/
`NativeOwnership` 与 opaque identity（含 `projectId`）；workbench/globalLocator query、
segments/groups/count、authoritative input order、`filterStatusFacts` 与 destination；以及
`EffectiveContext` 的 Adapter/package/rule/version/revision、source/load/priority/override、
resolution/reason/finding。它不为这些新增 projection 增加原始 filesystem path、content、敏感值
或可重放写 payload；v0.1 与冻结 contract 已允许的 detail/display-only 字段保持原有披露合同，
本 addendum 不缩窄或改写它们。`unknown`、`blocked`、`stale` 一律 fail-closed。该限制仍由
`ARC-02b` 的 ingress/最小 event 披露、`ARC-03` 的 `GatewayCore`/`AdapterRegistry` 归属以及
`ARC-06c` 的封闭 DTO 校验共同治理。

## 4. foundation ownership 与计划 evidence

`ORCH-UI-B2-01：方案 B（采用基础设施归属 A）` 相对 v0.1 的 FE-01 foundation owner，
将 foundation transfer 给 FE-07R。FE-07R 在其 vertical slice 中接管最小 Tauri
bootstrap/harness、L0–L3 骨架，以及未来在该 slice 创建或调整的
`TICKET_REGISTRY`/orchestration、ticket-driven manifest metadata、只读 `AdapterRegistry`
provenance seam、resolver 与 actual-read snapshot。FE-01 只复用该 foundation，不重建它。
FE-07 仍负责项目 lifecycle/index；FE-07R 不取得该责任。

| Ticket | 计划 evidence row | 不可推断事项 |
| --- | --- | --- |
| FE-07R | `FX-19`；L0/L1/L3 actual-read；无 L2、无 PF。 | 无业务写入、项目 lifecycle/index、prepare/apply 或 UI；其 provenance 不可借给 FE-01 closure。 |
| FE-01 | 自身 L0/L1/L2/L3 start/read/event/reread 与 PF-01；可使用 FE-07R foundation/snapshot。 | 必须在自身 ticket 取得自身 provenance；不得把 FE-07R evidence 计入自身 closure。 |

这些是计划 evidence row，不是 runtime、actual-read 已运行结果或 ticket closure。后续 FE-07R
vertical slice 才可实际创建/调整 registry、orchestration 与 ticket-driven manifest metadata；本次
不改 `TICKET_REGISTRY`、manifest 或任何可执行验证命令。

## 5. ARCH-GATE 复核决定与停点

`ARCH-GATE` 维持 `closed`，逐项依据如下：

- `ARC-02b` 已定义唯一 UI seam、现有 `read`/`prepare`/`apply` command 与单一 invalidation
  event；本次只扩展未来 read DTO，不增加 command/event 或写入入口。
- `ARC-03` 已将 read 编排、`AdapterRegistry` provenance、解析与 index/lifecycle 的责任分离；
  FE-07R 的 foundation/ticket ownership transfer 不改变这些 runtime owner，也不新设 trust seam。
- `ARC-06c` 已定义 Rust-first canonical wire source、单一版本、生成 declarations、正负 vectors、
  drift gate 和 provenance-separated L0–L4；breaking DTO delta 有既定落实路径。

只有未来出现新的 command、新的信任边界，或新的 serialization 事实源时，才重新评估并重开
`ARCH-GATE`。文档、Mock、OpenSpec 或 static 检查均不是 runtime/ticket closure evidence。

本阶段不更新 tracker、DAG、README、`RELEASE-GATE`、FE acceptance、`TICKET_REGISTRY`、
manifest、wire、Gateway、Adapter、UI 或 runtime；frontier 保持不变。仅在后续 task 1.10–1.23
完成相应 acceptance、规划 artifact 和 gate/frontier 重算时，才允许更新或重算这些对象。
