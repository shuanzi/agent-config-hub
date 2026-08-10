/** FE-07R bare L3 entry 的专用 Vite build；生产 bundle 不包含该入口。 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  clearScreen: false,
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      // Tauri 的初始窗口仍需要 index.html；WDIO 随即只导航到 bare FX-19
      // entry，且不运行任何 FE-01 tracer/UI journey。
      input: {
        main: resolve(here, 'index.html'),
        'tests/l3/fx19': resolve(here, 'tests/l3/fx19.html'),
      },
    },
  },
});
