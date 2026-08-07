import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Edit3,
  FileCode2,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe2,
  Import,
  Info,
  Layers3,
  MoreHorizontal,
  OctagonAlert,
  PanelLeftClose,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Webhook,
  X,
  type LucideIcon,
} from 'lucide-react';
import claudeCodeLogo from './assets/agent-logos/claude-code.svg';
import codexLogo from './assets/agent-logos/codex.svg';
import googleGeminiLogo from './assets/agent-logos/google-gemini.svg';
import openCodeLogo from './assets/agent-logos/opencode.svg';
import {
  b2AssetBlockReason,
  b2AssetDecisionStatus,
  b2Assets,
  b2DefaultContext,
  b2DefaultSkillId,
  b2NativeTargetPath,
  b2ProjectNames,
  createB2NativeAsset,
  type B2MockAsset,
} from './b2-data';
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
  type B2ChangeMode,
  type B2ListControls,
  type B2Page,
  type B2PageSize,
  type B2SortDirection,
} from './b2-model';
import {
  assetTypeHint,
  filterAssets,
  getAsset,
  mockAgents,
  mockAssets,
  mockRecoveryPoints,
  statusFilters,
} from './data';
import {
  assetTypes,
  applyDiscardedTransition,
  assetSelectionTransition,
  assetTypeTransition,
  configContextTransition,
  globalAssetSelectionTransition,
  initialMockState,
  journeys,
  resetForJourney,
  scenarios,
  syncMockQuery,
  variants,
} from './state';
import { selectedAssetTypes } from './types';
import type {
  AssetType,
  CatalogState,
  MockAsset,
  MockJourney,
  MockScenario,
  MockUiState,
  MockVariant,
  CreateMode,
  ConfigContext,
  InheritanceLayout,
  SkillAgentTarget,
  SkillTargetAction,
  Stage,
  ViewPreset,
} from './types';
import './mock.css';
import './b2.css';

const variantNames: Record<MockVariant, string> = {
  A: 'Native Workbench',
  B: 'Unified Command Strip',
  C: 'Asset Type Rail',
  selected: 'Selected · Asset Type Rail',
};

const journeyNames: Record<MockJourney, string> = {
  browse: '浏览与理解',
  edit: '编辑与应用',
  create: '创建与导入',
  convert: '跨 Agent 转换',
  manage: '项目与 Agent 管理',
  recover: '导出、删除与恢复',
};

const scenarioNames: Record<MockScenario, string> = {
  ready: '正常',
  stale: '索引过期',
  readonly: '只读降级',
  dirty: '未保存草稿',
  conflict: '磁盘冲突',
  degraded: '降级转换',
  blocked: '阻断',
  failed: '失败',
};

const stageNames: Record<Stage, string> = {
  browse: '浏览',
  editing: '编辑草稿',
  discard: '放弃确认',
  review: '审查',
  confirm: '聚焦确认',
  result: '结果',
  conflict: '冲突',
  target: '目标设置',
  mapping: '能力映射',
  manage: '管理',
  recover: '恢复',
};

const viewportNames: Record<ViewPreset, string> = {
  wide: '宽',
  medium: '中',
  narrow: '窄',
};

type B2IconName =
  | 'activity'
  | 'alert-octagon'
  | 'alert-triangle'
  | 'arrow-left'
  | 'arrow-up-down'
  | 'bot'
  | 'check-circle-2'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'database'
  | 'download'
  | 'edit-3'
  | 'file-code-2'
  | 'file-text'
  | 'filter'
  | 'folder'
  | 'folder-open'
  | 'folder-plus'
  | 'globe-2'
  | 'import'
  | 'info'
  | 'layers-3'
  | 'more-horizontal'
  | 'panel-left-close'
  | 'plus'
  | 'rotate-ccw'
  | 'search'
  | 'settings-2'
  | 'sparkles'
  | 'trash-2'
  | 'webhook'
  | 'x';

type B2LucideGlyph = LucideIcon;

const b2LucideIcons: Record<B2IconName, B2LucideGlyph> = {
  activity: Activity,
  'alert-octagon': OctagonAlert,
  'alert-triangle': AlertTriangle,
  'arrow-left': ArrowLeft,
  'arrow-up-down': ArrowUpDown,
  bot: Bot,
  'check-circle-2': CheckCircle2,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  database: Database,
  download: Download,
  'edit-3': Edit3,
  'file-code-2': FileCode2,
  'file-text': FileText,
  filter: Filter,
  folder: Folder,
  'folder-open': FolderOpen,
  'folder-plus': FolderPlus,
  'globe-2': Globe2,
  import: Import,
  info: Info,
  'layers-3': Layers3,
  'more-horizontal': MoreHorizontal,
  'panel-left-close': PanelLeftClose,
  plus: Plus,
  'rotate-ccw': RotateCcw,
  search: Search,
  'settings-2': Settings2,
  sparkles: Sparkles,
  'trash-2': Trash2,
  webhook: Webhook,
  x: X,
};

function B2Icon({ name, size = 18 }: { name: B2IconName; size?: number }): JSX.Element {
  const Icon = b2LucideIcons[name];
  return (
    <Icon aria-hidden="true" data-b2-icon={name} focusable="false" size={size} strokeWidth={1.8} />
  );
}

const B2_NARROW_MEDIA_QUERY = '(max-width: 1199px)';

function initialResponsiveMockState(): MockUiState {
  const state = initialMockState();
  if (
    state.variant !== 'selected' ||
    typeof window.matchMedia !== 'function' ||
    !window.matchMedia(B2_NARROW_MEDIA_QUERY).matches
  ) {
    return state;
  }
  return { ...state, selectedStep: b2NarrowStepForState(state) };
}

