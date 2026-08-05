import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  b2Assets,
  b2DefaultContext,
  b2DefaultSkillId,
  b2ProjectNames,
  type B2MockAsset,
} from '../../src/prototypes/full-ui-mock/b2-data';
import {
  applyB2DraftsToAssets,
  changedB2FileNames,
  controlsEnabledFromSearch,
  countB2ChangedFiles,
  createB2ListControls,
  firstB2ChangedFileName,
  paginateB2Items,
  searchB2Assets,
  sortB2ItemsByNameStable,
  toggleB2SkillTargetEnabled,
  withB2Criteria,
  type B2SortDirection,
} from '../../src/prototypes/full-ui-mock/b2-model';

/** 与 assetsForConfigContext 的 'all' 分支同语义（仅按类型过滤），但保留 B2MockAsset 类型。 */
function b2AssetsForAllContext(assetType: B2MockAsset['type']): B2MockAsset[] {
  return b2Assets.filter((asset) => asset.type === assetType);
}

interface AllSourceSection {
  key: string;
  label: string;
  assets: B2MockAsset[];
}

/** 镜像“全部”视图分段契约：全局适用在前，项目段按项目名稳定排序，空来源不出段。 */
function allSourceSections(
  contextAssets: readonly B2MockAsset[],
  sortDirection: B2SortDirection = 'asc',
): AllSourceSection[] {
  const sorted = (items: readonly B2MockAsset[]): B2MockAsset[] =>
    sortB2ItemsByNameStable(items, sortDirection);
  const sections: AllSourceSection[] = [];
  const globalAssets = sorted(contextAssets.filter((asset) => asset.scope === '全局'));
  if (globalAssets.length > 0) {
    sections.push({ key: 'global', label: '全局适用', assets: globalAssets });
  }
  const projectNames = sortB2ItemsByNameStable(
    Array.from(
      new Set(
        contextAssets.filter((asset) => asset.scope === '项目').map((asset) => asset.project),
      ),
    ).map((name) => ({ name })),
    'asc',
  ).map((entry) => entry.name);
  for (const project of projectNames) {
    const items = sorted(
      contextAssets.filter((asset) => asset.scope === '项目' && asset.project === project),
    );
    if (items.length > 0) {
      sections.push({ key: `project:${project}`, label: project, assets: items });
    }
  }
  return sections;
}

