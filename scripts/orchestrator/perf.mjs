/* global process, console */
/**
 * perf（PF-01 baseline 采集）。
 *
 * 用法：node scripts/orchestrator/perf.mjs PF-01 [--profile representative|stress]
 *
 * 流程：校验 descriptor 自描述 digest → wdio headless Chrome 采样
 * （performance/wdio.conf.ts）→ 读 samples.json 汇总 p50/p95 → 写
 * summary.json 与 proposed-budgets.json 到输出目录。
 *
 * 预算状态：当前没有已冻结预算文件 → `baseline-collected / budget-not-frozen`；
 * 建议预算（absolute ceiling + regression allowance）只写入 evidence 输出目录，
 * 明确标注“未冻结，需用户单独授权”，绝不写入版本控制内文件。
 * baseline-only 模式下样本完整即 pass。
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

const DESCRIPTOR_PATH = path.join(REPO_ROOT, 'performance/descriptors/pf-01.catalog-browse.json');
const REGISTERED_PF = new Set(['PF-01']);

const MIN_SAMPLES = {
  'pf01.startup.first_list_visible': 5,
  'pf01.search.results_visible': 20,
  'pf01.filter.results_visible': 20,
  'pf01.select.source_visible': 20,
};

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
    baseline: { p50: stats.p50, p95: stats.p95, n: stats.n },
    proposedAbsoluteCeilingMs: absoluteCeilingMs,
    proposedRegressionAllowance: { relativeTo: 'baseline-p50', maxRatio: 1.25 },
    status: 'proposed-not-frozen',
    note: '未冻结，需用户单独授权后方可进入版本控制的 performance/budgets manifest；当前仅作 evidence 留存',
  };
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

  const wdio = await runStep({
    cmd: 'corepack',
    args: ['npm', 'exec', '--', 'wdio', 'run', 'performance/wdio.conf.ts'],
    timeoutMs: 900_000,
    env: { PF01_PROFILE: profile, PF01_OUTPUT_DIR: outputDir },
  });
  if (wdio.exitCode !== 0) {
    console.error(`FAIL  wdio 采样 exit ${wdio.exitCode}`);
    process.exit(1);
  }

  const samplesPath = path.join(outputDir, 'samples.json');
  if (!fs.existsSync(samplesPath)) {
    console.error('FAIL  samples.json 未生成');
    process.exit(1);
  }
  const samplesPayload = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));

  const metrics = {};
  let complete = true;
  for (const [metricId, minSamples] of Object.entries(MIN_SAMPLES)) {
    const raw = samplesPayload.metrics?.[metricId]?.samples ?? [];
    const stats = summarize(raw);
    const enough = stats.n >= minSamples;
    if (!enough) complete = false;
    metrics[metricId] = { ...stats, minSamples, complete: enough, unit: 'ms' };
  }

  const status = complete ? 'baseline-collected / budget-not-frozen' : 'inconclusive';
  const summary = {
    schemaVersion: 1,
    descriptorId: 'PF-01',
    descriptorDigest: digest,
    profile,
    status,
    budgetState: 'budget-not-frozen（FE-01 不冻结数值预算）',
    surface: 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
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
  process.exit(complete ? 0 : 1);
}

await main();
