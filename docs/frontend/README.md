# 前端说明

本文定义当前 UI 的数据与交互约定，产品行为见[产品说明](../product/README.md)，视觉基准见 [polished 清单](../design/agent-config-manager-ui/polished/README.md)。不复制历史 Demo 的候选功能。

## 导航与目标

默认为 Skills → 已安装 → 全部。一级类型为 Skills、长期指令、Subagents，设置在底部；第二级为全部、全局和真实项目。没有全局“当前 Agent”选择器。

读取使用 `ConfigContext`：`{kind: 'all'}`、`{kind: 'global'}`、`{kind: 'project', projectId}`。写入使用 `ScopeTarget`：`{scope: 'global'}` 或 `{scope: 'project', projectId}`。新操作在 all 中先选完整目标；行内、详情、更新与备份操作从记录派生目标，不能取页面顶部的集中操作目标。

同名项目以 `rootPath` 展示消歧，身份始终是 `projectId`。同名 Skill 的选择与操作必须包括完整目标，不按名称或单独 ID 合并。项目根不可用显示后端错误，不能回退到全局。

## 查询与反馈

React Query hooks 位于 [src/hooks](../../src/hooks)，命令薄封装位于 [src/lib/api](../../src/lib/api)。资产读取按上下文建立 query key；发现与更新检查按具体目标区分状态。mutation 成功使该类资产相关上下文失效，项目 registry 变更也使资产查询失效，避免改绑后保留旧路径缓存。

列表与详情从当前 query 派生。切换上下文、筛选或刷新使选中项消失时清空选择。pending 时限制重复提交；错误保留在相关表面，支持重新读取／重试，已知结构化错误映射为中文原因和建议。

加载、空、失败和正常状态分别表达。错误用 `role="alert"`，成功提示用 `role="status"`；未知错误不直接展示后端堆栈。

## 请求契约

命令参数通过 Tauri 使用 camelCase，Rust 函数参数通常为 snake_case。完整 DTO 以 [types.ts](../../src/types.ts)、[原生定义 API](../../src/lib/api/nativeSubagents.ts) 及对应 Rust serde 类型共同维护；下表仅记录容易混淆的边界。

| 场景 | 当前请求与结果 |
| --- | --- |
| Skill 安装 | `install_skill({skill, target, initialLocation})`；`initialLocation` 为 Agent 目录或全局 `shared` |
| ZIP 安装 | `install_skills_from_zip({filePath, initialLocation, target})`；系统单 ZIP picker 取消时不提交 |
| 投放与撤回 | `set_skill_placement({id, target, location, placed, expectedRevision})`，revision 来自当前目录状态 |
| 导入 | `preview_skill_import({selections, target})` → revision 与逐路径动作；确认后 `import_skills_from_apps({selections, target, expectedRevision})` |
| 指令读取／保存 | `get_instruction_documents({context})`；`upsert_instruction_document({target, kind: 'agents', content})`；返回实际 `paths[]` |
| 原生安装 | `install_native_subagent({subagent, target, agent})`，单个兼容 Agent；不使用 Skill 的 shared 或 initialLocation |
| 原生接管／保存／启停 | 使用 `identity` 和 `expectedHash`；链接接管还需 `confirmSymlink` |
| 原生更新 | 先 preview，应用时同时提交 `expectedHash` 与 `expectedRemoteHash` |
| 原生恢复 | `backupId` 与必要的 `expectedDestinationHash`，不接受跨目标重定位 |
| 设置 | 同步方式、目录覆盖和存储迁移分别调用专用命令 |

`SkillPlacement` 的状态为 `placed / absent / unmanaged / conflict`，并包含 path、physicalPath、aliases、reason、withdrawable、sourceIsTarget、revision。目录实际状态以该结果为准，旧 `apps` 布尔字段不能代替冲突和撤回判断。

## 主表面与草稿

Skills 使用五列：名称、来源、目标、投放位置、操作。桌面记录高 64px，32px 图标横排；完整路径、别名及原因通过可聚焦提示与详情读取。未接管进入预览流程，冲突或受保护位置禁用并展示原因，详情不得截掉目录清单。

长期指令和 Subagents 在宽屏工作区内采用 master-detail。指令直接编辑当前目标 AGENTS.md；原生定义在接管后编辑源码，保存结果来自真实命令。前端不提供通用跨资产事务、自动格式转换或旧 Demo 的全局 dirty-guard 保证；具体草稿行为按对应面板和测试维护。

设置页的同步方式即时生效，不能因此清空目录覆盖草稿；覆盖路径显式保存，存储迁移另行确认。多个 Agent 覆盖依次提交，出现失败应保留错误和未完成草稿。

## 响应式与可访问性

`>=1200px` 同时展示类型侧栏、上下文侧栏和工作区；设置跳过上下文侧栏。桌面 Header 66px，窄屏 58px。`<1200px` 使用类型 → 上下文 → 列表 → 详情的单表面导航，设置从类型页直接进入。

390px 下不产生文档横向溢出，Skills 保留横排 44px 目录操作区域，集中动作进入更多操作。侧栏有稳定选中语义，图标有可访问名称，列表可由键盘进入详情，返回时恢复触发项焦点。

`FocusedDialog` 管理初始焦点、Tab 循环、Escape 关闭和触发器焦点恢复。路径提示支持悬停及键盘聚焦，触屏可通过详情获取同样信息。颜色不单独承担状态含义。

## 验证入口

[浏览器验收](../acceptance/polished-ui.md#浏览器验收) 复用正式 App、模拟命令和文件选择取消流程，刷新重置样例。[真实桌面验收](../acceptance/polished-ui.md#隔离桌面验收) 覆盖真实文件及重启读回。旧 `prototype=full-ui` 只保留为历史测试对象。

L1 覆盖参数、缓存、目标隔离与草稿；L2 覆盖正式 App 的导航、弹窗、尺寸、错误重试与交互；L3 覆盖真实 IPC 及磁盘读回。现有测试入口见[开发指南](../development.md#测试与证据)。
