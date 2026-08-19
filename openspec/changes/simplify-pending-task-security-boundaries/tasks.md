## 1. 用户确认与 formal 决策

- [ ] 1.1 让用户审查 `pending-task-audit.md`、trusted-runner 边界和目标执行顺序，并记录对 D7 每项的显式决定；未决定项保持原 formal requirement 与状态。
- [ ] 1.2 在任何影响 frozen acceptance、ticket/tracker/DAG、release gate 或真实产品安全边界的编辑前，创建并取得该编辑所需的独立授权；不得由本 change 的 planning completion 推断授权。
- [ ] 1.3 在用户选择 FE-03 WIP disposition 后，只读比较 6e5c dirty diff 与已确认的最小目标，并把保留、最小化或放弃的选择记录为后续受限工作项；不得重写历史 evidence。

## 2. 未来验证基础设施最小化

- [ ] 2.1 为获准的验证基础设施变更写出受信任 local/CI runner 前提、排除的同权限对抗/已攻陷环境，以及 exact relative-path allowlist、controlled evidence root、可检测 symlink 拒绝、leaf `O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验和异常 fail-closed 的验收。
- [ ] 2.2 对同权限对抗、native `openat` helper、跨平台安全文件系统和复杂 binary provenance 的任何新请求建立独立 threat-model decision；在获得明确授权前不得把它们加入功能完成或 closure 前置。
- [ ] 2.3 仅在 formal product/ticket source 已确认并冻结最小 acceptance、且实际出现共享需求时，设计满足该 acceptance 的最小公共 preflight/registry/manifest/verifier seam；verifier 不得反向定义或扩大 acceptance，formal closure 也不得成为其前置。保持每个 ticket 的 run identity、层级和 closure credit 独立，且不发明当前 verifier 不支持的命令或自动状态机。

## 3. 功能优先的 ticket 执行

- [ ] 3.1 对每个获得授权的 ticket，先实现其最小功能契约、L0/L1、必要 L2 和真实产品安全负例，并以该 ticket 自身的证据记录功能检查结果。
- [ ] 3.2 对涉及外部路径、敏感明文/grant/revision、apply/write/transaction/recovery、权限/跨资产隔离、不受信任 config/Adapter/extension/executable 或真实磁盘写入的 ticket，保留相应 fail-closed 产品安全验证，不以 trusted-runner 假设替代。
- [ ] 3.3 仅在产品 acceptance 已满足后，把 `functional complete` 和 `hardening pending` 作为报告语义记录；在当前 formal source 未经授权变更前，不将其自动映射为 checkbox、frontier、formal closure 或 release-ready 状态。

## 4. 后置 hardening 与 FE-03 路径

- [ ] 4.1 将 performance、stress、platform 和低概率对抗验证集中排入功能完成后的统一优化阶段；每个 ticket 使用自身输入、run identity、层级和 provenance，禁止跨票据借用 closure credit。
- [ ] 4.2 对 FE-03，先执行已确认的功能和真实 grant 安全边界工作；proposal 未经确认前继续暂停 native helper、edit-PF、formal comparison、`verify:ticket` 与 closure。
- [ ] 4.3 若用户决定保留 FE-03 edit-PF formal closure，按已确认的最小 trusted-runner 控制建立独立 edit identity 与代表性 read/edit 隔离负例；不得复用或改写 FE-02 的 read evidence、budget、waiver 或历史 lineage。
- [ ] 4.4 只在用户逐项批准 exact budget/freeze 输入后，执行 FE-03 的 budget/comparison/closure 工作；未批准或结果 fail/inconclusive 时保持 non-closure，不推进 frontier。

## 5. Formal closure 与 release

- [ ] 5.1 对每个 ticket，只有在其仍有效的 formal acceptance、独立 provenance 和独立 review 都满足时，才按获准的 tracker/gate 流程考虑 formal closure；review 本身不提供 closure credit。
- [ ] 5.2 只在全部所需 ticket closure 与既有 release requirement 实际满足后，执行 release 前综合 gate；不得以聚合检查替代任一 ticket 的产品或 provenance 验收。
- [ ] 5.3 对任何仍存在的 tracker/gate/verifier 冲突，保留来源和层级，另行请求用户裁决后再修改 formal source；不从文档、mock 或 planned command 推断 done 或 release ready。

## 6. 变更验证与审查

- [ ] 6.1 对未来获准的每个小范围 change 运行其 change-scoped strict OpenSpec validation、all strict validation、目标 Markdown formatting、diff whitespace 和 changed-path audit。
- [ ] 6.2 在每个未来 change 完成后进行独立 Standards/Spec 双轴 review；先修复有效 finding、重跑受影响验证，再报告其结果，且不将 review 误报为产品或 closure evidence。
