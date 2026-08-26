import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, FileText, Save } from 'lucide-react';
import type { ConfigContext, InstructionDocument, ProjectSummary, ScopeTarget } from '../../types';
import { useInstructionDocuments, useSaveInstructionDocument } from '../../hooks/usePrompts';
import { toUserError } from '../../lib/errors';
import { AgentBrandMark, agentLabels } from '../workbench/AgentBrandMark';
import './instructions.css';

interface InstructionsPanelProps {
  context: ConfigContext;
  projects?: readonly ProjectSummary[];
}

type NarrowSurface = 'list' | 'detail';

interface InstructionDocumentGroup {
  key: string;
  target: ScopeTarget;
  documents: InstructionDocument[];
}

function readNarrowInstructions(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 1199px)').matches === true;
}

function useNarrowInstructions(): boolean {
  const [isNarrow, setIsNarrow] = useState(readNarrowInstructions);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(max-width: 1199px)');
    const update = () => setIsNarrow(query.matches);
    update();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return isNarrow;
}

function targetKey(target: ScopeTarget): string {
  return target.scope === 'global' ? 'global' : `project:${target.projectId}`;
}

function documentKey(document: InstructionDocument): string {
  return `${targetKey(document.target)}:${document.kind}`;
}

function targetLabel(target: ScopeTarget, projects: readonly ProjectSummary[]): string {
  if (target.scope === 'global') return '全局配置';
  return (
    projects.find((project) => project.projectId === target.projectId)?.displayName ?? '项目配置'
  );
}

function contextLabel(context: ConfigContext, projects: readonly ProjectSummary[]): string {
  if (context.kind === 'all') return '全部配置';
  return context.kind === 'global'
    ? '全局配置'
    : (projects.find((project) => project.projectId === context.projectId)?.displayName ??
        '项目配置');
}

function contextKey(context: ConfigContext): string {
  return context.kind === 'project' ? `project:${context.projectId}` : context.kind;
}

function documentSummary(document: InstructionDocument): string {
  return document.kind === 'claude' ? '仅对 Claude Code 生效' : '对 Codex、OpenCode 生效';
}

function groupDocuments(documents: InstructionDocument[]): InstructionDocumentGroup[] {
  const groups = new Map<string, InstructionDocumentGroup>();

  for (const document of documents) {
    const key = targetKey(document.target);
    const group = groups.get(key);
    if (group) {
      group.documents.push(document);
      continue;
    }
    groups.set(key, { key, target: document.target, documents: [document] });
  }

  return [...groups.values()];
}

