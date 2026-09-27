import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Search, Settings } from 'lucide-react';
import type { AgentType, ConfigContext, ProjectSummary, ScopeTarget } from '../../types';
import * as api from '../../lib/api/nativeSubagents';
import {
  useSubagentRepos,
  useAddSubagentRepo,
  useRemoveSubagentRepo,
} from '../../hooks/useSubagents';
import { toUserError } from '../../lib/errors';
import { AgentBrandMark, agentLabels, WORKBENCH_AGENTS } from '../workbench/AgentBrandMark';
import { InitialAgentRadioGroup } from '../workbench/InitialAgentRadioGroup';
import { FocusedDialog } from '../workbench/FocusedDialog';
import { RepoManagerPanel } from './RepoManagerPanel';
import './subagents.css';
import './native-subagents.css';

interface Props {
  context: ConfigContext;
  projects: readonly ProjectSummary[];
}
export function SubagentsDiscoveryPage(props: Props) {
  return <NativeDiscovery key={JSON.stringify(props.context)} {...props} />;
}
function contextTarget(context: ConfigContext): ScopeTarget | null {
  return context.kind === 'all'
    ? null
    : context.kind === 'global'
      ? { scope: 'global' }
      : { scope: 'project', projectId: context.projectId };
}
function NativeDiscovery({ context, projects }: Props) {
  const client = useQueryClient();
  const [target, setTarget] = useState<ScopeTarget | null>(() => contextTarget(context));
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState<api.NativeSubagentDiscovery | null>(null);
  const [agent, setAgent] = useState<AgentType | null>(null);
  const [notice, setNotice] = useState('');
  const [manageRepos, setManageRepos] = useState(false);
  const repos = useSubagentRepos();
  const addRepo = useAddSubagentRepo();
  const removeRepo = useRemoveSubagentRepo();
  const discovery = useQuery({
    queryKey: ['subagents', 'native-discovery', target],
    queryFn: () => (target ? api.discoverNativeSubagents(target) : Promise.resolve([])),
    enabled: target !== null,
    staleTime: Infinity,
  });
  const installed = useQuery({
    queryKey: ['subagents', 'native', context],
    queryFn: () => api.scanNativeSubagents(context),
    staleTime: 0,
  });
  const install = useMutation({
    mutationFn: ({
      subagent,
      installTarget,
      selectedAgent,
    }: {
      subagent: api.NativeSubagentDiscovery;
      installTarget: ScopeTarget;
      selectedAgent: AgentType;
    }) => api.installNativeSubagent(subagent, installTarget, selectedAgent),
    onSuccess: async (result) => {
      setInstalling(null);
      setNotice(`已为 ${agentLabels[result.agent]} 安装 ${result.name}。可在“已安装”查看和管理。`);
      await client.invalidateQueries({ queryKey: ['subagents'] });
    },
  });
  const candidates = discovery.data ?? [];
  const filtered = candidates.filter((item) =>
    [item.name, item.description, item.path, `${item.repoOwner}/${item.repoName}`].some((value) =>
      value.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  const targetText =
    target === null
      ? '未选择目标'
      : target.scope === 'global'
        ? '全局配置'
        : (() => {
            const project = projects.find((item) => item.projectId === target.projectId);
            return project ? `${project.displayName} · ${project.rootPath}` : '项目不可用';
          })();
  const installedAgents = (candidate: api.NativeSubagentDiscovery) =>
    (installed.data?.definitions ?? [])
      .filter(
        (item) =>
          ['managed', 'disabled'].includes(item.managementStatus) &&
          item.repoOwner === candidate.repoOwner &&
          item.repoName === candidate.repoName &&
          item.repoPath === candidate.path &&
          JSON.stringify(item.target) === JSON.stringify(target),
      )
      .map((item) => item.agent);
  const beginInstall = (candidate: api.NativeSubagentDiscovery) => {
    setInstalling(candidate);
    setAgent(null);
    install.reset();
  };
  return (
    <section
      className="subagent-panel native-panel native-discovery-panel"
      aria-label="发现原生 Subagent"
    >
      <div className="native-page-heading">
        <div>
          <p className="skill-eyebrow">SUBAGENTS</p>
          <h2>发现 Subagents</h2>
          <p>从仓库发现兼容的原生定义，选择目标后安装。</p>
        </div>
      </div>
      <div className="discovery-target-card native-discovery-target">
        {context.kind === 'all' && (
          <label className="subagent-target-field">
            安装目标
            <select
              aria-label="选择 Subagent 发现目标"
              disabled={install.isPending}
              value={
                target?.scope === 'global' ? 'global' : target ? `project:${target.projectId}` : ''
              }
              onChange={(event) => {
                const value = event.target.value;
                setTarget(
                  value === 'global'
                    ? { scope: 'global' }
                    : value.startsWith('project:')
                      ? { scope: 'project', projectId: value.slice(8) }
                      : null,
                );
                setInstalling(null);
                setNotice('');
              }}
            >
              <option value="">选择目标</option>
              <option value="global">全局配置</option>
              {projects.map((project) => (
                <option key={project.projectId} value={`project:${project.projectId}`}>
                  {project.displayName} · {project.rootPath}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="subagent-button"
          disabled={!target || discovery.isFetching}
          onClick={() => void discovery.refetch()}
        >
          <RefreshCw size={14} className={discovery.isFetching ? 'spin' : ''} />
          刷新发现
        </button>
        {context.kind !== 'all' && (
          <div>
            <strong>发现目标</strong>
            <p>{targetText}</p>
          </div>
        )}
      </div>
      <div className="subagent-toolbar native-discovery-filters">
        <label className="subagent-search-field">
          <Search size={16} aria-hidden="true" />
          <input
            id="subagent-discovery-search"
            type="search"
            aria-label="搜索可安装 Subagent"
            placeholder="搜索名称或仓库路径"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button className="subagent-button" onClick={() => setManageRepos(true)}>
          <Settings size={14} />
          仓库管理
        </button>
      </div>
      <p className="native-help">
        目标：{targetText}。按原生格式安装到一个所属 Agent；不转换模型、工具或权限字段。
      </p>
      {notice && (
        <p className="subagent-status-message" role="status">
          {notice}
        </p>
      )}
      {discovery.isError && (
        <p className="subagent-error" role="alert">
          {toUserError(discovery.error).message}
        </p>
      )}
      {target === null ? (
        <div className="subagent-empty">
          <h3>先选择发现目标</h3>
          <p>选择全局配置或一个已登记项目后浏览原生定义。</p>
        </div>
      ) : discovery.isFetching ? (
        <p role="status">正在扫描配置的仓库…</p>
      ) : discovery.isError ? null : filtered.length === 0 ? (
        <div className="subagent-empty">
          <h3>没有可安装的原生定义</h3>
          <p>可添加包含原生 Agent 文件的仓库，或调整搜索条件。</p>
        </div>
      ) : (
        <div className="native-discovery-list" aria-label="可安装 Subagent 列表">
          {filtered.map((item) => (
            <article
              key={item.key}
              data-subagent-key={item.key}
              className="native-discovery-card"
              aria-label={`${item.name} 详情`}
            >
              <div className="native-discovery-card-heading">
                {item.compatibleAgents[0] && (
                  <AgentBrandMark app={item.compatibleAgents[0]} size={30} />
                )}
                <div>
                  <h3>{item.name}</h3>
                  <p>
                    {item.repoOwner}/{item.repoName} · {item.format}
                  </p>
                </div>
                <button
                  className="subagent-button is-primary"
                  disabled={item.compatibleAgents.length === 0 || install.isPending}
                  onClick={() => beginInstall(item)}
                >
                  <Download size={14} />
                  安装
                </button>
              </div>
              <p>{item.description}</p>
              <p className="native-help">
                兼容 Agent：
                {item.compatibleAgents.map((value) => agentLabels[value]).join(' / ') ||
                  '格式需要核对'}{' '}
                · {item.path}
              </p>
              {installedAgents(item).length > 0 && (
                <p className="native-help">
                  此目标已管理：
                  {installedAgents(item)
                    .map((value) => agentLabels[value])
                    .join('、')}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      <FocusedDialog
        open={installing !== null}
        title={`安装 ${installing?.name ?? ''}`}
        className="native-install-dialog"
        onClose={() => {
          if (!install.isPending) setInstalling(null);
        }}
        footer={
          <>
            <button
              className="subagent-button"
              disabled={install.isPending}
              onClick={() => setInstalling(null)}
            >
              取消
            </button>
            <button
              className="subagent-button is-primary"
              disabled={
                !agent ||
                !target ||
                install.isPending ||
                !installing?.compatibleAgents.includes(agent)
              }
              onClick={() => {
                if (agent && target && installing)
                  install.mutate({
                    subagent: installing,
                    installTarget: target,
                    selectedAgent: agent,
                  });
              }}
            >
              {install.isPending ? '安装中…' : '确认安装'}
            </button>
          </>
        }
      >
        <p className="native-source">
          {installing?.name} · {installing?.format.toUpperCase()}
        </p>
        <div className="skill-dialog-field">
          <span>安装到</span>
          <div className="native-install-target">{targetText}</div>
        </div>
        <InitialAgentRadioGroup
          name="native-subagent-agent"
          legend="选择兼容 Agent"
          value={agent}
          onChange={setAgent}
          disabled={install.isPending}
          disabledApps={WORKBENCH_AGENTS.filter(
            (value) =>
              !installing?.compatibleAgents.includes(value) ||
              (installing && installedAgents(installing).includes(value)),
          )}
          optionHints={Object.fromEntries(
            WORKBENCH_AGENTS.map((value) => [
              value,
              !installing?.compatibleAgents.includes(value)
                ? '此原生定义格式不兼容'
                : installedAgents(installing).includes(value)
                  ? '此目标已管理该 Agent 定义'
                  : `原生 ${installing.format.toUpperCase()} · ${installing.path}`,
            ]),
          )}
          description="当前定义格式不兼容，或此目标已管理该 Agent 定义。"
        />
        {install.isError && (
          <p role="alert" className="subagent-error">
            {toUserError(install.error).message}
          </p>
        )}
      </FocusedDialog>
      {manageRepos && (
        <RepoManagerPanel
          repos={repos.data ?? []}
          subagents={candidates.map((item) => ({
            ...item,
            directory: item.path,
            installed: false,
          }))}
          onAdd={async (repo) => {
            await addRepo.mutateAsync(repo);
            await client.invalidateQueries({ queryKey: ['subagents', 'native-discovery'] });
          }}
          onRemove={async (owner, name) => {
            await removeRepo.mutateAsync({ owner, name });
            await client.invalidateQueries({ queryKey: ['subagents', 'native-discovery'] });
          }}
          onClose={() => setManageRepos(false)}
        />
      )}
    </section>
  );
}
