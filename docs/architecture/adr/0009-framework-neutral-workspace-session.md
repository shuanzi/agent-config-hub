# ADR-0009：采用 framework-neutral 深 WorkspaceSession

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

前端需要同时表达 gateway snapshot、单一跨文件草稿、封闭 review/apply workflow、事件失效和大量纯视图状态。可以依赖通用 query/store/state-machine 库，也可以围绕当前单工作区约束建立一个深 module。

## 决策

- 建立 framework-neutral `WorkspaceSession`，注入 `FrontendGateway`；
- interface 仅包含 `getSnapshot`、`dispatch`、`subscribe` 和 `dispose`；
- React 通过 Context 和内置 external-store 订阅能力消费 session；
- gateway facts、local draft、workflow union 和 view state 在 implementation 中分层；
- workspace event 只触发 invalidation/read，旧异步结果不能覆盖新上下文；
- `apply` 只能派发一次，结果不确定时通过 `OperationProgressQuery` 对账；
- 敏感明文不进入 session snapshot，由短生命周期 helper 交给当前 surface；
- 只有按资产类型栏宽通过版本化偏好 adapter 持久化；
- 不引入 Zustand、Redux、TanStack Query、XState 或其他通用状态库；
- 不创建横向状态管理票据，module 随 FE tracer-bullet 纵向扩展。

## Interface 不变量

- `WorkspaceAction` 与 `WorkspaceViewState` 都是封闭、可判别 union；
- Gateway facts 只由成功 `read` 提供，不能由事件、索引提示或 view state 推断；
- 同时只有一个资产、一个 draft、一个目标、一个 prepared operation 和一个 apply effect；
- dirty draft 不被外部 revision 或旧 read 覆盖；
- prepared operation 只存在于合法 workflow variant，失效后必须重新 prepare；
- session 销毁后不再提交任何异步结果；
- 敏感 reveal 不进入持久化、日志、selector、开发工具或通用 cache。

## 结果

正向影响：

- 一个 interface 隐藏异步、失效、草稿和 workflow 协调；
- React view 不复制 gateway 调用顺序和状态机；
- 测试可在不渲染 React 的情况下覆盖核心前端旅程；
- 依赖数量和跨 store 同步最小；
- session 可随每个用户行为票据增量深化。

代价：

- 需要自行实现有限的 effect queue、request generation 和 selector；
- module 若缺少封闭 union 与 owner 纪律，可能演化为宽泛全局 store；
- 编辑器内部状态和敏感短生命周期 surface 仍需明确 adapter/helper；
- 不获得通用 query devtools、cache policy 或可视化 statechart。

## 替代方案

### TanStack Query + Zustand

提供成熟查询缓存与局部订阅，但 gateway facts、draft 和 workflow 会分属两个状态权威，需要额外失效协调。

### XState + TanStack Query

能够直接表达复杂状态图，但对一个资产、一个草稿和一个事务的 MVP 增加两套运行时与建模成本。

## 重新评估触发条件

只有产品基线加入多窗口、多资产草稿、并行事务、离线队列或多个独立长期 workflow，且真实实现证明单 session interface 无法保持深度时，才评估通用状态库。不得仅为调试工具或编码偏好替换已确认 interface。
