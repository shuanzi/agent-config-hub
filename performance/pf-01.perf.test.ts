/**
 * PF-01 catalog-browse 性能采样（L2 mock renderer surface）。
 *
 * 测量协议见 performance/descriptors/pf-01.catalog-browse.json：
 * - 指标名稳定，不含资产名、路径或搜索词；样本只记录毫秒数值；
 * - startup 每次 fresh load；交互类用页内 MutationObserver + rAF 稳定确认，
 *   排除 WebDriver 往返抖动（filter/select 起点为 probe arm，含一次恒定的
 *   本地往返开销，baseline 方法学内一致）；
 * - 样本写入 PF01_OUTPUT_DIR/samples.json；p50/p95 与预算建议由
 *   scripts/orchestrator/perf.mjs 汇总。
 */
import { after, describe, it } from 'mocha';
import { $, $$, browser } from '@wdio/globals';
// 拉入 webdriverio 的全局 WebdriverIO namespace 类型
import type {} from 'webdriverio';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROFILE = process.env.PF01_PROFILE === 'stress' ? 'stress' : 'representative';
const OUTPUT_DIR = process.env.PF01_OUTPUT_DIR;
const ENTRY = `/tests/l2/workbench.html?scenario=perf-catalog${PROFILE === 'stress' ? '&perfProfile=stress' : ''}`;

const METRIC = {
  startup: 'pf01.startup.first_list_visible',
  search: 'pf01.search.results_visible',
  filter: 'pf01.filter.results_visible',
  select: 'pf01.select.skill_cells_visible',
} as const;

const STARTUP_SAMPLES = 5;
const INTERACTION_SAMPLES = 20;

/** 搜索词只用于驱动确定子集，绝不写入指标名或样本；
 * 名称按全局序号步长 4 编号，两词命中数（representative 25/3，stress 25/3）
 * 互不相同且都小于全量，保证每次交替都有真实 DOM 变更 */
const SEARCH_TERMS = ['pf01-skill-00', 'pf01-skill-000'];
// 首个筛选必须令首屏条数变化，避免 20→20 时缺少可观测的 DOM 稳定边界。
const FILTER_AGENTS = ['gemini-cli', 'codex'];

const samples: Record<string, number[]> = {
  [METRIC.startup]: [],
  [METRIC.search]: [],
  [METRIC.filter]: [],
  [METRIC.select]: [],
};

interface ProbeState {
  start: number;
  result: number | null;
}

interface Pf01Page {
  __pf01?: {
    getStartupMs: () => number | null;
    countList: (condition: { searchText?: string; agents?: string[] }) => number | null;
    openLocator: () => void;
    dispatchSearch: (searchText: string) => void;
  };
  __pf01Probe?: ProbeState;
}

async function openFresh(): Promise<void> {
  await browser.url(ENTRY);
  await $('.workbench').waitForDisplayed();
  await $('[role="option"]').waitForDisplayed();
}

/** 列表探针：结果行数稳定等于 expectedCount（MutationObserver + rAF 复核） */
async function armListProbe(expectedCount: number): Promise<void> {
  await browser.execute((count) => {
    const page = window as unknown as Pf01Page;
    // 筛选会短暂置为 loading 并卸载 `.list-pane`；必须监听不卸载的父容器，
    // 再对新建的列表计算 rows，不能把观察器绑在将被移除的旧节点上。
    const root = document.querySelector('.workbench-main');
    if (root === null) throw new Error('缺少 .workbench-main');
    const rowCount = () => root.querySelectorAll('.list-pane [role="option"]').length;
    page.__pf01Probe = { start: performance.now(), result: null };
    const probe = page.__pf01Probe;
    const observer = new MutationObserver(() => {
      if (rowCount() !== count) return;
      requestAnimationFrame(() => {
        if (probe.result !== null) return;
        if (rowCount() === count) {
          probe.result = performance.now() - probe.start;
          observer.disconnect();
        }
      });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }, expectedCount);
}

/** 详情探针：只读结构化详情中的四个固定 Skill cells 出现且内容更新。 */
async function armDetailProbe(): Promise<void> {
  await browser.execute(() => {
    const page = window as unknown as Pf01Page;
    const panel = document.querySelector('.detail-panel');
    if (panel === null) throw new Error('缺少 .detail-panel');
    const before = panel.textContent ?? '';
    page.__pf01Probe = { start: performance.now(), result: null };
    const probe = page.__pf01Probe;
    const observer = new MutationObserver(() => {
      if (probe.result !== null) return;
      if (panel.querySelectorAll('.skill-target-grid article').length !== 4) return;
      if ((panel.textContent ?? '') === before) return;
      probe.result = performance.now() - probe.start;
      observer.disconnect();
    });
    observer.observe(panel, { childList: true, subtree: true, characterData: true });
  });
}

/** locator 探针：非空搜索的三类固定分组中结果数量稳定。 */
async function armLocatorProbe(expectedCount: number): Promise<void> {
  await browser.execute((count) => {
    const page = window as unknown as Pf01Page;
    const locator = document.querySelector('.global-locator');
    if (locator === null) throw new Error('缺少 .global-locator');
    page.__pf01Probe = { start: performance.now(), result: null };
    const probe = page.__pf01Probe;
    const observer = new MutationObserver(() => {
      if (locator.querySelectorAll('[data-testid="locator-result"]').length !== count) return;
      requestAnimationFrame(() => {
        if (probe.result !== null) return;
        if (locator.querySelectorAll('[data-testid="locator-result"]').length === count) {
          probe.result = performance.now() - probe.start;
          observer.disconnect();
        }
      });
    });
    observer.observe(locator, { childList: true, subtree: true, characterData: true });
  }, expectedCount);
}

/** 搜索 intent：probe 记点重置为 dispatch 时刻，再发出单次 dispatch */
async function dispatchSearchIntent(searchText: string): Promise<void> {
  await browser.execute((term) => {
    const page = window as unknown as Pf01Page;
    if (page.__pf01Probe) page.__pf01Probe.start = performance.now();
    page.__pf01?.dispatchSearch(term);
  }, searchText);
}

async function awaitProbeMs(): Promise<number> {
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => (window as unknown as Pf01Page).__pf01Probe?.result)) != null,
    { timeout: 15000, interval: 25, timeoutMsg: '性能探针 15s 内未稳定' },
  );
  const result = await browser.execute(() => (window as unknown as Pf01Page).__pf01Probe?.result);
  if (result == null) throw new Error('性能探针结果缺失');
  return result;
}

