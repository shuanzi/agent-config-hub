import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ChevronLeft,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import type {
  AgentType,
  ConfigContext,
  InstalledSubagent,
  ProjectSummary,
  ScopeTarget,
} from '../../types';
import {
  useAddSubagentRepo,
  useDiscoverableSubagents,
  useInstallSubagent,
  useInstalledSubagents,
  useRemoveSubagentRepo,
  useSubagentRepos,
  useUninstallSubagent,
} from '../../hooks/useSubagents';
import { toUserError } from '../../lib/errors';
import { AgentBrandMark, agentLabels, WORKBENCH_AGENTS } from '../workbench/AgentBrandMark';
import { FocusedDialog } from '../workbench/FocusedDialog';
import { InitialAgentRadioGroup } from '../workbench/InitialAgentRadioGroup';
import { RepoManagerPanel } from './RepoManagerPanel';
import { SubagentCard, type SubagentCardSubagent } from './SubagentCard';
import './subagents.css';

interface SubagentsDiscoveryPageProps {
  context: ConfigContext;
  projects: readonly ProjectSummary[];
}

type StatusFilter = 'all' | 'installed' | 'uninstalled';
type Notice = { tone: 'error' | 'status'; message: string } | null;
type SubagentItem = SubagentCardSubagent;

function targetForContext(context: ConfigContext): ScopeTarget | null {
  if (context.kind === 'global') return { scope: 'global' };
  if (context.kind === 'project') return { scope: 'project', projectId: context.projectId };
  return null;
}

function contextKey(context: ConfigContext): string {
  return context.kind === 'project' ? `project:${context.projectId}` : context.kind;
}

function sameTarget(left: ScopeTarget, right: ScopeTarget): boolean {
  return (
    left.scope === right.scope &&
    (left.scope !== 'project' || (right.scope === 'project' && left.projectId === right.projectId))
  );
}

function targetValue(target: ScopeTarget | null): string {
  if (target === null) return '';
  return target.scope === 'global' ? 'global' : `project:${target.projectId}`;
}

function targetFromValue(value: string): ScopeTarget | null {
  if (value === 'global') return { scope: 'global' };
  return value.startsWith('project:') ? { scope: 'project', projectId: value.slice(8) } : null;
}

function messageFor(error: unknown): string {
  const userError = toUserError(error);
  return [userError.message, userError.suggestion].filter(Boolean).join('\n');
}

function SubagentNotice({ notice }: { notice: Notice }) {
  if (notice === null) return null;
  return (
    <div
      className={notice.tone === 'error' ? 'subagent-error' : 'subagent-status-message'}
      role={notice.tone === 'error' ? 'alert' : 'status'}
      aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
    >
      {notice.message}
    </div>
  );
}

