import type { AgentType } from '../../types';
import { AgentBrandMark, agentLabels, WORKBENCH_AGENTS } from './AgentBrandMark';

interface InitialAgentRadioGroupProps {
  name: string;
  value: AgentType | null;
  onChange: (app: AgentType) => void;
  disabled?: boolean;
  disabledApps?: readonly AgentType[];
  description?: string;
  legend?: string;
  optionHints?: Partial<Record<AgentType, string>>;
}

export function InitialAgentRadioGroup({
  name,
  value,
  onChange,
  disabled = false,
  disabledApps = [],
  description,
  legend = '初始 Agent',
  optionHints,
}: InitialAgentRadioGroupProps) {
  return (
    <fieldset className="initial-agent-radio-group">
      <legend>{legend}</legend>
      <div className="initial-agent-radio-options">
        {WORKBENCH_AGENTS.map((app) => {
          const unsupported = disabledApps.includes(app);
          const optionDisabled = disabled || unsupported;
          return (
            <label key={app} className={optionDisabled ? 'is-disabled' : undefined}>
              <input
                type="radio"
                name={name}
                value={app}
                checked={value === app}
                onChange={() => onChange(app)}
                disabled={optionDisabled}
                aria-label={
                  unsupported
                    ? `${agentLabels[app]}（${description ?? '当前目标不支持'}）`
                    : agentLabels[app]
                }
              />
              <AgentBrandMark app={app} size={16} />
              <span>
                {agentLabels[app]}
                {optionHints?.[app] && <small>{optionHints[app]}</small>}
              </span>
            </label>
          );
        })}
      </div>
      {description && <p className="initial-agent-radio-description">{description}</p>}
    </fieldset>
  );
}
