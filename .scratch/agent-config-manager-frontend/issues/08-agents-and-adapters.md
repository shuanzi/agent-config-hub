# FE-08 — Agent 与适配器管理

**What to build:** 用户能够只读查看受支持 Agent 的安装与兼容状态，并安全检查、确认、启用或回滚官方适配器包。

**Blocked by:** FE-04 — 审查与安全应用闭环

**Status:** blocked

**Primary contract fixtures:** `FX-06 unknown-agent-version`、`FX-14 adapter-update-rollback`

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
