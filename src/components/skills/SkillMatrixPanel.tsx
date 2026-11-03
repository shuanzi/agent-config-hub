import { Fragment, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { CircleHelp } from 'lucide-react';
import { useApplySkillAssignments, useSkillMatrix } from '../../hooks/useSkills';
import { previewSkillAssignments } from '../../lib/api/skills';
import { toUserError } from '../../lib/errors';
import type {
  AgentType,
  ConfigContext,
  InstalledSkill,
  ProjectSummary,
  ScopeTarget,
  SkillAssignment,
  SkillAssignmentPreview,
  SkillMatrixRow,
} from '../../types';
import { AgentBrandMark, agentLabels, WORKBENCH_AGENTS } from '../workbench/AgentBrandMark';
import { FocusedDialog } from '../workbench/FocusedDialog';
import { CodexProjectLaunchDialog } from './CodexProjectLaunchDialog';
import './matrix.css';

export interface SkillMatrixDraftState {
  drafts: Record<string, SkillAssignment>;
  setDrafts: Dispatch<SetStateAction<Record<string, SkillAssignment>>>;
}

export function matrixTargetKey(target: ScopeTarget): string {
  return target.scope === 'global' ? 'global' : `project:${target.projectId}`;
}
export function assignmentKey(
  request: Pick<SkillAssignment, 'id' | 'sourceTarget' | 'target' | 'agent'>,
): string {
  return JSON.stringify([
    matrixTargetKey(request.sourceTarget),
    request.id,
    matrixTargetKey(request.target),
    request.agent,
  ]);
}
function rowKey(row: SkillMatrixRow): string {
  return JSON.stringify([matrixTargetKey(row.skill.target), row.skill.id]);
}
function scopeLabel(target: ScopeTarget, projects: readonly ProjectSummary[]): string {
  if (target.scope === 'global') return '全局';
  const project = projects.find((entry) => entry.projectId === target.projectId);
  if (!project) return target.projectId;
  return projects.some(
    (other) => other.projectId !== project.projectId && other.displayName === project.displayName,
  )
    ? `${project.displayName}（${project.rootPath}）`
    : project.displayName;
}
const origins = {
  placed: '已投放',
  inherited: '来自全局',
  excluded: '本范围已排除',
  absent: '未使用',
  unknown: '未能读取',
  enabled: '本范围已启用',
};
export function SkillMatrixPanel({
  context,
  projects,
  searchQuery,
  onDetail,
  active = true,
  draftState,
}: {
  context: ConfigContext;
  projects: readonly ProjectSummary[];
  searchQuery: string;
  onDetail: (skill: InstalledSkill) => void;
  active?: boolean;
  draftState?: SkillMatrixDraftState;
}) {
  const query = useSkillMatrix(context, active);
  const mutation = useApplySkillAssignments();
  const [localDrafts, setLocalDrafts] = useState<Record<string, SkillAssignment>>({});
  const { drafts, setDrafts } = draftState ?? { drafts: localDrafts, setDrafts: setLocalDrafts };
  const [selected, setSelected] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState<AgentType | ''>('');
  const [stateFilter, setStateFilter] = useState('all');
  const [reason, setReason] = useState('');
  const [reasonTitle, setReasonTitle] = useState('限制说明');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [review, setReview] = useState<SkillAssignmentPreview[] | null>(null);
  const [bulk, setBulk] = useState(false);
  const [bulkTargets, setBulkTargets] = useState<string[]>([]);
  const [bulkAgents, setBulkAgents] = useState<AgentType[]>([]);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const contextId = context.kind === 'project' ? context.projectId : context.kind;
  useEffect(() => {
    setSelected([]);
    setLaunchOpen(false);
    setBulk(false);
    setReview(null);
  }, [contextId, searchQuery, agentFilter, stateFilter]);
  const rows = query.data ?? [];
  const agents = agentFilter ? [agentFilter] : WORKBENCH_AGENTS;
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (
          ![
            row.skill.name,
            row.skill.description,
            row.skill.repoOwner,
            row.skill.repoName,
            row.skill.directory,
          ].some((term) => term?.toLowerCase().includes(searchQuery.trim().toLowerCase()))
        )
          return false;
        return row.cells.some(
          (cell) =>
            (!agentFilter || cell.agent === agentFilter) &&
            (stateFilter === 'all' ||
              (stateFilter === 'used'
                ? cell.checked
                : stateFilter === 'blocked'
                  ? cell.reason
                  : !cell.checked)),
        );
      }),
    [rows, searchQuery, agentFilter, stateFilter],
  );
  function stage(row: SkillMatrixRow, agent: AgentType, enabled: boolean) {
    const cell = row.cells.find((candidate) => candidate.agent === agent)!;
    const request: SkillAssignment = {
      id: row.skill.id,
      sourceTarget: row.skill.target,
      target: row.target,
      agent,
      enabled,
      expectedRevision: cell.revision,
    };
    setDrafts((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(
          ([key, item]) =>
            key !== assignmentKey(request) &&
            !(
              item.id === request.id &&
              matrixTargetKey(item.target) === matrixTargetKey(request.target) &&
              item.agent === agent &&
              item.expectedRevision === cell.revision
            ),
        ),
      );
      if (enabled === cell.checked) delete next[assignmentKey(request)];
      else next[assignmentKey(request)] = request;
      return next;
    });
  }
  async function stageBulk(enabled: boolean) {
    setReading(true);
    try {
      const requests = rows
        .filter((row) => selected.includes(rowKey(row)))
        .flatMap((row) =>
          bulkTargets.flatMap((key) =>
            bulkAgents.map((agent): SkillAssignment => ({
              id: row.skill.id,
              sourceTarget: row.skill.target,
              target:
                key === 'global'
                  ? { scope: 'global' }
                  : { scope: 'project', projectId: key.slice(8) },
              agent,
              enabled,
              expectedRevision: '',
            })),
          ),
        );
      const result = await previewSkillAssignments(requests);
      const seen = new Set<string>();
      const changes = result.filter((item) => {
        if (item.checked === enabled && item.request.expectedRevision) return false;
        const key = JSON.stringify([
          item.request.id,
          item.request.target,
          item.request.agent,
          item.request.enabled,
          item.request.expectedRevision,
        ]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const requestedKeys = new Set(requests.map(assignmentKey));
      setDrafts((current) => ({
        // A successful no-op preview also replaces the previous draft choice.
        ...Object.fromEntries(Object.entries(current).filter(([key]) => !requestedKeys.has(key))),
        ...Object.fromEntries(changes.map((item) => [assignmentKey(item.request), item.request])),
      }));
      setMessage(
        `已暂存 ${changes.length} 项，跳过 ${result.length - changes.length} 项无需变更。`,
      );
      setBulk(false);
    } catch (error) {
      setMessage(toUserError(error).message);
    } finally {
      setReading(false);
    }
  }
  async function preview() {
    setReading(true);
    try {
      const current = await previewSkillAssignments(Object.values(drafts));
      // Preview does not silently rebase a stale draft; original revision is
      // retained for application and an explicit reread is needed after failure.
      setReview(
        current.map((item) => ({
          ...item,
          request: drafts[assignmentKey(item.request)],
          reason:
            item.reason ||
            (item.request.expectedRevision !== drafts[assignmentKey(item.request)].expectedRevision
              ? '目录、版本或策略已变化，请放弃此草稿，重新读取后核对。'
              : undefined),
        })),
      );
    } catch (error) {
      setMessage(toUserError(error).message);
    } finally {
      setReading(false);
    }
  }
  async function apply() {
    if (!review) return;
    try {
      const results = await mutation.mutateAsync(
        review.filter((item) => !item.reason).map((item) => item.request),
      );
      const successful = results.filter((result) => result.applied);
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([key]) => !successful.some((result) => assignmentKey(result.request) === key),
          ),
        ),
      );
      setMessage(
        `已应用 ${successful.length} 项；保留 ${review.filter((item) => item.reason).length + results.length - successful.length} 项草稿。${results
          .filter((result) => !result.applied)
          .map((result) => result.error)
          .join('；')}`,
      );
      setReview(null);
    } catch (error) {
      setMessage(toUserError(error).message);
    }
  }
  const pending = mutation.isPending || reading;
  const changes = Object.values(drafts);
  if (!active) return null;
  return (
    <div className="skill-matrix">
      <div className="matrix-filters">
        <label>
          Agent{' '}
          <select
            aria-label="筛选矩阵 Agent"
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value as AgentType | '')}
          >
            <option value="">全部 Agent</option>
            {WORKBENCH_AGENTS.map((agent) => (
              <option key={agent} value={agent}>
                {agentLabels[agent]}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态{' '}
          <select
            aria-label="筛选矩阵状态"
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="used">已使用</option>
            <option value="unused">未使用</option>
            <option value="blocked">需核对</option>
          </select>
        </label>
        <button
          className="skill-button"
          disabled={query.isFetching || pending}
          onClick={() => void query.refetch()}
        >
          重新读取矩阵
        </button>
        <button
          className="skill-button"
          disabled={!selected.length || pending}
          onClick={() => {
            setBulkTargets(
              context.kind === 'all'
                ? []
                : [context.kind === 'project' ? `project:${context.projectId}` : 'global'],
            );
            setBulkAgents([...WORKBENCH_AGENTS]);
            setBulk(true);
          }}
        >
          批量分配（{selected.length}）
        </button>
        {context.kind === 'project' && (
          <button className="skill-button" disabled={pending} onClick={() => setLaunchOpen(true)}>
            启动 Codex
          </button>
        )}
      </div>
      <p className="skill-placement-note">
        勾选后暂存，预览并应用才写入。来自全局的取消勾选仅修改当前项目规则。Codex
        项目排除仅通过「启动 Codex」入口生效。状态表示配置，请在 Agent 新会话中核对加载。
      </p>
      {message && (
        <p role="status" className="skill-status">
          {message}
        </p>
      )}
      {query.error ? (
        <p role="alert" className="skill-error">
          {toUserError(query.error).message}
        </p>
      ) : query.isLoading ? (
        <p role="status">正在读取矩阵…</p>
      ) : (
        <div className="matrix-scroll">
          <table className={`matrix-table${agents.length === 1 ? ' is-single-agent' : ''}`}>
            <caption className="sr-only">Skills 使用矩阵</caption>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={`全选筛选结果（${visible.length} 个 Skill）`}
                    checked={
                      visible.length > 0 && visible.every((row) => selected.includes(rowKey(row)))
                    }
                    onChange={(event) =>
                      setSelected(event.target.checked ? visible.map(rowKey) : [])
                    }
                  />
                </th>
                <th>Skill / 来源</th>
                {agents.map((agent) => (
                  <th key={agent}>
                    <AgentBrandMark app={agent} size={18} decorative /> {agentLabels[agent]}
                    {agent === 'codex' && context.kind === 'project' && <small>项目启动入口</small>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => {
                const group =
                  row.skill.target.scope === 'global' && row.target.scope === 'project'
                    ? '来自全局'
                    : scopeLabel(row.skill.target, projects);
                const previous = visible[index - 1];
                const previousGroup =
                  previous &&
                  (previous.skill.target.scope === 'global' && previous.target.scope === 'project'
                    ? '来自全局'
                    : scopeLabel(previous.skill.target, projects));
                return (
                  <Fragment key={rowKey(row)}>
                    {previousGroup !== group && (
                      <tr className="matrix-group">
                        <th colSpan={agents.length + 2}>{group}</th>
                      </tr>
                    )}
                    <tr
                      data-skill-selection-id={`${matrixTargetKey(row.skill.target)}:${row.skill.id}`}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择 ${row.skill.name}，${scopeLabel(row.skill.target, projects)}`}
                          checked={selected.includes(rowKey(row))}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, rowKey(row)]
                                : current.filter((key) => key !== rowKey(row)),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="matrix-name skill-row-select"
                          onClick={() => onDetail(row.skill)}
                          aria-label={`${row.skill.name}，${scopeLabel(row.skill.target, projects)}，查看详情`}
                        >
                          {row.skill.name}
                        </button>
                        <small>{row.skill.description}</small>
                        <small>
                          {row.skill.repoOwner
                            ? `${row.skill.repoOwner}/${row.skill.repoName}`
                            : '本地来源'}
                        </small>
                      </td>
                      {agents.map((agent) => {
                        const cell = row.cells.find((candidate) => candidate.agent === agent)!;
                        const key = assignmentKey({
                          id: row.skill.id,
                          sourceTarget: row.skill.target,
                          target: row.target,
                          agent,
                        });
                        const draft =
                          drafts[key] ??
                          Object.values(drafts).find(
                            (item) =>
                              item.id === row.skill.id &&
                              matrixTargetKey(item.target) === matrixTargetKey(row.target) &&
                              item.agent === agent &&
                              item.expectedRevision === cell.revision,
                          );
                        return (
                          <td key={agent} className={draft ? 'matrix-draft' : ''}>
                            <div className="matrix-cell">
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`${row.skill.name}，${scopeLabel(row.target, projects)}，${agentLabels[agent]}`}
                                  checked={draft?.enabled ?? cell.checked}
                                  disabled={pending || !!cell.reason}
                                  onChange={(event) => stage(row, agent, event.target.checked)}
                                />
                                <span>
                                  {draft ? '待应用' : origins[cell.origin]}
                                  {cell.activationMode === 'projectLauncher' && (
                                    <small>启动入口生效</small>
                                  )}
                                </span>
                              </label>
                              {cell.notice && !cell.reason && (
                                <button
                                  className="matrix-reason"
                                  aria-label={`${row.skill.name}，${agentLabels[agent]}，查看生效说明`}
                                  onClick={() => {
                                    setReasonTitle('生效说明');
                                    setReason(cell.notice!);
                                  }}
                                >
                                  <CircleHelp size={14} aria-hidden="true" />
                                </button>
                              )}
                              {cell.reason && (
                                <button
                                  className="matrix-reason"
                                  aria-label={`${row.skill.name}，${agentLabels[agent]}，查看限制原因`}
                                  onClick={() => {
                                    setReasonTitle('限制说明');
                                    setReason(cell.reason!);
                                  }}
                                >
                                  <CircleHelp size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!visible.length && <p className="skill-empty">没有匹配的 Skill</p>}
        </div>
      )}
      {changes.length > 0 && (
        <div className="matrix-draft-bar" role="status">
          <span>{changes.length} 项待应用 · 切换项目保留草稿</span>
          <button className="skill-button" disabled={pending} onClick={() => setDrafts({})}>
            放弃草稿
          </button>
          <button
            className="skill-button primary"
            disabled={pending}
            onClick={() => void preview()}
          >
            预览变更
          </button>
        </div>
      )}
      {launchOpen && context.kind === 'project' && (
        <CodexProjectLaunchDialog
          projectId={context.projectId}
          hasDrafts={Object.values(drafts).some(
            (draft) =>
              draft.target.scope === 'project' && draft.target.projectId === context.projectId,
          )}
          onClose={() => setLaunchOpen(false)}
          onLaunched={() => {
            setLaunchOpen(false);
            setMessage('已将本项目 Codex 启动交给终端。');
          }}
        />
      )}
      {reason && (
        <FocusedDialog open title={reasonTitle} onClose={() => setReason('')}>
          <p>{reason}</p>
        </FocusedDialog>
      )}
      {review && (
        <FocusedDialog
          open
          title="预览 Skill 分配变更"
          onClose={() => !pending && setReview(null)}
          footer={
            <button
              className="skill-button primary"
              disabled={pending || !review.some((item) => !item.reason)}
              onClick={() => void apply()}
            >
              {pending
                ? '应用中…'
                : `应用可执行项（${review.filter((item) => !item.reason).length}）`}
            </button>
          }
        >
          <p>逐项复验目录、来源版本和原生策略。受限制或已变化的项保留草稿；其他项独立执行。</p>
          <ul>
            {review.map((item) => (
              <li key={assignmentKey(item.request)}>
                {item.request.id} · {scopeLabel(item.request.sourceTarget, projects)} →{' '}
                {scopeLabel(item.request.target, projects)} · {agentLabels[item.request.agent]}：
                {item.reason || (item.request.enabled ? '使用' : '停用')}
                <button
                  className="skill-button"
                  disabled={pending}
                  onClick={() => {
                    const key = assignmentKey(item.request);
                    setDrafts((current) =>
                      Object.fromEntries(
                        Object.entries(current).filter(([entry]) => entry !== key),
                      ),
                    );
                    setReview(null);
                    setMessage('已移除此项，请重新预览其余草稿。');
                  }}
                >
                  移除此项
                </button>
              </li>
            ))}
          </ul>
        </FocusedDialog>
      )}
      {bulk && (
        <FocusedDialog
          open
          title="批量指定项目与 Agent"
          onClose={() => !reading && setBulk(false)}
          footer={
            <>
              <button
                className="skill-button"
                disabled={reading || !bulkTargets.length || !bulkAgents.length}
                onClick={() => void stageBulk(false)}
              >
                暂存停用
              </button>
              <button
                className="skill-button primary"
                disabled={reading || !bulkTargets.length || !bulkAgents.length}
                onClick={() => void stageBulk(true)}
              >
                暂存使用
              </button>
            </>
          }
        >
          <fieldset>
            <legend>配置范围</legend>
            {[
              { key: 'global', label: '全局' },
              ...projects.map((project) => ({
                key: `project:${project.projectId}`,
                label: `${project.displayName} · ${project.rootPath}`,
              })),
            ].map((target) => (
              <label className="matrix-choice" key={target.key}>
                <input
                  type="checkbox"
                  checked={bulkTargets.includes(target.key)}
                  onChange={(event) =>
                    setBulkTargets((current) =>
                      event.target.checked
                        ? [...current, target.key]
                        : current.filter((key) => key !== target.key),
                    )
                  }
                />
                {target.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Agent</legend>
            {WORKBENCH_AGENTS.map((agent) => (
              <label className="matrix-choice" key={agent}>
                <input
                  type="checkbox"
                  checked={bulkAgents.includes(agent)}
                  onChange={(event) =>
                    setBulkAgents((current) =>
                      event.target.checked
                        ? [...current, agent]
                        : current.filter((key) => key !== agent),
                    )
                  }
                />
                {agentLabels[agent]}
              </label>
            ))}
          </fieldset>
        </FocusedDialog>
      )}
    </div>
  );
}