function SubagentInstallDialog({
  subagent,
  targetText,
  projectTarget,
  initialApp,
  pending,
  notice,
  onInitialAppChange,
  onConfirm,
  onClose,
}: {
  subagent: SubagentItem | null;
  targetText: string | null;
  projectTarget: boolean;
  initialApp: AgentType | null;
  pending: boolean;
  notice: Notice;
  onInitialAppChange: (app: AgentType) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (subagent === null) return null;
  return (
    <FocusedDialog
      open
      title={`安装 ${subagent.name}`}
      onClose={onClose}
      closeLabel={`关闭安装 ${subagent.name} 对话框`}
      footer={
        <>
          <button type="button" className="subagent-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="subagent-button is-primary"
            onClick={onConfirm}
            disabled={pending || targetText === null || initialApp === null}
          >
            {pending ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {pending ? '安装中…' : '确认安装'}
          </button>
        </>
      }
    >
      <SubagentNotice notice={notice} />
      <p className="subagent-dialog-empty">
        安装后仅启用所选初始 Agent，其他 Agent 可在已安装详情中调整。
      </p>
      <p className="subagent-dialog-empty">安装目标：{targetText ?? '未选择目标'}</p>
      <InitialAgentRadioGroup
        name="subagent-install-initial-agent"
        value={initialApp}
        onChange={onInitialAppChange}
        disabled={pending}
        disabledApps={projectTarget ? ['codex'] : []}
        description={projectTarget ? '项目配置不支持 Codex Subagent。' : undefined}
      />
    </FocusedDialog>
  );
}

function mapAppField(app: AgentType): keyof InstalledSubagent['apps'] {
  switch (app) {
    case 'claude-code':
      return 'claudeCode';
    case 'codex':
      return 'codex';
    case 'gemini-cli':
      return 'geminiCli';
    case 'opencode':
      return 'opencode';
  }
}

function DiscoverableSubagentDetail({
  subagent,
  installedSubagent,
  installPending,
  projectTarget,
  uninstallPending,
  onBack,
  backButtonRef,
  onInstall,
  onUninstall,
}: {
  subagent: SubagentItem | null;
  installedSubagent: InstalledSubagent | null;
  installPending: boolean;
  projectTarget: boolean;
  uninstallPending: boolean;
  onBack: () => void;
  backButtonRef: RefObject<HTMLButtonElement>;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  if (subagent === null) {
    return (
      <aside className="subagent-detail-pane subagent-detail-empty" aria-label="Subagent 详情">
        <p>选择左侧 Subagent 查看详情。</p>
      </aside>
    );
  }

  return (
    <aside
      className="subagent-detail-pane"
      aria-label={`${subagent.name} 详情`}
      data-subagent-key={subagent.key}
      data-subagent-detail-key={subagent.key}
    >
      <button ref={backButtonRef} type="button" className="subagent-detail-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        返回列表
      </button>
      <header className="subagent-detail-header">
        <div>
          <p className="subagent-eyebrow">
            {subagent.installed ? '已安装 Subagent' : '发现 Subagent'}
          </p>
          <h2 className="skill-card-title">{subagent.name}</h2>
          {subagent.description && <p>{subagent.description}</p>}
        </div>
        <span className={subagent.installed ? 'subagent-status is-enabled' : 'subagent-status'}>
          {subagent.installed ? '已安装' : '可安装'}
        </span>
      </header>

      <dl className="subagent-detail-facts">
        <div>
          <dt>目录</dt>
          <dd>{subagent.directory}</dd>
        </div>
        <div>
          <dt>路径</dt>
          <dd>{subagent.path}</dd>
        </div>
        <div>
          <dt>仓库</dt>
          <dd>
            {subagent.repoOwner}/{subagent.repoName}
          </dd>
        </div>
        <div>
          <dt>分支</dt>
          <dd>{subagent.repoBranch || 'main'}</dd>
        </div>
      </dl>

      {installedSubagent !== null && (
        <section className="subagent-agent-state" aria-label="已启用 Agent">
          <h3>已启用 Agent</h3>
          <div>
            {WORKBENCH_AGENTS.map((app) => {
              const enabled = installedSubagent.apps[mapAppField(app)];
              return (
                <span
                  key={app}
                  className={
                    enabled ? 'subagent-agent-state-mark is-enabled' : 'subagent-agent-state-mark'
                  }
                  title={`${agentLabels[app]}：${enabled ? '已启用' : '未启用'}`}
                  data-subagent-agent-state={app}
                >
                  <AgentBrandMark app={app} size={18} />
                  <span className="subagent-visually-hidden">
                    {agentLabels[app]}：{enabled ? '已启用' : '未启用'}
                  </span>
                </span>
              );
            })}
          </div>
        </section>
      )}

      <div className="subagent-detail-actions">
        {subagent.readmeUrl && (
          <a className="subagent-button" href={subagent.readmeUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden="true" />
            README
          </a>
        )}
        {subagent.installed ? (
          <button
            type="button"
            className="subagent-button is-danger uninstall"
            onClick={onUninstall}
            disabled={uninstallPending}
          >
            {uninstallPending ? (
              <Loader2 size={14} className="spin" aria-hidden="true" />
            ) : (
              <Trash2 size={14} aria-hidden="true" />
            )}
            {uninstallPending ? '卸载中…' : '卸载'}
          </button>
        ) : (
          <>
            {projectTarget && (
              <p
                id="subagent-install-unsupported"
                className="subagent-install-unsupported"
                role="status"
              >
                项目配置不支持 Codex Subagent，请选择其他 Agent。
              </p>
            )}
            <button
              type="button"
              className="subagent-button is-primary install"
              onClick={onInstall}
              disabled={installPending}
              aria-describedby={projectTarget ? 'subagent-install-unsupported' : undefined}
            >
              {installPending ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : (
                <Download size={14} aria-hidden="true" />
              )}
              {installPending ? '安装中…' : '安装'}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

export function SubagentsDiscoveryPage({ context, projects }: SubagentsDiscoveryPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRepo, setFilterRepo] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [repoManagerOpen, setRepoManagerOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledSubagent | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [installDialogKey, setInstallDialogKey] = useState<string | null>(null);
  const [initialApp, setInitialApp] = useState<AgentType | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [allDiscoveryTarget, setAllDiscoveryTarget] = useState<ScopeTarget | null>(null);
  const initializedSelectionRef = useRef(false);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const detailBackButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousContextKeyRef = useRef(contextKey(context));
  const scopedTarget = targetForContext(context);
  const discoveryTarget = scopedTarget ?? allDiscoveryTarget;
  const discoveryTargetValue = targetValue(discoveryTarget);
  const previousDiscoveryTargetRef = useRef(discoveryTargetValue);

  const {
    data: discoverableSubagents,
    isLoading: loadingDiscoverable,
    refetch: refetchDiscoverable,
  } = useDiscoverableSubagents(discoveryTarget);
  const { data: installedSubagents } = useInstalledSubagents(context);
  const { data: repos = [] } = useSubagentRepos();
  const installMutation = useInstallSubagent();
  const uninstallMutation = useUninstallSubagent();
  const addRepoMutation = useAddSubagentRepo();
  const removeRepoMutation = useRemoveSubagentRepo();

  // 完整身份 `{owner}/{repo}:{path}` 是唯一关联键；同名 stem 不能合并。
  const installedByKey = useMemo(() => {
    const map = new Map<string, InstalledSubagent>();
    for (const subagent of installedSubagents ?? []) {
      if (discoveryTarget === null || !sameTarget(subagent.target, discoveryTarget)) continue;
      map.set(subagent.id.toLowerCase(), subagent);
    }
    return map;
  }, [discoveryTarget, installedSubagents]);

  const subagents = useMemo<SubagentItem[]>(() => {
    if (discoverableSubagents === undefined) return [];
    return discoverableSubagents.map((subagent) => {
      const installedSubagent = installedByKey.get(subagent.key.toLowerCase()) ?? null;
      return {
        ...subagent,
        installed: subagent.installed,
        installedId: installedSubagent?.id ?? null,
      };
    });
  }, [discoverableSubagents, installedByKey]);

  const repoOptions = useMemo(() => {
    const options = new Set<string>();
    for (const subagent of subagents) options.add(`${subagent.repoOwner}/${subagent.repoName}`);
    return [...options].sort();
  }, [subagents]);

  const filteredSubagents = useMemo(() => {
    let result = subagents;
    if (filterRepo !== 'all') {
      result = result.filter(
        (subagent) => `${subagent.repoOwner}/${subagent.repoName}` === filterRepo,
      );
    }
    if (filterStatus === 'installed') result = result.filter((subagent) => subagent.installed);
    if (filterStatus === 'uninstalled') result = result.filter((subagent) => !subagent.installed);

    const query = searchQuery.trim().toLowerCase();
    if (!query) return result;
    return result.filter((subagent) =>
      [
        subagent.name,
        subagent.key,
        subagent.directory,
        subagent.path,
        subagent.repoOwner,
        subagent.repoName,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [filterRepo, filterStatus, searchQuery, subagents]);

  useEffect(() => {
    if (discoverableSubagents === undefined) return;
    if (!initializedSelectionRef.current) {
      initializedSelectionRef.current = true;
      if (filteredSubagents.length > 0) setSelectedKey(filteredSubagents[0].key);
      return;
    }
    if (
      selectedKey !== null &&
      !filteredSubagents.some((subagent) => subagent.key === selectedKey)
    ) {
      setSelectedKey(null);
      setDetailOpen(false);
    }
  }, [discoverableSubagents, filteredSubagents, selectedKey]);

  useEffect(() => {
    if (
      uninstallTarget !== null &&
      !(installedSubagents ?? []).some(
        (subagent) =>
          subagent.id === uninstallTarget.id && sameTarget(subagent.target, uninstallTarget.target),
      )
    ) {
      setUninstallTarget(null);
    }
  }, [installedSubagents, uninstallTarget]);

  const selectedSubagent = useMemo(
    () => filteredSubagents.find((subagent) => subagent.key === selectedKey) ?? null,
    [filteredSubagents, selectedKey],
  );
  const selectedInstalledSubagent = useMemo(
    () =>
      selectedSubagent?.installedId === null ||
      selectedSubagent === null ||
      discoveryTarget === null
        ? null
        : (installedSubagents?.find(
            (subagent) =>
              subagent.id === selectedSubagent.installedId &&
              sameTarget(subagent.target, discoveryTarget),
          ) ?? null),
    [discoveryTarget, installedSubagents, selectedSubagent],
  );

  useEffect(() => {
    if (detailOpen && selectedSubagent !== null) detailBackButtonRef.current?.focus();
  }, [detailOpen, selectedSubagent]);

  useEffect(() => {
    const nextContextKey = contextKey(context);
    if (previousContextKeyRef.current === nextContextKey) return;

    previousContextKeyRef.current = nextContextKey;
    setAllDiscoveryTarget(null);
    setSelectedKey(null);
    setInstallDialogKey(null);
    setInitialApp(null);
    setDetailOpen(false);
    setUninstallTarget(null);
    window.setTimeout(() => panelRef.current?.focus(), 0);
  }, [context]);

  useEffect(() => {
    if (
      allDiscoveryTarget?.scope === 'project' &&
      !projects.some((project) => project.projectId === allDiscoveryTarget.projectId)
    ) {
      setAllDiscoveryTarget(null);
    }
  }, [allDiscoveryTarget, projects]);

  useEffect(() => {
    if (previousDiscoveryTargetRef.current === discoveryTargetValue) return;

    previousDiscoveryTargetRef.current = discoveryTargetValue;
    setSelectedKey(null);
    setInstallDialogKey(null);
    setInitialApp(null);
    setDetailOpen(false);
    setUninstallTarget(null);
    window.setTimeout(() => panelRef.current?.focus(), 0);
  }, [discoveryTargetValue]);

  const requireDiscoveryTarget = (): ScopeTarget | null => {
    if (discoveryTarget !== null) return discoveryTarget;
    setNotice({ tone: 'error', message: '请先选择全局配置或一个项目配置作为发现和安装目标。' });
    return null;
  };

  const selectSubagent = (key: string) => {
    setNotice(null);
    setSelectedKey(key);
    setInitialApp(null);
    setDetailOpen(true);
  };

  const openInstallDialog = (key: string) => {
    const subagent = subagents.find((candidate) => candidate.key === key);
    if (subagent === undefined || subagent.installed) return;
    setNotice(null);
    if (requireDiscoveryTarget() === null) return;
    setInitialApp(null);
    setInstallDialogKey(key);
  };

  const closeDetail = () => {
    setDetailOpen(false);
    window.setTimeout(() => selectedRowRef.current?.focus(), 0);
  };

  const handleConfirmInstall = async () => {
    if (installDialogKey === null) return;
    const subagent = subagents.find((candidate) => candidate.key === installDialogKey);
    if (subagent === undefined) return;
    setNotice(null);
    const target = requireDiscoveryTarget();
    if (target === null) return;
    const selectedInitialApp = initialApp;
    if (selectedInitialApp === null) {
      setNotice({ tone: 'error', message: '请选择安装后要启用的初始 Agent。' });
      return;
    }
    if (target.scope === 'project' && selectedInitialApp === 'codex') {
      setNotice({ tone: 'error', message: '项目配置不支持 Codex Subagent，请选择其他 Agent。' });
      return;
    }
    try {
      const { installedId: _installedId, ...discoverable } = subagent;
      await installMutation.mutateAsync({
        subagent: discoverable,
        target,
        initialApp: selectedInitialApp,
      });
      setInstallDialogKey(null);
      setInitialApp(null);
      setNotice({ tone: 'status', message: `已安装 ${subagent.name}。` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const handleUninstall = (key: string) => {
    const subagent = subagents.find((candidate) => candidate.key === key);
    if (subagent === undefined || subagent.installedId === null || discoveryTarget === null) return;
    const installedSubagent = (installedSubagents ?? []).find(
      (candidate) =>
        candidate.id === subagent.installedId && sameTarget(candidate.target, discoveryTarget),
    );
    if (installedSubagent === undefined) return;
    setNotice(null);
    setUninstallTarget(installedSubagent);
  };

  const handleConfirmUninstall = async () => {
    if (uninstallTarget === null) return;
    const { id, name, target } = uninstallTarget;
    setUninstallTarget(null);
    setNotice(null);
    try {
      await uninstallMutation.mutateAsync({ id, target });
      setNotice({ tone: 'status', message: `已卸载 ${name}。` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const handleAddRepo = async (repo: Parameters<typeof addRepoMutation.mutateAsync>[0]) => {
    setNotice(null);
    try {
      await addRepoMutation.mutateAsync(repo);
      if (discoveryTarget !== null) await refetchDiscoverable();
      setNotice({ tone: 'status', message: `已添加 ${repo.owner}/${repo.name}。` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
      throw error;
    }
  };

  const handleRemoveRepo = async (owner: string, name: string) => {
    setNotice(null);
    try {
      await removeRepoMutation.mutateAsync({ owner, name });
      setNotice({ tone: 'status', message: `已移除 ${owner}/${name}。` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  return (
    <section
      ref={panelRef}
      className="subagent-panel"
      aria-label="发现 Subagents"
      data-subagent-panel="discovery"
      tabIndex={-1}
    >
      <div className="subagent-toolbar">
        <label className="subagent-search-field" htmlFor="subagent-discovery-search">
          <Search size={15} aria-hidden="true" />
          <span className="subagent-visually-hidden">搜索 Subagent 名称、路径或仓库</span>
          <input
            id="subagent-discovery-search"
            type="search"
            placeholder="搜索 Subagent、路径或仓库"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <label className="subagent-select-field">
          <span className="subagent-visually-hidden">仓库过滤</span>
          <select
            value={filterRepo}
            onChange={(event) => setFilterRepo(event.target.value)}
            aria-label="仓库过滤"
          >
            <option value="all">全部仓库</option>
            {repoOptions.map((repo) => (
              <option key={repo} value={repo}>
                {repo}
              </option>
            ))}
          </select>
        </label>
        <label className="subagent-select-field">
          <span className="subagent-visually-hidden">安装状态过滤</span>
          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value as StatusFilter)}
            aria-label="安装状态过滤"
          >
            <option value="all">全部状态</option>
            <option value="installed">已安装</option>
            <option value="uninstalled">未安装</option>
          </select>
        </label>
        <div className="subagent-toolbar-actions">
          <button
            type="button"
            className="subagent-button"
            onClick={() => {
              if (requireDiscoveryTarget() !== null) void refetchDiscoverable();
            }}
            disabled={discoveryTarget === null}
          >
            <RefreshCw size={14} aria-hidden="true" />
            刷新
          </button>
          <button
            type="button"
            className="subagent-button"
            onClick={() => setRepoManagerOpen(true)}
          >
            <Settings size={14} aria-hidden="true" />
            仓库管理
          </button>
        </div>
        {context.kind === 'all' && (
          <label className="subagent-target-field" htmlFor="subagent-discovery-target">
            <span>发现目标</span>
            <select
              id="subagent-discovery-target"
              aria-label="选择 Subagent 发现目标"
              value={targetValue(allDiscoveryTarget)}
              onChange={(event) => setAllDiscoveryTarget(targetFromValue(event.target.value))}
            >
              <option value="">选择全局或项目配置</option>
              <option value="global">全局配置</option>
              {projects.map((project) => (
                <option key={project.projectId} value={`project:${project.projectId}`}>
                  项目配置：{project.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {searchQuery && (
          <span className="subagent-results-count">{filteredSubagents.length} 个结果</span>
        )}
      </div>

      <SubagentNotice notice={installDialogKey === null ? notice : null} />

      {context.kind === 'all' && discoveryTarget === null ? (
        <div className="subagent-empty" role="status">
          <h3>先选择发现目标</h3>
          <p>请选择全局配置或一个项目配置后，再查看相对该目标的安装状态。</p>
        </div>
      ) : loadingDiscoverable ? (
        <div className="subagent-empty" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>正在加载…</p>
        </div>
      ) : subagents.length === 0 ? (
        <div className="subagent-empty">
          <h3>没有发现可安装的 Subagent</h3>
          <p>请添加仓库后点击刷新。</p>
          <button
            type="button"
            className="subagent-button is-primary"
            onClick={() => setRepoManagerOpen(true)}
          >
            管理仓库
          </button>
        </div>
      ) : filteredSubagents.length === 0 ? (
        <div className="subagent-empty">
          <h3>没有匹配的 Subagent</h3>
          <p>请调整搜索或过滤条件。</p>
        </div>
      ) : (
        <div className="subagent-master-detail" data-detail-open={detailOpen || undefined}>
          <div className="subagent-list-pane" aria-label="发现的 Subagent 列表">
            <div className="subagent-list">
              {filteredSubagents.map((subagent) => (
                <SubagentCard
                  key={subagent.key}
                  subagent={subagent}
                  selected={subagent.key === selectedKey}
                  onSelect={selectSubagent}
                  selectionRef={subagent.key === selectedKey ? selectedRowRef : undefined}
                />
              ))}
            </div>
          </div>
          <DiscoverableSubagentDetail
            subagent={selectedSubagent}
            installedSubagent={selectedInstalledSubagent}
            installPending={installMutation.isPending}
            projectTarget={discoveryTarget?.scope === 'project'}
            uninstallPending={uninstallMutation.isPending}
            onBack={closeDetail}
            backButtonRef={detailBackButtonRef}
            onInstall={() => {
              if (selectedSubagent !== null) openInstallDialog(selectedSubagent.key);
            }}
            onUninstall={() => {
              if (selectedSubagent !== null) handleUninstall(selectedSubagent.key);
            }}
          />
        </div>
      )}

      {repoManagerOpen && (
        <RepoManagerPanel
          repos={repos}
          subagents={discoverableSubagents ?? []}
          onAdd={handleAddRepo}
          onRemove={handleRemoveRepo}
          onClose={() => setRepoManagerOpen(false)}
        />
      )}

      {installDialogKey !== null && (
        <SubagentInstallDialog
          subagent={subagents.find((subagent) => subagent.key === installDialogKey) ?? null}
          targetText={
            discoveryTarget === null
              ? null
              : discoveryTarget.scope === 'global'
                ? '全局配置'
                : `项目配置：${projects.find((project) => project.projectId === discoveryTarget.projectId)?.displayName ?? discoveryTarget.projectId}`
          }
          projectTarget={discoveryTarget?.scope === 'project'}
          initialApp={initialApp}
          pending={installMutation.isPending}
          notice={notice}
          onInitialAppChange={setInitialApp}
          onConfirm={() => void handleConfirmInstall()}
          onClose={() => {
            setInstallDialogKey(null);
            setInitialApp(null);
            setNotice(null);
          }}
        />
      )}

      {uninstallTarget !== null && (
        <FocusedDialog
          open
          title="确认卸载"
          onClose={() => setUninstallTarget(null)}
          footer={
            <>
              <button
                type="button"
                className="subagent-button"
                onClick={() => setUninstallTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="subagent-button is-danger"
                onClick={() => void handleConfirmUninstall()}
                disabled={uninstallMutation.isPending}
              >
                卸载
              </button>
            </>
          }
        >
          <p className="subagent-dialog-confirm-copy">
            确定要卸载 {uninstallTarget.name} 吗？该 Subagent 将从该配置目标的所有 Agent 移除。
          </p>
        </FocusedDialog>
      )}
    </section>
  );
}
