import {
  assetTypes,
  journeys,
  scenarios,
  variants,
  type MockJourney,
  type MockScenario,
  type MockUiState,
  type MockVariant,
  type AssetType,
  type ConfigContext,
  type InheritanceLayout,
  type MockAsset,
  type Stage,
} from './types';
import { getAsset } from './data';
import { b2AssetDecisionStatus, b2DefaultContext, b2DefaultSkillId, getB2Asset } from './b2-data';

function isOneOf<T extends readonly string[]>(value: string | null, values: T): value is T[number] {
  return value !== null && values.includes(value);
}

export function selectedWriteJourneyBlocked(
  variant: MockVariant,
  scenario: MockScenario,
  journey: MockJourney,
  asset: MockAsset,
): boolean {
  if (variant !== 'selected') return false;
  if (
    asset.type === 'Skills' &&
    (journey === 'edit' || journey === 'create' || journey === 'convert' || journey === 'manage')
  ) {
    return true;
  }
  if (asset.type === '长期指令' && journey === 'convert') return true;
  if (journey !== 'create' && journey !== 'convert' && journey !== 'manage') return false;
  const decisionStatus = b2AssetDecisionStatus(asset);
  return scenario === 'readonly' || decisionStatus === '只读' || decisionStatus === '不兼容';
}

export function stageFor(journey: MockJourney, scenario: MockScenario): Stage {
  if (journey === 'browse') return 'browse';
  // edit 旅程总是从编辑开始；conflict 场景在“应用”时才进入冲突报告
  if (journey === 'edit') return 'editing';
  if (journey === 'create') return 'target';
  // convert 的 blocked 场景直接停在映射报告（阻断）
  if (journey === 'convert') return scenario === 'blocked' ? 'mapping' : 'target';
  if (journey === 'manage') return 'manage';
  return 'recover';
}

export function projectNamesFromAssets(assets: readonly MockAsset[]): string[] {
  return Array.from(
    new Set(assets.filter((asset) => asset.scope === '项目').map((asset) => asset.project)),
  ).sort();
}

export function configContextForAsset(asset: MockAsset): ConfigContext {
  return asset.scope === '全局' ? 'global' : `project:${asset.project}`;
}

export function assetsForConfigContext(
  assets: readonly MockAsset[],
  context: ConfigContext,
  assetType: AssetType,
): MockAsset[] {
  if (context === 'all') {
    return assets.filter((asset) => asset.type === assetType);
  }
  if (context === 'global') {
    return assets.filter((asset) => asset.type === assetType && asset.scope === '全局');
  }
  if (context.startsWith('project:')) {
    const project = context.slice('project:'.length);
    return assets.filter(
      (asset) =>
        asset.type === assetType &&
        ((asset.scope === '项目' && asset.project === project) || asset.scope === '全局'),
    );
  }
  return [];
}

export function assetSelectionTransition(
  state: MockUiState,
  asset: MockAsset,
): Partial<MockUiState> {
  return {
    assetId: asset.id,
    assetType: asset.type,
    fileName: asset.files[0].name,
    journey: state.skillTarget !== null ? 'browse' : state.journey,
    stage: state.journey === 'edit' ? 'editing' : 'browse',
    skillTarget: null,
    panelOverlay: null,
    globalSearchOpen: false,
    globalSearch: '',
    configContext:
      state.variant === 'selected' &&
      (state.configContext === 'all' ||
        (state.configContext.startsWith('project:') && asset.scope === '全局'))
        ? state.configContext
        : configContextForAsset(asset),
    selectedPanel: state.variant === 'selected' ? 'detail' : state.selectedPanel,
    selectedStep: state.variant === 'selected' ? 'detail' : state.selectedStep,
    ...(state.assetId === asset.id ? {} : { drafts: {} }),
    appliedFileCount: null,
    notice: null,
  };
}

export function globalAssetSelectionTransition(
  state: MockUiState,
  asset: MockAsset,
): Partial<MockUiState> {
  return {
    ...assetSelectionTransition(state, asset),
    journey: 'browse',
    stage: 'browse',
    selectedPanel: 'detail',
    selectedStep: 'detail',
    skillTarget: null,
    drafts: {},
    // 全局搜索目的地始终提交资产自身所在的具体作用域，即使当前处于“全部”聚合视图。
    configContext: configContextForAsset(asset),
  };
}

export function assetTypeTransition(
  state: MockUiState,
  assets: readonly MockAsset[],
  assetType: AssetType,
): Partial<MockUiState> | null {
  const asset =
    state.variant === 'selected'
      ? assetsForConfigContext(assets, state.configContext, assetType)[0]
      : assets.find((candidate) => candidate.type === assetType);
  if (asset === undefined) return null;
  return {
    ...assetSelectionTransition(state, asset),
    ...(state.variant === 'selected'
      ? {
          journey: 'browse' as const,
          stage: 'browse' as const,
          selectedPanel: 'list' as const,
          selectedStep: 'context' as const,
        }
      : {}),
  };
}

export function configContextTransition(
  state: MockUiState,
  assets: readonly MockAsset[],
  configContext: ConfigContext,
): Partial<MockUiState> {
  const asset = assetsForConfigContext(assets, configContext, state.assetType)[0];
  return {
    configContext,
    assetType: state.assetType,
    selectedPanel: 'list',
    selectedStep: 'list',
    journey: 'browse',
    stage: 'browse',
    globalSearchOpen: false,
    globalSearch: '',
    panelOverlay: null,
    skillTarget: null,
    appliedFileCount: null,
    notice: null,
    ...(asset === undefined
      ? {}
      : {
          assetId: asset.id,
          fileName: asset.files[0].name,
          ...(state.assetId === asset.id ? {} : { drafts: {} }),
        }),
  };
}

