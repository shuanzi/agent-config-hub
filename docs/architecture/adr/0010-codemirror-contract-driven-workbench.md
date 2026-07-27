# ADR-0010：采用 CodeMirror 6 与契约驱动的工作台控件

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

MVP 需要在同一工作区承载源码编辑、多文件导航、统一差异、三方冲突和可调面板。产品基线要求原生内容优先，前端契约又规定差异结构由 gateway 返回、敏感明文默认遮蔽，因此不能把完整 IDE 或前端 diff engine 变成第二个事实来源。

## 决策

- 源码编辑使用 CodeMirror 6，并由项目内深 `SourceEditor` module 隐藏其类型和生命周期；
- 统一差异由项目内 `ContractDiffView` 直接渲染 `UnifiedDiff`，前端不重新计算差异；
- 三方冲突使用契约提供的引用、块身份和动作，文本 pane 可复用只读 editor，但前端不自动合并；
- 文件树使用项目内 WAI-ARIA 单选 tree，不增加 tree library；
- 可调面板使用 `react-resizable-panels`，由项目 wrapper 落实既定键盘规则、上下限和偏好写入；
- 角色图标使用 `lucide-react`，其他 UI 使用语义化 HTML、项目内小型 primitive 和局部 CSS；
- 不引入 Monaco、完整 UI kit、通用 diff engine、IDE shell、拖放、多选、LSP、终端或 command palette；
- 控件随用户行为票据纵向增长，不建立横向组件平台票据。

## Interface 不变量

- CodeMirror 类型不越过 `SourceEditor` module；
- editor model 绑定不透明资产、文件身份与 revision，路径不能充当身份；
- 草稿内容和 dirty 事实属于 `WorkspaceSession`，光标、selection、IME 和 undo history 才属于 editor adapter；
- `UnifiedDiff` 与 `ConflictResult` 是 diff/conflict 的唯一语义来源；
- 展开未变行、选择文件和调整面板都只改变 view state，不能授权写入；
- 敏感查看明文不进入 CodeMirror document 或 history；敏感修改只存在于有授权、短生命周期的专用表面；
- 文件树只导航当前资产的一个文件，不建立多选、拖放或物理文件级资产身份；
- 面板偏好只保存经约束的资产类型栏宽，不保存内容、路径、身份、草稿或敏感值。

## 结果

正向影响：

- 获得成熟的 IME、selection、undo 和大文本可视区域编辑能力；
- Rust/gateway 继续是差异和冲突权威，不产生前端算法漂移；
- 文件树与面板依赖保持小而明确；
- 用户旅程可以通过 mock `FrontendGateway` 使用真实控件验证；
- 不为 MVP 支付完整 IDE 和通用设计系统的运行时与维护成本。

代价：

- 需要自行实现契约专用的 unified diff renderer 和 WAI-ARIA tree；
- 项目 wrapper 必须补齐产品基线比通用 panel library 更具体的键盘、收拢和偏好规则；
- CodeMirror extension 需要严格 allowlist，避免逐步演化为 IDE；
- JavaScript 内的短生命周期敏感字符串仍无法保证可靠清零。

## 替代方案

### Monaco + 内置 diff

提供更完整的 IDE 和 diff 能力，但增加 worker、model URI、disposable、bundle 与命令体系，并可能与 gateway 的 authoritative diff 冲突。

### 原生输入控件与完全自研编辑器

第三方依赖最少，但需要自行承担 IME、undo、selection、大文本渲染和辅助技术兼容。

### 完整 UI kit 和通用 tree/diff 组件

可以快速获得较多 primitive，但扩大依赖与抽象面，且未必能严格实现已冻结的原生内容优先布局和键盘规则。

## 重新评估触发条件

只有真实 fixture 证明 CodeMirror 无法满足已冻结的文本编辑行为，或可访问性测试证明单一项目 primitive 无法在固定 Tauri WebView 上满足契约，才评估替换对应单点依赖。不得因偏好、未来 IDE 设想或未测量的性能担忧替换本决策。
