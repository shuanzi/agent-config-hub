# PF-01 性能采样：已显式降级

> 状态：**Degraded（2026-08-22）**，随 OpenSpec change `adopt-ccswitch-asset-management`（tasks 7.1）

## 原因

旧 PF-01 采样绑定已删除的实现：

- `pf-01.perf.test.ts` 的入口参数 `?scenario=perf-catalog` 依赖已删除的 `src/gateway/perf-catalog.ts` 与 `ScriptedMockGateway`；
- `pf-01.coldstart.test.ts` 以首次 `frontend_gateway_read` 完成为采样终点，该命令已随架构 pivot（ADR-0020）废除。

## 当前处置

- `npm run perf` 已切换为显式未建立（`not-established.mjs perf-pf01-recalibration`），执行即失败；
- `verify-ticket.mjs` 的 FE-01 registry 已移除 perf 步骤；
- 旧采样脚本与 descriptor 保留在本目录作方法学参考，不参与任何验证链路。

## 恢复条件

按 cc-switch 式新列表实现（Skills 已安装/发现视图）重新校准测量协议：新的合成数据源、新的冷启动终点（建议改为首个 skills 命令往返完成）、重新走 baseline 采集与预算冻结授权流程。