export function applyDiscardedTransition(
  state: MockUiState,
  transition: Partial<MockUiState>,
): MockUiState {
  return {
    ...state,
    ...transition,
    dirty: false,
    drafts: {},
  };
}

export function initialMockState(): MockUiState {
  const query = new URLSearchParams(window.location.search);
  const queryVariant = query.get('variant');
  const queryJourney = query.get('journey');
  const queryScenario = query.get('scenario');
  const queryInheritanceLayout = query.get('inherit');
  const variant: MockVariant = isOneOf(queryVariant, variants) ? queryVariant : 'selected';
  const requestedJourney: MockJourney = isOneOf(queryJourney, journeys) ? queryJourney : 'browse';
  const scenario: MockScenario = isOneOf(queryScenario, scenarios) ? queryScenario : 'ready';
  const inheritanceLayout: InheritanceLayout =
    queryInheritanceLayout === 'B' || queryInheritanceLayout === 'C' ? queryInheritanceLayout : 'A';
  const asset = variant === 'selected' ? getB2Asset(b2DefaultSkillId) : getAsset('commit-guide');
  const selectedBlockedWriteJourney = selectedWriteJourneyBlocked(
    variant,
    scenario,
    requestedJourney,
    asset,
  );
  // selected 不提供恢复表面；只读或不兼容资产的直链不会进入写旅程。
  const journey: MockJourney =
    variant === 'selected' && (requestedJourney === 'recover' || selectedBlockedWriteJourney)
      ? 'browse'
      : requestedJourney;

  return {
    variant,
    inheritanceLayout,
    journey,
    scenario,
    stage: stageFor(journey, scenario),
    assetType: asset.type,
    assetId: asset.id,
    fileName: asset.files[0].name,
    view: 'source',
    search: '',
    searchRange: 'current',
    globalSearch: '',
    globalSearchOpen: false,
    agentFilter: '全部 Agent',
    catalogState: 'normal',
    panelOverlay: null,
    scopeFilter: '全部',
    filters: { status: [], agent: [] },
    filterOpen: false,
    dirty: scenario === 'dirty',
    drafts:
      scenario === 'dirty'
        ? {
            [asset.files[0].name]: `${asset.files[0].content}\n\n<!-- 未应用的合成修改 -->`,
          }
        : {},
    focused: false,
    inspectorOpen: null,
    viewport: 'wide',
    libraryWidth: 294,
    inspectorWidth: 244,
    managementTab: 'projects',
    createMode: '新建',
    createName: 'new-skill',
    importProject: variant === 'selected' ? 'ReinventedWheelAgent' : 'acme/desktop',
    targetAssetType: asset.type,
    targetAgent: 'Codex',
    targetScope: '项目',
    recoveryAction: 'idle',
    skillTarget: null,
    selectedPanel: 'list',
    selectedStep:
      variant === 'selected' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 800px)').matches
        ? stageFor(journey, scenario) === 'browse'
          ? 'type'
          : 'detail'
        : 'list',
    configContext: variant === 'selected' ? b2DefaultContext : configContextForAsset(asset),
    appliedFileCount: null,
    notice: null,
  };
}

export function resetForJourney(
  previous: MockUiState,
  journey: MockJourney,
  scenario: MockScenario = previous.scenario,
): MockUiState {
  const asset =
    previous.variant === 'selected' ? getB2Asset(previous.assetId) : getAsset(previous.assetId);
  const selectedBlockedWriteJourney = selectedWriteJourneyBlocked(
    previous.variant,
    scenario,
    journey,
    asset,
  );
  const normalizedJourney: MockJourney =
    previous.variant === 'selected' && (journey === 'recover' || selectedBlockedWriteJourney)
      ? 'browse'
      : journey;
  return {
    ...previous,
    journey: normalizedJourney,
    scenario,
    stage: stageFor(normalizedJourney, scenario),
    dirty: scenario === 'dirty',
    // 草稿生命周期覆盖 browse ↔ edit 闭环；跳到其他旅程时清除
    drafts: normalizedJourney === 'edit' || normalizedJourney === 'browse' ? previous.drafts : {},
    search: '',
    searchRange: 'current',
    globalSearch: '',
    globalSearchOpen: false,
    agentFilter: '全部 Agent',
    catalogState: 'normal',
    panelOverlay: null,
    scopeFilter: '全部',
    filters: { status: [], agent: [] },
    filterOpen: false,
    recoveryAction: 'idle',
    skillTarget: null,
    selectedPanel: 'list',
    ...(normalizedJourney === 'create' && previous.variant === 'selected'
      ? {
          createMode: '新建' as const,
          createName: 'new-skill',
          importProject: 'ReinventedWheelAgent',
          targetAssetType: previous.assetType,
          targetScope: '项目' as const,
        }
      : {}),
    appliedFileCount: null,
    notice: null,
    inspectorOpen: null,
  };
}

/** 重置只重建 URL 指定的内存初始状态，不接触任何真实配置或持久化存储。 */
export function resetMockState(): MockUiState {
  return initialMockState();
}

export function syncMockQuery(
  state: Pick<MockUiState, 'variant' | 'journey' | 'scenario' | 'inheritanceLayout'>,
): void {
  const url = new URL(window.location.href);
  url.searchParams.set('prototype', 'full-ui');
  url.searchParams.set('variant', state.variant);
  url.searchParams.set('journey', state.journey);
  url.searchParams.set('scenario', state.scenario);
  if (state.variant === 'selected') url.searchParams.set('inherit', state.inheritanceLayout);
  else url.searchParams.delete('inherit');
  window.history.replaceState(null, '', url);
}

export { assetTypes, journeys, scenarios, variants };
