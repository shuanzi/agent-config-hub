#!/usr/bin/env node
/**
 * PF-02 scroll 双峰噪声诊断 JSON 分析器。
 *
 * 读取 PF02_DIAG_OUTPUT（或命令行第一个参数）指向的 JSON，输出 Markdown
 * 报告到 stdout。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inputPath = process.argv[2] ?? process.env.PF02_DIAG_OUTPUT;
if (inputPath === undefined || inputPath.trim() === '') {
  console.error('用法: node analyze.mjs <diagnostic.json> 或设置 PF02_DIAG_OUTPUT');
  process.exit(1);
}

const raw = readFileSync(resolve(inputPath), { encoding: 'utf8' });
const data = JSON.parse(raw);

if (data.kind !== 'fe-02-pf02-scroll-diagnostic' || data.schemaVersion !== 1) {
  throw new Error('不支持的诊断 JSON 格式');
}

const samples = data.samples ?? [];
const treatmentDurations = samples.map((s) => s.treatment.duration);
const controlDurations = samples.map((s) => s.control.controlDuration);
const stableGaps = samples.map((s) => s.treatment.tStable - s.treatment.t0);
const treatmentRaf1Gaps = samples.map((s) => s.treatment.raf1 - s.treatment.t0);
const treatmentRaf2Gaps = samples.map((s) => s.treatment.raf2 - s.treatment.raf1);

function sortedCopy(values) {
  return [...values].sort((a, b) => a - b);
}

function quantile(values, q) {
  if (values.length === 0) return NaN;
  const sorted = sortedCopy(values);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function min(values) {
  return values.length === 0 ? NaN : Math.min(...values);
}

function max(values) {
  return values.length === 0 ? NaN : Math.max(...values);
}

function mean(values) {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function proportionInRange(values, low, high) {
  if (values.length === 0) return NaN;
  return values.filter((v) => v >= low && v <= high).length / values.length;
}

function proportionGreaterThan(values, threshold) {
  if (values.length === 0) return NaN;
  return values.filter((v) => v > threshold).length / values.length;
}

function histogram(values, binSize, options = {}) {
  const { modBase = null, precision = 3 } = options;
  const bins = new Map();
  for (const value of values) {
    const key = modBase !== null ? ((value % modBase) + modBase) % modBase : value;
    const binIndex = Math.floor(key / binSize);
    bins.set(binIndex, (bins.get(binIndex) ?? 0) + 1);
  }
  const sortedBins = [...bins.entries()].sort((a, b) => a[0] - b[0]);
  return sortedBins.map(([binIndex, count]) => {
    const start = modBase !== null
      ? (binIndex * binSize) % modBase
      : binIndex * binSize;
    const label = `[${start.toFixed(precision)}, ${(start + binSize).toFixed(precision)})`;
    return { label, count, proportion: count / values.length };
  });
}

function pearson(xs, ys) {
  if (xs.length !== ys.length || xs.length === 0) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

function binByIteration(slowFlags, binCount) {
  const n = slowFlags.length;
  if (n === 0) return [];
  const size = Math.max(1, Math.ceil(n / binCount));
  const rows = [];
  for (let start = 0; start < n; start += size) {
    const end = Math.min(start + size, n);
    const slice = slowFlags.slice(start, end);
    rows.push({
      iterations: `${start}..${end - 1}`,
      count: slice.length,
      slow: slice.filter(Boolean).length,
      proportion: slice.filter(Boolean).length / slice.length,
    });
  }
  return rows;
}

function fmt(v) {
  if (Number.isNaN(v)) return 'N/A';
  return v.toFixed(3);
}

function pct(v) {
  if (Number.isNaN(v)) return 'N/A';
  return `${(v * 100).toFixed(1)}%`;
}

const SLOW_THRESHOLD = 8;

const lines = [];
lines.push('# PF-02 Scroll 双峰噪声诊断报告');
lines.push('');
lines.push(`- 样本数: ${samples.length}`);
lines.push(`- git commit: ${data.gitCommit}${data.gitDirty ? ' (dirty)' : ''}`);
lines.push(`- 开始时间: ${data.startedAt}`);
lines.push(`- 采集前 loadavg: ${data.loadavgBefore.map((v) => v.toFixed(2)).join(', ')}`);
lines.push(`- 采集后 loadavg: ${data.loadavgAfter.map((v) => v.toFixed(2)).join(', ')}`);
lines.push(`- Chrome UA: ${data.chromeUserAgent}`);
lines.push(`- hardwareConcurrency: ${data.hardwareConcurrency}`);
lines.push('');

lines.push('## 1. 帧调度标定（200 次 rAF 的相邻 gaps）');
lines.push('');
const gaps = data.frameCalibrationGaps ?? [];
lines.push(`- 样本数: ${gaps.length}`);
lines.push(`- min: ${fmt(min(gaps))} ms`);
lines.push(`- p50: ${fmt(quantile(gaps, 0.5))} ms`);
lines.push(`- p95: ${fmt(quantile(gaps, 0.95))} ms`);
lines.push(`- max: ${fmt(max(gaps))} ms`);
lines.push(`- 落在 [15,18] ms 窗口的比例: ${pct(proportionInRange(gaps, 15, 18))}`);
lines.push('');

lines.push('## 2. 处理组（treatment）vs 对照组（control）duration');
lines.push('');

function durationTable(values, label) {
  lines.push(`### ${label}`);
  lines.push('');
  lines.push('| 分位 | duration (ms) |');
  lines.push('|------|---------------|');
  lines.push(`| p10  | ${fmt(quantile(values, 0.1))} |`);
  lines.push(`| p25  | ${fmt(quantile(values, 0.25))} |`);
  lines.push(`| p50  | ${fmt(quantile(values, 0.5))} |`);
  lines.push(`| p75  | ${fmt(quantile(values, 0.75))} |`);
  lines.push(`| p90  | ${fmt(quantile(values, 0.9))} |`);
  lines.push(`| p95  | ${fmt(quantile(values, 0.95))} |`);
  lines.push(`| max  | ${fmt(max(values))} |`);
  lines.push('');
  const slowProp = proportionGreaterThan(values, SLOW_THRESHOLD);
  lines.push(`- 慢模态占比（>${SLOW_THRESHOLD} ms）: ${pct(slowProp)}`);
  lines.push('');
}

durationTable(treatmentDurations, '处理组 duration（官方 measure 语义）');
durationTable(controlDurations, '对照组 duration（纯 rAF 链）');

lines.push('### 处理组 duration mod 16.667 直方图（2ms 桶）');
lines.push('');
lines.push('| 桶 (ms) | 计数 | 占比 |');
lines.push('|---------|------|------|');
for (const bin of histogram(treatmentDurations, 2, { modBase: 16.667 })) {
  lines.push(`| ${bin.label} | ${bin.count} | ${pct(bin.proportion)} |`);
}
lines.push('');

lines.push('## 3. 处理组 tStable - t0（产品侧真实稳定耗时）');
lines.push('');
lines.push('| 分位 | tStable - t0 (ms) |');
lines.push('|------|-------------------|');
lines.push(`| p10  | ${fmt(quantile(stableGaps, 0.1))} |`);
lines.push(`| p25  | ${fmt(quantile(stableGaps, 0.25))} |`);
lines.push(`| p50  | ${fmt(quantile(stableGaps, 0.5))} |`);
lines.push(`| p75  | ${fmt(quantile(stableGaps, 0.75))} |`);
lines.push(`| p90  | ${fmt(quantile(stableGaps, 0.9))} |`);
lines.push(`| p95  | ${fmt(quantile(stableGaps, 0.95))} |`);
lines.push(`| max  | ${fmt(max(stableGaps))} |`);
lines.push('');

lines.push('## 4. 慢样本（处理组 >8ms）的 rAF 网格量化证据');
lines.push('');
const slowIndices = samples
  .map((s, i) => ({ idx: i, dur: s.treatment.duration }))
  .filter((x) => x.dur > SLOW_THRESHOLD)
  .map((x) => x.idx);
const slowRaf1Gaps = slowIndices.map((i) => treatmentRaf1Gaps[i]);
const slowRaf2Gaps = slowIndices.map((i) => treatmentRaf2Gaps[i]);
lines.push(`- 慢样本数: ${slowIndices.length}`);
lines.push(`- raf1 - t0 落在 [15,18] ms 的比例: ${pct(proportionInRange(slowRaf1Gaps, 15, 18))}`);
lines.push(`- raf2 - raf1 落在 [15,18] ms 的比例: ${pct(proportionInRange(slowRaf2Gaps, 15, 18))}`);
lines.push('');

lines.push('## 5. 双峰归因：处理组 vs 对照组慢模态占比');
lines.push('');
const treatmentSlowProp = proportionGreaterThan(treatmentDurations, SLOW_THRESHOLD);
const controlSlowProp = proportionGreaterThan(controlDurations, SLOW_THRESHOLD);
lines.push(`- 处理组慢模态占比: ${pct(treatmentSlowProp)}`);
lines.push(`- 对照组慢模态占比: ${pct(controlSlowProp)}`);
if (controlSlowProp > 0.2 && treatmentSlowProp > 0.2) {
  lines.push('- **结论倾向**: 对照组也呈现明显慢模态，噪声更可能来自测量相位/宿主调度，而非与 DOM 变更的交互。');
} else if (treatmentSlowProp > 0.2 && controlSlowProp < 0.1) {
  lines.push('- **结论倾向**: 仅处理组呈现双峰，噪声与 scroll/DOM 变更的交互相关。');
} else {
  lines.push('- **结论倾向**: 慢模态占比均较低，当前样本不足以确认双峰。');
}
lines.push('');

lines.push('## 6. 慢样本比例与迭代序号的相关性');
lines.push('');
const treatmentSlowFlags = samples.map((s) => s.treatment.duration > SLOW_THRESHOLD);
const controlSlowFlags = samples.map((s) => s.control.controlDuration > SLOW_THRESHOLD);
const iterationIndices = samples.map((s) => s.iteration);
lines.push(`- 处理组慢样本 × 迭代序号 Pearson r: ${fmt(pearson(iterationIndices, treatmentSlowFlags.map(Number)))}`);
lines.push(`- 对照组慢样本 × 迭代序号 Pearson r: ${fmt(pearson(iterationIndices, controlSlowFlags.map(Number)))}`);
lines.push('');

const binCount = Math.min(10, Math.max(1, Math.floor(samples.length / 2)));
if (binCount >= 2) {
  lines.push('### 处理组按迭代序号分箱的慢样本比例');
  lines.push('');
  lines.push('| 迭代区间 | 样本数 | 慢样本数 | 慢样本比例 |');
  lines.push('|----------|--------|----------|------------|');
  for (const row of binByIteration(treatmentSlowFlags, binCount)) {
    lines.push(`| ${row.iterations} | ${row.count} | ${row.slow} | ${pct(row.proportion)} |`);
  }
  lines.push('');
  lines.push('### 对照组按迭代序号分箱的慢样本比例');
  lines.push('');
  lines.push('| 迭代区间 | 样本数 | 慢样本数 | 慢样本比例 |');
  lines.push('|----------|--------|----------|------------|');
  for (const row of binByIteration(controlSlowFlags, binCount)) {
    lines.push(`| ${row.iterations} | ${row.count} | ${row.slow} | ${pct(row.proportion)} |`);
  }
  lines.push('');
} else {
  lines.push('样本数过少，省略分箱表。');
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('*本报告由 `.scratch/diagnostics/fe-02-pf02-scroll/analyze.mjs` 自动生成。*');

console.log(lines.join('\n'));
