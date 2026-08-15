/**
 * PF-02 scroll 双峰噪声诊断 harness。
 *
 * 非 closure 受控采样：每个迭代内先做一次完整 restorePreState 与仪表化 scroll
 * 探针（处理组），再在相同页面状态下直接链式两次 rAF（对照组）。所有数据在
 * after hook 中写入 PF02_DIAG_OUTPUT 指定的 JSON 文件。
 */
import { after, before, describe, it } from 'mocha';
import { $, browser } from '@wdio/globals';
import type {} from 'webdriverio';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as os from 'node:os';

const ENTRY = '/tests/l2/workbench.html?scenario=perf-read-surface&pfId=PF-02&perfProfile=stress';
const OUTPUT_FILE = process.env.PF02_DIAG_OUTPUT;
const ITERATIONS = Number.parseInt(process.env.PF02_DIAG_ITERATIONS ?? '120', 10);

if (OUTPUT_FILE === undefined || OUTPUT_FILE.trim() === '') {
  throw new Error('PF02_DIAG_OUTPUT 未指定，拒绝生成不受控诊断输出');
}
if (!Number.isSafeInteger(ITERATIONS) || ITERATIONS <= 0) {
  throw new Error('PF02_DIAG_ITERATIONS 必须是正整数');
}

interface FixtureFileMetadata {
  fileId: string;
  relativePath: string;
  fileKind: 'text' | 'nonText' | 'unknown';
  isPrimary: boolean;
}

interface FixtureMetadata {
  descriptorId: 'PF-02' | 'PF-03';
  profile: 'representative' | 'stress';
  fixtureDigest: string;
  shape: Record<string, number | string>;
  files: FixtureFileMetadata[];
}

interface PfReadPage {
  __pfRead?: { getMetadata: () => FixtureMetadata | null };
}

interface TreatmentResult {
  t0: number;
  tStable: number;
  stableVia: 'sync' | 'observer';
  raf1: number;
  raf2: number;
  duration: number;
  raf2MinusT0: number;
  scrollHeight: number;
  clientHeight: number;
  targetScrollTop: number;
  error?: string;
}

interface ControlResult {
  t0: number;
  raf1: number;
  raf2: number;
  controlDuration: number;
  error?: string;
}

interface SampleRecord {
  iteration: number;
  treatment: TreatmentResult;
  control: ControlResult;
}

interface DiagnosticOutput {
  schemaVersion: 1;
  kind: 'fe-02-pf02-scroll-diagnostic';
  gitCommit: string;
  gitDirty: boolean;
  startedAt: string;
  loadavgBefore: number[];
  loadavgAfter: number[];
  chromeUserAgent: string;
  hardwareConcurrency: number;
  frameCalibrationGaps: number[];
  samples: SampleRecord[];
}

const samples: SampleRecord[] = [];
let frameCalibrationGaps: number[] = [];
let chromeUserAgent = '';
let hardwareConcurrency = 0;

async function fixtureMetadata(): Promise<FixtureMetadata> {
  const metadata = await browser.execute(
    () => (window as unknown as PfReadPage).__pfRead?.getMetadata() ?? null,
  );
  if (metadata === null) throw new Error('PF read safe fixture metadata 缺失');
  return metadata;
}

function primaryText(metadata: FixtureMetadata): FixtureFileMetadata {
  const file = metadata.files.find(
    (candidate) => candidate.isPrimary && candidate.fileKind === 'text',
  );
  if (file === undefined) throw new Error('primary text metadata 缺失');
  return file;
}

function pf02PrimaryTextBytes(metadata: FixtureMetadata): number {
  const bytes = metadata.shape.textBytes;
  if (
    metadata.descriptorId !== 'PF-02' ||
    typeof bytes !== 'number' ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0
  ) {
    throw new Error('PF-02 primary text byte shape 无效');
  }
  return bytes;
}

async function clickTreeFile(relativePath: string): Promise<void> {
  const clicked = await browser.execute((targetRelativePath) => {
    const item = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-testid="native-file-tree-item"]'),
    ].find((candidate) => candidate.textContent?.includes(targetRelativePath) === true);
    if (item === undefined) return false;
    item.click();
    return true;
  }, relativePath);
  if (!clicked) throw new Error('目标原生文件树项缺失');
}

async function restorePreState(): Promise<{
  metadata: FixtureMetadata;
  primary: FixtureFileMetadata;
}> {
  await browser.url(ENTRY);
  await $('.workbench').waitForDisplayed();
  const metadata = await fixtureMetadata();
  const firstRow = await $('[role="option"]');
  await firstRow.waitForDisplayed();
  await firstRow.click();
  await $('[data-testid="native-file-tree"]').waitForDisplayed();

  const primary = primaryText(metadata);
  await clickTreeFile(primary.relativePath);
  await $('[data-testid="native-file-text"]').waitForDisplayed();

  await browser.execute(() => {
    const panel = document.querySelector<HTMLElement>('.detail-panel');
    if (panel === null) throw new Error('缺少 .detail-panel');
    panel.scrollTop = 0;
    if (panel.scrollTop !== 0) throw new Error('detail-panel 未能恢复到 scrollTop=0');
  });

  return { metadata, primary };
}

async function runFrameCalibration(): Promise<number[]> {
  return browser.executeAsync((done) => {
    const gaps: number[] = [];
    let last = performance.now();
    let count = 0;
    const tick = () => {
      const now = performance.now();
      if (count > 0) gaps.push(now - last);
      last = now;
      count += 1;
      if (count < 200) {
        requestAnimationFrame(tick);
      } else {
        done(gaps);
      }
    };
    requestAnimationFrame(tick);
  });
}

