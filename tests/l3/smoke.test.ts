import { describe, it } from 'mocha';
import { $, browser, expect } from '@wdio/globals';

describe('Tauri real-IPC smoke', () => {
  it('reads seeded settings and runs skill/prompt/subagent/migration write sequences', async () => {
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

    const skillToggledText = await $('[data-testid="smoke-skill-toggled"]').getText();
    expect(skillToggledText).toContain('"codex":true');

    const skillUninstalledCount = await $(
      '[data-testid="smoke-skill-uninstalled-count"]',
    ).getText();
    expect(skillUninstalledCount).toBe('0');

    // Prompt sequence assertions
    const promptLiveText = await $('[data-testid="smoke-prompt-live"]').getText();
    expect(promptLiveText).toBe('l3 smoke prompt content');

    // Subagent sequence assertions
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
});
