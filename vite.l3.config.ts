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
  define: {
    // L3 harness 页在真实 Tauri webview 中运行，无法读取构建机路径；
    // 由本配置文件的位置解析仓库内的 fixture 路径并在构建期注入，
    // 保证干净检出/CI 下也能正确定位。
    __L3_SMOKE_FIXTURE_ZIP__: JSON.stringify(resolve(here, 'fixtures/l3/l3-smoke-skills.zip')),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        smoke: resolve(here, 'tests/l3/smoke.html'),
      },
    },
  },
});
