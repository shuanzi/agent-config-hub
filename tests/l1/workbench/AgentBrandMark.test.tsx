// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import codexSvg from '../../../src/assets/agent-logos/codex.svg?raw';
import { AgentBrandMark, WORKBENCH_AGENTS } from '../../../src/components/workbench/AgentBrandMark';

describe('AgentBrandMark', () => {
  afterEach(cleanup);

  it('renders every supported Agent through the shared centered container', () => {
    render(
      <div>
        {WORKBENCH_AGENTS.map((app) => (
          <AgentBrandMark key={app} app={app} size={18} decorative={false} />
        ))}
      </div>,
    );

    for (const app of WORKBENCH_AGENTS) {
      const mark = document.querySelector<HTMLElement>(`[data-agent-brand="${app}"]`);
      const image = mark?.querySelector<HTMLImageElement>('img');
      expect(mark?.classList.contains('agent-brand-mark')).toBe(true);
      expect(image?.width).toBe(18);
      expect(image?.height).toBe(18);
    }
    expect(screen.getByRole('img', { name: 'Codex' })).toBeTruthy();
  });

  it('uses a dark Codex mark that stays visible on light surfaces', () => {
    expect(codexSvg).toContain('fill="#111111"');
    expect(codexSvg).not.toContain('fill="#FFFFFF"');
  });
});
