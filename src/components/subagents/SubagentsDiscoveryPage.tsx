import { useMemo, useState } from 'react';
import { RefreshCw, Search, Settings } from 'lucide-react';
import type { AgentType, DiscoverableSubagent } from '../../types';
import {
  useDiscoverableSubagents,
  useInstalledSubagents,
  useSubagentRepos,
  useInstallSubagent,
  useAddSubagentRepo,
  useRemoveSubagentRepo,
} from '../../hooks/useSubagents';
import { SubagentCard } from './SubagentCard';
import { RepoManagerPanel } from './RepoManagerPanel';
import { toUserError } from '../../lib/errors';
import './subagents.css';

interface SubagentsDiscoveryPageProps {
  activeApp: AgentType;
}

type StatusFilter = 'all' | 'installed' | 'uninstalled';

export function SubagentsDiscoveryPage({ activeApp }: SubagentsDiscoveryPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRepo, setFilterRepo] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [repoManagerOpen, setRepoManagerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const {
    data: discoverableSubagents,
    isLoading: loadingDiscoverable,
    refetch: refetchDiscoverable,
  } = useDiscoverableSubagents();
  const { data: installedSubagents } = useInstalledSubagents();
  const { data: repos = [] } = useSubagentRepos();

  const installMutation = useInstallSubagent();
  const addRepoMutation = useAddSubagentRepo();
  const removeRepoMutation = useRemoveSubagentRepo();

  const installedKeys = useMemo(() => {
    if (installedSubagents === undefined) return new Set<string>();
    // 以完整身份 `{owner}/{repo}:{path}` 标记已安装：同仓库允许存在
    // a/reviewer.md 与 b/reviewer.md 这类 stem 相同的文件，不能按
    // directory+repo 折叠。
    return new Set(installedSubagents.map((s) => s.id.toLowerCase()));
  }, [installedSubagents]);

  type SubagentItem = DiscoverableSubagent & { installed: boolean };

  const subagents: SubagentItem[] = useMemo(() => {
    if (discoverableSubagents === undefined) return [];
    return discoverableSubagents.map((subagent) => ({
      ...subagent,
      installed: installedKeys.has(subagent.key.toLowerCase()),
    }));
  }, [discoverableSubagents, installedKeys]);

  const repoOptions = useMemo(() => {
    const repoSet = new Set<string>();
    subagents.forEach((s) => {
      if (s.repoOwner && s.repoName) {
        repoSet.add(`${s.repoOwner}/${s.repoName}`);
      }
    });
    return Array.from(repoSet).sort();
  }, [subagents]);

  const filteredSubagents = useMemo(() => {
    let result = subagents;
    if (filterRepo !== 'all') {
      result = result.filter((s) => `${s.repoOwner}/${s.repoName}` === filterRepo);
    }
    if (filterStatus === 'installed') {
      result = result.filter((s) => s.installed);
    } else if (filterStatus === 'uninstalled') {
      result = result.filter((s) => !s.installed);
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((s) => {
        const name = s.name.toLowerCase();
        const repo = `${s.repoOwner}/${s.repoName}`.toLowerCase();
        return name.includes(query) || repo.includes(query);
      });
    }
    return result;
  }, [subagents, filterRepo, filterStatus, searchQuery]);

  const handleInstall = async (key: string) => {
    const subagent = subagents.find((s) => s.key === key);
    if (subagent === undefined) return;
    setErrorMessage('');
    try {
      await installMutation.mutateAsync({ subagent, currentApp: activeApp });
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleUninstall = async (_key: string) => {
    // 发现面板不提供卸载；引导到已安装面板
  };

  const handleAddRepo = async (repo: Parameters<typeof addRepoMutation.mutateAsync>[0]) => {
    setErrorMessage('');
    try {
      await addRepoMutation.mutateAsync(repo);
      await refetchDiscoverable();
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
      throw error;
    }
  };

  const handleRemoveRepo = async (owner: string, name: string) => {
    setErrorMessage('');
    try {
      await removeRepoMutation.mutateAsync({ owner, name });
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  return (
    <section className="subagent-panel" aria-label="发现 Subagents">
      <div className="subagent-toolbar">
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            id="subagent-discovery-search"
            type="text"
            placeholder="搜索 subagent 名称或仓库"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{ paddingLeft: 28 }}
          />
        </div>
        <select value={filterRepo} onChange={(event) => setFilterRepo(event.target.value)}>
          <option value="all">全部仓库</option>
          {repoOptions.map((repo) => (
            <option key={repo} value={repo}>
              {repo}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(event) => setFilterStatus(event.target.value as StatusFilter)}
        >
          <option value="all">全部状态</option>
          <option value="installed">已安装</option>
          <option value="uninstalled">未安装</option>
        </select>
        <button type="button" onClick={() => refetchDiscoverable()}>
          <RefreshCw size={14} />
          刷新
        </button>
        <button type="button" onClick={() => setRepoManagerOpen(true)}>
          <Settings size={14} />
          仓库管理
        </button>
        {searchQuery && (
          <span style={{ fontSize: 13, color: '#555' }}>共 {filteredSubagents.length} 个结果</span>
        )}
      </div>

      {errorMessage && <div className="subagent-error">{errorMessage}</div>}

      {loadingDiscoverable ? (
        <div className="subagent-empty">
          <RefreshCw size={24} className="spin" />
          <p>正在加载…</p>
        </div>
      ) : subagents.length === 0 ? (
        <div className="subagent-empty">
          <h3>没有发现可安装的 Subagent</h3>
          <p>请添加仓库后点击刷新。</p>
          <button type="button" className="primary" onClick={() => setRepoManagerOpen(true)}>
            管理仓库
          </button>
        </div>
      ) : filteredSubagents.length === 0 ? (
        <div className="subagent-empty">
          <h3>没有匹配的 Subagent</h3>
          <p>请调整搜索或过滤条件。</p>
        </div>
      ) : (
        <div className="subagent-list">
          {filteredSubagents.map((subagent) => (
            <SubagentCard
              key={subagent.key}
              subagent={subagent}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
            />
          ))}
        </div>
      )}

      {repoManagerOpen && (
        <RepoManagerPanel
          repos={repos}
          subagents={discoverableSubagents ?? []}
          onAdd={handleAddRepo}
          onRemove={handleRemoveRepo}
          onClose={() => setRepoManagerOpen(false)}
        />
      )}
    </section>
  );
}
