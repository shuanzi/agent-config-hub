import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Blocks,
  Bot,
  ChevronLeft,
  FileText,
  FolderPlus,
  Link2,
  Settings,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { AgentType, ConfigContext, ProjectSummary } from './types';
import { InstalledSkillsPanel } from './components/skills/InstalledSkillsPanel';
import { SkillsDiscoveryPage } from './components/skills/SkillsDiscoveryPage';
import { InstalledSubagentsPanel } from './components/subagents/InstalledSubagentsPanel';
import { SubagentsDiscoveryPage } from './components/subagents/SubagentsDiscoveryPage';
import { InstructionsPanel } from './components/instructions/InstructionsPanel';
import { SettingsView } from './components/settings/SettingsView';
import { toUserError } from './lib/errors';
import {
  useAddProject,
  useProjects,
  useRelinkProjectRoot,
  useRemoveProject,
} from './hooks/useProjects';
import { FocusedDialog } from './components/workbench/FocusedDialog';
import { agentLabels, WORKBENCH_AGENTS } from './components/workbench/AgentBrandMark';

type View = 'skills' | 'instructions' | 'subagents' | 'settings';
type SkillsSubView = 'installed' | 'discovery';
type SubagentsSubView = 'installed' | 'discovery';
type AssetSubView = SkillsSubView | SubagentsSubView;
type NarrowStep = 'type' | 'context' | 'content';
type ProjectDialog =
  | { kind: 'add' }
  | { kind: 'relink'; project: ProjectSummary }
  | { kind: 'remove'; project: ProjectSummary }
  | null;
type NarrowFocusTarget =
  { kind: 'asset-type'; view: View } | { kind: 'context'; contextKey: string };

interface ViewNavigationItem {
  view: View;
  label: string;
  icon: LucideIcon;
}

const viewNavigation: readonly ViewNavigationItem[] = [
  { view: 'skills', label: 'Skills', icon: Blocks },
  { view: 'instructions', label: '长期指令', icon: FileText },
  { view: 'subagents', label: 'Subagents', icon: Bot },
];

const viewLabels: Record<View, string> = {
  skills: 'Skills',
  instructions: '长期指令',
  subagents: 'Subagents',
  settings: '设置',
};

function readNarrowWorkbench(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 1199px)').matches
  );
}

function useNarrowWorkbench(): boolean {
  const [isNarrow, setIsNarrow] = useState(readNarrowWorkbench);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(max-width: 1199px)');
    const update = () => setIsNarrow(query.matches);
    update();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return isNarrow;
}

