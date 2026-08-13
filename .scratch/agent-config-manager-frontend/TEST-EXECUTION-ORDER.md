# 测试执行顺序与范围矩阵

## 实施前只读基线

本节记录于本文件创建前；它是 task 1.1 的只读快照，不是 runtime、ticket closure 或 gate evidence。

- 分支：`codex/separate-functional-and-performance-gates`。
- `HEAD`、`origin/main` 和 `git merge-base HEAD origin/main` 都是 `d5740baaf8ecea496ff8195953d0fe5a15ab0ce5`；本地与上游 ahead/behind 均为 `0/0`。
- `merge-base..HEAD`、已暂存 diff 与未暂存 diff 的 changed paths 均为空。未跟踪文件仅为本 change 的四个既有 artifacts：`.openspec.yaml`、`proposal.md`、`design.md` 和 `tasks.md`（均位于 `openspec/changes/separate-functional-and-performance-gates/`）。
- `adopt-selected-b2-ui-baseline` 的 OpenSpec 完成计数为 `35/92`。`ARCH-GATE` 为 `closed`，`RELEASE-GATE` 为 `blocked`；`README.md` 与 `SPEC.md` 均记录 FE-07R、FE-01 为 `done`、FE-02 为唯一 `ready-for-agent` frontier、FE-03 至 FE-10 为 `blocked`。
- 该基线存在未解决的状态冲突：`issues/02-native-detail-and-multifile.md` 第 5–7 行仍将 FE-02 写为 `blocked`，等待 FE-01 的 `done` 与 provenance-appropriate evidence，并将 FE-01 列为 blocker。本 change 不修 tracker 或 issue、不据此启动 FE-02，也不裁决冲突；只调整未来任务的执行顺序，其他状态事实保持各来源的原样记录。
- 历史 evidence 仅记录稳定指针，不在本 change 中重新运行、重采样、重建或重新解释：FE-07R 为 `.artifacts/verification/FE-07R/20260810T071547Z/`，FE-01 为 `.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json`。这些指针不因本文档获得新的 closure 或 release credit。

## 永久范围

### Allowlist

本 change 只允许以下路径类别；允许测试断言路径并不授权在本任务中修改它们。

| 类别 | 允许路径 |
| --- | --- |
| 本 change artifacts | `openspec/changes/separate-functional-and-performance-gates/.openspec.yaml`、`openspec/changes/separate-functional-and-performance-gates/proposal.md`、`openspec/changes/separate-functional-and-performance-gates/design.md`、`openspec/changes/separate-functional-and-performance-gates/tasks.md` |
| 已冻结 task | `openspec/changes/adopt-selected-b2-ui-baseline/tasks.md` 中未完成任务的测试内容与执行顺序 |
| 本矩阵 | `.scratch/agent-config-manager-frontend/TEST-EXECUTION-ORDER.md` |
| TypeScript 测试断言 | `tests/**/*.test.ts`、`tests/**/*.test.tsx`、`tests/**/*.journey.test.ts` |
| Performance 测试断言 | `performance/**/*.test.ts` |
| Rust integration 测试断言 | `src-tauri/tests/**/*.rs` |

### Denylist

以下路径和内容永久禁止。即使某项优化看似需要它们，也不能通过扩展 proposal 或新增验证面绕过。

| 禁止类别 | 示例或范围 |
| --- | --- |
| 产品源码 | `src/**`（测试断言除外）、`src-tauri/src/**`（含 embedded Rust tests） |
| 验证与编排 | `scripts/**`、`TICKET_REGISTRY`、manifest／stable index／waiver 的 schema、reader、writer、validator，以及任何新 verifier、selector 或 runtime command |
| package 与依赖 | `package.json`、lockfile、依赖版本 |
| CI 与配置 | `.github/**`、Vitest／WDIO／Tauri／Rust test configuration、其他配置文件 |
| 非断言测试支撑 | test entry、bootstrap、harness、binary capture、`fixtures/**` 与静态 fixture；包括 `tests/` 下的 fixture、harness、bootstrap、config 与 entry，即使其文件名看似测试断言 |
| Performance 治理输入 | descriptor、budget、waiver、automatic-pass、采样或结果文件；`performance/**` 下非 `*.test.ts` 文件 |
| 已冻结治理与事实文档 | architecture／product／frontend contracts、tracker、`ARCH-GATE`、`RELEASE-GATE` 与历史 evidence |

若某项工作需要修改 denylist 路径，立即停止该项并记录为 `out-of-scope`；不得修改禁区、不得新增例外，也不得把停止规则解释为失败 evidence。

## Task-only 功能检查点

功能检查成功只能在对应 ticket 的未完成任务中记录 `functional checks complete`。该检查点不是 Ticket Status、ticket closure、runtime evidence、DAG blocker evidence、closure index 或 release credit，不能把任何 ticket 标为 `done`、推进 frontier 或启动仍被 blocker 阻塞的下游 ticket。

既有 `npm run verify:ticket -- FE-XX` 仍是正式 closure 入口；既有 ticket DAG、`verify:ticket` 串行语义、PF automatic verdict、waiver 和 `RELEASE-GATE` blocker 均保持不变。特别是 FE-01 的历史 PF-01 automatic `fail`／exit `1`、`samplingRun=false` 与 exact `accepted-with-waiver` disposition 不因本 change 改变。

### 失败后的独立只读复审

在正式 ready ticket 内，功能、PF 或正式 closure 任一失败／inconclusive 时，停止该 ticket 尚未开始的后续实现、PF 与 closure 工作，不能以先前 task-only checkpoint 继续推进。无论失败发生在哪一阶段，仍必须跳转到该 ticket 的独立只读复审并记录 finding；复审不是 closure，不能标记 `done`、更新 frontier 或产生 DAG blocker／release credit。这是人工执行分流，不改变既有 `verify:ticket` 在一次正式 invocation 内继续串行全部 registry steps 的行为。

