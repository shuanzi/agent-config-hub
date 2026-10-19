# 验收入口与证据

操作指南描述如何验证，报告记录当时实际执行的结果；历史截图或测试通过不代表当前提交已复测。设计源与设计导出见[设计入口](../design/README.md)。

| 类型 | 入口 | 范围 |
| --- | --- | --- |
| 操作指南 | [正式 App 操作验收](polished-ui.md) | 浏览器模拟命令、隔离桌面、目录维护及相关流程 |
| 验证方法 | [开发指南](../development.md#测试与证据) | 命令、工具链、隔离路径与各层证据边界 |
| 历史报告 | [2026-09-27 polished UI](polished-ui-results.md) | [截图与日志](evidence/2026-09-27-polished-ui/screenshot-manifest.json)，包含浏览器、真实文件及桌面实操 |
| 历史报告 | [2026-09-29 PR36 修复](2026-09-29-pr36-review-fixes.md) | 对应修复的验证及未完成边界 |
| 历史报告 | [2026-10-14 Skills 矩阵](skill-matrix-results.md) | [正式组件模拟截图](evidence/2026-10-14-skill-matrix/screenshot-manifest.tsv)，文件、重启及 CLI 证据在报告中分别说明 |

`evidence/<日期>-<主题>/` 保存已确认的运行证据。当前浏览器旅程输出到忽略目录 `.artifacts/ui/latest/`，不能自动覆盖入库证据。2026-10-17 的目录整理仅迁移既有证据，保留其原日期、内容与结论；不将迁移视为重做历史验收。
