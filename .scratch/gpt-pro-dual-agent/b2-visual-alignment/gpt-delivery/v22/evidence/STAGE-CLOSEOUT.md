# B2 v22 阶段收尾

## 结论

- v22 已通过隔离重放、技术门禁、独立审查和一次 Codex 内置浏览器最小 smoke，可供用户查看实际效果。
- 本结论仅表示“可预览”；UI 尚未由用户最终验收，`design-qa.md` 继续保持 `blocked`。
- 未把 v22 应用到原 B2 工作树，未 commit、push、创建 PR 或部署。

## GPT Pro 协作

- 模型：GPT-5.6 Sol Pro（不是 Sol 极高）。
- 对话：<https://chatgpt.com/g/g-p-6a60d6a96fe48191996b220b77b4f249-agent-config-manager/c/6a6daf68-8b6c-83ec-9911-93d773dd173d>
- Git 基线：`6c6a6bf85dd84e3dfec2201478d9fff5d2f5be5d`
- tracked overlay SHA-256：`85bf6766e328c28d4e58c7e997df2279e068e636b85b1b008c83cc71fa2afeab`
- 授权 untracked seed：`tests/l1/full-ui-mock-context.test.ts`，9304 bytes，SHA-256 `128fa738e5d0389a3416663f0af57dd822c076e6e5ffac0f7e31a780e82e9c6b`
- 完整派生源码包：526135 bytes，SHA-256 `48e54db815b46314317b9613831b3a5a0fe8dcc8ab2f092a356851b6014518e7`
- 上下文包：49914 bytes，SHA-256 `d526870b73952a76925e360d974eeb5bf8dca0a0b9dacf8dfc8987765e13de37`
- 参考图：1010642 bytes，SHA-256 `7dc497be34dca44d4f29c1cf0b11adab9c36cd6322a9ac549ecf5b797766a4ff`

## v22 最终交付身份

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `agent-config-hub-selected-b2-v22-full.patch` | 385518 | `d8fd0b4e35767ff2001e54229b912472634f9c681262b99b3ea620d756954712` |
| `agent-config-hub-selected-b2-v22-changed-files.zip` | 201225 | `9eb4f9d8431fcedb42e0ca7db60e84ca5c686c9f188e2548d18845c0d4b09a88` |
| `agent-config-hub-selected-b2-v22-manifest.json` | 21429 | `985fbfeed92d481b161aa03fe9003f3afd7d4dcd7c5021c77e2bc3eab1d5b4fa` |
| `agent-config-hub-selected-b2-v22-implementation-report.md` | 9503 | `4ddda3d72658797548620c3e128112f8ab9c9e9f85caa4dbb95d270f85f9c1a7` |

四件套、manifest→report、ZIP CRC/路径/权限、patch/ZIP/manifest/final tree 16/16、敏感扫描和 v21→v22 单文件格式差异均已独立对账。

## 本地独立验证

- `verify:toolchain`：PASS。
- `verify:static`：9/9 PASS。
- 聚焦 L1：62/62 PASS；全量 L1：108/108 PASS。
- `build:frontend`：PASS。
- B2 WDIO：21/21 PASS；full UI WDIO：29/29 PASS。
- L3 debug test-harness（真实 Tauri adapter）：PASS。
- `git diff --check`：PASS。
- `verify:ticket -- FE-01`：exit 2 / INCONCLUSIVE，仅因为 PF-01 `budget-not-frozen`；其余 L0-L3 均通过。
- 这些结果分别属于 Mock、测试浏览器和 debug test-harness 证据，不是 production 或发布验证。

## 内置浏览器 smoke

- 当前真实 IAB viewport：1075×964，DPR 2，命中窄窗单表面栈。
- 已走通：项目上下文 → Skills → 列表 → `testing-strategy` 结构化详情 → 编辑源码。
- 编辑页显示 `SKILL.md` 与 `references/usage.md`，textarea 获得焦点。
- `controls=0` 下控制器不存在；无页面横向溢出；采样 Agent 控件无内部裁切；console 无 error/warn。
- 当前对比图已经把参考图与实际 Skills 列表放在同一图中检查，但视口不同，只能用于定性判断，不能关闭 1586×992 的精确视觉验收。

## 仅登记的遗留问题

1. **P2，非 selected blocker**：底部控制器在 A↔B↔C 切换或重选当前旧方案时会重置资产、dirty 和 drafts；Alt+Arrow 行为不同。影响旧方案同状态比较，不阻止查看 selected。
2. **测试空白**：L2 使用 `controls=0/1`，但没有一条直接断言 `controls=0` 时 `.prototype-controller` 不存在。
3. **视觉证据空白**：尚未在 Codex 内置浏览器取得与参考图同状态、同 1586×992 viewport 的当前 v22 截图；因此不宣称视觉 QA passed。
4. **票据门禁**：PF-01 已采样，但预算未冻结；需要另行授权冻结预算后，FE-01 ticket 才可能从 INCONCLUSIVE 转为 PASS。

按用户要求，本阶段到此停止，不继续修改或发起 GPT Pro 修复循环；下一步等待用户查看实际效果并给出方向。
