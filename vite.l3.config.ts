/**
 * L3 harness 前端构建配置（仅 test:tauri / perf L3 采样使用）。
 *
 * 与生产 vite.config.ts 的唯一差异：rollupOptions.input 增加
 * tests/l3/contract.html 测试入口（L3 契约断言在真实 Tauri webview 内运行）。
 * 生产构建（build:frontend → vite.config.ts）保持单入口，物理不含测试入口
 * （L4 负向检查）。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed dev port and a relative base for the production bundle.
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        'tests/l3/contract': resolve(here, 'tests/l3/contract.html'),
      },
    },
  },
});
