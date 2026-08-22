import { init as initWdioPlugin } from '@wdio/tauri-plugin';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as skillsApi from '../../src/lib/api/skills';
import * as settingsApi from '../../src/lib/api/settings';
import type { InstalledSkill, SkillRepo } from '../../src/types';

// 初始化 WDIO Tauri plugin 前端侧（提供 execute/mock 所需的 __wdio_original_core__）。
void initWdioPlugin();

interface SmokeResult {
  settings?: { storageLocation: string; syncMethod: string };
  repos?: SkillRepo[];
  installed?: InstalledSkill[];
  error?: string;
}

function SmokeApp() {
  const [result, setResult] = useState<SmokeResult | null>(null);

  useEffect(() => {
    async function run() {
      try {
        const [settings, repos, installed] = await Promise.all([
          settingsApi.getSettings(),
          skillsApi.getSkillRepos(),
          skillsApi.getInstalledSkills(),
        ]);
        setResult({ settings, repos, installed });
      } catch (error) {
        setResult({ error: error instanceof Error ? error.message : String(error) });
      }
    }
    void run();
  }, []);

  if (result === null) {
    return <div data-testid="smoke-loading">加载中…</div>;
  }

  if (result.error !== undefined) {
    return <div data-testid="smoke-error">错误：{result.error}</div>;
  }

  return (
    <div data-testid="smoke-result">
      <div data-testid="smoke-settings">{JSON.stringify(result.settings)}</div>
      <div data-testid="smoke-repos">{JSON.stringify(result.repos)}</div>
      <div data-testid="smoke-installed-count">{result.installed?.length ?? -1}</div>
      <div data-testid="smoke-installed">{JSON.stringify(result.installed)}</div>
    </div>
  );
}

const container = document.getElementById('root');
if (container === null) {
  throw new Error('缺少 #root 挂载点');
}

createRoot(container).render(<SmokeApp />);
