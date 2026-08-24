import { useMemo, useState } from 'react';
import {
  RefreshCw,
  Search,
  Trash2,
  Download,
  FolderInput,
  ArchiveRestore,
  Loader2,
} from 'lucide-react';
import type {
  AgentType,
  ImportSkillSelection,
  InstalledSkill,
  SkillApps,
  UnmanagedSkill,
} from '../../types';
import {
  useInstalledSkills,
  useToggleSkillApp,
  useUninstallSkill,
  useCheckSkillUpdates,
  useUpdateSkill,
  useScanUnmanagedSkills,
  useImportSkillsFromApps,
  useInstallSkillsFromZip,
  useSkillBackups,
  useRestoreSkillBackup,
  useDeleteSkillBackup,
} from '../../hooks/useSkills';
import { toUserError } from '../../lib/errors';
import './skills.css';

const AGENTS: AgentType[] = ['claude-code', 'codex', 'gemini-cli', 'opencode'];

const agentLabels: Record<AgentType, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  'gemini-cli': 'Gemini',
  opencode: 'OpenCode',
};

interface InstalledSkillsPanelProps {
  activeApp: AgentType;
}

function AppToggleGroup({
  apps,
  onToggle,
  disabled,
}: {
  apps: SkillApps;
  onToggle: (app: AgentType, enabled: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="skill-toggle-group">
      <span className="skill-toggle-label">启用：</span>
      {AGENTS.map((app) => (
        <label key={app} className="skill-toggle">
          <input
            type="checkbox"
            checked={apps[mapAppField(app)]}
            onChange={(event) => onToggle(app, event.target.checked)}
            disabled={disabled}
          />
          {agentLabels[app]}
        </label>
      ))}
    </div>
  );
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

export function InstalledSkillsPanel({ activeApp }: InstalledSkillsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [zipPath, setZipPath] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [backupsDialogOpen, setBackupsDialogOpen] = useState(false);

  const { data: skills, isLoading } = useInstalledSkills();
  const toggleAppMutation = useToggleSkillApp();
  const uninstallMutation = useUninstallSkill();
  const {
    data: updates,
    refetch: checkUpdates,
    isFetching: isCheckingUpdates,
  } = useCheckSkillUpdates();
  const updateSkillMutation = useUpdateSkill();
  const { data: unmanagedSkills, refetch: scanUnmanaged } = useScanUnmanagedSkills({
    enabled: false,
  });
  const importMutation = useImportSkillsFromApps();
  const installFromZipMutation = useInstallSkillsFromZip();
  const { data: backups, refetch: refetchBackups } = useSkillBackups();
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
      for (const app of AGENTS) {
        if (skill.apps[mapAppField(app)]) {
          counts[app] += 1;
        }
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

  const pending =
    toggleAppMutation.isPending ||
    uninstallMutation.isPending ||
    updateSkillMutation.isPending ||
    importMutation.isPending ||
    installFromZipMutation.isPending ||
    restoreMutation.isPending ||
    deleteBackupMutation.isPending;

  const handleToggleApp = async (id: string, app: AgentType, enabled: boolean) => {
    setErrorMessage('');
    try {
      await toggleAppMutation.mutateAsync({ id, app, enabled });
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleUninstall = async (skill: InstalledSkill) => {
    setErrorMessage('');
    try {
      await uninstallMutation.mutateAsync(skill.id);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleCheckUpdates = async () => {
    setErrorMessage('');
    try {
      const result = await checkUpdates();
      const count = result.data?.length ?? 0;
      if (count === 0) {
        setErrorMessage('当前没有可更新的 Skill。');
      }
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleUpdateSkill = async (skill: InstalledSkill) => {
    setErrorMessage('');
    try {
      await updateSkillMutation.mutateAsync(skill.id);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleUpdateAll = async () => {
    setErrorMessage('');
    const applicable = (updates ?? []).filter((update) =>
      (skills ?? []).some((skill) => skill.id === update.id),
    );
    if (applicable.length === 0) return;
    let success = 0;
    const failures: string[] = [];
    for (const update of applicable) {
      try {
        await updateSkillMutation.mutateAsync(update.id);
        success += 1;
      } catch (error) {
        const userError = toUserError(error);
        failures.push(`${update.name}: ${userError.message}`);
      }
    }
    const messages: string[] = [];
    if (success > 0) {
      messages.push(`成功更新 ${success} 个 Skill。`);
    }
    messages.push(...failures);
    if (messages.length > 0) {
      setErrorMessage(messages.join('\n'));
    }
  };

  const handleOpenImport = async () => {
    setErrorMessage('');
    try {
      const result = await scanUnmanaged();
      if (result.data === undefined || result.data.length === 0) {
        setErrorMessage('未找到可导入的本地 Skill。');
        return;
      }
      setImportDialogOpen(true);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleImport = async (selections: ImportSkillSelection[]) => {
    setErrorMessage('');
    try {
      await importMutation.mutateAsync(selections);
      setImportDialogOpen(false);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleInstallFromZip = async () => {
    setErrorMessage('');
    if (zipPath.trim() === '') return;
    try {
      await installFromZipMutation.mutateAsync({ filePath: zipPath.trim(), currentApp: activeApp });
      setZipPath('');
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleOpenBackups = async () => {
    setErrorMessage('');
    setBackupsDialogOpen(true);
    try {
      await refetchBackups();
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleRestore = async (backupId: string) => {
    setErrorMessage('');
    try {
      await restoreMutation.mutateAsync({ backupId, currentApp: activeApp });
      setBackupsDialogOpen(false);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    setErrorMessage('');
    try {
      await deleteBackupMutation.mutateAsync(backupId);
      await refetchBackups();
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  return (
    <section className="skill-panel" aria-label="已安装 Skills">
      <div className="skill-count-bar">
        <span>
          已安装 <span className="count-value">{skills?.length ?? 0}</span> 个
        </span>
        {AGENTS.map((app) => (
          <span key={app} className="count-item">
            {agentLabels[app]}: <span className="count-value">{enabledCounts[app]}</span>
          </span>
        ))}
      </div>

      <div className="skill-toolbar">
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            id="skill-installed-search"
            type="text"
            placeholder="搜索已安装 skill"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{ paddingLeft: 28 }}
          />
        </div>
        <button type="button" onClick={handleCheckUpdates} disabled={isCheckingUpdates || pending}>
          {isCheckingUpdates ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          检查更新
        </button>
        {(updates ?? []).length > 0 && (
          <button type="button" className="primary" onClick={handleUpdateAll} disabled={pending}>
            <RefreshCw size={14} />
            全部更新 ({updates!.length})
          </button>
        )}
        <button type="button" onClick={handleOpenImport} disabled={pending}>
          <FolderInput size={14} />
          导入本地
        </button>
        <button type="button" onClick={handleOpenBackups} disabled={pending}>
          <ArchiveRestore size={14} />
          备份
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            placeholder="ZIP 文件路径"
            value={zipPath}
            onChange={(event) => setZipPath(event.target.value)}
            style={{ minWidth: 200 }}
          />
          <button
            type="button"
            onClick={handleInstallFromZip}
            disabled={pending || zipPath.trim() === ''}
          >
            <Download size={14} />从 ZIP 安装
          </button>
        </div>
      </div>

      {errorMessage && <div className="skill-error">{errorMessage}</div>}

      {isLoading ? (
        <div className="skill-empty">
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
        <div className="skill-list">
          {filteredSkills.map((skill) => (
            <article key={skill.id} className="skill-card" data-skill-id={skill.id}>
              <div className="skill-card-header">
                <div>
                  <h3 className="skill-card-title">{skill.name}</h3>
                  <div className="skill-card-meta">
                    <span className="skill-card-badge">{skill.directory}</span>
                    {skill.repoOwner && skill.repoName && (
                      <span className="skill-card-badge">
                        {skill.repoOwner}/{skill.repoName}
                      </span>
                    )}
                    {updatesMap[skill.id] !== undefined && (
                      <span className="skill-update-badge">可更新</span>
                    )}
                  </div>
                </div>
                <div className="skill-card-actions">
                  {updatesMap[skill.id] !== undefined && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => handleUpdateSkill(skill)}
                      disabled={pending}
                    >
                      <RefreshCw size={14} />
                      更新
                    </button>
                  )}
                  <button
                    type="button"
                    className="uninstall"
                    onClick={() => handleUninstall(skill)}
                    disabled={pending}
                  >
                    <Trash2 size={14} />
                    卸载
                  </button>
                </div>
              </div>
              {skill.description && <p className="skill-card-desc">{skill.description}</p>}
              <AppToggleGroup
                apps={skill.apps}
                onToggle={(app, enabled) => handleToggleApp(skill.id, app, enabled)}
                disabled={pending || toggleAppMutation.isPending}
              />
            </article>
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
  // 同名不同来源的发现项需用 directory + path（扫描拆条后各自指向本组来源）复合 key 区分。
  const selectionKey = (skill: UnmanagedSkill) => `${skill.directory}::${skill.path}`;
  // 与后端批量导入判重（directory.to_lowercase()）一致：directory 分组统一按小写比较。
  const directoryKey = (skill: UnmanagedSkill) => skill.directory.toLowerCase();

  // 同 directory 的发现项互斥（后端对重复 directory 会整批拒绝），默认只勾选每组第一条。
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
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      // 单选语义：勾选一条时自动取消同 directory（小写归一）的其他来源。
      for (const other of skills) {
        if (directoryKey(other) === directoryKey(skill)) {
          next.delete(selectionKey(other));
        }
      }
      next.add(key);
    }
    setSelected(next);
  };

  const toggleApp = (key: string, app: AgentType, enabled: boolean) => {
    setAppsBySkill((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [mapAppField(app)]: enabled,
      },
    }));
  };

  const handleImport = () => {
    const selections = skills
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
      }));
    onImport(selections);
  };

  return (
    <div className="skill-dialog-overlay" onClick={onClose}>
      <div
        className="skill-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="skill-dialog-header">
          <h3 id="import-title">导入本地 Skill</h3>
        </div>
        <div className="skill-dialog-body">
          {skills.map((skill) => (
            <div key={selectionKey(skill)} className="skill-import-item">
              <input
                type="checkbox"
                checked={selected.has(selectionKey(skill))}
                onChange={() => toggleSelect(skill)}
              />
              <div className="skill-import-item-info">
                <div className="skill-import-item-name">{skill.name}</div>
                {skill.description && (
                  <div style={{ fontSize: 12, color: '#555' }}>{skill.description}</div>
                )}
                <div className="skill-import-item-path">{skill.path}</div>
                {conflictDirectories.has(directoryKey(skill)) && (
                  <div style={{ fontSize: 11, color: '#a15c00' }}>
                    同名 Skill 一次只能导入一个来源
                  </div>
                )}
                <div className="skill-toggle-group" style={{ borderTop: 'none', paddingTop: 6 }}>
                  {AGENTS.map((app) => (
                    <label key={app} className="skill-toggle">
                      <input
                        type="checkbox"
                        checked={appsBySkill[selectionKey(skill)]?.[mapAppField(app)] ?? false}
                        onChange={(event) =>
                          toggleApp(selectionKey(skill), app, event.target.checked)
                        }
                      />
                      {agentLabels[app]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="skill-dialog-footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleImport}
            disabled={selected.size === 0}
          >
            导入选中项 ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}

function BackupsDialog({
  backups,
  onRestore,
  onDelete,
  onClose,
}: {
  backups: { backupId: string; backupPath: string; createdAt: number; skill: InstalledSkill }[];
  onRestore: (backupId: string) => void;
  onDelete: (backupId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="skill-dialog-overlay" onClick={onClose}>
      <div
        className="skill-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="backups-title"
      >
        <div className="skill-dialog-header">
          <h3 id="backups-title">Skill 备份</h3>
        </div>
        <div className="skill-dialog-body">
          {backups.length === 0 ? (
            <p style={{ color: '#555', fontSize: 13 }}>暂无备份。</p>
          ) : (
            backups.map((backup) => (
              <div key={backup.backupId} className="skill-backup-item">
                <div className="skill-backup-item-info">
                  <div className="skill-backup-item-name">{backup.skill.name}</div>
                  <div className="skill-backup-item-path">{backup.backupPath}</div>
                  <div style={{ fontSize: 11, color: '#777' }}>{formatDate(backup.createdAt)}</div>
                </div>
                <div className="skill-backup-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onRestore(backup.backupId)}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className="uninstall"
                    onClick={() => onDelete(backup.backupId)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="skill-dialog-footer">
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
