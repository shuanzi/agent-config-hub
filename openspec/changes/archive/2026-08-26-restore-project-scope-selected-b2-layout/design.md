## Context

当前 v0.3 使用“数据库 SSOT → 每类 service → 直接 Tauri command → React Query”的资产管理结构。Skills 与 Subagents 集中安装后投影到四个 Agent 的全局目录；旧长期指令是按 Agent 的预设库和 live 文件。现有路径解析只接受全局 Agent 配置目录或 per-Agent override，资产表、DTO 和命令都没有项目身份。

已确认的 UI 验收要求 selected B2 的第二栏恢复为“全部／全局配置／项目配置”。它要求真实项目数据和真实写入目标，不能以 Demo 的 mock project、`inherit` 查询参数或禁用按钮替代。本 change 同时受以下边界约束：

- 保留四个一等 Agent、直接语义 Tauri commands、SQLite SSOT／投影、React Query 和现有三类资产。
- 不恢复 Hooks、全局搜索、跨 Agent 转换、可配置继承、Adapter registry、项目 index／自动发现、provenance／freshness 系统或 `prepare → review → confirm → apply`。
- 当前 Agent 仍决定 Skills／Subagents 的安装默认 Agent，但不决定长期指令、scope/project，也不再作为第二栏。
- 逐 Agent、逐资产类型的项目路径与加载语义已冻结在 [task 1.1 矩阵](project-path-loading-matrix.md)；实现必须遵循其 `Supported`／`Unsupported` 边界，不能猜测路径。

## Goals / Non-Goals

**Goals:**

- 让用户显式登记项目根目录，并以稳定、不透明的 `projectId` 选择项目。
- 让每一个读取和写入都带有足以区分全局与项目的目标身份。
- 让项目视图只基于固定解析器的明确结果投影全局资产；未知、不可用或不支持时封闭失败。
- 让宽屏和窄屏 UI 均可使用真实的 type → context → list → detail 路径。

**Non-Goals:**

- 自动扫描、监听或索引磁盘项目；从路径、Git 仓库或当前工作目录猜测项目。
- 用通用资产框架、动态 resolver／Adapter 注册表或兼容层统一三类资产。
- 为项目视图缓存版本、修订、来源优先级、覆盖图或适用性 provenance。
- 恢复旧 Demo 中的全局搜索、继承开关、跨 Agent 转换或事务式审查／确认流程。
- 在本 change 起草阶段修改数据库、代码、主 specs、产品基线或 UI。

## Decisions

### D1：项目登记是唯一的项目事实源

新增一个窄项目 registry，由 `projects` 表、项目 DAO／service 和直接 Tauri commands 管理。最小镜像 DTO 为：

```text
ProjectSummary {
  projectId: string       // 数据库生成的稳定 opaque ID；唯一身份
  displayName: string     // 仅显示，可重复
  rootPath: string        // 已登记根目录，仅显示和 resolver 输入，不是身份
}
```

命令为 `add_project({ rootPath, displayName? })`、`list_projects()`、`relink_project_root({ projectId, rootPath })` 与 `remove_project({ projectId })`。添加和重新关联均只接受用户显式选择的现存目录；未提供显示名时以目录基名作为初始显示名。实现仅在添加／重新关联时规范化该现存目录，以拒绝另一个 `projectId` 已登记的同一规范化 root；该重复保护不把 root 变成 identity，也不合并同名项目。无需为此引入项目 watcher、自动重规范化或符号链接竞态防御。

`relink_project_root` 保持已有 `projectId`、所有 ownership 和项目 SSOT sibling 不变，仅更新 registry 的 root。它不得自动扫描新 root、移动／复制 SSOT 或项目文件、删除旧 root 内容或修改资产记录。这样旧 root 移动或不可用而仍有关联资产时，用户能先重新关联，再显式处理资产。所有选择、查询和写入始终以 `projectId` 定位；展示名和 root path 既不作为 identity，也不触发自动发现。

移除项目是**解除登记**，不是删除项目内容：它不得遍历项目根、删除项目目录、删除项目本地文件或隐式调用三类资产的卸载／删除逻辑。为避免隐藏受管资产，若该 `projectId` 仍有关联的项目 Skill／Subagent 资产记录或属于该 target 的备份，`remove_project` 必须拒绝并返回稳定的“仍有受管项目资产或备份”错误；用户须先逐项显式卸载／删除资产并清理备份。长期指令是项目根上的 live 文件，不建立数据库 ownership／backup record，也不因其存在阻止解除登记。项目根在移除时不可用不阻止该纯数据库操作；此时仍可列出并删除固定 backup root 下属于该项目的资产备份，再移除项目。

