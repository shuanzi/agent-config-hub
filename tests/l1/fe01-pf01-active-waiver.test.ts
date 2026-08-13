import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// @ts-expect-error active waiver validator is a plain Node ESM module.
import { activePf01StepMetadata } from '../../scripts/orchestrator/fe01-pf01-active-waiver.mjs';
// @ts-expect-error active waiver validator is a plain Node ESM module.
import { hasExactActiveWaiverRunIdentity } from '../../scripts/orchestrator/fe01-pf01-active-waiver.mjs';
// @ts-expect-error active waiver validator is a plain Node ESM module.
import { validateFe01Pf01ActiveWaiver } from '../../scripts/orchestrator/fe01-pf01-active-waiver.mjs';

const runId = '20260811T112008912Z-p30755-000';
const run = `.artifacts/performance/PF-01/${runId}`;
const activeWaiver = JSON.parse(
  readFileSync('performance/waivers/fe-01-pf-01-search-results-active.json', 'utf8'),
);
const temporaryRoots: Array<{ root: string; checkout: string }> = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function physicalArtifactCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'acm-fe01-active-waiver-'));
  const checkout = join(root, 'checkout');
  execFileSync(
    'git',
    ['worktree', 'add', '--detach', checkout, 'ef1fd9823d286616ed108576c543b6f4980b5fcd'],
    {
      cwd: process.cwd(),
      stdio: 'pipe',
    },
  );
  temporaryRoots.push({ root, checkout });
  const runDirectory = join(checkout, run);
  mkdirSync(runDirectory, { recursive: true });
  for (const file of Object.keys(activeWaiver.artifactSha256)) {
    copyFileSync(join(process.cwd(), run, file), join(runDirectory, file));
  }
  copyFileSync(
    'performance/waivers/fe-01-pf-01-search-results-active.json',
    join(checkout, 'performance/waivers/fe-01-pf-01-search-results-active.json'),
  );
  return checkout;
}

