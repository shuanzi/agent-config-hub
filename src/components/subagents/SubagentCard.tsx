import { useState } from 'react';
import { ExternalLink, Download, Trash2, Loader2 } from 'lucide-react';
import type { DiscoverableSubagent } from '../../types';

export type SubagentCardSubagent = DiscoverableSubagent & { installed?: boolean };

interface SubagentCardProps {
  subagent: SubagentCardSubagent;
  onInstall: (key: string) => Promise<void>;
  onUninstall: (key: string) => Promise<void>;
}

export function SubagentCard({ subagent, onInstall, onUninstall }: SubagentCardProps) {
  const [loading, setLoading] = useState(false);

  const handleInstall = async () => {
    setLoading(true);
    try {
      await onInstall(subagent.key);
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async () => {
    setLoading(true);
    try {
      await onUninstall(subagent.key);
    } finally {
      setLoading(false);
    }
  };

  return (
    <article className="skill-card" data-subagent-key={subagent.key}>
      <div className="skill-card-header">
        <div>
          <h3 className="skill-card-title">{subagent.name}</h3>
          <div className="skill-card-meta">
            {subagent.path !== subagent.name && (
              <span className="skill-card-badge">{subagent.path}</span>
            )}
            <span className="skill-card-badge">
              {subagent.repoOwner}/{subagent.repoName}
            </span>
            {subagent.installed && (
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
      {subagent.description && <p className="skill-card-desc">{subagent.description}</p>}
      <div className="skill-card-actions">
        {subagent.readmeUrl ? (
          <a
            className="skill-card-badge"
            href={subagent.readmeUrl}
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
        {subagent.installed ? (
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
