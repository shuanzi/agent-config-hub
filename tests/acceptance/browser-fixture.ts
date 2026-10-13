import type {
  AppSettings,
  ImportSkillSelection,
  InstalledSkill,
  ScopeTarget,
  SkillLocation,
  UnmanagedSkill,
} from '../../src/types';
import {
  createInstructionDocuments,
  createSkillPlacementAsset,
  skillPlacementTargets,
} from '../l2/mock-invoke';

/** This module is only imported by the browser test entry. It never enters the app bundle. */
export function setupAcceptanceFixture(): void {
  const params = new URLSearchParams(location.search);
  if (params.get('fixture') !== 'polished') return;
  const state = window.__ACM_MOCK_STATE__!;
  const baseInvoke = window.__ACM_MOCK_INVOKE__!;
  const scenario = params.get('scenario') ?? 'ready';
  const settings: AppSettings = { syncMethod: 'auto', storageLocation: 'hub' };
  document.title = 'Polished 验收 · 模拟数据';
  state.projects = [
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
  const seeds: [string, string, string | undefined, SkillLocation[]][] = [
    ['code-review', '审阅代码与回归风险', 'agent-tools', ['claude-code', 'shared']],
    ['frontend-design', '界面设计与前端实现', 'anthropics', ['claude-code', 'codex']],
    ['react-best-practices', 'React 性能与工程实践', 'vercel-labs', ['claude-code']],
    ['webapp-testing', '浏览器交互与页面验证', undefined, ['codex', 'shared']],
    ['project-conventions', '项目约定与代码规范', undefined, ['claude-code', 'codex']],
  ];
  state.installed =
    scenario === 'empty'
      ? []
      : seeds.map(([name, description, owner], index): InstalledSkill => ({
          id: `polished:${name}`,
          name,
          description,
          directory: name,
          repoOwner: owner,
          repoName: owner ? 'skills' : undefined,
          repoBranch: owner ? 'main' : undefined,
          readmeUrl: owner ? `https://github.com/${owner}/skills` : undefined,
          target:
            index === 4
              ? { scope: 'project', projectId: 'visual-project-alpha' }
              : { scope: 'global' },
          apps: {
            claudeCode: seeds[index][3].includes('claude-code'),
            codex: seeds[index][3].includes('codex'),
            geminiCli: false,
            opencode: false,
          },
          installedAt: 1790208000,
          updatedAt: 1790208000,
        }));
  state.skillPlacements = state.installed.map((skill, index) => {
    const asset = createSkillPlacementAsset(skill, seeds[index][3][0], state.projects);
    for (const p of asset.placements) {
      p.state = seeds[index][3].includes(p.location) ? 'placed' : 'absent';
      p.withdrawable = p.state === 'placed';
      if (index === 2 && p.location === 'gemini-cli') p.state = 'unmanaged';
      if (index === 2 && p.location === 'opencode') {
        p.state = 'conflict';
        p.reason = '目标目录与受管副本内容不同，请先处理冲突。';
      }
    }
    return asset;
  });
  if (scenario === 'isolation') {
    const duplicate = {
      ...state.installed[0],
      target: { scope: 'project' as const, projectId: 'visual-project-alpha' },
    };
    state.installed.push(duplicate);
    state.skillPlacements.push(createSkillPlacementAsset(duplicate, 'claude-code', state.projects));
  }
  state.instructionDocuments = Object.fromEntries(
    [
      ['global', { scope: 'global' }],
      ['project:visual-project-alpha', { scope: 'project', projectId: 'visual-project-alpha' }],
      ['project:visual-project-beta', { scope: 'project', projectId: 'visual-project-beta' }],
    ].map(([key, target]) => [
      key,
      createInstructionDocuments(
        target as ScopeTarget,
        '# 协作约定\n\n使用中文交流，先说明结论。\n修改前阅读项目中的相关约定。\n完成变更后运行相关验证。',
      ),
    ]),
  );
  state.discoverable.push({
    key: 'anthropics/skills:frontend-design',
    name: 'frontend-design',
    description: '界面设计与前端实现',
    directory: 'frontend-design',
    repoOwner: 'anthropics',
    repoName: 'skills',
    repoBranch: 'main',
    installed: false,
  });
  let failedOnce = false;
  const sameTarget = (a: ScopeTarget, b: ScopeTarget) => JSON.stringify(a) === JSON.stringify(b);
  let previewRevision = '';
  window.__ACM_MOCK_INVOKE__ = (command, args) => {
    if (command === 'get_installed_skills' && scenario === 'loading') return new Promise(() => {});
    if (command === 'get_installed_skills' && scenario === 'error' && !failedOnce) {
      failedOnce = true;
      throw new Error('验收样例：暂时无法读取 Skills，请重新读取投放状态。');
    }
    if (command === 'restore_native_subagent_backup' && scenario === 'backup-conflict')
      throw JSON.stringify({
        code: 'NATIVE_SUBAGENT_CONFLICT',
        context: { message: '目标已被外部修改；备份与现有文件均保留。' },
      });
    switch (command) {
      case 'get_settings_command':
        return { ...settings };
      case 'set_sync_method_command':
        settings.syncMethod = args?.method as AppSettings['syncMethod'];
        return;
      case 'set_agent_override_dir': {
        const key = {
          'claude-code': 'claudeCodeConfigDir',
          codex: 'codexConfigDir',
          'gemini-cli': 'geminiCliConfigDir',
          opencode: 'opencodeConfigDir',
        }[String(args?.app)] as keyof AppSettings;
        Object.assign(settings, { [key]: args?.dir ?? undefined });
        return;
      }
      case 'migrate_storage':
        settings.storageLocation = args?.target as AppSettings['storageLocation'];
        return {
          skill: { migratedCount: state.installed.length, errors: [] },
          subagent: { migratedCount: 0, errors: [] },
        };
      case 'scan_unmanaged_skills': {
        const target = args?.target as ScopeTarget;
        const placement = skillPlacementTargets(target, state.projects).find(
          (p) => p.location === 'claude-code',
        )!;
        return [
          {
            directory: 'local-helper',
            name: 'local-helper',
            description: '用于验证来源选择和接管预览',
            foundIn: ['claude-code'],
            path: `${placement.path}/local-helper`,
          },
          ...state.skillPlacements
            .filter((item) => sameTarget(item.target, target))
            .flatMap((asset) => {
              const skill = state.installed.find(
                (s) => s.id === asset.id && sameTarget(s.target, target),
              )!;
              return asset.placements
                .filter((p) => p.state === 'unmanaged')
                .map((p) => ({
                  directory: skill.directory,
                  name: skill.name,
                  foundIn: [p.location],
                  path: `${p.path}/${skill.directory}`,
                }));
            }),
        ] satisfies UnmanagedSkill[];
      }
      case 'preview_skill_import': {
        const preview = baseInvoke(command, args) as { revision: string };
        previewRevision = preview.revision;
        return preview;
      }
      case 'import_skills_from_apps': {
        if (args?.expectedRevision !== previewRevision) throw new Error('预览已过期，请重新预览');
        const selections = args?.selections as ImportSkillSelection[];
        const target = args?.target as ScopeTarget;
        const result: InstalledSkill[] = [];
        for (const selection of selections) {
          let skill = state.installed.find(
            (item) => item.directory === selection.directory && sameTarget(item.target, target),
          );
          if (!skill) {
            skill = {
              id: `import:${selection.directory}`,
              name: selection.directory,
              directory: selection.directory,
              target,
              apps: { claudeCode: false, codex: false, geminiCli: false, opencode: false },
              installedAt: Date.now() / 1000,
              updatedAt: 0,
            };
            state.installed.push(skill);
            state.skillPlacements.push(
              createSkillPlacementAsset(skill, selection.locations[0], state.projects),
            );
          }
          const asset = state.skillPlacements.find(
            (item) => item.id === skill.id && sameTarget(item.target, target),
          )!;
          for (const p of asset.placements)
            if (selection.locations.includes(p.location)) {
              p.state = 'placed';
              p.withdrawable = true;
              p.revision += ':import';
            }
          result.push(skill);
        }
        return result;
      }
      case 'set_skill_placement': {
        const p = state.skillPlacements
          .find(
            (item) => item.id === args?.id && sameTarget(item.target, args?.target as ScopeTarget),
          )
          ?.placements.find((item) => item.location === args?.location);
        if (
          !p ||
          p.revision !== args?.expectedRevision ||
          p.state === 'conflict' ||
          p.state === 'unmanaged' ||
          (p.state === 'placed' && !p.withdrawable)
        )
          throw new Error('位置已变化或不能修改，请重新读取投放状态');
        return baseInvoke(command, args);
      }
      case 'restore_skill_backup': {
        const restored = baseInvoke(command, args) as InstalledSkill;
        if (
          !state.skillPlacements.some(
            (item) => item.id === restored.id && sameTarget(item.target, restored.target),
          )
        )
          state.skillPlacements.push(createSkillPlacementAsset(restored, 'shared', state.projects));
        return restored;
      }
      default:
        return structuredClone(baseInvoke(command, args));
    }
  };
}
