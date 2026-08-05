# v22 四件套 intake / replay 记录

## 隔离基线与范围

- 目标 tree：`agent-config-hub-b2-gptpro-verify-v22`，detached `HEAD` 为 `6c6a6bf85dd84e3dfec2201478d9fff5d2f5be5d`。
- 输入 fixed-derived baseline 已验证：tracked overlay `85bf6766e328c28d4e58c7e997df2279e068e636b85b1b008c83cc71fa2afeab`；授权 seed 9304 bytes / `128fa738e5d0389a3416663f0af57dd822c076e6e5ffac0f7e31a780e82e9c6b`。
- 未修改原 B2 worktree，未手工编辑产品/测试源码，未 commit、push、PR 或 deploy。

## 制品身份与 manifest/report 一致性

| 制品 | Bytes | SHA-256 | 结果 |
| --- | ---: | --- | --- |
| `agent-config-hub-selected-b2-v22-full.patch` | 385518 | `d8fd0b4e35767ff2001e54229b912472634f9c681262b99b3ea620d756954712` | PASS |
| `agent-config-hub-selected-b2-v22-changed-files.zip` | 201225 | `9eb4f9d8431fcedb42e0ca7db60e84ca5c686c9f188e2548d18845c0d4b09a88` | PASS |
| `agent-config-hub-selected-b2-v22-manifest.json` | 21429 | `985fbfeed92d481b161aa03fe9003f3afd7d4dcd7c5021c77e2bc3eab1d5b4fa` | PASS |
| `agent-config-hub-selected-b2-v22-implementation-report.md` | 9503 | `4ddda3d72658797548620c3e128112f8ab9c9e9f85caa4dbb95d270f85f9c1a7` | PASS |

manifest schema 为 22。manifest 对 implementation report 的逻辑文件名、9503 bytes 与 SHA-256 一致；manifest 自身使用 self-referential digest null，故以外层固定 SHA 作为身份锚点。

## ZIP、路径与敏感扫描

- `unzip -t`：PASS，无 CRC 错误。
- ZIP、patch、manifest path 集合一致：**16/16**；ZIP extraction 的 bytes/SHA-256 与 manifest records 一致：**16/16**。
- ZIP 安全计数均为 0：duplicate、absolute path、`..` traversal、backslash path、directory、mode violation。全部 16 entries 为 regular `0644`，无 symlink 或 executable entry。
- patch 为 UTF-8，16 diff sections，9 modified、7 added、0 deleted。

扫描覆盖 patch、manifest、implementation report 与 ZIP 的 16 个解压文件。输出策略仅允许类别/文件/数量；未输出或保存任何匹配值。

| 扫描类别 | 命中文件 | 命中数量 |
| --- | --- | ---: |
| GPT sandbox credential label | 无 | 0 |
| known service token shape | 无 | 0 |
| generic credential assignment shape | 无 | 0 |
| private-key PEM marker | 无 | 0 |
| Artifactory/JFrog credential label | 无 | 0 |
| Artifactory/JFrog credential URL | 无 | 0 |

人工排除结论：所有扫描类别均为 0 命中，因此没有候选项需要人工排除；未发现 GPT sandbox credential 进入四件套。此为模式扫描，不替代外部凭据审计。

## v21 → v22 范围与格式化证据

- v21/v22 的 16 条 payload 路径集合相同。
- 仅 `tests/l2/full-ui-mock-b2.journey.test.ts` 不同：**1**；其余路径 byte-identical：**15/15**。
- v22 的该文件为 42331 bytes / `bd57b305b6461dc6235f7fa68b48dcd114f1749487de858f905eed6aa9a2526c`。
- 补丁后以 Node `24.18.0`、npm `11.16.0` 安装依赖，Prettier `3.9.6` 对 v22 文件的只读 `--check`：PASS；对 v21 ZIP extraction 的同一文件：exit 1。结合唯一文件差异与其余 15/15 一致，确认 v21→v22 是该 L2 文件的 repository-config Prettier 折行变化。

## Replay 与依赖安装

1. `git apply --check --whitespace=error-all`：PASS。
2. 应用 v22 complete patch：PASS。
3. `git diff --check`：PASS。
4. 应用后 `git apply --reverse --check --whitespace=error-all`：PASS；未实际 reverse apply。
5. replay target、v22 ZIP extraction 与 manifest records 最终文件逐字节一致：**16/16**。
6. 补丁后 `npm ci --offline`：PASS（791 packages added，audit 0 vulnerabilities）。npm 提示 12 个依赖 install scripts 尚未由 allowScripts 覆盖；未将此提示转换为门禁 PASS/FAIL。

本轮没有运行 Vitest、WDIO、build 或 ticket 门禁；补丁/ZIP/Prettier/安装的结果不构成这些运行时、Mock、L3、Gateway、IPC、Tauri、生产或真实数据行为的证据。
