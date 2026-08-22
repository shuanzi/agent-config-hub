import { useState } from 'react';
import { ExternalLink, Download, Trash2, Loader2 } from 'lucide-react';
import type { DiscoverableSkill } from '../../types';

export type SkillCardSkill = DiscoverableSkill & { installed?: boolean };

interface SkillCardProps {
  skill: SkillCardSkill;
  onInstall: (key: string) => Promise<void>;
  onUninstall: (key: string) => Promise<void>;
}

export function SkillCard({ skill, onInstall, onUninstall }: SkillCardProps) {
  const [loading, setLoading] = useState(false);

  const handleInstall = async () => {
    setLoading(true);
    try {
      await onInstall(skill.key);
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async () => {
    setLoading(true);
    try {
      await onUninstall(skill.key);
    } finally {
      setLoading(false);
    }
  };

  return (
    <article className="skill-card" data-skill-key={skill.key}>
      <div className="skill-card-header">
        <div>
          <h3 className="skill-card-title">{skill.name}</h3>
          <div className="skill-card-meta">
            {skill.directory !== skill.name && (
              <span className="skill-card-badge">{skill.directory}</span>
            )}
            <span className="skill-card-badge">
              {skill.repoOwner}/{skill.repoName}
            </span>
            {skill.installed && (
              <span
                className="skill-card-badge"
                style={{ background: '#e6f4ea', borderColor: '#b7dfb9', color: '#1e8e3e' }}
              >
                已安装
              </span>
            )}
          </div>
        </div>
      </div>
      {skill.description && <p className="skill-card-desc">{skill.description}</p>}
      <div className="skill-card-actions">
        {skill.readmeUrl ? (
          <a
            className="skill-card-badge"
            href={skill.readmeUrl}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <ExternalLink size={12} />
            README
          </a>
        ) : (
          <span className="skill-card-badge">README</span>
        )}
        {skill.installed ? (
          <button type="button" className="uninstall" onClick={handleUninstall} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            {loading ? '卸载中…' : '卸载'}
          </button>
        ) : (
          <button type="button" className="install" onClick={handleInstall} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {loading ? '安装中…' : '安装'}
          </button>
        )}
      </div>
    </article>
  );
}
