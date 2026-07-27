# ARCH-GATE — 整机应用技术方案门禁

**Status:** closed — 2026-07-27

**Acceptance:** 用户已于 2026-07-27 明确接受整机技术方案并要求关闭本门禁。

**Outcome:** 技术覆盖与独立只读审查均已完成；FE-01 的门禁 blocker 已解除，后续票据仍按直接依赖推进。

## 目的

在前端契约验收后、任何前端实现前，确定满足产品基线与前端契约的最小整机应用架构。该门禁只决定实现方式，不重新讨论产品范围、UI 行为或视觉方向。

## 技术方案必须确定

- macOS 桌面容器与前端运行时；
- `FrontendGateway` 到真实 IPC adapter 的映射，以及 renderer、preload/bridge（如适用）与核心引擎间的信任边界；
- core、四 Agent 适配器、平台能力、索引与文件事务的 seam；
- 编辑器、统一 diff、文件树和状态管理的最小依赖集合；
- 私有存储、搜索索引、监听、快照、加密和适配器包更新边界；
- IPC/wire 的版本兼容策略、边界输入校验、跨进程敏感值最小暴露与日志遮蔽原则；
- macOS 最低系统版本、CPU/application artifact matrix，以及签名/notarization、应用更新与适配器更新的职责边界；
- 基于 synthetic descriptor 与真实 tracer 的性能验收范围、测量责任和预算冻结规则；当前无运行 artifact 时不得虚构阈值，数值由相应首个 tracer 在票据完成前实际测量并锁定。

以上是必须由技术方案明确的后置主题，不预先选择没有证据的性能数值，更不在本门禁阶段编码。

## 验证命令契约与可运行命令

技术方案必须为 FE-01 至 FE-10 和 `RELEASE-GATE` 记录“验证命令契约”：验证对象、前置条件、运行环境、预计入口、通过判据和失败证据位置。它是未来实现的验证计划，不是当前可执行命令，也不得标为“已验证”。

首个实现切片（FE-01）负责在其最小纵向范围内建立 bootstrap。只有 bootstrap 存在、对应命令实际运行并留下通过/失败证据后，才可将该命令标记为“已验证可运行”。其余票据和发布门禁同样不得把占位命令、静态文档检查或 mock-only 结果冒充真实 adapter、构建或打包验证。

## 关闭条件

- [x] 前端契约已由用户验收（2026-07-27）；
- [x] `CR-FE-001` 已补齐 prepare transport/protocol failure 的封闭表达、fixture 与票据覆盖；
- [x] 技术方案写入 `docs/architecture/Agent_Config_Manager_MVP_技术方案_v0.1.md`（`ARC-01` 至 `ARC-06c`；2026-07-27）；
- [x] 每个 `FrontendGateway` 操作、类型、原因码和事件均有唯一实现归属（`ARC-02b`、`ARC-02c`、`ARC-03`；2026-07-27）；
- [x] mock adapter 与真实 adapter 复用同一契约测试的设计边界已定义（`ARC-06c` 测试层级；2026-07-27）；
- [x] 事务、并发、敏感信息和可执行内容边界没有降级（`ARC-03`、`ARC-04`、`ARC-05a` 至 `ARC-05d`；2026-07-27）；
- [x] IPC 信任边界、wire/versioning、边界校验、敏感跨进程处理、macOS 15+ arm64 artifact matrix、签名/notarization、应用更新与性能验收责任均有最小技术方案结论（`ARC-02b`、`ARC-02c`、`ARC-05a` 至 `ARC-05e`、`ARC-06c`；2026-07-27）；
- [x] 技术依赖均有当前产品需求依据，不存在推测性扩展（独立只读审查无 P0–P2；2026-07-27）；
- [x] 必要 ADR 仅覆盖难以逆转且存在真实取舍的决策（ADR-0001 至 ADR-0019；2026-07-27）；
- [x] FE-01 至 FE-10 与 `RELEASE-GATE` 均补充验证命令契约，未把未运行命令称为已验证（`ARC-06c`；2026-07-27）；
- [x] 用户明确接受整机技术方案（2026-07-27）。

关闭门禁只解除 blockers，不改变 FE 票据的用户行为和依赖关系。若技术方案证明契约不可实现，返回契约并提交最小 Change Request。

当前没有真实 app、DMG、updater、adapter release artifact、15.0.x 安装启动或签名/notarization evidence；这些保持 `planned / unverified` 并由实现期票据及 `RELEASE-GATE` 负责，不冒充本次架构审查证据。

门禁关闭不代表任何实现、测试或发布已完成，也不授权跳过票据依赖、产品基线、前端契约或本技术方案。
