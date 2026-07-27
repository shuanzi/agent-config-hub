# FE-08 — Agent 与适配器管理

**What to build:** 用户能够只读查看受支持 Agent 的安装与兼容状态，并安全检查、确认、启用或回滚官方适配器包。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** blocked

**Primary contract fixtures:** `FX-06 unknown-agent-version`、`FX-14 adapter-update-rollback`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] 展示 Claude Code、Codex、Gemini CLI 和 OpenCode 的安装状态、解析路径和版本；
- [ ] 缺失、未知或不兼容版本明确只读或阻断；
- [ ] UI 不提供 Agent 安装、升级、卸载或包管理器调用；
- [ ] Agent 检测与兼容展示只经 `read`；检查、启用、更新与回滚适配器包均为管理变更，必须先 `prepare` 再经明确确认 `apply`，不得绕过统一 gateway；
- [ ] 适配器候选展示版本、应用兼容范围、Agent 范围、能力和规则变化；
- [ ] 安装前需要明确确认，不自动改变转换行为；
- [ ] 签名、完整性、兼容或候选回归失败时保持当前版本；
- [ ] 成功启用以单一结果表达，不出现新旧规则混用状态；
- [ ] 可回滚到上一可用版本且不修改原生资产；
- [ ] 不提供第三方、自定义、社区适配器或绕过校验入口；
- [ ] 所有禁用态使用稳定原因码和邻近说明。

## 验证命令契约

**状态：** `planned / unverified`

- **统一入口：** `npm run verify:ticket -- FE-08`；这是实现后的计划命令，尚未运行。
- **前置条件：** FE-04 已有 `done` 证据；bootstrap、生成 wire 类型以及 `FX-06`、`FX-14` 的安全 fixture 可用；L3 使用专用 Tauri 测试构建、固定公钥和每次新建的合成已签名官方 candidate 根，不接触真实适配器包或 Agent 安装。
- **预计层级：** L0 检查变更源码、类型、格式、lint 与 wire/schema drift；L1 检查未知/不兼容版本的稳定原因码、签名/完整性/兼容/回归失败保持当前版本、候选原子启用与上一可用版本回滚；L2 以 scripted mock `FrontendGateway` 跑 `FX-06/14`，分别验证只读阻断与确认后的检查、切换、回滚表面；L3 只跑一次合成签名 candidate 的验证 → 原子切换 → 回滚 tracer；PF-07 记录合成 adapter-bundle descriptor 的验证、切换和回滚测量及 fixture digest。
- **通过判据：** 不出现 Agent 包管理调用、第三方入口或新旧规则混用；`FX-06/14` 的禁用、确认、失败保持和回滚结果符合本票据；L3 只在合成 candidate 上留下真实 command/event tracer；PF-07 留存原始样本、运行环境与 baseline/预算冻结记录，出现 `inconclusive` 不得计通过。
- **失败证据：** 脱敏日志、WebDriver trace、截图或 DOM dump、层级与 fixture 标识写入 `.artifacts/verification/FE-08/<run-id>/`。
- **Provenance 边界：** L2 mock PASS 不取得真实 IPC、签名验证或包切换 credit；L3 只证明该合成官方 candidate 路径，不证明生产发布 artifact、真实安装状态或全量真实 adapter 回归；PF-07 数据不替代行为或发布证据。
