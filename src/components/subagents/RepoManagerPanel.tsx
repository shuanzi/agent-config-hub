import { useRef, useState } from 'react';
import { ExternalLink, Trash2, Plus } from 'lucide-react';
import type { DiscoverableSubagent, SubagentRepo } from '../../types';
import { FocusedDialog } from '../workbench/FocusedDialog';

interface RepoManagerPanelProps {
  repos: SubagentRepo[];
  subagents: DiscoverableSubagent[];
  onAdd: (repo: SubagentRepo) => Promise<void>;
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
  subagents,
  onAdd,
  onRemove,
  onClose,
}: RepoManagerPanelProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const repoUrlRef = useRef<HTMLInputElement>(null);

  const getSubagentCount = (repo: SubagentRepo) =>
    subagents.filter(
      (subagent) =>
        subagent.repoOwner === repo.owner &&
        subagent.repoName === repo.name &&
        (subagent.repoBranch || 'main') === (repo.branch || 'main'),
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
    <FocusedDialog
      open
      title="Subagent 仓库管理"
      onClose={onClose}
      initialFocusRef={repoUrlRef}
      footer={
        <button type="button" className="subagent-button" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="subagent-repo-manager" data-subagent-repo-manager>
        <div className="subagent-repo-form">
          <label htmlFor="subagent-repo-url">GitHub 仓库 URL</label>
          <input
            ref={repoUrlRef}
            id="subagent-repo-url"
            type="text"
            placeholder="https://github.com/owner/name"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
          />
          <label htmlFor="subagent-repo-branch">分支（默认 main）</label>
          <input
            id="subagent-repo-branch"
            type="text"
            placeholder="main"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
          {error && (
            <p className="subagent-dialog-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="subagent-button is-primary" onClick={handleAdd}>
            <Plus size={14} aria-hidden="true" />
            添加仓库
          </button>
        </div>

        <h3 className="subagent-dialog-section-title">已配置仓库</h3>
        {repos.length === 0 ? (
          <p className="subagent-dialog-empty">暂无仓库，请添加一个 GitHub 仓库。</p>
        ) : (
          <div className="subagent-repo-list">
            {repos.map((repo) => {
              const repoName = `${repo.owner}/${repo.name}`;
              return (
                <div key={repoName} className="subagent-repo-row">
                  <div>
                    <strong>{repoName}</strong>
                    <span>
                      分支：{repo.branch || 'main'} · 发现 {getSubagentCount(repo)} 个 Subagent
                    </span>
                  </div>
                  <div className="subagent-repo-row-actions">
                    <a
                      href={`https://github.com/${repo.owner}/${repo.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="subagent-icon-button"
                      aria-label={`打开 ${repoName} 的 GitHub 仓库`}
                    >
                      <ExternalLink size={15} aria-hidden="true" />
                    </a>
                    <button
                      type="button"
                      className="subagent-icon-button is-danger"
                      onClick={() => onRemove(repo.owner, repo.name)}
                      aria-label={`移除 ${repoName}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FocusedDialog>
  );
}
