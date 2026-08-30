import { useState } from 'react';
import { Download, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import type { DiscoverableSkill } from '../../types';

export type SkillCardSkill = DiscoverableSkill & {
  installed: boolean;
  installedId: string | null;
};

interface SkillCardProps {
  skill: SkillCardSkill;
  onInstall: (key: string) => void | Promise<void>;
  onUninstall: (key: string) => void;
  onSelect: (key: string) => void;
  selected?: boolean;
  uninstallPending?: boolean;
}

/**
 * 发现列表的一行。选择和安装是两个独立操作，避免将完整 DTO 放进本地选择态。
 */
export function SkillCard({
  skill,
  onInstall,
  onUninstall,
  onSelect,
  selected = false,
  uninstallPending = false,
}: SkillCardProps) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstall(skill.key);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <article
      role="listitem"
      className={selected ? 'skill-row skill-card is-selected' : 'skill-row skill-card'}
      data-skill-key={skill.key}
    >
      <button
        type="button"
        className="skill-row-select"
        onClick={() => onSelect(skill.key)}
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
          <span>
            {skill.repoOwner}/{skill.repoName}
          </span>
        </span>
      </button>

      <div className="skill-row-actions" aria-label={`${skill.name} 操作`}>
        {skill.installed && <span className="skill-status-badge">已安装</span>}
        {skill.readmeUrl && (
          <a
            className="skill-icon-button"
            href={skill.readmeUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`打开 ${skill.name} 的 README`}
            title="打开 README"
          >
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        )}
        {skill.installed ? (
          <button
            type="button"
            className="skill-button danger uninstall"
            onClick={() => onUninstall(skill.key)}
            disabled={installing || uninstallPending}
          >
            {uninstallPending ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            {uninstallPending ? '卸载中…' : '卸载'}
          </button>
        ) : (
          <button
            type="button"
            className="skill-button primary install"
            onClick={handleInstall}
            disabled={installing}
          >
            {installing ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {installing ? '安装中…' : '安装'}
          </button>
        )}
      </div>
    </article>
  );
}