## 一次性 changed-path 审计

提交前在临时 shell 中运行下列命令；它合并 `merge-base..HEAD`、已暂存、未暂存和未跟踪路径并去重。该命令只产生终端输出，不写入仓库脚本、CI 或验证代码。

```sh
base="$(git merge-base HEAD origin/main)"
{
  git diff --name-only "$base..HEAD"
  git diff --cached --name-only
  git diff --name-only
  git ls-files --others --exclude-standard
} | awk 'NF && !seen[$0]++'
```

人工判定规则：逐条将输出与本文件的永久 allowlist 比对。只有四个精确的本 change artifact、精确的 adopted tasks 文件、精确的本矩阵文件，或从“当前测试库存与 primary classification”区间逐文件提取并验证的 56 个测试断言路径才可接受；任何其他路径（包括后缀看似测试却未登记的路径和 denylist 中的路径）立即判定为 `out-of-scope`。此审计不实现自动影响分析，也不创建持久化 checker。

### Synthetic 路径验证记录

以下一次性内联 zsh 命令在本次收紧后运行并以 exit `0` 结束；没有创建仓库脚本。它只从 `## 当前测试库存与 primary classification` 到下一个 `## 人工选择规则` 的区间提取 Markdown 文件列表中反引号包裹的实际路径；`src-tauri/src/lib.rs::…` embedded target 不匹配提取前缀，继续只读登记且不进入 allowlist。提取集合必须是无重复的 56 个现有 assertion paths，并与静态 inventory 差集为零。`allowed_path` 先在所有目录应用永久 deny，再精确允许六个文档路径；其余候选仅在该 56 路径集合中以 `grep -Fx` 精确命中时允许，绝不按后缀放行。

