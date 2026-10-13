# 仓库协作入口

使用中文输出文档与面向用户的说明。先读根 [README](README.md)，再按任务读取相关文档；不重复加载无关历史材料。

- [产品说明](docs/product/README.md)定义当前行为和术语；前端、架构、设计及验收文档按职责承接，不重复维护规格。
- 项目已退出 OpenSpec，不再创建 change 或运行其校验。旧资料通过 Git 历史追溯。
- GitHub Issues 用于任务跟踪，操作约定见[任务指南](docs/agents/issue-tracker.md)。不自动创建、评论或关闭任务。
- 阅读相关 [ADR](docs/architecture/adr/README.md) 时先核对适用状态；历史 Accepted 不等于现行实现。详见[领域文档指南](docs/agents/domain.md)。
- 修改行为或接口时同步对应说明；文档变更运行 `npm run verify:docs` 和 `git diff --check`。测试、隔离及证据边界见[开发指南](docs/development.md)。

保留用户未提交改动。实现、文档、模拟界面和真实文件操作的证据分别报告；发现当前实现与批准契约实质冲突时说明差异，不为消除文字矛盾擅自扩大产品范围。
