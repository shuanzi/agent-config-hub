import { init as initWdioPlugin } from '@wdio/tauri-plugin';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as skillsApi from '../../src/lib/api/skills';
import * as settingsApi from '../../src/lib/api/settings';
import * as promptsApi from '../../src/lib/api/prompts';
import * as subagentsApi from '../../src/lib/api/subagents';
import * as projectsApi from '../../src/lib/api/projects';
import type { InstalledSkill, ProjectSummary, ScopeTarget, SkillRepo } from '../../src/types';

// 初始化 WDIO Tauri plugin 前端侧（提供 execute/mock 所需的 __wdio_original_core__）。
void initWdioPlugin();

// 由 vite.l3.config.ts 的 define 在构建期注入（从仓库根解析 fixture 路径，
// 不再硬编码本机 worktree 路径）。
declare const __L3_SMOKE_FIXTURE_ZIP__: string;
const FIXTURE_ZIP = __L3_SMOKE_FIXTURE_ZIP__;
const GLOBAL_CONTEXT = { kind: 'global' } as const;
const GLOBAL_TARGET: ScopeTarget = { scope: 'global' };

interface SmokeResult {
  settings?: { storageLocation: string; syncMethod: string };
  repos?: SkillRepo[];
  installed?: InstalledSkill[];
  skillSequence?: {
    installed: InstalledSkill[];
    toggled: InstalledSkill[];
    uninstalledCount: number;
  };
  instructionSequence?: {
    claudeContent: string;
    agentsContent: string;
    agentsAppliesTo: string[];
  };
  subagentSequence?: {
    installedCount: number;
    repoCount: number;
    removed: boolean;
  };
  migrationSequence?: {
    skillMigratedCount: number;
    subagentMigratedCount: number;
  };
  projectRegistrySequence?: {
    firstProject: ProjectSummary;
    secondProject: ProjectSummary;
    listedAfterAdd: ProjectSummary[];
    projectSkill: InstalledSkill;
    projectSkillsAfterRelink: InstalledSkill[];
    relinked: ProjectSummary;
    listedAfterRemove: ProjectSummary[];
  };
  error?: string;
}

function projectRootsFromQuery(): [string, string, string] | undefined {
  const roots = new URLSearchParams(window.location.search).getAll('projectRoot');
  if (roots.length === 0) return undefined;
  if (roots.length !== 3 || roots.some((root) => root.trim() === '')) {
    throw new Error('L3 project registry journey requires three temporary project roots');
  }
  return [roots[0], roots[1], roots[2]];
}

