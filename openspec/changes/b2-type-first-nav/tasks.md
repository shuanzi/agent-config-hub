# Tasks: b2-type-first-nav

> 实施范围：throwaway Mock（`src/prototypes/full-ui-mock/`）。内存合成状态；不接触 Gateway/Tauri/IPC/真实文件系统；正式产物仅登记 UI-B2-01 处置与增补说明（UI_CHANGE_IMPACT.md），其余冻结。

## 1. 导航骨架

- [x] 1.1 两栏对调：第一栏渲染三类资产类型，第二栏渲染作用域选择器（全部／全局配置／各项目）；第一栏收窄至约 180px，1200–1360 与窄屏断点列宽同步，验收线：路径折行 ≤2 行、Agent 列不溢出
- [x] 1.2 默认落地为 Skills + 全部；URL 刷新起点、Prototype Controller 与 `b2DefaultContext` 相关默认同步调整
- [x] 1.3 作用域切换保持类型/筛选/排序/每页数量，变化回第 1 页；面包屑在"全部"时显示 `全部 › <类型>`

## 2. 全部视图聚合（cross-source-asset-grouping）

- [x] 2.1 列表装配层支持"全部"：聚合全局 + 全部项目的同类资产，按 全局适用 → 项目名 段序分段，空来源不出段
- [x] 2.2 段内筛选/稳定排序/分页独立生效，全段共享列网格（含 Agent 固定分列），分页以聚合结果为基数
- [x] 2.3 同名资产跨段独立成行，选择/详情/事务均按资产自身上下文运行
- [x] 2.4 项目视图保持"项目自有 → 全局适用"两段；全局视图只含全局资产

## 3. 窄屏与辅助路径

- [x] 3.1 窄屏栈调整为 类型 → 作用域 → 列表 → 详情，`b2NarrowStepForState` 与返回路径、焦点恢复同步
- [x] 3.2 全局搜索目的地提交适配类型优先（选择结果后提交类型 + 作用域 + 资产）
- [x] 3.3 内容型 master-detail 在各作用域（含全部）下行为一致；编辑区头部作用域标识常显核对

## 4. 测试与验证

- [x] 4.1 L1 系统性改造：上下文优先路径断言 → 类型优先路径；新增"全部"聚合、段序、空段、同名共存的模型/标记用例
- [x] 4.2 L2 journey 改造：导航路径、窄屏栈、搜索目的地按新 IA 重写；保留 guard/焦点/几何断言强度
- [x] 4.3 `verify:static`、`build:frontend`、focused ESLint/Prettier、`git diff --check`
- [x] 4.4 in-app browser smoke（宽/1280/窄）+ console 检查；真实密度下同尺寸截图对比
- [x] 4.5 独立 reviewer 复审；UI_CHANGE_IMPACT.md 登记（UI-B2-01 拒绝 + 本轮增补）

## 5. 依赖关系

- [x] 5.1 b2-state-scannability 归档完成后再归档本 change（其分段/badge 语义被本 change 复用）
