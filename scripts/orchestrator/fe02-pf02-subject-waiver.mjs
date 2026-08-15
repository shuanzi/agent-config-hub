/**
 * FE-02 的唯一 subject-bound PF-02 representative manual disposition。
 *
 * 通用 fail-closed exact 逻辑在 fe02-pf02-subject-waiver-factory.mjs；本文件只注入
 * representative profile 的钉死 historical 常量并保持既有公开导出与行为不变。
 * 只重读 immutable historical artifacts 和对应 Git objects；绝不启动 PF sampling，
 * 也不读取/升级旧 waiver record。
 */
import {
  createFe02Pf02SubjectWaiver,
  FE02_PF02_SUBJECT_WAIVER_EXECUTION_MODE,
} from './fe02-pf02-subject-waiver-factory.mjs';

export const FE02_PF02_SUBJECT_WAIVER_PATH =
  'performance/waivers/fe-02-pf-02-representative-scroll-render-stable.json';
export const FE02_PF02_SUBJECT_WAIVER_SHA256 =
  '60a6f7dbb89da3b6a2a4c955af796a41c7b5ec5d87dc765177056fc9c4e0eb8b';
export const FE02_PF02_SUBJECT_WAIVER_MODE = FE02_PF02_SUBJECT_WAIVER_EXECUTION_MODE;

const PERFORMANCE = 'PF-02';
const PROFILE = 'representative';
const BASELINE = Object.freeze({
  runId: '20260814T153344617Z-p43084-000',
  commit: '9470f64e9b1edb4695092675fbfbd2043ac7b354',
});
const SUBJECT = Object.freeze({
  runId: '20260815T060139784Z-p84684-000',
  commit: '7936cb91f54c94e836124b0d46337247776431d2',
});
const BUDGET_PATH = 'performance/budgets/pf-02.representative.budgets.json';
const DESCRIPTOR_PATH = 'performance/descriptors/pf-02.source-large.json';
const EXPECTED_VIOLATION = Object.freeze({
  metric: 'pf02.source.scroll.render_stable',
  statistic: 'p50',
  observedMs: 12.95,
  thresholdMs: 3.9375,
  deltaMs: 9.0125,
});
const AUTHORIZATION = Object.freeze({
  scope:
    '仅此 FE-02 subject historical PF-02 representative 的 pf02.source.scroll.render_stable 自动 numeric latency fail；不改变 automatic fail/exit 1、预算、阈值、公式、样本数、collector、verifier 规则或历史 artifact，不泛化、不复用。',
  policy: '仅精确 numeric latency violation 可有显式人工 disposition；hard gate 不可 waive；不得称为 automatic PASS。',
});
const EXPECTED_ARTIFACTS = Object.freeze({
  baseline: Object.freeze({
    'samples.json': '4c69d018fc9b54e45ae7340b6716b8b1cdc352cf2e1d1d5f4a0730dd43e13aa4',
    'summary.json': '373705bcb83f62ac8278521e69d1bc70804c6a70e87f14b97087f84e99c97e01',
    'proposed-budgets.json': '10297e8e61e8d315ebc0f036593116e10df0c2b5b45ab1aa7261be9b5fd1b864',
  }),
  subject: Object.freeze({
    'samples.json': '25123773cfe6dc4d24225e8c7c55ed00778adf1cad3b3d2b17b92c52b25b19ff',
    'summary.json': '9323fa0edab6c98bdb49ff99cc6cdd2c6fd34dd5da22a10c3cb07f395db67137',
    'fixture-attestation.json': 'b588bcd36ab999e618acba98e86d36e2ba01c295d0d5ca3ebe9fbe04c7f2a76e',
    'l2-dev-module-graph.json': '0461ec1eb1f9e6ca4b0412cec23a56abd84d728238f50b2cdbd7f01ae5b7b2fa',
    'proposed-budgets.json': '26f646bc424005e9fc9a6c6fefabe31c5c5892af77b06a06b8440c48d79516be',
  }),
});
const RUNNER = Object.freeze({
  node: 'v24.18.0',
  npm: '11.16.0',
  platform: 'darwin',
  release: '25.6.0',
  macosProductVersion: '26.6.1',
  arch: 'arm64',
});
const TOOLCHAIN = Object.freeze({
  cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)',
  rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)',
});
/** summary/fixture evidence 内 toolchain 的 key 顺序为 rustc 在前；与 record 常量分开绑定。 */
const SUMMARY_TOOLCHAIN = Object.freeze({
  rustc: 'rustc 1.97.1 (8bab26f4f 2026-07-14)',
  cargo: 'cargo 1.97.1 (c980f4866 2026-06-30)',
});
const PERFORMANCE_DEBT = Object.freeze({
  status: 'deferred',
  phase: 'post-optimization',
  rootCause:
    'collector 以两个 requestAnimationFrame 间隔度量 render_stable，冻结 p50 ceiling（3.9375ms）与 headless Chrome 帧量化/宿主调度噪声同量级；同一 commit、全部测量输入零 diff 的三次测量呈双峰（快簇 1.9-6.7ms，慢簇 16-19.3ms）且在 representative/stress 间交替失败，baseline 自身 p95 已达 16.965ms；证据指向宿主调度/测量相位不稳定而非产品回归，未经受控诊断采样进一步证实。',
  scope: '仅 PF-02 representative 的 scroll.render_stable p50 9.0125ms 超出 frozen regression threshold；不掩盖 automatic fail。',
});

const representative = createFe02Pf02SubjectWaiver({
  waiverPath: FE02_PF02_SUBJECT_WAIVER_PATH,
  waiverSha256: FE02_PF02_SUBJECT_WAIVER_SHA256,
  kind: 'fe-02-pf-02-representative-scroll-render-stable-exact-performance-waiver',
  performance: PERFORMANCE,
  profile: PROFILE,
  baseline: BASELINE,
  subject: SUBJECT,
  budgetPath: BUDGET_PATH,
  budgetSha256: '1bd6c4944fdb9de1cf360be2d08745791e3cf7f0e24f449c559b29a439bd4606',
  descriptorPath: DESCRIPTOR_PATH,
  descriptorDigest: '53df623aeb8538e1ad8e2821c287603241647de870dcd2c04c8816cb1beff86e',
  expectedViolation: EXPECTED_VIOLATION,
  authorization: AUTHORIZATION,
  expectedArtifacts: EXPECTED_ARTIFACTS,
  runner: RUNNER,
  toolchain: TOOLCHAIN,
  summaryToolchain: SUMMARY_TOOLCHAIN,
  measurementInputs: {
    schemaVersion: 1,
    algorithm: 'pf-read-measurement-contract-v1',
    digest: 'a1b474199c61bf46c769d83f22c6b7953be7f1053db0c1cbf3ed108e9259de45',
    l2DevModuleGraphSha256: '0461ec1eb1f9e6ca4b0412cec23a56abd84d728238f50b2cdbd7f01ae5b7b2fa',
  },
  fixture: {
    generator: 'src/gateway/pf-read-fixtures.ts#buildPf02SourceLargeFixture',
    profile: PROFILE,
    sha256: 'fc1100b4835e795128117099bc6c246497a26ef0d37bbbb941c3b87d41989e56',
  },
  sampleCount: 20,
  performanceDebt: PERFORMANCE_DEBT,
});

export const isExactFe02Pf02SubjectWaiverRecord = representative.isExactRecord;
export const validateFe02Pf02SubjectWaiver = representative.validate;
export const subjectPf02StepMetadata = representative.subjectStepMetadata;