async function runInstrumentedScrollProbe(
  primaryRelativePath: string,
  primaryTextBytes: number,
): Promise<TreatmentResult> {
  return browser.executeAsync(
    (expectedRelativePath, expectedTextBytes, done) => {
      const page = window as unknown as PfReadPage;
      const root = document.querySelector('.workbench-main');
      const panel = document.querySelector<HTMLElement>('.detail-panel');
      if (root === null || panel === null) {
        done({ error: '缺少 .workbench-main 或 .detail-panel' } as TreatmentResult);
        return;
      }
      const targetScrollTop = panel.scrollHeight - panel.clientHeight;
      if (targetScrollTop <= 0) {
        done({ error: 'detail-panel 没有可测量的垂直滚动范围' } as TreatmentResult);
        return;
      }

      const mark = `pf02-diag-${Math.round(performance.now() * 1000)}`;
      const startMark = `${mark}:start`;
      const endMark = `${mark}:end`;

      const isVisible = (element: Element | null) => {
        if (!(element instanceof HTMLElement) || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const result: TreatmentResult = {
        t0: 0,
        tStable: 0,
        stableVia: 'sync',
        raf1: 0,
        raf2: 0,
        duration: 0,
        raf2MinusT0: 0,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        targetScrollTop,
      };

      const matches = () => {
        const source = root.querySelector('[data-testid="native-file-text"]');
        const sourceText = source?.querySelector('pre')?.textContent;
        return (
          isVisible(source) &&
          source?.querySelector('h3')?.textContent === expectedRelativePath &&
          typeof sourceText === 'string' &&
          new TextEncoder().encode(sourceText).length === (expectedTextBytes ?? -1) &&
          panel.scrollTop === targetScrollTop
        );
      };

      let completed = false;
      let synchronousAttempt = true;

      const finish = (value: TreatmentResult) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        observer.disconnect();
        done(value);
      };

      const timeoutId = window.setTimeout(() => {
        finish({ error: 'PF-02 scroll 诊断探针 15s 内未稳定' } as TreatmentResult);
      }, 15000);

      let completeWhenStable = () => {};
      const observer = new MutationObserver(() => completeWhenStable());
      observer.observe(root, { childList: true, subtree: true, characterData: true });

      const t0 = performance.now();
      result.t0 = t0;
      performance.mark(startMark);

      completeWhenStable = () => {
        if (completed || !matches()) {
          synchronousAttempt = false;
          return;
        }
        if (result.tStable === 0) {
          result.tStable = performance.now();
          result.stableVia = synchronousAttempt ? 'sync' : 'observer';
        }
        synchronousAttempt = false;
        requestAnimationFrame(() => {
          result.raf1 = performance.now();
          requestAnimationFrame(() => {
            if (completed || !matches()) return;
            const raf2 = performance.now();
            performance.mark(endMark);
            performance.measure(mark, startMark, endMark);
            const measurement = performance.getEntriesByName(mark).at(-1);
            result.duration = measurement?.duration ?? raf2 - t0;
            result.raf2 = raf2;
            result.raf2MinusT0 = raf2 - t0;
            finish(result);
          });
        });
      };

      panel.scrollTop = targetScrollTop;
      completeWhenStable();
    },
    primaryRelativePath,
    primaryTextBytes,
  );
}

async function runControlProbe(): Promise<ControlResult> {
  return browser.executeAsync((done) => {
    let completed = false;
    const finish = (value: ControlResult) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      done(value);
    };
    const timeoutId = window.setTimeout(() => {
      finish({ error: 'PF-02 scroll 控制探针 15s 内未稳定' } as ControlResult);
    }, 15000);

    const t0 = performance.now();
    requestAnimationFrame(() => {
      const raf1 = performance.now();
      requestAnimationFrame(() => {
        const raf2 = performance.now();
        finish({
          t0,
          raf1,
          raf2,
          controlDuration: raf2 - t0,
        });
      });
    });
  });
}

describe('PF-02 scroll bimodal noise diagnostic', () => {
  before(async () => {
    await browser.url(ENTRY);
    await $('.workbench').waitForDisplayed();
    frameCalibrationGaps = await runFrameCalibration();
    chromeUserAgent = await browser.execute(() => navigator.userAgent);
    hardwareConcurrency = await browser.execute(() => navigator.hardwareConcurrency);
  });

  it(`collects ${ITERATIONS} paired treatment/control samples`, async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const { metadata, primary } = await restorePreState();
      const treatment = await runInstrumentedScrollProbe(
        primary.relativePath,
        pf02PrimaryTextBytes(metadata),
      );
      if (treatment.error !== undefined) throw new Error(treatment.error);

      const control = await runControlProbe();
      if (control.error !== undefined) throw new Error(control.error);

      samples.push({ iteration, treatment, control });
    }
  });

  after(() => {
    const output: DiagnosticOutput = {
      schemaVersion: 1,
      kind: 'fe-02-pf02-scroll-diagnostic',
      gitCommit: execSync('git rev-parse HEAD').toString().trim(),
      gitDirty: execSync('git status --porcelain').toString().trim() !== '',
      startedAt: new Date().toISOString(),
      loadavgBefore: os.loadavg(),
      loadavgAfter: os.loadavg(),
      chromeUserAgent,
      hardwareConcurrency,
      frameCalibrationGaps,
      samples,
    };
    writeFileSync(OUTPUT_FILE as string, `${JSON.stringify(output, null, 2)}\n`, {
      encoding: 'utf8',
    });
  });
});
