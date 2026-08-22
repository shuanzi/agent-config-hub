import { useMemo, useState } from 'react';
import { RefreshCw, Search, Trash2, ArchiveRestore, Loader2 } from 'lucide-react';
import type { AgentType, InstalledSubagent, SubagentApps, SubagentBackupEntry } from '../../types';
import {
  useInstalledSubagents,
  useToggleSubagentApp,
  useUninstallSubagent,
  useCheckSubagentUpdates,
  useUpdateSubagent,
  useSubagentBackups,
  useRestoreSubagentBackup,
  useDeleteSubagentBackup,
} from '../../hooks/useSubagents';
import { toUserError } from '../../lib/errors';
import './subagents.css';

const AGENTS: AgentType[] = ['claude-code', 'codex', 'gemini-cli', 'opencode'];

const agentLabels: Record<AgentType, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  'gemini-cli': 'Gemini',
  opencode: 'OpenCode',
};

interface InstalledSubagentsPanelProps {
  activeApp: AgentType;
}

function AppToggleGroup({
  apps,
  onToggle,
  disabled,
}: {
  apps: SubagentApps;
  onToggle: (app: AgentType, enabled: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="subagent-toggle-group">
      <span className="subagent-toggle-label">启用：</span>
      {AGENTS.map((app) => (
        <label key={app} className="subagent-toggle">
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
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? String(unixSeconds) : date.toLocaleString();
}

export function InstalledSubagentsPanel({ activeApp }: InstalledSubagentsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [backupsDialogOpen, setBackupsDialogOpen] = useState(false);

  const { data: subagents, isLoading } = useInstalledSubagents();
  const toggleAppMutation = useToggleSubagentApp();
  const uninstallMutation = useUninstallSubagent();
  const {
    data: updates,
    refetch: checkUpdates,
    isFetching: isCheckingUpdates,
  } = useCheckSubagentUpdates();
  const updateSubagentMutation = useUpdateSubagent();
  const { data: backups, refetch: refetchBackups } = useSubagentBackups();
  const restoreMutation = useRestoreSubagentBackup();
  const deleteBackupMutation = useDeleteSubagentBackup();

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
    for (const subagent of subagents ?? []) {
      for (const app of AGENTS) {
        if (subagent.apps[mapAppField(app)]) {
          counts[app] += 1;
        }
      }
    }
    return counts;
  }, [subagents]);

  const filteredSubagents = useMemo(() => {
    if (subagents === undefined) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return subagents;
    return subagents.filter((subagent) => {
      const values = [
        subagent.name,
        subagent.id,
        subagent.description,
        subagent.directory,
        subagent.repoOwner,
        subagent.repoName,
      ];
      return values.some((value) => value?.toLowerCase().includes(query));
    });
  }, [subagents, searchQuery]);

  const pending =
    toggleAppMutation.isPending ||
    uninstallMutation.isPending ||
    updateSubagentMutation.isPending ||
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

  const handleUninstall = async (subagent: InstalledSubagent) => {
    setErrorMessage('');
    try {
      await uninstallMutation.mutateAsync(subagent.id);
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
        setErrorMessage('当前没有可更新的 Subagent。');
      }
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleUpdateSubagent = async (subagent: InstalledSubagent) => {
    setErrorMessage('');
    try {
      await updateSubagentMutation.mutateAsync(subagent.id);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleUpdateAll = async () => {
    setErrorMessage('');
    const applicable = (updates ?? []).filter((update) =>
      (subagents ?? []).some((subagent) => subagent.id === update.id),
    );
    if (applicable.length === 0) return;
    let success = 0;
    for (const update of applicable) {
      try {
        await updateSubagentMutation.mutateAsync(update.id);
        success += 1;
      } catch (error) {
        const userError = toUserError(error);
        setErrorMessage(`${update.name}: ${userError.message}`);
      }
    }
    if (success > 0) {
      setErrorMessage(`成功更新 ${success} 个 Subagent。`);
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
    <section className="subagent-panel" aria-label="已安装 Subagents">
      <div className="subagent-count-bar">
        <span>
          已安装 <span className="count-value">{subagents?.length ?? 0}</span> 个
        </span>
        {AGENTS.map((app) => (
          <span key={app} className="count-item">
            {agentLabels[app]}: <span className="count-value">{enabledCounts[app]}</span>
          </span>
        ))}
      </div>

      <div className="subagent-toolbar">
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            id="subagent-installed-search"
            type="text"
            placeholder="搜索已安装 subagent"
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
        <button type="button" onClick={handleOpenBackups} disabled={pending}>
          <ArchiveRestore size={14} />
          备份
        </button>
      </div>

      {errorMessage && <div className="subagent-error">{errorMessage}</div>}

      {isLoading ? (
        <div className="subagent-empty">
          <Loader2 size={24} className="spin" />
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
        <div className="subagent-list">
          {filteredSubagents.map((subagent) => (
            <article key={subagent.id} className="skill-card" data-subagent-id={subagent.id}>
              <div className="skill-card-header">
                <div>
                  <h3 className="skill-card-title">{subagent.name}</h3>
                  <div className="skill-card-meta">
                    <span className="skill-card-badge">{subagent.directory}</span>
                    {subagent.repoOwner && subagent.repoName && (
                      <span className="skill-card-badge">
                        {subagent.repoOwner}/{subagent.repoName}
                      </span>
                    )}
                    {updatesMap[subagent.id] !== undefined && (
                      <span className="skill-update-badge">可更新</span>
                    )}
                  </div>
                </div>
                <div className="skill-card-actions">
                  {updatesMap[subagent.id] !== undefined && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => handleUpdateSubagent(subagent)}
                      disabled={pending}
                    >
                      <RefreshCw size={14} />
                      更新
                    </button>
                  )}
                  <button
                    type="button"
                    className="uninstall"
                    onClick={() => handleUninstall(subagent)}
                    disabled={pending}
                  >
                    <Trash2 size={14} />
                    卸载
                  </button>
                </div>
              </div>
              {subagent.description && <p className="skill-card-desc">{subagent.description}</p>}
              <AppToggleGroup
                apps={subagent.apps}
                onToggle={(app, enabled) => handleToggleApp(subagent.id, app, enabled)}
                disabled={pending || toggleAppMutation.isPending}
              />
            </article>
          ))}
        </div>
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

function BackupsDialog({
  backups,
  onRestore,
  onDelete,
  onClose,
}: {
  backups: SubagentBackupEntry[];
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
        aria-labelledby="subagent-backups-title"
      >
        <div className="skill-dialog-header">
          <h3 id="subagent-backups-title">Subagent 备份</h3>
        </div>
        <div className="skill-dialog-body">
          {backups.length === 0 ? (
            <p style={{ color: '#555', fontSize: 13 }}>暂无备份。</p>
          ) : (
            backups.map((backup) => (
              <div key={backup.backupId} className="skill-backup-item">
                <div className="skill-backup-item-info">
                  <div className="skill-backup-item-name">{backup.subagent.name}</div>
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
