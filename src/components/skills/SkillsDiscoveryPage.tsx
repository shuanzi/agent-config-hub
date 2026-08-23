import { useMemo, useState } from 'react';
import { RefreshCw, Search, Settings } from 'lucide-react';
import type { AgentType, DiscoverableSkill } from '../../types';
import { useDiscoverableSkills, useInstalledSkills, useSkillRepos } from '../../hooks/useSkills';
import { SkillCard } from './SkillCard';
import { RepoManagerPanel } from './RepoManagerPanel';
import {
  useInstallSkill,
  useUninstallSkill,
  useAddSkillRepo,
  useRemoveSkillRepo,
} from '../../hooks/useSkills';
import { toUserError } from '../../lib/errors';

interface SkillsDiscoveryPageProps {
  activeApp: AgentType;
}

type StatusFilter = 'all' | 'installed' | 'uninstalled';

export function SkillsDiscoveryPage({ activeApp }: SkillsDiscoveryPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRepo, setFilterRepo] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [repoManagerOpen, setRepoManagerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const {
    data: discoverableSkills,
    isLoading: loadingDiscoverable,
    refetch: refetchDiscoverable,
  } = useDiscoverableSkills();
  const { data: installedSkills } = useInstalledSkills();
  const { data: repos = [] } = useSkillRepos();

  const installMutation = useInstallSkill();
  const uninstallMutation = useUninstallSkill();
  const addRepoMutation = useAddSkillRepo();
  const removeRepoMutation = useRemoveSkillRepo();

  const installedIdsByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of installedSkills ?? []) {
      const owner = s.repoOwner?.toLowerCase() ?? '';
      const name = s.repoName?.toLowerCase() ?? '';
      map.set(`${s.directory.toLowerCase()}:${owner}:${name}`, s.id);
    }
    return map;
  }, [installedSkills]);

  type SkillItem = DiscoverableSkill & { installed: boolean; installedId: string | null };

  const skills: SkillItem[] = useMemo(() => {
    if (discoverableSkills === undefined) return [];
    return discoverableSkills.map((skill) => {
      const installName =
        skill.directory.split(/[/\\]/).pop()?.toLowerCase() ?? skill.directory.toLowerCase();
      const key = `${installName}:${skill.repoOwner.toLowerCase()}:${skill.repoName.toLowerCase()}`;
      const installedId = installedIdsByKey.get(key) ?? null;
      return { ...skill, installed: installedId !== null, installedId };
    });
  }, [discoverableSkills, installedIdsByKey]);

  const repoOptions = useMemo(() => {
    const repoSet = new Set<string>();
    skills.forEach((s) => {
      if (s.repoOwner && s.repoName) {
        repoSet.add(`${s.repoOwner}/${s.repoName}`);
      }
    });
    return Array.from(repoSet).sort();
  }, [skills]);

  const filteredSkills = useMemo(() => {
    let result = skills;
    if (filterRepo !== 'all') {
      result = result.filter((skill) => `${skill.repoOwner}/${skill.repoName}` === filterRepo);
    }
    if (filterStatus === 'installed') {
      result = result.filter((skill) => skill.installed);
    } else if (filterStatus === 'uninstalled') {
      result = result.filter((skill) => !skill.installed);
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((skill) => {
        const name = skill.name.toLowerCase();
        const repo = `${skill.repoOwner}/${skill.repoName}`.toLowerCase();
        return name.includes(query) || repo.includes(query);
      });
    }
    return result;
  }, [skills, filterRepo, filterStatus, searchQuery]);

  const handleInstall = async (key: string) => {
    const skill = skills.find((s) => s.key === key);
    if (skill === undefined) return;
    setErrorMessage('');
    try {
      await installMutation.mutateAsync({ skill, currentApp: activeApp });
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleUninstall = async (key: string) => {
    const skill = skills.find((s) => s.key === key);
    if (skill === undefined || skill.installedId === null) return;
    setErrorMessage('');
    try {
      await uninstallMutation.mutateAsync(skill.installedId);
      setErrorMessage(`已卸载 ${skill.name}。`);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
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
    <section className="skill-panel" aria-label="发现 Skills">
      <div className="skill-toolbar">
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            id="skill-discovery-search"
            type="text"
            placeholder="搜索 skill 名称或仓库"
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
          <span style={{ fontSize: 13, color: '#555' }}>共 {filteredSkills.length} 个结果</span>
        )}
      </div>

      {errorMessage && <div className="skill-error">{errorMessage}</div>}

      {loadingDiscoverable ? (
        <div className="skill-empty">
          <RefreshCw size={24} className="spin" />
          <p>正在加载…</p>
        </div>
      ) : skills.length === 0 ? (
        <div className="skill-empty">
          <h3>没有发现可安装的 Skill</h3>
          <p>请添加仓库后点击刷新。</p>
          <button type="button" className="primary" onClick={() => setRepoManagerOpen(true)}>
            管理仓库
          </button>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="skill-empty">
          <h3>没有匹配的 Skill</h3>
          <p>请调整搜索或过滤条件。</p>
        </div>
      ) : (
        <div className="skill-list">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.key}
              skill={skill}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
            />
          ))}
        </div>
      )}

      {repoManagerOpen && (
        <RepoManagerPanel
          repos={repos}
          skills={discoverableSkills ?? []}
          onAdd={handleAddRepo}
          onRemove={handleRemoveRepo}
          onClose={() => setRepoManagerOpen(false)}
        />
      )}
    </section>
  );
}
