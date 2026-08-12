/**
 * 票据关闭配置的唯一事实源。
 *
 * verifier 只从本文件取得步骤、fixture digest 根、可选 PF metadata 和
 * harness artifact identity；不得在 orchestration 内按 ticket ID 硬编码。
 */

const L0_STATIC_PROVENANCE = 'L0 静态 contract/wire drift gate；不取得 runtime/IPC/磁盘 credit';
const L1_RUST_PROVENANCE = 'L1 Rust public seam tests；无 WebView/IPC runtime credit';
const L1_FRONTEND_PROVENANCE =
  'L1 frontend/Vitest public seam tests；无 browser/WebView/IPC/磁盘 runtime credit';
const L2_PROVENANCE = 'L2 mock renderer journey；不取得真实 IPC/事件/磁盘 credit';
const L3_PROVENANCE =
  'L3 isolated synthetic fixture through real WebView/IPC/Rust core/disk read；非生产签名/DMG/L4';
const PF_PROVENANCE = 'PF synthetic performance descriptor；独立于 ticket actual-read provenance';

export const TICKET_REGISTRY = Object.freeze({
  'FE-01': {
    scope: 'FE-01',
    evidenceScope: 'ticket-closure',
    fixtures: [{ id: 'FX-01', root: 'fixtures/fx-01' }],
    steps: [
      {
        id: 'toolchain',
        layer: 'L0',
        provenance: L0_STATIC_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/verify-toolchain.mjs'],
        timeoutMs: 300_000,
      },
      {
        id: 'static',
        layer: 'L0',
        provenance: L0_STATIC_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/verify-static.mjs'],
        timeoutMs: 1_800_000,
      },
      {
        id: 'rust',
        layer: 'L1',
        provenance: L1_RUST_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/test-rust.mjs'],
        timeoutMs: 1_800_000,
      },
      {
        id: 'frontend',
        layer: 'L1',
        provenance: L1_FRONTEND_PROVENANCE,
        cmd: 'corepack',
        args: ['npm', 'run', 'test:frontend'],
        timeoutMs: 600_000,
      },
      {
        id: 'ui',
        layer: 'L2',
        provenance: L2_PROVENANCE,
        cmd: 'corepack',
        args: ['npm', 'run', 'test:ui'],
        timeoutMs: 900_000,
      },
      {
        id: 'tauri',
        layer: 'L3',
        provenance: L3_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/test-tauri.mjs'],
        timeoutMs: 2_400_000,
      },
      {
        id: 'perf',
        layer: 'PF',
        provenance: PF_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/perf.mjs', 'PF-01'],
        timeoutMs: 2_400_000,
        evidenceOutput: { env: 'PERF_OUTPUT_DIR', relativeDir: 'performance' },
      },
    ],
    performance: {
      descriptorPath: 'performance/descriptors/pf-01.catalog-browse.json',
      budgetPath: 'performance/budgets/pf-01.budgets.json',
      // 仅供历史审计；verify:ticket 不读取它，也绝不因此跳过新的 PF 采样或产生 waiver closure。
      historicalWaiverPath: 'performance/waivers/fe-01-pf-01-l3-cold-start.json',
      historicalActiveWaiverPath: 'performance/waivers/fe-01-pf-01-search-results-active.json',
      // 仅本次 FE-01 subject 的 exact manual disposition 可启动 historical validation；旧 waiver 仍只读历史审计。
      subjectWaiverPath: 'performance/waivers/fe-01-pf-01-subject-startup-p50.json',
      // 只有未来 immutable automatic-pass record 可免于重复 sampling；旧 waiver 绝不进入 closure。
      automaticPassPath: 'performance/automatic-passes/fe-01-pf-01.json',
      profile: 'representative',
      unfrozenLabel: 'budget-not-frozen（首次完整 clean representative baseline 只收集样本；该次仍为 inconclusive）',
      frozenLabel: 'budget-frozen（performance/budgets/pf-01.budgets.json）',
    },
    artifact: {
      identityPath: '.artifacts/test-harness/identity.json',
      fallback: { kind: 'test-harness', identifier: 'unknown', profile: 'unknown' },
      production: 'N/A（FE-01 不产出生产 artifact）',
    },
    uncoveredBoundaries: [
      'PF-01 仅为 L2 Vite dev/mock 与 L3 debug test-harness 的 development acceptance profile',
      '不证明 reference-Mac、release-like 或 production artifact',
      '不更新 automatic-pass index，不能解除 RELEASE-GATE；仍需独立 release/reference evidence',
    ],
    manifestAssertions: { runIdMatchesEvidenceDirectory: true },
  },
  'FE-07R': {
    scope: 'FE-07R',
    evidenceScope: 'actual-read',
    fixtures: [{ id: 'FX-19', root: 'fixtures/fx-19' }],
    steps: [
      {
        id: 'static',
        layer: 'L0',
        provenance: L0_STATIC_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/verify-static.mjs'],
        timeoutMs: 1_800_000,
      },
      {
        id: 'rust-fx19',
        layer: 'L1',
        provenance: L1_RUST_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/test-rust.mjs', 'FE-07R'],
        timeoutMs: 1_800_000,
      },
      {
        id: 'tauri-fx19',
        layer: 'L3',
        provenance: L3_PROVENANCE,
        cmd: 'node',
        args: ['scripts/orchestrator/test-fx19-tauri.mjs'],
        timeoutMs: 2_400_000,
      },
    ],
    artifact: {
      identityPath: '.artifacts/test-harness/fx19-identity.json',
      fallback: { kind: 'test-harness', identifier: 'unknown', profile: 'unknown' },
      production: 'N/A（FE-07R 不产出生产 artifact）',
    },
    uncoveredBoundaries: [
      '无 L2 UI journey',
      '无 PF',
      '无业务写入、项目 lifecycle/index、prepare/apply',
      '仅证明隔离 synthetic FX-19 input，不证明真实用户项目、配置或生产 artifact',
    ],
    manifestAssertions: { runIdMatchesEvidenceDirectory: true },
  },
});

export function ticketConfig(ticketId) {
  return TICKET_REGISTRY[ticketId];
}
