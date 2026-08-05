# v22 authoritative gate summary

## Baseline

- Worktree: `agent-config-hub-b2-gptpro-verify-v22`
- HEAD: `6c6a6bf85dd84e3dfec2201478d9fff5d2f5be5d` (detached)
- Toolchain: Node `v24.18.0`, `corepack npm` `11.16.0`, and `lucide-react@1.28.0` present after the pre-applied offline install.
- Tracked diff SHA-256 remained `a1cff641e5ba63f53028be731f0d27bc5984f398a538d58113cbf43274f2ba40`.
- The 16 payload file size/SHA-256 pairs match before and after all gates. Final non-evidence Git status matches the baseline.

## Results

| Command | Result |
| --- | --- |
| `npm run verify:toolchain` | PASS (exit 0) |
| `npm run verify:static` | PASS, 9/9 (exit 0) |
| focused L1: context + b2-list | PASS, 62/62 (exit 0) |
| `npm run test:frontend` | PASS, 108/108 (exit 0) |
| `npm run build:frontend` | PASS (exit 0) |
| B2 L2 WDIO | PASS, 21/21 (exit 0) |
| full UI L2 WDIO | PASS, 29/29 (exit 0) |
| `git diff --check` | PASS (exit 0) |
| `npm run verify:ticket -- FE-01` | INCONCLUSIVE (exit 2), only PF-01 `budget-not-frozen` |

The ticket's L0, L1, L2, and L3 debug test-harness stages passed. PF-01 completed its sample collection but cannot PASS until a numerical budget is separately authorized and frozen. This is not a technical test failure.

Raw stdout, stderr, and exit-code files for each command are kept alongside this summary. No source, test, or lockfile was modified; only this evidence directory and ignored command-generated artifacts were written. No commit, push, PR, or deployment was performed.
