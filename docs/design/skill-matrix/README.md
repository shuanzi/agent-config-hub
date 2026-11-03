# Skills 使用矩阵

2026-10-14 用户选定「项目 × Agent 矩阵」，并确认「来自全局」直接勾选／取消勾选的交互。此增量表面的视觉与交互基准为[所选概念](selected-concept.png)及[已批准可运行原型源码](prototype/README.md)；目录维护、详情及其他页面继续沿用 [polished Pen](../polished/design.pen)。原型在 `prototype/` 独立维护，可直接安装依赖并运行，样例数据不构成真实能力证据。

正式矩阵沿用已有三栏壳层、Agent 标识、字型和对话框。四列勾选、多选、筛选、跨项目批量分配与预览对应新表面；完整路径、接管、更新、卸载和备份继续使用「目录与维护」。项目切换、窄屏返回与资产页切换保留矩阵草稿；刷新页面不承诺保留草稿。

矩阵显示实际文件配置，包含共享目录关联发现与原生排除。支持路径、原生配置及限制以[产品说明](../../product/README.md#使用矩阵与批量分配)为准，不能将概念图中独立的四列推断为所有 Agent 的运行时能力。

设计原型预览见 [preview-manifest.tsv](preview-manifest.tsv)。正式 App 的 11 张模拟界面截图独立保存在[验收证据清单](../../acceptance/evidence/2026-10-14-skill-matrix/screenshot-manifest.tsv)；真实写入、重启与保护证据见[矩阵验收记录](../../acceptance/skill-matrix-results.md)。

## 项目排除与启动增量

用户已批准 Codex 项目启动入口。2026-10-14 交付的原型完成了依赖安装、9 项模型测试和构建。2026-10-17 将同一原型迁为可直接编辑的源码目录，保留模型测试、Vite 配置、必要脚本和静态资源；所选概念图只维护本目录中的一份。原型启动、错误及角色覆盖均为模拟，不运行真实 CLI。

原型的新增启动、缺失 CLI、重新读取和模拟交接已在浏览器复测，见[原型启动状态](previews/prototype-codex-launch.jpg)。

2026-10-14 正式组件的模拟界面证据：

- [项目排除](../../acceptance/evidence/2026-10-14-skill-matrix/desktop-matrix.jpg)、[两项变更预览](../../acceptance/evidence/2026-10-14-skill-matrix/desktop-preview.jpg)、[恢复继承](../../acceptance/evidence/2026-10-14-skill-matrix/desktop-restored.jpg)。
- [Codex 启动计划](../../acceptance/evidence/2026-10-14-skill-matrix/desktop-codex-launch.jpg)：完整路径、已保存排除项和生效边界。
- [390px 单 Agent](../../acceptance/evidence/2026-10-14-skill-matrix/mobile-matrix.jpg)、[草稿阻止启动](../../acceptance/evidence/2026-10-14-skill-matrix/mobile-launch-blocked.jpg)、[OpenCode 角色权限限制](../../acceptance/evidence/2026-10-14-skill-matrix/mobile-limitation.jpg)。

证据目录中的 `initial-` 截图保留初始矩阵接入的界面证据。所有 JPEG 按实际格式命名，清单读取真实像素尺寸；文档检查覆盖编码、尺寸、引用和清单完整性。项目路径、计数与样例名称均属于模拟数据。
