import type {
  AgentType,
  ConfigContext,
  DiscoverableSkill,
  DiscoverableSubagent,
  InstalledSkill,
  InstalledSubagent,
  ScopeTarget,
  SkillBackupEntry,
  SkillRepo,
  SkillUpdateInfo,
  SubagentBackupEntry,
  SubagentRepo,
  SubagentUpdateInfo,
  UnmanagedSkill,
} from '../../src/types';

declare global {
  interface Window {
    __ACM_MOCK_INVOKE__?: (cmd: string, args?: Record<string, unknown>) => unknown;
    __ACM_MOCK_STATE__?: MockState;
  }
}

interface MockState {
  projects: ProjectSummaryFixture[];
  repos: SkillRepo[];
  installed: InstalledSkill[];
  discoverable: DiscoverableSkill[];
  backups: SkillBackupEntry[];
  subagentRepos: SubagentRepo[];
  installedSubagents: InstalledSubagent[];
  discoverableSubagents: DiscoverableSubagent[];
  subagentBackups: SubagentBackupEntry[];
  instructionDocuments: Record<string, InstructionDocumentFixture[]>;
  skillUpdates: SkillUpdateInfo[];
  subagentUpdates: SubagentUpdateInfo[];
}

/** 对应项目 registry 的 `list_projects` command DTO。 */
interface ProjectSummaryFixture {
  projectId: string;
  displayName: string;
  rootPath: string;
}

type InstructionKind = 'claude' | 'agents';

interface InstructionDocumentFixture {
  kind: InstructionKind;
  fileName: 'CLAUDE.md' | 'AGENTS.md';
  appliesTo: readonly ('claude-code' | 'codex' | 'opencode')[];
  target: { scope: 'global' } | { scope: 'project'; projectId: string };
  content: string;
  exists: boolean;
  updatedAt?: number;
}

function createInstalledSkill(
  skill: DiscoverableSkill,
  app: AgentType,
  target: ScopeTarget = { scope: 'global' },
): InstalledSkill {
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
    target,
  };
}

function sameTarget(left: ScopeTarget, right: ScopeTarget): boolean {
  return (
    left.scope === right.scope &&
    (left.scope !== 'project' || (right.scope === 'project' && left.projectId === right.projectId))
  );
}

function recordsForContext<T extends { target: ScopeTarget }>(
  records: T[],
  context: ConfigContext,
): T[] {
  if (context.kind === 'all') return records;
  if (context.kind === 'global') {
    return records.filter((record) => record.target.scope === 'global');
  }
  return records.filter(
    (record) =>
      record.target.scope === 'global' ||
      (record.target.scope === 'project' && record.target.projectId === context.projectId),
  );
}

function createInstalledSubagent(
  subagent: DiscoverableSubagent,
  app: AgentType,
  target: ScopeTarget = { scope: 'global' },
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
    target,
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
    installed: false,
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
    installed: false,
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
    installed: false,
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
    installed: false,
  },
];

/**
 * 视觉回归专用数据：仅通过 `?fixture=visual` 启用，默认 L2 空态保持不变。
 * 所有字段均为实际 command DTO 中已有字段，避免测试壳层伪造产品模型。
 */
const visualDiscoverable: DiscoverableSkill[] = [
  ...initialDiscoverable,
  {
    key: 'anthropics/skills:testing-strategy',
    name: 'Testing Strategy',
    description: 'A skill for focused, reliable validation.',
    directory: 'testing-strategy',
    repoOwner: 'anthropics',
    repoName: 'skills',
    repoBranch: 'main',
    installed: false,
    readmeUrl: 'https://github.com/anthropics/skills/blob/main/testing-strategy/README.md',
  },
];

const visualDiscoverableSubagents: DiscoverableSubagent[] = [
  ...initialDiscoverableSubagents,
  {
    key: 'anthropics/subagents:test-runner',
    name: 'Test Runner',
    description: 'A subagent for focused validation.',
    directory: 'test-runner',
    path: 'test-runner',
    repoOwner: 'anthropics',
    repoName: 'subagents',
    repoBranch: 'main',
    installed: false,
    readmeUrl: 'https://github.com/anthropics/subagents/blob/main/test-runner/README.md',
  },
];

const visualProjects: ProjectSummaryFixture[] = [
  {
    projectId: 'visual-project-alpha',
    displayName: '同名项目',
    rootPath: '/workspaces/visual-alpha',
  },
  {
    projectId: 'visual-project-beta',
    displayName: '同名项目',
    rootPath: '/workspaces/visual-beta',
  },
];

