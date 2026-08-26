import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ArchiveRestore,
  ArrowLeft,
  Download,
  FolderInput,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  AgentType,
  ConfigContext,
  ImportSkillSelection,
  InstalledSkill,
  ProjectSummary,
  ScopeTarget,
  SkillApps,
  SkillBackupEntry,
  UnmanagedSkill,
} from '../../types';
import {
  useCheckSkillUpdates,
  useDeleteSkillBackup,
  useImportSkillsFromApps,
  useInstallSkillsFromZip,
  useInstalledSkills,
  useRestoreSkillBackup,
  useScanUnmanagedSkills,
  useSkillBackups,
  useToggleSkillApp,
  useUninstallSkill,
  useUpdateSkill,
} from '../../hooks/useSkills';
import { toUserError } from '../../lib/errors';
import { AgentBrandMark, agentLabels, WORKBENCH_AGENTS } from '../workbench/AgentBrandMark';
import { FocusedDialog } from '../workbench/FocusedDialog';
import './skills.css';

interface InstalledSkillsPanelProps {
  activeApp: AgentType;
  context: ConfigContext;
  projects: readonly ProjectSummary[];
}

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

function skillSelectionId(skill: InstalledSkill): string {
  return `${targetValue(skill.target)}:${skill.id}`;
}

function mapAppField(app: AgentType): keyof SkillApps {
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
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? String(unixSeconds) : date.toLocaleString();
}

