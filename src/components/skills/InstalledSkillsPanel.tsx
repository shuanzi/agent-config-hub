import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import {
  ArchiveRestore,
  ArrowLeft,
  Compass,
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
import { InitialAgentRadioGroup } from '../workbench/InitialAgentRadioGroup';
import './skills.css';

interface InstalledSkillsPanelProps {
  context: ConfigContext;
  projects: readonly ProjectSummary[];
  onOpenDiscovery: () => void;
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

function projectLabel(projectId: string, projects: readonly ProjectSummary[]): string {
  const project = projects.find((candidate) => candidate.projectId === projectId);
  if (project === undefined) return projectId;
  const duplicateName = projects.some(
    (candidate) =>
      candidate.projectId !== projectId && candidate.displayName === project.displayName,
  );
  return duplicateName ? `${project.displayName}（${project.rootPath}）` : project.displayName;
}

function targetLabel(target: ScopeTarget, projects: readonly ProjectSummary[]): string {
  if (target.scope === 'global') return '全局配置';
  return `项目配置：${projectLabel(target.projectId, projects)}`;
}

function repositoryLabel(skill: Pick<InstalledSkill, 'repoOwner' | 'repoName'>): string {
  return skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : '本地来源';
}

interface SkillListGroup {
  key: string;
  label: string;
  skills: InstalledSkill[];
}

function groupSkills(
  context: ConfigContext,
  skills: InstalledSkill[],
  projects: readonly ProjectSummary[],
): SkillListGroup[] {
  if (context.kind === 'all') {
    const groups: SkillListGroup[] = [
      { key: 'global', label: '全局配置', skills: [] },
      ...projects.map((project) => ({
        key: `project:${project.projectId}`,
        label: targetLabel({ scope: 'project', projectId: project.projectId }, projects),
        skills: [],
      })),
    ];
    const groupsByKey = new Map(groups.map((group) => [group.key, group]));
    for (const skill of skills) {
      const key = targetValue(skill.target);
      let group = groupsByKey.get(key);
      if (group === undefined) {
        group = {
          key,
          label: targetLabel(skill.target, projects),
          skills: [],
        };
        groupsByKey.set(key, group);
        groups.push(group);
      }
      group.skills.push(skill);
    }
    return groups.filter((group) => group.skills.length > 0);
  }

  if (context.kind === 'project') {
    const projectSkills = skills.filter((skill) => skill.target.scope === 'project');
    const globalSkills = skills.filter((skill) => skill.target.scope === 'global');
    return [
      {
        key: 'project-owned',
        label: `此项目拥有：${projectLabel(context.projectId, projects)}`,
        skills: projectSkills,
      },
      { key: 'global-applicable', label: '全局配置，可用于此项目', skills: globalSkills },
    ];
  }

  return [{ key: 'global', label: '全局配置', skills }];
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
  labelPrefix,
}: {
  apps: SkillApps;
  onToggle: (app: AgentType, enabled: boolean) => void;
  disabled?: boolean;
  legend?: string;
  labelPrefix?: string;
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
              aria-label={`${labelPrefix ? `${labelPrefix}，` : ''}${agentLabels[app]}`}
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
  targetText,
  updateAvailable,
  selected,
  onSelect,
  onUpdate,
  onUninstall,
  onToggle,
  pending,
}: {
  skill: InstalledSkill;
  targetText: string;
  updateAvailable: boolean;
  selected: boolean;
  onSelect: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onToggle: (app: AgentType, enabled: boolean) => void;
  pending: boolean;
}) {
  return (
    <tr
      className={selected ? 'skill-row skill-card is-selected' : 'skill-row skill-card'}
      data-skill-id={skill.id}
      data-skill-target={targetValue(skill.target)}
      data-skill-selection-id={skillSelectionId(skill)}
    >
      <td className="skill-row-name">
        <button
          type="button"
          className="skill-row-select"
          onClick={onSelect}
          aria-label={`${skill.name}，${targetText}，查看详情`}
          aria-current={selected ? 'true' : undefined}
        >
          <span className="skill-row-primary">
            <span className="skill-row-title-line">
              <span className="skill-row-title skill-card-title">{skill.name}</span>
              {updateAvailable && <span className="skill-update-badge">可更新</span>}
            </span>
            {skill.description && (
              <span className="skill-row-description">{skill.description}</span>
            )}
          </span>
        </button>
      </td>
      <td className="skill-row-source">
        <span>{skill.directory}</span>
        <span>{repositoryLabel(skill)}</span>
      </td>
      <td className="skill-row-target">
        <span className="skill-target-badge">{targetText}</span>
      </td>
      <td className="skill-row-agent-cell">
        <span className="skill-row-agents" role="group" aria-label={`${skill.name} Agent 启用状态`}>
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
                aria-label={`${skill.name}，${targetText}，${agentLabels[app]}`}
              />
              <AgentBrandMark
                app={app}
                size={15}
                className={skill.apps[mapAppField(app)] ? 'is-enabled' : 'is-disabled'}
              />
            </label>
          ))}
        </span>
      </td>
      <td className="skill-row-actions" aria-label={`${skill.name} 操作`}>
        {updateAvailable && (
          <button
            type="button"
            className="skill-icon-button"
            onClick={onUpdate}
            disabled={pending}
            aria-label={`更新 ${skill.name}，${targetText}`}
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
          aria-label={`卸载 ${skill.name}，${targetText}`}
          title="卸载"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

function InstalledSkillDetail({
  skill,
  targetText,
  updateAvailable,
  pending,
  onBack,
  backButtonRef,
  onUpdate,
  onUninstall,
  onToggle,
}: {
  skill: InstalledSkill;
  targetText: string;
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
          <dd>{targetText}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{repositoryLabel(skill)}</dd>
        </div>
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
          labelPrefix={`${skill.name}，${targetText}`}
        />
      </div>
    </section>
  );
}

export function InstalledSkillsPanel({
  context,
  projects,
  onOpenDiscovery,
}: InstalledSkillsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [zipPath, setZipPath] = useState('');
  const [zipDialogOpen, setZipDialogOpen] = useState(false);
  const [zipInitialApp, setZipInitialApp] = useState<AgentType | null>(null);
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

  const { data: skills, isLoading, error: installedSkillsError } = useInstalledSkills(context);
  const toggleAppMutation = useToggleSkillApp();
  const uninstallMutation = useUninstallSkill();
  const {
    data: updates,
    refetch: checkUpdates,
    isFetching: isCheckingUpdates,
  } = useCheckSkillUpdates(operationTarget);
  const updateSkillMutation = useUpdateSkill();
  const { data: unmanagedSkills, refetch: scanUnmanaged } = useScanUnmanagedSkills(
    operationTarget,
    { enabled: false },
  );
  const importMutation = useImportSkillsFromApps();
  const installFromZipMutation = useInstallSkillsFromZip();
  const { data: backups, refetch: refetchBackups } = useSkillBackups(operationTarget);
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

  const skillGroups = useMemo(
    () => groupSkills(context, filteredSkills, projects),
    [context, filteredSkills, projects],
  );

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
    setZipDialogOpen(false);
    setZipPath('');
    setZipInitialApp(null);
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
      setStatusMessage(
        `${skill.name}（${targetLabel(skill.target, projects)}）已${enabled ? '启用' : '停用'} ${agentLabels[app]}。`,
      );
    } catch (error) {
      const userError = toUserError(error);
      setStatusMessage('');
      setErrorMessage(
        [
          `${skill.name}（${targetLabel(skill.target, projects)}）`,
          userError.message,
          userError.suggestion,
        ]
          .filter(Boolean)
          .join('\n'),
      );
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
      setStatusMessage(`已卸载 ${name}（${targetLabel(target, projects)}）。`);
    } catch (error) {
      const userError = toUserError(error);
      setStatusMessage('');
      setErrorMessage(
        [`${name}（${targetLabel(target, projects)}）`, userError.message, userError.suggestion]
          .filter(Boolean)
          .join('\n'),
      );
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
      setStatusMessage(`已更新 ${skill.name}（${targetLabel(skill.target, projects)}）。`);
    } catch (error) {
      const userError = toUserError(error);
      setStatusMessage('');
      setErrorMessage(
        [
          `${skill.name}（${targetLabel(skill.target, projects)}）`,
          userError.message,
          userError.suggestion,
        ]
          .filter(Boolean)
          .join('\n'),
      );
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
        failures.push(
          `${update.name}（${targetLabel(skill.target, projects)}）: ${toUserError(error).message}`,
        );
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

  const handleChooseZip = async () => {
    clearFeedback();
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
      });
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof selectedPath === 'string' && selectedPath.trim() !== '') {
        setZipPath(selectedPath);
      }
    } catch (error) {
      reportError(error);
    }
  };

  const handleOpenZip = () => {
    clearFeedback();
    if (requireOperationTarget() === null) return;
    setZipPath('');
    setZipInitialApp(null);
    setZipDialogOpen(true);
  };

  const handleInstallFromZip = async () => {
    clearFeedback();
    if (zipPath.trim() === '') return;
    const target = requireOperationTarget();
    if (target === null) return;
    const initialApp = zipInitialApp;
    if (initialApp === null) {
      setErrorMessage('请选择 ZIP 安装后要启用的初始 Agent。');
      return;
    }
    try {
      await installFromZipMutation.mutateAsync({
        filePath: zipPath.trim(),
        initialApp,
        target,
      });
      setZipDialogOpen(false);
      setZipPath('');
      setZipInitialApp(null);
      setStatusMessage(`已从 ZIP 安装 Skill，并启用 ${agentLabels[initialApp]}。`);
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
  const allTargetMissing = context.kind === 'all' && operationTarget === null;

  return (
    <section className="skill-panel" aria-label="已安装 Skills">
      <div className="skill-panel-heading">
        <div>
          <p className="skill-eyebrow">Skills</p>
          <h2 ref={panelHeadingRef} tabIndex={-1}>
            已安装
          </h2>
          <p>{skills?.length ?? 0} 个目标记录</p>
        </div>
        <div className="skill-count-bar" aria-label="各 Agent 启用的目标记录数">
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
            disabled={isCheckingUpdates || pending || allTargetMissing}
          >
            {isCheckingUpdates ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            检查更新
          </button>
          {(updates ?? []).length > 0 && (
            <button
              type="button"
              className="skill-button primary"
              onClick={handleUpdateAll}
              disabled={pending || allTargetMissing}
            >
              <RefreshCw size={15} />
              全部更新 ({updates!.length})
            </button>
          )}
          <button
            type="button"
            className="skill-button"
            onClick={handleOpenImport}
            disabled={pending || allTargetMissing}
          >
            <FolderInput size={15} />
            导入已有
          </button>
          <button
            type="button"
            className="skill-button"
            onClick={handleOpenBackups}
            disabled={pending || allTargetMissing}
          >
            <ArchiveRestore size={15} />
            从备份恢复
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
                  {targetLabel({ scope: 'project', projectId: project.projectId }, projects)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="skill-button"
          onClick={handleOpenZip}
          disabled={pending || allTargetMissing}
        >
          <Download size={15} />从 ZIP 安装
        </button>
        <button type="button" className="skill-button" onClick={onOpenDiscovery}>
          <Compass size={15} />
          发现技能
        </button>
        {allTargetMissing && (
          <span className="skill-target-hint" role="status">
            请先选择操作目标，检查更新、导入已有、备份恢复或 ZIP 安装才会启用。
          </span>
        )}
      </div>

      <SkillFeedback
        errorMessage={
          installedSkillsErrorMessage ||
          (zipDialogOpen || importDialogOpen || backupsDialogOpen ? '' : errorMessage)
        }
        statusMessage={statusMessage}
      />

      {selectedSkill !== null ? (
        <InstalledSkillDetail
          skill={selectedSkill}
          targetText={targetLabel(selectedSkill.target, projects)}
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
        <div className="skill-scope-groups" aria-label="已安装 Skill 列表">
          {skillGroups.map((group) => (
            <section
              key={group.key}
              className="skill-scope-group"
              aria-labelledby={`skill-group-${group.key}`}
            >
              <h3 id={`skill-group-${group.key}`} className="skill-scope-group-heading">
                {group.label}
                <span>{group.skills.length}</span>
              </h3>
              <table className="skill-list skill-table">
                <caption className="sr-only">{group.label} Skill 列表</caption>
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">来源</th>
                    <th scope="col">目标</th>
                    <th scope="col">Agent</th>
                    <th scope="col">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.skills.map((skill) => (
                    <InstalledSkillRow
                      key={`${targetValue(skill.target)}:${skill.id}`}
                      skill={skill}
                      targetText={targetLabel(skill.target, projects)}
                      updateAvailable={hasUpdate(skill)}
                      selected={selectedSkillId === skillSelectionId(skill)}
                      onSelect={() => selectSkill(skill)}
                      onUpdate={() => void handleUpdateSkill(skill)}
                      onUninstall={() => requestUninstall(skill)}
                      onToggle={(app, enabled) => void handleToggleApp(skill, app, enabled)}
                      pending={pending}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {importDialogOpen && unmanagedSkills !== undefined && (
        <ImportDialog
          skills={unmanagedSkills}
          targetText={operationTarget ? targetLabel(operationTarget, projects) : '当前操作目标'}
          errorMessage={errorMessage}
          onImport={handleImport}
          onClose={() => {
            setImportDialogOpen(false);
            clearFeedback();
          }}
        />
      )}

      {zipDialogOpen && (
        <ZipInstallDialog
          path={zipPath}
          target={operationTarget}
          targetText={operationTarget ? targetLabel(operationTarget, projects) : null}
          projects={projects}
          allowTargetChange={context.kind === 'all'}
          initialApp={zipInitialApp}
          pending={installFromZipMutation.isPending}
          errorMessage={errorMessage}
          onChoose={handleChooseZip}
          onTargetChange={setAllOperationTarget}
          onInitialAppChange={setZipInitialApp}
          onInstall={() => void handleInstallFromZip()}
          onClose={() => {
            setZipDialogOpen(false);
            setZipPath('');
            setZipInitialApp(null);
            clearFeedback();
          }}
        />
      )}

      {backupsDialogOpen && (
        <BackupsDialog
          backups={backups ?? []}
          targetText={operationTarget ? targetLabel(operationTarget, projects) : '未选择目标'}
          errorMessage={errorMessage}
          onRestore={handleRestore}
          onDelete={handleDeleteBackup}
          onClose={() => {
            setBackupsDialogOpen(false);
            clearFeedback();
          }}
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
            确定要卸载 {uninstallTarget.name}（{targetLabel(uninstallTarget.target, projects)}）
            吗？该 Skill 将从该配置目标的所有 Agent 移除。
          </p>
        )}
      </FocusedDialog>
    </section>
  );
}

function ImportDialog({
  skills,
  targetText,
  errorMessage,
  onImport,
  onClose,
}: {
  skills: UnmanagedSkill[];
  targetText: string;
  errorMessage: string;
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
      title="导入已有 Skill"
      onClose={onClose}
      initialFocusRef={firstSelectionRef}
      closeLabel="关闭导入已有 Skill 对话框"
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
      {errorMessage && (
        <div className="skill-error" role="alert">
          {errorMessage}
        </div>
      )}
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
                  labelPrefix={`${skill.name}，${targetText}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </FocusedDialog>
  );
}

function ZipInstallDialog({
  path,
  target,
  targetText,
  projects,
  allowTargetChange,
  initialApp,
  pending,
  errorMessage,
  onChoose,
  onTargetChange,
  onInitialAppChange,
  onInstall,
  onClose,
}: {
  path: string;
  target: ScopeTarget | null;
  targetText: string | null;
  projects: readonly ProjectSummary[];
  allowTargetChange: boolean;
  initialApp: AgentType | null;
  pending: boolean;
  errorMessage: string;
  onChoose: () => void;
  onTargetChange: (target: ScopeTarget | null) => void;
  onInitialAppChange: (app: AgentType | null) => void;
  onInstall: () => void;
  onClose: () => void;
}) {
  const targetOptions = [
    { value: 'global', label: '全局配置' },
    ...projects.map((project) => ({
      value: `project:${project.projectId}`,
      label: targetLabel({ scope: 'project', projectId: project.projectId }, projects),
    })),
  ];

  return (
    <FocusedDialog
      open
      title="从 ZIP 安装 Skill"
      onClose={onClose}
      closeLabel="关闭 ZIP 安装对话框"
      className="skill-dialog"
      footer={
        <>
          <button type="button" className="skill-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="skill-button primary"
            onClick={onInstall}
            disabled={pending || path.trim() === '' || target === null || initialApp === null}
          >
            {pending ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            {pending ? '安装中…' : '安装'}
          </button>
        </>
      }
    >
      {errorMessage && (
        <div className="skill-error" role="alert">
          {errorMessage}
        </div>
      )}
      <div className="skill-zip-dialog-fields">
        <label className="skill-dialog-field" htmlFor="skill-zip-target">
          <span>安装目标</span>
          <select
            id="skill-zip-target"
            aria-label="选择 ZIP 安装目标"
            value={targetValue(target)}
            disabled={!allowTargetChange || pending}
            onChange={(event) => onTargetChange(targetFromValue(event.target.value))}
          >
            <option value="">请选择全局或项目配置</option>
            {targetOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {!allowTargetChange && targetText && (
            <span className="skill-dialog-field-hint">当前上下文：{targetText}</span>
          )}
        </label>
        <InitialAgentRadioGroup
          name="skill-zip-initial-agent"
          value={initialApp}
          onChange={onInitialAppChange}
          disabled={pending}
        />
        <div className="skill-zip-dialog-file">
          <span>ZIP 文件</span>
          <button type="button" className="skill-button" onClick={onChoose} disabled={pending}>
            选择 ZIP 文件
          </button>
          <output aria-live="polite">{path || '尚未选择文件'}</output>
        </div>
      </div>
    </FocusedDialog>
  );
}

function BackupsDialog({
  backups,
  targetText,
  errorMessage,
  onRestore,
  onDelete,
  onClose,
}: {
  backups: SkillBackupEntry[];
  targetText: string;
  errorMessage: string;
  onRestore: (backup: SkillBackupEntry) => void;
  onDelete: (backup: SkillBackupEntry) => void;
  onClose: () => void;
}) {
  return (
    <FocusedDialog
      open
      title="从备份恢复"
      onClose={onClose}
      closeLabel="关闭备份恢复对话框"
      className="skill-dialog"
      footer={
        <button type="button" className="skill-button" onClick={onClose}>
          关闭
        </button>
      }
    >
      {errorMessage && (
        <div className="skill-error" role="alert">
          {errorMessage}
        </div>
      )}
      <p className="skill-dialog-field-hint">备份范围：{targetText}</p>
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