function createVisualInstalledSkills(): InstalledSkill[] {
  return [
    {
      ...createInstalledSkill(visualDiscoverable[2], 'claude-code'),
      apps: { claudeCode: true, codex: true, geminiCli: false, opencode: false },
      installedAt: 1724371200,
      updatedAt: 1725148800,
      contentHash: 'visual-testing-strategy',
    },
    {
      ...createInstalledSkill(visualDiscoverable[1], 'codex', {
        scope: 'project',
        projectId: 'visual-project-alpha',
      }),
      apps: { claudeCode: false, codex: true, geminiCli: true, opencode: false },
      installedAt: 1724284800,
      updatedAt: 1725062400,
      contentHash: 'visual-code-review',
    },
    {
      ...createInstalledSkill(visualDiscoverable[0], 'opencode'),
      apps: { claudeCode: true, codex: false, geminiCli: false, opencode: true },
      installedAt: 1724198400,
      updatedAt: 1724976000,
      contentHash: 'visual-commit-conventions',
    },
  ];
}

function createVisualInstalledSubagents(): InstalledSubagent[] {
  return [
    {
      ...createInstalledSubagent(visualDiscoverableSubagents[0], 'claude-code'),
      apps: { claudeCode: true, codex: false, geminiCli: true, opencode: false },
      installedAt: 1724371200,
      updatedAt: 1725148800,
      contentHash: 'visual-pr-reviewer',
    },
    {
      ...createInstalledSubagent(visualDiscoverableSubagents[2], 'opencode', {
        scope: 'project',
        projectId: 'visual-project-alpha',
      }),
      apps: { claudeCode: false, codex: true, geminiCli: false, opencode: true },
      installedAt: 1724284800,
      updatedAt: 1725062400,
      contentHash: 'visual-test-runner',
    },
  ];
}

function createInstructionDocuments(
  target: { scope: 'global' } | { scope: 'project'; projectId: string },
  claudeContent: string,
  agentsContent: string,
): InstructionDocumentFixture[] {
  return [
    {
      kind: 'claude',
      fileName: 'CLAUDE.md',
      appliesTo: ['claude-code'],
      target,
      content: claudeContent,
      exists: claudeContent !== '',
      updatedAt: claudeContent === '' ? undefined : 1725148800,
    },
    {
      kind: 'agents',
      fileName: 'AGENTS.md',
      appliesTo: ['codex', 'opencode'],
      target,
      content: agentsContent,
      exists: agentsContent !== '',
      updatedAt: agentsContent === '' ? undefined : 1725062400,
    },
  ];
}

function hasVisualFixture(): boolean {
  return new URLSearchParams(window.location.search).get('fixture') === 'visual';
}

function hasProjectRootUnavailableScenario(): boolean {
  return new URLSearchParams(window.location.search).get('scenario') === 'project-root-unavailable';
}

function projectRootUnavailableError(projectId: string): Error {
  return new Error(
    JSON.stringify({
      code: 'PROJECT_ROOT_UNAVAILABLE',
      context: { projectId },
      suggestion: 'relinkProject',
    }),
  );
}