function AppToggleGroup({
  apps,
  onToggle,
  disabled,
  legend = '启用的 Agent',
}: {
  apps: SkillApps;
  onToggle: (app: AgentType, enabled: boolean) => void;
  disabled?: boolean;
  legend?: string;
}) {
  return (
    <fieldset className="skill-toggle-group">
      <legend className="skill-toggle-label">{legend}</legend>
      <div className="skill-toggle-options">
        {WORKBENCH_AGENTS.map((app) => (
          <label key={app} className="skill-toggle">
            <input
              type="checkbox"
              checked={apps[mapAppField(app)]}
              onChange={(event) => onToggle(app, event.target.checked)}
              disabled={disabled}
              aria-label={agentLabels[app]}
            />
            <AgentBrandMark app={app} size={16} />
            <span className="skill-visually-hidden">{agentLabels[app]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SkillFeedback({
  errorMessage,
  statusMessage,
}: {
  errorMessage: string;
  statusMessage: string;
}) {
  return (
    <>
      {errorMessage && (
        <div className="skill-error" role="alert">
          {errorMessage}
        </div>
      )}
      {statusMessage && (
        <div className="skill-status" role="status">
          {statusMessage}
        </div>
      )}
    </>
  );
}

function InstalledSkillRow({
  skill,
  updateAvailable,
  selected,
  onSelect,
  onUpdate,
  onUninstall,
  onToggle,
  pending,
}: {
  skill: InstalledSkill;
  updateAvailable: boolean;
  selected: boolean;
  onSelect: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onToggle: (app: AgentType, enabled: boolean) => void;
  pending: boolean;
}) {
  return (
    <article
      className={selected ? 'skill-row skill-card is-selected' : 'skill-row skill-card'}
      data-skill-id={skill.id}
      data-skill-target={targetValue(skill.target)}
      data-skill-selection-id={skillSelectionId(skill)}
    >
      <button
        type="button"
        className="skill-row-select"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
      >
        <span className="skill-row-primary">
          <span className="skill-row-title skill-card-title" role="heading" aria-level={3}>
            {skill.name}
          </span>
          {skill.description && <span className="skill-row-description">{skill.description}</span>}
        </span>
        <span className="skill-row-source">
          <span>{skill.directory}</span>
          {skill.repoOwner && skill.repoName && (
            <span>
              {skill.repoOwner}/{skill.repoName}
            </span>
          )}
        </span>
      </button>

      <div className="skill-row-actions" aria-label={`${skill.name} 操作`}>
        <span className="skill-target-badge">
          {skill.target.scope === 'global' ? '全局' : '项目'}
        </span>
        <span className="skill-row-agents" role="group" aria-label="Agent 启用状态">
          {WORKBENCH_AGENTS.map((app) => (
            <label
              key={app}
              className="skill-row-agent-toggle"
              title={`${agentLabels[app]}：${skill.apps[mapAppField(app)] ? '已启用' : '未启用'}`}
            >
              <input
                type="checkbox"
                checked={skill.apps[mapAppField(app)]}
                onChange={(event) => onToggle(app, event.target.checked)}
                disabled={pending}
                aria-label={agentLabels[app]}
              />
              <AgentBrandMark
                app={app}
                size={15}
                className={skill.apps[mapAppField(app)] ? 'is-enabled' : 'is-disabled'}
              />
            </label>
          ))}
        </span>
        {updateAvailable && <span className="skill-update-badge">可更新</span>}
        {updateAvailable && (
          <button
            type="button"
            className="skill-icon-button"
            onClick={onUpdate}
            disabled={pending}
            aria-label={`更新 ${skill.name}`}
            title="更新"
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="skill-icon-button is-danger uninstall"
          onClick={onUninstall}
          disabled={pending}
          aria-label={`卸载 ${skill.name}`}
          title="卸载"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function InstalledSkillDetail({
  skill,
  updateAvailable,
  pending,
  onBack,
  backButtonRef,
  onUpdate,
  onUninstall,
  onToggle,
}: {
  skill: InstalledSkill;
  updateAvailable: boolean;
  pending: boolean;
  onBack: () => void;
  backButtonRef: RefObject<HTMLButtonElement>;
  onUpdate: () => void;
  onUninstall: () => void;
  onToggle: (app: AgentType, enabled: boolean) => void;
}) {
  return (
    <section
      className="skill-detail"
      data-skill-detail={skill.id}
      data-skill-target={targetValue(skill.target)}
      aria-label={`${skill.name} 详情`}
    >
      <div className="skill-detail-header">
        <button ref={backButtonRef} type="button" className="skill-back-button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回列表
        </button>
        <div className="skill-detail-heading">
          <h2>{skill.name}</h2>
          {skill.description && <p>{skill.description}</p>}
        </div>
        <div className="skill-detail-actions">
          {skill.readmeUrl && (
            <a className="skill-button" href={skill.readmeUrl} target="_blank" rel="noreferrer">
              README
            </a>
          )}
          {updateAvailable && (
            <button
              type="button"
              className="skill-button primary"
              onClick={onUpdate}
              disabled={pending}
            >
              <RefreshCw size={15} aria-hidden="true" />
              更新
            </button>
          )}
          <button
            type="button"
            className="skill-button danger"
            onClick={onUninstall}
            disabled={pending}
          >
            <Trash2 size={15} aria-hidden="true" />
            卸载
          </button>
        </div>
      </div>

      <dl className="skill-detail-grid">
        <div>
          <dt>目录</dt>
          <dd>
            <code>{skill.directory}</code>
          </dd>
        </div>
        <div>
          <dt>目标</dt>
          <dd>{skill.target.scope === 'global' ? '全局配置' : '项目配置'}</dd>
        </div>
        {skill.repoOwner && skill.repoName && (
          <div>
            <dt>仓库</dt>
            <dd>
              {skill.repoOwner}/{skill.repoName}
            </dd>
          </div>
        )}
        {skill.repoBranch && (
          <div>
            <dt>分支</dt>
            <dd>{skill.repoBranch}</dd>
          </div>
        )}
        <div>
          <dt>安装时间</dt>
          <dd>{formatDate(skill.installedAt)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatDate(skill.updatedAt)}</dd>
        </div>
        {skill.contentHash && (
          <div>
            <dt>内容标识</dt>
            <dd>
              <code>{skill.contentHash}</code>
            </dd>
          </div>
        )}
      </dl>

      <div className="skill-detail-section">
        <AppToggleGroup
          apps={skill.apps}
          onToggle={onToggle}
          disabled={pending}
          legend="启用的 Agent"
        />
      </div>
    </section>
  );
}

export function InstalledSkillsPanel({ activeApp, context, projects }: InstalledSkillsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [zipPath, setZipPath] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledSkill | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [backupsDialogOpen, setBackupsDialogOpen] = useState(false);
  const [allOperationTarget, setAllOperationTarget] = useState<ScopeTarget | null>(null);
  const detailBackButtonRef = useRef<HTMLButtonElement>(null);
  const detailReturnFocusIdRef = useRef<string | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousContextKeyRef = useRef(contextKey(context));
  const scopedTarget = targetForContext(context);
  const operationTarget = scopedTarget ?? allOperationTarget;

  const {
    data: skills,
    isLoading,
    error: installedSkillsError,
  } = useInstalledSkills(context, activeApp);
  const toggleAppMutation = useToggleSkillApp();
  const uninstallMutation = useUninstallSkill();
  const {
    data: updates,
    refetch: checkUpdates,
    isFetching: isCheckingUpdates,
  } = useCheckSkillUpdates(operationTarget, activeApp);
  const updateSkillMutation = useUpdateSkill();
  const { data: unmanagedSkills, refetch: scanUnmanaged } = useScanUnmanagedSkills(
    operationTarget,
    activeApp,
    { enabled: false },
  );
  const importMutation = useImportSkillsFromApps();
  const installFromZipMutation = useInstallSkillsFromZip();
  const { data: backups, refetch: refetchBackups } = useSkillBackups(operationTarget, activeApp);
  const restoreMutation = useRestoreSkillBackup();
  const deleteBackupMutation = useDeleteSkillBackup();

  const updatesMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const update of updates ?? []) {
      map[update.id] = update.remoteHash;
    }
    return map;
  }, [updates]);

  const enabledCounts = useMemo(() => {
    const counts: Record<AgentType, number> = {
      'claude-code': 0,
      codex: 0,
      'gemini-cli': 0,
      opencode: 0,
    };
    for (const skill of skills ?? []) {
      for (const app of WORKBENCH_AGENTS) {
        if (skill.apps[mapAppField(app)]) counts[app] += 1;
      }
    }
    return counts;
  }, [skills]);

  const filteredSkills = useMemo(() => {
    if (skills === undefined) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter((skill) => {
      const values = [
        skill.name,
        skill.id,
        skill.description,
        skill.directory,
        skill.repoOwner,
        skill.repoName,
      ];
      return values.some((value) => value?.toLowerCase().includes(query));
    });
  }, [skills, searchQuery]);

  const selectedSkill =
    selectedSkillId === null
      ? null
      : (filteredSkills.find((skill) => skillSelectionId(skill) === selectedSkillId) ?? null);
  useEffect(() => {
    if (selectedSkillId !== null && selectedSkill === null) setSelectedSkillId(null);
  }, [selectedSkill, selectedSkillId]);

  useEffect(() => {
    if (
      uninstallTarget !== null &&
      !(skills ?? []).some(
        (skill) =>
          skill.id === uninstallTarget.id && sameTarget(skill.target, uninstallTarget.target),
      )
    ) {
      setUninstallTarget(null);
    }
  }, [skills, uninstallTarget]);

  useEffect(() => {
    if (selectedSkillId !== null) detailBackButtonRef.current?.focus();
  }, [selectedSkillId]);

  useEffect(() => {
    const nextContextKey = contextKey(context);
    if (previousContextKeyRef.current === nextContextKey) return;

    previousContextKeyRef.current = nextContextKey;
    setAllOperationTarget(null);
    setSelectedSkillId(null);
    setUninstallTarget(null);
    setImportDialogOpen(false);
    setBackupsDialogOpen(false);
    window.setTimeout(() => panelHeadingRef.current?.focus(), 0);
  }, [context]);

  useEffect(() => {
    if (
      allOperationTarget?.scope === 'project' &&
      !projects.some((project) => project.projectId === allOperationTarget.projectId)
    ) {
      setAllOperationTarget(null);
    }
  }, [allOperationTarget, projects]);

  const pending =
    toggleAppMutation.isPending ||
    uninstallMutation.isPending ||
    updateSkillMutation.isPending ||
    importMutation.isPending ||
    installFromZipMutation.isPending ||
    restoreMutation.isPending ||
    deleteBackupMutation.isPending;

  const clearFeedback = () => {
    setErrorMessage('');
    setStatusMessage('');
  };

  const reportError = (error: unknown) => {
    const userError = toUserError(error);
    setStatusMessage('');
    setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
  };

  const requireOperationTarget = (): ScopeTarget | null => {
    if (operationTarget !== null) return operationTarget;
    setStatusMessage('');
    setErrorMessage('请先选择全局配置或一个项目配置作为操作目标。');
    return null;
  };

  const selectSkill = (skill: InstalledSkill) => {
    const id = skillSelectionId(skill);
    detailReturnFocusIdRef.current = id;
    setSelectedSkillId(id);
  };

  const closeDetail = () => {
    setSelectedSkillId(null);
    window.setTimeout(() => {
      const id = detailReturnFocusIdRef.current;
      if (id === null) return;
      const trigger = Array.from(
        document.querySelectorAll<HTMLElement>('[data-skill-selection-id]'),
      )
        .find((row) => row.dataset.skillSelectionId === id)
        ?.querySelector<HTMLButtonElement>('.skill-row-select');
      trigger?.focus();
    }, 0);
  };

  const handleToggleApp = async (skill: InstalledSkill, app: AgentType, enabled: boolean) => {
    clearFeedback();
    try {
      await toggleAppMutation.mutateAsync({ id: skill.id, target: skill.target, app, enabled });
      setStatusMessage(`${enabled ? '已启用' : '已停用'} ${agentLabels[app]}。`);
    } catch (error) {
      reportError(error);
    }
  };

  const requestUninstall = (skill: InstalledSkill) => {
    if (
      !(skills ?? []).some(
        (candidate) => candidate.id === skill.id && sameTarget(candidate.target, skill.target),
      )
    ) {
      return;
    }
    clearFeedback();
    setUninstallTarget(skill);
  };

  const handleConfirmUninstall = async () => {
    if (uninstallTarget === null) return;
    const { id, name, target } = uninstallTarget;
    setUninstallTarget(null);
    clearFeedback();
    try {
      await uninstallMutation.mutateAsync({ id, target });
      if (selectedSkillId === skillSelectionId(uninstallTarget)) setSelectedSkillId(null);
      setStatusMessage(`已卸载 ${name}。`);
    } catch (error) {
      reportError(error);
    }
  };

  const handleCheckUpdates = async () => {
    clearFeedback();
    if (requireOperationTarget() === null) return;
    try {
      const result = await checkUpdates();
      const count = result.data?.length ?? 0;
      setStatusMessage(
        count === 0 ? '当前没有可更新的 Skill。' : `发现 ${count} 个可更新的 Skill。`,
      );
    } catch (error) {
      reportError(error);
    }
  };

  const handleUpdateSkill = async (skill: InstalledSkill) => {
    clearFeedback();
    try {
      await updateSkillMutation.mutateAsync({ id: skill.id, target: skill.target });
      setStatusMessage(`已更新 ${skill.name}。`);
    } catch (error) {
      reportError(error);
    }
  };

  const handleUpdateAll = async () => {
    clearFeedback();
    const target = requireOperationTarget();
    if (target === null) return;
    const applicable = (updates ?? [])
      .map((update) => ({
        update,
        skill: (skills ?? []).find(
          (skill) => skill.id === update.id && sameTarget(skill.target, target),
        ),
      }))
      .filter(
        (entry): entry is { update: NonNullable<typeof updates>[number]; skill: InstalledSkill } =>
          entry.skill !== undefined,
      );
    if (applicable.length === 0) return;

    let success = 0;
    const failures: string[] = [];
    for (const { update, skill } of applicable) {
      try {
        await updateSkillMutation.mutateAsync({ id: skill.id, target: skill.target });
        success += 1;
      } catch (error) {
        failures.push(`${update.name}: ${toUserError(error).message}`);
      }
    }

    const messages = [success > 0 ? `成功更新 ${success} 个 Skill。` : '', ...failures].filter(
      Boolean,
    );
    if (failures.length > 0) {
      setErrorMessage(messages.join('\n'));
    } else if (messages.length > 0) {
      setStatusMessage(messages.join('\n'));
    }
  };

  const handleOpenImport = async () => {
    clearFeedback();
    if (requireOperationTarget() === null) return;
    try {
      const result = await scanUnmanaged();
      if (result.data === undefined || result.data.length === 0) {
        setStatusMessage('未找到可导入的本地 Skill。');
        return;
      }
      setImportDialogOpen(true);
    } catch (error) {
      reportError(error);
    }
  };

  const handleImport = async (selections: ImportSkillSelection[]) => {
    clearFeedback();
    const target = requireOperationTarget();
    if (target === null) return;
    try {
      await importMutation.mutateAsync({ selections, target });
      setImportDialogOpen(false);
      setStatusMessage(`已导入 ${selections.length} 个本地 Skill。`);
    } catch (error) {
      reportError(error);
    }
  };

  const handleInstallFromZip = async () => {
    clearFeedback();
    if (zipPath.trim() === '') return;
    const target = requireOperationTarget();
    if (target === null) return;
    try {
      await installFromZipMutation.mutateAsync({
        filePath: zipPath.trim(),
        currentApp: activeApp,
        target,
      });
      setZipPath('');
      setStatusMessage(`已从 ZIP 安装 Skill，并启用 ${agentLabels[activeApp]}。`);
    } catch (error) {
      reportError(error);
    }
  };

  const handleOpenBackups = async () => {
    clearFeedback();
    if (requireOperationTarget() === null) return;
    setBackupsDialogOpen(true);
    try {
      await refetchBackups();
    } catch (error) {
      reportError(error);
    }
  };

  const handleRestore = async (backup: SkillBackupEntry) => {
    clearFeedback();
    try {
      await restoreMutation.mutateAsync({ backupId: backup.backupId, target: backup.skill.target });
      setBackupsDialogOpen(false);
      setStatusMessage('已恢复 Skill 备份。');
    } catch (error) {
      reportError(error);
    }
  };

  const handleDeleteBackup = async (backup: SkillBackupEntry) => {
    clearFeedback();
    try {
      await deleteBackupMutation.mutateAsync({
        backupId: backup.backupId,
        target: backup.skill.target,
      });
      await refetchBackups();
      setStatusMessage('已删除 Skill 备份。');
    } catch (error) {
      reportError(error);
    }
  };

  const hasUpdate = (skill: InstalledSkill) =>
    operationTarget !== null &&
    sameTarget(skill.target, operationTarget) &&
    updatesMap[skill.id] !== undefined;
  const installedSkillsUserError =
    installedSkillsError === null ? null : toUserError(installedSkillsError);
  const installedSkillsErrorMessage = installedSkillsUserError
    ? [installedSkillsUserError.message, installedSkillsUserError.suggestion]
        .filter(Boolean)
        .join('\n')
    : '';

  return (
    <section className="skill-panel" aria-label="已安装 Skills">
      <div className="skill-panel-heading">
        <div>
          <p className="skill-eyebrow">Skills</p>
          <h2 ref={panelHeadingRef} tabIndex={-1}>
            已安装
          </h2>
          <p>{skills?.length ?? 0} 个本地 Skill</p>
        </div>
        <div className="skill-count-bar" aria-label="各 Agent 启用的 Skill 数">
          {WORKBENCH_AGENTS.map((app) => (
            <span key={app} className="count-item">
              <AgentBrandMark app={app} size={15} />
              <span className="count-value">{enabledCounts[app]}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="skill-toolbar">
        <label className="skill-search-field" htmlFor="skill-installed-search">
          <Search size={15} aria-hidden="true" />
          <input
            id="skill-installed-search"
            type="search"
            placeholder="搜索已安装 Skill"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <div className="skill-toolbar-actions">
          <button
            type="button"
            className="skill-button"
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdates || pending}
          >
            {isCheckingUpdates ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            检查更新
          </button>
          {(updates ?? []).length > 0 && (
            <button
              type="button"
              className="skill-button primary"
              onClick={handleUpdateAll}
              disabled={pending}
            >
              <RefreshCw size={15} />
              全部更新 ({updates!.length})
            </button>
          )}
          <button
            type="button"
            className="skill-button"
            onClick={handleOpenImport}
            disabled={pending}
          >
            <FolderInput size={15} />
            导入本地
          </button>
          <button
            type="button"
            className="skill-button"
            onClick={handleOpenBackups}
            disabled={pending}
          >
            <ArchiveRestore size={15} />
            备份
          </button>
        </div>
        {context.kind === 'all' && (
          <label className="skill-target-field" htmlFor="skill-installed-target">
            <span>操作目标</span>
            <select
              id="skill-installed-target"
              aria-label="选择 Skill 操作目标"
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
        <label className="skill-zip-field" htmlFor="skill-zip-path">
          <span className="sr-only">ZIP 文件路径</span>
          <input
            id="skill-zip-path"
            type="text"
            placeholder="ZIP 文件路径"
            value={zipPath}
            onChange={(event) => setZipPath(event.target.value)}
          />
          <button
            type="button"
            className="skill-button"
            onClick={handleInstallFromZip}
            disabled={pending || zipPath.trim() === ''}
          >
            <Download size={15} />从 ZIP 安装
          </button>
        </label>
      </div>

      <SkillFeedback
        errorMessage={installedSkillsErrorMessage || errorMessage}
        statusMessage={statusMessage}
      />

      {selectedSkill !== null ? (
        <InstalledSkillDetail
          skill={selectedSkill}
          updateAvailable={hasUpdate(selectedSkill)}
          pending={pending}
          onBack={closeDetail}
          backButtonRef={detailBackButtonRef}
          onUpdate={() => void handleUpdateSkill(selectedSkill)}
          onUninstall={() => requestUninstall(selectedSkill)}
          onToggle={(app, enabled) => void handleToggleApp(selectedSkill, app, enabled)}
        />
      ) : isLoading ? (
        <div className="skill-empty" role="status">
          <Loader2 size={24} className="spin" />
          <p>正在加载…</p>
        </div>
      ) : skills === undefined || skills.length === 0 ? (
        <div className="skill-empty">
          <h3>尚未安装任何 Skill</h3>
          <p>切换到“发现”页签浏览并安装 Skill。</p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="skill-empty">
          <h3>没有匹配的 Skill</h3>
        </div>
      ) : (
        <div className="skill-list" role="list" aria-label="已安装 Skill 列表">
          {filteredSkills.map((skill) => (
            <InstalledSkillRow
              key={`${targetValue(skill.target)}:${skill.id}`}
              skill={skill}
              updateAvailable={hasUpdate(skill)}
              selected={selectedSkillId === skillSelectionId(skill)}
              onSelect={() => selectSkill(skill)}
              onUpdate={() => void handleUpdateSkill(skill)}
              onUninstall={() => requestUninstall(skill)}
              onToggle={(app, enabled) => void handleToggleApp(skill, app, enabled)}
              pending={pending}
            />
          ))}
        </div>
      )}

      {importDialogOpen && unmanagedSkills !== undefined && (
        <ImportDialog
          skills={unmanagedSkills}
          onImport={handleImport}
          onClose={() => setImportDialogOpen(false)}
        />
      )}

      {backupsDialogOpen && (
        <BackupsDialog
          backups={backups ?? []}
          onRestore={handleRestore}
          onDelete={handleDeleteBackup}
          onClose={() => setBackupsDialogOpen(false)}
        />
      )}

      <FocusedDialog
        open={uninstallTarget !== null}
        title="确认卸载"
        onClose={() => setUninstallTarget(null)}
        closeLabel="关闭确认卸载对话框"
        className="skill-dialog"
        footer={
          <>
            <button type="button" className="skill-button" onClick={() => setUninstallTarget(null)}>
              取消
            </button>
            <button
              type="button"
              className="skill-button danger"
              onClick={() => void handleConfirmUninstall()}
              disabled={pending}
            >
              卸载
            </button>
          </>
        }
      >
        {uninstallTarget !== null && (
          <p className="skill-dialog-copy">
            确定要卸载 {uninstallTarget.name} 吗？该 Skill 将从该配置目标的所有 Agent 移除。
          </p>
        )}
      </FocusedDialog>
    </section>
  );
}

function ImportDialog({
  skills,
  onImport,
  onClose,
}: {
  skills: UnmanagedSkill[];
  onImport: (selections: ImportSkillSelection[]) => void;
  onClose: () => void;
}) {
  const firstSelectionRef = useRef<HTMLInputElement>(null);
  const selectionKey = (skill: UnmanagedSkill) => `${skill.directory}::${skill.path}`;
  const directoryKey = (skill: UnmanagedSkill) => skill.directory.toLowerCase();
  const [selected, setSelected] = useState<Set<string>>(() => {
    const seenDirectories = new Set<string>();
    const initial = new Set<string>();
    for (const skill of skills) {
      if (!seenDirectories.has(directoryKey(skill))) {
        seenDirectories.add(directoryKey(skill));
        initial.add(selectionKey(skill));
      }
    }
    return initial;
  });
  const conflictDirectories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills) {
      const key = directoryKey(skill);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, count]) => count > 1).map(([directory]) => directory),
    );
  }, [skills]);
  const [appsBySkill, setAppsBySkill] = useState<Record<string, SkillApps>>(() => {
    const initial: Record<string, SkillApps> = {};
    for (const skill of skills) {
      initial[selectionKey(skill)] = {
        claudeCode: skill.foundIn.includes('claude-code'),
        codex: skill.foundIn.includes('codex'),
        geminiCli: skill.foundIn.includes('gemini-cli'),
        opencode: skill.foundIn.includes('opencode'),
      };
    }
    return initial;
  });

  const toggleSelect = (skill: UnmanagedSkill) => {
    const key = selectionKey(skill);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        for (const other of skills) {
          if (directoryKey(other) === directoryKey(skill)) next.delete(selectionKey(other));
        }
        next.add(key);
      }
      return next;
    });
  };

  const toggleApp = (key: string, app: AgentType, enabled: boolean) => {
    setAppsBySkill((previous) => ({
      ...previous,
      [key]: { ...previous[key], [mapAppField(app)]: enabled },
    }));
  };

  const handleImport = () => {
    onImport(
      skills
        .filter((skill) => selected.has(selectionKey(skill)))
        .map((skill) => ({
          directory: skill.directory,
          sourcePath: skill.path,
          apps: appsBySkill[selectionKey(skill)] ?? {
            claudeCode: false,
            codex: false,
            geminiCli: false,
            opencode: false,
          },
        })),
    );
  };

  return (
    <FocusedDialog
      open
      title="导入本地 Skill"
      onClose={onClose}
      initialFocusRef={firstSelectionRef}
      closeLabel="关闭导入本地 Skill 对话框"
      className="skill-dialog"
      footer={
        <>
          <button type="button" className="skill-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="skill-button primary"
            onClick={handleImport}
            disabled={selected.size === 0}
          >
            导入选中项 ({selected.size})
          </button>
        </>
      }
    >
      <div className="skill-import-list">
        {skills.map((skill, index) => {
          const key = selectionKey(skill);
          return (
            <div key={key} className="skill-import-item">
              <label className="skill-import-select">
                <input
                  ref={index === 0 ? firstSelectionRef : undefined}
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleSelect(skill)}
                  aria-label={`选择 ${skill.name}，来源 ${skill.path}`}
                />
              </label>
              <div className="skill-import-item-info">
                <div className="skill-import-item-name">{skill.name}</div>
                {skill.description && (
                  <div className="skill-import-description">{skill.description}</div>
                )}
                <div className="skill-import-item-path">{skill.path}</div>
                {conflictDirectories.has(directoryKey(skill)) && (
                  <div className="skill-import-warning">同名 Skill 一次只能导入一个来源</div>
                )}
                <AppToggleGroup
                  apps={appsBySkill[key]}
                  onToggle={(app, enabled) => toggleApp(key, app, enabled)}
                  legend="导入到 Agent"
                />
              </div>
            </div>
          );
        })}
      </div>
    </FocusedDialog>
  );
}

function BackupsDialog({
  backups,
  onRestore,
  onDelete,
  onClose,
}: {
  backups: SkillBackupEntry[];
  onRestore: (backup: SkillBackupEntry) => void;
  onDelete: (backup: SkillBackupEntry) => void;
  onClose: () => void;
}) {
  return (
    <FocusedDialog
      open
      title="Skill 备份"
      onClose={onClose}
      closeLabel="关闭 Skill 备份对话框"
      className="skill-dialog"
      footer={
        <button type="button" className="skill-button" onClick={onClose}>
          关闭
        </button>
      }
    >
      {backups.length === 0 ? (
        <p className="skill-dialog-empty">暂无备份。</p>
      ) : (
        <div className="skill-backup-list">
          {backups.map((backup) => (
            <div key={backup.backupId} className="skill-backup-item">
              <div className="skill-backup-item-info">
                <div className="skill-backup-item-name">{backup.skill.name}</div>
                <div className="skill-backup-item-path">{backup.backupPath}</div>
                <div className="skill-backup-date">{formatDate(backup.createdAt)}</div>
              </div>
              <div className="skill-backup-actions">
                <button
                  type="button"
                  className="skill-button primary"
                  onClick={() => onRestore(backup)}
                >
                  恢复
                </button>
                <button
                  type="button"
                  className="skill-icon-button is-danger"
                  onClick={() => onDelete(backup)}
                  aria-label={`删除 ${backup.skill.name} 的备份`}
                  title="删除备份"
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
