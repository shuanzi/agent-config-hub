import { useState } from 'react';
import { ExternalLink, Trash2, Plus } from 'lucide-react';
import type { DiscoverableSkill, SkillRepo } from '../../types';

interface RepoManagerPanelProps {
  repos: SkillRepo[];
  skills: DiscoverableSkill[];
  onAdd: (repo: SkillRepo) => Promise<void>;
  onRemove: (owner: string, name: string) => Promise<void>;
  onClose: () => void;
}

function parseRepoUrl(url: string): { owner: string; name: string } | null {
  let cleaned = url.trim();
  cleaned = cleaned.replace(/^https?:\/\/github\.com\//, '');
  cleaned = cleaned.replace(/\.git$/, '');
  const parts = cleaned.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], name: parts[1] };
  }
  return null;
}

export function RepoManagerPanel({
  repos,
  skills,
  onAdd,
  onRemove,
  onClose,
}: RepoManagerPanelProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');

  const getSkillCount = (repo: SkillRepo) =>
    skills.filter(
      (skill) =>
        skill.repoOwner === repo.owner &&
        skill.repoName === repo.name &&
        (skill.repoBranch || 'main') === (repo.branch || 'main'),
    ).length;

  const handleAdd = async () => {
    setError('');
    const parsed = parseRepoUrl(repoUrl);
    if (parsed === null) {
      setError('请输入有效的 GitHub 仓库 URL，格式如 https://github.com/owner/name');
      return;
    }
    try {
      await onAdd({
        owner: parsed.owner,
        name: parsed.name,
        branch: branch || 'main',
        enabled: true,
      });
      setRepoUrl('');
      setBranch('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '添加仓库失败');
    }
  };

  return (
    <div className="skill-dialog-overlay" onClick={onClose}>
      <div
        className="skill-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-manager-title"
      >
        <div className="skill-dialog-header">
          <h3 id="repo-manager-title">Skill 仓库管理</h3>
        </div>
        <div className="skill-dialog-body">
          <div className="skill-import-item-info" style={{ marginBottom: 16 }}>
            <label htmlFor="repo-url" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
              GitHub 仓库 URL
            </label>
            <input
              id="repo-url"
              type="text"
              placeholder="https://github.com/owner/name"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              style={{
                width: '100%',
                padding: 6,
                border: '1px solid var(--border)',
                borderRadius: 4,
              }}
            />
            <label
              htmlFor="repo-branch"
              style={{ display: 'block', fontSize: 13, marginTop: 12, marginBottom: 4 }}
            >
              分支（默认 main）
            </label>
            <input
              id="repo-branch"
              type="text"
              placeholder="main"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              style={{
                width: '100%',
                padding: 6,
                border: '1px solid var(--border)',
                borderRadius: 4,
              }}
            />
            {error && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{error}</p>}
            <button type="button" className="primary" onClick={handleAdd} style={{ marginTop: 12 }}>
              <Plus size={14} />
              添加仓库
            </button>
          </div>

          <h4 style={{ fontSize: 14, margin: '16px 0 8px' }}>已配置仓库</h4>
          {repos.length === 0 ? (
            <p style={{ color: '#555', fontSize: 13 }}>暂无仓库，请添加一个 GitHub 仓库。</p>
          ) : (
            <div>
              {repos.map((repo) => (
                <div key={`${repo.owner}/${repo.name}`} className="skill-backup-item">
                  <div className="skill-backup-item-info">
                    <div className="skill-backup-item-name">
                      {repo.owner}/{repo.name}
                    </div>
                    <div className="skill-backup-item-path">
                      分支：{repo.branch || 'main'} · 发现 {getSkillCount(repo)} 个 skill
                    </div>
                  </div>
                  <div className="skill-backup-actions">
                    <a
                      href={`https://github.com/${repo.owner}/${repo.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="skill-card-badge"
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <ExternalLink size={12} />
                    </a>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onRemove(repo.owner, repo.name)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