```zsh
matrix='.scratch/agent-config-manager-frontend/TEST-EXECUTION-ORDER.md'
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
approved_paths="$temp_dir/approved-paths"
approved_paths_sorted="$temp_dir/approved-paths-sorted"
inventory_paths="$temp_dir/inventory-paths"
changed_paths="$temp_dir/changed-paths"

awk '
  /^## 当前测试库存与 primary classification$/ { in_inventory = 1; next }
  in_inventory && /^## 人工选择规则/ { exit }
  in_inventory && /^- `(tests\/|performance\/|src-tauri\/tests\/)[^`]+`$/ {
    path = $0
    sub(/^- `/, "", path)
    sub(/`$/, "", path)
    print path
  }
' "$matrix" > "$approved_paths"

approved_count="$(wc -l < "$approved_paths" | tr -d '[:space:]')"
[[ "$approved_count" == 56 ]] || exit 1
[[ -z "$(LC_ALL=C sort "$approved_paths" | uniq -d)" ]] || exit 1
LC_ALL=C sort "$approved_paths" > "$approved_paths_sorted"

{
  find tests -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.journey.test.ts' \) -print
  find performance -type f -name '*.test.ts' -print
  find src-tauri/tests -type f -name '*.rs' -print
} | LC_ALL=C sort > "$inventory_paths"
[[ "$(wc -l < "$inventory_paths" | tr -d '[:space:]')" == 56 ]] || exit 1
diff -u "$approved_paths_sorted" "$inventory_paths"

allowed_path() {
  local candidate="$1"

  case "$candidate" in
    scripts/*|.github/*|package.json|package-lock.json|src/*|src-tauri/src/*|fixtures/*|performance/descriptors/*|performance/budgets/*) return 1 ;;
  esac
  case "/$candidate/" in
    */scripts/*|*/verifier/*|*/harness/*|*/bootstrap/*|*/fixtures/*|*/config/*|*/entry/*) return 1 ;;
  esac
  case "${candidate##*/}" in
    verifier.*|harness.*|bootstrap.*|fixtures.*|config.*|entry.*|*config*|*.conf.*|*wdio*) return 1 ;;
  esac

  case "$candidate" in
    openspec/changes/separate-functional-and-performance-gates/.openspec.yaml|openspec/changes/separate-functional-and-performance-gates/proposal.md|openspec/changes/separate-functional-and-performance-gates/design.md|openspec/changes/separate-functional-and-performance-gates/tasks.md|openspec/changes/adopt-selected-b2-ui-baseline/tasks.md|.scratch/agent-config-manager-frontend/TEST-EXECUTION-ORDER.md) return 0 ;;
  esac
  case "$candidate" in
    tests/*|performance/*|src-tauri/tests/*) grep -Fx -- "$candidate" "$approved_paths" > /dev/null && return 0 ;;
  esac
  return 1
}

base="$(git merge-base HEAD origin/main)"
{
  git diff --name-only "$base..HEAD"
  git diff --cached --name-only
  git diff --name-only
  git ls-files --others --exclude-standard
} | awk 'NF && !seen[$0]++' > "$changed_paths"

actual_changed_count=0
while IFS= read -r changed_path; do
  allowed_path "$changed_path" || exit 1
  ((actual_changed_count += 1))
done < "$changed_paths"
[[ "$actual_changed_count" == 6 ]] || exit 1

document_paths=(
  openspec/changes/separate-functional-and-performance-gates/.openspec.yaml
  openspec/changes/separate-functional-and-performance-gates/proposal.md
  openspec/changes/separate-functional-and-performance-gates/design.md
  openspec/changes/separate-functional-and-performance-gates/tasks.md
  openspec/changes/adopt-selected-b2-ui-baseline/tasks.md
  .scratch/agent-config-manager-frontend/TEST-EXECUTION-ORDER.md
)
rejected=(
  scripts/orchestrator/verify-ticket.ts package.json package-lock.json
  .github/workflows/ci.yml vitest.config.ts tests/harness/bootstrap.ts
  fixtures/fx-01/fixture.json src/components/AssetList.tsx
  src-tauri/src/frontend_gateway.rs performance/descriptors/pf-02.json
  performance/budgets/pf-02.json
  tests/harness/bootstrap.test.ts tests/fixtures/fixture.test.ts
  tests/bootstrap/example.test.ts tests/config/example.test.ts
  tests/entry/example.test.ts tests/unit/entry.test.ts
  openspec/changes/separate-functional-and-performance-gates/scripts/verifier.mjs
  openspec/changes/separate-functional-and-performance-gates/README.md
  tests/l1/unlisted-verifier.test.ts tests/l1/unlisted-ordinary.test.ts
  performance/harness/bootstrap.test.ts src-tauri/tests/harness/bootstrap.rs
)

accepted_count=0
rejected_count=0
document_count=0
for document_path in "${document_paths[@]}"; do
  [[ -f "$document_path" ]] || exit 1
  allowed_path "$document_path" || exit 1
  ((document_count += 1))
done
while IFS= read -r approved_path; do
  [[ -f "$approved_path" ]] || exit 1
  allowed_path "$approved_path" || exit 1
  ((accepted_count += 1))
done < "$approved_paths"
[[ "$accepted_count" == 56 && "$document_count" == 6 ]] || exit 1
for rejected_path in "${rejected[@]}"; do
  allowed_path "$rejected_path" && exit 1
  ((rejected_count += 1))
done
printf 'approved=%d/56 documents=%d/6 changed=%d/6 rejected=%d/%d\n' "$accepted_count" "$document_count" "$actual_changed_count" "$rejected_count" "${#rejected[@]}"
```

结果：提取集合为 `56/56` 个现有 assertion paths、零重复，并与静态 inventory 的逐文件差集为零；全部 `56/56` 个实际批准路径和 `6/6` 个精确文档路径被接受，`23/23` 个 synthetic denylist 路径被拒绝。拒绝样本特别包括未登记但后缀合法的 `tests/l1/unlisted-verifier.test.ts`、`tests/l1/unlisted-ordinary.test.ts`，以及跨目录的 `performance/harness/bootstrap.test.ts`、`src-tauri/tests/harness/bootstrap.rs`；因此未登记后缀不会绕过矩阵。实际 changed-path 集合为 6 个精确文档路径，审计为 `6/6` accepted；没有测试、PF、`verify:ticket`、DAG 或 closure verdict 被运行或改变。

## 当前测试库存与 primary classification

盘点范围仅为本 change 的 D4：`tests/**/*.test.ts`、`tests/**/*.test.tsx`、`tests/**/*.journey.test.ts`、`performance/**/*.test.ts`、`src-tauri/tests/**/*.rs`，以及 `src-tauri/src/**` 中含 Rust test 的 target。静态清单命令如下；输出是审查输入，不是 runtime、PF 或 closure evidence。

```sh
{
  find tests -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.journey.test.ts' \) -print
  find performance -type f -name '*.test.ts' -print
  find src-tauri/tests -type f -name '*.rs' -print
} | LC_ALL=C sort
rg -l '#\[cfg\(test\)\]|#\[test\]|#\[tokio::test\]' src-tauri/src --glob '*.rs'
```

本次输出计数为：`tests/` 下 47 个 TypeScript 文件、`performance/` 下 2 个 TypeScript 文件，共 49 个；`src-tauri/tests/` 下 7 个 integration target；`src-tauri/src/lib.rs` 下 1 个 embedded target。下列分组逐项列出全部 57 个文件／target；每项恰有一个 primary classification，不存在 `unknown`、selector 或 runtime registry。

### `ticket-functional/FE-01`（15）

**文件／target：**

- `tests/contract/frontend-gateway-contract.test.ts`
- `tests/l1/read-only-workbench-session.test.ts`
- `tests/l1/read-only-workbench.test.ts`
- `tests/l1/sensitive-masking.test.ts`
- `tests/l1/tauri-gateway.test.ts`
- `tests/l1/tauri-workbench-wire.test.ts`
- `tests/l1/workspace-session.test.ts`
- `tests/l2/fx-01.journey.test.ts`
- `tests/l3/contract.test.ts`
- `tests/l3/fx-01.tracer.test.ts`
- `src-tauri/tests/catalog.rs`
- `src-tauri/tests/core_read.rs`
- `src-tauri/tests/export_wire.rs`
- `src-tauri/tests/masking.rs`
- `src-tauri/tests/workbench_status_locator.rs`

**覆盖场景：** FX-01 只读 FrontendGateway、WorkspaceSession、masked native-file、wire decode、L2 mock read journey、L3 isolated actual read／event reread，以及 catalog、core、locator 的 Rust public seam。`export_wire.rs` 的 primary 是 FE-01 byte-deterministic gateway export wire；它不是 FE-09 的未来用户 export。`masking.rs` 的 primary 是 FE-01；FE-02 的未来 FX-03 masking coverage 必须另建，不能借此文件改写归属。

**fixture／artifact 前置：** L1 使用 ScriptedMockGateway 或普通临时根；Rust catalog／core 使用既有 FX-01 fixture（只读）；L2 由 `tests/l2/wdio.conf.ts` 启动 Vite mock surface；L3 由既有受控 wrapper 先构建 test-harness（`tsc -b`、`vite.l3.config.ts`、Tauri debug harness），写入 `.artifacts/test-harness/identity.json` 并管理隔离 `fixtures/fx-01/native-root`。不得原地修改 fixture，L3 harness 不是 production artifact。

**provenance 边界：** L1 仅 public seam，无 browser／IPC／disk runtime credit；L2 仅 mock renderer；L3 仅隔离 synthetic FX-01 的 WebView／IPC／Rust core／disk read，非签名 production DMG／L4。任何聚焦成功都不是 FE-01 closure。

**开发期精确命令：**

```sh
npm run test:frontend -- tests/contract/frontend-gateway-contract.test.ts tests/l1/read-only-workbench-session.test.ts tests/l1/read-only-workbench.test.ts tests/l1/sensitive-masking.test.ts tests/l1/tauri-gateway.test.ts tests/l1/tauri-workbench-wire.test.ts tests/l1/workspace-session.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test catalog --test core_read --test export_wire --test masking --test workbench_status_locator
npm run test:ui -- --spec tests/l2/fx-01.journey.test.ts
node scripts/orchestrator/test-tauri.mjs
```

`test-tauri.mjs` 不接受本矩阵新增的过滤参数：它先构建并记录受控 harness identity，再以固定 `tests/l3/wdio.conf.ts` 运行现有 L3 tracer／contract 集合。

**正式完整入口：** 既有 `npm run verify:ticket -- FE-01`；它仍按 registry 运行完整 L0～L3 与 PF-01，且其既有 provenance／waiver／verdict 不变。本 change 不运行该入口。

### `ticket-functional/FE-07R`（3）

**文件／target：**

- `tests/l3/fx19.tracer.test.ts`
- `src-tauri/tests/project_applicability.rs`
- `src-tauri/tests/wire_vectors.rs`

**覆盖场景：** FX-19 project applicability 的 fail-closed projection、query-bound identity/provenance 与 bare actual-read tracer。`wire_vectors.rs` primary 为 FE-07R 的 wire／FX-19 contract，即使其中也覆盖 workbench 字段；不能归到未来 FE-09。

**fixture／artifact 前置：** `project_applicability.rs` 使用既有只读 FX-19 fixture；`wire_vectors.rs` 同时使用既有只读 FX-01 与 FX-19 fixtures。L3 由既有受控 FX-19 wrapper 先构建 harness（`tsc -b`、`vite.fx19.config.ts`、Tauri debug harness），写入 `.artifacts/test-harness/fx19-identity.json`，再由 runner 只复制 `fixtures/fx-19` 到临时根并设置 `ACM_FX19_ROOT`。

**provenance 边界：** Rust 是 L1 public seam；L3 只证明隔离 synthetic fixture 经过 WebView／IPC／Rust core／disk 的 actual-read，非真实用户项目或 production artifact。FE-07R 已有历史 closure 不因本矩阵或再次聚焦运行增加 credit。

**开发期精确命令：**

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test project_applicability --test wire_vectors
node scripts/orchestrator/test-fx19-tauri.mjs
```

`test-fx19-tauri.mjs` 不接受本矩阵新增的过滤参数：它先构建并记录受控 FX-19 harness identity，再以固定 `tests/l3/fx19.wdio.conf.ts` 运行 bare actual-read tracer。

**正式完整入口：** 既有 `npm run verify:ticket -- FE-07R`；当前仅作为已完成 FE-07R 的历史正式入口记录，本 change 不重跑它。

### `legacy-ui`（4）

**文件：**

- `tests/l1/full-ui-mock-b2-list.test.ts`
- `tests/l1/full-ui-mock-context.test.ts`
- `tests/l1/mock-gateway.test.ts`
- `tests/l2/full-ui-mock-b2.journey.test.ts`

**覆盖场景：** B2 selected mock list／context、ScriptedMockGateway 的历史 mock 行为，以及 selected B2 browse boundary。`mock-gateway.test.ts` primary 为 legacy-ui，不能把 mock gateway 当作 FE-01 actual-read 或任何 ticket closure evidence。

**fixture／artifact 前置：** L1 为内存 mock；L2 由 `tests/l2/wdio.conf.ts` 启动既有 mock Vite surface，无 native fixture 或 harness artifact。

**provenance 边界：** 只提供历史 mock UI regression；没有真实 IPC、disk、PF、ticket status 或 closure credit。

**开发期精确命令：**

```sh
npm run test:frontend -- tests/l1/full-ui-mock-b2-list.test.ts tests/l1/full-ui-mock-context.test.ts tests/l1/mock-gateway.test.ts
npm run test:ui -- --spec tests/l2/full-ui-mock-b2.journey.test.ts
```

**正式完整入口：** 无 ticket closure 入口；仅可作为完整 frontend／L2 regression 的组成部分：`npm run test:frontend` 与 `npm run test:ui`。

### `performance/PF-01`：实际采样（2）

**文件：**

- `performance/pf-01.perf.test.ts`
- `performance/pf-01.coldstart.test.ts`

**覆盖场景：** L2 mock catalog browse 的 startup／search／filter／select measurement，以及 L3 test-harness 的 process-start 至 first trusted snapshot cold-start sample。

**fixture／artifact 前置：** 必须使用既有 PF-01 descriptor、frozen budget、受管理的临时 `PF01_OUTPUT_DIR`；L2 使用 performance Vite config，L3 还需要既有 harness build、隔离 FX-01 native-root、lifecycle／resource attestation。不得手工创建样本、budget、descriptor、waiver 或自动结果。

**provenance 边界：** PF-01 是 synthetic performance descriptor，独立于 FE actual-read；L2 是 Vite dev/mock，L3 是 debug test-harness，均非 production／release measurement。自动结果、waiver 和 ticket closure 只能由既有正式流程判定。

**开发期精确命令：** 仅在 PF-01 已由当前正式 ticket acceptance 要求且具备受控输出目录时使用；本 change 禁止运行。

```sh
PF01_OUTPUT_DIR=<受管理的临时输出目录> npm exec -- wdio run performance/wdio.conf.ts --spec performance/pf-01.perf.test.ts
PF01_OUTPUT_DIR=<受管理的临时输出目录> npm exec -- wdio run performance/wdio.l3.conf.ts --spec performance/pf-01.coldstart.test.ts
```

**正式完整入口：** 既有 `npm run perf -- PF-01`；对于 FE-01，PF 仍由既有 `npm run verify:ticket -- FE-01` 纳入正式 closure 前的 PF verdict。本 change 不运行任一入口。

### `performance/PF-01`：contract、budget 与 lifecycle guard（15）

**文件／target：**

- `tests/l1/pf01-automated-result.test.ts`
- `tests/l1/pf01-baseline-freeze.test.ts`
- `tests/l1/pf01-budget-validation.test.ts`
- `tests/l1/pf01-budget.test.ts`
- `tests/l1/pf01-build-inputs.test.ts`
- `tests/l1/pf01-descriptor.test.ts`
- `tests/l1/pf01-lifecycle.test.ts`
- `tests/l1/pf01-measurement-inputs.test.ts`
- `tests/l1/pf01-proposed-budget-copy.test.ts`
- `tests/l1/pf01-resource.test.ts`
- `tests/l1/pf01-startup-eligibility.test.ts`
- `tests/l1/pf01-vite-module-id.test.ts`
- `tests/l1/refresh-pf01-budget.test.ts`
- `tests/l2/pf01-dev-module-graph.journey.test.ts`
- `src-tauri/src/lib.rs::test_harness_lifecycle::tests::exit_request_only_matches_the_current_harness_lifecycle_identity`

**覆盖场景：** PF-01 automatic result、frozen baseline／budget／descriptor、measurement 与 build-input digest、dev-module graph、resource、startup eligibility、normal-exit lifecycle 与 proposed-budget copy 的 fail-closed contract。embedded `lib.rs` target 是 PF-01 harness lifecycle identity guard，只读登记；本 change 不得修改 `src-tauri/src/lib.rs`。

**fixture／artifact 前置：** L1 使用临时 physical roots、Git object 和已检查入的 PF descriptor／budget／历史 artifact；module-graph probe 需要 `PF01_OUTPUT_DIR` 和 `performance/wdio.conf.ts` 的真实 Vite lifecycle；embedded guard 要启用 `test-harness` feature。任何 historical artifact 缺失、symlink 或 digest 漂移都应使相关 contract 失败／inconclusive，不能以虚构输入替代。

**provenance 边界：** 这些是 PF contract／lifecycle boundary tests，不是新的 measurement 或 closure evidence；embedded target 只认证 harness identity，不提供 production build credit。聚焦成功不改变 automatic result、budget、descriptor、waiver、index 或 ticket status。

**开发期精确命令：**

```sh
npm run test:frontend -- tests/l1/pf01-automated-result.test.ts tests/l1/pf01-baseline-freeze.test.ts tests/l1/pf01-budget-validation.test.ts tests/l1/pf01-budget.test.ts tests/l1/pf01-build-inputs.test.ts tests/l1/pf01-descriptor.test.ts tests/l1/pf01-lifecycle.test.ts tests/l1/pf01-measurement-inputs.test.ts tests/l1/pf01-proposed-budget-copy.test.ts tests/l1/pf01-resource.test.ts tests/l1/pf01-startup-eligibility.test.ts tests/l1/pf01-vite-module-id.test.ts tests/l1/refresh-pf01-budget.test.ts
PF01_OUTPUT_DIR=<受管理的临时输出目录> npm exec -- wdio run performance/wdio.conf.ts --spec tests/l2/pf01-dev-module-graph.journey.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --features test-harness --lib test_harness_lifecycle::tests::exit_request_only_matches_the_current_harness_lifecycle_identity -- --exact
```

**正式完整入口：** L1 PF contract／budget tests 由 `npm run test:frontend` 完整回归；L2 module-graph 必须运行上方精确的 `PF01_OUTPUT_DIR=<受管理的临时输出目录> npm exec -- wdio run performance/wdio.conf.ts --spec tests/l2/pf01-dev-module-graph.journey.test.ts`，embedded Rust lifecycle 必须运行上方精确的 `cargo test --manifest-path src-tauri/Cargo.toml --features test-harness --lib test_harness_lifecycle::tests::exit_request_only_matches_the_current_harness_lifecycle_identity -- --exact`，不得笼统替换为会运行更多目标的 `npm run test:rust`。`npm run perf -- PF-01` 只负责 PF 入口／结果，不具 ticket closure 语义；只有既有 predicate 下的 `npm run verify:ticket -- FE-01` 具有正式 ticket closure 语义。本 change 不运行上述任何入口。

### `evidence/verification-index`（4）

**文件：**

- `tests/l1/clean-evidence-index.test.ts`
- `tests/l1/latest-clean-accepted-with-waiver.test.ts`
- `tests/l1/latest-clean-pass.test.ts`
- `tests/l1/latest-clean-subject-accepted-with-waiver.test.ts`

**覆盖场景：** physical regular stable index 的原子前进、latest clean pass／accepted-with-waiver binding，以及 FE-01 run-local subject disposition 的 index publication guard。

**fixture／artifact 前置：** 前三个普通 index 文件使用测试内临时 physical roots 与 Git objects。`latest-clean-subject-accepted-with-waiver.test.ts` 是 exhaustive subject 组，运行前无条件要求下列全部既有物理输入可读：`.artifacts/performance/PF-01/`、`.artifacts/test-harness/identity.json`、历史 FE-01 backing `.artifacts/verification/FE-01/20260812T115759948Z-p90022-000/`，以及 stable index `.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json`。任一输入缺失、不可读或不合物理约束时，停止整个 subject 组；不得复制、重建、伪造或以临时替代历史 backing／index。

**provenance 边界：** 只验证 verifier 的 index／publication safety seam；不生成 manifest、closure、release 或 ticket status credit。

**开发期精确命令：**

```sh
npm run test:frontend -- tests/l1/clean-evidence-index.test.ts tests/l1/latest-clean-accepted-with-waiver.test.ts tests/l1/latest-clean-pass.test.ts
# 仅当上列 subject 组的全部物理前置均可读时：
npm run test:frontend -- tests/l1/latest-clean-subject-accepted-with-waiver.test.ts
```

**正式完整入口：** 既有 FE-01 full frontend／`npm run verify:ticket -- FE-01` 可调用相关 verifier boundary；单独运行本组永远不是 closure。

## 慢测优化评估结果（第 4 组 fallback）

**状态：** `blocked`。目标 worktree 的 FE-01 ignored physical artifact 前置不可读；本组按预设 fallback 完成评估并以零测试改动收口。`4.1` 至 `4.5` 的 `[x]` 只表示该 fallback 评估和零改动收口已完成，绝不表示运行过长测、取得 runtime 结果或获得任何 closure／gate credit。

**未运行与零改动：** 测试改动为 `0`；未采集 wall time、test count、fail 或 skip；没有运行 fast-contract、exhaustive、完整 `test:frontend` 或任何其他测试／PF／`verify:ticket`／runtime 命令。

**静态前置复核：** 目标 worktree 缺少且由 `.gitignore` 的 `.artifacts/` 规则忽略以下全部四项：

- `.artifacts/performance/PF-01/`
- `.artifacts/test-harness/identity.json`
- `.artifacts/verification/FE-01/20260812T115759948Z-p90022-000/`
- `.artifacts/verification/FE-01/latest-clean-subject-accepted-with-waiver.json`

`36a7` worktree 中四项均存在，但不是本组可用输入；严禁从该 worktree 复制、重建、伪造或以其他临时输入替代它们。静态阅读 exhaustive 文件确认其 setup 链会在 fresh temp root 中复制 PF 输入、写入由 source identity 派生的 physical identity／binary，并由 `installAuthorizedLegacyBacking()` 复制历史 backing 与 stable index；这正是不能绕过前置去采集指标的原因。

**候选映射（静态，不是测试结果）：**

| 候选测试名 | 直接被测 capture／validate seam | 必须保持的 physical／TOCTOU invariant |
| --- | --- | --- |
| `把 capture 时的 identity 与 binary 固化在本次 evidence root，之后不读取可变的全局 binary` | `captureFe01RunLocalHarnessAttestation` → `validateFe01RunLocalHarnessAttestation` | capture 后全局 binary／identity 漂移不得影响已固化的 run-local evidence。 |
| `拒绝缺失、symlink、hash 漂移或污染的 run-local identity/binary` | `captureFe01RunLocalHarnessAttestation` → `validateFe01RunLocalHarnessAttestation` | run-local identity／binary 缺失、symlink、hash 漂移或污染必须拒绝，且不得跨越 physical／TOCTOU 边界。 |

现有 exhaustive setup 无条件读取 PF／identity 输入，并调用 exact waiver 与 closure-lineage 校验；其 candidate／publication 路径还依赖 stable index、约 1 秒 lock 窗口及 historical backing。因此无法证明上述两类候选独立于 waiver、lineage、index、lock 或 history：`4.2` 在 blocked fallback 下不适用，`4.3` 不新增 fast-contract 文件且测试零改动，`4.4` 以 Git 的零测试 diff 证明 exhaustive 文件及其全部矩阵原样保留，`4.5` 不适用且未运行测试。

### `evidence/waiver-lineage`（8）

**文件：**

- `tests/l1/fe01-active-waiver-verdict.test.ts`
- `tests/l1/fe01-pf01-active-waiver.test.ts`
- `tests/l1/fe01-pf01-automatic-pass.test.ts`
- `tests/l1/fe01-pf01-subject-waiver.test.ts`
- `tests/l1/fe01-pf01-waiver.test.ts`
- `tests/l1/fe01-subject-lineage.test.ts`
- `tests/l1/fe01-subject-waiver-verdict.test.ts`
- `tests/l1/fe01-ticket-waiver-verdict.test.ts`

**覆盖场景：** exact FE-01 PF-01 automatic／subject／active／historical waiver、immutable artifact hash、subject lineage 和 closure verdict 的 fail-closed binding。

**fixture／artifact 前置：** 需要历史 subject Git object、已检查入的 exact waiver、frozen budget、immutable `.artifacts/performance/PF-01/` inputs 与测试创建的临时 copies。没有这些物理前置时停止相关运行；不得复制、重采样、泛化 waiver 或伪造 lineage。

**provenance 边界：** 只测试 historical／exact waiver-lineage 验证；不会把 PF automatic `fail`／exit `1` 改成 pass，也不授予 FE-01 closure 或 RELEASE-GATE credit。

**开发期精确命令：**

```sh
npm run test:frontend -- tests/l1/fe01-active-waiver-verdict.test.ts tests/l1/fe01-pf01-active-waiver.test.ts tests/l1/fe01-pf01-automatic-pass.test.ts tests/l1/fe01-pf01-subject-waiver.test.ts tests/l1/fe01-pf01-waiver.test.ts tests/l1/fe01-subject-lineage.test.ts tests/l1/fe01-subject-waiver-verdict.test.ts tests/l1/fe01-ticket-waiver-verdict.test.ts
```

**正式完整入口：** 仅既有 `npm run verify:ticket -- FE-01` 能在既有 predicate 下取得正式 status；本组的 targeted result 不具有 closure 语义。

### `evidence/orchestration`（6）

**文件：**

- `tests/l1/fe01-run-local-harness-capture.test.ts`
- `tests/l1/orchestrator-provenance.test.ts`
- `tests/l1/ticket-registry.test.ts`
- `tests/l1/verify-ticket-active-waiver.test.ts`
- `tests/l1/verify-ticket-runtime-advisory.test.ts`
- `tests/l1/verify-ticket-subject-waiver.test.ts`

**覆盖场景：** run-local harness capture、physical／Git／descriptor provenance guards、现有 registry 的 FE-01 steps，以及 automatic／subject waiver execution and runtime-advisory seams。

**fixture／artifact 前置：** 临时 physical roots、test-harness identity and current Git metadata；若检查 exact subject／PF binding，还需要既有 immutable evidence。`TICKET_REGISTRY` 仅供读；本 change 不添加 FE-02～FE-10 registry entry。

**provenance 边界：** 只验证 orchestration safety contract；没有新 selector、manifest、status、DAG 或 closure evidence。任何聚焦结果都不能取代 `verify:ticket`。

**开发期精确命令：**

```sh
npm run test:frontend -- tests/l1/fe01-run-local-harness-capture.test.ts tests/l1/orchestrator-provenance.test.ts tests/l1/ticket-registry.test.ts tests/l1/verify-ticket-active-waiver.test.ts tests/l1/verify-ticket-runtime-advisory.test.ts tests/l1/verify-ticket-subject-waiver.test.ts
```

**正式完整入口：** 仅既有 FE-01 `npm run verify:ticket -- FE-01`；矩阵不创建或改变 verifier registry／串行语义。

### 交叉归属裁决与零未知检查

- `src-tauri/tests/wire_vectors.rs` 的唯一 primary 是 `ticket-functional/FE-07R`；它随 FE-07R 的 FX-19 actual-read wire contract 审查，不能因包含 workbench 字段而转给其他票据。
- `src-tauri/tests/export_wire.rs` 的唯一 primary 是 `ticket-functional/FE-01`；它是 gateway byte wire，不是未来 FE-09 的用户 export。
- `src-tauri/tests/masking.rs` 的唯一 primary 是 `ticket-functional/FE-01`；FE-02／FX-03 如需 masking contract，必须在该 future ticket 的授权范围另建明确测试，不迁移或复用本分类。
- `tests/l1/mock-gateway.test.ts` 的唯一 primary 是 `legacy-ui`；mock regression 不能充作 FE-01 actual-read evidence。
- `src-tauri/src/lib.rs::test_harness_lifecycle::tests::exit_request_only_matches_the_current_harness_lifecycle_identity` 的唯一 primary 是 `performance/PF-01` contract；它仅只读盘点，`src-tauri/src/lib.rs` 仍在 denylist。

本节的 8 个 groups 总计为 `15 + 3 + 4 + 2 + 15 + 4 + 8 + 6 = 57`，与 `49 TypeScript + 7 Rust integration + 1 embedded target` 一致。新增或拆分的允许测试断言必须在同一 change 更新此表并重新执行静态差集审查；这是一项人工 review 要求，不是自动 selector 或 runtime registry。

## 人工选择规则与 planned-command 边界

以下规则是人工执行纪律；不声称自动影响分析，也不改变 `verify:ticket` 的串行全部 registry steps 行为。

| 变化类型 | 必须人工选择的检查 | 何时加入 evidence／PF | 结果语义 |
| --- | --- | --- | --- |
| 普通产品改动 | 先按所属 ticket 精确运行其 `ticket-functional/<FE-ID>` 文件／target，以及该 ticket 已要求的 L0～L3。 | 只在变更实际触及 evidence 输入边界时点名相关 evidence group；PF 仍留给该 ticket 的正式末段。 | 成功只是 `functional checks complete` task-only checkpoint，不是 closure、frontier 或 release credit。 |
| 测试内容改动 | 精确运行被改文件所属 primary group；若拆分／移动，先更新本矩阵并按新旧 group 共同核对。 | 被改的是 evidence／PF contract 文件时，点名运行该 relevant group；不得用邻近功能测试代替。 | 仅证明测试内容的聚焦回归，不能修改 registry、manifest、automatic result 或 status。 |
| evidence／provenance 输入变化 | 先定位受影响的 verification-index、waiver-lineage 或 orchestration boundary，精确点名该 group 的 exhaustive tests。 | 不以“没有产品代码改动”省略 evidence test；PF sampling 只有既有正式 ticket acceptance 要求时才运行。 | 结果不重写历史 evidence，且仍须由原正式入口和 provenance predicate 决定 closure。 |
| 无法证明影响范围 | 保守运行相关 ticket 的 exhaustive functional 集合与所有可能相关 evidence group；不能声称“不受影响”。 | 若可能触及 PF／descriptor／budget／measurement input，停止并作为 out-of-scope 或等待正式 PF 阶段，不临时采样。 | 不确定性不能被降级为 pass，也不能用 task-only checkpoint 解锁下游。 |

目前 registry 只存在 FE-01 与 FE-07R。`npm run verify:ticket -- FE-02` 至 `-- FE-10` 在其各自 ticket 按既有授权建立 registry entry 前，均只能写作 **planned command**，不声称可运行、已运行或已经拥有 PF target。特别是本矩阵没有创建 FE-02+ 的 registry、PF ID、descriptor、budget、waiver 或 verifier step。

## FE-02 当前 change：测试增量登记（5）

本节只登记 FE-02 task 3.8～3.10 新增的五个 assertion paths；它不回填或重解释上文 previous-change 的 `56/56` assertion、`6/6` document changed-path 审计。五个路径的唯一 primary classification 均为 `ticket-functional/FE-02`：

- `src-tauri/tests/fe02_read_surfaces.rs` — L1 Rust public `GatewayCore::read`、FX-02 多文件只读与 FX-03 Hook compatibility/security negative；无 WebView、IPC 或 write credit。
- `tests/l1/fe02-read-only-detail-session.test.ts` — L1 scripted read-session、显式 Skill source、LTI／Subagent 默认 read、revision/race 与零 write calls。
- `tests/l1/fe02-tauri-read-wire.test.ts` — L1 FX-02／FX-03 wire 正向投影与 malformed／unmasked fail-closed。
- `tests/l2/fe02-read-surfaces.journey.test.ts` — L2 mock-only detail／disclosure／Hook unreachable journey；不得取得 IPC 或 disk credit。
- `tests/l3/fx-02.tracer.test.ts` — L3 isolated FX-02 WebView → IPC → Rust/core → temporary disk actual-read；无 Hook、write、draft、prepare 或 apply credit。

`tests/l3/fx-02.wdio.conf.ts` 与 `scripts/orchestrator/test-fx02-tauri.mjs` 是当前 FE-02 的 L3 支撑／identity-binding 入口，不是 assertion paths，也不计入上述五项。当前静态盘点为历史 external assertions `56` + FE-02 delta `5` = `61`（`tests/` 51、`performance/` 2、`src-tauri/tests/` 8）；embedded Rust target 仍为 1，因此合计 62 targets。上文 `49 TypeScript + 7 Rust integration + 1 embedded = 57` 保持为 previous-change archived snapshot。

本次使用以下独立 delta audit；它保留历史 56 路径原样，从当前静态 inventory 求新增集合，再与本节五个登记路径比较。2026-08-14 执行预期为 `historical=56 current=61 delta=5 registered=5`，且两个 `diff` 均为零：

```zsh
set -e
matrix='.scratch/agent-config-manager-frontend/TEST-EXECUTION-ORDER.md'

historical=("${(@f)$(awk '
  BEGIN { tick = sprintf("%c", 96) }
  /^## 当前测试库存与 primary classification$/ { inventory = 1; next }
  inventory && /^## 人工选择规则/ { exit }
  inventory && substr($0, 1, 3) == "- " tick && substr($0, length($0), 1) == tick {
    path = substr($0, 4, length($0) - 4)
    if (path ~ /^(tests\/|performance\/|src-tauri\/tests\/)/) print path
  }
' "$matrix" | LC_ALL=C sort)}")

current=("${(@f)$({
  find tests -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.journey.test.ts' \) -print
  find performance -type f -name '*.test.ts' -print
  find src-tauri/tests -type f -name '*.rs' -print
} | LC_ALL=C sort)}")

missing="$(comm -23 <(printf '%s\n' "${historical[@]}") <(printf '%s\n' "${current[@]}"))"
[[ -z "$missing" ]]
delta=("${(@f)$(comm -13 <(printf '%s\n' "${historical[@]}") <(printf '%s\n' "${current[@]}"))}")

registered=("${(@f)$(awk '
  BEGIN { tick = sprintf("%c", 96) }
  /^## FE-02 当前 change：测试增量登记（5）$/ { fe02 = 1; next }
  fe02 && /^## / { exit }
  fe02 && substr($0, 1, 3) == "- " tick {
    body = substr($0, 4); tick_pos = index(body, tick)
    if (tick_pos > 1) {
      path = substr(body, 1, tick_pos - 1)
      if (path ~ /^(tests\/|performance\/|src-tauri\/tests\/)/) print path
    }
  }
' "$matrix" | LC_ALL=C sort)}")

[[ "${#historical[@]}" == 56 ]]
[[ "${#current[@]}" == 61 ]]
[[ "${#delta[@]}" == 5 ]]
[[ "${#registered[@]}" == 5 ]]
diff -u <(printf '%s\n' "${registered[@]}") <(printf '%s\n' "${delta[@]}")
printf 'historical=%d current=%d delta=%d registered=%d\n' "${#historical[@]}" "${#current[@]}" "${#delta[@]}" "${#registered[@]}"
```

上述登记只支持 task 3.10 的 `functional checks complete` checkpoint。PF-02、PF-03、FE-02 registry、`npm run verify:ticket -- FE-02`、closure verdict 与 downstream frontier 仍未建立或执行；不得由本节结果推导。

## 统一 performance optimization backlog 模板

此表是后续独立 optimization change 的人工计划模板，当前不登记新 performance debt。填写一行不会生成或修改 manifest、automatic result、waiver、stable index、budget、descriptor 或 ticket status。

| Ticket | PF ID | automatic result（仅引用既有记录） | metric | descriptor／budget provenance | 运行环境 | 当前 closure blocker | 建议的独立优化 change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `<FE-ID>` | `<PF-ID>` | `<status / exit / runId；无记录则写 none>` | `<stable metric id>` | `<checked-in descriptor + frozen budget path/digest>` | `<L2 Vite mock 或 L3 test-harness；非 production>` | `<PF fail/inconclusive 或正式 closure failure>` | `<new change name；不得在当前 ticket 内绕过>` |

模板中的 `automatic result` 只能引用既有正式产物，不能由本 change 填写为 pass；性能优化、预算调整、重新采样、waiver disposition 和 release 评估都必须由建议的独立 change 另行授权。
