import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { open as openFileDialog } from '../../lib/dialog';
import {
  ArrowLeft,
  Download,
  Loader2,
  MoreHorizontal,
  ChevronRight,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  ConfigContext,
  ImportSkillSelection,
  InstalledSkill,
  ProjectSummary,
  ScopeTarget,
  SkillBackupEntry,
  SkillImportPreview,
  SkillLocation,
  SkillPlacement,
  SkillPlacementTarget,
  UnmanagedSkill,
} from '../../types';
import {
  useCheckSkillUpdates,
  useDeleteSkillBackup,
  useImportSkillsFromApps,
  useInstallSkillsFromZip,
  useInstalledSkills,
  usePreviewSkillImport,
  useRestoreSkillBackup,
  useScanUnmanagedSkills,
  useSetSkillPlacement,
  useSkillBackups,
  useSkillPlacements,
  useSkillPlacementTargets,
  useUninstallSkill,
  useUpdateSkill,
} from '../../hooks/useSkills';
import { toUserError } from '../../lib/errors';
import { FocusedDialog } from '../workbench/FocusedDialog';
import {
  SkillLocationCheckboxGroup,
  SkillLocationRadioGroup,
  SkillPlacementControls,
  skillLocationLabels,
} from './SkillPlacementControls';
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
      { key: 'global-applicable', label: '已投放的全局资产', skills: globalSkills },
    ];
  }

  return [{ key: 'global', label: '全局配置', skills }];
}

function skillSelectionId(skill: InstalledSkill): string {
  return `${targetValue(skill.target)}:${skill.id}`;
}

function formatDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? String(unixSeconds) : date.toLocaleString();
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
  placements,
  targetText,
  updateAvailable,
  selected,
  onSelect,
  onUpdate,
  onUninstall,
  onSetPlacement,
  pending,
}: {
  skill: InstalledSkill;
  placements: readonly SkillPlacement[];
  targetText: string;
  updateAvailable: boolean;
  selected: boolean;
  onSelect: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onSetPlacement: (placement: SkillPlacement, placed: boolean) => void;
  onTakeover: (placement: SkillPlacement) => void;
  pending: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const unmanaged = placements.filter((item) => item.state === 'unmanaged').length;
  const conflicts = placements.filter((item) => item.state === 'conflict').length;
  const exception = [unmanaged ? `${unmanaged} 待接管` : '', conflicts ? `${conflicts} 冲突` : '']
    .filter(Boolean)
    .join(' · ');
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
            <span className={`skill-row-description${exception ? ' is-warning' : ''}`}>
              {exception || skill.description}
            </span>
          </span>
        </button>
      </td>
      <td className="skill-row-source">
        <span>{repositoryLabel(skill)}</span>
        <span>{skill.repoOwner ? `GitHub · ${skill.repoBranch ?? 'main'}` : '本地主副本'}</span>
        <span className="skill-mobile-target">
          {' '}
          · {skill.target.scope === 'global' ? '全局' : targetText}
        </span>
      </td>
      <td className="skill-row-target">
        <span title={targetText}>
          {skill.target.scope === 'global' ? '全局配置' : targetText.split(' · ')[0]}
        </span>
        <span className="skill-target-origin">
          {skill.target.scope === 'global' ? '全局适用' : '项目自有'}
        </span>
      </td>
      <td className="skill-row-agent-cell">
        <SkillPlacementControls
          compact
          skillName={skill.name}
          placements={placements}
          pending={pending}
          onSetPlacement={onSetPlacement}
          onTakeover={() => onSelect()}
        />
      </td>
      <td className="skill-row-actions" aria-label={`${skill.name} 操作`}>
        <button
          className="skill-button skill-row-detail"
          onClick={onSelect}
          aria-label={`详情 ${skill.name}，${targetText}`}
        >
          <span>详情</span>
          <ChevronRight size={18} />
        </button>
        <button
          className="skill-icon-button skill-row-more"
          aria-label={`更多操作 ${skill.name}，${targetText}`}
          onClick={() => setMenuOpen(true)}
        >
          <MoreHorizontal size={18} />
        </button>
        {menuOpen && (
          <FocusedDialog
            open
            title={`${skill.name} · 更多操作`}
            onClose={() => setMenuOpen(false)}
            className="skill-row-menu"
          >
            <div className="skill-action-menu">
              <button
                className="skill-button"
                onClick={() => {
                  setMenuOpen(false);
                  onSelect();
                }}
              >
                查看详情
              </button>
              {updateAvailable && (
                <button
                  className="skill-button"
                  disabled={pending}
                  onClick={() => {
                    setMenuOpen(false);
                    onUpdate();
                  }}
                >
                  更新 {skill.name}
                </button>
              )}
              <button
                className="skill-button danger uninstall"
                disabled={pending}
                onClick={() => {
                  setMenuOpen(false);
                  onUninstall();
                }}
                aria-label={`卸载 ${skill.name}，${targetText}`}
              >
                卸载
              </button>
            </div>
          </FocusedDialog>
        )}
      </td>
    </tr>
  );
}

