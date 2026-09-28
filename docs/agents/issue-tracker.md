# GitHub 任务跟踪

使用 `gh` CLI 读取和维护 GitHub Issues；`gh` 从当前 Git remote 推断仓库。Issues 记录待办、讨论、依赖与交付链接，现行产品规格在[仓库文档](../../README.md#文档导航)中维护。

## 常用操作

```sh
gh issue list --state open
gh issue view <number> --comments
gh pr view <number>
```

创建、评论、修改标签或关闭问题须符合用户授权范围。多行正文先写入临时文件，再使用 `--body-file`；不以文字报告或自动化测试通过代替用户要求的真实验收。

## 历史任务编排约定

已有 wayfinder 工作流使用一个 `wayfinder:map` issue 与 child issues 表达任务。优先使用 GitHub 原生 sub-issue 和依赖；不可用时用任务列表及 `Part of` / `Blocked by` 引用表达。依赖 API 使用 issue 的数据库 ID，不是显示编号。

只有正在执行已授权的这类任务时才维护其领取、依赖和完成状态；普通文档或代码工作不自动创建 map、领取票据、发表评论或关闭问题。PR 不是本仓库的需求收集入口。
