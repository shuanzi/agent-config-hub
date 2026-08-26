import type { Ref } from 'react';
import type { DiscoverableSubagent } from '../../types';

export type SubagentCardSubagent = DiscoverableSubagent & {
  installed: boolean;
  installedId: string | null;
};

interface SubagentCardProps {
  subagent: SubagentCardSubagent;
  selected: boolean;
  onSelect: (key: string) => void;
  selectionRef?: Ref<HTMLButtonElement>;
}

/**
 * 发现页的高密度条目。操作统一放在右侧详情，避免在窄窗口里把行撑成卡片。
 */
export function SubagentCard({ subagent, selected, onSelect, selectionRef }: SubagentCardProps) {
  return (
    <article
      className={selected ? 'subagent-list-row is-selected' : 'subagent-list-row'}
      data-subagent-key={subagent.key}
    >
      <button
        type="button"
        className="subagent-list-row-select"
        ref={selectionRef}
        onClick={() => onSelect(subagent.key)}
        aria-current={selected ? 'true' : undefined}
      >
        <span className="subagent-list-row-copy">
          <span className="skill-card-title">{subagent.name}</span>
          <span className="subagent-list-row-meta">
            {subagent.directory} · {subagent.repoOwner}/{subagent.repoName}
          </span>
        </span>
        <span className={subagent.installed ? 'subagent-status is-enabled' : 'subagent-status'}>
          {subagent.installed ? '已安装' : '可安装'}
        </span>
      </button>
    </article>
  );
}
