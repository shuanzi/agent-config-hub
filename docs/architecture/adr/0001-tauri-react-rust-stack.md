# ADR-0001：采用 Tauri 2、React/TypeScript 与 Rust core

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

Agent Config Manager MVP 仅正式支持 macOS，但产品基线要求解析、转换和校验逻辑保持平台无关。界面以浏览、编辑和审查原生配置为主，包含源码编辑、文件树、检查器与统一差异；所有系统能力必须通过框架无关的 `FrontendGateway` seam 提供。

该技术组合难以在实现中途低成本替换，并直接影响 IPC、安全、测试、打包和团队技能，因此单独记录。

## 决策

采用：

- Tauri 2 作为 macOS 桌面容器；
- React + TypeScript 作为 UI 运行时；
- Rust 作为核心业务与本地能力实现语言；
- `FrontendGateway` 作为 UI 唯一外部 seam，由 mock adapter 和 Tauri IPC adapter 分别满足。

本 ADR 不决定 Rust core 是否拆为 sidecar，也不选择 bundler、编辑器、状态管理、数据库或其他依赖。

## 结果

正向影响：

- Web UI 能直接承接高密度工作台和既有原型；
- 核心逻辑可保持独立于 React、Tauri UI 和 macOS 路径；
- 文件事务、revision 校验和敏感数据处理集中在 Rust 侧；
- gateway 契约测试可同时约束 mock 与真实 IPC adapter。

代价：

- 需要维护 TypeScript 与 Rust 两套工具链；
- IPC wire 必须显式版本化、校验并遮蔽敏感信息；
- macOS WKWebView 行为需要真实应用验证，不能只依赖浏览器测试；
- exact dependency versions 和构建命令必须在后续技术决策中固定。

## 替代方案

### Electron + React/TypeScript + Node/TypeScript core

单语言栈和 Chromium 一致性更有利于快速开发，但扩大运行时、依赖与安全治理面，因此未采用。

### SwiftUI/AppKit + Swift core

原生系统集成更强，但源码编辑、统一差异、现有 Web 原型迁移及平台无关核心的成本更高，因此未采用。

## 参考资料

- [Tauri Architecture](https://v2.tauri.app/concept/architecture/)
- [Tauri Process Model](https://v2.tauri.app/concept/process-model/)
- [Tauri Inter-Process Communication](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
