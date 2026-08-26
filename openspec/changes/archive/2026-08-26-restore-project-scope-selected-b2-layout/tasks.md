## 1. 实施前事实与 RED 基线

- [x] 1.1 为 `claude-code`、`codex`、`gemini-cli`、`opencode` 冻结 Skills／Subagents 的[项目路径／加载语义表](project-path-loading-matrix.md)，并单独冻结长期指令 `CLAUDE.md`／`AGENTS.md` 的 global／project 2×2 矩阵；每个结论引用官方文档或当前仓库已支持事实。没有事实的单元明确标为 `Unsupported`，不得猜测路径。
- [x] 1.2 为项目 registry、规范化 root 重复保护、重新关联、完整 ownership target、`all/global/project` 集合、`all` 中的显式 mutation target、发现安装状态 target、根不可用、同名项目、项目备份、固定长期指令行、单侧／分歧全局 AGENTS 投影、双投影写入回滚与 override 不覆盖编写 Rust L1 RED tests；为指令 DTO／命令参数、rail 选中语义、纯图标名称及列表／详情焦点写前端 L1 RED tests。
- [x] 1.3 为真实 UI 写 L2 RED journeys：rail 内显式添加／重新关联／移除项目、切换三种上下文、`all` 中新 Skill／Subagent mutation 的 target 选择、现有资产行 target 保持、长期指令固定行直接保存、发现安装状态 target 隔离、根不可用错误、删除 Skill／Subagent 及其备份后移除项目、键盘列表／详情焦点往返、context 切换清空选择、窄屏逐级返回；默认空态 fixture 不得改为项目 fixture。

## 2. 项目 registry 与上下文核心

- [x] 2.1 将数据库 schema 升至下一 forward-only version：新增 `projects` registry 和三类资产的 ownership／project columns 或等价约束；迁移把既有记录保留为 global，并用迁移测试覆盖成功与失败回滚。
- [x] 2.2 实现项目 DAO／service 与 `add_project`、`list_projects`、`relink_project_root`、`remove_project` commands，以及 Rust／TypeScript `ProjectSummary` 镜像。添加／重新关联仅接受显式现存目录并拒绝另一个项目已登记的同一规范化 root；重新关联保持 `projectId` 与资产 ownership 不变且不扫描／移动文件。
- [x] 2.3 实现 `ConfigContext`、完整 `ScopeTarget` 参数校验和每类 command 的 project lookup；`all` 不可作为 mutation target，且其中没有既有资产 target 的新 Skill／Subagent mutation 需显式选择 global 或 project target。项目 root 不可用时返回稳定结构化错误，且不返回缓存项目结果或全局 fallback。项目仍有关联资产或项目备份时拒绝移除；长期指令只在 live 文件中存在，不建立项目数据库 ownership／backup record，也不阻止解除登记；Skill／Subagent 备份元数据列表／删除均不要求 root 可用。
- [x] 2.4 使第 1 节的 registry／迁移／目标校验 L1 RED tests 转 GREEN，并增加真实 Tauri L3 command 测试验证 opaque `projectId` 而非名称或路径被用作身份，以及重新关联不会改变 asset target。

## 3. 固定 resolver 与三类资产的项目目标

- [x] 3.1 在现有 per-Agent 路径模块和 Skill service 附近实现固定项目 target resolver 与全局适用性判断；按第 1.1 节路径表只启用已确认单元，其他单元封闭失败。为项目安装、更新、卸载和 Agent toggle 写 L1 RED→GREEN 目标路径隔离测试。
- [x] 3.2 为 Skills 扩展 DAO、DTO 和直接 commands，使列表、发现、ZIP 安装、未接管扫描／导入、安装、更新、卸载、备份恢复及 per-Agent toggle 接受完整 target；发现的 installed 状态按该 target 计算，`all` 先选择 target；同名 global/project asset 隔离，项目 mutation 不得写入全局路径，项目备份只可恢复到原 target。
- [x] 3.3 在长期指令 service 附近实现固定 2×2 live-file resolver 与 `get_instruction_documents({ context })`／`upsert_instruction_document({ target, kind, content })`：每个 target 固定返回 `CLAUDE.md`、`AGENTS.md`，不提供预设 CRUD、enable、import 或物理删除。global AGENTS 以 Codex/OpenCode 双投影保存，分歧返回结构化错误、任一写失败回滚；project 只写项目根单文件；override 只迁移所属投影且不覆盖不同内容。完成 L1 RED→GREEN 与 L3 隔离目录写入验证。
- [x] 3.4 在 Subagent service 附近实现固定项目 target resolver；为列表、发现、安装、更新、卸载、备份恢复及 per-Agent toggle 扩展完整 target。发现的 installed 状态按该 target 计算，`all` 先选择 target。完成 L1 RED→GREEN 与 L3 隔离目录写入验证，项目备份只可恢复到原 target。
- [x] 3.5 为 Skills 与 Subagents 扩展 hub／unified 存储位置迁移：移动 global SSOT root 与每个项目 SSOT sibling，并在任一受影响项目 target 无法重建投影时保持原设置与文件布局；固定 backup root 不迁移。以 L1 RED→GREEN 覆盖 global/project SSOT、失败回滚和保留的 backup target metadata。
- [x] 3.6 实现每类 `all/global/project` 集合、段序和 stable tie-break；全局 Skill／Subagent 只在 resolver 明确 `Applicable` 时进入项目视图，unknown/unavailable/unsupported 不进入；长期指令 project 视图固定为项目两行后 global 两行。为三类资产补齐 L1 和 L3 RED→GREEN 覆盖。

