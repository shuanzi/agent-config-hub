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
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error FE-01 waiver validator is a plain Node ESM module.
import { validateFe01Pf01Waiver } from '../../scripts/orchestrator/fe01-pf01-waiver.mjs';
// @ts-expect-error FE-01 waiver validator is a plain Node ESM module.
import { historicalPf01StepMetadata } from '../../scripts/orchestrator/fe01-pf01-waiver.mjs';
// @ts-expect-error runtime helper module is a plain Node ESM module.
import { sha256File } from '../../scripts/orchestrator/lib.mjs';

const runId = '20260811T024255740Z-p14989-000';
const run = `.artifacts/performance/PF-01/${runId}`;
const artifactSource = join(process.cwd(), run);
const waiver = JSON.parse(
  readFileSync('performance/waivers/fe-01-pf-01-l3-cold-start.json', 'utf8'),
);
const temporaryRoots: string[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function artifactCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'acm-fe01-pf01-waiver-'));
  temporaryRoots.push(root);
  const destination = join(root, runId);
  mkdirSync(destination);
  for (const file of Object.keys(waiver.artifactSha256)) {
    copyFileSync(join(artifactSource, file), join(destination, file));
  }
  return destination;
}

function updateHash(record: typeof waiver, artifactDirectory: string, file: string): void {
  record.artifactSha256[file] = sha256File(join(artifactDirectory, file));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('FE-01 PF-01 exact performance waiver', () => {
  it('从不可变 artifact 和 run-commit budget 复算唯一的已授权 L3 p50 失败', () => {
    expect(validateFe01Pf01Waiver()).toMatchObject({
      valid: true,
      manualDisposition: 'accepted-with-waiver',
      automaticResult: {
        status: 'fail',
        exitCode: 1,
        automatedExitCode: 1,
        violation: {
          metric: 'pf01.l3.cold_start.first_snapshot',
          observedMs: 612,
          thresholdMs: 610,
          deltaMs: 2,
        },
      },
    });
  });

  it('historical PF meta 明确声明未采样，并绑定原始 run', () => {
    const validation = validateFe01Pf01Waiver();
    expect(historicalPf01StepMetadata(validation)).toEqual({
      executionMode: 'historical-artifact-validation',
      samplingRun: false,
      historicalRunId: '20260811T024255740Z-p14989-000',
      initialWaiverValidation: 'valid',
    });
  });

  it('record 的 run、commit、metric、数值、exit/status 或 summary hash 任一漂移都不能获 waiver', () => {
    const mutations = [
      (record: typeof waiver) => (record.automaticResult.runId = '20260811T000000000Z-p0-000'),
      (record: typeof waiver) =>
        (record.automaticResult.run = '.artifacts/performance/PF-01/other'),
      (record: typeof waiver) => (record.automaticResult.commit = 'a'.repeat(40)),
      (record: typeof waiver) =>
        (record.automaticResult.violation.metric = 'pf01.search.results_visible'),
      (record: typeof waiver) => (record.automaticResult.violation.observedMs = 613),
      (record: typeof waiver) => (record.automaticResult.violation.thresholdMs = 611),
      (record: typeof waiver) => (record.automaticResult.violation.deltaMs = 3),
      (record: typeof waiver) => (record.automaticResult.exitCode = 0),
      (record: typeof waiver) => (record.automaticResult.status = 'pass'),
      (record: typeof waiver) => (record.scope = 'generic bypass'),
      (record: typeof waiver) => (record.artifactSha256['summary.json'] = 'a'.repeat(64)),
    ];
    for (const mutate of mutations) {
      const invalid = clone(waiver);
      mutate(invalid);
      expect(validateFe01Pf01Waiver({ waiver: invalid }).valid).toBe(false);
    }
  });

  it('record 与 automaticResult key set 封闭，且实际版本化文件字节哈希不能漂移', () => {
    const extraTopLevel = clone(waiver);
    extraTopLevel.unapproved = true;
    const extraAutomaticResult = clone(waiver);
    extraAutomaticResult.automaticResult.unapproved = true;
    for (const invalid of [extraTopLevel, extraAutomaticResult]) {
      expect(validateFe01Pf01Waiver({ waiver: invalid })).toMatchObject({ valid: false });
    }

    const root = mkdtempSync(join(tmpdir(), 'acm-fe01-pf01-waiver-byte-drift-'));
    temporaryRoots.push(root);
    const byteDriftedRecord = join(root, 'waiver.json');
    writeFileSync(
      byteDriftedRecord,
      `${readFileSync('performance/waivers/fe-01-pf-01-l3-cold-start.json', 'utf8')}\n`,
    );
    expect(validateFe01Pf01Waiver({ waiverRecordPath: byteDriftedRecord })).toMatchObject({
      valid: false,
    });
  });

  it('不可通过同步修改 record 的 hash 来重绑定 immutable artifact', () => {
    const directory = artifactCopy();
    const rewritten = clone(waiver);
    const proposed = JSON.parse(readFileSync(join(directory, 'proposed-budgets.json'), 'utf8'));
    proposed.note = 'non-contaminating rewritten proposed budget';
    writeFileSync(join(directory, 'proposed-budgets.json'), `${JSON.stringify(proposed)}\n`);
    updateHash(rewritten, directory, 'proposed-budgets.json');

    expect(
      validateFe01Pf01Waiver({ waiver: rewritten, artifactDirectory: directory }),
    ).toMatchObject({
      valid: false,
    });
  });

  it('dirty/inconclusive/contaminated/resource/provenance drift 或额外 metric failure 均 fail-closed', () => {
    const cases: Array<(directory: string, record: typeof waiver) => void> = [
      (directory, record) => {
        const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
        summary.comparisonProvenance.current.buildInputs.source.kind = 'dirty-checkout';
        writeFileSync(join(directory, 'summary.json'), `${JSON.stringify(summary)}\n`);
        updateHash(record, directory, 'summary.json');
      },
      (directory, record) => {
        const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
        summary.status = 'inconclusive';
        writeFileSync(join(directory, 'summary.json'), `${JSON.stringify(summary)}\n`);
        updateHash(record, directory, 'summary.json');
      },
      (directory, record) => {
        writeFileSync(join(directory, 'proposed-budgets.json'), 'SYNTHETIC-SECRET-pf01-waiver');
        updateHash(record, directory, 'proposed-budgets.json');
      },
      (directory, record) => {
        const resources = JSON.parse(
          readFileSync(join(directory, 'l3-resource-runs.json'), 'utf8'),
        );
        resources.runs[0].normalExit = false;
        writeFileSync(join(directory, 'l3-resource-runs.json'), `${JSON.stringify(resources)}\n`);
        updateHash(record, directory, 'l3-resource-runs.json');
      },
      (directory, record) => {
        const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
        summary.comparisonProvenance.current.artifact.actualBinarySha256 = 'b'.repeat(64);
        writeFileSync(join(directory, 'summary.json'), `${JSON.stringify(summary)}\n`);
        updateHash(record, directory, 'summary.json');
      },
      (directory) => {
        const summary = join(directory, 'summary.json');
        unlinkSync(summary);
        symlinkSync(join(artifactSource, 'summary.json'), summary);
      },
      (directory, record) => {
        const samples = JSON.parse(readFileSync(join(directory, 'samples.json'), 'utf8'));
        samples.metrics['pf01.select.skill_cells_visible'].samples = Array(20).fill(100);
        writeFileSync(join(directory, 'samples.json'), `${JSON.stringify(samples)}\n`);
        updateHash(record, directory, 'samples.json');
        const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
        summary.metrics['pf01.select.skill_cells_visible'] = {
          n: 20,
          min: 100,
          max: 100,
          p50: 100,
          p95: 100,
          minSamples: 20,
          complete: true,
          unit: 'ms',
          layer: 'L2 mock renderer（headless Chrome + Vite dev server；非 release-like artifact）',
        };
        writeFileSync(join(directory, 'summary.json'), `${JSON.stringify(summary)}\n`);
        updateHash(record, directory, 'summary.json');
      },
    ];
    for (const mutate of cases) {
      const directory = artifactCopy();
      expect(basename(directory)).toBe(runId);
      const invalid = clone(waiver);
      mutate(directory, invalid);
      expect(validateFe01Pf01Waiver({ waiver: invalid, artifactDirectory: directory }).valid).toBe(
        false,
      );
    }
  });
});
