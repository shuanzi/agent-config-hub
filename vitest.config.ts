import { defineConfig } from 'vitest/config';

// L1: TypeScript 单元测试（api 封装、错误解析、hooks 缓存失效）。
// hooks 测试文件通过文件顶部 @vitest-environment jsdom 指令单独启用 DOM。
export default defineConfig({
  test: {
    include: ['tests/l1/**/*.test.ts', 'tests/l1/**/*.test.tsx'],
    environment: 'node',
    restoreMocks: true,
    unstubGlobals: true,
  },
});
