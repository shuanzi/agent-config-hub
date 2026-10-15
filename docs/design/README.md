# 设计资产

目录维护和其他产品页面的视觉基准是 [polished 精细稿](agent-config-manager-ui/polished/README.md)和[对应可编辑 Pen](agent-config-manager-ui/agent-config-manager-ui-polished.pen)。保留目录维护的 Skills 五列紧凑列表、横排位置图标及类型／配置上下文／工作区壳层。Skills 默认表面新增[用户批准的使用矩阵](skill-matrix/README.md)，以已批准可运行原型作为该增量表面的设计源，现已补入 Codex 项目启动及 OpenCode 项目排除的状态预览。

- [画板与预览清单](agent-config-manager-ui/polished/preview-manifest.tsv)：37 份设计预览，包含 25 个页面状态、8 类弹窗及 4 个组件／总览画板。
- [正式 App 操作验收](../acceptance/polished-ui.md)：浏览器模拟命令及隔离桌面入口。
- [2026-09-27 实际截图与结果](../acceptance/polished-ui-results.md)：运行证据，区别于设计导出 PNG。

产品行为以[产品说明](../product/README.md)为准，交互与数据约定见[前端说明](../frontend/README.md)。设计样例中的名称、目录和计数不能作为机器实际配置事实。

更新 polished 页面时同步 Pen、预览和清单；更新矩阵时同步其原型源、预览和清单；实现发现偏差应先修实现，不通过改稿掩盖差异。重建稿、中间迭代与旧候选截图已退出工作目录，通过 Git 历史追溯。保留的 Pen 内历史参考节点不属于现行预览清单，不扩展产品范围。
