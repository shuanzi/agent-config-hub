import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import type {
  AgentType,
  ConfigContext,
  InstalledSkill,
  ProjectSummary,
  ScopeTarget,
} from '../../types';
import {
  useAddSkillRepo,
  useDiscoverableSkills,
  useInstallSkill,
  useInstalledSkills,
  useRemoveSkillRepo,
  useSkillRepos,
  useUninstallSkill,
} from '../../hooks/useSkills';
import { toUserError } from '../../lib/errors';
import { FocusedDialog } from '../workbench/FocusedDialog';
import { RepoManagerPanel } from './RepoManagerPanel';
import { SkillCard, type SkillCardSkill } from './SkillCard';
import './skills.css';

interface SkillsDiscoveryPageProps {
  activeApp: AgentType;
  context: ConfigContext;
  projects: readonly ProjectSummary[];
}

type StatusFilter = 'all' | 'installed' | 'uninstalled';

function targetForContext(context: ConfigContext): ScopeTarget | null {
  if (context.kind === 'global') return { scope: 'global' };
  if (context.kind === 'project') return { scope: 'project', projectId: context.projectId };
  return null;
}

function contextKey(context: ConfigContext): string {
  return context.kind === 'project' ? `project:${context.projectId}` : context.kind;
}

function sameTarget(left: ScopeTarget, right: ScopeTarget): boolean {
  return (
    left.scope === right.scope &&
    (left.scope !== 'project' || (right.scope === 'project' && left.projectId === right.projectId))
  );
}

function targetValue(target: ScopeTarget | null): string {
  if (target === null) return '';
  return target.scope === 'global' ? 'global' : `project:${target.projectId}`;
}

function targetFromValue(value: string): ScopeTarget | null {
  if (value === 'global') return { scope: 'global' };
  return value.startsWith('project:') ? { scope: 'project', projectId: value.slice(8) } : null;
}

