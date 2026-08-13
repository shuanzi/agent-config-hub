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

/**
 * `@wdio/tauri-service` 1.2.0 的 embedded direct-eval wrapper 只读取
 * `window.__wdio_original_core__`，但其自身没有初始化该别名。这个 transform
 * 只进入 L3 harness 的 HTML；production vite.config.ts 与正式 bundle 不变。
 */
const wdioCoreAlias = {
  name: 'l3-wdio-original-core-alias',
  transformIndexHtml: {
    order: 'pre' as const,
    handler: () => [
      {
        tag: 'script',
        injectTo: 'head-prepend' as const,
        children:
          'if (window.__TAURI__?.core) window.__wdio_original_core__ = window.__TAURI__.core;',
      },
    ],
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [wdioCoreAlias, react()],
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