function SmokeApp() {
  const [result, setResult] = useState<SmokeResult | null>(null);

  useEffect(() => {
    async function run() {
      try {
        const [settings, repos, installed] = await Promise.all([
          settingsApi.getSettings(),
          skillsApi.getSkillRepos(),
          skillsApi.getInstalledSkills(GLOBAL_CONTEXT),
        ]);

        // Skill 写序列：安装 fixture zip -> 切换 codex 开关 -> 断言 DTO -> 卸载
        const zipInstalled = await skillsApi.installSkillsFromZip(
          FIXTURE_ZIP,
          'codex',
          GLOBAL_TARGET,
        );
        const installedSkill = zipInstalled[0];
        if (installedSkill === undefined) {
          throw new Error('install_skills_from_zip returned empty');
        }
        await skillsApi.toggleSkillApp(installedSkill.id, installedSkill.target, 'codex', true);
        const toggled = await skillsApi.getInstalledSkills(GLOBAL_CONTEXT);
        await skillsApi.uninstallSkill(installedSkill.id, installedSkill.target);
        const uninstalled = await skillsApi.getInstalledSkills(GLOBAL_CONTEXT);

        // 长期指令写序列：两种固定文档直接写入，再通过全局读取确认。
        await promptsApi.upsertInstructionDocument(
          { scope: 'global' },
          'claude',
          'l3 smoke CLAUDE.md content',
        );
        await promptsApi.upsertInstructionDocument(
          { scope: 'global' },
          'agents',
          'l3 smoke AGENTS.md content',
        );
        const instructionDocuments = await promptsApi.getInstructionDocuments({ kind: 'global' });
        const claudeDocument = instructionDocuments.find((document) => document.kind === 'claude');
        const agentsDocument = instructionDocuments.find((document) => document.kind === 'agents');
        if (claudeDocument === undefined || agentsDocument === undefined) {
          throw new Error('get_instruction_documents must return both fixed documents');
        }

        // Subagent 读取使用完整 context；仓库写序列保持既有真实 IPC 旅程。
        const seededSubagents = await subagentsApi.getInstalledSubagents(GLOBAL_CONTEXT);
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

        // Project registry 写序列：同名项目保留各自 opaque ID，重新关联不改变 ID，最后解除登记。
        const projectRoots = projectRootsFromQuery();
        const projectRegistrySequence =
          projectRoots === undefined
            ? undefined
            : await (async () => {
                const [firstRoot, secondRoot, relinkedRoot] = projectRoots;
                const duplicateDisplayName = 'L3 同名项目';
                const firstProject = await projectsApi.addProject({
                  rootPath: firstRoot,
                  displayName: duplicateDisplayName,
                });
                const secondProject = await projectsApi.addProject({
                  rootPath: secondRoot,
                  displayName: duplicateDisplayName,
                });
                const listedAfterAdd = await projectsApi.listProjects();
                const projectTarget: ScopeTarget = {
                  scope: 'project',
                  projectId: firstProject.projectId,
                };
                const projectInstalled = await skillsApi.installSkillsFromZip(
                  FIXTURE_ZIP,
                  'codex',
                  projectTarget,
                );
                const projectSkill = projectInstalled[0];
                if (projectSkill === undefined) {
                  throw new Error('project install_skills_from_zip returned empty');
                }
                const relinked = await projectsApi.relinkProjectRoot({
                  projectId: firstProject.projectId,
                  rootPath: relinkedRoot,
                });
                const projectSkillsAfterRelink = await skillsApi.getInstalledSkills({
                  kind: 'project',
                  projectId: firstProject.projectId,
                });
                await skillsApi.uninstallSkill(projectSkill.id, projectTarget);
                const projectBackups = await skillsApi.getSkillBackups(projectTarget);
                await Promise.all(
                  projectBackups.map((backup) =>
                    skillsApi.deleteSkillBackup(backup.backupId, projectTarget),
                  ),
                );
                await projectsApi.removeProject(firstProject.projectId);
                await projectsApi.removeProject(secondProject.projectId);
                const listedAfterRemove = await projectsApi.listProjects();

                return {
                  firstProject,
                  secondProject,
                  listedAfterAdd,
                  projectSkill,
                  projectSkillsAfterRelink,
                  relinked,
                  listedAfterRemove,
                };
              })();

        setResult({
          settings,
          repos,
          installed,
          skillSequence: {
            installed: zipInstalled,
            toggled,
            uninstalledCount: uninstalled.length,
          },
          instructionSequence: {
            claudeContent: claudeDocument.content,
            agentsContent: agentsDocument.content,
            agentsAppliesTo: agentsDocument.appliesTo,
          },
          subagentSequence: {
            installedCount: seededSubagents.length,
            repoCount: subagentRepos.length,
            removed: subagentReposAfter.length === subagentRepos.length - 1,
          },
          migrationSequence: {
            skillMigratedCount: migration.skill.migratedCount,
            subagentMigratedCount: migration.subagent.migratedCount,
          },
          projectRegistrySequence,
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
      <div data-testid="smoke-instruction-documents">
        {JSON.stringify(result.instructionSequence)}
      </div>
      <div data-testid="smoke-subagent-repo-count">{result.subagentSequence?.repoCount}</div>
      <div data-testid="smoke-subagent-installed-count">
        {result.subagentSequence?.installedCount}
      </div>
      <div data-testid="smoke-subagent-removed">
        {result.subagentSequence?.removed ? 'true' : 'false'}
      </div>
      <div data-testid="smoke-migration-skill">{result.migrationSequence?.skillMigratedCount}</div>
      <div data-testid="smoke-migration-subagent">
        {result.migrationSequence?.subagentMigratedCount}
      </div>
      <div data-testid="smoke-project-registry">
        {JSON.stringify(result.projectRegistrySequence)}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container === null) {
  throw new Error('缺少 #root 挂载点');
}

createRoot(container).render(<SmokeApp />);
