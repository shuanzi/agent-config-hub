import type {} from '@wdio/tauri-service';
import { describe, it } from 'mocha';
import { $, browser, expect } from '@wdio/globals';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface ProjectSummaryWire {
  projectId: string;
  displayName: string;
  rootPath: string;
}

interface ProjectRegistrySequenceWire {
  firstProject: ProjectSummaryWire;
  secondProject: ProjectSummaryWire;
  listedAfterAdd: ProjectSummaryWire[];
  projectSkill: { id: string; target: { scope: string; projectId?: string } };
  projectSkillsAfterRelink: { id: string; target: { scope: string; projectId?: string } }[];
  relinked: ProjectSummaryWire;
  listedAfterRemove: ProjectSummaryWire[];
}

(process.env.ACM_L3_READBACK === '1' ? describe.skip : describe)('Tauri real-IPC smoke', () => {
  it('reads seeded settings and runs skill/instruction/subagent/migration write sequences', async () => {
    const home = process.env.ACM_HOME;
    if (!home) throw new Error('L3 requires an isolated ACM_HOME');
    const claudePath = join(home, '.claude', 'CLAUDE.md');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const claudeBefore = Buffer.from([0xff, ...Buffer.from('untouched Claude instructions')]);
    writeFileSync(claudePath, claudeBefore);
    await browser.url('tauri://localhost/tests/l3/smoke.html');

    const result = await $('[data-testid="smoke-result"]');
    await result.waitForDisplayed({ timeout: 60000 });

    const settingsText = await $('[data-testid="smoke-settings"]').getText();
    expect(settingsText).toContain('"storageLocation":"hub"');
    expect(settingsText).toContain('"syncMethod":"auto"');

    const reposText = await $('[data-testid="smoke-repos"]').getText();
    expect(reposText).toContain('anthropics');
    expect(reposText).toContain('skills');

    const installedCount = await $('[data-testid="smoke-installed-count"]').getText();
    expect(installedCount).toBe('0');

    // Skill sequence assertions
    const skillInstalledText = await $('[data-testid="smoke-skill-installed"]').getText();
    expect(skillInstalledText).toContain('"directory":"smoke-skill"');
    expect(skillInstalledText).toContain('"installedAt"');
    expect(skillInstalledText).toContain('"target":{"scope":"global"}');

    const skillToggledText = await $('[data-testid="smoke-skill-toggled"]').getText();
    const placements = JSON.parse(skillToggledText)[0].placements as {
      aliases: string[];
      state: string;
    }[];
    expect(placements.find((item) => item.aliases.includes('shared'))?.state).toBe('placed');
    expect(placements.find((item) => item.aliases.includes('codex'))?.state).toBe('absent');

    const skillUninstalledCount = await $(
      '[data-testid="smoke-skill-uninstalled-count"]',
    ).getText();
    expect(skillUninstalledCount).toBe('0');

    // 真实 IPC 拒绝旧 kind；磁盘两份 AGENTS.md 同步，原 CLAUDE.md 字节不变。
    const instructionText = await $('[data-testid="smoke-instruction-documents"]').getText();
    const instructionSequence = JSON.parse(instructionText) as {
      rejectedClaudeKind: boolean;
      documents: { kind: string; fileName: string; content: string; paths: string[] }[];
    };
    expect(instructionSequence.rejectedClaudeKind).toBe(true);
    expect(instructionSequence.documents).toHaveLength(1);
    const instruction = instructionSequence.documents[0];
    expect(instruction.kind).toBe('agents');
    expect(instruction.fileName).toBe('AGENTS.md');
    expect(instruction.paths).toEqual([
      join(home, '.codex', 'AGENTS.md'),
      join(home, '.config', 'opencode', 'AGENTS.md'),
    ]);
    for (const path of instruction.paths) {
      expect(readFileSync(path, 'utf8')).toBe('l3 smoke AGENTS.md content');
    }
    expect(readFileSync(claudePath).equals(claudeBefore)).toBe(true);
    expect(instructionText).not.toContain('appliesTo');

    // Subagent sequence assertions
    const subagentInstalledCount = await $(
      '[data-testid="smoke-subagent-installed-count"]',
    ).getText();
    expect(subagentInstalledCount).toBe('0');

    const subagentRepoCount = await $('[data-testid="smoke-subagent-repo-count"]').getText();
    expect(Number.parseInt(subagentRepoCount, 10)).toBeGreaterThan(0);

    const subagentRemoved = await $('[data-testid="smoke-subagent-removed"]').getText();
    expect(subagentRemoved).toBe('true');

    // Combined migration assertions (empty state -> zeros)
    const migrationSkill = await $('[data-testid="smoke-migration-skill"]').getText();
    expect(migrationSkill).toBe('0');

    const migrationSubagent = await $('[data-testid="smoke-migration-subagent"]').getText();
    expect(migrationSubagent).toBe('0');
  });

  it('uses opaque project IDs for same-name projects and preserves one through relink', async () => {
    const roots = [
      mkdtempSync(join(tmpdir(), 'acm-l3-project-alpha-')),
      mkdtempSync(join(tmpdir(), 'acm-l3-project-beta-')),
      mkdtempSync(join(tmpdir(), 'acm-l3-project-relinked-')),
    ];
    const canonicalRoots = roots.map((root) => realpathSync(root));
    const query = new URLSearchParams();
    roots.forEach((root) => query.append('projectRoot', root));

    try {
      await browser.url(`tauri://localhost/tests/l3/smoke.html?${query.toString()}`);

      const result = await $('[data-testid="smoke-result"]');
      await result.waitForDisplayed({ timeout: 60000 });

      const sequence = JSON.parse(
        await $('[data-testid="smoke-project-registry"]').getText(),
      ) as ProjectRegistrySequenceWire;
      expect(sequence.listedAfterAdd).toHaveLength(2);

      const { firstProject, secondProject } = sequence;
      expect(firstProject.displayName).toBe('L3 同名项目');
      expect(secondProject.displayName).toBe('L3 同名项目');
      expect(firstProject.projectId).not.toBe(secondProject.projectId);
      expect(firstProject.projectId).not.toBe(firstProject.displayName);
      expect(firstProject.projectId).not.toBe(firstProject.rootPath);
      expect(secondProject.projectId).not.toBe(secondProject.displayName);
      expect(secondProject.projectId).not.toBe(secondProject.rootPath);
      expect(sequence.listedAfterAdd.map((project) => project.projectId)).toEqual(
        expect.arrayContaining([firstProject.projectId, secondProject.projectId]),
      );

      expect(sequence.relinked.projectId).toBe(firstProject.projectId);
      expect(sequence.relinked.rootPath).toBe(canonicalRoots[2]);
      expect(sequence.projectSkill.target).toEqual({
        scope: 'project',
        projectId: firstProject.projectId,
      });
      const relinkedProjectSkill = sequence.projectSkillsAfterRelink.find(
        (skill) => skill.id === sequence.projectSkill.id,
      );
      expect(relinkedProjectSkill?.target).toEqual({
        scope: 'project',
        projectId: firstProject.projectId,
      });
      expect(sequence.listedAfterRemove).toEqual([]);
    } finally {
      roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
    }
  });
});

