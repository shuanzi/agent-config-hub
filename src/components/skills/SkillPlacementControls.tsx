import { Check, Folder, Minus, Plus, X } from 'lucide-react';
import type { AgentType, SkillLocation, SkillPlacement, SkillPlacementTarget } from '../../types';
import { AgentBrandMark, agentLabels } from '../workbench/AgentBrandMark';
import { Tooltip } from '../workbench/Tooltip';

export const skillLocationLabels: Record<SkillLocation, string> = {
  shared: '共享目录',
  'claude-code': agentLabels['claude-code'],
  codex: agentLabels.codex,
  'gemini-cli': agentLabels['gemini-cli'],
  opencode: agentLabels.opencode,
};

function locationsForTarget(target: SkillPlacementTarget): SkillLocation[] {
  return [...new Set([target.location, ...target.aliases])];
}

function LocationMark({ location, size = 20 }: { location: SkillLocation; size?: number }) {
  return location === 'shared' ? (
    <span className="skill-shared-mark" aria-hidden="true">
      <Folder size={size} />
    </span>
  ) : (
    <AgentBrandMark app={location as AgentType} size={size} decorative />
  );
}

function PlacementIdentity({ target }: { target: SkillPlacementTarget }) {
  const locations = locationsForTarget(target);
  return (
    <span className="skill-placement-identity">
      <span className="skill-placement-name">
        <span className="skill-placement-marks">
          {locations.map((location) => (
            <LocationMark key={location} location={location} />
          ))}
        </span>
        <span>{locations.map((location) => skillLocationLabels[location]).join(' / ')}</span>
      </span>
      <code title={target.physicalPath}>{target.path}</code>
    </span>
  );
}

export function SkillLocationRadioGroup({
  name,
  targets,
  value,
  onChange,
  disabled = false,
  legend = '初始投放位置',
}: {
  name: string;
  targets: readonly SkillPlacementTarget[];
  value: SkillLocation | null;
  onChange: (location: SkillLocation) => void;
  disabled?: boolean;
  legend?: string;
}) {
  return (
    <fieldset className="skill-location-options">
      <legend>{legend}</legend>
      {[...targets]
        .sort((a, b) => Number(a.location === 'shared') - Number(b.location === 'shared'))
        .map((target) => (
          <label key={`${target.location}:${target.physicalPath}`}>
            <input
              type="radio"
              name={name}
              value={target.location}
              checked={value === target.location}
              onChange={() => onChange(target.location)}
              disabled={disabled}
              aria-label={`${skillLocationLabels[target.location]}，${target.path}`}
            />
            <PlacementIdentity target={target} />
          </label>
        ))}
    </fieldset>
  );
}

