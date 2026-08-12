# ADR-0013：通过真实 tracer 校准并冻结性能预算

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

产品基线没有数值性能 SLA，当前仓库也没有可运行实现、release-like artifact 或固定 runner 的测量证据。技术方案仍需确定性能验收范围和责任，但直接填写毫秒或内存阈值会制造虚假精度；完全不设置预算又会让退化累积到发布。

## 决策

- 技术方案阶段冻结 PF-01 至 PF-07 descriptor、指标、参考环境字段、统计方式、责任票据和预算变更规则；
- 当前不填写无证据的数值，所有性能状态保持 `unverified`；
- 每个 surface 的首个可运行 tracer 在对应票据完成前生成 baseline；
- baseline 同时产生 absolute experience ceiling 与相对 regression allowance，并写入版本控制的预算 manifest；
- 后续直接依赖该 surface 的票据开始前，预算和命令必须可运行；
- `RELEASE-GATE` 在固定 reference environment 复测全部预算，并单独测量生产 artifact；
- 性能数据只本地输出结构化证据，不上传遥测或建立在线服务。

### FE-01 PF-01 的 development acceptance profile

FE-01 的 `PF-01` 是 development acceptance profile：L2 只在 Vite dev/mock renderer 上取样，L3 只在隔离 fixture 根的 debug test-harness 上取样。它不是 reference-Mac 测量、release-like artifact，也不是 `RELEASE-GATE` 的通过证据。`RELEASE-GATE` 仍保持 blocked，未来必须在独立的 reference/release environment 重新取得 production artifact 与预算复测证据。

冻结的 measurement contract（descriptor、L2/L3 方法、fixture、runtime/toolchain、buildEnvironment 与统计）和每次 run 的 SUT/build identity 分开校验：前者漂移才是 measurement drift；后者以每个 run 的 binary、Git build inputs 和 provenance 自证。历史 run 始终按其 subject commit 的 descriptor digest 校验，不能把后续补全的 descriptor 倒灌为旧采样的方法。

## Fixture 与证据边界

- performance fixture 只使用确定 seed 的 synthetic 内容、路径和占位敏感值；
- descriptor 记录资产/文件数量、目录深度、字节、行数、diff、finding、事件和事务分支等形状维度；
- `representative` 与 `stress` profile 的精确值由首个 tracer 校准；
- `stress` 不是产品支持上限，也不扩展 MVP；
- 记录 commit、artifact、runner、OS、toolchain、fixture digest、原始样本、p50/p95 和资源峰值；
- L2、L3 与 L4 测量分别保留 provenance，不能互相代替；
- 没有实际运行的 manifest、命令或设计不能取得性能通过状态。
- 数值 latency fail 只能由用户明确指定的、单次 exact manual disposition 接住；hard gate、污染、dirty、额外 violation 或 lineage drift 不可 waive，且 manual disposition 不得称为 automatic PASS。

## 不变量

- 安全校验、revision 重读、事务、敏感保护和回滚不能为性能达标而跳过；
- 性能 instrumentation 不记录内容、路径、搜索词、diff、Token 或 payload；
- runner 噪声导致的结果标为 `inconclusive`，不能通过任意删除异常值制造 PASS；
- 预算变更必须记录新旧值、原始证据和用户可见影响；
- 造成回归的同一修改不能同时放宽预算并宣称修复；
- 未经实际瓶颈证据不增加 virtualization、worker、sidecar、cache 或新索引。

## 结果

正向影响：

- 数值来自真实实现和固定环境；
- 首个 tracer 就建立可重复的回归基线；
- 无需维护外部性能服务或遥测；
- 性能优化仍受安全和产品边界约束；
- 不把假设规模转化为架构复杂度。

代价：

- `ARCH-GATE` 关闭时不会拥有已通过的数值证据；
- 每个首次引入的新 surface 需要在票据内完成一次校准；
- reference Mac 和 toolchain 变化需要重新建立可比较基线；
- 初次 baseline 审查会增加一个有限的票据步骤。

## 替代方案

### 现在冻结绝对阈值

通过判据立即清晰，但没有 artifact、fixture 和硬件测量支持，容易迫使实现针对错误数字优化。

### 只观测、不阻断

初期流程最轻，但无法阻止慢基线或渐进回归进入 release candidate。

## 重新评估触发条件

只有 reference environment 长期不可复现、指标无法关联用户可见 surface，或多台实际支持硬件显示单一预算明显失真时，才调整分层或预算模型。调整必须保留旧证据与迁移说明，不能静默覆盖历史 baseline。
