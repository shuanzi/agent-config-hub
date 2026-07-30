/**
 * L3 WebdriverIO 配置：真实 Tauri 测试构建（test-harness）+ embedded WebDriver
 * provider（tauri-plugin-wdio-webdriver，仅 loopback）。
 *
 * 前置（见 tests/l3/README.md）：
 * 1. `corepack npm run build:frontend`
 * 2. `corepack npx tauri build --debug --no-bundle -c src-tauri/tauri.conf.test-harness.json -- --features test-harness`
 *
 * 隔离：onPrepare 把 fixtures/fx-01/native-root 复制到临时目录并以
 * ACM_NATIVE_ROOT 指向它；harness 进程作为本 runner 的子进程继承该 env；
 * 仓库内 fixture 绝不被原地修改，onComplete 清理临时目录。
 */
import type { Options } from '@wdio/types';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// 拉入 webdriverio 的全局 WebdriverIO namespace 类型
import type {} from 'webdriverio';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const appBinary = join(repoRoot, 'src-tauri/target/debug/agent-config-manager');

let fixtureSandbox: string | null = null;

// 注：@wdio/types 的 Options.Testrunner 声明不完整（capabilities/services 透传
// 给 service），与 tests/l2/wdio.conf.ts 同样以类型断言补齐，不改依赖。
export const config = {
  runner: 'local',
  // embedded provider 下所有 spec 共享同一 harness 进程与同一窗口：
  // contract.test.ts 会把窗口导航到 contract.html，必须排在最后；
  // 用户旅程（tracer）先行，保证每个 spec 起始页面符合预期。
  specs: ['./fx-01.tracer.test.ts', './contract.test.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinary,
      },
    },
  ],
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath: appBinary,
        // macOS 唯一支持路径：embedded WebDriver（loopback，进程退出即关闭）
        driverProvider: 'embedded',
      },
    ],
  ],
  logLevel: 'warn',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  onPrepare: () => {
    fixtureSandbox = mkdtempSync(join(tmpdir(), 'acm-l3-fx01-'));
    const nativeRoot = join(fixtureSandbox, 'native-root');
    cpSync(join(repoRoot, 'fixtures/fx-01/native-root'), nativeRoot, { recursive: true });
    process.env.ACM_NATIVE_ROOT = nativeRoot;
  },
  onComplete: () => {
    if (fixtureSandbox !== null) {
      rmSync(fixtureSandbox, { recursive: true, force: true });
      fixtureSandbox = null;
    }
    delete process.env.ACM_NATIVE_ROOT;
  },
} as Options.Testrunner;
