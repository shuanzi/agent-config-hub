/* global setInterval, clearInterval, setTimeout */
/**
 * PF-01 的 L3-only resource sampler。
 *
 * 该模块刻意不采 L2 Chrome/Vite/WDIO，也不声称 steady RSS、私有存储或 L4
 * artifact 大小。它只在 test-harness 进程从成功启动至正常退出之间，每 50ms
 * 汇总 `agent-config-manager` PID 和后代的 RSS bytes。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PF01_PEAK_RSS_METRIC = 'pf01.l3.peak_rss_bytes';
export const PF01_L3_LAYER = 'L3 test-harness debug（隔离临时 fixture 根；非 release-like artifact）';
export const PF01_RSS_SAMPLING = Object.freeze({
  process: 'agent-config-manager harness PID and descendants only',
  intervalMs: 50,
  window: 'successful process start to normal exit',
});

function inconclusive(message) {
  return new Error(`PF-01 peak RSS inconclusive: ${message}`);
}

function validPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** 将 macOS `ps -axo pid=,ppid=,rss=` 转为可审计的 PID 表。RSS 单位为 KiB。 */
export function parsePsRssTable(stdout) {
  const rows = [];
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length === 1 && fields[0] === '') continue;
    if (fields.length !== 3 || !fields.every((field) => /^\d+$/.test(field))) {
      throw inconclusive('ps output malformed');
    }
    const [pid, parentPid, rssKiB] = fields.map(Number);
    const rssBytes = rssKiB * 1024;
    if (
      !validPositiveInteger(pid) ||
      !validNonnegativeInteger(parentPid) ||
      !validNonnegativeInteger(rssKiB) ||
      !Number.isSafeInteger(rssBytes)
    ) {
      throw inconclusive('ps output out of range');
    }
    rows.push({ pid, parentPid, rssBytes });
  }
  return rows;
}

/** 仅从已认证 harness root PID 向下闭包；WDIO/Vite 不在该树内就不会被计入。 */
export function processTreeRssBytes(rows, harnessPid) {
  if (!validPositiveInteger(harnessPid)) throw inconclusive('harness PID missing');
  const children = new Map();
  const byPid = new Map();
  for (const row of rows) {
    byPid.set(row.pid, row);
    const siblings = children.get(row.parentPid) ?? [];
    siblings.push(row.pid);
    children.set(row.parentPid, siblings);
  }
  if (!byPid.has(harnessPid)) throw inconclusive('harness PID absent from ps');
  const pending = [harnessPid];
  const visited = new Set();
  let total = 0;
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined || visited.has(pid)) continue;
    const row = byPid.get(pid);
    if (row === undefined) continue;
    visited.add(pid);
    total += row.rssBytes;
    for (const child of children.get(pid) ?? []) pending.push(child);
  }
  if (!validPositiveInteger(total)) throw inconclusive('tree RSS missing');
  return total;
}

/** 固定口径的 PF-01 resource evidence；任何不确定运行都拒绝产生 baseline。 */
export function finalizeHarnessPeakRss(runs) {
  if (!Array.isArray(runs) || runs.length !== 3) {
    throw inconclusive('exactly three L3 runs required');
  }
  const rawPeakBytes = runs.map((run) => {
    if (
      run === null ||
      typeof run !== 'object' ||
      !validPositiveInteger(run.harnessPid) ||
      run.normalExit !== true ||
      !Array.isArray(run.samples) ||
      run.samples.length === 0 ||
      !run.samples.every(validPositiveInteger)
    ) {
      throw inconclusive('PID ownership, sampling, or normal exit not established');
    }
    return Math.max(...run.samples);
  });
  return {
    metric: PF01_PEAK_RSS_METRIC,
    layer: PF01_L3_LAYER,
    sampling: { ...PF01_RSS_SAMPLING },
    rawPeakBytes,
    maxBytes: Math.max(...rawPeakBytes),
  };
}

/** PF runner/budget validator 使用的 closed resource schema。 */
export function validatePf01ResourceEvidence(value) {
  if (value === null || typeof value !== 'object') return { valid: false };
  if (
    value.metric !== PF01_PEAK_RSS_METRIC ||
    value.layer !== PF01_L3_LAYER ||
    value.sampling === null ||
    typeof value.sampling !== 'object' ||
    value.sampling.process !== PF01_RSS_SAMPLING.process ||
    value.sampling.intervalMs !== PF01_RSS_SAMPLING.intervalMs ||
    value.sampling.window !== PF01_RSS_SAMPLING.window ||
    !Array.isArray(value.rawPeakBytes) ||
    value.rawPeakBytes.length !== 3 ||
    !value.rawPeakBytes.every(validPositiveInteger) ||
    !validPositiveInteger(value.maxBytes) ||
    value.maxBytes !== Math.max(...value.rawPeakBytes)
  ) {
    return { valid: false };
  }
  return { valid: true };
}

async function readPsRows() {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,rss='], {
    encoding: 'utf8',
  });
  return parsePsRssTable(stdout);
}

