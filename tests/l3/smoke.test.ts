import { describe, it } from 'mocha';
import { $, browser, expect } from '@wdio/globals';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
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

describe('Tauri real-IPC smoke', () => {
  it('reads seeded settings and runs skill/instruction/subagent/migration write sequences', async () => {
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
    expect(skillToggledText).toContain('"codex":true');

    const skillUninstalledCount = await $(
      '[data-testid="smoke-skill-uninstalled-count"]',
    ).getText();
    expect(skillUninstalledCount).toBe('0');

    // 长期指令序列：CLAUDE.md 与全局共享 AGENTS.md 均经真实 IPC 读回。
    const instructionText = await $('[data-testid="smoke-instruction-documents"]').getText();
    expect(instructionText).toContain('l3 smoke CLAUDE.md content');
    expect(instructionText).toContain('l3 smoke AGENTS.md content');
    expect(instructionText).toContain('"agentsAppliesTo":["codex","opencode"]');

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