export function SkillLocationCheckboxGroup({
  targets,
  value,
  onChange,
  disabled = false,
  legend = '投放位置',
  labelPrefix,
}: {
  targets: readonly SkillPlacementTarget[];
  value: readonly SkillLocation[];
  onChange: (locations: SkillLocation[]) => void;
  disabled?: boolean;
  legend?: string;
  labelPrefix?: string;
}) {
  const selected = new Set(value);
  return (
    <fieldset className="skill-location-options is-compact">
      <legend>{legend}</legend>
      {[...targets]
        .sort((a, b) => Number(a.location === 'shared') - Number(b.location === 'shared'))
        .map((target) => {
          const checked = selected.has(target.location);
          return (
            <label key={`${target.location}:${target.physicalPath}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? value.filter((location) => location !== target.location)
                      : [...value, target.location],
                  )
                }
                disabled={disabled}
                aria-label={`${labelPrefix ? `${labelPrefix}，` : ''}${skillLocationLabels[target.location]}，${target.path}`}
              />
              <PlacementIdentity target={target} />
            </label>
          );
        })}
    </fieldset>
  );
}

const stateLabels: Record<SkillPlacement['state'], string> = {
  placed: '已投放',
  absent: '未投放',
  unmanaged: '已存在·未接管',
  conflict: '投放冲突',
};

export function SkillPlacementControls({
  skillName,
  placements,
  pending = false,
  onSetPlacement,
  onTakeover,
  compact = false,
}: {
  skillName: string;
  placements: readonly SkillPlacement[];
  pending?: boolean;
  onSetPlacement: (placement: SkillPlacement, placed: boolean) => void;
  onTakeover: (placement: SkillPlacement) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`skill-placement-controls${compact ? ' is-inline' : ''}`}
      role="group"
      aria-label={`${skillName} 投放位置`}
    >
      {[...placements]
        .sort((a, b) => Number(a.location === 'shared') - Number(b.location === 'shared'))
        .map((placement) => {
          const isPlaced = placement.state === 'placed';
          const reason =
            placement.reason ??
            (placement.sourceIsTarget && !placement.withdrawable
              ? '该位置同时保存主副本，无法独立撤回。'
              : undefined);
          if (compact) {
            const blocked =
              pending || placement.state === 'conflict' || (isPlaced && !placement.withdrawable);
            const action =
              placement.state === 'unmanaged' ? '查看详情并接管' : isPlaced ? '撤回投放' : '投放';
            const label = locationsForTarget(placement)
              .map((location) => skillLocationLabels[location])
              .join(' / ');
            const description = `${label}\n${placement.path}${placement.physicalPath !== placement.path ? `\n实际路径：${placement.physicalPath}` : ''}\n${stateLabels[placement.state]} · ${reason ?? action}`;
            const StateIcon = { placed: Check, absent: Minus, unmanaged: Plus, conflict: X }[
              placement.state
            ];
            return (
              <Tooltip
                key={`${placement.location}:${placement.physicalPath}`}
                content={description}
              >
                {(id) => (
                  <button
                    type="button"
                    className={`skill-placement-icon is-${placement.state}`}
                    aria-label={`投放位置：${skillName}，${label}，${placement.path}，${action}`}
                    aria-describedby={id}
                    aria-pressed={
                      placement.state === 'placed' || placement.state === 'absent'
                        ? isPlaced
                        : undefined
                    }
                    aria-disabled={blocked}
                    onClick={() => {
                      if (!blocked) {
                        if (placement.state === 'unmanaged') onTakeover(placement);
                        else onSetPlacement(placement, !isPlaced);
                      }
                    }}
                  >
                    <LocationMark location={placement.location} />
                    <span className="skill-placement-indicator">
                      <StateIcon size={9} strokeWidth={2.5} />
                    </span>
                  </button>
                )}
              </Tooltip>
            );
          }
          return (
            <div
              key={`${placement.location}:${placement.physicalPath}`}
              className={`skill-placement-row is-${placement.state}`}
            >
              <PlacementIdentity target={placement} />
              <span className="skill-placement-state">{stateLabels[placement.state]}</span>
              {placement.state === 'unmanaged' ? (
                <button
                  type="button"
                  className="skill-button"
                  onClick={() => onTakeover(placement)}
                  disabled={pending}
                  aria-label={`接管 ${skillName} 在 ${placement.path} 的已有条目`}
                >
                  接管…
                </button>
              ) : (
                <label className="skill-placement-switch">
                  <input
                    type="checkbox"
                    checked={isPlaced}
                    disabled={
                      pending ||
                      placement.state === 'conflict' ||
                      (isPlaced && !placement.withdrawable)
                    }
                    onChange={(event) => onSetPlacement(placement, event.target.checked)}
                    aria-label={`${skillName}，${skillLocationLabels[placement.location]}，${placement.path}，${isPlaced ? '撤回投放' : '投放'}`}
                  />
                  <span aria-hidden="true" />
                </label>
              )}
              {reason && <span className="skill-placement-reason">{reason}</span>}
            </div>
          );
        })}
    </div>
  );
}
