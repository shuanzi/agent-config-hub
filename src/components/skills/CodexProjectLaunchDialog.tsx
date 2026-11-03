import { useEffect, useState } from 'react';
import { getCodexProjectLaunch, launchCodexProject } from '../../lib/api/skills';
import { toUserError } from '../../lib/errors';
import type { CodexProjectLaunchPlan } from '../../types';
import { FocusedDialog } from '../workbench/FocusedDialog';

export function CodexProjectLaunchDialog({
  projectId,
  hasDrafts,
  onClose,
  onLaunched,
}: {
  projectId: string;
  hasDrafts: boolean;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [plan, setPlan] = useState<CodexProjectLaunchPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setPlan(null);
    setError('');
    void getCodexProjectLaunch(projectId).then(
      (result) => {
        if (active) setPlan(result);
      },
      (failure) => {
        if (active) setError(toUserError(failure).message);
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, reload]);
  const launch = async () => {
    if (!plan || hasDrafts || plan.reason || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await launchCodexProject(projectId, plan.revision);
      if (result.handedOff) onLaunched();
      else setError('未能将启动交给终端，请重新读取后重试。');
    } catch (failure) {
      setError(toUserError(failure).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FocusedDialog
      open
      title="启动项目 Codex"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button
            className="skill-button"
            disabled={busy}
            onClick={() => setReload((value) => value + 1)}
          >
            重新读取
          </button>
          <button className="skill-button" disabled={busy} onClick={onClose}>
            关闭
          </button>
          <button
            className="skill-button primary"
            disabled={!plan || !!plan.reason || hasDrafts || busy}
            onClick={() => void launch()}
          >
            {busy ? '正在交给终端…' : '在终端启动'}
          </button>
        </>
      }
    >
      <p>仅通过此入口启动的新 Codex CLI 会话使用本项目排除规则。</p>
      {hasDrafts && (
        <p role="alert" className="skill-error">
          请先应用或撤销本项目的矩阵草稿，再启动 Codex。
        </p>
      )}
      {error && (
        <p role="alert" className="skill-error">
          {error}
        </p>
      )}
      {!plan && !error && <p role="status">正在读取启动计划…</p>}
      {plan && (
        <>
          <p className="skill-placement-note matrix-launch-path">项目路径：{plan.projectRoot}</p>
          <p>已保存的排除项（{plan.excludedSkills.length}）</p>
          {plan.excludedSkills.length ? (
            <ul className="matrix-launch-list">
              {plan.excludedSkills.map((skill) => (
                <li key={skill.id}>{skill.name}</li>
              ))}
            </ul>
          ) : (
            <p>本项目没有单独排除的 Skill。</p>
          )}
          {plan.notice && <p className="skill-placement-note">{plan.notice}</p>}
          {plan.reason && (
            <p role="alert" className="skill-error">
              {plan.reason}
            </p>
          )}
        </>
      )}
    </FocusedDialog>
  );
}