选中或写入项目资产前，service 必须通过 `projectId` 重新取得登记 root，并确认它仍是可访问目录。失败返回 `PROJECT_ROOT_UNAVAILABLE`，不返回缓存资产、不尝试全局位置、也不写入任何文件。该 fail-closed 行为不需要项目 watcher、索引或 freshness 元数据。

### D2：作用域与目标身份按资产类型保留，不建通用资产层

每类资产分别在其现有表、DAO、service 和 command 附近增加全局／项目 ownership：

- Skills 与 Subagents 记录 `scope = global | project` 和项目 ownership 时的 `projectId`；同名或同一发现来源可在全局与不同项目中分别受管，但同一 ownership target 内沿用现有冲突规则。
- 长期指令不是数据库预设或 per-Agent ownership：每个完整 target 固定由 `CLAUDE.md` 与 `AGENTS.md` 两种 live 文档构成。`CLAUDE.md` 仅适用于 Claude Code；`AGENTS.md` 仅适用于 Codex 与 OpenCode；Gemini CLI 不受支持。
- 旧 prompt／preset 数据不参与新的读取、保存或 override 搬迁；本 change 不把它重新解释为当前文档，也不为它新增迁移或清理流程。

Skills 与 Subagents 保持现有“SSOT + Agent 投影”模型：global ownership 继续使用既有 global SSOT root（hub 为 `~/.agent-config-manager/skills` 与 `~/.agent-config-manager/subagents`，unified 为 `~/.agents/skills` 与 `~/.agents/subagents`）；project ownership 使用当前 storage location 下独立 sibling `projects/{projectId}/skills` 或 `projects/{projectId}/subagents`（hub 为 `~/.agent-config-manager/projects/{projectId}/…`，unified 为 `~/.agents/projects/{projectId}/…`），再投影到 resolver 确定的项目目录。该 sibling 不是项目 root 的替身，也不占用合法 global Skill／Subagent 名称；在 `hub` 与 `unified` 存储位置之间迁移时，global SSOT root 与全部项目 SSOT sibling 都随各自资产迁移。长期指令直接读写固定 live 文件：global `CLAUDE.md` 是 Claude 的有效全局文件，global `AGENTS.md` 是 Codex 与 OpenCode 两个有效全局投影的同一逻辑内容；project target 分别是项目根的 `CLAUDE.md` 与 `AGENTS.md`。

Skill 备份继续存于固定 `~/.agent-config-manager/skill-backups/`，Subagent 备份继续存于固定 `~/.agent-config-manager/subagent-backups/`，各自保留最近 20 份；二者的 metadata 新增完整 ownership target。恢复命令只读取该记录的原 target，不提供或接受跨 global／project 或跨项目的 retarget 参数；项目 root 不可用时恢复封闭失败并保留备份，列出或删除该备份不需要项目 root。backup root 不随 hub／unified SSOT 存储迁移。长期指令不提供删除、备份列表或恢复工作流：保存本身是对 live 文档的原子覆盖，且不删除物理文档。

数据库迁移必须把 Skill 与 Subagent 的唯一性从旧的全局身份扩展为“资产来源／本地 ID + 完整 ownership target”。`projectId` 只在 `scope = project` 时有效；服务层拒绝缺失或多余的项目 ID。长期指令不新增表、SSOT 或 ownership 行。实现不得建立共享 `assets`、`targets` 或继承表来抽象三类既有业务。

每个会读写资产的直接 command 都接收其资产类型自己的完整 target 参数，其语义等价于：

```text
ScopeTarget = { scope: "global" } | { scope: "project", projectId: string }
```