afterEach(() => {
  for (const { root, checkout } of temporaryRoots.splice(0)) {
    execFileSync('git', ['worktree', 'remove', '--force', checkout], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    rmSync(root, { recursive: true, force: true });
  }
});

describe('FE-01 PF-01 active exact performance waiver', () => {
  it('只从指定 immutable run 复算并接受唯一授权的搜索 p95 自动失败', () => {
    const validation = validateFe01Pf01ActiveWaiver();
    expect(validation).toMatchObject({
      valid: true,
      manualDisposition: 'accepted-with-waiver',
      automaticResult: {
        status: 'fail',
        exitCode: 1,
        runId: '20260811T112008912Z-p30755-000',
        violation: {
          metric: 'pf01.search.results_visible',
          statistic: 'p95',
          observedMs: 11.645,
          thresholdMs: 10,
          deltaMs: 1.645,
        },
      },
    });
    expect(activePf01StepMetadata(validation)).toEqual({
      executionMode: 'historical-artifact-validation',
      samplingRun: false,
      historicalRunId: '20260811T112008912Z-p30755-000',
      initialWaiverValidation: 'valid',
    });
  });

  it('summary runIdentity 必须显式证明 start/end 均为指定 clean evidence commit', () => {
    const exact = JSON.parse(readFileSync(join(run, 'summary.json'), 'utf8')).runIdentity;
    expect(hasExactActiveWaiverRunIdentity(exact)).toBe(true);
    for (const drift of [
      { ...exact, startCommit: 'a'.repeat(40) },
      { ...exact, endCommit: 'a'.repeat(40) },
      { ...exact, startWorktreeDirty: true },
      { ...exact, endWorktreeDirty: true },
      { ...exact, consistent: false },
      { ...exact, extra: true },
    ]) {
      expect(hasExactActiveWaiverRunIdentity(drift)).toBe(false);
    }
  });

  it('run、commit、metric、数值、budget、baseline/current、input、runtime、artifact hash、scope 或 key 漂移都不能扩大授权', () => {
    const mutations = [
      (record: typeof activeWaiver) =>
        (record.automaticResult.runId = '20260811T000000000Z-p0-000'),
      (record: typeof activeWaiver) =>
        (record.automaticResult.run = '.artifacts/performance/PF-01/other'),
      (record: typeof activeWaiver) => (record.automaticResult.commit = 'a'.repeat(40)),
      (record: typeof activeWaiver) => (record.automaticResult.status = 'pass'),
      (record: typeof activeWaiver) => (record.automaticResult.exitCode = 0),
      (record: typeof activeWaiver) =>
        (record.automaticResult.violation.metric = 'pf01.filter.results_visible'),
      (record: typeof activeWaiver) => (record.automaticResult.violation.statistic = 'p50'),
      (record: typeof activeWaiver) => (record.automaticResult.violation.observedMs = 11.646),
      (record: typeof activeWaiver) => (record.automaticResult.violation.thresholdMs = 11),
      (record: typeof activeWaiver) => (record.automaticResult.violation.deltaMs = 1.646),
      (record: typeof activeWaiver) => (record.budget.sha256 = 'a'.repeat(64)),
      (record: typeof activeWaiver) => (record.baseline.commit = 'a'.repeat(40)),
      (record: typeof activeWaiver) => (record.baseline.runId = '20260811T000000000Z-p0-000'),
      (record: typeof activeWaiver) =>
        (record.current.artifact.actualBinarySha256 = 'a'.repeat(64)),
      (record: typeof activeWaiver) => (record.attestation.fixture.sha256 = 'a'.repeat(64)),
      (record: typeof activeWaiver) => (record.attestation.buildInputs.digest = 'a'.repeat(64)),
      (record: typeof activeWaiver) =>
        (record.attestation.measurementInputs.l2DevModuleGraph.moduleCount = 13),
      (record: typeof activeWaiver) =>
        (record.attestation.measurementInputs.l2DevModuleGraph.evidenceSha256 = 'a'.repeat(64)),
      (record: typeof activeWaiver) => (record.attestation.runner.node = 'v99.0.0'),
      (record: typeof activeWaiver) => (record.attestation.runner.platform = 'linux'),
      (record: typeof activeWaiver) => (record.attestation.runner.npm = '99.0.0'),
      (record: typeof activeWaiver) => (record.attestation.toolchain.cargo = 'cargo 99'),
      (record: typeof activeWaiver) => (record.attestation.toolchain.rustc = 'rustc 99'),
      (record: typeof activeWaiver) => (record.artifactSha256['summary.json'] = 'a'.repeat(64)),
      (record: typeof activeWaiver) => (record.recordDigest.value = 'a'.repeat(64)),
      (record: typeof activeWaiver) => (record.scope = 'generic bypass'),
      (record: typeof activeWaiver) => ((record as Record<string, unknown>).unapproved = true),
    ];
    for (const mutate of mutations) {
      const record = clone(activeWaiver);
      mutate(record);
      expect(validateFe01Pf01ActiveWaiver({ waiver: record })).toMatchObject({ valid: false });
    }
  });

  it('拒绝 active waiver record/run 的 extra/missing、final file 与任一 parent symlink', () => {
    const mutations: Array<(checkout: string) => void> = [
      (checkout) => writeFileSync(join(checkout, run, 'extra.json'), '{}\n'),
      (checkout) => rmSync(join(checkout, run, 'samples.json')),
      (checkout) => {
        const summary = join(checkout, run, 'summary.json');
        unlinkSync(summary);
        symlinkSync(join(process.cwd(), run, 'summary.json'), summary);
      },
      (checkout) => {
        const recordPath = join(
          checkout,
          'performance/waivers/fe-01-pf-01-search-results-active.json',
        );
        unlinkSync(recordPath);
        symlinkSync(
          join(process.cwd(), 'performance/waivers/fe-01-pf-01-search-results-active.json'),
          recordPath,
        );
      },
      (checkout) => {
        const parent = join(checkout, 'performance/waivers');
        const physicalParent = join(checkout, 'physical-waivers');
        mkdirSync(physicalParent, { recursive: true });
        copyFileSync(
          'performance/waivers/fe-01-pf-01-search-results-active.json',
          join(physicalParent, 'fe-01-pf-01-search-results-active.json'),
        );
        rmSync(parent, { recursive: true, force: true });
        symlinkSync(physicalParent, parent);
      },
      (checkout) => {
        const runDirectory = join(checkout, run);
        rmSync(runDirectory, { recursive: true, force: true });
        symlinkSync(join(process.cwd(), run), runDirectory);
      },
      (checkout) => {
        const parent = join(checkout, '.artifacts/performance/PF-01');
        const physicalParent = join(checkout, 'physical-pf01');
        mkdirSync(physicalParent, { recursive: true });
        mkdirSync(join(physicalParent, runId));
        for (const file of Object.keys(activeWaiver.artifactSha256)) {
          copyFileSync(join(process.cwd(), run, file), join(physicalParent, runId, file));
        }
        rmSync(parent, { recursive: true, force: true });
        symlinkSync(physicalParent, parent);
      },
    ];
    for (const mutate of mutations) {
      const checkout = physicalArtifactCheckout();
      mutate(checkout);
      expect(validateFe01Pf01ActiveWaiver({ repoRoot: checkout })).toMatchObject({ valid: false });
    }
  });
});
