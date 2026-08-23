import { init as initWdioPlugin } from '@wdio/tauri-plugin';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as skillsApi from '../../src/lib/api/skills';
import * as settingsApi from '../../src/lib/api/settings';
import * as promptsApi from '../../src/lib/api/prompts';
import * as subagentsApi from '../../src/lib/api/subagents';
import type { InstalledSkill, Prompt, SkillRepo } from '../../src/types';

// 初始化 WDIO Tauri plugin 前端侧（提供 execute/mock 所需的 __wdio_original_core__）。
void initWdioPlugin();

const FIXTURE_ZIP =
  '/Users/xiquandai/.codex/worktrees/39d9/agent_config_hub/fixtures/l3/l3-smoke-skills.zip';

interface SmokeResult {
  settings?: { storageLocation: string; syncMethod: string };
  repos?: SkillRepo[];
  installed?: InstalledSkill[];
  skillSequence?: {
    installed: InstalledSkill[];
    toggled: InstalledSkill[];
    uninstalledCount: number;
  };
  promptSequence?: {
    liveContent: string | null;
  };
  subagentSequence?: {
    repoCount: number;
    removed: boolean;
  };
  migrationSequence?: {
    skillMigratedCount: number;
    subagentMigratedCount: number;
  };
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

        // Skill 写序列：安装 fixture zip -> 切换 codex 开关 -> 断言 DTO -> 卸载
        const zipInstalled = await skillsApi.installSkillsFromZip(FIXTURE_ZIP, 'codex');
        const installedSkill = zipInstalled[0];
        if (installedSkill === undefined) {
          throw new Error('install_skills_from_zip returned empty');
        }
        await skillsApi.toggleSkillApp(installedSkill.id, 'codex', true);
        const toggled = await skillsApi.getInstalledSkills();
        await skillsApi.uninstallSkill(installedSkill.id);
        const uninstalled = await skillsApi.getInstalledSkills();

        // Prompt 写序列：upsert -> enable -> 读取 live 内容
        // 已启用的预设不能直接删除，这里跳过 delete 以验证 upsert/enable/live 读取路径。
        const prompt: Prompt = {
          id: 'l3-smoke-prompt',
          name: 'L3 Smoke Prompt',
          content: 'l3 smoke prompt content',
          description: 'test',
          enabled: false,
        };
        await promptsApi.upsertPrompt('codex', prompt.id, prompt);
        await promptsApi.enablePrompt('codex', prompt.id);
        const liveContent = await promptsApi.getCurrentPromptFileContent('codex');

        // Subagent 写序列：add repo -> list -> remove
        await subagentsApi.addSubagentRepo({
          owner: 'l3-smoke',
          name: 'subagents',
          branch: 'main',
          enabled: false,
        });
        const subagentRepos = await subagentsApi.getSubagentRepos();
        await subagentsApi.removeSubagentRepo('l3-smoke', 'subagents');
        const subagentReposAfter = await subagentsApi.getSubagentRepos();

        // 组合迁移：在空状态下调用，应返回 zeros
        const migration = await settingsApi.migrateStorage('unified');

        setResult({
          settings,
          repos,
          installed,
          skillSequence: {
            installed: zipInstalled,
            toggled,
            uninstalledCount: uninstalled.length,
          },
          promptSequence: {
            liveContent,
          },
          subagentSequence: {
            repoCount: subagentRepos.length,
            removed: subagentReposAfter.length === subagentRepos.length - 1,
          },
          migrationSequence: {
            skillMigratedCount: migration.skill.migratedCount,
            subagentMigratedCount: migration.subagent.migratedCount,
          },
        });
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
      <div data-testid="smoke-skill-installed">
        {JSON.stringify(result.skillSequence?.installed)}
      </div>
      <div data-testid="smoke-skill-toggled">{JSON.stringify(result.skillSequence?.toggled)}</div>
      <div data-testid="smoke-skill-uninstalled-count">
        {result.skillSequence?.uninstalledCount}
      </div>
      <div data-testid="smoke-prompt-live">{result.promptSequence?.liveContent}</div>
      <div data-testid="smoke-subagent-repo-count">{result.subagentSequence?.repoCount}</div>
      <div data-testid="smoke-subagent-removed">
        {result.subagentSequence?.removed ? 'true' : 'false'}
      </div>
      <div data-testid="smoke-migration-skill">{result.migrationSequence?.skillMigratedCount}</div>
      <div data-testid="smoke-migration-subagent">
        {result.migrationSequence?.subagentMigratedCount}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container === null) {
  throw new Error('缺少 #root 挂载点');
}

createRoot(container).render(<SmokeApp />);
