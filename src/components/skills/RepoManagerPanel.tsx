import { useRef, useState } from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import type { DiscoverableSkill, SkillRepo } from '../../types';
import { FocusedDialog } from '../workbench/FocusedDialog';

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
  if (parts.length === 2 && parts[0] && parts[1]) return { owner: parts[0], name: parts[1] };
  return null;
}

export function RepoManagerPanel({
  repos,
  skills,
  onAdd,
  onRemove,
  onClose,
}: RepoManagerPanelProps) {
  const repoUrlRef = useRef<HTMLInputElement>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const getSkillCount = (repo: SkillRepo) =>
    skills.filter(
      (skill) =>
        skill.repoOwner === repo.owner &&
        skill.repoName === repo.name &&
        (skill.repoBranch || 'main') === (repo.branch || 'main'),
    ).length;

  const handleAdd = async () => {
    setError('');
    setStatus('');
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
      setStatus(`已添加 ${parsed.owner}/${parsed.name}。`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '添加仓库失败');
    }
  };

  return (
    <FocusedDialog
      open
      title="Skill 仓库管理"
      onClose={onClose}
      initialFocusRef={repoUrlRef}
      closeLabel="关闭 Skill 仓库管理对话框"
      className="skill-dialog"
      footer={
        <button type="button" className="skill-button" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="skill-repo-form">
        <label htmlFor="repo-url">GitHub 仓库 URL</label>
        <input
          ref={repoUrlRef}
          id="repo-url"
          type="text"
          placeholder="https://github.com/owner/name"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
        />
        <label htmlFor="repo-branch">分支（默认 main）</label>
        <input
          id="repo-branch"
          type="text"
          placeholder="main"
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
        />
        {error && (
          <p className="skill-dialog-error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="skill-dialog-status" role="status">
            {status}
          </p>
        )}
        <button type="button" className="skill-button primary" onClick={() => void handleAdd()}>
          <Plus size={15} />
          添加仓库
        </button>
      </div>

      <section className="skill-repo-list" aria-labelledby="configured-skill-repos">
        <h3 id="configured-skill-repos">已配置仓库</h3>
        {repos.length === 0 ? (
          <p className="skill-dialog-empty">暂无仓库，请添加一个 GitHub 仓库。</p>
        ) : (
          repos.map((repo) => (
            <div key={`${repo.owner}/${repo.name}`} className="skill-backup-item">
              <div className="skill-backup-item-info">
                <div className="skill-backup-item-name">
                  {repo.owner}/{repo.name}
                </div>
                <div className="skill-backup-item-path">
                  分支：{repo.branch || 'main'} · 发现 {getSkillCount(repo)} 个 Skill
                </div>
              </div>
              <div className="skill-backup-actions">
                <a
                  className="skill-icon-button"
                  href={`https://github.com/${repo.owner}/${repo.name}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`打开 ${repo.owner}/${repo.name}`}
                  title="在 GitHub 中打开"
                >
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
                <button
                  type="button"
                  className="skill-icon-button is-danger"
                  onClick={() => void onRemove(repo.owner, repo.name)}
                  aria-label={`移除 ${repo.owner}/${repo.name}`}
                  title="移除仓库"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </FocusedDialog>
  );
}
