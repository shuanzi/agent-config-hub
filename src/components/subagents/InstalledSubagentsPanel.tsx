import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ChevronLeft, RefreshCw, Search } from 'lucide-react';
import type { ConfigContext, ProjectSummary, ScopeTarget } from '../../types';
import * as api from '../../lib/api/nativeSubagents';
import { toUserError } from '../../lib/errors';
import { AgentBrandMark, agentLabels, WORKBENCH_AGENTS } from '../workbench/AgentBrandMark';
import { FocusedDialog } from '../workbench/FocusedDialog';
import { nativeDrafts } from './native-drafts';
import './subagents.css';
import './native-subagents.css';

interface Props {
  context: ConfigContext;
  projects: readonly ProjectSummary[];
}
export const nativeStatusLabels: Record<api.NativeSubagentDefinition['managementStatus'], string> =
  {
    unmanaged: '本地未接管',
    managed: '已管理',
    disabled: '已停用',
    invalid: '文件异常',
    'legacy-review': '旧记录 · 待核对',
  };
function errorText(error: unknown) {
  const parsed = toUserError(error);
  return [parsed.message, parsed.suggestion].filter(Boolean).join(' ');
}
function targetLabel(target: ScopeTarget, projects: readonly ProjectSummary[]) {
  if (target.scope === 'global') return '全局配置';
  const project = projects.find((item) => item.projectId === target.projectId);
  return project ? `${project.displayName} · ${project.rootPath}` : `项目 ${target.projectId}`;
}
function Diagnostics({ items }: { items: readonly api.NativeSubagentDiagnostic[] }) {
  return items.length ? (
    <ul className="native-diagnostics" aria-label="配置诊断">
      {items.map((item, index) => (
        <li key={`${item.code}:${index}`} data-severity={item.severity}>
          {item.message}
        </li>
      ))}
    </ul>
  ) : null;
}
/** 上下文变化时重置源码，禁止把上一目标的缓冲区用于新目标。 */
export function InstalledSubagentsPanel(props: Props) {
  return <NativePanel key={JSON.stringify(props.context)} {...props} />;
}
function NativePanel({ context, projects }: Props) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [showBackups, setShowBackups] = useState(false);
  const scan = useQuery({
    queryKey: ['subagents', 'native', context],
    queryFn: () => api.scanNativeSubagents(context),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const definitions = scan.data?.definitions ?? [];
  const active = definitions.find((item) => item.identity === selected);
  const visible = definitions.filter((item) =>
    [
      item.name,
      item.description ?? '',
      item.sourcePath,
      agentLabels[item.agent],
      targetLabel(item.target, projects),
    ].some((text) => text.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['subagents'] });
  };
  return (
    <section className="subagent-panel native-panel" aria-label="Subagent 原生管理">
      <div className="subagent-summary-row">
        <span>本地定义 {definitions.filter((item) => item.sourceKind !== 'legacy').length} 个</span>
        <div className="subagent-agent-counts" aria-label="四 Agent 定义数量">
          {WORKBENCH_AGENTS.map((agent) => (
            <span key={agent} title={agentLabels[agent]}>
              <AgentBrandMark app={agent} size={16} />
              <span className="subagent-visually-hidden">{agentLabels[agent]}：</span>
              {
                definitions.filter((item) => item.agent === agent && item.sourceKind !== 'legacy')
                  .length
              }
            </span>
          ))}
        </div>
      </div>
      <div className="subagent-toolbar">
        <label className="subagent-search-field">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="搜索本地 Subagent"
            placeholder="搜索名称、Agent 或来源路径"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="search"
          />
        </label>
        <button
          className="subagent-button"
          onClick={() => void scan.refetch()}
          disabled={scan.isFetching}
        >
          <RefreshCw size={14} className={scan.isFetching ? 'spin' : ''} aria-hidden="true" />
          {scan.isFetching ? '扫描中…' : '刷新扫描'}
        </button>
        <button className="subagent-button" onClick={() => setShowBackups(true)}>
          <ArchiveRestore size={14} aria-hidden="true" />
          备份恢复
        </button>
      </div>
      <p className="native-help">
        按各 Agent 原生格式管理。文件已配置不代表运行中的 Agent
        已加载；本地定义需显式纳入管理后才能修改。
      </p>
      {notice && (
        <p role="status" className="subagent-status-message">
          {notice}
        </p>
      )}
      {scan.isError && (
        <p role="alert" className="subagent-error">
          扫描失败：{errorText(scan.error)} 请刷新重试。
        </p>
      )}
      <Diagnostics items={scan.data?.scanErrors ?? []} />
      {!scan.isPending && !scan.isError && definitions.length === 0 && (
        <div className="subagent-empty">
          <h3>{scan.data?.scanErrors.length ? '扫描未完整完成' : '没有找到本地 Subagent 定义'}</h3>
          <p>
            {scan.data?.scanErrors.length
              ? '请处理上方目录访问或配置错误，再刷新。'
              : '可前往“发现”安装原生定义，或检查配置目录。这里只扫描全局配置及已登记项目。'}
          </p>
        </div>
      )}
      {definitions.length > 0 && (
        <div className={`native-master-detail${active ? ' has-selection' : ''}`}>
          <div className="native-list" aria-label="本地 Subagent 列表">
            {visible.length === 0 && <p className="native-help">没有匹配的定义。</p>}
            {visible.map((item) => (
              <button
                key={item.identity}
                className={`native-row${item.identity === selected ? ' is-selected' : ''}`}
                onClick={() => setSelected(item.identity)}
                aria-current={item.identity === selected ? 'true' : undefined}
                data-native-identity={item.identity}
              >
                <span className="native-row-title">
                  <AgentBrandMark app={item.agent} size={18} />
                  <strong>{item.name}</strong>
                  <span className="native-state">{nativeStatusLabels[item.managementStatus]}</span>
                </span>
                <span>
                  {agentLabels[item.agent]} · {targetLabel(item.target, projects)}
                </span>
                <span className="native-source" title={item.sourcePath}>
                  {item.sourcePath}
                  {item.sourceKey ? ` # ${item.sourceKey}` : ''}
                </span>
              </button>
            ))}
          </div>
          {active ? (
            <NativeDetail
              key={active.identity}
              definition={active}
              projects={projects}
              onBack={() => setSelected(null)}
              onRestore={() => setShowBackups(true)}
              onChanged={refresh}
              onNotice={setNotice}
            />
          ) : (
            <aside className="native-detail native-detail-empty">
              选择左侧定义查看原生源码及管理状态。
            </aside>
          )}
        </div>
      )}
      {showBackups && (
        <NativeBackups
          context={context}
          definitions={definitions}
          onClose={() => setShowBackups(false)}
          onChanged={refresh}
          onNotice={setNotice}
        />
      )}
    </section>
  );
}
function NativeDetail({
  definition,
  projects,
  onBack,
  onRestore,
  onChanged,
  onNotice,
}: {
  definition: api.NativeSubagentDefinition;
  projects: readonly ProjectSummary[];
  onBack: () => void;
  onRestore: () => void;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const drafts = nativeDrafts(useQueryClient());
  const [loaded, setLoaded] = useState<api.NativeSubagentContent | null>(
    () => drafts.get(definition.identity)?.loaded ?? null,
  );
  const [draft, setDraft] = useState(() => drafts.get(definition.identity)?.text ?? '');
  const [confirmation, setConfirmation] = useState<'adopt' | 'uninstall' | null>(null);
  const [confirmSymlink, setConfirmSymlink] = useState(false);
  const [failure, setFailure] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useMutation({
    mutationFn: async (task: () => Promise<void>) => {
      setFailure('');
      await task();
    },
    onError: (error) => {
      if (mounted.current) setFailure(errorText(error));
    },
  });
  const current = loaded?.definition ?? definition;
  const isManaged = ['managed', 'disabled'].includes(current.managementStatus);
  const isLegacy = current.sourceKind === 'legacy';
  const dirty = loaded !== null && draft !== loaded.content;
  const hash = loaded?.contentHash ?? current.contentHash;
  const blocked = run.isPending || !hash;
  const acceptContent = (result: api.NativeSubagentContent) => {
    drafts.delete(result.definition.identity);
    if (!mounted.current) return;
    setLoaded(result);
    setDraft(result.content);
  };
  return (
    <aside className="native-detail" aria-label={`${current.name} 详情`}>
      <button className="subagent-detail-back" onClick={onBack}>
        <ChevronLeft size={16} />
        返回列表
      </button>
      <header>
        <p className="subagent-eyebrow">
          {agentLabels[current.agent]} · {current.format}
        </p>
        <h2>{current.name}</h2>
        <p className="native-help">{current.description}</p>
      </header>
      <dl className="native-facts">
        <dt>目标</dt>
        <dd>{targetLabel(current.target, projects)}</dd>
        <dt>来源</dt>
        <dd>
          {current.sourcePath}
          {current.sourceKey ? ` # ${current.sourceKey}` : ''}
        </dd>
        <dt>状态</dt>
        <dd>
          {nativeStatusLabels[current.managementStatus]} ·{' '}
          {current.managementStatus === 'invalid' || isLegacy
            ? '未确认可用'
            : current.enabled
              ? '文件已配置'
              : '未启用'}
        </dd>
        {current.isSymlink && (
          <>
            <dt>链接目标</dt>
            <dd>{current.symlinkTarget ?? '无法解析'}</dd>
          </>
        )}
      </dl>
      <Diagnostics items={current.diagnostics} />
      {current.managementStatus === 'invalid' && (
        <div className="native-actions">
          <p className="native-help">
            文件异常或已缺失。可从备份修复；无备份时请核对来源，或在发现页重新安装原生定义。
          </p>
          <button className="subagent-button" onClick={onRestore}>
            从备份修复
          </button>
        </div>
      )}
      {failure && (
        <p role="alert" className="subagent-error">
          {failure}
        </p>
      )}
      {isLegacy ? (
        <p className="native-help">
          保留的旧版记录，不代表有效原生定义。请核对实际文件，再从原生定义纳入管理；不会自动转换或恢复旧跨
          Agent 投影。
        </p>
      ) : (
        <>
          <div className="native-actions">
            <button
              className="subagent-button"
              disabled={run.isPending || dirty}
              onClick={() =>
                run.mutate(async () =>
                  acceptContent(await api.readNativeSubagent(current.identity)),
                )
              }
            >
              {loaded ? '重新加载源码' : '查看原生源码'}
            </button>
            {current.managementStatus === 'unmanaged' && (
              <button
                className="subagent-button is-primary"
                disabled={blocked}
                onClick={() => setConfirmation('adopt')}
              >
                纳入管理
              </button>
            )}
            {isManaged && (
              <>
                <button
                  className="subagent-button"
                  disabled={blocked || dirty}
                  onClick={() =>
                    run.mutate(async () => {
                      await api.backupNativeSubagent(current.identity, hash!);
                      await onChanged();
                      onNotice('已创建原生定义备份。');
                    })
                  }
                >
                  备份
                </button>
                <button
                  className="subagent-button"
                  disabled={blocked || dirty}
                  onClick={() =>
                    run.mutate(async () => {
                      await api.setNativeSubagentEnabled(current.identity, !current.enabled, hash!);
                      acceptContent(await api.readNativeSubagent(current.identity));
                      await onChanged();
                      onNotice(current.enabled ? '已停用原生定义。' : '已恢复原生定义。');
                    })
                  }
                >
                  {current.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="subagent-button is-danger"
                  disabled={blocked || dirty}
                  onClick={() => setConfirmation('uninstall')}
                >
                  卸载
                </button>
              </>
            )}
          </div>
          {loaded && (
            <label className="native-editor">
              原生源码（{current.format}）
              <textarea
                aria-label="Subagent 原生源码"
                value={draft}
                readOnly={!isManaged || run.isPending}
                spellCheck={false}
                onChange={(event) => {
                  const text = event.target.value;
                  setDraft(text);
                  if (text === loaded.content) drafts.delete(current.identity);
                  else drafts.set(current.identity, { loaded, text });
                }}
              />
            </label>
          )}
          {loaded && isManaged && (
            <div className="native-actions">
              <button
                className="subagent-button is-primary"
                disabled={blocked || !dirty}
                onClick={() =>
                  run.mutate(async () => {
                    acceptContent(
                      await api.saveNativeSubagent(current.identity, draft, loaded.contentHash),
                    );
                    await onChanged();
                    onNotice('已备份并保存原生定义。');
                  })
                }
              >
                保存原生源码
              </button>
              {dirty && (
                <button
                  className="subagent-button"
                  disabled={run.isPending}
                  onClick={() => {
                    drafts.delete(current.identity);
                    setDraft(loaded.content);
                  }}
                >
                  放弃编辑
                </button>
              )}
              <span className="native-help">
                {dirty
                  ? '未保存修改已暂存本次会话；再次选择此定义可继续编辑。关闭应用前请保存。'
                  : '写入前备份并校验外部修改。'}
              </span>
            </div>
          )}
          <NativeUpdate
            definition={current}
            blocked={blocked || dirty || !isManaged}
            onChanged={async () => {
              setLoaded(null);
              await onChanged();
            }}
            onNotice={onNotice}
          />
        </>
      )}
      <FocusedDialog
        open={confirmation !== null}
        title={confirmation === 'adopt' ? '纳入管理' : '确认卸载'}
        onClose={() => {
          if (!run.isPending) setConfirmation(null);
        }}
        footer={
          <>
            <button
              className="subagent-button"
              disabled={run.isPending}
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
            <button
              className="subagent-button is-primary"
              disabled={
                blocked || (confirmation === 'adopt' && current.isSymlink && !confirmSymlink)
              }
              onClick={() =>
                run.mutate(async () => {
                  if (confirmation === 'adopt') {
                    await api.adoptNativeSubagent(current.identity, hash!, confirmSymlink);
                    acceptContent(await api.readNativeSubagent(current.identity));
                    onNotice('已备份并纳入管理，保留原生配置。');
                  } else {
                    await api.uninstallNativeSubagent(current.identity, hash!);
                    onNotice('已备份并卸载，可从备份恢复。');
                  }
                  setConfirmation(null);
                  await onChanged();
                })
              }
            >
              {run.isPending ? '处理中…' : confirmation === 'adopt' ? '确认纳入管理' : '备份并卸载'}
            </button>
          </>
        }
      >
        <p>
          {confirmation === 'adopt'
            ? '先备份，再将这个目标下的原生定义交由应用管理。不转换到其他 Agent。'
            : '只移除当前 Agent、当前目标的这个定义，其他配置不受影响。'}
        </p>
        <p className="native-source">{current.sourcePath}</p>
        {confirmation === 'adopt' && current.isSymlink && (
          <label className="native-symlink-confirm">
            <input
              type="checkbox"
              checked={confirmSymlink}
              onChange={(event) => setConfirmSymlink(event.target.checked)}
            />
            我已核对链接目标 {current.symlinkTarget}，同意以独立副本管理，不修改外部链接目标。
          </label>
        )}
        {failure && (
          <p role="alert" className="subagent-error">
            {failure}
          </p>
        )}
      </FocusedDialog>
    </aside>
  );
}

function NativeBackups({
  context,
  definitions,
  onClose,
  onChanged,
  onNotice,
}: {
  context: ConfigContext;
  definitions: api.NativeSubagentDefinition[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [selected, setSelected] = useState<api.NativeSubagentBackup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const backups = useQuery({
    queryKey: ['subagents', 'native-backups', context],
    queryFn: () => api.getNativeSubagentBackups(context),
    staleTime: 0,
  });
  const restore = useMutation({
    mutationFn: async (backup: api.NativeSubagentBackup) => {
      const current = definitions.find((item) => item.identity === backup.identity);
      await api.restoreNativeSubagentBackup(backup.backupId, current?.contentHash);
      await onChanged();
      onNotice('已恢复原生定义备份。');
      setSelected(null);
    },
  });
  const remove = useMutation({
    mutationFn: async (backup: api.NativeSubagentBackup) => {
      if (backup.legacy || !backup.contentHash) throw new Error('备份不可删除');
      await api.deleteNativeSubagentBackup(backup.backupId, backup.contentHash);
      setSelected(null);
      setConfirmDelete(false);
      await backups.refetch();
      onNotice('已删除所选原生备份，此备份不可恢复；原生定义文件未修改。');
    },
  });
  const busy = restore.isPending || remove.isPending;
  return (
    <FocusedDialog
      open
      title="Subagent 备份恢复"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button className="subagent-button" onClick={onClose} disabled={busy}>
            关闭
          </button>
          {selected && !confirmDelete && (
            <button
              className="subagent-button is-danger"
              disabled={busy || !selected.contentHash || selected.legacy}
              onClick={() => setConfirmDelete(true)}
            >
              删除所选备份
            </button>
          )}
          {selected && !confirmDelete && (
            <button
              className="subagent-button is-primary"
              disabled={busy}
              onClick={() => restore.mutate(selected)}
            >
              {restore.isPending ? '恢复中…' : '确认恢复所选备份'}
            </button>
          )}
          {selected && confirmDelete && (
            <>
              <button
                className="subagent-button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                保留备份
              </button>
              <button
                className="subagent-button is-danger"
                disabled={busy}
                onClick={() => remove.mutate(selected)}
              >
                {remove.isPending ? '删除中…' : '确认永久删除此备份'}
              </button>
            </>
          )}
        </>
      }
    >
      <p className="native-help">
        恢复只作用于备份记录的 Agent 和目标。目标发生外部修改或被其他文件占用时不会覆盖。
      </p>
      {backups.isPending && <p role="status">正在读取备份…</p>}
      {(backups.isError || restore.isError || remove.isError) && (
        <p role="alert" className="subagent-error">
          {errorText(backups.error ?? restore.error ?? remove.error)}
        </p>
      )}
      {backups.data?.length === 0 && <p>当前上下文暂无备份。</p>}
      {backups.data?.map((backup) => (
        <label key={backup.backupId} className="native-backup-item">
          <span>
            <input
              type="radio"
              name="native-backup"
              checked={selected?.backupId === backup.backupId}
              disabled={backup.legacy || busy || confirmDelete}
              onChange={() => {
                setSelected(backup);
                setConfirmDelete(false);
              }}
            />{' '}
            {backup.name} · {agentLabels[backup.agent]}
          </span>
          <span className="native-source">{backup.sourcePath}</span>
          <span>
            {new Date(backup.createdAt * 1000).toLocaleString()} · {backup.reason}
          </span>
          {backup.legacy && <span>旧版备份保留待核对，不自动恢复跨 Agent 投影。</span>}
        </label>
      ))}
      {selected && !confirmDelete && (
        <p role="status">将恢复 {selected.name} 至原目标。恢复前会校验当前文件并备份。</p>
      )}
      {selected && confirmDelete && (
        <p role="alert">
          将永久删除 {selected.name} 的所选备份（{selected.backupId}
          ）。此操作不可撤销，不删除定义文件或其他备份。
        </p>
      )}
    </FocusedDialog>
  );
}

function NativeUpdate({
  definition,
  blocked,
  onChanged,
  onNotice,
}: {
  definition: api.NativeSubagentDefinition;
  blocked: boolean;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [preview, setPreview] = useState<api.NativeSubagentUpdatePreview | null>(null);
  const [confirmedLocalEdits, setConfirmedLocalEdits] = useState(false);
  const check = useMutation({
    mutationFn: () => api.previewNativeSubagentUpdate(definition.identity),
    onSuccess: (result) => {
      if (result.currentHash === result.remoteHash)
        onNotice('当前定义与仓库一致，没有可更新内容。');
      else {
        setPreview(result);
        setConfirmedLocalEdits(false);
      }
    },
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (!preview) return;
      await api.applyNativeSubagentUpdate(
        definition.identity,
        preview.currentHash,
        preview.remoteHash,
      );
      await onChanged();
      onNotice('已备份并应用审阅过的更新。');
      setPreview(null);
    },
  });
  if (!definition.repoOwner || !definition.repoName)
    return <p className="native-help">本地定义无仓库来源，不检查远端更新。</p>;
  return (
    <>
      <div className="native-actions">
        <button
          className="subagent-button"
          disabled={blocked || check.isPending}
          onClick={() => check.mutate()}
        >
          {check.isPending ? '检查中…' : '检查更新'}
        </button>
        <span className="native-help">
          {definition.repoOwner}/{definition.repoName}
        </span>
      </div>
      {check.isError && (
        <p role="alert" className="subagent-error">
          {errorText(check.error)}
        </p>
      )}
      <FocusedDialog
        open={preview !== null}
        title="审阅 Subagent 更新"
        onClose={() => {
          if (!apply.isPending) setPreview(null);
        }}
        footer={
          <>
            <button
              className="subagent-button"
              disabled={apply.isPending}
              onClick={() => setPreview(null)}
            >
              取消
            </button>
            <button
              className="subagent-button is-primary"
              disabled={
                apply.isPending || Boolean(preview?.locallyModified && !confirmedLocalEdits)
              }
              onClick={() => apply.mutate()}
            >
              备份并应用更新
            </button>
          </>
        }
      >
        <p className="native-help">仅更新当前 Agent 的原生定义。应用前再次校验本地和远端摘要。</p>
        {preview && (
          <div className="native-diff">
            <div>
              <h3>当前源码</h3>
              <pre>{preview.currentContent}</pre>
            </div>
            <div>
              <h3>仓库源码</h3>
              <pre>{preview.nextContent}</pre>
            </div>
          </div>
        )}
        {preview?.locallyModified && (
          <label>
            <input
              type="checkbox"
              checked={confirmedLocalEdits}
              onChange={(event) => setConfirmedLocalEdits(event.target.checked)}
            />
            我已审阅本地修改，同意先备份再替换。
          </label>
        )}
        {apply.isError && (
          <p role="alert" className="subagent-error">
            {errorText(apply.error)}
          </p>
        )}
      </FocusedDialog>
    </>
  );
}
