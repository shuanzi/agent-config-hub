/* global process, console */
/**
 * perf（PF-01 baseline 采集）。
 *
 * 用法：node scripts/orchestrator/perf.mjs PF-01 [--profile representative|stress]
 *
 * 流程：校验 descriptor 自描述 digest → L2 采样（wdio headless Chrome，
 * performance/wdio.conf.ts）→ 确保 L3 harness 已构建（build-harness.mjs）
 * → L3 冷启动采样（performance/wdio.l3.conf.ts，每次 wdio run 由 tauri
 * service 新起 harness 进程取 1 个进程级样本，串行 3 次）→ 合并读
 * samples.json / l3-samples.json 汇总 p50/p95 → 写 summary.json 与
 * proposed-budgets.json 到输出目录。
 *
 * 预算门（ARC-06c §3.16，预算未冻结不得宣称通过）：
 * - 首次完整、clean representative baseline 只收集样本并保持 budget-not-frozen；
 *   它绝不写入 performance/budgets/pf-01.budgets.json，须独立人工审核后才可冻结；
 * - 存在 → 按预算逐 metric 比较，超预算 exit 1，达标 exit 0（未来路径）。
 * 采样本身失败（wdio 非零退出、样本数不足）一律 exit 1。
 *
 * 样本/资源/provenance 不完整或 worktree dirty 一律 inconclusive，绝不写预算。
 *
 * 输出目录：`--output-dir=<repo/.artifacts/...>`（verify:ticket 注入 evidence 目录），
 * 缺省 .artifacts/performance/PF-01/<run-id>/。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  assertCurrentPfDescriptorDigest,
  gitInfo,
  makeRunId,
  runStep,
  sanitizeText,
  scanEvidenceText,
  sameGitIdentity,
  writeJson,
  ARTIFACTS_ROOT,
  REPO_ROOT,
} from './lib.mjs';
import { ensureHarnessBuilt } from './build-harness.mjs';
import {
  assertPf01L3BuildEnvironment,
  assertPf01OutputDirectory,
  assertPf01L3ViteModuleClosure,
  assertPf01VerificationEnvironment,
  collectPf01L3HarnessBuildInputs,
} from './pf01-build-inputs.mjs';
import {
  collectPf01MeasurementInputs,
  readPf01L2ViteDevModuleGraph,
} from './pf01-measurement-inputs.mjs';
import {
  assertCleanPf01Baseline,
  capturePf01RuntimeProvenance,
  collectCurrentPf01Attestation,
  pf01ComparisonProvenance,
  validateCurrentPf01Attestation,
  validateFrozenPf01Budget,
} from './pf01-budget.mjs';
import { finalizeHarnessPeakRss, validatePf01ResourceEvidence } from './pf01-resource.mjs';
import { derivePf01AutomatedResult, PF01_CLEAN_CONTAMINATION } from './pf01-automated-result.mjs';

const DESCRIPTOR_PATH = path.join(REPO_ROOT, 'performance/descriptors/pf-01.catalog-browse.json');
const BUDGETS_PATH = path.join(REPO_ROOT, 'performance/budgets/pf-01.budgets.json');
const REGISTERED_PF = new Set(['PF-01']);

const LAYER_L2 = 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）';
const LAYER_L3 = 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）';

const MIN_SAMPLES = {
  'pf01.startup.first_list_visible': 5,
  'pf01.search.results_visible': 20,
  'pf01.filter.results_visible': 20,
  'pf01.select.skill_cells_visible': 20,
  'pf01.l3.cold_start.first_snapshot': 3,
};

const METRIC_LAYERS = {
  'pf01.startup.first_list_visible': LAYER_L2,
  'pf01.search.results_visible': LAYER_L2,
  'pf01.filter.results_visible': LAYER_L2,
  'pf01.select.skill_cells_visible': LAYER_L2,
  'pf01.l3.cold_start.first_snapshot': LAYER_L3,
};

/** L3 冷启动进程级样本数（每次 wdio run 一个新 harness 进程） */
const L3_COLD_START_RUNS = 3;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const value = sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
  return Math.round(value * 1000) / 1000;
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function proposeBudget(metricId, stats) {
  // absolute ceiling：p95 × 1.5 向上取整到 10ms；regression allowance：baseline p50 的 1.25 倍
  const absoluteCeilingMs = Math.ceil(((stats.p95 ?? 0) * 1.5) / 10) * 10;
  return {
    metric: metricId,
    layer: METRIC_LAYERS[metricId],
    baseline: { p50: stats.p50, p95: stats.p95, n: stats.n },
    proposedAbsoluteCeilingMs: absoluteCeilingMs,
    proposedRegressionAllowance: { relativeTo: 'baseline-p50', maxRatio: 1.25 },
    status: 'proposed-not-frozen',
    note: '本次完整 clean baseline 只收集样本；预算冻结须独立人工审核，首次运行仍为 inconclusive。',
  };
}

