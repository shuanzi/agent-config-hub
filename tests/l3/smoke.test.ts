import { describe, it } from 'mocha';
import { $, browser, expect } from '@wdio/globals';

describe('Tauri skill command smoke', () => {
  it('reads seeded default repos and empty installed skills', async () => {
    await browser.url('tauri://localhost/tests/l3/smoke.html');

    const result = await $('[data-testid="smoke-result"]');
    await result.waitForDisplayed({ timeout: 10000 });

    const settingsText = await $('[data-testid="smoke-settings"]').getText();
    expect(settingsText).toContain('"storageLocation":"hub"');
    expect(settingsText).toContain('"syncMethod":"auto"');

    const reposText = await $('[data-testid="smoke-repos"]').getText();
    expect(reposText).toContain('anthropics');
    expect(reposText).toContain('skills');

    const installedCount = await $('[data-testid="smoke-installed-count"]').getText();
    expect(installedCount).toBe('0');
  });
});
