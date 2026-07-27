# ADR-0007：四个 Agent 使用统一 compatibility bundle

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

产品固定支持 Claude Code、Codex、Gemini CLI 和 OpenCode。官方声明式适配器可以按 Agent 独立发布，也可以组成一个统一 package，或拆成共享层与 Agent 子包。

需要在独立发布灵活性与 MVP 的签名、候选验证、原子启用、上一版本回滚和版本溯源复杂度之间取舍。

## 决策

- 四个 Agent 的声明式定义组成一个不可变官方 compatibility bundle；
- bundle 具有一个 package identity/version 和一组应用/引擎兼容范围；
- manifest 仍分别声明四个 Agent 的 adapter、Schema、能力矩阵、规则和模板版本；
- active、candidate 和 previous 都以完整 bundle 为粒度；
- 任一 Agent 或必须回归项失败都会阻断整个 candidate；
- `updateAdapterPackage` 与 `rollbackAdapterPackage` 只原子切换 SQLite 中的 bundle pointer，不修改原生资产；
- 每次操作记录 package version 以及实际源、目标 Agent 的内部版本；
- 不建立可独立发布的共享基础包、Agent 子包或 package dependency graph。

## 存储与启用

- 应用内置一个只读、已验证 bundle；
- 下载的 `bundle.manifest.json`、`bundle.tar` 和 `bundle.sig` 在隔离 staging 中经 `AdapterBundleVerifier` 完成签名、完整性、兼容性、USTAR 安全 staging 及回归验证；
- 通过后形成包含 signed manifest、signature 与 `content/` 的不可变 version directory；raw TAR 在 journal 终态与 fsync/rename 完成后可以删除；SQLite 只保存 active/candidate/previous pointer 和验证摘要；
- active 切换在一个 SQLite transaction 中同时更新 previous、active 和 candidate 状态；
- 启动和使用前检查 bundle identity、manifest digest 与正文完整性；
- built-in、active、candidate、previous 及非终态 operation 引用版本不得清理；
- package pointer 变化使相关索引投影和未应用 prepared operation 失效。

具体 artifact、JCS、USTAR、detached signature 与 verifier 责任见 `docs/architecture/adr/0018-jcs-ustar-adapter-bundle.md`。

## 结果

正向影响：

- 一套签名、下载、验证、候选、切换与回滚流程覆盖四个 Agent；
- 一次操作只需绑定一个 package generation，不会混用独立 package；
- active/candidate/previous 状态和故障恢复最小；
- 完整 bundle 可以离线内置并作为应用升级后的兼容 fallback。

代价：

- 一个 Agent 的变化也需要提升 bundle version 并回归四个 Agent；
- 一个 Agent 的问题触发回滚时，其他三个 Agent 同时回退；
- 发布体积与验证时间高于单 Agent package；
- bundle 级版本之外仍必须记录 Agent 级版本，不能用单一 package version 模糊溯源。

## 替代方案

### 每个 Agent 独立 package

局部发布和回滚影响较小，但需要四套 package 状态；跨 Agent 转换必须绑定并验证源、目标两个 generation。

### 共享基础包与 Agent 子包

可以单独复用公共规则并独立发布 Agent 内容，但需要依赖解析、兼容矩阵和多包原子切换。

## 重新评估触发条件

只有真实发布数据证明某个 Agent 的更新频率、bundle 体积或全矩阵验证时间持续阻塞兼容修复，才评估拆分为每 Agent package。拆分不得改变签名验证、候选回归、原子启用、previous 回滚或结果溯源不变量。
