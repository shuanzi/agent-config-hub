/**
 * PF-01 L3 冷启动采样 WebdriverIO 配置：真实 Tauri 测试构建（test-harness）
 * + embedded WebDriver provider（与 tests/l3/wdio.conf.ts 同一启动方式）。
 *
 * 前置：harness 已由 perf.mjs 经 scripts/orchestrator/build-harness.mjs 构建。
 * 隔离：onPrepare 把 fixtures/fx-01/native-root 复制到临时目录并以
 * ACM_NATIVE_ROOT 指向它；harness 进程作为本 runner 的子进程继承该 env；
 * 仓库内 fixture 绝不被原地修改，onComplete 清理临时目录。
 *
 * 采样方式：每次 wdio run 由 tauri service 在 onPrepare 新起一个 harness
 * 进程，spec 取回 1 个冷启动样本并追加写入 PF01_OUTPUT_DIR/l3-samples.json；
 * perf.mjs 串行运行本配置 3 次以取得 3 个进程级冷启动样本（embedded
 * provider 下 reloadSession 不重启应用进程，进程级样本只能靠多次 run）。
 */
import type { Options } from '@wdio/types';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// 拉入 webdriverio 的全局 WebdriverIO namespace 类型
import type {} from 'webdriverio';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const appBinary = join(repoRoot, 'src-tauri/target/debug/agent-config-manager');

let fixtureSandbox: string | null = null;

// 与 tests/l3/wdio.conf.ts 相同的 Options.Testrunner 类型断言补齐。
export const config = {
  runner: 'local',
  specs: ['./pf-01.coldstart.test.ts'],
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
    fixtureSandbox = mkdtempSync(join(tmpdir(), 'acm-pf01-l3-'));
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
