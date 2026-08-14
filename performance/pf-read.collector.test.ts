/**
 * PF-02/PF-03 L2 read-surface 采样。
 *
 * 计时只发生在页面内：每个 intent 由 User Timing mark/measure 记录，DOM
 * MutationObserver 与连续两次 rAF 确认目标稳定；WDIO 仅负责发起 intent 与读取
 * 已完成的页内结果。samples.json 不写展示路径、文件内容或运行环境信息。
 */
import { after, describe, it } from 'mocha';
import { $, browser } from '@wdio/globals';
import type {} from 'webdriverio';
import { lstatSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DESCRIPTOR_ID = process.env.PF_READ_DESCRIPTOR_ID;
if (DESCRIPTOR_ID !== 'PF-02' && DESCRIPTOR_ID !== 'PF-03') {
  throw new Error('PF_READ_DESCRIPTOR_ID 必须为 PF-02 或 PF-03');
}
const PROFILE = process.env.PF_READ_PROFILE === 'stress' ? 'stress' : 'representative';
const OUTPUT_DIR = process.env.PF_READ_OUTPUT_DIR;
const SAMPLES_PER_METRIC = PROFILE === 'stress' ? 10 : 20;
const ENTRY = `/tests/l2/workbench.html?scenario=perf-read-surface&pfId=${DESCRIPTOR_ID}&perfProfile=${PROFILE}`;

const PF02_METRICS = {
  open: 'pf02.source.open.content_visible',
  scroll: 'pf02.source.scroll.render_stable',
  switch: 'pf02.source.readonly_switch.content_visible',
} as const;
const PF03_METRICS = {
  tree: 'pf03.multifile.tree.visible',
  text: 'pf03.multifile.text_switch.content_visible',
  nonText: 'pf03.multifile.nontext_switch.metadata_visible',
} as const;
const METRICS = DESCRIPTOR_ID === 'PF-02' ? PF02_METRICS : PF03_METRICS;

const samples: Record<string, number[]> = Object.fromEntries(
  Object.values(METRICS).map((metric) => [metric, []]),
);
let attestedFixtureMetadata: FixtureMetadata | null = null;

interface ProbeState {
  metric: string;
  result: number | null;
}

interface PfReadPage {
  __pfReadProbe?: ProbeState;
  __pfRead?: { getMetadata: () => FixtureMetadata | null };
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

/**
 * 安装通用 page-internal DOM probe。Observer 绑定到不卸载的工作台主区域；
 * 条件为真后连续两次 rAF 重新检查，并用 User Timing measure 得到唯一结果。
 */
async function dispatchVisibilityIntent(
  metric: string,
  surface: 'text' | 'nonText' | 'treeAndDetail',
  targetRelativePath?: string,
  targetTextBytes?: number,
): Promise<void> {
  await browser.execute(
    (metricId, expectedSurface, expectedRelativePath, expectedTextBytes) => {
      const page = window as unknown as PfReadPage;
      const root = document.querySelector('.workbench-main');
      if (root === null) throw new Error('缺少 .workbench-main');
      const mark = `pf-read-${metricId}-${Math.round(performance.now() * 1000)}`;
      const isVisible = (element: Element | null) => {
        if (!(element instanceof HTMLElement) || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const expectedFileIsShown = (selector: string) => {
        const surfaceNode = root.querySelector(selector);
        const sourceText = surfaceNode?.querySelector('pre')?.textContent;
        return (
          isVisible(surfaceNode) &&
          surfaceNode?.querySelector('h3')?.textContent === expectedRelativePath &&
          (expectedTextBytes == null ||
            (typeof sourceText === 'string' &&
              new TextEncoder().encode(sourceText).length === expectedTextBytes))
        );
      };
      if (
        expectedSurface === 'treeAndDetail' &&
        (root.querySelector('[data-testid="native-file-tree"]') !== null ||
          root.querySelector('[data-testid="skill-readonly-detail"]') !== null)
      ) {
        throw new Error('tree metric 必须从未选择详情、未出现文件树的前态开始');
      }
      if (
        (expectedSurface === 'text' || expectedSurface === 'nonText') &&
        expectedRelativePath !== undefined &&
        expectedFileIsShown(
          expectedSurface === 'text'
            ? '[data-testid="native-file-text"]'
            : '[data-testid="native-file-nontext"]',
        )
      ) {
        throw new Error('目标文件已处于展示状态，拒绝采集重复选择样本');
      }
      const matches = () => {
        if (expectedSurface === 'text') {
          return expectedFileIsShown('[data-testid="native-file-text"]');
        }
        if (expectedSurface === 'nonText') {
          return expectedFileIsShown('[data-testid="native-file-nontext"]');
        }
        return (
          isVisible(root.querySelector('[data-testid="native-file-tree"]')) &&
          isVisible(root.querySelector('[data-testid="skill-readonly-detail"]')) &&
          isVisible(root.querySelector('.detail-panel'))
        );
      };
      page.__pfReadProbe = { metric: metricId, result: null };
      const probe = page.__pfReadProbe;
      const completeWhenStable = () => {
        if (probe.result !== null || !matches()) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (probe.result !== null || !matches()) return;
            performance.mark(`${mark}:end`);
            performance.measure(mark, `${mark}:start`, `${mark}:end`);
            const measurement = performance.getEntriesByName(mark).at(-1);
            probe.result = measurement?.duration ?? null;
            observer.disconnect();
          });
        });
      };
      const observer = new MutationObserver(completeWhenStable);
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      performance.mark(`${mark}:start`);
      if (expectedSurface === 'treeAndDetail') {
        const row = root.querySelector<HTMLButtonElement>('[role="option"]');
        if (row === null) throw new Error('tree metric 缺少未选择的 workbench row');
        row.click();
        completeWhenStable();
        return;
      }
      const item = [
        ...root.querySelectorAll<HTMLButtonElement>('[data-testid="native-file-tree-item"]'),
      ].find((candidate) => candidate.textContent?.includes(expectedRelativePath ?? '') === true);
      if (item === undefined) throw new Error('目标原生文件树项缺失');
      item.click();
      completeWhenStable();
    },
    metric,
    surface,
    targetRelativePath,
    targetTextBytes,
  );
}