// Production React entry + real IPC + the same isolated ACM_HOME. No invoke mocks.
(process.env.ACM_L3_READBACK === '1' ? describe.skip : describe)(
  'Polished production UI with isolated filesystem',
  () => {
    it('imports, places, withdraws and detects a changed projection through the real UI', async () => {
      const home = process.env.ACM_HOME!;
      const source = join(home, '.claude/skills/ui-acceptance/SKILL.md');
      mkdirSync(join(home, '.claude/skills/ui-acceptance'), { recursive: true });
      const original =
        '---\nname: ui-acceptance\ndescription: Real UI acceptance\n---\nKeep this source intact.\n';
      writeFileSync(source, original);
      await browser.url('tauri://localhost/tests/l3/app.html');
      await $('.app-title').waitForDisplayed();
      console.log('UI checkpoint: production App mounted');
      await $("//button[normalize-space()='设置']").click();
      await $("//button[@aria-label='复制']").click();
      await $('.settings-success').waitForDisplayed();
      console.log('UI checkpoint: settings saved');
      await $("//button[normalize-space()='Skills']").click();
      await $("//nav[@aria-label='配置上下文']//button[normalize-space()='全局配置']").click();
      await $("//button[normalize-space()='导入已有']").click();
      const dialog = $('[role="dialog"]');
      await dialog.waitForDisplayed();
      console.log('UI checkpoint: import dialog opened');
      await dialog.$('input[aria-label^="选择 ui-acceptance"]').click();
      await dialog.$('input[aria-label*="Codex"]').click();
      await dialog.$(".//button[contains(normalize-space(),'预览接管')]").click();
      const projected = join(home, '.codex/skills/ui-acceptance/SKILL.md');
      const externallyChanged = `${original}\nExternal preview change\n`;
      writeFileSync(source, externallyChanged);
      await dialog.$(".//button[normalize-space()='确认接管']").click();
      await dialog.$('[role="alert"]').waitForDisplayed();
      expect(await dialog.$('[role="alert"]').getText()).toContain('重新预览');
      expect(readFileSync(source, 'utf8')).toBe(externallyChanged);
      expect(existsSync(projected)).toBe(false);
      writeFileSync(source, original);
      await dialog.$(".//button[normalize-space()='返回修改']").click();
      await dialog.$(".//button[contains(normalize-space(),'预览接管')]").click();
      await dialog.$(".//button[normalize-space()='确认接管']").click();
      await dialog.waitForDisplayed({ reverse: true });
      console.log('UI checkpoint: import committed');
      // IDs belong to the backend; locate by directory/name rather than inventing its wire ID.
      const placement = $('[aria-label^="投放位置：ui-acceptance，Codex"]');
      await placement.waitForDisplayed();
      expect(await placement.getAttribute('aria-pressed')).toBe('true');
      expect(readFileSync(projected, 'utf8')).toBe(original);
      await placement.click();
      await browser.waitUntil(
        async () => (await placement.getAttribute('aria-pressed')) === 'false',
      );
      expect(readFileSync(source, 'utf8')).toBe(original);
      await placement.click();
      await browser.waitUntil(
        async () => (await placement.getAttribute('aria-pressed')) === 'true',
      );
      writeFileSync(projected, `${original}\nExternal change\n`);
      await $("//button[normalize-space()='重新读取投放状态']").click();
      await browser.waitUntil(
        async () => (await placement.getAttribute('aria-disabled')) === 'true',
      );
      expect(readFileSync(projected, 'utf8')).toContain('External change');
      expect(readFileSync(source, 'utf8')).toBe(original);
      await browser.refresh();
      await $('[aria-label^="投放位置：ui-acceptance，Codex"]').waitForDisplayed();
      expect(
        await $('[aria-label^="投放位置：ui-acceptance，Codex"]').getAttribute('aria-disabled'),
      ).toBe('true');
    });

    it('saves AGENTS.md and native definitions with disk readback after reload', async () => {
      const home = process.env.ACM_HOME!;
      const claude = join(home, '.claude/CLAUDE.md');
      const untouched = readFileSync(claude);
      await $("//button[normalize-space()='长期指令']").click();
      const editor = $('#instruction-document-content');
      await editor.waitForDisplayed();
      await editor.setValue('# UI 验收\n真实 IPC 保存并重新读取。');
      await $("//button[normalize-space()='保存 AGENTS.md']").click();
      await $('.instructions-success').waitForDisplayed();
      for (const path of ['.codex/AGENTS.md', '.config/opencode/AGENTS.md'])
        expect(readFileSync(join(home, path), 'utf8')).toBe('# UI 验收\n真实 IPC 保存并重新读取。');
      expect(readFileSync(claude).equals(untouched)).toBe(true);
      const nativePath = join(home, '.codex/agents/ui-reviewer.toml');
      mkdirSync(join(home, '.codex/agents'), { recursive: true });
      writeFileSync(
        nativePath,
        'name = "ui-reviewer"\ndescription = "UI acceptance"\ndeveloper_instructions = "Review only."\n',
      );
      const nativeOriginal = readFileSync(nativePath, 'utf8');
      await $("//button[normalize-space()='Subagents']").click();
      await $("//button[contains(@class,'native-row')][contains(.,'ui-reviewer')]").click();
      await $("//button[normalize-space()='查看原生源码']").click();
      const nativeEditor = $('[aria-label="Subagent 原生源码"]');
      await nativeEditor.waitForDisplayed();
      expect(await nativeEditor.getAttribute('readonly')).not.toBeNull();
      await $("//button[normalize-space()='纳入管理']").click();
      await $("//*[@role='dialog']//button[normalize-space()='确认纳入管理']").click();
      await browser.waitUntil(async () => !(await nativeEditor.getAttribute('readonly')));
      const next = `${await nativeEditor.getValue()}\n# Native UI round trip\n`;
      await nativeEditor.setValue(next);
      await $("//button[normalize-space()='保存原生源码']").click();
      await browser.waitUntil(
        async () => !(await $("//button[normalize-space()='保存原生源码']").isEnabled()),
      );
      expect(readFileSync(nativePath, 'utf8')).toBe(next);
      const backupRoundTrip = await browser.tauri.execute(async ({ core }) => {
        const backups = (await core.invoke('get_native_subagent_backups', {
          context: { kind: 'global' },
        })) as import('../../src/lib/api/nativeSubagents').NativeSubagentBackup[];
        const backup = backups.find((item) => item.name === 'ui-reviewer');
        if (!backup) throw new Error('Native takeover/save backup missing');
        const before = (await core.invoke('read_native_subagent', {
          identity: backup.identity,
        })) as import('../../src/lib/api/nativeSubagents').NativeSubagentContent;
        await core.invoke('restore_native_subagent_backup', {
          backupId: backup.backupId,
          expectedDestinationHash: before.contentHash,
        });
        const restored = (await core.invoke('read_native_subagent', {
          identity: backup.identity,
        })) as import('../../src/lib/api/nativeSubagents').NativeSubagentContent;
        await core.invoke('save_native_subagent', {
          identity: backup.identity,
          content: before.content,
          expectedHash: restored.contentHash,
        });
        return { restored: restored.content, backupCount: backups.length };
      });
      expect(backupRoundTrip.backupCount).toBeGreaterThan(0);
      expect(backupRoundTrip.restored).toBe(nativeOriginal);
      expect(readFileSync(nativePath, 'utf8')).toBe(next);
      await $("//button[normalize-space()='停用']").click();
      await $("//button[normalize-space()='启用']").waitForDisplayed();
      expect(existsSync(nativePath)).toBe(false);
      await $("//button[normalize-space()='启用']").click();
      await $("//button[normalize-space()='停用']").waitForDisplayed();
      expect(readFileSync(nativePath, 'utf8')).toBe(next);
      await browser.refresh();
      await $("//button[normalize-space()='长期指令']").click();
      await $('#instruction-document-content').waitForDisplayed();
      expect(await $('#instruction-document-content').getValue()).toBe(
        '# UI 验收\n真实 IPC 保存并重新读取。',
      );
      expect(readFileSync(claude).equals(untouched)).toBe(true);
    });
  },
);