项目 mutation 还保留现有的 `assetId`、发现 source、`app` 或内容参数。`all` 仅是读取上下文，不是新安装／导入的 mutation target：现有资产行的 update／uninstall／toggle／edit 从该行记录的完整 ownership target 派生；global 或具体 project 上下文中的新安装／新建／导入默认使用该具体 target；在 `all` 中没有既有资产 target 的新安装／新建／导入必须由用户显式选择 global 或一个 `projectId` 后才能确认，禁止静默默认 global。长期指令在 all 返回的每个固定文档行已经携带 target，保存从该行 target 派生，不需要额外 picker。前端不得传入任意 root path；后端只用 `projectId` 查 registry，再交给对应 resolver。当前 Agent 只决定其它资产的 Agent，不决定 scope。一个从项目视图看到的全局资产仍携带 global target；一个项目 target 永远不能降级为 global target。这样全局与项目同名隔离，且项目操作不会写入全局路径。

### D3：固定 resolver 决定项目路径与全局适用性

不引入动态 Adapter registry。实现把固定 resolver 放在现有各 Agent 路径模块及三类 asset service 附近。Skills 与 Subagents 的每一对 `{AgentType, AssetKind}` 独立提供以下等价能力；长期指令只对两个固定 document kind 提供固定路径：`claude` → `CLAUDE.md`，`agents` → `AGENTS.md`。

```text
resolve_project_target(rootPath, asset identity) -> Resolved(path) | Unsupported | Unavailable
is_global_asset_applicable(rootPath, global asset target) -> Applicable | NotApplicable | UnknownOrUnavailable
```

这只是各现有 service 调用的固定分支，不是可插拔 trait、规则引擎或通用资产抽象。`Resolved(path)` 是项目-owned 读取／写入的唯一文件目标。`Applicable` 只能在固定 resolver 已明确确认该 Agent、资产类型和根目录支持全局配置对该项目生效时返回；它不得把“默认继承”当成确认结果。`UnknownOrUnavailable`、`Unsupported` 或根目录不可用都不允许全局资产进入该项目视图。

项目路径与加载语义以 [task 1.1 路径矩阵](project-path-loading-matrix.md) 为唯一冻结事实源：Skills／Subagents 覆盖 `{claude-code, codex, gemini-cli, opencode}`，长期指令独立冻结为 `{CLAUDE.md, AGENTS.md} × {global, project}`。Gemini CLI 指令是明确 `Unsupported`；实现只能启用其中的 `Supported` 单元，前端不得为 `Unsupported` 提供可写入口。该实施前 gate 仅防止伪造路径；它不恢复 ARCH-GATE、Adapter bundle 或 provenance 系统。上游文档、格式或优先级发生版本漂移时，必须先复核矩阵。

### D4：配置上下文查询集合和稳定顺序

每类列表 command 接收 `ConfigContext = all | global | project(projectId)`。长期指令不接收当前 Agent，读取固定 `InstructionDocument { target, kind, fileName, appliesTo, content, exists, updatedAt? }`；其 React Query key 只包含资产类型和配置上下文。Skills／Subagents 的 query key 仍包含现有 Agent 上下文。发现结果的远端内容不因 target 改变，但“已安装”状态只相对于一个具体 `ScopeTarget` 计算；global／project 上下文直接提供该 target，`all` 必须先显式选择 target。

- Skills／Subagents 的 `all`：先显示非空全局段，后显示非空项目段；项目段按 `displayName` 升序、同名以 `projectId` 作为 tie-break。一个根不可用或 resolver 不可用的项目不产生项目段。
- 长期指令的 `all`：先显示 global 的两个固定文档行，后按同一项目顺序显示每个可访问项目的两个固定文档行；缺失 live 文件仍显示未创建行。
- `global`：Skills／Subagents 只显示非空全局段；长期指令始终显示 global 的两个固定文档行。
- `project(projectId)`：Skills／Subagents 先显示该项目的非空项目自有段，再显示 resolver 返回 `Applicable` 的非空全局适用段。长期指令先显示该项目的两个固定行，再显示 global 的两个固定行；全局行保持 global ownership，不生成项目副本。
- Skills／Subagents 的每个资产段内按现有展示名称升序、同名以资产本地 ID 作为 tie-break；长期指令的固定行顺序为 `CLAUDE.md`、`AGENTS.md`。

对于 Skills 与 Subagents，固定 resolver 独立判断各现有 Agent target；至少一个 Agent target 被明确确认适用时，该全局资产才可进入项目的全局适用段。Skills 的四 Agent 状态始终在紧凑资产行中显示；Subagents 继续按既有主表面设计显示在资产行或详情中。长期指令不按当前 Agent 筛选，`CLAUDE.md` 与 `AGENTS.md` 的 appliesTo 为固定事实。查询／筛选导致已选资产不可见时，前端清空该资产选择并回到列表。

