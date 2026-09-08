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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
  const selected = candidates.find((item) => item.key === selectedKey);
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
    <section className="subagent-panel native-panel" aria-label="发现原生 Subagent">
      <div className="subagent-toolbar">
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
                setSelectedKey(null);
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
        <div className={`native-master-detail${selected ? ' has-selection' : ''}`}>
          <div className="native-list" aria-label="可安装 Subagent 列表">
            {filtered.map((item) => (
              <button
                key={item.key}
                data-subagent-key={item.key}
                className={`native-row${selected?.key === item.key ? ' is-selected' : ''}`}
                onClick={() => setSelectedKey(item.key)}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.repoOwner}/{item.repoName} · {item.format}
                </span>
                <span className="native-source">{item.path}</span>
                <span>
                  {item.compatibleAgents.map((value) => agentLabels[value]).join(' / ') ||
                    '格式需要核对'}
                </span>
              </button>
            ))}
          </div>
          {selected ? (
            <aside className="native-detail" aria-label={`${selected.name} 详情`}>
              <button className="subagent-detail-back" onClick={() => setSelectedKey(null)}>
                返回列表
              </button>
              <h2>{selected.name}</h2>
              <p className="native-help">{selected.description}</p>
              <p className="native-source">
                {selected.repoOwner}/{selected.repoName} · {selected.path}
              </p>
              <div className="native-actions">
                {selected.compatibleAgents.map((value) => (
                  <span key={value}>
                    <AgentBrandMark app={value} size={16} /> {agentLabels[value]}
                  </span>
                ))}
              </div>
              <p className="native-help">
                支持 Codex 的全局和项目 TOML 定义。Markdown 不会直接复制成 Codex 配置。
              </p>
              {installedAgents(selected).length > 0 && (
                <p>
                  此目标已管理：
                  {installedAgents(selected)
                    .map((value) => agentLabels[value])
                    .join('、')}
                </p>
              )}
              <button
                className="subagent-button is-primary"
                disabled={selected.compatibleAgents.length === 0 || install.isPending}
                onClick={() => beginInstall(selected)}
              >
                <Download size={14} />
                安装
              </button>
            </aside>
          ) : (
            <aside className="native-detail native-detail-empty">选择定义查看兼容 Agent。</aside>
          )}
        </div>
      )}
      <FocusedDialog
        open={installing !== null}
        title={`安装 ${installing?.name ?? ''}`}
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
        <p className="native-source">安装目标：{targetText}</p>
        <p>请选择所属 Agent。安装前由后端再次校验原生格式，不进行跨 Agent 转换。</p>
        <InitialAgentRadioGroup
          name="native-subagent-agent"
          value={agent}
          onChange={setAgent}
          disabled={install.isPending}
          disabledApps={WORKBENCH_AGENTS.filter(
            (value) =>
              !installing?.compatibleAgents.includes(value) ||
              (installing && installedAgents(installing).includes(value)),
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
