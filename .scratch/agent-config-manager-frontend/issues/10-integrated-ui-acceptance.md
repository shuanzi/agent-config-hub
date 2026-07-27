# FE-10 — FX-12 工作台可访问性集成旅程

**What to build:** 用户能够在已交付的只读工作台详情中，以键盘、窄窗口和减少动态效果完成 `FX-12 sensitive-narrow-keyboard` 的单一集成旅程。

**Blocked by:** FE-02 — 原生详情与多文件资产

**Status:** blocked

**Primary contract fixtures:** `FX-12 sensitive-narrow-keyboard`

**Accepted technical plan:** `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（2026-07-27）

- [ ] `FX-12` 通过 mock `FrontendGateway` 完成一条只读详情集成旅程；真实 adapter 全回归不在本票据内；
- [ ] 旅程只组合已由 FE-01/02 交付的资产列表、单个文本详情、文件树、原生内容和检查器，不重新验收其他 fixture；
- [ ] 资产列表、文件树、原生内容和检查器遵守已确认下限、上限、默认比例与栏宽记忆；
- [ ] “恢复默认栏宽”只作用于当前一级资产类型，共享栏宽记忆恢复为默认比例，不预先确认，也不影响其他类型；结果提示提供撤销并精确恢复操作前栏宽和记忆；
- [ ] 恢复栏宽的非模态提示位于工作区底部居中，默认显示 8 秒；悬停或键盘焦点进入时暂停计时，离开后继续；减少动态效果时直接切换结果；
- [ ] 可拖拽分隔线具有 1 px 视觉线、8 px 命中区及完整键盘调宽行为；
- [ ] 窄窗口按检查器后资产列表的顺序收拢，并按逆序和 64 px 回差恢复；
- [ ] 覆盖式浮层保持单实例、正确停靠、三种关闭方式和焦点恢复；
- [ ] 聚焦只能由内容工具栏显式进入和退出；进入时保留当前资产、文件路径、作用域、关键安全状态与多文件树，退出时恢复进入前布局以及当前资产、文件、草稿和检查器上下文；
- [ ] 聚焦、浮层和轻量反馈使用 160 ms 局部动效，减少动态效果时直接切换；
- [ ] 正文、焦点和非文本对比达到已确认目标，颜色不是唯一状态线索；
- [ ] 关键操作带可见文字，纯图标次要操作具有完整无障碍名称；
- [ ] 敏感内容默认遮蔽，显式临时查看的 `view` grant 在到期、切换资产或 revision 变化后失效，且明文不会进入缓存、索引、日志、事件或 fixture；
- [ ] 正常状态保持中性，当前只读旅程中的禁用原因和敏感状态在邻近位置可解释；
- [ ] 没有新增产品范围、替代工作台、批量操作或技术方案外依赖。
- [ ] 本票据只验证 FX-12；FX-01 至 FX-11、FX-13 至 FX-18 的主旅程，真实 adapter 全回归、构建、打包和发布负向范围检查只由 `RELEASE-GATE` 汇总验收。

## 验证命令契约

**状态：** `planned / unverified`

- **统一入口：** `npm run verify:ticket -- FE-10`；这是实现后的计划命令，尚未运行。
- **前置条件：** FE-02 已有 `done` 证据；bootstrap、生成 wire 类型与 `FX-12` 安全 fixture 可用；browser-mode runner 可注入 scripted mock `FrontendGateway`，不启动 Tauri 测试构建。
- **预计层级：** L0 检查变更源码、类型、格式、lint 与 wire/schema drift；L1 检查栏宽记忆/撤销、64 px 回差、焦点布局恢复和敏感 `view` grant 失效等 session 不变量；L2 以 scripted mock `FrontendGateway` 跑唯一的 `FX-12 sensitive-narrow-keyboard`，覆盖键盘、窄窗口、减少动态效果、浮层与焦点、敏感遮蔽和可见禁用原因；无 L3，且无新增 PF。
- **通过判据：** `FX-12` 在真实 browser event 下完成既有只读组合旅程，栏宽恢复、布局收拢/回弹、焦点和 grant 失效符合本票据；只接受 L0/L1/L2 的聚焦证据，不以测试文件、截图或 mock 调用数替代行为断言。
- **失败证据：** 脱敏日志、WebDriver trace、截图或 DOM dump、层级与 fixture 标识写入 `.artifacts/verification/FE-10/<run-id>/`。
- **Provenance 边界：** L2 mock PASS 不取得真实 IPC、磁盘、Keychain、Tauri lifecycle 或写入 credit；本票据刻意不运行 L3、不产生新的 PF 证据，也不接管真实 adapter 全回归、构建、打包或发布负向检查，这些仍属 `RELEASE-GATE`。
