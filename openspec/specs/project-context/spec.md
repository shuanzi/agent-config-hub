# project-context Specification

## Purpose

定义显式登记项目如何以不透明身份进入配置上下文，并在不自动发现项目的前提下，为三类资产提供真实、封闭失败的项目读取和写入目标。

## Requirements

### Requirement: 显式项目登记与稳定身份

系统 SHALL 只通过用户显式添加的现存目录建立项目 registry。每个登记项目 SHALL 持久化一个数据库生成的 opaque `projectId`、展示名和 root path；`projectId` 是列表、选择、查询和写入的唯一身份，展示名和 root path SHALL NOT 被用作身份或合并键。展示名相同的项目 SHALL 保持为不同项目并以各自 `projectId` 区分。系统 SHALL 提供添加、列出、重新关联和移除登记项目的直接语义命令，且 SHALL NOT 自动扫描、监听或从当前工作目录猜测项目。

#### Scenario: 添加两个同名项目

- **WHEN** 用户显式添加两个展示名相同但目录不同的项目
- **THEN** 系统返回两个不同的 `projectId`，并在项目列表中保留两个可独立选择的项目

#### Scenario: 尝试添加不存在的目录

- **WHEN** 用户提交一个不存在或不是目录的 root path
- **THEN** 添加被拒绝，且系统不得创建项目记录或从其他位置推断项目

### Requirement: 移除项目不删除项目资产

`remove_project(projectId)` SHALL 只解除项目登记，且 SHALL NOT 遍历项目 root、删除任何项目本地文件、隐式卸载资产或删除关联的项目资产记录。若该项目仍有关联的受管项目 Skill／Subagent 资产，或有保存其 project target 的 Skill／Subagent 备份，系统 SHALL 拒绝移除并返回稳定的结构化错误，要求用户先逐项显式处理资产和项目备份。长期指令仅是项目根的固定 live 文档，不建立 project ownership 数据库记录或 backup record，且不得成为解除登记的阻塞条件；遗留 `prompts` 行不是受管资产，即使保存旧的 `project_id` 也不得阻止解除登记。项目 root 不可用时，只要这些前置条件已满足，系统仍 SHALL 允许该不触碰文件系统的移除操作。

#### Scenario: 项目仍有受管资产

- **WHEN** 用户移除一个仍有项目作用域 Skill 的项目
- **THEN** 系统拒绝移除，Skill 的数据库记录和项目目录内容均保持不变

#### Scenario: 移除空项目

- **WHEN** 用户移除一个没有关联项目资产的登记项目
- **THEN** 该项目不再出现在配置上下文栏，且系统未删除项目 root 中的任何文件

#### Scenario: 根不可用时清理项目备份

- **WHEN** 项目的 root 已不可用且只剩保存该 project target 的 Skill 备份
- **THEN** 用户可删除该备份而不访问项目 root，随后可移除项目；系统未写入 global 目标

#### Scenario: 添加重复规范化 root

- **WHEN** 用户添加一个被另一 `projectId` 以相同规范化 root 登记的目录
- **THEN** 添加被拒绝，既有项目 registry 和资产记录均不变

### Requirement: 重新关联项目 root 与重复登记保护

`add_project` 和 `relink_project_root` SHALL 只接受现存目录，并在该时点规范化 root 以拒绝另一个 `projectId` 已登记的同一规范化 root。规范化 root 仅用于重复登记保护和 resolver 输入，SHALL NOT 成为项目 identity、合并同名项目或触发自动发现。`relink_project_root(projectId, rootPath)` SHALL 保持既有 `projectId`、资产 ownership 和以该 `projectId` 隔离的项目 SSOT sibling 不变，只更新 registry root；它 SHALL NOT 扫描、移动、复制或删除资产或项目文件。

#### Scenario: 重新关联有资产的项目

- **WHEN** 一个仍有项目资产的已登记 root 移动后，用户将该 `projectId` 重新关联到新的现存目录
- **THEN** `projectId` 和项目资产 target 保持不变，后续 resolver 从新 root 解析位置，且系统未自动移动或复制任何资产

#### Scenario: 重新关联到已登记 root

- **WHEN** 用户将一个项目重新关联到另一个 `projectId` 已登记的同一规范化 root
- **THEN** 操作被拒绝，两个项目的 registry 和资产记录均不变

### Requirement: 完整 ownership target 与项目路径封闭失败

