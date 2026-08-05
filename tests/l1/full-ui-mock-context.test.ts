import { describe, expect, it } from 'vitest';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import {
  b2AssetBlockReason,
  b2AssetDecisionStatus,
  b2Assets,
  b2DefaultContext,
  b2DefaultSkillId,
  createB2NativeAsset,
} from '../../src/prototypes/full-ui-mock/b2-data';
import {
  AssetTypeRail,
  ConfigContextSidebar,
  ManagementSurface,
  OutcomeSurface,
  SelectedAssetRow,
  SelectedCatalog,
  TargetIdentitySummary,
  applyResultTransitionForState,
  applySelectedSnapshotForState,
  b2CatalogSummary,
  b2ConvertTargetForSource,
  b2NarrowStepForState,
  b2TargetIdentityForState,
  b2TargetScopeLabel,
  confirmationDetailsForState,
  continueEditingTransitionForState,
  dirtyGuardBehaviorForState,
  draftDirtyForState,
  enterB2SelectedEdit,
  escapeTransitionForState,
  globalSearchShortcutTransitionForState,
  reviewTransitionForState,
  selectedApplySucceeds,
  selectedInlineInstructionEdit,
  selectedWriteBlockReason,
  shouldFocusGlobalSearchDestination,
  shouldClearPendingTransitionOnEscape,
  variantBoundaryFilterReset,
  type B2SourceSection,
} from '../../src/prototypes/full-ui-mock/FullUiMock';
import {
  changedB2FileNames,
  sortB2ItemsByNameStable,
} from '../../src/prototypes/full-ui-mock/b2-model';
import {
  applyDiscardedTransition,
  assetSelectionTransition,
  assetTypeTransition,
  assetsForConfigContext,
  configContextTransition,
  configContextForAsset,
  globalAssetSelectionTransition,
  projectNamesFromAssets,
  resetForJourney,
  selectedWriteJourneyBlocked,
} from '../../src/prototypes/full-ui-mock/state';
import type { MockUiState } from '../../src/prototypes/full-ui-mock/types';
import { assetTypes, selectedAssetTypes } from '../../src/prototypes/full-ui-mock/types';

const selectedState = {
  variant: 'selected',
  inheritanceLayout: 'A',
  journey: 'edit',
  stage: 'editing',
  assetType: 'Skills',
  assetId: b2DefaultSkillId,
  fileName: 'SKILL.md',
  scenario: 'ready',
  view: 'source',
  search: '',
  searchRange: 'current',
  agentFilter: '全部 Agent',
  catalogState: 'normal',
  configContext: b2DefaultContext,
  selectedPanel: 'list',
  selectedStep: 'list',
  dirty: true,
  drafts: { 'SKILL.md': 'changed' },
  skillTarget: null,
  panelOverlay: null,
  globalSearchOpen: true,
  globalSearch: 'commit',
  scopeFilter: '全部',
  filters: { status: [], agent: [] },
  filterOpen: false,
  focused: false,
  inspectorOpen: null,
  viewport: 'wide',
  libraryWidth: 294,
  inspectorWidth: 244,
  managementTab: 'projects',
  createMode: '导入项目 Skill',
  createName: 'commit-message-guide',
  importProject: 'ReinventedWheelAgent',
  targetAssetType: 'Skills',
  targetAgent: 'Codex',
  targetScope: '项目',
  recoveryAction: 'idle',
  appliedFileCount: null,
  notice: null,
} satisfies MockUiState;

/** 镜像“全部”视图分段契约：全局适用在前，项目段按项目名稳定排序，空来源不出段。 */
function allViewSourceSections(assetType: 'Skills' | '长期指令'): B2SourceSection[] {
  // 与 assetsForConfigContext 的 'all' 分支同语义（仅按类型过滤），但保留 B2MockAsset 类型
  const contextAssets = b2Assets.filter((asset) => asset.type === assetType);
  const sections: B2SourceSection[] = [];
  const globalAssets = sortB2ItemsByNameStable(
    contextAssets.filter((asset) => asset.scope === '全局'),
    'asc',
  );
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
    const items = sortB2ItemsByNameStable(
      contextAssets.filter((asset) => asset.scope === '项目' && asset.project === project),
      'asc',
    );
    if (items.length > 0) {
      sections.push({ key: `project:${project}`, label: project, assets: items });
    }
  }
  return sections;
}

function renderAllViewCatalog(options: {
  assetType: 'Skills' | '长期指令';
  assetId: string;
  fileName: string;
  sections: B2SourceSection[];
  masterDetail?: boolean;
}): string {
  const aggregated = options.sections.flatMap((section) => section.assets);
  return renderToStaticMarkup(
    createElement(SelectedCatalog, {
      state: {
        ...selectedState,
        journey: 'browse',
        stage: 'browse',
        assetType: options.assetType,
        assetId: options.assetId,
        fileName: options.fileName,
        dirty: false,
        globalSearchOpen: false,
        globalSearch: '',
        selectedPanel: 'list',
        selectedStep: 'list',
      },
      selectedAssets: aggregated,
      selectedApplicableGlobalAssets: aggregated.filter((asset) => asset.scope === '全局'),
      selectedSourceSections: options.sections,
      b2ListControls: { sortDirection: 'asc', pageSize: 20, page: 1 },
      b2Page: {
        items: aggregated,
        page: 1,
        pageSize: 20,
        totalItems: aggregated.length,
        totalPages: 1,
      },
      b2FirstRowFocusRef: createRef<HTMLButtonElement>(),
      b2ListScrollRef: createRef<HTMLDivElement>(),
      selectedFilterTriggerRef: createRef<HTMLButtonElement>(),
      resetB2Page: () => undefined,
      setB2SortDirection: () => undefined,
      setB2PageSize: () => undefined,
      changeB2Page: () => undefined,
      setInheritanceLayout: () => undefined,
      patchState: () => undefined,
      chooseAsset: () => undefined,
      toggleSkillAgentEnabled: () => undefined,
      masterDetail: options.masterDetail ?? false,
    }),
  );
}

