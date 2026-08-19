## Context

参见 [proposal.md](proposal.md) 的动机。本设计只为 planning artifact 定义今后如何重排未完成工作；它不改变产品、验证实现或任何 formal source。当前两个 active changes 仍分别有 51 项和 26 项 unchecked task。clean baseline 只有 FE-01、FE-02、FE-07R 的 registry entry，且没有 `.artifacts/`；因此文档中的 stable pointer 只能被记录为历史指针，不能在本轮重新证明其物理 provenance。

formal sources 还存在必须保留而不可在本 change 裁决的差异：

- `TEST-EXECUTION-ORDER.md:474` 的历史 registry 声明仅含 FE-01/FE-07R，而当前 `ticket-registry.mjs` 含 FE-02、FE-01、FE-07R；二者按历史与当前实现层级并列记录，不反写或据此推断其他 ticket command 已建立；
- `TEST-EXECUTION-ORDER` 的历史 FE-02 snapshot 与当前 tracker 的状态不同；
- `ARCH-GATE` 的 FE-07R candidate snapshot 与当前 `done` 记录不同；
- ticket 的 `ready-for-agent` 与其验证资料的 `planned`/`unverified` 属于不同层级；
- `RELEASE-GATE` 的统一 command 仍为 `not-established`；
- 历史 FE-02 PF failure、waiver 与 accepted-with-waiver 仍是历史结论，不能删除、重写或拿来给其他 ticket 记 credit。

## Goals / Non-Goals

**Goals:**

- 用一个受信任 local/CI runner 的明确威胁模型，将产品安全、验证基础设施防误用和理论 hardening 分层。
- 让每项 pending task 都有可追溯的最小 acceptance、分层验证、disposition、provenance 与 residual risk，而不修改原 task。
- 将未来执行固定为功能契约和最小实现、L0/L1、必要 L2、真实产品安全负例、`functional complete`、统一后置 hardening、release 前综合 gate 的有向序列。
- 让共享 runner、manifest、registry、preflight 和 verifier work 在未来只承担一次公共职责，避免每个 ticket 重复证明同一验证基础设施事实。

**Non-Goals:**

- 不运行 `openspec-apply-change`，不实现或删除任何产品、测试、verifier、registry、budget、collector、descriptor、fixture、evidence 或 gate。
- 不修改 frozen product acceptance、现有 release gate、ticket/tracker/DAG 或真实产品安全边界；这些都需要用户显式决定及后续独立 apply。
- 不把 trusted-runner 假设延伸至外部项目输入、真实业务数据、授权或写入边界。
- 不判断 FE-03 dirty WIP 应被保留或放弃，也不写入 `/Users/xiquandai/.codex/worktrees/6e5c/agent_config_hub`。

## Decisions

### D1：以 formal source 分层记录，而非合并冲突

审计矩阵以 active OpenSpec checkbox、ticket/tracker、DAG/frontier、gate 和 verifier/registry 各自的原始声明记录事实。出现冲突时，矩阵保留来源、层级和影响，且只提出 future disposition；它不改变任何 source，也不把 planning completion 当作 ticket completion 或 closure。

替代方案是选定一个文件作为本轮唯一真相并回写其他文件。该方案会重写历史结论、预先裁决 release/ticket 状态，故拒绝。

### D2：验证基础设施采用受信任 runner 模型

验证基础设施的信任边界是受信任的本地或 CI runner。它不要求防御同一用户权限恶意并发进程主动交换目录，也不防御已被攻陷的开发机、CI worker、工具链或仓库。未来最小防误用仍保留：exact relative-path allowlist、controlled evidence root、可检测 symlink 拒绝、leaf `O_EXCL`/`O_NOFOLLOW`、同一 fd 读写、写后校验和异常 fail-closed。

这些控制防止普通配置、路径或文件误用；它们不提供同权限恶意进程下的原子安全保证。因此不为该模型新增 native evidence-only `openat` helper、跨平台安全文件系统或复杂 binary provenance。若未来需要对抗这些排除项，应单独立项并先取得用户对成本、平台和威胁模型的确认。

### D3：真实产品安全与 runner hardening 不可互相替代

以下风险留在产品安全层，未来仍须有与实际产品边界相称的负例和 fail-closed 验证：外部项目根目录的 traversal/symlink escape；敏感明文、authorization grant、revision/stale；apply/write、transaction、recovery point、权限和跨资产隔离；不受信任 config、Adapter、extension 或 executable；真实业务数据和磁盘写入。

因此，FE-03 的 grant invalidation/re-masking、FE-04 的 transaction/revision/recovery、FE-07/FE-09 的外部路径和文件边界、FE-08 的不受信任 Adapter/bundle 都保留为产品安全工作。与之相反，只保护 trusted runner 自身证据目录的复杂物理 provenance 或同权限目录竞争证明，归为验证基础设施或理论 hardening，不能阻塞功能完成。

### D4：以任务分类和公共能力替代逐票重复证明

审计使用四个可叠加类别：产品功能、产品安全、验证基础设施、理论 hardening；独立 review 与 release governance 单列而不产生 closure credit。未来 apply 仅在有已确认需求时建立公共 preflight、registry/manifest/verifier route 或 test helper；每个 ticket 保留自己的产品 acceptance 和 evidence identity，但不得各自复制 runner、evaluator、manifest、freeze/history 或相同的负例矩阵。