### D5：外壳恢复配置上下文栏，当前 Agent 变为紧凑业务控件

宽屏（`>= 1200px`）显示 `资产类型 rail → 配置上下文 rail → 主工作区`：第一栏是 Skills、长期指令、Subagents，Settings 固定在底部；第二栏是“全部”“全局配置”和 `list_projects()` 的真实结果。`>= 1361px` 使用 `180px / 220px / minmax(0, 1fr)`，`1200px–1360px` 使用 `160px / 190px / minmax(0, 1fr)`；Header 为 `66px`。

当前 Agent 移至 Header 或主表面顶部的紧凑选择控件，仍决定 Skills／Subagents 的安装默认 Agent；它不形成独立 rail，也不决定长期指令、scope/project 身份。Skills 的四 Agent 启用状态必须位于资产行；Subagents 继续按既有主表面设计显示在资产行或详情中。`1280×800` 时 Skills 使用名称／状态、来源或路径、四 Agent 状态的三列紧凑行；长期指令与 Subagents 在主工作区内使用 master-detail，绝不增加第四栏。`390×844` 时 Skills 保持单列且其行内四个带可访问名称的 Agent logo controls 不得移入详情或隐藏。

窄屏（`< 1200px`）Header 为 `58px`，一次只展示一个表面：`资产类型 → 配置上下文 → 列表 → 详情`；Settings 从资产类型表面直接进入。两条 rail 的当前项使用 `aria-current` 或等价稳定选中语义，纯图标控件具备名称；列表项可键盘进入详情，详情有确定初始焦点，返回恢复触发列表项。context 切换使资产不可见时，清空选择、回到列表，并将焦点置于列表标题或首项；若现有实现有分页则回到有效页，但不为此新增分页。`390px` 宽度下不得横向溢出。

### D6：迁移和失败边界保持 v0.3 的直接语义

SQLite 使用下一次 forward-only schema migration；迁移在单个数据库事务中完成，失败时不提升 `user_version`。项目 registry 和 Skill／Subagent 的 ownership 列由同一迁移引入，旧全局记录按 D2 保留。长期指令不依赖 prompt 表或新数据库迁移，live 文件是读取来源。存储位置迁移仍沿用现有按资产 service 的语义，但必须移动 global SSOT root 与 `projects/{projectId}/skills`、`projects/{projectId}/subagents` sibling，并在无法为受影响项目重建投影时保持原设置和文件布局；固定 backup root 不迁移。文件系统写操作不新建跨资产事务框架。

每次成功 mutation 使同一资产类型所有受影响的 query keys 和项目列表失效；长期指令只失效受影响 context，不含 Agent key。失败保留当前已确认结果并呈现结构化错误。项目根／resolver 失败不会被前端转换为空成功、全局 fallback 或 Demo fixture 数据。global `AGENTS.md` 两投影不一致时保存与读取均返回 `INSTRUCTION_PROJECTIONS_DIVERGED` 并零写入；两个投影保存中途失败时恢复已写入的投影。

## Risks / Trade-offs

- Skills／Subagents 的四 Agent 路径与加载事实及长期指令的 2×2 文档矩阵已在 task 1.1 冻结；明确 `Unsupported` 会先限制功能，而不是伪造支持。Gemini CLI 长期指令因此不在本 change 范围。上游文档、格式或优先级版本漂移时，实施前须复核 D3 的[官方事实表](project-path-loading-matrix.md)。
- 项目 registry 是用户显式维护的清单；它不会自动反映磁盘新增、移动或删除的项目，这是本 change 有意避免的自动发现／索引范围。
- 已登记 root 移动后需要用户显式重新关联；重新关联只改变 registry 指向，不移动任何项目文件或资产。
- 同一资产可在多个 ownership target 中存在，DAO 查询和 mutation 必须始终使用完整 target；漏传 `projectId` 会造成错误目标，这是 L1／L3 的重点。
- Codex 与 OpenCode 的 global `AGENTS.md` 可能被外部工具分别修改；本 change 选择结构化冲突并零写入，而不增加内容合并、版本、冲突解决或新的数据库 SSOT。
