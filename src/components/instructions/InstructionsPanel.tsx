import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { AgentType, Prompt } from '../../types';
import {
  usePrompts,
  useCurrentPromptFileContent,
  useSavePrompt,
  useDeletePrompt,
  useEnablePrompt,
  useImportPromptFromFile,
} from '../../hooks/usePrompts';
import { toUserError } from '../../lib/errors';
import './instructions.css';

interface InstructionsPanelProps {
  activeApp: AgentType;
}

const agentLabels: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
};

function generateId(): string {
  return `prompt-${Date.now()}`;
}

function emptyPrompt(): Prompt {
  return {
    id: generateId(),
    name: '',
    content: '',
    description: '',
    enabled: false,
  };
}

export function InstructionsPanel({ activeApp }: InstructionsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<Prompt>(emptyPrompt());
  const [errorMessage, setErrorMessage] = useState('');
  const [showLiveContent, setShowLiveContent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const { data: prompts, isLoading } = usePrompts(activeApp);
  const { data: liveContent, isLoading: isLoadingLive } = useCurrentPromptFileContent(activeApp);
  const saveMutation = useSavePrompt();
  const deleteMutation = useDeletePrompt();
  const enableMutation = useEnablePrompt();
  const importMutation = useImportPromptFromFile();

  // activeApp 切换时组件保持挂载：重置编辑器状态，避免把上一个
  // Agent 的选中项或草稿保存进新 Agent。
  useEffect(() => {
    setSelectedId(null);
    setIsCreating(false);
    setDraft(emptyPrompt());
    setErrorMessage('');
  }, [activeApp]);

  const promptList = useMemo(() => {
    if (!prompts) return [];
    return Object.entries(prompts).sort(([, a], [, b]) => {
      const ta = a.createdAt ?? 0;
      const tb = b.createdAt ?? 0;
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
  }, [prompts]);

  const filteredPromptList = useMemo(() => {
    let result = promptList;
    if (statusFilter === 'enabled') {
      result = result.filter(([, prompt]) => prompt.enabled);
    } else if (statusFilter === 'disabled') {
      result = result.filter(([, prompt]) => !prompt.enabled);
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter(([id, prompt]) =>
        [prompt.name, prompt.description ?? '', id].some((value) =>
          value.toLowerCase().includes(query),
        ),
      );
    }
    return result;
  }, [promptList, searchQuery, statusFilter]);

  const selectedPrompt = useMemo(() => {
    if (isCreating) return draft;
    if (!prompts || !selectedId) return null;
    return prompts[selectedId] ?? null;
  }, [draft, isCreating, prompts, selectedId]);

  const isEnabled = selectedPrompt?.enabled ?? false;
  const pending =
    saveMutation.isPending ||
    deleteMutation.isPending ||
    enableMutation.isPending ||
    importMutation.isPending;

  const handleSelect = (id: string) => {
    setErrorMessage('');
    setIsCreating(false);
    setSelectedId(id);
    if (prompts && prompts[id]) {
      setDraft(prompts[id]);
    }
  };

  const handleCreate = () => {
    setErrorMessage('');
    setIsCreating(true);
    setSelectedId(null);
    setDraft(emptyPrompt());
  };

  const handleChange = (field: keyof Prompt, value: string | boolean) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    setErrorMessage('');
    if (!draft.name.trim()) {
      setErrorMessage('请输入预设名称。');
      return;
    }
    try {
      const id = isCreating ? draft.id : selectedId!;
      await saveMutation.mutateAsync({ app: activeApp, id, prompt: draft });
      setIsCreating(false);
      setSelectedId(id);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleDelete = async () => {
    setErrorMessage('');
    if (!selectedId) return;
    if (!window.confirm('确定要删除这条指令预设吗？')) return;
    try {
      await deleteMutation.mutateAsync({ app: activeApp, id: selectedId });
      setSelectedId(null);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleEnable = async () => {
    setErrorMessage('');
    if (!selectedId) return;
    try {
      await enableMutation.mutateAsync({ app: activeApp, id: selectedId });
      // 缓存已更新为 enabled，但本地 draft 仍是旧的 false；同步草稿，
      // 避免用户不重新选中直接保存时提交过期的 enabled: false 把预设改回禁用。
      setDraft((current) => ({ ...current, enabled: true }));
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleImport = async () => {
    setErrorMessage('');
    try {
      await importMutation.mutateAsync({ app: activeApp });
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleCancel = () => {
    setErrorMessage('');
    setIsCreating(false);
    if (promptList.length > 0 && !selectedId) {
      setSelectedId(promptList[0][0]);
    }
  };

  return (
    <div className="instructions-panel">
      <div className="instructions-toolbar">
        <span className="instructions-agent">{agentLabels[activeApp]}</span>
        <div className="instructions-actions">
          <button type="button" onClick={handleCreate} disabled={pending}>
            新建预设
          </button>
          <button type="button" onClick={handleImport} disabled={pending || isLoading}>
            从 live 文件导入
          </button>
          <button
            type="button"
            onClick={() => setShowLiveContent((v) => !v)}
            disabled={isLoadingLive}
          >
            {showLiveContent ? '隐藏 live 内容' : '查看 live 内容'}
          </button>
        </div>
      </div>

      {errorMessage && <div className="instructions-error">{errorMessage}</div>}

      <div className="instructions-body">
        <div className="instructions-list-pane">
          <div className="instructions-filter-bar">
            <div style={{ position: 'relative' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              />
              <input
                id="instructions-search"
                type="text"
                placeholder="搜索预设名称"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                style={{ paddingLeft: 28 }}
              />
            </div>
            <select
              id="instructions-status-filter"
              aria-label="状态过滤"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | 'enabled' | 'disabled')
              }
            >
              <option value="all">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">未启用</option>
            </select>
          </div>
          {isLoading ? (
            <div className="state-loading">加载中…</div>
          ) : promptList.length === 0 ? (
            <div className="state-empty">
              <p>尚无指令预设。</p>
              <p className="state-empty-hint">点击“新建预设”或“从 live 文件导入”。</p>
            </div>
          ) : filteredPromptList.length === 0 ? (
            <div className="state-empty">
              <p>没有匹配的预设。</p>
            </div>
          ) : (
            <ul className="asset-list">
              {filteredPromptList.map(([id, prompt]) => (
                <li
                  key={id}
                  className={`asset-row ${selectedId === id ? 'asset-row-selected' : ''}`}
                  onClick={() => handleSelect(id)}
                >
                  <div className="asset-row-line1">
                    <span className="asset-name">{prompt.name}</span>
                    {prompt.enabled && <span className="enabled-badge">已启用</span>}
                  </div>
                  {prompt.description ? (
                    <div className="asset-row-line2">
                      <span className="context-hint">{prompt.description}</span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="instructions-detail-pane">
          {showLiveContent ? (
            <div className="live-content-view">
              <h3>当前 live 文件内容</h3>
              {liveContent === null || liveContent === '' ? (
                <p className="live-content-empty">无 live 内容</p>
              ) : (
                <pre className="source-view">{liveContent}</pre>
              )}
            </div>
          ) : selectedPrompt ? (
            <div className="prompt-editor">
              <div className="prompt-field">
                <label htmlFor="prompt-name">名称</label>
                <input
                  id="prompt-name"
                  type="text"
                  value={draft.name}
                  onChange={(event) => handleChange('name', event.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="prompt-field">
                <label htmlFor="prompt-description">描述</label>
                <input
                  id="prompt-description"
                  type="text"
                  value={draft.description ?? ''}
                  onChange={(event) => handleChange('description', event.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="prompt-field prompt-field-grow">
                <label htmlFor="prompt-content">内容</label>
                <textarea
                  id="prompt-content"
                  value={draft.content}
                  onChange={(event) => handleChange('content', event.target.value)}
                  disabled={pending}
                  rows={16}
                />
              </div>
              <div className="prompt-editor-actions">
                {isEnabled ? (
                  <span className="enabled-status">当前已启用</span>
                ) : (
                  <button type="button" onClick={handleEnable} disabled={pending || isCreating}>
                    启用
                  </button>
                )}
                <button type="button" onClick={handleSave} disabled={pending}>
                  保存
                </button>
                {!isCreating && (
                  <button
                    type="button"
                    className="danger"
                    onClick={handleDelete}
                    disabled={pending}
                  >
                    删除
                  </button>
                )}
                {isCreating && (
                  <button type="button" onClick={handleCancel} disabled={pending}>
                    取消
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="state-empty">
              <p>选择左侧预设进行编辑，或新建一条预设。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