function InstalledSkillDetail({
  skill,
  placements,
  targetText,
  updateAvailable,
  pending,
  onBack,
  backButtonRef,
  onUpdate,
  onUninstall,
  onSetPlacement,
  onTakeover,
}: {
  skill: InstalledSkill;
  placements: readonly SkillPlacement[];
  targetText: string;
  updateAvailable: boolean;
  pending: boolean;
  onBack: () => void;
  backButtonRef: RefObject<HTMLButtonElement>;
  onUpdate: () => void;
  onUninstall: () => void;
  onSetPlacement: (placement: SkillPlacement, placed: boolean) => void;
  onTakeover: (placement: SkillPlacement) => void;
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
      </dl>

      <details className="skill-detail-metadata">
        <summary>版本与安装记录</summary>
        <dl className="skill-detail-grid">
          {' '}
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
      </details>
      <div className="skill-detail-section">
        <h3>投放位置</h3>
        <p className="skill-placement-note">
          关闭一个投放位置，不影响其他位置，也不保证 Agent 不再发现该 Skill。
        </p>
        <SkillPlacementControls
          skillName={skill.name}
          placements={placements}
          pending={pending}
          onSetPlacement={onSetPlacement}
          onTakeover={onTakeover}
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [zipInitialLocation, setZipInitialLocation] = useState<SkillLocation | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledSkill | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [backupsDialogOpen, setBackupsDialogOpen] = useState(false);
  const [takeoverTarget, setTakeoverTarget] = useState<{
    skill: InstalledSkill;
    placement: SkillPlacement;
  } | null>(null);
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
    isFetching: refreshingSkills,
    error: installedSkillsError,
    refetch: refetchInstalledSkills,
  } = useInstalledSkills(context);
  const {
    data: placementAssets = [],
    isFetching: refreshingPlacements,
    refetch: refetchPlacements,
  } = useSkillPlacements(context);
  const { data: placementTargets = [] } = useSkillPlacementTargets(operationTarget);
  const setPlacementMutation = useSetSkillPlacement();
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
  const previewImportMutation = usePreviewSkillImport();
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

  const placementsBySkill = useMemo(() => {
    const result = new Map<string, readonly SkillPlacement[]>();
    for (const asset of placementAssets) {
      result.set(`${targetValue(asset.target)}:${asset.id}`, asset.placements);
    }
    return result;
  }, [placementAssets]);

  const placedCount = useMemo(
    () =>
      placementAssets.reduce(
        (count, asset) =>
          count + asset.placements.filter((placement) => placement.state === 'placed').length,
        0,
      ),
    [placementAssets],
  );

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
    setZipInitialLocation(null);
    setTakeoverTarget(null);
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
    setPlacementMutation.isPending ||
    uninstallMutation.isPending ||
    updateSkillMutation.isPending ||
    importMutation.isPending ||
    installFromZipMutation.isPending ||
    restoreMutation.isPending ||
    deleteBackupMutation.isPending ||
    previewImportMutation.isPending;

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

  const handleSetPlacement = async (
    skill: InstalledSkill,
    placement: SkillPlacement,
    placed: boolean,
  ) => {
    clearFeedback();
    try {
      await setPlacementMutation.mutateAsync({
        id: skill.id,
        target: skill.target,
        location: placement.location,
        placed,
        expectedRevision: placement.revision,
      });
      setStatusMessage(
        placed
          ? `${skill.name} 已投放到 ${skillLocationLabels[placement.location]}。`
          : `${skill.name} 已从 ${skillLocationLabels[placement.location]} 撤回投放。`,
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

  const handleRefreshPlacements = async () => {
    clearFeedback();
    try {
      await Promise.all([refetchInstalledSkills(), refetchPlacements()]);
      setStatusMessage('已重新读取目录投放状态。');
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

  const handlePreviewImportForTarget = async (
    selections: ImportSkillSelection[],
    target: ScopeTarget,
  ): Promise<SkillImportPreview> => {
    clearFeedback();
    try {
      return await previewImportMutation.mutateAsync({ selections, target });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const handlePreviewImport = async (
    selections: ImportSkillSelection[],
  ): Promise<SkillImportPreview> => {
    const target = requireOperationTarget();
    if (target === null) throw new Error('未选择操作目标');
    return handlePreviewImportForTarget(selections, target);
  };

  const handleImportForTarget = async (
    selections: ImportSkillSelection[],
    expectedRevision: string,
    target: ScopeTarget,
  ) => {
    clearFeedback();
    try {
      await importMutation.mutateAsync({ selections, target, expectedRevision });
      setImportDialogOpen(false);
      setTakeoverTarget(null);
      setStatusMessage(`已接管 ${selections.length} 个本地 Skill。`);
    } catch (error) {
      reportError(error);
    }
  };

  const handleImport = async (selections: ImportSkillSelection[], expectedRevision: string) => {
    const target = requireOperationTarget();
    if (target === null) return;
    await handleImportForTarget(selections, expectedRevision, target);
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
    setZipInitialLocation(null);
    setZipDialogOpen(true);
  };

  const handleInstallFromZip = async () => {
    clearFeedback();
    if (zipPath.trim() === '') return;
    const target = requireOperationTarget();
    if (target === null) return;
    const initialLocation = zipInitialLocation;
    if (initialLocation === null) {
      setErrorMessage('请选择 ZIP 安装后的初始投放位置。');
      return;
    }
    try {
      await installFromZipMutation.mutateAsync({
        filePath: zipPath.trim(),
        initialLocation,
        target,
      });
      setZipDialogOpen(false);
      setZipPath('');
      setZipInitialLocation(null);
      setStatusMessage(`已从 ZIP 安装 Skill，并投放到 ${skillLocationLabels[initialLocation]}。`);
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
    <section
      className={`skill-panel${selectedSkill ? ' has-detail' : ''}`}
      aria-label="已安装 Skills"
    >
      <div className="skill-panel-heading">
        <div>
          <h2 ref={panelHeadingRef} tabIndex={-1}>
            已安装
          </h2>
          <p>
            {skills?.length ?? 0} 个受管 Skill · {placedCount} 处目录投放
          </p>
        </div>
      </div>

      <div className="skill-installed-toolbar">
        <div className="skill-toolbar-top">
          <label className="skill-search-field" htmlFor="skill-installed-search">
            <Search size={16} aria-hidden="true" />
            <input
              id="skill-installed-search"
              type="search"
              placeholder="搜索名称、描述或来源"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <div className="skill-desktop-actions">
            <button
              className="skill-button"
              onClick={handleCheckUpdates}
              disabled={isCheckingUpdates || pending || allTargetMissing}
            >
              {isCheckingUpdates ? '检查中…' : '检查更新'}
            </button>
            <button
              className="skill-button"
              onClick={() => void handleRefreshPlacements()}
              disabled={refreshingSkills || refreshingPlacements || pending}
            >
              {refreshingPlacements ? '读取中…' : '重新读取投放状态'}
            </button>
            <button className="skill-button primary" onClick={onOpenDiscovery}>
              发现技能
            </button>
          </div>
        </div>
        <div className="skill-toolbar-bottom">
          {context.kind === 'all' ? (
            <label className="skill-target-field" htmlFor="skill-installed-target">
              <span>操作目标</span>
              <select
                id="skill-installed-target"
                aria-label="选择 Skill 操作目标"
                value={targetValue(allOperationTarget)}
                onChange={(event) => setAllOperationTarget(targetFromValue(event.target.value))}
              >
                <option value="">选择操作目标</option>
                <option value="global">全局配置</option>
                {projects.map((project) => (
                  <option key={project.projectId} value={`project:${project.projectId}`}>
                    {targetLabel({ scope: 'project', projectId: project.projectId }, projects)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="skill-target-field">
              操作目标：{operationTarget ? targetLabel(operationTarget, projects) : ''}
            </span>
          )}
          <div className="skill-desktop-actions">
            <button
              className="skill-button"
              onClick={handleOpenImport}
              disabled={pending || allTargetMissing}
            >
              导入已有
            </button>
            <button
              className="skill-button"
              onClick={handleOpenBackups}
              disabled={pending || allTargetMissing}
            >
              从备份恢复
            </button>
            <button
              className="skill-button"
              onClick={handleOpenZip}
              disabled={pending || allTargetMissing}
            >
              从 ZIP 安装
            </button>
            {(updates ?? []).length > 0 && (
              <button
                className="skill-button primary"
                onClick={handleUpdateAll}
                disabled={pending || allTargetMissing}
              >
                全部更新 ({updates!.length})
              </button>
            )}
          </div>
          <button
            className="skill-button skill-mobile-actions"
            onClick={() => setActionsOpen(true)}
          >
            更多操作
          </button>
        </div>
        {allTargetMissing && (
          <span className="skill-target-hint" role="status">
            请先选择操作目标，检查更新、导入已有、备份恢复或 ZIP 安装才会启用。
          </span>
        )}
      </div>
      {actionsOpen && (
        <FocusedDialog
          open
          title="Skills · 更多操作"
          onClose={() => setActionsOpen(false)}
          className="skill-actions-dialog"
        >
          <div className="skill-action-menu">
            <button
              className="skill-button"
              disabled={isCheckingUpdates || pending || allTargetMissing}
              onClick={() => {
                setActionsOpen(false);
                void handleCheckUpdates();
              }}
            >
              检查更新
            </button>
            <button
              className="skill-button"
              disabled={refreshingSkills || refreshingPlacements || pending}
              onClick={() => {
                setActionsOpen(false);
                void handleRefreshPlacements();
              }}
            >
              重新读取投放状态
            </button>
            <button
              className="skill-button"
              disabled={pending || allTargetMissing}
              onClick={() => {
                setActionsOpen(false);
                handleOpenImport();
              }}
            >
              导入已有
            </button>
            <button
              className="skill-button"
              disabled={pending || allTargetMissing}
              onClick={() => {
                setActionsOpen(false);
                handleOpenBackups();
              }}
            >
              从备份恢复
            </button>
            <button
              className="skill-button"
              disabled={pending || allTargetMissing}
              onClick={() => {
                setActionsOpen(false);
                handleOpenZip();
              }}
            >
              从 ZIP 安装
            </button>
            {(updates ?? []).length > 0 && (
              <button
                className="skill-button"
                disabled={pending || allTargetMissing}
                onClick={() => {
                  setActionsOpen(false);
                  void handleUpdateAll();
                }}
              >
                全部更新 ({updates!.length})
              </button>
            )}
            <button
              className="skill-button primary"
              onClick={() => {
                setActionsOpen(false);
                onOpenDiscovery();
              }}
            >
              发现技能
            </button>
          </div>
        </FocusedDialog>
      )}

      <SkillFeedback
        errorMessage={
          installedSkillsErrorMessage ||
          (zipDialogOpen || importDialogOpen || backupsDialogOpen || takeoverTarget
            ? ''
            : errorMessage)
        }
        statusMessage={statusMessage}
      />
      <p className="skill-placement-note">
        图标控制目录投放；完整路径与异常处理见详情。关闭一个位置不保证 Agent 停止加载。
      </p>

      {selectedSkill !== null ? (
        <InstalledSkillDetail
          skill={selectedSkill}
          placements={placementsBySkill.get(skillSelectionId(selectedSkill)) ?? []}
          targetText={targetLabel(selectedSkill.target, projects)}
          updateAvailable={hasUpdate(selectedSkill)}
          pending={pending}
          onBack={closeDetail}
          backButtonRef={detailBackButtonRef}
          onUpdate={() => void handleUpdateSkill(selectedSkill)}
          onUninstall={() => requestUninstall(selectedSkill)}
          onSetPlacement={(placement, placed) =>
            void handleSetPlacement(selectedSkill, placement, placed)
          }
          onTakeover={(placement) => setTakeoverTarget({ skill: selectedSkill, placement })}
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
          {skillGroups.map((group, groupIndex) => (
            <section
              key={group.key}
              className="skill-scope-group"
              aria-labelledby={`skill-group-${group.key}`}
            >
              <table className="skill-list skill-table">
                <colgroup>
                  <col className="col-skill" />
                  <col className="col-source" />
                  <col className="col-target" />
                  <col className="col-placements" />
                  <col className="col-actions" />
                </colgroup>
                <caption className="sr-only">{group.label} Skill 列表</caption>
                <thead className={groupIndex > 0 ? 'sr-only' : undefined}>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">来源</th>
                    <th scope="col">目标</th>
                    <th scope="col">投放位置</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="skill-group-row">
                    <th colSpan={5}>
                      <h3 id={`skill-group-${group.key}`}>
                        {group.label} · {group.skills.length} 个 Skill
                      </h3>
                    </th>
                  </tr>
                  {group.skills.map((skill) => (
                    <InstalledSkillRow
                      key={`${targetValue(skill.target)}:${skill.id}`}
                      skill={skill}
                      placements={placementsBySkill.get(skillSelectionId(skill)) ?? []}
                      targetText={targetLabel(skill.target, projects)}
                      updateAvailable={hasUpdate(skill)}
                      selected={selectedSkillId === skillSelectionId(skill)}
                      onSelect={() => selectSkill(skill)}
                      onUpdate={() => void handleUpdateSkill(skill)}
                      onUninstall={() => requestUninstall(skill)}
                      onSetPlacement={(placement, placed) =>
                        void handleSetPlacement(skill, placement, placed)
                      }
                      onTakeover={(placement) => setTakeoverTarget({ skill, placement })}
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
          targets={placementTargets}
          targetText={operationTarget ? targetLabel(operationTarget, projects) : '当前操作目标'}
          errorMessage={errorMessage}
          pending={importMutation.isPending}
          onPreview={handlePreviewImport}
          onImport={handleImport}
          onClose={() => {
            setImportDialogOpen(false);
            clearFeedback();
          }}
        />
      )}

      {takeoverTarget !== null &&
        (() => {
          const { skill, placement } = takeoverTarget;
          const sourcePath = `${placement.path.replace(/\/+$/, '')}/${skill.directory.replace(/^\/+/, '')}`;
          return (
            <ImportDialog
              title={`接管 ${skill.name} 的已有投放`}
              skills={[
                {
                  directory: skill.directory,
                  name: skill.name,
                  description: skill.description,
                  foundIn: [placement.location],
                  path: sourcePath,
                },
              ]}
              targets={[placement]}
              targetText={targetLabel(skill.target, projects)}
              errorMessage={errorMessage}
              pending={importMutation.isPending}
              preselected={{ sourcePath, location: placement.location }}
              onPreview={(selections) => handlePreviewImportForTarget(selections, skill.target)}
              onImport={(selections, expectedRevision) =>
                void handleImportForTarget(selections, expectedRevision, skill.target)
              }
              onClose={() => {
                setTakeoverTarget(null);
                clearFeedback();
              }}
            />
          );
        })()}

      {zipDialogOpen && (
        <ZipInstallDialog
          path={zipPath}
          target={operationTarget}
          targetText={operationTarget ? targetLabel(operationTarget, projects) : null}
          projects={projects}
          allowTargetChange={context.kind === 'all'}
          targets={placementTargets}
          initialLocation={zipInitialLocation}
          pending={installFromZipMutation.isPending}
          errorMessage={errorMessage}
          onChoose={handleChooseZip}
          onTargetChange={setAllOperationTarget}
          onInitialLocationChange={setZipInitialLocation}
          onInstall={() => void handleInstallFromZip()}
          onClose={() => {
            setZipDialogOpen(false);
            setZipPath('');
            setZipInitialLocation(null);
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
            吗？这会删除受管主资产及其受管投放；未接管条目不在清理范围内。
          </p>
        )}
      </FocusedDialog>
    </section>
  );
}

function ImportDialog({
  skills,
  targets,
  targetText,
  errorMessage,
  pending,
  title = '导入已有 Skill',
  preselected,
  onPreview,
  onImport,
  onClose,
}: {
  skills: UnmanagedSkill[];
  targets: readonly SkillPlacementTarget[];
  targetText: string;
  errorMessage: string;
  pending: boolean;
  title?: string;
  preselected?: { sourcePath: string; location: SkillLocation };
  onPreview: (selections: ImportSkillSelection[]) => Promise<SkillImportPreview>;
  onImport: (selections: ImportSkillSelection[], expectedRevision: string) => void;
  onClose: () => void;
}) {
  const firstSelectionRef = useRef<HTMLInputElement>(null);
  const selectionKey = (skill: UnmanagedSkill) => `${skill.directory}::${skill.path}`;
  const directoryKey = (skill: UnmanagedSkill) => skill.directory.toLowerCase();
  const [selected, setSelected] = useState<Set<string>>(() => {
    const match = preselected
      ? skills.find((skill) => skill.path === preselected.sourcePath)
      : undefined;
    return match ? new Set([selectionKey(match)]) : new Set();
  });
  const [locationsBySkill, setLocationsBySkill] = useState<Record<string, SkillLocation[]>>(() => {
    if (!preselected) return {};
    const match = skills.find((skill) => skill.path === preselected.sourcePath);
    return match ? { [selectionKey(match)]: [preselected.location] } : {};
  });
  const [preview, setPreview] = useState<SkillImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
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
  const toggleSelect = (skill: UnmanagedSkill) => {
    const key = selectionKey(skill);
    setPreview(null);
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

  const setLocations = (key: string, locations: SkillLocation[]) => {
    setLocationsBySkill((previous) => ({
      ...previous,
      [key]: locations,
    }));
    setPreview(null);
  };

  const selections = skills
    .filter((skill) => selected.has(selectionKey(skill)))
    .map((skill) => ({
      directory: skill.directory,
      sourcePath: skill.path,
      locations: locationsBySkill[selectionKey(skill)] ?? [],
    }));
  const selectionReady =
    selections.length > 0 && selections.every((selection) => selection.locations.length > 0);

  const handlePreview = async () => {
    if (!selectionReady) return;
    setPreviewing(true);
    try {
      setPreview(await onPreview(selections));
    } catch {
      // 外层统一呈现结构化错误，保留当前选择以便重新预览。
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <FocusedDialog
      open
      title={title}
      onClose={onClose}
      initialFocusRef={firstSelectionRef}
      closeLabel="关闭导入已有 Skill 对话框"
      className="skill-dialog"
      footer={
        <>
          {preview ? (
            <>
              <button
                type="button"
                className="skill-button"
                onClick={() => setPreview(null)}
                disabled={pending}
              >
                返回修改
              </button>
              <button
                type="button"
                className="skill-button primary"
                onClick={() => onImport(selections, preview.revision)}
                disabled={pending}
              >
                确认接管
              </button>
            </>
          ) : (
            <>
              <button type="button" className="skill-button" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="skill-button primary"
                onClick={() => void handlePreview()}
                disabled={!selectionReady || previewing}
              >
                {previewing ? '生成预览中…' : `预览接管 (${selected.size})`}
              </button>
            </>
          )}
        </>
      }
    >
      {errorMessage && (
        <div className="skill-error" role="alert">
          {errorMessage}
        </div>
      )}
      {preview ? (
        <div className="skill-import-preview">
          <p className="skill-dialog-copy">
            请核对复制到受管位置、原件保留或原路径替换等实际动作。确认时会再次检查这些路径是否变化。
          </p>
          {preview.items.map((item) => (
            <section
              key={`${item.directory}:${item.sourcePath}`}
              className="skill-import-preview-item"
            >
              <h3>{item.directory}</h3>
              <dl>
                <div>
                  <dt>来源原件</dt>
                  <dd>
                    <code>{item.sourcePath}</code>
                  </dd>
                </div>
                <div>
                  <dt>受管位置</dt>
                  <dd>
                    <code>{item.storagePath}</code>
                  </dd>
                </div>
              </dl>
              <ul>
                {item.actions.map((action, index) => (
                  <li key={`${action.path}:${index}`}>
                    <code>{action.path}</code>
                    <span>{action.action}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="skill-import-list">
          <p className="skill-dialog-copy">
            请选择要接管的来源和投放位置。发现位置不会自动取得所有权；下一步会先展示实际文件动作。
          </p>
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
                  {selected.has(key) && (
                    <SkillLocationCheckboxGroup
                      targets={targets}
                      value={locationsBySkill[key] ?? []}
                      onChange={(locations) => setLocations(key, locations)}
                      legend="接管并投放到"
                      labelPrefix={`${skill.name}，${targetText}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </FocusedDialog>
  );
}

function ZipInstallDialog({
  path,
  target,
  targetText,
  projects,
  allowTargetChange,
  targets,
  initialLocation,
  pending,
  errorMessage,
  onChoose,
  onTargetChange,
  onInitialLocationChange,
  onInstall,
  onClose,
}: {
  path: string;
  target: ScopeTarget | null;
  targetText: string | null;
  projects: readonly ProjectSummary[];
  allowTargetChange: boolean;
  targets: readonly SkillPlacementTarget[];
  initialLocation: SkillLocation | null;
  pending: boolean;
  errorMessage: string;
  onChoose: () => void;
  onTargetChange: (target: ScopeTarget | null) => void;
  onInitialLocationChange: (location: SkillLocation | null) => void;
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
            disabled={pending || path.trim() === '' || target === null || initialLocation === null}
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
        <div className="skill-zip-dialog-file">
          <span>{path ? path.split(/[\\/]/).pop() : 'ZIP 文件'}</span>
          <button type="button" className="skill-button" onClick={onChoose} disabled={pending}>
            选择 ZIP 文件
          </button>
          <output aria-live="polite">{path || '尚未选择文件'}</output>
        </div>
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
        <SkillLocationRadioGroup
          name="skill-zip-initial-location"
          targets={targets}
          value={initialLocation}
          onChange={onInitialLocationChange}
          disabled={pending}
        />
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
