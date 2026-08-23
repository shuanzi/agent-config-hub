import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AgentType, AppSettings, SyncMethod, StorageLocation } from '../../types';
import { useInstalledSkills } from '../../hooks/useSkills';
import {
  useMigrateStorage,
  useSetAgentOverrideDir,
  useSettings,
  useSetSettings,
} from '../../hooks/useSettings';
import { toUserError } from '../../lib/errors';
import './settings.css';

const SYNC_OPTIONS: { value: SyncMethod; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'symlink', label: '符号链接' },
  { value: 'copy', label: '复制' },
];

const STORAGE_OPTIONS: { value: StorageLocation; label: string }[] = [
  { value: 'hub', label: 'Hub（~/.agent-config-manager）' },
  { value: 'unified', label: '统一目录（~/.agents）' },
];

type OverrideKey =
  'claudeCodeConfigDir' | 'codexConfigDir' | 'geminiCliConfigDir' | 'opencodeConfigDir';

const AGENT_FIELDS: { key: OverrideKey; label: string; app: AgentType }[] = [
  { key: 'claudeCodeConfigDir', label: 'Claude Code', app: 'claude-code' },
  { key: 'codexConfigDir', label: 'Codex', app: 'codex' },
  { key: 'geminiCliConfigDir', label: 'Gemini CLI', app: 'gemini-cli' },
  { key: 'opencodeConfigDir', label: 'OpenCode', app: 'opencode' },
];

export function SettingsView() {
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: installedSkills } = useInstalledSkills();
  const setSettingsMutation = useSetSettings();
  const migrateMutation = useMigrateStorage();
  const overrideMutation = useSetAgentOverrideDir();

  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [pendingStorage, setPendingStorage] = useState<StorageLocation | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (settings !== undefined) {
      setDraft(settings);
    }
  }, [settings]);

  if (settingsLoading || draft === null) {
    return (
      <div className="settings-view">
        <Loader2 size={24} className="spin" />
        <p>正在加载设置…</p>
      </div>
    );
  }

  const save = async (next: AppSettings) => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await setSettingsMutation.mutateAsync(next);
      setSuccessMessage('设置已保存。');
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleSyncChange = (value: SyncMethod) => {
    const next = { ...draft, syncMethod: value };
    setDraft(next);
    void save(next);
  };

  const handleStorageSelect = (value: StorageLocation) => {
    if (value === draft.storageLocation) return;
    if ((installedSkills?.length ?? 0) > 0) {
      setPendingStorage(value);
    } else {
      void doMigrate(value);
    }
  };

  const doMigrate = async (value: StorageLocation) => {
    setPendingStorage(null);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await migrateMutation.mutateAsync(value);
      const totalMigrated = result.skill.migratedCount + result.subagent.migratedCount;
      const errors = [...result.skill.errors, ...result.subagent.errors];
      if (errors.length > 0) {
        setErrorMessage(`迁移完成 ${totalMigrated} 项，失败 ${errors.length} 项。`);
      } else if (result.projectionErrors.length > 0) {
        setErrorMessage(
          `迁移完成 ${totalMigrated} 项，但部分 Agent 投影重建失败：${result.projectionErrors.join('；')}`,
        );
      } else {
        setSuccessMessage(`迁移完成 ${totalMigrated} 项。`);
      }
      const next = { ...draft, storageLocation: value };
      setDraft(next);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleOverrideChange = (key: OverrideKey, value: string) => {
    const next = { ...draft, [key]: value || undefined };
    setDraft(next);
  };

  // 覆盖路径变更需要搬迁受管投影：逐个 Agent 调用专用命令，
  // 而不是仅持久化设置（其余字段仍走 set_settings_command）。
  const handleSaveOverrides = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      for (const { key, app } of AGENT_FIELDS) {
        const previous = settings?.[key] ?? null;
        const next = draft[key] ?? null;
        if (previous !== next) {
          await overrideMutation.mutateAsync({ app, dir: next });
        }
      }
      setSuccessMessage('设置已保存。');
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  return (
    <div className="settings-view">
      <section className="settings-section">
        <h3>同步方式</h3>
        <p>决定 Skill 与 Subagent 投影到各 Agent 目录时使用符号链接还是实体复制。</p>
        <div className="settings-options">
          {SYNC_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                draft.syncMethod === option.value ? 'settings-option active' : 'settings-option'
              }
              onClick={() => handleSyncChange(option.value)}
              disabled={setSettingsMutation.isPending}
            >
              {option.label}
            </button>
          ))}
        </div>
        {draft.syncMethod === 'auto' && (
          <p style={{ marginTop: 8 }}>自动模式优先使用符号链接，失败时回退到复制。</p>
        )}
      </section>

      <section className="settings-section">
        <h3>SSOT 存储位置</h3>
        <p>切换 Skill 单一事实源（SSOT）的根目录。切换将触发迁移。</p>
        <div className="settings-options">
          {STORAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                draft.storageLocation === option.value
                  ? 'settings-option active'
                  : 'settings-option'
              }
              onClick={() => handleStorageSelect(option.value)}
              disabled={migrateMutation.isPending || setSettingsMutation.isPending}
            >
              {option.label}
            </button>
          ))}
        </div>
        {pendingStorage !== null && (
          <div className="settings-migrate-confirm">
            <p>
              当前已安装 {installedSkills?.length ?? 0} 个
              Skill，切换到新位置会移动全部文件并重建投影。 是否继续？
            </p>
            <div className="settings-actions">
              <button type="button" onClick={() => setPendingStorage(null)}>
                取消
              </button>
              <button type="button" className="primary" onClick={() => doMigrate(pendingStorage)}>
                确认迁移
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h3>Agent 配置目录覆盖</h3>
        <p>为空时使用默认路径；设置后该 Agent 的技能、subagent、指令文件均以此目录为基准。</p>
        <div className="settings-override-grid">
          {AGENT_FIELDS.map(({ key, label }) => (
            <>
              <label htmlFor={key}>{label}</label>
              <input
                id={key}
                type="text"
                placeholder="默认路径"
                value={draft[key] ?? ''}
                onChange={(event) => handleOverrideChange(key, event.target.value)}
              />
            </>
          ))}
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="primary"
            onClick={handleSaveOverrides}
            disabled={setSettingsMutation.isPending || overrideMutation.isPending}
          >
            {overrideMutation.isPending ? <Loader2 size={14} className="spin" /> : null}
            保存覆盖路径
          </button>
        </div>
      </section>

      {errorMessage && <div className="settings-error">{errorMessage}</div>}
      {successMessage && <div className="settings-success">{successMessage}</div>}
    </div>
  );
}
