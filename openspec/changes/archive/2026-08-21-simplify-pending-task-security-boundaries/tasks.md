## 1. 用户确认与 formal 决策

- [x] 1.1 用户已审查 `pending-task-audit.md`、trusted-runner 边界和目标执行顺序；`design.md` D7 与审计的“本次受限 apply 决策记录”逐项记录方案 A，未获独立授权的 formal requirement 与状态保持原样。
- [x] 1.2 已在 D7 与审计记录本 apply 的授权/禁止边界：只迁移治理文档与未来任务编排，不触及 frozen acceptance、ticket/tracker/DAG、release gate 或真实产品安全边界；未来触及这些 formal source 仍须独立授权，不能由本 change completion 推断。
- [x] 1.3 用户已选择 FE-03 WIP“最小化”；已完成的只读 6e5c dirty-diff 比较与最小目标已记录为后续受限工作项，只保留功能/真实 grant 安全部分并停止过度 provenance/native-helper，不重写历史 evidence。

## 2. 未来验证基础设施最小化

- [x] 2.1 已写明未来获准验证基础设施变更的受信任 local/CI runner 前提、排除的同权限对抗/已攻陷环境，以及 exact relative-path allowlist、controlled evidence root、可检测 symlink 拒绝、leaf `O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验和异常 fail-closed 验收。
- [x] 2.2 已作明确的“不立项/residual-risk” threat-model decision：同权限对抗、native `openat` helper、跨平台安全文件系统和复杂 binary provenance 不加入功能完成或 closure 前置；若未来提出，须独立 threat-model 与授权。

## 3. 2026-08-21 MVP 治理补充 disposition

本节是新增治理记录，不替换或重新解释上方历史已完成项，也不表示尚未实施 ticket 的产品、L3、PF 或 release 工作已经通过。

- [x] 3.1 已将每票的最小 contract/implementation、L0/L1、必要 L2、真实产品安全负例、必要 isolated L3 与独立功能复审定义为直接 MVP `done` gate；不新增 `functional complete` 等并行正式状态。
- [x] 3.2 已明确外部路径、敏感明文/grant/revision、apply/write/transaction/recovery、权限/跨资产、不受信任输入和真实磁盘的 fail-closed 产品安全验证仍属于 MVP gate。
- [x] 3.3 原公共 preflight/registry/manifest/verifier、逐票 formal closure 与 FE-03 edit-PF/budget/formal 工作均作为 deferred unified release/optimization 输入；当前不新增 verifier、registry 或自动状态机，也不把 deferred 项称为通过。

## 4. 后置 hardening 与 FE-03 路径

- [x] 4.1 已将 performance、stress、platform 和低概率对抗验证编排为功能完成后的统一优化阶段；每个 ticket 使用自身输入、run identity、层级和 provenance，禁止跨票据借用 closure credit。
- [x] 4.2 对 FE-03，后续先按已记录的最小化范围独立复验功能和真实 grant 安全边界；本 apply 不恢复 WIP。evidence-only native helper 是方案 A 的排除/停止项，未来仅在独立 threat-model 与授权后才可立项；edit-PF、formal comparison、`verify:ticket` 与 closure 才是后置受限工作。未来 `functional complete` 只能人工赋予 FE-04 产品功能开发的排期资格，不推进 FE-03/FE-04 formal 状态。

## 5. 归并与归档补充 disposition

本节是新增治理记录，不替换或重新解释第 4 节历史完成项。

- [x] 5.1 已将 performance、stress、platform 和低概率对抗验证维持为功能完成后的统一 release/optimization；未来若仍需要 FE-03 edit-PF，只能采用独立 identity、受控非敏感输入和代表性 read/edit 隔离负例，当前未实现、未采集、未通过。
- [x] 5.2 预算/freeze/comparison 只在未来获授权的 release optimization 中按实际需要处理；当前没有 budget、waiver、formal closure 或 frontier credit。
- [x] 5.3 tracker/gate/verifier 冲突已由 `simplify-mvp-functional-done-gates` 的显式 apply 处理；本 change 的归档不自动推断 ticket done、release-ready 或通过。

## 6. 变更验证与审查

- [x] 6.1 已对本次获准的小范围 apply 运行 change-scoped strict OpenSpec validation、all strict validation、目标 Markdown formatting、diff whitespace 和 changed-path audit。
- [x] 6.2 已对本次 apply 完成独立 Standards/Spec 双轴 review；有效 finding 已修复并重跑受影响验证，最终两轴 P0–P3 均清零，且该 review 不构成产品、PF 或 closure evidence。

## 7. 当前治理归档边界

- [x] 7.1 每票不再以 per-ticket formal closure 作为 MVP done 前置；release-level reconciliation 仍须保留独立审查与产品/provenance 边界，且不替代任一 ticket 的安全负例或 isolated L3。
- [x] 7.2 本 change 可在当前治理 PR 合并后作为“已吸收的 pending-task 简化 planning”归档；归档不代表 deferred 产品、PF、budget、formal comparison 或 release hardening 已执行。