function AssetTypeRail({
  currentView,
  onSelect,
  onButtonRef,
}: {
  currentView: View;
  onSelect: (view: View) => void;
  onButtonRef: (view: View, node: HTMLButtonElement | null) => void;
}) {
  return (
    <aside className="asset-type-rail" data-workbench-rail="asset-type" aria-label="资产类型">
      <nav className="asset-type-rail-nav" aria-label="资产类型导航">
        {viewNavigation.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            type="button"
            className={currentView === view ? 'rail-button is-selected' : 'rail-button'}
            onClick={() => onSelect(view)}
            ref={(node) => onButtonRef(view, node)}
            aria-current={currentView === view ? 'page' : undefined}
          >
            <span className="rail-icon" aria-hidden="true">
              <Icon size={17} strokeWidth={1.8} />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="asset-type-rail-footer">
        <button
          type="button"
          className={currentView === 'settings' ? 'rail-button is-selected' : 'rail-button'}
          onClick={() => onSelect('settings')}
          ref={(node) => onButtonRef('settings', node)}
          aria-current={currentView === 'settings' ? 'page' : undefined}
        >
          <span className="rail-icon" aria-hidden="true">
            <Settings size={17} strokeWidth={1.8} />
          </span>
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}

function CompactAgentControl({
  activeApp,
  onSelect,
}: {
  activeApp: AgentType;
  onSelect: (app: AgentType) => void;
}) {
  return (
    <label className="current-agent-control">
      <span>当前 Agent</span>
      <select value={activeApp} onChange={(event) => onSelect(event.target.value as AgentType)}>
        {WORKBENCH_AGENTS.map((app) => (
          <option key={app} value={app}>
            {agentLabels[app]}
          </option>
        ))}
      </select>
    </label>
  );
}

function isCurrentContext(context: ConfigContext, target: ConfigContext): boolean {
  return (
    context.kind === target.kind &&
    (context.kind !== 'project' ||
      (target.kind === 'project' && context.projectId === target.projectId))
  );
}

function contextFocusKey(context: ConfigContext): string {
  return context.kind === 'project' ? `project:${context.projectId}` : context.kind;
}

function ConfigContextRail({
  context,
  projects,
  isLoading,
  queryError,
  onSelect,
  onProjectRemoved,
  onContextButtonRef,
}: {
  context: ConfigContext;
  projects: readonly ProjectSummary[];
  isLoading: boolean;
  queryError: unknown;
  onSelect: (context: ConfigContext) => void;
  onProjectRemoved: (projectId: string) => void;
  onContextButtonRef: (context: ConfigContext, node: HTMLButtonElement | null) => void;
}) {
  const [dialog, setDialog] = useState<ProjectDialog>(null);
  const [rootPath, setRootPath] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(
    null,
  );
  const rootPathRef = useRef<HTMLInputElement>(null);
  const addProject = useAddProject();
  const relinkProjectRoot = useRelinkProjectRoot();
  const removeProject = useRemoveProject();

  const closeDialog = () => {
    setDialog(null);
    setRootPath('');
    setDisplayName('');
  };

  const openAddDialog = () => {
    setFeedback(null);
    setRootPath('');
    setDisplayName('');
    setDialog({ kind: 'add' });
  };

  const openRelinkDialog = (project: ProjectSummary) => {
    setFeedback(null);
    setRootPath(project.rootPath);
    setDialog({ kind: 'relink', project });
  };

  const openRemoveDialog = (project: ProjectSummary) => {
    setFeedback(null);
    setDialog({ kind: 'remove', project });
  };

  const reportError = (error: unknown) => {
    setFeedback({ kind: 'error', message: toUserError(error).message });
  };

  const submitAddProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const project = await addProject.mutateAsync({
        rootPath: rootPath.trim(),
        displayName: displayName.trim() || undefined,
      });
      setFeedback({ kind: 'success', message: `已添加项目「${project.displayName}」。` });
      closeDialog();
    } catch (error) {
      reportError(error);
    }
  };

  const submitRelinkProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dialog?.kind !== 'relink') return;

    try {
      await relinkProjectRoot.mutateAsync({
        projectId: dialog.project.projectId,
        rootPath: rootPath.trim(),
      });
      setFeedback({ kind: 'success', message: `已重新关联「${dialog.project.displayName}」。` });
      closeDialog();
    } catch (error) {
      reportError(error);
    }
  };

  const confirmRemoveProject = async () => {
    if (dialog?.kind !== 'remove') return;

    try {
      await removeProject.mutateAsync(dialog.project.projectId);
      onProjectRemoved(dialog.project.projectId);
      setFeedback({ kind: 'success', message: `已移除项目「${dialog.project.displayName}」。` });
      closeDialog();
    } catch (error) {
      reportError(error);
    }
  };

  const isMutating = addProject.isPending || relinkProjectRoot.isPending || removeProject.isPending;
  const currentProject = context.kind === 'project' ? context.projectId : undefined;

  return (
    <aside className="config-context-rail" data-workbench-rail="context" aria-label="配置上下文">
      <div className="config-context-header">
        <p className="config-context-heading">配置上下文</p>
        <button
          type="button"
          className="context-icon-button"
          onClick={openAddDialog}
          aria-label="添加项目"
        >
          <FolderPlus size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      {feedback?.kind === 'success' && (
        <p className="context-feedback context-feedback-success" role="status">
          {feedback.message}
        </p>
      )}
      {feedback?.kind === 'error' && dialog === null && (
        <p className="context-feedback context-feedback-error" role="alert">
          {feedback.message}
        </p>
      )}
      {queryError !== null && queryError !== undefined && (
        <p className="context-feedback context-feedback-error" role="alert">
          {toUserError(queryError).message}
        </p>
      )}

      <nav className="config-context-list" aria-label="配置上下文">
        <button
          type="button"
          className={
            isCurrentContext(context, { kind: 'all' })
              ? 'config-context-option is-selected'
              : 'config-context-option'
          }
          onClick={() => onSelect({ kind: 'all' })}
          ref={(node) => onContextButtonRef({ kind: 'all' }, node)}
          aria-current={isCurrentContext(context, { kind: 'all' }) ? 'page' : undefined}
        >
          全部
        </button>
        <button
          type="button"
          className={
            isCurrentContext(context, { kind: 'global' })
              ? 'config-context-option is-selected'
              : 'config-context-option'
          }
          onClick={() => onSelect({ kind: 'global' })}
          ref={(node) => onContextButtonRef({ kind: 'global' }, node)}
          aria-current={isCurrentContext(context, { kind: 'global' }) ? 'page' : undefined}
        >
          全局配置
        </button>

        <p className="config-project-heading">项目配置</p>
        {isLoading && (
          <p className="config-context-loading" role="status">
            正在载入项目…
          </p>
        )}
        {!isLoading && projects.length === 0 && (
          <p className="config-context-empty">尚未添加项目</p>
        )}
        {projects.map((project) => {
          const isSelected = currentProject === project.projectId;
          const actionLabel = `${project.displayName}（${project.rootPath}）`;
          return (
            <div key={project.projectId} className="config-project-row">
              <button
                type="button"
                className={
                  isSelected ? 'config-context-option is-selected' : 'config-context-option'
                }
                data-project-id={project.projectId}
                onClick={() => onSelect({ kind: 'project', projectId: project.projectId })}
                ref={(node) =>
                  onContextButtonRef({ kind: 'project', projectId: project.projectId }, node)
                }
                aria-current={isSelected ? 'page' : undefined}
                title={project.rootPath}
              >
                <span className="config-project-name">{project.displayName}</span>
                <span className="config-project-path">{project.rootPath}</span>
              </button>
              <div className="config-project-actions">
                <button
                  type="button"
                  className="context-icon-button"
                  onClick={() => openRelinkDialog(project)}
                  aria-label={`重新关联 ${actionLabel}`}
                >
                  <Link2 size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="context-icon-button"
                  onClick={() => openRemoveDialog(project)}
                  aria-label={`移除 ${actionLabel}`}
                >
                  <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </nav>

      <FocusedDialog
        open={dialog?.kind === 'add'}
        title="添加项目"
        onClose={closeDialog}
        initialFocusRef={rootPathRef}
        footer={
          <>
            <button type="button" className="context-dialog-secondary" onClick={closeDialog}>
              取消
            </button>
            <button
              type="submit"
              form="add-project-form"
              className="context-dialog-primary"
              disabled={isMutating}
            >
              添加项目
            </button>
          </>
        }
      >
        <form id="add-project-form" className="context-project-form" onSubmit={submitAddProject}>
          <label>
            项目目录
            <input
              ref={rootPathRef}
              type="text"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              required
            />
          </label>
          <label>
            显示名称（可选）
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          {feedback?.kind === 'error' && <p role="alert">{feedback.message}</p>}
        </form>
      </FocusedDialog>

      <FocusedDialog
        open={dialog?.kind === 'relink'}
        title="重新关联项目目录"
        onClose={closeDialog}
        initialFocusRef={rootPathRef}
        footer={
          <>
            <button type="button" className="context-dialog-secondary" onClick={closeDialog}>
              取消
            </button>
            <button
              type="submit"
              form="relink-project-form"
              className="context-dialog-primary"
              disabled={isMutating}
            >
              重新关联
            </button>
          </>
        }
      >
        <form
          id="relink-project-form"
          className="context-project-form"
          onSubmit={submitRelinkProject}
        >
          <label>
            项目目录
            <input
              ref={rootPathRef}
              type="text"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              required
            />
          </label>
          {feedback?.kind === 'error' && <p role="alert">{feedback.message}</p>}
        </form>
      </FocusedDialog>

      <FocusedDialog
        open={dialog?.kind === 'remove'}
        title="移除项目"
        onClose={closeDialog}
        footer={
          <>
            <button type="button" className="context-dialog-secondary" onClick={closeDialog}>
              取消
            </button>
            <button
              type="button"
              className="context-dialog-danger"
              onClick={confirmRemoveProject}
              disabled={isMutating}
            >
              移除项目
            </button>
          </>
        }
      >
        <p>这只会解除登记，不会删除项目目录或其中的内容。</p>
        {feedback?.kind === 'error' && <p role="alert">{feedback.message}</p>}
      </FocusedDialog>
    </aside>
  );
}

function AssetSubViewTabs({
  value,
  onChange,
  assetLabel,
}: {
  value: AssetSubView;
  onChange: (view: AssetSubView) => void;
  assetLabel: 'Skills' | 'Subagents';
}) {
  const panelId = `${assetLabel.toLowerCase()}-workspace`;

  return (
    <div className="sub-tabs" role="tablist" aria-label={`${assetLabel} 视图`}>
      <button
        id={`${assetLabel.toLowerCase()}-installed-tab`}
        type="button"
        role="tab"
        className={value === 'installed' ? 'sub-tab active' : 'sub-tab'}
        onClick={() => onChange('installed')}
        aria-selected={value === 'installed'}
        aria-controls={panelId}
      >
        已安装
      </button>
      <button
        id={`${assetLabel.toLowerCase()}-discovery-tab`}
        type="button"
        role="tab"
        className={value === 'discovery' ? 'sub-tab active' : 'sub-tab'}
        onClick={() => onChange('discovery')}
        aria-selected={value === 'discovery'}
        aria-controls={panelId}
      >
        发现
      </button>
    </div>
  );
}

export function App() {
  const [currentView, setCurrentView] = useState<View>('skills');
  const [skillsSubView, setSkillsSubView] = useState<SkillsSubView>('installed');
  const [subagentsSubView, setSubagentsSubView] = useState<SubagentsSubView>('installed');
  const [activeApp, setActiveApp] = useState<AgentType>('claude-code');
  const [configContext, setConfigContext] = useState<ConfigContext>({ kind: 'all' });
  const [narrowStep, setNarrowStep] = useState<NarrowStep>('type');
  const isNarrow = useNarrowWorkbench();
  const wasNarrowRef = useRef(isNarrow);
  const narrowTitleRef = useRef<HTMLSpanElement>(null);
  const assetTypeButtonRefs = useRef<Partial<Record<View, HTMLButtonElement>>>({});
  const contextButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<NarrowFocusTarget | null>(null);
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const selectedContext =
    configContext.kind !== 'project' ||
    projects.some((project) => project.projectId === configContext.projectId)
      ? configContext
      : { kind: 'all' as const };

  const title = useMemo(() => {
    if (currentView === 'subagents') {
      return subagentsSubView === 'installed' ? '已安装 Subagents' : '发现 Subagents';
    }
    if (currentView === 'skills') {
      return skillsSubView === 'installed' ? '已安装 Skills' : '发现 Skills';
    }
    return viewLabels[currentView];
  }, [currentView, skillsSubView, subagentsSubView]);

  const registerAssetTypeButton = useCallback((view: View, node: HTMLButtonElement | null) => {
    if (node === null) {
      delete assetTypeButtonRefs.current[view];
      return;
    }
    assetTypeButtonRefs.current[view] = node;
  }, []);

  const registerContextButton = useCallback(
    (context: ConfigContext, node: HTMLButtonElement | null) => {
      const key = contextFocusKey(context);
      if (node === null) {
        contextButtonRefs.current.delete(key);
        return;
      }
      contextButtonRefs.current.set(key, node);
    },
    [],
  );

  useEffect(() => {
    if (isNarrow && !wasNarrowRef.current) {
      pendingFocusRef.current = null;
      setNarrowStep('type');
      narrowTitleRef.current?.focus();
    }
    if (!isNarrow) pendingFocusRef.current = null;
    wasNarrowRef.current = isNarrow;
  }, [isNarrow]);

  useEffect(() => {
    if (!isNarrow) return;

    const pendingFocus = pendingFocusRef.current;
    if (pendingFocus === null) return;

    const target =
      pendingFocus.kind === 'asset-type'
        ? assetTypeButtonRefs.current[pendingFocus.view]
        : contextButtonRefs.current.get(pendingFocus.contextKey);
    (target ?? narrowTitleRef.current)?.focus();
    pendingFocusRef.current = null;
  }, [isNarrow, narrowStep]);

  const selectView = (view: View) => {
    setCurrentView(view);
    if (isNarrow) {
      setNarrowStep(view === 'settings' ? 'content' : 'context');
    }
  };

  const selectContext = (context: ConfigContext) => {
    setConfigContext(context);
    if (isNarrow) setNarrowStep('content');
  };

  const removeProjectFromContext = (projectId: string) => {
    if (configContext.kind === 'project' && configContext.projectId === projectId) {
      setConfigContext({ kind: 'all' });
    }
  };

  const goBack = () => {
    if (narrowStep === 'context') {
      pendingFocusRef.current = { kind: 'asset-type', view: currentView };
      setNarrowStep('type');
      return;
    }
    if (currentView === 'settings') {
      pendingFocusRef.current = { kind: 'asset-type', view: 'settings' };
      setNarrowStep('type');
      return;
    }
    pendingFocusRef.current = {
      kind: 'context',
      contextKey: contextFocusKey(selectedContext),
    };
    setNarrowStep('context');
  };

  const compactTitle =
    narrowStep === 'type' ? '资产类型' : narrowStep === 'context' ? '配置上下文' : title;
  const showAssetTypeRail = !isNarrow || narrowStep === 'type';
  const showContextRail = currentView !== 'settings' && (!isNarrow || narrowStep === 'context');
  const showWorkspace = !isNarrow || narrowStep === 'content';

  return (
    <div className="workbench" data-narrow-step={isNarrow ? narrowStep : undefined}>
      <header className="app-header">
        {isNarrow && narrowStep !== 'type' && (
          <button
            type="button"
            className="app-header-back"
            onClick={goBack}
            aria-label="返回上一步"
          >
            <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>返回</span>
          </button>
        )}
        <div className="app-header-brand">
          <h1 className="app-title">Agent Config Manager</h1>
          <span
            ref={narrowTitleRef}
            className="app-header-page-title"
            aria-live="polite"
            tabIndex={isNarrow ? -1 : undefined}
          >
            {isNarrow ? compactTitle : title}
          </span>
        </div>
        {currentView !== 'instructions' && (
          <CompactAgentControl activeApp={activeApp} onSelect={setActiveApp} />
        )}
      </header>

      <div
        className={
          !isNarrow && currentView === 'settings'
            ? 'workbench-layout is-settings'
            : 'workbench-layout'
        }
      >
        {showAssetTypeRail && (
          <AssetTypeRail
            currentView={currentView}
            onSelect={selectView}
            onButtonRef={registerAssetTypeButton}
          />
        )}
        {showContextRail && (
          <ConfigContextRail
            context={selectedContext}
            projects={projects}
            isLoading={projectsQuery.isLoading}
            queryError={projectsQuery.error}
            onSelect={selectContext}
            onProjectRemoved={removeProjectFromContext}
            onContextButtonRef={registerContextButton}
          />
        )}
        {showWorkspace && (
          <main
            className="app-main-surface"
            aria-label={title}
            data-config-context={selectedContext.kind}
            data-project-id={
              selectedContext.kind === 'project' ? selectedContext.projectId : undefined
            }
          >
            {currentView === 'skills' && (
              <div className="skills-view">
                <AssetSubViewTabs
                  value={skillsSubView}
                  onChange={(view) => setSkillsSubView(view as SkillsSubView)}
                  assetLabel="Skills"
                />
                <div
                  id="skills-workspace"
                  className="skills-view-content"
                  role="tabpanel"
                  aria-labelledby={`skills-${skillsSubView}-tab`}
                >
                  {skillsSubView === 'installed' ? (
                    <InstalledSkillsPanel
                      activeApp={activeApp}
                      context={selectedContext}
                      projects={projects}
                    />
                  ) : (
                    <SkillsDiscoveryPage
                      activeApp={activeApp}
                      context={selectedContext}
                      projects={projects}
                    />
                  )}
                </div>
              </div>
            )}
            {currentView === 'instructions' && (
              <InstructionsPanel context={selectedContext} projects={projects} />
            )}
            {currentView === 'subagents' && (
              <div className="subagents-view">
                <AssetSubViewTabs
                  value={subagentsSubView}
                  onChange={(view) => setSubagentsSubView(view as SubagentsSubView)}
                  assetLabel="Subagents"
                />
                <div
                  id="subagents-workspace"
                  className="subagents-view-content"
                  role="tabpanel"
                  aria-labelledby={`subagents-${subagentsSubView}-tab`}
                >
                  {subagentsSubView === 'installed' ? (
                    <InstalledSubagentsPanel
                      activeApp={activeApp}
                      context={selectedContext}
                      projects={projects}
                    />
                  ) : (
                    <SubagentsDiscoveryPage
                      activeApp={activeApp}
                      context={selectedContext}
                      projects={projects}
                    />
                  )}
                </div>
              </div>
            )}
            {currentView === 'settings' && <SettingsView />}
          </main>
        )}
      </div>
    </div>
  );
}