(process.env.ACM_L3_READBACK === '1' ? describe : describe.skip)('第二次进程启动持久化回读', () => {
  it('重新启动后保留 Skills 冲突状态、AGENTS.md、原生源码和同步设置', async () => {
    await browser.url('tauri://localhost/tests/l3/app.html');
    const placement = $('[aria-label^="投放位置：ui-acceptance，Codex"]');
    await placement.waitForDisplayed();
    expect(await placement.getAttribute('aria-disabled')).toBe('true');
    await $("//button[normalize-space()='长期指令']").click();
    await $('#instruction-document-content').waitForDisplayed();
    expect(await $('#instruction-document-content').getValue()).toBe(
      '# UI 验收\n真实 IPC 保存并重新读取。',
    );
    await $("//button[normalize-space()='Subagents']").click();
    await $("//button[contains(@class,'native-row')][contains(.,'ui-reviewer')]").click();
    await $("//button[normalize-space()='查看原生源码']").click();
    expect(await $('[aria-label="Subagent 原生源码"]').getValue()).toContain(
      'Native UI round trip',
    );
    await $("//button[normalize-space()='设置']").click();
    expect(await $('[aria-label="复制"]').getAttribute('aria-pressed')).toBe('true');
  });
});

(process.env.ACM_ONLINE_ACCEPTANCE === '1' && process.env.ACM_L3_READBACK !== '1'
  ? describe
  : describe.skip)('在线真实命令（独立于模拟验收）', () => {
  it('从公共仓库发现、安装、检查并应用同源更新', async () => {
    await browser.url('tauri://localhost/tests/l3/app.html');
    await $('.app-header').waitForDisplayed();
    await browser.setTimeout({ script: 120000 });
    const result = await browser.tauri.execute(async ({ core }) => {
      const invoke = <T>(command: string, args?: Record<string, unknown>) =>
        core.invoke(command, args) as Promise<T>;
      const repos = await invoke<import('../../src/types').SkillRepo[]>('get_skill_repos');
      for (const repo of repos)
        await core.invoke('add_skill_repo', { repo: { ...repo, enabled: false } });
      await core.invoke('add_skill_repo', {
        repo: { owner: 'anthropics', name: 'skills', branch: 'main', enabled: true },
      });
      const target = { scope: 'global' };
      const found = await invoke<import('../../src/types').DiscoverableSkill[]>(
        'discover_available_skills',
        { target },
      );
      const candidate = found.find((item) => item.directory.endsWith('frontend-design'));
      if (!candidate)
        throw new Error(
          `Online discovery returned ${found.length} candidates, frontend-design missing`,
        );
      const installed = await invoke<import('../../src/types').InstalledSkill>('install_skill', {
        skill: candidate,
        target,
        initialLocation: 'codex',
      });
      const updates = await invoke<import('../../src/types').SkillUpdateInfo[]>(
        'check_skill_updates',
        { target },
      );
      const updated = await invoke<import('../../src/types').InstalledSkill>('update_skill', {
        id: installed.id,
        target,
      });
      return {
        discovered: found.length,
        installed: installed.id,
        updated: updated.id,
        updates: updates.length,
        directory: installed.directory,
      };
    });
    expect(result.discovered).toBeGreaterThan(0);
    expect(result.updated).toBe(result.installed);
    expect(
      readFileSync(
        join(process.env.ACM_HOME!, '.codex/skills', result.directory, 'SKILL.md'),
        'utf8',
      ).length,
    ).toBeGreaterThan(100);
    console.log('ONLINE_ACCEPTANCE', JSON.stringify(result));
  });
});
