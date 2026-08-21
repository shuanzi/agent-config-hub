## 1. 最小架构与 Frozen planning truth 补充

- [ ] 1.1 在后续获授权的 apply 中，仅更新或补充最小 architecture addendum 与适用的 Frozen planning truth chain，固化 approved prepared-secret 边界；不得改写历史 evidence、已完成 checkbox、ticket/tracker 或正式状态。
- [ ] 1.2 将零到多个 segment-bound prepare 配对、双侧 ephemeral buffer、same-target revision-drift 的 unbound replacement、target/TTL 清零、single-use apply、authoritative reread cleanup 与 crash loss 明确交叉引用到两项 delta capability，不新增 command、apply plaintext、trust boundary、第二事实源或 progress domain。

## 2. 文档与静态架构复核

- [ ] 2.1 以 docs/static review 核对 prepared-secret 不进入 SQLite、journal、snapshot/recovery、draft、session snapshot、cache、可观察面、fixture/vector/golden、PF 或 evidence，且 journal 继续只保存无正文状态。
- [ ] 2.2 以 docs/static review 重新关闭 ARCH stop condition；若发现需要新 command、trust boundary 或 serialization source，则标记 `ARCH-GATE: reopen-required` 并停止，等待新的用户架构决定。

## 3. 用户冻结与 FE-04 恢复前置条件

- [ ] 3.1 对本 prerequisite artifacts 完成独立只读审查并修复有效 finding，取得用户对精确 prepared-secret 规则的显式验收/冻结；该审查与冻结不授予 implementation、L3、PF、`verify:ticket`、closure 或 frontier credit。
- [ ] 3.2 仅在用户冻结后将本 change 的 Draft PR 合并；只有合并后的新 main 才允许暂停中的 FE-04 原 ticket 恢复，且本 change 不自行恢复 FE-04。

## 4. 恢复后的独立 FE-04 gate

- [ ] 4.1 FE-04 恢复后，在其既有 ticket 中独立执行 3.25–3.28 的 public-seam RED→GREEN，不以本 prerequisite 或其文档/static review 替代任何实现检查。
- [ ] 4.2 FE-04 恢复后，在其既有 ticket 中独立取得 L0/L1/L2 与 isolated-temp L3 evidence，并保留其真实边界与无生产 artifact credit 的 provenance。
- [ ] 4.3 将 PF-04、`verify:ticket`、3.29–3.30、formal closure 与 frontier 维持为上述独立 gate 之后的后置工作；本 change 不执行、不勾选也不授予其中任一 credit。
