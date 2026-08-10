# FE-07R — 只读项目适用性 foundation

**Acceptance state:** Frozen — 2026-08-10

**Ticket Status:** done — evidence run `20260810T071547Z`

**What to build:** 为 FX-19 建立最小、只读的 project applicability vertical slice：从 authoritative
read 投影 opaque `projectId`、Adapter identity/version 与明确的 `builtIn` 或 `activePackage`
（package identity/version）provenance、rule identity/version/source 及 authoritative revision，解析
all/global/project 视图所需的适用性事实，并保持 fail-closed。

**Blocked by:** 无 ticket；`ARCH-GATE` 的 closed record（2026-07-27）是唯一 gate 前置事实。

**Primary contract fixture:** `FX-19 project-applicability-projection`

**Frozen truth chain:** `docs/product/Agent_Config_Manager_MVP_产品决策基线_v0.2.md`、`docs/frontend/Agent_Config_Manager_前端契约_v0.2.md`、`docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md` 及其 `2026-08-10` addendum。

`Acceptance state: Frozen` 仅表示下列 acceptance 文本已锁定；它不等同本票据 `Status`、`done`、
actual-read 已运行、runtime evidence 或 `RELEASE-GATE` credit。

## Frozen acceptance

- [x] `projectId` 始终是只读 opaque identity；项目显示名或路径不能代替身份，也不能参与同名项目的适用性猜测。
- [x] 每个 query-bound actual-read snapshot 保留 Adapter identity/version 与明确的 `builtIn` 或 `activePackage`（package identity/version）provenance、rule identity/version/source，以及 authoritative read revision；不从缓存、展示名或路径合成这些事实。
- [x] 仅当上述 facts 与当前 authoritative 事实链精确匹配时，`resolved` 才可将全局资产投影到对应 `project(projectId)` 的全局适用段；任一不匹配必须成为 `stale`、`unknown` 或 `blocked` 并带稳定 reason code，只能作为 all/global 可检查 finding，不得进入 project 段。
- [x] `all`、`global`、`project(projectId)` 各自持有 query-bound actual-read snapshot，且均锚定同一 authoritative 事实链；不得混合 query shape，并保持冻结 contract 的固定段序；同名不同 `projectId` 仍是不同项目。
- [x] 全局 `AssetRef` 保持 global native ownership；project applicability projection 不创建项目副本、不改变 native ownership。
- [x] 本票据为自身 closure 仅建立最小 Tauri test-harness/bootstrap、L0–L3 骨架、计划的 `npm run verify:ticket -- FE-07R` validation command contract，以及只读 `AdapterRegistry` seam。
- [x] 只计划 L0/L1/L3 actual-read；不包含 L2 UI journey 或 PF。不得写入业务数据、纳入/停止管理项目、管理 index lifecycle、调用 `prepare`/`apply`，或实现生产 UI。

## 验证命令契约

**状态：** `verified / pass`。统一入口 `npm run verify:ticket -- FE-07R` 已实际运行；动态 evidence 位于 `.artifacts/verification/FE-07R/20260810T071547Z/`，final manifest 的 `runId` 与目录一致，绑定 commit `bcd06f41e83308b814a86eba271e51cd65fdb412`，且 `worktreeDirty=false`。

**前置条件：** `ARCH-GATE` 保持 closed；最小 bootstrap/harness、`FX-19` 合成 fixture、隔离测试数据根和测试构建均已就绪。不得读取、管理或写入真实用户项目或 Agent 配置。

**预计层级：**

- L0：本 slice 的静态、类型、生成物与 schema/wire drift 一致性；
- L1：opaque identity、Adapter/rule provenance、authoritative revision、resolver 与 fail-closed projection 的契约断言；覆盖上述 provenance/revision mismatch、稳定 reason code、all/global finding 可检查及 project 段排除；
- L3：专用 Tauri 测试构建以隔离的 FX-19 输入执行真实 `read`，并记录 authoritative all/global/project projection；
- 无 L2、无 PF；L0–L3 骨架不授权建立 UI journey 或性能测量。

**通过判据：** L0/L1/L3 均为 `pass`；FX-19 `fixture.json` digest 为 `7a9d47c3f452f6ab6c46bcb80e0e03145f0e676705deb8b87e73e3c934dfa127`。manifest 仅含 L0/L1/L3 actual-read steps，不含 L2、PF step、PF descriptor 或 PF budget metadata。L3 只证明隔离输入穿过真实 WebView／IPC／Rust core／磁盘 read 边界后的 actual-read，不证明真实用户项目、生产 app、DMG、签名或发布。

**Provenance 边界：** run `20260810T071547Z` 的 L1 覆盖 8 类 provenance/revision drift，L3 以临时复制的 synthetic FX-19 实际验证 mismatch fail-closed。独立只读复审已处理全部 P1/P2 finding，第二轮无 P0–P3。该 evidence 绝不能借给 FE-01 closure；FE-01 仍须保留自身 L0/L1/L2/L3/PF-01 evidence。