## 4. 前端外壳与真实查询

- [x] 4.1 更新 `src/types.ts`、每类 API 薄封装与 React Query hooks；Skills／Subagents query keys 包含资产类型、`ConfigContext` 和现有 Agent 上下文，长期指令仅包含资产类型与 `ConfigContext`；mutation 成功后失效所有受影响 context 与项目列表。
- [x] 4.2 将 App shell 改为 selected B2 的 `资产类型 rail → 配置上下文 rail → 主工作区`：宽屏显示真实“全部／全局配置／项目配置”，rail 内提供添加项目和各项目的重新关联／移除动作，Settings 固定第一栏底部，当前 Agent 为 Header 或主表面紧凑控件而非第二栏。两条 rail 的当前项使用稳定选中语义，纯图标控件具备可访问名称。
- [x] 4.3 将 Skills、长期指令、Subagents 的列表／详情改为由当前 query 结果派生；切换 context 后不可见资产清空选择、回列表并将焦点置于列表标题或首项（若已有分页则回到有效页，不新增分页）。现有资产行从其记录派生完整 target；`all` 中新的 Skill／Subagent mutation 使用一个显式 global／project target 选择控件，不默认 global，长期指令直接使用固定行自带的 target。项目目标操作始终传完整 target，错误使用 `role="alert"`，成功提示使用 `role="status"`。列表项支持键盘进入详情，详情有确定初始焦点，返回恢复触发项。
- [x] 4.4 实现 `1280×800` Skills 的名称／状态、来源或路径、四 Agent 状态三列紧凑行，以及主工作区内长期指令／Subagent master-detail 且无第四栏；实现 `<1200px` 单表面 `类型 → 配置上下文 → 列表 → 详情` 路径、Settings 直达、返回焦点恢复和断点切换修复。验证 `390×844` Skills 行保留四个具可访问名称的 Agent logo controls、单列且无横向溢出。
- [x] 4.5 使第 1 节 L1／L2 RED tests 转 GREEN；补充以现有 DTO 映射的独立 `?fixture=visual` 项目数据模式，默认 fixture 的空态旅程保持不变。

## 5. 验收、文档与独立复审

- [x] 5.1 运行并修复 `npm run build:frontend`、`npm run test:frontend`、`npm run verify:static`、`npm run test:ui`、`npm run test:tauri` 和 `git diff --check` 中由本 change 引入的失败。
- [x] 5.2 在相同业务状态下重捕获 Demo／生产并排证据：`1586×992` Skills 列表和详情、`1280×800` Skills 三列及 Instructions／Subagents master-detail、`1199×900` 与 `390×844` 的完整上下文路径和 Skills 行内 Agent controls；追加到 `design-qa.md` 的生产 UI parity 章节，最终结果写为 `final result: passed`。
- [x] 5.3 依据实际实现更新产品基线与前端契约；仅在实现和验收完成后运行正式 `openspec archive restore-project-scope-selected-b2-layout` 合并主 specs，不得手工编辑主 specs 冒充归档，也不得把本草案或 mock 证据当作完成证据。
- [x] 5.4 由独立 reviewer 复审：没有恢复旧 Demo 的 Adapter/provenance/prepare-apply 语义，没有通用资产抽象、自动项目发现或假项目数据，且项目写入不会落入 global 路径。
