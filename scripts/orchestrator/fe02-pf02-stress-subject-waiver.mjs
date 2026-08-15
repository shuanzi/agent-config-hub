/**
 * FE-02 的第二份 subject-bound PF-02 stress manual disposition。
 *
 * 与 representative waiver 共用 fe02-pf02-subject-waiver-factory.mjs 的 fail-closed
 * exact 语义；本文件只注入 stress profile 的钉死 historical 常量（scope 明确不泛化、
 * 不复用）。只重读 immutable historical artifacts 和对应 Git objects；绝不启动
 * PF sampling，也不读取/升级旧 waiver record。
 */
import {
  createFe02Pf02SubjectWaiver,
  FE02_PF02_SUBJECT_WAIVER_EXECUTION_MODE,
} from './fe02-pf02-subject-waiver-factory.mjs';

export const FE02_PF02_STRESS_SUBJECT_WAIVER_PATH =
  'performance/waivers/fe-02-pf-02-stress-scroll-render-stable.json';
export const FE02_PF02_STRESS_SUBJECT_WAIVER_SHA256 =
  '3765d5bf11a67136153894775ee60ca2f45be583ac4b5cd218782b193682f4d4';
export const FE02_PF02_STRESS_SUBJECT_WAIVER_MODE = FE02_PF02_SUBJECT_WAIVER_EXECUTION_MODE;

const PERFORMANCE = 'PF-02';
const PROFILE = 'stress';
const BASELINE = Object.freeze({
  runId: '20260814T153438289Z-p43278-000',
  commit: '9470f64e9b1edb4695092675fbfbd2043ac7b354',
});
const SUBJECT = Object.freeze({
  runId: '20260815T094047023Z-p76378-000',
  commit: '222efc489f85a9efe9997f19badc350f23f50bb2',
});
const BUDGET_PATH = 'performance/budgets/pf-02.stress.budgets.json';
const DESCRIPTOR_PATH = 'performance/descriptors/pf-02.source-large.json';
const EXPECTED_VIOLATION = Object.freeze({
  metric: 'pf02.source.scroll.render_stable',
  statistic: 'p50',
  observedMs: 12.25,
  thresholdMs: 8.5,
  deltaMs: 3.75,
});
const AUTHORIZATION = Object.freeze({
  scope:
    '仅此 FE-02 subject historical PF-02 stress 的 pf02.source.scroll.render_stable 自动 numeric latency fail；不改变 automatic fail/exit 1、预算、阈值、公式、样本数、collector、verifier 规则或历史 artifact，不泛化、不复用。',
  policy: '仅精确 numeric latency violation 可有显式人工 disposition；hard gate 不可 waive；不得称为 automatic PASS。',
});
const EXPECTED_ARTIFACTS = Object.freeze({
  baseline: Object.freeze({
    'samples.json': 'ee99b9b0cc98a28ea4f1715f7d15a0cc2eecbb20500f9e8849a3be67d8dd779c',
    'summary.json': '47b2e32919c3e5ef48a05f44705bc0c2ac0f59d62eef14b931ecb7a92c6a3bc2',
    'proposed-budgets.json': 'e0cec9a5a50bb4a3c44b326e5e05f2e1ae1496401c75e17193181f4026e413da',
  }),
  subject: Object.freeze({
    'samples.json': '621f004678933f42d31b47dab3627c1d3a9d757a7469ce86448b84a9a97a6902',
    'summary.json': '989c1f400efae0587318bf7a1cf9a6dd6754ac61c1cfa939efe037d48861c0ae',
    'fixture-attestation.json': 'f09642a756a499dd695f8e58836243cafc710d2f76f52449b2cb166f6177c0ed',
    'l2-dev-module-graph.json': '0461ec1eb1f9e6ca4b0412cec23a56abd84d728238f50b2cdbd7f01ae5b7b2fa',
    'proposed-budgets.json': '2002e62c8b1e334c159cbf8e7420bb40cfca528bc9d76c70b47020f20a96803c',
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
    '受控诊断（.scratch/diagnostics/fe-02-pf02-scroll/REPORT.md：120 迭代处理组+对照组+帧标定）确认产品侧 tStable-t0 p50 3.2ms/max 3.9ms 恒定，95% rAF 间隔锁 16.7ms vsync 网格，对照组无 DOM 变更亦呈慢模态 99.2%；结论为 headless Chrome BeginFrame 帧调度相位噪声，排除产品回归。',
  scope: '仅 PF-02 stress 的 scroll.render_stable p50 3.75ms 超出 frozen regression threshold；不掩盖 automatic fail。',
});

const stress = createFe02Pf02SubjectWaiver({
  waiverPath: FE02_PF02_STRESS_SUBJECT_WAIVER_PATH,
  waiverSha256: FE02_PF02_STRESS_SUBJECT_WAIVER_SHA256,
  kind: 'fe-02-pf-02-stress-scroll-render-stable-exact-performance-waiver',
  performance: PERFORMANCE,
  profile: PROFILE,
  baseline: BASELINE,
  subject: SUBJECT,
  budgetPath: BUDGET_PATH,
  budgetSha256: '8b6684c3795876a2ae56367bf0f9581df0d1b581e3338c6c95cba1c0b3d02176',
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
    sha256: '91c8c9502f06b4f6162bc107b248bb2451b27b3ecfd7c9e3fe338ab3408395f3',
  },
  sampleCount: 10,
  performanceDebt: PERFORMANCE_DEBT,
});

export const isExactFe02Pf02StressSubjectWaiverRecord = stress.isExactRecord;
export const validateFe02Pf02StressSubjectWaiver = stress.validate;
export const subjectPf02StressStepMetadata = stress.subjectStepMetadata;