/** PF-02 scroll 专用条件：详情滚动容器到达目标且原生文本仍真实可见。 */
async function armScrollProbe(
  metric: string,
  primaryRelativePath: string,
  primaryTextBytes: number,
): Promise<void> {
  await browser.execute(
    (metricId, expectedRelativePath, expectedTextBytes) => {
      const page = window as unknown as PfReadPage;
      const root = document.querySelector('.workbench-main');
      const panel = document.querySelector<HTMLElement>('.detail-panel');
      if (root === null || panel === null) throw new Error('缺少 .detail-panel');
      const targetScrollTop = panel.scrollHeight - panel.clientHeight;
      if (targetScrollTop <= 0) throw new Error('detail-panel 没有可测量的垂直滚动范围');
      const mark = `pf-read-${metricId}-${Math.round(performance.now() * 1000)}`;
      const isVisible = (element: Element | null) => {
        if (!(element instanceof HTMLElement) || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      page.__pfReadProbe = { metric: metricId, result: null };
      const probe = page.__pfReadProbe;
      let completeWhenStable = () => {};
      const observer = new MutationObserver(() => completeWhenStable());
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      performance.mark(`${mark}:start`);
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
      completeWhenStable = () => {
        if (probe.result !== null || !matches()) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (probe.result !== null || !matches()) return;
            performance.mark(`${mark}:end`);
            performance.measure(mark, `${mark}:start`, `${mark}:end`);
            const measurement = performance.getEntriesByName(mark).at(-1);
            probe.result = measurement?.duration ?? null;
            observer.disconnect();
          });
        });
      };
      panel.scrollTop = targetScrollTop;
      completeWhenStable();
    },
    metric,
    primaryRelativePath,
    primaryTextBytes,
  );
}

async function awaitProbeMs(): Promise<number> {
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => (window as unknown as PfReadPage).__pfReadProbe?.result)) !=
      null,
    { timeout: 15000, interval: 25, timeoutMsg: 'PF read 页面内性能探针 15s 内未稳定' },
  );
  const result = await browser.execute(
    () => (window as unknown as PfReadPage).__pfReadProbe?.result,
  );
  if (result == null || !Number.isFinite(result)) throw new Error('PF read 页面内性能结果缺失');
  return result;
}

