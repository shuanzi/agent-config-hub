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

## 2026-08-08：当前 selected B2 UI demo 验收

> 本节记录当前 selected B2 UI demo 的用户确认。上方 v22 的 `final result: blocked` 属于历史环境与历史证据，保持原样；本节不回溯改写该结论。

### 验收对象与结论

- 用户已确认当前 selected B2 UI demo。
- Branch：`codex/ui-detail-polish`；base：`5d4b4f3`。
- 原型入口：`http://127.0.0.1:1421/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=0&inherit=A`。
- 浏览器验收覆盖 `1586×992`、`1280×800` 与 `390×844`；控制台无 error。

### 当前实现验证

- `npm run test:frontend`：125/125 通过。
- `npm run build:frontend`：通过。
- focused WDIO：1/1 通过。
- L1：64/64 通过（新增跨来源分页边界回归）。
- 本轮变更文件的 Prettier 检查：通过。
- `git diff --check`：通过。
- `npm run verify:static`：9/9 通过。

### 证据边界

- 本节证明当前 throwaway Mock 的 UI／浏览器验收已被用户确认，不证明生产实现、真实配置写入、全局适用解析或 Agent enable intent 已完成。
- 上述测试、构建与浏览器结果不关闭 FE 票据、IPC、L3 或 L4 门禁；这些事项仍需要各自的正式实现与 provenance-separated evidence。
- 本次没有执行 commit、push、创建 PR 或部署。

## 2026-08-24：生产 UI 对齐 selected B2 Demo

> 本节是生产 UI parity 的最新验收记录。上方历史 `final result: blocked` 与 2026-08-08 Demo 验收内容均保留，不回溯改写。

### 验收对象与状态

- 视觉基准：`/?prototype=full-ui&variant=selected&journey=browse&scenario=ready&controls=0&inherit=A`。
- 生产视觉 fixture：`/tests/l2/workbench.html?fixture=visual`；默认 L2 空态 fixture 保持不变。
- 生产实现：`src/App.tsx`、`src/ui/workbench.css`、`src/components/{workbench,skills,subagents,instructions,settings}`。
- 验收状态：Skills 已安装列表与详情、Instructions 列表与详情、Subagents 列表与详情，以及 1199px/390px 单表面导航路径。
- 数据边界：视觉 fixture 只映射现有 DTO 字段；未伪造 Demo 的 version、project、scope 或 decision status。

### 视觉与结构对齐

- 宽屏壳层为 `66px header + 180px 类型 rail + 220px Agent rail + 主工作区`；设置固定在类型 rail 底部。
- 使用 Apple 风格系统字体、浅灰背景、白色表面、1px 分隔线、低圆角、克制蓝色选择态和紧凑行密度。
- Skills/Subagents 使用三列紧凑行或 master-detail；Instructions 使用可编辑 master-detail；Settings 延续相同 tokens 重排现有区块。
- 四个 Agent SVG 从 Demo 提升为共享资源，业务图标继续使用现有 `lucide-react`；无新增依赖、手绘占位资产或假窗口控件。
- 生产保留原生 Tauri 标题栏。Demo 的交通灯、全局搜索、项目作用域、继承、Hooks、跨 Agent 转换和 `prepare → review → confirm → apply` 均按锁定范围不进入生产 UI。

### 同状态截图证据

- `1586×992`：
  - Skills 列表：`output/playwright/ui-demo-parity/final/01-demo-skills-list-1586x992.png`、`02-production-skills-list-1586x992.png`。
  - Skills 详情：`01b-demo-skill-detail-1586x992.png`、`03-production-skills-detail-1586x992.png`。
  - 组合比较：`compare-skills-list-demo-left-production-right.png`、`compare-skill-detail-demo-left-production-right.png`。
