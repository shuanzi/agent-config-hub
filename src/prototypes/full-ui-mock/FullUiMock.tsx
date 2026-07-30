import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
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
  initialMockState,
  journeys,
  resetForJourney,
  resetMockState,
  scenarios,
  stageFor,
  syncMockQuery,
  variants,
} from './state';
import type {
  AssetType,
  CatalogState,
  MockAsset,
  MockJourney,
  MockScenario,
  MockUiState,
  MockVariant,
  CreateMode,
  SkillAgentTarget,
  SkillTargetAction,
  Stage,
  ViewPreset,
} from './types';
import './mock.css';

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

function creationAsset(state: MockUiState): MockAsset {
  const isProjectSkillImport = state.createMode === '导入项目 Skill';
  const name =
    state.createName.trim() || (isProjectSkillImport ? 'commit-message-guide' : 'imported-skill');
  const mainContent =
    state.createMode === '新建'
      ? `---\nname: ${name}\ndescription: 新建的合成原生资产\n---\n\n# ${name}\n\n这是尚未写入磁盘的原生草稿。`
      : `---\nname: ${name}\ndescription: 从 ${isProjectSkillImport ? state.importProject : 'examples/skill'} 模拟导入\n---\n\n# ${name}\n\n导入内容仅来自内存中的合成 fixture。`;
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
        ? [{ name: 'SKILL.md', language: 'markdown', changed: true, content: mainContent }]
        : [
            { name: 'SKILL.md', language: 'markdown', changed: true, content: mainContent },
            {
              name: 'examples/imported.md',
              language: 'markdown',
              changed: true,
              content: '# Imported example\n\n合成导入示例；没有读取真实文件。',
            },
          ],
  };
}

function skillTargetKey(assetId: string, agent: string): string {
  return `${assetId}:${agent}`;
}

function isSkillTargetEnabled(
  state: MockUiState,
  asset: MockAsset,
  target: SkillAgentTarget,
): boolean {
  const configured = state.skillAgentEnabled[skillTargetKey(asset.id, target.agent)];
  return configured ?? target.status === 'recognized';
}

function targetToggleLabel(target: SkillAgentTarget, enabled: boolean): string {
  if (target.status === 'blocked') return '不可用';
  return enabled ? '已启用' : '未启用';
}

