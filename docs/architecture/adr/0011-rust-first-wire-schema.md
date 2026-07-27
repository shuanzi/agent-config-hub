# ADR-0011：以 Rust wire DTO 作为 IPC schema 事实源

> 状态：Accepted
>
> 决策日期：2026-07-27
>
> 所属门禁：`ARCH-GATE`（已关闭，2026-07-27）

## 背景

`FrontendGateway` 已映射为三个 Tauri command 和一个 invalidation event。Rust ingress 与 TypeScript adapter 需要共享大量封闭 union、稳定原因码、不透明身份和版本 envelope，且必须在不引入第二套产品事实的前提下防止 wire 漂移。

## 决策

- 建立与 core domain type 分离的 Rust wire DTO layer；
- `serde` 定义实际 JSON encode/decode shape；
- 仅 wire DTO 使用 `ts-rs` 生成 TypeScript declaration；
- 最小 Rust export entrypoint 同时生成 declaration 与 `GATEWAY_WIRE_VERSION`；
- 生成产物提交仓库但禁止手工编辑，验证时在临时目录重生成并要求零差异；
- mock gateway 不依赖 Tauri wire，真实 `TauriFrontendGateway` 使用生成 declaration；
- 保持三个 command 与一个 event 的手写 adapter，不引入新的 RPC framework；
- 使用同一组无敏感明文的正反向 golden JSON vectors 验证 Rust decode/encode 与 TypeScript adapter；
- TypeScript declaration 只提供静态类型，不冒充运行时验证器；
- 当前同包应用只支持一个 wire version，不实现协商、迁移或旧版本 fallback。

## Interface 不变量

- 产品基线与前端契约高于 Rust wire DTO；生成器不得新增行为、字段语义或原因码；
- domain type 不直接导出，wire 与 domain 之间必须显式转换；
- union 使用显式稳定 tag，不使用歧义 untagged union；
- 方向语义不同的 payload 使用独立 DTO；
- 身份与 revision 保持不透明 string，路径不充当身份；
- Rust ingress 拒绝未知 tag/字段、缺失字段、非法范围、超限 payload 和错误版本；
- TypeScript adapter 核对 envelope、版本、request ID 和顶层 tag，失败按既有 gateway 结果归一化；
- 生成 declaration、版本常量、golden vectors 或 mock fixture 都不能授权写入；
- 所有向量、错误输出和生成产物不得含敏感明文。

## 结果

正向影响：

- Rust 与 TypeScript 只维护一份 wire shape；
- 生成工具不接管既有 command routing 或 `FrontendGateway` 行为；
- 新上下文可以直接类型检查已提交的派生产物；
- drift、未知 variant 和版本错误在实现进入用户旅程前被发现；
- 不增加第三种 schema 语言或独立 RPC runtime。

代价：

- Rust 成为 wire 表达的主导语言；
- DTO 与 domain type 之间需要显式转换；
- wire shape 必须限制在 `serde` 与 `ts-rs` 能等价表达的子集；
- TypeScript 收到的嵌套 payload 不获得通用 schema runtime validator，依赖同包发布、Rust typed output、顶层核对和双向 vectors；
- 任何绕过生成目录的手写类型都必须由 review 和验证命令阻断。

## 替代方案

### TypeSpec/JSON Schema

语言中立且可生成运行时 schema，但增加第三种描述语言、两侧 generator、domain mapping 与独立版本治理。

### Rust/TypeScript 手工双写

工具依赖最少，但每次契约变更都需要同步两份大型 union，并依赖审查发现漂移。

### `tauri-specta`

可生成 Tauri command client，但会把已冻结的三 command interface 交给额外框架，并增加当前不需要的 routing/tool coupling。

## 重新评估触发条件

只有协议需要独立于应用发布、出现第三种语言客户端、需要处理不受信任的外部 response，或真实测试证明顶层核对与 typed Rust output 无法满足协议失败边界时，才评估 language-neutral schema 与完整 runtime validator。不得为假设中的公共 API 预先增加该工具链。