export function setupMockInvoke() {
  const visualFixture = hasVisualFixture();
  const state: MockState = {
    projects: visualFixture ? [...visualProjects] : [],
    repos: [...initialRepos],
    installed: visualFixture ? createVisualInstalledSkills() : [],
    discoverable: visualFixture ? [...visualDiscoverable] : [...initialDiscoverable],
    backups: [],
    subagentRepos: [...initialSubagentRepos],
    installedSubagents: visualFixture ? createVisualInstalledSubagents() : [],
    discoverableSubagents: visualFixture
      ? [...visualDiscoverableSubagents]
      : [...initialDiscoverableSubagents],
    subagentBackups: [],
    instructionDocuments: visualFixture
      ? {
          global: createInstructionDocuments(
            { scope: 'global' },
            '# Global Claude instructions',
            '',
          ),
          'project:visual-project-alpha': createInstructionDocuments(
            { scope: 'project', projectId: 'visual-project-alpha' },
            '# Project Claude instructions',
            '# Project shared instructions',
          ),
          'project:visual-project-beta': createInstructionDocuments(
            { scope: 'project', projectId: 'visual-project-beta' },
            '',
            '',
          ),
        }
      : { global: createInstructionDocuments({ scope: 'global' }, '', '') },
    skillUpdates: visualFixture
      ? [
          {
            id: 'anthropics/skills:testing-strategy',
            name: 'Testing Strategy',
            currentHash: 'visual-testing-strategy',
            remoteHash: 'visual-testing-strategy-next',
          },
        ]
      : [],
    subagentUpdates: visualFixture
      ? [
          {
            id: 'anthropics/subagents:pr-reviewer',
            name: 'PR Reviewer',
            currentHash: 'visual-pr-reviewer',
            remoteHash: 'visual-pr-reviewer-next',
          },
        ]
      : [],
  };

  window.__ACM_MOCK_STATE__ = state;

  window.__ACM_MOCK_INVOKE__ = (cmd, args) => {
    switch (cmd) {
      case 'list_projects':
        return state.projects;

      case 'add_project': {
        const rootPath = args?.rootPath as string;
        const displayName =
          (args?.displayName as string | undefined) ??
          rootPath.split('/').filter(Boolean).at(-1) ??
          '未命名项目';
        const project = {
          projectId: `mock-project-${state.projects.length + 1}`,
          displayName,
          rootPath,
        };
        state.projects.push(project);
        return project;
      }

      case 'relink_project_root': {
        const projectId = args?.projectId as string;
        const rootPath = args?.rootPath as string;
        const project = state.projects.find((item) => item.projectId === projectId);
        if (project === undefined) throw new Error('项目不存在');
        project.rootPath = rootPath;
        return undefined;
      }

      case 'remove_project': {
        const projectId = args?.projectId as string;
        state.projects = state.projects.filter((item) => item.projectId !== projectId);
        return undefined;
      }

      case 'get_settings_command':
        return { syncMethod: 'auto', storageLocation: 'hub' };

      case 'get_skill_repos':
        return state.repos;

      case 'get_installed_skills': {
        const context = args?.context as ConfigContext;
        if (
          hasProjectRootUnavailableScenario() &&
          context.kind === 'project' &&
          context.projectId === 'visual-project-alpha'
        ) {
          throw projectRootUnavailableError(context.projectId);
        }
        return recordsForContext(state.installed, context);
      }

      case 'discover_available_skills': {
        const target = args?.target as ScopeTarget;
        return state.discoverable.map((skill) => ({
          ...skill,
          installed: state.installed.some(
            (installed) => installed.id === skill.key && sameTarget(installed.target, target),
          ),
        }));
      }

      case 'install_skill': {
        const skill = args?.skill as DiscoverableSkill;
        const target = args?.target as ScopeTarget;
        const currentApp = (args?.currentApp as AgentType) ?? 'claude-code';
        const existingIndex = state.installed.findIndex(
          (installed) => installed.id === skill.key && sameTarget(installed.target, target),
        );
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
        const installed = createInstalledSkill(skill, currentApp, target);
        state.installed.push(installed);
        return installed;
      }

      case 'uninstall_skill': {
        const id = args?.id as string;
        const target = args?.target as ScopeTarget;
        const index = state.installed.findIndex(
          (installed) => installed.id === id && sameTarget(installed.target, target),
        );
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
        const target = args?.target as ScopeTarget;
        const app = args?.app as AgentType;
        const enabled = args?.enabled as boolean;
        const skill = state.installed.find(
          (installed) => installed.id === id && sameTarget(installed.target, target),
        );
        if (skill !== undefined) {
          skill.apps = {
            ...skill.apps,
            [app === 'claude-code' ? 'claudeCode' : app === 'gemini-cli' ? 'geminiCli' : app]:
              enabled,
          };
        }
        return undefined;
      }

      case 'get_skill_backups': {
        const target = args?.target as ScopeTarget;
        return state.backups.filter((backup) => sameTarget(backup.skill.target, target));
      }

      case 'restore_skill_backup': {
        const backupId = args?.backupId as string;
        const target = args?.target as ScopeTarget;
        const currentApp = (args?.currentApp as AgentType) ?? 'claude-code';
        const backup = state.backups.find(
          (entry) => entry.backupId === backupId && sameTarget(entry.skill.target, target),
        );
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
        const target = args?.target as ScopeTarget;
        state.backups = state.backups.filter(
          (backup) => backup.backupId !== backupId || !sameTarget(backup.skill.target, target),
        );
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
          installed: false,
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
        return state.skillUpdates;

      case 'update_skill': {
        const id = args?.id as string;
        const target = args?.target as ScopeTarget;
        state.skillUpdates = state.skillUpdates.filter((update) => update.id !== id);
        return (
          state.installed.find((skill) => skill.id === id && sameTarget(skill.target, target)) ?? {}
        );
      }

      case 'migrate_storage':
        return {
          skill: { migratedCount: 0, skippedCount: 0, errors: [] },
          subagent: { migratedCount: 0, skippedCount: 0, errors: [] },
          projectionErrors: [],
        };

      case 'set_agent_override_dir':
        return undefined;

      case 'install_skills_from_zip': {
        const filePath = args?.filePath as string;
        const currentApp = args?.currentApp as AgentType;
        const target = args?.target as ScopeTarget;
        const directory =
          filePath
            .split('/')
            .filter(Boolean)
            .at(-1)
            ?.replace(/\.zip$/i, '') ?? 'zip';
        const installed = createInstalledSkill(
          {
            key: `zip:${directory}`,
            name: directory,
            description: '',
            directory,
            repoOwner: 'local',
            repoName: 'zip',
            repoBranch: 'local',
            installed: false,
          },
          currentApp,
          target,
        );
        state.installed.push(installed);
        return [installed];
      }

      case 'import_skills_from_apps': {
        const selections = args?.selections as Array<{
          directory: string;
          apps: InstalledSkill['apps'];
        }>;
        const target = args?.target as ScopeTarget;
        const imported = selections.map(
          (selection) =>
            ({
              id: `import:${selection.directory}`,
              name: selection.directory,
              directory: selection.directory,
              apps: selection.apps,
              installedAt: Date.now() / 1000,
              updatedAt: 0,
              target,
            }) satisfies InstalledSkill,
        );
        state.installed.push(...imported);
        return imported;
      }

      case 'get_subagent_repos':
        return state.subagentRepos;

      case 'get_installed_subagents':
        return recordsForContext(state.installedSubagents, args?.context as ConfigContext);

      case 'discover_available_subagents': {
        const target = args?.target as ScopeTarget;
        return state.discoverableSubagents.map((subagent) => ({
          ...subagent,
          installed: state.installedSubagents.some(
            (installed) => installed.id === subagent.key && sameTarget(installed.target, target),
          ),
        }));
      }

      case 'install_subagent': {
        const subagent = args?.subagent as DiscoverableSubagent;
        const target = args?.target as ScopeTarget;
        const currentApp = (args?.currentApp as AgentType) ?? 'claude-code';
        const existingIndex = state.installedSubagents.findIndex(
          (installed) => installed.id === subagent.key && sameTarget(installed.target, target),
        );
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
        const installed = createInstalledSubagent(subagent, currentApp, target);
        state.installedSubagents.push(installed);
        return installed;
      }

      case 'uninstall_subagent': {
        const id = args?.id as string;
        const target = args?.target as ScopeTarget;
        const index = state.installedSubagents.findIndex(
          (installed) => installed.id === id && sameTarget(installed.target, target),
        );
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
        const target = args?.target as ScopeTarget;
        const app = args?.app as AgentType;
        const enabled = args?.enabled as boolean;
        const subagent = state.installedSubagents.find(
          (installed) => installed.id === id && sameTarget(installed.target, target),
        );
        if (subagent !== undefined) {
          subagent.apps = {
            ...subagent.apps,
            [app === 'claude-code' ? 'claudeCode' : app === 'gemini-cli' ? 'geminiCli' : app]:
              enabled,
          };
        }
        return undefined;
      }

      case 'get_subagent_backups': {
        const target = args?.target as ScopeTarget;
        return state.subagentBackups.filter((backup) => sameTarget(backup.subagent.target, target));
      }

      case 'restore_subagent_backup': {
        const backupId = args?.backupId as string;
        const target = args?.target as ScopeTarget;
        const currentApp = (args?.currentApp as AgentType) ?? 'claude-code';
        const backup = state.subagentBackups.find(
          (entry) => entry.backupId === backupId && sameTarget(entry.subagent.target, target),
        );
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
        const target = args?.target as ScopeTarget;
        state.subagentBackups = state.subagentBackups.filter(
          (backup) => backup.backupId !== backupId || !sameTarget(backup.subagent.target, target),
        );
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
          installed: false,
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
        return state.subagentUpdates;

      case 'update_subagent': {
        const id = args?.id as string;
        const target = args?.target as ScopeTarget;
        state.subagentUpdates = state.subagentUpdates.filter((update) => update.id !== id);
        return (
          state.installedSubagents.find(
            (subagent) => subagent.id === id && sameTarget(subagent.target, target),
          ) ?? {}
        );
      }

      case 'get_instruction_documents': {
        const context = args?.context as
          { kind: 'all' } | { kind: 'global' } | { kind: 'project'; projectId: string };
        const global = state.instructionDocuments.global ?? [];
        if (context.kind === 'global') return structuredClone(global);
        if (context.kind === 'project') {
          return structuredClone([
            ...(state.instructionDocuments[`project:${context.projectId}`] ?? []),
            ...global,
          ]);
        }
        return structuredClone(Object.values(state.instructionDocuments).flat());
      }

      case 'upsert_instruction_document': {
        const target = args?.target as
          { scope: 'global' } | { scope: 'project'; projectId: string };
        const kind = args?.kind as InstructionKind;
        const content = args?.content as string;
        const key = target.scope === 'project' ? `project:${target.projectId}` : 'global';
        const document = state.instructionDocuments[key]?.find((item) => item.kind === kind);
        if (document === undefined) throw new Error('长期指令文档不存在');
        document.content = content;
        document.exists = true;
        document.updatedAt = Date.now() / 1000;
        return undefined;
      }

      default:
        throw new Error(`Unhandled mock command: ${cmd}`);
    }
  };
}