async function fixtureMetadata(): Promise<FixtureMetadata> {
  const metadata = await browser.execute(
    () => (window as unknown as PfReadPage).__pfRead?.getMetadata() ?? null,
  );
  if (metadata === null) throw new Error('PF read safe fixture metadata 缺失');
  if (metadata.descriptorId !== DESCRIPTOR_ID || metadata.profile !== PROFILE) {
    throw new Error('PF read fixture metadata 与环境 profile 不一致');
  }
  if (attestedFixtureMetadata === null) {
    attestedFixtureMetadata = metadata;
  } else if (
    attestedFixtureMetadata.descriptorId !== metadata.descriptorId ||
    attestedFixtureMetadata.profile !== metadata.profile ||
    attestedFixtureMetadata.fixtureDigest !== metadata.fixtureDigest
  ) {
    throw new Error('PF read fixture metadata 跨 sample 不一致');
  }
  return metadata;
}

async function openReadonlyDetail(): Promise<FixtureMetadata> {
  await browser.url(ENTRY);
  await $('.workbench').waitForDisplayed();
  const metadata = await fixtureMetadata();
  const firstRow = await $('[role="option"]');
  await firstRow.waitForDisplayed();
  await firstRow.click();
  await $('[data-testid="native-file-tree"]').waitForDisplayed();
  return metadata;
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

function primaryText(metadata: FixtureMetadata): FixtureFileMetadata {
  const file = metadata.files.find(
    (candidate) => candidate.isPrimary && candidate.fileKind === 'text',
  );
  if (file === undefined) throw new Error('primary text metadata 缺失');
  return file;
}

function secondaryText(metadata: FixtureMetadata): FixtureFileMetadata {
  const file = metadata.files.find(
    (candidate) => !candidate.isPrimary && candidate.fileKind === 'text',
  );
  if (file === undefined) throw new Error('secondary text metadata 缺失');
  return file;
}

function activePf03Text(metadata: FixtureMetadata): FixtureFileMetadata {
  const activePath = metadata.shape.activePath;
  if (metadata.descriptorId !== 'PF-03' || typeof activePath !== 'string' || activePath === '') {
    throw new Error('PF-03 activePath shape 无效');
  }
  const file = metadata.files.find(
    (candidate) =>
      !candidate.isPrimary &&
      candidate.fileKind === 'text' &&
      candidate.relativePath === activePath,
  );
  if (file === undefined) throw new Error('PF-03 activePath text metadata 缺失');
  return file;
}

function nonTextFile(metadata: FixtureMetadata): FixtureFileMetadata {
  const file = metadata.files.find((candidate) => candidate.fileKind === 'nonText');
  if (file === undefined) throw new Error('nontext metadata 缺失');
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

async function openPrimaryTextForSetup(): Promise<{
  metadata: FixtureMetadata;
  primary: FixtureFileMetadata;
}> {
  const metadata = await openReadonlyDetail();
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

async function openSecondaryTextForSetup(): Promise<{
  metadata: FixtureMetadata;
  secondary: FixtureFileMetadata;
}> {
  const metadata = await openReadonlyDetail();
  const secondary = secondaryText(metadata);
  await clickTreeFile(secondary.relativePath);
  await $('[data-testid="native-file-text"]').waitForDisplayed();
  return { metadata, secondary };
}

/** 每个样本先在计时外回到明确前态，拒绝复用已经选中的目标表面。 */
async function restorePreState(
  state: 'workbench' | 'structuredDetail' | 'primaryText' | 'secondaryText',
): Promise<{
  metadata: FixtureMetadata;
  primary?: FixtureFileMetadata;
  secondary?: FixtureFileMetadata;
}> {
  if (state === 'workbench') {
    await browser.url(ENTRY);
    await $('.workbench').waitForDisplayed();
    await $('[role="option"]').waitForDisplayed();
    const preStateClean = await browser.execute(() => {
      const root = document.querySelector('.workbench-main');
      return (
        root !== null &&
        root.querySelector('[data-testid="native-file-tree"]') === null &&
        root.querySelector('[data-testid="skill-readonly-detail"]') === null
      );
    });
    if (!preStateClean) throw new Error('tree metric workbench 前态已含详情或文件树');
    return { metadata: await fixtureMetadata() };
  }
  if (state === 'structuredDetail') return { metadata: await openReadonlyDetail() };
  if (state === 'primaryText') {
    const { metadata, primary } = await openPrimaryTextForSetup();
    return { metadata, primary };
  }
  const { metadata, secondary } = await openSecondaryTextForSetup();
  return { metadata, secondary };
}

describe(`${DESCRIPTOR_ID} read-surface page-internal sampling`, () => {
  if (DESCRIPTOR_ID === 'PF-02') {
    it(`open → native text visible (${SAMPLES_PER_METRIC} samples)`, async () => {
      for (let index = 0; index < SAMPLES_PER_METRIC; index += 1) {
        const { metadata } = await restorePreState('structuredDetail');
        const primary = primaryText(metadata);
        await dispatchVisibilityIntent(
          PF02_METRICS.open,
          'text',
          primary.relativePath,
          pf02PrimaryTextBytes(metadata),
        );
        samples[PF02_METRICS.open].push(await awaitProbeMs());
      }
    });

    it(`scroll → detail-panel stable (${SAMPLES_PER_METRIC} samples)`, async () => {
      for (let index = 0; index < SAMPLES_PER_METRIC; index += 1) {
        const { metadata, primary } = await restorePreState('primaryText');
        if (primary === undefined) throw new Error('PF-02 primary text 前态缺失');
        await armScrollProbe(
          PF02_METRICS.scroll,
          primary.relativePath,
          pf02PrimaryTextBytes(metadata),
        );
        samples[PF02_METRICS.scroll].push(await awaitProbeMs());
      }
    });

    it(`readonly switch → large source visible (${SAMPLES_PER_METRIC} samples)`, async () => {
      for (let index = 0; index < SAMPLES_PER_METRIC; index += 1) {
        const { metadata } = await restorePreState('secondaryText');
        const target = primaryText(metadata);
        await dispatchVisibilityIntent(
          PF02_METRICS.switch,
          'text',
          target.relativePath,
          pf02PrimaryTextBytes(metadata),
        );
        samples[PF02_METRICS.switch].push(await awaitProbeMs());
      }
    });
  } else {
    it(`tree → tree and detail pane visible (${SAMPLES_PER_METRIC} samples)`, async () => {
      for (let index = 0; index < SAMPLES_PER_METRIC; index += 1) {
        await restorePreState('workbench');
        await dispatchVisibilityIntent(PF03_METRICS.tree, 'treeAndDetail');
        samples[PF03_METRICS.tree].push(await awaitProbeMs());
      }
    });

    it(`text switch → native text visible (${SAMPLES_PER_METRIC} samples)`, async () => {
      for (let index = 0; index < SAMPLES_PER_METRIC; index += 1) {
        const { metadata } = await restorePreState('primaryText');
        const target = activePf03Text(metadata);
        await dispatchVisibilityIntent(PF03_METRICS.text, 'text', target.relativePath);
        samples[PF03_METRICS.text].push(await awaitProbeMs());
      }
    });

    it(`nontext switch → metadata visible (${SAMPLES_PER_METRIC} samples)`, async () => {
      for (let index = 0; index < SAMPLES_PER_METRIC; index += 1) {
        const { metadata } = await restorePreState('primaryText');
        const target = nonTextFile(metadata);
        await dispatchVisibilityIntent(PF03_METRICS.nonText, 'nonText', target.relativePath);
        samples[PF03_METRICS.nonText].push(await awaitProbeMs());
      }
    });
  }

  after(() => {
    if (OUTPUT_DIR === undefined) {
      throw new Error('PF_READ_OUTPUT_DIR 未指定，拒绝生成不受控 samples.json');
    }
    const outputStat = lstatSync(OUTPUT_DIR);
    if (
      !outputStat.isDirectory() ||
      outputStat.isSymbolicLink() ||
      readdirSync(OUTPUT_DIR).length !== 0
    ) {
      throw new Error('PF_READ_OUTPUT_DIR 必须是 runner 预建的空物理目录');
    }
    if (attestedFixtureMetadata === null) {
      throw new Error('PF read fixture attestation metadata 缺失');
    }
    writeFileSync(
      join(OUTPUT_DIR, 'samples.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          descriptorId: DESCRIPTOR_ID,
          profile: PROFILE,
          unit: 'ms',
          metrics: Object.fromEntries(
            Object.entries(samples).map(([id, values]) => [
              id,
              { samples: values.map((value) => Math.round(value * 1000) / 1000) },
            ]),
          ),
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    writeFileSync(
      join(OUTPUT_DIR, 'fixture-attestation.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          descriptorId: attestedFixtureMetadata.descriptorId,
          profile: attestedFixtureMetadata.profile,
          fixtureDigest: attestedFixtureMetadata.fixtureDigest,
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  });
});