审计观察到的是**计划文本可能形成的相互前置风险**：ticket acceptance、formal contract 与 verifier capability 若彼此要求对方先完成，就会产生循环；当前实现未观察到 runtime cycle，registry 也只含已完成的 FE-02、FE-01、FE-07R。未来拆解必须单向进行：先由 formal product/ticket source 确认并冻结最小 acceptance，再只建立满足该 acceptance 所需的最小 verifier capability，最后才执行该 ticket 的 formal closure。verifier capability 不得反向定义或扩大 acceptance，formal closure 也不得成为建立 verifier capability 的前置。

对同一 provenance 事实，未来只需要一个 canonical ticket/run identity、controlled root 和明确 manifest binding；多个 digest、pointer、stable index、immutable blob 或 history 只有在证明不同事实时才保留。该简化绝不删除历史 evidence，也不允许跨 ticket 借用 closure credit。

### D5：功能完成、hardening、closure 与 release 的顺序

每个功能 slice 的目标序列为：

```text
功能契约 + 最小实现
  -> L0/L1 功能测试
  -> 必要 L2 产品 journey
  -> 真实产品安全负例
  -> functional complete
  -> performance / stress / platform / 对抗 hardening（统一优化阶段）
  -> ticket formal closure
  -> release 前综合 gate
  -> release ready
```

`functional complete` 和 `hardening pending` 是人工报告语义，不是当前 verifier 的新状态机、命令或自动 enforcement。前者只表明该 ticket 的最小产品 acceptance、所需 L0/L1/L2 与真实产品安全负例已完成；它不代表 performance/stress/platform hardening 已通过。未经授权修改 formal source 时，两者不可自动映射为 checkbox、frontier、formal closure 或 release ready；`hardening pending` 也不可伪装为通过、给 release credit 或借用别票 evidence。`formal closure` 和 `release ready` 继续受其各自当前 formal gate 约束，直到用户明确决定要如何调整 frozen acceptance 或 release requirement。

### D6：FE-03 的安全最小化和 WIP disposition

FE-03 的先决建议是先将 formal runner 威胁模型收窄到 D2，然后再决定 WIP 的最小化方式。proposal 确认前，native helper、formal comparison、PF、`verify:ticket` 和 closure 继续暂停。未来的功能阶段保留 draft、dirty guard、unknown preservation、grant invalidation/re-masking、L0/L1 与必要 L2；不取得 L3、actual Tauri IPC、真实 authorization 或磁盘写入 credit。

现有 dirty WIP 没有在此设计中被裁决。用户确认之后，未来 apply 只能在不改历史 evidence 的前提下选择并记录以下一种明确 disposition：保留与最小目标一致的部分、最小化为受信任 runner 所需控制，或放弃并从 clean target 重建。任何选择都必须单独检查 6e5c 的 dirty diff，且本 change 不执行该检查或写入。

### D7：需要用户显式决定的边界

下列事项不能由此 planning change 自动改变：

- 是否改变任何 frozen product acceptance、FE-03 PF 作为 formal closure 前置条件的语义，或 ticket/checkbox/frontier 状态；
- 是否改变 release gate、release command 或 release-ready 门槛；
- 是否把性能/PF 从当前 formal closure 前置移动为后置 hardening，及其对票据完成语义的影响；
- 是否采纳 FE-03 dirty WIP 的保留、最小化或放弃 disposition；
- 是否为同权限对抗或 compromised runner/toolchain 建立额外 hardening 项目；
- 任何会弱化真实产品安全边界的建议（本 design 不提出此类建议）。

## Risks / Trade-offs

- [性能问题在功能完成后才暴露] → 保留独立性能阶段和自身 PF lineage；未知性能明确标为 hardening pending，不影响功能事实。
- [受信任 runner 被攻陷或被同权限对抗者操纵] → 明确作为不在本模型内的 residual risk；如业务风险改变，再以单独 threat-model change 处理。
- [共享基础设施可能重新耦合各 ticket] → 仅共享无状态公共能力；ticket identity、产品 acceptance、run identity、层级与 closure credit 始终独立。
- [formal source 冲突导致错误推进] → 矩阵并列记录冲突并把状态改动留给用户确认后的 future apply，不从文档或 mock 推断 ready/done。
- [FE-03 旧 WIP 被误当成可复用 closure 输入] → proposal 确认前维持暂停；即使以后保留，也只能是待重新核验的实现输入，不能改写或替代历史 lineage。

## Migration Plan

本 planning change 没有部署、数据迁移或运行时 rollback。其唯一可提交内容是本 change 目录中的 OpenSpec 文档；撤回即不合并该 planning change，现有 product code、evidence、tracker、gate 和 WIP 均保持不变。

在用户审查并明确确认后，future apply 的最小迁移顺序是：先把审计矩阵中的公共 preflight/verification 责任与产品 acceptance 逐项映射到正式 change；再先交付每个产品 slice 的功能和真实产品安全负例；随后集中排期 performance/stress/platform hardening；最后仅按仍有效的 formal ticket/release gate 执行 closure/release 验证。任何会触及 D7 的项目先停止并回主任务请求显式决定。
