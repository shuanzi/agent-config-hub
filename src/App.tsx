import { useMemo, useState } from 'react';
import type { AgentType } from './types';
import { InstalledSkillsPanel } from './components/skills/InstalledSkillsPanel';
import { SkillsDiscoveryPage } from './components/skills/SkillsDiscoveryPage';
import { InstalledSubagentsPanel } from './components/subagents/InstalledSubagentsPanel';
import { SubagentsDiscoveryPage } from './components/subagents/SubagentsDiscoveryPage';
import { InstructionsPanel } from './components/instructions/InstructionsPanel';
import { SettingsView } from './components/settings/SettingsView';

type View = 'skills' | 'instructions' | 'subagents' | 'settings';
type SkillsSubView = 'installed' | 'discovery';
type SubagentsSubView = 'installed' | 'discovery';

const viewLabels: Record<View, string> = {
  skills: 'Skills',
  instructions: '长期指令',
  subagents: 'Subagents',
  settings: '设置',
};

const agentLabels: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
};

const AGENTS: AgentType[] = ['claude-code', 'codex', 'gemini-cli', 'opencode'];

export function App() {
  const [currentView, setCurrentView] = useState<View>('skills');
  const [skillsSubView, setSkillsSubView] = useState<SkillsSubView>('installed');
  const [subagentsSubView, setSubagentsSubView] = useState<SubagentsSubView>('installed');
  const [activeApp, setActiveApp] = useState<AgentType>('claude-code');

  const title = useMemo(() => {
    if (currentView === 'subagents') {
      return subagentsSubView === 'installed' ? '已安装 Subagents' : '发现 Subagents';
    }
    if (currentView === 'skills') {
      return skillsSubView === 'installed' ? '已安装 Skills' : '发现 Skills';
    }
    return viewLabels[currentView];
  }, [currentView, skillsSubView, subagentsSubView]);

  return (
    <div className="workbench">
      <header className="app-header">
        <div className="app-header-brand">
          <h1 className="app-title">Agent Config Manager</h1>
          <span className="app-header-page-title" aria-live="polite">
            {title}
          </span>
        </div>
        <nav className="top-nav" aria-label="主导航">
          <div className="tablist">
            {(Object.keys(viewLabels) as View[]).map((view) => (
              <button
                key={view}
                type="button"
                className={currentView === view ? 'tab tab-selected' : 'tab'}
                onClick={() => setCurrentView(view)}
                aria-current={currentView === view ? 'page' : undefined}
              >
                {viewLabels[view]}
              </button>
            ))}
          </div>
        </nav>
        <div className="agent-selector">
          <label htmlFor="active-app">当前 Agent</label>
          <select
            id="active-app"
            value={activeApp}
            onChange={(event) => setActiveApp(event.target.value as AgentType)}
          >
            {AGENTS.map((app) => (
              <option key={app} value={app}>
                {agentLabels[app]}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="workbench-main app-shell-main">
        {currentView === 'skills' && (
          <div className="skills-view">
            <div className="sub-tabs">
              <button
                type="button"
                className={skillsSubView === 'installed' ? 'sub-tab active' : 'sub-tab'}
                onClick={() => setSkillsSubView('installed')}
              >
                已安装
              </button>
              <button
                type="button"
                className={skillsSubView === 'discovery' ? 'sub-tab active' : 'sub-tab'}
                onClick={() => setSkillsSubView('discovery')}
              >
                发现
              </button>
            </div>
            <div className="skills-view-content">
              {skillsSubView === 'installed' ? (
                <InstalledSkillsPanel activeApp={activeApp} />
              ) : (
                <SkillsDiscoveryPage activeApp={activeApp} />
              )}
            </div>
          </div>
        )}
        {currentView === 'instructions' && <InstructionsPanel activeApp={activeApp} />}
        {currentView === 'subagents' && (
          <div className="subagents-view">
            <div className="sub-tabs">
              <button
                type="button"
                className={subagentsSubView === 'installed' ? 'sub-tab active' : 'sub-tab'}
                onClick={() => setSubagentsSubView('installed')}
              >
                已安装
              </button>
              <button
                type="button"
                className={subagentsSubView === 'discovery' ? 'sub-tab active' : 'sub-tab'}
                onClick={() => setSubagentsSubView('discovery')}
              >
                发现
              </button>
            </div>
            <div className="subagents-view-content">
              {subagentsSubView === 'installed' ? (
                <InstalledSubagentsPanel activeApp={activeApp} />
              ) : (
                <SubagentsDiscoveryPage activeApp={activeApp} />
              )}
            </div>
          </div>
        )}
        {currentView === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