function DocumentAppliesTo({ document }: { document: InstructionDocument }) {
  return (
    <div
      className="instruction-document-applies-to"
      aria-label={`适用 Agent：${document.appliesTo.map((app) => agentLabels[app]).join('、')}`}
    >
      <span>适用于</span>
      <div>
        {document.appliesTo.map((app) => (
          <span key={app} className="instruction-document-agent">
            <AgentBrandMark app={app} size={16} />
            {agentLabels[app]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function InstructionsPanel({ context, projects = [] }: InstructionsPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [narrowSurface, setNarrowSurface] = useState<NarrowSurface>('list');
  const isNarrow = useNarrowInstructions();
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const currentContextKey = contextKey(context);
  const [selectionContextKey, setSelectionContextKey] = useState(currentContextKey);
  const contextChanged = selectionContextKey !== currentContextKey;

  const documentsQuery = useInstructionDocuments(context);
  // 作用域切换的过渡帧不显示上一 target 的缓存行，也不让其重新成为选中详情。
  const documents = contextChanged ? [] : (documentsQuery.data ?? []);
  const saveMutation = useSaveInstructionDocument();
  const documentGroups = useMemo(() => groupDocuments(documents), [documents]);
  const selectedDocument = useMemo(
    () => documents.find((document) => documentKey(document) === selectedKey) ?? null,
    [documents, selectedKey],
  );

  useEffect(() => {
    if (!contextChanged) return;

    setSelectionContextKey(currentContextKey);
    setSelectedKey(null);
    setDraftContent('');
    setErrorMessage('');
    setSuccessMessage('');
    setNarrowSurface('list');

    if (!isNarrow) return;
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => listHeadingRef.current?.focus());
      return;
    }
    listHeadingRef.current?.focus();
  }, [contextChanged, currentContextKey, isNarrow]);

  // 选中态只保存稳定的「target + document kind」身份；详情始终从当前 query 结果派生。
  useEffect(() => {
    if (documents.length === 0) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }

    if (selectedDocument !== null) return;
    setSelectedKey(documentKey(documents[0]));
  }, [documents, selectedDocument, selectedKey]);

  useEffect(() => {
    if (selectedDocument !== null) setDraftContent(selectedDocument.content);
  }, [selectedDocument?.content, selectedKey]);

  useEffect(() => {
    if (!isNarrow || narrowSurface !== 'detail' || selectedDocument === null) return;
    detailHeadingRef.current?.focus();
  }, [isNarrow, narrowSurface, selectedDocument]);

  const clearMessages = () => {
    setErrorMessage('');
    setSuccessMessage('');
  };

  const handleSelect = (document: InstructionDocument) => {
    clearMessages();
    setSelectedKey(documentKey(document));
    setDraftContent(document.content);
    setNarrowSurface('detail');
  };

  const handleSave = async () => {
    if (selectedDocument === null) return;
    clearMessages();

    try {
      await saveMutation.mutateAsync({
        target: selectedDocument.target,
        kind: selectedDocument.kind,
        content: draftContent,
      });
      setSuccessMessage(`${selectedDocument.fileName} 已保存。`);
    } catch (error) {
      const userError = toUserError(error);
      setErrorMessage([userError.message, userError.suggestion].filter(Boolean).join('\n'));
    }
  };

  const handleReturnToList = () => {
    setNarrowSurface('list');
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => listHeadingRef.current?.focus());
      return;
    }
    listHeadingRef.current?.focus();
  };

  const detailVisible = selectedDocument !== null;

  return (
    <div
      className="instructions-panel"
      data-instructions-surface={isNarrow ? narrowSurface : undefined}
      data-instruction-context={context.kind}
    >
      {errorMessage && (
        <div className="instructions-error" role="alert">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="instructions-success" role="status">
          {successMessage}
        </div>
      )}

      <div className="instructions-body">
        <section className="instructions-list-pane" aria-label="长期指令文件列表">
          <header className="instructions-list-header">
            <div>
              <p className="instructions-list-eyebrow">{contextLabel(context, projects)}</p>
              <h2 ref={listHeadingRef} tabIndex={-1}>
                长期指令
              </h2>
              <p>维护 CLAUDE.md 与 AGENTS.md</p>
            </div>
          </header>

          {documentsQuery.isLoading ? (
            <div className="instructions-state" role="status">
              正在载入长期指令…
            </div>
          ) : documentsQuery.error ? (
            <div className="instructions-state instructions-state-error" role="alert">
              {toUserError(documentsQuery.error).message}
            </div>
          ) : documents.length === 0 ? (
            <div className="instructions-state instructions-state-empty">
              <FileText size={20} aria-hidden="true" />
              <p>当前配置范围没有可管理的长期指令文件。</p>
            </div>
          ) : (
            <div className="instructions-document-groups">
              {documentGroups.map((group) => (
                <section
                  key={group.key}
                  className="instructions-document-group"
                  data-instruction-target={group.key}
                  aria-label={targetLabel(group.target, projects)}
                >
                  <header>
                    <h3>{targetLabel(group.target, projects)}</h3>
                  </header>
                  <ul className="asset-list instructions-asset-list">
                    {group.documents.map((document) => {
                      const key = documentKey(document);
                      const isSelected = key === selectedKey;
                      return (
                        <li key={key} className="instructions-list-item">
                          <button
                            type="button"
                            className={
                              isSelected ? 'instruction-row is-selected' : 'instruction-row'
                            }
                            onClick={() => handleSelect(document)}
                            aria-current={isSelected ? 'page' : undefined}
                            data-instruction-kind={document.kind}
                            data-instruction-target={targetKey(document.target)}
                          >
                            <span className="instruction-row-title">
                              <span className="asset-name">{document.fileName}</span>
                              <span className="instruction-file-state">
                                {document.exists ? '已创建' : '未创建'}
                              </span>
                            </span>
                            <span className="instruction-row-summary">
                              {documentSummary(document)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>

        <section className="instructions-detail-pane" aria-label="长期指令文件详情">
          {isNarrow && detailVisible && (
            <button className="instructions-detail-back" type="button" onClick={handleReturnToList}>
              <ArrowLeft size={16} aria-hidden="true" />
              返回列表
            </button>
          )}
          {selectedDocument ? (
            <div
              className="instruction-document-editor"
              data-instruction-editor-kind={selectedDocument.kind}
              data-instruction-target={targetKey(selectedDocument.target)}
            >
              <header className="instructions-detail-header">
                <div>
                  <p className="instructions-detail-breadcrumb">
                    {targetLabel(selectedDocument.target, projects)} · 长期指令
                  </p>
                  <h2 ref={detailHeadingRef} tabIndex={-1}>
                    {selectedDocument.fileName}
                  </h2>
                </div>
                <span className="instruction-document-state">
                  {selectedDocument.exists ? (
                    <>
                      <Check size={14} aria-hidden="true" />
                      已创建
                    </>
                  ) : (
                    '尚未创建'
                  )}
                </span>
              </header>

              <DocumentAppliesTo document={selectedDocument} />

              <div className="instructions-editor-surface">
                <header>
                  <div>
                    <h3>Markdown 内容</h3>
                    <p>保存后将直接写入 {selectedDocument.fileName}。</p>
                  </div>
                  <span>{selectedDocument.fileName}</span>
                </header>
                <label
                  className="instructions-visually-hidden"
                  htmlFor="instruction-document-content"
                >
                  内容
                </label>
                <textarea
                  id="instruction-document-content"
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  disabled={saveMutation.isPending}
                  rows={16}
                  spellCheck={false}
                />
                <footer className="instruction-document-actions">
                  <span>
                    {selectedDocument.exists
                      ? '编辑并保存当前文件。'
                      : '填写内容并保存以创建此文件。'}
                  </span>
                  <button
                    type="button"
                    className="primary"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                  >
                    <Save size={15} aria-hidden="true" />
                    保存 {selectedDocument.fileName}
                  </button>
                </footer>
              </div>
            </div>
          ) : (
            <div className="instructions-state instructions-detail-empty">
              <FileText size={22} aria-hidden="true" />
              <p>选择一个长期指令文件进行编辑。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
