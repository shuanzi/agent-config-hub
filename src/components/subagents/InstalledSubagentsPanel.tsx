import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ArchiveRestore,
  ChevronLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  AgentType,
  ConfigContext,
  InstalledSubagent,
  ProjectSummary,
  ScopeTarget,
  SubagentApps,
  SubagentBackupEntry,
} from '../../types';
import {
  useCheckSubagentUpdates,
  useDeleteSubagentBackup,
  useInstalledSubagents,
  useRestoreSubagentBackup,
  useSubagentBackups,
  useToggleSubagentApp,
  useUninstallSubagent,
  useUpdateSubagent,
} from '../../hooks/useSubagents';
import { toUserError } from '../../lib/errors';
import { AgentBrandMark, agentLabels, WORKBENCH_AGENTS } from '../workbench/AgentBrandMark';
import { FocusedDialog } from '../workbench/FocusedDialog';
import './subagents.css';

interface InstalledSubagentsPanelProps {
  context: ConfigContext;
  projects: readonly ProjectSummary[];
}

type Notice = { tone: 'error' | 'status'; message: string } | null;

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

function subagentSelectionId(subagent: InstalledSubagent): string {
  return `${targetValue(subagent.target)}:${subagent.id}`;
}

function mapAppField(app: AgentType): keyof SubagentApps {
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

function formatDate(unixSeconds: number): string {
  if (unixSeconds <= 0) return '—';
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? String(unixSeconds) : date.toLocaleString();
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

function AppToggleGroup({
  apps,
  target,
  onToggle,
  disabled,
}: {
  apps: SubagentApps;
  target: ScopeTarget;
  onToggle: (app: AgentType, enabled: boolean) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="subagent-toggle-group">
      <legend>启用到 Agent</legend>
      <div className="subagent-toggle-list">
        {WORKBENCH_AGENTS.map((app) => {
          const enabled = apps[mapAppField(app)];
          const unsupported = target.scope === 'project' && app === 'codex';
          const state = unsupported ? '项目配置不支持' : enabled ? '已启用' : '未启用';
          return (
            <label
              key={app}
              className={
                unsupported
                  ? 'subagent-agent-toggle is-unsupported'
                  : enabled
                    ? 'subagent-agent-toggle is-enabled'
                    : 'subagent-agent-toggle'
              }
              title={`${agentLabels[app]}：${state}`}
              data-subagent-agent-toggle={app}
              data-subagent-agent-unsupported={unsupported || undefined}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => onToggle(app, event.target.checked)}
                disabled={disabled || unsupported}
                aria-label={`${agentLabels[app]}：${state}`}
              />
              <AgentBrandMark app={app} size={18} />
              <span className="subagent-visually-hidden">
                {agentLabels[app]}：{state}
              </span>
              {unsupported && (
                <span className="subagent-toggle-unsupported" aria-hidden="true">
                  不支持
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function InstalledSubagentDetail({
  subagent,
  hasUpdate,
  pending,
  onBack,
  backButtonRef,
  onToggle,
  onUpdate,
  onUninstall,
}: {
  subagent: InstalledSubagent | null;
  hasUpdate: boolean;
  pending: boolean;
  onBack: () => void;
  backButtonRef: RefObject<HTMLButtonElement>;
  onToggle: (app: AgentType, enabled: boolean) => void;
  onUpdate: () => void;
  onUninstall: () => void;
}) {
  if (subagent === null) {
    return (
      <aside className="subagent-detail-pane subagent-detail-empty" aria-label="Subagent 详情">
        <p>选择左侧 Subagent 查看详情。</p>
      </aside>
    );
  }

  const repository =
    subagent.repoOwner && subagent.repoName
      ? `${subagent.repoOwner}/${subagent.repoName}`
      : '本地安装';

  return (
    <aside
      className="subagent-detail-pane"
      aria-label={`${subagent.name} 详情`}
      data-subagent-id={subagent.id}
      data-subagent-detail-id={subagent.id}
    >
      <button ref={backButtonRef} type="button" className="subagent-detail-back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        返回列表
      </button>
      <header className="subagent-detail-header">
        <div>
          <p className="subagent-eyebrow">已安装 Subagent</p>
          <h2 className="skill-card-title">{subagent.name}</h2>
          {subagent.description && <p>{subagent.description}</p>}
        </div>
        {hasUpdate && <span className="subagent-status is-update">可更新</span>}
      </header>

      <dl className="subagent-detail-facts">
        <div>
          <dt>配置</dt>
          <dd>{subagent.target.scope === 'global' ? '全局配置' : '项目配置'}</dd>
        </div>
        <div>
          <dt>目录</dt>
          <dd>{subagent.directory}</dd>
        </div>
        <div>
          <dt>仓库</dt>
          <dd>{repository}</dd>
        </div>
        <div>
          <dt>安装时间</dt>
          <dd>{formatDate(subagent.installedAt)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatDate(subagent.updatedAt)}</dd>
        </div>
      </dl>

      <AppToggleGroup
        apps={subagent.apps}
        target={subagent.target}
        onToggle={onToggle}
        disabled={pending}
      />

      <div className="subagent-detail-actions">
        {subagent.readmeUrl && (
          <a className="subagent-button" href={subagent.readmeUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden="true" />
            README
          </a>
        )}
        {hasUpdate && (
          <button
            type="button"
            className="subagent-button is-primary"
            onClick={onUpdate}
            disabled={pending}
          >
            <RefreshCw size={14} aria-hidden="true" />
            更新
          </button>
        )}
        <button
          type="button"
          className="subagent-button is-danger"
          onClick={onUninstall}
          disabled={pending}
        >
          {pending ? (
            <Loader2 size={14} className="spin" aria-hidden="true" />
          ) : (
            <Trash2 size={14} aria-hidden="true" />
          )}
          {pending ? '卸载中…' : '卸载'}
        </button>
      </div>
    </aside>
  );
}

function BackupsDialog({
  backups,
  pending,
  onRestore,
  onDelete,
  onClose,
}: {
  backups: SubagentBackupEntry[];
  pending: boolean;
  onRestore: (backup: SubagentBackupEntry) => void;
  onDelete: (backup: SubagentBackupEntry) => void;
  onClose: () => void;
}) {
  return (
    <FocusedDialog
      open
      title="Subagent 备份"
      onClose={onClose}
      footer={
        <button type="button" className="subagent-button" onClick={onClose}>
          关闭
        </button>
      }
    >
      {backups.length === 0 ? (
        <p className="subagent-dialog-empty">暂无备份。</p>
      ) : (
        <div className="subagent-backup-list">
          {backups.map((backup) => (
            <div key={backup.backupId} className="subagent-backup-row">
              <div>
                <strong>{backup.subagent.name}</strong>
                <span>{backup.backupPath}</span>
                <time dateTime={new Date(backup.createdAt * 1000).toISOString()}>
                  {formatDate(backup.createdAt)}
                </time>
              </div>
              <div className="subagent-backup-actions">
                <button
                  type="button"
                  className="subagent-button is-primary"
                  onClick={() => onRestore(backup)}
                  disabled={pending}
                >
                  恢复
                </button>
                <button
                  type="button"
                  className="subagent-icon-button is-danger"
                  onClick={() => onDelete(backup)}
                  disabled={pending}
                  aria-label={`删除 ${backup.subagent.name} 的备份`}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </FocusedDialog>
  );
}

export function InstalledSubagentsPanel({ context, projects }: InstalledSubagentsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [backupsDialogOpen, setBackupsDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledSubagent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [allOperationTarget, setAllOperationTarget] = useState<ScopeTarget | null>(null);
  const initializedSelectionRef = useRef(false);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const detailBackButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousContextKeyRef = useRef(contextKey(context));
  const scopedTarget = targetForContext(context);
  const operationTarget = scopedTarget ?? allOperationTarget;
  const operationTargetValue = targetValue(operationTarget);
  const previousOperationTargetRef = useRef(operationTargetValue);

  const {
    data: subagents,
    isLoading,
    error: installedSubagentsError,
  } = useInstalledSubagents(context);
  const toggleAppMutation = useToggleSubagentApp();
  const uninstallMutation = useUninstallSubagent();
  const {
    data: updates,
    refetch: checkUpdates,
    isFetching: isCheckingUpdates,
  } = useCheckSubagentUpdates(operationTarget);
  const updateSubagentMutation = useUpdateSubagent();
  const { data: backups, refetch: refetchBackups } = useSubagentBackups(operationTarget);
  const restoreMutation = useRestoreSubagentBackup();
  const deleteBackupMutation = useDeleteSubagentBackup();

  const updatesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const update of updates ?? []) map.set(update.id, update.remoteHash);
    return map;
  }, [updates]);

  const enabledCounts = useMemo(() => {
    const counts: Record<AgentType, number> = {
      'claude-code': 0,
      codex: 0,
      'gemini-cli': 0,
      opencode: 0,
    };
    for (const subagent of subagents ?? []) {
      for (const app of WORKBENCH_AGENTS) {
        if (subagent.apps[mapAppField(app)]) counts[app] += 1;
      }
    }
    return counts;
  }, [subagents]);

  const filteredSubagents = useMemo(() => {
    if (subagents === undefined) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return subagents;
    return subagents.filter((subagent) =>
      [
        subagent.name,
        subagent.id,
        subagent.description,
        subagent.directory,
        subagent.repoOwner,
        subagent.repoName,
      ].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [searchQuery, subagents]);

  useEffect(() => {
    if (subagents === undefined) return;
    if (!initializedSelectionRef.current) {
      initializedSelectionRef.current = true;
      if (filteredSubagents.length > 0) setSelectedId(subagentSelectionId(filteredSubagents[0]));
      return;
    }
    if (
      selectedId !== null &&
      !filteredSubagents.some((subagent) => subagentSelectionId(subagent) === selectedId)
    ) {
      setSelectedId(null);
      setDetailOpen(false);
    }
  }, [filteredSubagents, selectedId, subagents]);

  const selectedSubagent = useMemo(
    () =>
      filteredSubagents.find((subagent) => subagentSelectionId(subagent) === selectedId) ?? null,
    [filteredSubagents, selectedId],
  );

  useEffect(() => {
    if (
      uninstallTarget !== null &&
      !(subagents ?? []).some(
        (subagent) =>
          subagent.id === uninstallTarget.id && sameTarget(subagent.target, uninstallTarget.target),
      )
    ) {
      setUninstallTarget(null);
    }
  }, [subagents, uninstallTarget]);

  useEffect(() => {
    if (detailOpen && selectedSubagent !== null) detailBackButtonRef.current?.focus();
  }, [detailOpen, selectedSubagent]);

  useEffect(() => {
    const nextContextKey = contextKey(context);
    if (previousContextKeyRef.current === nextContextKey) return;

    previousContextKeyRef.current = nextContextKey;
    setAllOperationTarget(null);
    setSelectedId(null);
    setDetailOpen(false);
    setUninstallTarget(null);
    setBackupsDialogOpen(false);
    window.setTimeout(() => panelRef.current?.focus(), 0);
  }, [context]);

  useEffect(() => {
    if (
      allOperationTarget?.scope === 'project' &&
      !projects.some((project) => project.projectId === allOperationTarget.projectId)
    ) {
      setAllOperationTarget(null);
    }
  }, [allOperationTarget, projects]);

  useEffect(() => {
    if (previousOperationTargetRef.current === operationTargetValue) return;

    previousOperationTargetRef.current = operationTargetValue;
    setSelectedId(null);
    setDetailOpen(false);
    setUninstallTarget(null);
    setBackupsDialogOpen(false);
    window.setTimeout(() => panelRef.current?.focus(), 0);
  }, [operationTargetValue]);

  const pending =
    toggleAppMutation.isPending ||
    uninstallMutation.isPending ||
    updateSubagentMutation.isPending ||
    restoreMutation.isPending ||
    deleteBackupMutation.isPending;

  const requireOperationTarget = (): ScopeTarget | null => {
    if (operationTarget !== null) return operationTarget;
    setNotice({ tone: 'error', message: '请先选择全局配置或一个项目配置作为操作目标。' });
    return null;
  };

  const selectSubagent = (subagent: InstalledSubagent) => {
    setNotice(null);
    setSelectedId(subagentSelectionId(subagent));
    setDetailOpen(true);
  };

  const closeDetail = () => {
    setDetailOpen(false);
    window.setTimeout(() => selectedRowRef.current?.focus(), 0);
  };

  const handleToggleApp = async (subagent: InstalledSubagent, app: AgentType, enabled: boolean) => {
    if (subagent.target.scope === 'project' && app === 'codex') return;
    setNotice(null);
    try {
      await toggleAppMutation.mutateAsync({
        id: subagent.id,
        target: subagent.target,
        app,
        enabled,
      });
      setNotice({
        tone: 'status',
        message: `已${enabled ? '启用' : '停用'} ${agentLabels[app]}。`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const requestUninstall = (subagent: InstalledSubagent) => {
    if (
      !(subagents ?? []).some(
        (candidate) =>
          candidate.id === subagent.id && sameTarget(candidate.target, subagent.target),
      )
    ) {
      return;
    }
    setNotice(null);
    setUninstallTarget(subagent);
  };

  const handleConfirmUninstall = async () => {
    if (uninstallTarget === null) return;
    const { id, name, target } = uninstallTarget;
    setUninstallTarget(null);
    setNotice(null);
    try {
      await uninstallMutation.mutateAsync({ id, target });
      if (selectedId === subagentSelectionId(uninstallTarget)) setSelectedId(null);
      setNotice({ tone: 'status', message: `已卸载 ${name}。` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const handleCheckUpdates = async () => {
    setNotice(null);
    if (requireOperationTarget() === null) return;
    try {
      const result = await checkUpdates();
      const count = result.data?.length ?? 0;
      setNotice({
        tone: 'status',
        message:
          count === 0 ? '当前没有可更新的 Subagent。' : `发现 ${count} 个可更新的 Subagent。`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const handleUpdateSubagent = async (subagent: InstalledSubagent) => {
    setNotice(null);
    try {
      await updateSubagentMutation.mutateAsync({ id: subagent.id, target: subagent.target });
      setNotice({ tone: 'status', message: `已更新 ${subagent.name}。` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const handleUpdateAll = async () => {
    setNotice(null);
    const target = requireOperationTarget();
    if (target === null) return;
    const applicable = (updates ?? [])
      .map((update) => ({
        update,
        subagent: (subagents ?? []).find(
          (candidate) => candidate.id === update.id && sameTarget(candidate.target, target),
        ),
      }))
      .filter(
        (
          entry,
        ): entry is { update: NonNullable<typeof updates>[number]; subagent: InstalledSubagent } =>
          entry.subagent !== undefined,
      );
    if (applicable.length === 0) return;

    let success = 0;
    const failures: string[] = [];
    for (const { update, subagent } of applicable) {
      try {
        await updateSubagentMutation.mutateAsync({ id: subagent.id, target: subagent.target });
        success += 1;
      } catch (error) {
        failures.push(`${update.name}: ${messageFor(error)}`);
      }
    }

    const message = [
      ...(success > 0 ? [`成功更新 ${success} 个 Subagent。`] : []),
      ...failures,
    ].join('\n');
    if (message) setNotice({ tone: failures.length > 0 ? 'error' : 'status', message });
  };

  const handleOpenBackups = async () => {
    setNotice(null);
    if (requireOperationTarget() === null) return;
    setBackupsDialogOpen(true);
    try {
      await refetchBackups();
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const handleRestore = async (backup: SubagentBackupEntry) => {
    setNotice(null);
    try {
      await restoreMutation.mutateAsync({
        backupId: backup.backupId,
        target: backup.subagent.target,
      });
      setBackupsDialogOpen(false);
      setNotice({ tone: 'status', message: '已恢复 Subagent 备份。' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const handleDeleteBackup = async (backup: SubagentBackupEntry) => {
    setNotice(null);
    try {
      await deleteBackupMutation.mutateAsync({
        backupId: backup.backupId,
        target: backup.subagent.target,
      });
      await refetchBackups();
      setNotice({ tone: 'status', message: '已删除备份。' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFor(error) });
    }
  };

  const hasUpdate = (subagent: InstalledSubagent) =>
    operationTarget !== null &&
    sameTarget(subagent.target, operationTarget) &&
    updatesMap.has(subagent.id);

  return (
    <section
      ref={panelRef}
      className="subagent-panel"
      aria-label="已安装 Subagents"
      data-subagent-panel="installed"
      tabIndex={-1}
    >
      <div className="subagent-summary-row">
        <span>已安装 {subagents?.length ?? 0} 个</span>
        <div className="subagent-agent-counts" aria-label="各 Agent 启用数量">
          {WORKBENCH_AGENTS.map((app) => (
            <span key={app} title={`${agentLabels[app]}：${enabledCounts[app]} 个`}>
              <AgentBrandMark app={app} size={16} />
              {enabledCounts[app]}
            </span>
          ))}
        </div>
      </div>

      <div className="subagent-toolbar">
        <label className="subagent-search-field" htmlFor="subagent-installed-search">
          <Search size={15} aria-hidden="true" />
          <span className="subagent-visually-hidden">搜索已安装 Subagent</span>
          <input
            id="subagent-installed-search"
            type="search"
            placeholder="搜索已安装 Subagent"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <div className="subagent-toolbar-actions">
          <button
            type="button"
            className="subagent-button"
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdates || pending}
          >
            {isCheckingUpdates ? (
              <Loader2 size={14} className="spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            检查更新
          </button>
          {(updates ?? []).length > 0 && (
            <button
              type="button"
              className="subagent-button is-primary"
              onClick={handleUpdateAll}
              disabled={pending}
            >
              <RefreshCw size={14} aria-hidden="true" />
              全部更新 ({updates!.length})
            </button>
          )}
          <button
            type="button"
            className="subagent-button"
            onClick={handleOpenBackups}
            disabled={pending || operationTarget === null}
          >
            <ArchiveRestore size={14} aria-hidden="true" />
            备份
          </button>
        </div>
        {context.kind === 'all' && (
          <label className="subagent-target-field" htmlFor="subagent-installed-target">
            <span>操作目标</span>
            <select
              id="subagent-installed-target"
              aria-label="选择 Subagent 操作目标"
              value={targetValue(allOperationTarget)}
              onChange={(event) => setAllOperationTarget(targetFromValue(event.target.value))}
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
      </div>

      <SubagentNotice
        notice={
          installedSubagentsError === null
            ? notice
            : { tone: 'error', message: messageFor(installedSubagentsError) }
        }
      />

      {isLoading ? (
        <div className="subagent-empty" role="status">
          <Loader2 size={24} className="spin" aria-hidden="true" />
          <p>正在加载…</p>
        </div>
      ) : subagents === undefined || subagents.length === 0 ? (
        <div className="subagent-empty">
          <h3>尚未安装任何 Subagent</h3>
          <p>切换到“发现”页签浏览并安装 Subagent。</p>
        </div>
      ) : filteredSubagents.length === 0 ? (
        <div className="subagent-empty">
          <h3>没有匹配的 Subagent</h3>
        </div>
      ) : (
        <div className="subagent-master-detail" data-detail-open={detailOpen || undefined}>
          <div className="subagent-list-pane" aria-label="已安装 Subagent 列表">
            <div className="subagent-list">
              {filteredSubagents.map((subagent) => {
                const selected = subagentSelectionId(subagent) === selectedId;
                const enabledApps = WORKBENCH_AGENTS.filter(
                  (app) => subagent.apps[mapAppField(app)],
                );
                return (
                  <article
                    key={subagentSelectionId(subagent)}
                    className={selected ? 'subagent-list-row is-selected' : 'subagent-list-row'}
                    data-subagent-list-id={subagent.id}
                    data-subagent-target={targetValue(subagent.target)}
                    data-subagent-selection-id={subagentSelectionId(subagent)}
                  >
                    <button
                      type="button"
                      className="subagent-list-row-select"
                      ref={selected ? selectedRowRef : undefined}
                      onClick={() => selectSubagent(subagent)}
                      aria-current={selected ? 'true' : undefined}
                    >
                      <span className="subagent-list-row-copy">
                        <span className="skill-card-title">{subagent.name}</span>
                        <span className="subagent-list-row-meta">
                          {subagent.directory} ·{' '}
                          {subagent.repoOwner && subagent.repoName
                            ? `${subagent.repoOwner}/${subagent.repoName}`
                            : '本地'}
                        </span>
                      </span>
                      <span
                        className="subagent-list-row-marks"
                        aria-label={`已启用 ${enabledApps.length} 个 Agent`}
                      >
                        <span className="subagent-target-badge">
                          {subagent.target.scope === 'global' ? '全局' : '项目'}
                        </span>
                        {enabledApps.map((app) => (
                          <AgentBrandMark key={app} app={app} size={15} />
                        ))}
                        {hasUpdate(subagent) && (
                          <span className="subagent-status is-update">可更新</span>
                        )}
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
          <InstalledSubagentDetail
            subagent={selectedSubagent}
            hasUpdate={selectedSubagent !== null && hasUpdate(selectedSubagent)}
            pending={pending}
            onBack={closeDetail}
            backButtonRef={detailBackButtonRef}
            onToggle={(app, enabled) => {
              if (selectedSubagent !== null) void handleToggleApp(selectedSubagent, app, enabled);
            }}
            onUpdate={() => {
              if (selectedSubagent !== null) void handleUpdateSubagent(selectedSubagent);
            }}
            onUninstall={() => {
              if (selectedSubagent !== null) requestUninstall(selectedSubagent);
            }}
          />
        </div>
      )}

      <FocusedDialog
        open={uninstallTarget !== null}
        title="确认卸载"
        onClose={() => setUninstallTarget(null)}
        closeLabel="关闭确认卸载对话框"
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
              disabled={pending}
            >
              卸载
            </button>
          </>
        }
      >
        {uninstallTarget !== null && (
          <p className="subagent-dialog-empty">
            确定要卸载 {uninstallTarget.name} 吗？该 Subagent 将从该配置目标的所有 Agent 移除。
          </p>
        )}
      </FocusedDialog>

      {backupsDialogOpen && (
        <BackupsDialog
          backups={backups ?? []}
          pending={pending}
          onRestore={(backup) => void handleRestore(backup)}
          onDelete={(backup) => void handleDeleteBackup(backup)}
          onClose={() => setBackupsDialogOpen(false)}
        />
      )}
    </section>
  );
}
