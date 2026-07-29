# Full UI Mock（throwaway）

这是用于整体 UI 评审的 throwaway React 原型，不是正式产品实现。

- 状态和合成数据只存在于内存，不读取或写入浏览器存储、文件、网络、Tauri、真实 Agent 配置、`FrontendGateway` 或 `WorkspaceSession`。
- 运行：`npm run mock:ui`；服务固定在 `http://127.0.0.1:1421/`。
- 默认入口：`/?prototype=full-ui&variant=selected&journey=browse&scenario=ready`。

URL 参数：

- `variant=A|B|C|selected`
- `journey=browse|edit|create|convert|manage|recover`
- `scenario=ready|stale|readonly|dirty|conflict|degraded|blocked|failed`

刷新会依据 URL 重建旅程起点；草稿、面板状态和所有模拟结果都不会保存。

## `selected` 状态

集中验收一于 2026-07-29 明确选择方案 C（Asset Type Rail），因此 `selected` 固化为 C，并作为第二阶段完整旅程验收入口。

- 已选择：C，以窄垂直资产类型导航轨建立稳定的“资产类型 → 资产库 → 原生内容工作台”空间关系。
- 保留锚点：四类一级导航、双栏工作台、两行资产列表、原生内容主导以及辅助检查器。
- 未选择：A、B 仍保留在 throwaway 分支作为设计证据；用户没有给出更细的否决理由，原型不自行推断。
- 范围：该选择只确认 UI 编排方向，不修改产品能力、前端契约、技术方案或 FE-01～FE-10 依赖关系。