除各资产规范明确限定为“不访问项目 root”的备份元数据列出／删除外，每个三类资产的读取或 mutation SHALL 使用完整 target：全局 target，或包含 opaque `projectId` 的项目 target。项目 target SHALL 只通过 registry 取回 root 后由对应 Agent／资产类型的固定 resolver 确定文件位置；系统 SHALL NOT 接受调用方传入任意项目路径，也 SHALL NOT 将项目 target 回退为全局 target。root 不存在、不可访问、resolver 不支持或无法确认目标时，系统 SHALL 以稳定结构化错误封闭失败，不返回项目缓存结果也不写入文件。

#### Scenario: 已登记 root 后来不可用

- **WHEN** 用户选择一个登记后被移动或不可访问的项目并读取或修改项目资产
- **THEN** 系统返回项目 root 不可用的结构化错误，不读取或写入全局位置

### Requirement: 读取上下文与 mutation target 正交

`all` SHALL 只作为读取上下文，且 SHALL NOT 被传入或转换为 mutation target。update、uninstall、toggle 和 edit SHALL 从被操作资产行的完整 ownership target 派生；从 global 或 `project(projectId)` 上下文发起没有既有资产 target 的安装、新建或导入时，系统 SHALL 默认使用该具体 target。从 `all` 发起没有既有资产 target 的安装、新建或导入时，用户 SHALL 先显式选择 global 或一个 `projectId`，系统才可确认 mutation；系统 SHALL NOT 静默默认 global。当前 Agent 只决定 Agent，不决定 scope/project。

#### Scenario: All 中安装前选择 target

- **WHEN** 用户在 `all` 上下文安装一个新发现的 Skill
- **THEN** 系统要求用户选择 global 或一个已登记 `projectId`，选择前不创建安装或写入 global 位置

#### Scenario: All 中操作既有项目资产

- **WHEN** 用户在 `all` 中关闭一项 project Subagent 的 Agent 开关
- **THEN** 系统从该行的 project ownership target 派生操作，不要求重新选择 scope，也不修改 global 投影

### Requirement: 配置上下文栏的项目管理入口

配置上下文栏 SHALL 提供最小的“添加项目”入口，并为每个已登记项目提供重新关联和移除动作；这些动作 SHALL 调用既有的 add／relink／remove registry commands 并遵守其目录、重复登记和受管资产／备份约束。入口可使用 FocusedDialog，但 SHALL NOT 创建单独的项目管理页、自动扫描或虚构项目数据。

#### Scenario: 在配置上下文栏添加项目

- **WHEN** 用户在配置上下文栏选择添加项目并确认一个现存目录
- **THEN** 系统调用项目 registry 的添加命令，成功后新项目出现在该栏，失败时显示结构化错误

### Requirement: 配置上下文集合和稳定顺序

系统 SHALL 为每种资产类型支持 `all`、`global` 和 `project(projectId)` 三个读取上下文。`all` SHALL 先呈现非空全局段，再按项目展示名升序、同名按 `projectId` 呈现非空项目段；`global` SHALL 只呈现非空全局段；`project(projectId)` SHALL 先呈现非空项目自有段，再呈现非空全局适用段。每个段内 SHALL 按展示名称升序、同名按资产本地 ID 稳定排序，且空段 SHALL NOT 渲染。根或 resolver 不可用的项目 SHALL NOT 产生项目资产段。

#### Scenario: All 中有同名项目段

- **WHEN** 两个同名项目均有当前资产类型的项目自有资产
- **THEN** 全局段之后的两个项目段以 `projectId` 作为稳定 tie-break 呈现

#### Scenario: 全局上下文

- **WHEN** 用户选择“全局配置”
- **THEN** 系统只返回 global ownership 的资产，不返回项目资产或空项目段

### Requirement: 固定 resolver 的全局适用性

项目视图 SHALL 只将固定 per-Agent resolver 明确返回 `Applicable` 的全局资产放入全局适用段。resolver 的确认基于已冻结的 Agent／资产类型项目路径和加载语义；它 SHALL NOT 以默认继承、Demo 参数、缓存 freshness 或动态 Adapter 规则替代确认。`UnknownOrUnavailable`、`Unsupported` 和项目 root 不可用时，全局资产 SHALL NOT 进入项目视图，也 SHALL NOT 生成项目副本。

#### Scenario: 适用性未确认

- **WHEN** resolver 无法确认一个全局 Subagent 对已选项目适用
- **THEN** 该 Subagent 不出现在该项目的全局适用段，且系统不创建项目副本