export function FullUiMock(): JSX.Element {
  const [state, setState] = useState<MockUiState>(initialMockState);
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<Partial<MockUiState> | null>(null);
  const [sensitiveVisible, setSensitiveVisible] = useState(false);
  const [convertTarget, setConvertTarget] = useState('Codex');
  const searchRef = useRef<HTMLInputElement>(null);
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const globalSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const globalSearchRestoreRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const previousOverlayRef = useRef<MockUiState['panelOverlay']>(null);

  // A/B/C 是第一阶段的完整设计证据；selected 是第二阶段独立重构，不改写它们。
  const visualVariant = state.variant;
  const storedAsset = getAsset(state.assetId);
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

  const selectedAssets = useMemo(() => {
    const currentTypeAssets = mockAssets.filter((candidate) => candidate.type === state.assetType);
    if (state.assetType === 'Skills') {
      const filtered = filterAssets(currentTypeAssets, state.scopeFilter, {
        status: [],
        agent: [],
      });
      // “全部”范围下固定把全局 Skill 放在项目 Skill 前；同一范围内保持 fixture 顺序。
      return state.scopeFilter === '全部'
        ? filtered
            .slice()
            .sort((left, right) => Number(left.scope === '项目') - Number(right.scope === '项目'))
        : filtered;
    }
    const agentFiltered =
      state.agentFilter === '全部 Agent'
        ? currentTypeAssets
        : currentTypeAssets.filter((candidate) => candidate.agent === state.agentFilter);
    return filterAssets(agentFiltered, state.scopeFilter, state.filters);
  }, [state.agentFilter, state.assetType, state.filters, state.scopeFilter]);

  useEffect(() => {
    syncMockQuery(state);
  }, [state.variant, state.journey, state.scenario]);

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
          globalSearchRestoreRef.current = document.activeElement as HTMLElement | null;
          setState((previous) => ({ ...previous, globalSearchOpen: true }));
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
      if (event.altKey && !isEditableTarget(event.target)) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const direction = event.key === 'ArrowLeft' ? -1 : 1;
          setState((previous) => {
            const variant = nextVariant(previous.variant, direction);
            return {
              ...previous,
              variant,
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
  }, [state.variant]);

  useEffect(() => {
    if (state.stage !== 'confirm' && state.stage !== 'discard') {
      const previousTarget = restoreFocusRef.current;
      const fallbackTarget =
        state.stage === 'review'
          ? document.querySelector<HTMLElement>('.review-surface .flow-footer .primary-button')
          : state.stage === 'editing'
            ? document.querySelector<HTMLElement>('.editor-shell textarea')
            : null;
      window.requestAnimationFrame(() => {
        if (previousTarget?.isConnected) {
          previousTarget.focus();
        } else {
          fallbackTarget?.focus();
        }
      });
      restoreFocusRef.current = null;
    }
  }, [state.stage]);

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
    if (assetId === state.assetId) {
      if (state.variant === 'selected' && getAsset(assetId).type === 'Skills') {
        patchState({ selectedPanel: 'detail' });
      }
      return;
    }
    if (state.dirty) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setPendingAssetId(assetId);
      setPendingTransition(null);
      patchState({ stage: 'discard' });
      return;
    }
    commitAssetChoice(assetId);
  };

  const commitAssetChoice = (assetId: string): void => {
    const nextAsset = getAsset(assetId);
    setPendingAssetId(null);
    setState((previous) => ({
      ...previous,
      assetId: nextAsset.id,
      assetType: nextAsset.type,
      fileName: nextAsset.files[0].name,
      journey: previous.skillTarget !== null ? 'browse' : previous.journey,
      stage: previous.journey === 'edit' ? 'editing' : 'browse',
      dirty: false,
      drafts: {},
      skillTarget: null,
      panelOverlay: null,
      globalSearchOpen: false,
      globalSearch: '',
      selectedPanel:
        previous.variant === 'selected' && nextAsset.type === 'Skills'
          ? 'detail'
          : previous.selectedPanel,
      notice: null,
    }));
  };

  const chooseAssetType = (assetType: AssetType): void => {
    const firstAsset = mockAssets.find((candidate) => candidate.type === assetType);
    if (firstAsset === undefined) return;
    if (state.dirty && firstAsset.id !== state.assetId) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setPendingAssetId(firstAsset.id);
      setPendingTransition(null);
      patchState({ stage: 'discard' });
      return;
    }
    commitAssetChoice(firstAsset.id);
    if (state.variant === 'selected' && assetType === 'Skills') {
      patchState({ selectedPanel: 'list' });
    }
  };

  const chooseJourney = (journey: MockJourney): void => {
    setPendingAssetId(null);
    setPendingTransition(null);
    setState((previous) => resetForJourney(previous, journey));
  };

  const chooseScenario = (scenario: MockScenario): void => {
    setPendingAssetId(null);
    setPendingTransition(null);
    setState((previous) => ({
      ...resetForJourney(previous, previous.journey, scenario),
      stage: stageFor(previous.journey, scenario),
    }));
  };

  const requestTransition = (transition: Partial<MockUiState>): void => {
    if (state.dirty) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setPendingAssetId(null);
      setPendingTransition(transition);
      patchState({ stage: 'discard' });
      return;
    }
    setState((previous) => ({ ...previous, ...transition }));
  };

  const startCreate = (mode: CreateMode): void => {
    const transition: MockUiState = {
      ...resetForJourney(state, 'create', 'ready'),
      createMode: mode,
      createName:
        mode === '新建'
          ? 'new-skill'
          : mode === '导入项目 Skill'
            ? 'commit-message-guide'
            : 'imported-skill',
      importProject: 'acme/desktop',
      targetAssetType: mode === '导入项目 Skill' ? 'Skills' : state.assetType,
      targetAgent: 'Codex',
      targetScope: '项目',
      stage: 'target',
    };
    requestTransition(transition);
  };

  const startManage = (): void =>
    requestTransition({
      journey: 'manage',
      stage: 'manage',
      skillTarget: null,
      dirty: false,
      drafts: {},
      panelOverlay: null,
      recoveryAction: 'idle',
    });

  const startConvert = (): void =>
    requestTransition({
      journey: 'convert',
      stage: 'target',
      skillTarget: null,
      dirty: false,
      drafts: {},
      panelOverlay: null,
      recoveryAction: 'idle',
    });

  const startSkillTarget = (
    assetId: string,
    action: SkillTargetAction,
    target: SkillAgentTarget,
  ): void => {
    if (target.status !== 'installable' && target.status !== 'convertible') return;
    const targetAsset = getAsset(assetId);
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
      recoveryAction: 'idle',
    };
    setConvertTarget(target.agent);
    if (state.dirty) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setPendingAssetId(null);
      setPendingTransition(transition);
      patchState({ stage: 'discard' });
      return;
    }
    setState((previous) => ({ ...previous, ...transition }));
  };

  const openGlobalSearch = (): void => {
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
    closeGlobalSearch();
    chooseAsset(assetId);
  };

  const startRecover = (): void =>
    state.variant === 'selected'
      ? requestTransition({ journey: 'browse', stage: 'browse', selectedPanel: 'list' })
      : requestTransition({
          journey: 'recover',
          stage: 'recover',
          skillTarget: null,
          dirty: false,
          drafts: {},
          panelOverlay: null,
          recoveryAction: 'idle',
        });

  const toggleSkillTarget = (assetId: string, target: SkillAgentTarget): void => {
    if (target.status === 'blocked') return;
    const targetAsset = getAsset(assetId);
    const currentEnabled = isSkillTargetEnabled(state, targetAsset, target);
    patchState({
      skillAgentEnabled: {
        ...state.skillAgentEnabled,
        [skillTargetKey(assetId, target.agent)]: !currentEnabled,
      },
    });
  };

  const startReview = (): void => {
    patchState({ stage: 'review', dirty: true, notice: null });
  };

  const openConfirmation = (source: HTMLElement): void => {
    restoreFocusRef.current = source;
    patchState({ stage: 'confirm' });
  };

  const applyPreparedOperation = (): void => {
    if (state.scenario === 'conflict') {
      patchState({
        stage: 'result',
        dirty: true,
        notice: 'apply 重新校验发现磁盘变化；返回 REPREPARE_REQUIRED，未写入文件。',
      });
      return;
    }
    if (state.scenario === 'failed' || state.scenario === 'blocked') {
      patchState({
        stage: 'result',
        dirty: true,
        notice:
          state.scenario === 'failed'
            ? '事务在提交前失败；原文件与草稿均已保留。'
            : '能力或授权阻断；没有写入文件。',
      });
      return;
    }
    patchState({
      stage: 'result',
      dirty: false,
      drafts: {},
      notice:
        state.variant === 'selected'
          ? '已完成模拟应用；当前文件状态已更新。'
          : '已完成模拟应用，并固定恢复点 RP-20260729-1042。',
    });
  };

  const sharedProps: LayoutProps = {
    state,
    asset,
    activeFile,
    visibleAssets,
    selectedAssets,
    searchRef,
    globalSearchRef,
    globalSearchTriggerRef,
    sensitiveVisible,
    convertTarget,
    patchState,
    chooseAsset,
    chooseAssetType,
    startCreate,
    startManage,
    startConvert,
    startSkillTarget,
    toggleSkillTarget,
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
          searchRef={globalSearchRef}
          onSearch={(globalSearch) => patchState({ globalSearch })}
          onClose={closeGlobalSearch}
          onChoose={chooseGlobalAsset}
        />
      )}

      <PrototypeController
        state={state}
        onVariant={(variant) =>
          patchState({
            variant,
            ...(variant === 'selected' && state.journey === 'recover'
              ? {
                  journey: 'browse' as const,
                  stage: 'browse' as const,
                  selectedPanel: 'list' as const,
                }
              : {}),
            ...(state.journey === 'create' && variant === 'selected'
              ? {
                  createMode: '导入项目 Skill' as const,
                  createName: 'commit-message-guide',
                  importProject: 'acme/desktop',
                  targetAssetType: 'Skills' as const,
                  targetScope: '项目' as const,
                }
              : {}),
            ...(state.journey === 'create' && state.variant === 'selected' && variant !== 'selected'
              ? {
                  createMode: '新建' as const,
                  createName: 'new-skill',
                  targetAssetType: state.assetType,
                  targetScope: '项目' as const,
                }
              : {}),
          })
        }
        onJourney={chooseJourney}
        onScenario={chooseScenario}
        onCatalogState={(catalogState) => patchState({ catalogState })}
        onViewport={(viewport) =>
          patchState({
            viewport,
            panelOverlay: null,
            inspectorOpen: viewport === 'narrow' ? null : state.inspectorOpen,
          })
        }
        onReset={() => {
          setPendingAssetId(null);
          setPendingTransition(null);
          setSensitiveVisible(false);
          setState(resetMockState());
        }}
      />

      {state.stage === 'discard' && (
        <FocusedDialog
          title="保留当前草稿并继续编辑？"
          description="当前资产有未应用的本地更改。MVP 不维护多资产草稿池；默认继续停留在当前资产。"
          tone="warning"
          primaryLabel="继续编辑"
          onPrimary={() => {
            setPendingAssetId(null);
            setPendingTransition(null);
            patchState({ journey: 'edit', stage: 'editing' });
          }}
          secondaryLabel={
            pendingAssetId !== null
              ? '放弃更改并切换'
              : pendingTransition !== null
                ? '放弃更改并继续'
                : '放弃草稿并离开'
          }
          onSecondary={() => {
            if (pendingAssetId !== null) {
              commitAssetChoice(pendingAssetId);
            } else if (pendingTransition !== null) {
              setState((previous) => ({ ...previous, ...pendingTransition }));
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
          details={[
            `${asset.name} · ${asset.agent}`,
            state.skillTarget?.action === 'install'
              ? `复制 ${asset.files.length} 个原生文件到 ${convertTarget}，${state.scenario === 'degraded' ? '含 2 项降级' : '安装计划完整'}`
              : state.journey === 'convert'
                ? `转换到 ${convertTarget}，${state.scenario === 'degraded' ? '含 2 项降级' : '完整映射'}`
                : `修改 ${asset.files.length} 个原生文件`,
            state.variant === 'selected' ? '不会操作 Git' : '应用前固定恢复点；不会操作 Git',
          ]}
          primaryLabel={state.skillTarget?.action === 'install' ? '确认安装并应用' : '确认并应用'}
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
  selectedAssets: MockAsset[];
  searchRef: RefObject<HTMLInputElement>;
  globalSearchRef: RefObject<HTMLInputElement>;
  globalSearchTriggerRef: RefObject<HTMLButtonElement>;
  sensitiveVisible: boolean;
  convertTarget: string;
  patchState: (patch: Partial<MockUiState>) => void;
  chooseAsset: (assetId: string) => void;
  chooseAssetType: (assetType: AssetType) => void;
  startCreate: (mode: CreateMode) => void;
  startManage: () => void;
  startConvert: () => void;
  startSkillTarget: (assetId: string, action: SkillTargetAction, target: SkillAgentTarget) => void;
  toggleSkillTarget: (assetId: string, target: SkillAgentTarget) => void;
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

function SelectedLayout(props: LayoutProps): JSX.Element {
  const { asset, state, patchState } = props;
  const isSkill = asset.type === 'Skills';
  const isSkillEditing = isSkill && state.stage === 'editing';
  const isSkillBrowse = isSkill && state.stage === 'browse';
  const isSkillList = isSkillBrowse && state.selectedPanel === 'list';
  const isSkillDetail = isSkillBrowse && state.selectedPanel === 'detail';
  const isSecondaryFlow = (
    ['target', 'mapping', 'review', 'confirm', 'result', 'conflict', 'manage', 'recover'] as Stage[]
  ).includes(state.stage);

  return (
    <>
      <SelectedHeader {...props} />
      <div
        className={`selected-layout ${isSkillEditing ? 'is-skill-editing' : ''} ${
          isSkillList ? 'is-skill-list' : ''
        } ${isSkillDetail ? 'is-skill-detail' : ''} ${isSecondaryFlow ? 'is-secondary-flow' : ''}`}
      >
        <AssetTypeRail
          state={state}
          onChoose={props.chooseAssetType}
          onManage={props.startManage}
        />
        {!isSkillDetail && !isSkillEditing && !isSecondaryFlow && <SelectedCatalog {...props} />}
        {!isSkillList && (
          <section className="selected-main" aria-label="当前资产详情">
            <button
              className="selected-mobile-back"
              type="button"
              onClick={() => patchState({ selectedPanel: 'list' })}
            >
              返回 {state.assetType}
            </button>
            {isSkillDetail ? (
              <SelectedSkillBrowse {...props} />
            ) : isSkillEditing ? (
              <SelectedSkillEditor {...props} />
            ) : (
              <Workspace {...props} />
            )}
          </section>
        )}
      </div>
    </>
  );
}

function SelectedHeader({
  state,
  startCreate,
  startManage,
  openGlobalSearch,
  globalSearchTriggerRef,
}: Pick<
  LayoutProps,
  'state' | 'startCreate' | 'startManage' | 'openGlobalSearch' | 'globalSearchTriggerRef'
>): JSX.Element {
  const hideSkillBrowseStatus = state.assetType === 'Skills' && state.stage === 'browse';
  return (
    <header className="selected-header">
      <div className="traffic-lights" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="selected-identity">
        <span className="app-mark" aria-hidden="true">
          AC
        </span>
        <strong>Agent Config Manager</strong>
        <span>本地资产工作台</span>
      </div>
      <div className="selected-header-context">
        {!hideSkillBrowseStatus && state.scenario === 'stale' && (
          <span className="status-dot warning">索引过期</span>
        )}
        {!hideSkillBrowseStatus && state.scenario === 'readonly' && (
          <span className="status-dot neutral">只读模式</span>
        )}
      </div>
      <div className="selected-header-actions">
        <button
          ref={globalSearchTriggerRef}
          className="selected-search-trigger"
          type="button"
          onClick={openGlobalSearch}
        >
          <span>搜索</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          className="quiet-button"
          type="button"
          onClick={() => startCreate('导入项目 Skill')}
        >
          导入项目 Skill
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="打开管理"
          title="项目与 Agent 管理"
          onClick={startManage}
        >
          管理
        </button>
      </div>
    </header>
  );
}

function SelectedCatalog({
  state,
  selectedAssets,
  patchState,
  chooseAsset,
  chooseAssetType,
  toggleSkillTarget,
}: Pick<
  LayoutProps,
  | 'state'
  | 'selectedAssets'
  | 'patchState'
  | 'chooseAsset'
  | 'chooseAssetType'
  | 'toggleSkillTarget'
>): JSX.Element {
  const isSkills = state.assetType === 'Skills';
  const activeFilterCount =
    (state.scopeFilter === '全部' ? 0 : 1) +
    (isSkills ? 0 : state.filters.status.length) +
    state.filters.agent.length +
    (state.agentFilter === '全部 Agent' ? 0 : 1);
  const skillAssets = mockAssets.filter((asset) => asset.type === 'Skills');

  const toggleFilterValue = (kind: 'status' | 'agent', value: string): void => {
    const current = state.filters[kind];
    const next = current.includes(value)
      ? current.filter((candidate) => candidate !== value)
      : [...current, value];
    patchState({ filters: { ...state.filters, [kind]: next } });
  };

  return (
    <aside className="selected-catalog" aria-label={`${state.assetType} 资产库`}>
      <header className="selected-catalog-heading">
        <div>
          <span className="eyebrow">资产库</span>
          <h2>{state.assetType}</h2>
          <p>{assetTypeHint[state.assetType]}</p>
        </div>
        {!isSkills && (
          <button
            className={`filter-button ${activeFilterCount > 0 ? 'is-active' : ''}`}
            type="button"
            aria-expanded={state.filterOpen}
            onClick={() => patchState({ filterOpen: !state.filterOpen })}
          >
            筛选{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
          </button>
        )}
        {!isSkills && state.filterOpen && (
          <div className="filter-popover" role="dialog" aria-label="筛选当前资产类型">
            <div className="filter-popover-header">
              <strong>筛选 {state.assetType}</strong>
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
              <legend>来源 Agent</legend>
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
            {state.assetType !== 'Skills' && (
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
            )}
          </div>
        )}
      </header>

      {isSkills && (
        <nav className="selected-scope-tabs" aria-label="Skills 作用域筛选" role="tablist">
          {(['全部', '全局', '项目'] as const).map((scope) => (
            <button
              key={scope}
              className={state.scopeFilter === scope ? 'is-selected' : ''}
              type="button"
              role="tab"
              aria-selected={state.scopeFilter === scope}
              aria-controls="selected-skill-list"
              tabIndex={state.scopeFilter === scope ? 0 : -1}
              onClick={() => patchState({ scopeFilter: scope })}
              onKeyDown={(event) => {
                const scopes = ['全部', '全局', '项目'] as const;
                const currentIndex = scopes.indexOf(scope);
                const nextIndex =
                  event.key === 'ArrowRight'
                    ? (currentIndex + 1) % scopes.length
                    : event.key === 'ArrowLeft'
                      ? (currentIndex - 1 + scopes.length) % scopes.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? scopes.length - 1
                          : -1;
                if (nextIndex < 0) return;
                event.preventDefault();
                patchState({ scopeFilter: scopes[nextIndex] });
                const tabs =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                window.requestAnimationFrame(() => tabs?.[nextIndex]?.focus());
              }}
            >
              {scope}
            </button>
          ))}
        </nav>
      )}

      {isSkills && (
        <div className="skill-catalog-summary" aria-label="Skills Agent 识别摘要">
          <span className="skill-summary-total">已安装 {skillAssets.length}</span>
          {mockAgents.map((agent) => (
            <span key={agent}>
              {targetShortName(agent)} ·{' '}
              {
                skillAssets.filter((asset) =>
                  skillTargetsFor(asset).some(
                    (target) =>
                      target.agent === agent &&
                      target.status !== 'blocked' &&
                      isSkillTargetEnabled(state, asset, target),
                  ),
                ).length
              }
            </span>
          ))}
        </div>
      )}

      <div
        id={isSkills ? 'selected-skill-list' : undefined}
        className="selected-catalog-list"
        role={isSkills ? 'tabpanel' : undefined}
        aria-live="polite"
      >
        {state.scenario === 'stale' && (
          <InlineNotice tone="warning" title="索引可能过期">
            当前类型仍可浏览；重新索引前不会据此授权写入。
            <button type="button" onClick={() => patchState({ notice: '正在模拟重建索引…' })}>
              重建
            </button>
          </InlineNotice>
        )}
        {state.catalogState === 'loading' && <LibraryLoading />}
        {state.catalogState === 'empty' && (
          <EmptyState
            title={`${state.assetType} 还没有资产`}
            description="调整当前类型的筛选条件。"
          />
        )}
        {state.catalogState === 'normal' && selectedAssets.length === 0 && (
          <EmptyState title="没有匹配结果" description="尝试清除当前类型的筛选。" />
        )}
        {state.catalogState === 'normal' && selectedAssets.length > 0 && (
          <ul className={`selected-asset-list ${isSkills ? 'is-skills' : ''}`}>
            {selectedAssets.map((candidate) =>
              candidate.type === 'Skills' ? (
                <SelectedSkillRow
                  key={candidate.id}
                  asset={candidate}
                  selected={candidate.id === state.assetId}
                  enabledTargets={state.skillAgentEnabled}
                  onChoose={() => chooseAsset(candidate.id)}
                  onToggleTarget={(target) => toggleSkillTarget(candidate.id, target)}
                />
              ) : (
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
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
      <footer className="selected-catalog-footer">
        <span>{state.catalogState === 'normal' ? `${selectedAssets.length} 项` : '—'}</span>
        <span>当前类型 · 本地索引</span>
      </footer>
      <nav className="selected-mobile-type-switch" aria-label="窄窗口资产类型">
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
    </aside>
  );
}

function SelectedSkillRow({
  asset,
  selected,
  enabledTargets,
  onChoose,
  onToggleTarget,
}: {
  asset: MockAsset;
  selected: boolean;
  enabledTargets: MockUiState['skillAgentEnabled'];
  onChoose: () => void;
  onToggleTarget: (target: SkillAgentTarget) => void;
}): JSX.Element {
  return (
    <li className={`skill-row ${selected ? 'is-selected' : ''}`}>
      <button
        className="skill-row-summary"
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onChoose}
      >
        <span className="skill-row-name">
          <strong>{asset.name}</strong>
          <small>{asset.scope === '全局' ? '全局' : asset.project}</small>
        </span>
        <span className="skill-row-description">{asset.description}</span>
      </button>
      <div className="skill-targets" aria-label={`${asset.name} 的 Agent 目标状态`}>
        {skillTargetsFor(asset).map((target) => {
          const configured = enabledTargets[skillTargetKey(asset.id, target.agent)];
          const enabled = configured ?? target.status === 'recognized';
          const label = `${targetShortName(target.agent)}：${targetToggleLabel(target, enabled)}`;
          return target.status !== 'blocked' ? (
            <button
              key={target.agent}
              className={`skill-target is-${target.status} ${enabled ? 'is-enabled' : 'is-disabled'}`}
              type="button"
              aria-pressed={enabled}
              aria-label={`${label}；点击${enabled ? '停用' : '启用'}`}
              title={`${label}；点击${enabled ? '停用' : '启用'}`}
              onClick={() => onToggleTarget(target)}
            >
              <span>{targetShortName(target.agent)}</span>
              <b>{targetToggleLabel(target, enabled)}</b>
            </button>
          ) : (
            <button
              key={target.agent}
              className={`skill-target is-${target.status}`}
              type="button"
              disabled
              aria-label={`${targetShortName(target.agent)}：不可用。${target.reason ?? ''}`}
              title={target.reason ?? '当前环境不可用'}
            >
              <span>{targetShortName(target.agent)}</span>
              <b>不可用</b>
            </button>
          );
        })}
      </div>
    </li>
  );
}

function SelectedSkillBrowse({
  state,
  asset,
  patchState,
  toggleSkillTarget,
}: Pick<LayoutProps, 'state' | 'asset' | 'patchState' | 'toggleSkillTarget'>): JSX.Element {
  const readOnly =
    state.scenario === 'readonly' || asset.status === '只读' || asset.status === '不兼容';
  return (
    <section className="selected-skill-detail" aria-label="Skill 结构化详情">
      <header className="selected-detail-header">
        <div>
          <div className="asset-breadcrumb">
            <span>Skills</span>
            <span>/</span>
            <span>结构化信息</span>
          </div>
          <h1>{asset.name}</h1>
          <p>{asset.description}</p>
        </div>
        <div className="asset-actions">
          <button
            className="quiet-button"
            type="button"
            onClick={() => patchState({ selectedPanel: 'list' })}
          >
            返回列表
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={readOnly}
            onClick={() =>
              patchState({
                journey: 'edit',
                stage: 'editing',
                skillTarget: null,
                selectedPanel: 'detail',
                drafts:
                  state.drafts[asset.files[0].name] === undefined
                    ? { ...state.drafts, [asset.files[0].name]: asset.files[0].content }
                    : state.drafts,
              })
            }
          >
            编辑源码
          </button>
        </div>
      </header>
      <div className="skill-structured-sheet">
        <section>
          <span className="eyebrow">定义</span>
          <dl>
            <div>
              <dt>名称</dt>
              <dd>{asset.name}</dd>
            </div>
            <div>
              <dt>描述</dt>
              <dd>{asset.description}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{asset.scope === '全局' ? '本地全局配置' : asset.project}</dd>
            </div>
            <div>
              <dt>生效范围</dt>
              <dd>{asset.scope}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>0.3.0-mock</dd>
            </div>
          </dl>
        </section>
        <section className="skill-structured-targets">
          <span className="eyebrow">Agent 目标</span>
          <p>原生 Skill 保持单一身份；以下状态只说明各 Agent 的识别或可准备操作。</p>
          {skillTargetsFor(asset).map((target) => {
            const enabled = isSkillTargetEnabled(state, asset, target);
            const isBlocked = target.status === 'blocked';
            return (
              <div key={target.agent} className="structured-target-row">
                <div>
                  <strong>{targetShortName(target.agent)}</strong>
                  <span>{targetToggleLabel(target, enabled)}</span>
                </div>
                {!isBlocked ? (
                  <button
                    className="quiet-button"
                    type="button"
                    aria-pressed={enabled}
                    aria-label={`${targetShortName(target.agent)}：${targetToggleLabel(target, enabled)}；点击${enabled ? '停用' : '启用'}`}
                    onClick={() => toggleSkillTarget(asset.id, target)}
                  >
                    {enabled ? '停用' : '启用'}
                  </button>
                ) : (
                  <small>{target.reason ?? '当前环境不可用'}</small>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </section>
  );
}

function SelectedSkillEditor({
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
  return (
    <section className="selected-skill-editor" aria-label="Skill 源码编辑">
      <header className="selected-editor-header">
        <div>
          <div className="asset-breadcrumb">
            <span>Skills</span>
            <span>/</span>
            <span>编辑源码</span>
          </div>
          <h1>{asset.name}</h1>
          <p>本地草稿仅保存在原型内存中，尚未写入文件。</p>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={() =>
            patchState(state.dirty ? { stage: 'discard' } : { journey: 'browse', stage: 'browse' })
          }
        >
          返回结构化详情
        </button>
      </header>
      <ScenarioBanner variant={state.variant} scenario={state.scenario} stage={state.stage} />
      <div className="selected-editor-body">
        {asset.files.length > 1 && (
          <FileTree
            asset={asset}
            activeFileName={activeFile.name}
            onChoose={(fileName) => patchState({ fileName })}
            overlayOpen={state.panelOverlay === 'files'}
            onClose={() => patchState({ panelOverlay: null })}
          />
        )}
        <section className="native-document" aria-label="原生 Skill 源码">
          <div className="document-toolbar">
            <div className="file-identity">
              <span className="file-icon">{isBinary ? '非文本' : '文件'}</span>
              <strong>{activeFile.name}</strong>
              {state.dirty && <span className="dirty-indicator">● 未应用</span>}
            </div>
            {asset.files.length > 1 && (
              <button
                className="file-tree-trigger"
                type="button"
                onClick={() => patchState({ panelOverlay: 'files' })}
              >
                文件 {asset.files.length}
              </button>
            )}
          </div>
          {isBinary ? (
            <NonTextPreview />
          ) : (
            <div className="editor-shell">
              <textarea
                aria-label={`${activeFile.name} 本地草稿`}
                spellCheck={false}
                value={state.drafts[activeFile.name] ?? activeFile.content}
                onChange={(event) => {
                  const drafts = { ...state.drafts, [activeFile.name]: event.currentTarget.value };
                  const dirty = Object.entries(drafts).some(([name, content]) => {
                    const original = asset.files.find((file) => file.name === name);
                    return original === undefined || original.content !== content;
                  });
                  patchState({ drafts, dirty });
                }}
              />
              <footer className="editor-footer">
                <span>源码编辑 · 未写入磁盘</span>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!state.dirty && state.scenario !== 'dirty'}
                  onClick={startReview}
                >
                  审查更改
                </button>
              </footer>
            </div>
          )}
        </section>
        {state.panelOverlay === 'files' && (
          <button
            className="panel-scrim"
            type="button"
            aria-label="关闭文件树"
            onClick={() => patchState({ panelOverlay: null })}
          />
        )}
      </div>
    </section>
  );
}

function GlobalSearchOverlay({
  state,
  searchRef,
  onSearch,
  onClose,
  onChoose,
}: {
  state: MockUiState;
  searchRef: RefObject<HTMLInputElement>;
  onSearch: (value: string) => void;
  onClose: () => void;
  onChoose: (assetId: string) => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);
  const normalized = state.globalSearch.trim().toLowerCase();
  const results = mockAssets.filter((asset) => {
    if (normalized.length === 0) return true;
    return `${asset.name} ${asset.type} ${asset.agent} ${asset.scope} ${asset.project} ${asset.description}`
      .toLowerCase()
      .includes(normalized);
  });
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
          <button className="quiet-button" type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="global-search-results">
          {results.length === 0 ? (
            <EmptyState title="没有匹配的资产" description="尝试名称、Agent、项目或资产类型。" />
          ) : (
            assetTypes.map((type) => {
              const grouped = results.filter((asset) => asset.type === type);
              if (grouped.length === 0) return null;
              return (
                <section key={type}>
                  <h2>{type}</h2>
                  {grouped.map((asset) => (
                    <button key={asset.id} type="button" onClick={() => onChoose(asset.id)}>
                      <span>
                        <strong>{asset.name}</strong>
                        <small>{asset.description}</small>
                      </span>
                      <span>{asset.agent}</span>
                      <span>{asset.scope}</span>
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

function AssetTypeRail({
  state,
  onChoose,
  onManage,
}: {
  state: MockUiState;
  onChoose: (assetType: AssetType) => void;
  onManage: () => void;
}): JSX.Element {
  const icons: Record<AssetType, string> = {
    Skills: 'S',
    长期指令: 'I',
    Subagents: 'A',
    Hooks: 'H',
  };
  return (
    <nav className="asset-type-rail" aria-label="资产类型">
      {assetTypes.map((type) => (
        <button
          key={type}
          className={state.assetType === type ? 'is-selected' : ''}
          type="button"
          aria-current={state.assetType === type ? 'page' : undefined}
          onClick={() => onChoose(type)}
          title={type}
        >
          <span className="rail-icon">{icons[type]}</span>
          <span>{type === '长期指令' ? '指令' : type}</span>
        </button>
      ))}
      <div className="rail-spacer" />
      <button type="button" title="管理" onClick={onManage}>
        <span className="rail-icon">⚙</span>
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
    surface = <ManagementSurface state={state} patchState={patchState} />;
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
    surface = <OutcomeSurface state={state} asset={asset} patchState={patchState} />;
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
        ☰ 资产库
      </button>
      {state.panelOverlay !== null && (
        <button
          className="panel-scrim"
          type="button"
          aria-label="关闭侧边浮层"
          onClick={() => patchState({ panelOverlay: null, filterOpen: false })}
        />
      )}
      {state.notice !== null && (
        <div className="toast" role="status">
          <span>{state.notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => patchState({ notice: null })}>
            ×
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
        <InlineNotice tone="neutral" title="该资产当前只读">
          {hideHistory
            ? '可浏览原生文件；编辑和转换暂不可用。'
            : '可浏览与导出原生文件；编辑、转换、恢复和删除不可用。'}
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
            <SourcePreview content={activeFile.content} />
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
}: {
  asset: MockAsset;
  activeFileName: string;
  onChoose: (name: string) => void;
  overlayOpen?: boolean;
  onClose?: () => void;
}): JSX.Element {
  return (
    <aside className={`file-tree ${overlayOpen ? 'is-overlay-open' : ''}`} aria-label="资产文件">
      <div className="file-tree-heading">
        <span>文件</span>
        <small>{asset.files.length}</small>
        {onClose !== undefined && (
          <button className="mobile-close" type="button" aria-label="关闭文件树" onClick={onClose}>
            ×
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
          <span>{file.language === 'binary' ? '◫' : '▤'}</span>
          <span className="truncate">{file.name}</span>
          {file.changed && <span className="changed-dot" title="已修改" />}
        </button>
      ))}
    </aside>
  );
}

function SourcePreview({ content }: { content: string }): JSX.Element {
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
      <InlineNotice tone="warning" title="索引状态可能过期">
        正在显示磁盘读取结果。应用前会重新校验，不以索引授权写入。
      </InlineNotice>
    );
  }
  if (scenario === 'readonly') {
    return (
      <InlineNotice tone="neutral" title="当前 Agent 版本仅支持只读">
        可浏览原生内容与导出；编辑、转换和删除暂不可用。
      </InlineNotice>
    );
  }
  if (scenario === 'degraded') {
    return (
      <InlineNotice tone="warning" title="目标能力可能降级">
        浏览不受影响；转换时会逐项说明映射结果。
      </InlineNotice>
    );
  }
  if (scenario === 'blocked') {
    return (
      <InlineNotice tone="danger" title="当前操作被阻断">
        {variant === 'selected'
          ? '查看能力映射或授权范围后再重试。'
          : '查看能力映射或授权范围后选择恢复动作。'}
      </InlineNotice>
    );
  }
  if (scenario === 'conflict' && stage !== 'conflict') {
    return (
      <InlineNotice tone="warning" title="应用时将模拟磁盘漂移">
        用于验收三方冲突与草稿保留状态。
      </InlineNotice>
    );
  }
  if (scenario === 'failed') {
    return (
      <InlineNotice tone="danger" title="部分管理状态读取失败">
        原生文件仍可只读浏览；重试不会产生写入。
      </InlineNotice>
    );
  }
  return null;
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
  const isSelectedProjectImport = state.variant === 'selected' && state.journey === 'create';
  const skillTargetAction = state.skillTarget?.action;
  const isSkillInstall = skillTargetAction === 'install';
  const lockedSkillTargetAgent = state.skillTarget?.agent;
  const lockedSkillTarget = lockedSkillTargetAgent !== undefined;
  const managedProjects = ['acme/desktop', 'acme/server'];
  const importCandidates = mockAssets.filter(
    (candidate) =>
      candidate.type === 'Skills' &&
      candidate.scope === '项目' &&
      candidate.project === state.importProject,
  );

  if (isSelectedProjectImport) {
    return (
      <div className="flow-surface target-surface selected-project-import">
        <FlowHeader
          eyebrow="导入项目 Skill"
          title="从已管理项目导入 Skill"
          description="选择已经纳入管理的项目和其中已有的 Skill；原型不会读取真实目录。"
          step={1}
          total={3}
        />
        <div className="form-sheet">
          <div className="import-project-note">
            <strong>仅导入项目内已有 Skill</strong>
            <span>不提供新建模板或任意本地文件导入。</span>
          </div>
          <div className="field-grid">
            <label>
              <span>已管理项目</span>
              <select
                value={state.importProject}
                onChange={(event) => {
                  const importProject = event.currentTarget.value;
                  const firstCandidate = mockAssets.find(
                    (candidate) =>
                      candidate.type === 'Skills' &&
                      candidate.scope === '项目' &&
                      candidate.project === importProject,
                  );
                  patchState({
                    importProject,
                    createName: firstCandidate?.name ?? 'project-skill',
                  });
                }}
              >
                {managedProjects.map((project) => (
                  <option key={project}>{project}</option>
                ))}
              </select>
            </label>
            <label>
              <span>项目中的 Skill</span>
              <select
                value={state.createName}
                onChange={(event) => patchState({ createName: event.currentTarget.value })}
              >
                {importCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <FlowFooter
          secondaryLabel="取消"
          onSecondary={() => patchState({ journey: 'browse', stage: 'browse', dirty: false })}
          primaryLabel="导入为本地草稿"
          disabled={importCandidates.length === 0}
          onPrimary={() =>
            patchState({
              stage: 'editing',
              dirty: true,
              assetType: 'Skills',
              targetScope: '项目',
              fileName: asset.files[0].name,
              drafts: Object.fromEntries(asset.files.map((file) => [file.name, file.content])),
            })
          }
        />
      </div>
    );
  }

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
      <div className="form-sheet">
        {!isConvert && (
          <div className="entry-switch">
            {(['新建', '从本地导入'] as const).map((mode) => (
              <button
                key={mode}
                className={state.createMode === mode ? 'is-selected' : ''}
                type="button"
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
            <span className="drop-icon">⇩</span>
            <strong>选择本地文件或目录</strong>
            <span>原型不会读取、复制或上传选择内容</span>
            <button
              type="button"
              onClick={() => patchState({ notice: '已模拟选择 examples/skill；未读取真实文件。' })}
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
                onChange={(event) =>
                  patchState({ targetAssetType: event.currentTarget.value as AssetType })
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
              disabled={lockedSkillTarget}
              onChange={(event) => {
                if (isConvert) {
                  setConvertTarget(event.currentTarget.value);
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
              onChange={(event) =>
                patchState({ targetScope: event.currentTarget.value as '全局' | '项目' })
              }
            >
              <option value="项目">项目 · acme/desktop</option>
              <option value="全局">全局 · 用户配置</option>
            </select>
          </label>
          {!isConvert && (
            <label className="wide-field">
              <span>资产名称</span>
              <input
                value={state.createName}
                onChange={(event) => patchState({ createName: event.currentTarget.value })}
              />
              {state.scenario === 'blocked' && (
                <small className="field-error">目标位置已有同名资产；请选择其他名称。</small>
              )}
            </label>
          )}
        </div>
      </div>
      <FlowFooter
        secondaryLabel="取消"
        onSecondary={() => patchState({ journey: 'browse', stage: 'browse', dirty: false })}
        primaryLabel={isSkillInstall ? '生成安装计划' : isConvert ? '生成能力映射' : '创建本地草稿'}
        disabled={state.scenario === 'blocked' && !isConvert}
        onPrimary={() =>
          patchState({
            stage: isConvert ? 'mapping' : 'editing',
            dirty: !isConvert,
            assetType: isConvert ? state.assetType : state.targetAssetType,
            fileName: isConvert ? state.fileName : asset.files[0].name,
            drafts: isConvert
              ? {}
              : Object.fromEntries(asset.files.map((file) => [file.name, file.content])),
          })
        }
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
  const blocked = state.scenario === 'blocked';
  const degraded = state.scenario === 'degraded';
  const isSkillInstall = state.skillTarget?.action === 'install';
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
      <div className={`mapping-summary ${blocked ? 'danger' : degraded ? 'warning' : 'positive'}`}>
        <span className="mapping-symbol">{blocked ? '×' : degraded ? '!' : '✓'}</span>
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
                className={`mini-badge ${conclusion === '完整' ? 'positive' : conclusion === '降级' ? 'warning' : 'danger'}`}
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
          blocked ? '阻断：不能继续' : isSkillInstall ? '继续审查安装计划' : '继续审查差异'
        }
        disabled={blocked}
        onPrimary={() => patchState({ stage: 'review', dirty: false })}
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
  const hideHistory = state.variant === 'selected';
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
  const changedFileCount = isConvert
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
      <div className={`review-grid ${asset.files.length > 1 ? 'has-file-tree' : ''}`}>
        {asset.files.length > 1 && (
          <FileTree
            asset={asset}
            activeFileName={activeFile.name}
            onChoose={(fileName) => patchState({ fileName })}
            overlayOpen={state.panelOverlay === 'files'}
            onClose={() => patchState({ panelOverlay: null })}
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
              {asset.files.length > 1 && (
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
        <aside className="review-checks" aria-label="检查器与校验">
          <header className="review-inspector-heading">
            <span className="eyebrow">辅助信息</span>
            <strong>检查器与校验</strong>
            <small>
              {asset.agent} · {asset.scope}
            </small>
          </header>
          <section>
            <span className="check-symbol success">✓</span>
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
            <span className="check-symbol warning">!</span>
            <div>
              <strong>Git 工作树有修改</strong>
              <p>应用不会暂存、提交或还原 Git 变更。</p>
            </div>
          </section>
          {isConvert && !isSkillInstall && state.scenario === 'degraded' && (
            <section>
              <span className="check-symbol warning">!</span>
              <div>
                <strong>包含 2 项降级</strong>
                <p>目标文件以注释保留未知字段，自动触发改为手动说明。</p>
              </div>
            </section>
          )}
          {!hideHistory && (
            <section>
              <span className="check-symbol success">↶</span>
              <div>
                <strong>将固定恢复点</strong>
                <p>应用前保留当前原生文件，可从结果页恢复。</p>
              </div>
            </section>
          )}
        </aside>
      </div>
      <FlowFooter
        secondaryLabel={isConvert ? '返回映射' : '返回草稿'}
        onSecondary={() =>
          patchState({ stage: isConvert ? 'mapping' : 'editing', dirty: !isConvert })
        }
        primaryLabel="继续确认"
        onPrimary={(event) => openConfirmation(event.currentTarget)}
      />
    </div>
  );
}

function OutcomeSurface({
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
                patchState({ stage: state.journey === 'convert' ? 'mapping' : 'review' })
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
                patchState({ journey: 'browse', stage: 'browse', scenario: 'ready', notice: null })
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

function ManagementSurface({
  state,
  patchState,
}: {
  state: MockUiState;
  patchState: (patch: Partial<MockUiState>) => void;
}): JSX.Element {
  const hideHistory = state.variant === 'selected';
  const activeManagementTab =
    hideHistory && state.managementTab === 'recovery' ? 'projects' : state.managementTab;
  const managementTabs: Array<[MockUiState['managementTab'], string]> = hideHistory
    ? [
        ['projects', '项目与索引'],
        ['agents', 'Agent 与适配器'],
      ]
    : [
        ['projects', '项目与索引'],
        ['agents', 'Agent 与适配器'],
        ['recovery', '恢复点'],
      ];
  return (
    <div className="management-surface">
      <FlowHeader
        eyebrow="工作区管理"
        title="项目、Agent 与索引"
        description="管理维度保持辅助位置，不改变四类资产的一级导航。"
        step={1}
        total={1}
      />
      <nav className="management-tabs" aria-label="管理区域">
        {managementTabs.map(([key, label]) => (
          <button
            key={key}
            className={activeManagementTab === key ? 'is-selected' : ''}
            type="button"
            onClick={() =>
              patchState({ managementTab: key as MockUiState['managementTab'], notice: null })
            }
          >
            {label}
          </button>
        ))}
      </nav>
      {activeManagementTab === 'projects' && (
        <div className="management-list">
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
        </div>
      )}
      {activeManagementTab === 'agents' && (
        <div className="management-list">
          <ManagementRow
            title="Codex"
            meta="v0.7.4 · 官方适配器 1.4.0"
            status="完整支持"
            tone="positive"
            action="检查更新"
            onAction={() => patchState({ notice: '当前已是最新版本。' })}
          />
          <ManagementRow
            title="Gemini CLI"
            meta="v0.3.1 · 适配器更新可用"
            status={state.scenario === 'failed' ? '更新失败 · 保持 1.2.0' : '可更新'}
            tone={state.scenario === 'failed' ? 'danger' : 'warning'}
            action={
              state.scenario === 'failed'
                ? hideHistory
                  ? '重试更新'
                  : '回滚上一版本'
                : '更新适配器'
            }
            onAction={() =>
              patchState({
                notice:
                  state.scenario === 'failed'
                    ? hideHistory
                      ? '更新失败；现有只读能力保持可用。'
                      : '已模拟回滚；现有只读能力保持可用。'
                    : '已模拟更新适配器。',
              })
            }
          />
          <ManagementRow
            title="OpenCode"
            meta="v0.1.8 · 版本高于已验证范围"
            status="只读降级"
            tone="neutral"
            action="查看兼容性"
            onAction={() => patchState({ notice: '仅展示兼容性说明。' })}
          />
        </div>
      )}
      {!hideHistory && activeManagementTab === 'recovery' && (
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
          onClick={() => patchState({ journey: 'browse', stage: 'browse' })}
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
              patchState({ journey: 'browse', stage: 'browse', recoveryAction: 'idle' })
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
          patchState({ journey: 'manage', stage: 'manage', managementTab: 'recovery' })
        }
      />
    </div>
  );
}

function ManagementRow({
  title,
  meta,
  status,
  tone,
  action,
  onAction,
}: {
  title: string;
  meta: string;
  status: string;
  tone: string;
  action: string;
  onAction: () => void;
}): JSX.Element {
  return (
    <section>
      <div className="management-leading">
        <span className="project-icon">{title.slice(0, 2).toUpperCase()}</span>
        <div>
          <strong>{title}</strong>
          <span>{meta}</span>
        </div>
      </div>
      <span className={`status-chip ${tone}`}>{status}</span>
      <button type="button" onClick={onAction}>
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
  disabled = false,
}: {
  secondaryLabel: string;
  onSecondary: () => void;
  primaryLabel: string;
  onPrimary: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <footer className="flow-footer">
      <button className="quiet-button" type="button" onClick={onSecondary}>
        {secondaryLabel}
      </button>
      <button className="primary-button" type="button" disabled={disabled} onClick={onPrimary}>
        {primaryLabel}
      </button>
    </footer>
  );
}

function InlineNotice({
  tone,
  title,
  children,
}: {
  tone: 'warning' | 'danger' | 'neutral';
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`inline-notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">
        {tone === 'danger' ? '!' : tone === 'warning' ? '△' : 'i'}
      </span>
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="empty-state">
      <span aria-hidden="true">⌕</span>
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
  title,
  description,
  tone,
  details,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  description: string;
  tone: 'default' | 'warning';
  details?: string[];
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
}): JSX.Element {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

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
          {tone === 'warning' ? '!' : '✓'}
        </span>
        <h2 id="focused-dialog-title">{title}</h2>
        <p>{description}</p>
        {details !== undefined && (
          <ul>
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button className="quiet-button" type="button" onClick={onSecondary}>
            {secondaryLabel}
          </button>
          <button ref={primaryRef} className="primary-button" type="button" onClick={onPrimary}>
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
