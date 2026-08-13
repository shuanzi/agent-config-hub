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
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// 拉入 webdriverio 的全局 WebdriverIO namespace 类型
import type {} from 'webdriverio';
// @ts-expect-error runtime helper is a plain Node ESM module.
import { HarnessPeakRssSampler } from '../scripts/orchestrator/pf01-resource.mjs';
// prettier-ignore
// @ts-expect-error runtime helper is a plain Node ESM module.
import { readHarnessExitFailure, waitForHarnessLifecycleState, writeHarnessExitFailure, writeHarnessExitRequest } from '../scripts/orchestrator/pf01-lifecycle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const appBinary = join(repoRoot, 'src-tauri/target/debug/agent-config-manager');

let fixtureSandbox: string | null = null;
let resourceSampler: InstanceType<typeof HarnessPeakRssSampler> | null = null;

async function requestHarnessNormalExit(): Promise<void> {
  const lifecyclePath = process.env.PF01_HARNESS_LIFECYCLE_PATH;
  if (lifecyclePath === undefined || lifecyclePath.length === 0) return;

  try {
    const startedHarness = await waitForHarnessLifecycleState({
      lifecyclePath,
      expectedNormalExit: false,
    });
    writeHarnessExitRequest({ lifecyclePath, harness: startedHarness });
    await waitForHarnessLifecycleState({
      lifecyclePath,
      expectedNormalExit: true,
      expectedHarness: startedHarness,
    });
  } catch (error) {
    writeHarnessExitFailure(lifecyclePath);
    throw error;
  }
}

function appendResourceRun(outputDir: string, run: unknown): void {
  const resourcePath = join(outputDir, 'l3-resource-runs.json');
  const existing = existsSync(resourcePath)
    ? (JSON.parse(readFileSync(resourcePath, 'utf8')) as { runs?: unknown[] })
    : null;
  const payload = {
    schemaVersion: 1,
    metric: 'pf01.l3.peak_rss_bytes',
    runs: [...(existing?.runs ?? []), run],
  };
  writeFileSync(resourcePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

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
    process.env.PF01_HARNESS_LIFECYCLE_PATH = join(fixtureSandbox, 'harness-lifecycle.json');
    resourceSampler = new HarnessPeakRssSampler({
      lifecyclePath: process.env.PF01_HARNESS_LIFECYCLE_PATH,
    });
    resourceSampler.start();
  },
  // Runner 先成功 deleteSession，才执行 config afterSession。失败写到同一临时
  // sandbox 的 marker；runner 对 hook 异常只记录日志，onComplete 会据此使 WDIO
  // 非零，避免把未认证的 normal exit 误作有效采样。
  afterSession: async () => {
    await requestHarnessNormalExit();
  },
  onComplete: async () => {
    let lifecycleFailure: Error | null = null;
    if (process.env.PF01_OUTPUT_DIR !== undefined && resourceSampler !== null) {
      try {
        appendResourceRun(process.env.PF01_OUTPUT_DIR, await resourceSampler.finalize());
      } catch (error) {
        appendResourceRun(process.env.PF01_OUTPUT_DIR, resourceSampler.diagnosticRun(error));
      }
    }
    const lifecyclePath = process.env.PF01_HARNESS_LIFECYCLE_PATH;
    if (lifecyclePath !== undefined && lifecyclePath.length > 0) {
      try {
        if (readHarnessExitFailure(lifecyclePath) !== null) {
          lifecycleFailure = new Error('PF-01 L3 harness normal exit not established');
        }
      } catch (error) {
        lifecycleFailure =
          error instanceof Error
            ? error
            : new Error('PF-01 harness lifecycle failure marker invalid');
      }
    }
    resourceSampler = null;
    if (fixtureSandbox !== null) {
      rmSync(fixtureSandbox, { recursive: true, force: true });
      fixtureSandbox = null;
    }
    delete process.env.ACM_NATIVE_ROOT;
    delete process.env.PF01_HARNESS_LIFECYCLE_PATH;
    if (lifecycleFailure !== null) throw lifecycleFailure;
  },
} as Options.Testrunner;