function namedItems(count: number): Array<{ id: string; name: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-${index + 1}`,
    name: `Asset ${String(index + 1).padStart(3, '0')}`,
  }));
}

describe('selected B2 list model', () => {
  it('keeps the 20/21 record boundary deterministic', () => {
    const twenty = paginateB2Items(namedItems(20), 1, 20);
    const twentyOneFirst = paginateB2Items(namedItems(21), 1, 20);
    const twentyOneSecond = paginateB2Items(namedItems(21), 2, 20);

    expect(twenty).toMatchObject({ totalItems: 20, totalPages: 1, page: 1 });
    expect(twenty.items).toHaveLength(20);
    expect(twentyOneFirst).toMatchObject({ totalItems: 21, totalPages: 2, page: 1 });
    expect(twentyOneFirst.items).toHaveLength(20);
    expect(twentyOneSecond.items).toHaveLength(1);
  });

  it('keeps the 50/51 record boundary deterministic', () => {
    const fifty = paginateB2Items(namedItems(50), 1, 50);
    const fiftyOneFirst = paginateB2Items(namedItems(51), 1, 50);
    const fiftyOneSecond = paginateB2Items(namedItems(51), 2, 50);

    expect(fifty).toMatchObject({ totalItems: 50, totalPages: 1, page: 1 });
    expect(fiftyOneFirst).toMatchObject({ totalItems: 51, totalPages: 2, page: 1 });
    expect(fiftyOneFirst.items).toHaveLength(50);
    expect(fiftyOneSecond.items.map((item) => item.id)).toEqual(['asset-51']);
  });

  it('sorts names stably in both directions', () => {
    const items = [
      { id: 'second-alpha', name: 'alpha' },
      { id: 'beta', name: 'Beta' },
      { id: 'first-alpha', name: 'Alpha' },
    ];

    expect(sortB2ItemsByNameStable(items, 'asc').map((item) => item.id)).toEqual([
      'second-alpha',
      'first-alpha',
      'beta',
    ]);
    expect(sortB2ItemsByNameStable(items, 'desc').map((item) => item.id)).toEqual([
      'beta',
      'second-alpha',
      'first-alpha',
    ]);
  });

  it('returns to page one whenever sorting, filtering or page capacity changes', () => {
    const controls = { ...createB2ListControls(), page: 3 };

    expect(withB2Criteria(controls, { sortDirection: 'desc' })).toMatchObject({
      sortDirection: 'desc',
      page: 1,
    });
    expect(withB2Criteria(controls, { pageSize: 50 })).toMatchObject({ pageSize: 50, page: 1 });
    expect(withB2Criteria(controls, {})).toMatchObject({ page: 1 });
  });

  it('does not paginate global search results', () => {
    const many = Array.from({ length: 51 }, (_, index) => ({
      ...b2Assets[0],
      id: `search-${index}`,
      name: `Search asset ${index}`,
    }));

    expect(searchB2Assets(many, 'search asset')).toHaveLength(51);
  });

  it('counts only files whose draft differs during edit', () => {
    const asset = b2Assets.find((candidate) => candidate.id === b2DefaultSkillId)!;
    const drafts = {
      [asset.files[0].name]: `${asset.files[0].content}\nchanged`,
      [asset.files[1].name]: asset.files[1].content,
    };

    expect(countB2ChangedFiles(asset, drafts, 'edit')).toBe(1);
    expect(countB2ChangedFiles(asset, drafts, 'convert')).toBe(asset.files.length);
  });

  it('focuses the first real changed file before review', () => {
    const asset = b2Assets.find((candidate) => candidate.id === b2DefaultSkillId)!;
    const drafts = {
      [asset.files[0].name]: `${asset.files[0].content}\nchanged`,
      [asset.files[1].name]: asset.files[1].content,
    };

    expect(changedB2FileNames(asset, drafts, 'edit')).toEqual([asset.files[0].name]);
    expect(firstB2ChangedFileName(asset, drafts, 'edit')).toBe(asset.files[0].name);
  });

  it('writes confirmed drafts into an isolated B2 memory snapshot', () => {
    const asset = b2Assets.find((candidate) => candidate.id === b2DefaultSkillId)!;
    const appliedContent = `${asset.files[0].content}\nconfirmed`;
    const next = applyB2DraftsToAssets(b2Assets, asset.id, {
      [asset.files[0].name]: appliedContent,
    });

    expect(next).not.toBe(b2Assets);
    const appliedAsset = next.find((candidate) => candidate.id === asset.id)!;
    expect(appliedAsset.files[0].content).toBe(appliedContent);
    expect(
      countB2ChangedFiles(appliedAsset, { [asset.files[0].name]: appliedContent }, 'edit'),
    ).toBe(0);
    expect(asset.files[0].content).not.toBe(appliedContent);
  });

  it('toggles only an eligible Skill target in the isolated session snapshot', () => {
    const asset = b2Assets.find((candidate) => candidate.id === b2DefaultSkillId)!;
    const enabled = asset.agentTargets!.find((target) => target.agent === 'Codex')!;
    const next = toggleB2SkillTargetEnabled(b2Assets, asset.id, enabled.agent);

    expect(next).not.toBe(b2Assets);
    expect(next.find((candidate) => candidate.id === asset.id)?.agentTargets).toContainEqual({
      ...enabled,
      enabled: !(enabled.enabled ?? enabled.status === 'recognized'),
    });
    expect(asset.agentTargets!.find((target) => target.agent === enabled.agent)).toEqual(enabled);

    const blockedAsset = b2Assets.find((candidate) =>
      candidate.agentTargets?.some((target) => target.status === 'blocked'),
    )!;
    const blocked = blockedAsset.agentTargets!.find((target) => target.status === 'blocked')!;
    expect(toggleB2SkillTargetEnabled(b2Assets, blockedAsset.id, blocked.agent)).toEqual(b2Assets);
  });

  it('uses controls=0 as clean mode and controls=1 as development mode', () => {
    expect(controlsEnabledFromSearch('')).toBe(false);
    expect(controlsEnabledFromSearch('?controls=0')).toBe(false);
    expect(controlsEnabledFromSearch('?controls=1')).toBe(true);
    expect(controlsEnabledFromSearch('?controls=2')).toBe(false);
  });

  it('sorts each source section independently while head and rows share column tracks', () => {
    const projectItems = [
      { id: 'project-zebra', name: 'zebra' },
      { id: 'project-alpha', name: 'alpha' },
    ];
    const globalItems = [{ id: 'global-aardvark', name: 'aardvark' }];
    const sectioned = [
      ...sortB2ItemsByNameStable(projectItems, 'asc'),
      ...sortB2ItemsByNameStable(globalItems, 'asc'),
    ];

    expect(sectioned.map((item) => item.id)).toEqual([
      'project-alpha',
      'project-zebra',
      'global-aardvark',
    ]);

    const css = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/b2.css', import.meta.url),
      'utf8',
    );
    const headTracks = css.match(
      /\.variant-selected \.b2-table-head \{[\s\S]*?grid-template-columns: ([^;]+);/,
    )?.[1];
    const rowTracks = css.match(
      /\.variant-selected \.b2-asset-row \{[\s\S]*?grid-template-columns: ([^;]+);/,
    )?.[1];

    expect(headTracks).toBeDefined();
    expect(headTracks).toBe(rowTracks);
  });

  it('ships the exact reference project density without touching legacy fixtures', () => {
    expect(b2ProjectNames).toEqual([
      'ReinventedWheelAgent',
      'agent-config-manager',
      'mobile-tooling',
    ]);
    expect(b2DefaultContext).toBe('all');
    expect(b2DefaultSkillId).toBe('b2-commit-conventions');
    expect(
      b2Assets.filter(
        (asset) => asset.project === 'ReinventedWheelAgent' && asset.type === 'Skills',
      ),
    ).toHaveLength(8);
  });

  it('aggregates the all view into global-first stable sections without empty buckets', () => {
    const allSkills = b2AssetsForAllContext('Skills');
    const sections = allSourceSections(allSkills);

    expect(sections.map((section) => section.key)).toEqual([
      'global',
      'project:agent-config-manager',
      'project:mobile-tooling',
      'project:ReinventedWheelAgent',
    ]);
    expect(sections.map((section) => [section.label, section.assets.length])).toEqual([
      ['全局适用', 2],
      ['agent-config-manager', 2],
      ['mobile-tooling', 2],
      ['ReinventedWheelAgent', 8],
    ]);
    expect(sections[0].assets.every((asset) => asset.scope === '全局')).toBe(true);
    for (const section of sections.slice(1)) {
      expect(
        section.assets.every(
          (asset) => asset.scope === '项目' && `project:${asset.project}` === section.key,
        ),
      ).toBe(true);
    }

    // Gemini CLI 筛选使全局与 agent-config-manager 无匹配：两段整体消失，不产生空标题
    const geminiOnly = allSourceSections(allSkills.filter((asset) => asset.agent === 'Gemini CLI'));
    expect(geminiOnly.map((section) => section.key)).toEqual([
      'project:mobile-tooling',
      'project:ReinventedWheelAgent',
    ]);
    expect(geminiOnly.every((section) => section.assets.length > 0)).toBe(true);

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const derivation = source.slice(
      source.indexOf('const selectedSourceSections = useMemo'),
      source.indexOf('const selectedSortedAssets = useMemo'),
    );
    expect(derivation).toContain("if (state.configContext !== 'all') return [];");
    expect(derivation).toContain('if (selectedSortedGlobalAssets.length > 0)');
    expect(derivation).toContain("key: 'global', label: '全局适用'");
    expect(derivation).toContain(
      'Array.from(new Set(selectedProjectAssets.map((asset) => asset.project)))',
    );
    expect(derivation).toContain('if (items.length > 0)');
    expect(derivation).toContain('key: `project:${project}`');
    // 实现的 'all' 过滤分支与本测试 fixture 构造同语义：仅按类型过滤
    expect(source).toContain("if (state.configContext === 'all') return true;");
  });

  it('sorts each all-view section independently without cross-section moves', () => {
    const allSkills = b2AssetsForAllContext('Skills');
    const asc = allSourceSections(allSkills, 'asc');
    const desc = allSourceSections(allSkills, 'desc');

    // 段序固定，不随排序方向变化
    expect(desc.map((section) => section.key)).toEqual(asc.map((section) => section.key));

    const globalAsc = asc[0].assets.map((asset) => asset.name);
    expect(globalAsc).toEqual(['security-review', 'technical-writing']);
    expect(desc[0].assets.map((asset) => asset.name)).toEqual([...globalAsc].reverse());

    const reinventedAsc = asc[3].assets.map((asset) => asset.name);
    expect(reinventedAsc).toEqual([
      'api-contract-audit',
      'code-review-checklist',
      'commit-conventions',
      'frontend-design',
      'harmonyos-migration-review',
      'migration-evidence',
      'release-checklist',
      'testing-strategy',
    ]);
    expect(desc[3].assets.map((asset) => asset.name)).toEqual([...reinventedAsc].reverse());

    // 资产不跨段移动：每个分段在两个方向下的 id 集合一致
    for (let index = 0; index < asc.length; index += 1) {
      expect(new Set(desc[index].assets.map((asset) => asset.id))).toEqual(
        new Set(asc[index].assets.map((asset) => asset.id)),
      );
    }

    // 同名资产跨来源共存：稳定排序保留各自独立条目，不合并、不去重
    const duplicates = [
      { id: 'project-agents', name: 'AGENTS.md' },
      { id: 'global-agents', name: 'AGENTS.md' },
    ];
    for (const direction of ['asc', 'desc'] as const) {
      expect(sortB2ItemsByNameStable(duplicates, direction).map((item) => item.id)).toEqual([
        'project-agents',
        'global-agents',
      ]);
    }
  });

  it('paginates the all view over the aggregated cross-source total', () => {
    const sections = allSourceSections(b2AssetsForAllContext('Skills'));
    const aggregated = sections.flatMap((section) => section.assets);
    const sectionTotal = sections.reduce((total, section) => total + section.assets.length, 0);

    expect(aggregated).toHaveLength(14);
    expect(sectionTotal).toBe(14);

    const page = paginateB2Items(aggregated, 1, 20);
    expect(page).toMatchObject({ totalItems: 14, totalPages: 1, page: 1 });
    expect(page.items).toHaveLength(14);

    // 基数是聚合结果而非单一分段：跨段拼合的 23 项产出第二页 3 项
    const globalItems = namedItems(20).map((item) => ({ ...item, id: `global-${item.id}` }));
    const projectItems = namedItems(3).map((item) => ({ ...item, id: `project-${item.id}` }));
    const secondPage = paginateB2Items([...globalItems, ...projectItems], 2, 20);
    expect(secondPage).toMatchObject({ totalItems: 23, totalPages: 2, page: 2 });
    expect(secondPage.items.map((item) => item.id)).toEqual([
      'project-asset-1',
      'project-asset-2',
      'project-asset-3',
    ]);

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const sortedAssets = source.slice(
      source.indexOf('const selectedSortedAssets = useMemo'),
      source.indexOf('const b2Page = useMemo'),
    );
    expect(sortedAssets).toContain("if (state.configContext === 'all')");
    expect(sortedAssets).toContain('selectedSourceSections.flatMap((section) => section.assets)');
    expect(source).toContain(
      'paginateB2Items(selectedSortedAssets, b2ListControls.page, b2ListControls.pageSize)',
    );
  });
});
