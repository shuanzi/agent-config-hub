import { useRef, useState } from 'react';
import { Check, Copy, Folder, HardDrive, Link2, Loader2, Save } from 'lucide-react';
import type { AgentType, AppSettings, SyncMethod, StorageLocation } from '../../types';
import { useInstalledSkills } from '../../hooks/useSkills';
import {
  useMigrateStorage,
  useSetAgentOverrideDir,
  useSettings,
  useSetSyncMethod,
} from '../../hooks/useSettings';
import { toUserError } from '../../lib/errors';
import { AgentBrandMark } from '../workbench/AgentBrandMark';
import './settings.css';

const SYNC_OPTIONS: {
  value: SyncMethod;
  label: string;
  description: string;
  icon: typeof Link2;
}[] = [
  { value: 'auto', label: '自动', description: '优先链接，失败时复制', icon: Link2 },
  { value: 'symlink', label: '符号链接', description: '使用原始目录引用', icon: Link2 },
  { value: 'copy', label: '复制', description: '写入独立投影副本', icon: Copy },
];

const STORAGE_OPTIONS: { value: StorageLocation; label: string; description: string }[] = [
  { value: 'hub', label: 'Hub', description: '~/.agent-config-manager' },
  { value: 'unified', label: '统一目录', description: '~/.agents' },
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
  const syncMethodMutation = useSetSyncMethod();
  const migrateMutation = useMigrateStorage();
  const overrideMutation = useSetAgentOverrideDir();

  const [overrideDraft, setOverrideDraft] = useState<Partial<Record<OverrideKey, string>>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);
  const savingOverridesRef = useRef(false);
  const draft: AppSettings | null = settings ? { ...settings, ...overrideDraft } : null;
  const [pendingStorage, setPendingStorage] = useState<StorageLocation | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  if (settingsLoading || draft === null) {
    return (
      <div className="settings-view settings-view-loading" role="status">
        <Loader2 size={24} className="spin" aria-hidden="true" />
        <p>正在加载设置…</p>
      </div>
    );
  }

  const clearMessages = () => {
    setErrorMessage('');
    setSuccessMessage('');
  };

  // 同步方式是单字段保存路径：不提交整个 draft，避免把未保存的
  // 覆盖路径编辑一并持久化（storageLocation/覆盖字段由后端强制走专用命令）。
  const handleSyncChange = async (value: SyncMethod) => {
    clearMessages();
    try {
      await syncMethodMutation.mutateAsync(value);
      setSuccessMessage('同步方式已保存。');
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
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
    clearMessages();
    try {
      const result = await migrateMutation.mutateAsync(value);
      const totalMigrated = result.skill.migratedCount + result.subagent.migratedCount;
      const errors = [...result.skill.errors, ...result.subagent.errors];
      if (errors.length > 0) {
        setErrorMessage(`迁移完成 ${totalMigrated} 项，失败 ${errors.length} 项。`);
      } else {
        setSuccessMessage(`迁移完成 ${totalMigrated} 项。`);
      }
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleOverrideChange = (key: OverrideKey, value: string) => {
    setOverrideDraft((current) => ({ ...current, [key]: value }));
  };

  // 覆盖路径变更需要搬迁受管投影：逐个 Agent 调用专用命令
  // （set_settings_command 会在后端拒绝 storageLocation/覆盖字段的变更）。
  const handleSaveOverrides = async () => {
    if (savingOverridesRef.current) return;
    savingOverridesRef.current = true;
    setSavingOverrides(true);
    clearMessages();
    try {
      for (const { key, app } of AGENT_FIELDS) {
        const previous = settings?.[key] ?? null;
        const next = draft[key] || null;
        if (previous !== next) {
          await overrideMutation.mutateAsync({ app, dir: next });
        }
      }
      setOverrideDraft((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key, value]) => value !== draft[key as OverrideKey]),
        ),
      );
      setSuccessMessage('Agent 覆盖路径已保存。');
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    } finally {
      savingOverridesRef.current = false;
      setSavingOverrides(false);
    }
  };

  return (
    <div className="settings-view">
      <header className="settings-page-header">
        <div>
          <p>SETTINGS</p>
          <h2>设置</h2>
          <span>同步策略、数据目录与 Agent 覆盖路径</span>
        </div>
      </header>

      {errorMessage && (
        <div className="settings-error" role="alert">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="settings-success" role="status">
          {successMessage}
        </div>
      )}

      <section className="settings-section" aria-labelledby="sync-method-heading">
        <header className="settings-section-header">
          <span className="settings-section-icon" aria-hidden="true">
            <Link2 size={18} strokeWidth={1.8} />
          </span>
          <div>
            <h3 id="sync-method-heading">同步方式</h3>
            <p>选择后立即保存，并用于后续配置同步。</p>
          </div>
        </header>
        <div className="settings-options" role="group" aria-label="同步方式">
          {SYNC_OPTIONS.map(({ value, label, description, icon: Icon }) => {
            const selected = draft.syncMethod === value;
            return (
              <button
                key={value}
                type="button"
                className={selected ? 'settings-option active' : 'settings-option'}
                onClick={() => handleSyncChange(value)}
                disabled={syncMethodMutation.isPending}
                aria-pressed={selected}
                aria-label={label}
              >
                <Icon size={15} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                {selected && (
                  <Check size={15} className="settings-option-check" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
        {draft.syncMethod === 'auto' && (
          <p className="settings-hint">自动模式优先使用符号链接，失败时回退到复制。</p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="storage-heading">
        <header className="settings-section-header">
          <span className="settings-section-icon" aria-hidden="true">
            <HardDrive size={18} strokeWidth={1.8} />
          </span>
          <div>
            <h3 id="storage-heading">配置数据目录</h3>
            <p>Hub 与统一目录代表不同的数据归属，迁移会移动现有配置。</p>
          </div>
        </header>
        <div
          className="settings-options settings-storage-options"
          role="group"
          aria-label="配置数据目录"
        >
          {STORAGE_OPTIONS.map(({ value, label, description }) => {
            const selected = draft.storageLocation === value;
            return (
              <button
                key={value}
                type="button"
                className={selected ? 'settings-option active' : 'settings-option'}
                onClick={() => handleStorageSelect(value)}
                disabled={migrateMutation.isPending || syncMethodMutation.isPending}
                aria-pressed={selected}
                aria-label={label}
              >
                <HardDrive size={15} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                {selected && (
                  <Check size={15} className="settings-option-check" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
        {pendingStorage !== null && (
          <div className="settings-migrate-confirm" aria-live="polite">
            <p>
              当前已安装 {installedSkills?.length ?? 0} 个
              Skill，切换到新位置会移动全部文件并重建投影。是否继续？
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

      <section className="settings-section" aria-labelledby="agent-override-heading">
        <header className="settings-section-header">
          <span className="settings-section-icon" aria-hidden="true">
            <Folder size={18} strokeWidth={1.8} />
          </span>
          <div>
            <h3 id="agent-override-heading">Agent 配置目录覆盖</h3>
            <p>为空时使用默认路径；设置后该 Agent 的技能、Subagent、指令文件均以此目录为基准。</p>
          </div>
        </header>
        <div className="settings-override-grid">
          {AGENT_FIELDS.map(({ key, label, app }) => (
            <div key={key} className="settings-override-row">
              <label htmlFor={key}>
                <AgentBrandMark app={app} size={17} />
                {label}
              </label>
              <input
                id={key}
                type="text"
                placeholder="默认路径"
                value={draft[key] ?? ''}
                onChange={(event) => handleOverrideChange(key, event.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="settings-actions settings-save-actions">
          <button
            type="button"
            className="primary"
            onClick={handleSaveOverrides}
            disabled={syncMethodMutation.isPending || savingOverrides}
          >
            {savingOverrides ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <Save size={15} aria-hidden="true" />
            )}
            保存覆盖路径
          </button>
        </div>
      </section>
    </div>
  );
}