/**
 * 未来显式 budget freeze 必须能从 immutable run 重建完整 provenance；这里仅记录
 * 当前采样 runner/toolchain，绝不在 perf 首次 baseline 内创建预算。
 */
/**
 * 冻结预算比较（未来路径，代码就绪）：逐 metric 查 budget 条目，
 * p95 ≤ absoluteCeilingMs 且 p50 ≤ baseline.p50 × regressionAllowance.maxRatio。
 * 返回违规描述列表（空 = 全部达标）。
 */
function compareAgainstBudgets(payload, metrics) {
  const entries = new Map((payload.budgets ?? []).map((entry) => [entry.metric, entry]));
  const violations = [];
  for (const [metricId, stats] of Object.entries(metrics)) {
    const budget = entries.get(metricId);
    if (budget === undefined) {
      violations.push(`${metricId}: 预算文件缺少该 metric 条目`);
      continue;
    }
    if (
      typeof budget.absoluteCeilingMs === 'number' &&
      stats.p95 !== null &&
      stats.p95 > budget.absoluteCeilingMs
    ) {
      violations.push(`${metricId}: p95 ${stats.p95}ms 超 absoluteCeilingMs ${budget.absoluteCeilingMs}ms`);
    }
    const allowance = budget.regressionAllowance;
    if (
      allowance !== undefined &&
      typeof allowance.maxRatio === 'number' &&
      typeof budget.baseline?.p50 === 'number' &&
      stats.p50 !== null &&
      stats.p50 > budget.baseline.p50 * allowance.maxRatio
    ) {
      violations.push(
        `${metricId}: p50 ${stats.p50}ms 超 baseline p50 ${budget.baseline.p50}ms × ${allowance.maxRatio}`,
      );
    }
  }
  return violations;
}