function lifecycleFrom(pathname) {
  try {
    const parsed = JSON.parse(fs.readFileSync(pathname, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isNormalExitBoundary(error) {
  return (
    error instanceof Error &&
    (error.message === 'PF-01 peak RSS inconclusive: harness PID absent from ps' ||
      error.message === 'PF-01 peak RSS inconclusive: tree RSS missing')
  );
}

/**
 * 在 wdio config 的 onPrepare 启动，在 onComplete 收束。lifecycle JSON 只能由
 * harness test-feature 写入，因而 PID 归属与正常退出没有证据时自然 inconclusive。
 */
export class HarnessPeakRssSampler {
  constructor({ lifecyclePath, intervalMs = PF01_RSS_SAMPLING.intervalMs, readRows = readPsRows }) {
    this.lifecyclePath = lifecyclePath;
    this.intervalMs = intervalMs;
    this.readRows = readRows;
    this.harnessPid = null;
    this.samples = [];
    this.failure = null;
    this.timer = null;
    this.captureInFlight = null;
    this.normalExit = false;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => void this.capture(), this.intervalMs);
    void this.capture();
  }

  stopSampling() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  fail(message) {
    if (this.failure === null) {
      this.failure = message instanceof Error ? message : inconclusive(message);
    }
    return this.failure;
  }

  observeLifecycle(lifecycle, { missingIsFailure = false } = {}) {
    if (lifecycle === null) {
      if (missingIsFailure) this.fail('harness lifecycle missing during RSS capture');
      return false;
    }
    if (
      lifecycle.binary !== 'agent-config-manager' ||
      lifecycle.role !== 'test-harness' ||
      !validPositiveInteger(lifecycle.pid)
    ) {
      this.fail('harness lifecycle identity invalid');
      return false;
    }
    if (this.harnessPid !== null && this.harnessPid !== lifecycle.pid) {
      this.fail('harness PID changed');
      return false;
    }
    if (typeof lifecycle.normalExit !== 'boolean') {
      this.fail('harness normal exit state invalid');
      return false;
    }
    this.harnessPid = lifecycle.pid;
    if (lifecycle.normalExit) {
      this.normalExit = true;
      this.stopSampling();
    }
    return true;
  }

  capture() {
    if (this.captureInFlight !== null) return this.captureInFlight;
    const capture = this.captureOnce().catch((error) => {
      this.fail(error instanceof Error ? error : 'RSS capture failed');
    });
    this.captureInFlight = capture;
    void capture.then(() => {
      if (this.captureInFlight === capture) this.captureInFlight = null;
    });
    return capture;
  }

  async captureOnce() {
    if (this.failure !== null) return;
    const before = lifecycleFrom(this.lifecyclePath);
    if (before === null) return;
    if (!this.observeLifecycle(before)) return;
    if (before.normalExit) {
      // 终态一经 attested 就不再查询已退出 PID；仅保留此前成功窗口内样本。
      return;
    }

    let sample;
    let sampleError = null;
    try {
      sample = processTreeRssBytes(await this.readRows(), before.pid);
    } catch (error) {
      sampleError = error instanceof Error ? error : inconclusive('RSS capture failed');
    }

    // `ps` 是异步的：它返回前 harness 可能已经经同一 lifecycle 正常退出。只有
    // 已认证的同 PID normalExit 才能把 root 消失/零 RSS 视为窗口的自然终点；
    // 运行中、身份漂移或其他 ps 错误仍必须 fail-closed。
    const after = lifecycleFrom(this.lifecyclePath);
    if (!this.observeLifecycle(after, { missingIsFailure: true })) return;
    if (sampleError !== null) {
      if (after.normalExit && isNormalExitBoundary(sampleError)) return;
      this.fail(sampleError);
      return;
    }
    this.samples.push(sample);
  }

  async finalize({ waitForLifecycleMs = 5000 } = {}) {
    this.stopSampling();
    if (this.captureInFlight !== null) await this.captureInFlight;
    const deadline = Date.now() + waitForLifecycleMs;
    let lifecycle = lifecycleFrom(this.lifecyclePath);
    while (lifecycle?.normalExit !== true && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      lifecycle = lifecycleFrom(this.lifecyclePath);
    }
    if (lifecycle !== null) this.observeLifecycle(lifecycle);
    if (this.failure !== null) throw this.failure;
    if (lifecycle?.normalExit !== true || !this.normalExit) {
      throw this.fail('harness normal exit not established');
    }
    if (!validPositiveInteger(this.harnessPid) || this.samples.length === 0) {
      throw this.fail('sampling missing');
    }
    return {
      harnessPid: this.harnessPid,
      samples: this.samples,
      normalExit: true,
    };
  }

  diagnosticRun(error) {
    const inconclusiveReason =
      error instanceof Error ? error.message : 'PF-01 peak RSS inconclusive: resource sampler failed';
    return {
      harnessPid: this.harnessPid,
      samples: [...this.samples],
      normalExit: this.normalExit,
      failure: this.failure?.message ?? inconclusiveReason,
      inconclusive: inconclusiveReason,
    };
  }
}
