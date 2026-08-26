import type { CSSProperties } from 'react';
import type { AgentType } from '../../types';
import claudeCodeLogo from '../../assets/agent-logos/claude-code.svg';
import codexLogo from '../../assets/agent-logos/codex.svg';
import googleGeminiLogo from '../../assets/agent-logos/google-gemini.svg';
import openCodeLogo from '../../assets/agent-logos/opencode.svg';

export const WORKBENCH_AGENTS: readonly AgentType[] = [
  'claude-code',
  'codex',
  'gemini-cli',
  'opencode',
];

export const agentLabels: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
};

const agentLogoSources: Record<AgentType, string> = {
  'claude-code': claudeCodeLogo,
  codex: codexLogo,
  'gemini-cli': googleGeminiLogo,
  opencode: openCodeLogo,
};

interface AgentBrandMarkProps {
  app: AgentType;
  size?: number;
  className?: string;
  decorative?: boolean;
}

/**
 * 四个一等 Agent 共用的品牌标记。默认仅作视觉标记，名称由相邻文本提供。
 */
export function AgentBrandMark({
  app,
  size = 20,
  className,
  decorative = true,
}: AgentBrandMarkProps) {
  const classes = ['agent-brand-mark', `agent-brand-mark-${app}`, className]
    .filter(Boolean)
    .join(' ');
  const imageStyle: CSSProperties = { width: size, height: size };

  return (
    <span className={classes} data-agent-brand={app} aria-hidden={decorative || undefined}>
      <img
        src={agentLogoSources[app]}
        alt={decorative ? '' : agentLabels[app]}
        width={size}
        height={size}
        style={imageStyle}
      />
    </span>
  );
}