async function expectedCount(condition: {
  searchText?: string;
  agents?: string[];
}): Promise<number> {
  const count = await browser.execute(
    (cond) => (window as unknown as Pf01Page).__pf01?.countList(cond),
    condition,
  );
  if (count == null || count <= 0) {
    throw new Error(`perf-catalog 期望行数不可用: ${String(count)}`);
  }
  return count;
}

describe('PF-01 catalog-browse 采样', () => {
  it(`startup → 首屏列表可见（${STARTUP_SAMPLES} 次 fresh load）`, async () => {
    for (let index = 0; index < STARTUP_SAMPLES; index += 1) {
      await openFresh();
      await browser.waitUntil(
        async () =>
          (await browser.execute(() => (window as unknown as Pf01Page).__pf01?.getStartupMs())) !=
          null,
        { timeout: 15000, interval: 25, timeoutMsg: 'startup 记点缺失' },
      );
      const ms = await browser.execute(() =>
        (window as unknown as Pf01Page).__pf01?.getStartupMs(),
      );
      if (ms == null) throw new Error('startup 记点缺失');
      samples[METRIC.startup].push(ms);
    }
  });

  it(`选择 Skill 资产 → 四个只读 Agent cells 可见（${INTERACTION_SAMPLES} 样本）`, async () => {
    await openFresh();
    for (let index = 0; index < INTERACTION_SAMPLES; index += 1) {
      await armDetailProbe();
      const rows = await $$('[role="option"]');
      await rows[index % 2].click();
      samples[METRIC.select].push(await awaitProbeMs());
    }
  });

  it(`筛选 → 结果可见（${INTERACTION_SAMPLES} 样本）`, async () => {
    await openFresh();
    for (let index = 0; index < INTERACTION_SAMPLES; index += 1) {
      const agent = FILTER_AGENTS[index % FILTER_AGENTS.length];
      const expected = await expectedCount({ agents: [agent] });
      await armListProbe(expected);
      await $('#filter-agent').selectByAttribute('value', agent);
      samples[METRIC.filter].push(await awaitProbeMs());
    }
  });

  it(`搜索 → 结果可见（${INTERACTION_SAMPLES} 样本）`, async () => {
    await openFresh();
    await browser.execute(() => (window as unknown as Pf01Page).__pf01?.openLocator());
    await $('.global-locator').waitForDisplayed();
    for (let index = 0; index < INTERACTION_SAMPLES; index += 1) {
      const term = SEARCH_TERMS[index % SEARCH_TERMS.length];
      const expected = await expectedCount({ searchText: term });
      await armLocatorProbe(expected);
      await dispatchSearchIntent(term);
      samples[METRIC.search].push(await awaitProbeMs());
    }
  });

  after(() => {
    if (!OUTPUT_DIR) return;
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const payload = {
      schemaVersion: 1,
      descriptorId: 'PF-01',
      profile: PROFILE,
      collectedAt: new Date().toISOString(),
      unit: 'ms',
      metrics: Object.fromEntries(
        Object.entries(samples).map(([id, values]) => [
          id,
          { samples: values.map((value) => Math.round(value * 1000) / 1000) },
        ]),
      ),
    };
    writeFileSync(
      join(OUTPUT_DIR, 'samples.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );
  });
});