async function main() {
  const args = process.argv.slice(2);
  const pfId = args.find((arg) => !arg.startsWith('--'));
  const profileFlag = args.find((arg) => arg.startsWith('--profile='));
  const profile = profileFlag?.split('=')[1] === 'stress' ? 'stress' : 'representative';

  if (pfId === undefined || !REGISTERED_PF.has(pfId)) {
    console.error(`未知 PF ID: ${pfId ?? '(未提供)'}；已登记: ${[...REGISTERED_PF].join(', ')}`);
    process.exit(1);
  }

  try {
    assertPf01VerificationEnvironment();
  } catch (error) {
    console.error(
      `INCONCLUSIVE  PF ambient environment 无法证明：${error instanceof Error ? error.message : 'unknown'}`,
    );
    process.exit(2);
  }

  // descriptor 自描述 digest 一致性（防手工篡改形状而未更新 digest）
  let descriptor;
  let digest;
  try {
    ({ descriptor, digest } = assertCurrentPfDescriptorDigest(DESCRIPTOR_PATH));
  } catch (error) {
    console.error(
      `FAIL  descriptor digest 无效：${error instanceof Error ? error.message : 'unknown'}`,
    );
    process.exit(1);
  }
  console.log(`PF-01 descriptor digest: ${digest}（profile: ${profile}）`);

  // authoritative baseline 与 budget freeze 只允许绑定 clean commit；此 gate
  // 位于任何 L2/L3 采样之前，避免 dirty run 留下可被误用的候选 artifact。
  const startingGit = await gitInfo();
  try {
    assertCleanPf01Baseline(startingGit);
  } catch (error) {
    console.error(`INCONCLUSIVE  ${error instanceof Error ? error.message : 'clean worktree required'}`);
    process.exit(2);
  }
  let buildEnvironment;
  let runtimeProvenance;
  try {
    buildEnvironment = assertPf01L3BuildEnvironment();
    runtimeProvenance = await capturePf01RuntimeProvenance();
  } catch (error) {
    console.error(
      `INCONCLUSIVE  L3 harness build/runner environment 无法证明：${error instanceof Error ? error.message : 'unknown'}`,
    );
    process.exit(2);
  }

  const outputDirFlag = args.filter((arg) => arg.startsWith('--output-dir='));
  if (outputDirFlag.length > 1 || (outputDirFlag[0] !== undefined && outputDirFlag[0].length === 13)) {
    console.error('INCONCLUSIVE  PF output directory 参数无效');
    process.exit(2);
  }
  let outputDir;
  try {
    outputDir = assertPf01OutputDirectory(
      outputDirFlag[0]?.slice('--output-dir='.length) ??
        path.join(ARTIFACTS_ROOT, 'performance/PF-01', makeRunId()),
    );
  } catch (error) {
    console.error(
      `INCONCLUSIVE  PF output directory 无法证明：${error instanceof Error ? error.message : 'unknown'}`,
    );
    process.exit(2);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // --- L2 采样（mock renderer surface） --------------------------------------
  const wdio = await runStep({
    cmd: 'corepack',
    args: ['npm', 'exec', '--', 'wdio', 'run', 'performance/wdio.conf.ts'],
    timeoutMs: 900_000,
    env: { PF01_PROFILE: profile, PF01_OUTPUT_DIR: outputDir },
  });
  if (wdio.exitCode !== 0) {
    console.error(`FAIL  L2 wdio 采样 exit ${wdio.exitCode}`);
    process.exit(1);
  }

  const samplesPath = path.join(outputDir, 'samples.json');
  if (!fs.existsSync(samplesPath)) {
    console.error('FAIL  samples.json 未生成');
    process.exit(1);
  }
  const samplesPayload = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));
  let l2DevModuleGraph;
  try {
    l2DevModuleGraph = readPf01L2ViteDevModuleGraph(
      path.join(outputDir, 'l2-dev-module-graph.json'),
    );
  } catch (error) {
    console.error(
      `INCONCLUSIVE  L2 actual Vite dev module graph 无法证明：${error instanceof Error ? error.message : 'unknown'}`,
    );
    process.exit(2);
  }

  // --- L3 冷启动采样（test-harness surface） ---------------------------------
  // 确保 harness 已构建（standalone `perf -- PF-01` 同样可用），再串行 3 次
  // wdio run；embedded provider 下 reloadSession 不重启应用进程，进程级
  // 冷启动样本必须跨 run 取得（每次 run 由 tauri service 新起 harness 进程）。
  console.log('\n=== 确保 L3 harness 已构建（冷启动采样前置）');
  if (!(await ensureHarnessBuilt())) {
    console.error('FAIL  harness 构建失败');
    process.exit(1);
  }
  let currentAttestation;
  try {
    await assertPf01L3ViteModuleClosure();
    const measurementInputs = collectPf01MeasurementInputs({ l2DevModuleGraph });
    currentAttestation = collectCurrentPf01Attestation({
      buildInputs: collectPf01L3HarnessBuildInputs(),
      measurementInputs,
      runtimeProvenance,
    });
    const attestation = validateCurrentPf01Attestation(currentAttestation);
    if (!attestation.valid) throw new Error(attestation.violations.join('; '));
    writeJson(path.join(outputDir, 'harness-identity.json'), {
      schemaVersion: 1,
      artifact: currentAttestation.artifact,
    });
  } catch (error) {
    console.error(
      `INCONCLUSIVE  当前 harness/FX-01 attestation 无效：${error instanceof Error ? error.message : 'unknown'}`,
    );
    process.exit(2);
  }

  const l3SamplesPath = path.join(outputDir, 'l3-samples.json');
  fs.rmSync(l3SamplesPath, { force: true });
  for (let run = 1; run <= L3_COLD_START_RUNS; run += 1) {
    console.log(`\n=== L3 冷启动采样（第 ${run}/${L3_COLD_START_RUNS} 次进程启动）`);
    const l3 = await runStep({
      cmd: 'corepack',
      args: ['npm', 'exec', '--', 'wdio', 'run', 'performance/wdio.l3.conf.ts'],
      timeoutMs: 600_000,
      env: { PF01_OUTPUT_DIR: outputDir },
    });
    if (l3.exitCode !== 0) {
      console.error(`FAIL  L3 冷启动采样（第 ${run} 次）exit ${l3.exitCode}`);
      process.exit(1);
    }
  }
  if (!fs.existsSync(l3SamplesPath)) {
    console.error('FAIL  l3-samples.json 未生成');
    process.exit(1);
  }
  const l3SamplesPayload = JSON.parse(fs.readFileSync(l3SamplesPath, 'utf8'));

  // 资源口径由用户冻结为 L3 harness PID+后代 50ms sampled peak RSS。
  // 任一 run 无 PID/样本/normal exit attestation 都必须让 PF inconclusive；
  // L2 Chrome/Vite/WDIO 与 L4 artifact 不在本 metric 的归属范围内。
  const resourceRunsPath = path.join(outputDir, 'l3-resource-runs.json');
  let resourceEvidence;
  let resourceError = null;
  try {
    if (!fs.existsSync(resourceRunsPath)) throw new Error('L3 resource runs 未生成');
    const resourceRuns = JSON.parse(fs.readFileSync(resourceRunsPath, 'utf8'));
    resourceEvidence = finalizeHarnessPeakRss(resourceRuns.runs);
    if (!validatePf01ResourceEvidence(resourceEvidence).valid) {
      throw new Error('L3 resource evidence schema invalid');
    }
  } catch (error) {
    resourceEvidence = null;
    resourceError = error instanceof Error ? error.message : 'L3 resource evidence invalid';
  }

  // --- 合并汇总（每 metric 标注 layer provenance） ----------------------------
  const mergedSamples = { ...samplesPayload.metrics };
  for (const [metricId, entry] of Object.entries(l3SamplesPayload.metrics ?? {})) {
    mergedSamples[metricId] = entry;
  }

  const metrics = {};
  let complete = true;
  let provenanceError = null;
  for (const [metricId, minSamples] of Object.entries(MIN_SAMPLES)) {
    const raw = mergedSamples[metricId]?.samples ?? [];
    const stats = summarize(raw);
    const enough = stats.n >= minSamples;
    if (!enough) complete = false;
    metrics[metricId] = {
      ...stats,
      minSamples,
      complete: enough,
      unit: 'ms',
      layer: METRIC_LAYERS[metricId],
    };
  }
  if (resourceEvidence === null) complete = false;
  const endingGit = await gitInfo();
  const gitIdentityConsistent = sameGitIdentity(startingGit, endingGit);
  if (!gitIdentityConsistent) {
    complete = false;
    provenanceError = 'PF-01 start/end Git identity mismatch';
  }

  // current budget 缺失时首次完整采样只收集样本；保持
  // budget-not-frozen/inconclusive，不能自动写入或把首次结果冒充 PASS。
  const budgetExistedBeforeRun = fs.existsSync(BUDGETS_PATH);
  let existingBudget = null;
  let budgetValidation = null;
  if (budgetExistedBeforeRun) {
    try {
      existingBudget = JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf8'));
      budgetValidation = validateFrozenPf01Budget(
        existingBudget,
        descriptor,
        profile,
        currentAttestation,
      );
    } catch (error) {
      budgetValidation = {
        valid: false,
        violations: [error instanceof Error ? error.message : '预算文件无法解析'],
      };
    }
  }
  const status = !complete
    ? 'inconclusive'
    : !budgetExistedBeforeRun
      ? 'baseline-collected / budget-not-frozen'
      : budgetValidation?.valid
        ? 'budget-comparison'
        : 'budget-invalid';
  const comparisonViolations =
    complete && budgetExistedBeforeRun && budgetValidation?.valid && existingBudget !== null
      ? compareAgainstBudgets(existingBudget, metrics)
      : [];
  const automatedResult = derivePf01AutomatedResult({
    complete,
    budgetExistedBeforeRun,
    budgetValid: budgetValidation?.valid === true,
    comparisonViolations,
  });
  const comparisonProvenance = pf01ComparisonProvenance(existingBudget, currentAttestation);
  const summary = {
    schemaVersion: 1,
    descriptorId: 'PF-01',
    descriptorDigest: digest,
    profile,
    status,
    budgetState: !budgetExistedBeforeRun
      ? 'budget-not-frozen（本次 baseline 只收集样本，未生成版本化预算）'
      : budgetValidation?.valid
        ? 'budget-frozen（performance/budgets/pf-01.budgets.json）'
        : 'budget-invalid（禁止比较或 PASS）',
    surfaces: { L2: LAYER_L2, L3: LAYER_L3 },
    metrics,
    resources:
      resourceEvidence === null
        ? { status: 'inconclusive', reason: resourceError ?? provenanceError }
        : { status: 'collected', ...resourceEvidence },
    comparisonProvenance: {
      ...comparisonProvenance,
      current: {
        ...comparisonProvenance.current,
        buildEnvironment,
        ...runtimeProvenance,
      },
    },
    runIdentity: {
      startCommit: startingGit.commit,
      startWorktreeDirty: startingGit.worktreeDirty,
      endCommit: endingGit.commit,
      endWorktreeDirty: endingGit.worktreeDirty,
      consistent: gitIdentityConsistent,
    },
    budgetValidation:
      budgetValidation === null
        ? { status: 'not-created' }
        : budgetValidation,
    automatedResult,
    contamination: PF01_CLEAN_CONTAMINATION,
    collectedAt: samplesPayload.collectedAt,
  };
  const proposedBudgets = {
    schemaVersion: 1,
    descriptorId: 'PF-01',
    profile,
    status: 'proposed-not-frozen',
    note: '以下为基于本次样本分布的建议预算（absolute ceiling = p95×1.5 上取整 10ms；regression allowance = baseline p50×1.25）。首次 clean baseline 只收集样本；须独立人工审核后才可冻结，绝不据此关闭性能验收。',
    budgets: Object.entries(metrics).map(([metricId, stats]) => proposeBudget(metricId, stats)),
    resources:
      resourceEvidence === null
        ? { status: 'inconclusive', reason: resourceError }
        : {
            status: 'collected-not-budgeted',
            ...resourceEvidence,
            note: '资源峰值仅作为 PF-01 L3 provenance；用户冻结的毫秒预算公式不适用于 bytes。',
          },
  };

  for (const [file, payload] of [
    ['summary.json', summary],
    ['proposed-budgets.json', proposedBudgets],
  ]) {
    const sanitized = sanitizeText(JSON.stringify(payload, null, 2));
    const scan = scanEvidenceText(sanitized);
    if (!scan.clean) {
      console.error(`FAIL  ${file} 扫描命中敏感占位值或个人路径`);
      process.exit(1);
    }
    writeJson(path.join(outputDir, file), JSON.parse(sanitized));
  }

  console.log(`\nPF-01 ${status}`);
  for (const [metricId, stats] of Object.entries(metrics)) {
    console.log(
      `  ${metricId}: n=${stats.n} p50=${stats.p50}ms p95=${stats.p95}ms (min ${stats.min} / max ${stats.max})`,
    );
  }
  console.log(`evidence: ${sanitizeText(outputDir)}`);

  if (automatedResult.exitCode === 2 && !complete) {
    console.error(`INCONCLUSIVE  样本、资源或 provenance 不完整（${provenanceError ?? '见 summary'}）`);
    process.exit(2);
  }

  // 预算门：首次生成预算仍为 inconclusive；后续独立运行才可比较。
  if (automatedResult.exitCode === 2 && !budgetExistedBeforeRun) {
    console.log('budget-not-frozen → inconclusive（需单独授权冻结预算后才能 PASS）');
    process.exit(2);
  }

  if (automatedResult.exitCode === 1 && (!budgetValidation?.valid || existingBudget === null)) {
    console.error(`FAIL  versioned budget invalid:\n  ${(budgetValidation?.violations ?? []).join('\n  ')}`);
    process.exit(1);
  }

  if (comparisonViolations.length > 0) {
    console.error(`FAIL  超预算:\n  ${comparisonViolations.join('\n  ')}`);
    process.exit(1);
  }
  console.log('预算达标（budget-frozen）');
  process.exit(0);
}

await main();
