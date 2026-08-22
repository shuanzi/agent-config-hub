import type {
  AgentType,
  DiscoverableSkill,
  DiscoverableSubagent,
  InstalledSkill,
  InstalledSubagent,
  Prompt,
  SkillBackupEntry,
  SkillRepo,
  SubagentBackupEntry,
  SubagentRepo,
  UnmanagedSkill,
} from '../../src/types';

declare global {
  interface Window {
    __ACM_MOCK_INVOKE__?: (cmd: string, args?: Record<string, unknown>) => unknown;
    __ACM_MOCK_STATE__?: MockState;
  }
}

interface MockState {
  repos: SkillRepo[];
  installed: InstalledSkill[];
  discoverable: DiscoverableSkill[];
  backups: SkillBackupEntry[];
  subagentRepos: SubagentRepo[];
  installedSubagents: InstalledSubagent[];
  discoverableSubagents: DiscoverableSubagent[];
  subagentBackups: SubagentBackupEntry[];
  prompts: Record<AgentType, Record<string, Prompt>>;
  liveFiles: Record<AgentType, string | null>;
}

function createInstalledSkill(skill: DiscoverableSkill, app: AgentType): InstalledSkill {
  return {
    id: skill.key,
    name: skill.name,
    description: skill.description || undefined,
    directory: skill.directory.split('/').pop() ?? skill.directory,
    repoOwner: skill.repoOwner,
    repoName: skill.repoName,
    repoBranch: skill.repoBranch,
    readmeUrl: skill.readmeUrl,
    apps: {
      claudeCode: app === 'claude-code',
      codex: app === 'codex',
      geminiCli: app === 'gemini-cli',
      opencode: app === 'opencode',
    },
    installedAt: Date.now() / 1000,
    updatedAt: 0,
  };
}

function createInstalledSubagent(
  subagent: DiscoverableSubagent,
  app: AgentType,
): InstalledSubagent {
  return {
    id: subagent.key,
    name: subagent.name,
    description: subagent.description || undefined,
    directory: subagent.directory.split('/').pop() ?? subagent.directory,
    repoOwner: subagent.repoOwner,
    repoName: subagent.repoName,
    repoBranch: subagent.repoBranch,
    readmeUrl: subagent.readmeUrl,
    apps: {
      claudeCode: app === 'claude-code',
      codex: app === 'codex',
      geminiCli: app === 'gemini-cli',
      opencode: app === 'opencode',
    },
    installedAt: Date.now() / 1000,
    updatedAt: 0,
  };
}

const initialRepos: SkillRepo[] = [
  { owner: 'anthropics', name: 'skills', branch: 'main', enabled: true },
];

const initialDiscoverable: DiscoverableSkill[] = [
  {
    key: 'anthropics/skills:commit-conventions',
    name: 'Commit Conventions',
    description: 'A skill for consistent commit messages.',
    directory: 'commit-conventions',
    repoOwner: 'anthropics',
    repoName: 'skills',
    repoBranch: 'main',
    readmeUrl: 'https://github.com/anthropics/skills/blob/main/commit-conventions/README.md',
  },
  {
    key: 'anthropics/skills:code-review',
    name: 'Code Review',
    description: 'A skill for structured code reviews.',
    directory: 'code-review',
    repoOwner: 'anthropics',
    repoName: 'skills',
    repoBranch: 'main',
  },
];

const initialSubagentRepos: SubagentRepo[] = [
  { owner: 'anthropics', name: 'subagents', branch: 'main', enabled: true },
];

const initialDiscoverableSubagents: DiscoverableSubagent[] = [
  {
    key: 'anthropics/subagents:pr-reviewer',
    name: 'PR Reviewer',
    description: 'A subagent for structured pull request reviews.',
    directory: 'pr-reviewer',
    path: 'pr-reviewer',
    repoOwner: 'anthropics',
    repoName: 'subagents',
    repoBranch: 'main',
    readmeUrl: 'https://github.com/anthropics/subagents/blob/main/pr-reviewer/README.md',
  },
  {
    key: 'anthropics/subagents:doc-writer',
    name: 'Doc Writer',
    description: 'A subagent for documentation writing.',
    directory: 'doc-writer',
    path: 'doc-writer',
    repoOwner: 'anthropics',
    repoName: 'subagents',
    repoBranch: 'main',
  },
];

