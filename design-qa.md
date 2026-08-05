# Agent Config Manager selected B2 v2：设计 QA

> 2026-08-03 注：本文是本轮产品调整前的 v22 收尾证据。后续 selected 候选已在 `src/prototypes/full-ui-mock/UI_CHANGE_IMPACT.md` 登记：Hooks 暂从 selected 移除，Skill 收敛为结构化查看与会话内多 Agent 启停预览，并新增项目自有／全局适用 A、B、C 三种布局。下列旧检查点仅作历史证据；`final result: blocked` 不变。

## 验收对象

- 派生基线：`6c6a6bf85dd84e3dfec2201478d9fff5d2f5be5d + local_overlay_sha256 b1c36114bb83676998f37949ed695b89332fb664a8866fc27ab0a0bd98489a69`
- 原型入口：`/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=0`
- 视觉参考：`reference-b2.png`，SHA-256
  `7dc497be34dca44d4f29c1cf0b11adab9c36cd6322a9ac549ecf5b797766a4ff`
- v1 验收输入：`browser-qa-v1.md`、`gate-log.md`、三张拒绝证据截图及
  `reviewer-state-responsive.md`
- 实现范围：只重构 `selected`；A、B、C 继续作为历史方案证据。

## v2 修正检查点

1. selected 图标固定使用 `lucide-react@1.28.0`；不存在 `b2-icons.tsx` 或其引用。
2. 一级上下文栏只保留“全局配置”“项目配置”及项目列表；管理入口留在顶栏。
3. Skill 浏览详情只显示结构化信息；文件、文件树和源码只在 Edit 中出现。
4. 真实窄窗口使用“上下文 → 类型 → 列表 → 详情／旅程”单一主表面。
5. dirty guard 只暂存目标转换；继续编辑保持原上下文、原资产和 selected 编辑器。
6. dirty + 全局搜索切换会先关闭搜索，再显示唯一的放弃确认；继续编辑恢复 textarea 焦点。
7. 成功 Apply 会把已确认草稿写回当前会话的 Mock 内存资产快照；刷新按 URL 起点重置。
8. 多文件 Review 自动聚焦首个真实变更文件，并提供带 changed 标记的文件导航。
9. Review、Focused Confirm 与 Outcome 共用同一实际变更文件计数。
10. Convert 的 conflict／failed 返回 capability mapping／review，保持 `dirty=false` 且不制造源码草稿。
11. selected Outcome 使用正常内容流中的紧凑网格，不再继承旧的全高居中表面。
12. Browse、Detail、Edit、Create／Import、Convert、Review、Confirm、Outcome 与 Manage
    使用轻量、薄分隔、低圆角、无重阴影的 B2 语言。
13. `controls=0` 保持干净模式，`controls=1` 显示开发控制条；selected 不暴露 Recovery。
14. 所有数据和操作仍是内存合成 Mock，不访问 Gateway、Tauri、网络、真实磁盘或用户数据。

## 本环境实际执行结果

### 通过的补充检查

- TypeScript 语法解析：8 个相关 TypeScript／TSX 文件全部通过，退出码 0。
- 全局 TypeScript 5.8.3 + 临时声明补充检查：退出码 0；启用了
  `--noUnusedLocals --noUnusedParameters`。该检查不替代仓库固定依赖下的 `tsc -b`。
- 源码／契约 smoke：退出码 0，输出 `v2 source smoke assertions passed`。
- 可执行模型 smoke：先把 `types.ts`、`b2-data.ts`、`b2-model.ts` 编译到临时目录，
  再验证 changed-file、首个变更文件、内存快照写回、20／50 分页模型和 controls 解析；
  编译与执行均为退出码 0。

### 未通过或受环境阻断的固定门禁

- `npm run verify:toolchain`：退出码 1，2/10 项通过。当前环境为 Node `v22.16.0`、
  npm `10.9.2`、Linux x86_64，且没有 Rust、Xcode 或 Chrome；锁文件结构检查通过。
- `npm run verify:static`：退出码 1，2/9 项通过。以离线模式执行，Corepack 无法取得固定
  npm `11.16.0`，Rust 命令不存在；禁止依赖与敏感占位值守卫通过。未得到真实的
  Prettier、ESLint 或项目 `tsc -b` 结论。
- `npm run test:frontend`：退出码 127，`vitest: not found`。
- 聚焦测试命令：退出码 127，`vitest: not found`。
- `npm run build:frontend`：退出码 1，缺少 `vite/client` 和 `node` 类型定义。

## 证据边界

- v1 截图和只读审查只用于定位拒绝项，不能证明 v2 已通过。
- 当前环境未启动 Vite，未执行 v2 的 Browser／IAB 宽、中、窄画面、控制台或交互验证。
- 静态 smoke、临时声明 typecheck 和模型执行不能替代固定工具链或真实浏览器 QA。
- Codex 第二轮验收仍需验证全局搜索、分页、详情／编辑、dirty guard、焦点、变更计数、
  Outcome、管理表面、A／B／C 隔离及参考图一致性。
- 本次没有执行 commit、push、创建 PR 或部署。

final result: blocked