function useB2NarrowViewport(): boolean {
  const query = B2_NARROW_MEDIA_QUERY;
  const [matches, setMatches] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return matches;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function nextVariant(current: MockVariant, direction: -1 | 1): MockVariant {
  const comparisonVariants: MockVariant[] = ['A', 'B', 'C'];
  const normalized = current === 'selected' ? 'A' : current;
  const currentIndex = comparisonVariants.indexOf(normalized);
  return comparisonVariants[
    (currentIndex + direction + comparisonVariants.length) % comparisonVariants.length
  ];
}

function badgeTone(status: string | undefined): string {
  if (status === '冲突' || status === '不兼容') return 'danger';
  if (status === '漂移') return 'warning';
  if (status === '只读') return 'neutral';
  return 'positive';
}

function legacyCreationAsset(state: MockUiState): MockAsset {
  const isProjectSkillImport = state.createMode === '导入项目 Skill';
  const name =
    state.createName.trim() || (isProjectSkillImport ? 'commit-message-guide' : 'imported-skill');
  const mainContent =
    state.createMode === '新建'
      ? `---\nname: ${name}\ndescription: 新建的合成原生资产\n---\n\n# ${name}\n\n这是尚未写入磁盘的原生草稿。`
      : `---\nname: ${name}\ndescription: 从 ${
          isProjectSkillImport ? state.importProject : 'examples/skill'
        } 模拟导入\n---\n\n# ${name}\n\n导入内容仅来自内存中的合成 fixture。`;
  return {
    id: `draft:${name}`,
    type: isProjectSkillImport ? 'Skills' : state.targetAssetType,
    name,
    agent: state.targetAgent,
    scope: isProjectSkillImport ? '项目' : state.targetScope,
    project: isProjectSkillImport
      ? state.importProject
      : state.targetScope === '项目'
        ? 'acme/desktop'
        : '用户全局配置',
    description:
      state.createMode === '新建'
        ? '尚未应用的新建原生资产。'
        : isProjectSkillImport
          ? '尚未应用的项目内 Skill 导入草稿。'
          : '尚未应用的本地导入资产。',
    files:
      state.createMode === '新建'
        ? [
            {
              name: 'SKILL.md',
              language: 'markdown',
              changed: true,
              content: mainContent,
            },
          ]
        : [
            {
              name: 'SKILL.md',
              language: 'markdown',
              changed: true,
              content: mainContent,
            },
            {
              name: 'examples/imported.md',
              language: 'markdown',
              changed: true,
              content: '# Imported example\n\n合成导入示例；没有读取真实文件。',
            },
          ],
  };
}

function creationAsset(state: MockUiState): MockAsset {
  if (state.variant !== 'selected') return legacyCreationAsset(state);
  const isProjectSkillImport = state.createMode === '导入项目 Skill';
  return createB2NativeAsset({
    type: isProjectSkillImport ? 'Skills' : state.targetAssetType,
    name:
      state.createName.trim() || (isProjectSkillImport ? 'commit-message-guide' : 'imported-asset'),
    agent: state.targetAgent,
    scope: isProjectSkillImport ? '项目' : state.targetScope,
    project: state.importProject,
    mode: state.createMode,
  });
}

function b2ChangeModeForState(state: MockUiState): B2ChangeMode {
  if (state.skillTarget?.action === 'install') return 'install';
  if (state.journey === 'convert') return 'convert';
  if (state.journey === 'create') return 'create';
  return 'edit';
}

function b2ChangedFileCount(state: MockUiState, asset: MockAsset): number {
  return countB2ChangedFiles(asset, state.drafts, b2ChangeModeForState(state));
}

export function b2NarrowStepForState(
  state: Pick<MockUiState, 'stage' | 'selectedPanel' | 'selectedStep'>,
): MockUiState['selectedStep'] {
  if (state.stage === 'browse') {
    return state.selectedPanel === 'detail' ? 'detail' : 'type';
  }
  return 'detail';
}

export function b2CatalogSummary(context: ConfigContext, count: number): string {
  if (context === 'all') return `${count} 项全部来源资产`;
  return context === 'global' ? `${count} 项全局资产` : `${count} 项项目自有与全局适用资产`;
}

export function variantBoundaryFilterReset(
  currentVariant: MockVariant,
  nextVariant: MockVariant,
): Partial<MockUiState> {
  if ((currentVariant === 'selected') === (nextVariant === 'selected')) return {};
  return {
    agentFilter: '全部 Agent',
    filters: { status: [], agent: [] },
    filterOpen: false,
  };
}

type MockAgentName = (typeof mockAgents)[number];

function isMockAgentName(value: string): value is MockAgentName {
  return mockAgents.some((agent) => agent === value);
}

export function b2ConvertTargetForSource(sourceAgent: string, requestedTarget?: string): string {
  const availableTargets = mockAgents.filter((agent) => agent !== sourceAgent);
  const requested =
    requestedTarget !== undefined &&
    isMockAgentName(requestedTarget) &&
    availableTargets.includes(requestedTarget)
      ? requestedTarget
      : undefined;
  return requested ?? availableTargets[0] ?? sourceAgent;
}

export interface B2TargetIdentity {
  agent: string;
  scope: '全局' | '项目';
  project: string | null;
  nativePath: string;
}

export function b2TargetIdentityForState(
  state: Pick<MockUiState, 'targetScope' | 'importProject'>,
  asset: Pick<MockAsset, 'type' | 'name'>,
  targetAgent: string,
): B2TargetIdentity {
  const project = state.targetScope === '项目' ? state.importProject : null;
  return {
    agent: targetAgent,
    scope: state.targetScope,
    project,
    nativePath: b2NativeTargetPath({
      type: asset.type,
      name: asset.name,
      agent: targetAgent,
      scope: state.targetScope,
      project: project ?? '用户全局配置',
    }),
  };
}

export function b2TargetScopeLabel(identity: B2TargetIdentity): string {
  return identity.scope === '全局' ? '全局 · 用户配置' : `项目 · ${identity.project}`;
}

export function draftDirtyForState(
  state: Pick<MockUiState, 'variant' | 'journey'>,
  asset: Pick<MockAsset, 'files'>,
  drafts: Readonly<Record<string, string>>,
): boolean {
  if (state.variant === 'selected' && state.journey === 'create') return true;
  return Object.entries(drafts).some(([name, content]) => {
    const original = asset.files.find((file) => file.name === name);
    return original === undefined || original.content !== content;
  });
}

export function enterB2SelectedEdit(state: MockUiState, asset: MockAsset): MockUiState {
  const primaryFile = asset.files[0];
  const readOnly = selectedWriteBlockReason(state, asset) !== null;
  return {
    ...state,
    journey: 'edit',
    stage: 'editing',
    selectedPanel: 'detail',
    selectedStep: 'detail',
    skillTarget: null,
    drafts:
      readOnly || state.drafts[primaryFile.name] !== undefined
        ? state.drafts
        : { ...state.drafts, [primaryFile.name]: primaryFile.content },
  };
}

export function selectedWriteBlockReason(
  state: Pick<MockUiState, 'variant' | 'scenario'>,
  asset: MockAsset,
): string | null {
  if (state.variant !== 'selected') return null;
  const capabilityBlockReason = selectedCapabilityBlockReason(state, asset);
  if (capabilityBlockReason !== null) {
    return asset.type === 'Skills'
      ? `${capabilityBlockReason} 当前 Skill 仍可结构化查看，但不提供源码、编辑或转换。`
      : capabilityBlockReason;
  }
  if (asset.type === 'Skills') {
    return '当前 selected Skill 只支持结构化查看与 Mock 会话内 Agent 启停预览。';
  }
  return null;
}

function selectedCapabilityBlockReason(
  state: Pick<MockUiState, 'variant' | 'scenario'>,
  asset: MockAsset,
): string | null {
  if (state.variant !== 'selected') return null;
  const decisionStatus = b2AssetDecisionStatus(asset);
  if (state.scenario === 'readonly' || decisionStatus === '只读') {
    return '当前 Agent 版本仅支持只读；不能创建、安装、转换或应用。';
  }
  if (decisionStatus === '不兼容') {
    return b2AssetBlockReason(asset) ?? '当前资产不兼容；可以查看源码，但不能执行写操作。';
  }
  return null;
}

export function globalSearchShortcutTransitionForState(
  state: Pick<MockUiState, 'variant' | 'stage' | 'viewport' | 'panelOverlay'>,
): Partial<MockUiState> | null {
  if (state.variant === 'selected') {
    return state.stage === 'confirm' || state.stage === 'discard'
      ? null
      : { globalSearchOpen: true };
  }
  return {
    panelOverlay: state.viewport === 'narrow' ? 'library' : state.panelOverlay,
  };
}

export function escapeTransitionForState(
  state: Pick<MockUiState, 'globalSearchOpen' | 'stage' | 'filterOpen' | 'panelOverlay' | 'notice'>,
): Partial<MockUiState> {
  if (state.globalSearchOpen) return { globalSearchOpen: false, globalSearch: '' };
  if (state.stage === 'confirm') return { stage: 'review' };
  if (state.stage === 'discard') return { stage: 'editing' };
  return { filterOpen: false, panelOverlay: null, notice: null };
}

export function continueEditingTransitionForState(
  state: Pick<MockUiState, 'variant'>,
): Partial<MockUiState> {
  return state.variant === 'selected'
    ? { stage: 'editing' }
    : { journey: 'edit', stage: 'editing' };
}

export function dirtyGuardBehaviorForState(state: Pick<MockUiState, 'variant'>): {
  focus: 'active-element' | 'selected-editor';
  patch: Partial<MockUiState>;
} {
  return state.variant === 'selected'
    ? {
        focus: 'selected-editor',
        patch: { stage: 'discard', globalSearchOpen: false, globalSearch: '' },
      }
    : { focus: 'active-element', patch: { stage: 'discard' } };
}

export function shouldClearPendingTransitionOnEscape(
  state: Pick<MockUiState, 'variant' | 'stage'>,
): boolean {
  return state.variant === 'selected' && state.stage === 'discard';
}

export function shouldFocusGlobalSearchDestination(
  state: Pick<
    MockUiState,
    'variant' | 'stage' | 'selectedPanel' | 'selectedStep' | 'globalSearchOpen' | 'assetId'
  >,
  pendingAssetId: string | null,
): boolean {
  return (
    pendingAssetId !== null &&
    state.variant === 'selected' &&
    state.stage === 'browse' &&
    state.selectedPanel === 'detail' &&
    state.selectedStep === 'detail' &&
    !state.globalSearchOpen &&
    state.assetId === pendingAssetId
  );
}

export function reviewTransitionForState(
  state: MockUiState,
  asset: MockAsset,
): Partial<MockUiState> {
  if (state.variant !== 'selected') {
    return { stage: 'review', dirty: true, notice: null };
  }
  const writeBlockReason = selectedWriteBlockReason(state, asset);
  if (writeBlockReason !== null) {
    return { dirty: false, appliedFileCount: 0, notice: writeBlockReason };
  }
  const changeMode = b2ChangeModeForState(state);
  const reviewFileName = firstB2ChangedFileName(asset, state.drafts, changeMode);
  return {
    stage: 'review',
    dirty: changeMode === 'convert' || changeMode === 'install' ? false : true,
    fileName: reviewFileName || state.fileName,
    appliedFileCount: null,
    notice: null,
  };
}

export function selectedApplySucceeds(state: MockUiState, asset: MockAsset): boolean {
  if (state.variant !== 'selected') return false;
  if (selectedWriteBlockReason(state, asset) !== null) return false;
  return (
    state.scenario !== 'conflict' && state.scenario !== 'failed' && state.scenario !== 'blocked'
  );
}

export function selectedInlineInstructionEdit(
  state: Pick<MockUiState, 'variant' | 'journey'>,
  asset: Pick<MockAsset, 'type'>,
): boolean {
  return state.variant === 'selected' && state.journey === 'browse' && asset.type === '长期指令';
}

export function applyResultTransitionForState(
  state: MockUiState,
  asset: MockAsset,
): Partial<MockUiState> {
  if (state.variant !== 'selected') {
    if (state.scenario === 'conflict') {
      return {
        stage: 'result',
        dirty: true,
        notice: 'apply 重新校验发现磁盘变化；返回 REPREPARE_REQUIRED，未写入文件。',
      };
    }
    if (state.scenario === 'failed' || state.scenario === 'blocked') {
      return {
        stage: 'result',
        dirty: true,
        notice:
          state.scenario === 'failed'
            ? '事务在提交前失败；原文件与草稿均已保留。'
            : '能力或授权阻断；没有写入文件。',
      };
    }
    return {
      stage: 'result',
      dirty: false,
      drafts: {},
      notice: '已完成模拟应用，并固定恢复点 RP-20260729-1042。',
    };
  }

  const writeBlockReason = selectedWriteBlockReason(state, asset);
  if (writeBlockReason !== null) {
    return {
      stage: 'review',
      dirty: false,
      drafts: {},
      appliedFileCount: 0,
      notice: writeBlockReason,
    };
  }

  const changedFileCount = b2ChangedFileCount(state, asset);
  if (selectedApplySucceeds(state, asset)) {
    return {
      stage: 'result',
      dirty: false,
      drafts: {},
      appliedFileCount: changedFileCount,
      notice: '已完成模拟应用；确认内容已写入 Mock 内存资产快照，刷新后按 URL 起点重置。',
    };
  }

  const preservesDraft =
    state.journey === 'edit' ||
    state.journey === 'create' ||
    selectedInlineInstructionEdit(state, asset);
  if (state.scenario === 'conflict') {
    return {
      stage: 'result',
      dirty: preservesDraft,
      drafts: preservesDraft ? state.drafts : {},
      appliedFileCount: 0,
      notice: 'apply 重新校验发现磁盘变化；返回 REPREPARE_REQUIRED，未写入文件。',
    };
  }
  return {
    stage: 'result',
    dirty: preservesDraft,
    drafts: preservesDraft ? state.drafts : {},
    appliedFileCount: 0,
    notice:
      state.scenario === 'failed'
        ? preservesDraft
          ? '事务在提交前失败；原文件与草稿均已保留。'
          : '事务在提交前失败；转换映射保持可审查，没有创建源码草稿。'
        : '能力或授权阻断；没有写入文件。',
  };
}

export function confirmationDetailsForState(
  state: MockUiState,
  asset: MockAsset,
  convertTarget: string,
): string[] {
  if (state.variant !== 'selected') {
    return [
      `${asset.name} · ${asset.agent}`,
      state.skillTarget?.action === 'install'
        ? `复制 ${asset.files.length} 个原生文件到 ${convertTarget}，${
            state.scenario === 'degraded' ? '含 2 项降级' : '安装计划完整'
          }`
        : state.journey === 'convert'
          ? `转换到 ${convertTarget}，${state.scenario === 'degraded' ? '含 2 项降级' : '完整映射'}`
          : `修改 ${asset.files.length} 个原生文件`,
      '应用前固定恢复点；不会操作 Git',
    ];
  }

  const targetIdentity =
    state.journey === 'convert' || state.skillTarget?.action === 'install'
      ? b2TargetIdentityForState(state, asset, convertTarget)
      : null;

  return [
    `${asset.name} · ${targetIdentity === null ? asset.agent : targetIdentity.agent}`,
    ...(targetIdentity === null
      ? []
      : [
          `单一目标：${b2TargetScopeLabel(targetIdentity)}`,
          `原生位置：${targetIdentity.nativePath}`,
        ]),
    state.skillTarget?.action === 'install'
      ? `复制 ${b2ChangedFileCount(state, asset)} 个原生文件到 ${convertTarget}，${
          state.scenario === 'degraded' ? '含 2 项降级' : '安装计划完整'
        }`
      : state.journey === 'convert'
        ? `转换 ${b2ChangedFileCount(state, asset)} 个原生文件到 ${convertTarget}，${
            state.scenario === 'degraded' ? '含 2 项降级' : '完整映射'
          }`
        : `修改 ${b2ChangedFileCount(state, asset)} 个原生文件`,
    '不会操作 Git',
  ];
}

function createB2MemorySnapshot(source: readonly B2MockAsset[] = b2Assets): B2MockAsset[] {
  return source.map((asset) => ({
    ...asset,
    agentTargets: asset.agentTargets?.map((target) => ({ ...target })),
    files: asset.files.map((file) => ({ ...file })),
  }));
}

function asCreatedB2Asset(asset: MockAsset, drafts: Readonly<Record<string, string>>): B2MockAsset {
  const selectedAsset = asset as B2MockAsset;
  return {
    ...selectedAsset,
    updatedLabel: '刚刚应用',
    files: asset.files.map((file) => ({
      ...file,
      content: drafts[file.name] ?? file.content,
      changed: false,
    })),
  };
}

export function applySelectedSnapshotForState(
  snapshots: readonly B2MockAsset[],
  state: MockUiState,
  asset: MockAsset,
): B2MockAsset[] {
  if (!selectedApplySucceeds(state, asset)) return [...snapshots];
  if (state.journey === 'edit' || selectedInlineInstructionEdit(state, asset)) {
    return applyB2DraftsToAssets(snapshots, asset.id, state.drafts);
  }
  if (state.journey === 'create') {
    const createdAsset = asCreatedB2Asset(asset, state.drafts);
    return [
      createdAsset,
      ...snapshots.filter(
        (candidate) =>
          candidate.id !== createdAsset.id && candidate.sourcePath !== createdAsset.sourcePath,
      ),
    ];
  }
  return [...snapshots];
}

/** “全部”视图的一个来源分段；assets 已按当前排序方向在段内稳定排序。 */
export interface B2SourceSection {
  key: string;
  label: string;
  assets: B2MockAsset[];
}

export interface FullUiMockProps {
  initialB2Assets?: readonly B2MockAsset[];
}

export function FullUiMock({ initialB2Assets = b2Assets }: FullUiMockProps = {}): JSX.Element {
  const [state, setState] = useState<MockUiState>(initialResponsiveMockState);
  const [pendingTransition, setPendingTransition] = useState<Partial<MockUiState> | null>(null);
  const [sensitiveVisible, setSensitiveVisible] = useState(false);
  const [convertTarget, setConvertTarget] = useState(() => {
    if (state.variant !== 'selected') return 'Codex';
    const initialAsset =
      initialB2Assets.find((candidate) => candidate.id === b2DefaultSkillId) ?? initialB2Assets[0];
    return b2ConvertTargetForSource(initialAsset.agent);
  });
  const [b2ListControls, setB2ListControls] = useState<B2ListControls>(createB2ListControls);
  const [b2AssetSnapshots, setB2AssetSnapshots] = useState<B2MockAsset[]>(() =>
    createB2MemorySnapshot(initialB2Assets),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const globalSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const globalSearchRestoreRef = useRef<HTMLElement | null>(null);
  const globalSearchDestinationFocusRef = useRef<string | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const previousOverlayRef = useRef<MockUiState['panelOverlay']>(null);
  const b2FirstRowFocusRef = useRef<HTMLButtonElement>(null);
  const b2ListScrollRef = useRef<HTMLDivElement>(null);
  const b2PageFocusPendingRef = useRef(false);
  const browserNarrow = useB2NarrowViewport();
  const b2Narrow = state.variant === 'selected' && (state.viewport === 'narrow' || browserNarrow);
  const previousB2NarrowRef = useRef(b2Narrow);

  // A/B/C 是第一阶段的完整设计证据；selected 是第二阶段独立重构，不改写它们。
  const visualVariant = state.variant;
  const showPrototypeControls = controlsEnabledFromSearch(window.location.search);
  const resolveB2Asset = (assetId: string): B2MockAsset =>
    b2AssetSnapshots.find((candidate) => candidate.id === assetId) ?? b2AssetSnapshots[0];
  const storedAsset =
    state.variant === 'selected' ? resolveB2Asset(state.assetId) : getAsset(state.assetId);
  const asset = state.journey === 'create' ? creationAsset(state) : storedAsset;
  const activeFile = asset.files.find((file) => file.name === state.fileName) ?? asset.files[0];

  const visibleAssets = useMemo(() => {
    const normalizedSearch = state.search.trim().toLowerCase();
    const source =
      state.searchRange === 'all'
        ? mockAssets
        : mockAssets.filter((candidate) => candidate.type === state.assetType);
    const searched = source.filter((candidate) => {
      if (normalizedSearch.length === 0) return true;
      return `${candidate.name} ${candidate.agent} ${candidate.project} ${candidate.description}`
        .toLowerCase()
        .includes(normalizedSearch);
    });
    const agentFiltered =
      state.agentFilter === '全部 Agent'
        ? searched
        : searched.filter((candidate) => candidate.agent === state.agentFilter);
    return filterAssets(agentFiltered, state.scopeFilter, state.filters);
  }, [
    state.agentFilter,
    state.assetType,
    state.filters,
    state.scopeFilter,
    state.search,
    state.searchRange,
  ]);

  const selectedFilteredAssets = useMemo(() => {
    const currentTypeAssets = b2AssetSnapshots.filter((candidate) => {
      if (candidate.type !== state.assetType) return false;
      if (state.configContext === 'all') return true;
      if (state.configContext === 'global') return candidate.scope === '全局';
      return (
        candidate.scope === '全局' ||
        candidate.project === state.configContext.slice('project:'.length)
      );
    });
    return currentTypeAssets.filter((candidate) => {
      const matchesPrimaryAgent =
        state.agentFilter === '全部 Agent' || candidate.agent === state.agentFilter;
      const matchesAgent =
        state.filters.agent.length === 0 ||
        candidate.agentTargets?.some(
          (target) => target.status !== 'blocked' && state.filters.agent.includes(target.agent),
        ) ||
        state.filters.agent.includes(candidate.agent);
      const matchesStatus =
        state.filters.status.length === 0 ||
        state.filters.status.includes(candidate.decisionStatus);
      return matchesPrimaryAgent && matchesAgent && matchesStatus;
    });
  }, [b2AssetSnapshots, state.agentFilter, state.assetType, state.configContext, state.filters]);

  const selectedProjectAssets = useMemo(
    () => selectedFilteredAssets.filter((candidate) => candidate.scope === '项目'),
    [selectedFilteredAssets],
  );
  const selectedApplicableGlobalAssets = useMemo(
    () => selectedFilteredAssets.filter((candidate) => candidate.scope === '全局'),
    [selectedFilteredAssets],
  );
  const selectedSortedProjectAssets = useMemo(
    () => sortB2ItemsByNameStable(selectedProjectAssets, b2ListControls.sortDirection),
    [b2ListControls.sortDirection, selectedProjectAssets],
  );
  const selectedSortedGlobalAssets = useMemo(
    () => sortB2ItemsByNameStable(selectedApplicableGlobalAssets, b2ListControls.sortDirection),
    [b2ListControls.sortDirection, selectedApplicableGlobalAssets],
  );
  // “全部”视图的跨来源分段：全局适用段在前，项目段按项目名稳定排序；空来源不产出空段。
  const selectedSourceSections = useMemo<B2SourceSection[]>(() => {
    if (state.configContext !== 'all') return [];
    const sections: B2SourceSection[] = [];
    if (selectedSortedGlobalAssets.length > 0) {
      sections.push({ key: 'global', label: '全局适用', assets: selectedSortedGlobalAssets });
    }
    const projectNames = sortB2ItemsByNameStable(
      Array.from(new Set(selectedProjectAssets.map((asset) => asset.project))).map((name) => ({
        name,
      })),
      'asc',
    ).map((entry) => entry.name);
    for (const project of projectNames) {
      const items = sortB2ItemsByNameStable(
        selectedProjectAssets.filter((asset) => asset.project === project),
        b2ListControls.sortDirection,
      );
      if (items.length > 0) {
        sections.push({ key: `project:${project}`, label: project, assets: items });
      }
    }
    return sections;
  }, [
    b2ListControls.sortDirection,
    selectedProjectAssets,
    selectedSortedGlobalAssets,
    state.configContext,
  ]);

  const selectedSortedAssets = useMemo(() => {
    if (state.configContext === 'all') {
      return selectedSourceSections.flatMap((section) => section.assets);
    }
    if (state.configContext === 'global') return selectedSortedGlobalAssets;
    if (state.inheritanceLayout === 'A') {
      return [...selectedSortedProjectAssets, ...selectedSortedGlobalAssets];
    }
    if (state.inheritanceLayout === 'C') return selectedSortedProjectAssets;
    return sortB2ItemsByNameStable(
      [...selectedProjectAssets, ...selectedApplicableGlobalAssets],
      b2ListControls.sortDirection,
    );
  }, [
    b2ListControls.sortDirection,
    selectedApplicableGlobalAssets,
    selectedProjectAssets,
    selectedSortedGlobalAssets,
    selectedSortedProjectAssets,
    selectedSourceSections,
    state.configContext,
    state.inheritanceLayout,
  ]);

  const b2Page = useMemo(
    () => paginateB2Items(selectedSortedAssets, b2ListControls.page, b2ListControls.pageSize),
    [b2ListControls.page, b2ListControls.pageSize, selectedSortedAssets],
  );

  const selectedAssets = b2Page.items;

  useEffect(() => {
    syncMockQuery(state);
  }, [state.inheritanceLayout, state.variant, state.journey, state.scenario]);

  useEffect(() => {
    if (!sensitiveVisible) return undefined;
    const timeout = window.setTimeout(() => setSensitiveVisible(false), 8000);
    return () => window.clearTimeout(timeout);
  }, [sensitiveVisible]);

  useEffect(() => {
    setSensitiveVisible(false);
  }, [state.assetId, state.fileName, state.scenario]);

  useEffect(() => {
    if (!state.globalSearchOpen) return;
    window.requestAnimationFrame(() => globalSearchRef.current?.focus());
  }, [state.globalSearchOpen]);

  useEffect(() => {
    const previousOverlay = previousOverlayRef.current;
    window.requestAnimationFrame(() => {
      if (state.panelOverlay === 'library') {
        searchRef.current?.focus();
      } else if (state.panelOverlay === 'files') {
        document.querySelector<HTMLElement>('.file-tree.is-overlay-open button')?.focus();
      } else if (state.panelOverlay === 'inspector') {
        document.querySelector<HTMLElement>('.inspector .mobile-close')?.focus();
      } else if (previousOverlay === 'library') {
        document.querySelector<HTMLElement>('.mobile-library-trigger')?.focus();
      } else if (previousOverlay === 'files') {
        document.querySelector<HTMLElement>('.file-tree-trigger')?.focus();
      } else if (previousOverlay === 'inspector') {
        document.querySelector<HTMLElement>('.inspector-trigger')?.focus();
      }
    });
    previousOverlayRef.current = state.panelOverlay;
  }, [state.panelOverlay]);

  useEffect(() => {
    if (!state.filterOpen) return undefined;
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.filter-popover button')?.focus(),
    );
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.filter-popover') !== null || target.closest('.filter-button') !== null) {
        return;
      }
      setState((previous) => ({ ...previous, filterOpen: false }));
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [state.filterOpen]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (state.variant === 'selected') {
          const transition = globalSearchShortcutTransitionForState(state);
          if (transition === null) return;
          globalSearchRestoreRef.current = document.activeElement as HTMLElement | null;
          setState((previous) => ({ ...previous, ...transition }));
          return;
        }
        setState((previous) => ({
          ...previous,
          panelOverlay: previous.viewport === 'narrow' ? 'library' : previous.panelOverlay,
        }));
        window.requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (event.key === 'Escape') {
        if (state.variant !== 'selected') {
          setState((previous) => {
            if (previous.globalSearchOpen) {
              window.requestAnimationFrame(() => {
                const restoreTarget = globalSearchRestoreRef.current;
                if (restoreTarget?.isConnected) restoreTarget.focus();
                else globalSearchTriggerRef.current?.focus();
                globalSearchRestoreRef.current = null;
              });
              return { ...previous, globalSearchOpen: false, globalSearch: '' };
            }
            if (previous.stage === 'confirm') return { ...previous, stage: 'review' };
            if (previous.stage === 'discard') return { ...previous, stage: 'editing' };
            return {
              ...previous,
              filterOpen: false,
              panelOverlay: null,
              notice: null,
            };
          });
          return;
        }
        if (shouldClearPendingTransitionOnEscape(state)) {
          setPendingTransition(null);
          globalSearchDestinationFocusRef.current = null;
          restoreFocusRef.current = document.querySelector<HTMLElement>(
            selectedInlineInstructionEdit(state, asset)
              ? '.b2-instruction-editor textarea'
              : '.editor-shell textarea',
          );
        }
        setState((previous) => {
          if (previous.globalSearchOpen) {
            window.requestAnimationFrame(() => {
              const restoreTarget = globalSearchRestoreRef.current;
              if (restoreTarget?.isConnected) restoreTarget.focus();
              else globalSearchTriggerRef.current?.focus();
              globalSearchRestoreRef.current = null;
            });
          } else if (previous.filterOpen) {
            window.requestAnimationFrame(() => {
              selectedFilterTriggerRef.current?.focus();
            });
          }
          return {
            ...previous,
            ...(previous.stage === 'discard' && selectedInlineInstructionEdit(previous, asset)
              ? {
                  stage: 'browse' as const,
                  selectedPanel: 'detail' as const,
                  selectedStep: 'detail' as const,
                }
              : escapeTransitionForState(previous)),
          };
        });
        return;
      }
      if (event.altKey && !isEditableTarget(event.target)) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const direction = event.key === 'ArrowLeft' ? -1 : 1;
          setState((previous) => {
            const variant = nextVariant(previous.variant, direction);
            return {
              ...previous,
              variant,
              ...variantBoundaryFilterReset(previous.variant, variant),
              ...(previous.journey === 'create' &&
              previous.variant === 'selected' &&
              variant !== 'selected'
                ? {
                    createMode: '新建' as const,
                    createName: 'new-skill',
                    targetAssetType: previous.assetType,
                    targetScope: '项目' as const,
                  }
                : {}),
            };
          });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.stage, state.variant]);

  useEffect(() => {
    if (state.stage === 'confirm' || state.stage === 'discard') return;

    const previousTarget = restoreFocusRef.current;
    if (state.variant !== 'selected') {
      const fallbackTarget =
        state.stage === 'review'
          ? document.querySelector<HTMLElement>('.review-surface .flow-footer .primary-button')
          : state.stage === 'editing'
            ? document.querySelector<HTMLElement>('.editor-shell textarea')
            : null;
      window.requestAnimationFrame(() => {
        if (previousTarget?.isConnected) previousTarget.focus();
        else fallbackTarget?.focus();
      });
      restoreFocusRef.current = null;
      return;
    }

    window.requestAnimationFrame(() => {
      const fallbackTarget =
        state.stage === 'review'
          ? document.querySelector<HTMLElement>('.review-surface .flow-footer .primary-button')
          : state.stage === 'editing'
            ? document.querySelector<HTMLElement>('.editor-shell textarea')
            : state.stage === 'browse' &&
                state.selectedPanel === 'detail' &&
                asset.type === '长期指令'
              ? document.querySelector<HTMLElement>('.b2-instruction-editor textarea')
              : state.stage === 'result' || state.stage === 'conflict'
                ? document.querySelector<HTMLElement>('[data-b2-focus="outcome"]')
                : null;
      if (state.stage === 'editing' && fallbackTarget !== null) fallbackTarget.focus();
      else if (previousTarget?.isConnected) previousTarget.focus();
      else fallbackTarget?.focus();
    });
    restoreFocusRef.current = null;
  }, [asset.type, state.selectedPanel, state.stage, state.variant]);

  useEffect(() => {
    const becameNarrow = b2Narrow && !previousB2NarrowRef.current;
    previousB2NarrowRef.current = b2Narrow;
    if (!becameNarrow || state.variant !== 'selected') return;
    setState((previous) => {
      const selectedStep = b2NarrowStepForState(previous);
      return selectedStep === previous.selectedStep ? previous : { ...previous, selectedStep };
    });
  }, [b2Narrow, state.variant]);

  useEffect(() => {
    if (state.variant !== 'selected' || !b2Narrow || state.stage !== 'browse') return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-b2-focus="${state.selectedStep}"]`)?.focus();
    });
  }, [b2Narrow, state.selectedPanel, state.selectedStep, state.stage, state.variant]);

  useEffect(() => {
    if (!shouldFocusGlobalSearchDestination(state, globalSearchDestinationFocusRef.current)) {
      return;
    }
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('[data-b2-focus="global-search-detail"]');
      if (target === null) return;
      target.focus();
      globalSearchDestinationFocusRef.current = null;
    });
  }, [
    state.assetId,
    state.globalSearchOpen,
    state.selectedPanel,
    state.selectedStep,
    state.stage,
    state.variant,
  ]);

  useEffect(() => {
    if (b2ListControls.page !== b2Page.page) {
      setB2ListControls((previous) => ({ ...previous, page: b2Page.page }));
    }
    if (!b2PageFocusPendingRef.current) return;
    b2PageFocusPendingRef.current = false;
    window.requestAnimationFrame(() => {
      b2FirstRowFocusRef.current?.focus({ preventScroll: true });
      b2ListScrollRef.current?.scrollTo({ top: 0 });
    });
  }, [b2ListControls.page, b2Page.page]);

  const resetB2Page = (): void => {
    setB2ListControls((previous) => withB2Criteria(previous, {}));
  };

  const setB2SortDirection = (sortDirection: B2SortDirection): void => {
    setB2ListControls((previous) => withB2Criteria(previous, { sortDirection }));
  };

  const setB2PageSize = (pageSize: B2PageSize): void => {
    setB2ListControls((previous) => withB2Criteria(previous, { pageSize }));
  };

  const changeB2Page = (page: number): void => {
    b2PageFocusPendingRef.current = true;
    setB2ListControls((previous) => ({ ...previous, page }));
  };

  const setInheritanceLayout = (inheritanceLayout: InheritanceLayout): void => {
    patchState({ inheritanceLayout });
  };

  const toggleSkillAgentEnabled = (assetId: string, agent: string): void => {
    setB2AssetSnapshots((previous) => toggleB2SkillTargetEnabled(previous, assetId, agent));
  };

  const patchState = (patch: Partial<MockUiState>): void => {
    setState((previous) => {
      const leavesSkillTargetFlow =
        previous.skillTarget !== null &&
        (patch.journey === 'browse' ||
          patch.journey === 'edit' ||
          patch.journey === 'create' ||
          patch.journey === 'manage' ||
          patch.journey === 'recover' ||
          patch.stage === 'browse' ||
          patch.stage === 'editing' ||
          patch.stage === 'manage' ||
          patch.stage === 'recover');
      return {
        ...previous,
        ...patch,
        ...(leavesSkillTargetFlow ? { skillTarget: null } : {}),
      };
    });
  };

  const chooseAsset = (assetId: string): void => {
    const transition = assetSelectionTransition(
      state,
      state.variant === 'selected' ? resolveB2Asset(assetId) : getAsset(assetId),
    );
    if (assetId === state.assetId) {
      setState((previous) => ({ ...previous, ...transition }));
      return;
    }
    requestTransition(transition);
  };

  const chooseAssetType = (assetType: AssetType): void => {
    const transition = assetTypeTransition(
      state,
      state.variant === 'selected' ? b2AssetSnapshots : mockAssets,
      assetType,
    );
    if (transition !== null) {
      resetB2Page();
      requestTransition(transition);
    }
  };

  const chooseConfigContext = (configContext: ConfigContext): void => {
    resetB2Page();
    requestTransition(configContextTransition(state, b2AssetSnapshots, configContext));
  };

  const chooseJourney = (journey: MockJourney): void => {
    const writeBlockReason = selectedWriteBlockReason(state, asset);
    if (
      writeBlockReason !== null &&
      (journey === 'create' || journey === 'convert' || journey === 'manage')
    ) {
      patchState({ notice: writeBlockReason });
      return;
    }
    setPendingTransition(null);
    setState((previous) => resetForJourney(previous, journey));
  };

  const chooseScenario = (scenario: MockScenario): void => {
    setPendingTransition(null);
    resetB2Page();
    setState((previous) => resetForJourney(previous, previous.journey, scenario));
  };

  const requestTransition = (transition: Partial<MockUiState>): void => {
    if (state.dirty) {
      if (state.variant !== 'selected') {
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        setPendingTransition(transition);
        patchState({ stage: 'discard' });
        return;
      }

      const editorTarget = document.querySelector<HTMLElement>('.editor-shell textarea');
      restoreFocusRef.current = state.globalSearchOpen
        ? (globalSearchRestoreRef.current ?? editorTarget)
        : (editorTarget ?? (document.activeElement as HTMLElement | null));
      globalSearchRestoreRef.current = null;
      setPendingTransition(transition);
      setState((previous) => ({
        ...previous,
        ...dirtyGuardBehaviorForState(previous).patch,
      }));
      return;
    }
    setState((previous) => ({ ...previous, ...transition }));
  };

  const startCreate = (mode: CreateMode): void => {
    const writeBlockReason = selectedWriteBlockReason(state, asset);
    if (writeBlockReason !== null) {
      patchState({ notice: writeBlockReason });
      return;
    }
    const selectedProject = state.configContext.startsWith('project:')
      ? state.configContext.slice('project:'.length)
      : b2ProjectNames[0];
    const transition: MockUiState = {
      ...resetForJourney(state, 'create', 'ready'),
      createMode: mode,
      createName:
        mode === '新建'
          ? 'new-skill'
          : mode === '导入项目 Skill'
            ? 'commit-message-guide'
            : 'imported-skill',
      importProject: state.variant === 'selected' ? selectedProject : 'acme/desktop',
      targetAssetType: mode === '导入项目 Skill' ? 'Skills' : state.assetType,
      targetAgent: 'Codex',
      targetScope:
        state.variant === 'selected' && mode !== '导入项目 Skill'
          ? state.configContext === 'global'
            ? '全局'
            : '项目'
          : '项目',
      stage: 'target',
      selectedStep: state.variant === 'selected' ? 'detail' : state.selectedStep,
    };
    requestTransition(transition);
  };

  const startManage = (): void => {
    const writeBlockReason = selectedCapabilityBlockReason(state, asset);
    if (writeBlockReason !== null) {
      patchState({ notice: writeBlockReason });
      return;
    }
    requestTransition({
      journey: 'manage',
      stage: 'manage',
      skillTarget: null,
      dirty: false,
      drafts: {},
      panelOverlay: null,
      recoveryAction: 'idle',
      appliedFileCount: null,
      selectedStep: state.variant === 'selected' ? 'detail' : state.selectedStep,
    });
  };

  const startConvert = (): void => {
    if (state.variant === 'selected' && asset.type === '长期指令') {
      patchState({ notice: '长期指令不提供跨 Agent 转换。' });
      return;
    }
    const writeBlockReason = selectedWriteBlockReason(state, asset);
    if (writeBlockReason !== null) {
      patchState({ notice: writeBlockReason });
      return;
    }
    if (state.variant === 'selected') {
      setConvertTarget(b2ConvertTargetForSource(asset.agent));
    }
    const selectedProject = state.configContext.startsWith('project:')
      ? state.configContext.slice('project:'.length)
      : b2ProjectNames[0];
    requestTransition({
      journey: 'convert',
      stage: 'target',
      skillTarget: null,
      dirty: false,
      drafts: {},
      panelOverlay: null,
      recoveryAction: 'idle',
      appliedFileCount: null,
      ...(state.variant === 'selected'
        ? {
            targetScope: state.configContext === 'global' ? ('全局' as const) : ('项目' as const),
            importProject: selectedProject,
          }
        : {}),
      selectedStep: state.variant === 'selected' ? 'detail' : state.selectedStep,
    });
  };

  const startSelectedEdit = (): void => {
    restoreFocusRef.current = null;
    setState((previous) => enterB2SelectedEdit(previous, asset));
  };

  const startSkillTarget = (
    assetId: string,
    action: SkillTargetAction,
    target: SkillAgentTarget,
  ): void => {
    if (target.status !== 'installable' && target.status !== 'convertible') return;
    const targetAsset = state.variant === 'selected' ? resolveB2Asset(assetId) : getAsset(assetId);
    const writeBlockReason = selectedWriteBlockReason(state, targetAsset);
    if (writeBlockReason !== null) {
      patchState({ notice: writeBlockReason });
      return;
    }
    const selectedProject = state.configContext.startsWith('project:')
      ? state.configContext.slice('project:'.length)
      : b2ProjectNames[0];
    const transition: Partial<MockUiState> = {
      assetId: targetAsset.id,
      assetType: targetAsset.type,
      fileName: targetAsset.files[0].name,
      journey: 'convert',
      stage: 'target',
      skillTarget: { action, agent: target.agent },
      dirty: false,
      drafts: {},
      panelOverlay: null,
      selectedPanel: 'detail',
      selectedStep: state.variant === 'selected' ? 'detail' : state.selectedStep,
      recoveryAction: 'idle',
      appliedFileCount: null,
      ...(state.variant === 'selected'
        ? {
            targetScope: state.configContext === 'global' ? ('全局' as const) : ('项目' as const),
            importProject: selectedProject,
          }
        : {}),
    };
    setConvertTarget(target.agent);
    requestTransition(transition);
  };

  const openGlobalSearch = (): void => {
    if (state.variant === 'selected' && (state.stage === 'confirm' || state.stage === 'discard')) {
      return;
    }
    globalSearchRestoreRef.current = document.activeElement as HTMLElement | null;
    patchState({ globalSearchOpen: true });
  };

  const closeGlobalSearch = (): void => {
    patchState({ globalSearchOpen: false, globalSearch: '' });
    window.requestAnimationFrame(() => {
      const restoreTarget = globalSearchRestoreRef.current;
      if (restoreTarget?.isConnected) restoreTarget.focus();
      else globalSearchTriggerRef.current?.focus();
      globalSearchRestoreRef.current = null;
    });
  };

  const chooseGlobalAsset = (assetId: string): void => {
    const targetAsset = state.variant === 'selected' ? resolveB2Asset(assetId) : getAsset(assetId);
    if (state.variant === 'selected') {
      globalSearchDestinationFocusRef.current = targetAsset.id;
    }
    requestTransition(
      state.variant === 'selected'
        ? globalAssetSelectionTransition(state, targetAsset)
        : assetSelectionTransition(state, targetAsset),
    );
  };

  const startRecover = (): void =>
    state.variant === 'selected'
      ? requestTransition({
          journey: 'browse',
          stage: 'browse',
          selectedPanel: 'list',
        })
      : requestTransition({
          journey: 'recover',
          stage: 'recover',
          skillTarget: null,
          dirty: false,
          drafts: {},
          panelOverlay: null,
          recoveryAction: 'idle',
        });

  const startReview = (): void => {
    patchState(reviewTransitionForState(state, asset));
  };

  const openConfirmation = (source: HTMLElement): void => {
    const writeBlockReason = selectedWriteBlockReason(state, asset);
    if (writeBlockReason !== null) {
      patchState({ notice: writeBlockReason });
      return;
    }
    restoreFocusRef.current = source;
    patchState({ stage: 'confirm' });
  };

  const applyPreparedOperation = (): void => {
    const writeBlockReason = selectedWriteBlockReason(state, asset);
    if (writeBlockReason !== null) {
      patchState({
        stage: 'review',
        dirty: false,
        drafts: {},
        appliedFileCount: 0,
        notice: writeBlockReason,
      });
      return;
    }

    const resultTransition = applyResultTransitionForState(state, asset);
    const successfulSelectedApply = selectedApplySucceeds(state, asset);
    if (
      successfulSelectedApply &&
      (state.journey === 'edit' ||
        state.journey === 'create' ||
        selectedInlineInstructionEdit(state, asset))
    ) {
      setB2AssetSnapshots((previous) => applySelectedSnapshotForState(previous, state, asset));
    }

    patchState({
      ...resultTransition,
      ...(successfulSelectedApply && state.journey === 'create'
        ? {
            assetId: asset.id,
            assetType: asset.type,
            fileName: asset.files[0].name,
            configContext:
              asset.scope === '全局' ? ('global' as const) : (`project:${asset.project}` as const),
            selectedPanel: 'detail' as const,
            selectedStep: 'detail' as const,
          }
        : {}),
    });
  };

  const sharedProps: LayoutProps = {
    state,
    asset,
    activeFile,
    visibleAssets,
    selectedAssets,
    selectedApplicableGlobalAssets: selectedSortedGlobalAssets,
    selectedSourceSections,
    b2Narrow,
    b2ListControls,
    b2Page,
    b2FirstRowFocusRef,
    b2ListScrollRef,
    resetB2Page,
    setB2SortDirection,
    setB2PageSize,
    changeB2Page,
    setInheritanceLayout,
    searchRef,
    globalSearchRef,
    globalSearchTriggerRef,
    selectedFilterTriggerRef,
    sensitiveVisible,
    convertTarget,
    patchState,
    chooseAsset,
    chooseAssetType,
    chooseConfigContext,
    startCreate,
    startManage,
    startConvert,
    startSelectedEdit,
    startSkillTarget,
    toggleSkillAgentEnabled,
    startRecover,
    startReview,
    openConfirmation,
    applyPreparedOperation,
    setSensitiveVisible,
    setConvertTarget,
    openGlobalSearch,
    closeGlobalSearch,
    chooseGlobalAsset,
  };

  const frameStyle = {
    '--library-width': `${state.libraryWidth}px`,
    '--inspector-width': `${state.inspectorWidth}px`,
  } as CSSProperties;

  return (
    <main className="mock-root">
      <section
        className={`mock-frame variant-${visualVariant.toLowerCase()} ${
          state.focused ? 'is-focused' : ''
        }`}
        data-viewport={state.viewport}
        data-b2-narrow={b2Narrow ? 'true' : undefined}
        style={frameStyle}
        aria-label={`Agent Config Manager UI Mock，方案 ${visualVariant}`}
      >
        {visualVariant === 'A' && <VariantA {...sharedProps} />}
        {visualVariant === 'B' && <VariantB {...sharedProps} />}
        {visualVariant === 'C' && <VariantC {...sharedProps} />}
        {visualVariant === 'selected' && <SelectedLayout {...sharedProps} />}
      </section>

      {state.variant === 'selected' && state.globalSearchOpen && (
        <GlobalSearchOverlay
          state={state}
          assets={b2AssetSnapshots}
          searchRef={globalSearchRef}
          onSearch={(globalSearch) => patchState({ globalSearch })}
          onClose={closeGlobalSearch}
          onChoose={chooseGlobalAsset}
        />
      )}

      {showPrototypeControls && (
        <PrototypeController
          state={state}
          onVariant={(variant) => {
            resetB2Page();
            const filterReset = variantBoundaryFilterReset(state.variant, variant);
            if (variant === 'selected') {
              const nextAsset = resolveB2Asset(b2DefaultSkillId);
              setConvertTarget(b2ConvertTargetForSource(nextAsset.agent));
              patchState({
                variant,
                ...filterReset,
                journey: 'browse',
                stage: 'browse',
                assetId: nextAsset.id,
                assetType: nextAsset.type,
                fileName: nextAsset.files[0].name,
                configContext: b2DefaultContext,
                selectedPanel: 'list',
                selectedStep: b2Narrow ? 'type' : 'list',
                createMode: state.journey === 'create' ? '新建' : state.createMode,
                createName: state.journey === 'create' ? 'new-skill' : state.createName,
                importProject: 'ReinventedWheelAgent',
                targetAssetType: 'Skills',
                targetScope: '项目',
                dirty: false,
                drafts: {},
              });
              return;
            }
            const nextAsset = getAsset('commit-guide');
            setConvertTarget('Codex');
            patchState({
              variant,
              ...filterReset,
              assetId: nextAsset.id,
              assetType: nextAsset.type,
              fileName: nextAsset.files[0].name,
              configContext: `project:${nextAsset.project}`,
              selectedPanel: 'list',
              selectedStep: 'list',
              createMode: state.journey === 'create' ? '新建' : state.createMode,
              createName: state.journey === 'create' ? 'new-skill' : state.createName,
              importProject: 'acme/desktop',
              dirty: false,
              drafts: {},
            });
          }}
          onJourney={chooseJourney}
          onScenario={chooseScenario}
          onCatalogState={(catalogState) => patchState({ catalogState })}
          onViewport={(viewport) =>
            patchState({
              viewport,
              selectedStep:
                state.variant === 'selected' && viewport === 'narrow'
                  ? b2NarrowStepForState(state)
                  : state.selectedStep,
              panelOverlay: null,
              inspectorOpen: viewport === 'narrow' ? null : state.inspectorOpen,
            })
          }
          onReset={() => {
            setPendingTransition(null);
            setSensitiveVisible(false);
            setB2ListControls(createB2ListControls());
            setB2AssetSnapshots(createB2MemorySnapshot(initialB2Assets));
            setState(initialResponsiveMockState());
          }}
        />
      )}

      {state.stage === 'discard' && (
        <FocusedDialog
          b2Icons={state.variant === 'selected'}
          title="保留当前草稿并继续编辑？"
          description="当前资产有未应用的本地更改。MVP 不维护多资产草稿池；默认继续停留在当前资产。"
          tone="warning"
          primaryLabel="继续编辑"
          onPrimary={() => {
            setPendingTransition(null);
            if (state.variant === 'selected') {
              const inlineInstruction = selectedInlineInstructionEdit(state, asset);
              globalSearchDestinationFocusRef.current = null;
              restoreFocusRef.current = document.querySelector<HTMLElement>(
                inlineInstruction ? '.b2-instruction-editor textarea' : '.editor-shell textarea',
              );
              patchState(
                inlineInstruction
                  ? { stage: 'browse', selectedPanel: 'detail', selectedStep: 'detail' }
                  : continueEditingTransitionForState(state),
              );
              return;
            }
            patchState({ journey: 'edit', stage: 'editing' });
          }}
          secondaryLabel={pendingTransition !== null ? '放弃更改并继续' : '放弃草稿并离开'}
          onSecondary={() => {
            if (pendingTransition !== null) {
              setState((previous) => applyDiscardedTransition(previous, pendingTransition));
              setPendingTransition(null);
            } else {
              patchState({
                journey: 'browse',
                stage: 'browse',
                dirty: false,
                drafts: {},
              });
            }
          }}
        />
      )}

      {state.stage === 'confirm' && (
        <FocusedDialog
          b2Icons={state.variant === 'selected'}
          title={
            state.skillTarget?.action === 'install'
              ? `确认安装到 ${convertTarget}？`
              : '确认应用到本地文件？'
          }
          description={
            state.skillTarget?.action === 'install'
              ? '将重新校验磁盘 revision，并以单次事务复制列出的原生文件到该单一目标。搜索索引和前端缓存不会参与授权。'
              : '将重新校验磁盘 revision，并以单次事务写入。搜索索引和前端缓存不会参与授权。'
          }
          tone={state.scenario === 'degraded' ? 'warning' : 'default'}
          details={confirmationDetailsForState(state, asset, convertTarget)}
          detailsLabel={
            state.variant === 'selected' &&
            (state.journey === 'convert' || state.skillTarget?.action === 'install')
              ? '单一目标'
              : undefined
          }
          primaryLabel={state.skillTarget?.action === 'install' ? '确认安装并应用' : '确认并应用'}
          primaryDisabled={selectedWriteBlockReason(state, asset) !== null}
          primaryTitle={selectedWriteBlockReason(state, asset) ?? undefined}
          onPrimary={applyPreparedOperation}
          secondaryLabel="返回审查"
          onSecondary={() => patchState({ stage: 'review' })}
        />
      )}
    </main>
  );
}

interface LayoutProps {
  state: MockUiState;
  asset: MockAsset;
  activeFile: MockAsset['files'][number];
  visibleAssets: MockAsset[];
  selectedAssets: B2MockAsset[];
  selectedApplicableGlobalAssets: B2MockAsset[];
  selectedSourceSections: B2SourceSection[];
  b2Narrow: boolean;
  b2ListControls: B2ListControls;
  b2Page: B2Page<B2MockAsset>;
  b2FirstRowFocusRef: RefObject<HTMLButtonElement>;
  b2ListScrollRef: RefObject<HTMLDivElement>;
  resetB2Page: () => void;
  setB2SortDirection: (direction: B2SortDirection) => void;
  setB2PageSize: (pageSize: B2PageSize) => void;
  changeB2Page: (page: number) => void;
  setInheritanceLayout: (inheritanceLayout: InheritanceLayout) => void;
  searchRef: RefObject<HTMLInputElement>;
  globalSearchRef: RefObject<HTMLInputElement>;
  globalSearchTriggerRef: RefObject<HTMLButtonElement>;
  selectedFilterTriggerRef: RefObject<HTMLButtonElement>;
  sensitiveVisible: boolean;
  convertTarget: string;
  patchState: (patch: Partial<MockUiState>) => void;
  chooseAsset: (assetId: string) => void;
  chooseAssetType: (assetType: AssetType) => void;
  chooseConfigContext: (context: ConfigContext) => void;
  startCreate: (mode: CreateMode) => void;
  startManage: () => void;
  startConvert: () => void;
  startSelectedEdit: () => void;
  startSkillTarget: (assetId: string, action: SkillTargetAction, target: SkillAgentTarget) => void;
  toggleSkillAgentEnabled: (assetId: string, agent: string) => void;
  startRecover: () => void;
  startReview: () => void;
  openConfirmation: (source: HTMLElement) => void;
  applyPreparedOperation: () => void;
  setSensitiveVisible: (visible: boolean) => void;
  setConvertTarget: (target: string) => void;
  openGlobalSearch: () => void;
  closeGlobalSearch: () => void;
  chooseGlobalAsset: (assetId: string) => void;
}

function VariantA(props: LayoutProps): JSX.Element {
  return (
    <>
      <AppHeader {...props} compact={false} />
      <AssetTabs state={props.state} onChoose={props.chooseAssetType} />
      <div className="layout-a">
        <AssetLibrary {...props} mode="A" />
        <ResizeDivider
          label="调整资产库宽度"
          value={props.state.libraryWidth}
          min={248}
          max={430}
          onChange={(libraryWidth) => props.patchState({ libraryWidth })}
        />
        <Workspace {...props} />
      </div>
    </>
  );
}

function VariantB(props: LayoutProps): JSX.Element {
  return (
    <>
      <AppHeader {...props} compact />
      <div className="layout-b">
        <section className="library-b-shell" aria-label="资产库与搜索命令区">
          <AssetTabs state={props.state} onChoose={props.chooseAssetType} compact />
          <AssetLibrary {...props} mode="B" />
        </section>
        <ResizeDivider
          label="调整资产库宽度"
          value={props.state.libraryWidth}
          min={260}
          max={440}
          onChange={(libraryWidth) => props.patchState({ libraryWidth })}
        />
        <section className="workspace-b-shell">
          <WorkspaceCommandStrip {...props} />
          <Workspace {...props} compactHeader />
        </section>
      </div>
    </>
  );
}

function VariantC(props: LayoutProps): JSX.Element {
  return (
    <>
      <AppHeader {...props} compact />
      <div className="layout-c">
        <AssetTypeRail
          state={props.state}
          onChoose={props.chooseAssetType}
          onManage={props.startManage}
        />
        <AssetLibrary {...props} mode="C" />
        <ResizeDivider
          label="调整资产库宽度"
          value={props.state.libraryWidth}
          min={248}
          max={410}
          onChange={(libraryWidth) => props.patchState({ libraryWidth })}
        />
        <Workspace {...props} />
      </div>
    </>
  );
}

function skillTargetsFor(asset: MockAsset): SkillAgentTarget[] {
  return (
    asset.agentTargets ??
    mockAgents.map((agent) => ({
      agent,
      status: agent === asset.agent ? 'recognized' : 'installable',
    }))
  );
}

function targetShortName(agent: string): string {
  if (agent === 'Claude Code') return 'Claude';
  if (agent === 'Gemini CLI') return 'Gemini';
  return agent;
}

const agentLogoSources: Readonly<Record<string, string>> = {
  'Claude Code': claudeCodeLogo,
  Codex: codexLogo,
  'Gemini CLI': googleGeminiLogo,
  OpenCode: openCodeLogo,
};

function AgentBrandMark({ agent }: { agent: string }): JSX.Element {
  const source = agentLogoSources[agent];
  return (
    <span
      className={`b2-agent-logo is-${agent.toLocaleLowerCase().replace(/\s+/g, '-')}`}
      data-b2-agent-logo={agent}
      aria-hidden="true"
    >
      {source !== undefined && <img src={source} alt="" />}
    </span>
  );
}

function SelectedLayout(props: LayoutProps): JSX.Element {
  const { asset, b2Narrow, state, patchState } = props;
  const inlineInstruction = selectedInlineInstructionEdit(state, asset);
  const isBrowseList = state.stage === 'browse' && state.selectedPanel === 'list';
  const isBrowseDetail =
    (state.stage === 'browse' || (state.stage === 'discard' && inlineInstruction)) &&
    state.selectedPanel === 'detail';
  const isEditing = state.stage === 'editing' || (state.stage === 'discard' && !inlineInstruction);
  const isFlow = (
    ['target', 'mapping', 'review', 'confirm', 'result', 'conflict', 'manage', 'recover'] as Stage[]
  ).includes(state.stage);
  // 内容型资产（长期指令/Subagents）在宽/中屏使用 master-detail：列表与内容同属主表面，
  // 共享同一份选中态；窄屏（b2Narrow）与空态仍退回现有“列表 → 详情”单表面栈。
  const isMasterDetail =
    !b2Narrow &&
    (state.assetType === '长期指令' || state.assetType === 'Subagents') &&
    (state.stage === 'browse' || (state.stage === 'discard' && inlineInstruction)) &&
    state.catalogState === 'normal' &&
    props.selectedAssets.length > 0;

  const showContext = !b2Narrow || (!isFlow && state.selectedStep === 'context');
  const showTypes = !b2Narrow || (!isFlow && state.selectedStep === 'type');
  const showMain =
    !b2Narrow || isFlow || state.selectedStep === 'list' || state.selectedStep === 'detail';

  return (
    <>
      <SelectedHeader {...props} />
      <div
        className={`selected-layout b2-layout ${isBrowseList ? 'is-list' : ''} ${
          isBrowseDetail ? 'is-detail' : ''
        } ${isEditing ? 'is-editing' : ''} ${isFlow ? 'is-flow' : ''}`}
      >
        {showTypes && (
          <AssetTypeRail
            state={state}
            onChoose={props.chooseAssetType}
            onManage={props.startManage}
          />
        )}
        {showContext && (
          <ConfigContextSidebar
            state={state}
            chooseConfigContext={props.chooseConfigContext}
            onBack={() => patchState({ selectedStep: 'type' })}
          />
        )}
        {showMain && (
          <main className="b2-main-surface" aria-label="当前配置资产工作区">
            {isMasterDetail ? (
              <div className="b2-master-detail">
                <SelectedCatalog {...props} masterDetail />
                <SelectedAssetDetail {...props} masterDetail />
              </div>
            ) : isBrowseList ? (
              <SelectedCatalog {...props} />
            ) : isBrowseDetail ? (
              <SelectedAssetDetail {...props} />
            ) : isEditing ? (
              <SelectedAssetEditor {...props} />
            ) : (
              <Workspace {...props} />
            )}
          </main>
        )}
      </div>
    </>
  );
}

export function ConfigContextSidebar({
  state,
  chooseConfigContext,
  onBack,
}: Pick<LayoutProps, 'state' | 'chooseConfigContext'> & { onBack?: () => void }): JSX.Element {
  const projectItems = b2ProjectNames.map((project) => ({
    value: `project:${project}` as ConfigContext,
    label: project,
  }));

  return (
    <aside className="config-context-sidebar" aria-label="配置作用域">
      {onBack !== undefined && (
        <button className="rail-context-back" type="button" onClick={onBack}>
          <span className="rail-icon">
            <B2Icon name="arrow-left" />
          </span>
          <span>资产类型</span>
        </button>
      )}
      <button
        className={`context-primary ${state.configContext === 'all' ? 'is-selected' : ''}`}
        type="button"
        aria-current={state.configContext === 'all' ? 'page' : undefined}
        data-b2-focus={state.configContext === 'all' ? 'context' : undefined}
        onClick={() => chooseConfigContext('all')}
      >
        <B2Icon name="database" />
        <span>全部</span>
      </button>
      <button
        className={`context-primary ${state.configContext === 'global' ? 'is-selected' : ''}`}
        type="button"
        aria-current={state.configContext === 'global' ? 'page' : undefined}
        data-b2-focus={state.configContext === 'global' ? 'context' : undefined}
        onClick={() => chooseConfigContext('global')}
      >
        <B2Icon name="globe-2" />
        <span>全局配置</span>
      </button>

      <div className="context-section-heading">项目配置</div>
      <nav aria-label="项目列表">
        {projectItems.map((item) => (
          <button
            key={item.value}
            className={state.configContext === item.value ? 'is-selected' : ''}
            type="button"
            aria-current={state.configContext === item.value ? 'page' : undefined}
            data-b2-focus={state.configContext === item.value ? 'context' : undefined}
            onClick={() => chooseConfigContext(item.value)}
          >
            <B2Icon name="folder" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function SelectedHeader({
  state,
  asset,
  startCreate,
  startManage,
  openGlobalSearch,
  globalSearchTriggerRef,
}: Pick<
  LayoutProps,
  'state' | 'asset' | 'startCreate' | 'startManage' | 'openGlobalSearch' | 'globalSearchTriggerRef'
>): JSX.Element {
  const createBlockReason = selectedWriteBlockReason(state, asset);
  const manageBlockReason = selectedCapabilityBlockReason(state, asset);
  return (
    <header className="selected-header">
      <div className="traffic-lights" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <strong className="selected-product-name">Agent Config Manager</strong>
      <div className="selected-header-status" aria-live="polite">
        {state.scenario === 'stale' && <span className="status-dot warning">索引过期</span>}
        {state.scenario === 'readonly' && <span className="status-dot neutral">只读模式</span>}
      </div>
      <div className="selected-header-actions">
        <button
          ref={globalSearchTriggerRef}
          className="selected-search-trigger"
          type="button"
          onClick={openGlobalSearch}
        >
          <B2Icon name="search" />
          <span>全局搜索</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          className="b2-top-action b2-create-action"
          type="button"
          aria-label="新建或从本地导入配置资产"
          title={createBlockReason ?? undefined}
          disabled={createBlockReason !== null}
          onClick={() => startCreate('新建')}
        >
          <B2Icon name="plus" />
          <span>新建</span>
        </button>
        <button
          className="b2-top-action"
          type="button"
          title={manageBlockReason ?? undefined}
          disabled={manageBlockReason !== null}
          onClick={startManage}
        >
          纳入项目
        </button>
      </div>
    </header>
  );
}

function contextLabel(context: ConfigContext): string {
  if (context === 'all') return '全部';
  return context === 'global' ? '全局配置' : context.slice('project:'.length);
}

const b2FilterStatuses = ['正常', '存在问题', '只读', '漂移', '冲突', '不兼容'] as const;

export function SelectedCatalog({
  state,
  selectedAssets,
  selectedApplicableGlobalAssets,
  selectedSourceSections,
  b2ListControls,
  b2Page,
  b2FirstRowFocusRef,
  b2ListScrollRef,
  selectedFilterTriggerRef,
  resetB2Page,
  setB2SortDirection,
  setB2PageSize,
  changeB2Page,
  setInheritanceLayout,
  patchState,
  chooseAsset,
  toggleSkillAgentEnabled,
  masterDetail = false,
}: Pick<
  LayoutProps,
  | 'state'
  | 'selectedAssets'
  | 'selectedApplicableGlobalAssets'
  | 'selectedSourceSections'
  | 'b2ListControls'
  | 'b2Page'
  | 'b2FirstRowFocusRef'
  | 'b2ListScrollRef'
  | 'selectedFilterTriggerRef'
  | 'resetB2Page'
  | 'setB2SortDirection'
  | 'setB2PageSize'
  | 'changeB2Page'
  | 'setInheritanceLayout'
  | 'patchState'
  | 'chooseAsset'
  | 'toggleSkillAgentEnabled'
> & { masterDetail?: boolean }): JSX.Element {
  const activeFilterCount =
    state.filters.status.length +
    state.filters.agent.length +
    (state.agentFilter === '全部 Agent' ? 0 : 1);

  const toggleFilterValue = (kind: 'status' | 'agent', value: string): void => {
    const current = state.filters[kind];
    const next = current.includes(value)
      ? current.filter((candidate) => candidate !== value)
      : [...current, value];
    resetB2Page();
    patchState({ filters: { ...state.filters, [kind]: next } });
  };

  const clearFilters = (): void => {
    resetB2Page();
    patchState({
      agentFilter: '全部 Agent',
      filters: { status: [], agent: [] },
    });
  };

  const pageNumbers = Array.from({ length: b2Page.totalPages }, (_, index) => index + 1);
  const isAllContext = state.configContext === 'all';
  const isProjectContext = state.configContext.startsWith('project:');
  const showInheritanceSwitcher =
    typeof window !== 'undefined' &&
    controlsEnabledFromSearch(window.location.search) &&
    isProjectContext &&
    state.stage === 'browse';
  const projectAssets = selectedAssets.filter((candidate) => candidate.scope === '项目');
  const globalAssets = selectedAssets.filter((candidate) => candidate.scope === '全局');
  const catalogSummaryTotal =
    isProjectContext && state.inheritanceLayout === 'C'
      ? b2Page.totalItems + selectedApplicableGlobalAssets.length
      : b2Page.totalItems;
  const renderRows = (assets: readonly B2MockAsset[], offset = 0): JSX.Element[] =>
    assets.map((candidate, index) => (
      <SelectedAssetRow
        key={candidate.id}
        asset={candidate}
        selected={candidate.id === state.assetId}
        rowRef={index + offset === 0 ? b2FirstRowFocusRef : undefined}
        onChoose={() => chooseAsset(candidate.id)}
        onToggleAgent={(target) => toggleSkillAgentEnabled(candidate.id, target.agent)}
      />
    ));
  // “全部”视图：当前页按来源连续分组渲染分段标题；段内排序/筛选/分页契约与项目视图一致。
  const renderAllSectionRows = (): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    let offset = 0;
    let currentSection: { key: string; assets: B2MockAsset[] } | null = null;
    const flushSection = (): void => {
      const pending = currentSection;
      if (pending === null || pending.assets.length === 0) return;
      const full = selectedSourceSections.find((section) => section.key === pending.key);
      const label = full?.label ?? pending.key;
      rows.push(
        <li
          key={`section-${pending.key}`}
          className={`b2-source-section ${pending.key === 'global' ? 'is-global' : ''}`}
          aria-label={pending.key === 'global' ? '全局适用资产' : `${label} 项目资产`}
        >
          {label} · {full?.assets.length ?? pending.assets.length} 项
        </li>,
      );
      rows.push(...renderRows(pending.assets, offset));
      offset += pending.assets.length;
      currentSection = null;
    };
    for (const candidate of selectedAssets) {
      const key = candidate.scope === '全局' ? 'global' : `project:${candidate.project}`;
      if (currentSection === null || currentSection.key !== key) {
        flushSection();
        currentSection = { key, assets: [] };
      }
      currentSection.assets.push(candidate);
    }
    flushSection();
    return rows;
  };
  const tableHead = (
    <div className="b2-table-head">
      <span>名称与状态</span>
      <span>来源或路径</span>
      {state.assetType === 'Skills' ? (
        <span className="b2-head-targets">
          <span className="b2-visually-hidden">Agent 启用预览</span>
          {mockAgents.map((agent) => (
            <span
              key={agent}
              className="b2-head-agent"
              role="img"
              aria-label={targetShortName(agent)}
              title={targetShortName(agent)}
            >
              <AgentBrandMark agent={agent} />
            </span>
          ))}
        </span>
      ) : (
        <span>主要 Agent</span>
      )}
    </div>
  );
  const list = (
    <div ref={b2ListScrollRef} className="selected-catalog-list" aria-live="polite">
      {!masterDetail && tableHead}
      {state.scenario === 'stale' && (
        <InlineNotice b2Icons tone="warning" title="索引可能过期">
          当前类型仍可浏览；重新索引前不会据此授权写入。
          <span className="reason-code">原因码：INDEX_STALE</span>
          <button type="button" onClick={() => patchState({ notice: '正在模拟重建索引…' })}>
            重建
          </button>
        </InlineNotice>
      )}
      {state.catalogState === 'loading' && <LibraryLoading />}
      {state.catalogState === 'empty' && (
        <EmptyState
          b2Icons
          title={`${state.assetType} 还没有资产`}
          description="当前上下文中没有已发现资产。"
        />
      )}
      {state.catalogState === 'normal' && selectedAssets.length === 0 && (
        <EmptyState b2Icons title="没有匹配结果" description="清除筛选后再试。" />
      )}
      {state.catalogState === 'normal' && selectedAssets.length > 0 && (
        <ul className="selected-asset-list" aria-label={`${state.assetType} 资产列表`}>
          {isAllContext ? (
            renderAllSectionRows()
          ) : (
            <>
              {isProjectContext && state.inheritanceLayout === 'A' && projectAssets.length > 0 && (
                <li className="b2-source-section" aria-label="项目自有资产">
                  项目自有
                </li>
              )}
              {state.inheritanceLayout === 'A'
                ? renderRows(projectAssets)
                : renderRows(selectedAssets)}
              {isProjectContext && state.inheritanceLayout === 'A' && globalAssets.length > 0 && (
                <li className="b2-source-section is-global" aria-label="全局适用资产">
                  全局适用
                </li>
              )}
              {state.inheritanceLayout === 'A' && renderRows(globalAssets, projectAssets.length)}
            </>
          )}
        </ul>
      )}
    </div>
  );

  return (
    <section
      className={`selected-catalog ${
        isProjectContext ? `is-inheritance-${state.inheritanceLayout.toLowerCase()}` : ''
      } ${masterDetail ? 'is-master-detail' : ''}`}
      aria-label={`${state.assetType} 资产列表`}
    >
      <button
        className="b2-stack-back"
        type="button"
        onClick={() => patchState({ selectedStep: 'context' })}
      >
        <B2Icon name="arrow-left" />
        返回作用域
      </button>

      <header className="selected-catalog-heading">
        <div>
          <div className="asset-breadcrumb" aria-label="当前上下文">
            <span>{contextLabel(state.configContext)}</span>
            <B2Icon name="chevron-right" size={14} />
            <span>{state.assetType}</span>
          </div>
          <h1 className="b2-visually-hidden">{state.assetType} 资产列表</h1>
          <p>{b2CatalogSummary(state.configContext, catalogSummaryTotal)}</p>
        </div>
        <div className="b2-list-actions">
          <button
            ref={selectedFilterTriggerRef}
            className={`filter-button ${activeFilterCount > 0 ? 'is-active' : ''}`}
            type="button"
            aria-expanded={state.filterOpen}
            onClick={() => patchState({ filterOpen: !state.filterOpen })}
          >
            <B2Icon name="filter" />
            筛选{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
          </button>
          <button
            className="b2-sort-button"
            type="button"
            aria-label={`当前按名称${b2ListControls.sortDirection === 'asc' ? '升序' : '降序'}；点击切换`}
            onClick={() =>
              setB2SortDirection(b2ListControls.sortDirection === 'asc' ? 'desc' : 'asc')
            }
          >
            <B2Icon name="arrow-up-down" />
            <span>按名称排序</span>
            <B2Icon name="chevron-down" size={14} />
          </button>
        </div>
        {showInheritanceSwitcher && (
          <InheritanceDemoSwitcher
            value={state.inheritanceLayout}
            onChange={setInheritanceLayout}
          />
        )}
        {state.filterOpen && (
          <div className="filter-popover b2-filter-popover" role="dialog" aria-label="筛选当前资产">
            <div className="filter-popover-header">
              <strong>筛选 {state.assetType}</strong>
              <button type="button" onClick={clearFilters}>
                清除
              </button>
            </div>
            <fieldset>
              <legend>适用 Agent</legend>
              {mockAgents.map((agent) => (
                <label key={agent}>
                  <input
                    type="checkbox"
                    checked={state.filters.agent.includes(agent)}
                    onChange={() => toggleFilterValue('agent', agent)}
                  />
                  {agent}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>状态</legend>
              {b2FilterStatuses.map((status) => (
                <label key={status}>
                  <input
                    type="checkbox"
                    checked={state.filters.status.includes(status)}
                    onChange={() => toggleFilterValue('status', status)}
                  />
                  {status}
                </label>
              ))}
            </fieldset>
          </div>
        )}
      </header>

      {isProjectContext && state.inheritanceLayout === 'C' ? (
        <div className="b2-inheritance-c-body">
          <div className="b2-inheritance-c-table">{list}</div>
          <InheritedAssetsAside
            assets={selectedApplicableGlobalAssets}
            assetType={state.assetType}
            selectedAssetId={state.assetId}
            onChoose={chooseAsset}
          />
        </div>
      ) : (
        list
      )}

      <footer className="selected-catalog-footer">
        <span>
          {isProjectContext && state.inheritanceLayout === 'C'
            ? `项目自有 ${b2Page.totalItems} 项 · 全局适用 ${selectedApplicableGlobalAssets.length} 项`
            : `共 ${b2Page.totalItems} 项`}
        </span>
        <div className="b2-pagination">
          <label>
            <span>每页显示</span>
            <select
              value={b2ListControls.pageSize}
              onChange={(event) => setB2PageSize(Number(event.currentTarget.value) as B2PageSize)}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <button
            type="button"
            aria-label="上一页"
            disabled={b2Page.page <= 1}
            onClick={() => changeB2Page(b2Page.page - 1)}
          >
            <B2Icon name="chevron-left" />
          </button>
          {pageNumbers.map((page) => (
            <button
              key={page}
              className={page === b2Page.page ? 'is-current' : ''}
              type="button"
              aria-current={page === b2Page.page ? 'page' : undefined}
              onClick={() => changeB2Page(page)}
            >
              {page}
            </button>
          ))}
          <button
            type="button"
            aria-label="下一页"
            disabled={b2Page.page >= b2Page.totalPages}
            onClick={() => changeB2Page(b2Page.page + 1)}
          >
            <B2Icon name="chevron-right" />
          </button>
        </div>
      </footer>
    </section>
  );
}

function InheritanceDemoSwitcher({
  value,
  onChange,
}: {
  value: InheritanceLayout;
  onChange: (value: InheritanceLayout) => void;
}): JSX.Element {
  const options: Array<{ value: InheritanceLayout; label: string }> = [
    { value: 'A', label: 'A 分段同表' },
    { value: 'B', label: 'B 统一混排' },
    { value: 'C', label: 'C 继承侧栏' },
  ];
  return (
    <div className="b2-inheritance-switcher" role="group" aria-label="项目与全局资产布局方案">
      <span>DEV · 方案</span>
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? 'is-selected' : ''}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function InheritedAssetsAside({
  assets,
  assetType,
  selectedAssetId,
  onChoose,
}: {
  assets: readonly B2MockAsset[];
  assetType: AssetType;
  selectedAssetId: string;
  onChoose: (assetId: string) => void;
}): JSX.Element {
  return (
    <aside className="b2-inheritance-aside" aria-label="全局适用资产">
      <header>
        <span>全局适用</span>
        <small>{assets.length} 项</small>
      </header>
      <p>当前 Mock 假设这些全局资产适用于本项目。</p>
      {assets.length === 0 ? (
        <span className="b2-inheritance-empty">没有匹配的全局资产</span>
      ) : (
        <ul>
          {assets.map((asset) => (
            <li key={asset.id}>
              <button
                className={asset.id === selectedAssetId ? 'is-selected' : ''}
                type="button"
                aria-current={asset.id === selectedAssetId ? 'true' : undefined}
                onClick={() => onChoose(asset.id)}
              >
                <strong>{asset.name}</strong>
                <span>
                  {assetSourceLabel(asset)} · {asset.agent}
                </span>
                {assetType === 'Skills' && (
                  <small>
                    {skillTargetsFor(asset)
                      .map(
                        (target) =>
                          `${targetShortName(target.agent)} ${skillTargetToggleLabel(target)}`,
                      )
                      .join(' · ')}
                  </small>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function assetIconName(type: AssetType): B2IconName {
  if (type === 'Skills') return 'file-code-2';
  if (type === '长期指令') return 'file-text';
  if (type === 'Subagents') return 'bot';
  return 'webhook';
}

function targetStatusLabel(status: SkillAgentTarget['status']): string {
  if (status === 'recognized') return '已识别';
  if (status === 'installable') return '可安装';
  if (status === 'convertible') return '可转换';
  return '阻断';
}

function skillTargetEnabled(target: SkillAgentTarget): boolean {
  return target.enabled ?? target.status === 'recognized';
}

function skillTargetToggleLabel(target: SkillAgentTarget): string {
  if (target.status === 'blocked') return '不可用';
  return skillTargetEnabled(target) ? '已启用' : '已停用';
}

function assetSourceLabel(asset: MockAsset): string {
  return asset.scope === '全局' ? '全局适用' : '项目自有';
}

function renderSourcePathWithBreaks(path: string): ReactNode[] {
  return path
    .split('/')
    .flatMap((segment, index) => (index === 0 ? [segment] : ['/', <wbr key={index} />, segment]));
}

export function SelectedAssetRow({
  asset,
  selected,
  rowRef,
  onChoose,
  onToggleAgent,
}: {
  asset: B2MockAsset;
  selected: boolean;
  rowRef?: RefObject<HTMLButtonElement>;
  onChoose: () => void;
  onToggleAgent: (target: SkillAgentTarget) => void;
}): JSX.Element {
  const decisionStatus = b2AssetDecisionStatus(asset);
  const blockReason = b2AssetBlockReason(asset);
  const isSkill = asset.type === 'Skills';
  return (
    <li className={`b2-asset-row ${selected ? 'is-selected' : ''}`} onClick={onChoose}>
      <button
        ref={rowRef}
        className="b2-row-primary"
        type="button"
        aria-current={selected ? 'true' : undefined}
        data-b2-focus={selected ? 'list' : undefined}
        aria-label={isSkill ? '查看 Skill：' + asset.name : '查看资产：' + asset.name}
        onClick={(event) => {
          event.stopPropagation();
          onChoose();
        }}
      >
        <span className="b2-row-icon">
          <B2Icon name={assetIconName(asset.type)} />
        </span>
        <span className="b2-row-name-block">
          <strong>{asset.name}</strong>
          <span className="b2-row-meta">
            {isSkill && <span>查看 Skill</span>}
            <span
              className={'b2-source-badge is-' + (asset.scope === '全局' ? 'global' : 'project')}
            >
              {assetSourceLabel(asset)}
            </span>
            <span
              className={`b2-health ${
                decisionStatus === '正常'
                  ? 'is-ok'
                  : decisionStatus === '不兼容'
                    ? 'is-incompatible'
                    : 'is-warning'
              }`}
            >
              {decisionStatus === '不兼容' ? <B2Icon name="alert-triangle" size={13} /> : <i />}
              {decisionStatus}
            </span>
            {asset.issueCount !== undefined && (
              <span className="b2-issue-count">{asset.issueCount} 项问题</span>
            )}
            {blockReason === null ? (
              <>
                <span>版本 {asset.version}</span>
                <span>{asset.updatedLabel}</span>
              </>
            ) : (
              <span className="b2-block-reason">
                <B2Icon name="alert-triangle" size={12} />
                <span>原因：{blockReason}</span>
              </span>
            )}
          </span>
        </span>
      </button>
      <button
        className="b2-row-path"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onChoose();
        }}
      >
        {renderSourcePathWithBreaks(asset.sourcePath)}
      </button>
      <div className="b2-row-targets" role="group" aria-label={asset.name + ' 的 Agent 启用状态'}>
        {isSkill ? (
          skillTargetsFor(asset).map((target) => (
            <label
              key={target.agent}
              className={
                'b2-agent-toggle is-' +
                target.status +
                (skillTargetEnabled(target) ? ' is-enabled' : '')
              }
              title={
                target.reason ??
                targetShortName(target.agent) + ' ' + skillTargetToggleLabel(target)
              }
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={skillTargetEnabled(target)}
                disabled={target.status === 'blocked'}
                aria-label={
                  target.agent +
                  '：' +
                  skillTargetToggleLabel(target) +
                  (target.reason === undefined ? '' : '；' + target.reason)
                }
                onChange={() => onToggleAgent(target)}
              />
              <AgentBrandMark agent={target.agent} />
            </label>
          ))
        ) : (
          <span className="b2-primary-agent">{asset.agent}</span>
        )}
      </div>
    </li>
  );
}

function SelectedAssetDetail({
  state,
  asset,
  patchState,
  startConvert,
  startSelectedEdit,
  startSkillTarget,
  startReview,
  toggleSkillAgentEnabled,
  masterDetail = false,
}: Pick<
  LayoutProps,
  | 'state'
  | 'asset'
  | 'patchState'
  | 'startConvert'
  | 'startSelectedEdit'
  | 'startSkillTarget'
  | 'startReview'
  | 'toggleSkillAgentEnabled'
> & { masterDetail?: boolean }): JSX.Element {
  const metadata = 'version' in asset ? (asset as B2MockAsset) : null;
  const writeBlockReason = selectedWriteBlockReason(state, asset);
  const readOnly = writeBlockReason !== null;
  const isSkill = asset.type === 'Skills';
  const isInstruction = asset.type === '长期指令';
  const instructionFile =
    asset.files.find((file) => file.name === state.fileName) ?? asset.files[0];

  return (
    <section
      className="selected-skill-detail b2-detail-surface"
      aria-label={`${asset.name} 结构化详情`}
    >
      {masterDetail ? null : (
        <button
          className="b2-stack-back"
          type="button"
          data-b2-focus="detail"
          onClick={() => patchState({ selectedPanel: 'list', selectedStep: 'list' })}
        >
          <B2Icon name="arrow-left" />
          返回列表
        </button>
      )}
      <header className="selected-detail-header">
        <div>
          <div className="asset-breadcrumb">
            <span>{contextLabel(state.configContext)}</span>
            <B2Icon name="chevron-right" size={14} />
            <span>{state.assetType}</span>
            <B2Icon name="chevron-right" size={14} />
            <span>{asset.name}</span>
          </div>
          <h1 data-b2-focus="global-search-detail" tabIndex={-1}>
            {asset.name}
          </h1>
          <p>{asset.description}</p>
        </div>
        <div className="asset-actions">
          {isSkill ? (
            <span className="b2-view-only-note">查看 Skill</span>
          ) : isInstruction ? (
            <button
              className="primary-button"
              type="button"
              disabled={readOnly || !state.dirty}
              onClick={startReview}
            >
              <B2Icon name={readOnly ? 'file-code-2' : 'edit-3'} />
              {readOnly ? '只读查看' : '审查更改'}
            </button>
          ) : (
            <>
              <button
                className="quiet-button"
                type="button"
                title={writeBlockReason ?? undefined}
                disabled={writeBlockReason !== null}
                onClick={startConvert}
              >
                <B2Icon name="sparkles" />跨 Agent 转换
              </button>
              <button className="primary-button" type="button" onClick={startSelectedEdit}>
                <B2Icon name={readOnly ? 'file-code-2' : 'edit-3'} />
                {readOnly ? '查看源码' : '编辑源码'}
              </button>
            </>
          )}
        </div>
      </header>

      {writeBlockReason !== null && (
        <div className="b2-write-block-reason" role="status">
          <B2Icon name="alert-triangle" />
          <span>{writeBlockReason}</span>
        </div>
      )}

      {isInstruction ? (
        <div className="b2-instruction-detail">
          <section className="b2-instruction-status" aria-label="Agent 使用状态">
            <div>
              <span className="b2-instruction-status-label">Agent 使用状态</span>
              <span className="b2-instruction-agent">
                <AgentBrandMark agent={asset.agent} />
                <strong>{targetShortName(asset.agent)}</strong>
                <span>使用中</span>
              </span>
            </div>
            <dl>
              <div>
                <dt>来源</dt>
                <dd>{asset.scope === '全局' ? '全局配置' : asset.project}</dd>
              </div>
              <div>
                <dt>作用域</dt>
                <dd>{asset.scope}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{metadata?.updatedLabel ?? '由本地索引提供'}</dd>
              </div>
            </dl>
          </section>

          <section className="b2-instruction-editor" aria-label="Markdown 内容">
            <header>
              <div>
                <h2>Markdown 内容</h2>
                <p>
                  {readOnly
                    ? '当前场景仅可查看原生内容。'
                    : '直接编辑当前文件；草稿只保存在 Mock 会话内，审查并确认前不会写入配置。'}
                </p>
              </div>
              <span>{instructionFile.name}</span>
            </header>
            <textarea
              aria-label={`${instructionFile.name} Markdown 草稿`}
              spellCheck={false}
              readOnly={readOnly}
              value={state.drafts[instructionFile.name] ?? instructionFile.content}
              onChange={(event) => {
                const drafts = {
                  ...state.drafts,
                  [instructionFile.name]: event.currentTarget.value,
                };
                patchState({ drafts, dirty: draftDirtyForState(state, asset, drafts) });
              }}
            />
            <footer>
              <span>{readOnly ? '只读内容 · 不可写入' : 'Mock 会话草稿 · 未写入配置'}</span>
              <span>{state.dirty ? '存在未审查更改' : '未检测到更改'}</span>
            </footer>
          </section>
        </div>
      ) : (
        <>
          <div className="b2-detail-grid">
            <section className="b2-detail-section is-wide">
              <h2>结构化信息</h2>
              <dl>
                <div>
                  <dt>资产类型</dt>
                  <dd>{asset.type}</dd>
                </div>
                <div>
                  <dt>来源上下文</dt>
                  <dd>{asset.scope === '全局' ? '全局配置' : asset.project}</dd>
                </div>
                <div>
                  <dt>作用域</dt>
                  <dd>{asset.scope}</dd>
                </div>
                <div>
                  <dt>主要 Agent</dt>
                  <dd>{asset.agent}</dd>
                </div>
                <div>
                  <dt>版本</dt>
                  <dd>{metadata?.version ?? '原生定义'}</dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd>{metadata?.updatedLabel ?? '由本地索引提供'}</dd>
                </div>
              </dl>
            </section>

            <section className="b2-detail-section is-wide">
              <h2>{isSkill ? '多个 Agent 启用预览' : 'Agent 适用状态'}</h2>
              <p>
                {isSkill
                  ? 'Mock 会话预览，不写入配置；阻断目标不可切换，刷新后恢复 seed。'
                  : '可安装与可转换状态只进入 prepare / review / confirm，不执行即时启停。'}
              </p>
              <div className="b2-detail-targets">
                {skillTargetsFor(asset).map((target) => {
                  const actionable =
                    target.status === 'installable' || target.status === 'convertible';
                  return (
                    <div key={target.agent}>
                      <span className={`b2-agent-chip is-${target.status}`}>
                        <i />
                        {targetShortName(target.agent)}
                      </span>
                      <span>
                        {isSkill
                          ? skillTargetToggleLabel(target)
                          : targetStatusLabel(target.status)}
                      </span>
                      {isSkill ? (
                        <label className="b2-detail-toggle">
                          <input
                            type="checkbox"
                            checked={skillTargetEnabled(target)}
                            disabled={target.status === 'blocked'}
                            aria-label={
                              target.agent +
                              '：' +
                              skillTargetToggleLabel(target) +
                              (target.reason === undefined ? '' : '；' + target.reason)
                            }
                            onChange={() => toggleSkillAgentEnabled(asset.id, target.agent)}
                          />
                          <span>
                            {target.status === 'blocked'
                              ? '不可切换'
                              : skillTargetEnabled(target)
                                ? '停用'
                                : '启用'}
                          </span>
                        </label>
                      ) : actionable ? (
                        <button
                          type="button"
                          title={writeBlockReason ?? undefined}
                          disabled={writeBlockReason !== null}
                          onClick={() =>
                            startSkillTarget(
                              asset.id,
                              target.status === 'installable' ? 'install' : 'convert',
                              target,
                            )
                          }
                        >
                          {target.status === 'installable' ? '准备安装' : '准备转换'}
                        </button>
                      ) : (
                        <small>{target.reason ?? '无需操作'}</small>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
          {masterDetail && asset.type === 'Subagents' && (
            <section className="b2-subagent-body" aria-label="正文内容">
              <header>
                <h2>正文内容</h2>
                <span>{instructionFile.name}</span>
              </header>
              <SourcePreview content={instructionFile.content} highlight />
            </section>
          )}
        </>
      )}
    </section>
  );
}

function SelectedAssetEditor({
  state,
  asset,
  activeFile,
  patchState,
  startReview,
}: Pick<
  LayoutProps,
  'state' | 'asset' | 'activeFile' | 'patchState' | 'startReview'
>): JSX.Element {
  const isBinary = activeFile.language === 'binary';
  const readOnly = selectedWriteBlockReason(state, asset) !== null;
  return (
    <section
      className="selected-skill-editor b2-editor-surface"
      aria-label={`${asset.name} ${readOnly ? '源码查看' : '源码编辑'}`}
    >
      <button
        className="b2-stack-back"
        type="button"
        data-b2-focus="detail"
        onClick={() =>
          patchState(
            state.dirty
              ? { stage: 'discard' }
              : {
                  journey: 'browse',
                  stage: 'browse',
                  selectedPanel: 'detail',
                  selectedStep: 'detail',
                },
          )
        }
      >
        <B2Icon name="arrow-left" />
        返回结构化详情
      </button>
      <header className="selected-editor-header">
        <div>
          <div className="asset-breadcrumb">
            <span>{asset.scope === '全局' ? '全局配置' : asset.project}</span>
            <B2Icon name="chevron-right" size={14} />
            <span>{state.assetType}</span>
            <B2Icon name="chevron-right" size={14} />
            <span>{readOnly ? '查看源码' : '编辑源码'}</span>
          </div>
          <h1>{asset.name}</h1>
          <p>
            {readOnly
              ? '当前资产只读；此处仅展示原生源码和文件，不允许编辑或写入。'
              : '草稿只保存在当前 Mock 内存中，审查并确认前不会写入磁盘。'}
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={readOnly || !state.dirty}
          onClick={startReview}
        >
          {readOnly ? '只读查看' : '审查更改'}
        </button>
      </header>

      {readOnly && (
        <InlineNotice b2Icons tone="warning" title="当前资产只读">
          可以查看源码，但本场景不会授权写入。
        </InlineNotice>
      )}

      <div className="selected-editor-body">
        <aside className="b2-editor-files" aria-label="资产文件">
          <h2>原生文件</h2>
          {asset.files.map((file) => (
            <button
              key={file.name}
              className={file.name === activeFile.name ? 'is-selected' : ''}
              type="button"
              onClick={() => patchState({ fileName: file.name })}
            >
              <B2Icon name={file.language === 'binary' ? 'database' : 'file-text'} />
              <span>{file.name}</span>
            </button>
          ))}
        </aside>
        <section className="native-document" aria-label="原生源码">
          <div className="document-toolbar">
            <div className="file-identity">
              <B2Icon name={isBinary ? 'database' : 'file-code-2'} />
              <strong>{activeFile.name}</strong>
              {state.dirty && <span className="dirty-indicator">未应用</span>}
            </div>
            <span>{activeFile.language}</span>
          </div>
          {isBinary ? (
            <NonTextPreview />
          ) : (
            <div className="editor-shell">
              <textarea
                aria-label={`${activeFile.name} 本地草稿`}
                spellCheck={false}
                readOnly={readOnly}
                value={state.drafts[activeFile.name] ?? activeFile.content}
                onChange={(event) => {
                  const drafts = {
                    ...state.drafts,
                    [activeFile.name]: event.currentTarget.value,
                  };
                  const dirty = draftDirtyForState(state, asset, drafts);
                  patchState({ drafts, dirty });
                }}
              />
              <footer className="editor-footer">
                <span>{readOnly ? '只读源码 · 不可写入' : '本地草稿 · 未写入磁盘'}</span>
                <span>
                  {readOnly ? '查看模式' : state.dirty ? '存在未应用更改' : '未检测到更改'}
                </span>
              </footer>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function GlobalSearchOverlay({
  state,
  assets,
  searchRef,
  onSearch,
  onClose,
  onChoose,
}: {
  state: MockUiState;
  assets: readonly B2MockAsset[];
  searchRef: RefObject<HTMLInputElement>;
  onSearch: (value: string) => void;
  onClose: () => void;
  onChoose: (assetId: string) => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);
  const results = searchB2Assets(
    assets.filter((asset) =>
      selectedAssetTypes.includes(asset.type as (typeof selectedAssetTypes)[number]),
    ),
    state.globalSearch,
  );
  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), button:not(:disabled)',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="global-search-layer" role="presentation">
      <button
        className="global-search-scrim"
        type="button"
        aria-label="关闭全局搜索"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="global-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索资产"
        onKeyDown={trapFocus}
      >
        <header>
          <label className="global-search-field">
            <B2Icon name="search" />
            <input
              ref={searchRef}
              type="search"
              value={state.globalSearch}
              placeholder="搜索全部资产、Agent、项目或描述"
              aria-label="搜索全部资产"
              onChange={(event) => onSearch(event.currentTarget.value)}
            />
            <kbd>Esc</kbd>
          </label>
          <button className="b2-icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <B2Icon name="x" />
          </button>
        </header>
        <div className="global-search-results">
          <p className="b2-search-count">共 {results.length} 项；全局搜索结果不分页。</p>
          {results.length === 0 ? (
            <EmptyState
              b2Icons
              title="没有匹配的资产"
              description="尝试名称、Agent、项目或资产类型。"
            />
          ) : (
            selectedAssetTypes.map((type) => {
              const grouped = results.filter((asset) => asset.type === type);
              if (grouped.length === 0) return null;
              return (
                <section key={type}>
                  <h2>{type}</h2>
                  {grouped.map((candidate) => (
                    <button key={candidate.id} type="button" onClick={() => onChoose(candidate.id)}>
                      <B2Icon name={assetIconName(candidate.type)} />
                      <span>
                        <strong>{candidate.name}</strong>
                        <small>{candidate.description}</small>
                      </span>
                      <span>{candidate.project}</span>
                      <span>{candidate.agent}</span>
                    </button>
                  ))}
                </section>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function AppHeader({
  state,
  startCreate,
  startManage,
  compact,
}: LayoutProps & { compact: boolean }): JSX.Element {
  return (
    <header className={`app-header ${compact ? 'is-compact' : ''}`}>
      <div className="traffic-lights" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="app-identity">
        <span className="app-mark" aria-hidden="true">
          AC
        </span>
        <span>
          <strong>Agent Config Manager</strong>
          {!compact && <small>本地资产工作台</small>}
        </span>
      </div>
      <div className="header-context">
        <span className="context-pill">acme/desktop</span>
        {state.scenario === 'stale' && <span className="status-dot warning">索引过期</span>}
        {state.scenario === 'readonly' && <span className="status-dot neutral">只读模式</span>}
      </div>
      <div className="header-actions">
        <button className="quiet-button" type="button" onClick={() => startCreate('新建')}>
          ＋ 新建
        </button>
        <button className="quiet-button" type="button" onClick={() => startCreate('从本地导入')}>
          ⇩ 本地导入
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="打开管理"
          title="项目与 Agent 管理"
          onClick={startManage}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}

function AssetTabs({
  state,
  onChoose,
  compact = false,
}: {
  state: MockUiState;
  onChoose: (assetType: AssetType) => void;
  compact?: boolean;
}): JSX.Element {
  return (
    <nav className={`asset-tabs ${compact ? 'is-compact' : ''}`} aria-label="资产类型">
      {assetTypes.map((type) => (
        <button
          key={type}
          className={state.assetType === type ? 'is-selected' : ''}
          type="button"
          aria-current={state.assetType === type ? 'page' : undefined}
          onClick={() => onChoose(type)}
        >
          <span>{type}</span>
          <small>{mockAssets.filter((asset) => asset.type === type).length}</small>
        </button>
      ))}
    </nav>
  );
}

export function AssetTypeRail({
  state,
  onChoose,
  onManage,
  onBack,
}: {
  state: MockUiState;
  onChoose: (assetType: AssetType) => void;
  onManage: () => void;
  onBack?: () => void;
}): JSX.Element {
  const legacyIcons: Record<AssetType, string> = {
    Skills: 'S',
    长期指令: 'I',
    Subagents: 'A',
    Hooks: 'H',
  };
  const selectedIcons: Record<AssetType, B2IconName> = {
    Skills: 'layers-3',
    长期指令: 'file-text',
    Subagents: 'bot',
    Hooks: 'webhook',
  };
  const isSelected = state.variant === 'selected';
  return (
    <nav className="asset-type-rail" aria-label="资产类型">
      {onBack !== undefined && (
        <button className="rail-context-back" type="button" onClick={onBack}>
          <span className="rail-icon">{isSelected ? <B2Icon name="arrow-left" /> : '‹'}</span>
          <span>配置上下文</span>
        </button>
      )}
      {(isSelected ? selectedAssetTypes : assetTypes).map((type) => (
        <button
          key={type}
          className={state.assetType === type ? 'is-selected' : ''}
          type="button"
          aria-current={state.assetType === type ? 'page' : undefined}
          data-b2-focus={isSelected && state.assetType === type ? 'type' : undefined}
          onClick={() => onChoose(type)}
          title={type}
        >
          <span className="rail-icon">
            {isSelected ? <B2Icon name={selectedIcons[type]} /> : legacyIcons[type]}
          </span>
          <span>{isSelected ? type : type === '长期指令' ? '指令' : type}</span>
        </button>
      ))}
      <div className="rail-spacer" />
      <button type="button" title="管理" onClick={onManage}>
        <span className="rail-icon">{isSelected ? <B2Icon name="settings-2" /> : '⚙'}</span>
        <span>管理</span>
      </button>
    </nav>
  );
}

function AssetLibrary({
  state,
  visibleAssets,
  searchRef,
  patchState,
  chooseAsset,
  chooseAssetType,
  mode,
}: LayoutProps & { mode: 'A' | 'B' | 'C' }): JSX.Element {
  const activeFilterCount =
    (state.scopeFilter === '全部' ? 0 : 1) +
    state.filters.status.length +
    state.filters.agent.length +
    (state.agentFilter === '全部 Agent' ? 0 : 1);

  const toggleFilterValue = (kind: 'status' | 'agent', value: string): void => {
    const current = state.filters[kind];
    const next = current.includes(value)
      ? current.filter((candidate) => candidate !== value)
      : [...current, value];
    patchState({ filters: { ...state.filters, [kind]: next } });
  };

  return (
    <aside
      className={`asset-library mode-${mode.toLowerCase()} ${
        state.panelOverlay === 'library' ? 'is-overlay-open' : ''
      }`}
      aria-label="资产库"
    >
      <div className="library-heading">
        <div>
          <span className="eyebrow">资产库</span>
          <h2>{state.searchRange === 'all' ? '全部资产' : state.assetType}</h2>
          <p>{assetTypeHint[state.assetType]}</p>
        </div>
        <button
          className="mobile-close"
          type="button"
          aria-label="关闭资产库"
          onClick={() => patchState({ panelOverlay: null })}
        >
          ×
        </button>
      </div>

      <nav className="mobile-type-switch" aria-label="窄窗口资产类型">
        {assetTypes.map((type) => (
          <button
            key={type}
            className={state.assetType === type ? 'is-selected' : ''}
            type="button"
            onClick={() => chooseAssetType(type)}
          >
            {type === '长期指令' ? '指令' : type}
          </button>
        ))}
      </nav>

      <div className="library-search">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            value={state.search}
            placeholder="搜索名称、Agent 或项目"
            aria-label="搜索资产"
            onChange={(event) => patchState({ search: event.currentTarget.value })}
          />
          <kbd>⌘K</kbd>
        </label>
        <button
          className={`filter-button ${activeFilterCount > 0 ? 'is-active' : ''}`}
          type="button"
          aria-expanded={state.filterOpen}
          onClick={() => patchState({ filterOpen: !state.filterOpen })}
        >
          筛选{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
        {state.filterOpen && (
          <div className="filter-popover" role="dialog" aria-label="资产筛选">
            <div className="filter-popover-header">
              <strong>筛选资产</strong>
              <button
                type="button"
                onClick={() =>
                  patchState({
                    scopeFilter: '全部',
                    agentFilter: '全部 Agent',
                    filters: { status: [], agent: [] },
                  })
                }
              >
                清除
              </button>
            </div>
            <fieldset>
              <legend>作用域</legend>
              <div className="choice-row">
                {(['全部', '全局', '项目'] as const).map((scope) => (
                  <button
                    key={scope}
                    className={state.scopeFilter === scope ? 'is-selected' : ''}
                    type="button"
                    onClick={() => patchState({ scopeFilter: scope })}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Agent</legend>
              {mockAgents.map((agent) => (
                <label key={agent}>
                  <input
                    type="checkbox"
                    checked={state.filters.agent.includes(agent)}
                    onChange={() => toggleFilterValue('agent', agent)}
                  />
                  {agent}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>状态</legend>
              {statusFilters.map((status) => (
                <label key={status}>
                  <input
                    type="checkbox"
                    checked={state.filters.status.includes(status)}
                    onChange={() => toggleFilterValue('status', status)}
                  />
                  {status}
                </label>
              ))}
            </fieldset>
          </div>
        )}
      </div>

      <div className="library-controls">
        <div className="range-toggle" aria-label="搜索范围">
          <button
            className={state.searchRange === 'current' ? 'is-selected' : ''}
            type="button"
            onClick={() => patchState({ searchRange: 'current' })}
          >
            当前类型
          </button>
          <button
            className={state.searchRange === 'all' ? 'is-selected' : ''}
            type="button"
            onClick={() => patchState({ searchRange: 'all' })}
          >
            全部
          </button>
        </div>
        <select
          value={state.agentFilter}
          aria-label="按 Agent 快速筛选"
          onChange={(event) => patchState({ agentFilter: event.currentTarget.value })}
        >
          <option>全部 Agent</option>
          {mockAgents.map((agent) => (
            <option key={agent}>{agent}</option>
          ))}
        </select>
      </div>

      <div className="library-list-shell" aria-live="polite">
        {state.scenario === 'stale' && (
          <InlineNotice tone="warning" title="索引可能过期">
            列表仍可浏览；重新索引前不会据此授权写入。
            <button type="button" onClick={() => patchState({ notice: '正在模拟重建索引…' })}>
              重建
            </button>
          </InlineNotice>
        )}
        {state.scenario === 'failed' && state.journey === 'browse' && (
          <InlineNotice tone="danger" title="无法读取部分目录">
            已保留上次可用快照。检查授权范围后重试。
          </InlineNotice>
        )}
        {state.catalogState === 'loading' && <LibraryLoading />}
        {state.catalogState === 'empty' && (
          <EmptyState
            title="这个范围还没有资产"
            description="调整搜索范围或筛选条件；不会自动纳入项目。"
          />
        )}
        {state.catalogState === 'normal' && visibleAssets.length === 0 && (
          <EmptyState title="没有匹配结果" description="尝试清除筛选，或改为搜索全部资产。" />
        )}
        {state.catalogState === 'normal' && visibleAssets.length > 0 && (
          <ul className="asset-list">
            {visibleAssets.map((candidate) => (
              <li key={candidate.id}>
                <button
                  className={`asset-row ${candidate.id === state.assetId ? 'is-selected' : ''}`}
                  type="button"
                  aria-current={candidate.id === state.assetId ? 'true' : undefined}
                  onClick={() => chooseAsset(candidate.id)}
                >
                  <span className="asset-row-primary">
                    <strong>{candidate.name}</strong>
                    {candidate.status !== undefined && (
                      <span className={`mini-badge ${badgeTone(candidate.status)}`}>
                        {candidate.status}
                      </span>
                    )}
                  </span>
                  <span className="asset-row-secondary">
                    <span>{candidate.agent}</span>
                    <span>{candidate.scope}</span>
                    <span className="truncate">{candidate.project}</span>
                  </span>
                  {state.searchRange === 'all' && (
                    <span className="type-corner">{candidate.type}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="library-footer">
        <span>{state.catalogState === 'normal' ? `${visibleAssets.length} 项` : '—'}</span>
        <span>本地索引 · 2 分钟前</span>
      </footer>
    </aside>
  );
}

function WorkspaceCommandStrip(props: LayoutProps): JSX.Element {
  const { asset, state, startConvert, startRecover, patchState } = props;
  const readOnly =
    state.scenario === 'readonly' || asset.status === '只读' || asset.status === '不兼容';
  return (
    <div className="workspace-command-strip">
      <div className="command-context">
        <span className="eyebrow">当前资产</span>
        <strong>{asset.name}</strong>
        <span>{asset.agent}</span>
      </div>
      <div className="command-actions">
        <button type="button" disabled={readOnly} onClick={startConvert}>
          转换…
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => patchState({ journey: 'edit', stage: 'editing' })}
        >
          编辑
        </button>
        <button type="button" onClick={startRecover}>
          更多…
        </button>
      </div>
    </div>
  );
}

function Workspace({
  state,
  asset,
  activeFile,
  sensitiveVisible,
  convertTarget,
  patchState,
  startConvert,
  startRecover,
  startReview,
  openConfirmation,
  setSensitiveVisible,
  setConvertTarget,
  compactHeader = false,
}: LayoutProps & { compactHeader?: boolean }): JSX.Element {
  let surface: JSX.Element;

  if (state.stage === 'manage') {
    surface = <ManagementSurface state={state} asset={asset} patchState={patchState} />;
  } else if (state.stage === 'recover') {
    surface = <RecoverySurface state={state} asset={asset} patchState={patchState} />;
  } else if (state.stage === 'target') {
    surface = (
      <TargetSetup
        state={state}
        asset={asset}
        convertTarget={convertTarget}
        patchState={patchState}
        setConvertTarget={setConvertTarget}
      />
    );
  } else if (state.stage === 'mapping') {
    surface = (
      <MappingSurface
        state={state}
        asset={asset}
        convertTarget={convertTarget}
        patchState={patchState}
      />
    );
  } else if (state.stage === 'review' || state.stage === 'confirm') {
    surface = (
      <ReviewSurface
        state={state}
        asset={asset}
        activeFile={activeFile}
        convertTarget={convertTarget}
        patchState={patchState}
        openConfirmation={openConfirmation}
      />
    );
  } else if (state.stage === 'result' || state.stage === 'conflict') {
    surface = (
      <OutcomeSurface
        state={state}
        asset={asset}
        convertTarget={convertTarget}
        patchState={patchState}
      />
    );
  } else {
    surface = (
      <AssetSurface
        state={state}
        asset={asset}
        activeFile={activeFile}
        sensitiveVisible={sensitiveVisible}
        patchState={patchState}
        startConvert={startConvert}
        startRecover={startRecover}
        startReview={startReview}
        setSensitiveVisible={setSensitiveVisible}
      />
    );
  }

  return (
    <section
      className={`workspace ${compactHeader ? 'has-compact-header' : ''} ${
        state.panelOverlay === 'inspector' ? 'inspector-overlay-open' : ''
      }`}
      aria-label="主工作区"
    >
      <button
        className="mobile-library-trigger"
        type="button"
        onClick={() => patchState({ panelOverlay: 'library' })}
      >
        {state.variant === 'selected' ? <B2Icon name="panel-left-close" /> : '☰'} 资产库
      </button>
      {state.panelOverlay !== null && (
        <button
          className="panel-scrim"
          type="button"
          aria-label="关闭侧边浮层"
          onClick={() => patchState({ panelOverlay: null, filterOpen: false })}
        />
      )}
      {state.notice !== null &&
        !(
          state.variant === 'selected' &&
          (state.stage === 'result' || state.stage === 'conflict')
        ) && (
          <div className="toast" role="status">
            <span>{state.notice}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => patchState({ notice: null })}
            >
              {state.variant === 'selected' ? <B2Icon name="x" /> : '×'}
            </button>
          </div>
        )}
      {surface}
    </section>
  );
}

function AssetSurface({
  state,
  asset,
  activeFile,
  sensitiveVisible,
  patchState,
  startConvert,
  startRecover,
  startReview,
  setSensitiveVisible,
}: Pick<
  LayoutProps,
  | 'state'
  | 'asset'
  | 'activeFile'
  | 'sensitiveVisible'
  | 'patchState'
  | 'startConvert'
  | 'startRecover'
  | 'startReview'
  | 'setSensitiveVisible'
>): JSX.Element {
  const isEditing = state.stage === 'editing';
  const isBinary = activeFile.language === 'binary';
  const readOnly =
    state.scenario === 'readonly' || asset.status === '只读' || asset.status === '不兼容';
  const hideHistory = state.variant === 'selected';

  return (
    <div className="asset-workspace">
      <header className="asset-header">
        <div>
          <div className="asset-breadcrumb">
            <span>{asset.type}</span>
            <span>/</span>
            <span>{asset.agent}</span>
          </div>
          <h1>{asset.name}</h1>
          <p>{asset.description}</p>
        </div>
        <div className="asset-actions">
          {asset.status !== undefined && (
            <span className={`status-chip ${badgeTone(asset.status)}`}>{asset.status}</span>
          )}
          <button className="quiet-button" type="button" disabled={readOnly} onClick={startConvert}>
            转换…
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={readOnly || isBinary}
            onClick={() =>
              patchState({
                journey: 'edit',
                stage: 'editing',
                drafts:
                  state.drafts[activeFile.name] === undefined
                    ? { ...state.drafts, [activeFile.name]: activeFile.content }
                    : state.drafts,
              })
            }
          >
            {isEditing ? '正在编辑' : '编辑'}
          </button>
          {!hideHistory && (
            <button
              className="icon-button"
              type="button"
              aria-label="更多资产操作"
              onClick={startRecover}
            >
              •••
            </button>
          )}
        </div>
      </header>

      <ScenarioBanner variant={state.variant} scenario={state.scenario} stage={state.stage} />
      {state.scenario !== 'readonly' && (asset.status === '只读' || asset.status === '不兼容') && (
        <InlineNotice b2Icons={state.variant === 'selected'} tone="neutral" title="该资产当前只读">
          {hideHistory
            ? '可浏览原生文件；编辑和转换暂不可用。'
            : '可浏览与导出原生文件；编辑、转换、恢复和删除不可用。'}
          {state.variant === 'selected' && (
            <span className="reason-code">原因码：ASSET_READONLY</span>
          )}
        </InlineNotice>
      )}

      <div className="document-workspace">
        {asset.files.length > 1 && (
          <FileTree
            asset={asset}
            activeFileName={activeFile.name}
            onChoose={(fileName) => patchState({ fileName })}
            overlayOpen={state.panelOverlay === 'files'}
            onClose={() => patchState({ panelOverlay: null })}
            b2Icons={state.variant === 'selected'}
          />
        )}
        <section className="native-document" aria-label="原生内容">
          <div className="document-toolbar">
            <div className="file-identity">
              <span className="file-icon">{isBinary ? '◫' : '≡'}</span>
              <strong>{activeFile.name}</strong>
              {state.dirty && <span className="dirty-indicator">● 未应用</span>}
            </div>
            <div className="document-tools">
              {!isBinary && (
                <div className="view-toggle" aria-label="内容视图">
                  <button
                    className={state.view === 'source' ? 'is-selected' : ''}
                    type="button"
                    onClick={() => patchState({ view: 'source' })}
                  >
                    源码
                  </button>
                  <button
                    className={state.view === 'structured' ? 'is-selected' : ''}
                    type="button"
                    onClick={() => patchState({ view: 'structured' })}
                  >
                    结构化
                  </button>
                </div>
              )}
              {asset.files.length > 1 && (
                <button
                  className="file-tree-trigger"
                  type="button"
                  onClick={() => patchState({ panelOverlay: 'files' })}
                >
                  文件 {asset.files.length}
                </button>
              )}
              <button
                className="icon-button"
                type="button"
                aria-pressed={state.focused}
                title={state.focused ? '退出聚焦' : '聚焦原生内容'}
                onClick={() => patchState({ focused: !state.focused })}
              >
                {state.focused ? '⊙' : '⛶'}
              </button>
              <button
                className="inspector-trigger"
                type="button"
                onClick={() => patchState({ panelOverlay: 'inspector' })}
              >
                检查器
              </button>
            </div>
          </div>

          {isBinary ? (
            <NonTextPreview />
          ) : isEditing ? (
            <div className="editor-shell">
              <textarea
                aria-label={`${activeFile.name} 本地草稿`}
                spellCheck={false}
                value={state.drafts[activeFile.name] ?? activeFile.content}
                onChange={(event) => {
                  const nextDrafts = {
                    ...state.drafts,
                    [activeFile.name]: event.currentTarget.value,
                  };
                  const dirty =
                    state.journey === 'create' ||
                    Object.entries(nextDrafts).some(([name, content]) => {
                      const original = asset.files.find((file) => file.name === name);
                      return original === undefined || original.content !== content;
                    });
                  patchState({ drafts: nextDrafts, dirty });
                }}
              />
              <footer className="editor-footer">
                <span>本地草稿 · 尚未写入磁盘</span>
                <div>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() =>
                      patchState(
                        state.dirty ? { stage: 'discard' } : { journey: 'browse', stage: 'browse' },
                      )
                    }
                  >
                    {state.dirty ? '放弃草稿…' : '退出编辑'}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!state.dirty && state.scenario !== 'dirty'}
                    onClick={startReview}
                  >
                    审查更改
                  </button>
                </div>
              </footer>
            </div>
          ) : state.view === 'structured' ? (
            <StructuredPreview asset={asset} activeFile={activeFile} />
          ) : (
            <SourcePreview content={activeFile.content} highlight={state.variant === 'selected'} />
          )}
        </section>

        <ResizeDivider
          label="调整检查器宽度"
          value={state.inspectorWidth}
          min={220}
          max={360}
          reverse
          onChange={(inspectorWidth) => patchState({ inspectorWidth })}
        />
        <Inspector
          state={state}
          asset={asset}
          sensitiveVisible={sensitiveVisible}
          onClose={() => patchState({ panelOverlay: null })}
          onToggleSensitive={() => setSensitiveVisible(!sensitiveVisible)}
        />
      </div>
    </div>
  );
}

function FileTree({
  asset,
  activeFileName,
  onChoose,
  overlayOpen = false,
  onClose,
  b2Icons = false,
}: {
  asset: MockAsset;
  activeFileName: string;
  onChoose: (name: string) => void;
  overlayOpen?: boolean;
  onClose?: () => void;
  b2Icons?: boolean;
}): JSX.Element {
  return (
    <aside className={`file-tree ${overlayOpen ? 'is-overlay-open' : ''}`} aria-label="资产文件">
      <div className="file-tree-heading">
        <span>文件</span>
        <small>{asset.files.length}</small>
        {onClose !== undefined && (
          <button className="mobile-close" type="button" aria-label="关闭文件树" onClick={onClose}>
            {b2Icons ? <B2Icon name="x" /> : '×'}
          </button>
        )}
      </div>
      {asset.files.map((file) => (
        <button
          key={file.name}
          className={file.name === activeFileName ? 'is-selected' : ''}
          type="button"
          onClick={() => {
            onChoose(file.name);
            if (overlayOpen) onClose?.();
          }}
        >
          <span>
            {b2Icons ? (
              <B2Icon name={file.language === 'binary' ? 'database' : 'file-text'} />
            ) : file.language === 'binary' ? (
              '◫'
            ) : (
              '▤'
            )}
          </span>
          <span className="truncate">{file.name}</span>
          {file.changed && <span className="changed-dot" title="已修改" />}
        </button>
      ))}
    </aside>
  );
}

function tokenizeSourcePlaceholders(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/(<[^>]+>)/g)
    .filter((part) => part.length > 0)
    .map((part, index) =>
      part.startsWith('<') && part.endsWith('>') ? (
        <span key={`${keyPrefix}-${index}`} className="tok-str">
          {part}
        </span>
      ) : (
        part
      ),
    );
}

function colorizeJsonLiterals(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/\b(true|false|null)\b/g).map((part, index) =>
    /^(?:true|false|null)$/.test(part) ? (
      <span key={`${keyPrefix}-${index}`} className="tok-str">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function tokenizeJsonLine(line: string, keyPrefix: string): ReactNode[] {
  const pattern = /("(?:[^"\\]|\\.)*")(\s*:)?/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null = pattern.exec(line);
  while (match !== null) {
    if (match.index > last) {
      nodes.push(...colorizeJsonLiterals(line.slice(last, match.index), `${keyPrefix}-t${index}`));
    }
    const isKey = match[2] !== undefined;
    nodes.push(
      <span key={`${keyPrefix}-m${index}`} className={isKey ? 'tok-key' : 'tok-str'}>
        {match[1]}
      </span>,
    );
    if (isKey) nodes.push(match[2]);
    last = match.index + match[0].length;
    index += 1;
    match = pattern.exec(line);
  }
  if (last < line.length) {
    nodes.push(...colorizeJsonLiterals(line.slice(last), `${keyPrefix}-e`));
  }
  return nodes;
}

/* 轻量语法着色（定稿）：frontmatter/JSON 键蓝色、字符串与占位符绿色、Markdown 标题加粗。 */
function renderSourceTokens(content: string): ReactNode[][] {
  const isJson = content.trimStart().startsWith('{');
  let inFrontmatter = false;
  return content.split('\n').map((line, lineIndex) => {
    const key = `l${lineIndex}`;
    if (isJson) return tokenizeJsonLine(line, key);
    if (line.trim() === '---') {
      inFrontmatter = !inFrontmatter;
      return [
        <span key={key} className="cm">
          {line}
        </span>,
      ];
    }
    if (/^#{1,3}\s/.test(line)) {
      return [
        <span key={key} className="tok-heading">
          {line}
        </span>,
      ];
    }
    if (inFrontmatter) {
      const field = line.match(/^([\w-]+)(:)(.*)$/);
      if (field !== null) {
        return [
          <span key={`${key}-k`} className="tok-key">
            {field[1]}
          </span>,
          field[2],
          ...tokenizeSourcePlaceholders(field[3], `${key}-v`),
        ];
      }
    }
    return tokenizeSourcePlaceholders(line, key);
  });
}

function SourcePreview({
  content,
  highlight = false,
}: {
  content: string;
  highlight?: boolean;
}): JSX.Element {
  if (highlight) {
    const tokenized = renderSourceTokens(content);
    return (
      <div className="source-preview is-highlighted" tabIndex={0} aria-label="源码，只读">
        <pre>
          {tokenized.map((nodes, index) => (
            <span key={index} className="sv-line">
              <span className="ln" aria-hidden="true">
                {index + 1}
              </span>
              <span className="sv-text">{nodes.length === 0 ? ' ' : nodes}</span>
            </span>
          ))}
        </pre>
      </div>
    );
  }
  const lines = content.split('\n');
  return (
    <div className="source-preview" tabIndex={0} aria-label="源码，只读">
      <pre aria-hidden="true" className="line-numbers">
        {lines.map((_, index) => `${index + 1}\n`)}
      </pre>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  );
}

function StructuredPreview({
  asset,
  activeFile,
}: {
  asset: MockAsset;
  activeFile: MockAsset['files'][number];
}): JSX.Element {
  return (
    <div className="structured-preview">
      <p className="structured-note">结构化视图只辅助理解；未知字段和原始排版仍由源码保留。</p>
      <dl>
        <div>
          <dt>名称</dt>
          <dd>{asset.name}</dd>
        </div>
        <div>
          <dt>原生文件</dt>
          <dd>{activeFile.name}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{asset.agent}</dd>
        </div>
        <div>
          <dt>作用域</dt>
          <dd>{asset.scope}</dd>
        </div>
        <div>
          <dt>未知字段</dt>
          <dd>
            <code>version: 0.3.0-mock</code>
            <span className="mini-badge neutral">原样保留</span>
          </dd>
        </div>
      </dl>
      <section className="structured-body">
        <span className="eyebrow">内容摘要</span>
        <h3>{asset.description}</h3>
        <p>解析成功。切回“源码”可查看注释、字段顺序和完整原生内容。</p>
      </section>
    </div>
  );
}

function NonTextPreview(): JSX.Element {
  return (
    <div className="non-text-preview">
      <div className="binary-icon" aria-hidden="true">
        BIN
      </div>
      <h2>这是非文本原生文件</h2>
      <p>可查看文件信息，但 MVP 不提供预览、结构化解析或编辑。</p>
      <dl>
        <div>
          <dt>类型</dt>
          <dd>application/octet-stream</dd>
        </div>
        <div>
          <dt>大小</dt>
          <dd>18 KB（合成数据）</dd>
        </div>
      </dl>
    </div>
  );
}

function Inspector({
  state,
  asset,
  sensitiveVisible,
  onClose,
  onToggleSensitive,
}: {
  state: MockUiState;
  asset: MockAsset;
  sensitiveVisible: boolean;
  onClose: () => void;
  onToggleSensitive: () => void;
}): JSX.Element {
  const hideHistory = state.variant === 'selected';
  return (
    <aside className="inspector" aria-label="检查器">
      <header>
        <div>
          <span className="eyebrow">辅助信息</span>
          <h2>检查器</h2>
        </div>
        <button className="mobile-close" type="button" aria-label="关闭检查器" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="inspector-key-summary" aria-label="关键摘要">
        <div>
          <span>生效</span>
          <strong>{asset.scope}</strong>
        </div>
        <div>
          <span>兼容</span>
          <strong>
            {state.scenario === 'readonly' || asset.status === '不兼容' ? '只读' : '完整'}
          </strong>
        </div>
        <div>
          <span>风险</span>
          <strong className="warning-text">Git 2 项</strong>
        </div>
      </div>
      <details>
        <summary>来源与生效</summary>
        <dl>
          <div>
            <dt>Agent</dt>
            <dd>{asset.agent}</dd>
          </div>
          <div>
            <dt>作用域</dt>
            <dd>{asset.scope}</dd>
          </div>
          <div>
            <dt>项目</dt>
            <dd>{asset.project}</dd>
          </div>
          <div>
            <dt>原生位置</dt>
            <dd className="mono">~/.agent/•••/{asset.name}</dd>
          </div>
        </dl>
      </details>
      <details>
        <summary>兼容性与漂移</summary>
        <dl>
          <div>
            <dt>兼容性</dt>
            <dd>
              <span
                className={`mini-badge ${
                  state.scenario === 'readonly' || asset.status === '不兼容' ? 'danger' : 'positive'
                }`}
              >
                {state.scenario === 'readonly' || asset.status === '不兼容'
                  ? '只读降级'
                  : '完整支持'}
              </span>
            </dd>
          </div>
          <div>
            <dt>索引</dt>
            <dd>{state.scenario === 'stale' ? '过期 · 待重建' : '最新'}</dd>
          </div>
          <div>
            <dt>磁盘 revision</dt>
            <dd className="mono">rev_•••42A</dd>
          </div>
        </dl>
      </details>
      {!hideHistory && (
        <details>
          <summary>更改与恢复</summary>
          <dl>
            <div>
              <dt>Git</dt>
              <dd className="warning-text">工作树有 2 项修改</dd>
            </div>
            <div>
              <dt>最近恢复点</dt>
              <dd>7 月 28 日 21:33</dd>
            </div>
            <div>
              <dt>敏感值</dt>
              <dd>
                <span className="mono secret-value">
                  {sensitiveVisible ? 'mock-token-8F3A' : '•••••••••••••••'}
                </span>
                <button className="text-button" type="button" onClick={onToggleSensitive}>
                  {sensitiveVisible ? '立即遮蔽' : '临时查看'}
                </button>
              </dd>
            </div>
          </dl>
          {sensitiveVisible && (
            <p className="sensitive-note" role="status">
              8 秒后自动遮蔽；不会进入搜索、日志或事件。
            </p>
          )}
        </details>
      )}
    </aside>
  );
}

function ScenarioBanner({
  variant,
  scenario,
  stage,
}: {
  variant: MockVariant;
  scenario: MockScenario;
  stage: Stage;
}): JSX.Element | null {
  if (scenario === 'ready' || scenario === 'dirty') return null;
  if (scenario === 'stale') {
    return (
      <InlineNotice b2Icons={variant === 'selected'} tone="warning" title="索引状态可能过期">
        正在显示磁盘读取结果。应用前会重新校验，不以索引授权写入。
        {variant === 'selected' && <span className="reason-code">原因码：INDEX_STALE</span>}
      </InlineNotice>
    );
  }
  if (scenario === 'readonly') {
    return (
      <InlineNotice
        b2Icons={variant === 'selected'}
        tone="neutral"
        title="当前 Agent 版本仅支持只读"
      >
        可浏览原生内容与导出；编辑、转换和删除暂不可用。
        {variant === 'selected' && <span className="reason-code">原因码：TARGET_READONLY</span>}
      </InlineNotice>
    );
  }
  if (scenario === 'degraded') {
    return (
      <InlineNotice b2Icons={variant === 'selected'} tone="warning" title="目标能力可能降级">
        浏览不受影响；转换时会逐项说明映射结果。
        {variant === 'selected' && <span className="reason-code">原因码：MAPPING_DEGRADED</span>}
      </InlineNotice>
    );
  }
  if (scenario === 'blocked') {
    return (
      <InlineNotice b2Icons={variant === 'selected'} tone="danger" title="当前操作被阻断">
        {variant === 'selected'
          ? '查看能力映射或授权范围后再重试。'
          : '查看能力映射或授权范围后选择恢复动作。'}
        {variant === 'selected' && <span className="reason-code">原因码：WRITE_BLOCKED</span>}
      </InlineNotice>
    );
  }
  if (scenario === 'conflict' && stage !== 'conflict') {
    return (
      <InlineNotice b2Icons={variant === 'selected'} tone="warning" title="应用时将模拟磁盘漂移">
        用于验收三方冲突与草稿保留状态。
        {variant === 'selected' && <span className="reason-code">原因码：DISK_CONFLICT</span>}
      </InlineNotice>
    );
  }
  if (scenario === 'failed') {
    return (
      <InlineNotice b2Icons={variant === 'selected'} tone="danger" title="部分管理状态读取失败">
        原生文件仍可只读浏览；重试不会产生写入。
        {variant === 'selected' && <span className="reason-code">原因码：STATUS_READ_FAILED</span>}
      </InlineNotice>
    );
  }
  return null;
}

export function TargetIdentitySummary({ identity }: { identity: B2TargetIdentity }): JSX.Element {
  return (
    <dl
      className="b2-target-identity"
      aria-label="单一目标"
      data-b2-target-agent={identity.agent}
      data-b2-target-scope={identity.scope}
      data-b2-target-project={identity.project ?? undefined}
      data-b2-target-path={identity.nativePath}
    >
      <div>
        <dt>目标 Agent</dt>
        <dd>{identity.agent}</dd>
      </div>
      <div>
        <dt>目标作用域</dt>
        <dd>{b2TargetScopeLabel(identity)}</dd>
      </div>
      <div className="is-wide">
        <dt>原生位置</dt>
        <dd className="mono">{identity.nativePath}</dd>
      </div>
    </dl>
  );
}

function TargetSetup({
  state,
  asset,
  convertTarget,
  patchState,
  setConvertTarget,
}: Pick<
  LayoutProps,
  'state' | 'asset' | 'convertTarget' | 'patchState' | 'setConvertTarget'
>): JSX.Element {
  const isConvert = state.journey === 'convert';
  const skillTargetAction = state.skillTarget?.action;
  const isSkillInstall = skillTargetAction === 'install';
  const lockedSkillTargetAgent = state.skillTarget?.agent;
  const lockedSkillTarget = lockedSkillTargetAgent !== undefined;
  const writeBlockReason = selectedWriteBlockReason(state, asset);
  const selectedProjectContext = state.configContext.startsWith('project:')
    ? state.configContext.slice('project:'.length)
    : null;
  const targetIdentity =
    state.variant === 'selected'
      ? b2TargetIdentityForState(state, asset, isConvert ? convertTarget : state.targetAgent)
      : null;
  return (
    <div className="flow-surface target-surface">
      <FlowHeader
        eyebrow={isSkillInstall ? '安装到 Agent' : isConvert ? '跨 Agent 转换' : state.createMode}
        title={
          isSkillInstall
            ? `安装 ${asset.name} 到 ${convertTarget}`
            : isConvert
              ? `转换 ${asset.name}`
              : state.createMode === '新建'
                ? '创建原生资产'
                : '从本地导入'
        }
        description={
          isSkillInstall
            ? '先准备一个单一目标的安装计划；下一步只生成映射与审查材料，不写入文件。'
            : isConvert
              ? '先选择单一目标；下一步只生成能力映射报告，不写入文件。'
              : '设置一个目标 Agent 与作用域，随后在主工作区准备本地草稿。'
        }
        step={1}
        total={isConvert ? 4 : 4}
      />
      {writeBlockReason !== null && (
        <InlineNotice b2Icons tone="neutral" title="只读模式">
          {writeBlockReason}
        </InlineNotice>
      )}
      <div className="form-sheet">
        {!isConvert && (
          <div className="entry-switch">
            {(['新建', '从本地导入'] as const).map((mode) => (
              <button
                key={mode}
                className={state.createMode === mode ? 'is-selected' : ''}
                type="button"
                disabled={writeBlockReason !== null}
                onClick={() =>
                  patchState({
                    createMode: mode,
                    createName: mode === '新建' ? 'new-skill' : 'imported-skill',
                  })
                }
              >
                <strong>{mode}</strong>
                <span>{mode === '新建' ? '从最小原生模板开始' : '选择本地文件或目录'}</span>
              </button>
            ))}
          </div>
        )}
        {state.createMode === '从本地导入' && !isConvert && (
          <div className="drop-zone">
            <span className="drop-icon">
              {state.variant === 'selected' ? <B2Icon name="import" /> : '⇩'}
            </span>
            <strong>选择本地文件或目录</strong>
            <span>原型不会读取、复制或上传选择内容</span>
            <button
              type="button"
              disabled={writeBlockReason !== null}
              onClick={() =>
                patchState({
                  notice: '已模拟选择 examples/skill；未读取真实文件。',
                })
              }
            >
              模拟选择 examples/skill
            </button>
          </div>
        )}
        <div className="field-grid">
          {!isConvert && (
            <label>
              <span>资产类型</span>
              <select
                value={state.targetAssetType}
                disabled={writeBlockReason !== null}
                onChange={(event) =>
                  patchState({
                    targetAssetType: event.currentTarget.value as AssetType,
                  })
                }
              >
                {assetTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>目标 Agent</span>
            <select
              value={isConvert ? convertTarget : state.targetAgent}
              disabled={lockedSkillTarget || writeBlockReason !== null}
              onChange={(event) => {
                if (isConvert) {
                  setConvertTarget(
                    state.variant === 'selected'
                      ? b2ConvertTargetForSource(asset.agent, event.currentTarget.value)
                      : event.currentTarget.value,
                  );
                } else {
                  patchState({ targetAgent: event.currentTarget.value });
                }
              }}
            >
              {(lockedSkillTarget
                ? [lockedSkillTargetAgent]
                : mockAgents.filter((agent) => !isConvert || agent !== asset.agent)
              ).map((agent) => (
                <option key={agent}>{agent}</option>
              ))}
            </select>
            {lockedSkillTarget && <small>由当前 Skill 的目标状态锁定</small>}
          </label>
          <label>
            <span>作用域</span>
            <select
              value={state.targetScope}
              disabled={writeBlockReason !== null}
              onChange={(event) => {
                const targetScope = event.currentTarget.value as '全局' | '项目';
                patchState({
                  targetScope,
                  ...(state.variant === 'selected' && targetScope === '项目'
                    ? {
                        importProject: selectedProjectContext ?? state.importProject,
                      }
                    : {}),
                });
              }}
            >
              {state.variant === 'selected' ? (
                <>
                  <option value="项目">项目</option>
                  <option value="全局">全局 · 用户配置</option>
                </>
              ) : (
                <>
                  <option value="项目">项目 · acme/desktop</option>
                  <option value="全局">全局 · 用户配置</option>
                </>
              )}
            </select>
          </label>
          {state.variant === 'selected' && state.targetScope === '项目' && (
            <label>
              <span>目标项目</span>
              <select
                value={state.importProject}
                disabled={writeBlockReason !== null || selectedProjectContext !== null}
                onChange={(event) => patchState({ importProject: event.currentTarget.value })}
              >
                {b2ProjectNames.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
              {selectedProjectContext !== null && <small>当前项目上下文</small>}
            </label>
          )}
          {!isConvert && (
            <label className="wide-field">
              <span>资产名称</span>
              <input
                value={state.createName}
                disabled={writeBlockReason !== null}
                onChange={(event) => patchState({ createName: event.currentTarget.value })}
              />
              {state.scenario === 'blocked' && (
                <small className="field-error">目标位置已有同名资产；请选择其他名称。</small>
              )}
            </label>
          )}
        </div>
        {targetIdentity !== null && <TargetIdentitySummary identity={targetIdentity} />}
      </div>
      <FlowFooter
        secondaryLabel="取消"
        onSecondary={() =>
          patchState({
            journey: 'browse',
            stage: 'browse',
            dirty: false,
            selectedPanel: 'list',
            selectedStep: state.variant === 'selected' ? 'list' : state.selectedStep,
          })
        }
        primaryLabel={
          writeBlockReason !== null
            ? isConvert
              ? '只读：不能继续'
              : '只读：不能创建'
            : isSkillInstall
              ? '生成安装计划'
              : isConvert
                ? '生成能力映射'
                : '创建本地草稿'
        }
        primaryTitle={writeBlockReason ?? undefined}
        disabled={writeBlockReason !== null || (state.scenario === 'blocked' && !isConvert)}
        onPrimary={() => {
          if (writeBlockReason !== null) {
            patchState({ notice: writeBlockReason });
            return;
          }
          patchState({
            stage: isConvert ? 'mapping' : 'editing',
            dirty: !isConvert,
            assetType: isConvert ? state.assetType : state.targetAssetType,
            fileName: isConvert ? state.fileName : asset.files[0].name,
            drafts: isConvert
              ? {}
              : Object.fromEntries(asset.files.map((file) => [file.name, file.content])),
          });
        }}
      />
    </div>
  );
}

function MappingSurface({
  state,
  asset,
  convertTarget,
  patchState,
}: Pick<LayoutProps, 'state' | 'asset' | 'convertTarget' | 'patchState'>): JSX.Element {
  const writeBlockReason = selectedWriteBlockReason(state, asset);
  const blocked = state.scenario === 'blocked' || writeBlockReason !== null;
  const degraded = state.scenario === 'degraded';
  const isSkillInstall = state.skillTarget?.action === 'install';
  const targetIdentity =
    state.variant === 'selected' ? b2TargetIdentityForState(state, asset, convertTarget) : null;
  const mappingRows: Array<[string, string, string]> = isSkillInstall
    ? blocked
      ? [
          ['原生 Skill 正文', '目标拒绝创建安装副本', '阻断'],
          ['多文件 examples/', '不会复制', '阻断'],
          ['元数据与未知字段', '不会写入目标', '阻断'],
          ['Agent 目标记录', '保持当前状态', '阻断'],
        ]
      : [
          ['原生 Skill 正文', `${convertTarget} 的原生 Skill 目录`, '完整'],
          ['多文件 examples/', '保留相对目录并复制', '完整'],
          [
            '元数据与未知字段',
            degraded ? '原文复制，2 项可选能力待确认' : '按原文复制，不重写',
            degraded ? '降级' : '完整',
          ],
          ['Agent 目标记录', '安装后重新识别', '完整'],
        ]
    : [
        ['原生说明正文', 'AGENTS.md 正文', '完整'],
        ['多文件 examples/', '同目录保留', '完整'],
        [
          '自动触发提示',
          blocked ? '目标无等价能力' : degraded ? '改为手动说明' : 'frontmatter trigger',
          blocked ? '阻断' : degraded ? '降级' : '完整',
        ],
        ['未知字段 version', degraded ? '保留为注释' : '原样字段', degraded ? '降级' : '完整'],
      ];
  return (
    <div className="flow-surface mapping-surface">
      <FlowHeader
        eyebrow={isSkillInstall ? '安装计划' : '跨 Agent 转换'}
        title={
          isSkillInstall
            ? `安装 ${asset.name} 到 ${convertTarget}`
            : `${asset.agent} → ${convertTarget}`
        }
        description={
          isSkillInstall
            ? '安装计划只复制列出的原生文件到单一目标；此页面不会写入文件。'
            : '能力映射是审查材料，不会修改源资产或创建目标文件。'
        }
        step={2}
        total={4}
      />
      {targetIdentity !== null && <TargetIdentitySummary identity={targetIdentity} />}
      <div className={`mapping-summary ${blocked ? 'danger' : degraded ? 'warning' : 'positive'}`}>
        <span className="mapping-symbol">
          {state.variant === 'selected' ? (
            <B2Icon name={blocked ? 'alert-octagon' : degraded ? 'alert-triangle' : 'check-circle-2'} />
          ) : blocked ? (
            '×'
          ) : degraded ? (
            '!'
          ) : (
            '✓'
          )}
        </span>
        <div>
          <h2>
            {blocked
              ? isSkillInstall
                ? '无法安装'
                : '无法转换'
              : degraded
                ? isSkillInstall
                  ? '可降级安装'
                  : '可降级转换'
                : isSkillInstall
                  ? '安装计划已就绪'
                  : '完整映射'}
          </h2>
          <p>
            {isSkillInstall
              ? blocked
                ? '目标 Agent 当前不能接收此原生 Skill；阻断状态停留在计划报告。'
                : degraded
                  ? '原生内容会复制，但 2 项可选能力需要人工确认。'
                  : '原生内容、文件结构与未知字段将按原样复制到单一目标。'
              : blocked
                ? '目标不支持必需的触发能力；阻断状态停留在报告。'
                : degraded
                  ? '主体内容可保留，但 2 项目标能力需要改写或省略。'
                  : '原生内容、文件结构与声明能力均有明确目标表示。'}
          </p>
        </div>
      </div>
      <div
        className="mapping-table"
        role="table"
        aria-label={isSkillInstall ? '安装计划' : '能力映射'}
      >
        <div role="row" className="mapping-head">
          <span role="columnheader">源能力</span>
          <span role="columnheader">目标表示</span>
          <span role="columnheader">结论</span>
        </div>
        {mappingRows.map(([source, target, conclusion]) => (
          <div role="row" key={source}>
            <span role="cell">{source}</span>
            <span role="cell" className="mono">
              {target}
            </span>
            <span role="cell">
              <span
                className={`mini-badge ${
                  conclusion === '完整' ? 'positive' : conclusion === '降级' ? 'warning' : 'danger'
                }`}
              >
                {conclusion}
              </span>
            </span>
          </div>
        ))}
      </div>
      <FlowFooter
        secondaryLabel="返回目标设置"
        onSecondary={() => patchState({ stage: 'target' })}
        primaryLabel={
          writeBlockReason !== null
            ? '只读：不能继续'
            : blocked
              ? '阻断：不能继续'
              : isSkillInstall
                ? '继续审查安装计划'
                : '继续审查差异'
        }
        primaryTitle={writeBlockReason ?? undefined}
        disabled={blocked}
        onPrimary={() => {
          if (writeBlockReason !== null) {
            patchState({ notice: writeBlockReason });
            return;
          }
          patchState({ stage: 'review', dirty: false });
        }}
      />
    </div>
  );
}

function ReviewSurface({
  state,
  asset,
  activeFile,
  convertTarget,
  patchState,
  openConfirmation,
}: Pick<
  LayoutProps,
  'state' | 'asset' | 'activeFile' | 'convertTarget' | 'patchState' | 'openConfirmation'
>): JSX.Element {
  const isConvert = state.journey === 'convert';
  const isCreate = state.journey === 'create';
  const isSkillInstall = state.skillTarget?.action === 'install';
  const isSelected = state.variant === 'selected';
  const isInlineInstruction = selectedInlineInstructionEdit(state, asset);
  const writeBlockReason = selectedWriteBlockReason(state, asset);
  const targetIdentity =
    isSelected && (isConvert || isSkillInstall)
      ? b2TargetIdentityForState(state, asset, convertTarget)
      : null;
  const originalContent = isConvert || isCreate ? '' : activeFile.content;
  const proposedContent = isSkillInstall
    ? activeFile.content
    : isConvert
      ? `# Converted for ${convertTarget}\n\n${activeFile.content}`
      : (state.drafts[activeFile.name] ?? activeFile.content);
  const originalLines = originalContent.length === 0 ? [] : originalContent.split('\n');
  const proposedLines = proposedContent.split('\n');
  let commonLineCount = 0;
  while (
    commonLineCount < originalLines.length &&
    commonLineCount < proposedLines.length &&
    originalLines[commonLineCount] === proposedLines[commonLineCount]
  ) {
    commonLineCount += 1;
  }
  const contextLines = originalLines.slice(Math.max(0, commonLineCount - 3), commonLineCount);
  const removedLines = originalLines.slice(commonLineCount);
  const addedLines = proposedLines.slice(commonLineCount);
  const changedFileNames = isSelected
    ? changedB2FileNames(asset, state.drafts, b2ChangeModeForState(state))
    : [];
  const changedFileCount = isSelected
    ? changedFileNames.length
    : isConvert
      ? asset.files.length
      : asset.files.filter((file) => {
          const draft = state.drafts[file.name];
          return isCreate || (draft !== undefined && draft !== file.content);
        }).length;
  return (
    <div className="flow-surface review-surface">
      <FlowHeader
        eyebrow={
          isSkillInstall
            ? '安装审查'
            : isConvert
              ? '转换审查'
              : isCreate
                ? `${state.createMode} · 审查`
                : '应用前审查'
        }
        title={
          isSkillInstall
            ? `审查安装到 ${convertTarget} 的目标文件`
            : isConvert
              ? `审查 ${convertTarget} 的目标文件`
              : `审查 ${asset.name} 的更改`
        }
        description="prepare 阶段只生成校验、风险与统一差异；此页面尚未写入任何文件。"
        step={isConvert ? 3 : 3}
        total={4}
      />
      {isSelected && (
        <nav className="b2-review-files" aria-label="审查文件">
          {asset.files.map((file) => {
            const changed = changedFileNames.includes(file.name);
            return (
              <button
                key={file.name}
                className={`${file.name === activeFile.name ? 'is-selected' : ''} ${
                  changed ? 'is-changed' : ''
                }`}
                type="button"
                aria-current={file.name === activeFile.name ? 'page' : undefined}
                onClick={() => patchState({ fileName: file.name })}
              >
                <B2Icon name={file.language === 'binary' ? 'database' : 'file-text'} />
                <span>{file.name}</span>
                {changed && <i aria-label="已更改" />}
              </button>
            );
          })}
        </nav>
      )}
      <div
        className={`review-grid ${!isSelected && asset.files.length > 1 ? 'has-file-tree' : ''}`}
      >
        {targetIdentity !== null && <TargetIdentitySummary identity={targetIdentity} />}
        {!isSelected && asset.files.length > 1 && (
          <FileTree
            asset={asset}
            activeFileName={activeFile.name}
            onChoose={(fileName) => patchState({ fileName })}
            overlayOpen={state.panelOverlay === 'files'}
            onClose={() => patchState({ panelOverlay: null })}
            b2Icons={state.variant === 'selected'}
          />
        )}
        <section className="diff-panel">
          <header>
            <div>
              <strong>
                {isSkillInstall
                  ? `${convertTarget}/${activeFile.name} · 原生复制`
                  : isConvert
                    ? `${convertTarget}/${activeFile.name}`
                    : activeFile.name}
              </strong>
              <span>
                +{addedLines.length} −{removedLines.length}
              </span>
            </div>
            <div className="diff-legend">
              <span className="positive">新增</span>
              <span className="danger">删除</span>
              {!isSelected && asset.files.length > 1 && (
                <button
                  className="file-tree-trigger"
                  type="button"
                  onClick={() => patchState({ panelOverlay: 'files' })}
                >
                  文件 {asset.files.length}
                </button>
              )}
            </div>
          </header>
          <pre aria-label="统一差异">
            <code>
              <span className="diff-meta">
                @@ -{Math.max(1, commonLineCount + 1)},{removedLines.length} +
                {Math.max(1, commonLineCount + 1)},{addedLines.length} @@
              </span>
              {contextLines.map((line, index) => (
                <span key={`context-${index}`}> {line || ' '}</span>
              ))}
              {removedLines.map((line, index) => (
                <span className="diff-remove" key={`remove-${index}`}>
                  -{line}
                </span>
              ))}
              {addedLines.map((line, index) => (
                <span className="diff-add" key={`add-${index}`}>
                  +{line}
                </span>
              ))}
            </code>
          </pre>
        </section>
        <aside className="review-checks" aria-label={isSelected ? '校验与风险' : '检查器与校验'}>
          <header className="review-inspector-heading">
            <span className="eyebrow">辅助信息</span>
            <strong>{isSelected ? '校验与风险' : '检查器与校验'}</strong>
            <small>
              {isSelected
                ? `${asset.agent} · ${asset.scope === '全局' ? '全局配置' : asset.project}`
                : `${asset.agent} · ${asset.scope}`}
            </small>
          </header>
          <section>
            <span className="check-symbol success">
              {state.variant === 'selected' ? <B2Icon name="check-circle-2" /> : '✓'}
            </span>
            <div>
              <strong>{isSkillInstall ? '原生文件可直接复制' : '原生格式有效'}</strong>
              <p>
                {isSkillInstall
                  ? `${changedFileCount} 个原生文件将复制到 ${convertTarget}；当前审查 ${activeFile.name}。`
                  : `${changedFileCount} 个文件有更改；当前审查 ${activeFile.name}，未知字段将保留。`}
              </p>
            </div>
          </section>
          <section>
            <span className="check-symbol warning">
              {state.variant === 'selected' ? <B2Icon name="alert-triangle" /> : '!'}
            </span>
            <div>
              <strong>Git 工作树有修改</strong>
              <p>应用不会暂存、提交或还原 Git 变更。</p>
            </div>
          </section>
          {isConvert && !isSkillInstall && state.scenario === 'degraded' && (
            <section>
              <span className="check-symbol warning">
                {state.variant === 'selected' ? <B2Icon name="alert-triangle" /> : '!'}
              </span>
              <div>
                <strong>包含 2 项降级</strong>
                <p>目标文件以注释保留未知字段，自动触发改为手动说明。</p>
              </div>
            </section>
          )}
          <section>
            <span className="check-symbol success">
              {isSelected ? <B2Icon name="rotate-ccw" /> : '↶'}
            </span>
            <div>
              <strong>将保留恢复证据</strong>
              <p>
                {isSelected
                  ? '应用前固定当前 revision；Outcome 与管理表面表达回滚状态，不提供独立恢复入口。'
                  : '应用前保留当前原生文件，可从结果页恢复。'}
              </p>
            </div>
          </section>
        </aside>
      </div>
      <FlowFooter
        secondaryLabel={isConvert ? '返回映射' : '返回草稿'}
        onSecondary={() =>
          patchState({
            stage: isConvert ? 'mapping' : isInlineInstruction ? 'browse' : 'editing',
            dirty: !isConvert,
            ...(isInlineInstruction
              ? { selectedPanel: 'detail' as const, selectedStep: 'detail' as const }
              : {}),
          })
        }
        primaryLabel={writeBlockReason === null ? '继续确认' : '只读：不能确认'}
        primaryTitle={writeBlockReason ?? undefined}
        disabled={writeBlockReason !== null}
        onPrimary={(event) => openConfirmation(event.currentTarget)}
      />
    </div>
  );
}

export function OutcomeSurface(
  props: Pick<LayoutProps, 'state' | 'asset' | 'convertTarget' | 'patchState'>,
): JSX.Element {
  if (props.state.variant !== 'selected') {
    return (
      <LegacyOutcomeSurface state={props.state} asset={props.asset} patchState={props.patchState} />
    );
  }
  return <SelectedOutcomeSurface {...props} />;
}

function LegacyOutcomeSurface({
  state,
  asset,
  patchState,
}: Pick<LayoutProps, 'state' | 'asset' | 'patchState'>): JSX.Element {
  const hideHistory = state.variant === 'selected';
  const rolledBack = !hideHistory && state.journey === 'recover' && state.stage === 'result';
  const rollbackFailed = rolledBack && state.scenario === 'failed';
  const prepareConflict = state.stage === 'conflict';
  const reprepareRequired = state.scenario === 'conflict' && state.stage === 'result';
  const failed = state.scenario === 'failed';
  const blocked = state.scenario === 'blocked';
  const tone = prepareConflict || reprepareRequired || failed || blocked ? 'danger' : 'positive';
  const title = rollbackFailed
    ? '回滚失败，当前磁盘内容未改变'
    : rolledBack
      ? '已从恢复点回滚'
      : reprepareRequired
        ? '磁盘已变化，需要重新准备'
        : prepareConflict
          ? '准备阶段发现三方冲突'
          : failed
            ? '应用失败，未写入文件'
            : blocked
              ? '操作已阻断'
              : '应用完成';
  return (
    <div className="flow-surface outcome-surface">
      <div className={`outcome-mark ${tone}`}>{tone === 'positive' ? '✓' : '!'}</div>
      <span className="eyebrow">操作结果</span>
      <h1>{title}</h1>
      <p>
        {reprepareRequired
          ? 'apply 重新校验发现 revision 已变化，返回 BlockedResult(REPREPARE_REQUIRED)。系统未覆盖磁盘内容，草稿与基线均已保留。'
          : prepareConflict
            ? 'prepare 已生成三方冲突报告；解决冲突前不能进入 apply。'
            : rollbackFailed
              ? '回滚事务在写入前失败；目标文件保持回滚前状态，可重试或返回恢复点列表。'
              : rolledBack
                ? `${asset.name} 已恢复到 RP-20260728-2133；回滚前状态已固定为新的恢复点。`
                : failed
                  ? '事务在提交前失败，原文件保持不变。可查看原因码并重试。'
                  : blocked
                    ? '当前能力或授权范围不足，没有创建任何目标文件。'
                    : `${asset.name} 已通过模拟事务应用；前端缓存不会作为结果事实来源。`}
      </p>
      <div className="result-sheet">
        <dl>
          <div>
            <dt>结果码</dt>
            <dd className="mono">
              {reprepareRequired
                ? 'REPREPARE_REQUIRED'
                : prepareConflict
                  ? 'THREE_WAY_CONFLICT'
                  : rollbackFailed
                    ? 'ROLLBACK_FAILED'
                    : rolledBack
                      ? 'ROLLED_BACK'
                      : failed
                        ? 'TRANSACTION_FAILED'
                        : blocked
                          ? 'CAPABILITY_BLOCKED'
                          : 'APPLIED'}
            </dd>
          </div>
          <div>
            <dt>写入</dt>
            <dd>{tone === 'positive' ? `${asset.files.length} 个原生文件` : '0 个文件'}</dd>
          </div>
          {!hideHistory && (
            <div>
              <dt>恢复点</dt>
              <dd className="mono">
                {rolledBack
                  ? 'RP-20260729-ROLLBACK · 已固定'
                  : tone === 'positive'
                    ? 'RP-20260729-1042 · 已固定'
                    : '沿用原恢复点'}
              </dd>
            </div>
          )}
          <div>
            <dt>Git</dt>
            <dd>未执行任何 Git 操作</dd>
          </div>
          {!hideHistory && (
            <>
              <div>
                <dt>回滚</dt>
                <dd className="mono">
                  {rollbackFailed ? 'failed' : rolledBack ? 'succeeded' : 'notNeeded'}
                </dd>
              </div>
              <div>
                <dt>恢复动作</dt>
                <dd>{rollbackFailed ? '重试回滚 / 返回恢复点' : '可从恢复点再次审查'}</dd>
              </div>
            </>
          )}
        </dl>
      </div>
      <div className="outcome-actions">
        {(prepareConflict || reprepareRequired) && (
          <>
            <button
              className="quiet-button"
              type="button"
              onClick={() => patchState({ stage: 'editing', dirty: true })}
            >
              返回草稿
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                patchState({
                  stage: 'review',
                  scenario: 'ready',
                  notice: '已基于最新磁盘 revision 重新执行 prepare。',
                })
              }
            >
              重新 prepare 并审查
            </button>
          </>
        )}
        {!prepareConflict && !reprepareRequired && tone === 'danger' && (
          <>
            <button
              className="quiet-button"
              type="button"
              onClick={() => patchState({ journey: 'browse', stage: 'browse' })}
            >
              返回工作区
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                patchState({
                  stage: state.journey === 'convert' ? 'mapping' : 'review',
                })
              }
            >
              {hideHistory ? '返回审查' : '查看恢复动作'}
            </button>
          </>
        )}
        {tone === 'positive' && (
          <>
            {!hideHistory && (
              <button
                className="quiet-button"
                type="button"
                onClick={() => patchState({ journey: 'recover', stage: 'recover' })}
              >
                查看恢复点
              </button>
            )}
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                patchState({
                  journey: 'browse',
                  stage: 'browse',
                  scenario: 'ready',
                  notice: null,
                })
              }
            >
              返回资产
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SelectedOutcomeSurface({
  state,
  asset,
  convertTarget,
  patchState,
}: Pick<LayoutProps, 'state' | 'asset' | 'convertTarget' | 'patchState'>): JSX.Element {
  const isSelected = state.variant === 'selected';
  const isConvert = state.journey === 'convert';
  const isInlineInstruction = selectedInlineInstructionEdit(state, asset);
  const rolledBack = !isSelected && state.journey === 'recover' && state.stage === 'result';
  const rollbackFailed = rolledBack && state.scenario === 'failed';
  const prepareConflict = state.stage === 'conflict';
  const reprepareRequired = state.scenario === 'conflict' && state.stage === 'result';
  const failed = state.scenario === 'failed';
  const writeBlockReason = selectedWriteBlockReason(state, asset);
  const blocked = state.scenario === 'blocked' || writeBlockReason !== null;
  const tone = prepareConflict || reprepareRequired || failed || blocked ? 'danger' : 'positive';
  const writtenFileCount =
    tone === 'positive' ? (state.appliedFileCount ?? b2ChangedFileCount(state, asset)) : 0;
  const targetIdentity = isConvert ? b2TargetIdentityForState(state, asset, convertTarget) : null;
  const title = rollbackFailed
    ? '回滚失败，当前磁盘内容未改变'
    : rolledBack
      ? '已从恢复点回滚'
      : reprepareRequired
        ? '磁盘已变化，需要重新准备'
        : prepareConflict
          ? '准备阶段发现三方冲突'
          : failed
            ? '应用失败，未写入文件'
            : blocked
              ? '操作已阻断'
              : '应用完成';
  return (
    <div className="flow-surface outcome-surface">
      <div className={`outcome-mark ${tone}`}>
        {state.variant === 'selected' ? (
          <B2Icon name={tone === 'positive' ? 'check-circle-2' : 'alert-triangle'} />
        ) : tone === 'positive' ? (
          '✓'
        ) : (
          '!'
        )}
      </div>
      <div className="b2-outcome-heading">
        <span className="eyebrow">操作结果</span>
        <h1 data-b2-focus="outcome" tabIndex={-1}>
          {title}
        </h1>
      </div>
      <p>
        {reprepareRequired
          ? 'apply 重新校验发现 revision 已变化，返回 BlockedResult(REPREPARE_REQUIRED)。系统未覆盖磁盘内容，草稿与基线均已保留。'
          : prepareConflict
            ? 'prepare 已生成三方冲突报告；解决冲突前不能进入 apply。'
            : rollbackFailed
              ? '回滚事务在写入前失败；目标文件保持回滚前状态，可重试或返回恢复点列表。'
              : rolledBack
                ? `${asset.name} 已恢复到 RP-20260728-2133；回滚前状态已固定为新的恢复点。`
                : failed
                  ? '事务在提交前失败，原文件保持不变。可查看原因码并重试。'
                  : blocked
                    ? (writeBlockReason ?? '当前能力或授权范围不足，没有创建任何目标文件。')
                    : `${asset.name} 已通过模拟事务应用；已确认内容现在来自当前 Mock 内存资产快照。`}
      </p>
      {isSelected && state.notice !== null && (
        <div className="b2-outcome-notice" role="status">
          {state.notice}
        </div>
      )}
      {targetIdentity !== null && <TargetIdentitySummary identity={targetIdentity} />}
      <div className="result-sheet">
        <dl>
          <div>
            <dt>结果码</dt>
            <dd className="mono">
              {reprepareRequired
                ? 'REPREPARE_REQUIRED'
                : prepareConflict
                  ? 'THREE_WAY_CONFLICT'
                  : rollbackFailed
                    ? 'ROLLBACK_FAILED'
                    : rolledBack
                      ? 'ROLLED_BACK'
                      : failed
                        ? 'TRANSACTION_FAILED'
                        : blocked
                          ? 'CAPABILITY_BLOCKED'
                          : 'APPLIED'}
            </dd>
          </div>
          <div>
            <dt>写入</dt>
            <dd>{writtenFileCount} 个原生文件</dd>
          </div>
          <div>
            <dt>恢复点</dt>
            <dd className="mono">
              {rolledBack
                ? 'RP-20260729-ROLLBACK · 已固定'
                : tone === 'positive'
                  ? 'RP-20260729-1042 · 已固定'
                  : '沿用原恢复点'}
            </dd>
          </div>
          <div>
            <dt>Git</dt>
            <dd>未执行任何 Git 操作</dd>
          </div>
          <div>
            <dt>回滚</dt>
            <dd className="mono">
              {rollbackFailed ? 'failed' : rolledBack ? 'succeeded' : 'notNeeded'}
            </dd>
          </div>
          <div>
            <dt>恢复动作</dt>
            <dd>{rollbackFailed ? '重试回滚 / 返回恢复点' : '可从恢复点再次审查'}</dd>
          </div>
        </dl>
      </div>
      <div className="outcome-actions">
        {(prepareConflict || reprepareRequired) && (
          <>
            <button
              className="quiet-button"
              type="button"
              onClick={() =>
                patchState({
                  stage: isConvert ? 'mapping' : isInlineInstruction ? 'browse' : 'editing',
                  dirty: isConvert ? false : true,
                  drafts: isConvert ? {} : state.drafts,
                  ...(isInlineInstruction
                    ? { selectedPanel: 'detail' as const, selectedStep: 'detail' as const }
                    : {}),
                })
              }
            >
              {isConvert ? '返回能力映射' : '返回草稿'}
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                patchState({
                  stage: 'review',
                  scenario: 'ready',
                  dirty: isConvert ? false : state.dirty,
                  drafts: isConvert ? {} : state.drafts,
                  notice: '已基于最新磁盘 revision 重新执行 prepare。',
                })
              }
            >
              重新 prepare 并审查
            </button>
          </>
        )}
        {!prepareConflict && !reprepareRequired && tone === 'danger' && (
          <>
            <button
              className="quiet-button"
              type="button"
              onClick={() => patchState({ journey: 'browse', stage: 'browse' })}
            >
              返回工作区
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                patchState({
                  stage: isConvert ? 'mapping' : 'review',
                  dirty: isConvert ? false : state.dirty,
                  drafts: isConvert ? {} : state.drafts,
                })
              }
            >
              {isConvert ? '返回能力映射' : isSelected ? '返回审查' : '查看恢复动作'}
            </button>
          </>
        )}
        {tone === 'positive' && (
          <>
            {!isSelected && (
              <button
                className="quiet-button"
                type="button"
                onClick={() => patchState({ journey: 'recover', stage: 'recover' })}
              >
                查看恢复点
              </button>
            )}
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                patchState({
                  journey: 'browse',
                  stage: 'browse',
                  scenario: 'ready',
                  notice: null,
                })
              }
            >
              返回资产
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ManagementSurface({
  state,
  asset,
  patchState,
}: {
  state: MockUiState;
  asset: MockAsset;
  patchState: (patch: Partial<MockUiState>) => void;
}): JSX.Element {
  const isSelected = state.variant === 'selected';
  const writeBlockReason = selectedCapabilityBlockReason(state, asset);
  const selectedWritesBlocked = isSelected && writeBlockReason !== null;
  const activeManagementTab = state.managementTab;
  const managementTabs: Array<[MockUiState['managementTab'], string]> = isSelected
    ? [
        ['projects', '项目与索引'],
        ['agents', 'Agent 与适配器'],
        ['recovery', '导出与维护'],
      ]
    : [
        ['projects', '项目与索引'],
        ['agents', 'Agent 与适配器'],
        ['recovery', '恢复点'],
      ];
  const rollbackTone =
    state.scenario === 'failed' ? 'danger' : state.scenario === 'conflict' ? 'warning' : 'positive';
  const rollbackCode =
    state.scenario === 'failed'
      ? 'ROLLBACK_FAILED'
      : state.scenario === 'conflict'
        ? 'ROLLBACK_CONFLICT'
        : 'ROLLBACK_SUCCEEDED';

  return (
    <div className="management-surface">
      <FlowHeader
        eyebrow="工作区管理"
        title={isSelected ? '项目、Agent 与维护操作' : '项目、Agent 与索引'}
        description={
          isSelected
            ? '管理维度保持在辅助表面；导出、删除和回滚只使用内存 Mock 表达，不形成独立 Recovery 页面。'
            : '管理维度保持辅助位置，不改变四类资产的一级导航。'
        }
        step={1}
        total={1}
      />
      {selectedWritesBlocked && (
        <InlineNotice b2Icons tone="neutral" title="管理操作已禁用">
          {writeBlockReason}
        </InlineNotice>
      )}
      <nav className="management-tabs" aria-label="管理区域">
        {managementTabs.map(([key, label]) => (
          <button
            key={key}
            className={activeManagementTab === key ? 'is-selected' : ''}
            type="button"
            onClick={() =>
              patchState({
                managementTab: key as MockUiState['managementTab'],
                recoveryAction: 'idle',
                notice: null,
              })
            }
          >
            {label}
          </button>
        ))}
      </nav>

      {activeManagementTab === 'projects' && (
        <div className="management-list">
          {isSelected ? (
            <>
              <ManagementRow
                icon="folder"
                title="ReinventedWheelAgent"
                meta="~/projects/ReinventedWheelAgent · 11 项原生资产"
                status={state.scenario === 'stale' ? '索引过期' : '已纳入'}
                tone={state.scenario === 'stale' ? 'warning' : 'positive'}
                action={state.scenario === 'stale' ? '重建索引' : '停止管理'}
                actionDisabled={selectedWritesBlocked}
                actionTitle={writeBlockReason ?? undefined}
                onAction={() => patchState({ notice: '模拟操作完成；未访问真实目录。' })}
              />
              <ManagementRow
                icon="folder"
                title="agent-config-manager"
                meta="~/projects/agent-config-manager · 5 项原生资产"
                status="已纳入"
                tone="positive"
                action="查看索引"
                onAction={() => patchState({ notice: '已打开合成索引摘要。' })}
              />
              <ManagementRow
                icon="folder"
                title="mobile-tooling"
                meta="~/projects/mobile-tooling · 5 项原生资产"
                status="已纳入"
                tone="positive"
                action="查看索引"
                onAction={() => patchState({ notice: '已打开合成索引摘要。' })}
              />
              <ManagementRow
                icon="folder-plus"
                title="candidate-workspace"
                meta="~/projects/candidate-workspace · 候选项目"
                status="待确认"
                tone="neutral"
                action="纳入管理"
                actionDisabled={selectedWritesBlocked}
                actionTitle={writeBlockReason ?? undefined}
                onAction={() => patchState({ notice: '已模拟纳入候选项目。' })}
              />
            </>
          ) : (
            <>
              <ManagementRow
                title="acme/desktop"
                meta="/Users/mock/code/acme/desktop · 18 项资产"
                status={state.scenario === 'stale' ? '索引过期' : '已纳入'}
                tone={state.scenario === 'stale' ? 'warning' : 'positive'}
                action={state.scenario === 'stale' ? '重建索引' : '停止管理'}
                onAction={() => patchState({ notice: '模拟操作完成；未访问真实目录。' })}
              />
              <ManagementRow
                title="acme/server"
                meta="/Users/mock/code/acme/server · 候选项目"
                status="待确认"
                tone="neutral"
                action="纳入管理"
                onAction={() => patchState({ notice: '已模拟纳入候选项目。' })}
              />
            </>
          )}
        </div>
      )}

      {activeManagementTab === 'agents' && (
        <div className="management-list">
          <ManagementRow
            icon={isSelected ? 'bot' : undefined}
            title="Codex"
            meta="v0.7.4 · 官方适配器 1.4.0"
            status="完整支持"
            tone="positive"
            action="检查更新"
            onAction={() => patchState({ notice: '当前已是最新版本。' })}
          />
          <ManagementRow
            icon={isSelected ? 'bot' : undefined}
            title="Gemini CLI"
            meta="v0.3.1 · 适配器更新可用"
            status={state.scenario === 'failed' ? '更新失败 · 保持 1.2.0' : '可更新'}
            tone={state.scenario === 'failed' ? 'danger' : 'warning'}
            action={
              state.scenario === 'failed'
                ? isSelected
                  ? '重试更新'
                  : '回滚上一版本'
                : '更新适配器'
            }
            actionDisabled={selectedWritesBlocked}
            actionTitle={writeBlockReason ?? undefined}
            onAction={() =>
              patchState({
                notice:
                  state.scenario === 'failed'
                    ? isSelected
                      ? '更新失败；现有只读能力保持可用。'
                      : '已模拟回滚；现有只读能力保持可用。'
                    : '已模拟更新适配器。',
              })
            }
          />
          <ManagementRow
            icon={isSelected ? 'bot' : undefined}
            title="OpenCode"
            meta="v0.1.8 · 版本高于已验证范围"
            status="只读降级"
            tone="neutral"
            action="查看兼容性"
            onAction={() => patchState({ notice: '仅展示兼容性说明。' })}
          />
        </div>
      )}

      {isSelected && activeManagementTab === 'recovery' && (
        <div className="b2-maintenance-panel">
          <div className="operation-list">
            <section>
              <B2Icon name="download" />
              <div>
                <strong>导出当前上下文的原生资产</strong>
                <p>只生成合成导出计划；不读取或打包真实文件。</p>
              </div>
              <button type="button" onClick={() => patchState({ notice: '已生成合成导出计划。' })}>
                准备导出
              </button>
            </section>
            <section>
              <B2Icon name="trash-2" />
              <div>
                <strong>删除前审查</strong>
                <p>删除必须经过确认并保留可恢复证据；本 Mock 不写入磁盘。</p>
              </div>
              <button
                type="button"
                title={writeBlockReason ?? undefined}
                disabled={selectedWritesBlocked}
                onClick={() => patchState({ recoveryAction: 'delete-confirm' })}
              >
                审查删除
              </button>
            </section>
            <section>
              <B2Icon name="rotate-ccw" />
              <div>
                <strong>回滚结果演练</strong>
                <p>用当前场景表达成功、冲突或失败的稳定结果码。</p>
              </div>
              <button
                type="button"
                title={writeBlockReason ?? undefined}
                disabled={selectedWritesBlocked}
                onClick={() => patchState({ recoveryAction: 'delete-result' })}
              >
                模拟回滚
              </button>
            </section>
          </div>

          {!selectedWritesBlocked && state.recoveryAction === 'delete-confirm' && (
            <InlineNotice b2Icons tone="warning" title="确认删除原生资产？">
              仅准备删除计划；确认前会重新校验 revision，并保留恢复证据。
              <button
                type="button"
                title={writeBlockReason ?? undefined}
                disabled={selectedWritesBlocked}
                onClick={() => patchState({ recoveryAction: 'delete-result' })}
              >
                确认模拟删除
              </button>
            </InlineNotice>
          )}

          {!selectedWritesBlocked && state.recoveryAction === 'delete-result' && (
            <section className={`management-maintenance-result ${rollbackTone}`} aria-live="polite">
              <B2Icon name={rollbackTone === 'positive' ? 'check-circle-2' : 'alert-triangle'} />
              <div>
                <strong>{rollbackCode}</strong>
                <p>
                  {state.scenario === 'failed'
                    ? '回滚事务在写入前失败；当前内容保持不变。'
                    : state.scenario === 'conflict'
                      ? '目标 revision 已变化；保留冲突报告，未覆盖当前内容。'
                      : '已完成合成回滚；回滚前状态被记录为新的恢复证据。'}
                </p>
              </div>
            </section>
          )}
        </div>
      )}

      {!isSelected && activeManagementTab === 'recovery' && (
        <div className="recovery-table">
          {mockRecoveryPoints.map((point) => (
            <div key={point.id}>
              <span className="mono">{point.id}</span>
              <strong>{point.assetName}</strong>
              <span>{point.time}</span>
              <span>{point.pinned ? '已固定' : '可清理'}</span>
              <button type="button" onClick={() => patchState({ notice: `已选择 ${point.id}` })}>
                查看
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="management-footer">
        <button
          className="quiet-button"
          type="button"
          onClick={() =>
            patchState({
              journey: 'browse',
              stage: 'browse',
              selectedPanel: 'list',
              selectedStep: state.variant === 'selected' ? 'list' : state.selectedStep,
            })
          }
        >
          返回工作区
        </button>
      </div>
    </div>
  );
}

function RecoverySurface({
  state,
  asset,
  patchState,
}: Pick<LayoutProps, 'state' | 'asset' | 'patchState'>): JSX.Element {
  const conflict = state.scenario === 'conflict';
  const readOnly =
    state.scenario === 'readonly' || asset.status === '只读' || asset.status === '不兼容';
  return (
    <div className="flow-surface recovery-surface">
      <FlowHeader
        eyebrow="资产操作"
        title={`导出、删除与恢复 ${asset.name}`}
        description="操作入口集中呈现，但不会抢占浏览与编辑主路径。"
        step={1}
        total={1}
      />
      {state.recoveryAction === 'idle' && (
        <div className="operation-list">
          <section>
            <span className="operation-icon">⇧</span>
            <div>
              <h2>导出原生文件</h2>
              <p>保持目录结构与未知字段，不转换成工具私有格式。</p>
            </div>
            <button
              type="button"
              onClick={() => patchState({ notice: '已模拟导出；没有写入磁盘。' })}
            >
              选择位置…
            </button>
          </section>
          <section>
            <span className="operation-icon">↶</span>
            <div>
              <h2>从恢复点恢复</h2>
              <p>
                {conflict
                  ? '目标位置已有不同内容；必须选择新名称或返回。'
                  : '恢复会先审查差异并重新校验目标 revision。'}
              </p>
              {conflict && <span className="mini-badge danger">恢复冲突</span>}
            </div>
            <button
              type="button"
              disabled={conflict || readOnly}
              onClick={() =>
                patchState({
                  stage: 'result',
                  notice: '已完成模拟恢复；未访问真实文件或执行 Git。',
                })
              }
            >
              模拟审查并恢复
            </button>
          </section>
          <section className="danger-operation">
            <span className="operation-icon">⌫</span>
            <div>
              <h2>可恢复删除</h2>
              <p>删除前固定恢复点；不会删除 Git 历史或执行 Git 命令。</p>
            </div>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => patchState({ recoveryAction: 'delete-confirm' })}
            >
              删除…
            </button>
          </section>
        </div>
      )}
      {state.recoveryAction === 'delete-confirm' && (
        <section className="recovery-action-state warning" aria-labelledby="delete-confirm-title">
          <span className="outcome-mark danger" aria-hidden="true">
            !
          </span>
          <span className="eyebrow">聚焦确认</span>
          <h2 id="delete-confirm-title">可恢复删除 {asset.name}？</h2>
          <p>删除前会固定恢复点 RP-MOCK-DELETE。不会操作 Git，也不会删除其他资产。</p>
          <dl>
            <div>
              <dt>目标</dt>
              <dd>{asset.files.length} 个原生文件</dd>
            </div>
            <div>
              <dt>恢复</dt>
              <dd>可从恢复点审查并恢复</dd>
            </div>
          </dl>
          <div>
            <button
              className="primary-button"
              type="button"
              autoFocus
              onClick={() => patchState({ recoveryAction: 'idle' })}
            >
              保留资产
            </button>
            <button
              className="quiet-button danger-text"
              type="button"
              onClick={() => patchState({ recoveryAction: 'delete-result' })}
            >
              确认可恢复删除
            </button>
          </div>
        </section>
      )}
      {state.recoveryAction === 'delete-result' && (
        <section className="recovery-action-state" aria-live="polite">
          <span className={`outcome-mark ${state.scenario === 'failed' ? 'danger' : 'positive'}`}>
            {state.scenario === 'failed' ? '!' : '✓'}
          </span>
          <span className="eyebrow">删除结果</span>
          <h2>{state.scenario === 'failed' ? '删除失败，原文件保持不变' : '资产已可恢复删除'}</h2>
          <p>
            {state.scenario === 'failed'
              ? '事务在提交前失败；rollback: notNeeded。'
              : '恢复点 RP-MOCK-DELETE 已固定；未执行任何 Git 操作。'}
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() =>
              patchState({
                journey: 'browse',
                stage: 'browse',
                recoveryAction: 'idle',
              })
            }
          >
            返回资产库
          </button>
        </section>
      )}
      <FlowFooter
        secondaryLabel="返回资产"
        onSecondary={() => patchState({ journey: 'browse', stage: 'browse' })}
        primaryLabel="查看全部恢复点"
        onPrimary={() =>
          patchState({
            journey: 'manage',
            stage: 'manage',
            managementTab: 'recovery',
          })
        }
      />
    </div>
  );
}

function ManagementRow({
  icon,
  title,
  meta,
  status,
  tone,
  action,
  actionDisabled = false,
  actionTitle,
  onAction,
}: {
  icon?: B2IconName;
  title: string;
  meta: string;
  status: string;
  tone: string;
  action: string;
  actionDisabled?: boolean;
  actionTitle?: string;
  onAction: () => void;
}): JSX.Element {
  return (
    <section>
      <div className="management-leading">
        <span className="project-icon">
          {icon === undefined ? title.slice(0, 2).toUpperCase() : <B2Icon name={icon} />}
        </span>
        <div>
          <strong>{title}</strong>
          <span>{meta}</span>
        </div>
      </div>
      <span className={`status-chip ${tone}`}>{status}</span>
      <button type="button" title={actionTitle} disabled={actionDisabled} onClick={onAction}>
        {action}
      </button>
    </section>
  );
}

function FlowHeader({
  eyebrow,
  title,
  description,
  step,
  total,
}: {
  eyebrow: string;
  title: string;
  description: string;
  step: number;
  total: number;
}): JSX.Element {
  return (
    <header className="flow-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {total > 1 && (
        <div className="step-indicator" aria-label={`第 ${step} 步，共 ${total} 步`}>
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={index + 1 <= step ? 'is-complete' : ''} />
          ))}
          <small>
            {step}/{total}
          </small>
        </div>
      )}
    </header>
  );
}

function FlowFooter({
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
  primaryTitle,
  disabled = false,
}: {
  secondaryLabel: string;
  onSecondary: () => void;
  primaryLabel: string;
  onPrimary: (event: React.MouseEvent<HTMLButtonElement>) => void;
  primaryTitle?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <footer className="flow-footer">
      <button className="quiet-button" type="button" onClick={onSecondary}>
        {secondaryLabel}
      </button>
      <button
        className="primary-button"
        type="button"
        title={primaryTitle}
        disabled={disabled}
        onClick={onPrimary}
      >
        {primaryLabel}
      </button>
    </footer>
  );
}

function InlineNotice({
  b2Icons = false,
  tone,
  title,
  children,
}: {
  b2Icons?: boolean;
  tone: 'warning' | 'danger' | 'neutral';
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`inline-notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">
        {b2Icons ? (
          <B2Icon
            name={
              tone === 'neutral' ? 'info' : tone === 'danger' ? 'alert-octagon' : 'alert-triangle'
            }
          />
        ) : tone === 'danger' ? (
          '!'
        ) : tone === 'warning' ? (
          '△'
        ) : (
          'i'
        )}
      </span>
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}

function EmptyState({
  b2Icons = false,
  title,
  description,
}: {
  b2Icons?: boolean;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="empty-state">
      <span aria-hidden="true">{b2Icons ? <B2Icon name="search" /> : '⌕'}</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function LibraryLoading(): JSX.Element {
  return (
    <div className="library-loading" aria-label="正在加载资产">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index}>
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function ResizeDivider({
  label,
  value,
  min,
  max,
  reverse = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  reverse?: boolean;
  onChange: (value: number) => void;
}): JSX.Element {
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const startX = event.clientX;
    const startValue = value;
    event.currentTarget.setPointerCapture(event.pointerId);
    const handleMove = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX;
      const next = startValue + (reverse ? -delta : delta);
      onChange(Math.min(max, Math.max(min, next)));
    };
    const handleUp = (): void => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onChange(event.key === 'Home' ? min : max);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const step = event.shiftKey ? 32 : 8;
    const next = value + direction * (reverse ? -step : step);
    onChange(Math.min(max, Math.max(min, next)));
  };

  return (
    <button
      className="resize-divider"
      type="button"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onPointerDown={startDrag}
      onKeyDown={handleKeyDown}
    >
      <span />
    </button>
  );
}

function FocusedDialog({
  b2Icons,
  title,
  description,
  tone,
  details,
  detailsLabel,
  primaryLabel,
  primaryDisabled = false,
  primaryTitle,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  b2Icons: boolean;
  title: string;
  description: string;
  tone: 'default' | 'warning';
  details?: string[];
  detailsLabel?: string;
  primaryLabel: string;
  primaryDisabled?: boolean;
  primaryTitle?: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
}): JSX.Element {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    (primaryDisabled ? secondaryRef.current : primaryRef.current)?.focus();
  }, [primaryDisabled]);

  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className={`focused-dialog ${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="focused-dialog-title"
        onKeyDown={keepFocusInside}
      >
        <span className="dialog-mark" aria-hidden="true">
          {b2Icons ? (
            <B2Icon name={tone === 'warning' ? 'alert-triangle' : 'check-circle-2'} />
          ) : tone === 'warning' ? (
            '!'
          ) : (
            '✓'
          )}
        </span>
        <h2 id="focused-dialog-title">{title}</h2>
        <p>{description}</p>
        {details !== undefined && (
          <ul aria-label={detailsLabel}>
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button ref={secondaryRef} className="quiet-button" type="button" onClick={onSecondary}>
            {secondaryLabel}
          </button>
          <button
            ref={primaryRef}
            className="primary-button"
            type="button"
            title={primaryTitle}
            disabled={primaryDisabled}
            onClick={onPrimary}
          >
            {primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function PrototypeController({
  state,
  onVariant,
  onJourney,
  onScenario,
  onCatalogState,
  onViewport,
  onReset,
}: {
  state: MockUiState;
  onVariant: (variant: MockVariant) => void;
  onJourney: (journey: MockJourney) => void;
  onScenario: (scenario: MockScenario) => void;
  onCatalogState: (catalogState: CatalogState) => void;
  onViewport: (viewport: ViewPreset) => void;
  onReset: () => void;
}): JSX.Element {
  const availableJourneys =
    state.variant === 'selected' ? journeys.filter((journey) => journey !== 'recover') : journeys;
  return (
    <aside className="prototype-controller" aria-label="原型控制器">
      <div className="variant-switcher">
        <button
          type="button"
          aria-label="上一方案"
          onClick={() => onVariant(nextVariant(state.variant, -1))}
        >
          ←
        </button>
        <label>
          <span>结构方案</span>
          <select
            value={state.variant}
            onChange={(event) => onVariant(event.currentTarget.value as MockVariant)}
          >
            {variants.map((variant) => (
              <option key={variant} value={variant}>
                {variant} · {variantNames[variant]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="下一方案"
          onClick={() => onVariant(nextVariant(state.variant, 1))}
        >
          →
        </button>
      </div>
      <div className="controller-fields">
        <label>
          <span>旅程</span>
          <select
            value={state.journey}
            onChange={(event) => onJourney(event.currentTarget.value as MockJourney)}
          >
            {availableJourneys.map((journey) => (
              <option key={journey} value={journey}>
                {state.variant === 'selected' && journey === 'create'
                  ? '导入项目 Skill'
                  : journeyNames[journey]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>场景</span>
          <select
            value={state.scenario}
            onChange={(event) => onScenario(event.currentTarget.value as MockScenario)}
          >
            {scenarios.map((scenario) => (
              <option key={scenario} value={scenario}>
                {scenarioNames[scenario]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>列表</span>
          <select
            value={state.catalogState}
            onChange={(event) => onCatalogState(event.currentTarget.value as CatalogState)}
          >
            <option value="normal">正常</option>
            <option value="loading">Loading</option>
            <option value="empty">Empty</option>
          </select>
        </label>
      </div>
      <div className="controller-status" aria-label="当前原型状态">
        <code>variant/{state.variant}</code>
        <code>journey/{state.journey}</code>
        <code>
          stage/{state.stage}:{stageNames[state.stage]}
        </code>
        <code>asset/{state.assetId}</code>
        <code>dirty/{String(state.dirty)}</code>
        <code>scenario/{state.scenario}</code>
      </div>
      <div className="viewport-switcher" aria-label="窗口预设">
        {(['wide', 'medium', 'narrow'] as const).map((viewport) => (
          <button
            key={viewport}
            className={state.viewport === viewport ? 'is-selected' : ''}
            type="button"
            onClick={() => onViewport(viewport)}
          >
            {viewportNames[viewport]}
          </button>
        ))}
      </div>
      <button className="reset-button" type="button" onClick={onReset}>
        重置
      </button>
    </aside>
  );
}