export function setupMockInvoke() {
  const state: MockState = {
    repos: [...initialRepos],
    installed: [],
    discoverable: [...initialDiscoverable],
    backups: [],
    subagentRepos: [...initialSubagentRepos],
    installedSubagents: [],
    discoverableSubagents: [...initialDiscoverableSubagents],
    subagentBackups: [],
    prompts: {
      'claude-code': {},
      codex: {},
      'gemini-cli': {},
      opencode: {},
    },
    liveFiles: {
      'claude-code': null,
      codex: null,
      'gemini-cli': null,
      opencode: null,
    },
  };

  window.__ACM_MOCK_STATE__ = state;

  window.__ACM_MOCK_INVOKE__ = (cmd, args) => {
    switch (cmd) {
      case 'get_settings_command':
        return { syncMethod: 'auto', storageLocation: 'hub' };

      case 'get_skill_repos':
        return state.repos;

      case 'get_installed_skills':
        return state.installed;

      case 'discover_available_skills':
        return state.discoverable;

      case 'install_skill': {
        const skill = args?.skill as DiscoverableSkill;
        const currentApp = (args?.currentApp as AgentType) ?? 'claude-code';
        const existingIndex = state.installed.findIndex((s) => s.id === skill.key);
        if (existingIndex >= 0) {
          const existing = state.installed[existingIndex];
          existing.apps = {
            claudeCode: existing.apps.claudeCode || currentApp === 'claude-code',
            codex: existing.apps.codex || currentApp === 'codex',
            geminiCli: existing.apps.geminiCli || currentApp === 'gemini-cli',
            opencode: existing.apps.opencode || currentApp === 'opencode',
          };
          return existing;
        }
        const installed = createInstalledSkill(skill, currentApp);
        state.installed.push(installed);
        return installed;
      }

      case 'uninstall_skill': {
        const id = args?.id as string;
        const index = state.installed.findIndex((s) => s.id === id);
        if (index >= 0) {
          const [removed] = state.installed.splice(index, 1);
          state.backups.push({
            backupId: `bak-${removed.id}`,
            backupPath: `/tmp/backups/${removed.id}`,
            createdAt: Date.now() / 1000,
            skill: removed,
          });
        }
        return { backupPath: `/tmp/backups/${id}` };
      }

      case 'toggle_skill_app': {
        const id = args?.id as string;
        const app = args?.app as AgentType;
        const enabled = args?.enabled as boolean;
        const skill = state.installed.find((s) => s.id === id);
        if (skill !== undefined) {
          skill.apps = {
            ...skill.apps,
            [app === 'claude-code' ? 'claudeCode' : app === 'gemini-cli' ? 'geminiCli' : app]:
              enabled,
          };
        }
        return undefined;
      }

      case 'get_skill_backups':
        return state.backups;

      case 'restore_skill_backup': {
        const backupId = args?.backupId as string;
        const currentApp = (args?.currentApp as AgentType) ?? 'claude-code';
        const backup = state.backups.find((b) => b.backupId === backupId);
        if (backup === undefined) throw new Error('Backup not found');
        const restored: InstalledSkill = {
          ...backup.skill,
          apps: {
            claudeCode: currentApp === 'claude-code',
            codex: currentApp === 'codex',
            geminiCli: currentApp === 'gemini-cli',
            opencode: currentApp === 'opencode',
          },
        };
        state.installed.push(restored);
        return restored;
      }

      case 'delete_skill_backup': {
        const backupId = args?.backupId as string;
        state.backups = state.backups.filter((b) => b.backupId !== backupId);
        return undefined;
      }

      case 'scan_unmanaged_skills':
        return [] as UnmanagedSkill[];

      case 'add_skill_repo': {
        const repo = args?.repo as SkillRepo;
        state.repos.push(repo);
        state.discoverable.push({
          key: `${repo.owner}/${repo.name}:sample`,
          name: 'Sample Skill',
          description: 'A sample skill from the added repo.',
          directory: 'sample',
          repoOwner: repo.owner,
          repoName: repo.name,
          repoBranch: repo.branch,
        });
        return undefined;
      }

      case 'remove_skill_repo': {
        const owner = args?.owner as string;
        const name = args?.name as string;
        state.repos = state.repos.filter((r) => !(r.owner === owner && r.name === name));
        state.discoverable = state.discoverable.filter(
          (s) => !(s.repoOwner === owner && s.repoName === name),
        );
        return undefined;
      }

      case 'check_skill_updates':
        return [];

      case 'update_skill':
        return state.installed.find((s) => s.id === args?.id) ?? {};

      case 'migrate_skill_storage':
        return { migratedCount: 0, skippedCount: 0, errors: [] };

      case 'install_skills_from_zip':
        return [];

      case 'import_skills_from_apps':
        return [];

      case 'get_subagent_repos':
        return state.subagentRepos;

      case 'get_installed_subagents':
        return state.installedSubagents;

      case 'discover_available_subagents':
        return state.discoverableSubagents;

      case 'install_subagent': {
        const subagent = args?.subagent as DiscoverableSubagent;
        const currentApp = (args?.currentApp as AgentType) ?? 'claude-code';
        const existingIndex = state.installedSubagents.findIndex((s) => s.id === subagent.key);
        if (existingIndex >= 0) {
          const existing = state.installedSubagents[existingIndex];
          existing.apps = {
            claudeCode: existing.apps.claudeCode || currentApp === 'claude-code',
            codex: existing.apps.codex || currentApp === 'codex',
            geminiCli: existing.apps.geminiCli || currentApp === 'gemini-cli',
            opencode: existing.apps.opencode || currentApp === 'opencode',
          };
          return existing;
        }
        const installed = createInstalledSubagent(subagent, currentApp);
        state.installedSubagents.push(installed);
        return installed;
      }

      case 'uninstall_subagent': {
        const id = args?.id as string;
        const index = state.installedSubagents.findIndex((s) => s.id === id);
        if (index >= 0) {
          const [removed] = state.installedSubagents.splice(index, 1);
          state.subagentBackups.push({
            backupId: `bak-${removed.id}`,
            backupPath: `/tmp/backups/${removed.id}`,
            createdAt: Date.now() / 1000,
            subagent: removed,
          });
        }
        return { backupPath: `/tmp/backups/${id}` };
      }

      case 'toggle_subagent_app': {
        const id = args?.id as string;
        const app = args?.app as AgentType;
        const enabled = args?.enabled as boolean;
        const subagent = state.installedSubagents.find((s) => s.id === id);
        if (subagent !== undefined) {
          subagent.apps = {
            ...subagent.apps,
            [app === 'claude-code' ? 'claudeCode' : app === 'gemini-cli' ? 'geminiCli' : app]:
              enabled,
          };
        }
        return undefined;
      }

      case 'get_subagent_backups':
        return state.subagentBackups;

      case 'restore_subagent_backup': {
        const backupId = args?.backupId as string;
        const currentApp = (args?.currentApp as AgentType) ?? 'claude-code';
        const backup = state.subagentBackups.find((b) => b.backupId === backupId);
        if (backup === undefined) throw new Error('Backup not found');
        const restored: InstalledSubagent = {
          ...backup.subagent,
          apps: {
            claudeCode: currentApp === 'claude-code',
            codex: currentApp === 'codex',
            geminiCli: currentApp === 'gemini-cli',
            opencode: currentApp === 'opencode',
          },
        };
        state.installedSubagents.push(restored);
        return restored;
      }

      case 'delete_subagent_backup': {
        const backupId = args?.backupId as string;
        state.subagentBackups = state.subagentBackups.filter((b) => b.backupId !== backupId);
        return undefined;
      }

      case 'add_subagent_repo': {
        const repo = args?.repo as SubagentRepo;
        state.subagentRepos.push(repo);
        state.discoverableSubagents.push({
          key: `${repo.owner}/${repo.name}:sample`,
          name: 'Sample Subagent',
          description: 'A sample subagent from the added repo.',
          directory: 'sample',
          path: 'sample',
          repoOwner: repo.owner,
          repoName: repo.name,
          repoBranch: repo.branch,
        });
        return undefined;
      }

      case 'remove_subagent_repo': {
        const owner = args?.owner as string;
        const name = args?.name as string;
        state.subagentRepos = state.subagentRepos.filter(
          (r) => !(r.owner === owner && r.name === name),
        );
        state.discoverableSubagents = state.discoverableSubagents.filter(
          (s) => !(s.repoOwner === owner && s.repoName === name),
        );
        return undefined;
      }

      case 'check_subagent_updates':
        return [];

      case 'update_subagent':
        return state.installedSubagents.find((s) => s.id === args?.id) ?? {};

      case 'migrate_subagent_storage':
        return { migratedCount: 0, skippedCount: 0, errors: [] };

      case 'get_prompts': {
        const app = (args?.app as AgentType) ?? 'claude-code';
        return { ...state.prompts[app] };
      }

      case 'upsert_prompt': {
        const app = (args?.app as AgentType) ?? 'claude-code';
        const id = args?.id as string;
        const prompt = args?.prompt as Prompt;
        state.prompts[app][id] = prompt;
        if (prompt.enabled) {
          for (const other of Object.values(state.prompts[app])) {
            if (other.id !== id) {
              other.enabled = false;
            }
          }
          state.liveFiles[app] = prompt.content;
        }
        return undefined;
      }

      case 'delete_prompt': {
        const app = (args?.app as AgentType) ?? 'claude-code';
        const id = args?.id as string;
        delete state.prompts[app][id];
        return undefined;
      }

      case 'enable_prompt': {
        const app = (args?.app as AgentType) ?? 'claude-code';
        const id = args?.id as string;
        const prompt = state.prompts[app][id];
        if (prompt === undefined) throw new Error('Prompt not found');
        for (const other of Object.values(state.prompts[app])) {
          other.enabled = false;
        }
        prompt.enabled = true;
        state.liveFiles[app] = prompt.content;
        return undefined;
      }

      case 'import_prompt_from_file': {
        const app = (args?.app as AgentType) ?? 'claude-code';
        const content = state.liveFiles[app];
        if (content === null || content === '') throw new Error('指令文件不存在');
        const id = `imported-${Date.now()}`;
        state.prompts[app][id] = {
          id,
          name: `导入的指令 ${new Date().toLocaleString()}`,
          content,
          description: '从现有配置文件导入',
          enabled: false,
          createdAt: Date.now() / 1000,
          updatedAt: Date.now() / 1000,
        };
        return id;
      }

      case 'get_current_prompt_file_content': {
        const app = (args?.app as AgentType) ?? 'claude-code';
        return state.liveFiles[app];
      }

      default:
        throw new Error(`Unhandled mock command: ${cmd}`);
    }
  };
}