function DiscoverySkillDetail({
  skill,
  pending,
  onBack,
  backButtonRef,
  onInstall,
  onUninstall,
}: {
  skill: SkillCardSkill;
  pending: boolean;
  onBack: () => void;
  backButtonRef: RefObject<HTMLButtonElement>;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  return (
    <section
      className="skill-detail"
      data-skill-detail={skill.key}
      aria-label={`${skill.name} 详情`}
    >
      <div className="skill-detail-header">
        <button ref={backButtonRef} type="button" className="skill-back-button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回列表
        </button>
        <div className="skill-detail-heading">
          <div className="skill-detail-title-line">
            <h2>{skill.name}</h2>
            {skill.installed && <span className="skill-status-badge">已安装</span>}
          </div>
          <p>{skill.description}</p>
        </div>
        <div className="skill-detail-actions">
          {skill.readmeUrl && (
            <a className="skill-button" href={skill.readmeUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden="true" />
              README
            </a>
          )}
          {skill.installed ? (
            <button
              type="button"
              className="skill-button danger"
              onClick={onUninstall}
              disabled={pending}
            >
              <Trash2 size={15} aria-hidden="true" />
              卸载
            </button>
          ) : (
            <button
              type="button"
              className="skill-button primary"
              onClick={onInstall}
              disabled={pending}
            >
              {pending ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
              {pending ? '安装中…' : '安装'}
            </button>
          )}
        </div>
      </div>

      <dl className="skill-detail-grid">
        <div>
          <dt>目录</dt>
          <dd>
            <code>{skill.directory}</code>
          </dd>
        </div>
        <div>
          <dt>仓库</dt>
          <dd>
            {skill.repoOwner}/{skill.repoName}
          </dd>
        </div>
        <div>
          <dt>分支</dt>
          <dd>{skill.repoBranch}</dd>
        </div>
        <div>
          <dt>发现标识</dt>
          <dd>
            <code>{skill.key}</code>
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function SkillsDiscoveryPage({ activeApp, context, projects }: SkillsDiscoveryPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRepo, setFilterRepo] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [repoManagerOpen, setRepoManagerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledSkill | null>(null);
  const [allDiscoveryTarget, setAllDiscoveryTarget] = useState<ScopeTarget | null>(null);
  const detailBackButtonRef = useRef<HTMLButtonElement>(null);
  const detailReturnFocusKeyRef = useRef<string | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousContextKeyRef = useRef(contextKey(context));
  const scopedTarget = targetForContext(context);
  const discoveryTarget = scopedTarget ?? allDiscoveryTarget;
  const previousDiscoveryTargetRef = useRef(targetValue(discoveryTarget));

  const {
    data: discoverableSkills,
    isLoading: loadingDiscoverable,
    refetch: refetchDiscoverable,
  } = useDiscoverableSkills(discoveryTarget, activeApp);
  const { data: installedSkills } = useInstalledSkills(context, activeApp);
  const { data: repos = [] } = useSkillRepos();
  const installMutation = useInstallSkill();
  const uninstallMutation = useUninstallSkill();
  const addRepoMutation = useAddSkillRepo();
  const removeRepoMutation = useRemoveSkillRepo();

  const installedIdsByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const skill of installedSkills ?? []) {
      if (discoveryTarget === null || !sameTarget(skill.target, discoveryTarget)) continue;
      map.set(skill.id.toLowerCase(), skill.id);
      if (skill.readmeUrl) map.set(`readme:${skill.readmeUrl.toLowerCase()}`, skill.id);
    }
    return map;
  }, [discoveryTarget, installedSkills]);

  const skills = useMemo<SkillCardSkill[]>(() => {
    if (discoverableSkills === undefined) return [];
    return discoverableSkills.map((skill) => {
      const installedId =
        installedIdsByKey.get(skill.key.toLowerCase()) ??
        (skill.readmeUrl
          ? installedIdsByKey.get(`readme:${skill.readmeUrl.toLowerCase()}`)
          : null) ??
        null;
      return { ...skill, installed: skill.installed, installedId };
    });
  }, [discoverableSkills, installedIdsByKey]);

  const repoOptions = useMemo(() => {
    const repoSet = new Set<string>();
    for (const skill of skills) repoSet.add(`${skill.repoOwner}/${skill.repoName}`);
    return [...repoSet].sort();
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
    if (!query) return result;
    return result.filter((skill) => {
      const values = [skill.name, skill.directory, skill.repoOwner, skill.repoName];
      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [filterRepo, filterStatus, searchQuery, skills]);

  const selectedSkill =
    selectedSkillKey === null
      ? null
      : (filteredSkills.find((skill) => skill.key === selectedSkillKey) ?? null);
  useEffect(() => {
    if (selectedSkillKey !== null && selectedSkill === null) setSelectedSkillKey(null);
  }, [selectedSkill, selectedSkillKey]);

  useEffect(() => {
    if (
      uninstallTarget !== null &&
      !(installedSkills ?? []).some(
        (skill) =>
          skill.id === uninstallTarget.id && sameTarget(skill.target, uninstallTarget.target),
      )
    ) {
      setUninstallTarget(null);
    }
  }, [installedSkills, uninstallTarget]);

  useEffect(() => {
    if (selectedSkillKey !== null) detailBackButtonRef.current?.focus();
  }, [selectedSkillKey]);

  useEffect(() => {
    const nextContextKey = contextKey(context);
    if (previousContextKeyRef.current === nextContextKey) return;

    previousContextKeyRef.current = nextContextKey;
    setAllDiscoveryTarget(null);
    setSelectedSkillKey(null);
    setUninstallTarget(null);
    window.setTimeout(() => panelHeadingRef.current?.focus(), 0);
  }, [context]);

  useEffect(() => {
    if (
      allDiscoveryTarget?.scope === 'project' &&
      !projects.some((project) => project.projectId === allDiscoveryTarget.projectId)
    ) {
      setAllDiscoveryTarget(null);
    }
  }, [allDiscoveryTarget, projects]);

  useEffect(() => {
    const nextTargetValue = targetValue(discoveryTarget);
    if (previousDiscoveryTargetRef.current === nextTargetValue) return;

    previousDiscoveryTargetRef.current = nextTargetValue;
    setSelectedSkillKey(null);
    setUninstallTarget(null);
    window.setTimeout(() => panelHeadingRef.current?.focus(), 0);
  }, [discoveryTarget]);

  const clearFeedback = () => {
    setErrorMessage('');
    setStatusMessage('');
  };

  const reportError = (error: unknown) => {
    const userError = toUserError(error);
    setStatusMessage('');
    setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
  };

  const requireDiscoveryTarget = (): ScopeTarget | null => {
    if (discoveryTarget !== null) return discoveryTarget;
    setStatusMessage('');
    setErrorMessage('请先选择全局配置或一个项目配置作为发现和安装目标。');
    return null;
  };

  const selectSkill = (key: string) => {
    detailReturnFocusKeyRef.current = key;
    setSelectedSkillKey(key);
  };

  const closeDetail = () => {
    setSelectedSkillKey(null);
    window.setTimeout(() => {
      const key = detailReturnFocusKeyRef.current;
      if (key === null) return;
      const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-skill-key]'))
        .find((row) => row.dataset.skillKey === key)
        ?.querySelector<HTMLButtonElement>('.skill-row-select');
      trigger?.focus();
    }, 0);
  };

  const handleInstall = async (key: string) => {
    const skill = skills.find((item) => item.key === key);
    if (skill === undefined) return;
    clearFeedback();
    const target = requireDiscoveryTarget();
    if (target === null) return;
    try {
      await installMutation.mutateAsync({ skill, target, currentApp: activeApp });
      setStatusMessage(`已安装 ${skill.name}。`);
    } catch (error) {
      reportError(error);
    }
  };

  const handleUninstall = (key: string) => {
    const skill = skills.find((item) => item.key === key);
    if (skill?.installedId === null || skill === undefined || discoveryTarget === null) return;
    const installedSkill = (installedSkills ?? []).find(
      (candidate) =>
        candidate.id === skill.installedId && sameTarget(candidate.target, discoveryTarget),
    );
    if (installedSkill === undefined) return;
    clearFeedback();
    setUninstallTarget(installedSkill);
  };

  const handleConfirmUninstall = async () => {
    if (uninstallTarget === null) return;
    const { id, name, target } = uninstallTarget;
    setUninstallTarget(null);
    clearFeedback();
    try {
      await uninstallMutation.mutateAsync({ id, target });
      setStatusMessage(`已卸载 ${name}。`);
    } catch (error) {
      reportError(error);
    }
  };

  const handleAddRepo = async (repo: Parameters<typeof addRepoMutation.mutateAsync>[0]) => {
    clearFeedback();
    try {
      await addRepoMutation.mutateAsync(repo);
      await refetchDiscoverable();
      setStatusMessage(`已添加 ${repo.owner}/${repo.name}。`);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const handleRemoveRepo = async (owner: string, name: string) => {
    clearFeedback();
    try {
      await removeRepoMutation.mutateAsync({ owner, name });
      setStatusMessage(`已移除 ${owner}/${name}。`);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <section className="skill-panel" aria-label="发现 Skills">
      <div className="skill-panel-heading">
        <div>
          <p className="skill-eyebrow">Skills</p>
          <h2 ref={panelHeadingRef} tabIndex={-1}>
            发现
          </h2>
          <p>{skills.length} 个可安装 Skill</p>
        </div>
      </div>

      <div className="skill-toolbar skill-discovery-toolbar">
        <label className="skill-search-field" htmlFor="skill-discovery-search">
          <Search size={15} aria-hidden="true" />
          <input
            id="skill-discovery-search"
            type="search"
            placeholder="搜索 Skill 名称或仓库"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <label className="sr-only" htmlFor="skill-repo-filter">
          按仓库筛选
        </label>
        <select
          id="skill-repo-filter"
          value={filterRepo}
          onChange={(event) => setFilterRepo(event.target.value)}
        >
          <option value="all">全部仓库</option>
          {repoOptions.map((repo) => (
            <option key={repo} value={repo}>
              {repo}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="skill-status-filter">
          按安装状态筛选
        </label>
        <select
          id="skill-status-filter"
          value={filterStatus}
          onChange={(event) => setFilterStatus(event.target.value as StatusFilter)}
        >
          <option value="all">全部状态</option>
          <option value="installed">已安装</option>
          <option value="uninstalled">未安装</option>
        </select>
        {context.kind === 'all' && (
          <label className="skill-target-field" htmlFor="skill-discovery-target">
            <span>发现目标</span>
            <select
              id="skill-discovery-target"
              aria-label="选择 Skill 发现目标"
              value={targetValue(allDiscoveryTarget)}
              onChange={(event) => setAllDiscoveryTarget(targetFromValue(event.target.value))}
            >
              <option value="">选择全局或项目配置</option>
              <option value="global">全局配置</option>
              {projects.map((project) => (
                <option key={project.projectId} value={`project:${project.projectId}`}>
                  项目配置：{project.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="skill-toolbar-actions">
          <button
            type="button"
            className="skill-button"
            onClick={() => {
              if (requireDiscoveryTarget() !== null) void refetchDiscoverable();
            }}
            disabled={discoveryTarget === null}
          >
            <RefreshCw size={15} />
            刷新
          </button>
          <button type="button" className="skill-button" onClick={() => setRepoManagerOpen(true)}>
            <Settings size={15} />
            仓库管理
          </button>
        </div>
        {searchQuery && (
          <span className="skill-result-count">共 {filteredSkills.length} 个结果</span>
        )}
      </div>

      {errorMessage && (
        <div className="skill-error" role="alert">
          {errorMessage}
        </div>
      )}
      {statusMessage && (
        <div className="skill-status" role="status">
          {statusMessage}
        </div>
      )}

      {context.kind === 'all' && discoveryTarget === null ? (
        <div className="skill-empty" role="status">
          <h3>先选择发现目标</h3>
          <p>请选择全局配置或一个项目配置后，再查看相对该目标的安装状态。</p>
        </div>
      ) : selectedSkill !== null ? (
        <DiscoverySkillDetail
          skill={selectedSkill}
          pending={installMutation.isPending || uninstallMutation.isPending}
          onBack={closeDetail}
          backButtonRef={detailBackButtonRef}
          onInstall={() => void handleInstall(selectedSkill.key)}
          onUninstall={() => handleUninstall(selectedSkill.key)}
        />
      ) : loadingDiscoverable ? (
        <div className="skill-empty" role="status">
          <Loader2 size={24} className="spin" />
          <p>正在加载…</p>
        </div>
      ) : skills.length === 0 ? (
        <div className="skill-empty">
          <h3>没有发现可安装的 Skill</h3>
          <p>请添加仓库后点击刷新。</p>
          <button
            type="button"
            className="skill-button primary"
            onClick={() => setRepoManagerOpen(true)}
          >
            管理仓库
          </button>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="skill-empty">
          <h3>没有匹配的 Skill</h3>
          <p>请调整搜索或过滤条件。</p>
        </div>
      ) : (
        <div className="skill-list" role="list" aria-label="发现的 Skill 列表">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.key}
              skill={skill}
              selected={selectedSkillKey === skill.key}
              onSelect={selectSkill}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
              uninstallPending={uninstallMutation.isPending}
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

      <FocusedDialog
        open={uninstallTarget !== null}
        title="确认卸载"
        onClose={() => setUninstallTarget(null)}
        closeLabel="关闭确认卸载对话框"
        className="skill-dialog"
        footer={
          <>
            <button type="button" className="skill-button" onClick={() => setUninstallTarget(null)}>
              取消
            </button>
            <button
              type="button"
              className="skill-button danger"
              onClick={() => void handleConfirmUninstall()}
            >
              卸载
            </button>
          </>
        }
      >
        {uninstallTarget !== null && (
          <p className="skill-dialog-copy">
            确定要卸载 {uninstallTarget.name} 吗？该 Skill 将从该配置目标的所有 Agent 移除。
          </p>
        )}
      </FocusedDialog>
    </section>
  );
}
