import {
  assetTypes,
  journeys,
  scenarios,
  variants,
  type MockJourney,
  type MockScenario,
  type MockUiState,
  type MockVariant,
  type Stage,
} from './types';
import { getAsset } from './data';

function isOneOf<T extends readonly string[]>(value: string | null, values: T): value is T[number] {
  return value !== null && values.includes(value);
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

export function initialMockState(): MockUiState {
  const query = new URLSearchParams(window.location.search);
  const queryVariant = query.get('variant');
  const queryJourney = query.get('journey');
  const queryScenario = query.get('scenario');
  const variant: MockVariant = isOneOf(queryVariant, variants) ? queryVariant : 'selected';
  const journey: MockJourney = isOneOf(queryJourney, journeys) ? queryJourney : 'browse';
  const scenario: MockScenario = isOneOf(queryScenario, scenarios) ? queryScenario : 'ready';
  const asset = getAsset('commit-guide');

  return {
    variant,
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
    targetAssetType: asset.type,
    targetAgent: 'Codex',
    targetScope: '项目',
    recoveryAction: 'idle',
    skillTarget: null,
    selectedPanel: 'list',
    notice: null,
  };
}

export function resetForJourney(
  previous: MockUiState,
  journey: MockJourney,
  scenario: MockScenario = previous.scenario,
): MockUiState {
  return {
    ...previous,
    journey,
    scenario,
    stage: stageFor(journey, scenario),
    dirty: scenario === 'dirty',
    // 草稿生命周期覆盖 browse ↔ edit 闭环；跳到其他旅程时清除
    drafts: journey === 'edit' || journey === 'browse' ? previous.drafts : {},
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
    notice: null,
    inspectorOpen: null,
  };
}

/** 重置只重建 URL 指定的内存初始状态，不接触任何真实配置或持久化存储。 */
export function resetMockState(): MockUiState {
  return initialMockState();
}

export function syncMockQuery(state: Pick<MockUiState, 'variant' | 'journey' | 'scenario'>): void {
  const url = new URL(window.location.href);
  url.searchParams.set('prototype', 'full-ui');
  url.searchParams.set('variant', state.variant);
  url.searchParams.set('journey', state.journey);
  url.searchParams.set('scenario', state.scenario);
  window.history.replaceState(null, '', url);
}

export { assetTypes, journeys, scenarios, variants };