- `1280×800`：
  - Instructions：`04-demo-instructions-1280x800.png`、`05b-production-instructions-list-1280x800.png`、`05-production-instructions-detail-1280x800.png`。
  - Subagents：`06-demo-subagents-1280x800.png`、`07b-production-subagents-list-1280x800.png`、`07-production-subagents-detail-1280x800.png`。
  - 组合比较：`compare-instructions-list-demo-left-production-right.png`、`compare-subagents-list-demo-left-production-right.png`。
- `1199×900`：`08-production-skills-list-1199x900.png`、`09-production-skills-detail-1199x900.png`，验证类型 → Agent → 列表 → 详情的单表面路径。
- `390×844`：`10-production-skills-list-390x844.png`、`11-production-skill-detail-390x844.png`；应用内浏览器实测 `innerWidth=390`、`scrollWidth=390`，进入详情聚焦“返回列表”，返回后焦点恢复原列表行。
- 宽中屏截图均以精确像素尺寸捕获，并逐图断言 `document/body scrollWidth <= innerWidth`。组合图使用相同 viewport、相同业务状态并排比较，不以单张截图代替判断。

### Findings 修复记录

- P0/P1 视觉 finding：无。
- P2：Skills Agent 控件最初显示复选框与文字，密度偏离 Demo；已收敛为带可访问名称的 logo-only 控件并重抓比较图。
- P2：窄窗程序化聚焦页标题会留下突兀默认蓝框；该非交互标题保留焦点语义但不绘制控件式焦点环。
- 独立复审发现已安装 Skills/Subagents 卸载缺少二次确认；已复用 `FocusedDialog`，仅保存目标 ID 并从当前 query 派生目标，取消不执行 mutation。
- 独立复审发现 Skills 列表/详情未恢复焦点；已补进入详情焦点与返回原行焦点，并在 L1、L2 和 390px 实际路径验证。
- 独立复审发现 Subagent 详情单项更新缺少 L2 覆盖；已补 visual fixture 的检查更新 → 详情更新 → 成功状态与更新消失断言。
- 最终独立复审未发现旧 Demo 产品语义回流、新依赖、后端/DTO 改动或需要上报的过度设计。

### 最终工程验证

- Node `v24.18.0` 下 `npm run build:frontend`：通过。
- `npm run test:frontend`：20 files、174 tests 通过。
- `npm run verify:static`：8/8 通过。
- `npm run test:ui`：5 spec files、38 tests 通过；既有 Demo click-retry 与 Prompt stale-element 日志最终均为通过。
- `npm run test:tauri`：L3 build 与真实 IPC smoke 1/1 通过；既有 test-harness 窗口切换/清理 warning 不影响最终结果。
- `git diff --check`：通过。

### 证据边界

- 本节证明生产前端壳层、主任务 UI、响应式路径和现有命令连接已完成本轮 parity；不恢复明确排除的旧 Demo 产品模型。
- 未修改 Rust、数据库、Tauri command、React Query hooks 或 DTO；未执行 commit、push、PR、部署或合并。
- 历史未跟踪 `output/` 保留；本轮截图集中在独立的 `output/playwright/ui-demo-parity/final/` 子目录。

final result: passed

## 2026-08-26：真实项目上下文与固定长期指令复验

> 本节取代上一节中“Agent rail”“不支持项目作用域”“未修改 Rust／DTO”等已经被后续产品决策替换的描述；历史内容继续保留，不回溯改写。

### 验收范围

- 宽屏壳层固定为 `66px Header + 资产类型 rail + 配置上下文 rail + 主工作区`；第二栏显示真实“全部／全局配置／项目配置”，当前 Agent 位于 Header 紧凑控件。
- Skills 与 Subagents 使用完整 ownership target，并由真实项目 registry、opaque `projectId` 和固定 resolver 支撑项目读写；根不可用时中文 `role="alert"` 封闭失败。
- 长期指令每个 target 只管理 `CLAUDE.md` 与 `AGENTS.md`。前者只适用于 Claude Code，后者只适用于 Codex 与 OpenCode；不显示 Gemini CLI，不提供预设、导入、删除或 Agent enable。
- 旧 Prompt service／DAO 仅保留原有 global legacy 数据兼容；早期未暴露的项目 Prompt、`GEMINI.md`、enable／backup target 扩展已移除。

