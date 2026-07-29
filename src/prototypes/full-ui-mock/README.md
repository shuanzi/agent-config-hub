# Full UI Mock（throwaway）

这是用于整体 UI 评审的 throwaway React 原型，不是正式产品实现。

- 状态和合成数据只存在于内存，不读取或写入浏览器存储、文件、网络、Tauri、真实 Agent 配置、`FrontendGateway` 或 `WorkspaceSession`。
- 运行：`npm run mock:ui`；服务固定在 `http://127.0.0.1:1421/`。
- 默认入口：`/?prototype=full-ui&variant=A&journey=browse&scenario=ready`。

URL 参数：

- `variant=A|B|C|selected`
- `journey=browse|edit|create|convert|manage|recover`
- `scenario=ready|stale|readonly|dirty|conflict|degraded|blocked|failed`

刷新会依据 URL 重建旅程起点；草稿、面板状态和所有模拟结果都不会保存。

## `selected` 状态

集中验收一尚未进行，因此 `selected` 只作为第二阶段入口占位，暂时复用推荐起点 A。只有用户明确确认整体结构或混合方案后，才可固化选择并记录“选择、理由与拒绝项”。
