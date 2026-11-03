import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { browser } from '@wdio/globals';

export const evidenceDirectory = fileURLToPath(
  new URL('../../.artifacts/ui/latest/', import.meta.url),
);

export async function saveEvidence(name: string): Promise<void> {
  await mkdir(evidenceDirectory, { recursive: true });
  await browser.saveScreenshot(`${evidenceDirectory}/${name}.png`);
}