### 同状态截图证据

截图集中在 `output/playwright/ui-project-scope-parity/final/`：

- `1586×992` Skills：`01-demo-skills-list-1586x992.png`、`01b-demo-skill-detail-1586x992.png`、`02-production-skills-list-1586x992.png`、`03-production-skills-detail-1586x992.png`；
- `1280×800` 三列／master-detail：`02b-production-skills-list-1280x800.png`、`04-demo-instructions-1280x800.png`、`05-production-instructions-list-1280x800.png`、`05b-production-instructions-detail-1280x800.png`、`06-demo-subagents-1280x800.png`、`07-production-subagents-list-1280x800.png`、`07b-production-subagents-detail-1280x800.png`；
- `1199×900` 单表面路径：`08-production-type-1199x900.png` 至 `11-production-skills-detail-1199x900.png`；
- `390×844` 完整路径：`12-production-type-390x844.png` 至 `15-production-skills-detail-390x844.png`。

实际浏览器读数在 390px 的类型、上下文、列表、详情四个表面均为 `innerWidth = documentElement.scrollWidth = body.scrollWidth = 390`；详情初始焦点为“返回列表”，返回后焦点恢复到原 Testing Strategy 资产按钮。浏览器仅报告无业务影响的 `/favicon.ico` 404，没有应用运行时错误。

### Findings 与范围收敛

- P0／P1 视觉 finding：无。
- P2：项目根不可用的 query error 曾未进入 UI；已在 Skills／Subagents 已安装表面补充中文 `role="alert"`，L1 与 L2 均覆盖。
- 过度设计：早期旧 Prompt service 曾包含未暴露的项目预设、Gemini `GEMINI.md`、per-target enable／backup；已全部移除，仅保留 global legacy 数据兼容与新的固定文档 service。
- P1：项目 add／relink／remove 曾只失效项目列表；现已同步失效 Skills、Subagents 与长期指令查询，防止重新关联后把旧 root 的无限缓存内容保存到新 root。
- P1：Settings override 曾让 enabled legacy preset 参与新 live 文件迁移；现已完全移除 legacy Prompt 的读取、写入与备份，只迁移固定 live 文档投影。
- P2：项目 root 曾只检查 `is_dir()`；现已增加可列目录、可进入验证，目录存在但权限失效时稳定返回 `PROJECT_ROOT_UNAVAILABLE`。
- Demo 的搜索、Adapter/provenance、prepare/apply、跨 Agent 转换、继承和假项目数据均未进入生产实现。

### 最终工程验证

- `npm run build:frontend`：通过；
- `npm run test:frontend`：21 files、177 tests 通过；
- `npm run verify:static`：8/8 通过；
- `npm run test:ui`：5 spec files、43 tests 通过；既有 Demo click-retry 日志最终通过；
- `npm run test:tauri`：L3 build 与真实 IPC smoke 2/2 通过；opaque `projectId` 与重新关联后资产 target 保持已由真实项目 Skill 写入旅程验证；
- `cargo test --lib`：198/198 通过；
- `git diff --check`：通过；
- `npx openspec validate --all --strict --no-interactive`：归档前 6/6 通过。
- `npx openspec archive restore-project-scope-selected-b2-layout --yes`：已正式合并主规格并归档为 `2026-08-26-restore-project-scope-selected-b2-layout`。

### 当前结论

视觉、布局、项目作用域与固定长期指令的实现证据已齐备。独立 reviewer 的三条 P1/P2 均已修复并复核闭环，最终结论为无 actionable findings；未发现过度设计或过度审查项。

final result: passed