describe('selected B2 config context', () => {
  it('preserves narrow edit and detail surfaces while only resetting browse lists to the type rail', () => {
    expect(
      b2NarrowStepForState({
        stage: 'editing',
        selectedPanel: 'detail',
        selectedStep: 'detail',
      }),
    ).toBe('detail');
    expect(
      b2NarrowStepForState({
        stage: 'discard',
        selectedPanel: 'detail',
        selectedStep: 'detail',
      }),
    ).toBe('detail');
    expect(
      b2NarrowStepForState({
        stage: 'browse',
        selectedPanel: 'detail',
        selectedStep: 'detail',
      }),
    ).toBe('detail');
    expect(
      b2NarrowStepForState({
        stage: 'browse',
        selectedPanel: 'list',
        selectedStep: 'list',
      }),
    ).toBe('type');
  });

  it('uses context-accurate asset summary wording', () => {
    expect(b2CatalogSummary('global', 2)).toBe('2 项全局资产');
    expect(b2CatalogSummary('project:ReinventedWheelAgent', 8)).toBe('8 项项目自有与全局适用资产');
  });

  it('resets shared filters only when crossing selected and legacy visual systems', () => {
    expect(variantBoundaryFilterReset('selected', 'A')).toEqual({
      agentFilter: '全部 Agent',
      filters: { status: [], agent: [] },
      filterOpen: false,
    });
    expect(variantBoundaryFilterReset('A', 'selected')).toEqual({
      agentFilter: '全部 Agent',
      filters: { status: [], agent: [] },
      filterOpen: false,
    });
    expect(variantBoundaryFilterReset('A', 'B')).toEqual({});
    expect(variantBoundaryFilterReset('selected', 'selected')).toEqual({});
  });

  it('uses one truthful selected Apply success predicate for transition and snapshots', () => {
    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    const sentinel = `${asset.files[0].content}\nSENTINEL-V10-APPLY`;

    for (const scenario of ['ready', 'dirty', 'stale', 'degraded'] as const) {
      const state = {
        ...selectedState,
        scenario,
        journey: 'edit' as const,
        drafts: { [asset.files[0].name]: sentinel },
      };
      expect(selectedApplySucceeds(state, asset)).toBe(true);
      expect(applyResultTransitionForState(state, asset)).toMatchObject({
        stage: 'result',
        dirty: false,
        appliedFileCount: 1,
      });
      const snapshots = applySelectedSnapshotForState(b2Assets, state, asset);
      expect(
        snapshots
          .find((candidate) => candidate.id === asset.id)!
          .files.find((file) => file.name === asset.files[0].name)!.content,
      ).toBe(sentinel);
    }

    for (const scenario of ['conflict', 'failed', 'blocked', 'readonly'] as const) {
      const state = {
        ...selectedState,
        scenario,
        journey: 'edit' as const,
        drafts: { [asset.files[0].name]: sentinel },
      };
      expect(selectedApplySucceeds(state, asset)).toBe(false);
      const snapshots = applySelectedSnapshotForState(b2Assets, state, asset);
      expect(
        snapshots
          .find((candidate) => candidate.id === asset.id)!
          .files.find((file) => file.name === asset.files[0].name)!.content,
      ).toBe(asset.files[0].content);
    }

    const incompatible = b2Assets.find((candidate) => candidate.decisionStatus === '不兼容')!;
    const incompatibleState = {
      ...selectedState,
      scenario: 'ready' as const,
      journey: 'edit' as const,
      drafts: { [incompatible.files[0].name]: 'incompatible sentinel' },
    };
    expect(selectedApplySucceeds(incompatibleState, incompatible)).toBe(false);
    expect(applySelectedSnapshotForState(b2Assets, incompatibleState, incompatible)).toEqual(
      b2Assets,
    );
  });

  it('persists and preserves drafts from the inline long-term instruction lifecycle', () => {
    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    const file = asset.files[0];
    const draft = `${file.content}\nINLINE-INSTRUCTION-DRAFT`;
    const readyState = {
      ...selectedState,
      journey: 'browse' as const,
      stage: 'confirm' as const,
      scenario: 'ready' as const,
      assetId: asset.id,
      assetType: asset.type,
      fileName: file.name,
      drafts: { [file.name]: draft },
    };

    expect(selectedInlineInstructionEdit(readyState, asset)).toBe(true);
    expect(
      applySelectedSnapshotForState(b2Assets, readyState, asset)
        .find((candidate) => candidate.id === asset.id)!
        .files.find((candidate) => candidate.name === file.name)!.content,
    ).toBe(draft);

    const conflict = applyResultTransitionForState({ ...readyState, scenario: 'conflict' }, asset);
    expect(conflict).toMatchObject({
      stage: 'result',
      dirty: true,
      drafts: { [file.name]: draft },
      appliedFileCount: 0,
    });
    expect(selectedInlineInstructionEdit({ ...readyState, journey: 'edit' }, asset)).toBe(false);
  });

  it('creates native assets from type, Agent, scope, and managed project conventions', () => {
    const cases = [
      {
        type: 'Skills' as const,
        agent: 'Codex',
        scope: '项目' as const,
        project: 'ReinventedWheelAgent',
        expectedFile: 'SKILL.md',
        expectedLanguage: 'markdown',
        expectedPath: '~/projects/ReinventedWheelAgent/.codex/skills/shared-name/SKILL.md',
        expectedContent: 'name: shared-name',
      },
      {
        type: '长期指令' as const,
        agent: 'Claude Code',
        scope: '全局' as const,
        project: '用户全局配置',
        expectedFile: 'CLAUDE.md',
        expectedLanguage: 'markdown',
        expectedPath: '~/.claude/CLAUDE.md',
        expectedContent: '# shared-name',
      },
      {
        type: 'Subagents' as const,
        agent: 'Gemini CLI',
        scope: '项目' as const,
        project: 'mobile-tooling',
        expectedFile: 'agents/shared-name.md',
        expectedLanguage: 'markdown',
        expectedPath: '~/projects/mobile-tooling/.gemini/agents/shared-name.md',
        expectedContent: 'name: shared-name',
      },
      {
        type: 'Hooks' as const,
        agent: 'OpenCode',
        scope: '全局' as const,
        project: '用户全局配置',
        expectedFile: 'hooks/shared-name.json',
        expectedLanguage: 'json',
        expectedPath: '~/.opencode/hooks/shared-name.json',
        expectedContent: '"name": "shared-name"',
      },
    ];

    for (const testCase of cases) {
      const asset = createB2NativeAsset({
        type: testCase.type,
        name: 'shared-name',
        agent: testCase.agent,
        scope: testCase.scope,
        project: testCase.project,
        mode: '新建',
      });
      expect(asset.type).toBe(testCase.type);
      expect(asset.agent).toBe(testCase.agent);
      expect(asset.scope).toBe(testCase.scope);
      expect(asset.project).toBe(testCase.project);
      expect(asset.sourcePath).toBe(testCase.expectedPath);
      expect(asset.files).toHaveLength(1);
      expect(asset.files[0]).toMatchObject({
        name: testCase.expectedFile,
        language: testCase.expectedLanguage,
      });
      expect(asset.files[0].content).toContain(testCase.expectedContent);
    }

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('<span>目标项目</span>');
    expect(source).toContain('b2ProjectNames.map((project)');
    expect(source).toContain('selectedProjectContext !== null');
  });

  it('keeps one complete target identity through project and global transaction summaries', () => {
    const asset = b2Assets.find((candidate) => candidate.name === 'commit-conventions')!;
    const projectState = {
      ...selectedState,
      journey: 'convert' as const,
      targetScope: '项目' as const,
      importProject: 'ReinventedWheelAgent',
    };
    const projectTarget = b2TargetIdentityForState(projectState, asset, 'Gemini CLI');
    expect(projectTarget).toEqual({
      agent: 'Gemini CLI',
      scope: '项目',
      project: 'ReinventedWheelAgent',
      nativePath: '~/projects/ReinventedWheelAgent/.gemini/skills/commit-conventions/SKILL.md',
    });
    expect(b2TargetScopeLabel(projectTarget)).toBe('项目 · ReinventedWheelAgent');
    expect(confirmationDetailsForState(projectState, asset, 'Gemini CLI')).toEqual(
      expect.arrayContaining([
        '单一目标：项目 · ReinventedWheelAgent',
        '原生位置：~/projects/ReinventedWheelAgent/.gemini/skills/commit-conventions/SKILL.md',
      ]),
    );

    const globalTarget = b2TargetIdentityForState(
      {
        ...selectedState,
        targetScope: '全局',
      },
      asset,
      'Codex',
    );
    expect(globalTarget).toEqual({
      agent: 'Codex',
      scope: '全局',
      project: null,
      nativePath: '~/.codex/skills/commit-conventions/SKILL.md',
    });
    expect(
      renderToStaticMarkup(createElement(TargetIdentitySummary, { identity: globalTarget })),
    ).toContain('aria-label="单一目标"');
  });

  it('uses one visible incompatible decision status and adjacent block reason', () => {
    const asset = b2Assets.find((candidate) => candidate.name === 'adapter-audit')!;
    expect(asset.status).toBeUndefined();
    expect(b2AssetDecisionStatus(asset)).toBe('不兼容');
    expect(b2AssetBlockReason(asset)).toBe('适配器未覆盖此 Skill 结构。');
    expect(selectedWriteBlockReason({ variant: 'selected', scenario: 'ready' }, asset)).toBe(
      '适配器未覆盖此 Skill 结构。 当前 Skill 仍可结构化查看，但不提供源码、编辑或转换。',
    );

    const markup = renderToStaticMarkup(
      createElement(SelectedAssetRow, {
        asset,
        selected: false,
        onChoose: () => undefined,
        onToggleAgent: () => undefined,
      }),
    );
    expect(markup).toContain('不兼容');
    expect(markup).toContain('原因：适配器未覆盖此 Skill 结构。');
    expect(markup).toContain('data-b2-icon="alert-triangle"');
    expect(markup).not.toContain('>正常<');
    expect(markup).toContain('disabled=""');
  });

  it('keeps create templates reviewable while edit drafts can return clean', () => {
    const created = createB2NativeAsset({
      type: 'Skills',
      name: 'dirty-semantics',
      agent: 'Codex',
      scope: '项目',
      project: 'ReinventedWheelAgent',
      mode: '新建',
    });
    const createDrafts = { [created.files[0].name]: created.files[0].content };
    expect(
      draftDirtyForState({ variant: 'selected', journey: 'create' }, created, createDrafts),
    ).toBe(true);
    expect(changedB2FileNames(created, createDrafts, 'create')).toEqual([created.files[0].name]);

    const existing = b2Assets.find((candidate) => candidate.name === 'commit-conventions')!;
    const originalDrafts = {
      [existing.files[0].name]: existing.files[0].content,
    };
    expect(
      draftDirtyForState({ variant: 'selected', journey: 'edit' }, existing, originalDrafts),
    ).toBe(false);
    expect(
      draftDirtyForState({ variant: 'selected', journey: 'edit' }, existing, {
        [existing.files[0].name]: `${existing.files[0].content}\nchanged`,
      }),
    ).toBe(true);
  });

  it('renders the selected catalog as a native list without overriding button roles', () => {
    const asset = b2Assets.find((candidate) => candidate.name === 'commit-conventions')!;
    const browseState = {
      ...selectedState,
      journey: 'browse' as const,
      stage: 'browse' as const,
      dirty: false,
      globalSearchOpen: false,
      globalSearch: '',
      selectedPanel: 'list' as const,
      selectedStep: 'list' as const,
    };
    const markup = renderToStaticMarkup(
      createElement(SelectedCatalog, {
        state: browseState,
        selectedAssets: [asset],
        selectedApplicableGlobalAssets: [],
        selectedSourceSections: [
          {
            key: `project:${asset.project}`,
            label: asset.project,
            assets: [asset],
          },
        ],
        b2ListControls: { sortDirection: 'asc', pageSize: 20, page: 1 },
        b2Page: {
          items: [asset],
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
        },
        b2FirstRowFocusRef: createRef<HTMLButtonElement>(),
        b2ListScrollRef: createRef<HTMLDivElement>(),
        selectedFilterTriggerRef: createRef<HTMLButtonElement>(),
        resetB2Page: () => undefined,
        setB2SortDirection: () => undefined,
        setB2PageSize: () => undefined,
        changeB2Page: () => undefined,
        setInheritanceLayout: () => undefined,
        patchState: () => undefined,
        chooseAsset: () => undefined,
        toggleSkillAgentEnabled: () => undefined,
      }),
    );
    expect(markup).toContain('<ul class="selected-asset-list" aria-label="Skills 资产列表">');
    expect(markup).toContain('<h1 class="b2-visually-hidden">Skills 资产列表</h1>');
    expect(markup).not.toContain('<h1>Skills</h1>');
    expect(markup).not.toMatch(/role="(?:rowgroup|row|columnheader|gridcell)"/);
    expect(markup).toMatch(/<button[^>]*class="b2-row-primary"/);
    expect(markup).toMatch(/<button[^>]*class="b2-row-path"/);
    expect(markup).toContain('查看 Skill');
    // The head lives inside the scroll container so head and rows always share
    // one content width, and its Agent column headers stay in the a11y tree.
    expect(markup.indexOf('selected-catalog-list')).toBeLessThan(markup.indexOf('b2-table-head'));
    expect(markup).not.toMatch(/b2-table-head"[^>]*aria-hidden/);
    expect(markup).toContain('<div class="b2-table-head">');
    for (const label of ['Claude', 'Codex', 'Gemini', 'OpenCode']) {
      expect(markup).toContain(`class="b2-head-agent" role="img" aria-label="${label}"`);
    }
    expect(markup).toContain('class="b2-row-targets" role="group"');
  });

  it('narrows the catalog to a selectable list column inside master-detail', () => {
    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    const markup = renderToStaticMarkup(
      createElement(SelectedCatalog, {
        state: {
          ...selectedState,
          journey: 'browse',
          stage: 'browse',
          assetType: '长期指令',
          assetId: asset.id,
          fileName: asset.files[0].name,
          dirty: false,
          globalSearchOpen: false,
          globalSearch: '',
          selectedPanel: 'list',
          selectedStep: 'list',
        },
        selectedAssets: [asset],
        selectedApplicableGlobalAssets: [],
        selectedSourceSections: [
          {
            key: `project:${asset.project}`,
            label: asset.project,
            assets: [asset],
          },
        ],
        b2ListControls: { sortDirection: 'asc', pageSize: 20, page: 1 },
        b2Page: {
          items: [asset],
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
        },
        b2FirstRowFocusRef: createRef<HTMLButtonElement>(),
        b2ListScrollRef: createRef<HTMLDivElement>(),
        selectedFilterTriggerRef: createRef<HTMLButtonElement>(),
        resetB2Page: () => undefined,
        setB2SortDirection: () => undefined,
        setB2PageSize: () => undefined,
        changeB2Page: () => undefined,
        setInheritanceLayout: () => undefined,
        patchState: () => undefined,
        chooseAsset: () => undefined,
        toggleSkillAgentEnabled: () => undefined,
        masterDetail: true,
      }),
    );

    expect(markup).toContain('is-master-detail');
    expect(markup).not.toContain('b2-table-head');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('data-b2-focus="list"');
  });

  it('splits content asset surfaces into master-detail while Skills keep the jump model', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const layout = source.slice(
      source.indexOf('function SelectedLayout('),
      source.indexOf('export function ConfigContextSidebar('),
    );
    const detail = source.slice(
      source.indexOf('function SelectedAssetDetail('),
      source.indexOf('function SelectedAssetEditor('),
    );

    expect(layout).toContain('className="b2-master-detail"');
    expect(layout).toContain("state.assetType === '长期指令' || state.assetType === 'Subagents'");
    expect(layout).toContain('!b2Narrow');
    expect(layout).toContain('<SelectedCatalog {...props} masterDetail />');
    expect(layout).toContain('<SelectedAssetDetail {...props} masterDetail />');
    expect(detail).toContain("masterDetail && asset.type === 'Subagents'");
    expect(detail).toContain('className="b2-subagent-body"');

    const css = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/b2.css', import.meta.url),
      'utf8',
    );
    expect(css).toContain('.mock-frame.variant-selected .b2-master-detail {');
    expect(css).toContain('grid-template-columns: minmax(240px, 0.4fr) minmax(0, 1fr);');
    expect(css).toContain(
      '.mock-frame.variant-selected .b2-master-detail .b2-asset-row.is-selected {',
    );
  });

  it('keeps same-name created identities isolated by Agent, type, scope, and project', () => {
    const create = (
      type: 'Skills' | '长期指令' | 'Subagents' | 'Hooks',
      agent: string,
      scope: '全局' | '项目',
      project: string,
    ) =>
      createB2NativeAsset({
        type,
        name: 'collision-name',
        agent,
        scope,
        project,
        mode: '新建',
      });

    const assets = [
      create('长期指令', 'Codex', '项目', 'ReinventedWheelAgent'),
      create('Hooks', 'Codex', '项目', 'ReinventedWheelAgent'),
      create('长期指令', 'Codex', '全局', '用户全局配置'),
      create('长期指令', 'Codex', '项目', 'mobile-tooling'),
      create('长期指令', 'Claude Code', '项目', 'ReinventedWheelAgent'),
    ];

    expect(new Set(assets.map((asset) => asset.id)).size).toBe(assets.length);
    expect(create('长期指令', 'Codex', '项目', 'ReinventedWheelAgent').id).toBe(assets[0].id);

    let snapshots: typeof b2Assets = [];
    for (const asset of assets) {
      snapshots = applySelectedSnapshotForState(
        snapshots,
        {
          ...selectedState,
          journey: 'create',
          scenario: 'ready',
          drafts: { [asset.files[0].name]: asset.files[0].content },
        },
        asset,
      );
    }
    expect(snapshots).toHaveLength(assets.length);

    const exactReplacement = create('长期指令', 'Codex', '项目', 'ReinventedWheelAgent');
    snapshots = applySelectedSnapshotForState(
      snapshots,
      {
        ...selectedState,
        journey: 'create',
        scenario: 'ready',
        drafts: {
          [exactReplacement.files[0].name]: `${exactReplacement.files[0].content}\nreplacement`,
        },
      },
      exactReplacement,
    );
    expect(snapshots).toHaveLength(assets.length);
    expect(snapshots.find((asset) => asset.id === exactReplacement.id)!.files[0].content).toContain(
      'replacement',
    );
  });

  it('replaces one physical instruction target across different display names', () => {
    const createInstruction = (name: string) =>
      createB2NativeAsset({
        type: '长期指令',
        name,
        agent: 'Codex',
        scope: '项目',
        project: 'ReinventedWheelAgent',
        mode: '新建',
      });
    const first = createInstruction('team-rules');
    const second = createInstruction('security-rules');
    const sentinel = `${second.files[0].content}\nLAST-CONFIRMED-INSTRUCTION`;

    expect(first.sourcePath).toBe(second.sourcePath);
    expect(first.id).toBe(second.id);

    let snapshots = applySelectedSnapshotForState(
      b2Assets,
      {
        ...selectedState,
        journey: 'create',
        scenario: 'ready',
        drafts: { [first.files[0].name]: first.files[0].content },
      },
      first,
    );
    snapshots = applySelectedSnapshotForState(
      snapshots,
      {
        ...selectedState,
        journey: 'create',
        scenario: 'ready',
        drafts: { [second.files[0].name]: sentinel },
      },
      second,
    );

    const matchingTargets = snapshots.filter(
      (candidate) => candidate.sourcePath === second.sourcePath,
    );
    expect(matchingTargets).toHaveLength(1);
    expect(matchingTargets[0].name).toBe('security-rules');
    expect(matchingTargets[0].files[0].content).toContain('LAST-CONFIRMED-INSTRUCTION');
  });

  it('commits global-search choices as atomic browse detail destinations', () => {
    const target = b2Assets.find((candidate) => candidate.name === 'testing-strategy')!;

    for (const [journey, stage] of [
      ['edit', 'editing'],
      ['create', 'target'],
      ['convert', 'mapping'],
      ['manage', 'manage'],
    ] as const) {
      const drafts: Record<string, string> =
        journey === 'edit' ? { 'SKILL.md': 'dirty sentinel' } : {};
      const origin = {
        ...selectedState,
        journey,
        stage,
        dirty: journey === 'edit',
        drafts,
      };
      const transition = globalAssetSelectionTransition(origin, target);
      expect(transition).toMatchObject({
        journey: 'browse',
        stage: 'browse',
        assetId: target.id,
        assetType: target.type,
        fileName: target.files[0].name,
        configContext: 'project:ReinventedWheelAgent',
        selectedPanel: 'detail',
        selectedStep: 'detail',
        globalSearchOpen: false,
        globalSearch: '',
        drafts: {},
      });

      const committed = applyDiscardedTransition(origin, transition);
      expect(committed).toMatchObject({
        journey: 'browse',
        stage: 'browse',
        assetId: target.id,
        selectedPanel: 'detail',
        selectedStep: 'detail',
        dirty: false,
        drafts: {},
      });
    }
  });

  it('keeps the selected product create entry available without prototype controls', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const header = source.slice(
      source.indexOf('function SelectedHeader('),
      source.indexOf('function contextLabel('),
    );

    expect(header).toContain('b2-create-action');
    expect(header).toContain('新建或从本地导入配置资产');
    expect(header).toContain("startCreate('新建')");
  });

  it('enters the selected editor from a narrow detail interaction and seeds the primary draft', () => {
    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    const next = enterB2SelectedEdit(
      {
        ...selectedState,
        journey: 'browse',
        stage: 'browse',
        selectedPanel: 'detail',
        selectedStep: 'detail',
        dirty: false,
        drafts: {},
        assetId: asset.id,
        fileName: asset.files[0].name,
      },
      asset,
    );

    expect(next).toMatchObject({
      journey: 'edit',
      stage: 'editing',
      selectedPanel: 'detail',
      selectedStep: 'detail',
      skillTarget: null,
    });
    expect(next.drafts[asset.files[0].name]).toBe(asset.files[0].content);

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const detail = source.slice(
      source.indexOf('function SelectedAssetDetail('),
      source.indexOf('function SelectedAssetEditor('),
    );
    expect(detail).toContain('onClick={startSelectedEdit}');
  });

  it('fails closed selected readonly write journeys without changing legacy', () => {
    for (const journey of ['create', 'convert', 'manage'] as const) {
      const selected = resetForJourney(
        {
          ...selectedState,
          journey: 'browse',
          scenario: 'ready',
          dirty: false,
        },
        journey,
        'readonly',
      );
      expect(selected).toMatchObject({
        journey: 'browse',
        stage: 'browse',
        scenario: 'readonly',
      });

      const legacy = resetForJourney(
        {
          ...selectedState,
          variant: 'A',
          journey: 'browse',
          scenario: 'ready',
          dirty: false,
        },
        journey,
        'readonly',
      );
      expect(legacy.journey).toBe(journey);
      expect(legacy.stage).toBe(journey === 'manage' ? 'manage' : 'target');
    }
  });

  it('opens selected readonly source without creating an editable draft', () => {
    const asset = b2Assets.find((candidate) => candidate.name === 'testing-strategy')!;
    const next = enterB2SelectedEdit(
      {
        ...selectedState,
        journey: 'browse',
        stage: 'browse',
        scenario: 'readonly',
        selectedPanel: 'detail',
        selectedStep: 'detail',
        dirty: false,
        drafts: {},
        assetId: asset.id,
        fileName: asset.files[0].name,
      },
      asset,
    );

    expect(next).toMatchObject({
      journey: 'edit',
      stage: 'editing',
      selectedPanel: 'detail',
      selectedStep: 'detail',
      dirty: false,
      drafts: {},
    });
  });

  it('uses one canonical Convert target for the default and user-selected destination', () => {
    expect(b2ConvertTargetForSource('Codex')).toBe('Claude Code');
    const selectedTarget = b2ConvertTargetForSource('Codex', 'Gemini CLI');
    expect(selectedTarget).toBe('Gemini CLI');
    expect(b2ConvertTargetForSource('Codex', 'Codex')).toBe('Claude Code');

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain("if (state.variant !== 'selected') return 'Codex';");
    expect(source).toContain('setConvertTarget(b2ConvertTargetForSource(asset.agent));');
    expect(source).toContain('b2ConvertTargetForSource(asset.agent, event.currentTarget.value)');
    expect(source).toContain('`${asset.agent} → ${convertTarget}`');
    expect(source).toContain('`审查 ${convertTarget} 的目标文件`');
    expect(source).toContain(
      "state.journey === 'convert' || state.skillTarget?.action === 'install'",
    );

    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    const identity = b2TargetIdentityForState(selectedState, asset, selectedTarget);
    const markup = renderToStaticMarkup(createElement(TargetIdentitySummary, { identity }));
    expect(identity.agent).toBe(selectedTarget);
    expect(markup).toContain(`data-b2-target-agent="${selectedTarget}"`);
  });

  it('shows the actual convert changed-file count in focused confirmation', () => {
    const asset = b2Assets.find((candidate) => candidate.name === 'commit-conventions')!;
    const details = confirmationDetailsForState(
      { ...selectedState, journey: 'convert', stage: 'confirm', drafts: {} },
      asset,
      'Claude Code',
    );
    const changedFileCount = changedB2FileNames(asset, {}, 'convert').length;

    expect(details[0]).toBe(`${asset.name} · Claude Code`);
    expect(details).toContain(`转换 ${changedFileCount} 个原生文件到 Claude Code，完整映射`);
  });

  it('keeps narrow sorting visible and Agent chips at the 12px readability floor', () => {
    const css = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/b2.css', import.meta.url),
      'utf8',
    );

    expect(css).toMatch(/\.variant-selected \.b2-agent-chip \{[\s\S]*?font-size: 12px;/);
    expect(css).not.toContain('font-size: 9px;');
    expect(css).not.toContain('font-size: 10px;');
    expect(css).toMatch(
      /\.mock-frame\.variant-selected\[data-b2-narrow='true'\] \.b2-sort-button \{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/,
    );
    expect(css).toContain('.b2-sort-button svg:last-child');
    expect(css).toContain('minmax(200px, 0.9fr) 204px');
    expect(css).toContain('repeat(4, 48px)');
  });

  it('uses the pinned Lucide package and removes the handwritten icon module', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const packageLock = JSON.parse(
      readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'),
    ) as {
      packages: Record<
        string,
        {
          version?: string;
          integrity?: string;
          dependencies?: Record<string, string>;
        }
      >;
    };

    expect(packageJson.dependencies['lucide-react']).toBe('1.28.0');
    expect(packageLock.packages[''].dependencies?.['lucide-react']).toBe('1.28.0');
    expect(packageLock.packages['node_modules/lucide-react'].version).toBe('1.28.0');
    expect(packageLock.packages['node_modules/lucide-react'].integrity).toBe(
      'sha512-fARAFJULsGuDDydjp6+6blekG/sBIM29TerzLjc9bQUKAcEfrSc4ZQKb25KRz4OMKd87cZTb5dgq0w/T6KufVg==',
    );
    expect(
      existsSync(new URL('../../src/prototypes/full-ui-mock/b2-icons.tsx', import.meta.url)),
    ).toBe(false);
  });

  it('derives the exact managed project list from the selected-only fixtures', () => {
    expect(projectNamesFromAssets(b2Assets)).toEqual([
      'ReinventedWheelAgent',
      'agent-config-manager',
      'mobile-tooling',
    ]);
  });

  it('shows project-owned assets together with applicable global assets in a project context', () => {
    const globalSkills = assetsForConfigContext(b2Assets, 'global', 'Skills');
    expect(globalSkills.length).toBeGreaterThan(0);
    expect(globalSkills.every((asset) => asset.scope === '全局')).toBe(true);

    const projectInstructions = assetsForConfigContext(
      b2Assets,
      'project:ReinventedWheelAgent',
      '长期指令',
    );
    expect(projectInstructions).toHaveLength(2);
    expect(projectInstructions.some((asset) => asset.scope === '项目')).toBe(true);
    expect(projectInstructions.some((asset) => asset.scope === '全局')).toBe(true);
    expect(projectInstructions.find((asset) => asset.scope === '项目')).toMatchObject({
      scope: '项目',
      project: 'ReinventedWheelAgent',
      type: '长期指令',
    });
  });

  it('derives the destination context for a global-search result', () => {
    expect(configContextForAsset(b2Assets.find((asset) => asset.scope === '全局')!)).toBe('global');
    expect(
      configContextForAsset(
        b2Assets.find(
          (asset) => asset.scope === '项目' && asset.project === 'agent-config-manager',
        )!,
      ),
    ).toBe('project:agent-config-manager');
  });

  it('opens a same-id asset on the detail surface', () => {
    const destination = assetSelectionTransition(
      {
        ...selectedState,
        journey: 'browse',
        stage: 'browse',
        dirty: false,
        drafts: {},
      },
      b2Assets.find((asset) => asset.id === b2DefaultSkillId)!,
    );

    expect(destination).toMatchObject({
      configContext: b2DefaultContext,
      selectedPanel: 'detail',
      selectedStep: 'detail',
      globalSearchOpen: false,
      globalSearch: '',
    });
  });

  it('clears a clean draft when switching to another asset with the same primary file name', () => {
    const currentAsset = b2Assets.find((asset) => asset.id === selectedState.assetId)!;
    const nextAsset = b2Assets.find(
      (asset) =>
        asset.id !== currentAsset.id &&
        asset.type === currentAsset.type &&
        asset.files[0].name === currentAsset.files[0].name,
    )!;
    expect(nextAsset).toBeDefined();

    const destination = assetSelectionTransition(
      {
        ...selectedState,
        dirty: false,
        drafts: { [currentAsset.files[0].name]: currentAsset.files[0].content },
      },
      nextAsset,
    );

    expect(destination.drafts).toEqual({});
  });

  it('carries context, type, asset and narrow focus as one context destination', () => {
    const destination = configContextTransition(
      selectedState,
      b2Assets,
      'project:agent-config-manager',
    );

    expect(destination).toMatchObject({
      configContext: 'project:agent-config-manager',
      assetType: 'Skills',
      selectedPanel: 'list',
      selectedStep: 'list',
      drafts: {},
    });
    expect(destination.assetId).not.toBe(selectedState.assetId);
  });

  it('uses context filtering only for selected and keeps legacy type choice independent', () => {
    const selectedDestination = assetTypeTransition(selectedState, b2Assets, 'Subagents');
    const legacyAsset = {
      ...b2Assets[0],
      type: 'Hooks' as const,
      id: 'legacy-hook',
      project: 'legacy-project',
    };
    const legacyDestination = assetTypeTransition(
      { ...selectedState, variant: 'A', configContext: 'project:missing' },
      [legacyAsset],
      'Hooks',
    );

    expect(selectedDestination).toMatchObject({
      configContext: b2DefaultContext,
      selectedPanel: 'list',
      selectedStep: 'context',
    });
    expect(legacyDestination?.assetId).toBe('legacy-hook');
  });

  it('commits selected asset-type rail destinations as browse lists from clean editor and outcome', () => {
    const origins: MockUiState[] = [
      {
        ...selectedState,
        journey: 'edit',
        stage: 'editing',
        dirty: false,
        drafts: {},
      },
      {
        ...selectedState,
        journey: 'create',
        stage: 'result',
        dirty: false,
        drafts: {},
      },
    ];

    for (const origin of origins) {
      const destination = assetTypeTransition(origin, b2Assets, 'Subagents');

      expect(destination).toMatchObject({
        journey: 'browse',
        stage: 'browse',
        configContext: b2DefaultContext,
        assetType: 'Subagents',
        selectedPanel: 'list',
        selectedStep: 'context',
      });
    }
  });

  it('defers the selected asset-type list destination until dirty discard is confirmed', () => {
    const origin: MockUiState = {
      ...selectedState,
      journey: 'edit',
      stage: 'editing',
      dirty: true,
      drafts: { 'SKILL.md': 'dirty sentinel' },
    };
    const destination = assetTypeTransition(origin, b2Assets, 'Subagents');

    expect(destination).not.toBeNull();
    const guarded = { ...origin, ...dirtyGuardBehaviorForState(origin).patch };
    expect(guarded).toMatchObject({
      journey: 'edit',
      stage: 'discard',
      assetType: 'Skills',
      assetId: origin.assetId,
      dirty: true,
    });

    const discarded = applyDiscardedTransition(guarded, destination!);
    expect(discarded).toMatchObject({
      journey: 'browse',
      stage: 'browse',
      assetType: 'Subagents',
      selectedPanel: 'list',
      selectedStep: 'context',
      dirty: false,
      drafts: {},
    });
  });

  it('atomically discards drafts before applying one pending destination', () => {
    const destination = configContextTransition(selectedState, b2Assets, 'project:mobile-tooling');
    const next = applyDiscardedTransition(selectedState, destination);

    expect(next).toMatchObject(destination);
    expect(next.dirty).toBe(false);
    expect(next.drafts).toEqual({});
  });

  it('renders the B2 context rail with accessible selected state and Lucide markers', () => {
    const html = renderToStaticMarkup(
      createElement(ConfigContextSidebar, {
        state: selectedState,
        chooseConfigContext: () => undefined,
      }),
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('ReinventedWheelAgent');
    expect(html).toContain('agent-config-manager');
    expect(html).toContain('mobile-tooling');
    expect(html).not.toContain('所有项目');
    expect(html).not.toContain('纳入项目');
    expect(html).not.toContain('Agent 检测状态');
    expect(html).toContain('data-b2-icon="globe-2"');
  });

  it('renders one narrow type focus target only on selected, never on legacy Variant C', () => {
    const selectedHtml = renderToStaticMarkup(
      createElement(AssetTypeRail, {
        state: { ...selectedState, assetType: 'Skills' },
        onChoose: () => undefined,
        onManage: () => undefined,
        onBack: () => undefined,
      }),
    );
    const variantCHtml = renderToStaticMarkup(
      createElement(AssetTypeRail, {
        state: { ...selectedState, variant: 'C', assetType: 'Skills' },
        onChoose: () => undefined,
        onManage: () => undefined,
      }),
    );

    expect(selectedHtml.match(/data-b2-focus="type"/g)).toHaveLength(1);
    expect(selectedHtml).toMatch(/data-b2-focus="type"[^>]*>[\s\S]*?Skills/);
    expect(selectedHtml).toContain('data-b2-icon="layers-3"');
    expect(variantCHtml).not.toContain('data-b2-focus');
    expect(variantCHtml).not.toContain('data-b2-icon');
    expect(selectedHtml).not.toContain('Hooks');
    expect(variantCHtml).toContain('Hooks');
    expect(selectedAssetTypes).not.toContain('Hooks');
    expect(assetTypes).toContain('Hooks');
  });

  it('keeps selected global search and Skill rows free of Hooks and prepare/convert CTAs', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const row = source.slice(
      source.indexOf('export function SelectedAssetRow('),
      source.indexOf('function SelectedAssetDetail('),
    );
    const search = source.slice(
      source.indexOf('function GlobalSearchOverlay('),
      source.indexOf('function AppHeader('),
    );

    expect(b2Assets.some((asset) => asset.type === 'Hooks')).toBe(false);
    expect(row).toContain('查看 Skill');
    expect(row).toContain('type="checkbox"');
    expect(row).not.toContain('准备安装');
    expect(row).not.toContain('准备转换');
    expect(search).toContain('selectedAssetTypes');
    expect(search).not.toContain('assetTypes.map');
  });

  it('keeps all three project/global candidate structures isolated to selected browse UI', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const css = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/b2.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain('InheritanceDemoSwitcher');
    expect(source).toContain('b2-source-section');
    expect(source).toContain('InheritedAssetsAside');
    expect(css).toContain('.variant-selected .b2-inheritance-c-body');
    expect(css).toContain('@media (max-width: 1360px)');
  });

  it('keeps selected focus markers and navigation behavior out of legacy tabs', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const assetTabs = source.slice(
      source.indexOf('function AssetTabs('),
      source.indexOf('export function AssetTypeRail('),
    );
    const selectedDetail = source.slice(
      source.indexOf('function SelectedAssetDetail('),
      source.indexOf('function SelectedAssetEditor('),
    );

    expect(assetTabs).not.toContain('data-b2-focus');
    expect(selectedDetail).toContain("patchState({ selectedPanel: 'list', selectedStep: 'list' })");
  });

  it('keeps all B2 layout CSS namespaced and expresses the three-column and narrow-stack gates', () => {
    const css = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/b2.css', import.meta.url),
      'utf8',
    );

    expect(css).toContain('grid-template-columns: 180px 220px minmax(0, 1fr);');
    expect(css).toContain('margin: 0 18px 18px;');
    expect(css).toContain('height: calc(100% - 84px);');
    expect(css).toMatch(/\.variant-selected \.b2-main-surface \{/);
    expect(css).toMatch(
      /\.mock-frame\.variant-selected\[data-b2-narrow='true'\] \.b2-layout[\s\S]*?display: block;/,
    );
    expect(css).toMatch(
      /\.mock-frame\.variant-selected\[data-b2-narrow='true'\] \.b2-stack-back[\s\S]*?display: inline-flex;/,
    );
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const query = source.match(/const B2_NARROW_MEDIA_QUERY = '\(max-width: (\d+)px\)'/);
    expect(query).not.toBeNull();
    const maxNarrowWidth = Number(query![1]);

    expect(840 <= maxNarrowWidth).toBe(true);
    expect(760 <= maxNarrowWidth).toBe(true);
    expect(1280 <= maxNarrowWidth).toBe(false);
    expect(css).toContain(`@media (max-width: ${maxNarrowWidth}px)`);
    expect(css).toContain(`@media (min-width: ${maxNarrowWidth + 1}px) and (max-width: 1360px)`);
    expect(css).toMatch(
      /\.variant-selected \.flow-footer \.primary-button \{[\s\S]*?border-color: var\(--b2-blue\);[\s\S]*?color: #fff;[\s\S]*?background: var\(--b2-blue\);/,
    );
    expect(css).toMatch(
      /\.variant-selected \.b2-filter-popover legend,[\s\S]*?\.variant-selected \.b2-filter-popover label \{[\s\S]*?font-size: 12px;/,
    );
    expect(css).toMatch(
      /\.mock-root:has\(\.variant-selected\) \.global-search-results section > button strong,[\s\S]*?button small \{[\s\S]*?font-size: 12px;/,
    );
    expect(css).toMatch(
      /\.variant-selected \.selected-header-status \.status-dot \{[\s\S]*?font-size: 12px;/,
    );
    expect(css).toMatch(/\.variant-selected \.outcome-surface \{[\s\S]*?align-content: start;/);
  });

  it('keeps structured detail free of native filenames until edit', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const detail = source.slice(
      source.indexOf('function SelectedAssetDetail('),
      source.indexOf('function SelectedAssetEditor('),
    );

    expect(detail).not.toContain('原生文件');
    expect(detail).not.toContain('SKILL.md');
    expect(detail).not.toContain('references/usage.md');
    expect(detail).not.toContain('sourcePath');
  });

  it('keeps the selected editor mounted behind the dirty guard and defers context mutation', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const selectedLayout = source.slice(
      source.indexOf('function SelectedLayout('),
      source.indexOf('export function ConfigContextSidebar('),
    );
    const requestTransition = source.slice(
      source.indexOf('const requestTransition ='),
      source.indexOf('const startCreate ='),
    );

    expect(selectedLayout).toContain(
      'const inlineInstruction = selectedInlineInstructionEdit(state, asset);',
    );
    expect(selectedLayout).toContain(
      "state.stage === 'editing' || (state.stage === 'discard' && !inlineInstruction)",
    );
    expect(selectedLayout).toContain("state.stage === 'discard' && inlineInstruction");
    const dirtyBranch = requestTransition.slice(
      requestTransition.indexOf('if (state.dirty)'),
      requestTransition.indexOf('return;', requestTransition.indexOf('if (state.dirty)')) +
        'return;'.length,
    );

    expect(selectedLayout).toContain('<SelectedAssetEditor {...props} />');
    expect(dirtyBranch).toContain('setPendingTransition(transition)');
    expect(dirtyBranch).not.toContain('...transition');
    expect(requestTransition).toContain('setState((previous) => ({ ...previous, ...transition }))');
    expect(source).toContain("inlineInstruction ? '.b2-instruction-editor textarea'");
    expect(source).toContain("document.querySelector<HTMLElement>('.editor-shell textarea')");
  });

  it('opens a direct narrow selected edit URL on the editor surface', () => {
    const stateSource = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/state.ts', import.meta.url),
      'utf8',
    );

    expect(stateSource).toContain("stageFor(journey, scenario) === 'browse'");
    expect(stateSource).toContain("? 'type'");
    expect(stateSource).toContain(": 'detail'");
  });

  it('moves focus from confirm to a stable outcome heading', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('document.querySelector<HTMLElement>(\'[data-b2-focus="outcome"]\')');
    expect(source).toContain('<h1 data-b2-focus="outcome" tabIndex={-1}>');
  });

  it('persists confirmed selected drafts in an isolated memory snapshot', () => {
    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    const file = asset.files[0];
    const originalContent = file.content;
    const persistedContent = `${originalContent}\nconfirmed draft`;
    const nextSnapshots = applySelectedSnapshotForState(
      b2Assets,
      {
        ...selectedState,
        journey: 'edit',
        stage: 'confirm',
        scenario: 'ready',
        assetId: asset.id,
        fileName: file.name,
        drafts: { [file.name]: persistedContent },
      },
      asset,
    );
    expect(nextSnapshots).not.toBe(b2Assets);
    expect(nextSnapshots.find((candidate) => candidate.id === asset.id)?.files[0].content).toBe(
      persistedContent,
    );
    expect(asset.files[0].content).toBe(originalContent);

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const apply = source.slice(
      source.indexOf('const applyPreparedOperation ='),
      source.indexOf('const sharedProps:'),
    );

    expect(apply).toContain('applySelectedSnapshotForState(previous, state, asset)');
    expect(source).toContain('export function applySelectedSnapshotForState(');
    expect(source).toContain('applyB2DraftsToAssets(snapshots, asset.id, state.drafts)');
    expect(source).toContain('确认内容已写入 Mock 内存资产快照');
  });

  it('focuses the real changed file and exposes changed-file review navigation', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const baseAsset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    const asset = {
      ...baseAsset,
      files: [
        ...baseAsset.files,
        {
          ...baseAsset.files[0],
          name: 'references/usage.md',
          content: '# Usage\n',
        },
      ],
    };
    const changedFile = asset.files[0];
    const unchangedFile = asset.files[1];
    const transition = reviewTransitionForState(
      {
        ...selectedState,
        assetId: asset.id,
        fileName: unchangedFile.name,
        drafts: { [changedFile.name]: `${changedFile.content}\nchanged` },
      },
      asset,
    );
    const review = source.slice(
      source.indexOf('function ReviewSurface('),
      source.indexOf('function OutcomeSurface('),
    );

    expect(transition.fileName).toBe(changedFile.name);
    expect(review).toContain('className="b2-review-files"');
    expect(review).toContain('changedFileNames.includes(file.name)');
  });

  it('keeps convert conflict and failure recovery on mapping without source drafts', () => {
    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    for (const scenario of ['conflict', 'failed'] as const) {
      const transition = applyResultTransitionForState(
        {
          ...selectedState,
          journey: 'convert',
          stage: 'confirm',
          scenario,
          dirty: false,
          drafts: {},
        },
        asset,
      );
      expect(transition).toMatchObject({
        stage: 'result',
        dirty: false,
        drafts: {},
      });
    }

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const outcome = source.slice(
      source.indexOf('function SelectedOutcomeSurface('),
      source.indexOf('function ManagementSurface('),
    );
    expect(outcome).toContain(
      "stage: isConvert ? 'mapping' : isInlineInstruction ? 'browse' : 'editing'",
    );
    expect(outcome).toContain('dirty: isConvert ? false : true');
    expect(outcome).toContain('drafts: isConvert ? {} : state.drafts');
  });

  it('focuses a stable selected detail anchor after a global-search destination commits', () => {
    const target = b2Assets.find((asset) => asset.name === 'testing-strategy')!;
    const committed: MockUiState = {
      ...selectedState,
      journey: 'browse',
      stage: 'browse',
      selectedPanel: 'detail',
      selectedStep: 'detail',
      assetId: target.id,
      globalSearchOpen: false,
      dirty: false,
      drafts: {},
    };

    expect(shouldFocusGlobalSearchDestination(committed, target.id)).toBe(true);
    expect(
      shouldFocusGlobalSearchDestination({ ...committed, globalSearchOpen: true }, target.id),
    ).toBe(false);
    expect(shouldFocusGlobalSearchDestination({ ...committed, stage: 'editing' }, target.id)).toBe(
      false,
    );
    expect(shouldFocusGlobalSearchDestination(committed, selectedState.assetId)).toBe(false);

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('data-b2-focus="global-search-detail"');
    expect(source).toContain('globalSearchDestinationFocusRef.current = targetAsset.id');
  });

  it('closes global search before dirty guard and restores the selected editor focus path', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const requestTransition = source.slice(
      source.indexOf('const requestTransition ='),
      source.indexOf('const startCreate ='),
    );

    expect(requestTransition).toContain('globalSearchRestoreRef.current ?? editorTarget');
    expect(requestTransition).toContain('...dirtyGuardBehaviorForState(previous).patch');
    expect(dirtyGuardBehaviorForState(selectedState)).toEqual({
      focus: 'selected-editor',
      patch: { stage: 'discard', globalSearchOpen: false, globalSearch: '' },
    });
    expect(source).toContain("if (state.stage === 'confirm' || state.stage === 'discard') return;");
    expect(source).toContain("inlineInstruction ? '.b2-instruction-editor textarea'");
    expect(source).toContain('continueEditingTransitionForState(state)');
    expect(source).toContain("stage: 'browse', selectedPanel: 'detail', selectedStep: 'detail'");
    expect(source).toContain('const selectedFilterTriggerRef = useRef<HTMLButtonElement>(null);');
    expect(source).toContain('} else if (previous.filterOpen) {');
    expect(source).toContain('selectedFilterTriggerRef.current?.focus();');
    expect(source).toContain('ref={selectedFilterTriggerRef}');
    expect(continueEditingTransitionForState(selectedState)).toEqual({
      stage: 'editing',
    });
  });

  it('keeps selected maintenance inside management and exposes stable rollback outcomes', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const management = source.slice(
      source.indexOf('function ManagementSurface('),
      source.indexOf('function RecoverySurface('),
    );

    expect(management).toContain("['recovery', '导出与维护']");
    expect(management).toContain('ROLLBACK_SUCCEEDED');
    expect(management).toContain('ROLLBACK_CONFLICT');
    expect(management).toContain('ROLLBACK_FAILED');
    expect(management).toContain('不形成独立 Recovery 页面');
    expect(management).toContain('<B2Icon name="download" />');
    expect(management).toContain('<B2Icon name="trash-2" />');
    expect(management).toContain('<B2Icon name="rotate-ccw" />');
    expect(management).toContain(
      'const selectedWritesBlocked = isSelected && writeBlockReason !== null',
    );
    expect(management).toContain('actionDisabled={selectedWritesBlocked}');
    expect(management).toContain('disabled={selectedWritesBlocked}');
    expect(management).toContain(
      "!selectedWritesBlocked && state.recoveryAction === 'delete-confirm'",
    );
    expect(management).toContain(
      "!selectedWritesBlocked && state.recoveryAction === 'delete-result'",
    );
  });

  it('removes the selected recovery entry while retaining recovery only as legacy evidence', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const stateSource = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/state.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("state.variant === 'selected'");
    expect(source).toContain("journeys.filter((journey) => journey !== 'recover')");
    expect(stateSource).toContain('selectedWriteJourneyBlocked(');

    const selected = {
      ...selectedState,
      journey: 'browse' as const,
      dirty: false,
    };
    expect(resetForJourney(selected, 'recover').journey).toBe('browse');
    expect(resetForJourney({ ...selected, scenario: 'readonly' }, 'manage').journey).toBe('browse');

    const incompatible = b2Assets.find((candidate) => candidate.name === 'adapter-audit')!;
    expect(
      resetForJourney(
        {
          ...selected,
          assetId: incompatible.id,
          fileName: incompatible.files[0].name,
        },
        'manage',
      ).journey,
    ).toBe('browse');
  });

  it('preserves legacy A/B/C review, apply, confirmation, and outcome behavior', () => {
    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;

    for (const variant of ['A', 'B', 'C'] as const) {
      const legacyState = {
        ...selectedState,
        variant,
        journey: 'edit' as const,
        stage: 'editing' as const,
        scenario: 'ready' as const,
      };

      expect(reviewTransitionForState(legacyState, asset)).toEqual({
        stage: 'review',
        dirty: true,
        notice: null,
      });
      expect(applyResultTransitionForState(legacyState, asset)).toEqual({
        stage: 'result',
        dirty: false,
        drafts: {},
        notice: '已完成模拟应用，并固定恢复点 RP-20260729-1042。',
      });
      expect(
        applyResultTransitionForState(
          { ...legacyState, scenario: 'conflict', dirty: false, drafts: {} },
          asset,
        ),
      ).toEqual({
        stage: 'result',
        dirty: true,
        notice: 'apply 重新校验发现磁盘变化；返回 REPREPARE_REQUIRED，未写入文件。',
      });
      expect(
        applyResultTransitionForState(
          { ...legacyState, scenario: 'failed', dirty: false, drafts: {} },
          asset,
        ),
      ).toEqual({
        stage: 'result',
        dirty: true,
        notice: '事务在提交前失败；原文件与草稿均已保留。',
      });
      expect(confirmationDetailsForState(legacyState, asset, 'Claude Code')).toEqual([
        `${asset.name} · ${asset.agent}`,
        `修改 ${asset.files.length} 个原生文件`,
        '应用前固定恢复点；不会操作 Git',
      ]);

      const html = renderToStaticMarkup(
        createElement(OutcomeSurface, {
          state: { ...legacyState, stage: 'result' },
          asset,
          convertTarget: 'Claude Code',
          patchState: () => undefined,
        }),
      );
      expect(html).not.toContain('data-b2-focus="outcome"');
      expect(html).toContain('前端缓存不会作为结果事实来源');
      expect(html).toContain(`${asset.files.length} 个原生文件`);
    }
  });

  it('keeps selected-only outcome focus and changed-file facts out of legacy markup', () => {
    const asset = b2Assets.find((candidate) => candidate.type === '长期指令')!;
    const html = renderToStaticMarkup(
      createElement(OutcomeSurface, {
        state: {
          ...selectedState,
          stage: 'result',
          scenario: 'ready',
          appliedFileCount: 1,
        },
        asset,
        convertTarget: 'Claude Code',
        patchState: () => undefined,
      }),
    );

    expect(html).toContain('data-b2-focus="outcome"');
    expect(html).toContain('1 个原生文件');
    expect(html).toContain('Mock 内存资产快照');
  });

  it('offers a read-only source viewer without enabling edits or review', () => {
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const detail = source.slice(
      source.indexOf('function SelectedAssetDetail('),
      source.indexOf('function SelectedAssetEditor('),
    );
    const editor = source.slice(
      source.indexOf('function SelectedAssetEditor('),
      source.indexOf('function GlobalSearchOverlay('),
    );

    expect(detail).toContain("{readOnly ? '查看源码' : '编辑源码'}");
    expect(detail).not.toContain('disabled={readOnly}');
    expect(editor).toContain('readOnly={readOnly}');
    expect(editor).toContain("{readOnly ? '只读查看' : '审查更改'}");
    expect(editor).toContain('disabled={readOnly ||');
  });

  it('keeps selected keyboard and dirty-guard behavior out of A/B/C', () => {
    for (const variant of ['A', 'B', 'C'] as const) {
      const legacy: MockUiState = {
        ...selectedState,
        variant,
        stage: 'confirm',
        viewport: 'narrow',
      };
      expect(globalSearchShortcutTransitionForState(legacy)).toEqual({
        panelOverlay: 'library',
      });
      expect(continueEditingTransitionForState(legacy)).toEqual({
        journey: 'edit',
        stage: 'editing',
      });
      expect(
        escapeTransitionForState({
          ...legacy,
          globalSearchOpen: true,
          stage: 'discard',
        }),
      ).toEqual({
        globalSearchOpen: false,
        globalSearch: '',
      });
      expect(
        escapeTransitionForState({
          ...legacy,
          globalSearchOpen: false,
          stage: 'discard',
        }),
      ).toEqual({
        stage: 'editing',
      });
      expect(dirtyGuardBehaviorForState(legacy)).toEqual({
        focus: 'active-element',
        patch: { stage: 'discard' },
      });
      expect(shouldClearPendingTransitionOnEscape(legacy)).toBe(false);
    }

    expect(
      globalSearchShortcutTransitionForState({
        ...selectedState,
        variant: 'selected',
        stage: 'confirm',
      }),
    ).toBeNull();
    expect(continueEditingTransitionForState(selectedState)).toEqual({
      stage: 'editing',
    });
    expect(
      escapeTransitionForState({
        ...selectedState,
        globalSearchOpen: false,
        stage: 'discard',
      }),
    ).toEqual({
      stage: 'editing',
    });
    expect(dirtyGuardBehaviorForState(selectedState)).toEqual({
      focus: 'selected-editor',
      patch: { stage: 'discard', globalSearchOpen: false, globalSearch: '' },
    });
    expect(
      shouldClearPendingTransitionOnEscape({
        ...selectedState,
        stage: 'discard',
      }),
    ).toBe(true);
  });

  it('blocks selected readonly and incompatible write transitions without blocking source viewing', () => {
    const asset = b2Assets.find((candidate) => candidate.name === 'testing-strategy')!;
    const readonlyState = {
      ...selectedState,
      scenario: 'readonly' as const,
      dirty: false,
    };
    expect(selectedWriteBlockReason(readonlyState, asset)).toBe(
      '当前 Agent 版本仅支持只读；不能创建、安装、转换或应用。 当前 Skill 仍可结构化查看，但不提供源码、编辑或转换。',
    );
    expect(selectedWriteJourneyBlocked('selected', 'readonly', 'manage', asset)).toBe(true);
    expect(reviewTransitionForState(readonlyState, asset)).not.toHaveProperty('stage', 'review');
    expect(applyResultTransitionForState(readonlyState, asset)).toMatchObject({
      stage: 'review',
      appliedFileCount: 0,
      dirty: false,
    });

    const incompatibleAsset = {
      ...asset,
      status: '不兼容' as const,
      decisionStatus: '不兼容' as const,
      blockReason: '当前测试资产不兼容。',
    };
    const incompatibleState = {
      ...selectedState,
      scenario: 'ready' as const,
      dirty: false,
    };
    expect(b2AssetDecisionStatus(incompatibleAsset)).toBe('不兼容');
    expect(b2AssetBlockReason(incompatibleAsset)).toBe('当前测试资产不兼容。');
    expect(selectedWriteBlockReason(incompatibleState, incompatibleAsset)).toBe(
      '当前测试资产不兼容。 当前 Skill 仍可结构化查看，但不提供源码、编辑或转换。',
    );
    expect(selectedWriteJourneyBlocked('selected', 'ready', 'manage', incompatibleAsset)).toBe(
      true,
    );
    expect(reviewTransitionForState(incompatibleState, incompatibleAsset)).not.toHaveProperty(
      'stage',
      'review',
    );
    expect(applyResultTransitionForState(incompatibleState, incompatibleAsset)).toMatchObject({
      stage: 'review',
      appliedFileCount: 0,
      dirty: false,
    });
  });

  it('fails closed for selected Skill write routes, review, and apply', () => {
    const skill = b2Assets.find((candidate) => candidate.name === 'testing-strategy')!;
    const skillState = {
      ...selectedState,
      scenario: 'ready' as const,
      dirty: false,
    };
    const reason = '当前 selected Skill 只支持结构化查看与 Mock 会话内 Agent 启停预览。';

    expect(selectedWriteBlockReason(skillState, skill)).toBe(reason);
    for (const journey of ['edit', 'create', 'convert', 'manage'] as const) {
      expect(selectedWriteJourneyBlocked('selected', 'ready', journey, skill)).toBe(true);
    }
    expect(reviewTransitionForState(skillState, skill)).toEqual({
      dirty: false,
      appliedFileCount: 0,
      notice: reason,
    });
    expect(selectedApplySucceeds(skillState, skill)).toBe(false);
    expect(applyResultTransitionForState(skillState, skill)).toMatchObject({
      stage: 'review',
      dirty: false,
      appliedFileCount: 0,
      notice: reason,
    });
  });

  it('keeps selected long-term instructions editable but outside conversion', () => {
    const instruction = b2Assets.find((candidate) => candidate.name === 'Global AGENTS.md')!;
    const instructionState = {
      ...selectedState,
      assetId: instruction.id,
      assetType: instruction.type,
      fileName: instruction.files[0].name,
      configContext: 'global' as const,
      scenario: 'ready' as const,
      dirty: false,
      drafts: {},
    };

    expect(selectedWriteJourneyBlocked('selected', 'ready', 'convert', instruction)).toBe(true);
    expect(selectedWriteJourneyBlocked('selected', 'ready', 'edit', instruction)).toBe(false);
    expect(resetForJourney(instructionState, 'convert')).toMatchObject({
      journey: 'browse',
      stage: 'browse',
      assetId: instruction.id,
    });

    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const row = source.slice(
      source.indexOf('export function SelectedAssetRow('),
      source.indexOf('function SelectedAssetDetail('),
    );
    const detail = source.slice(
      source.indexOf('function SelectedAssetDetail('),
      source.indexOf('function SelectedAssetEditor('),
    );

    expect(row).toContain('<AgentBrandMark agent={target.agent} />');
    expect(detail).toContain("const isInstruction = asset.type === '长期指令';");
    expect(detail).toContain('className="b2-instruction-editor"');
    expect(detail).toContain('aria-label={`${instructionFile.name} Markdown 草稿`}');
    expect(detail).toContain('disabled={readOnly || !state.dirty}');
  });

  it('disables every forced selected Management write action by accessible name', () => {
    const readonlyAsset = b2Assets.find((candidate) => candidate.name === 'testing-strategy')!;
    const incompatibleAsset = b2Assets.find((candidate) => candidate.name === 'adapter-audit')!;

    const renderManagement = (
      asset: (typeof b2Assets)[number],
      overrides: Partial<MockUiState>,
    ): string =>
      renderToStaticMarkup(
        createElement(ManagementSurface, {
          state: {
            ...selectedState,
            journey: 'manage',
            stage: 'manage',
            scenario: 'ready',
            managementTab: 'projects',
            recoveryAction: 'idle',
            dirty: false,
            ...overrides,
          },
          asset,
          patchState: () => undefined,
        }),
      );

    const buttonAttributes = (markup: string, accessibleName: string): string[] => {
      const escapedName = accessibleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return Array.from(
        markup.matchAll(new RegExp(`<button([^>]*)>${escapedName}</button>`, 'g')),
        (match) => match[1],
      );
    };

    const expectDisabled = (markup: string, accessibleName: string): void => {
      const matches = buttonAttributes(markup, accessibleName);
      expect(matches, `${accessibleName} should render`).not.toHaveLength(0);
      expect(matches.every((attributes) => attributes.includes('disabled=""'))).toBe(true);
    };

    const expectEnabled = (markup: string, accessibleName: string): void => {
      const matches = buttonAttributes(markup, accessibleName);
      expect(matches, `${accessibleName} should render`).not.toHaveLength(0);
      expect(matches.every((attributes) => !attributes.includes('disabled=""'))).toBe(true);
    };

    const readonlyProjects = renderManagement(readonlyAsset, {
      scenario: 'readonly',
    });
    expect(readonlyProjects).toContain('管理操作已禁用');
    expectDisabled(readonlyProjects, '停止管理');
    expectDisabled(readonlyProjects, '纳入管理');
    expectEnabled(readonlyProjects, '查看索引');

    const incompatibleStaleProjects = renderManagement(incompatibleAsset, {
      scenario: 'stale',
    });
    expectDisabled(incompatibleStaleProjects, '重建索引');
    expectDisabled(incompatibleStaleProjects, '纳入管理');
    expectEnabled(incompatibleStaleProjects, '查看索引');

    const incompatibleAgents = renderManagement(incompatibleAsset, {
      managementTab: 'agents',
    });
    expectDisabled(incompatibleAgents, '更新适配器');
    expectEnabled(incompatibleAgents, '检查更新');
    expectEnabled(incompatibleAgents, '查看兼容性');

    const incompatibleFailedAgents = renderManagement(incompatibleAsset, {
      scenario: 'failed',
      managementTab: 'agents',
    });
    expectDisabled(incompatibleFailedAgents, '重试更新');

    const incompatibleRecovery = renderManagement(incompatibleAsset, {
      managementTab: 'recovery',
    });
    expectDisabled(incompatibleRecovery, '审查删除');
    expectDisabled(incompatibleRecovery, '模拟回滚');

    const forcedDeleteConfirm = renderManagement(incompatibleAsset, {
      managementTab: 'recovery',
      recoveryAction: 'delete-confirm',
    });
    expect(forcedDeleteConfirm).not.toContain('确认模拟删除');

    for (const scenario of ['ready', 'conflict', 'failed'] as const) {
      const forcedResult = renderManagement(incompatibleAsset, {
        scenario,
        managementTab: 'recovery',
        recoveryAction: 'delete-result',
      });
      expect(forcedResult).not.toContain('确认模拟删除');
      expect(forcedResult).not.toContain('ROLLBACK_SUCCEEDED');
      expect(forcedResult).not.toContain('ROLLBACK_CONFLICT');
      expect(forcedResult).not.toContain('ROLLBACK_FAILED');
    }
  });

  it('resets narrow detail actions into normal flow and keeps the 1361 seam measurable', () => {
    const css = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/b2.css', import.meta.url),
      'utf8',
    );

    expect(css).toMatch(/data-b2-narrow='true'\] \.selected-detail-header,[\s\S]*?display: flex;/);
    expect(css).toMatch(
      new RegExp(
        "data-b2-narrow='true'\\] \\.selected-detail-header \\.asset-actions," +
          "[\\s\\S]*?data-b2-narrow='true'\\] \\.selected-editor-header \\.asset-actions \\{" +
          '[\\s\\S]*?position: relative;[\\s\\S]*?inset: auto;' +
          '[\\s\\S]*?z-index: 2;[\\s\\S]*?pointer-events: auto;',
      ),
    );
    expect(css).toMatch(
      /data-b2-narrow='true'\] \.selected-detail-header,[\s\S]*?flex: 0 0 auto;[\s\S]*?overflow: visible;/,
    );
    expect(css).toContain('@media (min-width: 1200px) and (max-width: 1360px)');
    expect(css).toContain(
      'grid-template-columns: minmax(240px, 1.1fr) minmax(200px, 0.9fr) 204px;',
    );
    expect(css).toContain('repeat(4, 48px);');
    expect(css).not.toContain('repeat(2, minmax(72px, 1fr))');
  });

  it('renders the all view with global-first sections, aggregate summary, and 全部 breadcrumb', () => {
    expect(b2CatalogSummary('all', 14)).toBe('14 项全部来源资产');

    const sections = allViewSourceSections('Skills');
    const markup = renderAllViewCatalog({
      assetType: 'Skills',
      assetId: b2DefaultSkillId,
      fileName: 'SKILL.md',
      sections,
    });
    const text = markup.replace(/<!-- -->/g, '');

    // 面包屑与摘要：全部 › Skills，N 项全部来源资产
    expect(markup).toContain(
      '<div class="asset-breadcrumb" aria-label="当前上下文"><span>全部</span>',
    );
    expect(markup).toContain('<p>14 项全部来源资产</p>');
    expect(text).toContain('共 14 项');

    // 分段顺序与计数：全局适用 → agent-config-manager → mobile-tooling → ReinventedWheelAgent
    const sectionLabels = [
      'aria-label="全局适用资产"',
      'aria-label="agent-config-manager 项目资产"',
      'aria-label="mobile-tooling 项目资产"',
      'aria-label="ReinventedWheelAgent 项目资产"',
    ];
    const positions = sectionLabels.map((label) => markup.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(markup.match(/b2-source-section/g)).toHaveLength(4);
    expect(text).toContain('全局适用 · 2 项');
    expect(text).toContain('agent-config-manager · 2 项');
    expect(text).toContain('mobile-tooling · 2 项');
    expect(text).toContain('ReinventedWheelAgent · 8 项');

    // 各段内容为该来源该类型资产：段序决定行序
    const rowOrder = ['security-review', 'adapter-audit', 'mobile-release', 'api-contract-audit'];
    const rowPositions = rowOrder.map((name) => markup.indexOf(`<strong>${name}</strong>`));
    expect(rowPositions.every((position) => position >= 0)).toBe(true);
    expect(rowPositions).toEqual([...rowPositions].sort((left, right) => left - right));

    // 聚合视图保留共享列网格（含 Agent 固定分列）
    expect(markup).toContain('<div class="b2-table-head">');
    for (const label of ['Claude', 'Codex', 'Gemini', 'OpenCode']) {
      expect(markup).toContain(`class="b2-head-agent" role="img" aria-label="${label}"`);
    }
  });

  it('keeps same-name assets from different sources as independent rows in the all view', () => {
    const globalInstruction = createB2NativeAsset({
      type: '长期指令',
      name: 'AGENTS.md',
      agent: 'Codex',
      scope: '全局',
      project: '用户全局配置',
      mode: '新建',
    });
    const projectInstruction = createB2NativeAsset({
      type: '长期指令',
      name: 'AGENTS.md',
      agent: 'Codex',
      scope: '项目',
      project: 'mobile-tooling',
      mode: '新建',
    });
    expect(globalInstruction.id).not.toBe(projectInstruction.id);

    const markup = renderAllViewCatalog({
      assetType: '长期指令',
      assetId: projectInstruction.id,
      fileName: projectInstruction.files[0].name,
      sections: [
        { key: 'global', label: '全局适用', assets: [globalInstruction] },
        { key: 'project:mobile-tooling', label: 'mobile-tooling', assets: [projectInstruction] },
      ],
    });

    // 同名资产各自成行：两个独立按钮、两个独立名称块
    expect(markup.match(/aria-label="查看资产：AGENTS\.md"/g)).toHaveLength(2);
    expect(markup.match(/<strong>AGENTS\.md<\/strong>/g)).toHaveLength(2);
    expect(markup).toContain('b2-source-badge is-global');
    expect(markup).toContain('b2-source-badge is-project');

    // 选择其中一个只影响该资产：选中态落在项目行，全局行不受影响
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
    const selectedRowIndex = markup.indexOf('b2-asset-row is-selected');
    expect(selectedRowIndex).toBeGreaterThan(-1);
    expect(markup.lastIndexOf('b2-source-badge is-global', selectedRowIndex)).toBeGreaterThan(-1);
    expect(markup.indexOf('b2-source-badge is-project')).toBeGreaterThan(selectedRowIndex);
  });

  it('maps the narrow stack as type → context → list → detail with matching return targets', () => {
    // 进入窄屏时收敛到稳定栈位：browse+list 一律回落到类型栏
    for (const selectedStep of ['type', 'context', 'list'] as const) {
      expect(b2NarrowStepForState({ stage: 'browse', selectedPanel: 'list', selectedStep })).toBe(
        'type',
      );
    }
    expect(
      b2NarrowStepForState({ stage: 'browse', selectedPanel: 'detail', selectedStep: 'detail' }),
    ).toBe('detail');
    expect(
      b2NarrowStepForState({ stage: 'editing', selectedPanel: 'detail', selectedStep: 'detail' }),
    ).toBe('detail');

    // 前链路：选类型 → 作用域栏；选作用域 → 列表；选资产 → 详情
    expect(assetTypeTransition(selectedState, b2Assets, '长期指令')).toMatchObject({
      selectedPanel: 'list',
      selectedStep: 'context',
    });
    expect(configContextTransition(selectedState, b2Assets, 'all')).toMatchObject({
      configContext: 'all',
      selectedPanel: 'list',
      selectedStep: 'list',
    });
    expect(
      assetSelectionTransition(
        { ...selectedState, journey: 'browse', stage: 'browse', dirty: false, drafts: {} },
        b2Assets.find((asset) => asset.id === b2DefaultSkillId)!,
      ),
    ).toMatchObject({ selectedPanel: 'detail', selectedStep: 'detail' });

    // 返回目标：列表 → 作用域；作用域 → 类型；详情 → 列表
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain("onClick={() => patchState({ selectedStep: 'context' })}");
    expect(source).toContain("onBack={() => patchState({ selectedStep: 'type' })}");
    expect(source).toContain("patchState({ selectedPanel: 'list', selectedStep: 'list' })");

    // 作用域栏的返回入口与当前作用域的焦点标记
    const sidebarMarkup = renderToStaticMarkup(
      createElement(ConfigContextSidebar, {
        state: selectedState,
        chooseConfigContext: () => undefined,
        onBack: () => undefined,
      }),
    );
    expect(sidebarMarkup).toContain('rail-context-back');
    expect(sidebarMarkup).toContain('<span>资产类型</span>');
    expect(sidebarMarkup).toContain('aria-current="page"');
    expect(sidebarMarkup.match(/data-b2-focus="context"/g)).toHaveLength(1);
    expect(sidebarMarkup).toMatch(/data-b2-focus="context"[^>]*>[\s\S]*?<span>全部<\/span>/);
  });

  it('keeps master-detail section counts and detail source truthful under the all scope', () => {
    const sections = allViewSourceSections('长期指令');
    expect(sections.map((section) => [section.label, section.assets.length])).toEqual([
      ['全局适用', 1],
      ['agent-config-manager', 1],
      ['mobile-tooling', 1],
      ['ReinventedWheelAgent', 1],
    ]);

    const selected = sections
      .flatMap((section) => section.assets)
      .find((asset) => asset.project === 'ReinventedWheelAgent')!;
    const markup = renderAllViewCatalog({
      assetType: '长期指令',
      assetId: selected.id,
      fileName: selected.files[0].name,
      sections,
      masterDetail: true,
    });
    const text = markup.replace(/<!-- -->/g, '');

    expect(markup).toContain('is-master-detail');
    expect(markup).not.toContain('b2-table-head');
    expect(text).toContain('全局适用 · 1 项');
    expect(text).toContain('agent-config-manager · 1 项');
    expect(text).toContain('mobile-tooling · 1 项');
    expect(text).toContain('ReinventedWheelAgent · 1 项');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('data-b2-focus="list"');

    // 详情来源字段由资产自身上下文决定：面包屑用作用域标签，来源用资产自身项目名
    const source = readFileSync(
      new URL('../../src/prototypes/full-ui-mock/FullUiMock.tsx', import.meta.url),
      'utf8',
    );
    const detail = source.slice(
      source.indexOf('function SelectedAssetDetail('),
      source.indexOf('function SelectedAssetEditor('),
    );
    expect(detail).toContain('<dt>来源</dt>');
    expect(detail).toContain("{asset.scope === '全局' ? '全局配置' : asset.project}");
    expect(detail.match(/contextLabel\(state\.configContext\)/g)).toHaveLength(1);
  });
});
