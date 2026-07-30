import { defineConfig } from 'vitest/config';

// L1: framework-neutral TypeScript only (WorkspaceSession, mock gateway contract,
// generated-type consumption). Node mode — no jsdom; visible UI behaviour is L2.
export default defineConfig({
  test: {
    include: ['tests/l1/**/*.test.ts', 'tests/contract/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    unstubGlobals: true,
  },
});
