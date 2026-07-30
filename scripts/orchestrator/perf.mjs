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
 * - 版本控制预算文件 performance/budgets/pf-01.budgets.json 不存在 →
 *   汇总照常写，但进程以退出码 2 结束（budget-not-frozen → inconclusive，
 *   需单独授权冻结预算后才能 PASS）；
 * - 存在 → 按预算逐 metric 比较，超预算 exit 1，达标 exit 0（未来路径）。
 * 采样本身失败（wdio 非零退出、样本数不足）一律 exit 1。
 *
 * 建议预算（absolute ceiling + regression allowance）只写入 evidence 输出
 * 目录，明确标注“未冻结，需用户单独授权”，绝不写入版本控制内文件。
 *
 * 输出目录：环境变量 PERF_OUTPUT_DIR（verify:ticket 注入 evidence 目录），
 * 缺省 .artifacts/performance/PF-01/<run-id>/。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  makeRunId,
  pfDescriptorDigest,
  runStep,
  sanitizeText,
  scanEvidenceText,
  writeJson,
  ARTIFACTS_ROOT,
  REPO_ROOT,
} from './lib.mjs';
import { ensureHarnessBuilt } from './build-harness.mjs';

const DESCRIPTOR_PATH = path.join(REPO_ROOT, 'performance/descriptors/pf-01.catalog-browse.json');
const BUDGETS_PATH = path.join(REPO_ROOT, 'performance/budgets/pf-01.budgets.json');
const REGISTERED_PF = new Set(['PF-01']);

const LAYER_L2 = 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）';
const LAYER_L3 = 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）';

const MIN_SAMPLES = {
  'pf01.startup.first_list_visible': 5,
  'pf01.search.results_visible': 20,
  'pf01.filter.results_visible': 20,
  'pf01.select.source_visible': 20,
  'pf01.l3.cold_start.first_snapshot': 3,
};

const METRIC_LAYERS = {
  'pf01.startup.first_list_visible': LAYER_L2,
  'pf01.search.results_visible': LAYER_L2,
  'pf01.filter.results_visible': LAYER_L2,
  'pf01.select.source_visible': LAYER_L2,
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
    note: '未冻结，需用户单独授权后方可进入版本控制的 performance/budgets manifest；当前仅作 evidence 留存',
  };
}

/**
 * 冻结预算比较（未来路径，代码就绪）：逐 metric 查 budget 条目，
 * p95 ≤ absoluteCeilingMs 且 p50 ≤ baseline.p50 × regressionAllowance.maxRatio。
 * 返回违规描述列表（空 = 全部达标）。
 */
function compareAgainstBudgets(budgetsPath, metrics) {
  const payload = JSON.parse(fs.readFileSync(budgetsPath, 'utf8'));
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

  // descriptor 自描述 digest 一致性（防手工篡改形状而未更新 digest）
  const digest = pfDescriptorDigest(DESCRIPTOR_PATH);
  const declared = JSON.parse(fs.readFileSync(DESCRIPTOR_PATH, 'utf8')).digest.value;
  if (digest !== declared) {
    console.error(`FAIL  descriptor digest 不一致: 实算 ${digest} != 声明 ${declared}`);
    process.exit(1);
  }
  console.log(`PF-01 descriptor digest: ${digest}（profile: ${profile}）`);

  const outputDir =
    process.env.PERF_OUTPUT_DIR ?? path.join(ARTIFACTS_ROOT, 'performance/PF-01', makeRunId());
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

  // --- L3 冷启动采样（test-harness surface） ---------------------------------
  // 确保 harness 已构建（standalone `perf -- PF-01` 同样可用），再串行 3 次
  // wdio run；embedded provider 下 reloadSession 不重启应用进程，进程级
  // 冷启动样本必须跨 run 取得（每次 run 由 tauri service 新起 harness 进程）。
  console.log('\n=== 确保 L3 harness 已构建（冷启动采样前置）');
  if (!(await ensureHarnessBuilt())) {
    console.error('FAIL  harness 构建失败');
    process.exit(1);
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

  // --- 合并汇总（每 metric 标注 layer provenance） ----------------------------
  const mergedSamples = { ...samplesPayload.metrics };
  for (const [metricId, entry] of Object.entries(l3SamplesPayload.metrics ?? {})) {
    mergedSamples[metricId] = entry;
  }

  const metrics = {};
  let complete = true;
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

  const budgetsFrozen = fs.existsSync(BUDGETS_PATH);
  const status = !complete
    ? 'inconclusive'
    : budgetsFrozen
      ? 'budget-comparison'
      : 'baseline-collected / budget-not-frozen';
  const summary = {
    schemaVersion: 1,
    descriptorId: 'PF-01',
    descriptorDigest: digest,
    profile,
    status,
    budgetState: budgetsFrozen
      ? 'budget-frozen（performance/budgets/pf-01.budgets.json）'
      : 'budget-not-frozen（FE-01 不冻结数值预算）',
    surfaces: { L2: LAYER_L2, L3: LAYER_L3 },
    metrics,
    collectedAt: samplesPayload.collectedAt,
  };
  const proposedBudgets = {
    schemaVersion: 1,
    descriptorId: 'PF-01',
    profile,
    status: 'proposed-not-frozen',
    note: '以下为基于本次样本分布的建议预算（absolute ceiling = p95×1.5 上取整 10ms；regression allowance = baseline p50×1.25）。未冻结，需用户单独授权；不得据此关闭任何性能验收。',
    budgets: Object.entries(metrics).map(([metricId, stats]) => proposeBudget(metricId, stats)),
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

  if (!complete) {
    console.error('FAIL  样本数不足（见各 metric 的 complete 标记）');
    process.exit(1);
  }

  // 预算门：未冻结 → inconclusive（退出码 2），不得宣称通过
  if (!budgetsFrozen) {
    console.log('budget-not-frozen → inconclusive（需单独授权冻结预算后才能 PASS）');
    process.exit(2);
  }

  const violations = compareAgainstBudgets(BUDGETS_PATH, metrics);
  if (violations.length > 0) {
    console.error(`FAIL  超预算:\n  ${violations.join('\n  ')}`);
    process.exit(1);
  }
  console.log('预算达标（budget-frozen）');
  process.exit(0);
}

await main();
